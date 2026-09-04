## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-4.1 调用模型` | 精确识别可恢复的截断 Tool call，并在预算提升后对 reasoning-only `length` 结果做一次收敛重试 | `model-invocation-contract` | `FN-4.1 调用模型` |

本 change 不新增产品源码、测试或运行时目录层级。新增的 OpenSpec change 目录由 OpenSpec workflow 拥有，生命周期为 active 到 archive，对构建、打包和运行时无影响。

## `FN-4.1 调用模型`

### 目标与规范依据

系统只恢复具有精确截断证据的空 Tool-call 终态；预算提升后仍只有内部推理的 `length` 结果先获得一次收敛机会，再进入既有有界续写。

#### 本 Function 的目标 Requirements

canonical spec：`model-invocation-contract`

- `MODIFIED`：`Failure exits are explicit and safe`
- `MODIFIED`：`输出超限不得静默截断`

### 当前实现

`openai-compatible` provider 已能在 Tool-call JSON 因输出预算耗尽而无法形成完整调用时产生 `incompleteOutputReason="truncated-tool-call"`。`normalizeModelTerminalResult` 当前只要发现空 `finishReason="tool-calls"` 就生成 `MODEL_TOOL_CALLS_MISSING`，导致 Agent core 收不到截断证据。

Agent core 已有一次预算提升、request-local 续写和一次 reasoning-only correction。correction 只识别 `finishReason="stop"`；`length` 空产出只会在预算提升后继续普通续写。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 只有精确截断证据可进入恢复 | 模型边界无条件拒绝空 Tool-call 终态 | 可恢复结果被提前终止 |
| 语义不匹配的 incomplete 标记安全失败 | 只按是否存在 incomplete 标记区分会扩大放行范围 | `output-limit` 可错误绕过 Tool-call 安全校验 |
| 首次 `length` 先提升预算 | 既有流程已提供预算提升 | 保持不变 |
| 提升后 reasoning-only 先收敛一次 | correction 只覆盖 `stop` | 推理模型可能重复空转 |

### 修改方案

唯一实施路径如下：

1. `normalizeModelTerminalResult` 对 `finishReason="tool-calls"` 且无完整 Tool call 的结果，只在 `incompleteOutputReason==="truncated-tool-call"` 时保留 incomplete 终态；其他值均产生 non-retryable `MODEL_TOOL_CALLS_MISSING`。
2. `isReasoningOnlyStop` 同时识别 `stop` 和 `length`，但 `shouldCorrectReasoningOnly` 对 `length` 额外要求 `escalationAttempted=true`。因此首次 `length` 必然先进入既有预算提升。
3. 提升后仍为空 content、无 Tool call 且存在非空 reasoning 时，复用 `withReasoningOnlyCorrection` 注入一次 request-local 收敛指令，并设置既有 `reasoningCorrectionAttempted`。
4. correction 后仍返回 incomplete output 时，继续使用既有最多三次续写；不完整 Tool call、恢复耗尽和 cancellation 沿用既有失败路径。

不新增 parallel normalizer、provider 特判、恢复状态机或配置。`agent-model` 拥有终态归一化，`agent-core` 拥有 request-local 恢复生命周期。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `输出超限不得静默截断` | 预算提升后一次 correction，再复用三次续写上限 | 顺序、次数、耗尽和取消 |
| 安全 | `Failure exits are explicit and safe` | 仅精确 `truncated-tool-call` 证据可放行 | `output-limit` 和无标记负例 |
| 性能/容量 | `输出超限不得静默截断` | 不增加无界计数器，最多增加一次 correction 调用 | model round 内调用总数有界 |

## 验证策略

- model boundary：分别覆盖 `truncated-tool-call`、`output-limit` 和无标记的空 Tool-call 终态。
- Agent core：覆盖首次 `length` 只提升预算、提升后 reasoning-only 注入一次 correction、correction 后继续既有续写以及恢复耗尽。
- cancellation：确认 correction 或续写期间取消后不产生后续调用或 late output。
- 整体验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/model-invocation-contract/spec.md`：合并两个 MODIFIED Requirements。
- `openspec/designs/functions/D4-模型与上下文/D4.1-模型调用与降级/FN-4.1-调用模型.md`：更新处理过程、结果和“输出 Token 恢复”规格项。
- `openspec/overview.md`：仅在需要说明系统范围恢复不变量时提炼；否则无。
- `openspec/designs/architecture/`：无新增长期架构边界。
- `openspec/designs/modules/agent-model.md`、`openspec/designs/modules/agent-core.md`：更新终态归一化与恢复协作。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：更新验证入口。

## 风险与取舍（Risks / Trade-offs）

- correction 最多增加一次模型调用；它只在预算提升后仍有 reasoning 但无可交付输出时发生，收益高于直接进入相同消息续写。
- 只接受精确 `truncated-tool-call` 会拒绝语义不匹配的 provider 结果；这是 fail-closed 行为，不提供兼容性别名。

## 待确认问题（Open Questions）

无。
