# add-ts-rag-knowledge-governance

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Tool / Gateway

状态：active
类型：实施 change
主要 owner：`agent-platform-gateway-local`
依赖：`add-ts-rag-tool` 中定义的 `RagRetrievalGateway` public contract

## 目标

- 新增 RAG 知识治理能力，为本地部署下的 `rag` Tool 提供可检索的临时知识数据。
- 在 NextAgent 本地启动阶段一次性治理 compiled active Agent `workspaceFiles` read scope 内的安全文本文件。
- 将治理后的 bounded chunk 写入本地临时检索存储，并在构建完成后供 RAG retrieval gateway 查询。
- 在 `agent-platform-gateway-local` 中实现 local `RagRetrievalGateway` provider，读取本 change 生成的本地临时检索数据并返回 provider-neutral chunk result。
- 在 NextAgent 关闭时清理本地 RAG 临时数据；异常残留必须在下一次启动前清理。

## 黑盒效果

系统启动后，用户不需要手动触发治理，也不需要在 Tool input 中选择索引或文档目录。系统会：

1. 根据可信 Agent assembly 和 workspace policy 确定可治理文档范围。
2. 只治理 workspace read scope 内的 Markdown/MDX、JSON、TXT 和安全文本代码文件。
3. 按固定上限切分文档，保留 workspace-relative source、file type、startLine、endLine 和 content。
4. 将 chunk 写入本地临时检索数据。
5. 运行中的 `rag` Tool 通过 local `RagRetrievalGateway` provider 查询启动时治理完成的数据。
6. 关闭时清理本地临时检索数据。

用户可感知结果：
- 本地部署启动完成且治理成功时，`rag` Tool 可以检索启动时治理过的 workspace 知识片段。
- 治理失败、部分跳过、索引不可用或超过容量边界时，`rag` Tool 返回明确 degraded/unavailable 状态，而不是静默空结果。
- 运行中文件新增、修改或删除不会立即影响本次进程中的 RAG 检索结果。

## 与 `add-ts-rag-tool` 的边界

| Change | 边界 | 黑盒效果 |
|--------|------|----------|
| `add-ts-rag-tool` | 定义 builtin `rag` Tool、Tool 输入/输出、executor 和 retrieval gateway 调用边界 | 模型调用 `rag` 后获得安全知识片段或明确失败/降级 |
| `add-ts-rag-knowledge-governance` | 定义本地启动治理、chunk 生成、临时检索数据写入、local retrieval provider 和关闭清理 | 本地启动后形成可被 retrieval gateway 消费的临时知识数据，并由 local provider 返回安全检索结果 |

## 非目标

- 不定义 `rag` Tool descriptor/schema/executor。
- 不定义远端 RAG 服务接口、远端索引绑定、ES/向量召回参数或远端排序协议。
- 不定义 remote `RagRetrievalGateway` provider。
- 不实现 embedding、向量库、LLM reranker、BM25 归一化、自研重排或混合检索。
- 不实现定时任务、watcher、增量更新、manifest diff、snapshot/current 指针或长期索引生命周期。
- 不新增 Web API、runtime command、用户刷新按钮或模型可控的治理参数。

## 验收要点

- 本地启动时只扫描 trusted workspace read scope 内的 allowlist 安全文本文件。
- 文档切分有固定上限，chunk 必须保留 workspace-relative source 和 line coordinate。
- local `RagRetrievalGateway` provider 只读取本地治理生成的临时检索数据，并把 FTS5/private row 映射为 provider-neutral result。
- 本地临时检索数据不泄漏 host path、SQLite path、底层查询语法、raw content 诊断或 credential。
- 运行中文件变化不触发治理，不影响已构建数据。
- 关闭时清理本地临时检索数据；异常残留在下一次启动前清理。
- 治理失败、FTS 不可用、读取失败、decode 失败或容量超限必须产生明确 degraded/unavailable reason，不得静默吞错。
