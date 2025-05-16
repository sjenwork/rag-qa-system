from typing import List, Optional, Dict
import os
import yaml
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends, BackgroundTasks, Request
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
import asyncio
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
import logging
from datetime import datetime

# 配置日誌
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 載入設定
with open("config.yaml", "r", encoding="utf-8") as f:
    config = yaml.safe_load(f)

# 初始化 Gemini 模型
genai.configure(api_key=config["gemini"]["api_key"])
model = genai.GenerativeModel("gemini-1.5-flash")

# 初始化 FastAPI 應用
app = FastAPI(title="RAG System API", root_path="/app/demo/rag")


# 超時中間件
class TimeoutMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        try:
            # 設置 60 秒超時
            response = await asyncio.wait_for(call_next(request), timeout=60.0)
            return response
        except asyncio.TimeoutError:
            logger.error(f"Request timeout: {request.url}")
            return JSONResponse(status_code=504, content={"detail": "請求處理超時，請稍後重試"})
        except Exception as e:
            logger.error(f"Error processing request: {str(e)}")
            return JSONResponse(status_code=500, content={"detail": "處理請求時發生錯誤"})


# 添加中間件
app.add_middleware(TimeoutMiddleware)

# 設定 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "X-Device-ID", "X-User-Name"],  # 明確允許自定義請求頭
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
    enhanced_prompt: str  # 添加強化後的提示詞字段


class Document(BaseModel):
    filename: str
    content: str


class DeleteRequest(BaseModel):
    filename: str
    password: str


class UserAction(BaseModel):
    device_id: str
    user_name: Optional[str] = None
    action: str
    details: Optional[Dict] = None


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


