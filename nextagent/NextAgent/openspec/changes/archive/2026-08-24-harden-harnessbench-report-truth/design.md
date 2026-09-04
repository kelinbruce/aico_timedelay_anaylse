## 设计范围

| Function | 目标变化 | Delta spec | 设计章节 |
|---|---|---|---|
| `FN-10.13 HarnessBench 评测` | 为计分报告增加显式总体的互斥统计，细分已知 stream 等待失败原因，并提供固定非计分回归入口 | `harnessbench-evaluation` | `FN-10.13 HarnessBench 评测` |

## FN-10.13 HarnessBench 评测

### 目标与规范依据

本 Function 必须让平台维护者从同一份安全报告中得到唯一可复算的框架效果统计、成功任务质量统计和可行动的 stream 等待失败结论，同时保持既有真实候选执行、评分公式与产品边界不变。

**本 Function 的目标 Requirements：**

- canonical spec：`harnessbench-evaluation`
- `ADDED`：`计分报告提供显式总体的互斥统计`
- `ADDED`：`stream 等待失败使用可行动的闭集原因码`
- `ADDED`：`stream 失败具有固定非计分回归入口`

### 当前实现

- `tests/harnessbench/report.mjs` 是 JSON 与 Markdown 报告的单一生成入口。`normalizeTaskResult` 已将非 `scored` task 的 `taskScore` 归零，`createEvaluationReport` 已使用 `taskScore` 计算 `frameworkEffectScore`，但报告没有输出带明确总体和评分字段的派生统计。
- Markdown 的逐 task 表只显示名为 `Score` 的 `taskScore`，不显示原始 `combinedScore`。人工扩展报告若从原始 task 分量另行统计，当前 artifact 无法直接提供可复用的总体与互斥分档。
- `tests/harnessbench/nextagent-cli.mjs` 在 `failurePhase=stream_wait` 时把没有嵌入原因码的异常统一映射为 `STREAM_WAIT_FAILED`。本地 terminal 等待计时器触发时，`waitForTerminal` 返回 `status=timed_out`，随后已通过 terminal 路径形成 `TASK_TIMED_OUT`。
- `tests/harnessbench/profiles` 已提供 timeout、terminal、infrastructure 和 failure-recovery 等非计分 profile，但没有恰好覆盖本次完整评测 stream 失败集合的 profile。
- `tests/harnessbench/**` 是该 Function 的唯一实现 owner；报告是私有测试 artifact，不进入产品 API 或 `agent-contracts`。
- 当前实现已经包含已完成 active change `refine-harnessbench-scoring-denominator`、`harden-harnessbench-failure-diagnostics` 和 `refine-harnessbench-score-publication` 的目标态；stable spec/Function/architecture 尚未全部归档刷新，因此本 design 以这些 change 与当前代码为实施基线。

### GAP 分析

| 目标 | 当前事实 | GAP |
|---|---|---|
| 框架效果与成功任务质量可独立复算 | 只有逐 task 字段和总 FES，没有明确总体的派生摘要 | 人工分析可混用 `taskScore`/`combinedScore` 或 execute/scored 总体 |
| 分档计数互斥 | 报告未提供 canonical 分档 | 人工报告可能把满分重复计入“卓越”并再次相加 |
| 已知 stream 失败可行动 | runtime 规格化的 5 分钟 subscriber idle close 被 adapter 当作失败，其他已知条件共享 `STREAM_WAIT_FAILED` fallback | 长任务被误报失败，且无法区分 HTTP、无法续接的 terminal 前关闭和 transport 失败 |
| 本次 stream 失败可重复回归 | 现有 profile 只覆盖子集或其他历史集合 | 缺少固定、非计分、同产品路径的八 task 回归入口 |

### 修改方案

#### 报告计分摘要

`report.mjs` 继续作为唯一报告 owner，不新增第二个分析脚本。`createEvaluationReport` 在完整计分运行中从已经规范化的 `reportTasks` 生成 `scoreSummaries`：

