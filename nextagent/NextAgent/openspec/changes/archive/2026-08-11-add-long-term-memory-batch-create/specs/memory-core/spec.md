## Function

- **所属 Function**：`FN-8.5 长期记忆 search/list/detail/count/state transition`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 长期记忆批量新增保持逐项准入和结果可核对

系统 MUST 接受包含 1 至 100 个条目的长期记忆批量新增请求。每个条目 MUST 包含 `memoryType`、`knowledgeSourceType`、`briefIndex` 和非空 `content`；MAY 包含 `memoryId`、`labels`、`confidence`、`source`、`idempotencyKey`、`state` 和 `archiveReason`。当 `confidence` 缺失时系统 MUST 使用 `1`；当 `state` 缺失时系统 MUST 使用 `ACTIVE`。未知字段、空批次或超过 100 个条目的请求 MUST 在处理任何条目前整体拒绝。

任一条目未通过 HTTP runtime schema 字段校验时，系统 MUST 在处理任何条目前整体拒绝该请求。通过请求级 schema 校验后，系统 MUST 对每个条目独立执行内容安全准入、可信 Owner Scope 与 Agent Scope 约束、50 条 `CONFIGURED` 个人记忆容量约束和幂等写入。单个条目的安全准入、容量或写入失败 MUST NOT 阻止后续条目处理，也 MUST NOT 为该条目创建记忆。成功结果 MUST 返回 `successCount`、`failCount` 和按输入处理顺序排列的成功 `memoryIds`，其中 `successCount + failCount` MUST 等于输入条目数，`memoryIds.length` MUST 等于 `successCount`。请求级可信 scope 错误、取消或存储不可用 MUST 使整个调用返回 presentation-safe 错误；系统 MUST NOT 把部分结果报告为完整成功。

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

### Requirement: 长期记忆管理提供唯一 Channel 端口

系统 SHALL 通过 `@nextagent/agent-contracts/channel` 暴露 `LongTermMemoryManagementPort`，供 Web Channel 调用长期记忆管理能力。该 port SHALL 精确定义 save、list、batch create、manual save、get、delete、mutate、search、detail、publish、unpublish、list published 和 copy published 13 个 operation。

**需求类别**：功能性需求

#### Scenario: Channel 通过 Management Port 调用批量新增

- **WHEN** Web Channel 处理长期记忆批量新增 HTTP operation
- **THEN** Channel MUST 调用 `LongTermMemoryManagementPort.batchCreateLongTermMemory`
- **AND** Channel MUST NOT 直接调用 `LongTermMemoryStoreGateway` 或其它 Gateway port

#### Scenario: Management Port 的公开方法集合包含批量新增

- **WHEN** contract tests 枚举 `LongTermMemoryManagementPort` 的公开 method
- **THEN** method 集合 MUST 与 13 个已定义 operation 一一对应
- **AND** port MUST NOT 增加 count、batch delete、transition、adjust、access 或其它兼容别名

### Requirement: Management 调用使用可信 Scope 和取消上下文

每个长期记忆 management command/query SHALL 携带由完整 `IdentityContext` 和独立 `agentId` 组成的可信 `LongTermMemoryManagementScope`。`IdentityContext` SHALL 原样来自 channel/auth boundary，`agentId` SHALL 来自 trusted hosted-Agent selection 或 app composition。`agent-memory` SHALL 只把 `identityContext.tenantId`、`identityContext.subjectId` 和 `agentId` 映射到 Gateway scope；`displayName` MUST NOT 进入 Gateway 请求、记忆响应或诊断。所有 13 个 management methods SHALL 接收可选 `AbortSignal`；application service SHALL 在调用 Gateway 前检查取消状态。客户端 query/body、模型输出、Capability 参数或 metadata MUST NOT 覆盖 Owner Scope 或 Agent Scope。

**需求类别**：功能性需求

#### Scenario: 批量新增注入唯一可信 Scope

