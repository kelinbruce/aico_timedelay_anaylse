## Function

- **所属 Function**：`FN-8.15 管理长期记忆`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Long-term memory management entry gate

Agent Web MUST 根据 `runtimeConfig.portalAbilityConfig.longTermMemoryManagementEnabled` 控制长期记忆管理入口可见性。字段为 `true` 或缺失时，入口 MUST 保持当前默认可见行为；字段为 `false` 时，入口 MUST NOT 渲染。

Local 宿主 MUST 继续不渲染长期记忆管理入口。Immersive 与 Collaborative/PIU 宿主 MUST 使用同一个 `longTermMemoryManagementEnabled` 值控制所有长期记忆管理入口。关闭入口 MUST NOT 影响直达 `#/memory` 的既有行为，也 MUST NOT 修改长期记忆 API 或记忆能力执行语义。

**需求类别**：功能性需求

#### Scenario: 默认显示长期记忆管理入口

- **WHEN** `longTermMemoryManagementEnabled` 为 `true` 或缺失
- **THEN** Immersive 与 Collaborative/PIU 宿主中的长期记忆管理入口 MUST 保持当前可见行为
- **AND** Local 宿主 MUST 继续不渲染该入口

#### Scenario: 关闭长期记忆管理入口

- **WHEN** `longTermMemoryManagementEnabled` 为 `false`
- **THEN** Immersive 与 Collaborative/PIU 宿主中的长期记忆管理入口 MUST NOT 渲染
- **AND** 直达 `#/memory` 的既有行为 MUST 保持不变
- **AND** 长期记忆 API 和记忆能力执行语义 MUST 保持不变

#### Scenario: 多宿主入口一致

- **WHEN** `longTermMemoryManagementEnabled` 为 `false`
- **THEN** Immersive 与 Collaborative/PIU 中的所有长期记忆管理入口 MUST 均不可见
- **AND** MUST NOT 出现一个宿主隐藏、另一个宿主仍可见的行为

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：长期记忆管理入口由 `longTermMemoryManagementEnabled` 统一控制，默认在 Immersive 与 Collaborative/PIU 中可见，`false` 时隐藏；Local 继续不可见。
- **依据 Requirements**：`Long-term memory management entry gate`

### 规格

- **规格项**：长期记忆管理入口开关
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`longTermMemoryManagementEnabled` 默认 `true`；仅 `false` 时隐藏 Immersive 与 Collaborative/PIU 入口。
- **依据 Requirements**：`Long-term memory management entry gate`