1. `frameworkEffect` 过滤 `supportStatus=execute`，仅读取 `taskScore`；其 `taskCount` 与 `scoringDenominator` 相同，`mean` 复用同一计算结果 `frameworkEffectScore`。
2. `scoredCombined` 过滤 `terminalStatus=scored` 且 `combinedScore` 合法的 task，仅读取 `combinedScore`。
3. 两组摘要都由同一个纯函数计算 `scoreSum`、`mean` 和五个互斥 `bands`。边界判断按 `1`、`[0.9,1)`、`[0.6,0.9)`、`[0.4,0.6)`、`[0,0.4)` 的固定顺序完成，每个分数只进入一个分支。
4. JSON 报告版本提升到 4。Markdown 只消费报告中的 `scoreSummaries`，不重新选择总体或计算分档，并把逐 task 列明确命名为 `Task score`；原始 `combinedScore` 仅以 `Upstream combined` 诊断列展示。
5. partial 与 `nonScoring` 报告不输出 `scoreSummaries`，防止定向运行的均值被解释为可比较的全量框架效果。

该路径保持 `frameworkEffectScore` 公式、失败归零、`scoringDenominator` 和评分覆盖发布规则不变。

#### stream 等待失败分类

`waitForTerminal` 保持一个覆盖完整 terminal 等待预算的本地 AbortController，不新增 task、模型调用或 Capability 重试，也不增加产品状态轮询。runtime 的稳定 contract 会在 subscriber 连续空闲 300000ms 后正常关闭连接，因此 adapter 对已经接收合法 timeline `sequence` 的 non-terminal stream 使用同一 `sessionId/runId` 和最高 `lastSeenSequence` 重新打开公开 stream；续接次数按总等待预算除以 300000ms 得到上界，且每次续接共享原始 deadline，不重置预算。无法获得合法 cursor，或在总预算允许的理论 idle-close 次数之外仍连续关闭时，才形成 `STREAM_CLOSED_WITHOUT_TERMINAL`。

| 可观察条件 | 失败阶段 | 原因码 |
|---|---|---|
| HTTP 响应非成功 | `stream_wait` | `STREAM_HTTP_FAILED` |
| HTTP 成功但响应结束时没有 terminal event，且没有合法 cursor 或已超出有界续接次数 | `stream_wait` | `STREAM_CLOSED_WITHOUT_TERMINAL` |
| fetch 或响应体读取抛出非本地预算异常 | `stream_wait` | `STREAM_TRANSPORT_FAILED` |
| 本地 terminal 等待计时器触发 | `terminal` | `TASK_TIMED_OUT` |

前三种失败条件直接抛出已有 `HarnessTaskFailure` 安全 envelope，使外层不再依赖异常 message 猜测原因码；异常正文和响应体不进入 envelope。合法 cursor 续接只恢复同一 accepted run 的 delivery，不重新提交请求或执行 task。预算耗尽继续取消已接受请求并返回 `timed_out`，由现有 terminal 映射负责。

#### 固定回归入口

在既有 `tests/harnessbench/profiles` 中增加 `stream-failure-regression.json`，仅声明规范固定的八个 task 和 `nonScoring=true`。`run.mjs` 继续通过通用 profile 路径校验 catalog、执行真实候选、运行 grader 并生成报告；不增加专用执行分支。

#### 明确不修改的边界

- 不修改 `packages/**`、`agent-contracts`、产品 stream/runtime 实现或默认 Agent。
- 不修改 task、oracle、rubric、grader、timeout、task/model/Capability 重试和 FES 公式。
- 不从本 change 的新原因码推导 provider 或框架根因；真实回归证据只作为后续 owner 评审输入。

#### 质量属性影响

- **审计/可追溯性**：依据 `计分报告提供显式总体的互斥统计` 和 `stream 等待失败使用可行动的闭集原因码`；验证 JSON/Markdown 同源、失败归零、互斥分档和安全原因码。
- **可测试性**：依据 `stream 失败具有固定非计分回归入口`；固定 profile 复用正式产品路径，单元测试使用本地 HTTP/SSE fixture 覆盖各失败条件。

## 验证策略

- spec 行为：使用 HarnessBench Vitest 测试构造包含 scored、failed 正向 `combinedScore` 和各阈值边界的完整报告，断言两组总体、FES、分档和 Markdown 一致。
- stream failure 行为：使用本地 HTTP server 分别触发带 sequence 的 idle-close 后 cursor 续接、非成功 HTTP、无法续接的无 terminal 关闭、transport 中断和本地预算耗尽；断言同一 run/cursor、共享预算、安全阶段与原因码，并验证预算耗尽仍走 terminal 语义。
- profile 边界：读取固定 profile，断言八个 task、`nonScoring=true`、catalog 合法且不发布 FES。
- design 边界：architecture 检查和代码审查确认没有 `packages/**`、private import、第二个报告 owner、task/model/Capability 自动重试或 timeout 变化。
- negative case：failed task 的正向 `combinedScore` 必须无法进入 `frameworkEffect` 总体；分数 `1` 必须无法同时进入 `perfect` 与 `excellent`。

