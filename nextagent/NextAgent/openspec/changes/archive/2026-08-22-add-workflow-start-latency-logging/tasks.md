# Tasks

## 1. workflow.execution.started 诊断事件（agent-workflow/engine）

- [x] 1.1 确认 `InMemoryWorkflowExecutionService.execute()` 在 recipe version 校验通过后、`executePath` 之前输出 `workflow.execution.started` info 级别日志，携带 `executionId`、`recipeName`、`runId`、`startedAtEpochMs`。代码已有（commit `0b26e5f7c`），确认字段与 spec 对齐。 -> 验证: workflow-node-logging.test.ts 断言事件存在、级别 info、字段类型正确
- [x] 1.2 新增 negative-case 测试：断言 `workflow.execution.started` 不进入 timeline event、audit、metric、trace 或 Web API response。 -> 验证: 测试断言 timeline store 无 `workflow.execution.started` 记录

## 2. runtime.run.dispatched 升级（agent-runtime/submit）

- [x] 2.1 修改 submit.ts `dispatched` 日志：`logger.debug` → `logger.info`，字段 `createdAt` → `runCreatedAtMs`（= `Number(run.createdAt)`）。 -> 验证: submit-acceptance-order.test.ts 断言级别 info、字段名 `runCreatedAtMs`、值 > 0
- [x] 2.2 新增 negative-case 测试：断言 `runtime.run.dispatched` 不进入 timeline event、audit、metric、trace 或 Web API response。 -> 验证: 测试断言 timeline store 无 `runtime.run.dispatched` 记录

## 3. runtime.run.turn_completed 规格化（agent-runtime/submit）

- [x] 3.1 确认 `turn_completed` 已有实现（submit.ts:6464），无需改代码。确认字段与 spec 对齐：`agentId`、`sessionId`、`requestId`、`runId`、`runStatus`、`durationMs`。 -> 验证: 确认代码字段与 spec 一致
- [x] 3.2 新增测试：断言 `runtime.run.turn_completed` 在 run 终态时以 info 级别输出，携带 `durationMs`，且不进入 timeline/audit/Web API。 -> 验证: 测试断言事件存在、级别 info、durationMs > 0、timeline store 无记录

## 4. OpenSpec 验证与回归测试

- [x] 4.1 运行 `openspec validate --all --strict` 通过。 -> 验证: 命令退出码 0
- [x] 4.2 运行 `npm test` 确认 runtime + workflow + kernel 测试无回归。 -> 验证: 测试全部通过
