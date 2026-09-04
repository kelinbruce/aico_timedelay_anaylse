# agent-memory

## 职责

承载 long-term memory 的 local backend 业务编排：模型可调用 `memory-tools` provider contribution factory、task trajectory builder/worker、memory extraction/dreaming、memory aging coordinator、owner-authorized L2 detail revival helper、memory lifecycle safe diagnostics 和长期记忆相关 prompt consumer 边界。

## 非职责

不拥有 request lifecycle、Web API、context window selection、terminal commit、gateway-local 持久化实现、SQLite/FTS5、remote complete-service memory lifecycle、Capability catalog、capability invocation port、model provider SDK 或 app composition。它拥有 `memory-tools` provider 的 Tool definitions 和 contribution construction semantics，但不拥有 capability catalog governance 或 invocation execution loop。

`agent-memory` 不作为 core memory store/retriever 的必经 wrapper，不重导出 `LongTermMemoryStoreGateway` / `LongTermMemoryRetrieverGateway`，不替代 `agent-contracts/gateway` 的 public port contract。后台 extraction/aging 不调用 model-facing memory tools，也不通过 capability invocation 伪装成后台写入。

## 依赖

允许依赖 `@nextagent/agent-common`、`@nextagent/agent-contracts/gateway` public subpath 和 `@nextagent/agent-contracts/capability` contribution/discovery/executor public SPI。memory tools submodule 允许以受限方式使用 `@nextagent/agent-capability` public Tool SPI 类型来构造 Tool definitions，并通过 public factory 返回 `memory-tools` provider contribution；不得导入 catalog、invocation port、builtin tool 实现或 capability private paths。

不得导入 Web channel、runtime implementation、context-engine private paths、model provider SDK、app composition、gateway-local private paths、SQLite/Kysely/FTS5 实现、observability SDK 类型或其它 implementation package。

## 核心设计落点

- `search_memory` 与 `get_memory_detail` 作为 `IDEMPOTENT` Capability 可在统一瞬态门禁内同参 retry；`add_memory` 保持 `NON_IDEMPOTENT` 且不自动重放。三者直接生产统一 outer `safeError`，不建立 memory-specific 失败 envelope 或结果 pre-limit。
- 单项 detail not-found 与 global failure 分离；owner-confirmed result-unknown 不存在时不得合成该出口。大结果复用公共 `256000` UTF-16 code unit 容量和外置回读边界。

