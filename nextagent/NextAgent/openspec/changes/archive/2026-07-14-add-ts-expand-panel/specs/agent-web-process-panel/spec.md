# agent-web-process-panel Specification

## MODIFIED Requirements

### Requirement: TOOL_STRUCTURED_DELTA 过程面板处理

`buildProcessTimelineEntries()` SHALL 处理 `TOOL_STRUCTURED_DELTA` 事件。`TITLE` 类型 SHALL 新建过程条目并设为最近 TITLE 条目。`DETAIL` 类型 SHALL 累积到最近 TITLE 条目的 detail。`SUB_TITLE` 类型 SHALL 新建过程条目并设为最近 SUB_TITLE 条目。`SUB_DETAIL` 和 `SUB_CONCLUSION` 类型 SHALL 累积到最近 SUB_TITLE 条目的 detail。`ANSWER` 类型 MUST NOT 创建过程面板条目。`EXPAND_PANEL` 类型 MUST NOT 创建独立过程条目，SHALL 将数据挂到最近 TITLE 条目的 `expandPanelData` 字段上并设置 `hasExpandPanel` 为 true。如果 `EXPAND_PANEL` 到达时 `lastStructuredTitleEntry` 为 null，该事件 MUST 被忽略。当同一 `toolCallId` 有 `TOOL_STRUCTURED_DELTA` 事件时，`CAPABILITY_STARTED` 和 `CAPABILITY_COMPLETED` MUST NOT 在过程面板生成条目。

#### Scenario: EXPAND_PANEL 挂到最近 TITLE

- **GIVEN** 已存在 `lastStructuredTitleEntry`
- **WHEN** 收到 `toolEventType: "EXPAND_PANEL"` 的 `TOOL_STRUCTURED_DELTA` 事件
- **THEN** 该 TITLE 条目的 `expandPanelData` MUST 设置为 `{ toolMessageType, content }`
- **AND** 该 TITLE 条目的 `hasExpandPanel` MUST 为 true
- **AND** MUST NOT 创建独立过程条目

#### Scenario: EXPAND_PANEL 无 TITLE 时被忽略

- **GIVEN** `lastStructuredTitleEntry` 为 null
- **WHEN** 收到 `toolEventType: "EXPAND_PANEL"` 的 `TOOL_STRUCTURED_DELTA` 事件
- **THEN** 该事件 MUST 被忽略

#### Scenario: 有 expandPanelData 的 TITLE 条目可交互

- **WHEN** 过程面板渲染 `hasExpandPanel` 为 true 的 TITLE 条目
- **THEN** 鼠标悬停时 cursor MUST 为 `pointer`
- **AND** 鼠标悬停时 MUST 显示 tooltip "点击打开扩展面板"
- **AND** 点击 MUST 触发扩展面板打开

#### Scenario: 无 expandPanelData 的 TITLE 条目不可交互

- **WHEN** 过程面板渲染 `hasExpandPanel` 为 false 或 undefined 的 TITLE 条目
- **THEN** cursor MUST NOT 为 `pointer`
- **AND** MUST NOT 显示 tooltip
- **AND** 点击 MUST NOT 触发扩展面板
