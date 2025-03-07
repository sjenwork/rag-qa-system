import os
from rag_system import RAGSystem

def load_documents(docs_dir):
    documents = []
    for filename in os.listdir(docs_dir):
        if filename.endswith('.md') or filename.endswith('.txt'):
            with open(os.path.join(docs_dir, filename), 'r', encoding='utf-8') as f:
                content = f.read()
                documents.append((filename, content))
    return documents

def main():
    # 初始化 RAG 系統
    rag = RAGSystem()
    
    # 載入文檔
    docs_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'docs')
    documents = load_documents(docs_dir)
    
    # 將文檔加入到向量存儲中
    for filename, content in documents:
        print(f"Adding document: {filename}")
        rag.add_document(content, {"source": filename})
    
    # 測試查詢
    questions = [
        "請問公司有什麼計劃？",
        "有哪些獎懲制度？",
        "學校的使命是什麼？",
        "學生應遵守哪些規範？"
    ]
    for question in questions:
        print(f"\nTesting query: {question}")
        response = rag.query(question)
        print(f"\nResponse: {response}")

if __name__ == "__main__":
    main()