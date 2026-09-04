# ts-runtime-bootstrap-config Specification

## Purpose
Define the runtime bootstrap API exposure of file upload configuration and frontend upload behavior driven by bootstrap config.

## Function

- **所属 Function**：`FN-8.5 上传和管理附件`
- **spec 角色**：主规格
## Requirements
### Requirement: Bootstrap API exposes file upload configuration
The `/api/v1/runtime/bootstrap` endpoint MUST expose effective upload capability and limits through `ChatUploadConfigProvider.get()` at request time, NOT from a startup-frozen snapshot.

**LOCAL mode**: The response MUST always contain `chatUploadFileConfig` with effective values. When the config file does not exist, the response MUST include default markdown-only limits, so file upload remains available.

**REMOTE mode**: The response MUST contain `chatUploadFileConfig` when the config file exists. When the config file does not exist, the response MUST NOT include `chatUploadFileConfig`, signaling to the frontend that file upload is disabled.

The config MUST contain effective (post-validation) values for all client-relevant fields: `chatUploadFileType`, `chatUploadMaxFileNumber`, `chatUploadMaxFileSize`, `uploadFileIdleExpireTime`, `uploadFileMaxExpireTime`. Storage backend identifiers such as HOFS bucket names MUST NOT be required by the frontend to choose an upload workflow.

#### Scenario: LOCAL mode bootstrap always includes file upload config
- **WHEN** LOCAL mode and the frontend calls `/api/v1/runtime/bootstrap`
- **THEN** the response MUST include `chatUploadFileConfig`
- **AND** all fields MUST reflect effective values (config or defaults)

#### Scenario: REMOTE mode bootstrap includes config when configured
- **WHEN** REMOTE mode and the config file exists
- **AND** the frontend calls `/api/v1/runtime/bootstrap`
- **THEN** the response MUST include `chatUploadFileConfig` with effective values

#### Scenario: REMOTE mode bootstrap omits chatUploadFileConfig when not configured
- **WHEN** REMOTE mode and the config file does not exist
- **AND** the frontend calls `/api/v1/runtime/bootstrap`
- **THEN** the response MUST NOT include `chatUploadFileConfig`
- **AND** the frontend MUST disable the attachment button with a tooltip

#### Scenario: Bootstrap response does not expose storage routing details
- **WHEN** local storage is used because HOFS is absent but config file exists
- **THEN** the bootstrap response MUST include `chatUploadFileConfig` with effective default limits
- **AND** the frontend MUST NOT infer a different upload protocol from the absence of a HOFS bucket

#### Scenario: Bootstrap returns current config not startup snapshot
- **WHEN** REMOTE mode and the config file is created or modified after application startup
- **AND** the frontend calls `/api/v1/runtime/bootstrap`
- **THEN** the endpoint MUST call `ChatUploadConfigProvider.get()` to retrieve the current config
- **AND** the response MUST reflect the current `config/config.json` content
- **AND** MUST NOT return a startup-time frozen snapshot

### Requirement: Bootstrap config drives frontend upload behavior
The frontend MUST use the bootstrap config to configure upload limits, accepted file types, and timer display. The frontend MUST enable the attachment button when `chatUploadFileConfig` is present and disable it with a tooltip when absent. The frontend MUST always use the unified staged upload flow for attachments when enabled.

#### Scenario: Frontend uses staged upload with configured limits
- **WHEN** the bootstrap response includes `chatUploadFileConfig`
- **THEN** the frontend MUST enable the attachment button
- **AND** the frontend MUST upload files immediately on selection via the staged upload endpoint
- **AND** the frontend MUST send staged attachment references when submitting a question
- **AND** the frontend MUST apply accepted file types and size/count limits from the config

#### Scenario: Frontend disables attachment button when config absent
- **WHEN** the bootstrap response does not include `chatUploadFileConfig`
- **THEN** the frontend MUST disable the attachment button
- **AND** MUST display a tooltip explaining that file upload is not configured
- **AND** MUST NOT fall back to default upload limits

### Requirement: Bootstrap API exposes portal ability entry gates

