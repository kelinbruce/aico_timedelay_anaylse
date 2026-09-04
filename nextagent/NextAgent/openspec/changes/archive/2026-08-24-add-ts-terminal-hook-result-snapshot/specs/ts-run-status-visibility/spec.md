## Function

- **所属 Function**：`FN-2.4 查看请求状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 请求终态同步返回 Hook 执行结果快照

每个 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 和 `REQUEST_SUPERSEDED` terminal stream event 的 `payload` MUST 包含 `hookResults` 或 `hookResultsErrorCode`，且两者 MUST NOT 同时存在。

当系统能够完整取得同一 request/run 在终态提交前已经持久化的全部 `HOOK_INVOKED` 时，`hookResults` MUST 是按 timeline `sequence` 严格升序排列的数组；没有 matching event 时 MUST 返回空数组。每个 matching event MUST 在数组中恰好产生一个条目。数组条目 MUST 是 object，并只允许包含以下字段：必填 `hookInvocationId: string`、`hookId: string`、`stage: LifecycleStage`、`status: HookInvocationStatus`、`failureMode: HookFailureMode`；当源 event 提供时，允许包含 `outcome: HookOutcome` 和 `resultSummary: JsonObject`。源 event 中的其他已有 timeline-only 字段 MUST NOT 进入快照条目；上述必填字段缺失或值非法时 MUST 将该源事实判定为非法。

仅当条目的 `status` 为 `SUCCESS` 时，条目 MUST 包含源 event 的真实 `outcome`，并在源 event 提供时包含 JSON 语义等价的 `resultSummary`。当 `status` 为 `TIMEOUT`、`FAILED`、`INVALID_RESULT` 或 `IGNORED` 时，条目 MUST 省略 `outcome` 和 `resultSummary`。快照 MUST NOT 包含 safe reason、error、diagnostic、duration、idempotency key、mutation summary、Owner Scope、Agent Scope、prompt、模型输入输出、Capability 输入输出、路径、credential、authentication token、附件内容或原始异常。

`HOOK_INVOKED` MUST 继续是单次 Hook invocation 的权威事实。`hookResults` MUST 是同一运行终态的只读快照；系统 MUST NOT 根据该数组重新执行 Hook、改变请求状态或建立第二个 Hook truth source。

**需求类别**：功能性需求

#### Scenario: 多个 Hook 按执行顺序同步返回

- **WHEN** 同一 request/run 在终态提交前已持久化三个合法 `HOOK_INVOKED`
- **THEN** terminal stream event MUST 包含三个 `hookResults` 条目
- **AND** 三个条目 MUST 按源 event 的 timeline `sequence` 严格升序排列
- **AND** 每个源 invocation MUST 恰好出现一次

#### Scenario: 无 Hook 的请求返回空数组

- **WHEN** 同一 request/run 在终态提交前不存在 `HOOK_INVOKED`
- **THEN** terminal stream event MUST 包含 `hookResults: []`
- **AND** terminal stream event MUST NOT 包含 `hookResultsErrorCode`

#### Scenario: 成功 Hook 保留显式结果

- **WHEN** 源 `HOOK_INVOKED` 包含 `status: "SUCCESS"`、真实 `outcome` 和 `resultSummary: { "a": 1, "b": 2 }`
- **THEN** 对应 terminal `hookResults` 条目 MUST 包含相同 `outcome`
- **AND** 该条目的 `resultSummary` MUST 为 `{ "a": 1, "b": 2 }`

#### Scenario: 非成功 Hook 不伪造结果

- **WHEN** 源 `HOOK_INVOKED.status` 为 `TIMEOUT`、`FAILED`、`INVALID_RESULT` 或 `IGNORED`
- **THEN** 对应 terminal `hookResults` 条目 MUST 保留真实 `status` 和 `failureMode`
- **AND** 该条目 MUST 省略 `outcome` 和 `resultSummary`

#### Scenario: 四类终态使用相同快照契约

- **WHEN** 同一 Hook 历史分别伴随 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED`
- **THEN** 每类 terminal stream event MUST 使用相同的 `hookResults` schema、排序规则和内容边界
- **AND** Hook 快照 MUST NOT 改变对应请求终态

### Requirement: Hook 终态快照必须保持作用域隔离

系统 MUST 只聚合与 terminal fact 完全相同的可信 Owner Scope、Agent Scope、session、request 和 run 坐标下的 `HOOK_INVOKED`。任一坐标不匹配的 event MUST NOT 进入 `hookResults`，系统 MUST NOT 搜索其他 scope、session、request 或 run 补足结果。

