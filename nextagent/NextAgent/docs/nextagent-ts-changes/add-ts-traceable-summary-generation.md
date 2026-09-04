# add-ts-traceable-summary-generation

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Context Assembly

状态：active
类型：实施 change
主要 owner：`agent-context-engine`
依赖：`add-ts-context-compression`、`add-ts-model-invocation-contract`、`add-ts-redaction-policy`

目标：
- 为 `add-ts-context-compression` 提供具体语义压缩内部 port：给定 covered history，生成可继续、安全、可预算的 summary draft。
- 保留来源引用、生成时间、用途、owner scope、历史检索关联、generation mode、prompt template version 和 token estimates，供 context compression 写入 summary message metadata。

能力组共享输入：

整理状态：已整理为能力组产输入

能力组目标：
- 补足上下文选择、预算、提示词组装、压缩和大内容处理策略。

共享规格输入：
- 本 change 不决定什么时候压缩、压哪段或保留哪段 tail、不写 active context、不写 checkpoint/timeline。
- 本 change 实现 `TraceableSummaryGenerationPort`，输入来自 `add-ts-context-compression` 的 `TraceableSummaryGenerationRequest`（已冻结于该 change 的 spec）：owner scope、session/run 坐标、covered messages、covered refs、retained tail refs、locale、purpose、source active context version 和 target token budget。
- 输出是 `TraceableSummaryDraft`，至少包含 summary content、sourceReferences、historyLookupLinkage、generationMode、promptTemplateVersion、inputUnitEstimate 和 outputUnitEstimate。
- summary draft 不包含 `messageId`、`activeContextVersion`、`idempotencyKey` 或 persistence status；这些由 `add-ts-context-compression` 在 commit 时补齐。
- 摘要模型调用必须通过 `ModelInvocationService.complete()`，禁用所有工具，并接收 `AbortSignal`。
- 本 slice 提示词模板是 `agent-context-engine` 内部固定字符串 `compact-summary/v1`，由 `agent-context-engine` 在 prompt 资源中声明；模板加载失败必须 fail-fast 抛错，不使用隐式运行期默认模板（待后续 change 引入 registry 后再讨论 fallback 策略）。
- 推荐输出格式为 `<analysis>` + `<summary>`；只保留 `<summary>`，必须丢弃 `<analysis>`。
- 缺 `<summary>` 但有非空文本输出时，可作为 parse fallback summary，并记录 safe fallback reason。
- 空输出、tool call attempt、schema 非法或压缩无效时返回 safe failure，不进入多级 escalation，也不产出 degraded draft。
- auth/authorization/policy denied 错误同样不产出 degraded draft，直接返回 safe failure；caller 侧按既有预算退化路径处理。
- 图片、二进制文档、超大附件正文、大工具结果和 artifact 内容不得原样进入摘要模型；必须转为安全引用、excerpt 或 placeholder。
- 净化不修改既有 `SessionMessage.content`。
- owner scope 只能来自调用方可信上下文，不得被模型输出覆盖。
- structured logs、metrics、safe error 和 audit 不得包含 raw prompt、raw messages、raw summary、tool args/results、附件内容、路径、credential 或 secret。

并行边界：
- `add-ts-context-compression` 负责整体压缩编排、active context commit、checkpoint 对账和恢复锚点；checkpoint/timeline 写入仍归 runtime-owned boundary。
- `add-ts-traceable-summary-generation` 只负责语义摘要 draft 生成，不拥有 session persistence 或 active context state。
- `agent-model` 负责 provider SDK 隔离、model invocation contract 和 safe provider error mapping。
- `agent-observability` / redaction 相关 change 负责全局日志、metric、audit、safe error 净化规则。

后续维护：
- 本文件承担该 change 的详细规格输入、契约输入、实现边界、非目标、验收要点和并行边界。
- 如果本 change 需要修改已总结核心契约，必须先提出 contract refinement change。
- 模板 registry、prompt-too-long retry、多级 escalation、rehydration hints、session memory 和 long-term memory 不在本 change 范围内，由后续 change 重新提出。
