## Function

- **所属 Function**：`FN-8.1 持久化运行数据`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: RequestRun 批量分页查询

Working Memory gateway MUST 通过必需的 `RequestRunStoreGateway.listRuns` 操作提供 RequestRun 批量分页查询。`RequestRunListQuery` MUST 包含可信 `tenantId`、`subjectId`、`agentId`、必需的 `offset` 和 `limit`，并 MUST 包含非空 `sessionIds`、非空 `runIds` 或二者；当二者同时存在时，结果 MUST 同时匹配两个集合。重复的过滤 ID MUST NOT 使同一 `RequestRunRecord` 在结果中重复出现。

`RequestRunRecordPage` MUST 包含 `items`、`offset`、`limit` 和 `hasMore`。`items` MUST 只包含匹配查询 scope 和过滤条件的记录，MUST 按 `createdAt` 降序、再按 `runId` 降序稳定排序。`offset` 和 `limit` MUST 回显已接受查询的同名值；仅当过滤后的稳定结果序列在当前页之后仍有至少一条记录时，`hasMore` MUST 为 `true`。

**需求类别**：功能性需求

#### Scenario: 按多个 sessionId 查询

- **WHEN** 查询在 scope `(T1, U1, A1)` 下传入 `sessionIds=[S1,S2]`、省略 `runIds`、`offset=0`、`limit=100`
- **THEN** `items` MUST 只包含该 scope 下属于 `S1` 或 `S2` 的 RequestRun
- **AND** 每条记录 MUST 至多出现一次

#### Scenario: 按多个 runId 查询

- **WHEN** 查询在 scope `(T1, U1, A1)` 下传入 `runIds=[R1,R2]`、省略 `sessionIds`、`offset=0`、`limit=100`
- **THEN** `items` MUST 只包含该 scope 下存在的 `R1` 和 `R2`
- **AND** 不存在或不属于该 scope 的 ID MUST 不出现在结果中

#### Scenario: sessionId 与 runId 同时过滤

- **WHEN** 查询传入 `sessionIds=[S1]` 和 `runIds=[R1,R2]`
- **AND** `R1` 属于 `S1`，`R2` 属于 `S2`
- **THEN** `items` MUST 包含 `R1`
- **AND** `items` MUST 不包含 `R2`

#### Scenario: 稳定分页并指示下一页

- **GIVEN** scope 和过滤条件匹配 3 条记录，稳定顺序依次为 `R3,R2,R1`
- **WHEN** 查询使用 `offset=1`、`limit=1`
- **THEN** `items` MUST 只包含 `R2`
- **AND** 结果 MUST 为 `{ items: [R2], offset: 1, limit: 1, hasMore: true }`

### Requirement: RequestRun 批量查询有界且隔离 scope

Working Memory gateway MUST 只返回与查询中可信 `tenantId`、`subjectId` 和 `agentId` 全部相等的 RequestRun。`offset` MUST 是大于或等于 `0` 的安全整数；`limit` MUST 是 `1..100` 的安全整数。`sessionIds` 和 `runIds` 在出现时 MUST 是非空数组，且两个字段 MUST 至少有一个出现。违反任一约束时，gateway MUST 以 `AgentError` 显式失败且不得返回 RequestRun records，其中 `code="REQUEST_RUN_QUERY_INVALID"`、`category="VALIDATION"`、`retryable=false`。

LOCAL 和 REMOTE Working Memory provider MUST 实现相同查询契约。REMOTE provider MUST NOT 通过逐个 `runId` 调用单记录查询来实现 `listRuns`；一次 `listRuns` 调用 MUST 对部署方表现为一次批量 gateway 操作。

**需求类别**：系统质量属性

**质量属性**：安全、性能/容量

**适用范围**：该 Function

#### Scenario: 单页达到最大值

- **WHEN** 查询使用 `limit=100`
- **THEN** gateway MUST 接受该分页参数
- **AND** `items` 的长度 MUST 不超过 `100`

#### Scenario: limit 超过最大值

- **WHEN** 查询使用 `limit=101`
- **THEN** gateway MUST 抛出 `REQUEST_RUN_QUERY_INVALID`
- **AND** MUST NOT 返回 RequestRun records

#### Scenario: 未提供有效过滤集合

- **WHEN** 查询同时省略 `sessionIds` 和 `runIds`，或任一已提供字段为空数组
- **THEN** gateway MUST 抛出 `REQUEST_RUN_QUERY_INVALID`
- **AND** MUST NOT 将该输入解释为无条件全量查询

#### Scenario: 相同 ID 存在于其他 scope

- **GIVEN** `(T1,U1,A1)` 与 `(T2,U2,A2)` 下存在相同字符串值的 `runId`
- **WHEN** `(T1,U1,A1)` 查询该 `runId`
- **THEN** 结果 MUST 只包含 `(T1,U1,A1)` 的记录
- **AND** 其他 scope 的记录 MUST 不可见

#### Scenario: REMOTE provider 执行批量查询

- **WHEN** 调用方对 REMOTE Working Memory binding 调用一次 `listRuns` 并传入多个 `runIds`
- **THEN** provider MUST 执行一次批量 gateway 操作
- **AND** MUST NOT 对每个 `runId` 分别调用 `loadRun`

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统除持久化单条运行数据外，还提供受 Owner Scope 和 Agent Scope 隔离的 RequestRun 批量分页查询，并在 LOCAL 与 REMOTE 部署中保持一致契约。
- **依据 Requirements**：`RequestRun 批量分页查询`、`RequestRun 批量查询有界且隔离 scope`

### 输入

- **变更类型**：修改
- **目标内容**：持久化运行数据查询可接受至少一个非空 session ID 集合或 run ID 集合，以及非负 offset 和单页 limit。
- **依据 Requirements**：`RequestRun 批量分页查询`、`RequestRun 批量查询有界且隔离 scope`

### 输出

- **变更类型**：修改
- **目标内容**：批量查询返回稳定排序的当前页 RequestRun、回显分页参数和下一页指示。
- **依据 Requirements**：`RequestRun 批量分页查询`

### 结果

- **变更类型**：修改
- **目标内容**：合法查询返回当前可信 scope 内的匹配页；非法过滤或分页参数在数据读取前以确定的 validation error 失败。
- **依据 Requirements**：`RequestRun 批量分页查询`、`RequestRun 批量查询有界且隔离 scope`
