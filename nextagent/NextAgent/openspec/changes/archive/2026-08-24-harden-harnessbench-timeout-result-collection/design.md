## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.13 HarnessBench 评测` | 为长耗时 task 保留结果收集预算，以结果文件恢复结论，并输出精确进程失败码 | `harnessbench-evaluation` | `FN-10.13 HarnessBench 评测` |

## `FN-10.13 HarnessBench 评测`

### 目标与规范依据

本设计使标准评测在确定总预算内优先保全已经形成的 HarnessBench upstream-result，并把不可恢复的进程失败收敛为安全闭集原因码；08-14 证据触发的预算修订只扩大 task 与 terminal 窗口，评分、单次模型调用和上游基线保持不变。

#### 本 Function 的目标 Requirements

canonical spec：`harnessbench-evaluation`

- `ADDED`：`任务执行为结果收集保留确定预算`
- `ADDED`：`有效 upstream-result 优先于进程摘要`
- `ADDED`：`HarnessBench 进程失败使用闭集原因码`

### 当前实现

- 当前 `full-suite.json` 已提供 `taskTimeoutSeconds=900` 与 `terminalTimeoutSeconds=780`，并保留 `120 s` 结果收集余量。08-14 完整评测仍有 7 个复杂 task 达到该上界，其中 5 个已形成正向 upstream score 或高过程分。
- 固定上游 generic CLI adapter 使用 `subprocess.run(..., timeout=ctx.timeout_sec)`。`TimeoutExpired` 会跳出上游 runner，导致 oracle、rubric 和 upstream-result 写入均不执行。
- 本地 `runHarnessTask` 先要求 Python 子进程退出码为 `0` 并成功解析 stdout 最后一个 JSON，再读取 upstream-result。stdout 摘要失败时，即使结果文件已经存在也无法恢复。
- Python 子进程非零退出被包装为无结构普通 Error，attempt ledger 和报告回落到 `harness_process/UNKNOWN`。
- `readHarnessTaskResult` 已能在结果目录递归读取 task JSON，但读取发生得过晚，且多匹配排序使用字符串而不是数值。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 外层 `1200 s`、terminal `1080 s`、收集余量 `120 s` | 已有 `900/780/120 s` 分层预算，但 08-14 有 7 个复杂 task 达到上界 | 两层关系正确，窗口需按已观测长耗时任务扩大 `300 s` |
| 有效 upstream-result 优先 | stdout 解析成功是读取结果文件的前置条件 | 结果恢复顺序相反 |
| 已知进程失败使用闭集原因码 | 非零退出和摘要解析失败形成普通 Error | 缺少边界错误分类和安全映射 |
| 不修改固定上游 | 上游不捕获 `TimeoutExpired` | 必须由本地预算分层避免常规竞争，并在本地边界分类剩余失败 |

### 修改方案

唯一实施路径如下：

1. profile 将 `taskTimeoutSeconds` 定义为 Python generic CLI adapter 启动的 NextAgent CLI 子进程预算 `1200 s`，并将 `terminalTimeoutSeconds` 定义为 `1080 s`。preflight 继续校验两个值均为 `1..1800` 的整数，且 `taskTimeoutSeconds - terminalTimeoutSeconds` 必须恰好为 `120`。
2. `buildHarnessConfig` 将外层值写入 `timeout_sec`，只把内层值转换为 `--timeout-ms`。run manifest 同时记录两者，保证评测事实可追溯。
3. 本地 HarnessBench `run-task` 进程执行边界不再把退出码和 stdout 解析耦合到一个 Promise：边界返回 `{ exitCode, stdout, stderr }`；只有启动失败或 abort 直接抛出结构化错误。
4. `runHarnessTask` 在进程关闭后首先调用 `readHarnessTaskResult`。存在有效结果时，以结果文件为权威输入，stdout JSON 仅作为可选 summary 合并；进程退出码不再覆盖已经落盘的结果。
5. 仓内 `harness-task-wrapper.py` 是本地 runner 启动上游 `harnessbench.cli run-task` 的唯一 Python 入口。wrapper 直接调用上游 `main()`，只捕获 `subprocess.TimeoutExpired` 并向 stdout 输出 `{ "ok": false, "failurePhase": "harness_process", "failureReasonCode": "PROCESS_TIMEOUT" }`；其他异常保持非零退出。wrapper 不读取或写入评分，不修改上游 checkout。
6. 无有效结果时按固定优先级分类：外部 abort → 既有取消语义；启动失败 → `PROCESS_START_FAILED`；upstream-result 文件存在但全部 JSON 无效 → `RESULT_JSON_INVALID`；wrapper 的安全 timeout summary → `PROCESS_TIMEOUT`；非零退出 → `PROCESS_NONZERO_EXIT`；退出码 `0` 且摘要无效 → `RESULT_SUMMARY_INVALID`；摘要有效但结果缺失 → `RESULT_JSON_MISSING`。本 change 不通过字符串扫描 stderr 猜测 timeout。
7. `readHarnessTaskResult` 对 JSON 缺失和 JSON 无效使用不同内部错误，但报告只投影闭集字段，不投影文件路径或原文。
8. 固定 `timeout-budget-regression` 非计分 profile 覆盖 08-14 的 7 个 `TASK_TIMED_OUT` task，以及 037、041 两个在恢复调用期间耗尽 terminal 窗口的 task；它复用正式 `1200/1080/120 s` 路径，用于下一轮 A/B 证据，不发布 `frameworkEffectScore`。

