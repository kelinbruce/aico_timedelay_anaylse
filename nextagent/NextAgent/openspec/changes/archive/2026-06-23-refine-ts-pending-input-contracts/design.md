## 背景和现状（Context）

`ts-core-contracts` 已经冻结 pending input 的三对象 skeleton、四态 `PendingInputStatus`、`AnswerPendingInputCommand` 可信身份边界和 `PendingInputStoreGateway` 的 create/load/resolve 最小 surface。当前代码也已经有这些接口，但 `PendingInputQuestion` 只有 `prompt` 和 `options`，gateway 也只有按 id load/resolve。

六个 Human Pending Input change 和 AskUserQuestion producer 都需要同一组窄增强：选项题多选、自定义文本、active pending 查询、timeout due 查询、answer resolve 幂等锚点，以及 Agent/core 向 runtime 表达 pending pause 的显式 control outcome。它们属于共享契约，不应该由某个 type-specific 或 producer change 私自扩展。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 为 question 补充 `multiple?: boolean` 和 `custom?: boolean`。
- 为 runtime 提供 active pending 和 due timeout 的 gateway fact-query。
- 为 pending answer command 提供 gateway-owned resolve idempotency anchor。
- 为 Agent/core 提供 `AgentExecutionOutcome.PENDING_INPUT` 暂停出口，避免 pending 被误处理为 completed/failed terminal path。
- 为 Capability invocation producer 提供 `AgentRunStatePort.requestPendingInput(...)` runtime-owned internal handoff。
- 保持 pending input 归 `agent-contracts/runtime`，gateway record/port 归 `agent-contracts/gateway`。

**非目标：**

- 不定义 question、confirmation、authorization 或 handoff 的业务触发条件。
- 不新增 `RunStatus`、`PendingInputStatus`、`TimelineEventType` 或独立 `agent-contracts/pending-input` subpath。
- 不新增 timeout behavior 字段、answer schema 字段、origin 字段、audit linkage 字段或 model-formatted answer。
- 不把 idempotency key 放入 `PendingInputAnswer` 客户端 payload、`PendingInput` 领域对象或 `PendingInputRecord` 业务字段。
- 不实现 runtime pending lifecycle、Web answer route、timeout outcome 或 type-specific validation。
- 不实现 checkpoint-before-visible、`USER_INPUT_REQUIRED` 发布、same-session lane block、answer resume、cancel resolution、timeout resolution 或 pending visible 后的恢复闭环；这些属于后续 pending lifecycle / type-specific changes。
- 不新增 thrown control signal、generic `PolicyPort` 或 `CapabilityInvocationRuntimeContext.requestPendingInput(...)` facade；除 runtime-owned minimal `producerRef` resume coordinate 外，不新增 client-controlled、policy-bearing、scope-bearing 或 capability-private pending record producer/tool-call 字段。

## 设计决策（Decisions）

### D1：`multiple` 和 `custom` 放在 question，不放在 answer

选定方案：`PendingInputQuestion` 和 `PendingInputQuestionRecord` 增加 `multiple?: boolean` 与 `custom?: boolean`。`multiple` 只表示该 question 的 answer 内层数组是否允许多个值；`custom` 只表示该 question 是否允许回答一个非 options value 的文本。客户端 answer 仍然只是 `string[][]`，不能携带 `multiple=true`、`custom=true` 或自定义 schema。

理由：题型权限来自 runtime 已接受的 pending request 约束，不是用户回答时可以自报的权限。这样刷新页面或换设备时，客户端只需要读取当前 pending request，即可按 runtime 投影的题型约束提交 answer。

拒绝方案：在 `PendingInputAnswer` 增加 answer type、multiple/custom 标记或 answer schema。拒绝原因是 answer payload 会穿过不可信客户端边界，容易让客户端扩大题型权限，也违反当前核心契约对 answer schema 的冻结。

### D2：多选是 question 约束，不是独立状态机

