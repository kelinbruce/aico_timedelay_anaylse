## 0. Scope lock

- [x] 0.1 本 change 只收敛共享 pending input contract surface：`agent-contracts/runtime` question shape、`AgentExecutionOutcome`、`AgentRunStatePort.requestPendingInput(...)`、`agent-contracts/gateway` pending fact queries、`resolvePendingInput` idempotency metadata、gateway adapter support 和 contract/architecture tests。
  验证：diff review 确认没有新增 Web route、runtime pending lifecycle、timeout outcome、type-specific validation 或独立 pending-input subpath；确认未创建缺少 checkpoint-before-visible、same-session lane protection 和 answer/cancel/timeout recovery path 的 partial pending lifecycle
  来源：proposal 架构约束
- [x] 0.2 实施顺序固定为 question shape -> Agent execution pending outcome -> runtime-owned pending handoff contract -> gateway record/query contract -> local/remote adapter support -> resolve idempotency -> boundary tests；后续 core/timeout/kind/producer change 只能消费这些 surface。
  验证：tasks/checklist review；后续 change 不重复定义平行 DTO、Record、status、store 或 helper API
  来源：同形同策原则

## 1. Contract surface

- [x] 1.1 在 `agent-contracts/runtime` 的 `PendingInputQuestion` 中增加 `multiple?: boolean` 和 `custom?: boolean`，并确保 `PendingInputIntent`、`PendingInputRequest` 通过同一 question shape 继承这些字段。
  验证：`npm test -- packages/agent-contracts` 或对应 runtime contract test；`npm run build`
  来源：`Hook And Pending Boundary Baseline`
- [x] 1.2 在 `agent-contracts/gateway` 的 pending input question/request record 中增加 `multiple?: boolean` 和 `custom?: boolean`，缺省语义都为 `false`；在 `PendingInputRecord` durable fact 中增加 runtime-owned minimal `producerRef`，只允许 `{ kind: "LIFECYCLE_HOOK" }` 或 `{ kind: "CAPABILITY_INVOCATION", capabilityId, toolCallId }`。
  验证：gateway contract test；source tests 断言 `producerRef` 不进入 client answer、Web DTO、tool input 或 `AgentExecutionOutcome`，且不携带 identity、scope、policy、risk、operation、idempotency 或 timeout behavior；`npm run build`
  来源：`Pending input gateway fact queries`
- [x] 1.3 增加 answer shape contract/runtime tests，覆盖 text、single-select、multi-select、custom text 和非法空值/重复值/越权 custom。
  验证：pending input contract/runtime validation tests；断言 `custom=true` 单选题只能提交一个总值（一个 option 或一个 custom text），`custom=true` 多选题最多包含一个 custom text
  来源：`Pending input boundary objects stay minimal`
- [x] 1.4 定义 `AgentExecutionOutcome`，并将 `Agent.execute(...)` 返回值从 `Promise<void>` 改为 `Promise<AgentExecutionOutcome>`；只允许 `{ status: "COMPLETED" }` 和 `{ status: "PENDING_INPUT", pendingInput: PendingInputRequest }` 两种 core-to-runtime control outcome。
  验证：runtime contract tests 断言 `PENDING_INPUT` 不新增 `RunStatus`、不使用 thrown control signal、不会进入 terminal output aggregation、terminal commit 或 failure commit path，且不携带 reason、lifecycle stage、producerRef、toolCallId、resume hint 或其它 producer 坐标；source/integration tests 断言 `requestPendingInput(...)` 成功返回后 Agent/core 立即返回 `PENDING_INPUT`，不继续执行后续 tool call 或 append 普通 capability result，runtime 不把该 run 当作 idle/completed 释放 same-session dispatch
  来源：`Agent execution can pause for pending input`
- [x] 1.5 在既有 `AgentRunStatePort` 增加 `requestPendingInput(run, context, intent): Promise<PendingInputRequest>`，作为 Capability invocation producer 提交 producer-local validated `PendingInputIntent` 的唯一 runtime-owned internal handoff；runtime 在 pending 可见前仍必须做最终 acceptance validation。
  验证：contract tests 断言该方法接收 accepted `RequestRun`、trusted `RequestContext` 和 `PendingInputIntent`，仅在 acceptance 成功时返回 safe `PendingInputRequest`，不等待 answer，不返回 answer、terminal、resume 或 lifecycle-stage decision，不暴露 public Web command 或 capability-private wait/resume API；当完整 pending lifecycle 不可用、checkpoint/pending acceptance failure、active pending conflict、abort 或 unexpected producer failure 时，沿用既有 runtime/capability safe failure path，由 producer 映射为 safe reason code，不创建 partial pending fact、不返回 `PENDING_INPUT`、不新增第三种 `AgentExecutionOutcome`、不改变 ordinary `CapabilityInvocationPort.invoke(...)` 失败语义
  来源：`Capability invocation producer uses runtime-owned handoff`

