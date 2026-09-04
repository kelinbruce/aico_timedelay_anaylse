## ADDED Requirements

### Requirement: AICOConfig configuration type and field definitions

AICOConfig SHALL be a JSON-compatible configuration object that customizes NextAgent frontend UI appearance, behavior switches, layout, and PIU rendering injection points. All fields are optional; when the entire AICOConfig is absent or any individual field is absent, the corresponding UI element or behavior MUST use the current hardcoded default. AICOConfig MUST NOT introduce any behavior change when no field is provided.

The following fields and types SHALL be supported:

- `containerId?: string` — collaborative mode host container element ID
- `icon?: string` — base64-encoded icon for the top bar / sidebar header icon
- `activeIcon?: string` — base64-encoded active state icon (reserved, not consumed in this change)
- `entranceIcon?: string` — base64-encoded icon for the collaborative entrance button
- `guideIcon?: string` — base64-encoded icon for the welcome page brand icon
- `name?: string` — display title text replacing the hardcoded "NextAgent"
- `welcome?: string` — welcome subtitle text replacing the i18n default
- `modalSize?: ModalSize` — collaborative panel size control (width, height, minWidth)
- `clearStorage?: boolean` — when true, collaborative mode MUST NOT restore the previous session
- `declaration?: boolean | { title: string; tips: string }` — controls the bottom disclaimer area
- `showAskTime?: boolean` — when true, displays the timestamp on user question messages
- `showThinkingChain?: boolean` — when false, hides the "full process" entry in ProcessPanel
- `operators?: Operator[]` — custom operator buttons in the toolbar / sidebar
- `answerOperator?: PIUInfoItem` — replaces the default BubbleActions for assistant answers
- `quickInfo?: { type: QuickType; data?: PIUInfoItem }` — controls the input-above area
- `inputOperator?: PIUInfoItem` — replaces the slash-hint area inside the composer
- `layoutConfig?: { expandPanelPosition?: ExpandPanelPosition; operatorPosition?: ToolBarPosition }` — layout configuration
- `guideInfo?: { type: GuideAreaType; data?: PIUInfoItem }` — controls the welcome page guide area

All icon fields (`icon`, `activeIcon`, `entranceIcon`, `guideIcon`, `Operator.lightIcon`, `Operator.darkIcon`) MUST be base64-encoded strings. The frontend MUST render them via `<img src="data:image/...;base64,...">` or equivalent.

Supporting types:

- `ModalSize`: `{ width?: number | string; height?: number | string; minWidth?: number | string }`
- `PIUInfoItem`: `{ piuName: string; piuVersion: string; renderFunc: string; data?: Record<string, unknown>; width?: number | string; height?: number | string }`
- `QuickType`: enum `SKILL_LIST | SELF_DEFINE | CATEGORY_RECOMMEND`
- `OperatorPosition`: enum `OUTER | INNER`
- `OperatorType`: enum `PANEL | MODAL`
- `ExpandPanelPosition`: enum `LEFT | RIGHT`
- `ToolBarPosition`: enum `LEFT | RIGHT`
- `Operator`: `{ lightIcon: string; darkIcon: string; enName: string; zhName: string; position: OperatorPosition; type: OperatorType; data: PIUInfoItem }`
- `GuideAreaType`: enum `HIGH_FREQUENCY_RECOMMEND | SELF_DEFINE`

#### Scenario: No AICOConfig provided
- **WHEN** no AICOConfig is provided in any mode
- **THEN** all UI elements and behaviors MUST remain identical to the current hardcoded defaults
- **AND** no error or warning MUST be emitted

#### Scenario: AICOConfig with only partial fields
- **WHEN** AICOConfig is provided with only `{ name: "网络助手" }` and no other fields
- **THEN** the display title MUST become "网络助手"
- **AND** all other UI elements and behaviors MUST remain at their current defaults

#### Scenario: Base64 icon field is rendered
- **WHEN** AICOConfig provides `entranceIcon` as a base64 string
- **THEN** the collaborative entrance button MUST render the decoded image
- **AND** if the base64 string is malformed, the frontend MUST fall back to the default logo and emit a console warning

### Requirement: AICOConfig injection paths per host mode

AICOConfig SHALL be injected through mode-specific paths:

- **Immersive mode**: The frontend MUST read AICOConfig from `sessionStorage` using the key `AICOConfig` during page load. The value MUST be a JSON string. The frontend MUST parse and validate it once at startup. Page refresh MUST trigger a fresh read.
- **Collaborative mode**: The frontend MUST receive AICOConfig through the PIU `loadAIAgent` handler payload. The payload MUST be the complete AICOConfig object. The frontend MUST parse and validate it once when `loadAIAgent` is invoked. No hot update is supported.
- **Local mode**: The frontend MUST NOT read or consume AICOConfig. All UI MUST use hardcoded defaults.

In all modes, AICOConfig MUST be read exactly once at startup. The frontend MUST NOT support runtime configuration updates. If a new `loadAIAgent` is emitted in collaborative mode, the new AICOConfig MUST fully replace the previous one (not merge).