# 用戶訪問記錄
async def log_user_activity(request: Request, action: str, details: Optional[Dict] = None):
    """記錄用戶活動"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    client_host = request.client.host
    user_agent = request.headers.get("user-agent", "unknown")

    log_entry = {
        "timestamp": timestamp,
        "ip": client_host,
        "user_agent": user_agent,
        "action": action,
        "details": details or {},
    }

    # 寫入日誌文件
    log_file = f"logs/user_activity_{datetime.now().strftime('%Y-%m-%d')}.log"
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")


@app.post("/query", response_model=Answer)
async def query(request: Request, question: Question, background_tasks: BackgroundTasks):
    """查詢文件"""
    try:
        # 記錄查詢活動
        await log_user_activity(
            request, "query", {"question": question.text, "similarity_threshold": question.similarity_threshold}
        )

        # 原有的查詢邏輯
        threshold = question.similarity_threshold
        if threshold is not None:
            min_threshold = config["server"]["similarity_settings"]["min_threshold"]
            max_threshold = config["server"]["similarity_settings"]["max_threshold"]
            threshold = max(min_threshold, min(max_threshold, threshold))

        result = await asyncio.wait_for(asyncio.to_thread(rag_system.query, question.text, threshold), timeout=30.0)

        return Answer(
            answer=result["answer"],
            sources=result["sources"],
            enhanced_prompt=result.get("enhanced_prompt", "未提供強化後的提示詞"),
        )
    except Exception as e:
        # 記錄錯誤
        await log_user_activity(request, "query_error", {"error": str(e), "question": question.text})
        raise


@app.post("/upload")
async def upload_document(request: Request, file: UploadFile = File(...), password: str = Form(...)):
    """上傳新文件（需要管理員密碼）"""
    try:
        # 記錄上傳活動
        await log_user_activity(request, "upload", {"filename": file.filename})

        # 原有的上傳邏輯
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
    except Exception as e:
        await log_user_activity(request, "upload_error", {"filename": file.filename, "error": str(e)})
        raise


@app.delete("/documents/{filename}")
async def delete_document(request: Request, filename: str, password: str = Depends(verify_password)):
    """刪除文件（需要管理員密碼）"""
    try:
        # 記錄刪除活動
        await log_user_activity(request, "delete", {"filename": filename})

        # 原有的刪除邏輯
        file_path = os.path.join("docs", filename)
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="檔案不存在")

        os.remove(file_path)
        # TODO: 從 RAG 系統中移除文件
        return JSONResponse(content={"message": "檔案刪除成功"})
    except Exception as e:
        await log_user_activity(request, "delete_error", {"filename": filename, "error": str(e)})
        raise


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
    請分析提供的表格圖片並轉換為 JSON 格式。
    1. 使用表格的標題列作為鍵值來建立資料結構
    2. 如果不同欄位之間有對應的項目（如「(一)」、「(二)」等），請在 JSON 結構中將它們分開為獨立的項目
    3. 請使用正體中文（繁體中文）輸出
    4. 只回傳純 JSON 資料，不要包含其他說明文字或 markdown 標記
    """

    try:
        # 產生 Gemini 回應
        response = model.generate_content([prompt, img])

        # 清理回應文字
        clean_text = response.text.strip()

        # 移除可能的程式碼區塊標記
        if clean_text.startswith("```json"):
            clean_text = clean_text[7:]
        elif clean_text.startswith("```"):
            clean_text = clean_text[3:]
        if clean_text.endswith("```"):
            clean_text = clean_text[:-3]

        clean_text = clean_text.strip()

        # 嘗試解析 JSON
        try:
            json_data = json.loads(clean_text)
            return json_data
        except json.JSONDecodeError as e:
            logger.error(f"JSON 解析錯誤：{str(e)}\n原始內容：{clean_text}")
            raise HTTPException(status_code=500, detail=f"無法解析 AI 回應為 JSON 格式：{str(e)}")

    except Exception as e:
        logger.error(f"處理圖片時發生錯誤：{str(e)}")
        raise HTTPException(status_code=500, detail=f"處理圖片時發生錯誤：{str(e)}")


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
            clean_text = response.text.strip("`").strip()
            if clean_text.startswith("json"):
                clean_text = clean_text[4:]
            try:
                # 尋找 JSON 陣列的起始和結束位置
                start_idx = clean_text.find("[")
                end_idx = clean_text.rfind("]") + 1
                json_content = clean_text[start_idx:end_idx]
                json_data = json.loads(json_content)
                return json_data
            except json.JSONDecodeError as e:
                raise Exception(f"無法解析回應為 JSON：{e}\n回應內容：{response.text}")
    except Exception as e:
        return {"error": f"處理 PDF 時發生錯誤：{str(e)}"}


async def save_table_formats(data, base_name, output_dir):
    """將表格資料儲存為多種格式並回傳 URLs"""

    # 儲存 JSON 結果
    json_filename = f"{base_name}.json"
    json_output_path = output_dir / json_filename
    with json_output_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # 儲存 CSV 結果
    csv_filename = f"{base_name}.csv"
    csv_output_path = output_dir / csv_filename
    df = pd.DataFrame(data)
    df.to_csv(csv_output_path, index=False)

    # 儲存 Excel 結果
    excel_filename = f"{base_name}.xlsx"
    excel_output_path = output_dir / excel_filename
    df.to_excel(excel_output_path, index=False)

    # 儲存純文字結果
    text_filename = f"{base_name}.txt"
    text_output_path = output_dir / text_filename

    # 將 JSON 資料轉換為易讀的文字格式
    text_content = []
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                for key, value in item.items():
                    text_content.append(f"{key}: {value}")
            else:
                text_content.append(str(item))
            text_content.append("-" * 40)  # 分隔線
    elif isinstance(data, dict):
        for key, value in data.items():
            text_content.append(f"{key}: {value}")

    # 寫入文字檔
    with text_output_path.open("w", encoding="utf-8") as f:
        f.write("\n".join(text_content))

    # 回傳相對於伺服器的路徑和純文字內容
    return {
        "name": base_name,
        "json": f"./output/{json_filename}",
        "csv": f"./output/{csv_filename}",
        "excel": f"./output/{excel_filename}",
        "text": f"./output/{text_filename}",
        "text_content": "\n".join(text_content),  # 添加純文字內容
    }