选定方案：所有 pending input answer 继续使用 `string[][]`。规则如下：

- `options` 为空表示文本题；answer entry 必须包含一个非空字符串。
- `options` 非空且 `multiple` 缺省或为 `false` 表示单选题；answer entry 必须包含一个值。
- `options` 非空且 `multiple=true` 表示多选题；answer entry 可以包含多个唯一值。
- 对选项题，所有值必须在 options 内；当 `custom=true` 时，允许至多一个非 option 自定义文本值。
- 单选题即使 `custom=true`，answer entry 也只能包含一个总值：一个 option value 或一个非 option 自定义文本。
- 多选题在 `custom=true` 时可以包含多个唯一 option values，并且至多一个非 option 自定义文本。

理由：复用既有 `string[][]` 外壳即可表达多问题和多选，不需要新增 pending object、answer schema 或 per-type DTO。

### D3：gateway 只提供事实查询

选定方案：`loadActivePendingInput` 返回某个 owner+agent+session 下当前 `PENDING` fact；`listDuePendingInputs` 返回已经到期的 `PENDING` facts。runtime 根据这些 facts 决定 reject submit、resolve timeout、恢复或继续等待。

active pending 的事实不变量必须由 gateway adapter 强制或检测：同一 `tenantId + subjectId + agentId + sessionId` 下最多只能有一个 `PENDING` pending input。local gateway 必须使用 adapter-private partial unique index 或等价 scoped constraint；不得用 `ORDER BY` / `LIMIT 1` 任意选择一条 active pending。若检测到多条 active pending，gateway/runtime 必须把它作为 invariant violation，并通过既有 gateway/runtime safe error normalization 返回 safe conflict；不得只记录 logs/metrics，也不得静默挑选。

拒绝方案：gateway 返回 `shouldRejectSubmit`、`shouldTimeout` 或 `timeoutBehavior`。拒绝原因是 gateway 只能保存和读取 durable facts，不能拥有 request lifecycle 决策。

### D3.1：`producerRef` 是 runtime-owned resume coordinate

选定方案：`PendingInputRecord` 增加一个最小 `producerRef`：

```ts
type PendingInputProducerRef =
  | { kind: "LIFECYCLE_HOOK" }
  | { kind: "CAPABILITY_INVOCATION"; capabilityId: CapabilityId; toolCallId: ToolCallId };
```

`producerRef` 只回答 resume 时的分支问题：这是 lifecycle gate pending，还是某个原始 tool call 的 capability result materialization。它不得携带 identity、owner scope、agent scope、policy、risk level、operation scope、idempotency key、timeout behavior、client 字段或 capability-private state。Hook producer 的实际恢复点仍来自 `checkpointId` / `requestContextId` / existing lifecycle recovery state；Capability invocation producer 的原始 tool call 由 `toolCallId` 定位，并用 `capabilityId` 交叉校验。

拒绝方案：不持久化 producer 坐标，只从 checkpoint、assistant tool-use message、current tool batch reconstruction 和 single-active-pending invariant 推导。拒绝原因是该方案把恢复语义隐藏进 runtime/core 推导逻辑，降低可审计性和恢复确定性。

### D4：due timeout query 是 runtime-internal administrative query

选定方案：due query 使用 `now + limit` 扫描已到期 facts，并返回完整 owner/agent/run/session 坐标；只有 runtime timeout/recovery 代码可以消费。它不进入 channel、core、capability 或 Web public API。返回顺序必须稳定，按 `timeoutAt` 升序再按 stable pending input id 升序，或使用 adapter 等价的稳定顺序。

实现约束：local gateway due query 必须由 adapter-private indexed storage 支撑，例如私有 `timeout_at` column/index 或等价索引结构；不得把该索引暴露为 `PendingInputRecord` 字段，也不得以无界 JSON/full-table scan 实现。

