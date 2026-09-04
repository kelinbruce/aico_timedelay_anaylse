# RAG Tool

本设计承载 `rag` Tool 的长期跨模块事实。行为性要求由 `openspec/specs/rag-tool/spec.md` 承载；本文件只记录 owner、调用链和安全边界。

## 核心边界

`rag` 是 builtin Tool framework 下的一个查询型 Tool，不是新的 request lifecycle、知识治理、索引构建或 provider discovery 平面。模型只能在 accepted request 内通过统一 capability invocation path 调用它；session lane、pending input、terminal commit、stream projection 和 audit 真相仍由既有 runtime/capability/observability 边界拥有。

`rag` executor 只依赖 public `RagRetrievalGateway` contract 和 runtime 提供的 capability invocation context。它不得 import SQLite/FTS5 实现、local corpus governance 私有实现、provider-private wire DTO、host workspace path、provider credential 或 provider route config。gateway provider 的选择权只来自 trusted app composition；Tool input、用户请求体、模型输出和 capability 参数都不得改写 provider 选择。

显式 Tool input `indexes` 始终优先于默认配置。只有当 input 省略 `indexes` 时，executor 才消费 app composition 冻结并注入的默认 logical indexes；若 composition 未配置默认值，才回退到 `["local"]`。executor 不得把显式索引与默认索引合并，也不得在默认索引失败时私自切换 provider 或改查其他索引。

## 调用链

1. `agent-core` 在 model tool loop 中把 `rag` 解析为当前 Agent 可见的 governed builtin Tool descriptor。
2. `agent-capability` 负责 input/output schema 校验、safe failure mapping 和 `CapabilityInvocationResult` 包装。
3. `rag` executor 调用 app-composed `RagRetrievalGateway`。
4. retrieval provider 在 trusted owner scope、knowledge scope 和当前 Agent 可用知识源边界内执行语义检索，返回 bounded safe results。本地 fallback provider 共享当前 owner/workspace 的 startup-built local index，不把 `agentId` / `agentVersion` 作为该共享索引的隔离键。
5. capability result 通过统一 tool result path 回到模型；runtime/observability 再派生安全生命周期和诊断事实。

## 结果与失败语义

`rag` 成功结果是 bounded `results[]`，每项只包含 provider-neutral 的 `content`、`source`、可选 `provenance`、可选 `score` 和可选 `rankHint`。结果不得暴露 host path、SQLite 表名、FTS5 表达式、provider-private connection/config、credential、raw provider response、raw diagnostics 或高基数文件列表。

输出 schema 允许顶层额外字段和任意字段的 `diagnostics` 对象；不对结果项或诊断对象施加封闭字段集、长度、格式、数值范围或必填字段约束。调用方不得依赖 `content`、`source`、`provenance`、`score`、`rankHint` 的 schema 长度、格式或封闭字段集校验。Tool 保留既有提供方结果校验、状态映射、字段投影和按 `topK` 截取的结果数量边界。

provider unavailable、index not ready、scope mismatch、timeout、cancellation、invalid provider result 或执行失败都必须产生显式 degraded/unavailable/failed/canceled outcome。系统不得把这些基础设施失败伪装成“空成功检索结果”。

## 模块归属

- `agent-capability`：builtin `rag` Tool descriptor、input/output validation、safe result mapping。
- `agent-app`：`RagRetrievalGateway` provider 选择和依赖注入。
- `agent-platform-gateway-local` 或后续 remote gateway：provider-private retrieval adapter 与索引/连接细节。
- `agent-core`：统一 tool loop 调度，不拥有检索 provider 选择权。

## 安全与可观测性

RAG observability 只允许稳定低基数事实，例如 capability id、status、result count、duration bucket 和 safe reason code。日志、metric、trace 和 audit 不得包含 raw query、result content、绝对路径、provider-private config、credential、prompt text、模型输出或 raw provider error。
