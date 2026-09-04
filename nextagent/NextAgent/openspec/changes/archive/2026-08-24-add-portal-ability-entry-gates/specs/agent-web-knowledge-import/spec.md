## Function

- **所属 Function**：`FN-8.16 知识导入`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Knowledge import entry gate

Agent Web MUST 根据 `runtimeConfig.portalAbilityConfig.knowledgeImportEnabled` 控制知识导入入口可见性。字段为 `true` 或缺失时，入口 MUST 保持当前默认可见行为；字段为 `false` 时，入口 MUST NOT 渲染。

Local 宿主 MUST 继续不渲染知识导入入口。Immersive 与 Collaborative/PIU 宿主 MUST 使用同一个 `knowledgeImportEnabled` 值控制所有知识导入入口。关闭入口 MUST NOT 影响直达知识导入内容视图的既有行为，也 MUST NOT 修改知识导入 API 或知识导入能力执行语义。

**需求类别**：功能性需求

#### Scenario: 默认显示知识导入入口

- **WHEN** `knowledgeImportEnabled` 为 `true` 或缺失
- **THEN** Immersive 与 Collaborative/PIU 宿主中的知识导入入口 MUST 保持当前可见行为
- **AND** Local 宿主 MUST 继续不渲染该入口

#### Scenario: 关闭知识导入入口

- **WHEN** `knowledgeImportEnabled` 为 `false`
- **THEN** Immersive 与 Collaborative/PIU 宿主中的知识导入入口 MUST NOT 渲染
- **AND** 直达知识导入内容视图的既有行为 MUST 保持不变
- **AND** 知识导入 API 和知识导入能力执行语义 MUST 保持不变

#### Scenario: 多宿主入口一致

- **WHEN** `knowledgeImportEnabled` 为 `false`
- **THEN** Immersive 与 Collaborative/PIU 中的所有知识导入入口 MUST 均不可见
- **AND** MUST NOT 出现一个宿主隐藏、另一个宿主仍可见的行为

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：知识导入入口由 `knowledgeImportEnabled` 统一控制，默认在 Immersive 与 Collaborative/PIU 中可见，`false` 时隐藏；Local 继续不可见。
- **依据 Requirements**：`Knowledge import entry gate`

### 规格

- **规格项**：知识导入入口开关
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`knowledgeImportEnabled` 默认 `true`；仅 `false` 时隐藏 Immersive 与 Collaborative/PIU 入口。
- **依据 Requirements**：`Knowledge import entry gate`