理由：重启后没有 process-local timer，runtime 必须从 durable store 找回到期 pending。把查询限定在 runtime-internal port usage，可以兼顾恢复和 owner/agent scope。

### D5：answer idempotency 锚定 pending resolve 操作

选定方案：`resolvePendingInput` 接收 gateway-owned idempotency write option，包含 `idempotencyKey` 和 runtime 计算的 `idempotencySemantic`。gateway 在同一 owner+agent+session+pendingInput scope 内保存 resolve anchor：

- 第一次相同 key + semantic 将 pending fact 从 `PENDING` CAS 到目标状态。
- 相同 key + semantic 重试返回等价 resolved record，不再次推进 lifecycle。
- 相同 key + 不同 semantic 返回 idempotency conflict。
- 不同 key 在 pending 已经被别的 command resolve 后返回 version/status conflict，由 runtime 映射为 safe already-answered、timeout、canceled 或 conflict outcome。

`idempotencySemantic` 必须由 runtime 生成 canonical string，且只能由这些逻辑字段组成：`pendingInputId`、target resolve status（本 change 的 answer path 为 `RECEIVED`）和 validation 后按 question 顺序保留的 ordered `answers`。canonical string 必须使用版本化、确定性的数组 tuple 编码，例如稳定 JSON 表达的 `["pending-input-resolve-v1", pendingInputId, targetStatus, answers]`；不得重新排序 answers，也不得在 answer validation 之后再做 trim、case-folding 或其它语义归一化。它不得包含 `answeredAt`、`idempotencyKey`、random id、trace id、audit id、log field、stream event id、gateway row id、adapter-private column 或 wall-clock value。gateway 必须把 `idempotencySemantic` 当作 opaque write metadata，只能在同一 scope 内做 equality comparison，不得解析它、校验 answer 业务规则或推导 lifecycle 决策。

理由：`pendingInputId` 是跨刷新、跨设备的业务锚点；`idempotencyKey` 是单次 answer command 的网络重试锚点。换设备提交答案可以使用新的 command key，但仍受 pending status CAS 保护，不会产生双恢复。

拒绝方案：把 answer idempotency key 写进 `PendingInputAnswer` 或 `PendingInputRecord`。拒绝原因是客户端 answer payload 和核心持久化对象都已冻结为不承载 idempotency key；gateway anchor 属于写入操作元数据，不是 pending input 业务事实。

### D6：pending pause 是 Agent/core 到 runtime 的显式 outcome

选定方案：在 `agent-contracts/runtime` 定义 `AgentExecutionOutcome`，并让 `Agent.execute(...)` 返回 `Promise<AgentExecutionOutcome>`。`AgentExecutionOutcome` 只允许 `{ status: "COMPLETED" }` 和 `{ status: "PENDING_INPUT", pendingInput: PendingInputRequest }` 两种形态；`COMPLETED` 表示 Agent/core 已完成当前 run，可以走既有 terminal commit；`PENDING_INPUT` 表示 runtime-owned pending 已创建且当前 run 必须暂停等待 answer。`PENDING_INPUT` 不携带 reason、lifecycle stage、producerRef、toolCallId、resume hint 或其它 producer 坐标。

Capability invocation producer 只能调用既有 `AgentRunStatePort` 上的 `requestPendingInput(run, context, intent): Promise<PendingInputRequest>` 提交 producer-local validated `PendingInputIntent`；该方法是唯一 frozen runtime-owned handoff contract，不等待用户 answer，也不返回 answer、terminal、resume 或 lifecycle-stage decision。runtime 在 pending 可见前仍必须执行最终 acceptance validation。完整 lifecycle 的 checkpoint-before-visible、`USER_INPUT_REQUIRED` 发布、same-session lane block、answer resume、cancel resolution、timeout resolution 和 type-specific validation 不属于本 change；这些行为由后续 pending lifecycle / type-specific changes 实现。

