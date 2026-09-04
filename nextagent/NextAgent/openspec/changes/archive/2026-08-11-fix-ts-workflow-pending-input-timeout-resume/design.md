## 设计范围

本 change 修改 2 个 Function 的行为契约，涉及 4 个 delta specs。

- **FN-6.5 请求用户确认或授权**：WORKFLOW_NODE pending input 超时从直接终态化 `FAILED` 改为 resume 原 run，终态由 engine 决定。涉及 delta specs：`human-pending-input-core`（主规格）、`human-pending-input-timeout`（补充规格）。设计章节：设计决策 1、3、4、5。
- **FN-9.5 执行交互节点**：`interrupt` 节点超时 resume 时防御性抛 `WORKFLOW_NODE_TIMEOUT`，防止死循环。涉及 delta spec：`workflow-interaction-nodes`（主规格）。设计章节：设计决策 2。
- **FN-9.4 执行能力节点**：`restful` 节点 reflection 超时 resume 时防御性抛 `WORKFLOW_NODE_TIMEOUT`，防止死循环。涉及 delta spec：`workflow-capability-nodes`（主规格）。设计章节：设计决策 2。

## 背景和现状（Context）

workflow `user-check` 节点配置 `node.timeout` 后，pending input 超时时 runtime 的 `timeoutPendingInput`（`packages/agent-runtime/src/lifecycle/submit.ts:2791`）直接调用 `commitTerminal('FAILED')`（line 2875-2888），绕过了 workflow engine 的 exception 路由路径。

engine 侧已有完整的超时处理链路：`throwUserCheckTimeout`（`interaction-nodes.ts:177`）→ `toSafeError`（`engine/index.ts`）→ `mapSafeErrorToVariables`（`engine/index.ts:1309`）→ `resolveErrorTransition`（exception 分支选择）。当 `resumeState.answers === undefined` 时，`executeUserCheckNode` 已有判断逻辑（`interaction-nodes.ts:143-150`）调用 `throwUserCheckTimeout` 抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT）。但 runtime 在超时时从未 resume run，这条 engine 路径从未被触发。

`answerPendingInput` 路径（用户回答恢复）已正确工作：`resumePendingRun`（`submit.ts:3044`）加载 checkpoint → 重建 recovery context → `attachWorkflowPendingResume`（`submit.ts:3348`，设 `answers` 字段）→ re-queue。`default-agent.ts:1333-1342` 的 `readWorkflowResumeState` 从 `flowVariables.workflowPendingResume` 读取 `answers`，若 `answers` 为 `undefined` 则不设 `resumeState.answers`。

三条 pending input 超时路径：
- `LIFECYCLE_HOOK`：不产生 WORKFLOW_NODE pending input，不受影响。
- `CAPABILITY_INVOCATION`：不产生 WORKFLOW_NODE pending input，不受影响。
- `WORKFLOW_NODE`：包含 USER_CHECK、INTERRUPT、RESTFUL 三种 nodeType，本次修改目标。

相关方：recipe 作者（配置 exception condition）、runtime（`agent-runtime`，pending input 超时处理）、workflow engine（`agent-workflow`，节点超时判断和 exception 路由）、agent-core（`default-agent.ts` bridge，resume state 重建）。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- runtime `timeoutPendingInput` 对 `producerRef.kind === 'WORKFLOW_NODE'` 的 pending input 超时，resume 原 run 而非直接 `commitTerminal('FAILED')`，使 engine 的 `throwUserCheckTimeout` → exception 路由路径被触发。
- runtime 不区分 nodeType（USER_CHECK / INTERRUPT / RESTFUL），判断逻辑由 engine 各 handler 承担。
- engine 对 INTERRUPT 和 RESTFUL 补防御性超时处理，防止 resume 后死循环。

