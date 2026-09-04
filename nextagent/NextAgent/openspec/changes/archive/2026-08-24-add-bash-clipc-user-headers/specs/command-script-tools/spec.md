## Function

- **所属 Function**：`FN-5.5 执行命令和脚本`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Bash 为 opt-in 的 clipc 调用注入可信用户身份 Header

Bash Tool MUST 在提交 sandbox gateway 前，识别 executable 精确等于 `clipc`、当前 active Skill 的 `metadata.extension.api_header_params` 已声明对应身份 header、且 argv 中存在 `--params` 后续值为 JSON object 的调用。对这类调用，Bash Tool MUST 把该 JSON object 的 `header` 字段规范化为 JSON object，并只把已声明的下列键合并进去：

- `X-Subject-Id`：取自当前可信 `identityContext.subjectId`
- `X-Display-Name`：取自当前可信 `identityContext.displayName`

Bash Tool MUST 用可信值覆盖模型或用户提供 的同名 `X-Subject-Id` 和 `X-Display-Name`，MUST 保留 `header` 中其他键和 `--params` 中其他字段，并 MUST NOT 注入 `tenantId` 或 `Agent-Tenant-ID`。当 executable 不是 `clipc`、当前 active Skill 未声明对应身份 header、`--params` 缺失、或 `--params` 后续值不是 JSON object 时，Bash Tool MUST NOT 合成或修改 `--params`，并 MUST 保持既有命令提交行为。

**需求类别**：功能性需求

#### Scenario: 注入可信 X-Subject-Id 和 X-Display-Name

- **WHEN** Bash Tool 收到 executable 为 `clipc` 的调用
- **AND** 当前 active Skill 的 `api_header_params` 包含 `X-Subject-Id,X-Display-Name`
- **AND** `--params` 后续值是 JSON object
- **THEN** Bash Tool MUST 在提交 sandbox gateway 前把 `header.X-Subject-Id` 设置为 `identityContext.subjectId`
- **AND** MUST 把 `header.X-Display-Name` 设置为 `identityContext.displayName`
- **AND** MUST 保留 `--params` 中其他字段和 `header` 中其他键

#### Scenario: 模型不能覆盖身份字段

- **WHEN** Bash Tool 收到 executable 为 `clipc` 的调用
- **AND** 当前 active Skill 已声明对应身份 header
- **AND** 模型在 `--params.header` 中提供了 `X-Subject-Id` 或 `X-Display-Name`
- **THEN** Bash Tool MUST 用可信 `identityContext` 中的对应值覆盖同名键
- **AND** MUST NOT 让模型提供的身份值进入 sandbox 请求

#### Scenario: 不注入 tenantId

- **WHEN** Bash Tool 收到 executable 为 `clipc` 的调用
- **AND** `--params.header` 中存在模型提供的 `tenantId` 或 `Agent-Tenant-ID`
- **THEN** Bash Tool MUST NOT 用可信身份生成或覆盖该键
- **AND** MUST 保持该键的既有值不变

#### Scenario: 未 opt-in 的 clipc 调用保持原参数

- **WHEN** Bash Tool 收到 executable 为 `clipc` 的调用
- **AND** 当前 active Skill 的 `api_header_params` 未声明任何支持的身份 header
- **THEN** Bash Tool MUST NOT 修改 `--params`
- **AND** MUST 保持既有 sandbox 提交行为

#### Scenario: 非 clipc 命令不注入身份 Header

- **WHEN** Bash Tool 收到 executable 不是 `clipc` 的调用
- **THEN** Bash Tool MUST NOT 修改 `--params`
- **AND** MUST 保持既有命令解析和 sandbox 提交行为

#### Scenario: 缺少或非法 --params 不合成身份参数

- **WHEN** Bash Tool 收到 executable 为 `clipc` 的调用
- **AND** `--params` 缺失或后续值不是 JSON object
- **THEN** Bash Tool MUST NOT 合成 `--params`
- **AND** MUST 保持既有命令提交行为

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：Bash Tool 在已 opt-in 的 `clipc` 调用的 `--params.header` 中注入可信 `X-Subject-Id` 和 `X-Display-Name`，并阻止模型覆盖这两个身份字段。
- **依据 Requirements**：`Bash 为 opt-in 的 clipc 调用注入可信用户身份 Header`

### 处理过程

- **变更类型**：修改
- **目标内容**：Bash Tool 在提交 sandbox gateway 前识别 `clipc` 调用，解析 `--params` JSON object，合并可信用户身份 header，并将修改后的 argv 继续交给既有 sandbox 执行路径。
- **依据 Requirements**：`Bash 为 opt-in 的 clipc 调用注入可信用户身份 Header`

### 规格

- **规格项**：`clipc` 用户身份 header
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`X-Subject-Id` 来自 `identityContext.subjectId`；`X-Display-Name` 来自 `identityContext.displayName`；不注入 `tenantId` 或 `Agent-Tenant-ID`；同名模型输入必须被可信值覆盖。
- **依据 Requirements**：`Bash 为 opt-in 的 clipc 调用注入可信用户身份 Header`

### 主规格

- **变更类型**：修改
- **目标内容**：`command-script-tools`
- **依据 Requirements**：`Bash 为 opt-in 的 clipc 调用注入可信用户身份 Header`
