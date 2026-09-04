## 背景与问题（Why）

当前用户只能在同一个 session 里继续追问，或者新建一个空 session 后手动重述上下文。对于电信网络诊断、方案推演和故障处置复盘，用户经常需要从某一次已持久化、可渲染的 Agent 回复处开启另一条探索路径：保留该回复之前的历史和模型可用上下文，同时让后续提问、运行状态和持久化事实与原会话隔离。

同会话 detach、subagent 或 `add-ts-task-tools` 不能解决这个问题。detach 的目标是让一个正在执行的 run 后台继续；subagent 的目标是为工具调用创建 fresh child execution，不继承父会话 history 或 active context。用户这里需要的是一个用户可见的新会话：从某条已持久化、可渲染的 assistant message 派生，完整继承锚点之前的会话历史和可用上下文，但从派生完成后与原会话独立演进。

当前 TS 后端已有 owner/agent-scoped session、message、active context、runtime session facade 和 Web conversation read path，但缺少从历史 assistant message 创建隔离子会话的 public command、持久化原子写入、child active context 初始化和面向 Web 客户端的派生提示投影。

## 变更范围（What Changes）

- 新增 session fork command/API：用户从源 session 中一条已持久化、visible、可渲染的 assistant message 创建一个新的 child session。
- 新增 fork 持久化语义：创建 child session、复制源 session 从开头到锚点的 canonical message prefix、生成 child message ids、重映射 child-side `requestId`、初始化 child active context、保存 fork source metadata 和 idempotency anchor 必须在一个 composite write 中完成。
- 新增 safe child message projection 规则：复制消息前必须检查 content、metadata、replacement evidence、summary metadata 和 backing refs；owner+agent scoped durable artifact/attachment/blob 可继承或重映射，execution-bound refs（如 source `tool-results/*` 或 run workspace path）必须通过 gateway metadata staging promotion 为 child 可访问 durable content，child message 不得暴露 `BlobRef` 或 source path，否则 fork 原子失败；promotion staging 边界负责 blob 写入和 metadata 写入，可见性由 gateway metadata 的 `STAGED`/`COMMITTED`/`ABORTED` 状态机控制；fork-promotion cleanup job 仅后台收敛不可见的 `STAGED`/`ABORTED` 残留。
- 新增 child active context 初始化规则：child model-visible context 必须来自复制后的 child message ids，不得引用 parent message ids，不得复制 parent 当前 active context，不得重建历史 active context snapshot；已有 context compression summary 必须作为 replacement 保留，不能与 covered originals 重复进入 child active context；fork 初始化不调用模型、不新建 compression summary。
- 新增 fork notice public projection：child session 在派生后尚未提交新 user message 时，默认/latest conversation bootstrap response 返回用于渲染“由某会话派生”的窄化提示；源会话标题为派生时快照，源会话链接只提供普通 session navigation target；分页和锚点读取不返回该提示。
- 新增 Web route：`POST /api/v1/sessions/{sessionId}/messages/{messageId}/fork`，请求体只允许客户端生成的 bounded `idempotencyKey`；Web route 负责 trim、拒绝空白或超过 128 字符的 key，owner scope 和 agent scope 只能来自可信边界。
- 扩展 runtime/session/context/gateway contracts：`agent-contracts/runtime` 新增唯一 fork command/result，`agent-contracts/session` 新增 fork notice read model，`agent-contracts/context` 新增 fork active context selection port，`agent-contracts/gateway` 新增 fork source record、prefix query、composite write request/result 和必要的 fork lookup/query shape。

本变更不破坏既有 session、message、active context、submit、stream、history 的用户可见行为。它会扩展 public TypeScript contract surface：所有 `RuntimeSessionPort`、新增 gateway fork port/方法、相关 test doubles 和 `agent-app` composition 必须同步实现新增 contract。

## Capability 影响（Capabilities）

### 新增 Capability

- `session-fork-from-message`：用户从已持久化、可渲染的 assistant message 派生新会话，继承锚点前历史和 active context 效果，派生后与原会话隔离，并提供首屏 fork notice。

### 修改的 Capability

- `ts-core-contracts`：扩展 runtime/session/context/gateway public contracts，新增 runtime fork command、fork source metadata、safe child message projection、fork promotion staging lifecycle、prefix query、fork notice projection、fork active context selection port、fork composite persistence write 和 child active context 初始化所需契约。
- `ts-minimal-agent-kernel`：Web route registry 增加 `POST /api/v1/sessions/{sessionId}/messages/{messageId}/fork`，并保持 owner/agent scope、安全 DTO 和现有 session route 约束。

## 影响范围（Impact）