- 落实 `architecture/memory.md` 的长期记忆生命周期边界：长期记忆、自学习、task trajectory、extraction 和 aging 都在 request terminal commit 关键路径之外运行。
- 提供 `createMemoryToolsProviderContribution()` memory tool provider contribution factory。工具只通过 owner-owned `memory-tools` provider contribution 进入 capability subsystem；`agent-app` 只在 `MemoryConfig` 有效、Agent binding opt-in 且 backend 可用时调用该 public factory 并传递 returned contribution，不在 app 侧手写 Tool 清单、provider id 或 executor support。`MemoryConfig` disabled/invalid、Agent 未 opt-in 或 adapter 缺失时不得模型可见。
- `search_memory`、`get_memory_detail` 和 `add_memory` 只接收业务参数；trusted owner scope 和 agent scope 由 app/capability invocation 注入。`search_memory` 不做类别 fan-out 规划；不确定类别时依赖一次 broad search，且非 `USER_CHARACTERISTICS` 的 `purpose` 输入只作为兼容噪声被忽略。`add_memory` 只处理用户显式要求立即记住的 fast path，不做相似检测、冲突消歧或 confidence corroboration；它可以在 tool provider 边界接受有限 convenience input，但必须在写 core gateway 前规范化为严格 category-specific memory content，并丢弃 alias/extra 模型字段。`get_memory_detail` 的成功 `entry` 向模型提供完整 category-specific 结构化业务内容，但 output schema 和实际结果不包含 `sourceTrace` 或原始 `source`，也不以其他顶层 provenance 字段返回 session、request、run、message 或 extraction cycle 坐标；当 retained source 可解析时，系统把由 `longTermMemoryId` 关联的来源写入模型隐藏的 `CapabilityInvocationResult.metadata.sourceTrace`，供本地 canonical `toolOutput` 一步定位。该 metadata 与 `structuredPayload` 一并计入公共单结果容量，不进入模型输入、durable `CAPABILITY_RESULT`、Web/stream/timeline、SafeError、audit、metric、trace 或 `ObservabilityObservationEvent`。retained source、来源融合、Gateway storage 和授权 management 查询保持不变。
- 提供 task trajectory builder/worker：terminal commit 后异步读取 committed public gateway facts，生成安全摘要和 refs；catch-up 通过 `TaskTrajectoryQueryGateway.listBuildCandidates` 补建缺失 intent。builder 可以为 LLM-assisted extraction 生成带 `llm-note:` 前缀的 bounded/redacted `REQUEST_FACT`，用于表达规则未覆盖但具备电信业务信号的安全用户事实投影；它不是 rule-ready memory candidate，且不得复制完整原始消息。
- 提供 memory extraction/dreaming：默认 disabled，启用后通过 `TaskTrajectoryQueryGateway` 读取安全 trajectory 投影，先运行 RULE_FIRST 规则策略，必要时通过 shared `MEMORY_EXTRACTION` prompt assembly 的 LLM 策略提取候选。规则候选必须先过滤 message/timeline 计数、terminal status、capability/tool status 和 diagnostic-code-only 这类运行元数据；`llm-note:` 只能进入 LLM 语义提取，不能被规则直接写入，也不能被同一周期其它 rule-ready candidates 饿死；只有 accepted useful rule candidates 才能阻止普通 LLM fallback。LLM prompt projection 必须过滤 Rag/Glob/Grep 等 runtime/tool status-only 噪声，只保留 business-safe summaries、source refs 和必要证据摘要；模型可读 prompt 必须要求人类可读字段跟随来源摘要主语言，并保持电信编码/协议/KPI/告警 ID 原样。LLM 自评分 confidence 只是候选 hint，写入前必须由 extraction 规范化为保守上限，后续提升只能走 evidence fusion/corroboration。候选通过 category-specific quality/safety gate 后，通过 core memory gateway 写入或融合。
- 提供 memory aging：默认 disabled，启用后按 `decay -> delete` 顺序扫描 scoped retained memory，使用 core store 的 state/confidence/delete mutation；L2 detail access revival helper 只在 app composition 接到 owner-authorized detail path 且 aging enabled 时使用。
- 当前最小内核不启用长期记忆产品能力；context engine 只能通过后续 public memory boundary 消费可披露记忆。
- long-term memory core 已冻结最小 persistence/retrieval contract：retained record 使用 owner scope + agent scope 隔离，支持 cross-session save/search/list/detail/count/state transition，并以 `ACTIVE` / `ARCHIVED` 为 retained lifecycle 基础状态；物理 delete 不是 archive。
- 长期记忆 management service 暴露 `LongTermMemoryManagementPort` 的 13 个 operation（save/list/batch create/manual save/get/delete/mutate/search/detail/publish/unpublish/list published/copy published）。每个 management command/query 携带由完整 `IdentityContext` 和独立 `agentId` 组成的可信 `LongTermMemoryManagementScope`，application service 只把 `tenantId`/`subjectId`/`agentId` 映射到 Gateway scope，`displayName` 不进入 Gateway 请求或诊断；所有 method 接收可选 `AbortSignal`，调用 Gateway 前检查取消。批量新增按输入顺序逐条复用既有知识安全准入和 50 条 `CONFIGURED` 容量校验，把每条 `idempotencyKey` 映射到 Gateway write options，单项失败只计入 `failCount` 并继续后续条目，请求级 scope/取消/存储不可用使整批安全失败；返回 `successCount`/`failCount`/按输入顺序排列的 `memoryIds`，且 `successCount + failCount` 等于输入条目数。
- `LongTermMemoryRecord` 是 gateway-owned retained fact；`LongTermMemoryListItem`、`LongTermMemorySearchEntry` 和 `LongTermMemorySearchResult` 是 query projection，不得反向变成 session/runtime/channel public DTO。
- aging、maintenance、extraction 和 sharing 仍是独立上层业务边界。它们可以消费 core contract 中的 `isPinned`、`archivedAt`、`archiveReason`、`lastAccessedAt`、`accessCount`、`recallCount` 等 durable facts，但不得把 lifecycle state machine 下推给 gateway-local。
- Memory extraction prompt customization 必须复用 context-engine prompt template assembly 与统一 `ModelSelectionService`，使用 `PromptPurpose=MEMORY_EXTRACTION` 和实际调用的 canonical `modelId` 投影；scheduler/cycle owner 冻结 `cycleId` 并将同值用作后台调用 `operationId`，不伪造 run coordinates。不得新增 memory-private prompt file format、loader chain、prompt id allowlist 或 request-path parser。
- Remote complete-service backend 下，本地 task trajectory worker、extraction scheduler、aging scheduler 和 revival helper必须禁用；远端服务拥有 memory lifecycle，本地最多做 contract adaptation、trusted scope injection、SafeError mapping 和 safe diagnostics。

## 替换边界

否。`agent-memory` 是长期记忆业务编排 owner；local/remote memory backend 替换发生在 gateway adapter 和 app composition 边界。

## 验证关注点

- memory lifecycle 不得阻塞 request terminal commit，不得改变已提交 RequestRun、SessionMessage、canonical timeline、active context 或 stream projection。
- context engine 不得自动检索、注入或提升长期记忆。
- memory tools 不得接收 owner/agent scope 字段；后台 extraction/aging 不得调用 memory tools 或 capability executor。
- extraction/aging/task trajectory 只能消费 public gateway ports，不得导入 gateway-local private path、SQLite、FTS5 或 storage rows。
- remote complete-service memory backend 下本地 lifecycle scheduler/helper 不启动。
- logs/metrics/audit/diagnostics 不得包含 memory content、prompt、model output、tool payload、attachment content、raw trait value、path、credential、token 或 raw storage/provider error。

## Capability 失败处置协作

`search_memory` 与 `get_memory_detail` 是 `IDEMPOTENT`，只有统一瞬态门禁成立时才可同参 retry；`add_memory` 是 `NON_IDEMPOTENT`，不得自动重放。三者直接使用公共 `SafeError`、output schema 和公共容量，不创建 memory-specific envelope、pre-limit 或 retry owner；逐 Tool 语义见 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md`。

## Public Exports

`@nextagent/agent-memory`