**非目标：**
- 不改变 `LIFECYCLE_HOOK` 和 `CAPABILITY_INVOCATION` pending input 的超时行为。
- 不改变 engine-level `node.timeout` abort signal 超时路径。
- 不改变 `executeUserCheckNode` 已有的超时处理逻辑。
- 不改变 `default-agent.ts` bridge 的 `readWorkflowResumeState` 逻辑（已正确处理 `answers === undefined`）。
- 不改变 exception 变量空间 shape（由 `refine-ts-workflow-exception-failure-contract` 承载）。
- 不改变 user-check 节点增强（由 `refine-ts-workflow-user-check-scenarios` 承载）。

## 设计决策（Decisions）

### 决策 1：runtime 对 WORKFLOW_NODE 超时统一 resume，不区分 nodeType

`timeoutPendingInput` 在完成 pending input CAS 和 `USER_INPUT_TIMEOUT` 事件发布后，对 `producerRef.kind === 'WORKFLOW_NODE'` 的 pending input，调用新方法 `resumePendingInputTimeout` 替代 `commitTerminal('FAILED')`。不检查 `producerRef.nodeType`。

理由：runtime 的架构边界是 request lifecycle 和 canonical timeline，不做业务语义路由。区分 nodeType 是业务语义判断，应由 engine 承担。`producerRef.kind === 'WORKFLOW_NODE'` 是 runtime 已有的判断（`attachWorkflowPendingResume` 和 `isWorkflowInterruptPendingInput` 均使用），不引入新概念。

`resumePendingInputTimeout` 复用 `resumePendingRun` 的 checkpoint 加载和 recovery context 重建逻辑，但通过 `attachWorkflowPendingTimeoutResume`（不设 `answers` 字段）替代 `attachWorkflowPendingResume`（设 `answers` 字段）。这样 `default-agent.ts:1334` 的 `asStringMatrix(pendingResume?.['answers'])` 返回 `undefined`，`resumeState.answers` 不被设置，触发 engine handler 的超时判断。

`resumePendingInputTimeout` 的 re-queue MUST 使用 `enqueueWork`（非阻塞），MUST NOT 使用 `executeQueuedWork`（内联阻塞）。理由：`timeoutPendingInput` 在 timeout batch loop 中被调用，若使用 `executeQueuedWork` 内联执行 resume，会阻塞 loop 处理后续到期 timeout。`answerPendingInput` 的 WORKFLOW_NODE 路径（`submit.ts:2240`）同样使用 `enqueueWork`，保持一致。`resumePendingRun`（`submit.ts:3186`）使用 `executeQueuedWork` 是因为用户回答场景不在 batch loop 中，可以内联执行。

`resumePendingInputTimeout` 的 re-queue pattern 参照 `answerPendingInput` 的 WORKFLOW_NODE 路径（`submit.ts:2225-2240`）：saveRun QUEUED + CAS `expectedVersion` + `enqueueWork`。checkpoint 加载和 recovery context 重建逻辑复用 `resumePendingRun`（`submit.ts:3044-3190`），但 re-queue 方式不同。MUST 设置 `routingConstraints.targetRecipe` 为 `pending.producerRef.recipeName`（与 `answerPendingInput` line 2159-2168 一致），因为 `timeoutPendingInput` 现有的 `command`（来自 `toRecoverySubmitCommand`，`submit.ts:2848`）不含此字段，不设置会导致 resume run 路由到错误 recipe。

**备选方案 A**：runtime 检查 `producerRef.nodeType === 'USER_CHECK'` 才 resume，其余直接 FAILED。放弃：违反"runtime 不做业务语义路由"的架构边界，且 future 新增 WORKFLOW_NODE 类型需同步修改 runtime。

**备选方案 B**：runtime resume 全部 pending input（含 LIFECYCLE_HOOK / CAPABILITY_INVOCATION）。放弃：这两类的 resume 语义不同（LIFECYCLE_HOOK 需要恢复 lifecycle gate，CAPABILITY_INVOCATION 需要物化 capability result），且它们没有 `answers === undefined` 超时处理逻辑。

### 决策 2：engine 对 INTERRUPT 和 RESTFUL 补防御性超时处理