**需求类别**：系统质量属性

**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 跨作用域事件不能进入快照

- **WHEN** timeline 中存在其他 Owner Scope、Agent Scope、session、request 或 run 的 `HOOK_INVOKED`
- **THEN** terminal `hookResults` MUST NOT 包含这些 event
- **AND** 系统 MUST 只根据当前 terminal scope 的 matching events 形成结果或错误码

### Requirement: Hook 终态快照必须保持有界完整性

序列化后的完整 `hookResults` JSON 数组 MUST 不超过 `49_000 bytes` UTF-8。系统 MUST 在终态 event 提交前读取并验证完整 matching Hook history；无论内部读取是否分页，都 MUST NOT 因单次读取上限遗漏、重复或重排 invocation。

当存在非法 matching event 时，terminal payload MUST 省略 `hookResults`，并 MUST 包含 `hookResultsErrorCode: "HOOK_RESULTS_INVALID"`。当完整数组超过容量时，terminal payload MUST 省略 `hookResults`，并 MUST 包含 `hookResultsErrorCode: "HOOK_RESULTS_LIMIT_EXCEEDED"`。两类失败都 MUST NOT 返回部分数组，MUST NOT 截断、删除条目或改写 `resultSummary`。

**需求类别**：系统质量属性

**质量属性**：性能/容量、审计/可追溯性
**适用范围**：该 Function

#### Scenario: 较大 Hook 历史被完整聚合

- **WHEN** 当前 request/run 有多个 matching `HOOK_INVOKED`，且完整快照未超过容量上限
- **THEN** 系统 MUST 返回全部 invocation 形成的单个完整 `hookResults`
- **AND** 任一 invocation MUST NOT 因内部读取上限而丢失或重复

#### Scenario: 非法 Hook fact 显式降级

- **WHEN** matching `HOOK_INVOKED` 缺少快照必填字段或字段值不在允许集合
- **THEN** terminal payload MUST 包含 `hookResultsErrorCode: "HOOK_RESULTS_INVALID"`
- **AND** terminal payload MUST 省略 `hookResults`
- **AND** 系统 MUST NOT 返回合法条目的部分前缀

#### Scenario: 快照超限不截断

- **WHEN** 序列化后的完整 `hookResults` JSON 数组超过 `49_000 bytes` UTF-8
- **THEN** terminal payload MUST 包含 `hookResultsErrorCode: "HOOK_RESULTS_LIMIT_EXCEEDED"`
- **AND** terminal payload MUST 省略 `hookResults`
- **AND** 系统 MUST NOT 截断数组、删除条目或改写 `resultSummary` 以适应容量

### Requirement: Hook 终态快照不可用时必须保留原请求终态

当 Hook history 读取失败、超时或不完整时，terminal payload MUST 省略 `hookResults`，并 MUST 包含 `hookResultsErrorCode: "HOOK_RESULTS_UNAVAILABLE"`。该降级 MUST 保持原有 request terminal status、content、code、category 和 retryable 字段不变，MUST NOT 返回已读取 invocation 的部分前缀。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: 历史读取失败保持原终态

- **WHEN** Hook history 读取失败、超时或不完整
- **THEN** terminal payload MUST 包含 `hookResultsErrorCode: "HOOK_RESULTS_UNAVAILABLE"`
- **AND** terminal payload MUST 省略 `hookResults`
- **AND** request terminal status、content、code、category 和 retryable MUST 保持未聚合 Hook 快照时的值

### Requirement: Hook 终态快照在实时与历史中必须一致

SSE、WebSocket、timeline resume 和 REST run-event history MUST 调用同一个 terminal event projector 返回 `hookResults` 或 `hookResultsErrorCode`。对同一个 persisted terminal fact，这四个 surface 的字段存在性、数组顺序、条目字段和值 MUST 相同。普通 conversation history MUST NOT 从 assistant message、其他 timeline events 或浏览器状态重建 `hookResults`。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复、可测试性
**适用范围**：该 Function

#### Scenario: Live 与 REST history 返回相同快照

- **WHEN** 同一个 persisted terminal fact 先通过 SSE 或 WebSocket 返回，随后通过 REST run-event history 读取
- **THEN** 两次返回的 `hookResults` 或 `hookResultsErrorCode` MUST 相同
- **AND** REST history MUST NOT 再读取独立 Hook event 重新计算快照

#### Scenario: Resume 复用 persisted terminal 快照

