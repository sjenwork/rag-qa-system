from typing import List, Optional
import os
import yaml
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn
from improved_rag_system import ImprovedRAGSystem

# 載入配置
with open("config.yaml", "r", encoding="utf-8") as f:
    config = yaml.safe_load(f)

app = FastAPI(title="RAG System API")

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 初始化 RAG 系統
rag_system = ImprovedRAGSystem()

# 請求/響應模型
class Question(BaseModel):
    text: str
    similarity_threshold: Optional[float] = None  # 添加可選的相似度閾值參數

class Answer(BaseModel):
    answer: str
    sources: List[str]

class Document(BaseModel):
    filename: str
    content: str

class DeleteRequest(BaseModel):
    filename: str
    password: str

# 身份驗證
def verify_password(password: str = Form(...)) -> bool:
    if password != config["server"]["admin_password"]:
        raise HTTPException(status_code=403, detail="密碼錯誤")
    return True

# API 路由
@app.get("/documents", response_model=List[str])
async def list_documents():
    """列出所有可用的文檔"""
    docs_dir = "docs"
    documents = []
    for filename in os.listdir(docs_dir):
        if any(filename.endswith(ext) for ext in config["upload"]["allowed_extensions"]):
            documents.append(filename)
    return documents

@app.post("/query", response_model=Answer)
async def query(question: Question):
    """查詢文檔"""
    try:
        # 使用用戶提供的閾值或默認值
        threshold = question.similarity_threshold
        if threshold is not None:
            # 確保閾值在有效範圍內
            min_threshold = config["server"]["similarity_settings"]["min_threshold"]
            max_threshold = config["server"]["similarity_settings"]["max_threshold"]
            threshold = max(min_threshold, min(max_threshold, threshold))
        
        result = rag_system.query(question.text, threshold)
        return Answer(answer=result["answer"], sources=result["sources"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    """上傳新文檔"""
    # 檢查文件大小
    file_size = 0
    content = b""
    while chunk := await file.read(8192):
        content += chunk
        file_size += len(chunk)
        if file_size > config["upload"]["max_file_size"]:
            raise HTTPException(status_code=413, detail="文件太大")
    
    # 檢查文件類型
    if not any(file.filename.endswith(ext) for ext in config["upload"]["allowed_extensions"]):
        raise HTTPException(status_code=400, detail="不支援的文件類型")
    
    # 保存文件
    file_path = os.path.join("docs", file.filename)
    with open(file_path, "wb") as f:
        f.write(content)
    
    # 添加到 RAG 系統
    with open(file_path, "r", encoding="utf-8") as f:
        text = f.read()
        rag_system.add_document(text, {"source": file.filename})
    
    return JSONResponse(content={"message": "文件上傳成功"})

@app.delete("/documents/{filename}")
async def delete_document(filename: str, password: str = Depends(verify_password)):
    """刪除文檔（需要管理員密碼）"""
    file_path = os.path.join("docs", filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    
    try:
        os.remove(file_path)
        # TODO: 從 RAG 系統中移除文檔
        return JSONResponse(content={"message": "文件刪除成功"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 掛載靜態文件（前端頁面）
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    # 確保必要的目錄存在
    os.makedirs("docs", exist_ok=True)
    os.makedirs("static", exist_ok=True)
    os.makedirs("logs", exist_ok=True)
    
    # 檢查並加載新文檔或更新的文檔
    docs_dir = "docs"
    loaded_docs = set()
    try:
        # 獲取已加載的文檔列表
        results = rag_system.collection.get()
        if results and results['metadatas']:
            for metadata in results['metadatas']:
                if 'source' in metadata:
                    loaded_docs.add(metadata['source'])
    except Exception as e:
        print(f"獲取已加載文檔列表時發生錯誤: {str(e)}")
    
    # 檢查並加載新文檔
    for filename in os.listdir(docs_dir):
        if any(filename.endswith(ext) for ext in config["upload"]["allowed_extensions"]):
            try:
                file_path = os.path.join(docs_dir, filename)
                with open(file_path, "r", encoding="utf-8") as f:
                    text = f.read()
                    rag_system.add_document(text, {"source": filename})
                    if filename not in loaded_docs:
                        print(f"加載新文檔: {filename}")
            except Exception as e:
                print(f"加載文檔 {filename} 時發生錯誤: {str(e)}")
    
    # 啟動服務器
    uvicorn.run(
        app,
        host=config["server"]["host"],
        port=config["server"]["port"]
    ) 