@app.post("/convert")
async def convert_file(request: Request, file: UploadFile = File(...)):
    """處理上傳的圖片或 PDF 檔案並轉換為表格資料"""
    try:
        # 記錄轉換活動
        await log_user_activity(request, "convert", {"filename": file.filename})

        # 原有的轉換邏輯
        # 儲存上傳的檔案
        upload_dir = Path("uploads")
        upload_dir.mkdir(exist_ok=True)
        file_path = upload_dir / file.filename

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
                return JSONResponse(status_code=400, content={"error": result["error"]})

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
                    tables_output.append(await save_table_formats(table_data, base_name, output_dir))
            else:
                # 單一表格的情況
                base_name = f"{file_path.stem}"
                tables_output.append(await save_table_formats(result, base_name, output_dir))

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
        await log_user_activity(request, "convert_error", {"filename": file.filename, "error": str(e)})
        print(f"處理檔案時發生錯誤：{str(e)}")
        print(traceback.format_exc())
        return JSONResponse(status_code=500, content={"error": f"處理檔案時發生錯誤：{str(e)}"})
    finally:
        # 清理上傳的檔案
        if file_path.exists():
            file_path.unlink()


# 掛載靜態文件
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/output", StaticFiles(directory="output"), name="output")
app.mount("/docs", StaticFiles(directory="docs"), name="docs")

# 掛載根路徑的 HTML 檔案
app.mount("/", StaticFiles(directory="static", html=True), name="html")


# 健康檢查端點
@app.get("/health")
async def health_check():
    """健康檢查端點"""
    try:
        # 檢查 RAG 系統是否正常
        rag_system.collection.get()
        return {"status": "healthy", "timestamp": time.time()}
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        raise HTTPException(status_code=503, detail="系統異常")


@app.get("/visit")
async def visit():
    return JSONResponse(content={"status": "success"})


@app.post("/log_visit")
async def log_visit(request: Request):
    """記錄使用者訪問"""
    try:
        # 從請求頭或請求體中獲取資訊
        device_id = request.headers.get("X-Device-ID", "unknown")
        user_name = request.headers.get("X-User-Name", "anonymous")

        # 記錄訪問資訊
        logger.info(f"收到訪問請求: device_id={device_id}, user_name={user_name}")

        # 記錄用戶活動
        await log_user_activity(
            request,
            "visit",
            {
                "device_id": device_id,
                "user_name": user_name,
                "path": str(request.url.path),
                "method": request.method,
                "headers": dict(request.headers),
            },
        )

        return JSONResponse(
            status_code=200,
            content={"status": "success", "message": "訪問記錄已保存", "device_id": device_id, "user_name": user_name},
        )
    except Exception as e:
        logger.error(f"記錄訪問失敗：{str(e)}")
        logger.error(f"錯誤詳情：{traceback.format_exc()}")
        return JSONResponse(status_code=500, content={"status": "error", "error": "記錄訪問失敗", "detail": str(e)})


@app.post("/log_action")
async def log_action(action: UserAction, request: Request):
    """記錄使用者行為"""
    try:
        await log_user_activity(
            request,
            action.action,
            {"device_id": action.device_id, "user_name": action.user_name, "details": action.details},
        )

        return JSONResponse(content={"status": "success"})
    except Exception as e:
        logger.error(f"記錄行為失敗：{str(e)}")
        return JSONResponse(status_code=500, content={"error": "記錄行為失敗"})


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
        if results and results["metadatas"]:
            for metadata in results["metadatas"]:
                if "source" in metadata:
                    loaded_docs.add(metadata["source"])
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
    uvicorn.run(app, host=config["server"]["host"], port=config["server"]["port"])