#### Scenario: Immersive mode reads AICOConfig from sessionStorage
- **GIVEN** `sessionStorage["AICOConfig"]` contains a valid JSON string
- **WHEN** the immersive page loads
- **THEN** the frontend MUST parse the JSON and apply the configuration
- **AND** the configuration MUST NOT be re-read during the same page session without a refresh

#### Scenario: Collaborative mode receives AICOConfig via loadAIAgent
- **GIVEN** the collaborative host emits `loadAIAgent` with a full AICOConfig payload
- **WHEN** the `loadAIAgent` handler processes the payload
- **THEN** the frontend MUST parse and validate the AICOConfig
- **AND** the frontend MUST apply the configuration to the rendered PIU panel

#### Scenario: Local mode ignores AICOConfig
- **WHEN** local mode is active
- **THEN** the frontend MUST NOT read `sessionStorage["AICOConfig"]`
- **AND** all UI MUST use hardcoded defaults

#### Scenario: AICOConfig is re-emitted in collaborative mode
- **GIVEN** collaborative mode has already applied an AICOConfig
- **WHEN** the host emits `loadAIAgent` again with a different AICOConfig
- **THEN** the new AICOConfig MUST fully replace the previous one
- **AND** any active custom PANEL MUST be unmounted before applying the new config

### Requirement: AICOConfig validation uses hand-written functions

AICOConfig validation SHALL use hand-written TypeScript validation functions, not TypeBox/Ajv or other schema validation libraries. Validation MUST be performed at the boundary where AICOConfig enters the frontend (sessionStorage read or `loadAIAgent` handler).

Validation rules:
- The top-level value MUST be an object or null/undefined. If null/undefined, all defaults apply.
- Each field MUST be validated against its expected type. Unknown fields MUST be silently ignored.
- String fields MUST be non-empty after trimming to be considered valid; empty strings are treated as absent.
- Array fields (`operators`) MUST be validated per-element; invalid elements MUST be filtered out with a console warning.
- Enum fields MUST be validated against their allowed values; invalid values MUST fall back to the default for that field.
- Base64 icon strings MUST be validated as non-empty strings; format validation beyond non-emptiness is not required at validation time (malformed base64 is handled at render time with fallback).
- If the entire AICOConfig is invalid (not an object), the frontend MUST fall back to all defaults and emit a single console warning.

#### Scenario: Valid AICOConfig is accepted
- **WHEN** a well-formed AICOConfig JSON object is provided
- **THEN** all valid fields MUST be applied
- **AND** unknown fields MUST be silently ignored

#### Scenario: Invalid AICOConfig falls back to defaults
- **WHEN** AICOConfig is a string, number, or array instead of an object
- **THEN** the frontend MUST ignore the entire configuration
- **AND** all defaults MUST be used
- **AND** a single console warning MUST be emitted

#### Scenario: Partially invalid operators are filtered
- **WHEN** AICOConfig provides `operators` where one element has an invalid `position` value
- **THEN** that element MUST be filtered out with a console warning
- **AND** remaining valid operators MUST be applied

### Requirement: AICOConfig default behavior when fields are absent

When an AICOConfig field is absent or invalid, the frontend MUST apply the following defaults:

- `containerId`: uses the `containerId` from the `loadAIAgent` call (collaborative mode only)
- `icon`: uses the built-in logo SVG
- `activeIcon`: not consumed (reserved)
- `entranceIcon`: uses the built-in logo SVG
- `guideIcon`: uses the built-in logo SVG
- `name`: uses "NextAgent"
- `welcome`: uses i18n `welcome.subtitle`
- `modalSize`: uses `DOCKED_DEFAULT_WIDTH` (484px) and current default height/minWidth
- `clearStorage`: false (restores previous session in collaborative mode)
- `declaration`: uses current i18n default disclaimer text and tips
- `showAskTime`: false (no timestamp on user messages)
- `showThinkingChain`: true (shows "full process" entry)
- `operators`: empty array (only default buttons shown)
- `answerOperator`: uses default BubbleActions (copy/like/dislike/favorite/fork/share)
- `quickInfo`: uses default `SKILL_LIST` (SkillSelector)
- `inputOperator`: uses default slash-hint ("输入 / 查看命令")
- `layoutConfig`: uses default layout (`operatorPosition: LEFT`, `expandPanelPosition: RIGHT`)
- `guideInfo`: uses default `HIGH_FREQUENCY_RECOMMEND` (HighFrequencyQuestions)

#### Scenario: Absent fields use defaults
- **WHEN** AICOConfig is an empty object `{}`
- **THEN** every UI element and behavior MUST be identical to having no AICOConfig at all
- **AND** no visual or behavioral difference MUST be observable

#### Scenario: Absent operators shows only default buttons
- **WHEN** AICOConfig does not include `operators`
- **THEN** the toolbar / sidebar MUST show only the default buttons (new session, search, favorites, etc.)
