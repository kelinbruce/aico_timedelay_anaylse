# agent-web-multi-host-modes Specification

## Purpose
Define agent-web local, immersive, and collaborative host modes, including shared chat core ownership, Prel/PIU startup, collaborative `loadAIAgent` payload semantics, panel display state, and frontend artifact delivery boundaries.
## Requirements
### Requirement: Agent-web supports three host modes with one business core

`agent-web` SHALL support three host modes: local, immersive, and collaborative. All three modes MUST reuse the same chat/session business core for conversation rendering, session history, stream continuity, composer behavior, request controls, attachments, and run-process detail rendering. Host mode code MAY change entrypoint, shell layout, route strategy, chrome visibility, floating container behavior, and integration adapter, but MUST NOT fork or duplicate the chat/session/stream business implementation.

The previous contextual shape is not a host mode. Its behavior is represented by the collaborative PIU panel's internal floating layout after the user drags the panel.

#### Scenario: Mode shells are inspected for business logic duplication
- **WHEN** the implementation is reviewed for local, immersive, and collaborative entries
- **THEN** each mode MUST render through the shared chat/session business core
- **AND** mode-specific code MUST be limited to providers, shell layout, host integration, navigation presentation, and container behavior
- **AND** no mode-specific copy of session history, stream continuity, request submission, request cancellation, retry/edit, attachment, or run-process detail business logic may exist

### Requirement: Local mode remains a dev and test standalone page

Local mode SHALL remain a standalone browser page for development and testing. It MUST NOT load `/febs/v1/assets/prelude-loader`. It SHALL own local login, local theme control, local locale control, help, logout, complete page layout, and browser history routing.

Local mode is not a formal product artifact in this change. Frontend/backend local testing MUST use the default dev entrypoint named `index.html`; this source `index.html` MUST remain a local entry and MUST NOT be published as the formal artifact entry.

#### Scenario: Local mode starts without Prel
- **WHEN** a developer starts frontend/backend local testing and opens the default `index.html`
- **THEN** the document MUST NOT include `<script src="/febs/v1/assets/prelude-loader"></script>`
- **AND** the frontend MUST display the local shell controls for login, theme, locale, help, logout, full page layout, and history routing

#### Scenario: Formal frontend artifact is inspected for local entry
- **WHEN** the formal `@nextagent/agent-web` artifact is inspected
- **THEN** its published `index.html` MUST NOT be the local mode entry
- **AND** the published `index.html` MUST include the immersive Prel script

### Requirement: Immersive mode is the formal page entry

Immersive mode SHALL use a dev/test source entry named `immersive.html`. The formal build or artifact assembly MUST publish this immersive entry as `index.html` in the formal artifact. `immersive.html` and the published formal `index.html` MUST include the fixed script path `<script src="/febs/v1/assets/prelude-loader"></script>`.

Immersive mode SHALL render the full conversation page and preserve the left session/history navigation. It MUST hide local-owned settings, help, logout, theme, and locale controls because those actions are provided by the product framework loaded by Prel. The real Prel top menu is a `position: fixed` overlay owned by the product framework; immersive mode MUST NOT render a menu placeholder and MUST NOT add page-owned top spacing such as `margin-top` or `padding-top` for that menu. Whether the product menu overlays or offsets the product page is owned by the product framework. If Prel is unavailable and immersive startup cannot obtain `window.Prel`, the immersive root MUST still occupy the full browser viewport.

#### Scenario: Immersive formal page is loaded
- **WHEN** a product loads the formal artifact `index.html`
- **THEN** the document MUST include `<script src="/febs/v1/assets/prelude-loader"></script>` without changing the script `src`
- **AND** the conversation page MUST render as a full-viewport product page body without local menu chrome
- **AND** the left session/history navigation MUST remain available
- **AND** local settings, help, logout, theme, and locale controls MUST be hidden

#### Scenario: Immersive Prel startup fails before the frame is available
- **WHEN** immersive mode loads but `window.Prel` is unavailable
- **THEN** the immersive root MUST occupy the full browser viewport
- **AND** the frontend MUST NOT reserve any product top menu height
- **AND** the frontend MUST NOT fall back to local login controls

#### Scenario: Immersive conversation content scrolls below the fixed top menu
- **GIVEN** Prel startup succeeds and the fixed top menu overlays the viewport
- **WHEN** the selected conversation contains content taller than the visible business area
- **THEN** browser-level document scrolling MUST remain disabled
- **AND** the conversation scroll bar MUST belong to the existing `right-pane-scroll-viewport`
- **AND** the frontend MUST NOT include any product top menu DOM or menu placeholder in that scrollable range
- **AND** bottom-following, user-scroll-away, new-message, and older-history anchor behavior MUST continue to use that same `right-pane-scroll-viewport`

### Requirement: Non-local modes trust Prel site context

Immersive and collaborative modes SHALL use Prel-provided site context as the authority for session, user, locale, and theme. Locale values MUST use `zh-cn | en-us`. Theme values MUST use `lightday | evening`. The frontend theme adapter MUST map `lightday` to AntD light theme tokens and MUST map `evening` to AntD dark theme tokens.

Non-local modes MUST NOT show the local login page. If the backend returns an auth challenge while a non-local mode is active, the frontend MUST navigate to the fixed product login URL `/login-url`.