- **WHEN** 已认证的批量新增请求进入 Channel
- **THEN** Channel MUST 从 trusted identity resolver 和 Agent resolver/composition 构造 management scope
- **AND** request body 中的 `tenantId`、`subjectId`、`userId` 或 `agentId` MUST 导致请求拒绝
- **AND** 同一可信 scope MUST 应用于该批次的全部条目

#### Scenario: 批量准入期间取消

- **WHEN** 客户端在批量新增完成前断开连接
- **THEN** Channel MUST abort 传给 management port 的 signal
- **AND** application service MUST 在下一次 Gateway 调用前观察取消并停止继续处理
- **AND** 已完成条目的结果 MUST 保持已提交，未开始的条目 MUST 不被写入

### Requirement: Management Boundary 由 Composition 显式启用

`agent-app` SHALL 是构造和注入 `LongTermMemoryManagementPort` 的唯一 composition owner。`agent-app` SHALL 只选择 Gateway bindings、调用 `agent-memory` public factory并传递返回 port；MUST NOT 承担 management DTO mapping、Record projection、记忆业务校验或 route delegation。只有 selected Gateway bindings 可用且 application service 构造成功时，Web Channel 才 SHALL 接收 management port。

**需求类别**：功能性需求

#### Scenario: 可用依赖启用批量新增 Route

- **WHEN** app composition 已获得 selected Store、Retriever 和 Sharing Gateway bindings
- **THEN** app MUST 构造并只向 Web Channel 注入一个 `LongTermMemoryManagementPort`
- **AND** 包含批量新增在内的 13 个长期记忆 routes MUST 委托该 port

#### Scenario: 缺少依赖不产生批量直连

- **WHEN** selected Gateway bindings 缺失、歧义或不可用
- **THEN** app MUST NOT 向 Channel 注入 management port
- **AND** Channel MUST NOT 为批量新增回退到直接调用 Gateway、disabled adapter 或 process-local mock

## Function 变更汇总

### 输入

- **变更类型**：修改
- **目标内容**：`FN-8.5` 接受单条写入以及每批 1 至 100 条的管理批量写入；批量条目不能提供可信 scope。
- **依据 Requirements**：`长期记忆批量新增保持逐项准入和结果可核对`、`Management 调用使用可信 Scope 和取消上下文`

### 输出

- **变更类型**：修改
- **目标内容**：批量写入返回成功数、失败数和成功记忆标识，并满足可核对的计数关系。
- **依据 Requirements**：`长期记忆批量新增保持逐项准入和结果可核对`

### 接口

- **变更类型**：修改
- **目标内容**：长期记忆管理 REST surface 和 `LongTermMemoryManagementPort` 增加批量新增 operation，所有管理 route 继续只委托该 port。
- **依据 Requirements**：`长期记忆管理提供唯一 Channel 端口`、`Management Boundary 由 Composition 显式启用`

### 量化指标

- **指标名称**：单次批量新增条目数
- **变更类型**：新增
- **原值或原口径**：不适用（新增）
- **目标值或目标口径**：每次 1 至 100 条，包含首尾边界
- **单位与测量边界**：条/请求；以通过请求级 schema validation 的 `items.length` 计数
- **依据 Requirements**：`长期记忆批量新增保持逐项准入和结果可核对`

### 主规格

- **变更类型**：修改
- **目标内容**：`memory-core`
- **依据 Requirements**：`长期记忆批量新增保持逐项准入和结果可核对`、`长期记忆管理提供唯一 Channel 端口`、`Management 调用使用可信 Scope 和取消上下文`、`Management Boundary 由 Composition 显式启用`

### 遗留规格

- **变更类型**：修改
- **目标内容**：`long-term-memory-management-contract` 不再承载本次触及并迁入主规格的三个 Requirements；其它未触及 Requirements 保持原位。
- **依据 Requirements**：`长期记忆管理提供唯一 Channel 端口`、`Management 调用使用可信 Scope 和取消上下文`、`Management Boundary 由 Composition 显式启用`
