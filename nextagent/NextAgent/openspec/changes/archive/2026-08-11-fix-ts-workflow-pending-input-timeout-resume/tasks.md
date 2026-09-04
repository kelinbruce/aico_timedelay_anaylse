## 1. Runtime pending input timeout resume（agent-runtime）

- [x] 1.1 修改 `timeoutPendingInput`（`packages/agent-runtime/src/lifecycle/submit.ts`），在完成 pending input CAS（`PENDING` → `TIMED_OUT`）、发布 `USER_INPUT_TIMEOUT` 事件、加载最新 run record 后，对 `producerRef.kind === 'WORKFLOW_NODE'` 的 pending input，调用新方法 `resumePendingInputTimeout` 替代 `commitTerminal('FAILED')`。对 `producerRef.kind !== 'WORKFLOW_NODE'` 的 pending input，保持现有 `commitTerminal('FAILED')` 行为不变。
  验证：`packages/agent-runtime/tests/` 中新增 "WORKFLOW_NODE timeout resumes run" 测试通过
  来源：spec human-pending-input-core `WORKFLOW_NODE timeout resumes original run`、design 决策 1

- [x] 1.2 新增 `resumePendingInputTimeout` 方法（`packages/agent-runtime/src/lifecycle/submit.ts`），复用 `resumePendingRun` 的 checkpoint 加载和 recovery context 重建逻辑，但通过新方法 `attachWorkflowPendingTimeoutResume`（不设 `answers` 字段）替代 `attachWorkflowPendingResume`（设 `answers` 字段）。re-queue 逻辑与 `answerPendingInput` 的 WORKFLOW_NODE 路径一致（saveRun QUEUED + CAS `expectedVersion` + `enqueueWork`），MUST NOT 使用 `resumePendingRun` 的 `executeQueuedWork`（内联阻塞）。MUST 设置 `routingConstraints.targetRecipe` 为 `pending.producerRef.recipeName`（与 `answerPendingInput` line 2159-2168 和 `toPendingInputSubmitCommand` line 3488-3493 一致），因为 `timeoutPendingInput` 现有的 `command`（来自 `toRecoverySubmitCommand`）不含此字段。
  验证：`packages/agent-runtime/tests/` 中新增测试断言 `resumeState.answers === undefined`
  来源：spec human-pending-input-core `WORKFLOW_NODE timeout resumes original run`、design 决策 1

- [x] 1.3 新增 `attachWorkflowPendingTimeoutResume` 方法（`packages/agent-runtime/src/lifecycle/submit.ts`），与 `attachWorkflowPendingResume` 结构一致，但 MUST NOT 设置 `answers` 和 `pendingAnswerSummary` 字段。只设 `recipeName`、`nodeId`、`nodeType`、`pendingInputId`。
  验证：code review 确认 `answers` 字段未设置；`packages/agent-runtime/tests/` 中断言 `workflowPendingResume` 不含 `answers` key
  来源：design 决策 1

- [x] 1.4 在 `resumePendingInputTimeout` 中处理 checkpoint 不可用 fallback：当 `checkpointStore.loadCheckpoint` 返回 `undefined` 时，MUST fallback 到 `commitTerminal('FAILED')`（`failureReason: PENDING_INPUT_TIMEOUT`），MUST NOT 让 run 挂死。
  验证：`packages/agent-runtime/tests/` 中新增 "checkpoint unavailable fallback to FAILED" 测试断言 `PENDING_INPUT_TIMEOUT` failureReason
  来源：spec human-pending-input-core `WORKFLOW_NODE timeout checkpoint unavailable fallback`、design 决策 3

- [x] 1.5 新增 negative test：断言 `producerRef.kind === 'LIFECYCLE_HOOK'` 和 `producerRef.kind === 'CAPABILITY_INVOCATION'` 的 pending input 超时仍走 `commitTerminal('FAILED')` + `PENDING_INPUT_TIMEOUT`，MUST NOT resume。
  验证：`packages/agent-runtime/tests/` 中 negative case 实际触发并断言非 resume 行为
  来源：spec human-pending-input-core `Non-WORKFLOW_NODE timeout terminalizes directly`、design 决策 1 备选方案 B