#### Scenario: Non-local mode receives Prel context
- **WHEN** Prel starts `agent-web` with `site.session`, `site.user`, `site.locale`, and `site.theme`
- **THEN** the frontend MUST treat those values as trusted host context
- **AND** locale MUST be applied from `site.locale`
- **AND** theme MUST be applied from `site.theme`
- **AND** `lightday` and `evening` themes MUST be mapped to AntD light and dark tokens respectively
- **AND** local login, local locale control, and local theme control MUST NOT be displayed

#### Scenario: Non-local mode receives backend auth challenge
- **WHEN** immersive or collaborative mode receives a backend auth challenge
- **THEN** the browser MUST navigate to `/login-url`
- **AND** the frontend MUST NOT render the local login page

### Requirement: Prel and PIU lifecycle is explicit per host mode

Non-local HTML entries SHALL use the Prel lifecycle defined for this capability. Any HTML entry that depends on Prel MUST include `<script src="/febs/v1/assets/prelude-loader"></script>` with that exact `src` value before it uses `window.Prel`.

Immersive mode SHALL use `Prel.start("AFWebsitePIU", packageVersion, ["session", "user", "locale", "theme"], callback)` to obtain trusted `site` context for page rendering, but immersive mode MUST NOT load the PIU JavaScript or stylesheet assets through `Prel.autoLoad` and MUST NOT start rendering through `loadAIAgent`. The immersive PIU name `AFWebsitePIU` MUST be distinct from the collaborative PIU name `AICOPIU` so that the two host modes do not collide when served from the same environment.

Collaborative host pages SHALL load the PIU JavaScript and its same-name stylesheet through `Prel.autoLoad({ AICOPIU: version })` or the equivalent two-argument `Prel.autoLoad("AICOPIU", version)` form. `Prel.autoLoad` MUST be treated as asset loading only; UI rendering MUST start only after the host PIU or test host emits `loadAIAgent`.

The PIU JavaScript SHALL call `Prel.start("AICOPIU", packageVersion, ["session", "user", "locale", "theme"], callback)` after `Prel.ready`. Inside that callback it MUST register handlers through `piu.attach(piu, handlers)`. It MUST NOT render the entrance logo or panel until the attached `loadAIAgent` handler is invoked.

#### Scenario: Immersive page uses Prel without loading the PIU
- **WHEN** the immersive source entry `immersive.html` is loaded in dev/test or as the formal artifact `index.html`
- **THEN** the document MUST load `/febs/v1/assets/prelude-loader`
- **AND** the page MUST call `Prel.start` with name `AFWebsitePIU`, the package version, and deps `session`, `user`, `locale`, and `theme`
- **AND** the page MUST obtain `site.session`, `site.user`, `site.locale`, and `site.theme` through Prel startup
- **AND** the page MUST render the immersive shell directly through the page entry
- **AND** it MUST NOT call `Prel.autoLoad` for `AFWebsitePIU`
- **AND** it MUST NOT emit `loadAIAgent`

#### Scenario: Collaborative host loads and triggers the PIU
- **WHEN** a collaborative product page or collaborative test host is loaded
- **THEN** the host document MUST load `/febs/v1/assets/prelude-loader`
- **AND** the host MUST provide an element whose id is passed as `containerId`
- **WHEN** the host calls `Prel.autoLoad({ AICOPIU: version })`
- **THEN** the host MUST load the PIU JavaScript and same-name stylesheet assets
- **WHEN** the host PIU emits `loadAIAgent` with `{ containerId }`
- **THEN** the attached PIU handler MUST render the entrance logo into that container
- **AND** no panel MUST be rendered before logo click or `displayAIAgent`

#### Scenario: PIU registers handlers before rendering
- **WHEN** the PIU JavaScript is loaded by Prel
- **THEN** it MUST call `Prel.start` with name `AICOPIU`, the package version, and deps `session`, `user`, `locale`, and `theme`
- **AND** it MUST call `piu.attach` to register `loadAIAgent`, `displayAIAgent`, `switchTheme`, and `sendQuestionToLui`
- **AND** no entrance logo or panel MUST be rendered before `loadAIAgent` is emitted by the host

### Requirement: PIU starts through Prel and loadAIAgent

Collaborative mode SHALL be delivered through one PIU logical asset named `AICOPIU`. The PIU name MUST be `AICOPIU`, and its runtime version MUST come from the repository root `package.json.version`.

Products SHALL load the PIU through Prel asset loading and start rendering by emitting `loadAIAgent` with an AICOConfig payload. `loadAIAgent` MUST accept an AICOConfig object as its payload. The AICOConfig object MUST include a `containerId: string` field as the host-selected rendering location, plus optional UI customization fields defined by the `aico-config-contract` capability. `loadAIAgent` MUST NOT accept or require a host-provided `mode`.

The PIU MUST render a small entrance logo into the element identified by `AICOConfig.containerId`. The conversation panel MUST open only through PIU display state, such as logo click or `displayAIAgent`, and MUST render in a fixed floating element owned by the PIU.

When `loadAIAgent` is called again with a different AICOConfig, the new configuration MUST fully replace the previous one (not merge). Any active custom PANEL MUST be unmounted before applying the new configuration.

#### Scenario: Product loads and starts the PIU with AICOConfig
- **WHEN** a product executes `window.Prel.autoLoad({ AICOPIU: version })`
- **AND** the host PIU emits `loadAIAgent` with an AICOConfig containing `{ containerId: "ai-agent-container", name: "网络助手", operators: [...] }`
- **THEN** the PIU MUST locate the host element by `AICOConfig.containerId`
- **AND** it MUST render the entrance logo inside that host element
- **AND** it MUST apply the AICOConfig customization fields (name, operators, etc.)
- **AND** it MUST keep panel layout state internal to the PIU

