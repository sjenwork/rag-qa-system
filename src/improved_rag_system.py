from typing import List, Dict, Any, Optional
import os
import yaml
import hashlib
from pathlib import Path
import numpy as np
import chromadb
import google.generativeai as genai
from sentence_transformers import SentenceTransformer
from langchain.text_splitter import RecursiveCharacterTextSplitter
from loguru import logger

class ImprovedRAGSystem:
    def __init__(self, config_path: str = "config.yaml"):
        """
        初始化改進版 RAG 系統
        
        Args:
            config_path: 設定檔路徑
        """
        self._setup_logging()
        self.config = self._load_config(config_path)
        self._initialize_components()
        
    def _setup_logging(self) -> None:
        """設定日誌系統"""
        logger.add(
            "logs/rag_system.log",
            rotation="500 MB",
            retention="10 days",
            level="INFO"
        )
    
    def _load_config(self, config_path: str) -> dict:
        """
        載入設定檔
        
        Args:
            config_path: 設定檔路徑
            
        Returns:
            設定字典
        """
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f)
            logger.info(f"成功載入設定檔：{config_path}")
            return config
        except Exception as e:
            logger.error(f"載入設定檔失敗：{str(e)}")
            raise
    
    def _initialize_components(self) -> None:
        """初始化系統元件"""
        try:
            # 初始化 Gemini
            genai.configure(api_key=self.config['gemini']['api_key'])
            self.model = genai.GenerativeModel('gemini-1.5-flash')  # 使用 1.5 版本
            
            # 初始化 Sentence Transformer
            self.embedding_model = SentenceTransformer(
                'shibing624/text2vec-base-chinese'  # 使用專門的中文模型
            )
            
            # 初始化 ChromaDB
            self.client = chromadb.HttpClient(
                host=self.config.get('chroma_host', 'localhost'),
                port=self.config.get('chroma_port', 8000)
            )
            
            # 取得或建立集合
            self.collection = self._get_or_create_collection()
            
            # 初始化文字分割器
            self.text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=300,      # 較小的區塊大小
                chunk_overlap=100,   # 適當的重疊
                separators=["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""],  # 中文分隔符
                keep_separator=True  # 保留分隔符
            )
            
            logger.info("所有元件初始化成功")
            
        except Exception as e:
            logger.error(f"元件初始化失敗：{str(e)}")
            raise
    
    def _get_or_create_collection(self) -> Any:
        """取得或建立 ChromaDB 集合"""
        collection_name = self.config.get('collection_name', 'documents')
        try:
            # 嘗試取得現有集合
            try:
                collection = self.client.get_collection(collection_name)
                logger.info(f"取得現有集合：{collection_name}")
                return collection
            except:
                # 如果集合不存在，建立新集合
                logger.info(f"建立新的集合：{collection_name}")
                return self.client.create_collection(
                    name=collection_name,
                    metadata={"description": "Document collection for RAG"}
                )
        except Exception as e:
            logger.error(f"取得或建立集合失敗：{str(e)}")
            raise
    
    def get_document_hash(self, text: str, metadata: dict) -> str:
        """
        計算文件的雜湊值
        
        Args:
            text: 文件文字
            metadata: 文件元資料
            
        Returns:
            文件雜湊值
        """
        content = f"{text}{str(sorted(metadata.items()))}"
        return hashlib.sha256(content.encode()).hexdigest()
    
    def embed_text(self, text: str) -> List[float]:
        """
        使用 Sentence Transformer 產生文字嵌入
        
        Args:
            text: 輸入文字
            
        Returns:
            文字嵌入向量
        """
        try:
            logger.info(f"正在產生文字嵌入，文字長度：{len(text)}")
            embedding = self.embedding_model.encode(text, normalize_embeddings=True)
            return embedding.tolist()
        except Exception as e:
            logger.error(f"產生文字嵌入失敗：{str(e)}")
            raise
    
    def add_document(self, text: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        """
        新增文件到向量儲存
        
        Args:
            text: 文件文字
            metadata: 文件元資料
        """
        if metadata is None:
            metadata = {}
            
        try:
            # 計算文件雜湊值
            doc_hash = self.get_document_hash(text, metadata)
            metadata['doc_hash'] = doc_hash
            
            # 檢查文件是否已存在且內容相同
            try:
                existing_docs = self.collection.get(
                    where={"doc_hash": doc_hash}
                )
                if existing_docs and existing_docs['metadatas']:
                    logger.info(f"文件已存在且未更改（雜湊值：{doc_hash}），跳過處理")
                    return
            except Exception as e:
                logger.warning(f"檢查文件存在時發生錯誤：{str(e)}")
            
            # 如果是更新，先刪除舊版本
            if 'source' in metadata:
                try:
                    old_docs = self.collection.get(
                        where={"source": metadata['source']}
                    )
                    if old_docs and old_docs['metadatas']:
                        old_hash = old_docs['metadatas'][0].get('doc_hash', '')
                        if old_hash == doc_hash:
                            logger.info(f"文件內容未變更（來源：{metadata['source']}），跳過處理")
                            return
                        self.collection.delete(
                            where={"source": metadata['source']}
                        )
                        logger.info(f"刪除舊版本文件：{metadata['source']}")
                except Exception as e:
                    logger.warning(f"刪除舊版本時發生錯誤：{str(e)}")
            
            # 處理新文件
            chunks = self.text_splitter.split_text(text)
            if not chunks:
                logger.warning("文件分割後為空，跳過處理")
                return
                
            # 產生嵌入
            embeddings = [self.embed_text(chunk) for chunk in chunks]
            
            # 新增到 ChromaDB
            self.collection.add(
                embeddings=embeddings,
                documents=chunks,
                metadatas=[{**metadata, "chunk_id": f"chunk_{i}"} for i in range(len(chunks))],
                ids=[f"doc_{doc_hash}_chunk_{i}" for i in range(len(chunks))]
            )
            
            logger.info(f"成功新增/更新文件（雜湊值：{doc_hash}，區塊數：{len(chunks)}）")
            
        except Exception as e:
            logger.error(f"新增文件失敗：{str(e)}")
            raise
    
    def query(self, query_text: str, similarity_threshold: Optional[float] = None) -> dict:
        """
        查詢文字並回傳答案
        
        Args:
            query_text: 查詢文字
            similarity_threshold: 相似度閾值，如果為 None 則使用預設值
            
        Returns:
            包含答案和來源的字典
        """
        try:
            # 取得預設閾值
            default_threshold = self.config["server"]["similarity_settings"]["default_threshold"]
            threshold = similarity_threshold if similarity_threshold is not None else default_threshold
            logger.info(f"使用相似度閾值：{threshold}")
            
            # 取得查詢的嵌入向量
            query_embedding = self.embed_text(query_text)
            
            # 在 ChromaDB 中搜尋相似文字，增加檢索數量
            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=20,  # 增加檢索數量
                include=["documents", "metadatas", "distances"]
            )
            
            if not results["documents"][0]:
                logger.warning("沒有找到任何相關文字")
                return {"answer": "抱歉，我在文件中找不到相關的資訊。", "sources": [], "enhanced_prompt": ""}
            
            # 計算並輸出所有檢索結果的相似度
            all_results = []
            max_similarity = float('-inf')
            min_similarity = float('inf')
            
            # 先找出最大和最小相似度
            for distance in results["distances"][0]:
                similarity = 1 - distance
                max_similarity = max(max_similarity, similarity)
                min_similarity = min(min_similarity, similarity)
            
            # 計算相似度範圍
            similarity_range = max_similarity - min_similarity
            
            # 對相似度進行正規化處理
            for i, (doc, distance) in enumerate(zip(results["documents"][0], results["distances"][0])):
                # 原始相似度
                raw_similarity = 1 - distance
                
                # 正規化相似度到 [0,1] 範圍
                if similarity_range > 0:
                    normalized_similarity = (raw_similarity - min_similarity) / similarity_range
                else:
                    normalized_similarity = 1 if raw_similarity == max_similarity else 0
                
                source = results["metadatas"][0][i].get("source", "未知")
                chunk_id = results["metadatas"][0][i].get("chunk_id", "未知")
                
                # 記錄詳細資訊
                all_results.append({
                    "chunk": doc,
                    "raw_similarity": raw_similarity,
                    "normalized_similarity": normalized_similarity,
                    "source": source,
                    "chunk_id": chunk_id
                })
                logger.info(f"文字 {i+1} - 原始相似度：{raw_similarity:.4f}，正規化相似度：{normalized_similarity:.4f}，來源：{source}，區塊 ID：{chunk_id}")
                logger.info(f"內容片段：{doc[:100]}...")
            
            # 根據正規化相似度排序
            all_results.sort(key=lambda x: x["normalized_similarity"], reverse=True)
            
            # 使用正規化後的相似度進行過濾
            filtered_chunks = []
            filtered_sources = set()
            current_source_chunks = {}
            
            for result in all_results:
                if result["normalized_similarity"] >= threshold:
                    source = result["source"]
                    if source not in current_source_chunks:
                        current_source_chunks[source] = []
                    current_source_chunks[source].append(result["chunk"])
                    filtered_sources.add(source)
            
            # 對每個來源的文字區塊進行排序和合併
            for source, chunks in current_source_chunks.items():
                filtered_chunks.extend(chunks[:3])  # 每個來源最多使用前 3 個最相關的區塊
            
            if not filtered_chunks:
                logger.warning(f"沒有文字通過相似度閾值 {threshold} 的過濾")
                return {
                    "answer": f"抱歉，沒有找到相似度高於 {threshold:.2f} 的相關文字。請嘗試調低相似度閾值。",
                    "sources": [],
                    "enhanced_prompt": ""
                }
            
            logger.info(f"過濾後保留了 {len(filtered_chunks)} 個相關片段，來自 {len(filtered_sources)} 個文件")
            
            # 建立上下文
            context = "\n\n---\n\n".join(filtered_chunks)
            
            # 使用 Gemini 產生答案
            prompt = f"""基於以下文字內容回答問題。如果文字內容不足以回答問題，請說明無法回答。

問題：{query_text}

文字內容：
{context}

請根據上述文字內容提供準確、簡潔的回答。如果內容相關性不夠，請明確指出。
如果找到相關內容，請盡可能完整地回答問題。"""
            
            logger.info("發送到 Gemini 的提示詞：")
            logger.info(prompt)
            
            try:
                response = self.model.generate_content(prompt)
                answer = response.text
                logger.info(f"Gemini 回傳的答案：{answer}")
            except Exception as e:
                logger.error(f"Gemini API 呼叫失敗：{str(e)}")
                answer = "抱歉，產生答案時出現錯誤。"
            
            return {
                "answer": answer,
                "sources": list(filtered_sources),
                "enhanced_prompt": prompt
            }
            
        except Exception as e:
            logger.error(f"查詢處理失敗：{str(e)}")
            return {"answer": "抱歉，處理查詢時出現錯誤。", "sources": [], "enhanced_prompt": ""} 