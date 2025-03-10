import os
from improved_rag_system import ImprovedRAGSystem

def load_documents(docs_dir):
    documents = []
    for filename in os.listdir(docs_dir):
        if filename.endswith('.md') or filename.endswith('.txt'):
            with open(os.path.join(docs_dir, filename), 'r', encoding='utf-8') as f:
                content = f.read()
                documents.append((filename, content))
    return documents

def test_rag():
    # 初始化系統
    rag = ImprovedRAGSystem()
    
    # 讀取docs目錄下的所有文本
    docs_dir = "docs"
    documents = load_documents(docs_dir)
    
    # 添加所有文本到系統
    for filename, content in documents:
        rag.add_document(content, {"source": filename, "type": "document"})
        print(f"已添加文本: {filename}")
    
    # 測試查詢
    questions = [
        "專案完成之後要做什麼事"
    ]
    
    print("\n=== 開始測試查詢 ===\n")
    
    for q in questions:
        print(f"\n問題：{q}")
        print("-" * 50)
        answer = rag.query(q)
        print(f"回答：{answer}")
        print("-" * 50)

if __name__ == "__main__":
    test_rag()