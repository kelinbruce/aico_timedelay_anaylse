# agent-web-process-panel Specification Delta

所属 Function：`FN-10.6 前端定制`
Function 变更类型：修改
spec 角色：主规格

## ADDED Requirements

### Requirement: Runtime Capability 内 SUB_TITLE 层级视觉呈现

当 `SUB_TITLE` / `SUB_DETAIL` 结构化过程被归并到匹配 runtime Capability 卡片内部时，`ProcessPanel` MUST 继续把它们呈现为该卡片内部的结构化分段，MUST NOT 为 `SUB_TITLE` 创建第二个顶层 Capability 条目。该内部 `SUB_TITLE` 分段 MUST 使用当前主题的 circle icon，并以 subordinate 层级呈现标题和后续 `SUB_DETAIL` / `SUB_CONCLUSION` 内容。`SUB_DETAIL` 和 `SUB_CONCLUSION` MUST 继续累积到匹配的最近 `SUB_TITLE` 分段。

**需求类别**：功能性需求

#### Scenario: Runtime Bash 卡片呈现 SUB_TITLE 小圆圈和层级

- **GIVEN** 同一 `toolCallId` 下存在 runtime Bash Capability lifecycle
- **AND** 该 `toolCallId` 依次产生 `SUB_TITLE="小区分析"` 与 `SUB_DETAIL="RSRP 低于门限"`
- **WHEN** ProcessPanel 渲染该 Bash Capability 卡片
- **THEN** 卡片内部 MUST 呈现带当前主题 circle icon 的 `SUB_TITLE` 分段
- **AND** `SUB_TITLE` 分段 MUST 呈现 subordinate 层级
- **AND** `SUB_DETAIL` MUST 显示在该 `SUB_TITLE` 分段下
- **AND** ProcessPanel MUST NOT 为 `SUB_TITLE` 创建第二个顶层 Capability 条目

#### Scenario: 独立 SUB_TITLE 条目保持既有呈现

- **WHEN** `SUB_TITLE` 没有匹配 runtime Capability lifecycle，而是作为独立结构化过程条目渲染
- **THEN** 该条目 MUST 继续使用当前主题 circle icon
- **AND** 其 detail / conclusion 关联行为 MUST 保持不变

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：runtime Capability 内部的 `SUB_TITLE` 结构化分段保持单卡片归并，同时呈现 circle icon 和 subordinate 层级。
- **依据 Requirements**：`Runtime Capability 内 SUB_TITLE 层级视觉呈现`

### 规格

- **规格项**：Runtime Capability 内 SUB_TITLE 视觉层级
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`SUB_TITLE` 分段使用当前主题 circle icon，并以 subordinate 层级呈现其 detail / conclusion；不创建第二个顶层条目
- **依据 Requirements**：`Runtime Capability 内 SUB_TITLE 层级视觉呈现`

### 主规格

- **变更类型**：修改
- **目标内容**：`agent-web-process-panel`
- **依据 Requirements**：`Runtime Capability 内 SUB_TITLE 层级视觉呈现`
