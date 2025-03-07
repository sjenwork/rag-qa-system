import chromadb
import yaml

def load_config():
    with open("config.yaml", "r") as f:
        return yaml.safe_load(f)

def main():
    config = load_config()
    client = chromadb.HttpClient(
        host=config.get('chroma_host', 'localhost'),
        port=config.get('chroma_port', 8000)
    )
    
    collection = client.get_collection(config.get('collection_name', 'documents'))
    results = collection.get()
    
    print("\n=== 文檔信息 ===")
    if results and results['metadatas']:
        for i, metadata in enumerate(results['metadatas']):
            print(f"\n文檔 {i+1}:")
            print(f"哈希值: {metadata.get('doc_hash', '未知')}")
            print(f"來源: {metadata.get('source', '未知')}")
            print(f"塊ID: {metadata.get('chunk_id', '未知')}")
    else:
        print("沒有找到任何文檔")

if __name__ == "__main__":
    main() 