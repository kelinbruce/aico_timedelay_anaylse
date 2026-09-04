## Why

HarnessBench 运维人员在 2026-08-13 全量评测中观察到 29 个 task 的模型输出达到固定的 `8192 tokens` 上限。其中 4 个 task 在收到 `finish_reason=length` 后进入既有输出恢复流程，但恢复调用恰好在 `300 s` 单次模型调用上限失败，最终形成 `MODEL_TIMEOUT`。这使复杂 task 的完成度和评测可比性受评测 profile 预算限制影响，而不是单纯反映 NextAgent 的框架能力。

当前证据同时表明：模型边界已经正确识别输出超限、发起有界恢复并把真实超时映射为 `MODEL_TIMEOUT`；问题位于 HarnessBench 候选模型的固定评测预算。应在下一次全量评测前收敛该预算，避免修改产品运行时行为来适配评测。

### 规范上下文

| 上下文 | 固定值 |
|---|---|
| 适用 profile | 标准全量 profile 与固定定向回归 profile |
| 候选模型 profile 基础输出预算 | `16384 tokens` |
| 候选模型单次调用超时 | `540 s` |
| 已接受请求 terminal 等待预算 | `780 s` |
| generic CLI 子进程预算 | `900 s` |

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 每个 HarnessBench task 从 candidate profile 获得 `16384 tokens` 基础输出预算，减少因基础 `8192 tokens` 截断而触发的额外恢复调用。
- 单次候选模型调用最多等待 `540 s`，使合法的长输出调用可在 `780 s` terminal 总预算内完成，并继续受 terminal 取消约束。
- 标准全量和固定定向回归使用同一组固定候选模型预算，使不同运行的结果可复现、可比较。

**非目标：**

- 不改变 NextAgent 产品 profile、公共模型契约、输出超限分类、恢复次数、预算提升算法或 `MODEL_TIMEOUT` 语义。
- 不按 task id、task 类型或历史分数动态分配模型预算。
- 不承诺本次预算调整必然提升 `frameworkEffectScore`；收益必须由新的计分运行验证。
- 不再调整已由 `harden-harnessbench-timeout-result-collection` 定义的 `780 s` terminal 与 `900 s` generic CLI 子进程预算。

## What Changes

- 修改 HarnessBench candidate profile 的固定基础输出预算：从 `8192 tokens` 提升到 `16384 tokens`；既有输出恢复流程仍可按产品契约覆盖单次恢复调用的输出预算。
- 修改 HarnessBench 候选模型的固定单次调用超时：从 `300 s` 提升到 `540 s`。
- 标准全量与固定定向回归 MUST 使用相同固定值；运行入口不得按 task 动态改写这两个值。
- 保持 NextAgent 产品代码和公共契约不变；评测继续通过真实 local runtime 与真实模型链路执行。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.13 HarnessBench 评测` → `specs/harnessbench-evaluation/spec.md`
  - 功能边界：修改计分运行与定向回归中候选模型的固定输出容量和单次调用时间上界，不改变任务输入、评分、报告或失败语义。
  - 系统质量属性：性能/容量、可靠性/恢复、可测试性。
  - 映射说明：canonical spec。

## 影响范围（Impact）

- 运维人员需要为单个复杂 task 预留更高的模型输出 token 成本与最长 `540 s` 的单次调用时间。
- HarnessBench candidate config、执行可靠性 contract test 和评测说明文档受影响。
- `packages/**`、前端、公共 API、持久化、模型 provider adapter 和 Agent Core 恢复编排不受影响。
