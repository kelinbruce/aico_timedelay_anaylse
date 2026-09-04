# agent-web-piu-historical-chat-replay Specification

## Purpose
Define the collaborative-PIU attach handler `handleHistoricalChatReplay` behavior contract: receiving historical data replay payloads from external hosts, deduplicating by `chatId`, opening the conversation panel, and rendering replay content as PIU components above the message list in the conversation panel. This capability is scoped to the collaborative PIU entry only.
## Requirements
### Requirement: handleHistoricalChatReplay capability is scoped to collaborative PIU only

`handleHistoricalChatReplay` handler SHALL only be registered in `registerAIAgentPIU`（协作式入口）的 `createHandlers` 返回类型中。沉浸式入口（`immersive.tsx`）和本地入口（`local.tsx`）的 `piu.attach` MUST NOT 注册 `handleHistoricalChatReplay`。`PIU.attach` 类型声明（`prel.ts`）MUST NOT 被修改，`handleHistoricalChatReplay` 与 `renderKnowledge`/`minimizeAIAgent`/`loadAIAgent` 等协作式自定义 handler 同形，只在 `createHandlers` 返回类型声明。

**需求类别**：功能性需求

#### Scenario: Immersive mode does not register handleHistoricalChatReplay
- **GIVEN** the immersive entry point (`immersive.tsx`) has started
- **WHEN** `piu.attach` is called
- **THEN** the attached handlers MUST NOT include `handleHistoricalChatReplay`

#### Scenario: Local mode does not register handleHistoricalChatReplay
- **GIVEN** the local entry point (`local.tsx`) has started
- **WHEN** the mock prel starts
- **THEN** `piu.attach` MUST NOT include `handleHistoricalChatReplay`

#### Scenario: prel.ts PIU.attach type not modified
- **GIVEN** the change is implemented
- **WHEN** checking git diff of `prel.ts`
- **THEN** the `PIU.attach` type declaration MUST remain unchanged

### Requirement: PIU exposes handleHistoricalChatReplay handler through attach

PIU SHALL register a `handleHistoricalChatReplay` handler in `piu.attach()` within `registerAIAgentPIU`. The handler SHALL accept a payload `{ piuName: string, piuVersion: string, method: string, chatId: string, data: unknown }`. The `method` field is the `piu.emit` emit key used by `PiuRenderer` to render the replay PIU. The `chatId` field is the unique identifier for deduplication. The `data` field carries the business data passed to the PIU component.

The handler type SHALL be declared in the `createHandlers` return type, following the same pattern as `renderKnowledge`/`loadAIAgent`/`displayAIAgent`. `prel.ts` 的 `PIU.attach` 类型 SHALL NOT be modified.

**需求类别**：功能性需求

#### Scenario: handleHistoricalChatReplay handler is registered
- **GIVEN** PIU has been registered via `registerAIAgentPIU()`
- **WHEN** `prel.start` callback fires and `piu.attach()` is called
- **THEN** the attached handlers MUST include `handleHistoricalChatReplay`
- **AND** `handleHistoricalChatReplay` MUST be a function that accepts a payload with `piuName`, `piuVersion`, `method`, `chatId`, and `data`

### Requirement: handleHistoricalChatReplay payload validation

The handler SHALL validate that `piuName`, `piuVersion`, `method`, and `chatId` are non-empty strings (trimmed length > 0). If any of these fields is missing, empty, or not a string, the handler MUST `console.warn` and return without rendering or storing any replay entry.

**需求类别**：功能性需求

#### Scenario: Missing piuName warns and returns
- **GIVEN** `handleHistoricalChatReplay` is called with a payload where `piuName` is missing, empty, or whitespace-only
- **WHEN** the handler executes
- **THEN** the handler MUST warn and return without storing a replay entry

#### Scenario: Missing piuVersion warns and returns
- **GIVEN** `handleHistoricalChatReplay` is called with a payload where `piuVersion` is missing, empty, or whitespace-only
- **WHEN** the handler executes
- **THEN** the handler MUST warn and return without storing a replay entry

#### Scenario: Missing method warns and returns
- **GIVEN** `handleHistoricalChatReplay` is called with a payload where `method` is missing, empty, or whitespace-only
- **WHEN** the handler executes
- **THEN** the handler MUST warn and return without storing a replay entry

