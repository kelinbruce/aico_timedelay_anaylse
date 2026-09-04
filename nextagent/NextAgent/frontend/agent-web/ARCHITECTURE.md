# NextAgent Frontend Implementation Architecture

## 1. Purpose and authority

This document is the package-local implementation architecture guide for `frontend/agent-web`. It describes the current entry composition, state ownership, external I/O, and rendering boundaries.

Normative product behavior and long-term architecture are owned by OpenSpec:

- `openspec/specs/` contains the archived stable behavior baseline.
- `openspec/changes/` contains active, unarchived changes.
- `openspec/designs/` contains long-term architecture, module design, and ADRs.

An implementation documented here is not stable merely because it exists in source. Active-change and implementation-only surfaces are identified explicitly below.

## 2. Scope

This guide covers:

- `src/entries/*`
- `src/App.tsx`
- `src/app/*`
- `src/config/*`
- `src/host/*`
- `src/piu/*`
- `src/pages/*`
- `src/features/*`
- `src/state/*`
- `src/services/*`

`packages/agent-dev-workbench` is a separate developer-tooling product surface. It is not part of the `agent-web` routes or formal frontend artifact.

## 3. Host entries and composition

The three host modes share the chat business implementation but do not use one identical React entry or navigation chain.

### 3.1 Local

Local is the standalone development and test surface:

```text
index.html
 -> entries/local.tsx
 -> renderRoot
 -> App
 -> AppProviders(mode="local")
 -> LocalAppShell
 -> HashRouter
 -> ChatWorkspace
 -> ChatPage
 -> ChatPageCore
```

`App` owns only the Local shell: local auth challenge handling, local theme controls, Sidebar, command help, and routed shared-conversation access.

### 3.2 Immersive

Immersive is the formal page-hosted product surface:

```text
immersive.html
 -> entries/immersive.tsx
 -> Prel startup
 -> renderRoot
 -> ImmersiveApp
 -> AppProviders(mode="immersive")
 -> ImmersiveContent
 -> HashRouter
 -> ChatWorkspace
 -> ChatPage
 -> ChatPageCore
```

The Immersive entry obtains and normalizes trusted host context from Prel before passing it to the shell. The shell owns page-level navigation, Sidebar or host-configured header composition, and non-local permission projection.

### 3.3 Collaborative / PIU

The formal Collaborative surface is the PIU artifact, not the development host page:

```text
AIAgentPIU.js
 -> entries/piu.tsx
 -> registerAIAgentPIU
 -> host loadAIAgent(payload)
 -> renderRoot
 -> AIAgentPiuRuntime
 -> PiuContext + AppProviders(mode="piu")
 -> PiuContent
 -> ChatPageCore + ChatNavigationAdapter
```

In the current implementation, Collaborative does not use `HashRouter` or `ChatWorkspace`. `aiAgentPiuRuntimeStore` and `ChatNavigationAdapter` select the active session without modifying the host URL.

`entries/collaborative.ts` is only the local development harness that simulates a host loading the PIU. Formal mode builds use `entries/piu.tsx` to produce `piu/AIAgentPIU.js` and `piu/AIAgentPIU.css`; `collaborative.html` is not shipped in the product artifact.

## 4. Routes and navigation authority

These `HashRouter` routes apply to Local and Immersive only:

| Route | Component | Role |
| --- | --- | --- |
| `/` | `ChatPage` | Welcome or new-session state |
| `/session/:sessionId` | `ChatPage` | Session-scoped chat |
| `/shared/:shareId` | `SharedConversationPage` | Read-only shared conversation |

There is no standalone `/sessions` route. Session history, search, favorites, and reopen controls are composed into the host shell.

Collaborative passes `sessionId`, `openSession`, `openNewSession`, and load-failure handling through `ChatNavigationAdapter`. `sessionStore.activeSessionId` mirrors the navigation input for shared state/actions; it is not the sole navigation authority across every host.

