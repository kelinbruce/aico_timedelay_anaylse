## Function

- **所属 Function**：`FN-10.6 前端定制`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Portal full-process gate controls full process entry

`portalAbilityConfig.fullProcessEnabled` SHALL control the visibility of the “full process” entry in the ProcessPanel. When `false`, the entry MUST be hidden. When `true` or absent in a legacy bootstrap response, the entry MUST remain controlled by the existing process-data and `showThinkingChain` rules.

The final entry visibility MUST be the conjunction of process timeline availability, `AICOConfig.showThinkingChain !== false`, and `portalAbilityConfig.fullProcessEnabled !== false`. This gate MUST NOT remove the ProcessPanel summary or collapsible process entries.

**需求类别**：功能性需求

#### Scenario: portal full-process gate false hides entry

- **GIVEN** process details are available and `AICOConfig.showThinkingChain` is not `false`
- **AND** runtime bootstrap resolves `fullProcessEnabled: false`
- **WHEN** a ProcessPanel renders with expandable process entries
- **THEN** the “full process” button MUST NOT be visible
- **AND** the ProcessPanel summary and collapsible details MUST still be visible

#### Scenario: portal full-process gate true preserves existing behavior

- **GIVEN** process details are available and `AICOConfig.showThinkingChain` is not `false`
- **AND** runtime bootstrap resolves `fullProcessEnabled: true` or omits the legacy field
- **WHEN** a ProcessPanel renders with expandable process entries
- **THEN** the “full process” button MUST follow the existing visibility rules

#### Scenario: gates compose conservatively

- **GIVEN** either `AICOConfig.showThinkingChain: false` or `fullProcessEnabled: false`
- **WHEN** a ProcessPanel renders
- **THEN** the “full process” button MUST NOT be visible

## Function 变更汇总

### 规格

- **规格项**：完整过程入口显隐控制
- **变更类型**：新增
- **原规格值**：仅 `AICOConfig.showThinkingChain` 控制“完整过程”入口。
- **目标规格值**：`AICOConfig.showThinkingChain` 与 `portalAbilityConfig.fullProcessEnabled` 叠加控制“完整过程”入口；任一关闭即隐藏。
- **依据 Requirements**：`Portal full-process gate controls full process entry`
