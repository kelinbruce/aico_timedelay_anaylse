## Function

- **所属 Function**：`FN-10.32 管理插件开发诊断产物`
- **Function 变更类型**：`ADDED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: 系统统一接收插件开发诊断记录

系统 MUST 向任一受支持部署模式中已通过启动校验的全部插件提供 `DeveloperDiagnosticArtifactSink.emit(input)`；该 sink MUST 在 LOCAL、REMOTE 和后续受支持部署模式中默认可写。`input` MUST 只包含 `artifactType`、可选可信运行坐标和 JSON-compatible `payload`，MUST NOT 包含 `pluginId`、文件目录、文件名、轮转、压缩或保留策略。系统 MUST 从已校验的插件 manifest 绑定 `pluginId`，并为每次调用返回 `ACCEPTED` 或 `DROPPED`；`DROPPED` 时 MUST 返回 `INVALID_RECORD`、`RECORD_TOO_LARGE`、`QUEUE_OVERLOADED` 或 `OUTPUT_UNAVAILABLE` 中恰好一个稳定 reason code。

**需求类别**：功能性需求

#### Scenario: 两种部署模式均接受合法记录
- **WHEN** 官方 LOCAL 产品入口和官方 REMOTE 产品入口分别加载同一个已通过启动校验的插件，且插件提交合法 `artifactType`、JSON-compatible `payload` 和可用运行坐标
- **THEN** 两个部署中的系统 MUST 都返回 `ACCEPTED`
- **AND** 两条对应物理记录 MUST 使用各自 manifest 绑定的 `pluginId`

#### Scenario: 插件尝试控制物理输出
- **WHEN** 任一部署模式中的插件提交文件目录、文件名、轮转、压缩、保留策略或自声明 `pluginId`
- **THEN** 系统 MUST 返回 `DROPPED`
- **AND** reason code MUST 为 `INVALID_RECORD`
- **AND** 系统 MUST NOT 创建或修改该输入指定的文件

### Requirement: 开发诊断记录使用独立的短期产物文件族

当通过官方 LOCAL 或 REMOTE 产品入口启动的已激活插件提交合法 developer diagnostic artifact 记录时，系统 MUST 把全部已接受记录写入直接位于 `paths.logDirectory` 的独立 NDJSON 文件族。文件名 MUST 使用 `nextagent-plugin-diagnostic` 专属前缀，且 MUST NOT 为该文件族创建额外子目录。每个物理记录 MUST 是一条完整 UTF-8 JSON line，并包含 `schemaVersion=1`、`recordedAt`、宿主绑定的 `pluginId`、`artifactType`、可用可信运行坐标和 `payload`。该文件族 MUST NOT 与 operational log、audit 或 metrics 共享 active destination、文件 selector、maintenance state 或 retention lifecycle。

**需求类别**：功能性需求

#### Scenario: 两种部署模式使用同一产物边界
- **WHEN** LOCAL 部署和 REMOTE 部署中的已激活调测插件分别提交一条合法记录
- **THEN** 两个部署中的系统 MUST 都把对应记录写入各自 `paths.logDirectory` 下的 developer diagnostic artifact 文件族
- **AND** 两个文件族 MUST 使用相同的 `nextagent-plugin-diagnostic` 前缀和物理记录结构
- **AND** operational、audit 和 metrics 文件族 MUST 不包含这两条 `payload`

## Function 变更汇总

### 描述

- **变更类型**：新增
- **目标内容**：系统在 LOCAL 和 REMOTE 部署中统一接收已加载插件提交的开发诊断记录，并输出独立、有界且与主输出面隔离的短期物理产物。
- **依据 Requirements**：`系统统一接收插件开发诊断记录`、`开发诊断记录使用独立的短期产物文件族`

### 输入

- **变更类型**：新增
- **目标内容**：已通过启动校验的插件提交的 `artifactType`、可选可信运行坐标和 JSON-compatible `payload`。
- **依据 Requirements**：`系统统一接收插件开发诊断记录`

### 输出

- **变更类型**：新增
- **目标内容**：`ACCEPTED` 或带稳定 reason code 的 `DROPPED` 结果，以及已接受记录对应的独立 NDJSON 物理记录。
- **依据 Requirements**：`系统统一接收插件开发诊断记录`、`开发诊断记录使用独立的短期产物文件族`

### 结果

- **变更类型**：新增
- **目标内容**：LOCAL 和 REMOTE 部署提供一致的插件开发诊断产物能力，非法输入被拒绝且主输出面不接收原始调测内容。
- **依据 Requirements**：`系统统一接收插件开发诊断记录`、`开发诊断记录使用独立的短期产物文件族`

### 规格

- **规格项**：部署支持范围
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：LOCAL、REMOTE
- **依据 Requirements**：`系统统一接收插件开发诊断记录`、`开发诊断记录使用独立的短期产物文件族`

### 覆盖特性

- **变更类型**：新增
- **目标内容**：`F-10.2 装配插件`
- **依据 Requirements**：`系统统一接收插件开发诊断记录`、`开发诊断记录使用独立的短期产物文件族`

### 主规格

- **变更类型**：新增
- **目标内容**：`plugin-developer-diagnostic-artifacts`
- **依据 Requirements**：`系统统一接收插件开发诊断记录`、`开发诊断记录使用独立的短期产物文件族`
