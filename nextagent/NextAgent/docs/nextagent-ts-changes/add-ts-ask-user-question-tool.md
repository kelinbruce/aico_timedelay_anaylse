# add-ts-ask-user-question-tool

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)

所属分组：Tool

状态：active
类型：实施 change
主要 owner：`agent-capability`
依赖：`add-ts-capability-core-governance`、`add-ts-human-pending-input-core`、`add-ts-question-pending-input`

目标：

- 新增 canonical id 为 `AskUser` 的 built-in Tool descriptor、input/output schema 和 safe result，`displayName` 同样为 `AskUser`。
- 定义工具到 runtime-owned `QUESTION` pending input boundary 的提交规则。
- 支持文本、单选、多选和自定义选项题的 safe pending request shape。
- 保持 AskUser producer 非阻塞；用户 answer、cancel 和 resume 都由 runtime pending input flow 处理，timeout 由 pending input timeout change 负责。
- 通过 `AgentExecutionOutcome.PENDING_INPUT` 暂停当前 run；answer 后再 materialize 原 `AskUser` tool call 的 safe `CAPABILITY_RESULT`。

规格输入：

- tool/capability id 固定为 `AskUser`，`displayName` 为 `AskUser`；`ask_user_question`、`AskUserQuestion`、`askUser`、`ask_user` 等旧名或别名都不是 canonical id。
- tool description 必须固定为 design 中定义的 model-facing description，描述 runtime-owned question pending input，不使用 `PendingInputKind.QUESTION` 枚举名面向模型。
- tool input 使用 `questions[]`，允许 1-3 个问题；每个 question 只使用 `prompt`、`options?`、`multiple?`、`custom?`。
- option 只使用 `value`、`label`。
- 字符串预算固定为 `prompt` 1-500 字符、option `value` 1-500 字符、option `label` 1-500 字符；空值或超预算 visible text 必须以 `INVALID_INPUT` 拒绝。
- context rendering 暴露给模型的 tool input schema 在 provider-facing schema 支持 JSON Schema-compatible 字符串约束时，必须用 `minLength`/`maxLength` 携带这些具体字符串预算；provider 无法表达时也不得放宽 Agent/core 对 resolved descriptor schema 的最终校验。
- `options` 缺省表示文本题；`options` 出现表示选项题且必须有 2-8 项；同一 question 内 option `value` 必须唯一；`multiple` 和 `custom` 只能用于选项题，文本题携带这两个字段必须 `INVALID_INPUT`。
- model-facing tool schema 和字段说明必须说明题型由 shape 决定：无 `options` 是文本题；有 `options` 且 `multiple` 缺省或 false 是单选；有 `options` 且 `multiple=true` 是多选；有 `options` 且 `custom=true` 是允许自定义答案的选项题。不得新增 `questionType`、`kind` 或其他平行 discriminator。
- credential、raw secret、authorization grant、protected-operation approval、high-risk confirmation、human handoff/escalation prompt purpose 必须 deterministic reject 为 `INVALID_INPUT`，不创建 pending input；sanitize/redact 只用于 log/audit，不得清洗后继续创建 pending。
- surveys 和 long-form form input 只作为 model-facing scope guidance 和 schema-bounded 非目标，不在本 change 引入 policy/classifier；只有同时违反 schema/budget 或触发 hard forbidden purpose 时才拒绝。
- 4 个及以上问题必须以 `INVALID_INPUT` 拒绝，不截断、不创建 partial pending input；模型可在恢复后再次调用下一批 1-3 个问题。
- Agent/core immediate outcome 必须是 `{ status: "PENDING_INPUT", pendingInput: PendingInputRequest }`；`pendingInput` 是 runtime contract 允许的 safe request（`id`、`sessionId`、`kind`、`questions`、`timeoutAt?`）。channel/UI 可再投影为 `{ pendingInputId, status: "pending" }` 这类更窄显示引用，但它不是 Agent/core outcome，也不是 answer 前的模型可见 `CAPABILITY_RESULT`。
- `agent-capability` 暴露 bundled Tool descriptor；context rendering 将 tool `name=AskUser` 披露给模型；模型返回同名 tool call 后，Agent/core 通过既有 capability resolver/catalog path 精确解析该 `toolName`。
- context rendering 和 provider adapter 必须保留 exact tool name `AskUser`，不得把它规范化为 `ask_user_question`、`AskUserQuestion`、`askUser`、`ask_user` 或 provider-local alias；若 provider 无法表达该 exact name，必须 fail safely，而不是静默改名。
- Agent/core 只有在 resolved descriptor 满足 `kind="TOOL"`、`capabilityId="AskUser"`、`provider.providerId="builtin-tools"`、`provider.providerKind="BUNDLED"`、`availabilityStatus="AVAILABLE"` 时，才进入 AskUser producer 分支。
- 这个 producer branch 只是本 change 为 canonical `AskUser` bundled built-in Tool descriptor 定义的窄特例：它发生在正常 descriptor resolution 之后、普通 `CapabilityInvocationPort.invoke(...)` 之前；不建立 generic pending producer registry，不依赖 display name、description、schema shape、string similarity、natural-language inference 或 `CapabilityDescriptor.metadata` 决定 routing、authorization、replay safety 或 pending lifecycle，也不 import `agent-capability` implementation path。
- `question`、`AskUserQuestion`、`ask_user_question`、`askUser`、`askUserQuestion`、`ask_user`、`ask_user_questions`、同 schema 的普通 tool、非 bundled `AskUser` descriptor 都不得进入 producer branch 或创建 pending input。
- 若同一 model tool batch 中存在多个 `AskUser` 调用，Agent/core 必须沿既有 tool batch 顺序处理；成功创建 pending 后立即返回 `AgentExecutionOutcome.PENDING_INPUT`，只暂停当前 `AskUser` tool call，后续 `AskUser` 只能在恢复继续执行到它时再进入自己的 pending。
- owner scope、accepted `RequestRun`、trusted `RequestContext`、session id、request id 和 run id 来自 Agent/core runtime invocation path，不来自 tool input。
- tool 不接收用户答案，不持有 answer schema，不注入 identity/idempotency。
- channel 只按 pending input projection 路径展示 safe pending request；不拥有 AskUser 私有发送/等待状态。

