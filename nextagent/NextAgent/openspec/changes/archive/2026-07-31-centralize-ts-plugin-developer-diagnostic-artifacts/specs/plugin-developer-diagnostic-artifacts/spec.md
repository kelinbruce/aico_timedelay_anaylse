## Function

- **所属 Function**：`FN-10.5 管理插件开发诊断产物`
- **Function 变更类型**：`ADDED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 系统统一接收插件开发诊断记录

系统 MUST 向已通过启动校验的插件提供 `DeveloperDiagnosticArtifactSink.emit(input)`；`input` MUST 只包含 `artifactType`、可选可信运行坐标和 JSON-compatible `payload`，MUST NOT 包含 `pluginId`、文件目录、文件名、轮转、压缩或保留策略。系统 MUST 从已校验的插件 manifest 绑定 `pluginId`，并为每次调用返回 `ACCEPTED` 或 `DROPPED`；`DROPPED` 时 MUST 返回 `INVALID_RECORD`、`RECORD_TOO_LARGE`、`QUEUE_OVERLOADED` 或 `OUTPUT_UNAVAILABLE` 中恰好一个稳定 reason code。

**需求类别**：功能性需求

#### Scenario: 已加载插件提交合法记录
- **WHEN** 已加载插件提交合法 `artifactType`、JSON-compatible `payload` 和可用运行坐标
- **THEN** 系统 MUST 返回 `ACCEPTED`
- **AND** 对应物理记录 MUST 使用 manifest 绑定的 `pluginId`
- **AND** 插件输入 MUST NOT 覆盖该 `pluginId`

#### Scenario: 插件尝试控制物理输出
- **WHEN** 插件提交文件目录、文件名、轮转、压缩、保留策略或自声明 `pluginId`
- **THEN** 系统 MUST 返回 `DROPPED`
- **AND** reason code MUST 为 `INVALID_RECORD`
- **AND** 系统 MUST NOT 创建或修改该输入指定的文件

### Requirement: 开发诊断记录使用独立的短期产物文件族

本地部署系统 MUST 把全部已接受记录写入直接位于 `paths.logDirectory` 的独立 NDJSON 文件族，文件名 MUST 使用 `nextagent-plugin-diagnostic` 专属前缀，且 MUST NOT 为该文件族创建额外子目录。每个物理记录 MUST 是一条完整 UTF-8 JSON line，并包含 `schemaVersion=1`、`recordedAt`、宿主绑定的 `pluginId`、`artifactType`、可用可信运行坐标和 `payload`。该文件族 MUST NOT 与 operational log、audit 或 metrics 共享 active destination、文件 selector、maintenance state 或 retention lifecycle。REMOTE 部署 MUST NOT 创建本地 developer diagnostic artifact writer 或本地 fallback。

**需求类别**：功能性需求

#### Scenario: 两个插件共享统一产物边界
- **WHEN** `developer-hook-trace` 与 `context-monitor` 分别提交一条合法记录
- **THEN** 系统 MUST 在同一 developer diagnostic artifact 文件族中写入两条完整记录
- **AND** 该文件族 MUST 直接位于 `paths.logDirectory`
- **AND** 每条记录 MUST 保留各自宿主绑定的 `pluginId` 与 `artifactType`
- **AND** operational、audit 和 metrics 文件族 MUST 不包含这两条 payload

### Requirement: 产物写入具有有界容量和生命周期

系统 MUST 对 developer diagnostic artifact 文件族应用固定 daily boundary 或 active segment 达到 `100 MiB` 时轮转，以先发生者为准。closed segment MUST 通过 `.gz.tmp` 后原子提交 `.gz`，并只在 committed archive 存在后删除 closed source。系统 MUST 从 `closedAt` 起保留 closed source 或 archive `3` 个 elapsed days，并在 startup reconciliation 和周期 maintenance 中只处理该文件族精确拥有的 regular files。单条包含换行分隔符的 serialized record MUST 不超过 `4 MiB`；超过上限的记录 MUST 以 `RECORD_TOO_LARGE` 丢弃，MUST NOT 部分写入或任意截断。

**需求类别**：系统质量属性
**质量属性**：性能/容量
**适用范围**：该 Function

#### Scenario: 大小边界触发轮转与压缩
- **WHEN** active segment 接受下一条完整记录后达到或超过 `100 MiB`
- **THEN** 系统 MUST 关闭该 segment 并为后续记录选择新的 active segment
- **AND** closed segment MUST 最终形成可恢复的 committed gzip archive

#### Scenario: 单条记录超过上限
- **WHEN** 一条记录的 UTF-8 serialized bytes 加换行超过 `4 MiB`
- **THEN** 系统 MUST 返回 `DROPPED`
- **AND** reason code MUST 为 `RECORD_TOO_LARGE`
- **AND** active segment MUST 不包含该记录的部分内容

### Requirement: 产物失败不改变受保护操作

`DeveloperDiagnosticArtifactSink.emit` MUST 使用有界异步 enqueue，MUST NOT 在插件 Hook、Tool 或 Policy 路径执行同步文件 append、同步 flush、gzip、目录扫描或 retention。记录非法、记录超限、队列过载、destination 不可用、maintenance 失败或 close 超时时，系统 MUST NOT 改变插件贡献的业务结果、request terminal result 或 Agent activation；系统 MUST 更新受信本地开发诊断状态，且 MUST NOT 把该失败写入 operational log、audit、metrics、timeline、stream 或 Web 公共响应。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: 产物 destination 不可用
- **WHEN** 插件执行期间 developer diagnostic artifact destination 不可用
- **THEN** `emit` MUST 返回 `DROPPED` 与 `OUTPUT_UNAVAILABLE`
- **AND** 插件受保护操作 MUST 继续其原有结果
- **AND** 主运行日志 MUST 不出现 artifact payload 或该写入失败的镜像记录

### Requirement: 本地状态只暴露有界安全证据

受信本地开发诊断状态 MUST 只包含 `availability=AVAILABLE|DEGRADED`、范围为 `0..2147483647` 的 saturating `droppedCount` 和可选 `lastFailureCode`。状态 MUST NOT 包含 artifact payload、原始异常、宿主路径、credential、token、tenant identity 或 subject identity。任一记录或 lifecycle failure 后 availability MUST 为 `DEGRADED`；成功重新建立 destination 后 availability MUST 恢复为 `AVAILABLE`，但 `droppedCount` MUST 保留进程内累计值。REMOTE 部署不得投影本地 writer status。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 本地开发者查询降级状态
- **WHEN** 至少一条记录因 `QUEUE_OVERLOADED` 被丢弃
- **THEN** 受信本地状态 MUST 返回 `availability=DEGRADED`
- **AND** `droppedCount` MUST 至少为 `1`
- **AND** `lastFailureCode` MUST 为 `QUEUE_OVERLOADED`
- **AND** 状态 MUST 不暴露被丢弃的 payload

### Requirement: 原始调测内容与主输出面隔离

developer diagnostic artifact MAY 包含已激活调测插件所需的用户问题、模型输入输出、Tool 参数或结果以及上下文内容；本地部署中只要 Agent activation 启用相应插件，系统 MUST 生成记录，且系统配置 MUST NOT 提供 `developerDiagnostics` 或其它 artifact 输出开关。系统 MUST 把该文件族视为潜在敏感内容，MUST NOT 将其读取、投影或镜像到 operational log、audit、metrics、timeline、stream、Web 公共 API 或普通 readiness payload。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：系统

#### Scenario: 未激活调测插件
- **WHEN** 目标 Agent 未激活调测插件
- **THEN** 系统 MUST 不为请求生成该插件的 developer diagnostic artifact 记录

#### Scenario: 配置尝试关闭本地 artifact 输出
- **WHEN** 本地部署配置包含 `developerDiagnostics`
- **THEN** 启动校验 MUST 拒绝该未知配置
- **AND** 系统 MUST NOT 因配置而关闭已激活插件的 artifact 输出

#### Scenario: 主输出维护扫描共享日志目录
- **WHEN** operational、audit 或 metrics maintenance 在 `paths.logDirectory` 遇到 developer diagnostic artifact family member
- **THEN** 该 maintenance MUST 保留该文件
- **AND** 只有 developer diagnostic artifact lifecycle MAY 轮转、压缩或删除它

### Requirement: 内置调测插件提交统一记录

`developer-hook-trace` 在每个已激活且受支持的 lifecycle stage MUST 提交恰好一条 `artifactType=developer-hook-trace` 记录，保留既有 trace coordinates 与原始 boundary 内容。`context-monitor` MUST 在每次完成上下文压缩后提交恰好一条 `artifactType=context-evolution.compaction` 记录，并在每次 Agent terminal 前提交恰好一条 `artifactType=context-evolution.terminal` 记录；它 MUST 保留现有 pre-compression、post-compression、summary、latest messages 和 latest answer 语义。两个插件 MUST NOT 接受或使用 `logDirectory`、`logFile`，MUST NOT 直接创建、追加、覆盖、轮转或删除宿主文件。

**需求类别**：功能性需求

#### Scenario: Developer hook trace 记录模型调用边界
- **WHEN** 已激活 `developer-hook-trace` 的 Agent 进入 `BEFORE_MODEL_INVOKE`
- **THEN** 插件 MUST 提交恰好一条 `artifactType=developer-hook-trace` 记录
- **AND** payload MUST 保留该 stage 的原始 boundary 与可用 trace coordinates

#### Scenario: Context monitor 记录压缩与终态
- **WHEN** 一个已激活 `context-monitor` 的请求完成一次上下文压缩并随后进入 terminal
- **THEN** 插件 MUST 提交恰好一条 compaction record 和恰好一条 terminal record
- **AND** 插件 MUST 不创建 session-specific 文件

## Function 变更汇总

### 描述

- **变更类型**：新增
- **目标内容**：系统统一接收已加载插件的结构化开发诊断记录，将潜在敏感调测内容输出为独立、有界、短期保留的本地产物，并以安全状态表达降级而不影响受保护操作。
- **依据 Requirements**：`系统统一接收插件开发诊断记录`、`开发诊断记录使用独立的短期产物文件族`、`产物失败不改变受保护操作`、`原始调测内容与主输出面隔离`

### 输入

- **变更类型**：新增
- **目标内容**：已加载插件提交的 artifact type、JSON-compatible payload 与可用可信运行坐标；物理输出策略不属于插件输入。
- **依据 Requirements**：`系统统一接收插件开发诊断记录`

### 输出

- **变更类型**：新增
- **目标内容**：独立 NDJSON/gzip developer diagnostic artifact 文件族、每次 emit 的 accepted/dropped 结果以及不含敏感 payload 的本地状态。
- **依据 Requirements**：`开发诊断记录使用独立的短期产物文件族`、`本地状态只暴露有界安全证据`

### 处理过程

- **变更类型**：新增
- **目标内容**：系统校验记录并绑定可信插件身份；合法记录进入有界输出，非法、超限、过载或不可用记录被整体丢弃；已接受记录按固定容量和时间边界轮转、压缩及老化。
- **依据 Requirements**：`系统统一接收插件开发诊断记录`、`产物写入具有有界容量和生命周期`、`产物失败不改变受保护操作`

### 结果

- **变更类型**：新增
- **目标内容**：显式启用的内置调测插件产生统一、隔离的开发诊断记录；未启用或输出失败时请求和插件贡献结果保持不变。
- **依据 Requirements**：`原始调测内容与主输出面隔离`、`内置调测插件提交统一记录`、`产物失败不改变受保护操作`

### 量化指标

- **指标名称**：单条 serialized record 上限
- **变更类型**：新增
- **原值或原口径**：不适用（新增）
- **目标值或目标口径**：至多 `4 MiB`，包含 UTF-8 JSON bytes 与一个换行分隔符
- **单位与测量边界**：bytes；每次 `emit` 序列化完成后、enqueue 前测量
- **依据 Requirements**：`产物写入具有有界容量和生命周期`

- **指标名称**：active segment 大小轮转阈值
- **变更类型**：新增
- **原值或原口径**：不适用（新增）
- **目标值或目标口径**：`100 MiB` 或 fixed daily boundary，以先发生者为准
- **单位与测量边界**：MiB；单个 developer diagnostic artifact active segment
- **依据 Requirements**：`产物写入具有有界容量和生命周期`

- **指标名称**：closed artifact 保留期
- **变更类型**：新增
- **原值或原口径**：不适用（新增）
- **目标值或目标口径**：从 `closedAt` 起 `3` 个 elapsed days
- **单位与测量边界**：每个 closed source 或 committed archive
- **依据 Requirements**：`产物写入具有有界容量和生命周期`

### 接口

- **变更类型**：新增
- **目标内容**：`DeveloperDiagnosticArtifactSink.emit(input)` 与受信本地开发诊断状态查询。
- **依据 Requirements**：`系统统一接收插件开发诊断记录`、`本地状态只暴露有界安全证据`

### 覆盖特性

- **变更类型**：新增
- **目标内容**：`F-10.5 管理插件开发诊断产物`
- **依据 Requirements**：`系统统一接收插件开发诊断记录`、`内置调测插件提交统一记录`

### 主规格

- **变更类型**：新增
- **目标内容**：`plugin-developer-diagnostic-artifacts`
- **依据 Requirements**：`系统统一接收插件开发诊断记录`

### 遗留规格

- **变更类型**：新增
- **目标内容**：`developer-hook-trace-logging` 与 `context-monitor-logging` 继续承载插件自身定义和触发语义；其被触及的文件输出 Requirements 原子迁入主规格。
- **依据 Requirements**：`内置调测插件提交统一记录`
