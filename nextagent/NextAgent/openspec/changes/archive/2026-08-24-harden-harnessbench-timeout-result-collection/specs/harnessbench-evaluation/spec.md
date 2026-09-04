## Function

- **所属 Function**：`FN-10.13 HarnessBench 评测`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 任务执行为结果收集保留确定预算

系统 MUST 将标准全量与定向 profile 的 generic CLI 子进程预算固定为 `1200 s`，并将 NextAgent 已接受请求的 terminal 等待预算固定为 `1080 s`；从 terminal 等待预算结束到 generic CLI 子进程预算结束 MUST 保留恰好 `120 s`，用于 CLI runtime cleanup 和 workspace export。系统 MUST NOT 使用同一个截止时刻同时终止 terminal 等待和 generic CLI 子进程；oracle、rubric 和 upstream-result 落盘 MUST 在 generic CLI 子进程返回后继续执行。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: terminal 在内层预算内完成

- **WHEN** 一个 `execute` task 在提交后 `1080 s` 内形成 terminal result
- **THEN** 系统 MUST 在 generic CLI 子进程内继续完成 runtime cleanup 和 workspace export
- **AND** generic CLI 子进程 MUST 继续受 `1200 s` 确定上界约束
- **AND** generic CLI 子进程返回后，系统 MUST 继续执行 oracle、rubric 和 upstream-result 落盘

#### Scenario: terminal 达到内层预算

- **WHEN** 一个已接受请求等待 terminal result 达到 `1080 s`
- **THEN** 系统 MUST 取消该请求并形成结构化 terminal failure
- **AND** 系统 MUST 继续在剩余 `120 s` 预算内完成 CLI runtime cleanup 和 workspace export
- **AND** generic CLI 子进程返回后，系统 MUST 继续执行 oracle、rubric 和 upstream-result 落盘

### Requirement: 有效 upstream-result 优先于进程摘要

Python task 进程退出后，系统 MUST 读取与当前 task id 唯一匹配的 upstream-result；当该文件存在且是有效 JSON 时，系统 MUST 以该文件形成 task 结论，MUST NOT 因进程 stdout 摘要缺失、包含额外文本或无法解析而丢弃该结果。不存在有效 upstream-result 时，系统 MUST NOT 使用仅包含 CLI terminal envelope 的 sidecar 伪造 scored 结果。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: stdout 摘要无效但结果文件有效

- **WHEN** Python task 进程已经退出、stdout 不包含有效 JSON 摘要且当前 task 的 upstream-result 是有效 JSON
- **THEN** 系统 MUST 从 upstream-result 形成 task 结论
- **AND** task 的 usage、oracle、rubric 和评分 MUST 来自该 upstream-result

#### Scenario: 结果文件不存在

- **WHEN** Python task 进程已经退出且当前 task 不存在有效 upstream-result
- **THEN** 系统 MUST 形成 `harness_process` 失败
- **AND** 系统 MUST NOT 把 CLI terminal envelope 解释为 upstream-result

### Requirement: HarnessBench 进程失败使用闭集原因码

系统 MUST 为未形成有效 upstream-result 的 HarnessBench 进程失败输出唯一 `failurePhase=harness_process`，且 `failureReasonCode` MUST 是 `PROCESS_START_FAILED`、`PROCESS_NONZERO_EXIT`、`PROCESS_TIMEOUT`、`RESULT_SUMMARY_INVALID`、`RESULT_JSON_MISSING` 或 `RESULT_JSON_INVALID` 之一。系统 MUST NOT 在上述可判定条件下输出 `UNKNOWN`，且报告 MUST NOT 包含原始 stdout、stderr、prompt、模型输出、credential、token 或主机绝对路径。

**需求类别**：系统质量属性
**质量属性**：审计/可追溯性
**适用范围**：该 Function

#### Scenario: Python 进程非零退出且无结果

- **WHEN** Python task 进程以非零退出码结束且不存在有效 upstream-result
- **THEN** task MUST 以 `failureReasonCode=PROCESS_NONZERO_EXIT` 形成终态结论

#### Scenario: Python 进程被外层预算终止且无结果

- **WHEN** Python task 进程达到 `1200 s` 外层预算且不存在有效 upstream-result
- **THEN** task MUST 以 `failureReasonCode=PROCESS_TIMEOUT` 形成终态结论

#### Scenario: stdout 摘要无效且无结果

- **WHEN** Python task 进程以退出码 `0` 结束、stdout 不包含有效 JSON 摘要且不存在有效 upstream-result
- **THEN** task MUST 以 `failureReasonCode=RESULT_SUMMARY_INVALID` 形成终态结论

#### Scenario: upstream-result JSON 无效

- **WHEN** 当前 task 存在 upstream-result 文件但全部匹配文件都不是有效 JSON
- **THEN** task MUST 以 `failureReasonCode=RESULT_JSON_INVALID` 形成终态结论

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：系统以 `1080 s` terminal 等待和 `1200 s` generic CLI 子进程的分层预算执行 task，优先从有效 upstream-result 形成结论，并对不可恢复的进程失败输出闭集原因码。
- **依据 Requirements**：`任务执行为结果收集保留确定预算`、`有效 upstream-result 优先于进程摘要`、`HarnessBench 进程失败使用闭集原因码`

### 结果

- **变更类型**：修改
- **目标内容**：长耗时 task 在已形成有效 upstream-result 时不得因 stdout 摘要失败而丢失；未形成结果时提供安全且可行动的失败结论。
- **依据 Requirements**：`有效 upstream-result 优先于进程摘要`、`HarnessBench 进程失败使用闭集原因码`

### 规格

- **规格项**：HarnessBench 执行预算
- **变更类型**：修改
- **原规格值**：generic CLI adapter task 进程与 terminal 等待分别为 `600 s`
- **目标规格值**：每个 `execute` task 的 terminal 等待 `1080 s`、generic CLI 子进程 `1200 s`，CLI runtime cleanup 和 workspace export 余量恰好 `120 s`
- **依据 Requirements**：`任务执行为结果收集保留确定预算`
