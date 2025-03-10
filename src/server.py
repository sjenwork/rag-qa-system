from typing import List, Optional
import os
import yaml
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn
from .improved_rag_system import ImprovedRAGSystem
import google.generativeai as genai
from PIL import Image
import pandas as pd
from pdf2image import convert_from_path
import json
import traceback
from pathlib import Path
import shutil
import time

# 載入設定
with open("config.yaml", "r", encoding="utf-8") as f:
    config = yaml.safe_load(f)

# 初始化 Gemini 模型
genai.configure(api_key=config["gemini"]["api_key"])
model = genai.GenerativeModel('gemini-1.5-pro')

app = FastAPI(title="RAG System API")

# 設定 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 初始化 RAG 系統
rag_system = ImprovedRAGSystem()

# 請求/回應模型
class Question(BaseModel):
    text: str
    similarity_threshold: Optional[float] = None  # 新增可選的相似度閾值參數

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
    """驗證管理員密碼"""
    if not password:
        raise HTTPException(status_code=401, detail="需要管理員密碼")
    if password != config["server"]["admin_password"]:
        raise HTTPException(status_code=403, detail="管理員密碼錯誤")
    return True

# API 路由
@app.get("/documents", response_model=List[str])
async def list_documents():
    """列出所有可用的文件"""
    docs_dir = "docs"
    documents = []
    for filename in os.listdir(docs_dir):
        if any(filename.endswith(ext) for ext in config["upload"]["allowed_extensions"]):
            documents.append(filename)
    return documents

@app.post("/query", response_model=Answer)
async def query(question: Question):
    """查詢文件"""
    try:
        # 使用使用者提供的閾值或預設值
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
async def upload_document(
    file: UploadFile = File(...),
    password: str = Form(...)
):
    """上傳新文件（需要管理員密碼）"""
    # 驗證密碼
    verify_password(password)
    
    # 檢查檔案大小
    file_size = 0
    content = b""
    while chunk := await file.read(8192):
        content += chunk
        file_size += len(chunk)
        if file_size > config["upload"]["max_file_size"]:
            raise HTTPException(status_code=413, detail="檔案太大")
    
    # 檢查檔案類型
    if not any(file.filename.endswith(ext) for ext in config["upload"]["allowed_extensions"]):
        raise HTTPException(status_code=400, detail="不支援的檔案類型")
    
    # 儲存檔案
    file_path = os.path.join("docs", file.filename)
    with open(file_path, "wb") as f:
        f.write(content)
    
    # 新增到 RAG 系統
    with open(file_path, "r", encoding="utf-8") as f:
        text = f.read()
        rag_system.add_document(text, {"source": file.filename})
    
    return JSONResponse(content={"message": "檔案上傳成功"})

