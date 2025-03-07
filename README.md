# 改进版RAG系统

这是一个基于Python的改进版检索增强生成（RAG）系统，使用Gemini和Sentence Transformers实现高质量的文档检索和问答功能。

## 主要特点

- 使用Sentence Transformers进行高质量文本嵌入
- 完整的错误处理和日志记录
- 类型提示支持
- 可配置的文档分块策略
- 文档去重和版本控制
- 支持元数据管理

## 系统要求

- Python 3.8+
- ChromaDB服务器
- Gemini API密钥

## 安装

1. 安装依赖：
```bash
pip install -r requirements.txt
```

2. 配置系统：
- 复制`config.yaml`并填写必要的配置信息
- 确保ChromaDB服务器正在运行
- 设置有效的Gemini API密钥

## 使用方法

```python
from src.improved_rag_system import ImprovedRAGSystem

# 初始化系统
rag = ImprovedRAGSystem()

# 添加文档
rag.add_document(
    text="你的文档内容",
    metadata={"source": "文档来源", "author": "作者"}
)

# 查询
response = rag.query("你的问题")
print(response)
```

## 配置说明

配置文件（config.yaml）包含以下主要设置：

- Gemini API配置
- ChromaDB连接设置
- 嵌入模型选择
- 文档处理参数

## 日志

系统日志存储在`logs/rag_system.log`中，包含详细的操作记录和错误信息。

## 改进内容

相比原始版本：

1. 使用专业的Sentence Transformers替代简单的词频向量
2. 添加完整的错误处理和日志记录
3. 支持类型提示
4. 改进的文档处理流程
5. 更灵活的配置选项
6. 更好的代码组织和文档化 