## 长期基线刷新计划

归档前先归档 `refine-harnessbench-scoring-denominator`、`harden-harnessbench-failure-diagnostics` 和 `refine-harnessbench-score-publication`，或在同一次设计同步中先按该顺序合并其目标态；随后再合并本 change，避免旧 stable 文本覆盖当前实现。

- stable spec：归档前把三个新增 Requirements 合并到 `openspec/specs/harnessbench-evaluation/spec.md`，并保留 `FN-10.13` 元数据。
- Function：刷新 `FN-10.13 HarnessBench 评测` 的输出、处理过程和报告/原因码/profile 规格。
- Feature：刷新 `F-10.13 HarnessBench 能力评测` 的可依赖报告质量保证。
- overview：无。
- architecture：刷新 `openspec/designs/architecture/e2e-quality-gates.md` 的报告版本、统计和失败诊断说明。
- modules：`agent-test-kit` 的非职责边界不变，无正文变化。
- ADR：无。
- spec-to-design-map：现有映射和验证入口不变，无正文变化。

## 风险与取舍

- 报告 schema version 4 会要求机器消费者显式升级。通过保留既有顶层字段和逐 task 字段、只新增 `scoreSummaries` 降低迁移风险；不提供双版本写入，避免两个报告事实源。
- 更细原因码提高定位精度但仍不能证明根因 owner。报告只陈述 stream 边界的可观察条件，框架优化必须等待真实回归和运行诊断证据。
- 固定八 task 回归成本较高，因此保持按需、真实模型、非计分，不进入默认 gate。

## 2026-08-17 运行证据与 `packages/**` 评审候选

本 change 实施时复核本地完整运行 `2026-08-17T22-00-32-816Z-97b4e308` 的安全报告、usage 汇总和 operational event 计数，得到以下 owner 结论：

| 结论 | 证据 | 唯一 owner / 拟改范围 | 黑盒预期与验证 |
|---|---|---|---|
| P0 stream cluster 首要修复属于 HarnessBench adapter，不属于产品 package | 八个 `STREAM_WAIT_FAILED` 均在最后一次 model/capability/pending-input 活动后约 300 秒关闭；全部 32 次上游模型响应均为 HTTP 200；300 秒与 stable `subscriberIdleTimeoutMs` 一致 | 本 change 已授权的 `tests/harnessbench/nextagent-cli.mjs` 与 `workspace-bridge.mjs` | 同一 accepted run 以最高 cursor 续接后得到 terminal，且 task/model/Capability 只执行一次；本地 SSE fixture 与固定八 task profile 验证 |
| 078 pending-input 路径需要 package characterization，当前证据不足以直接修改 | operational evidence 在 `USER_INPUT_REQUIRED` 对应活动后约 305 秒关闭；现有 runtime 代码声明 pending input 应豁免 idle timeout，但尚未证明该 timeline event 是否到达同一 filtered subscriber | **待用户评审**：`agent-runtime`；候选文件 `packages/agent-runtime/src/lifecycle/submit.ts`、`packages/agent-runtime/tests/stream-idle-timeout.test.ts` | 先增加 filtered run stream 的黑盒 characterization：接收 `USER_INPUT_REQUIRED` 后推进虚拟时钟超过 300 秒仍不关闭；只有复现失败才提出最小修复 |
| 088 收敛提示属于 package 策略候选，不在本 change 实施 | task 使用 51 次 runtime model invocation（50 个 tool-call turn + 1 finalizing turn），59 次 Capability 调用、12 次 Tool failure feedback，完整耗尽 `maxTurns=50` 后才 final stop；不是无限循环或 transport 故障 | **待用户评审**：`agent-core`（loop/orchestration owner）；候选文件 `packages/agent-core/src/agent/default-agent.ts` 及对应黑盒 loop tests | 先定义 OpenSpec：连续失败或剩余 turn 的 runtime-owned 收敛反馈如何进入既有 request-local model patch；验证不改变 `maxTurns`、正常 tool loop、finalizing 与恢复语义，并用 088 profile 观察请求数和 outcome |

031/070/092 的高 process/低 outcome 以及 103-106 的领域弱项目前只有评分相关性，没有共同 package 级因果证据；在 oracle/artifact 差异分析前不创建 package 改动候选。

## 待确认问题

078 pending-input characterization 与 088 收敛策略是否进入新的 OpenSpec change，等待用户评审；本 change 不修改 `packages/**`。
