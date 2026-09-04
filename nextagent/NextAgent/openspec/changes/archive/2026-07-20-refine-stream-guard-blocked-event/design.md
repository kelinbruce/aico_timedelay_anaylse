## 背景和现状

`add-ts-safety-guardrails` 的输出护栏需要向客户端流发送一个"本轮被拦截"的 terminal 信号。当前基线两处约束阻止直接实现：

- `ts-core-contracts` 冻结 `StreamEventType`，且 stream-derivation 规定客户端流只从 canonical timeline 或 runtime status 派生。
- `ts-web-sse-ws-transports` 规定 projection service 不得发明 transport-private stream event 名。

为绕开，`add-ts-safety-guardrails` 原计划走 `failRun`→run FAILED→`REQUEST_FAILED` 链路（复杂且语义不直观）；本 refinement 改为新增 `OUTPUT_GUARD_BLOCKED` 受控例外，使该 change 直接注入 terminal 事件 + 隐藏 assistant 消息（`visible=false`），不再使用 failRun 路线。

## 目标和非目标

**目标**：放宽契约边界，使输出护栏回到直观模型——guard proxy 在 guard-forward relay 流上注入 terminal `OUTPUT_GUARD_BLOCKED` 事件，前端收到即清空本轮。

**非目标**：不规定 guard proxy 回调拓扑（由 `add-ts-safety-guardrails` 决定）；不改动 runtime terminal commit 语义；不放宽除 `OUTPUT_GUARD_BLOCKED` 外的派生规则。

## 设计决策

### 决策 1：新增 `OUTPUT_GUARD_BLOCKED` 作为受控例外，而非重写 failRun 链路

加一个 terminal 事件 + 一个窄例外，比"failRun→run FAILED→REQUEST_FAILED 投影"链路简单一个量级，且语义直观（外部策略层拦截 → 拦截事件 → 前端清空）。例外被严格收口：仅 `OUTPUT_GUARD_BLOCKED` 一个事件、仅 guard-forward relay 路径、必须 terminal、必须经 `GuardrailGatewayPort`、不替代 runtime terminal 事实。

### 决策 2：`OUTPUT_GUARD_BLOCKED` 不替代 runtime terminal commit

guard 层注入的 `OUTPUT_GUARD_BLOCKED` 是对客户端流的 terminal 信号；run 的 canonical terminal 状态仍由 runtime 拥有（run 可能继续在 runtime 侧走到自己的 terminal，或被 cancel/failRun）。二者独立，避免 guard 事件污染 runtime terminal 真相。`add-ts-safety-guardrails` 决定是否在 guard 拦截后额外 cancel/failRun run（本 refinement 不强制）。

### 决策 3：例外写进 spec 而非仅 design

`ts-core-contracts` 的派生规则是 spec 级强约束。例外 MUST 在 spec 里以 ADDED requirement 写明适用范围与约束（AGENTS.md：例外必须文档化适用范围），不能只放 design。

## 质量属性设计

- **安全**：例外仅 `OUTPUT_GUARD_BLOCKED` + 仅 guard-forward relay + 必须经 `GuardrailGatewayPort`，防止外部任意注入。验证：contract 测试断言仅该事件可注入。
- **可维护性**：例外窄、约束明确，不破坏既有派生规则的其他场景。验证：现有 stream projection 测试不回归。
- **可测试性**：contract 测试枚举 `StreamEventType` 含 `OUTPUT_GUARD_BLOCKED`；guard-forward relay 注入后 terminal 语义。

## 验证映射

| 关键约束 | 验证入口 |
|---|---|
| `StreamEventType` 含 `OUTPUT_GUARD_BLOCKED` | contract 测试枚举断言 |
| 仅 `OUTPUT_GUARD_BLOCKED` 可由 guard relay 注入 | guard-forward relay 测试断言其他事件仍来自 timeline/runtime |
| `OUTPUT_GUARD_BLOCKED` terminal + 其后无增量 | relay 投影测试 |
| 不替代 runtime terminal 事实 | runtime terminal commit 测试不回归 |

## 风险与取舍

- [派生规则放宽] → 严格收口到单事件 + 单路径 + terminal，避免滥用。
- [guard 事件与 runtime terminal 并存] → 二者独立，`add-ts-safety-guardrails` 决定是否额外终止 run。

## 归档前更新基线（Baseline Promotion Plan）

- `specs/ts-core-contracts/spec.md`：合并 `OUTPUT_GUARD_BLOCKED` + guard-forward relay 例外 requirement。
- `specs/ts-web-sse-ws-transports/spec.md`：合并 projection service 例外 requirement。
- `designs/architecture/core-contracts.md`：`StreamEventType` 清单加 `OUTPUT_GUARD_BLOCKED`；stream-derivation 不变量补例外说明。
- `overview.md`、`designs/spec-to-design-map.md`：导航更新。

## 待确认问题

- `add-ts-safety-guardrails` 在 guard 拦截后是否仍需 cancel/failRun run（避免 run 在 runtime 侧继续跑）？本 refinement 不强制，留给 guardrail change 决定。
