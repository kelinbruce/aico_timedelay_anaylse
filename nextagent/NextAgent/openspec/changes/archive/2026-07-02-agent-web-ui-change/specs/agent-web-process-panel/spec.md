## ADDED Requirements

### Requirement: ProcessPanel 独立组件

对话过程面板 SHALL 作为独立 React 组件 `ProcessPanel` 实现，位于 `frontend/agent-web/src/features/chat/components/ProcessPanel.tsx`。`TurnBlock` SHALL 渲染该组件替代内联过程面板逻辑。

#### Scenario: TurnBlock 渲染 ProcessPanel
- **WHEN** 渲染 TurnBlock 且需要显示过程面板
- **THEN** TurnBlock MUST 渲染 `ProcessPanel` 组件

### Requirement: 过程面板图标

`ProcessPanel` SHALL 根据过程标题关键词和当前主题动态选择图标。图标类型 SHALL 包含 `think`（标题包含"思考"或"think"）、`skill`（标题包含"agent"或"skill"）、`process-complete`（默认）和 `final-complete`。每个图标 SHALL 有浅色和深色版本。

#### Scenario: 思考过程图标
- **WHEN** 过程标题包含"思考"或"think"
- **THEN** 图标类型 MUST 为 `think`

#### Scenario: 技能过程图标
- **WHEN** 过程标题包含"agent"或"skill"
- **THEN** 图标类型 MUST 为 `skill`

#### Scenario: 默认过程图标
- **WHEN** 过程标题不匹配任何关键词
- **THEN** 图标类型 MUST 为 `process-complete`

### Requirement: TurnBlock 过程面板提取

`TurnBlock` SHALL 移除内联的过程面板 CSS（`PROCESS_IDLE_SWEEP_CSS`）、`ProcessPanelMode` 类型、`persistedProcessPanelModes` 缓存和 `PROCESS_AUTO_COLLAPSE_DELAY_MS`、`PROCESS_PANEL_TRANSITION_MS`、`PROCESS_PANEL_TOP_GAP_PX` 常量。这些逻辑 SHALL 由 `ProcessPanel` 组件内部管理。

#### Scenario: TurnBlock 不包含已移除的过程面板逻辑
- **WHEN** 检查 TurnBlock 源码
- **THEN** MUST 不包含 `PROCESS_IDLE_SWEEP_CSS`、`ProcessPanelMode`、`persistedProcessPanelModes`
- **AND** MUST 包含 `ProcessPanel` 的 import