#### Scenario: loadAIAgent is called repeatedly with same containerId
- **WHEN** `loadAIAgent` is called again with the same `containerId`
- **THEN** the existing React root MUST be reused
- **AND** if a new AICOConfig is provided, it MUST fully replace the previous configuration

#### Scenario: loadAIAgent is called with a different containerId
- **WHEN** `loadAIAgent` is called with a different `containerId`
- **THEN** the PIU MUST keep a single active instance and move the entrance root to the new container
- **AND** if a new AICOConfig is provided, it MUST fully replace the previous configuration

#### Scenario: loadAIAgent replaces active custom PANEL
- **GIVEN** a custom PANEL operator is active
- **WHEN** `loadAIAgent` is emitted again with a new AICOConfig
- **THEN** the active custom PANEL MUST be unmounted
- **AND** the new AICOConfig MUST be applied
- **AND** the panel state MUST return to `CONVERSATION_PANEL`

### Requirement: PIU display state has one authority

`AICOPIU` SHALL use one internal display state as the authority for entrance and panel visibility. The `displayAIAgent` handler MUST accept `{ showEntrance: boolean; showPanel?: boolean }`.

The state combinations MUST behave as follows:

- `{ showEntrance: false, showPanel: false }` hides both entrance and panel.
- `{ showEntrance: true, showPanel: false }` shows only the entrance logo.
- `{ showEntrance: true, showPanel: true }` shows the entrance logo and panel.
- `{ showEntrance: false, showPanel: true }` is invalid and MUST be normalized to `{ showEntrance: false, showPanel: false }`.

The PIU close button MUST set `showPanel` to `false` and preserve the current `showEntrance` value. No other component may independently own entrance or panel open state.

#### Scenario: Host hides the PIU completely
- **WHEN** the host emits `displayAIAgent` with `{ showEntrance: false, showPanel: false }`
- **THEN** the entrance logo MUST be hidden
- **AND** the floating panel MUST be hidden

#### Scenario: User closes the PIU panel
- **WHEN** the floating panel close button is clicked
- **THEN** the PIU MUST set `showPanel` to `false`
- **AND** it MUST preserve the current `showEntrance` value

#### Scenario: Host sends invalid visible panel state
- **WHEN** the host emits `displayAIAgent` with `{ showEntrance: false, showPanel: true }`
- **THEN** the PIU MUST normalize the state to hide both entrance and panel

### Requirement: Collaborative panel has docked, floating, and maximized layouts

The collaborative PIU panel SHALL render within the host page and MUST NOT cover the product top menu loaded by Prel. The fixed top menu height is `63.2px`; all collaborative panel layouts MUST use this value as their top boundary. The layout state MUST be internal to `AICOPIU` and MUST NOT be selected by `loadAIAgent`.

The panel layout state SHALL have these forms:

- `docked`: default right-side layout, width `484px`, height `calc(100vh - 63.2px)`, a `left | right` dock side, and manual width resizing from the inner panel edge.
- `floating`: draggable window layout entered when the user drags the panel handle or activates a float action, with manual resizing from all four edges and all four corners.
- `maximized`: host-page maximized layout below the `63.2px` top menu, with restore returning to the previous `docked` or `floating` geometry.

At a `1920px` by `1080px` viewport, entering `floating` from a dragged docked panel MUST resize the window to `484px` wide by `756px` high. At that viewport, the floating minimum size MUST be `406px` wide by `484px` high, and floating resize MUST NOT allow width greater than `1112px`. Other viewport sizes MAY adjust these dimensions by clamping to the available viewport below the `63.2px` menu, but the panel MUST remain visible and MUST NOT cover the top menu.

#### Scenario: Collaborative panel opens docked
- **WHEN** the PIU display state opens the collaborative panel
- **THEN** the panel layout MUST be `docked`
- **AND** the panel top MUST be `63.2px`
- **AND** the panel height MUST be `calc(100vh - 63.2px)`
- **AND** the default dock position MUST be right side
- **AND** its default width MUST be `484px`

#### Scenario: Collaborative docked panel resizes from the inner edge
- **WHEN** the docked panel is on the right side
- **THEN** dragging the left edge at the top, middle, or bottom MUST resize the panel width
- **AND** dragging left MUST increase the width
- **AND** dragging right MUST decrease the width no smaller than `484px`
- **WHEN** the docked panel is on the left side
- **THEN** dragging the right edge at the top, middle, or bottom MUST resize the panel width
- **AND** dragging right MUST increase the width
- **AND** dragging left MUST decrease the width no smaller than `484px`

#### Scenario: Dragging the docked panel creates a floating window on 1920 by 1080
- **GIVEN** the viewport is `1920px` by `1080px`
- **WHEN** the user starts dragging the docked panel from its drag handle
- **THEN** the layout MUST become `floating`
- **AND** the floating window MUST be `484px` wide and `756px` high
- **AND** resizing MUST NOT shrink it below `406px` by `484px`
- **AND** resizing MUST NOT expand its width beyond `1112px`
- **AND** the window MUST remain below the `63.2px` top menu

#### Scenario: Dragging a left-docked panel keeps a left-side floating anchor
- **GIVEN** the collaborative panel is docked on the left side
- **WHEN** the user starts dragging the docked panel from its drag handle
- **THEN** the floating window MUST be created near the left dock position
- **AND** it MUST NOT first jump to the right-side default floating position

