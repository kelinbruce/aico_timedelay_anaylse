# add-ts-rag-tool

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Tool

状态：active
类型：实施 change
主要 owner：`agent-capability`
依赖：`add-ts-builtin-tool-framework`

## 目标

- 新增 RAG (Retrieval-Augmented Generation) tool descriptor/schema definition。
- 新增 RAG tool executor handler。
- 提供统一的**语义检索**黑盒能力，在不同部署场景下为 LLM 检索 workspace 内的相关文档片段并提供上下文增强。

## 与已有 Tool 的边界

| Tool | 边界 | 黑盒效果 |
|------|------|----------|
| **Grep tool** | 精确文本/正则匹配：搜索包含特定字符串的文件 | 用户感知：找到包含"错误代码 E404"的行 |
| **RAG tool** | 语义检索：按部署场景选择 local FTS5 或 remote RAG provider，返回与查询意图相关的文档片段 | 用户感知：找到与"如何处理连接超时问题"相关的段落 |
| **Glob tool** | 文件名模式匹配 | 用户感知：找到所有 `.md` 文件 |
| **Read tool** | 读取已知文件的完整内容 | 用户感知：查看 README.md 内容 |

**关键区分**：
- Grep tool 是**精确匹配**：必须包含指定的关键词或模式
- RAG tool 是**语义检索黑盒**：调用方只看到“相关知识片段检索”能力，不关心底层实现是 local FTS5 还是 remote RAG 基础设施
- local 场景使用受控 workspace 文档上的 FTS5 召回作为 KISS 最小实现
- remote 场景对接 RAG 基础设施，可使用 embedding / vector search / rerank 等 provider-owned 能力
- RAG tool 返回的是文档片段（chunk）而非整行

## 非目标

- 不定义通用向量数据库或自研检索引擎；remote 场景依赖外部 RAG 基础设施，local 场景依赖本地轻量 FTS5 索引。
- 不定义实时索引更新；local 索引在启动时构建，remote 更新策略由其基础设施 owner 决定。
- 不定义 workspace 外文档的检索。
- 不定义文档的语义理解或问答（RAG 只负责检索，问答由 LLM 完成）。

## 黑盒效果

用户通过 RAG tool 可以：
1. 提供自然语言查询（如"如何配置 SSL 证书"）
2. 可选指定检索范围（目录、文档类型）
3. 获得按相关性排序的文档片段列表：`[{content, file, relevance_score}]`

系统保证：
- 检索范围限制在 workspace 内
- 返回 top-K 最相关的文档片段（K 可配置，默认 5）
- 每个片段包含来源文件和位置信息
- 按部署场景选择受信 provider：local 使用 FTS5 最小实现，remote 使用已装配的 RAG 基础设施