#### Scenario: Missing chatId warns and returns
- **GIVEN** `handleHistoricalChatReplay` is called with a payload where `chatId` is missing, empty, or whitespace-only
- **WHEN** the handler executes
- **THEN** the handler MUST warn and return without storing a replay entry

### Requirement: handleHistoricalChatReplay data preservation

The handler SHALL preserve the `data` field from the payload as-is (`const data = obj.data`) without type filtering. The `data` field type is `unknown` in `ReplayEntry`. When `HistoricalChatReplayView` renders the entry, it SHALL narrow `data` via `toPiuData`: arrays are preserved as `readonly unknown[]`, plain objects are preserved as `Readonly<Record<string, unknown>>`, and null/undefined/string/number/boolean are set to `undefined`. The `PIUInfoItem.data` type SHALL accept both `Readonly<Record<string, unknown>>` and `readonly unknown[]`.

When `data` is an array, `HistoricalChatReplayView` SHALL wrap it as `{ data: entry.data }` before passing to `PiuRenderer`, so that `PiuRenderer`'s emit payload spread (`{ ...piuInfo.data, ... }`) produces `{ data: [...] }` rather than index keys from the array.

**需求类别**：功能性需求

#### Scenario: Plain object data is preserved
- **GIVEN** `handleHistoricalChatReplay` is called with `data: { chartType: "bar", values: [1, 2, 3] }`
- **WHEN** the handler stores the replay entry
- **THEN** the entry's `data` MUST equal the original object

#### Scenario: Array data is preserved and wrapped for PiuRenderer
- **GIVEN** `handleHistoricalChatReplay` is called with `data: [1, 2, 3]`
- **WHEN** the handler stores the replay entry
- **THEN** the entry's `data` MUST equal `[1, 2, 3]`
- **AND** when `HistoricalChatReplayView` renders, `PiuRenderer` MUST receive `piuInfo.data` as `{ data: [1, 2, 3] }`

#### Scenario: String data is preserved in store but omitted from PiuRenderer
- **GIVEN** `handleHistoricalChatReplay` is called with `data: "some string"`
- **WHEN** the handler stores the replay entry
- **THEN** the entry's `data` MUST equal `"some string"`
- **AND** when `HistoricalChatReplayView` renders, `toPiuData` MUST return `undefined` and `PiuRenderer` MUST NOT receive a `data` property

#### Scenario: Null data is preserved in store but omitted from PiuRenderer
- **GIVEN** `handleHistoricalChatReplay` is called with `data: null`
- **WHEN** the handler stores the replay entry
- **THEN** the entry's `data` MUST equal `null`
- **AND** when `HistoricalChatReplayView` renders, `toPiuData` MUST return `undefined` and `PiuRenderer` MUST NOT receive a `data` property

#### Scenario: Undefined data remains undefined
- **GIVEN** `handleHistoricalChatReplay` is called with `data: undefined` or `data` field absent
- **WHEN** the handler stores the replay entry
- **THEN** the entry's `data` MUST be `undefined`
- **AND** the handler MUST NOT throw
### Requirement: handleHistoricalChatReplay preserves sibling fields as extraPayload

The handler SHALL collect all payload fields that are not `piuName`, `piuVersion`, `method`, or `data` into an `extraPayload: Readonly<Record<string, unknown>>` field on the `ReplayEntry`. This includes `chatId` and any other sibling fields (e.g. `isHistory`) that the external host passes alongside the known fields. The `extraPayload` SHALL be passed to `PiuRenderer` via its `extraPayload` prop, so that `PiuRenderer`'s `piu.emit` call includes these fields in the emit payload alongside `piuInfo.data`, `theme`, and `containerId`.

**需求类别**：功能性需求

#### Scenario: Sibling fields are collected into extraPayload
- **GIVEN** `handleHistoricalChatReplay` is called with a payload containing `piuName`, `piuVersion`, `method`, `chatId`, `isHistory: true`, and `data`
- **WHEN** the handler stores the replay entry
- **THEN** the entry's `extraPayload` MUST contain `chatId` and `isHistory: true`
- **AND** `extraPayload` MUST NOT contain `piuName`, `piuVersion`, `method`, or `data`

#### Scenario: extraPayload is passed to PiuRenderer
- **GIVEN** a replay entry with `extraPayload: { chatId: "chat-A", isHistory: true }` is stored
- **WHEN** `HistoricalChatReplayView` renders the entry
- **THEN** `PiuRenderer` MUST receive `extraPayload` containing `chatId` and `isHistory`

