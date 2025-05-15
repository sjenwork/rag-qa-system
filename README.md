# 文件問答系統（RAG System）

這是一個基於 Python 的文件問答系統，採用 RAG（Retrieval-Augmented Generation）技術，結合 Gemini 和 Sentence Transformers 實現高品質的文件檢索與問答功能。系統提供完整的網頁介面，支援文件上傳、預覽、刪除等功能。

## 系統特色

- 運用 Sentence Transformers 進行高品質文字向量化
- 完整的例外處理與記錄功能
- 支援型別提示
- 可自訂文件分割策略
- 文件去重與版本控制
- 支援中繼資料管理
- 網頁介面支援：
  - 文件上傳與管理
  - Markdown 文件預覽
  - 文件內容直接編輯
  - 深色/淺色主題切換
  - 相似度閾值調整
  - 響應式設計

## 系統需求

- Python 3.8 以上版本
- Docker 和 Docker Compose
- ChromaDB 伺服器
- Gemini API 金鑰
- 現代化瀏覽器（支援 ES6+）

## 安裝方式

1. 安裝相依套件：
```bash
pip install -r requirements.txt
```

2. 啟動 ChromaDB 和相關服務：
```bash
# 啟動所有服務
docker-compose up -d

# 檢查服務狀態
docker-compose ps
```

3. 系統設定：
- 複製 `config.yaml` 並填寫必要的設定資訊
- 確認 ChromaDB 伺服器已啟動
- 設定有效的 Gemini API 金鑰

## 資料庫設定

系統使用 ChromaDB 作為向量資料庫。相關設定在 `docker-compose.yml` 中定義：

```yaml
services:
  chroma:
    image: chromadb/chroma:latest
    environment:
      - CHROMA_SERVER_HOST=0.0.0.0
      - CHROMA_SERVER_PORT=8000
    ports:
      - "8000:8000"
    volumes:
      - ./data/chromadb:/chroma/data
    restart: unless-stopped
```

確保在啟動系統前：
1. Docker 服務正在運行
2. ChromaDB 容器已成功啟動
3. 資料目錄具有適當的權限

## 使用說明

### 後端 API

```python
from src.improved_rag_system import ImprovedRAGSystem

# 初始化系統
rag = ImprovedRAGSystem()

# 新增文件
rag.add_document(
    text="您的文件內容",
    metadata={"source": "文件來源", "author": "作者"}
)

# 查詢
response = rag.query("您的問題")
print(response)
```

### 網頁介面

1. 啟動伺服器：
```bash
python src/server.py
```

2. 開啟瀏覽器訪問：`http://localhost:8080`

3. 主要功能：
   - 上傳文件：支援 .txt、.md 等格式
   - 直接編輯：支援 Markdown 格式編輯與預覽
   - 文件管理：預覽、刪除文件
   - 問答查詢：調整相似度閾值進行精確查詢

## 設定說明

設定檔（config.yaml）包含以下主要設定：

- Gemini API 設定
- ChromaDB 連線設定
- 向量模型選擇
- 文件處理參數
- 伺服器設定
- 上傳限制設定

## 系統記錄

系統記錄檔儲存於 `logs/rag_system.log`，包含詳細的操作記錄和錯誤資訊。

## 更新記錄

### 2025-03-09
- 修正查詢 API 請求格式，優化錯誤處理
- 新增直接輸入文字功能，支援 Markdown 格式
- 改進導覽列設計，優化深色模式支援
- 改進 Markdown 預覽功能，提供類似編輯器的體驗
- 優化使用者介面，改善中文本地化

### 2024-03-07
- 完成基本 RAG 系統實作
- 實作基於 ChromaDB 的向量儲存
- 使用 text2vec-base-chinese 進行中文文字嵌入
- 實作文字分割和相似度搜尋
- 新增網頁介面，支援文件上傳和刪除
- 新增相似度閾值調整功能
- 改進 Markdown 格式顯示

## 改進重點

相較於原始版本：

1. 採用專業的 Sentence Transformers 取代簡單的詞頻向量
2. 新增完整的例外處理與記錄功能
3. 支援型別提示
4. 優化文件處理流程
5. 更彈性的設定選項
6. 提升程式碼組織與文件品質
7. 新增完整的網頁介面
8. 支援深色/淺色主題切換
9. 改進文件預覽與編輯功能 