## 2. Gateway fact queries and resolve idempotency

- [x] 2.1 在 `PendingInputStoreGateway` 增加 `loadActivePendingInput({ tenantId, subjectId, agentId, sessionId })`，并在本地/远端 gateway adapter 中实现 owner+agent+session scoped 查询。
  验证：gateway contract test 覆盖 scoped hit、scoped miss、cross-owner/cross-agent negative case；local gateway source/contract test 断言 active pending scoped uniqueness 使用 adapter-private partial unique index 或等价 constraint，且不得以 `ORDER BY` / `LIMIT 1` 静默选择多条 active pending 中的一条；多条 active pending 检测必须通过既有 safe conflict normalization fail closed，且不得只记录 logs/metrics
  来源：`Pending input gateway fact queries`
- [x] 2.2 在 `PendingInputStoreGateway` 增加 `listDuePendingInputs({ now, limit })`，并在 gateway adapter 中实现 bounded due query。
  验证：gateway contract test 覆盖 due filtering、status filtering、limit enforcement、按 `timeoutAt` 再按 stable pending input id 的稳定返回顺序或 adapter 等价稳定顺序
  来源：`Pending input gateway fact queries`
- [x] 2.2a 为 due timeout query 增加 adapter-private indexed storage 约束：local gateway MUST 使用私有 `timeout_at` column/index 或等价索引结构支撑 `listDuePendingInputs({ now, limit })`；MUST NOT 以无界 JSON/full-table scan 实现；该索引不得暴露为新的 `PendingInputRecord` 业务字段。
  验证：gateway contract/source tests 覆盖 indexed due filtering、status filtering、limit enforcement，以及 `PendingInputRecord` 不新增 timeout implementation 字段
  来源：`Runtime lists pending inputs due for timeout`
- [x] 2.3 将 `resolvePendingInput` 扩展为带 `{ idempotencyKey, idempotencySemantic }` write option / result 的 pending resolve contract；同 key+semantic 返回等价 resolved record，不同 semantic 返回 idempotency conflict，且 key 不进入 `PendingInputRecord` 业务字段。
  验证：gateway resolve idempotency contract tests；runtime contract/source test 断言 `idempotencySemantic` 只由 pendingInputId、target resolve status 和 validated ordered answers 组成，使用版本化确定性 tuple 编码，不在 validation 后重排 answers、trim、case-folding 或其它语义归一化，不包含 answeredAt、idempotencyKey、random/trace/audit/log/stream/gateway row/adapter-private/wall-clock fields；source assertion 断言 `PendingInputRecord` 不暴露 idempotency key
  来源：`Pending input resolve is idempotent`

## 3. Boundary validation

- [x] 3.1 增加 answer payload schema/contract test，断言客户端 answer 不能携带 identity、idempotencyKey、multiple、custom、answer schema、timeout behavior 或 model-formatted answer。
  验证：contract negative test
  来源：`Hook And Pending Boundary Baseline`
- [x] 3.2 增加或更新 architecture test，断言 `PendingInputStoreGateway` 的新增 query 和 resolve idempotency surface 只能被 runtime/gateway implementation 消费，channel/core/model/capability 不直接调用 gateway pending query 或私自 resolve pending lifecycle；同时断言不得新增 generic `PolicyPort`、`CapabilityInvocationRuntimeContext.requestPendingInput(...)` facade、除 runtime-owned minimal `producerRef` 之外的 pending record producer/tool-call 字段或 capability-private wait/resume state。
  验证：`npm run lint:architecture`
  来源：design D3、D4、D5、D6
- [x] 3.3 运行 OpenSpec 和工程验证。
  验证：`openspec validate refine-ts-pending-input-contracts --strict`、`npm run build`、`npm test`、`npm run lint:architecture`
  来源：本 change 全部 requirements

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，按 proposal/design 的 Baseline Promotion Plan 更新长期基线；不得在 apply 阶段把长期基线更新当作普通实施任务提前勾选。
