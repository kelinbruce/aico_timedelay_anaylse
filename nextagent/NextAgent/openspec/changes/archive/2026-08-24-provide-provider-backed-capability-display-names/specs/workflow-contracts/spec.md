## Function

- **所属 Function**：`FN-9.1 执行工作流`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: RecipeDefinition 提供可选本地化展示名称

`RecipeDefinition` MUST 支持 optional、非 `null` 的 `locales`，其结构和校验边界 MUST 与 `CapabilityDescriptor.locales` 相同。字段缺失时 Recipe MUST 继续按 required `displayName` 保持合法；字段非法时 Recipe schema validation MUST 失败，并 MUST 进入既有 invalid Recipe skip path。

**需求类别**：功能性需求

Workflow Capability Provider MUST 把 `RecipeDefinition.displayName` 作为 Workflow descriptor 的稳定 `displayName`，并 MUST 把合法 `RecipeDefinition.locales` 逐值投影到同一 descriptor。Recipe 的稳定或本地化名称 MUST NOT 改变 `recipeName`、Workflow identity、routing、graph、inputs、execution、retry、timeout、节点层级或结果。

#### Scenario: Workflow Recipe 提供中英文名称

- **WHEN** 合法 Recipe 提供稳定 `displayName` 以及 `zh-CN`、`en-US` 本地化名称
- **THEN** Workflow descriptor MUST 逐值保留稳定和本地化名称
- **AND** Workflow 的选择和执行 MUST 继续使用 `recipeName`

#### Scenario: Workflow Recipe 未提供本地化名称

- **WHEN** 合法 Recipe 不包含 `locales`
- **THEN** Recipe MUST 继续通过 schema validation
- **AND** Workflow descriptor MUST 使用 Recipe 的稳定 `displayName`

#### Scenario: Workflow Recipe 名称非法

- **WHEN** Recipe 的 `locales` 不满足统一结构、locale grammar 或文本约束
- **THEN** Recipe schema validation MUST 失败
- **AND** loader MUST 跳过该 Recipe，MUST NOT 发布部分名称或 descriptor

## Function 变更汇总

### 输入

- **变更类型**：修改
- **目标内容**：Workflow Recipe 可以提供稳定 `displayName` 和 optional 本地化名称。
- **依据 Requirements**：`RecipeDefinition 提供可选本地化展示名称`

### 输出

- **变更类型**：修改
- **目标内容**：Workflow descriptor 保留 Recipe 的稳定和本地化展示事实；字段缺失时只输出稳定名称。
- **依据 Requirements**：`RecipeDefinition 提供可选本地化展示名称`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统校验 Recipe 展示事实并投影到 descriptor，名称不参与 Workflow identity、选择或执行。
- **依据 Requirements**：`RecipeDefinition 提供可选本地化展示名称`