`requestPendingInput(...)` 是 success-only handoff：只有 acceptance 成功才返回 `PendingInputRequest`。handoff 拒绝、pending lifecycle 不可用、checkpoint/pending acceptance failure、active pending conflict、abort 或 unexpected producer failure 必须沿用既有 runtime/capability safe failure path 交给调用方 producer 归类；不得返回 `PendingInputRequest`，不得创建 pending fact，不得把失败转换为 `AgentExecutionOutcome.PENDING_INPUT`，也不得新增第三种 `AgentExecutionOutcome`。普通工具调用失败仍沿用既有 `CapabilityInvocationResult.safeError` / producer-specific safe reason code 路径，本 refinement 不改变 ordinary `CapabilityInvocationPort.invoke(...)` 的失败语义。

partial pending lifecycle 被禁止：实现不得创建 visible/durable pending input，除非 owning lifecycle 同时保证 checkpoint-before-visible、same-session lane protection，以及明确的 answer/cancel/timeout recovery path。在完整 lifecycle 尚不可用时，`requestPendingInput(...)` 的实现必须 fail closed，走既有 safe failure path，不得创建半成品 pending fact。`requestPendingInput(...)` 成功返回后，Agent/core 必须立即返回 `AgentExecutionOutcome.status="PENDING_INPUT"`；不得继续执行后续 tool call、append 普通 capability result、或用后续异常把同一 run 转成 failed/completed terminal path。

runtime 收到 `PENDING_INPUT` 后必须在 terminal output aggregation 和 terminal commit 前停止当前 dispatch；不得把该 run 当作 idle/completed 来释放 same-session dispatch；不得发布 completed/failed/canceled terminal event；不得新增 durable `RunStatus`。具体 paused-run / lane-blocking persistence 和 answer/cancel/timeout resume handling 由 `add-ts-human-pending-input-core` 及 timeout/type-specific changes 拥有。

理由：`Agent.execute(...)` 原本的 `Promise<void>` 无法区分“正常完成”和“已暂停等待输入”。如果 implementation change 自己用 thrown signal、普通 capability result 或私有状态表达暂停，runtime 可能把暂停误提交为 completed/failed，或让 AskUserQuestion 这类 producer 重复调用。显式 outcome 把暂停分支冻结在核心契约里，后续 core/pending/producer change 只消费该 surface。

拒绝方案：通过 thrown control signal 表达 pending pause。拒绝原因是它容易被既有 failure catch 误映射为 failed terminal path，也不如显式 outcome 易于 contract test。

拒绝方案：给 `CapabilityInvocationRuntimeContext` 增加通用 `requestPendingInput(...)` facade。拒绝原因是首版不让 capability executor 拥有 pending lifecycle 或 wait/resume state；若后续具体 producer 需要 facade，必须另行 change 定义窄 facade，并委托到同一个 runtime-owned handoff。

## 质量属性设计（Quality Attributes）

安全：`multiple` / `custom` 由 runtime request 决定，client answer 不能改变题型权限；active query 按 trusted owner+agent+session 过滤并强制或检测 scoped active-pending 唯一性；due query 不暴露给用户入口；resolve idempotency key 原文不得进入 stream、safe error、audit、metric 或 log。验证入口是 contract tests、owner/agent-scope negative tests 和 architecture boundary tests。

性能/容量：due query 必须带 positive bounded `limit`，避免无界扫描；active pending query 必须有 scoped index/constraint 支撑；resolve idempotency anchor 必须按 scoped key 建唯一约束。验证入口是 gateway contract tests。

可靠性/恢复：due query 让 runtime restart 后仍能发现 timeout；active query 让 cross-device submit guard 基于 durable facts 而不是内存；resolve idempotency 让 answer 网络重试不会产生双恢复。验证入口是 runtime recovery/timeout/concurrency characterization tests。

可维护性：所有共享字段、gateway 行为和 pending pause contract 只改 `agent-contracts/runtime` 和 `agent-contracts/gateway`；后续业务 change 消费同一 surface。验证入口是 dependency-cruiser architecture gate 和 package public export tests。

