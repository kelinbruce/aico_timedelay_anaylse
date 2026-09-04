# add-ts-local-run-timeline-store

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：本地状态 Gateway

状态：active
类型：实施 change
主要 owner：`agent-platform-gateway-local`
依赖：`establish-ts-core-contracts`

目标：
- 通过 `RequestRunStoreGateway` 持久化 RequestRun、terminal result 和 timeline；RequestRun 版本更新和 claim/fencing 必须支持 CAS result，terminal commit 使用专用幂等结果。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 补实本地状态持久化，并保持上层只依赖 gateway contract。

共享规格输入：
- 首版必须纳入恢复和终态提交所需的 optimistic concurrency 最小语义，但不纳入完整 PaaS 多实例运行能力。
- RequestRun 持久化端口命名为 `RequestRunStoreGateway`，lookup request 命名为 `RequestRunLookupRequest`。
- `RequestRun` 必须具备 optimistic `version`、claim/fencing 或等价执行领取语义。
- 普通持久化写入返回持久化后的对象；RequestRun 版本更新、claim/fencing 和 pending input resolve 等 CAS 操作返回专用 CAS result。
- 执行领取、恢复 takeover 和 terminal commit takeover 必须通过 compare-and-set 或等价条件写入实现冲突检测；terminal commit 使用专用 terminal commit result 表达 committed、already committed、version conflict 和 not found。
- 多个执行者同时恢复同一 run 时，只允许一个成功，其他执行者必须在 version conflict 后重新读取状态、放弃或进入安全诊断路径。
- Terminal commit 必须幂等，不能因并发恢复产生重复 assistant message、capability-result message、timeline event 或重复终态。
- Artifact 首批只保存 metadata/ref，不提供下载内容入口。
- Artifact metadata 至少包含 `artifactId`、`tenantId`、`subjectId`、`sessionId`、`requestRunId`、`sourceType`、`contentRef`、`mimeType`、`sizeBytes`、`createdAt`、`safeName`、`visibility`。
- `sourceType` 首批使用 `ATTACHMENT`、`CAPABILITY_RESULT`、`OTHER`；模型摘要作为 summary `SessionMessage` 管理，不作为 artifact source type。
- Artifact owner scope 不使用抽象 `ownerScope` 字段，明确拆成 `tenantId` 和 `subjectId`。
- 本地重启后 active run 的恢复策略采用稳定运行语义，不采用“一律 failed/canceled”的简单处理。
- Runtime 拥有恢复决策，Gateway 只提供持久化事实。
- `QUEUED` run 重建调度 work item，并通过 version/lock/claim 语义避免重复启动。
- `EXECUTING` run 优先按 checkpoint stage、persisted message、timeline 和 run version 恢复。
- 模型调用可作为可重复计算处理：若模型结果未形成持久化 assistant message 可重放，若已持久化则继续使用该事实。
- terminal commit 处于 pending/retrying 时必须幂等重试。
- 如果 terminal message/event 已持久化但 RequestRun 未进入终态，恢复应 reconcile run 终态而不重复写 message/event。
- 已完成终态的 run 直接跳过。
- 缺少 checkpoint 或 terminal facts、无法证明安全恢复的 executing run，应进入显式 recovery failed/safe error 和运维可见诊断，不得长期停留在 running/executing，也不应被归类为用户 cancel。

并行边界：
- 不得让 runtime、session、channel 或 context 直接依赖具体数据库、文件布局或查询库。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