#### Scenario: No sibling fields produces empty extraPayload
- **GIVEN** `handleHistoricalChatReplay` is called with only `piuName`, `piuVersion`, `method`, `chatId`, and `data`
- **WHEN** the handler stores the replay entry
- **THEN** the entry's `extraPayload` MUST be an empty object `{}`
### Requirement: handleHistoricalChatReplay opens panel before replay

Before storing the replay entry, the handler SHALL ensure the conversation panel is visible. If the panel is not shown (`showPanel` is false) or is minimized (`minimized` is true), the handler SHALL call `aiAgentPiuRuntimeStore.openPanel()` followed by `aiAgentPiuRuntimeStore.restoreFromMinimized()` to make the panel visible and restored from minimized state.

**需求类别**：功能性需求

#### Scenario: Panel closed when replay is triggered
- **GIVEN** the panel is not shown (`showPanel: false`)
- **WHEN** `handleHistoricalChatReplay` is called with a valid payload
- **THEN** `openPanel` MUST be called
- **AND** `restoreFromMinimized` MUST be called
- **AND** the panel's `showPanel` MUST be `true` and `minimized` MUST be `false`

#### Scenario: Panel minimized when replay is triggered
- **GIVEN** the panel is shown but minimized (`showPanel: true`, `minimized: true`)
- **WHEN** `handleHistoricalChatReplay` is called with a valid payload
- **THEN** `restoreFromMinimized` MUST be called
- **AND** the panel's `minimized` MUST be `false`

#### Scenario: Panel already visible when replay is triggered
- **GIVEN** the panel is shown and not minimized (`showPanel: true`, `minimized: false`)
- **WHEN** `handleHistoricalChatReplay` is called with a valid payload
- **THEN** the replay entry MUST be stored
- **AND** the panel state MUST remain unchanged


### Requirement: handleHistoricalChatReplay clears active session before replay

Before opening the panel and storing the replay entry, the handler SHALL check if `aiAgentPiuRuntimeStore.getSnapshot().activeSessionId` is non-null. If a session is active, the handler SHALL call `aiAgentPiuRuntimeStore.clearActiveSessionForReplay()` to clear the active session without clearing existing replay entries. This ensures the conversation history from a previously opened session does not mix with replay content in the conversation panel.

The `clearActiveSessionForReplay()` method SHALL set `activeSessionId` and `activeSessionTitle` to `null` and persist the null session id via `writeAIAgentPiuActiveSessionId(null)`, but SHALL NOT call `historicalChatReplayStore.getState().clearAllReplays()`. This distinguishes it from `openNewSession()`, which clears both the session and replay entries.

**需求类别**：功能性需求

#### Scenario: Active session is cleared before replay
- **GIVEN** `aiAgentPiuRuntimeStore.activeSessionId` is a non-null session id
- **WHEN** `handleHistoricalChatReplay` is called with a valid payload
- **THEN** `clearActiveSessionForReplay` MUST be called
- **AND** `activeSessionId` MUST be `null` after the call
- **AND** existing replay entries MUST NOT be cleared

#### Scenario: No active session does not call clearActiveSessionForReplay
- **GIVEN** `aiAgentPiuRuntimeStore.activeSessionId` is `null`
- **WHEN** `handleHistoricalChatReplay` is called with a valid payload
- **THEN** `clearActiveSessionForReplay` MUST NOT be called
- **AND** the replay entry MUST be stored
### Requirement: Historical chat replay store deduplication by chatId

The `historicalChatReplayStore` SHALL maintain a collection of replay entries keyed by `chatId`. When `startReplay(entry)` is called with a `chatId` that already exists in the store, the store MUST NOT add a duplicate entry and MUST NOT replace the existing entry. When `startReplay(entry)` is called with a new `chatId`, the store MUST append the entry to the collection. The store SHALL preserve the insertion order of entries.

The store MUST NOT persist entries; entries are in-memory local view state only. The store MUST NOT interact with `conversationStore`, `sessionStore`, `requestStore`, Web API, SSE, WebSocket, timeline, SafeError, audit, metric, or trace.

**需求类别**：功能性需求

#### Scenario: First replay adds entry
- **GIVEN** the replay store is empty
- **WHEN** `startReplay` is called with `chatId: "chat-A"`
- **THEN** the store MUST contain exactly one entry with `chatId: "chat-A"`

