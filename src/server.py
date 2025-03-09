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
import google.generativeai as genai
from PIL import Image
import pandas as pd
from pdf2image import convert_from_path
import json
import traceback
from pathlib import Path
import shutil
import time

# 載入配置
with open("config.yaml", "r", encoding="utf-8") as f:
    config = yaml.safe_load(f)

# 初始化 Gemini 模型
genai.configure(api_key=config["gemini"]["api_key"])
model = genai.GenerativeModel('gemini-1.5-pro')

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

@app.get("/documents/{filename}/content")
async def get_document_content(filename: str):
    """獲取文檔內容"""
    file_path = os.path.join("docs", filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        return content
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def process_image(model, image):
    # Load and prepare the image
    if isinstance(image, (str, Path)):
        img = Image.open(str(image))
    else:
        img = image
    
    # Create the prompt for table extraction
    prompt = """
    Analyze the provided table image and convert it into JSON format. Structure the data using the table's header columns as keys. If there are corresponding items (like "(一)", "(二)", etc.) across different columns, split them into individual entries within the JSON structure, preserving their numbering. Return only the JSON data without any additional text.
    """
    # Generate response from Gemini
    response = model.generate_content([prompt, img])
    
    # Extract JSON from response
    try:
        # Attempt to parse the response text as JSON
        json_data = json.loads(response.text)
        return json_data
    except json.JSONDecodeError:
        # If direct parsing fails, try to extract JSON-like content
        print("Warning: Could not directly parse JSON. Attempting to clean response.")
        # Remove any markdown formatting if present
        clean_text = response.text.strip('`').strip()
        if (clean_text.startswith('json')):
            clean_text = clean_text[4:]
        try:
            # Find the start and end of the JSON array
            start_idx = clean_text.find('[')
            end_idx = clean_text.rfind(']') + 1
            json_content = clean_text[start_idx:end_idx]
            json_data = json.loads(json_content)
            return json_data
        except json.JSONDecodeError as e:
            raise Exception(f"Failed to parse response as JSON: {e}\nResponse was: {response.text}")

def process_pdf(model, pdf_path):
    """
    處理 PDF 檔案，首先檢查頁數，如果超過 5 頁則拒絕處理，
    否則將所有頁面一次性送到 Gemini 處理，讓 AI 自動整合跨頁的表格
    """
    # 轉換 PDF 到圖片並檢查頁數
    images = convert_from_path(pdf_path)
    
    # 檢查頁數限制
    if len(images) > 5:
        return {"error": "PDF 頁數超過限制（最多 5 頁）", "page_count": len(images)}
    
    # 將所有頁面整合為一個請求
    prompt = """
    Analyze the provided PDF images of tables and convert them into JSON format. These images are multiple pages of a PDF document.
    
    Instructions:
    1. If the same table spans across multiple pages, combine them into a single coherent table.
    2. If there are multiple different tables, create separate JSON arrays for each distinct table.
    3. Return your response as a JSON array of table objects. Each table object should have:
       - "table_id": A unique identifier for each distinct table
       - "data": An array of table rows with column headers as keys
    
    Return only the JSON data without any additional text.
    """
    
    # 生成 Gemini 的響應
    try:
        # 將所有圖片一次性送到 Gemini
        response = model.generate_content([prompt] + images)
        
        # 解析 JSON 結果
        try:
            # 嘗試直接解析響應文本為 JSON
            json_data = json.loads(response.text)
            return json_data
        except json.JSONDecodeError:
            # 如果直接解析失敗，嘗試提取 JSON 內容
            clean_text = response.text.strip('`').strip()
            if (clean_text.startswith('json')):
                clean_text = clean_text[4:]
            try:
                # 查找 JSON 數組的起始和結束
                start_idx = clean_text.find('[')
                end_idx = clean_text.rfind(']') + 1
                json_content = clean_text[start_idx:end_idx]
                json_data = json.loads(json_content)
                return json_data
            except json.JSONDecodeError as e:
                raise Exception(f"Failed to parse response as JSON: {e}\nResponse was: {response.text}")
    except Exception as e:
        return {"error": f"處理 PDF 時發生錯誤: {str(e)}"}

async def save_table_formats(data, base_name, output_dir):
    """將表格數據儲存為多種格式並返回URLs"""
    # 使用時間戳作為文件名前綴，避免衝突
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
    
    # 返回相對於服務器的路徑
    return {
        "name": base_name,
        "json": f"/output/{json_filename}",
        "csv": f"/output/{csv_filename}",
        "excel": f"/output/{excel_filename}"
    }

@app.post("/convert")
async def convert_file(file: UploadFile = File(...)):
    """處理上傳的圖片或 PDF 文件並轉換為表格數據"""
    # 儲存上傳的文件
    upload_dir = Path("uploads")
    upload_dir.mkdir(exist_ok=True)
    file_path = upload_dir / file.filename
    
    try:
        # 保存上傳的文件
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        output_dir = Path("output")
        output_dir.mkdir(exist_ok=True)

        # 處理文件
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
            
            # 檢查返回的數據結構
            if isinstance(result, list):
                # 多個表格的情況
                for table_idx, table in enumerate(result):
                    table_id = table.get("table_id", f"table_{table_idx + 1}")
                    table_data = table.get("data", table)  # 如果沒有 data 欄位，就使用整個表
                    
                    # 生成檔案名稱
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
            
            # 返回處理結果
            return JSONResponse(content={"tables": tables_output})
        
        else:
            # 處理單一圖片
            json_data = process_image(model, file_path)
            base_name = f"{file_path.stem}"
            table_output = await save_table_formats(json_data, base_name, output_dir)
            
            # 返回單頁結果
            return JSONResponse(content={"tables": [table_output]})
    except Exception as e:
        print(f"處理文件時發生錯誤: {str(e)}")
        print(traceback.format_exc())
        return JSONResponse(
            status_code=500,
            content={"error": f"處理文件時發生錯誤: {str(e)}"}
        )
    finally:
        # 清理上傳的文件
        if file_path.exists():
            file_path.unlink()

# 掛載靜態文件（前端頁面和輸出文件）
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/output", StaticFiles(directory="output"), name="output")

# 掛載根路徑的 HTML 文件
app.mount("/", StaticFiles(directory="static", html=True), name="html")

if __name__ == "__main__":
    # 確保必要的目錄存在
    os.makedirs("docs", exist_ok=True)
    os.makedirs("static", exist_ok=True)
    os.makedirs("logs", exist_ok=True)
    os.makedirs("uploads", exist_ok=True)
    os.makedirs("output", exist_ok=True)
    
    # 打印所有註冊的路由
    print("\n=== 已註冊的路由 ===")
    for route in app.routes:
        if hasattr(route, "methods"):
            print(f"路由: {route.path}, 方法: {route.methods}")
    print("==================\n")
    
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