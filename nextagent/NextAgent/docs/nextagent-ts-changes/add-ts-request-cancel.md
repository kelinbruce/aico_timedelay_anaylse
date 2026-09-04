# add-ts-request-cancel

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：请求控制

状态：active
类型：实施 change
主要 owner：`agent-runtime`、`agent-channel-web`
依赖：`ship-ts-minimal-agent-kernel`

目标：
- 支持取消当前可操作请求，并产生一致 canceled 终态。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 补实当前会话内请求控制能力，同时保持 runtime command ownership 不变。

共享规格输入：
- 当前会话内可操作请求的判定、非法操作结果和安全可见性，是请求控制能力组的共享语义，不单独作为实施 change。
- 取消、重试和编辑重提各自必须说明适用请求状态、目标选择规则和非法操作结果。
- `RequestControlCommand` 和 `EditLatestRequestCommand` 必须携带由可信 channel/auth boundary 注入的 `identityContext`。
- runtime 必须使用 `identityContext.tenantId` 和 `identityContext.subjectId` 校验 session、latest request、message 和 run 的 owner scope。
- 请求控制 command 字段名保持稳定语义：`sessionId`、`expectedLatestRequestId`、`action`、`editedInputText`、`attachmentIds`、`idempotencyKey`。
- 不新增 `OwnerScope` DTO，不用泛化 `owner`、`targetId`、`input` 或 `metadata` 替代已冻结字段。
- 客户端 payload、客户端 metadata、模型输出或 capability input 不得覆盖 command identity。

并行边界：
- 这些 change 只能扩展 runtime command 和合法性规则，不得改写最小内核的 request lifecycle owner。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