#### Scenario: Same chatId does not duplicate
- **GIVEN** the replay store contains an entry with `chatId: "chat-A"`
- **WHEN** `startReplay` is called again with `chatId: "chat-A"` (even with different data)
- **THEN** the store MUST still contain exactly one entry with `chatId: "chat-A"`
- **AND** the existing entry MUST NOT be replaced

#### Scenario: Different chatId appends new entry
- **GIVEN** the replay store contains an entry with `chatId: "chat-A"`
- **WHEN** `startReplay` is called with `chatId: "chat-B"`
- **THEN** the store MUST contain two entries
- **AND** the insertion order MUST be `["chat-A", "chat-B"]`

### Requirement: Historical chat replay store clear

The `historicalChatReplayStore` SHALL provide a `clearAllReplays()` method that empties the entire entry collection. After `clearAllReplays()`, the store MUST contain zero entries and the insertion order array MUST be empty.

**需求类别**：功能性需求

#### Scenario: clearAllReplays empties the store
- **GIVEN** the replay store contains entries with `chatId: "chat-A"` and `chatId: "chat-B"`
- **WHEN** `clearAllReplays()` is called
- **THEN** the store MUST contain zero entries
- **AND** the insertion order array MUST be empty

### Requirement: Historical chat replay cleared on panel close

When `aiAgentPiuRuntimeStore.closePanel()` is called, the replay store MUST be cleared via `clearAllReplays()`. After panel close, no replay entries SHALL remain.

**需求类别**：功能性需求

#### Scenario: closePanel clears replay entries
- **GIVEN** the replay store contains entries
- **WHEN** `closePanel()` is called
- **THEN** the replay store MUST be empty

### Requirement: Historical chat replay cleared on session switch

When `aiAgentPiuRuntimeStore.openSession(sessionId)` or `aiAgentPiuRuntimeStore.openNewSession()` is called, the replay store MUST be cleared via `clearAllReplays()`. After session switch or new session creation, no replay entries SHALL remain.

**需求类别**：功能性需求

#### Scenario: openSession clears replay entries
- **GIVEN** the replay store contains entries
- **WHEN** `openSession("session-123")` is called
- **THEN** the replay store MUST be empty

#### Scenario: openNewSession clears replay entries
- **GIVEN** the replay store contains entries
- **WHEN** `openNewSession()` is called
- **THEN** the replay store MUST be empty

### Requirement: Historical chat replay not cleared on minimize

When `aiAgentPiuRuntimeStore.minimize()` is called, the replay store MUST NOT be cleared. Replay entries SHALL persist through minimize and restore. The `PiuRenderer` components MAY re-execute `autoLoad` + `emit` on restore due to React remounting, which is acceptable behavior.

**需求类别**：功能性需求

#### Scenario: minimize preserves replay entries
- **GIVEN** the replay store contains entries
- **WHEN** `minimize()` is called
- **THEN** the replay store MUST still contain all entries

### Requirement: aboveMessagesSlot renders above MessageList

`ChatPageCore` SHALL accept an optional `aboveMessagesSlot?: React.ReactNode` prop. When provided, the slot content SHALL render within the main content container and the `shouldShowWelcome` ternary (rendering `WelcomeState` or the conversation `MessageList` block) SHALL be suppressed. This ensures replay content replaces the conversation view entirely without showing the welcome page or message list alongside it.

When `aboveMessagesSlot` is not provided, `ChatPageCore` SHALL render exactly as before with no behavioral change.

The slot content and `MessageList` MUST share the same scroll container (`right-pane-scroll-viewport`), enabling unified scrolling: scrolling down passes through replay content first, then conversation messages.

**需求类别**：功能性需求

#### Scenario: aboveMessagesSlot renders before MessageList
- **GIVEN** `ChatPageCore` is rendered with `aboveMessagesSlot` containing a div with `data-testid="replay-slot"`
- **WHEN** the component renders with an active session (`shouldShowWelcome` is false)
- **THEN** the replay slot div MUST appear in the DOM before the `MessageList` element

#### Scenario: aboveMessagesSlot suppresses welcome state
- **GIVEN** `ChatPageCore` is rendered with `aboveMessagesSlot` containing replay content
- **AND** `shouldShowWelcome` is true (no active session)
- **WHEN** the component renders
- **THEN** the slot content MUST be rendered in the DOM
- **AND** `WelcomeState` MUST NOT be rendered
- **AND** `MessageList` MUST NOT be rendered

