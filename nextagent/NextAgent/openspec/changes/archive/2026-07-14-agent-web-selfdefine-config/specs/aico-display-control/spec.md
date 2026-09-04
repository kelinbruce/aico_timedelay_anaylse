## ADDED Requirements

### Requirement: Icon fields use base64 and override defaults

AICOConfig icon fields (`icon`, `entranceIcon`, `guideIcon`) SHALL be base64-encoded strings that replace the corresponding default icons when provided. `activeIcon` is reserved and MUST NOT be consumed in this change.

Icon mapping:
- `icon`: replaces the top bar / sidebar header icon (currently the built-in `logo.svg`)
- `entranceIcon`: replaces the collaborative entrance button icon (currently the built-in `logo.svg` in `AIAgentEntrance`)
- `guideIcon`: replaces the welcome page brand icon (currently the built-in `logo.svg` in `WelcomeState`)

When an icon field is absent, the corresponding default icon MUST be used. When a base64 string is malformed or cannot be decoded as an image, the frontend MUST fall back to the default icon and emit a `console.warn`.

#### Scenario: Custom icon replaces default
- **GIVEN** AICOConfig with `icon: "data:image/png;base64,iVBOR..."`
- **WHEN** the header renders
- **THEN** the header icon MUST display the decoded base64 image instead of the default logo

#### Scenario: Malformed base64 falls back to default
- **GIVEN** AICOConfig with `entranceIcon: "not-valid-base64!!!"`
- **WHEN** the entrance button renders
- **THEN** the default logo MUST be displayed
- **AND** a console warning MUST be emitted

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
- **GIVEN** collaborative mode with `clearStorage: true` and `sessionStorage["nextagent:AIAgentPIU:activeSessionId"]` contains "session-1"
- **WHEN** the panel loads
- **THEN** the panel MUST NOT restore "session-1"
- **AND** the panel MUST show the welcome state

#### Scenario: clearStorage false restores previous session
- **GIVEN** collaborative mode with `clearStorage: false` and `sessionStorage["nextagent:AIAgentPIU:activeSessionId"]` contains "session-1"
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