- **WHEN** 客户端从 terminal event 之前的合法 sequence 恢复同一 run stream
- **THEN** resume 返回的 terminal payload MUST 与首次投影的 terminal payload 使用相同 Hook 快照事实
- **AND** 恢复过程 MUST NOT 产生新的 `HOOK_INVOKED` 或不同顺序的 `hookResults`

#### Scenario: Conversation history 不重建 Hook 快照

- **WHEN** 调用方只读取普通 conversation history
- **THEN** conversation response MUST NOT 从 assistant message metadata 或 content 合成 `hookResults`
- **AND** Hook 快照 MUST 只通过 terminal stream event 或 run-event history 返回

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：查看请求状态时，平台集成方可以从四类请求终态取得同一运行的完整 Hook 执行结果快照；单次 Hook 事实、请求状态和最终内容保持各自语义。
- **依据 Requirements**：`请求终态同步返回 Hook 执行结果快照`、`Hook 终态快照必须保持作用域隔离`、`Hook 终态快照必须保持有界完整性`、`Hook 终态快照不可用时必须保留原请求终态`、`Hook 终态快照在实时与历史中必须一致`

### 输入

- **变更类型**：修改
- **目标内容**：除既有可信会话、请求和运行坐标外，终态输出使用同一坐标下在终态提交前已经形成的全部 Hook invocation facts。
- **依据 Requirements**：`请求终态同步返回 Hook 执行结果快照`、`Hook 终态快照必须保持作用域隔离`

### 输出

- **变更类型**：修改
- **目标内容**：四类请求终态输出完整、有序且有界的 `hookResults`；无法完整产生时输出固定 `hookResultsErrorCode`，不返回部分数组。
- **依据 Requirements**：`请求终态同步返回 Hook 执行结果快照`、`Hook 终态快照必须保持作用域隔离`、`Hook 终态快照必须保持有界完整性`、`Hook 终态快照不可用时必须保留原请求终态`、`Hook 终态快照在实时与历史中必须一致`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统按可信 scope 和 request/run 坐标选择终态前的 Hook facts，按 timeline sequence 形成完整快照；读取、校验或容量失败时保持原请求终态并返回唯一降级码；live、resume 和 history 使用同一 persisted terminal fact。
- **依据 Requirements**：`请求终态同步返回 Hook 执行结果快照`、`Hook 终态快照必须保持作用域隔离`、`Hook 终态快照必须保持有界完整性`、`Hook 终态快照不可用时必须保留原请求终态`、`Hook 终态快照在实时与历史中必须一致`

### 结果

- **变更类型**：修改
- **目标内容**：平台集成方只消费请求终态即可取得该 run 的 Hook 执行结果或明确的快照不可用原因，刷新和重连不改变结果。
- **依据 Requirements**：`请求终态同步返回 Hook 执行结果快照`、`Hook 终态快照必须保持作用域隔离`、`Hook 终态快照必须保持有界完整性`、`Hook 终态快照不可用时必须保留原请求终态`、`Hook 终态快照在实时与历史中必须一致`

### 规格

- **规格项**：请求终态 Hook 快照返回范围
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED` 均返回当前 request/run 的完整 `hookResults`，无 invocation 时为空数组；不可完整返回时只返回固定 `hookResultsErrorCode`
- **依据 Requirements**：`请求终态同步返回 Hook 执行结果快照`、`Hook 终态快照必须保持作用域隔离`、`Hook 终态快照必须保持有界完整性`、`Hook 终态快照不可用时必须保留原请求终态`

- **规格项**：请求终态 Hook 快照容量
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：每个 request/run 的完整 `hookResults` JSON 数组最多 `49_000 bytes` UTF-8；超限不截断、不删项，返回 `HOOK_RESULTS_LIMIT_EXCEEDED`
- **依据 Requirements**：`Hook 终态快照必须保持有界完整性`

### 接口

- **变更类型**：修改
- **目标内容**：SSE、WebSocket、timeline resume 和 REST run-event history 的 terminal `StreamEnvelope.payload` 增加互斥的 `hookResults` 或 `hookResultsErrorCode`；普通 conversation history 不提供该字段。
- **依据 Requirements**：`请求终态同步返回 Hook 执行结果快照`、`Hook 终态快照在实时与历史中必须一致`

### 覆盖特性

- **变更类型**：修改
- **目标内容**：`F-2.4 查看请求状态` 增加终态同步取得 Hook 执行结果的集成价值，组成 Functions 不变。
- **依据 Requirements**：`请求终态同步返回 Hook 执行结果快照`、`Hook 终态快照在实时与历史中必须一致`
