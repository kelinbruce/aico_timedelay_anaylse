# Design: 按工具危险性分级放宽 tool loop 每轮 fan-out 并改为可恢复

## 背景和现状（Context）

`packages/agent-core/src/tools/tool-loop.ts` 的 `executeToolCallsInOrder` 在入口对整批 tool call 做统一上限检查（`toolCalls.length > maxCalls`），`maxCalls` 由 `RoutingConstraintGovernor` 产出，默认 5、schema 上限 5（`packages/agent-contracts/src/runtime/index.ts` `RoutingConstraintsSchema.maxToolCalls`）。超额即抛 `TOOL_CALL_LIMIT_EXCEEDED`（`retryable: false`），整轮零执行并以 `REQUEST_FAILED` 终态结束。

`openspec/changes/archive/2026-06-27-support-parallel-tool-calls` 已让同轮 ordinary tool call 受控并行、按模型顺序回填结果，但每轮 count 上限仍是统一的 5。该不变量把只读调用与副作用调用一视同仁，频繁误杀合法的并行只读信息收集（例如一轮 9 个 `Read`）。

## 目标和非目标（Goals / Non-Goals）

见 proposal。补充实现层非目标：不引入跨 request/run 的全局 worker pool；不改变 ordinary batch 的 prepare/invoke/finalize 三阶段与 `Promise.allSettled` 等待语义；不改变 `executeToolCallsInOrder` 对直调方（不传 `maxReadOnlyCalls`）的既有行为。

## 设计决策（Decisions）

1. **唯一实现路径：在 `agent-core` tool loop 与 governor 内做分级上限 + 可恢复重试。** 不新增 capability contract，不让 runtime/channel 参与分级。

2. **只读分类用 runtime-owned 静态白名单，不读 descriptor 元数据。** `READONLY_CAPABILITY_IDS = { Read, Grep, Glob }`。理由：只读性是安全相关信任属性，必须 runtime 拥有，不能由模型或 capability provider 断言；静态白名单是最小、可审计的机制。未来若需扩展为 descriptor 元数据，另立 change。白名单大小写敏感、按 capability id 精确匹配。

3. **两类上限独立计数。** 每轮把 tool call 分为 read-only 与 side-effecting 两类，分别比对 `maxReadOnlyToolCallsPerRound`（默认 20、上限 20）与 `maxToolCallsPerRound`（默认 5、上限 5）。任一类超上限即判超额。`Read` 不会占用 `maxToolCalls` 预算，副作用工具也不会占用 `maxReadOnlyToolCalls` 预算（防"夹带"：副作用工具无法藏入只读预算）。每类的逐个 `forbiddenCapabilityIds` / risk policy / sandbox 校验不变，count 上限是其上的 fan-out 纵深防御。

4. **`maxReadOnlyToolCalls` 由 governor 产出，不进入 `RoutingConstraints` schema。** `RoutingConstraintGovernor.govern(context, defaultMaxToolCalls, defaultMaxReadOnlyToolCalls=20)` 新增返回 `maxReadOnlyToolCalls`：`executionMode==="model-only"` 或 `constraints.maxToolCalls===0` 时两类上限同时为 0；否则 `maxReadOnlyToolCalls=defaultMaxReadOnlyToolCalls`（clamp 到 [0,20]）。`maxToolCalls` 语义从"全批总数"收敛为"副作用工具数"。不新增 routing constraint 字段，避免扩大 request-carried 治理面；只读上限作为 `DefaultAgent` 依赖注入。

5. **直调方向后兼容。** `executeToolCallsInOrder` 入参加 `maxReadOnlyCalls?: number`。未提供时维持旧行为：`toolCalls.length > maxCalls` 即抛 `TOOL_CALL_LIMIT_EXCEEDED`，分类不生效。提供时改用 `evaluateToolCallLimit` 的 per-class 判定。新增导出 `evaluateToolCallLimit`、`isReadOnlyCapability` 供 `DefaultAgent` 主路径预检查复用。

6. **超额处理在 `DefaultAgent` 主路径预检查，零预算硬失败、正预算可恢复。** 主路径（模型 round 产生 tool calls 后、调用 `executeToolCallsInOrder` 前）先 `evaluateToolCallLimit`：
   - 未超额：清零 `consecutiveToolCallLimitRetries`，正常调用 `executeToolCallsInOrder` 执行。
   - 超额且 `maxCalls===0`（零预算，即 `model-only` / 显式 `maxToolCalls=0`）：直接调用 `executeToolCallsInOrder`，由其既有 guard 发布 `DEGRADATION_NOTICE(TOOL_CALL_LIMIT_EXCEEDED)` 并抛错 → safe `REQUEST_FAILED`。零预算下重试无意义（模型无法在该 request 内合法调用任何工具），故硬失败。
   - 超额且 `maxCalls>0` 且 `consecutiveToolCallLimitRetries < toolCallLimitRecoveryLimit(=3)`：`consecutiveToolCallLimitRetries++`，发布 `DEGRADATION_NOTICE(TOOL_CALL_LIMIT_EXCEEDED)`，追加一条 model-visible 纠正 `USER` 消息，`continue` 重新进入模型 round。该轮不调用 `executeToolCallsInOrder`、不持久化 assistant tool-use 消息、不执行任何工具（不变量保留）。
   - 超额且 `maxCalls>0` 且重试耗尽：直接调用 `executeToolCallsInOrder` → 既有 guard 抛 `TOOL_CALL_LIMIT_EXCEEDED` → safe `REQUEST_FAILED`。
   - `BEFORE_CAPABILITY_INVOKE` 恢复路径与 terminal hook 路径不预检查，继续走 `executeToolCallsInOrder` 既有 guard（受信来源，不恢复）。