## 5. Runtime bootstrap and providers

Runtime bootstrap happens before the application React tree is rendered:

```text
host entry
 -> renderRoot
 -> loadRuntimeConfig
 -> render application tree
```

`runtimeConfig.ts` resolves configuration as follows:

1. `backendBaseUrl` comes from `VITE_BACKEND_BASE_URL`; an empty value means same-origin.
2. `transportKind` comes from `GET /api/v1/runtime/bootstrap` in product execution.
3. Development may fall back to `VITE_TRANSPORT_KIND`, then to `SSE`, if bootstrap fails.
4. Non-development execution fails closed and renders `RuntimeConfigError` when bootstrap cannot be loaded or validated.

In the current implementation, `AppProviders` does not own runtime bootstrap or trusted host-context acquisition. It projects the normalized context supplied by the entry and owns:

- host mode and site-context projection;
- theme preference or host theme projection;
- locale and Ant Design configuration;
- non-Local CSRF token projection into `apiClient`.

### 5.1 Known divergences from long-term design

This section records current implementation differences that have not been reconciled with the long-term OpenSpec design. It does not change OpenSpec authority or establish a new stable architecture contract.

1. Current `renderRoot` loads runtime configuration before the React application tree is rendered. The long-term design still assigns runtime bootstrap ownership to `AppProviders`.
2. Current Collaborative / PIU composition renders `ChatPageCore` with `ChatNavigationAdapter` directly and does not pass through `ChatWorkspace`. The long-term design still defines `AppProviders -> HostModeShell -> ChatWorkspace` as the shared frontend composition.

## 6. Layer and external I/O boundaries

### 6.1 Current backend I/O inventory

At this baseline, raw browser transport calls in production source are present at these locations:

| Owner | Responsibility |
| --- | --- |
| `services/apiClient.ts` | ordinary JSON requests through `fetch`, attachment upload through `XMLHttpRequest`, auth challenge handling, CSRF |
| `config/runtimeConfig.ts` | runtime bootstrap through an injectable fetcher that defaults to browser `fetch` |
| `features/chat/transport/streamTransport.ts` | SSE through `fetch` and stream reading, plus browser `WebSocket` |

Business services under `services/*` currently compose paths and DTOs on top of `apiClient`. The inventory above records what the current source does; it is not a new allowlist and does not establish a package-local prohibition for future code. The production source does not currently create an `EventSource`; the SSE adapter uses `fetch`.

Prel host lifecycle and asset loading are a separate external boundary. `host/prel.ts` adapts the host-provided `window.Prel`; `entries/immersive.tsx`, `entries/collaborative.ts`, and `piu/registerAIAgentPIU.tsx` own the corresponding start, auto-load, attach, and emit integration. This host I/O must not be routed through backend business services.

### 6.2 UI layering

- `entries/*` adapt HTML or host lifecycle into React startup.
- `App.tsx` owns the Local shell and local auth orchestration.
- `app/*` owns providers, the Immersive shell, non-Local auth adapters, and routed `ChatWorkspace` composition.
- `piu/*` owns Collaborative host lifecycle, display/layout state, and internal navigation.
- `pages/*` coordinates product workflows and currently performs some service calls and feature composition directly.
- `features/*` owns feature UI, hooks, presentation models, and feature-specific adapters.
- `state/*` owns browser projections and state transitions; several stores currently import chat adapters or utilities directly.
- `services/*` contains the shared HTTP client and most path/DTO adapters.

These directories are not currently isolated by a uniform public-module boundary. Verified dependency edges include:

- `TurnBlock.tsx` calls `annotationService` and `userQuestionService` from the rendering component.
- `MessageInput.tsx`, question components, Sidebar components, and share components import services directly; `SuggestedQuestions.tsx` composes its endpoint with `apiClient` inside the component.
- `conversationStore.ts` and `requestStore.ts` import adapters or utilities from `features/chat`.
- Sidebar imports auth implementation files through a cross-feature deep path, while pages compose multiple feature components through deep paths.

