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
        初始化改进版RAG系统
        
        Args:
            config_path: 配置文件路径
        """
        self._setup_logging()
        self.config = self._load_config(config_path)
        self._initialize_components()
        
    def _setup_logging(self) -> None:
        """配置日志系统"""
        logger.add(
            "logs/rag_system.log",
            rotation="500 MB",
            retention="10 days",
            level="INFO"
        )
    
    def _load_config(self, config_path: str) -> dict:
        """
        加载配置文件
        
        Args:
            config_path: 配置文件路径
            
        Returns:
            配置字典
        """
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f)
            logger.info(f"成功加载配置文件: {config_path}")
            return config
        except Exception as e:
            logger.error(f"加载配置文件失败: {str(e)}")
            raise
    
    def _initialize_components(self) -> None:
        """初始化系统组件"""
        try:
            # 初始化 Gemini
            genai.configure(api_key=self.config['gemini']['api_key'])
            self.model = genai.GenerativeModel('gemini-1.5-pro')  # 改回 1.5 版本
            
            # 初始化 Sentence Transformer
            self.embedding_model = SentenceTransformer(
                'shibing624/text2vec-base-chinese'  # 使用專門的中文模型
            )
            
            # 初始化 ChromaDB
            self.client = chromadb.HttpClient(
                host=self.config.get('chroma_host', 'localhost'),
                port=self.config.get('chroma_port', 8000)
            )
            
            # 获取或创建集合
            self.collection = self._get_or_create_collection()
            
            # 初始化文本分割器
            self.text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=300,      # 更小的塊大小
                chunk_overlap=100,   # 適當的重疊
                separators=["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""],  # 中文分隔符
                keep_separator=True  # 保留分隔符
            )
            
            logger.info("所有组件初始化成功")
            
        except Exception as e:
            logger.error(f"组件初始化失败: {str(e)}")
            raise
    
    def _get_or_create_collection(self) -> Any:
        """獲取或創建ChromaDB集合"""
        collection_name = self.config.get('collection_name', 'documents')
        try:
            # 刪除現有集合（如果存在）
            try:
                self.client.delete_collection(collection_name)
                logger.info(f"刪除現有集合: {collection_name}")
            except:
                pass
            
            # 創建新集合
            logger.info(f"創建新的集合: {collection_name}")
            return self.client.create_collection(
                name=collection_name,
                metadata={"description": "Document collection for RAG"}
            )
        except Exception as e:
            logger.error(f"創建集合失敗: {str(e)}")
            raise
    
    def get_document_hash(self, text: str, metadata: dict) -> str:
        """
        计算文档的哈希值
        
        Args:
            text: 文档文本
            metadata: 文档元数据
            
        Returns:
            文档哈希值
        """
        content = f"{text}{str(sorted(metadata.items()))}"
        return hashlib.sha256(content.encode()).hexdigest()
    
    def embed_text(self, text: str) -> List[float]:
        """
        使用 Sentence Transformer 生成文本嵌入
        
        Args:
            text: 輸入文本
            
        Returns:
            文本嵌入向量
        """
        try:
            logger.info(f"正在生成文本嵌入，文本長度: {len(text)}")
            embedding = self.embedding_model.encode(text, normalize_embeddings=True)
            return embedding.tolist()
        except Exception as e:
            logger.error(f"生成文本嵌入失敗: {str(e)}")
            raise
    
    def add_document(self, text: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        """
        添加文档到向量存储
        
        Args:
            text: 文档文本
            metadata: 文档元数据
        """
        if metadata is None:
            metadata = {}
            
        try:
            # 计算文档哈希
            doc_hash = self.get_document_hash(text, metadata)
            metadata['doc_hash'] = doc_hash
            
            # 检查文档是否已存在且内容相同
            try:
                existing_docs = self.collection.get(
                    where={"doc_hash": doc_hash}
                )
                if existing_docs and existing_docs['metadatas']:
                    logger.info(f"文档已存在且未更改 (hash: {doc_hash}), 跳过处理")
                    return
            except Exception as e:
                logger.warning(f"檢查文檔存在時發生錯誤: {str(e)}")
            
            # 如果是更新，先删除旧版本
            if 'source' in metadata:
                try:
                    old_docs = self.collection.get(
                        where={"source": metadata['source']}
                    )
                    if old_docs and old_docs['metadatas']:
                        old_hash = old_docs['metadatas'][0].get('doc_hash', '')
                        if old_hash == doc_hash:
                            logger.info(f"文檔內容未變更 (source: {metadata['source']}), 跳過處理")
                            return
                        self.collection.delete(
                            where={"source": metadata['source']}
                        )
                        logger.info(f"删除旧版本文档: {metadata['source']}")
                except Exception as e:
                    logger.warning(f"刪除舊版本時發生錯誤: {str(e)}")
            
            # 处理新文档
            chunks = self.text_splitter.split_text(text)
            if not chunks:
                logger.warning("文档分块后为空，跳过处理")
                return
                
            # 生成嵌入
            embeddings = [self.embed_text(chunk) for chunk in chunks]
            
            # 添加到ChromaDB
            self.collection.add(
                embeddings=embeddings,
                documents=chunks,
                metadatas=[{**metadata, "chunk_id": f"chunk_{i}"} for i in range(len(chunks))],
                ids=[f"doc_{doc_hash}_chunk_{i}" for i in range(len(chunks))]
            )
            
            logger.info(f"成功添加/更新文档 (hash: {doc_hash}, chunks: {len(chunks)})")
            
        except Exception as e:
            logger.error(f"添加文档失败: {str(e)}")
            raise
    
    def query(self, query_text: str, similarity_threshold: Optional[float] = None) -> dict:
        """
        查詢文檔並返回答案
        
        Args:
            query_text: 查詢文本
            similarity_threshold: 相似度閾值，如果為 None 則使用默認值
            
        Returns:
            包含答案和來源的字典
        """
        try:
            # 獲取默認閾值
            default_threshold = self.config["server"]["similarity_settings"]["default_threshold"]
            threshold = similarity_threshold if similarity_threshold is not None else default_threshold
            logger.info(f"使用相似度閾值: {threshold}")
            
            # 獲取查詢的嵌入向量
            query_embedding = self.embed_text(query_text)
            
            # 在 ChromaDB 中搜索相似文檔，增加檢索數量
            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=20,  # 增加檢索數量
                include=["documents", "metadatas", "distances"]
            )
            
            if not results["documents"][0]:
                logger.warning("沒有找到任何相關文檔")
                return {"answer": "抱歉，我在文檔中找不到相關的信息。", "sources": []}
            
            # 計算並輸出所有檢索結果的相似度
            all_results = []
            max_similarity = float('-inf')
            min_similarity = float('inf')
            
            # 首先找出最大和最小相似度
            for distance in results["distances"][0]:
                similarity = 1 - distance
                max_similarity = max(max_similarity, similarity)
                min_similarity = min(min_similarity, similarity)
            
            # 計算相似度範圍
            similarity_range = max_similarity - min_similarity
            
            # 對相似度進行歸一化處理
            for i, (doc, distance) in enumerate(zip(results["documents"][0], results["distances"][0])):
                # 原始相似度
                raw_similarity = 1 - distance
                
                # 歸一化相似度到 [0,1] 範圍
                if similarity_range > 0:
                    normalized_similarity = (raw_similarity - min_similarity) / similarity_range
                else:
                    normalized_similarity = 1 if raw_similarity == max_similarity else 0
                
                source = results["metadatas"][0][i].get("source", "未知")
                chunk_id = results["metadatas"][0][i].get("chunk_id", "未知")
                
                # 記錄詳細信息
                all_results.append({
                    "chunk": doc,
                    "raw_similarity": raw_similarity,
                    "normalized_similarity": normalized_similarity,
                    "source": source,
                    "chunk_id": chunk_id
                })
                logger.info(f"文檔 {i+1} - 原始相似度: {raw_similarity:.4f}, 歸一化相似度: {normalized_similarity:.4f}, 來源: {source}, 塊ID: {chunk_id}")
                logger.info(f"內容片段: {doc[:100]}...")
            
            # 根據歸一化相似度排序
            all_results.sort(key=lambda x: x["normalized_similarity"], reverse=True)
            
            # 使用歸一化後的相似度進行過濾
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
            
            # 對每個來源的文檔塊進行排序和合併
            for source, chunks in current_source_chunks.items():
                filtered_chunks.extend(chunks[:3])  # 每個來源最多使用前3個最相關的塊
            
            if not filtered_chunks:
                logger.warning(f"沒有文檔通過相似度閾值 {threshold} 的過濾")
                return {
                    "answer": f"抱歉，沒有找到相似度高於 {threshold:.2f} 的相關文檔。請嘗試調低相似度閾值。",
                    "sources": []
                }
            
            logger.info(f"過濾後保留了 {len(filtered_chunks)} 個相關片段，來自 {len(filtered_sources)} 個文檔")
            
            # 構建上下文
            context = "\n\n---\n\n".join(filtered_chunks)
            
            # 使用 Gemini 生成答案
            prompt = f"""基於以下文檔內容回答問題。如果文檔內容不足以回答問題，請說明無法回答。

問題：{query_text}

文檔內容：
{context}

請根據上述文檔內容提供準確、簡潔的回答。如果內容相關性不夠，請明確指出。
如果找到相關內容，請盡可能完整地回答問題。"""
            
            logger.info("發送到 Gemini 的提示詞：")
            logger.info(prompt)
            
            try:
                response = self.model.generate_content(prompt)
                answer = response.text
                logger.info(f"Gemini 返回的答案：{answer}")
            except Exception as e:
                logger.error(f"Gemini API 調用失敗: {str(e)}")
                answer = "抱歉，生成答案時出現錯誤。"
            
            return {
                "answer": answer,
                "sources": list(filtered_sources)
            }
            
        except Exception as e:
            logger.error(f"查詢處理失敗: {str(e)}")
            return {"answer": "抱歉，處理查詢時出現錯誤。", "sources": []} 