- [x] 1.6 新增测试：`recoverLocalRuntime` 在 timeout resume 后发现 QUEUED run 时，CAS 必须防止 double dispatch。timeout resume 设置 run 为 QUEUED 并 `enqueueWork` 后，若 `recoverLocalRuntime` 同时发现该 QUEUED run，MUST NOT 重复 dispatch。
  验证：`packages/agent-runtime/tests/` 中新增 "recoverLocalRuntime does not double-dispatch QUEUED run from timeout resume" 测试
  来源：design 质量属性 可靠性/恢复

## 2. Engine 防御性超时处理（agent-workflow）

- [x] 2.1 修改 `executeInterruptNode`（`packages/agent-workflow/src/nodes/interaction-nodes.ts`），在 `readWorkflowPendingAnswer` 返回 `undefined` 之后、`requestPendingInput` 之前，新增判断：若 `context.resumeState !== undefined && context.resumeState.nodeId === context.nodeId && context.resumeState.nodeType === 'INTERRUPT' && context.resumeState.answers === undefined`，则抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT, retryable: true, safeDetails 含 nodeId/nodeType）。
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts` 中 "interrupt timeout resume throws" 测试通过
  来源：spec workflow-interaction-nodes `Timeout Resume Throws Workflow Node Timeout`、design 决策 2

- [x] 2.2 新增 negative test：断言 `executeInterruptNode` 超时 resume 后 MUST NOT 调用 `requestPendingInput` 创建新 pending input。
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts` 中 negative case 断言 `requestPendingInput` 未被调用
  来源：spec workflow-interaction-nodes `Timeout Resume Does Not Create New Pending Input`、design 决策 2

- [x] 2.3 修改 RESTFUL reflection 超时防御（`packages/agent-workflow/src/nodes/capability-nodes.ts` 的 `resolveRestfulArgs` 或 `restful-param-extract.ts` 的 `extractRestfulParameters` 调用前），新增判断：若 `context.resumeState !== undefined && context.resumeState.nodeId === context.nodeId && context.resumeState.answers === undefined`，则抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT）。
  验证：`npx vitest run packages/agent-workflow/tests/workflow-capability-nodes.test.ts` 中 "restful reflection timeout resume throws" 测试通过
  来源：design 决策 2

- [x] 2.4 确认 `executeUserCheckNode`（`packages/agent-workflow/src/nodes/interaction-nodes.ts`）已有 `answers === undefined → throwUserCheckTimeout` 逻辑（line 143-150），MUST NOT 修改。此为确认性 task。
  验证：code review 检查 `executeUserCheckNode` 无修改，现有超时判断逻辑保持不变
  来源：design 决策 2、spec workflow-interaction-nodes（USER_CHECK 已有处理）

## 3. 端到端测试

- [x] 3.1 新增测试：USER_CHECK pending input 超时后，recipe 配置了 `exception: { condition: "${error.category == 'TIMEOUT'}" }` 分支时，run 走 exception 分支，terminal 状态为 `COMPLETED`。
  验证：`packages/agent-workflow/tests/workflow-execution-engine.test.ts` 或 `packages/agent-runtime/tests/` 中新增端到端 case 通过
  来源：spec human-pending-input-timeout `WORKFLOW_NODE timeout routes via engine exception`

- [x] 3.2 新增测试：USER_CHECK pending input 超时后，recipe 未配置 exception 分支时，run 终态为 `FAILED`，`failureReason` 为 `WORKFLOW_NODE_TIMEOUT`。
  验证：`packages/agent-runtime/tests/` 中新增 case 断言 `WORKFLOW_NODE_TIMEOUT` failureReason
  来源：spec human-pending-input-timeout `WORKFLOW_NODE timeout without exception terminalizes FAILED`

