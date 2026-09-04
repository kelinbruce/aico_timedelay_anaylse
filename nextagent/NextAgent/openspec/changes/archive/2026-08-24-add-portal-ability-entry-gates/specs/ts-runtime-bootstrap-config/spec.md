## Function

- **所属 Function**：`FN-8.5 上传和管理附件`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Bootstrap API exposes portal ability entry gates

`/api/v1/runtime/bootstrap` response 的 `portalAbilityConfig` MUST 包含以下 public boolean 字段：

- `cronTasksEnabled`
- `longTermMemoryManagementEnabled`
- `knowledgeImportEnabled`

字段值 MUST 等于 `PortalAbilityConfigProvider.get()` 当前解析的 effective 值。LOCAL 和 REMOTE 模式都 MUST 返回这三个字段。配置缺失或非法时，三个字段 MUST 均为默认值 `true`。

`portalAbilityConfig` MUST NOT 包含 `ask-user-question-time-minutes` 或其毫秒派生值。Bootstrap response MUST NOT 因为入口开关配置异常而失败。

**需求类别**：功能性需求

#### Scenario: bootstrap 返回三个入口开关

- **WHEN** 前端调用 `/api/v1/runtime/bootstrap`
- **THEN** response MUST 包含 `portalAbilityConfig.cronTasksEnabled`
- **AND** response MUST 包含 `portalAbilityConfig.longTermMemoryManagementEnabled`
- **AND** response MUST 包含 `portalAbilityConfig.knowledgeImportEnabled`
- **AND** 字段值 MUST 等于 provider 当前解析的 effective boolean

#### Scenario: 配置缺失时返回默认开启

- **WHEN** active Agent package 的 `config/config.json` 不存在或缺少任一入口字段
- **THEN** 对应 bootstrap 字段 MUST 为 `true`

#### Scenario: REMOTE 模式配置变化后 bootstrap 返回当前值

- **WHEN** REMOTE 模式下 `config/config.json` 在应用启动后被修改
- **AND** 前端之后调用 `/api/v1/runtime/bootstrap`
- **THEN** 三个入口开关 MUST 反映 provider 当前解析的值

#### Scenario: bootstrap 不暴露 AskUserQuestion 等待时间

- **WHEN** `portal-ability-config` 配置了 `ask-user-question-time-minutes`
- **THEN** bootstrap response MUST NOT 包含该值或其毫秒派生值

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：runtime bootstrap response 的 `portalAbilityConfig` 始终返回 `cronTasksEnabled`、`longTermMemoryManagementEnabled`、`knowledgeImportEnabled`，不返回 AskUserQuestion 等待时间。
- **依据 Requirements**：`Bootstrap API exposes portal ability entry gates`

### 规格

- **规格项**：Portal ability 入口开关 bootstrap 投影
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`portalAbilityConfig` 包含三个 boolean 入口开关，默认均为 `true`。
- **依据 Requirements**：`Bootstrap API exposes portal ability entry gates`
