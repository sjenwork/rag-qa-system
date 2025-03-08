# 文件問答系統（RAG System）

這是一個基於 Python 的文件問答系統，採用 RAG（Retrieval-Augmented Generation）技術，結合 Gemini 和 Sentence Transformers 實現高品質的文件檢索與問答功能。

## 系統特色

- 運用 Sentence Transformers 進行高品質文本向量化
- 完整的例外處理與記錄功能
- 支援型別提示
- 可自訂文件切分策略
- 文件去重與版本控制
- 支援中繼資料管理

## 系統需求

- Python 3.8 以上版本
- ChromaDB 伺服器
- Gemini API 金鑰

## 安裝方式

1. 安裝相依套件：
```bash
pip install -r requirements.txt
```

2. 系統設定：
- 複製 `config.yaml` 並填寫必要的設定資訊
- 確認 ChromaDB 伺服器已啟動
- 設定有效的 Gemini API 金鑰

## 使用說明

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

## 設定說明

設定檔（config.yaml）包含以下主要設定：

- Gemini API 設定
- ChromaDB 連線設定
- 向量模型選擇
- 文件處理參數

## 系統記錄

系統記錄檔儲存於 `logs/rag_system.log`，包含詳細的操作記錄和錯誤資訊。

## 改進重點

相較於原始版本：

1. 採用專業的 Sentence Transformers 取代簡單的詞頻向量
2. 新增完整的例外處理與記錄功能
3. 支援型別提示
4. 優化文件處理流程
5. 更彈性的設定選項
6. 提升程式碼組織與文件品質 