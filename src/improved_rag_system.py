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
            self.model = genai.GenerativeModel('gemini-1.5-pro')
            
            # 初始化 Sentence Transformer
            self.embedding_model = SentenceTransformer(
                self.config.get('embedding_model', 'all-MiniLM-L6-v2')
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
                chunk_size=self.config.get('chunk_size', 500),
                chunk_overlap=self.config.get('chunk_overlap', 100),
                length_function=len,
                is_separator_regex=False
            )
            
            logger.info("所有组件初始化成功")
            
        except Exception as e:
            logger.error(f"组件初始化失败: {str(e)}")
            raise
    
    def _get_or_create_collection(self) -> Any:
        """获取或创建ChromaDB集合"""
        collection_name = self.config.get('collection_name', 'documents')
        try:
            return self.client.get_collection(collection_name)
        except:
            logger.info(f"创建新的集合: {collection_name}")
            return self.client.create_collection(
                name=collection_name,
                metadata={"description": "Document collection for RAG"}
            )
    
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
        使用Sentence Transformer生成文本嵌入
        
        Args:
            text: 输入文本
            
        Returns:
            文本嵌入向量
        """
        try:
            embedding = self.embedding_model.encode(text)
            return embedding.tolist()
        except Exception as e:
            logger.error(f"生成文本嵌入失败: {str(e)}")
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
            
            # 检查文档是否已存在
            existing_docs = self.collection.get(
                where={"doc_hash": doc_hash}
            )
            
            if existing_docs and existing_docs['metadatas']:
                logger.info(f"文档已存在 (hash: {doc_hash}), 跳过处理")
                return
                
            # 如果是更新，先删除旧版本
            if 'source' in metadata:
                try:
                    self.collection.delete(
                        where={"source": metadata['source']}
                    )
                    logger.info(f"删除旧版本文档: {metadata['source']}")
                except:
                    pass
            
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
    
    def query(self, question: str, k: int = 3) -> str:
        """
        查询文档并生成回答
        
        Args:
            question: 查询问题
            k: 返回的相似文档数量
            
        Returns:
            生成的回答
        """
        try:
            # 生成问题的嵌入向量
            question_embedding = self.embed_text(question)
            
            # 搜索相似块
            results = self.collection.query(
                query_embeddings=[question_embedding],
                n_results=k,
                include=['documents', 'metadatas']
            )
            
            if not results['documents'][0]:
                logger.warning("未找到相关文档")
                return "抱歉，我在文档中找不到相关的信息。"
            
            # 创建提示
            context = "\n".join(results['documents'][0])
            sources = [m.get('source', 'unknown') for m in results['metadatas'][0]]
            sources_str = "\n".join([f"- {s}" for s in set(sources)])
            
            prompt = f"""基于以下的内容，请用中文回答这个问题：

内容：
{context}

问题：{question}

请根据提供的内容来回答，如果内容中没有相关信息，请直接说明找不到相关信息。

参考来源：
{sources_str}"""
            
            logger.info(f"生成回答 (k={k}, sources={len(set(sources))})")
            # 使用Gemini生成回答
            response = self.model.generate_content(prompt)
            return response.text
            
        except Exception as e:
            logger.error(f"查询处理失败: {str(e)}")
            raise 