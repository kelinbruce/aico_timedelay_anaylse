## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.13 HarnessBench 评测` | 固定提高候选模型的初始输出容量与单次调用时间上界 | `harnessbench-evaluation` | `FN-10.13 HarnessBench 评测` |

## `FN-10.13 HarnessBench 评测`

### 目标与规范依据

本设计只调整 HarnessBench candidate config，使标准全量与固定定向回归在相同、可复现的预算下评估复杂 task。NextAgent 产品模型配置与输出恢复行为保持不变。

#### 本 Function 的目标 Requirements

canonical spec：`harnessbench-evaluation`

- `ADDED`：`候选模型使用固定的基础输出预算`
- `ADDED`：`候选模型使用固定的单次调用超时`

### 当前实现

- `tests/harnessbench/evaluation-config.mjs` 以单一常量固定 `HARNESSBENCH_MODEL_MAX_OUTPUT_TOKENS=8192`。
- `tests/harnessbench/nextagent-cli.mjs` 的 candidate config 为模型固定写入该输出预算，并在同一位置固定 `timeoutMs=300000`。
- 标准全量与固定定向回归都经过同一个 candidate config builder，没有按 task 动态配置的分支。
- `packages/agent-model` 已把 provider `finish_reason=length` 归一为 `incompleteOutputReason=output-limit`；`packages/agent-core` 已按同一请求提升预算并有界恢复。2026-08-13 的 4 个 `MODEL_TIMEOUT` task 均先产生 `8192 tokens`、`finish_reason=length` 的成功调用，随后恢复调用恰好执行 `300000 ms` 并返回 `MODEL_TIMEOUT`。
- `harden-harnessbench-timeout-result-collection` 已将 terminal 等待预算固定为 `780 s`、generic CLI 子进程预算固定为 `900 s`，并为结果收集保留 `120 s`。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 初始输出预算固定为 `16384 tokens` | 当前固定为 `8192 tokens` | 复杂输出更容易先截断并触发额外恢复调用 |
| 单次模型调用超时固定为 `540 s` | 当前固定为 `300 s` | 已触发的恢复调用在 provider 尚未形成终态时被模型边界取消 |
| 所有评测 profile 使用同一预算 | 当前已复用同一 builder | 需要测试锁定新值并继续禁止 task-specific 分支 |
| 产品行为保持不变 | packages 已正确完成分类、恢复和超时映射 | 不存在需要由 packages 闭合的 GAP |

### 修改方案

唯一实现路径由 HarnessBench adapter 自身拥有：

1. 在 `tests/harnessbench/evaluation-config.mjs` 将固定的候选模型初始输出预算改为 `16384`，并新增同层固定常量 `HARNESSBENCH_MODEL_TIMEOUT_MS=540000`。两个值均属于评测配置，不读取环境变量，也不接受 task 覆盖。
2. `buildHarnessCandidateConfig()` 只引用上述两个常量生成 local runtime candidate config。标准全量与固定定向回归继续共用该 builder，不增加模型名、task id 或 task 类型分支。
3. 执行可靠性 contract test 从黑盒 config 输出断言 `maxOutputTokens=16384` 和 `timeoutMs=540000`，同时保留 `terminalTimeoutSeconds=780` 与 `taskTimeoutSeconds=900` 的现有断言，证明预算嵌套关系未被破坏。
4. 不修改 `packages/**`。初始预算增加后如仍出现 provider `length`，现有模型边界与 Core 恢复路径继续生效；单次调用达到 `540 s` 或更早收到 terminal 取消时，现有安全失败语义继续生效。

`540 s` 的选择保留了相对于 `780 s` terminal 预算的 `240 s` 余量，可容纳启动、前序 Tool round、context assembly 和 terminal commit；同时比历史 `300 s` 上限增加 80%。它不是 generic CLI 外层超时，不能替代 `780 s / 900 s` 分层预算。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 性能/容量 | `候选模型使用固定的基础输出预算` | 固定 `16384 tokens` 基础输出容量，不按 task 动态扩张；既有恢复契约仍可覆盖恢复调用预算 | config 输出值、所有 profile 共用路径、恢复覆盖不回归、token 成本说明 |
| 可靠性/恢复 | `候选模型使用固定的单次调用超时` | 固定 `540 s` 单次调用上界，继续服从 `780 s` terminal 与取消信号 | 预算嵌套、超时安全终态、既有恢复测试不回归 |
| 可测试性 | `候选模型使用固定的基础输出预算`、`候选模型使用固定的单次调用超时` | 由单一 candidate config builder 与 contract test 固定两项数值 | 禁止环境变量或 task-specific 覆盖、定向与全量一致 |

#### 备选方案（Alternatives Considered）

- 仅把 `maxOutputTokens` 调到 `16384`：减少首次截断，但输出规模增大可能使长调用更容易触及现有 `300 s`，不能闭合已观测的恢复超时。
- 将单次模型超时直接设为 `600 s` 或 `780 s`：可提供更多 provider 时间，但会压缩多轮 Tool 执行和 terminal commit 余量；`540 s` 在历史证据与 terminal 总预算之间保留更清晰的层级。
- 按复杂 task 动态调参：可能节省简单 task 成本，但会把历史分类或 task 内容引入评测策略，降低可复现性并扩大实现范围。
- 修改 packages 的恢复次数或超时语义：现有实现与规范一致，且日志证明失败是评测 profile 的显式预算生效；修改产品代码会混淆框架能力与评测条件。

## 验证策略（Verification Strategy）

- contract test 从生成的 candidate config 验证标准输出预算、单次模型超时以及与 terminal/generic CLI 预算的组合，不断言私有常量名称。
- HarnessBench 定向测试套件验证 config builder、运行入口、failure classification 和 P0 结果收集路径不回归。
- 现有 agent-model 与 agent-core 输出完整性测试作为 package 不变边界的 characterization 证据；只有这些测试或代码审查发现现有分类/恢复偏离规范时，才另建 package change。
- negative case 通过源码与 config contract 检查确认不存在环境变量、task id 或 task 类型对候选模型预算的覆盖入口。
- 新的真实评测运行用于验证收益和成本，不把预期 FES 增量作为代码完成条件。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/harnessbench-evaluation/spec.md`：合并候选模型固定评测调用预算 Requirement。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.3-测试与扩展/FN-10.13-HarnessBench评测.md`：在输入与规格中补充候选模型调用预算。
- `openspec/designs/features/D10-二次开发与平台集成/D10.3-测试与扩展/F-10.13-HarnessBench能力评测.md`：无；用户价值和 Function 组成不变。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/`：无；不改变架构边界。
- `openspec/designs/modules/`：无；不改变产品 package 职责。
- `openspec/designs/adr/`：无；不形成跨 Function 长期技术决策。
- `openspec/designs/spec-to-design-map.md`：补充候选预算的验证入口。

## 风险与取舍（Risks / Trade-offs）

- 每次调用允许的最大输出翻倍，极端情况下会增加模型成本；通过固定值、现有 total token 报告和下一次全量评测对比监控。
- `540 s` 仍不能保证所有 provider 调用完成；达到上限时继续使用现有 `MODEL_TIMEOUT`，不无限等待。
- 若一个 task 在较早轮次已消耗超过 `240 s`，后续单次调用仍可能先被 `780 s` terminal 截止取消；这是有界评测的预期行为，而不是将单次调用绝对保证为 `540 s`。

## 待确认问题（Open Questions）

无。