#### Scenario: aboveMessagesSlot absent preserves existing behavior
- **GIVEN** `ChatPageCore` is rendered without `aboveMessagesSlot`
- **WHEN** the component renders
- **THEN** the output MUST be identical to the behavior before this change
- **AND** no slot placeholder SHALL be rendered
### Requirement: aboveMessagesSlot backward compatible

The `aboveMessagesSlot` prop MUST be optional. Local entry (`local.tsx`) and immersive entry (`immersive.tsx`) MUST NOT pass `aboveMessagesSlot` to `ChatPageCore`. Only the collaborative PIU host (`AIAgentPiuRuntime`) MAY pass `aboveMessagesSlot` when replay entries exist.

**需求类别**：功能性需求

#### Scenario: Local mode does not pass aboveMessagesSlot
- **GIVEN** the local entry point renders `ChatPageCore`
- **WHEN** the component renders
- **THEN** `aboveMessagesSlot` MUST NOT be passed

#### Scenario: Immersive mode does not pass aboveMessagesSlot
- **GIVEN** the immersive entry point renders `ChatPageCore`
- **WHEN** the component renders
- **THEN** `aboveMessagesSlot` MUST NOT be passed

### Requirement: HistoricalChatReplayView renders PiuRenderer per entry

The `HistoricalChatReplayView` component SHALL read entries from `historicalChatReplayStore` and render one `PiuRenderer` per entry, ordered by insertion order. Each `PiuRenderer` SHALL receive a `PIUInfoItem` constructed from the entry: `piuName` from `entry.piuName`, `piuVersion` from `entry.piuVersion`, `renderFunc` from `entry.method`, and `data` from `entry.data` (narrowed via `toPiuData`). Each `PiuRenderer` SHALL also receive `extraPayload` from `entry.extraPayload`. Each `PiuRenderer` SHALL use `chatId` as its React key to ensure stable instance identity across re-renders.

The per-entry rendering SHALL be wrapped in a `React.memo` component (`ReplayPiuRenderer`) that receives the immutable `ReplayEntry` as its sole prop. This prevents existing entries from re-rendering when a new entry is appended to the store, which would otherwise trigger `PiuRenderer`'s `useEffect` cleanup (`containerEl.replaceChildren()`) and clear previously rendered PIU content.

The component SHALL render within a container with `data-testid="historical-chat-replay-view"`. The replay area MUST NOT render process panel, thinking chain, bubble actions, or any conversation-specific affordances. Replay entries MUST NOT carry `runId` or `requestId` and MUST NOT enter `MessageList` or `TurnBlock`.

**需求类别**：功能性需求

#### Scenario: Two entries render two PiuRenderers
- **GIVEN** the replay store contains entries with `chatId: "chat-A"` and `chatId: "chat-B"`
- **WHEN** `HistoricalChatReplayView` renders
- **THEN** two `PiuRenderer` instances MUST be rendered
- **AND** the first MUST correspond to `chatId: "chat-A"` and the second to `chatId: "chat-B"`

#### Scenario: PiuRenderer receives correct PIUInfoItem
- **GIVEN** the replay store contains an entry with `piuName: "chart-piu"`, `piuVersion: "1.0.0"`, `method: "renderChart"`, `data: { type: "bar" }`
- **WHEN** `HistoricalChatReplayView` renders
- **THEN** the `PiuRenderer` MUST receive `piuInfo` with `piuName: "chart-piu"`, `piuVersion: "1.0.0"`, `renderFunc: "renderChart"`, `data: { type: "bar" }`

#### Scenario: Empty store renders nothing
- **GIVEN** the replay store is empty
- **WHEN** `HistoricalChatReplayView` renders
- **THEN** no `PiuRenderer` MUST be rendered
- **AND** the container with `data-testid="historical-chat-replay-view"` MAY still be present

#### Scenario: Replay entries do not participate in conversation operations
- **GIVEN** replay entries are rendered in the conversation panel
- **WHEN** the user interacts with share selection, report selection, fork, annotation, retry, or edit
- **THEN** replay entries MUST NOT be selectable or actionable
- **AND** replay entries MUST NOT appear in `MessageList` or `TurnBlock`

