## Function

- **所属 Function**：`FN-8.5 上传和管理附件`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Bootstrap API exposes portal ability configuration

`/api/v1/runtime/bootstrap` MUST 在 response 中包含 `portalAbilityConfig`，并通过 `PortalAbilityConfigProvider.get()` 在请求时解析当前 effective 值，MUST NOT 使用启动时冻结的快照。`portalAbilityConfig` MUST 只包含 public 字段 `suggestedQuestionsEnabled: boolean`。`ask-user-question-time-minutes` 或其派生值 MUST NOT 出现在 bootstrap response 中。

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

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：runtime bootstrap response 在附件配置之外始终返回 `portalAbilityConfig.suggestedQuestionsEnabled`，不返回 AskUserQuestion 等待时间。
- **依据 Requirements**：`Bootstrap API exposes portal ability configuration`

### 规格

- **规格项**：Portal 能力 bootstrap 投影
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：response 始终包含 `portalAbilityConfig.suggestedQuestionsEnabled: boolean`；不包含 `ask-user-question-time-minutes` 及其派生值。
- **依据 Requirements**：`Bootstrap API exposes portal ability configuration`