These entries describe current implementation relationships and known layering exceptions. They do not introduce a new import rule or claim that the current package already enforces one.

## 7. Client state ownership

| Owner | Browser-side responsibility |
| --- | --- |
| `ChatNavigationAdapter` | current session navigation input for the active host |
| `sessionStore` | session list, paging/search actions, rename/delete actions, active-session mirror |
| `conversationStore` | conversation snapshot, historical/live envelopes, preview windows, `activeRun`, stream continuity and recovery projection |
| `requestStore` | submit/cancel/retry/edit command state, optimistic pending request state, client notices |
| `userInputStore` | current Pending Input projection, submit state, and error |
| `skillSelectionStore` | selected Skill projection |
| `categorySelectionStore` | selected category-question projection |
| `useChatComposerController` and `MessageInput` | draft, edit mode, attachment workflow, slash panel, and input-local state |
| `AppProviders` | supplied host-context, theme, locale, and CSRF projection |
| `aiAgentPiuRuntimeStore` | PIU display/layout, trusted host site, and Collaborative session navigation |

The backend remains authoritative for session, request, run, timeline, permission, and persistence facts. Frontend stores are projections for rendering and interaction; `requestStore`, for example, does not own the canonical request lifecycle.

`AICOConfigStore` is the current host-configuration projection. Its configuration, display, layout, and PIU injection behavior is owned by the stable `aico-config-contract`, `aico-display-control`, `aico-layout-mode`, and `aico-piu-injection` specs.

## 8. Conversation snapshot and live overlay

The chat projection consumes three related inputs:

1. Persisted conversation messages from `GET /api/v1/sessions/{sessionId}/conversation`.
2. The conversation response's top-level `activeRun` summary.
3. Current-page live envelopes received through SSE or WebSocket.

The presentation path is:

```text
persisted SessionConversationMessage items
 -> snapshot-derived history envelopes

snapshot-derived history envelopes
 + activeRun summary
 + current-page live envelopes
 -> buildSessionProjection(...)
    -> buildHistoricalTurnBlocks(...)
    -> overlayLiveTurnBlocks(...)
 -> MessageList
 -> TurnBlock
```

The archived [`ts-stream-history-consistency`](../../openspec/specs/ts-stream-history-consistency/spec.md) and [`ts-stream-resume-replay`](../../openspec/specs/ts-stream-resume-replay/spec.md) specs own these stable semantics:

- Persisted conversation data defines durable visible history.
- `activeRun` restores current execution coordinates and controls after refresh.
- Live envelopes enrich the active turn with in-flight content and process detail.
- Historical rendering must remain correct without replaying every historical stream event.
- Same-page reconnect cursors are in-memory continuity state, not persisted conversation data.

`ChatPageCore` is the current shared workflow coordinator. It delegates stream lifecycle, viewport behavior, composer behavior, and projection transforms to `useChatSessionStream`, `useChatViewportController`, `useChatComposerController`, and `buildSessionProjection`, while still composing feature components and some service interactions directly.

## 9. Main UI surfaces and status

Current stable or implementation-backed composition includes:

```text
ChatPageCore
 |- MessageList
 |   `- TurnBlock
 |       |- answer/content rendering
 |       `- ProcessPanel
 |- RespondInput or MessageInput
 `- BackgroundTaskHeaderMonitor
