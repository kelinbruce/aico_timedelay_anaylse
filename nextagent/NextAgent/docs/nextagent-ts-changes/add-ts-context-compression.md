# add-ts-context-compression

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Context Assembly

状态：active
类型：实施 change
主要 owner：`agent-context-engine`、`agent-platform-gateway-local`（session gateway 指 `agent-platform-gateway-local` 中负责 active context 持久化的 commit 路径，不含 `agent-session` 写入范围）
依赖：`add-ts-context-budget-explainability`
协作依赖：`add-ts-traceable-summary-generation` 提供具体 summary draft 生成实现；本 change 只定义并消费 `TraceableSummaryGenerationPort` / DTO，不拥有 prompt 模板、模型调用或输出解析。

目标：
- 通过模型摘要压缩较早历史，支撑无限轮次会话并避免静默丢失关键事实。
- 串通整体压缩逻辑：上下文压力评估、prefix compact + recent tail、语义摘要内部 port 调用、active context 原子提交、runtime checkpoint 对账和显式降级。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 补实上下文选择、预算、提示词组装、压缩和大内容处理策略。

共享规格输入：
- TS 首个发布版本目标是支持无限轮次会话。
- 只选择当前 owner 和当前 session 的历史。
- 当前用户输入优先级最高。
- 已启用 Markdown 附件安全摘要/内容引用优先于更早历史。
- 有效上下文预算 = 模型上下文窗口 - 预留摘要输出 token（参考值 ~20k）
- 近期历史以完整 turn 进入上下文，较早历史通过模型摘要进入上下文。
- 超预算时优先压缩较早历史并记录 explainability。
- 如果当前输入本身超预算，不静默截断，返回 safe error 或显式降级结果。
- 输出长度受限或可能截断时必须记录并提示用户，不提供自动继续生成能力。
- 会话上下文压缩摘要由模型生成，必须保留来源引用、生成时间、用途、owner scope 和历史检索关联，并归 session 持久化边界管理。
- 本 change 负责定义 `TraceableSummaryGenerationPort` / DTO、在 summary compression path 中调用已装配的 port 并消费 summary draft；具体 prompt 模板、模型调用、输出解析、semantic escalation 和 source reference draft 由 `add-ts-traceable-summary-generation` 负责。未装配 generator 时，本 change 只走显式 budget degradation / safe failure，不把真实生成实现纳入当前范围。
- 上下文压缩相关的 active context 读取、summary message 写入、compaction commit、checkpoint write 和 timeline append 都必须使用 owner-scoped request，显式携带 `tenantId`、`subjectId`；不得从请求体、客户端 metadata、模型输出或 capability 参数覆盖当前身份。
- active context view 是模型可见 message 引用表；`active_context_items` 一行保存一个 messageId，便于与 `session_messages` 联合查询；`messages` 保存完整原始消息和压缩生成的 summary message，保持 append-only；模型调用只读取 active context items，不直接读取全量 messages。
- `ActiveContextItem.ordinal` 由 `ActiveContextStoreGateway` 在 append 或 compaction commit 时生成/维护，不得来自客户端、channel、模型输出或 capability 参数；只要求同一 view 内唯一且按升序还原模型上下文，不规定编号策略。
- 压缩采用 prefix compact + recent tail：被压缩前缀生成一个 summary `SessionMessage`，新的 active context 用 summary message id 替换前缀并保留 recent tail 原顺序；无 tail 时退化为单个 summary。
- `recent tail` 的起点必须满足模型 API 归一化不变量：不得拆开 `tool_use`/`tool_result` 配对，不得截断同一 provider message identity 下需要合并恢复的 assistant 分片；必要时必须向前扩展保留边界，优先保证上下文合法性而不是更短 tail。
- 提交压缩必须在同一事务或等价原子边界内写入 summary message、把压缩追溯信息写入 summary message metadata、替换 active context items 并递增 `activeContextVersion`；`activeContextVersion` 用于 checkpoint 恢复和多实例冲突检测。
- `activeContextVersion` 是 active context view 的 optimistic lock version；append 和 compaction commit 必须携带 `expectedActiveContextVersion`，版本不匹配时返回 version conflict，不得覆盖当前 active context。
- `commitCompaction` 必须对齐核心契约 `ContextCompactionCommitRequest` 语义，至少包含 `tenantId`、`subjectId`、`sessionId`、`expectedActiveContextVersion`、`summaryMessage`、`coveredMessageRefs`、`retainedTailMessageRefs` 和 `idempotencyKey`；不得为压缩路径另起一套并发控制或提交语义。
- summary message metadata 是 `SessionMessage.metadata: JsonObject` 的 typed extension；所有字段必须是 JSON-compatible value，写入和读取时必须通过 schema/type guard 校验。
- `ContentRef.refType=MODEL_SUMMARY` 指向 summary `SessionMessage.messageId`，不指向独立 summary store。
- 长期记忆摘要不属于首版本地 release；后续如纳入长期记忆，则归 memory changes 和 `agent-memory` 边界管理。
- 摘要失败、取消或重试耗尽时不得破坏当前请求终态一致性，必须返回 safe error、显式降级或保留未压缩边界；不得留下已写入 summary message 但未替换 active context items、或已替换 active context items 但未递增版本的半提交状态。
- 大内容引用范围包括附件、大的工具调用结果和模型摘要。
- 首批不把 artifact 下载内容、PDF/Excel/Word 解析后的大内容或外部知识库大文档作为必要范围。
- 压缩请求交给语义摘要生成 port 前必须带上 covered refs、retained tail refs、owner scope、locale、purpose 和 token budget；语义摘要生成 port 负责把图片、二进制文档、超大附件正文和不需要进入摘要模型的再水合附件净化为安全引用、摘要片段或占位说明，避免压缩请求本身超预算。
- 压缩完成后，当前任务态、关键文件、能力披露、附件上下文等运行期工作态必须由 Context Engine/Prompt shaping 基于权威 store 重新组装，不得要求 summary message 独自承载全部工作上下文。
- Prompt shaping 首批只定义 profile 边界和组装顺序，不在 OpenSpec 中固化具体提示词全文。
- Prompt shaping 必须保留 system/developer instruction slot、locale metadata、telecom domain instruction slot、capability disclosure slot、selected history slot、attachment context slot、current user input slot。
- 具体提示词模板内容放配置、实现默认值或 Agent package 的 `prompts/` 目录，后续可替换。
- `ContextAssemblyRequest` 只表达位置和意图：`sessionId`、`requestId`、`requestContextId`、`agentId`、`agentVersion`、`runId`、`stepId`、`locale`、`purpose`；其中 `requestId` 表示当前 root user request identity，不新增 `rootMessageId`。
- `ContextAssemblyRequest` 不携带 `historyRefs`、`attachmentRefs`、`capabilityDisclosureRefs`、`currentMessage`、`agentAssembly` 或 `budget`；context selection、budget 和 prompt shaping 由 Context Engine/Query Policy 决定。

