# RAG 文本問答系統

## 功能簡介

- 輸入文字，系統會自動從背景知識庫中檢索相關資訊，並以文字方式呈現。
- 可新增知識庫，提供檔案上傳與文字輸入。
- 當檢索結果不夠滿意時，可調整相似度閾值，降低數值可增加檢索結果數量，但可能犧牲精確性。

## 使用須知
- <div style="color: red;">因採用較小的模型進行embeddings，所以檢索速度較快，但精確性較低。欲提升精準度必須使用較大的模型進行embeddings。</div>
- <div style="color: red;">因為是使用免費的Gemini API，所以有使用上的限制，請見[Gemini API 使用限制](https://ai.google.dev/gemini-api/docs/rate-limits)。</div>

## 架構說明
- 使用簡易的向量資料庫：ChromaDB
- 語句嵌入(Sentence Embedding)模型：shibing624/text2vec-base-chinese
   - 特色：輕量級，適合處理中文文本。
- LLMs: google/gemini-1.5-pro, google/gemini-1.5-flash
   - 特色：適合處理中文文本，且具備多模態能力。


---
# 影像/PDF 轉換文字

## 功能簡介

- 可將影像/PDF 轉換為文字。
- 輸出格式可選擇 json、txt、excel。