```

The following surfaces require explicit status handling:

| Surface | Status | Owner |
| --- | --- | --- |
| Multi-host shells and auth projection | Stable | `agent-web-multi-host-modes`, `agent-web-auth-control` |
| Share page, conversation annotation, background-task monitor | Stable | corresponding archived specs |
| Composer keyboard/command behavior, browser attachment queue, root-route first-submit session establishment, session title, edit-resubmit, welcome HFQ, Turn Run Graph, and bounded Mermaid behavior | Stable | corresponding stable specs |
| Pending Input lifecycle and canonical kind projection | Stable | pending-input stable specs |
| Pending Input response surface, normal Composer switching/restoration, display-only expiration, and owning-request cancel delegation | Stable | `agent-web-pending-input-ui` |
| Pending Input visual layout, countdown format/cadence, and compatibility kinds | Implementation-only | `RespondInput` |
| Completed ordinary assistant Markdown, GFM-style tables, and ordinary code semantics | Stable | `agent-web-assistant-markdown-rendering` |
| Complete Mermaid fence detection, lazy/stale handling, generic failure fallback, and viewport notification | Stable | `agent-web-mermaid-rendering` |
| Complete Mermaid sanitization, raw-error logging safety, capacity limits, and exact visual details | Implementation-only; known security conflicts remain separate | current renderer implementation |
| Turn Run Graph | Stable | `agent-web-turn-run-graph` |
| AICO config, OperatorsArea, CustomPanel | Stable | `aico-config-contract`, `aico-display-control`, `aico-layout-mode`, `aico-piu-injection` |
| Structured tool result event and frontend rendering | Stable | `tool-structured-delta`, `agent-web-structured-message-rendering` |
| Expand Panel | Stable | `agent-web-expand-panel` |
| Turn-granularity favorite list data and target coordinates | Stable | `conversation-annotation` |
| Exact in-conversation scroll/focus after selecting a favorite item | Implementation-only | current favorite/session navigation implementation |

The active baseline owns only the behavior slices listed in its delta specs. This guide does not promote those slices to Stable before archive, and it does not restate unresolved layout or security details outside those deltas.

## 10. Security and quality constraints

- Identity, operation permissions, and non-Local CSRF must come from the applicable auth or Prel boundary. Local theme and locale may come from frontend preferences or system settings; Immersive and PIU theme/locale come from trusted Prel site context. None of these values may come from model output or arbitrary request content.
- UI permission gates improve usability but are not a security boundary; backend auth, owner scope, and agent scope checks remain authoritative.
- Runtime bootstrap, HTTP response, stream envelope, persisted JSON, host payload, and structured capability content must be validated at their untrusted boundaries.
- Rendered Markdown and Mermaid content must remain sanitized. Diagnostic safety remains governed by the project security constraints.
- No new frontend dependency is introduced without explicit approval.
- Product behavior changes to API, stream, runtime command, permission, persistence, or host contract require an OpenSpec change before implementation.

### 10.1 Current rendering and diagnostic touchpoints

- Markdown HTML currently passes through `xss`. Mermaid currently uses `securityLevel: "strict"`, disables HTML labels, and applies limited SVG cleanup before `dangerouslySetInnerHTML`.
- `LazyMermaid.tsx` currently logs the raw render error to `console.error`; this is a known diagnostic-safety conflict, not a security guarantee.
- The renderer and diagnostic entries in this subsection only record current implementation. Product behavior and security requirements continue to come from repository guidance and the applicable Stable or Active OpenSpec.

## 11. Verification and governance

From `frontend/agent-web`, the default package checks are:

```bash
npm run build
npm test
```

Host or artifact changes also require:

```bash
npm run build:vite:modes
```

Use targeted tests for the changed boundary, for example:

```bash
npm test -- tests/runtime-config.test.ts tests/stream-transport.test.ts
npm test -- tests/conversationStore.test.ts tests/useChatSessionStream.test.tsx
npm test -- tests/immersive-entry.test.tsx tests/piu-runtime-contract.test.tsx
```

When implementation and this guide conflict:

1. Identify the applicable stable OpenSpec or active change.
2. A product or contract behavior change must update OpenSpec before code.
3. Pure documentation drift must be corrected here against verified implementation.
4. This guide does not authorize a product behavior change.
