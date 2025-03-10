import os
import yaml
import hashlib
import chromadb
import google.generativeai as genai
from langchain.text_splitter import RecursiveCharacterTextSplitter

class RAGSystem:
    def __init__(self, config_path="config.yaml"):
        # Load configuration
        with open(config_path, 'r') as f:
            config = yaml.safe_load(f)
        
        # Initialize Gemini
        genai.configure(api_key=config['gemini']['api_key'])
        self.model = genai.GenerativeModel('gemini-1.5-pro')
        
        # Initialize ChromaDB
        self.client = chromadb.HttpClient(host="localhost", port=8000)
        
        # Get or create collection
        try:
            self.collection = self.client.get_collection("documents")
        except:
            # Collection doesn't exist, create it
            self.collection = self.client.create_collection(
                name="documents",
                metadata={"description": "Document collection for RAG"}
            )
        
        # Initialize text splitter
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,  # 減小塊大小
            chunk_overlap=100  # 增加重疊部分
        )
    
    def get_document_hash(self, text, metadata):
        """計算文本的哈希值"""
        content = f"{text}{str(metadata)}"
        return hashlib.md5(content.encode()).hexdigest()
    
    def embed_text(self, text):
        """使用自定義的嵌入方法"""
        # 使用較簡單的詞頻向量作為臨時解決方案
        words = text.lower().split()
        vector = []
        for i in range(512):  # 創建一個512維的向量
            if i < len(words):
                vector.append(hash(words[i]) % 100 / 100.0)
            else:
                vector.append(0.0)
        return vector
    
    def add_document(self, text, metadata=None):
        """Add a document to the vector store"""
        if metadata is None:
            metadata = {}
            
        # 計算文本哈希
        doc_hash = self.get_document_hash(text, metadata)
        metadata['doc_hash'] = doc_hash
        
        # 檢查文本是否已存在且未更改
        existing_docs = self.collection.get(
            where={"doc_hash": doc_hash}
        )
        
        if existing_docs and existing_docs['metadatas']:
            print(f"Document with hash {doc_hash} already exists and hasn't changed. Skipping...")
            return
            
        # 如果是更新，先刪除舊版本
        try:
            self.collection.delete(
                where={"source": metadata.get('source', '')}
            )
        except:
            pass  # 如果沒有找到舊版本，繼續處理
        
        # 處理新文本
        chunks = self.text_splitter.split_text(text)
        if not chunks:
            return
            
        # Generate embeddings
        embeddings = [self.embed_text(chunk) for chunk in chunks]
        
        # Add to ChromaDB
        self.collection.add(
            embeddings=embeddings,
            documents=chunks,
            metadatas=[{**metadata, "chunk_id": f"chunk_{i}"} for i in range(len(chunks))],
            ids=[f"doc_{doc_hash}_chunk_{i}" for i in range(len(chunks))]
        )
        print(f"Added/Updated document with hash {doc_hash}")
    
    def query(self, question, k=3):
        """Query the vector store and generate response"""
        # Generate embedding for the question
        question_embedding = self.embed_text(question)
        
        # Search similar chunks
        results = self.collection.query(
            query_embeddings=[question_embedding],
            n_results=k,
            include=['documents', 'metadatas']
        )
        
        if not results['documents'][0]:
            return "抱歉，我在文本中找不到相關的資訊。"
        
        # Create prompt with context
        context = "\n".join(results['documents'][0])
        sources = [m.get('source', 'unknown') for m in results['metadatas'][0]]
        sources_str = "\n".join([f"- {s}" for s in set(sources)])
        
        prompt = f"""基於以下的內容，請用中文回答這個問題：

內容：
{context}

問題：{question}

請根據提供的內容來回答，如果內容中沒有相關資訊，請直接說明找不到相關資訊。

參考來源：
{sources_str}"""
        
        print(prompt)
        # Generate response using Gemini
        response = self.model.generate_content(prompt)
        return response.text