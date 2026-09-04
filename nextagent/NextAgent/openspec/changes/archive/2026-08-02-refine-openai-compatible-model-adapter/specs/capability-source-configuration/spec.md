## Function

- **所属 Function**：`FN-5.1 管理能力目录`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Custom providers require explicit adapter registration

当 `type=custom` 时，provider entry MUST 包含非空 `adapter`。该 provider 可以贡献 executable descriptor 之前，app composition 边界 MUST 已显式注册匹配的 custom adapter。对于 adapter 未注册的 custom entry，resolver MUST 产生 `CUSTOM_ADAPTER_UNREGISTERED`，并且 MUST NOT 把该 provider 加入 `ResolvedCapabilityProviders.providers`。

模型目录或模型 provider 的装配 MUST NOT 被解释为 custom Capability adapter registration。

**需求类别**：功能性需求

#### Scenario: Custom provider 缺少 adapter

- **WHEN** custom provider entry 未提供 `adapter`
- **THEN** resolver MUST 为该 entry 产生 `MISSING_REQUIRED_FIELD`
- **AND** 该 entry MUST NOT 出现在 `ResolvedCapabilityProviders.providers`

#### Scenario: Custom provider adapter 未注册

- **WHEN** custom provider entry 提供了 `adapter`，但没有匹配的 app-level adapter registration
- **THEN** resolver MUST 产生 `CUSTOM_ADAPTER_UNREGISTERED`
- **AND** 该 entry MUST NOT 出现在 `ResolvedCapabilityProviders.providers`

#### Scenario: 模型 provider 已装配

- **WHEN** 模型目录已装配 compatible 或 Gateway provider
- **THEN** 该事实不自动注册同名 custom Capability adapter

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：系统只接受已显式注册匹配 Capability adapter 的 custom provider；模型目录或模型 provider 的装配事实不构成 custom Capability adapter registration。既有 adapter 字段校验、错误码和目录结果不变。
- **依据 Requirements**：`Custom providers require explicit adapter registration`

### 主规格

- **变更类型**：修改
- **目标内容**：`capability-source-configuration`
- **依据 Requirements**：`Custom providers require explicit adapter registration`

### 遗留规格

- **变更类型**：修改
- **目标内容**：`capability-catalog` 继续承载未触及的能力目录行为。
- **依据 Requirements**：`Custom providers require explicit adapter registration`
