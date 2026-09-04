## ADDED Requirements

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

Immersive mode SHALL use `Prel.start("AIAgentPIU", packageVersion, ["session", "user", "locale", "theme"], callback)` to obtain trusted `site` context for page rendering, but immersive mode MUST NOT load `AIAgentPIU.js` or `AIAgentPIU.css` through `Prel.autoLoad` and MUST NOT start rendering through `loadAIAgent`.

Collaborative host pages SHALL load `AIAgentPIU.js` and its same-name stylesheet `AIAgentPIU.css` through `Prel.autoLoad({ AIAgentPIU: version })` or the equivalent two-argument `Prel.autoLoad("AIAgentPIU", version)` form. `Prel.autoLoad` MUST be treated as asset loading only; UI rendering MUST start only after the host PIU or test host emits `loadAIAgent`.

`AIAgentPIU.js` SHALL call `Prel.start("AIAgentPIU", packageVersion, ["session", "user", "locale", "theme"], callback)` after `Prel.ready`. Inside that callback it MUST register handlers through `piu.attach(piu, handlers)`. It MUST NOT render the entrance logo or panel until the attached `loadAIAgent` handler is invoked.

#### Scenario: Immersive page uses Prel without loading AIAgentPIU
- **WHEN** the immersive source entry `immersive.html` is loaded in dev/test or as the formal artifact `index.html`
- **THEN** the document MUST load `/febs/v1/assets/prelude-loader`
- **AND** the page MUST call `Prel.start` with name `AIAgentPIU`, the package version, and deps `session`, `user`, `locale`, and `theme`
- **AND** the page MUST obtain `site.session`, `site.user`, `site.locale`, and `site.theme` through Prel startup
- **AND** the page MUST render the immersive shell directly through the page entry
- **AND** it MUST NOT call `Prel.autoLoad` for `AIAgentPIU`
- **AND** it MUST NOT emit `loadAIAgent`

#### Scenario: Collaborative host loads and triggers the PIU
- **WHEN** a collaborative product page or collaborative test host is loaded
- **THEN** the host document MUST load `/febs/v1/assets/prelude-loader`
- **AND** the host MUST provide an element whose id is passed as `containerId`
- **WHEN** the host calls `Prel.autoLoad({ AIAgentPIU: version })`
- **THEN** the host MUST load the PIU JavaScript and same-name stylesheet assets
- **WHEN** the host PIU emits `loadAIAgent` with `{ containerId }`
- **THEN** the attached `AIAgentPIU` handler MUST render the entrance logo into that container
- **AND** no panel MUST be rendered before logo click or `displayAIAgent`

#### Scenario: AIAgentPIU registers handlers before rendering
- **WHEN** `AIAgentPIU.js` is loaded by Prel
- **THEN** it MUST call `Prel.start` with name `AIAgentPIU`, the package version, and deps `session`, `user`, `locale`, and `theme`
- **AND** it MUST call `piu.attach` to register `loadAIAgent`, `displayAIAgent`, `switchTheme`, and `sendQuestionToLui`
- **AND** no entrance logo or panel MUST be rendered before `loadAIAgent` is emitted by the host

### Requirement: AIAgentPIU starts through Prel and loadAIAgent

Collaborative mode SHALL be delivered through one PIU logical asset named `AIAgentPIU`, composed of `AIAgentPIU.js` and the same-name stylesheet `AIAgentPIU.css`. The PIU name MUST be `AIAgentPIU`, and its runtime version MUST come from the repository root `package.json.version`.

Products SHALL load the PIU through Prel asset loading and start rendering by emitting `loadAIAgent` with a host container id. `loadAIAgent` MUST accept only `containerId: string` as its host-selected rendering location. It MUST NOT accept or require a host-provided `mode`.

`AIAgentPIU` MUST render a small entrance logo into the element identified by `containerId`. The conversation panel MUST open only through PIU display state, such as logo click or `displayAIAgent`, and MUST render in a fixed floating element owned by `AIAgentPIU`.

#### Scenario: Product loads and starts AIAgentPIU
- **WHEN** a product executes `window.Prel.autoLoad({ AIAgentPIU: version })`
- **AND** the host PIU emits `loadAIAgent` with `{ containerId: "ai-agent-container" }`
- **THEN** `AIAgentPIU` MUST locate the host element by `containerId`
- **AND** it MUST render the entrance logo inside that host element
- **AND** it MUST keep panel layout state internal to `AIAgentPIU`

#### Scenario: loadAIAgent is called repeatedly
- **WHEN** `loadAIAgent` is called again with the same `containerId`
- **THEN** the existing React root MUST be reused
- **WHEN** `loadAIAgent` is called with a different `containerId`
- **THEN** the PIU MUST keep a single active instance and move the entrance root to the new container

### Requirement: PIU display state has one authority

`AIAgentPIU` SHALL use one internal display state as the authority for entrance and panel visibility. The `displayAIAgent` handler MUST accept `{ showEntrance: boolean; showPanel?: boolean }`.

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

