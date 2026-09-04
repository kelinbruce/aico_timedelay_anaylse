## Why

平台维护者使用 HarnessBench 报告判断 NextAgent 框架改进优先级时，需要能够区分框架效果得分、成功任务质量和失败任务的上游诊断分量。当前报告虽然保存了 `taskScore` 与原始评分分量，但没有同时给出带明确总体和字段来源的派生统计；人工分析因此可能把失败任务的 `combinedScore` 当成框架效果得分贡献，或在跨期比较时混用全部任务与成功任务总体。

同时，stream 等待阶段的多种已知失败会收敛为同一个 `STREAM_WAIT_FAILED`，维护者无法仅凭安全报告判断是 HTTP 响应失败、stream 在 terminal 前关闭，还是 transport 读取失败。这会把评测适配故障、provider 波动和潜在框架 terminal/stream 问题混为同一结论，阻碍后续把真正属于框架的优化交给正确 owner。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- JSON 与 Markdown 报告提供内容一致的计分摘要，每项统计明确总体、评分字段、任务数、分数和与框架效果得分的关系。
- 全部质量分档统计使用固定阈值和显式总体，禁止通过相互重叠的档位重复计数。
- 已知 stream 等待失败形成可行动的闭集原因码；只有无法归入已知条件的失败使用安全 fallback。
- 对 runtime 按既有 5 分钟 subscriber idle contract 正常关闭的 non-terminal stream，使用同一 accepted run 的 session cursor 续接，且不重置总等待预算。
- 提供固定的 stream 失败非计分回归入口，覆盖本次完整评测中出现该失败阶段的任务。

**非目标：**

- 不修改 HarnessBench task、oracle、rubric、grader 或评分公式。
- 不修改评测 task/terminal/model timeout，不新增 task、模型调用或 Capability 自动重试；同一 accepted run 的 stream cursor 续接不属于执行重试。
- 不修改 `packages/**`、产品默认 Agent、公共 API 或公共 contract。
- 不在缺少可重复证据时把 provider、runtime、terminal commit、stream transport 或 context policy 指定为失败根因。
- 不在本 change 中实现 088 的新循环终止策略或调整 Agent `maxTurns`。

## What Changes

- 将评测报告升级为新的机器可读版本，并新增两组不可混用的计分摘要：全部 `execute` task 的 `taskScore` 总体，以及 `terminalStatus=scored` task 的 `combinedScore` 总体。
- 为两组计分摘要分别输出固定且互斥的质量分档，Markdown 必须展示总体、评分字段和任务数，不得把原始 `combinedScore` 表述为失败 task 的框架效果得分贡献。
- 对携带合法 timeline sequence 的 non-terminal idle-close stream 按 cursor 续接；无法安全续接时，将已知 stream 等待失败区分为 HTTP 非成功响应、terminal 前关闭和 transport 失败。terminal 等待预算耗尽继续使用既有 `TASK_TIMED_OUT` terminal 语义。
- 新增固定、非计分的 stream 失败回归 profile，复用完整评测的候选执行、报告和安全诊断路径。

## Feature 影响（Features）

### 修改的 Feature

- `F-10.13 HarnessBench 能力评测`：平台维护者获得可直接比较且不会混用总体的计分统计，并可从安全原因码区分已知 stream 等待失败类型；Function 组成不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.13 HarnessBench 评测` → `specs/harnessbench-evaluation/spec.md`
  - 功能边界：报告新增显式总体的计分摘要和固定互斥分档；stream 等待阶段输出更精确的安全失败原因码；新增固定非计分回归入口。
  - 系统质量属性：审计/可追溯性、可测试性。
  - 映射说明：canonical spec；不触及 legacy spec。

## 影响范围（Impact）

- 报告消费者需要按新报告版本读取计分摘要；既有逐 task 原始评分分量、`taskScore` 和 `frameworkEffectScore` 的语义不变。
- HarnessBench 维护者可使用固定 profile 对 stream 失败进行真实模型回归，但该结果不能作为全量框架效果得分。
- 评测报告、stream 等待适配逻辑、类型声明、定向 profile、README 和相关测试受到被动影响。
- 本 change 以已完成的 `refine-harnessbench-scoring-denominator`、`harden-harnessbench-failure-diagnostics` 和 `refine-harnessbench-score-publication` 为目标态前置；归档时 MUST 先合并这些 change 的计分分母、schema v3 与 degraded 得分发布语义，再合并本 change，禁止从尚未刷新的 stable spec 恢复旧行为。