7. **纠正消息为 model-visible `USER` 消息，不持久化 orphan tool-use。** 超额轮跳过 `appendAssistantToolUseMessage`，仅追加 `role=USER`、`visible=true`、`metadata.kind=TOOL_CALL_LIMIT_CORRECTION` 的纠正消息，内容包含实际各类计数与各类上限，指示模型重新分发不多于上限的调用、其余延后。这样保留 tool_use/tool_result 配对不变量。`consecutiveToolCallLimitRetries` 在任意一轮正常执行后清零，允许后续轮次再次触发恢复。

8. **常量集中。** `minimalToolLoopLimits` 增加 `maxReadOnlyToolCallsPerRound: 20`、`toolCallLimitRecoveryLimit: 3`。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 只读性由 runtime 静态白名单决定，模型/provider 不可断言；副作用工具不占只读预算（防夹带）；逐个 forbidden/risk/sandbox 校验不变；超额轮零执行；零预算硬失败。 | unit: 副作用超额不执行、混批夹带不绕过、model-only 零执行；`npm run lint:architecture` |
| 性能/容量 | 只读 fan-out 上限 20（服务端成本/DoS 护栏，非无限）；副作用仍 5；恢复重试上限 3 轮，避免无限循环。 | unit: 9 Read 全执行、21 Read 触发恢复；integration: 持续超额 3 轮后 REQUEST_FAILED |
| 可靠性/恢复 | 正预算超额可恢复（纠正 + 重入），连续 3 次才失败；零预算与受信路径维持既有硬失败；tool_use/tool_result 配对不变量保留。 | unit/integration: 恢复后正常执行并清零计数；`npm test` |
| 可维护性 | 变更集中在 `tool-loop.ts`、`routing-constraint-governor.ts`、`default-agent.ts`；导出 `evaluateToolCallLimit` 复用；不新增 contract/包。 | `npm run lint:architecture`、code review |
| 可测试性 | `evaluateToolCallLimit` 为纯函数；恢复路径用 modelSteps 多轮驱动。 | `vitest run packages/agent-core/tests/tool-loop-readonly-fanout.test.ts`、`tests/agent-kernel/tool-loop.test.ts` |
| 审计/可追溯性 | 沿用既有 `tool.loop.limit_exceeded` 与 `DEGRADATION_NOTICE(TOOL_CALL_LIMIT_EXCEEDED)`；恢复轮额外发 `tool.loop.limit_recoverable`。不新增 event vocabulary 主体，仅增 recoverable 子事件。 | unit/integration 断言 event |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 只读 9 个 Read 在 maxCalls=5 下全执行 | 5.2 | `vitest run packages/agent-core/tests/tool-loop-readonly-fanout.test.ts` |
| 只读 21 个超过 20 触发恢复、零执行 | 5.2 | 同上 |
| 副作用 6 个超过 5 触发恢复、零执行 | 5.2 | 同上 |
| 混批中副作用工具不占只读预算 | 5.2 | 同上 |
| model-only / maxCalls=0 硬失败、零执行 | 5.1, 5.3 | `vitest run packages/agent-core/tests/routing-constraint-budget.test.ts`、`tests/agent-kernel/tool-loop.test.ts` |
| 连续超额 3 轮后 safe REQUEST_FAILED | 5.3 | `tests/agent-kernel/tool-loop.test.ts` |
| 恢复后正常执行并清零计数 | 5.2 | `vitest run packages/agent-core/tests/tool-loop-readonly-fanout.test.ts` |
| 直调 `executeToolCallsInOrder`（不传 maxReadOnlyCalls）行为不变 | 5.4 | `vitest run packages/agent-core/tests/parallel-tool-loop.test.ts`、`tests/agent-kernel/capability-governance.test.ts` |
| OpenSpec 与架构边界有效 | 5.5 | `openspec validate refine-tool-loop-readonly-fanout --strict`、`npm run lint:architecture` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-minimal-agent-kernel/spec.md` 主承载分级上限、零预算硬失败、正预算可恢复与只读白名单语义。
- 模块设计：`openspec/designs/modules/agent-core.md` 主承载 tool loop 分级上限、governor 产出 `maxReadOnlyToolCalls`、`READONLY_CAPABILITY_IDS` 与恢复重试落点。
- 导航：`openspec/designs/spec-to-design-map.md`。
- ADR：无（取舍已在 design 决策 2/4 记录）。

## 风险与取舍（Risks / Trade-offs）

- [风险] 只读白名单硬编码可能漏判新只读工具。 -> 白名单 runtime-owned、可审计；新只读工具需显式登记，避免模型/provider 误判。未来可迁移到 descriptor 元数据。
- [风险] `maxToolCalls` 语义从"全批总数"变为"副作用数"，调用方若依赖旧语义可能预期不符。 -> governor 在 `maxToolCalls=0` 时仍把只读上限也置 0，保留"零工具"语义；文档与 spec 显式说明语义收敛。
- [风险] 恢复重试可能被持续超额的模型拖到 3 轮才失败，增加成本。 -> `toolCallLimitRecoveryLimit=3` 硬上限；每轮零执行，仅多 3 次模型调用。
- [取舍] 不把 `maxReadOnlyToolCalls` 暴露为 routing constraint。 -> 调用方无法逐 request 收紧只读 fan-out；当前默认 20 已兼顾成本，逐 request 收紧另立 change。

## 迁移计划（Migration Plan）

无数据迁移。回滚方式：恢复 `tool-loop.ts` 统一上限检查与 `default-agent.ts` 主路径直调 `executeToolCallsInOrder`，同时保留本 change 未归档状态以便重设计。

## 待确认问题（Open Questions）

无。
