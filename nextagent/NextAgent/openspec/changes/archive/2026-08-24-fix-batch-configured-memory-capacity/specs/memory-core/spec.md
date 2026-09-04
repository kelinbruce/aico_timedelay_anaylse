## Function

- **所属 Function**：`FN-8.15 管理长期记忆`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: 长期记忆批量新增保持逐项准入和结果可核对

系统 MUST 接受包含 1 至 100 个条目的长期记忆批量新增请求。每个条目 MUST 包含 `memoryType`、`knowledgeSourceType`、`briefIndex` 和非空 `content`；MAY 包含 `memoryId`、`labels`、`confidence`、`source`、`idempotencyKey`、`state` 和 `archiveReason`。当 `confidence` 缺失时系统 MUST 使用 `1`；当 `state` 缺失时系统 MUST 使用 `ACTIVE`。未知字段、空批次或超过 100 个条目的请求 MUST 在处理任何条目前整体拒绝。

任一条目未通过 HTTP runtime schema 字段校验时，系统 MUST 在处理任何条目前整体拒绝该请求。通过请求级 schema 校验后，系统 MUST 对每个条目独立执行内容安全准入、可信 Owner Scope 与 Agent Scope 约束、50 条 `CONFIGURED` 个人记忆容量约束和幂等写入。单个条目的安全准入、容量或写入失败 MUST NOT 阻止后续条目处理，也 MUST NOT 为该条目创建记忆。成功结果 MUST 返回 `successCount`、`failCount` 和按输入处理顺序排列的成功 `memoryIds`，其中 `successCount + failCount` MUST 等于输入条目数，`memoryIds.length` MUST 等于 `successCount`。请求级可信 scope 错误、取消或存储不可用 MUST 使整个调用返回 presentation-safe 错误；系统 MUST NOT 把部分结果报告为完整成功。

50 条 `CONFIGURED` 个人记忆容量约束 MUST NOT 依赖单一持久化 gateway 实现的自愿行为：在调用持久化 gateway 前，management service MUST 对未携带 `memoryId` 的 `CONFIGURED` 条目按输入顺序执行容量预检。剩余额度 MUST 为 50 减去同一可信 scope 与 `memoryInstance`（缺省 `defaultInstance`）下 `ACTIVE` 与 `ARCHIVED` 状态 `CONFIGURED` 记忆总数；超出剩余额度的条目 MUST 计入 `failCount` 且 MUST NOT 进入持久化调用。携带 `memoryId` 的条目与 `CONFIGURED` 之外的条目不受该预检约束。批次内不存在未携带 `memoryId` 的 `CONFIGURED` 条目时，management service MUST NOT 执行容量预检查询。容量预检查询返回 SafeError 时，整个调用 MUST 返回该 presentation-safe 错误且 MUST NOT 处理任何条目。

**需求类别**：功能性需求

#### Scenario: 三条记录部分成功

- **GIVEN** 批量请求包含三个 schema 合法的条目
- **AND** 第二个条目被内容安全准入拒绝
- **WHEN** 系统处理该批量请求
- **THEN** 第一和第三个条目 MUST 各创建一条记忆
- **AND** 第二个条目 MUST 不创建记忆
- **AND** 结果 MUST 为 `successCount = 2`、`failCount = 1` 和两个按输入顺序排列的 `memoryIds`

#### Scenario: 批量大小越界时整体拒绝

- **WHEN** 批量请求包含 0 个或 101 个条目
- **THEN** 系统 MUST 返回 validation 类安全错误
- **AND** 系统 MUST 不处理或写入任何条目

#### Scenario: 重复条目按自己的幂等键收敛

- **GIVEN** 一个条目携带幂等键 `K1` 且首次处理已成功
- **WHEN** 相同可信 scope 下再次提交携带 `K1` 的同一条目
- **THEN** 系统 MUST 返回首次写入对应的 `memoryId`
- **AND** 系统 MUST 不创建第二条记忆或重复产生写入副作用

#### Scenario: 容量不足条目按序占用剩余额度

- **GIVEN** 当前可信 scope 与 `memoryInstance` 下已有 47 条 `ACTIVE` 与 `ARCHIVED` 合计的 `CONFIGURED` 记忆
- **WHEN** 批量请求包含 20 个未携带 `memoryId` 的 `CONFIGURED` 条目
- **THEN** 按输入顺序的前 3 个条目 MUST 进入持久化调用并可创建记忆
- **AND** 其余 17 个条目 MUST 计入 `failCount` 且不进入持久化调用
- **AND** 结果 MUST 为 `successCount` 与 `failCount` 之和等于 20

#### Scenario: 容量预检查询失败使整批安全失败

- **WHEN** 容量预检查询返回 SafeError（如存储不可用或取消）
- **THEN** 整个调用 MUST 返回该 presentation-safe 错误
- **AND** 系统 MUST 不处理或写入任何条目

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：`batchCreateLongTermMemory` 对未携带 `memoryId` 的 `CONFIGURED` 条目按输入顺序执行 50 条容量预检；被拒条目计入 `failCount` 且不进入持久化调用；count 查询失败整批安全失败；无新增 `CONFIGURED` 条目的批次不做预检查询。
- **依据 Requirements**：`长期记忆批量新增保持逐项准入和结果可核对`

### 结果

- **变更类型**：修改
- **目标内容**：批量新增的容量执法不再依赖单一持久化 gateway 实现的自愿行为；REMOTE deployment 下超剩余额度的 `CONFIGURED` 导入条目被拒绝并计入 `failCount`，修复前端提示「可导入 0 条」但确认导入仍全部成功的问题。
- **依据 Requirements**：`长期记忆批量新增保持逐项准入和结果可核对`
