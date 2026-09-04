## Function

- **所属 Function**：`FN-10.1 注册和执行钩子`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Hook 结果输出必须满足请求终态公开边界

当 Hook 在 `HookResult.resultSummary` 中提供执行后结果时，该对象 MUST 只包含允许返回给当前 Owner Scope 与 Agent Scope 调用方的数据。同一 request/run 形成合法请求终态快照时，系统 MUST 使用与 `HOOK_INVOKED.inlinePayload.resultSummary` JSON 语义等价的对象。不能保证该公开边界的 Hook MUST 省略 `resultSummary`。

Runtime MUST NOT 从 Hook input、boundary、mutation、pending input、safe reason、error details 或处理后的 boundary 补充、展开或反推 `resultSummary`。除既有 JSON 与容量校验外，Runtime MUST NOT 对其执行摘要生成、字段筛选、字段重命名、值转换、排序、裁剪、脱敏、补全或业务解释。`HOOK_INVOKED` event 本身的 timeline-only 可见性 MUST 保持不变。

**需求类别**：系统质量属性

**质量属性**：安全、审计/可追溯性
**适用范围**：该 Function

#### Scenario: Hook 结果进入同一请求终态快照

- **WHEN** Hook 为当前 request/run 返回合法且允许公开的 `resultSummary`
- **THEN** 系统 MUST 保留该对象作为对应 `HOOK_INVOKED` 的结果事实
- **AND** 请求终态快照包含该 invocation 时 MUST 使用与该对象 JSON 语义等价的 `resultSummary`
- **AND** `HOOK_INVOKED` event 本身 MUST NOT 因此进入公开 stream vocabulary

#### Scenario: Hook 省略结果时不合成输出

- **WHEN** Hook 未提供 `resultSummary`
- **THEN** 对应 invocation 的请求终态快照条目 MUST 省略 `resultSummary`
- **AND** 系统 MUST NOT 从其他 Hook 或运行数据补充该字段

#### Scenario: Runtime 不替 Hook 执行内容处理

- **WHEN** Hook 提供字段名、字段值和嵌套结构均合法的 `resultSummary`
- **THEN** Runtime MUST 按 JSON 语义直接复制完整对象
- **AND** Runtime MUST NOT 因内容语义修改该对象

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：Hook 显式提供且满足公开边界的执行后 JSON 结果，既作为单次 invocation 事实，也可随同一请求终态被平台集成方取得；省略时不合成结果。
- **依据 Requirements**：`Hook 结果输出必须满足请求终态公开边界`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统只接受 Hook 主动提供且通过 JSON 与容量校验的结果对象，按 JSON 语义直接复制，不从其他运行数据生成或改写结果内容。
- **依据 Requirements**：`Hook 结果输出必须满足请求终态公开边界`

### 结果

- **变更类型**：修改
- **目标内容**：Hook author 明确承担请求终态公开结果的数据安全责任，调用方取得的结果与 Hook 返回对象保持 JSON 语义一致。
- **依据 Requirements**：`Hook 结果输出必须满足请求终态公开边界`

### 覆盖特性

- **变更类型**：修改
- **目标内容**：`F-10.1 扩展生命周期钩子` 增加 Hook 显式结果随请求终态返回的集成价值，组成 Functions 不变。
- **依据 Requirements**：`Hook 结果输出必须满足请求终态公开边界`