由于 runtime 不区分 nodeType 统一 resume，INTERRUPT 和 RESTFUL 在 `resumeState.answers === undefined` 时会 fall through 创建新 pending input，导致死循环。必须在 engine handler 中补防御性判断。

**INTERRUPT**（`executeInterruptNode`，`interaction-nodes.ts:279`）：在 `readWorkflowPendingAnswer` 返回 `undefined` 之后、`requestPendingInput` 之前，新增判断：
``+text
if (resumeState !== undefined && resumeState.nodeId === nodeId && resumeState.nodeType === 'INTERRUPT' && resumeState.answers === undefined) {
  throw WORKFLOW_NODE_TIMEOUT (category: TIMEOUT)
}
``+
与 `executeUserCheckNode` 的超时判断模式（`interaction-nodes.ts:143-150`）一致。

**RESTFUL reflection**（`capability-nodes.ts` / `restful-param-extract.ts`）：在 `readReflectionAnswer` 返回 `undefined` 之后、`extractRestfulParameters` 之前，新增判断：
``+text
if (resumeState !== undefined && resumeState.nodeId === nodeId && resumeState.answers === undefined) {
  throw WORKFLOW_NODE_TIMEOUT (category: TIMEOUT)
}
``+
RESTFUL 的 `readReflectionAnswer`（`capability-nodes.ts:55-61`）在 `answers === undefined` 时返回 `undefined`，与 `readWorkflowPendingAnswer` 行为一致。

两个防御性 throw 产生的 `WORKFLOW_NODE_TIMEOUT` 会走 engine exception 路由（如 recipe 配了 `error.category == 'TIMEOUT'` 的 exception）或 FAILED。这是 resume 统一路径的必要副作用，不是本次 change 的主目标。主目标是 USER_CHECK 的超时 exception 路由。

### 决策 3：checkpoint 不可用时 fallback 到直接终态化

`resumePendingInputTimeout` 在 checkpoint 不可用时（`checkpointStore.loadCheckpoint` 返回 `undefined`），MUST fallback 到现有 `commitTerminal('FAILED')` 行为（`failureReason: PENDING_INPUT_TIMEOUT`），MUST NOT 让 run 挂死。

理由：checkpoint 不可用是降级场景（持久化故障、数据丢失等），resume 无法进行。fallback 到直接终态化保证 run 收敛，不引入新风险。fallback 时的 `failureReason` 保持 `PENDING_INPUT_TIMEOUT`（而非 `WORKFLOW_NODE_TIMEOUT`），因为 engine 路径未走完，用 runtime 超时原因更准确。

### 决策 4：USER_INPUT_TIMEOUT 事件在 resume 前发布

`timeoutPendingInput` 现有逻辑在 `commitTerminal` 前发布 `USER_INPUT_TIMEOUT` 事件（`submit.ts:2852`）。改为 resume 后，该事件 MUST 仍在 resume 前发布。

理由：超时是已发生的事实，resume 是后果。事件记录的是"pending input 超时"这一事实，不应因后续走 resume 还是终态化而改变。timeline 事件的消费者（audit、observability）依赖该事件做超时统计。

### 决策 5：Breaking observable — failureReason 变化

USER_CHECK 超时 + 无 exception 匹配时，terminal `failureReason` 从 `PENDING_INPUT_TIMEOUT` 变为 `WORKFLOW_NODE_TIMEOUT`（由 engine `toSafeError` 合成）。这是可观察的 breaking change。

USER_CHECK 超时 + exception 匹配时，terminal 状态从 `FAILED` 变为 `COMPLETED`（exception 分支成功执行）。这也是可观察的 breaking change，但是正向修复——正是用户期望的行为。

INTERRUPT 和 RESTFUL 超时的 failureReason 同样从 `PENDING_INPUT_TIMEOUT` 变为 `WORKFLOW_NODE_TIMEOUT`。这是防御性处理的副作用。