#### Scenario: Floating collaborative panel resizes from edges and corners
- **WHEN** the panel is in `floating` layout
- **THEN** dragging its left or right edge MUST resize the width
- **AND** dragging its top or bottom edge MUST resize the height
- **AND** dragging any corner MUST resize width and height together
- **AND** width MUST NOT shrink below `406px`
- **AND** height MUST NOT shrink below `484px`
- **AND** the panel MUST remain below the `63.2px` top menu

#### Scenario: Floating panel is clamped on smaller viewports
- **WHEN** the viewport cannot fit the reference floating size below the top menu
- **THEN** the floating width and height MAY be reduced to fit the available viewport
- **AND** the panel MUST remain fully reachable inside the host page
- **AND** the panel MUST NOT cover the `63.2px` top menu

#### Scenario: PIU panel is maximized and restored
- **WHEN** the user activates maximize inside collaborative mode
- **THEN** the panel MUST maximize within the host page below the `63.2px` top menu
- **AND** the implementation MUST NOT call the browser fullscreen API as the primary behavior
- **WHEN** the user activates restore
- **THEN** the panel MUST return to the previous `docked` or `floating` layout geometry

### Requirement: PIU chrome exposes lightweight actions

The collaborative panel SHALL use lightweight icon actions in the panel chrome. The chrome MUST include new session, recent history, float/dock, maximize/restore, and close actions. Recent history MUST be shown through the existing History Popover. With no history search conditions, the History Popover MUST display the latest 10 sessions by default and support scroll loading for more sessions.

The existing History Popover SHALL support the same session history search capability defined by `session-history-search`: keyword search, creation-time range filtering, stale-response protection, search empty state, and loading more with the current conditions. The History Popover MUST expose the same keyword input, creation-time icon entry, localized compact selected range summary, clear behavior, debounce behavior, IME protection, accessible names, and Tooltip or equivalent hover-help rules as the local/immersive search dialog. Search mode MUST display a 20-entry search window by default.

Local, immersive, and collaborative host runtimes are mutually exclusive in product runtime. Collaborative history search MUST reuse the existing session-history store/action path used by PIU history, while local/immersive search uses dialog-local result state. This enhancement MUST NOT add a Sidebar to collaborative mode, MUST NOT add a second history/search entry, MUST NOT add an independent search route or result page, and MUST NOT add PIU-specific search store, query namespace, or parallel search business state separate from the shared session history query capability.

Search and History Popover open/close state MUST remain UI-local to the popover. Closing the History Popover MUST NOT clear the committed search query during the current host runtime lifecycle. Search conditions MUST NOT be written to the host URL, localStorage, or sessionStorage, and MUST clear after host runtime remount. Search MUST NOT change `loadAIAgent` or `displayAIAgent` payload semantics, and MUST NOT change the collaborative panel's docked, floating, or maximized layout state.

#### Scenario: User opens recent history in PIU mode
- **WHEN** the user clicks the history icon in collaborative mode
- **THEN** the panel MUST open the existing History Popover
- **AND** the popover MUST initially show at most the latest 10 sessions when no search condition is active
- **AND** the popover MUST support loading more sessions while scrolling

#### Scenario: User searches history in PIU mode
- **WHEN** the user enters a history keyword or chooses a complete creation-time range in the History Popover
- **THEN** the popover MUST request session history with the current search conditions
- **AND** the popover MUST provide the same keyword input, creation-time icon entry, localized compact selected range summary, clear behavior, debounce behavior, IME protection, accessible names, and Tooltip or equivalent hover-help rules as local/immersive search dialog
- **AND** the popover MUST display a 20-entry search window
- **AND** loading more MUST carry the same search conditions
- **AND** the popover MUST NOT show snippets, highlights, or result counts

#### Scenario: PIU history search conditions stay runtime-local
- **WHEN** the user applies history search conditions and closes or reopens the History Popover
- **THEN** the committed search query MUST remain active during the current host runtime lifecycle
- **AND** the search query MUST NOT be written to the browser URL
- **AND** the search query MUST NOT be written to localStorage or sessionStorage
- **AND** the search query MUST clear after host runtime remount

#### Scenario: PIU history search preserves host-mode authority
- **WHEN** the user selects a session from PIU history search results
- **THEN** `AICOPIU` MUST update the internal active session id through the same runtime state path used by ordinary PIU history selection
- **AND** it MUST write the selected session id to `sessionStorage["nextagent:AICOPIU:activeSessionId"]`
- **AND** the browser URL MUST NOT change
- **AND** the panel layout MUST remain in its current docked, floating, or maximized state

### Requirement: Collaborative session selection uses PIU state

Collaborative mode MUST NOT use browser URL paths, browser history, `BrowserRouter`, or `MemoryRouter` as the authority for the selected chat session. Its selected session MUST be owned by the `AICOPIU` runtime state and persisted in `sessionStorage` under the exact key `nextagent:AICOPIU:activeSessionId`.

Local and immersive modes SHALL continue to use URL routing for `/` and `/session/:sessionId`. The shared chat/session business core MAY receive a host navigation adapter, but the adapter MUST preserve URL routing for local and immersive modes and MUST use PIU runtime state for collaborative mode.

