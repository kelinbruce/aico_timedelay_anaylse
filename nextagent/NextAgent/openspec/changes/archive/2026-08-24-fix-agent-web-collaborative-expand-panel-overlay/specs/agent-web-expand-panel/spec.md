# agent-web-expand-panel Delta Specification

**所属 Function**：`agent-web-expand-panel`
**Function 变更类型**：修改
**spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Collaborative 模式下的扩展面板布局

在 collaborative 模式下，扩展面板 SHALL 永远位于左侧。扩展面板打开时，PIU 对话面板 MUST 强制变为 docked-right 状态，宽度 MUST 重置为基准宽度。基准宽度 MUST 为 `AICOConfig.modalSize.width` 的有效数值配置；未提供有效数值配置时 MUST 为 `DOCKED_DEFAULT_WIDTH`（484px）。如果 PIU 面板当前为 floating 或 maximized 状态，MUST 先切换为 docked 再设置宽度。`expandPanelPosition` 配置在 collaborative 模式下 MUST 被忽略。

当 PIU 对话面板宽度小于或等于基准宽度时，扩展面板 MUST 填充 PIU 对话面板左侧的剩余视口宽度。当 PIU 对话面板宽度大于基准宽度时，扩展面板 MUST 保持基准边界，PIU 对话面板 MUST 覆盖在扩展面板之上；扩展面板 MUST NOT 跟随 PIU 对话面板继续压缩。PIU 对话内容 MUST 填充当前 PIU 对话面板宽度。关闭扩展面板后，PIU 面板宽度 MUST 保持基准宽度，不恢复用户之前拖拽的宽度。

**需求类别**：功能性需求

#### Scenario: Collaborative 模式打开扩展面板

- **WHEN** collaborative 模式下扩展面板打开
- **THEN** 扩展面板 MUST 在左侧
- **AND** PIU 对话面板 MUST 在右侧
- **AND** PIU 对话面板宽度 MUST 重置为基准宽度
- **AND** PIU 对话内容 MUST 填充 PIU 对话面板

#### Scenario: 基准宽度内共享视口

- **GIVEN** collaborative 模式下扩展面板已打开
- **WHEN** PIU 对话面板宽度小于或等于基准宽度
- **THEN** 扩展面板 MUST 填充 PIU 对话面板左侧的剩余视口宽度

#### Scenario: 超过基准宽度时覆盖扩展面板

- **GIVEN** collaborative 模式下扩展面板已打开
- **WHEN** PIU 对话面板被拖拽为大于基准宽度
- **THEN** 扩展面板 MUST 保持基准边界
- **AND** PIU 对话面板 MUST 覆盖在扩展面板之上
- **AND** PIU 对话内容 MUST 填充拖拽后的 PIU 对话面板宽度

#### Scenario: Collaborative 模式忽略 expandPanelPosition

- **WHEN** collaborative 模式下 `expandPanelPosition` 为 `RIGHT`
- **THEN** 扩展面板 MUST 仍在左侧

#### Scenario: 用户拖拽后触发扩展面板

- **GIVEN** collaborative 模式下用户已拖拽 PIU 面板改变宽度
- **WHEN** 扩展面板被触发打开
- **THEN** PIU 面板宽度 MUST 重置为基准宽度
- **AND** 扩展面板 MUST 填充左侧剩余区域

#### Scenario: PIU 面板为 floating 时触发扩展面板

- **GIVEN** collaborative 模式下 PIU 面板为 floating 状态
- **WHEN** 扩展面板被触发打开
- **THEN** PIU 面板 MUST 切换为 docked-right
- **AND** PIU 面板宽度 MUST 重置为基准宽度

#### Scenario: PIU 面板为 maximized 时触发扩展面板

- **GIVEN** collaborative 模式下 PIU 面板为 maximized 状态
- **WHEN** 扩展面板被触发打开
- **THEN** PIU 面板 MUST 切换为 docked-right
- **AND** PIU 面板宽度 MUST 重置为基准宽度

#### Scenario: 关闭扩展面板后 PIU 面板保持默认宽度

- **GIVEN** collaborative 模式下扩展面板已打开，PIU 面板为基准宽度
- **WHEN** 扩展面板关闭
- **THEN** PIU 面板宽度 MUST 保持基准宽度
- **AND** MUST NOT 恢复用户之前拖拽的宽度

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：collaborative 模式左侧扩展面板在 PIU 面板不超过基准宽度时与 PIU 面板共享视口；超过基准宽度时保持基准边界并被 PIU 面板覆盖，PIU 对话内容始终填满自身面板。
- **依据 Requirements**：`Collaborative 模式下的扩展面板布局`

### 规格

- **规格项**：Collaborative 扩展面板宽度边界
- **变更类型**：修改
- **原规格值**：扩展面板填充 PIU 对话面板之外的剩余区域
- **目标规格值**：PIU 面板宽度 ≤ 基准宽度时共享剩余视口；PIU 面板宽度 > 基准宽度时扩展面板保持基准边界并被覆盖
- **依据 Requirements**：`Collaborative 模式下的扩展面板布局`

### 主规格

- **变更类型**：修改
- **目标内容**：`agent-web-expand-panel`
- **依据 Requirements**：`Collaborative 模式下的扩展面板布局`
