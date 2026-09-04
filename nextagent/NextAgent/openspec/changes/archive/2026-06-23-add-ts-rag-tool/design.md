## 背景和现状（Context）

`rag` 是模型可调用的 builtin Tool，属于 `agent-capability` 的 Tool 能力。它的职责是在 request lifecycle 的 capability invocation 阶段接收模型自然语言查询，调用当前运行包已装配的 provider-neutral RAG retrieval gateway 检索当前 Agent 可用知识源，并返回安全、可追溯、有界的 knowledge chunks。

知识治理、workspace 文档扫描、chunk 切分、临时检索数据写入和 cleanup 由 `add-ts-rag-knowledge-governance` 定义。本 change 不实现这些治理行为，避免 Tool executor 同时承担检索入口和索引生命周期 owner。

固定调用链为：

```text
model tool_call: rag
  -> agent-core/capability invocation path
  -> agent-capability rag executor
  -> agent-contracts/gateway RagRetrievalGateway
  -> composed retrieval provider
  -> safe Tool result
  -> model consumes returned chunks/results
```

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 新增 builtin `rag` Tool descriptor、input schema、output schema 和 executor。
- 新增最小 `RagRetrievalGateway` public contract，隐藏 provider-private implementation。
- Tool executor 只依赖 gateway contract 和 invocation context，不依赖任何 provider 具体实现。
- Tool input 只允许 `query`、logical `indexes` 和 bounded `topK`；不得携带 scope、provider、deployment、provider-private connection/config、provider-private credential、host path 或底层查询表达式。
- gateway unavailable、index not ready、scope mismatch、timeout、cancelled、result invalid 或 execution failed 时返回 explicit safe status 和 diagnostics。

**非目标：**
- 不定义知识治理、索引构建、workspace 扫描、chunk 切分、FTS 表 lifecycle 或 cleanup。
- 不定义任何 provider-private wire DTO、索引绑定、召回参数、排序协议、connection/config 或 credential。
- 不实现 embedding、向量库、rerank、BM25 归一化、score breakdown 或混合检索。
- 不新增 Web API、runtime command、用户刷新入口或模型可控 provider 选择。

## 设计决策（Decisions）

### 决策 1：`rag` 是查询型 builtin Tool

`agent-capability` 拥有 `rag` Tool descriptor、input/output schema、executor 和 Tool contract tests。触发机制是模型在已接受 request 中发起 Tool call；执行阶段是 capability invocation。Tool 不拥有 request lifecycle、context assembly、model invocation、knowledge governance 或 persistence lifecycle。

### 决策 2：Tool 只依赖 `RagRetrievalGateway`

`agent-contracts/gateway` 新增最小 port：

```text
RagRetrievalGateway.retrieve(request, signal)
```

request 包含：
- trusted owner scope
- trusted agent scope
- trusted workspace scope 或 provider-neutral knowledge-source context ref
- query
- logical indexes，类型为 list<string>，表示当前 Agent 可用知识源中的逻辑索引选择；省略时默认为 `["local"]`
- bounded options，例如 topK；省略时默认为 5，允许范围为 1-10

request 不包含：
- tenant/subject/agent override
- deployment mode override
- provider kind override
- local SQLite path、host path、workspace root override
- raw FTS5 expression
- provider-private connection/config、provider-private credential、token、provider-private index binding 或 provider-private retrieval parameters

result 包含：

```text
status: OK | NO_INDEX | UNAVAILABLE | DEGRADED
results[]
diagnostics?
```

result 只表达 provider-neutral `results`、status 和安全低基数 `diagnostics`，不暴露 provider-private implementation。每个 result 是字典对象，字段为 `content`、`source`、`provenance?`、`score?` 和 `rankHint?`：`content` 是可供模型消费的知识片段文本；`source` 是安全来源标识；`provenance` 是安全、可披露的来源辅助信息，例如 provider-neutral label 或行号；`score` 是可选相关性分数；`rankHint` 是可选排序提示。`diagnostics` 只允许低基数字段，例如 `reason`，不得包含 raw query、content、host path、provider-private request/response、endpoint、credential 或 raw error。

### 决策 3：provider 选择来自 product composition / package shape

`agent-app` 在 trusted composition 中注入当前运行包可用的 `RagRetrievalGateway`。Tool input、用户请求体、模型输出和客户端 metadata 不得改变 provider 选择。

当前设计不要求多个 retrieval provider 在同一运行包中共存。若当前 package/composition 装配本地 RAG provider，该 provider 由 `agent-platform-gateway-local` 在 `add-ts-rag-knowledge-governance` 中实现，并消费其启动治理产生的临时检索数据。若某个包未装配 RAG retrieval gateway，`rag` Tool 应不可用或返回 explicit unavailable/degraded safe result，不注册静默 no-op 成功路径。