When a collaborative user selects a session from the history popover, `AICOPIU` MUST update the internal active session id and write it to `sessionStorage` without changing the host page URL. When a collaborative user starts a new session, `AICOPIU` MUST clear the internal active session id and remove the storage key. When the composer creates a session while submitting from the collaborative welcome state, `AICOPIU` MUST store the created session id through the same navigation adapter. If a stored collaborative session id is restored but its conversation load fails, `AICOPIU` MUST clear the stored active session id and return the panel to the welcome state.

#### Scenario: Collaborative history selection does not change the host URL
- **WHEN** the collaborative history popover item for session `session-1` is selected
- **THEN** `sessionStorage["nextagent:AICOPIU:activeSessionId"]` MUST become `session-1`
- **AND** the chat business core MUST render session `session-1`
- **AND** the browser URL MUST NOT be changed to `/session/session-1`

#### Scenario: Collaborative session restores after page refresh
- **GIVEN** `sessionStorage["nextagent:AICOPIU:activeSessionId"]` is `session-1`
- **WHEN** the product page reloads and emits `loadAIAgent`
- **THEN** `AICOPIU` MUST pass `session-1` to the shared chat business core as the active session
- **AND** it MUST NOT require a router path to restore the selected session

#### Scenario: Collaborative new session clears stored selection
- **GIVEN** collaborative mode has active session `session-1`
- **WHEN** the user clicks the new session action
- **THEN** `AICOPIU` MUST clear its active session id
- **AND** it MUST remove `sessionStorage["nextagent:AICOPIU:activeSessionId"]`
- **AND** the shared chat business core MUST show the welcome state

#### Scenario: Collaborative restored session load fails
- **GIVEN** collaborative mode restores `session-1` from `sessionStorage`
- **WHEN** loading the conversation for `session-1` fails
- **THEN** `AICOPIU` MUST remove `sessionStorage["nextagent:AICOPIU:activeSessionId"]`
- **AND** it MUST return the shared chat business core to the welcome state

### Requirement: PIU handlers control theme and question injection

`AICOPIU` SHALL expose `switchTheme(theme: "lightday" | "evening")` and `sendQuestionToLui(payload: { question: string; isSend?: boolean })`.

`switchTheme` MUST update React state, AntD theme, and `document.documentElement[data-theme]` together. It MUST map `lightday` to AntD light theme tokens, map `evening` to AntD dark theme tokens, and preserve the original host theme value in `document.documentElement[data-theme]`. `sendQuestionToLui` MUST default `isSend` to `false`; when called while the panel is hidden, it MUST open the panel and populate the composer with `question`. If `isSend` is `true`, the question MUST be submitted after the panel and composer are ready. If `isSend` is absent or `false`, the question MUST remain as composer draft and MUST NOT submit.

#### Scenario: Host switches PIU theme
- **WHEN** the host emits `switchTheme` with `"evening"`
- **THEN** React theme state MUST become evening
- **AND** AntD MUST use dark theme tokens
- **AND** `document.documentElement[data-theme]` MUST be set to `"evening"`

#### Scenario: Host injects a question without sending
- **WHEN** the host emits `sendQuestionToLui` with `{ question: "查询小区告警" }`
- **THEN** the PIU panel MUST open if it is hidden
- **AND** the composer MUST contain `查询小区告警`
- **AND** no request MUST be submitted

#### Scenario: Host injects and sends a question
- **WHEN** the host emits `sendQuestionToLui` with `{ question: "查询小区告警", isSend: true }`
- **THEN** the PIU panel MUST open if it is hidden
- **AND** the composer MUST submit `查询小区告警` after it is ready

### Requirement: Dev Prel test framework supports PIU verification only

The repository SHALL provide a lightweight dev/test-only Prel framework for validating immersive and collaborative frontend behavior. The test framework MUST be served from the fixed path `/febs/v1/assets/prelude-loader` during local test hosting. It MUST provide only the Prel and PIU features required by this capability: `ready`, `autoLoad`, `start`, `piu.attach`, `piu.emit`, and injected `site.session`, `site.user`, `site.locale`, and `site.theme`.

The test framework MAY render a mock top menu with a right-side test container for `collaborative.html`. It MUST NOT render a visible mock top menu for immersive mode; immersive dev/test still loads `/febs/v1/assets/prelude-loader` to obtain Prel APIs and site context, but page chrome remains owned by the product framework contract rather than the mock. When the test framework renders the collaborative mock top menu, the mock menu MUST participate in document flow so collaborative test hosts keep the menu material visible while source tests can distinguish mock flow layout from the real fixed Prel overlay. It MUST NOT be included in the formal `@nextagent/agent-web` artifact.

#### Scenario: immersive.html uses the mock Prel framework without mock menu chrome
- **WHEN** `immersive.html` is served in dev/test mode
- **THEN** the document MUST load `/febs/v1/assets/prelude-loader`
- **AND** the mock Prel framework MUST install `window.Prel`
- **AND** the mock Prel framework MUST provide `site.session`, `site.user`, `site.locale`, and `site.theme`
- **AND** the mock Prel framework MUST NOT render `prel-mock-menu`
- **AND** immersive layout MUST NOT add page-owned top spacing after `Prel.start` succeeds

#### Scenario: collaborative.html loads the mock Prel framework
- **WHEN** `collaborative.html` is served in dev/test mode
- **THEN** `/febs/v1/assets/prelude-loader` MUST load the lightweight Prel test framework
- **AND** the mock top menu MUST expose a right-side container with id `ai-agent-container`
- **AND** the test page MUST automatically call `piu.emit("loadAIAgent", { containerId: "ai-agent-container" })` after `Prel.autoLoad({ AICOPIU: version })` completes
- **AND** the test page MUST support validating docked, floating, and maximized collaborative layouts

