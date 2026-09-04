# aico-display-control Specification

## Purpose
Define AICOConfig display and behavior switches for agent-web icons, title and welcome text, disclaimer rendering, session restoration, user message timestamps, and process entry visibility.
## Requirements
### Requirement: Icon fields use base64 and override defaults

AICOConfig icon fields（`icon`、`entranceIcon`、`guideIcon`）SHALL 是 base64-encoded strings that replace the corresponding default icons when provided. `activeIcon` is reserved and MUST NOT be consumed in this change.

Icon mapping:

- `icon`：replaces the top bar / sidebar header icon
- `entranceIcon`：replaces the collaborative entrance button icon
- `guideIcon`：replaces the welcome page brand icon

`entranceStyle` SHALL 是一个可选的 CSS 键值对对象，其键为 CSS 属性名（camelCase），值为 `string` 或 `number`。前端 MUST 将 `entranceStyle` 作为 inline style 叠加到入口按钮（`AIAgentEntrance` 的 `<button>`）上。`entranceStyle` 的 inline style MUST 覆盖 CSS class 中的同名属性。

When an icon field is absent, the corresponding default icon MUST be used. When a base64 string is malformed or cannot be decoded as an image, the frontend MUST fall back to the default icon and emit a `console.warn`. When `entranceStyle` is absent, the frontend MUST NOT apply additional inline style to the entrance button.

**需求类别**：功能性需求

#### Scenario: entranceStyle 叠加到入口按钮

- **GIVEN** AICOConfig with `entranceIcon: "data:image/png;base64,iVBOR..."` and `entranceStyle: { right: 16, bottom: '20px' }`
- **WHEN** the entrance button renders
- **THEN** the entrance button MUST display the decoded base64 icon
- **AND** the entrance button MUST apply `right: 16` and `bottom: '20px'` as inline style

#### Scenario: entranceStyle absent uses default styling

- **WHEN** AICOConfig does not provide `entranceStyle`
- **THEN** the entrance button MUST NOT apply additional inline style
- **AND** the entrance button MUST use CSS class default styling

### Requirement: name and welcome override display text

`name` SHALL override the display title text (currently hardcoded as "NextAgent"). `welcome` SHALL override the welcome subtitle text (currently from i18n `welcome.subtitle`).

When `name` is absent, the title MUST be "NextAgent". When `welcome` is absent, the subtitle MUST use the i18n default for the current locale.

#### Scenario: Custom name replaces title
- **GIVEN** AICOConfig with `name: "网络智能助手"`
- **WHEN** the header renders
- **THEN** the title text MUST be "网络智能助手" instead of "NextAgent"

#### Scenario: Custom welcome replaces subtitle
- **GIVEN** AICOConfig with `welcome: "欢迎使用网络智能助手"`
- **WHEN** the welcome page renders
- **THEN** the subtitle MUST be "欢迎使用网络智能助手" instead of the i18n default

### Requirement: declaration controls bottom disclaimer area

`declaration` SHALL control the bottom disclaimer area in `RightPaneLayout`. The behavior depends on the value type:

- `false`: the disclaimer area MUST NOT be rendered.
- `true`: the disclaimer MUST render with the current default i18n text (`rightPane.disclaimer` and `rightPane.disclaimerTip`).
- `{ title: string; tips: string }`: the disclaimer MUST render with `title` replacing the default disclaimer text and `tips` replacing the tooltip content.
- absent: the disclaimer MUST render with the current default i18n text (same as `true`).

#### Scenario: declaration false hides disclaimer
- **GIVEN** AICOConfig with `declaration: false`
- **WHEN** the layout renders
- **THEN** the disclaimer area MUST NOT be visible

#### Scenario: declaration true uses defaults
- **GIVEN** AICOConfig with `declaration: true`
- **WHEN** the layout renders
- **THEN** the disclaimer text MUST be the i18n default
- **AND** the tooltip content MUST be the i18n default

#### Scenario: declaration object customizes text
- **GIVEN** AICOConfig with `declaration: { title: "自定义声明", tips: "自定义提示内容" }`
- **WHEN** the layout renders
- **THEN** the disclaimer text MUST be "自定义声明"
- **AND** the tooltip content MUST be "自定义提示内容"

### Requirement: clearStorage controls session restoration

`clearStorage` SHALL control whether collaborative mode restores the previous session on load. When `clearStorage` is `true`, collaborative mode MUST NOT restore the previous session ID from `sessionStorage` and MUST start with a fresh welcome state. When `clearStorage` is `false` or absent, collaborative mode MUST restore the previous session as per the current behavior.

`clearStorage` MUST NOT affect local or immersive modes.

#### Scenario: clearStorage true starts fresh
- **GIVEN** collaborative mode with `clearStorage: true` and `sessionStorage["nextagent:AICOPIU:activeSessionId"]` contains "session-1"
- **WHEN** the panel loads
- **THEN** the panel MUST NOT restore "session-1"
- **AND** the panel MUST show the welcome state

#### Scenario: clearStorage false restores previous session
- **GIVEN** collaborative mode with `clearStorage: false` and `sessionStorage["nextagent:AICOPIU:activeSessionId"]` contains "session-1"
- **WHEN** the panel loads
- **THEN** the panel MUST restore "session-1" as the active session

### Requirement: showAskTime controls user message timestamp

`showAskTime` SHALL control the visibility of the timestamp on user question messages. When `true`, user question messages MUST display their creation timestamp. When `false` or absent, user question messages MUST NOT display a timestamp.

`showAskTime` MUST NOT affect assistant message timestamps.

#### Scenario: showAskTime true displays user timestamp
- **GIVEN** AICOConfig with `showAskTime: true`
- **WHEN** a user question message renders
- **THEN** the timestamp MUST be visible on the user message bubble

#### Scenario: showAskTime false hides user timestamp
- **GIVEN** AICOConfig with `showAskTime: false` or absent
- **WHEN** a user question message renders
- **THEN** no timestamp MUST be visible on the user message bubble

### Requirement: showThinkingChain controls full process entry

`showThinkingChain` SHALL control the visibility of the "full process" (完整过程) entry in the ProcessPanel. When `false`, the entry MUST be hidden. When `true` or absent, the entry MUST be visible (current default behavior).

Hiding the entry MUST NOT remove the ProcessPanel itself; only the "full process" timeline button is hidden. There is no other entry point to the thinking chain, so hiding this entry effectively prevents user access to the thinking chain view.

#### Scenario: showThinkingChain false hides entry
- **GIVEN** AICOConfig with `showThinkingChain: false`
- **WHEN** a ProcessPanel renders with process entries
- **THEN** the "full process" button MUST NOT be visible
- **AND** the ProcessPanel summary and collapsible details MUST still be visible

#### Scenario: showThinkingChain true or absent shows entry
- **GIVEN** AICOConfig with `showThinkingChain: true` or absent
- **WHEN** a ProcessPanel renders with process entries
- **THEN** the "full process" button MUST be visible (current default behavior)

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