保留现有 `classifyUpstreamTaskResult`、模型证据、评分、重试和报告聚合路径。实现不修改上游 cache、不增加 sidecar 公共契约、不修改 `packages/**`。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `任务执行为结果收集保留确定预算`、`有效 upstream-result 优先于进程摘要` | 独立分层预算和 result-first 恢复顺序 | 边界预算、stdout 无效但结果有效、结果缺失 |
| 可测试性 | `任务执行为结果收集保留确定预算` | 无凭据配置和进程 fixture 测试 | 不启动真实模型也能覆盖全部分支 |
| 审计/可追溯性 | `HarnessBench 进程失败使用闭集原因码` | 结构化边界错误与安全闭集映射 | known failure 不得回落 `UNKNOWN`，不得泄露原文 |

#### 备选方案（Alternatives Considered）

- 修改固定上游 `generic_cli.py` 捕获 `TimeoutExpired`：可以在上游直接落盘，但会污染固定评测基线并使 NextAgent 评测不可复现，因此不选择。
- 由 CLI 写 scored-result sidecar：CLI 不拥有 oracle 和 rubric，无法形成真实 HarnessBench upstream-result，因此只会伪造评分边界，不选择。
- 把两层预算都提高到 `1200 s`：仍然没有收尾余量，会把相同竞争延后而非消除，不选择。

## 验证策略（Verification Strategy）

- unit/contract 测试验证 profile 与生成配置中的 `1200/1080/120` 关系以及非法预算组合拒绝。
- integration-style 进程 fixture 验证 stdout 无效但 upstream-result 有效时恢复、非零退出但结果有效时恢复、无结果时的闭集失败码。
- negative tests 验证 CLI terminal envelope 不能替代 upstream-result、已知失败不回落 `UNKNOWN`、错误不包含 stdout/stderr 原文。
- 全量 HarnessBench 自动化测试与 OpenSpec strict validation 验证既有评分、模型证据、报告和架构边界无回归；`timeout-budget-regression` 用于后续真实模型定向非计分验证。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/harnessbench-evaluation/spec.md`：合并三个新增 Requirements，并把分层预算目标态更新为 `1200 s` 外层、`1080 s` terminal 和 `120 s` 结果收集余量。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.3-测试与扩展/FN-10.13-HarnessBench评测.md`：刷新处理过程、结果和执行预算规格。
- Feature：无。
- `openspec/overview.md`：无。
- architecture：无。
- modules：无。
- ADR：无。
- `openspec/designs/spec-to-design-map.md`：无导航变化。

## 风险与取舍（Risks / Trade-offs）

- 相对 08-14 配置，全量运行在无法终止的 task 上最多多等待 `300 s`；通过 `1200 s` 硬上界控制容量风险。
- 固定上游仍不捕获自身 `TimeoutExpired`；通过 `120 s` 预算隔离避免常规路径触发，剩余异常由本地闭集诊断暴露。
- 结果文件可能在进程退出前处于写入中；本地仅在进程关闭后读取，避免读取半写文件。

## 待确认问题（Open Questions）

无。