#### Scenario: Formal artifact excludes Prel mock
- **WHEN** the formal `@nextagent/agent-web` artifact is inspected
- **THEN** the mock Prel loader MUST NOT be present
- **AND** source `collaborative.html` MUST NOT be present

### Requirement: Source watch exposes all host modes through one Vite server

`npm run dev:watch` SHALL remain the single source watch command for multi-host frontend development. It MUST start exactly one `frontend/agent-web` Vite dev server for frontend source hosting, and that Vite dev server MUST expose local, immersive, and collaborative dev entries through route mapping rather than separate dev servers or mode-specific npm scripts.

The dev entry route mapping MUST be:

- `/` and `/index.html` load the local source `index.html`.
- `/immersive/`, `/immersive/**`, and `/immersive.html` load the immersive source `immersive.html`.
- `/collaborative/`, `/collaborative/**`, and `/collaborative.html` load the collaborative dev/test host source `collaborative.html`.
- `/febs/v1/assets/prelude-loader` serves the dev/test-only mock Prel loader.

The dev entry source mapping MUST be:

- `index.html` loads `/src/entries/local.tsx`.
- `immersive.html` loads `/src/entries/immersive.tsx`.
- `collaborative.html` loads `/src/entries/collaborative.ts`.
- Mock `Prel.autoLoad({ AICOPIU: version })` loads `/src/entries/piu.tsx`.

Local browser history fallback MUST remain available in source watch mode. The Vite dev server MUST keep `/api/**`, Vite internal client/HMR paths, source module paths, static asset paths, `/febs/v1/assets/prelude-loader`, `/immersive/**`, and `/collaborative/**` out of the local HTML fallback. Any other browser document navigation MUST load the local source `index.html`.

The Vite dev server MUST use `strictPort: true` for the configured dev port. The default host and port MUST remain `127.0.0.1:5173`; if `VITE_DEV_HOST` overrides the host, `dev:watch` MUST print the entry URLs using the effective host. Port conflicts MUST fail closed instead of drifting to another port.

In source watch mode, mock `Prel.autoLoad({ AICOPIU: version })` MUST load the source PIU entry `src/entries/piu.tsx`; it MUST NOT read `dist/piu/AIAgentPIU.js` or `dist/piu/AIAgentPIU.css`. `dev:watch` MUST NOT run `npm run build:vite:modes`, artifact assembly, package installation, or packaged `with-frontend` startup. It MUST NOT create or update formal build outputs, including `dist/index.html`, `dist/piu/AIAgentPIU.js`, or `dist/piu/AIAgentPIU.css`.

#### Scenario: Developer starts multi-host source watch mode
- **WHEN** a developer runs `npm run dev:watch`
- **THEN** the command MUST start one Vite dev server for `frontend/agent-web`
- **AND** the command MUST print local, immersive, and collaborative entry URLs
- **AND** the local URL MUST point to `/`
- **AND** the immersive URL MUST point to `/immersive/`
- **AND** the collaborative URL MUST point to `/collaborative/`

#### Scenario: Vite dev routing selects the correct source entry
- **WHEN** the Vite dev server receives `/` or `/index.html`
- **THEN** it MUST serve the local source `index.html`
- **AND** `index.html` MUST load `/src/entries/local.tsx`
- **WHEN** the Vite dev server receives `/immersive/`, a path below `/immersive/`, or `/immersive.html`
- **THEN** it MUST serve the immersive source `immersive.html`
- **AND** `immersive.html` MUST load `/src/entries/immersive.tsx`
- **WHEN** the Vite dev server receives `/collaborative/`, a path below `/collaborative/`, or `/collaborative.html`
- **THEN** it MUST serve the collaborative source `collaborative.html`
- **AND** `collaborative.html` MUST load `/src/entries/collaborative.ts`

#### Scenario: Local source watch preserves browser history fallback
- **WHEN** the Vite dev server receives a browser document navigation that is not `/api/**`, a Vite internal client/HMR path, a source module path, a static asset path, `/febs/v1/assets/prelude-loader`, `/immersive/**`, or `/collaborative/**`
- **THEN** it MUST serve the local source `index.html`
- **AND** the request MUST NOT be proxied to the backend
- **AND** the request MUST NOT be routed to `immersive.html` or `collaborative.html`

#### Scenario: Source watch keeps formal build artifacts out of the loop
- **WHEN** `dev:watch` is inspected or executed
- **THEN** it MUST NOT run `npm run build:vite:modes`
- **AND** it MUST NOT run artifact assembly
- **AND** it MUST NOT create or update `dist/index.html`, `dist/piu/AIAgentPIU.js`, or `dist/piu/AIAgentPIU.css`
- **AND** it MUST NOT install `@nextagent/agent-web`
- **AND** it MUST NOT start `with-frontend`

### Requirement: Local and immersive Sidebar search uses dialog while PIU keeps History Popover

Local and immersive Sidebar search MUST open a dialog from the Sidebar search action instead of navigating to a route or changing the current Sidebar view. This local/immersive dialog behavior is separate from collaborative PIU.

Collaborative mode MUST continue to use the existing History Popover and MUST NOT gain a Sidebar, second history entry, route-based search page, or PIU-specific search state.

