# agent-web-piu-minimize Delta Specification

**所属 Function**：`FN-10.6 前端定制`
**Function 变更类型**：修改
**spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Minimized rendering hides panel content without unmounting

当 `display.minimized === true` 时，PIU 面板 SHALL 渲染 `MinimizedInputBox`。面板的 inline style SHALL 由 `{ ...defaults, ...aicoConfig?.minimizedStyle }` 计算，其中 defaults 为 `{ position: 'fixed', bottom: 16, right: 16, width: 360, borderRadius: 8 }`。`minimizedStyle` 中的键覆盖 defaults 中的同名键。

当 `minimizedStyle` 缺省时，最小化面板 MUST 使用 defaults 值（与当前行为一致）。

`closeBehavior: 'minimize'` 时，关闭按钮触发 `minimize()` SHALL 成为最小化的新触发路径。此路径 MUST 与 `minimizeAIAgent()` handler 触发的最小化行为完全一致。

`initialDisplayState: { minimized: true }` SHALL 作为初始最小化的新路径。`loadAIAgent` 时应用此初始状态 MUST 使面板在加载后立即进入最小化状态。

`normalizeDisplayState` 不再包含 `!showEntrance && showPanel` 规则。集成方可以在 `showEntrance: false` 的情况下设置 `showPanel: true`，用于自定义入口按钮场景。`normalizeDisplayState` 只保留 `minimized && !showPanel -> minimized: false` 规则。

当 `display.minimized === true` 且 `display.showEntrance === true` 时，入口按钮（`AIAgentEntrance`）SHALL 继续渲染。入口按钮的渲染条件 MUST NOT 受 `minimized` 状态影响。

**需求类别**：功能性需求

#### Scenario: minimizedStyle 覆盖最小化面板位置

- **GIVEN** PIU panel with `minimizedStyle: { left: 56, right: 'auto', bottom: 16, width: 320 }`
- **WHEN** 面板进入最小化状态
- **THEN** 最小化面板 MUST 使用 `left: 56`、`right: 'auto'`、`bottom: 16`、`width: 320`
- **AND** `borderRadius` MUST 保持默认值 `8`

#### Scenario: closeBehavior minimize 作为最小化触发路径

- **GIVEN** PIU panel with `closeBehavior: 'minimize'` and `showPanel === true`
- **WHEN** 用户点击关闭按钮
- **THEN** `minimize()` MUST 被调用
- **AND** `display.minimized` MUST 为 `true`
- **AND** `showPanel` MUST 保持 `true`
- **AND** SSE/WebSocket stream connections MUST 保持打开

#### Scenario: initialDisplayState minimized true 作为初始最小化路径

- **GIVEN** AICOConfig with `closeBehavior: 'minimize'` and `initialDisplayState: { showEntrance: false, showPanel: true, minimized: true }`
- **WHEN** `loadAIAgent` 被调用
- **THEN** `display.minimized` MUST 为 `true`
- **AND** `display.showPanel` MUST 为 `true`
- **AND** `display.showEntrance` MUST 为 `false`
- **AND** `MinimizedInputBox` MUST 被渲染

#### Scenario: normalizeDisplayState 允许 showEntrance=false + showPanel=true

- **WHEN** `normalizeDisplayState({ showEntrance: false, showPanel: true })` 被调用
- **THEN** 结果 MUST 为 `{ showEntrance: false, showPanel: true, minimized: false }`

#### Scenario: normalizeDisplayState 仍纠正 minimized=true + showPanel=false

- **WHEN** `normalizeDisplayState({ showEntrance: true, showPanel: false, minimized: true })` 被调用
- **THEN** 结果 MUST 为 `{ showEntrance: true, showPanel: false, minimized: false }`

#### Scenario: 最小化时入口按钮继续渲染

- **GIVEN** PIU panel with `showEntrance === true` and `minimized === true`
- **WHEN** 面板渲染
- **THEN** `AIAgentEntrance` MUST 继续渲染
- **AND** `MinimizedInputBox` MUST 也被渲染

#### Scenario: minimizedStyle 缺省使用默认位置

- **WHEN** AICOConfig 不包含 `minimizedStyle`
- **THEN** 最小化面板 MUST 使用 `{ position: 'fixed', bottom: 16, right: 16, width: 360, borderRadius: 8 }`

#### Scenario: Minimized panel renders MinimizedInputBox and hides body
- **GIVEN** PIU panel is open with `minimized === true`
- **WHEN** the panel renders
- **THEN** `MinimizedInputBox` MUST be rendered
- **AND** the panel header MUST have `display: none`
- **AND** the panel body MUST have `display: none`
- **AND** `ChatPageCore` MUST remain mounted in the React tree

#### Scenario: Minimized panel is fixed at bottom-right
- **GIVEN** PIU panel is open with `minimized === true` and layout kind is `docked`
- **WHEN** the panel renders
- **THEN** the panel container MUST be positioned at the bottom-right corner of the viewport
- **AND** the current `CollaborativePanelLayout` state MUST NOT be modified

#### Scenario: Stream connection persists during minimization
- **GIVEN** PIU panel is open with an active SSE stream and `minimized` transitions to `true`
- **WHEN** the panel is in minimized state
- **THEN** the SSE stream connection MUST remain open
- **AND** incoming stream messages MUST continue to be written to `conversationStore`

#### Scenario: Restore returns to previous layout
- **GIVEN** PIU panel is minimized and the previous layout was `floating`
- **WHEN** `display.minimized` transitions to `false`
- **THEN** the panel MUST render with the `floating` layout
- **AND** the header and body MUST be visible
- **AND** `MinimizedInputBox` MUST NOT be rendered

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：`minimizedStyle` 覆盖最小化面板位置、`closeBehavior: 'minimize'` 作为最小化触发路径、`initialDisplayState: { minimized: true }` 作为初始最小化路径、`normalizeDisplayState` 移除 `!showEntrance && showPanel` 规则。
- **依据 Requirements**：`Minimized rendering hides panel content without unmounting`

### 规格

- **规格项**：PIU 最小化渲染与触发
- **变更类型**：修改
- **目标规格值**：`minimizedStyle` 样式覆盖、`closeBehavior` 触发路径、`initialDisplayState` 初始最小化、`normalizeDisplayState` 移除规则
- **依据 Requirements**：`Minimized rendering hides panel content without unmounting`

### 主规格

- **变更类型**：修改
- **目标内容**：`agent-web-piu-minimize`
- **依据 Requirements**：`Minimized rendering hides panel content without unmounting`