`/api/v1/runtime/bootstrap` response 的 `portalAbilityConfig` MUST 包含以下 public boolean 字段：

- `cronTasksEnabled`
- `longTermMemoryManagementEnabled`
- `knowledgeImportEnabled`
- `fullProcessEnabled`

字段值 MUST 等于 `PortalAbilityConfigProvider.get()` 当前解析的 effective 值。LOCAL 和 REMOTE 模式都 MUST 返回这四个字段。配置缺失或非法时，四个字段 MUST 均为默认值 `true`。

`portalAbilityConfig` MUST NOT 包含 `ask-user-question-time-minutes` 或其毫秒派生值。Bootstrap response MUST NOT 因为入口开关配置异常而失败。

**需求类别**：功能性需求

#### Scenario: bootstrap 返回四个入口开关

- **WHEN** 前端调用 `/api/v1/runtime/bootstrap`
- **THEN** response MUST 包含 `portalAbilityConfig.cronTasksEnabled`
- **AND** response MUST 包含 `portalAbilityConfig.longTermMemoryManagementEnabled`
- **AND** response MUST 包含 `portalAbilityConfig.knowledgeImportEnabled`
- **AND** response MUST 包含 `portalAbilityConfig.fullProcessEnabled`
- **AND** 字段值 MUST 等于 provider 当前解析的 effective boolean

#### Scenario: 配置缺失时返回默认开启

- **WHEN** active Agent package 的 `config/config.json` 不存在或缺少任一入口字段
- **THEN** 对应 bootstrap 字段 MUST 为 `true`

#### Scenario: REMOTE 模式配置变化后 bootstrap 返回当前值

- **WHEN** REMOTE 模式下 `config/config.json` 在应用启动后被修改
- **AND** 前端之后调用 `/api/v1/runtime/bootstrap`
- **THEN** 四个入口开关 MUST 反映 provider 当前解析的值

#### Scenario: bootstrap 不暴露 AskUserQuestion 等待时间

- **WHEN** `portal-ability-config` 配置了 `ask-user-question-time-minutes`
- **THEN** bootstrap response MUST NOT 包含该值或其毫秒派生值

### Requirement: Bootstrap API exposes portal ability configuration

`/api/v1/runtime/bootstrap` MUST 在 response 中包含 `portalAbilityConfig`，并通过 `PortalAbilityConfigProvider.get()` 在请求时解析当前 effective 值，MUST NOT 使用启动时冻结的快照。`portalAbilityConfig` MUST 包含 public 字段 `suggestedQuestionsEnabled: boolean`。`ask-user-question-time-minutes` 或其派生值 MUST NOT 出现在 bootstrap response 中。

LOCAL 和 REMOTE 模式都 MUST 包含 `portalAbilityConfig`；配置文件缺失或非法时，`suggestedQuestionsEnabled` MUST 为默认值 `true`。

**需求类别**：功能性需求

#### Scenario: bootstrap 返回推荐问题开关
- **WHEN** 前端调用 `/api/v1/runtime/bootstrap`
- **THEN** response MUST 包含 `portalAbilityConfig.suggestedQuestionsEnabled`
- **AND** 字段值 MUST 等于 provider 当前解析的 effective boolean

#### Scenario: bootstrap 不暴露 AskUserQuestion 等待时间
- **WHEN** `portal-ability-config.ask-user-question-time-minutes` 被配置为任意合法值
- **THEN** bootstrap response MUST NOT 包含该值或其毫秒派生值

#### Scenario: REMOTE 模式配置变化后 bootstrap 返回当前值
- **WHEN** REMOTE 模式下 `config/config.json` 在应用启动后被修改
- **AND** 前端之后调用 `/api/v1/runtime/bootstrap`
- **THEN** response 的 `portalAbilityConfig.suggestedQuestionsEnabled` MUST 反映 provider 当前解析的值

#### Scenario: 配置缺失时 bootstrap 返回默认开启
- **WHEN** LOCAL 或 REMOTE 模式下 active Agent package 的 `config/config.json` 不存在
- **THEN** response 的 `portalAbilityConfig.suggestedQuestionsEnabled` MUST 为 `true`