The collaborative PIU panel SHALL render within the host page and MUST NOT cover the product top menu loaded by Prel. The fixed top menu height is `63.2px`; all collaborative panel layouts MUST use this value as their top boundary. The layout state MUST be internal to `AIAgentPIU` and MUST NOT be selected by `loadAIAgent`.

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

The collaborative panel SHALL use lightweight icon actions in the panel chrome. The chrome MUST include new session, recent history, float/dock, maximize/restore, and close actions. Recent history MUST be shown through a popover, display the latest 10 sessions by default, and support scroll loading for more sessions.

#### Scenario: User opens recent history in PIU mode
- **WHEN** the user clicks the history icon in collaborative mode
- **THEN** the panel MUST open a popover
- **AND** the popover MUST initially show at most the latest 10 sessions
- **AND** the popover MUST support loading more sessions while scrolling

### Requirement: Collaborative session selection uses PIU state

Collaborative mode MUST NOT use browser URL paths, browser history, `BrowserRouter`, or `MemoryRouter` as the authority for the selected chat session. Its selected session MUST be owned by the `AIAgentPIU` runtime state and persisted in `sessionStorage` under the exact key `nextagent:AIAgentPIU:activeSessionId`.

Local and immersive modes SHALL continue to use URL routing for `/` and `/session/:sessionId`. The shared chat/session business core MAY receive a host navigation adapter, but the adapter MUST preserve URL routing for local and immersive modes and MUST use PIU runtime state for collaborative mode.

When a collaborative user selects a session from the history popover, `AIAgentPIU` MUST update the internal active session id and write it to `sessionStorage` without changing the host page URL. When a collaborative user starts a new session, `AIAgentPIU` MUST clear the internal active session id and remove the storage key. When the composer creates a session while submitting from the collaborative welcome state, `AIAgentPIU` MUST store the created session id through the same navigation adapter. If a stored collaborative session id is restored but its conversation load fails, `AIAgentPIU` MUST clear the stored active session id and return the panel to the welcome state.

#### Scenario: Collaborative history selection does not change the host URL
- **WHEN** the collaborative history popover item for session `session-1` is selected
- **THEN** `sessionStorage["nextagent:AIAgentPIU:activeSessionId"]` MUST become `session-1`
- **AND** the chat business core MUST render session `session-1`
- **AND** the browser URL MUST NOT be changed to `/session/session-1`

#### Scenario: Collaborative session restores after page refresh
- **GIVEN** `sessionStorage["nextagent:AIAgentPIU:activeSessionId"]` is `session-1`
- **WHEN** the product page reloads and emits `loadAIAgent`
- **THEN** `AIAgentPIU` MUST pass `session-1` to the shared chat business core as the active session
- **AND** it MUST NOT require a router path to restore the selected session

#### Scenario: Collaborative new session clears stored selection
- **GIVEN** collaborative mode has active session `session-1`
- **WHEN** the user clicks the new session action
- **THEN** `AIAgentPIU` MUST clear its active session id
- **AND** it MUST remove `sessionStorage["nextagent:AIAgentPIU:activeSessionId"]`
- **AND** the shared chat business core MUST show the welcome state

#### Scenario: Collaborative restored session load fails
- **GIVEN** collaborative mode restores `session-1` from `sessionStorage`
- **WHEN** loading the conversation for `session-1` fails
- **THEN** `AIAgentPIU` MUST remove `sessionStorage["nextagent:AIAgentPIU:activeSessionId"]`
- **AND** it MUST return the shared chat business core to the welcome state

### Requirement: PIU handlers control theme and question injection

`AIAgentPIU` SHALL expose `switchTheme(theme: "lightday" | "evening")` and `sendQuestionToLui(payload: { question: string; isSend?: boolean })`.

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
- **AND** the test page MUST automatically call `piu.emit("loadAIAgent", { containerId: "ai-agent-container" })` after `Prel.autoLoad({ AIAgentPIU: version })` completes
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
- Mock `Prel.autoLoad({ AIAgentPIU: version })` loads `/src/entries/piu.tsx`.

Local browser history fallback MUST remain available in source watch mode. The Vite dev server MUST keep `/api/**`, Vite internal client/HMR paths, source module paths, static asset paths, `/febs/v1/assets/prelude-loader`, `/immersive/**`, and `/collaborative/**` out of the local HTML fallback. Any other browser document navigation MUST load the local source `index.html`.

The Vite dev server MUST use `strictPort: true` for the configured dev port. The default host and port MUST remain `127.0.0.1:5173`; if `VITE_DEV_HOST` overrides the host, `dev:watch` MUST print the entry URLs using the effective host. Port conflicts MUST fail closed instead of drifting to another port.

In source watch mode, mock `Prel.autoLoad({ AIAgentPIU: version })` MUST load the source PIU entry `src/entries/piu.tsx`; it MUST NOT read `dist/piu/AIAgentPIU.js` or `dist/piu/AIAgentPIU.css`. `dev:watch` MUST NOT run `npm run build:vite:modes`, artifact assembly, package installation, or packaged `with-frontend` startup. It MUST NOT create or update formal build outputs, including `dist/index.html`, `dist/piu/AIAgentPIU.js`, or `dist/piu/AIAgentPIU.css`.

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