部署形态不改变 Tool 语义。local mode 通过同一个 `RagRetrievalGateway` public port 接到本地 SQLite FTS/FTS5 fallback provider；remote mode 通过同一个 `RagRetrievalGateway` public port 接到真实 RAG 服务。Tool executor 不根据部署形态改变 input/output shape，也不把 local fallback 能力当作产品语义上限。

### 决策 4：executor 做 scope 派生和 result mapping

executor 从 `CapabilityInvocationRequest` / invocation context 派生 trusted owner scope、agent scope 和 workspace scope，调用 gateway，并把 gateway result 映射为 bounded Tool output。executor 不读取 workspace host path，不构造 FTS5 expression，不访问 provider-private client。

### 决策 5：安全可观测只记录低基数字段

Tool invocation observability 只记录 capability id、invocation id、status、result count、duration bucket 和 reason code。raw query、content、provider raw error、host path、provider-private connection/config、provider-private credential 和底层查询语法不得进入日志、metric、trace 或 audit。

RAG 专属的安全观测字段由 `rag` Tool 定义通过 Tool metadata 中的 `observability.safeCompletionDiagnostics` 声明，例如 safe status、result count bucket 和低基数 reason code。builtin Tool executor 负责在 Tool 执行完成后调用该声明并写入通用 `CapabilityInvocationResult.metadata.toolDiagnostics`；`agent-core` 的 Tool loop 只把该通用字段转发到 `CAPABILITY_COMPLETED` timeline event；`agent-observability` 的 timeline mapper 只消费通用 `toolDiagnostics`，不得按 RAG 做 `ragStatus`、`ragResultCountBucket` 等定制映射。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | Tool input 不能选择 authority；trusted scopes 只来自 invocation/app context；result 不泄漏 provider-private details。 | schema negative tests、scope/provider override tests |
| 性能/容量 | topK 默认为 5 且限制为 1-10，Tool 不追加文件全文或邻接 chunk；gateway result mapping 维持 bounded output。 | contract/executor result bound tests |
| 可靠性/恢复 | gateway unavailable、no index/index not ready、scope mismatch、timeout、cancelled、invalid result 和 execution failure 显式 degraded/unavailable/failed，不伪装空成功。 | failure/degraded tests |
| 可维护性 | `agent-capability` 只依赖 gateway contract；provider 实现由 composition 注入。 | architecture assertions |
| 可测试性 | Tool schema、executor、gateway fake 和 result mapping 可独立测试。 | unit + contract tests |
| 审计/可追溯性 | 只记录低基数字段；result source 使用 safe source identifier。 | observability redaction tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| builtin `rag` Tool descriptor/schema/executor | 2.1, 2.2 | Tool contract/executor tests |
| Tool input 不能携带 authority | 2.1, 4.1 | schema negative tests |
| executor 只依赖 gateway contract | 2.2, 3.1 | architecture assertions |
| gateway contract 不泄漏 provider-private fields | 1.1 | contract source assertions |
| indexes 是 provider-neutral list<string>，默认 `["local"]` | 1.1, 2.1 | contract/schema tests |
| deployment shape 不改变 Tool 语义 | 3.1 | composition tests |
| provider selection 来自 composition | 3.1 | composition tests |
| unavailable/degraded 不伪装成功 | 4.2 | failure tests |
| safe observability | 4.3 | Tool observability metadata tests、timeline mapper redaction tests |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/rag-tool/spec.md`
- 架构和跨模块设计：`openspec/designs/architecture/rag-tool.md`
- 模块设计：`openspec/designs/modules/agent-capability.md`、`openspec/designs/modules/agent-app.md`
- ADR：无
- 导航：`openspec/designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] Tool 与治理 change 边界不清 -> 本 design 明确 Tool 不扫描、不建索引、不清理治理数据；local provider 实现由治理 change 的 local gateway owner 承担。
- [风险] provider contract 过度贴近某个实现 -> public gateway request/result 只表达 provider-neutral fields，provider-private wire contract 和索引协议不进入本 change。
- [风险] 未装配 provider 时用户看到空结果 -> 必须返回 explicit unavailable/degraded。

## 迁移计划（Migration Plan）

无数据迁移。本 change 新增 Tool 和 gateway contract；provider 实现由对应 package/composition change 接入。回滚时移除 builtin `rag` descriptor/executor 和 gateway contract usage。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/rag-tool/spec.md`：Tool input/output、gateway invocation、failure/degradation 和 observability 行为。
- `openspec/overview.md`：`rag` Tool 作为 capability 查询入口的长期背景。
- `openspec/designs/architecture/rag-tool.md`：Tool -> gateway -> provider 调用链、scope 派生和失败边界。
- `openspec/designs/modules/agent-capability.md`：builtin `rag` Tool descriptor/executor 职责。
- `openspec/designs/modules/agent-app.md`：`RagRetrievalGateway` dependency 注入。
- `openspec/designs/spec-to-design-map.md`：新增导航。

## 待确认问题（Open Questions）

无。