#### Scenario: Host modes keep separate search surfaces
- **WHEN** local or immersive mode is running
- **THEN** Sidebar search MUST open a dialog without changing the browser route
- **AND** Sidebar search MUST preserve the current Sidebar favorites/recent view behind the dialog
- **WHEN** collaborative PIU mode is running
- **THEN** history search MUST remain inside the existing PIU History Popover
- **AND** collaborative PIU MUST NOT render a Sidebar search dialog

### Requirement: Local and immersive conversation surfaces expose current-session preview rail

Local and immersive host modes SHALL support the current-session preview rail defined by `session-conversation-preview`. The rail SHALL be rendered in the conversation area, left-middle near the Sidebar boundary with spacing, and SHALL remain bounded within the conversation viewport without covering the Sidebar, conversation list, or composer. Marker spacing SHALL use a component-level fixed strategy and MUST NOT be recomputed or dynamically compressed from marker count, marker total height, or rail viewport height. When marker total height exceeds the rail viewport, the rail SHALL remain bounded and usable through internal scrolling rather than growing without bound. Exact height caps, gap values, and scrollbar styling are frontend component constants rather than host-mode or Web/API contract fields. Local and immersive preview rail SHALL use paged marker data and DOM windowing so long sessions do not require all marker data or all marker DOM at once.

The rail SHALL be mouse-operated in this change. Non-hover state SHALL show compact inactive tick markers. Hovering a loaded marker SHALL highlight only that focused marker and show a bounded preview card with a one-line title from visible USER message `previewText` and, when available, a body from the same request's bounded visible ASSISTANT `answerPreviewText` clamped to three visible lines. Placeholder ticks for unloaded marker windows MAY be rendered, but hovering them MUST NOT request data or show a preview card. Clicking an unloaded placeholder SHALL first load that marker's preview window and then navigate if the marker data is available. Clicking a loaded preview card or compact tick marker SHALL either scroll smoothly to an already loaded message or load an anchored continuous conversation window through the conversation anchor API and then scroll smoothly to the anchor.

Local and immersive preview rail SHALL use fixed first-version loading constants: `windowSize=100`, request `limit=100`, `preloadThreshold=80`, and at most two in-flight preview window requests. Initial recent-session rendering SHALL request the latest preview window without `offset` and align the preview rail viewport to the bottom so the bottom visible marker is the latest USER submission without user scrolling. The current preview window SHALL be derived from the preview rail viewport center marker index. Adjacent windows SHALL be preloaded when the preview rail visible boundary is within 80 markers of the current window head or tail. The UI SHALL dedupe loaded/loading windows, SHALL NOT enqueue every window crossed during a fast scroll, and SHALL NOT introduce request cancellation, priority queues, scroll-speed prediction, dynamic window sizes, or LRU eviction in this change.

When a new USER submission succeeds, local and immersive preview rail SHALL refresh only the tail preview window and `totalMarkers`. When that submission's model response completes, it SHALL refresh the tail window again so the latest marker can include the answer preview. Tail refresh MUST NOT reset preview rail scroll position, clear a historical hover card, or redraw unrelated historical windows. If the new marker falls inside the currently rendered preview range, it SHALL be added to that range.

Mouse movement across preview markers/cards MUST keep hovered, neighboring, and inactive marker states visually distinguishable without shifting surrounding layout; exact width and animation duration values are frontend component constants, not host-mode or Web/API contract fields. Highlighting SHALL exist only on the marker currently under mouse focus/hover; local and immersive preview rail MUST NOT highlight a marker from the conversation viewport or anchored selection. The rail is a current-session user-submission mini-map, not a keyword search result list, and MUST NOT depend on `positionRatio`. The conversation UI MUST keep one continuous visible message segment and MUST NOT stitch non-contiguous early and latest segments together. While anchored, new latest messages or live stream deltas MUST NOT be appended to the currently visible anchored segment unless continuity has been loaded.

Collaborative PIU conversation preview rail is explicitly out of scope for this change. Collaborative mode MUST NOT add a second conversation preview rail, new PIU search store, new layout state, or host URL behavior.

#### Scenario: Local conversation rail is bounded and theme-aware
- **GIVEN** the local conversation surface has current-session preview markers
- **WHEN** the preview rail is displayed
- **THEN** it MUST be positioned near the Sidebar boundary with spacing
- **AND** it MUST remain bounded within the conversation viewport
- **AND** marker spacing MUST use one component-level fixed gap value and MUST NOT be recomputed from marker count or rail height
- **AND** when marker total height exceeds the rail height, the rail MUST remain usable through internal scrolling
- **AND** initial recent-session rendering MUST align the rail viewport so the bottom visible marker is the latest USER submission without user scrolling
- **AND** total rail content height MAY be based on `totalMarkers * markerRowHeight`
- **AND** marker DOM MUST be rendered only near the current preview viewport and its preload threshold
- **AND** inactive markers MUST use theme secondary/border tokens
- **AND** only the hovered preview marker/card is highlighted in both dark and light themes
- **AND** hovered preview card and neighboring markers MUST remain visually distinguishable without shifting the conversation layout

#### Scenario: Immersive rail click uses anchored conversation navigation
- **GIVEN** the immersive conversation surface displays preview rail markers
- **WHEN** the user clicks a preview card or compact tick marker for an unloaded message
- **THEN** the UI MUST load a continuous anchored conversation window for that message
- **AND** the UI MUST scroll smoothly to the anchor
- **AND** the visible conversation MUST NOT contain a gap between an early anchored segment and the latest segment
- **AND** live stream deltas or new latest messages MUST NOT be appended into the anchored segment until continuity is loaded or the user returns to latest

