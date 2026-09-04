# ADR：Workflow Pending Input 超时 Resume 由 Engine 决定

## 上下文

Workflow `user-check`、`interrupt` 和 `restful`（reflection）节点创建的 pending input 超时时，runtime 的 `timeoutPendingInput` 原先直接调用 `commitTerminal('FAILED')`（`failureReason: PENDING_INPUT_TIMEOUT`），绕过了 workflow engine 的 exception 路由路径。

engine 侧已有完整的超时处理链路：`throwUserCheckTimeout` → `toSafeError` → `mapSafeErrorToVariables` → `resolveErrorTransition`（exception 分支选择）。`executeUserCheckNode` 在 `resumeState.answers === undefined` 时已有 `throwUserCheckTimeout` 逻辑，但 runtime 在超时时从未 resume run，这条 engine 路径从未被触发。

Recipe 作者可以配置 `exception: { condition: "${error.category == 'TIMEOUT'}" }` 分支来处理超时，但该分支从未被触发，因为 runtime 直接终态化了 run。

## 决策

`producerRef.kind === 'WORKFLOW_NODE'` 的 pending input 超时时，runtime resume 原 run（从 checkpoint 重建 recovery context 并 re-queue 执行），不设 `answers` 字段，由 workflow engine handler 决定终态：

- `executeUserCheckNode`：已有 `answers === undefined → throwUserCheckTimeout` 逻辑，抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT）。
- `executeInterruptNode`：新增 `answers === undefined → throw WORKFLOW_NODE_TIMEOUT` 防御性判断，防止 fall through 创建新 pending input 导致死循环。
- `executeRestfulNode` reflection 路径：新增 `answers === undefined → throw WORKFLOW_NODE_TIMEOUT` 防御性判断，防止重复调用模型创建新 reflection pending input。

throw 产生的 safe error 走 engine exception 路由：若 recipe 配置了匹配的 exception 分支（如 `error.category == 'TIMEOUT'`），run 走 exception 分支（terminal 可能为 `COMPLETED`）；若无 exception 匹配，run 终态为 `FAILED`（`failureReason: WORKFLOW_NODE_TIMEOUT`）。

`producerRef.kind !== 'WORKFLOW_NODE'`（`LIFECYCLE_HOOK`、`CAPABILITY_INVOCATION`）的 pending input 超时保持直接终态化 `FAILED`（`PENDING_INPUT_TIMEOUT`），因为这两类的 resume 语义不同且没有 `answers === undefined` 超时处理逻辑。

checkpoint 不可用时 fallback 到直接终态化 `FAILED`（`PENDING_INPUT_TIMEOUT`），保证 run 收敛不挂死。

runtime 不区分 `nodeType`（USER_CHECK / INTERRUPT / RESTFUL），统一 resume 所有 `WORKFLOW_NODE` pending input 超时。判断逻辑由 engine 各 handler 承担，符合"runtime 不做业务语义路由"的架构边界。

## 可观察的 Breaking Change

- USER_CHECK 超时 + 无 exception：`failureReason` 从 `PENDING_INPUT_TIMEOUT` 变为 `WORKFLOW_NODE_TIMEOUT`。
- USER_CHECK 超时 + exception 匹配：terminal 状态从 `FAILED` 变为 `COMPLETED`（正向修复）。
- 超时终态时 terminal lifecycle hook 不再被跳过（`skipTerminalLifecycleHook` 不再设置），正向修复——audit、cleanup 等 hook 应在超时终态时执行。

## 被拒绝的方案

- **runtime 检查 `producerRef.nodeType === 'USER_CHECK'` 才 resume**：被拒绝，违反"runtime 不做业务语义路由"的架构边界，且 future 新增 WORKFLOW_NODE 类型需同步修改 runtime。
- **runtime resume 全部 pending input（含 LIFECYCLE_HOOK / CAPABILITY_INVOCATION）**：被拒绝，这两类的 resume 语义不同（LIFECYCLE_HOOK 需要恢复 lifecycle gate，CAPABILITY_INVOCATION 需要物化 capability result），且没有 `answers === undefined` 超时处理逻辑。
- **engine 不补 INTERRUPT/RESTFUL 防御性判断**：被拒绝，会导致 resume 后 fall through 创建新 pending input，形成死循环（resume → 无 answers → 创建新 pending input → 再超时 → 再 resume）。

## 已知后续 Follow-up

`question-pending-input`、`confirmation-pending-input`、`authorization-pending-input` 三个 stable spec 的 timeout scenario 写了无条件的 `visible terminal reason MUST be PENDING_INPUT_TIMEOUT`，未区分 `producerRef.kind`。当 QUESTION/CONFIRMATION/AUTHORIZATION pending input 的 `producerRef.kind === 'WORKFLOW_NODE'` 时，本决策的行为变更与这 3 个 spec 存在表面冲突。`human-pending-input-timeout` 的 `producerRef.kind` 区分是 timeout 行为的权威来源；这 3 个 kind-specific spec 的区分留作后续 change。