- `agent-contracts/session`：新增 fork notice read model，扩展 conversation/session message page 的安全投影；不扩展 `UserSession`，也不暴露 fork command。
- `agent-contracts/runtime`：runtime session facade 暴露唯一 fork command/result，runtime 负责可信 Agent Scope 解析和 session fork orchestration。
- `agent-contracts/context`：新增窄化 `ForkActiveContextSelectionPort` 及 request/result DTO，供 runtime 通过 app composition 注入消费。
- `agent-contracts/gateway`：新增 fork source persistence record、fork promotion staging request/metadata record/status、fork composite write request/result、`ListSessionMessagePrefixThroughAnchorQuery` 和必要的 fork lookup/query/cleanup shape。
- `agent-runtime`：新增 fork command orchestration，校验源 session 和 anchor message，协调 child session/message/active-context/fork metadata composite write。
- `agent-session`：承载 session domain read model 和 fork notice projection 的领域映射；不返回 gateway `*Record` 或 Web DTO alias。
- `agent-context-engine`：实现 `ForkActiveContextSelectionPort`，定义 child active context 从 copied prefix 形成的模型可见上下文规则，避免 runtime 或 gateway-local 复制上下文选择语义。
- `agent-channel-web`：新增 route、TypeBox schema、安全 DTO projection 和 conversation response 的 `forkNotice` 投影。
- `agent-platform-gateway-local`：实现 SQLite composite transaction、`session_forks` 专用事实表、fork promotion metadata 表、promotion staging/abort/cleanup 持久化，以及 child messages 和 active context 初始化写入。
- `agent-app`：composition root 注入新增 ports/dependencies，包括 fork active context selector，并注册 fork-promotion scheduled cleanup job 到既有 scheduled maintenance。
- `frontend/agent-web`：实现最小 fork 入口和 fork notice 展示，复用后端 Web API/DTO，不实现分支管理或完整 lineage UI。
- 测试：新增 contract、gateway transaction、runtime command、Web route、active context、owner/agent scope、idempotency、message projection、resource preflight 和 negative tests。

## 非目标（Non-Goals）

- 不实现同会话 detach，不复用 `add-ts-task-tools`，不把派生结果作为后台 task 展示。
- 不使用 subagent execution 实现本能力；subagent child session 继续保持 fresh context 语义。
- 不继承或复制 raw prompt、raw provider error、stream delta、pending input continuation、未完成 tool state、checkpoint、timeline 或运行中 lifecycle state。
- 不复制 parent 当前 active context，不保存或回放任意历史 active context snapshot。
- 不实现父子会话实时同步、fork tree UI、分支管理页面、公开每条消息 lineage、源会话重命名后的动态标题同步或 fork notice 长期显示。
- 不实现 fork tree、分支管理页面、公开完整 lineage、父子会话实时同步或源标题动态同步；本变更只包含 `frontend/agent-web` 的最小派生按钮、失败提示、成功跳转和 fork notice 展示。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/session-fork-from-message/spec.md`：新增 session fork 行为契约、Web 可见行为、隔离语义、active context 继承效果、幂等和失败路径。
- `openspec/specs/ts-core-contracts/spec.md`：提升 runtime fork command、fork source metadata、safe child message projection、prefix query、fork notice projection、fork active context selection port、fork composite gateway write 和 child active context 初始化契约。
- `openspec/specs/ts-minimal-agent-kernel/spec.md`：提升新增 fork route 的 route registry 约束。

长期背景：
- `openspec/overview.md`：补充“从已持久化回复派生隔离会话”的用户可见能力背景；不记录实现过程。

设计视图：
- `openspec/designs/architecture/core-contracts.md`：补充 session fork 相关 DO/DTO/Record/port ownership、fork source 字段、idempotency anchor 和 composite write 契约。
- `openspec/designs/architecture/runtime-boundaries.md`：补充 fork command 不创建 RequestRun、不进入 request lifecycle、不复用 subagent/detach 的边界。
- `openspec/designs/architecture/context-assembly.md`：补充 fork active context selection port、child active context 初始化规则和“不复制 parent 当前 active context”的理由。
- `openspec/designs/modules/agent-runtime.md`：补充 fork orchestration owner 和 scope 校验落点。
- `openspec/designs/modules/agent-session.md`：补充 fork notice read model 和 session domain projection。
- `openspec/designs/modules/agent-channel-web.md`：补充 fork route 和 conversation `forkNotice` projection。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充 fork composite transaction、专用事实表和索引。
- `openspec/designs/adr/session-fork-copies-prefix-not-runtime-state.md`：记录“复制 canonical prefix + 初始化 child active context，而非复制 runtime state 或历史 active context snapshot”的长期决策。
- `openspec/designs/spec-to-design-map.md`：新增 `session-fork-from-message` 导航。

验证入口：
- contract tests for session/runtime/gateway fork contracts
- runtime command tests for fork happy path、idempotency、scope rejection、anchor rejection
- gateway-local transaction tests for child session/messages/active context/fork metadata atomicity
- context tests for child active context refs using child message ids only, including summary replacement without covered-original duplication
- runtime tests for safe child message projection, execution-bound ref staging promotion/failure, `BlobRef` non-disclosure, runtime-owned resource preflight failure and child active context v0 not invoking model/compression
- gateway/app tests for fork-promotion cleanup job only retrying expired `STAGED`/`ABORTED` residue and never mutating `COMMITTED` promotion
- Web route tests for bounded `idempotencyKey` schema、safe projection、default/latest fork notice visibility and paged/anchored notice omission
- architecture tests for no private imports and owner/module boundary preservation
- `openspec validate --all --strict`