- [x] 3.3 新增测试：CAS 竞态——timeout CAS 与用户回答 CAS 竞争，先完成者生效。若 timeout CAS 先成功，后续用户回答被拒绝（pending 状态已 TIMED_OUT）；若用户回答先成功，timeout CAS 失败。
  验证：`packages/agent-runtime/tests/` 中 CAS 竞态 case 断言先完成者生效
  来源：design 决策 3、verification map CAS 竞态不变

- [x] 3.4 新增测试：`USER_INPUT_TIMEOUT` 事件在 resume 前发布，timeline 事件序列正确（`USER_INPUT_REQUIRED` → `USER_INPUT_TIMEOUT` → resume 后的 execution 事件）。
  验证：`packages/agent-runtime/tests/` 中 timeline 事件序列断言
  来源：spec human-pending-input-core `WORKFLOW_NODE timeout resumes original run`、design 决策 4

- [x] 3.5 新增 negative test：断言 WORKFLOW_NODE 超时 resume 后，`failureReason` MUST NOT 为 `PENDING_INPUT_TIMEOUT`（除非 checkpoint 不可用 fallback）。旧 failureReason 仅在 non-WORKFLOW_NODE 和 fallback 场景出现。
  验证：`packages/agent-runtime/tests/` 中 negative case 断言 `PENDING_INPUT_TIMEOUT` 不出现（WORKFLOW_NODE + checkpoint 可用场景）
  来源：design 决策 5 BREAKING observable

- [x] 3.6 新增测试：timeout resume 的幂等性——若 timeout resume 后 run 因故障中断，后续 recovery 重新发现 TIMED_OUT 但未终态化的 pending input，MUST 幂等 resume（不重复 enqueue、不重复发布 `USER_INPUT_TIMEOUT` 事件）。CAS 由现有 `resolvePendingInput` 保护，timeout CAS 先完成后续重试 MUST NOT 产生新 side effect。
  验证：`packages/agent-runtime/tests/` 中新增 "timeout resume idempotency on retry" 测试断言不重复 side effect
  来源：spec human-pending-input-core `Partial timeout completion is retried from durable facts`、design 质量属性 可靠性/恢复

## 4. 验证和收尾

- [x] 4.1 code review 确认 `timeoutPendingInput` 中对 `producerRef.kind` 的判断不包含 `nodeType` 检查，runtime 不做业务语义路由。
  验证：code review 检查 `timeoutPendingInput` 分支逻辑
  来源：design 决策 1、AGENTS.md 架构边界

- [x] 4.2 code review 确认 `resumePendingInputTimeout` 使用 `enqueueWork`（非阻塞）而非 `executeQueuedWork`（内联），且 `skipTerminalLifecycleHook` 不在 resume 路径设置（仅在 checkpoint 不可用 fallback 时由 `toPendingInputTerminalContext` 设置）。
  验证：code review 检查 `resumePendingInputTimeout` 的 re-queue 方式和 `toPendingInputTerminalContext` 不被调用
  来源：design 决策 1 enqueueWork 决策、design 决策 5 skipTerminalLifecycleHook breaking observable

- [x] 4.3 运行 agent-runtime 包全量测试，确认无回退。
  验证：`npm test -- agent-runtime` 全绿
  来源：design 验证映射全量覆盖

- [x] 4.4 运行 agent-workflow 包全量测试，确认无回退。
  验证：`npm test -- agent-workflow` 全绿
  来源：design 验证映射全量覆盖

- [x] 4.5 运行 `openspec validate --all --strict` 确认 change 文档合法。
  验证：`openspec validate --all --strict` 无错误
  来源：AGENTS.md 验证门禁

- [x] 4.6 运行 `npm run lint:architecture` 确认架构边界无违反。
  验证：`npm run lint:architecture` 通过
  来源：AGENTS.md 验证门禁
