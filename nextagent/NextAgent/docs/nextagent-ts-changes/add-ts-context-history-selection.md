# add-ts-context-history-selection

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Context Assembly

状态：active
类型：实施 change
主要 owner：`agent-context-engine`
依赖：`ship-ts-minimal-agent-kernel`

目标：
- 支持无限轮次会话的上下文选择：当前 owner/session、当前输入和已启用 Markdown 附件上下文优先，近期完整 turn 与较早历史摘要共同参与上下文。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 补实上下文选择、预算、提示词组装、压缩和大内容处理策略。

共享规格输入：
- TS 首个发布版本目标是支持无限轮次会话。
- 只选择当前 owner 和当前 session 的历史。
- 当前用户输入优先级最高。
- 已启用 Markdown 附件安全摘要/内容引用优先于更早历史。
- 历史上下文最多使用模型窗口 60% 预算。
- 近期历史以完整 turn 进入上下文，较早历史通过模型摘要进入上下文。
- 超预算时优先压缩较早历史并记录 explainability。
- 如果当前输入本身超预算，不静默截断，返回 safe error 或显式降级结果。
- 输出长度受限或可能截断时必须记录并提示用户，不提供自动继续生成能力。
- 会话上下文压缩摘要由模型生成，必须保留来源引用、生成时间、用途、owner scope 和历史检索关联，并归 session 持久化边界管理。
- active context view 是模型可见 message 引用表；`active_context_items` 一行保存一个 messageId，便于与 `session_messages` 联合查询；`messages` 保存完整原始消息和压缩生成的 summary message，保持 append-only；模型调用只读取 active context items，不直接读取全量 messages。
- `ActiveContextItem.ordinal` 由 `ActiveContextStoreGateway` 在 append 或 compaction commit 时生成/维护，不得来自客户端、channel、模型输出或 capability 参数；只要求同一 view 内唯一且按升序还原模型上下文，不规定编号策略。
- 压缩采用 prefix compact + recent tail：被压缩前缀生成一个 summary `SessionMessage`，新的 active context 用 summary message id 替换前缀并保留 recent tail 原顺序；无 tail 时退化为单个 summary。
- 提交压缩必须在同一事务或等价原子边界内写入 summary message、把压缩追溯信息写入 summary message metadata、替换 active context items 并递增 `activeContextVersion`；`activeContextVersion` 用于 checkpoint 恢复和多实例冲突检测。
- `activeContextVersion` 是 active context view 的 optimistic lock version；append 和 compaction commit 必须携带 `expectedActiveContextVersion`，版本不匹配时返回 version conflict，不得覆盖当前 active context。
- summary message metadata 是 `SessionMessage.metadata: JsonObject` 的 typed extension；所有字段必须是 JSON-compatible value，写入和读取时必须通过 schema/type guard 校验。
- `ContentRef.refType=MODEL_SUMMARY` 指向 summary `SessionMessage.messageId`，不指向独立 summary store。
- 长期记忆摘要不属于首版本地 release；后续如纳入长期记忆，则归 memory changes 和 `agent-memory` 边界管理。
- 摘要失败时不得破坏当前请求终态一致性，必须返回 safe error、显式降级或保留未压缩边界。
- 大内容引用范围包括附件、大的工具调用结果和模型摘要。
- 首批不把 artifact 下载内容、PDF/Excel/Word 解析后的大内容或外部知识库大文档作为必要范围。
- Prompt shaping 首批只定义 profile 边界和组装顺序，不在 OpenSpec 中固化具体提示词全文。
- Prompt shaping 必须保留 system/developer instruction slot、locale metadata、telecom domain instruction slot、capability disclosure slot、selected history slot、attachment context slot、current user input slot。
- 具体提示词模板内容放配置、实现默认值或 Agent package 的 `prompts/` 目录，后续可替换。
- `ContextAssemblyRequest` 只表达位置和意图：`sessionId`、`requestId`、`requestContextId`、`agentId`、`agentVersion`、`runId`、`stepId`、`locale`、`purpose`。
- `ContextAssemblyRequest` 不携带 `historyRefs`、`attachmentRefs`、`capabilityDisclosureRefs`、`currentMessage`、`agentAssembly` 或 `budget`；context selection、budget 和 prompt shaping 由 Context Engine/Query Policy 决定。

并行边界：
- 上下文策略归 `agent-context-engine` 所有，不得分散到 session、core、capability 或 channel。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