@app.delete("/documents/{filename}")
async def delete_document(filename: str, password: str = Depends(verify_password)):
    """刪除文件（需要管理員密碼）"""
    file_path = os.path.join("docs", filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="檔案不存在")
    
    try:
        os.remove(file_path)
        # TODO: 從 RAG 系統中移除文件
        return JSONResponse(content={"message": "檔案刪除成功"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/documents/{filename}/content")
async def get_document_content(filename: str):
    """取得文件內容"""
    file_path = os.path.join("docs", filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="檔案不存在")
    
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        return content
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def process_image(model, image):
    # 載入並準備圖片
    if isinstance(image, (str, Path)):
        img = Image.open(str(image))
    else:
        img = image
    
    # 建立表格擷取的提示詞
    prompt = """
    分析提供的表格圖片並轉換為 JSON 格式。使用表格的標題列作為鍵值來建立資料結構。如果不同欄位之間有對應的項目（如「(一)」、「(二)」等），請在 JSON 結構中將它們分開為獨立的項目，並保留其編號。只回傳 JSON 資料，不要包含其他文字。
    """
    # 產生 Gemini 回應
    response = model.generate_content([prompt, img])
    
    # 解析 JSON 回應
    try:
        # 嘗試直接解析回應文字為 JSON
        json_data = json.loads(response.text)
        return json_data
    except json.JSONDecodeError:
        # 如果直接解析失敗，嘗試清理並擷取 JSON 內容
        print("警告：無法直接解析 JSON。嘗試清理回應內容。")
        # 移除任何 markdown 格式
        clean_text = response.text.strip('`').strip()
        if (clean_text.startswith('json')):
            clean_text = clean_text[4:]
        try:
            # 尋找 JSON 陣列的起始和結束位置
            start_idx = clean_text.find('[')
            end_idx = clean_text.rfind(']') + 1
            json_content = clean_text[start_idx:end_idx]
            json_data = json.loads(json_content)
            return json_data
        except json.JSONDecodeError as e:
            raise Exception(f"無法解析回應為 JSON：{e}\n回應內容：{response.text}")

def process_pdf(model, pdf_path):
    """
    處理 PDF 檔案，先檢查頁數，如果超過 5 頁則拒絕處理，
    否則將所有頁面一次送到 Gemini 處理，讓 AI 自動整合跨頁的表格
    """
    # 轉換 PDF 到圖片並檢查頁數
    images = convert_from_path(pdf_path)
    
    # 檢查頁數限制
    if len(images) > 5:
        return {"error": "PDF 頁數超過限制（最多 5 頁）", "page_count": len(images)}
    
    # 將所有頁面整合為一個請求
    prompt = """
    分析提供的 PDF 圖片中的表格並轉換為 JSON 格式。這些圖片是 PDF 文件的多個頁面。
    
    指示：
    1. 如果同一個表格跨越多個頁面，請將它們合併為一個完整的表格。
    2. 如果有多個不同的表格，請為每個不同的表格建立獨立的 JSON 陣列。
    3. 回傳的內容應為包含表格物件的 JSON 陣列。每個表格物件應包含：
       - "table_id"：每個不同表格的唯一識別碼
       - "data"：以欄位標題為鍵值的表格資料陣列
    
    只回傳 JSON 資料，不要包含其他文字。
    """
    
    # 產生 Gemini 回應
    try:
        # 將所有圖片一次送到 Gemini
        response = model.generate_content([prompt] + images)
        
        # 解析 JSON 結果
        try:
            # 嘗試直接解析回應文字為 JSON
            json_data = json.loads(response.text)
            return json_data
        except json.JSONDecodeError:
            # 如果直接解析失敗，嘗試擷取 JSON 內容
            clean_text = response.text.strip('`').strip()
            if (clean_text.startswith('json')):
                clean_text = clean_text[4:]
            try:
                # 尋找 JSON 陣列的起始和結束位置
                start_idx = clean_text.find('[')
                end_idx = clean_text.rfind(']') + 1
                json_content = clean_text[start_idx:end_idx]
                json_data = json.loads(json_content)
                return json_data
            except json.JSONDecodeError as e:
                raise Exception(f"無法解析回應為 JSON：{e}\n回應內容：{response.text}")
    except Exception as e:
        return {"error": f"處理 PDF 時發生錯誤：{str(e)}"}

async def save_table_formats(data, base_name, output_dir):
    """將表格資料儲存為多種格式並回傳 URLs"""
    # 使用時間戳記作為檔名前綴，避免衝突
    timestamp = int(time.time())
    
    # 儲存 JSON 結果
    json_filename = f"{timestamp}_{base_name}.json"
    json_output_path = output_dir / json_filename
    with json_output_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    # 儲存 CSV 結果
    csv_filename = f"{timestamp}_{base_name}.csv"
    csv_output_path = output_dir / csv_filename
    df = pd.DataFrame(data)
    df.to_csv(csv_output_path, index=False)
    
    # 儲存 Excel 結果
    excel_filename = f"{timestamp}_{base_name}.xlsx"
    excel_output_path = output_dir / excel_filename
    df.to_excel(excel_output_path, index=False)
    
    # 回傳相對於伺服器的路徑
    return {
        "name": base_name,
        "json": f"/output/{json_filename}",
        "csv": f"/output/{csv_filename}",
        "excel": f"/output/{excel_filename}"
    }

@app.post("/convert")
async def convert_file(file: UploadFile = File(...)):
    """處理上傳的圖片或 PDF 檔案並轉換為表格資料"""
    # 儲存上傳的檔案
    upload_dir = Path("uploads")
    upload_dir.mkdir(exist_ok=True)
    file_path = upload_dir / file.filename
    
    try:
        # 儲存上傳的檔案
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        output_dir = Path("output")
        output_dir.mkdir(exist_ok=True)

        # 處理檔案
        if file.filename.lower().endswith((".pdf", ".PDF")):
            # 處理 PDF 檔案
            result = process_pdf(model, file_path)
            
            # 檢查是否有錯誤訊息（例如頁數過多）
            if isinstance(result, dict) and "error" in result:
                return JSONResponse(
                    status_code=400,
                    content={"error": result["error"]}
                )
            
            # 處理結果
            tables_output = []
            
            # 檢查回傳的資料結構
            if isinstance(result, list):
                # 多個表格的情況
                for table_idx, table in enumerate(result):
                    table_id = table.get("table_id", f"table_{table_idx + 1}")
                    table_data = table.get("data", table)  # 如果沒有 data 欄位，就使用整個表
                    
                    # 產生檔名
                    base_name = f"{file_path.stem}_{table_id}"
                    
                    # 儲存各種格式
                    tables_output.append(
                        await save_table_formats(table_data, base_name, output_dir)
                    )
            else:
                # 單一表格的情況
                base_name = f"{file_path.stem}"
                tables_output.append(
                    await save_table_formats(result, base_name, output_dir)
                )
            
            # 回傳處理結果
            return JSONResponse(content={"tables": tables_output})
        
        else:
            # 處理單一圖片
            json_data = process_image(model, file_path)
            base_name = f"{file_path.stem}"
            table_output = await save_table_formats(json_data, base_name, output_dir)
            
            # 回傳單頁結果
            return JSONResponse(content={"tables": [table_output]})
    except Exception as e:
        print(f"處理檔案時發生錯誤：{str(e)}")
        print(traceback.format_exc())
        return JSONResponse(
            status_code=500,
            content={"error": f"處理檔案時發生錯誤：{str(e)}"}
        )
    finally:
        # 清理上傳的檔案
        if file_path.exists():
            file_path.unlink()

# 掛載靜態檔案（前端頁面和輸出檔案）
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/output", StaticFiles(directory="output"), name="output")

# 掛載根路徑的 HTML 檔案
app.mount("/", StaticFiles(directory="static", html=True), name="html")

@app.on_event("startup")
async def startup_event():
    """服務啟動時的初始化操作"""
    # 確保必要的目錄存在
    os.makedirs("docs", exist_ok=True)
    os.makedirs("static", exist_ok=True)
    os.makedirs("logs", exist_ok=True)
    os.makedirs("uploads", exist_ok=True)
    os.makedirs("output", exist_ok=True)
    
    # 列印所有註冊的路由
    print("\n=== 已註冊的路由 ===")
    for route in app.routes:
        if hasattr(route, "methods"):
            print(f"路由：{route.path}, 方法：{route.methods}")
    print("==================\n")
    
    # 檢查並載入新文件或更新的文件
    docs_dir = "docs"
    loaded_docs = set()
    try:
        # 取得已載入的文件列表
        results = rag_system.collection.get()
        if results and results['metadatas']:
            for metadata in results['metadatas']:
                if 'source' in metadata:
                    loaded_docs.add(metadata['source'])
    except Exception as e:
        print(f"取得已載入文件列表時發生錯誤：{str(e)}")
    
    # 檢查並載入新文件
    for filename in os.listdir(docs_dir):
        if any(filename.endswith(ext) for ext in config["upload"]["allowed_extensions"]):
            try:
                file_path = os.path.join(docs_dir, filename)
                with open(file_path, "r", encoding="utf-8") as f:
                    text = f.read()
                    rag_system.add_document(text, {"source": filename})
                    if filename not in loaded_docs:
                        print(f"載入新文件：{filename}")
            except Exception as e:
                print(f"載入文件 {filename} 時發生錯誤：{str(e)}")

if __name__ == "__main__":
    # 啟動伺服器
    uvicorn.run(
        app,
        host=config["server"]["host"],
        port=config["server"]["port"]
    ) 