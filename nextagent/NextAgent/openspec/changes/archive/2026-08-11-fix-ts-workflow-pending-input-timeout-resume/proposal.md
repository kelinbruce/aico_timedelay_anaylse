## 背景与问题（Why）

workflow `user-check` 节点配置了 `node.timeout`（秒）后，当 pending input 超时，页面显示超时但 run 并未跳转到 `exception` 分支。根因：runtime 的 `timeoutPendingInput`（`packages/agent-runtime/src/lifecycle/submit.ts`）在 pending input 超时时直接调用 `commitTerminal('FAILED')`，绕过了 workflow engine 的 exception 路由路径。engine 侧已有的 `throwUserCheckTimeout` → `mapSafeErrorToVariables` → `resolveErrorTransition` exception 路由从未被触发。

两条超时路径存在：
1. **Engine-level timeout**（`node.timeout` → `createScopedAbortSignal` → `didTimeout`）：正确工作，触发 exception。不受本次修改影响。
2. **Pending input timeout**（`timeoutAt` → runtime scheduler → `timeoutPendingInput`）：当前直接终态化 FAILED，跳过 exception。本次修复目标。

`producerRef.kind === 'WORKFLOW_NODE'` 的 pending input 有三种 nodeType 会产生 pending input：`USER_CHECK`、`INTERRUPT`、`RESTFUL`（reflection）。`USER_CHECK` 的 engine handler 已有 `answers === undefined → throwUserCheckTimeout` 超时处理逻辑；`INTERRUPT` 和 `RESTFUL` 没有，若 runtime 无条件 resume 这两类会导致死循环（resume → 无 answers → 创建新 pending input → 再超时 → 再 resume）。

## 变更范围（What Changes）

### Runtime pending input timeout resume（agent-runtime）

`timeoutPendingInput` 在完成 pending input CAS（`PENDING` → `TIMED_OUT`）、发布 `USER_INPUT_TIMEOUT` 事件后，对 `producerRef.kind === 'WORKFLOW_NODE'` 的 pending input，MUST 改为 resume 原 run（加载 checkpoint、重建 recovery context、re-queue 执行），而非直接 `commitTerminal('FAILED')`。resume 时 MUST NOT 设置 `answers` 字段，使 engine handler 的 `resumeState.answers === undefined` 判断生效，触发 `throwUserCheckTimeout`。

runtime 不区分 `nodeType`（USER_CHECK / INTERRUPT / RESTFUL），统一 resume 所有 `WORKFLOW_NODE` pending input 超时。判断逻辑由 engine 各 handler 承担。

对 `producerRef.kind !== 'WORKFLOW_NODE'`（`LIFECYCLE_HOOK`、`CAPABILITY_INVOCATION`）的 pending input 超时，MUST 保持现有 `commitTerminal('FAILED')` 行为不变。

新增 `resumePendingInputTimeout` 方法，复用 `resumePendingRun` 的 checkpoint 加载和 recovery context 重建逻辑，但通过 `attachWorkflowPendingTimeoutResume`（不设 `answers`）替代 `attachWorkflowPendingResume`（设 `answers`）。

### Engine 防御性超时处理（agent-workflow）

- `executeInterruptNode`（`interaction-nodes.ts`）：MUST 新增 `resumeState.answers === undefined → throw WORKFLOW_NODE_TIMEOUT` 判断，防止超时 resume 后 fall through 创建新 pending input 导致死循环。
- `executeRestfulNode` reflection 路径（`capability-nodes.ts` / `restful-param-extract.ts`）：MUST 新增 `resumeState.answers === undefined → throw WORKFLOW_NODE_TIMEOUT` 判断，防止超时 resume 后重复调用模型创建新 reflection pending input。
- `executeUserCheckNode`：已有 `answers === undefined → throwUserCheckTimeout` 逻辑，MUST NOT 修改。

### 降级与边界

- checkpoint 不可用时，MUST fallback 到现有 `commitTerminal('FAILED')` 行为（`failureReason: PENDING_INPUT_TIMEOUT`），MUST NOT 让 run 挂死。
- 默认 30 分钟超时（未显式指定 `timeoutAt`）MUST 同样触发 resume，不区分显式与默认超时。
- CAS 竞态（timeout CAS vs 用户回答 CAS）由现有 `resolvePendingInput` CAS 语义保护，MUST NOT 引入新逻辑。

