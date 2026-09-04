# Tasks

## 1. tool-loop 分级上限与可恢复支持

- [x] 1.1 在 `packages/agent-core/src/tools/tool-loop.ts` 增加 `READONLY_CAPABILITY_IDS = new Set(["Read","Grep","Glob"])`，导出 `isReadOnlyCapability(toolName)` 与纯函数 `evaluateToolCallLimit(toolCalls, maxCalls, maxReadOnlyCalls?)`，返回 `{ exceeded, readOnlyCount, sideEffectingCount, effectiveMaxReadOnlyCalls }`；`maxReadOnlyCalls` 为 `undefined` 时维持旧行为 `toolCalls.length > maxCalls`。
  验证：`vitest run packages/agent-core/tests/tool-loop-readonly-fanout.test.ts`
  来源：design 决策 2、3、5；spec `tool loop 按工具危险性分级约束每轮 fan-out 并可恢复`

- [x] 1.2 `executeToolCallsInOrder` 入参增加 `maxReadOnlyCalls?: number`；超额检查改用 `evaluateToolCallLimit`，`tool.loop.limit_exceeded` 日志补充 `readOnlyCount`、`sideEffectingCount`、`maxReadOnlyCalls` 字段；未传 `maxReadOnlyCalls` 时行为与基线一致。
  验证：`vitest run packages/agent-core/tests/parallel-tool-loop.test.ts`、`vitest run tests/agent-kernel/capability-governance.test.ts`
  来源：design 决策 5、6；spec 同上

- [x] 1.3 `minimalToolLoopLimits` 增加 `maxReadOnlyToolCallsPerRound: 20` 与 `toolCallLimitRecoveryLimit: 3`；新增导出 `appendToolCallLimitCorrectionMessage(runState, run, context, round, evaluation, maxCalls, maxReadOnlyCalls)`，追加 `role=USER`、`visible=true`、`metadata.kind=TOOL_CALL_LIMIT_CORRECTION` 的纠正消息。
  验证：code review 检查 `tool-loop.ts`
  来源：design 决策 7、8；spec 同上

## 2. governor 产出 maxReadOnlyToolCalls

- [x] 2.1 `packages/agent-core/src/routing/routing-constraint-governor.ts` 的 `GovernedRoutingConstraints` 增加 `maxReadOnlyToolCalls: number`；`govern(context, defaultMaxToolCalls, defaultMaxReadOnlyToolCalls=20)` 在 `executionMode==="model-only"` 或 `constraints.maxToolCalls===0` 时把两个上限都置 0，否则 `maxReadOnlyToolCalls` clamp 到 [0,20]。
  验证：`vitest run packages/agent-core/tests/routing-constraint-budget.test.ts`
  来源：design 决策 4；spec `tool loop 按工具危险性分级约束每轮 fan-out 并可恢复`

## 3. DefaultAgent 主路径可恢复重试

- [x] 3.1 `packages/agent-core/src/agent/default-agent.ts` `DefaultAgentDependencies` 增加 `maxReadOnlyToolCallsPerRound?: number`（默认 20）；`govern` 调用传入该值，从 `governedConstraints.maxReadOnlyToolCalls` 取 `maxReadOnlyCalls`。
  验证：code review 检查 `default-agent.ts`
  来源：design 决策 4、6；spec 同上

- [x] 3.2 主路径（模型 round 产生 tool calls 后、调用 `executeToolCallsInOrder` 前）增加 `evaluateToolCallLimit` 预检查与 `consecutiveToolCallLimitRetries` 计数：未超额清零并执行；零预算（`maxCalls===0`）超额直调 `executeToolCallsInOrder` 硬失败；正预算超额且重试未耗尽时发 `DEGRADATION_NOTICE(TOOL_CALL_LIMIT_EXCEEDED)` + `tool.loop.limit_recoverable` 日志 + 纠正消息后 `continue`；重试耗尽直调 `executeToolCallsInOrder` 硬失败。
  验证：`vitest run packages/agent-core/tests/tool-loop-readonly-fanout.test.ts`、`vitest run tests/agent-kernel/tool-loop.test.ts`
  来源：design 决策 6、7；spec 同上

