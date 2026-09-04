## Function

- **所属 Function**：`FN-11.1 恢复运行状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Local Runtime 启动必须执行 bounded recovery pass

每个 Agent-bound Runtime 启动后 MUST 在 scheduler dispatch 新 work 前执行一次 bounded recovery pass。该 pass MUST 使用由可信 app composition 确定的当前 `agentId` 发现候选，并使用 durable `RequestRun`、checkpoint、message、timeline 和 terminal commit facts 作为恢复依据；process-local scheduler queue、execution handle、lane map 或内存 context MUST NOT 被视为恢复事实来源。

Server listen 和 server readiness MUST NOT 等待该 recovery pass 完成。recovery pass 运行期间，通过既有请求验收条件的新请求 MUST 被接受为 pending work，但 MUST NOT 进入 execution path，直到当前可信 Agent 下 queued、executing 和 terminal-pending durable runs 已完成分类和必要的 claim，或 recovery pass 已以完成/降级终态结束。recovery pass 结束后，pending work 和已恢复的 queued work MUST 交由既有 scheduler path 处理。

Recovery discovery MUST 只扫描当前应用绑定 Agent 下的 runs，同时覆盖该 Agent 下所有 tenant/subject owner scopes。`agentId` MUST NOT 来自 Web request、client metadata、model output 或 capability parameters。同一 Agent 存在多个实例时，只有取得 durable claim lease 的实例可以恢复会重新执行的 run；本 capability 不声明 distributed consensus、shared worker registry 或 non-sticky routing。

**需求类别**：功能性需求

#### Scenario: Server readiness 可以先于 recovery 完成

- **GIVEN** Agent-bound Runtime 已完成启动装配并存在尚未分类的 recoverable runs
- **WHEN** server readiness 检查发生
- **THEN** server listen 和 readiness MUST 成功
- **AND** recovery pass MUST 继续在后台执行
- **AND** Runtime MUST NOT 因 recovery pass 未完成而拒绝请求或返回启动不可用

#### Scenario: Recovery 在 startup 时 gate scheduler dispatch

- **GIVEN** recovery pass 尚未完成分类和必要的 claim
- **WHEN** 一个通过既有验收条件的新请求到达
- **THEN** Runtime MUST 接受并保留该请求为 pending work
- **AND** Runtime MUST NOT dispatch 该请求进入 execution path
- **AND** Runtime MUST NOT 让该请求与尚未 claim/classify 的 recoverable work 并行执行

#### Scenario: Recovery 结束后恢复调度

- **GIVEN** recovery pass 已经进入完成或降级终态
- **WHEN** pending work 或已恢复的 queued work 存在
- **THEN** Runtime MUST 交由既有 scheduler path 处理
- **AND** Runtime MUST 保持 same-session lane、Agent Scope、Owner Scope 和 idempotency constraints

#### Scenario: Recovery 失败不阻塞服务可用性

- **GIVEN** recovery pass 内部产生既有安全降级诊断
- **WHEN** recovery pass 进入降级终态
- **THEN** server readiness 和已接受的 pending work MUST NOT 因该失败永久不可用
- **AND** Runtime MUST 继续输出既有 `runtime.recovery.degraded` 诊断
- **AND** Runtime MUST NOT 将该失败伪装为成功恢复或用户 cancel

#### Scenario: Recovery 使用 Agent-scoped bounded durable scan

- **WHEN** Runtime 执行 startup recovery
- **THEN** Runtime MUST 使用可信 app composition 确定的 `agentId` 和有限 `limit` 查询 recoverable runs
- **AND** Runtime MUST NOT 查询或恢复其他 Agent 的 run
- **AND** Runtime MUST NOT 把无界 history scan、frontend session list 或 projection cache 作为 recovery source

#### Scenario: Recovery Agent Scope 不可由客户端覆盖

- **WHEN** 任意 Web request、client metadata、model output 或 capability argument 包含不同 `agentId`
- **THEN** recovery discovery MUST 继续使用 app composition 绑定的 `agentId`
- **AND** 不可信值 MUST NOT 改变 discovery 或 claim scope

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统重启后根据持久化事实在后台恢复运行状态；server readiness 不等待恢复完成，恢复完成前新请求被接受但不执行。
- **依据 Requirements**：`Local Runtime 启动必须执行 bounded recovery pass`

### 处理过程

- **变更类型**：修改
- **目标内容**：启动时先完成对外监听，再后台扫描持久化事实、分类并 claim 可恢复 run；恢复结束或降级后，pending work 和恢复的 queued work 进入既有调度路径。
- **依据 Requirements**：`Local Runtime 启动必须执行 bounded recovery pass`

### 规格

- **规格项**：启动可用性与恢复调度
- **变更类型**：修改
- **原规格值**：恢复完成前不进入 server readiness。
- **目标规格值**：server readiness 不等待 recovery pass；recovery 进入终态前新请求只被接受为 pending work，终态后进入既有 scheduler path。
- **依据 Requirements**：`Local Runtime 启动必须执行 bounded recovery pass`