## 不在范围内（Explicit Non-Goals）

- 不改变 `LIFECYCLE_HOOK` 和 `CAPABILITY_INVOCATION` pending input 的超时行为（仍直接 `commitTerminal('FAILED')`）。
- 不改变 engine-level `node.timeout` abort signal 超时路径（`createScopedAbortSignal` → `didTimeout`）。
- 不改变 `refine-ts-workflow-user-check-scenarios` 的 user-check 节点增强（kind 场景、inputFormat、HUMAN_HANDOFF 等）。
- 不改变 `refine-ts-workflow-exception-failure-contract` 的 exception 变量空间 shape（`error.{code, message, category?}`）。
- 不改变 pending input timeout 上限（48h，由 `refine-ts-workflow-user-check-scenarios` task 1.5 承载）。
- 不引入新的 pending input kind 或 producerRef kind。
- 不改变 RESTFUL reflection 的参数提取逻辑本身（只在超时 resume 时防御性 throw）。
- 不修改 `question-pending-input`、`confirmation-pending-input`、`authorization-pending-input` 的 stable spec。这 3 个 spec 的 timeout scenario 写了无条件的 `visible terminal reason MUST be PENDING_INPUT_TIMEOUT`，未区分 `producerRef.kind`。当 QUESTION/CONFIRMATION/AUTHORIZATION pending input 的 `producerRef.kind === 'WORKFLOW_NODE'` 时，本 change 的行为变更（`WORKFLOW_NODE_TIMEOUT` 或 exception 路由）与这 3 个 spec 存在表面冲突。`human-pending-input-timeout` 的 MODIFIED scenario 已补 `producerRef.kind` 区分，是 timeout 行为的权威来源。这 3 个 kind-specific spec 的 `producerRef.kind` 区分留作后续 change。

## 依赖（Dependencies）

- `refine-ts-workflow-exception-failure-contract`：定义了 `error.category == "TIMEOUT"` 的 exception 变量空间 shape，本 change 依赖其先落地。
- `refine-ts-workflow-user-check-scenarios`：定义了 `throwUserCheckTimeout` 行为和 `node.timeout` 复用为等待超时，代码中已实现（`buildUserCheckTimeoutAt` 读 `context.node.timeout`、`throwUserCheckTimeout` 抛 `WORKFLOW_NODE_TIMEOUT`），本 change 依赖其 spec 先落地。

## Function 影响（OpenSpec Capabilities）

- 修改 Function `FN-6.5 请求用户确认或授权`（`human-pending-input-core` 主规格、`human-pending-input-timeout` 补充规格）：WORKFLOW_NODE producerRef 的 pending input 超时从直接终态化 `FAILED` 改为 resume 原 run，终态由 engine 决定；涉及可靠性/恢复。

- 修改 Function `FN-9.5 执行交互节点`（`workflow-interaction-nodes`）：`Interrupt Gateway` requirement 修改——INTERRUPT 节点超时 resume 时 throw `WORKFLOW_NODE_TIMEOUT`，防止死循环。

- 修改 Function `FN-9.4 执行能力节点`（`workflow-capability-nodes`）：`Restful Node` requirement 修改——RESTFUL reflection pending input 超时 resume 时 throw `WORKFLOW_NODE_TIMEOUT`，防止死循环。

## 影响范围（Impact）

- **agent-runtime**: `timeoutPendingInput` 方法修改——WORKFLOW_NODE 超时 resume 替代直接终态化；新增 `resumePendingInputTimeout` 和 `attachWorkflowPendingTimeoutResume` 方法。
- **agent-workflow**: `executeInterruptNode` 新增超时防御判断；RESTFUL reflection 路径新增超时防御判断；`executeUserCheckNode` 无修改。
- **agent-core**: 无修改（`default-agent.ts` bridge 的 `readWorkflowResumeState` 已正确处理 `answers === undefined`）。
- **agent-contracts**: 无修改。
- **测试**: USER_CHECK 超时 + exception → COMPLETED；USER_CHECK 超时 + 无 exception → FAILED（WORKFLOW_NODE_TIMEOUT）；INTERRUPT 超时防御 → FAILED；RESTFUL reflection 超时防御 → FAILED；checkpoint 不可用 fallback → FAILED（PENDING_INPUT_TIMEOUT）；CAS 竞态不变。
