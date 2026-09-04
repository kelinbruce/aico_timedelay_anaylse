# agent-web-structured-message-rendering Specification

## MODIFIED Requirements

### Requirement: PIU Message Rendering

`PiuMessage` 组件 SHALL 从 `PiuContext` 获取 `piu` 对象。组件 SHALL 使用 `useId()` 生成 `wrapperId`。组件 SHALL 调用 `window.Prel.autoLoad(piuName, piuVersion)` 加载远端 PIU 组件，加载成功后调用 `piu.emit(method, payload)`。payload SHALL 包含原始 `content`、`wrapperId`、`containerId`（值为 `wrapperId`）。payload SHALL 额外注入 `handleExpandPanelOpen`（函数）、`handleExpandPanelClose`（函数）和 `expandPanelId`（固定字符串）。`handleExpandPanelOpen` 调用后 SHALL 打开扩展面板，PIU 组件自行往 `expandPanelId` div 渲染内容。`handleExpandPanelClose` 调用后 SHALL 关闭扩展面板。

`piuName` MUST 匹配 `/^[A-Za-z0-9._-]+$/`。如果 `piuName` 无效、`piu` 为 null 或 `window.Prel` 不存在，组件 SHALL 渲染占位文本 "PIU 内容（本地不可预览）"。

#### Scenario: PIU 正常渲染

- **WHEN** `piuName` 有效且 `piu` 和 `window.Prel` 可用
- **THEN** 组件 MUST 调用 `window.Prel.autoLoad(piuName, piuVersion)`
- **AND** 加载成功后 MUST 调用 `piu.emit(method, payload)`
- **AND** payload MUST 包含 `handleExpandPanelOpen`、`handleExpandPanelClose` 和 `expandPanelId`

#### Scenario: PIU 调用 handleExpandPanelOpen

- **WHEN** PIU 组件调用 payload 中的 `handleExpandPanelOpen()`
- **THEN** 扩展面板 MUST 打开
- **AND** `expandPanelId` div MUST 可供 PIU 渲染

#### Scenario: PIU 调用 handleExpandPanelClose

- **WHEN** PIU 组件调用 payload 中的 `handleExpandPanelClose()`
- **THEN** 扩展面板 MUST 关闭

#### Scenario: piuName 无效

- **WHEN** `piuName` 不匹配 `/^[A-Za-z0-9._-]+$/` 或为空
- **THEN** 组件 MUST 渲染占位文本 "PIU 内容（本地不可预览）"
- **AND** MUST NOT 调用 `window.Prel.autoLoad`

#### Scenario: piu 或 Prel 不存在

- **WHEN** `piu` 为 null 或 `window.Prel` 不存在
- **THEN** 组件 MUST 渲染占位文本 "PIU 内容（本地不可预览）"
