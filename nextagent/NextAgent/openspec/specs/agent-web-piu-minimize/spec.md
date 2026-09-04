# agent-web-piu-minimize Specification

## Purpose
定义协作式 PIU 宿主内的最小化范围、交互状态和恢复行为，确保该视图控制不会改变其他宿主的请求生命周期或会话事实。
## Requirements
### Requirement: Minimize capability is scoped to collaborative PIU only

The `minimizeAIAgent` handler and the `nextagent:piu-display-change` CustomEvent listener SHALL only be registered in `registerAIAgentPIU`. The immersive entry (`immersive.tsx`) and local entry (`local.tsx`) MUST NOT register `minimizeAIAgent` or listen for the CustomEvent. The `AIAgentPiuRuntime` component and `MinimizedInputBox` SHALL only render in collaborative mode.

#### Scenario: Immersive mode does not register minimizeAIAgent
- **GIVEN** the immersive entry point (`immersive.tsx`) has started
- **WHEN** `piu.attach` is called
- **THEN** the attached handlers MUST NOT include `minimizeAIAgent`
- **AND** no `nextagent:piu-display-change` listener SHALL be active

#### Scenario: Local mode does not register minimizeAIAgent
- **GIVEN** the local entry point (`local.tsx`) has started
- **WHEN** the mock prel starts
- **THEN** `piu.attach` MUST NOT be called with `minimizeAIAgent`
- **AND** no `nextagent:piu-display-change` listener SHALL be active

### Requirement: PIU exposes minimizeAIAgent handler through attach

PIU SHALL register a `minimizeAIAgent` handler in `piu.attach()` alongside existing handlers. The handler SHALL call `aiAgentPiuRuntimeStore.minimize()` with no payload. The integrator triggers minimization by calling `piu.emit('minimizeAIAgent')`.

The `minimizeAIAgent` handler SHALL be independent from `displayAIAgent`. Calling `minimizeAIAgent` SHALL NOT modify `showEntrance` or `showPanel`. Calling `displayAIAgent` SHALL NOT modify `minimized`.

The `minimizeAIAgent` handler type SHALL be declared in the `createHandlers` return type, following the same pattern as `loadAIAgent`, `displayAIAgent`, and `sendQuestionToLui`. The `PIU.attach` type in `prel.ts` SHALL NOT be modified.

#### Scenario: minimizeAIAgent handler is registered
- **GIVEN** PIU has been registered via `registerAIAgentPIU()`
- **WHEN** `prel.start` callback fires and `piu.attach()` is called
- **THEN** the attached handlers MUST include `minimizeAIAgent`
- **AND** `minimizeAIAgent` MUST be a function that accepts no required arguments

#### Scenario: minimizeAIAgent triggers minimized state
- **GIVEN** PIU panel is open with `showPanel === true` and `minimized === false`
- **WHEN** the `minimizeAIAgent` handler is called
- **THEN** `aiAgentPiuRuntimeStore.getSnapshot().display.minimized` MUST be `true`
- **AND** `display.showEntrance` MUST remain unchanged
- **AND** `display.showPanel` MUST remain unchanged

#### Scenario: minimizeAIAgent does not affect displayAIAgent state
- **GIVEN** PIU panel is open with `showEntrance === true` and `showPanel === true`
- **WHEN** `minimizeAIAgent` is called
- **THEN** `display.showEntrance` MUST still be `true`
- **AND** `display.showPanel` MUST still be `true`
- **AND** `display.minimized` MUST be `true`

#### Scenario: minimizeAIAgent when panel is hidden is a no-op
- **GIVEN** PIU panel is hidden with `showPanel === false` and `minimized === false`
- **WHEN** the `minimizeAIAgent` handler is called
- **THEN** `display.minimized` MUST remain `false`
- **AND** `display.showPanel` MUST remain `false`

### Requirement: CustomEvent triggers minimization only

PIU SHALL listen for the `nextagent:piu-display-change` CustomEvent on `window`. When `event.detail.minimized === true`, PIU SHALL call `aiAgentPiuRuntimeStore.minimize()`. When `event.detail.minimized` is `false` or absent, PIU MUST ignore the event and SHALL NOT call `store.restoreFromMinimized()`.

The event listener SHALL be registered in `registerAIAgentPIU` during the `prel.start` callback, alongside `piu.attach` handlers. The listener SHALL persist for the page lifetime; `registerAIAgentPIU` has no PIU unmount mechanism and the listener does not require separate cleanup.

#### Scenario: CustomEvent with minimized true triggers minimization
- **GIVEN** PIU panel is open with `minimized === false`
- **WHEN** `window.dispatchEvent(new CustomEvent('nextagent:piu-display-change', { detail: { minimized: true } }))` is called
- **THEN** `aiAgentPiuRuntimeStore.getSnapshot().display.minimized` MUST be `true`

