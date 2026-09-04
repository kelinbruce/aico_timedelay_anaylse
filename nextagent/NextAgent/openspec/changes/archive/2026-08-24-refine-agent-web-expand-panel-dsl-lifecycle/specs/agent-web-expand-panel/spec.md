# agent-web-expand-panel Delta Specification

## ADDED Requirements

### Requirement: 扩展面板内容来源

扩展面板 SHALL 区分内容来源，以决定布局、header 显隐和生命周期回调行为。

- `'react'`：前端通过 `setContent` 渲染结构化内容。
- `'view'`：前端通过 `setView` 渲染 React 视图页。
- `'dsl'`：DSL 引擎通过 `@cloudsop/dsl-engine-web` 的 `init` 方法直接接管容器渲染。
- `null`：面板未打开。

#### Scenario: 设置内容来源

- **WHEN** `setContent` 被调用
- **THEN** `contentSource` MUST 变为 `'react'`

- **WHEN** `setView` 被调用
- **THEN** `contentSource` MUST 变为 `'view'`

- **WHEN** `openDsl` 被调用
- **THEN** `contentSource` MUST 变为 `'dsl'`

- **WHEN** `close` 或 `closeDsl` 被调用
- **THEN** `contentSource` MUST 变为 `null`

### Requirement: DSL 引擎打开时隐藏 header

当 `contentSource === 'dsl'` 时，扩展面板 SHALL 不渲染 header（含关闭按钮）。

#### Scenario: DSL 内容源不显示 header

- **GIVEN** `contentSource` 为 `'dsl'`
- **WHEN** 扩展面板打开
- **THEN** header 区域 MUST 不被渲染

#### Scenario: 非 DSL 内容源显示 header

- **GIVEN** `contentSource` 为 `'react'` 或 `'view'`
- **WHEN** 扩展面板打开
- **THEN** header 区域 MUST 被渲染

### Requirement: DSL 引擎生命周期回调

扩展面板 SHALL 提供 `registerDslClearHandler` 方法，允许外部注册一个无参回调。当 `contentSource` 从 `'dsl'` 切换到其他来源，或面板被外部关闭时，该回调 MUST 被调用。

#### Scenario: 外部关闭触发 DSL 清理

- **GIVEN** `contentSource` 为 `'dsl'` 且已注册 DSL 清理回调
- **WHEN** `close()` 被调用
- **THEN** 已注册的 DSL 清理回调 MUST 被调用一次
- **AND** `contentSource` MUST 变为 `null`

#### Scenario: 切换到 React 内容触发 DSL 清理

- **GIVEN** `contentSource` 为 `'dsl'` 且已注册 DSL 清理回调
- **WHEN** `setContent()` 被调用
- **THEN** 已注册的 DSL 清理回调 MUST 被调用一次
- **AND** `contentSource` MUST 变为 `'react'`

#### Scenario: 切换到视图页触发 DSL 清理

- **GIVEN** `contentSource` 为 `'dsl'` 且已注册 DSL 清理回调
- **WHEN** `setView()` 被调用
- **THEN** 已注册的 DSL 清理回调 MUST 被调用一次
- **AND** `contentSource` MUST 变为 `'view'`

#### Scenario: DSL 正常关闭不触发清理回调

- **GIVEN** `contentSource` 为 `'dsl'` 且已注册 DSL 清理回调
- **WHEN** DSL 引擎调用 `handleExpandPanel(false)`，进而调用 `closeDsl()`
- **THEN** 已注册的 DSL 清理回调 MUST NOT 被调用
- **AND** `contentSource` MUST 变为 `null`

### Requirement: 按来源重新挂载容器

扩展面板容器 div 的 React key SHALL 基于 `contentSource`，确保来源切换时 React 重新挂载容器，清空 DSL 注入的 DOM。

#### Scenario: 来源切换清空容器

- **GIVEN** 扩展面板当前显示 DSL 内容
- **WHEN** `contentSource` 从 `'dsl'` 变为 `'react'` 或 `'view'`
- **THEN** 容器 div MUST 被重新挂载，原有 DSL DOM 被清除