当前 change 实施范围（收敛到最小 summary compression 闭环）：
- 每次 `assemble()` 基于 Query Policy 的 prior-history pressure evidence 判断是否需要 summary compression；本 change 不引入后台维护触发器、常态化压缩调度或分层压缩流水线。
- 预算预留、covered prefix、retained tail 和 current request protection 只服务本次 `PREFIX_COMPACT_RECENT_TAIL` commit；不引入中间段删除、读时投影、多段折叠或独立 summary store。
- 本 change 不引入摘要辅助输入、后台会话状态笔记、自动压缩熔断、逐步扩大前缀重试或旁路缓存清理；这些能力如需落地，必须作为后续 change 重新定义目标、owner、契约和验收。
- 取消语义：summary generation、commit 前检查和 runtime 后置对账必须接入同一个 `AbortSignal` 或等价取消上下文；请求已取消时不得继续进行新的摘要模型调用或新的压缩 commit。
- 压缩后对账：压缩 commit 成功后必须由 runtime 或 runtime 协调路径触发 `CONTEXT_COMPACTED` checkpoint 并写入 timeline event；Context Engine 和 gateway 不拥有 checkpoint、canonical timeline 或 runtime lifecycle state。
- 压缩后 checkpoint 必须满足核心恢复锚点要求，payload 至少包含 `checkpointId`、`sessionId`、`requestId`、`runId`、`requestContextId`、`runVersion`、`triggerReason=CONTEXT_COMPACTED`、`lastSequence`、`activeContextVersion`、`flowVariables`、`savedAt` 和 checkpoint write 的 `idempotencyKey`；恢复时必须使用 `runVersion`、`lastSequence`、`activeContextVersion` 对账，而不是依据旧消息范围推断压缩边界。

非目标（受核心契约硬约束，本 change 不引入）：
- 不引入中间段删除（Snip）：`ActiveContextStoreGateway` 没有 `removeItem`，`commitCompaction` 只支持前缀+尾部语义，无法表达"挖掉中间段"。
- 不引入读时投影/可逆折叠（Context Collapse）：核心契约要求 `active_context_items` 是物化表，`SummaryMessageMetadata.strategy` 锁定为 `"PREFIX_COMPACT_RECENT_TAIL"`，不支持投影或折叠策略。
- 不引入多段折叠：每次 `commitCompaction` 只产生一个 summary message，表达一次前缀压缩，不支持同时存在多个独立折叠段。
- 不修改已有 `SessionMessage.content`：工具结果清理只能通过 compaction commit 将其纳入 `coveredMessageRefs`，不能替换为占位符。

并行边界：
- 上下文策略归 `agent-context-engine` 所有，不得分散到 session、core、capability 或 channel。
- session gateway 负责 `active_context_items` 和 `session_messages` 的持久化，`agent-context-engine` 负责压缩决策和 summary message commit 请求；runtime 负责 timeline/checkpoint lifecycle 对账；`add-ts-traceable-summary-generation` 负责具体语义压缩生成 summary draft。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