#### Scenario: CustomEvent with minimized false is ignored
- **GIVEN** PIU panel is minimized with `minimized === true`
- **WHEN** `window.dispatchEvent(new CustomEvent('nextagent:piu-display-change', { detail: { minimized: false } }))` is called
- **THEN** `display.minimized` MUST remain `true`
- **AND** `store.restoreFromMinimized()` MUST NOT have been called

#### Scenario: CustomEvent without detail is ignored
- **GIVEN** PIU panel is open with `minimized === false`
- **WHEN** `window.dispatchEvent(new CustomEvent('nextagent:piu-display-change'))` is called
- **THEN** `display.minimized` MUST remain `false`

### Requirement: Display state model includes minimized field

`AIAgentDisplayState` SHALL include a `minimized: boolean` field with default value `false`. The `normalizeDisplayState` function SHALL enforce: when `minimized === true` and `showPanel === false`, `minimized` MUST be set to `false` (a hidden panel cannot be minimized).

The existing constraint `showEntrance === false && showPanel === true → showPanel = false` SHALL remain unchanged.

#### Scenario: minimized defaults to false
- **WHEN** `defaultDisplayState` is inspected
- **THEN** `minimized` MUST be `false`

#### Scenario: minimized true with showPanel false is normalized to false
- **GIVEN** a display state `{ showEntrance: true, showPanel: false, minimized: true }`
- **WHEN** `normalizeDisplayState` is called
- **THEN** `minimized` MUST be `false`

#### Scenario: minimized true with showPanel true is preserved
- **GIVEN** a display state `{ showEntrance: true, showPanel: true, minimized: true }`
- **WHEN** `normalizeDisplayState` is called
- **THEN** `minimized` MUST be `true`
- **AND** `showPanel` MUST be `true`

### Requirement: Minimized rendering hides panel content without unmounting

When `display.minimized === true`, the PIU panel SHALL render a `MinimizedInputBox` fixed at the bottom-right corner of the screen. The panel header, resize handles, and body (including `ChatPageCore`) SHALL be hidden via CSS `display: none` and MUST NOT be unmounted.

The `ChatPageCore` component and its hooks (`useChatSessionStream`, `useChatViewportController`, `useChatComposerController`) SHALL continue running during minimization. SSE/WebSocket stream connections SHALL remain open. All Zustand stores (conversation, session, request, skill) SHALL retain their data.

When `display.minimized` transitions from `true` to `false`, the panel SHALL restore the previous layout (docked/floating/maximized) and make the header and body visible again. The `MinimizedInputBox` SHALL be removed.

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

### Requirement: Restore is triggered by MinimizedInputBox focus only

The `MinimizedInputBox` SHALL restore the panel from minimized state when its textarea receives focus. The `onFocus` event SHALL call `aiAgentPiuRuntimeStore.restoreFromMinimized()`. There SHALL be no other restore path; neither `displayAIAgent` handler nor CustomEvent SHALL trigger restore.

#### Scenario: Focus on MinimizedInputBox restores panel
- **GIVEN** PIU panel is in minimized state
- **WHEN** the MinimizedInputBox textarea receives focus
- **THEN** `display.minimized` MUST transition to `false`
- **AND** the panel MUST restore the previous layout

#### Scenario: displayAIAgent does not restore from minimized
- **GIVEN** PIU panel is in minimized state
- **WHEN** `displayAIAgent({ showEntrance: true, showPanel: true })` is called
- **THEN** `display.minimized` MUST remain `true`

### Requirement: MinimizedInputBox is a minimal empty textarea

The `MinimizedInputBox` SHALL render a single `<textarea>` element with no skill selector, attachments, retry/edit buttons, slash command panel, or association panel. The textarea SHALL be empty (no pre-filled content). The textarea placeholder SHALL use the i18n key `composer.placeholder`. The height of `MinimizedInputBox` SHALL be 40px, which is lower than the current `MessageInput` component.

#### Scenario: MinimizedInputBox renders empty textarea with composer placeholder
- **GIVEN** PIU panel is in minimized state with locale `zh-cn`
- **WHEN** `MinimizedInputBox` renders
- **THEN** the textarea MUST be empty
- **AND** the textarea placeholder MUST be the value of `composer.placeholder` for the current locale
- **AND** no skill selector, attachment, or slash command elements MUST be present

### Requirement: Minimization force-closes expand panel

When `store.minimize()` is called, if `expandPanelStore.getState().isOpen === true`, the minimize operation SHALL call `expandPanelStore.close()` before transitioning to minimized state. When the panel is restored from minimized state, the expand panel SHALL NOT automatically reopen.

#### Scenario: expandPanel open is closed on minimize
- **GIVEN** PIU panel is open with `expandPanelStore.isOpen === true`
- **WHEN** `store.minimize()` is called
- **THEN** `expandPanelStore.getState().isOpen` MUST be `false`
- **AND** `display.minimized` MUST be `true`

#### Scenario: expandPanel does not reopen on restore
- **GIVEN** PIU panel is minimized and was previously in minimized state
- **WHEN** the panel is restored via MinimizedInputBox focus
- **THEN** `expandPanelStore.getState().isOpen` MUST remain `false`