可测试性：字段、answer shape、query 和 resolve idempotency 都能由 contract tests 覆盖；业务决策留给后续 change 的 runtime tests。

审计/可追溯性：本 refinement 不新增 audit fact；后续 runtime event/audit 只能引用 pending input id、kind、status 和 safe summary。验证入口是 review 检查点。

## 验证映射（Verification Map）

- `multiple` / `custom` 在 request/record 中可用且不进入 answer payload：T1.1、T1.2；验证 `packages/agent-contracts` contract tests。
- answer shape 覆盖 text、single-select、multi-select、custom text：T1.3、T3.1；验证 contract/runtime negative tests。
- active pending query 保持 owner+agent+session scope 且不允许多条 active pending 被静默挑选：T2.1；验证 gateway contract tests。
- due timeout query bounded 且只返回 facts：T2.2；验证 gateway contract tests。
- pending resolve idempotency anchor 和 canonical semantic 输入：T2.3；验证 gateway contract tests 和 runtime answer idempotency tests。
- Agent/core pending pause outcome、partial lifecycle 禁止和 `requestPendingInput(...)` handoff：T1.4、T1.5；验证 runtime/core contract tests。
- runtime/channel/core/capability 依赖边界不变：T3.2；验证 `npm run lint:architecture`。

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-core-contracts/spec.md`。
- 架构和跨模块设计：`openspec/designs/architecture/runtime-boundaries.md`。
- 模块设计：`openspec/designs/modules/agent-contracts.md`、`openspec/designs/modules/agent-runtime.md`、gateway 模块文档。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [风险] due query 看起来像跨 owner 扫描。-> 只允许 runtime-internal usage，返回 facts 必须携带完整 scope，Web/channel 不暴露。
- [风险] `multiple` / `custom` 被误当成客户端权限。-> 明确只存在于 accepted request/question，answer 不携带 schema。
- [风险] answer idempotency 被误认为跨设备锁。-> 明确跨设备靠 pending status CAS；idempotency key 只解决同一 command 网络重试。
- [风险] contract refinement 被误实现为半套 pending lifecycle。-> 明确本 change 只冻结 handoff/outcome/query/idempotency surface；完整 pending lifecycle 不可用时必须 fail closed，不得创建 partial pending fact。
- [风险] active pending query 静默选择多条事实中的一条。-> gateway 必须 enforce/detect scoped uniqueness，多条 active pending 时通过 safe conflict fail closed，不得只记录 diagnostics。
- [取舍] 不新增 typed answer DTO。-> 保持三对象契约稳定，使用 question 约束解释 `string[][]`。
- [取舍] 新增最小 `producerRef` durable coordinate。-> 用一个 runtime-owned 恢复坐标换掉隐式 tool batch 推导；该字段不进入客户端、tool input、policy 或 scope 边界。

## 迁移计划（Migration Plan）

首版实现时为已有 question record 写入缺省语义：`multiple` 和 `custom` 缺省都等价 `false`。没有存量生产 pending input 需要数据迁移。pending resolve idempotency anchor 是 gateway write metadata；本地 gateway 可用专用锚点列或专用 scoped anchor 表实现，但不得作为 `PendingInputRecord` 字段泄漏。

## 归档前更新基线（Baseline Promotion Plan）

- 更新 `openspec/specs/ts-core-contracts/spec.md` 的 pending input requirement、gateway fact-query requirement、resolve idempotency requirement 和 Agent execution pending outcome requirement，并统一 pending question 字段命名与 answer idempotency 归属。
- 更新 `openspec/designs/architecture/runtime-boundaries.md` 的 pending input contract/refinement 设计。
- 更新 `openspec/designs/modules/agent-contracts.md` 和 gateway/runtime 模块设计。
- 更新 `openspec/designs/spec-to-design-map.md`。

## 待确认问题（Open Questions）

无。
