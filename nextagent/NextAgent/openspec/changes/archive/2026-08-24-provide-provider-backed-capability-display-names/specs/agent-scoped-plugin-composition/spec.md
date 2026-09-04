## Function

- **所属 Function**：`FN-10.2 装配插件`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Plugin Tool authoring 使用统一展示名称契约

Plugin Tool authoring 的 frozen `DefineToolInput` 与 `ToolMetadata` MUST 继续使用 `name` 作为 canonical Tool identity，并 MUST additive 支持 optional stable `displayName` 和 optional `locales`。`displayName` 缺失时 plugin Tool Provider MUST 使用 `name` 作为 stable descriptor `displayName`；`locales` 的结构和校验边界 MUST 与 `CapabilityDescriptor.locales` 相同。

**需求类别**：功能性需求

Plugin SDK `defineToolProvider(...)` MUST 按统一 Tool descriptor 规则投影名称，并 MUST 在现有 Plugin API version 下保真暴露这些 backward-compatible optional fields。Stable `displayName` MUST 保留 Capability descriptor 的既有消费者语义；`locales` MUST 只参与 presentation。Tool 名称事实 MUST NOT 改变 provider identity、Tool name、Agent binding、conflict resolution、model-visible description、schemas、configuration、dependency、execution、risk policy、sandbox、权限或审计。插件也可以通过 `defineCapabilityProvider(...)` 直接返回满足统一 contract 的 Tool descriptor；两种 plugin authoring path MUST 进入同一个 Catalog governance path。

#### Scenario: Plugin Tool 提供中英文名称

- **WHEN** plugin `defineTool(...)` 提供 canonical `name`、稳定 `displayName` 以及合法 `zh-CN`、`en-US` 名称
- **THEN** `defineToolProvider(...)` 产生的 Tool descriptor MUST 逐值保留这些展示事实
- **AND** Tool identity 和模型调用名称 MUST 继续使用 canonical `name`

#### Scenario: Plugin Tool 未提供展示扩展

- **WHEN** plugin Tool 只提供既有 `name`、description 和 schemas
- **THEN** Tool descriptor MUST 使用 `name` 作为稳定 `displayName`
- **AND** Tool registration、discovery 和 invocation MUST 继续成功

#### Scenario: Stable displayName 进入既有目录消费者

- **GIVEN** plugin Tool 同时提供 canonical `name=lookup_alarm` 和 stable `displayName=Alarm lookup`
- **WHEN** Tool descriptor 被目录或 ToolSearch 读取
- **THEN** Tool identity 和模型调用名称 MUST 保持 `lookup_alarm`
- **AND** 读取 descriptor stable name 的结果 MUST 使用 `Alarm lookup`

#### Scenario: Tool 展示名称非法

- **WHEN** Tool authoring metadata 提供非法稳定 `displayName` 或非法 `locales`
- **THEN** provider assembly or descriptor validation MUST fail closed
- **AND** 系统 MUST NOT 以部分名称注册该 Tool

## Function 变更汇总

### 输入

- **变更类型**：修改
- **目标内容**：plugin Tool frozen authoring contracts 可以提供 optional stable 与本地化展示名称，并继续以 `name` 作为 Tool identity。
- **依据 Requirements**：`Plugin Tool authoring 使用统一展示名称契约`

### 输出

- **变更类型**：修改
- **目标内容**：plugin Tool Provider 通过统一 descriptor 输出展示事实；字段缺失时使用 canonical Tool name 降级。
- **依据 Requirements**：`Plugin Tool authoring 使用统一展示名称契约`

### 处理过程

- **变更类型**：修改
- **目标内容**：plugin Tool authoring paths复用同一 descriptor投影与 Catalog governance，名称不改变 Tool 注册、选择或执行。
- **依据 Requirements**：`Plugin Tool authoring 使用统一展示名称契约`