现有 spec `human-pending-input-timeout` 要求 "visible terminal reason MUST be `PENDING_INPUT_TIMEOUT`"，需 MODIFIED 为：WORKFLOW_NODE producerRef 的超时终态由 engine 决定，failureReason 为 `WORKFLOW_NODE_TIMEOUT`（无 exception）或 `COMPLETED`（exception 匹配）。

现有 spec `human-pending-input-core` 要求 "MUST 幂等完成 `FAILED/PENDING_INPUT_TIMEOUT`" 和 "MUST NOT 恢复原 run"，需 MODIFIED 为：WORKFLOW_NODE producerRef 的超时 resume 原 run，终态由 engine 决定。

此外，`timeoutPendingInput` 现有路径通过 `toPendingInputTerminalContext`（`submit.ts:2878`）设置 `skipTerminalLifecycleHook: true`（`submit.ts:3472`），跳过 terminal lifecycle hook。改为 resume 后，若 engine throw `WORKFLOW_NODE_TIMEOUT` 且无 exception 匹配而终态化 FAILED，terminal commit 走正常路径，`skipTerminalLifecycleHook` 不再被设置——terminal lifecycle hook 将被执行。这是可观察的 breaking change：原先超时不触发 terminal lifecycle hook，现在会触发。这是正向修复——terminal lifecycle hook（如 audit、cleanup）应在超时终态时执行。

### 已知冲突与后续 follow-up

stable baseline 中 `question-pending-input`、`confirmation-pending-input`、`authorization-pending-input` 三个 spec 的 timeout scenario 写了无条件的 `visible terminal reason MUST be PENDING_INPUT_TIMEOUT`，未区分 `producerRef.kind`。当 QUESTION/CONFIRMATION/AUTHORIZATION pending input 的 `producerRef.kind === 'WORKFLOW_NODE'` 时，本 change 的行为变更（`WORKFLOW_NODE_TIMEOUT` 或 exception 路由）与这 3 个 spec 存在表面冲突。

本 change 只关注 WORKFLOW_NODE timeout 处理，不修改这 3 个 spec。`human-pending-input-timeout` 的 MODIFIED scenario 已补 `producerRef.kind` 区分，是 timeout 行为的权威来源。这 3 个 kind-specific spec 的 `producerRef.kind` 区分留作后续 change。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | resume 不引入新的 trusted field 注入。`resumeState` 仍由 runtime 从 checkpoint 和 pending input record 构建，不接受客户端输入。`answers === undefined` 是 runtime 控制的信号，不可被外部伪造（pending input 状态已 CAS 为 TIMED_OUT）。 | resume 使用的 resumeState 不含客户端 payload 的 contract test |
| 性能/容量 | resume 路径复用现有 checkpoint 加载和 recovery context 重建，无额外开销。一次 timeout resume = 一次 checkpoint load + 一次 context reconstruct + 一次 re-queue，与 `resumePendingRun` 等价。 | 现有 runtime 性能测试无回退 |
| 可靠性/恢复 | checkpoint 不可用时 fallback 到直接终态化，保证 run 收敛。CAS 竞态由现有 `resolvePendingInput` 保护。runtime 重启后 timeout recovery 仍能处理 TIMED_OUT 但未终态化的 run——若 checkpoint 可用则 resume，否则 fallback。 | checkpoint 不可用 fallback 测试 + CAS 竞态测试 |
| 可维护性 | runtime 不区分 nodeType，engine 各 handler 自行处理超时。新增 WORKFLOW_NODE 类型时只需在 handler 中补超时判断，不需修改 runtime。符合"runtime 不做业务语义路由"边界。 | code review + 架构边界检查 |
| 可测试性 | `answers === undefined` 是 resume 的关键信号，可直接断言。exception 路由结果（COMPLETED / FAILED）是外部可观察行为。INTERRUPT/RESTFUL 死循环可通过超时 resume 后不再创建新 pending input 断言。 | runtime + workflow 测试套件 |
| 审计/可追溯性 | `USER_INPUT_TIMEOUT` 事件在 resume 前发布，timeline 记录超时事实。resume 后的 execution 走正常 timeline 流程，exception 路由产生 `NODE_FAILED` → exception 分支事件。 | timeline 事件序列断言 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| WORKFLOW_NODE 超时 resume 替代直接终态化 | 1.1, 1.2 | `packages/agent-runtime/tests/` pending input timeout resume 测试 |
| resume 不设 answers 字段 | 1.2 | 测试断言 `resumeState.answers === undefined` |
| checkpoint 不可用 fallback | 1.3 | 测试断言 fallback 走 `commitTerminal('FAILED')` + `PENDING_INPUT_TIMEOUT` |
| LIFECYCLE_HOOK / CAPABILITY_INVOCATION 不受影响 | 1.4 | 测试断言非 WORKFLOW_NODE 仍直接终态化 |
| INTERRUPT 超时防御 | 2.1 | `workflow-interaction-nodes.test.ts` INTERRUPT 超时 throw 测试 |
| RESTFUL reflection 超时防御 | 2.3 | `workflow-capability-nodes.test.ts` reflection 超时 throw 测试 |
| RESTFUL reflection 超时防御 (spec) | 2.3 | spec workflow-capability-nodes `Reflection Timeout Resume Throws Workflow Node Timeout` |
| USER_CHECK 超时 + exception → COMPLETED | 3.1 | `workflow-execution-engine.test.ts` 超时 exception 路由测试 |
| USER_CHECK 超时 + 无 exception → FAILED | 3.2 | runtime 测试断言 `WORKFLOW_NODE_TIMEOUT` failureReason |
| CAS 竞态不变 | 3.3 | 测试断言 timeout CAS vs answer CAS 先完成者生效 |
| USER_INPUT_TIMEOUT 事件在 resume 前发布 | 3.4 | timeline 事件序列断言 |
| BREAKING: failureReason 变化 | 3.5 | negative test 断言旧 `PENDING_INPUT_TIMEOUT` 不再出现（WORKFLOW_NODE 场景） |
| 架构边界: runtime 不区分 nodeType | 4.1 | code review 确认 `timeoutPendingInput` 无 nodeType 检查 |