#### Scenario: Local rail avoids request storms during fast preview scrolling
- **GIVEN** the local conversation surface has more than 100 current-session preview markers
- **WHEN** the user quickly scrolls the preview rail across multiple marker windows
- **THEN** the UI MUST request only the latest current window and eligible adjacent preload windows
- **AND** it MUST dedupe already loaded and loading windows
- **AND** it MUST keep no more than two preview window requests in flight
- **AND** it MUST NOT request every intermediate window crossed during the fast scroll

#### Scenario: Tail refresh does not disturb historical preview interaction
- **GIVEN** the local or immersive preview rail is scrolled to an earlier marker range
- **AND** the pointer is hovering a historical loaded marker card
- **WHEN** a new USER submission succeeds or its model response completes
- **THEN** the UI MUST refresh only the tail preview window and `totalMarkers`
- **AND** it MUST keep the current preview rail scroll position and hover card stable
- **AND** it MUST add the new marker only if that marker is inside the current rendered preview range

#### Scenario: Collaborative mode does not add preview rail
- **GIVEN** the app runs in collaborative PIU mode
- **WHEN** this change is implemented
- **THEN** collaborative mode MUST NOT add a conversation preview rail in this change
- **AND** it MUST NOT add PIU-specific search store, layout state, host URL changes, or a second history/search entry

### Requirement: Process history behavior is identical across all host modes

Local、immersive and collaborative modes SHALL obtain process-history target selection, scheduling, caching, message/event composition, process entry lifecycle and manual overrides exclusively from the shared chat/session business core. Host shells and PIU adapters MUST NOT issue their own run event queries, keep a parallel process cache, observe conversation turns through a host-specific hydration path or implement host-specific loading and folding rules.

#### Scenario: Completed conversation is reopened in each host
- **WHEN** the same completed conversation and true-viewport fixture are opened in local、immersive and collaborative modes
- **THEN** all three modes MUST select the same display runs from explicit intent, true viewport and bounded preload rules through the shared chat/session business core
- **AND** MUST render equivalent completed thinking text, capability process order and final answer
- **AND** MUST start with the completed process panel collapsed

#### Scenario: Long history is scrolled in each host
- **WHEN** the same long conversation fixture is rapidly scrolled through local、immersive and collaborative modes
- **THEN** all three modes MUST apply the same target replacement, request concurrency, cache coherence and stale-generation rules
- **AND** all three modes MUST apply the same sixteen-explicit-target cap, load-outcome release, retry and whole-run LRU rules
- **AND** all three modes MUST apply the same queued-generation displacement, disclosure preservation and session-teardown cancellation rules
- **AND** all three modes MUST keep every started source request pinned to normal outcome and apply the same active-identity result commit guard
- **AND** no host MUST query every run in the loaded message window

#### Scenario: Live process completes in each host
- **WHEN** the same stream fixture drives a run from thinking through capability execution to final answer in each host mode
- **THEN** all three modes MUST auto-expand active entries, auto-collapse settled entries and auto-collapse the terminal panel with the same state results
- **AND** a manual entry or panel override MUST have the same scope and precedence in each mode

#### Scenario: Host implementation is inspected
- **WHEN** the three host entries and adapters are reviewed
- **THEN** run event HTTP calls, target scheduling and process-history cache MUST exist only in the shared agent-web service/store path
- **AND** process loading and folding behavior MUST exist only in the shared conversation components

### Requirement: Agent Web diagnostics use runtime-owned reporters

Agent Web 浏览器生产源码与 `agent-web-mock-server` 运行时源码中的 info、warning、error 与 debug 诊断 MUST 分别通过所属 runtime 的诊断 reporter 输出；业务源码、route、data stream 与 server 模块 MUST NOT 直接调用 `console.log`、`console.warn`、`console.error` 或 `console.debug`。reporter MUST 保持既有浏览器开发控制台或 mock server stdout/stderr 可见性，并 MUST NOT 改变触发诊断的原业务控制流、用户可见结果或后端请求行为。

**需求类别**：系统质量属性

**质量属性**：可维护性、可测试性
**适用范围**：该 Function

#### Scenario: 浏览器业务源码不直接依赖 console

- **WHEN** Agent Web 浏览器生产源码需要输出 warning、error 或 debug 诊断
- **THEN** 该源码 MUST 调用前端诊断 reporter
- **AND** 该源码 MUST NOT 直接调用 `console.*`

#### Scenario: Mock server 运行时源码不直接依赖 console

- **WHEN** `agent-web-mock-server` 的 server、route 或 data stream 模块需要输出 info、warning 或 error 诊断
- **THEN** 该模块 MUST 调用 mock server 诊断 reporter
- **AND** 该模块 MUST NOT 直接调用 `console.*`

#### Scenario: 诊断不改变业务结果

- **WHEN** AICOConfig 校验、PIU 集成、多宿主启动、Mermaid 渲染、stream envelope 防御或 mock server request/stream 路径触发诊断
- **THEN** reporter MUST 输出对应级别的事实
- **AND** 原有降级、渲染、请求处理或拒绝行为 MUST 保持不变

#### Scenario: 诊断不进入产品输出或外部边界

- **WHEN** reporter 输出 diagnostic
- **THEN** 输出 MUST 仅面向对应 runtime 的浏览器开发控制台或 mock server stdout/stderr
- **AND** MUST NOT 渲染用户界面通知、发送网络请求或写入 persistence、audit、metric 或 trace