- [x] 3.3 `default-agent.ts` 构造模型请求时，当 `maxCalls===0`（零工具预算）MUST 把 `tools` 置空（`{ ...rendered, tools: [] }`），使模型在请求层即无法看到工具；tool loop 零预算 guard 保留为防御性兜底。
  验证：`vitest run packages/agent-core/tests/routing-constraint-budget.test.ts`（断言 `model.stream` 收到 `tools: []`）
  来源：spec `tool loop 按工具危险性分级约束每轮 fan-out 并可恢复`（model-only 不披露工具）

## 4. characterization 测试更新

- [x] 4.1 更新 `tests/agent-kernel/tool-loop.test.ts` 的 "fails without partial capability execution when tool calls exceed the per-round limit"：6 个 `Read` 现处于只读上限 20 内，MUST 全执行（断言 `CAPABILITY_STARTED` 出现、不出现 `TOOL_CALL_LIMIT_EXCEEDED`）。
  验证：`vitest run tests/agent-kernel/tool-loop.test.ts`
  来源：spec `tool loop 按工具危险性分级约束每轮 fan-out 并可恢复`；AGENTS.md characterization 要求

- [x] 4.2 在 `tests/agent-kernel/tool-loop.test.ts` 新增 integration 场景：模型连续 4 轮每轮返回 21 个 `Read`（超过只读上限 20），断言前 3 轮零执行（无 `CAPABILITY_STARTED`）并出现 `TOOL_CALL_LIMIT_EXCEEDED`，第 4 轮以 `event: REQUEST_FAILED` 结束。
  验证：`vitest run tests/agent-kernel/tool-loop.test.ts`
  来源：design 决策 6；spec 同上

## 5. 新增单元测试

- [x] 5.1 新增 `packages/agent-core/tests/tool-loop-readonly-fanout.test.ts`，覆盖 `evaluateToolCallLimit` 纯函数：9 Read 不超额、21 Read 超额、6 Bash 超额、混批独立计数、`maxReadOnlyCalls===undefined` 走旧行为。
  验证：`vitest run packages/agent-core/tests/tool-loop-readonly-fanout.test.ts`
  来源：design 决策 3、5；spec 同上

- [x] 5.2 在同文件覆盖 `executeToolCallsInOrder` 传入 `maxReadOnlyCalls` 的行为：9 Read + `maxCalls=5/maxReadOnlyCalls=20` 全执行；21 Read 超额零执行并抛 `TOOL_CALL_LIMIT_EXCEEDED`；6 Bash 超额零执行；8 Read + 6 Bash 混批中副作用超额零执行（夹带不绕过）。
  验证：`vitest run packages/agent-core/tests/tool-loop-readonly-fanout.test.ts`
  来源：design 决策 3、5、6；spec 同上

## 6. 验证和收尾

- [x] 6.1 运行 push gate：build、test、contract、architecture 与 OpenSpec strict validation。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate refine-tool-loop-readonly-fanout --strict`
  来源：AGENTS.md 验证门禁；design 验证映射

- [x] 6.2 确认未触碰 frozen core contract、owner/agent scope、terminal lifecycle；`maxReadOnlyToolCalls` 未进入 `RoutingConstraints` schema；提交范围只含本 change 收敛内容。
  验证：`git diff --stat`；code review 检查点
  来源：proposal 非目标；design 非目标

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前：

- 同步 `openspec/specs/ts-minimal-agent-kernel/spec.md` 的 `最小 Capability Tool 集合` requirement（分级上限 + 可恢复语义）。
- 更新 `openspec/designs/modules/agent-core.md` 的 tool loop 落点。
- 更新 `openspec/designs/spec-to-design-map.md` 导航。
- 先归档 `refine-ts-tool-loop-fallback-round-limit`，再归档本 change。