## 长期基线刷新计划

stable spec：
- `openspec/specs/human-pending-input-core/spec.md`：修改，`Runtime resolves pending input timeout` requirement 新增 WORKFLOW_NODE 超时 resume 行为。
- `openspec/specs/human-pending-input-timeout/spec.md`：修改，`Timeout never auto-approves` requirement 对齐 WORKFLOW_NODE 超时终态由 engine 决定。
- `openspec/specs/workflow-interaction-nodes/spec.md`：修改，`Interrupt Gateway` requirement 新增超时防御处理。
- `openspec/specs/workflow-capability-nodes/spec.md`：修改，`Restful Node` requirement 新增 reflection 超时防御处理。

Function：
- `FN-6.5 请求用户确认或授权`：刷新处理过程和结果。
- `FN-9.5 执行交互节点`：刷新处理过程和结果。
- `FN-9.4 执行能力节点`：刷新处理过程和结果。

Feature：无（不影响用户价值、黑盒边界或 Function 组成）。

overview：无（pending input timeout resume 是模块内行为，不影响系统级背景）。

architecture：
- `openspec/designs/architecture/workflow-execution-and-routing.md`：修改，补充 pending input 超时 resume 走 engine exception 路由的跨模块流程。

modules：
- `openspec/designs/modules/agent-workflow.md`：修改，补充 INTERRUPT/RESTFUL 超时防御处理的设计落点。
- `openspec/designs/modules/agent-runtime.md`：修改，补充 `timeoutPendingInput` resume 路径的设计落点。

ADR：
- `openspec/designs/adr/workflow-pending-input-timeout-resume.md`：新增 ADR，记录 pending input 超时 resume 由 engine 决定而非 runtime 直接终态化的取舍。

spec-to-design-map：
- `openspec/designs/spec-to-design-map.md`：修改，新增 human-pending-input-core / human-pending-input-timeout / workflow-interaction-nodes / workflow-capability-nodes 到 architecture/module/adr 的导航。