非目标：

- 不创建新的 pending input 状态机。
- 不定义 Web UI 表单或浏览器 UI。
- 不实现长期记忆、任务调度或 Agent handoff。
- 不定义 channel 实现细节。
- 不用于 credential、raw secret、authorization grant 或高风险 confirmation。
- 不新增 `CapabilityInvocationRuntimeContext.requestPendingInput(...)`、generic pending producer registry、generic `PolicyPort`、public create-pending command、RunStatus、LifecycleStage、CheckpointTriggerReason 或 pending record producer/tool-call 字段。
- 不定义 tool-level timeout behavior 或 timer。
- 不新增 agent-core 到 agent-capability implementation package 的直接依赖；Agent/core 只能通过既有 capability contract surface 读取 descriptor/schema。

验收要点：

- schema tests 覆盖文本、单选、多选、自定义选项题、空值/超预算 visible text、4 个及以上问题和非法组合。
- failure mapping tests 覆盖 descriptor unavailable、schema/safety invalid、pending handoff unavailable、abort 和 unexpected producer failure 到 safe reason code 的固定映射。
- integration test 覆盖 `AskUser` producer 在 descriptor resolution 之后、ordinary capability invocation 之前调用 `AgentRunStatePort.requestPendingInput`、返回 `AgentExecutionOutcome.PENDING_INPUT`、不产生 immediate capability result、不 terminal commit。
- resume test 覆盖 answer 后只生成一次原 `AskUser` tool call 的 safe `CAPABILITY_RESULT`，且不重复调用 AskUser；multi-call test 覆盖同一 batch 中多个 `AskUser` 按原始顺序逐个 pending/materialize。
- architecture test 覆盖 tool 不拥有 wait/resume state，不直接依赖 channel/gateway private implementation。
- routing negative tests 覆盖相似名称、同 schema 普通 tool、非 bundled descriptor 不进入 producer branch。
- security test 覆盖 credential、raw secret、authorization grant、protected-operation approval、high-risk confirmation、human handoff/escalation prompt purpose 被 deterministic safety guard 拒绝，不引入 policy/risk/survey/form classifier。
- unavailable test 覆盖 descriptor 缺失、disabled 或 unavailable 时不创建 pending input。
