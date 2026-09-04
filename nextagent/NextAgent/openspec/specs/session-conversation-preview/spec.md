# session-conversation-preview Specification

## Purpose
Define the stable current-session conversation preview marker API and anchor/newer navigation behavior used by local and immersive conversation surfaces.
## Requirements
### Requirement: 当前会话提供用户提交 mini-map preview

系统 SHALL 为已打开的单个会话提供 conversation preview mini-map。该能力 SHALL 只以当前可信 owner scope、Agent scope 和 `sessionId` 内 `role=USER` 且 `visible=true` 的消息生成 marker；每个 marker MAY 附带同一 `requestId` 下 `role=ASSISTANT` 且 `visible=true` 的 bounded answer preview。系统 MUST NOT 以 assistant 回答、工具输出、Capability result、hidden message、不可见历史或其他会话内容生成 marker。

Web API SHALL expose:

```http
GET /api/v1/sessions/{sessionId}/conversation/preview
```

该接口 MUST 接受显式 `limit` 查询参数，并 MAY 接受显式 `offset` 查询参数；它 MUST NOT 接受 `q`、`createdFrom`、`createdTo`、`cursor`、`positionRatio`、`includeCapabilityResults` 或搜索参数。When provided, `offset` MUST be greater than or equal to `0`; `limit` MUST be greater than `0` and less than or equal to `500`. Missing or invalid `limit`, invalid `offset`, or unsupported query parameters SHALL fail validation. When `offset` is omitted, preview SHALL return the latest preview marker window and SHALL report the actual effective `offset` in the response. preview 是当前会话的全局用户提交 mini-map，不是关键词搜索接口，也不是会话列表搜索结果的一部分。

响应 SHALL 使用轻量 marker 列表：

```ts
interface ConversationPreviewResponse {
  readonly sessionId: string;
  readonly totalMarkers: number;
  readonly offset: number;
  readonly limit: number;
  readonly markers: readonly ConversationPreviewMarker[];
}

interface ConversationPreviewMarker {
  readonly messageId: string;
  readonly requestId?: string;
  readonly createdAt: number;
  readonly previewText: string;
  readonly previewTruncated: boolean;
  readonly answerPreviewText?: string;
  readonly answerPreviewTruncated?: boolean;
}
```

`previewText` SHALL be generated server-side from the visible USER message content and truncated before the Web response is returned. `answerPreviewText`, when present, SHALL be generated server-side from the latest visible ASSISTANT message in the same request and truncated before the Web response is returned. The truncation limit for both preview fields SHALL be 300 Unicode code points and implementations MUST NOT split surrogate pairs. `previewTruncated` and `answerPreviewTruncated` SHALL be `true` only when the corresponding original visible content exceeds that limit. Frontend MUST NOT derive preview text from full conversation messages. `previewText` MUST NOT contain assistant/tool/Capability result content. `answerPreviewText` MUST NOT contain USER, tool, Capability result, hidden, or other-session content. Markers SHALL be ordered by `createdAt ASC, messageId ASC`.

`totalMarkers` SHALL be the total number of visible USER markers for the requested session under the trusted owner and Agent scope. When `offset` is provided, the response `markers` array SHALL contain only the requested `[offset, offset + limit)` page and MAY contain fewer than `limit` markers on the last page or when `offset` is at/after `totalMarkers`. When `offset` is omitted, the implementation SHALL use `effectiveOffset = max(0, totalMarkers - limit)` and return the latest marker page. The response `offset` SHALL always equal the actual effective offset used for the marker page. The preview contract SHALL NOT impose a total marker cap and MUST NOT fail closed merely because more than 100 visible USER markers exist. Implementations MUST NOT sample markers, return a random subset, add overflow reason fields, or treat `totalMarkers` as a search hit count.

The preview rail SHALL render markers as an ordered mini-map of user submissions. It MUST NOT require or expose `positionRatio`, global message count, global ordinal, or full-scrollbar height estimation. Frontend SHALL use `totalMarkers` to maintain stable rail content height, and SHALL render only the marker DOM near the current preview rail viewport rather than creating DOM for every marker. Compact loaded tick markers SHALL reveal the card on hover. Placeholder ticks for unloaded marker windows MAY be displayed, but hovering an unloaded placeholder MUST NOT request data or display a card. Clicking an unloaded placeholder SHALL load the corresponding preview window and, if the marker data is returned, trigger the same target-message navigation as a loaded tick/card; failure MUST NOT show a toast. The compact tick marker and the bounded preview card for the same loaded marker SHALL trigger the same target-message navigation. The card SHALL remain visible while the pointer is inside the marker-card interaction region and SHALL close when the pointer leaves that region or enters another marker-card region. If the target message is already loaded, navigation SHALL scroll smoothly to it. If the target message is not loaded, navigation SHALL load an anchored window and then scroll smoothly to the anchor. Highlighting SHALL apply only to the loaded marker currently under mouse focus/hover. Non-hover markers MUST NOT be highlighted from the conversation viewport or anchored selection. Hovered, neighboring, and inactive markers MUST be visually distinguishable, but exact widths, spacing values, height caps, scrollbar styling, and animation durations are frontend component constants and MUST NOT become Web/API, runtime, session, or gateway contract fields. Marker spacing SHALL use a component-level fixed strategy and MUST NOT be recomputed or dynamically compressed from marker count, marker total height, or rail viewport height. When marker total height exceeds the rail viewport, the preview rail SHALL remain bounded and usable through internal scrolling. The visual falloff MUST NOT shift surrounding conversation layout.

#### Scenario: Preview returns a paged marker window with total marker count
- **GIVEN** a session contains visible USER messages, visible assistant messages, tool results, Capability results, hidden USER messages, and messages from another session
- **AND** the visible USER message count for the session is greater than 100
- **WHEN** the client requests `GET /api/v1/sessions/{sessionId}/conversation/preview?offset=100&limit=100`
- **THEN** the response MUST include `totalMarkers`, `offset`, `limit`, and markers only from visible USER messages in the requested session
- **AND** `totalMarkers` MUST reflect the full visible USER marker count for the requested session
- **AND** `offset` MUST equal `100`
- **AND** `limit` MUST equal `100`
- **AND** each marker MUST include `messageId`, optional `requestId`, `createdAt`, `previewText`, and `previewTruncated`
- **AND** a marker MAY include `answerPreviewText` and `answerPreviewTruncated` only when a visible ASSISTANT message exists for the same request
- **AND** the response MUST NOT include assistant/tool/Capability result markers, hidden messages, other-session markers, search totals, global message count, highlights, rank, position ratio, `markersComplete`, `markerLimit`, or conversation items

#### Scenario: Preview returns latest marker window when offset is omitted
- **GIVEN** a session has `350` visible USER markers
- **WHEN** the client requests `GET /api/v1/sessions/{sessionId}/conversation/preview?limit=100`
- **THEN** the response MUST include `totalMarkers=350`, `offset=250`, `limit=100`, and the latest 100 visible USER markers
- **AND** the last marker in the response MUST correspond to the latest visible USER marker in the session

#### Scenario: Preview validates paging parameters without imposing a total cap
- **WHEN** the client requests `GET /api/v1/sessions/{sessionId}/conversation/preview` without `limit`
- **THEN** Web API SHALL return a validation error
- **WHEN** the client requests preview with negative `offset`, zero or negative `limit`, or `limit` greater than `500`
- **THEN** Web API SHALL return a validation error
- **AND** runtime/session/gateway preview contracts MUST NOT receive an unbounded preview query
- **AND** sessions with more than 100 visible USER markers MUST still be readable through valid `offset` and `limit` pages

#### Scenario: Preview route does not accept search parameters
- **WHEN** the client requests `GET /api/v1/sessions/{sessionId}/conversation/preview?offset=0&limit=100&q=告警` or passes cursor/date/position/search parameters
- **THEN** Web API SHALL return a validation error
- **AND** runtime/session/gateway preview contracts MUST NOT receive a keyword search query

#### Scenario: Preview rail loads marker data by fixed windows
- **GIVEN** a session contains many visible USER markers
- **AND** local or immersive conversation UI is displaying the preview rail
- **WHEN** the preview rail initializes
- **THEN** frontend SHALL request the latest preview window with `limit=100` and no `offset`
- **AND** frontend SHALL initially align the preview rail viewport to the bottom so the bottom visible marker corresponds to the latest visible USER marker without user scrolling
- **AND** frontend MAY preload adjacent explicit-offset windows when the initial latest-aligned visible boundary is within the preload threshold
- **WHEN** the preview rail scroll position changes
- **THEN** frontend SHALL compute the current window from the preview rail viewport center marker index
- **AND** it SHALL preload adjacent windows when the visible preview rail boundary is within 80 markers of the current window head or tail
- **AND** it SHALL dedupe already loaded or loading windows and keep at most two preview window requests in flight
- **AND** it MUST NOT enqueue every window crossed during a fast scroll

#### Scenario: Preview rail hover shows bounded user and answer preview
- **GIVEN** a preview rail marker corresponds to a visible USER message
- **WHEN** the user hovers that marker
- **THEN** UI MUST show a bounded preview card whose title is based on the marker `previewText`
- **AND** the title MUST use one line with visual ellipsis when it overflows
- **AND** if `answerPreviewText` is present, the card body MUST show it as at most three visible lines
- **AND** if `answerPreviewText` is absent, the card MUST omit the body area
- **AND** the card MUST NOT contain tool, Capability result, hidden, or other-session text
- **AND** the card MUST remain within the conversation viewport constraints without pushing the conversation list layout
- **AND** the card MUST remain visible while the pointer moves from the marker into the card
- **AND** the card MUST close when the pointer leaves the marker-card interaction region

#### Scenario: Preview rail mouse movement preserves state priority without layout shift
- **GIVEN** conversation preview returned markers
- **AND** local or immersive conversation UI is displaying the preview rail
- **WHEN** the user moves the mouse from one preview marker/card to another
- **THEN** the newly hovered preview card MUST be the only highlighted marker/card state
- **AND** hovered markers MUST remain visually distinct from neighboring and inactive markers
- **AND** exact width and animation duration values MUST remain frontend component constants rather than contract fields
- **AND** the animation MUST NOT push the conversation list, Sidebar, or composer layout

#### Scenario: Preview rail keeps fixed marker spacing while staying bounded
- **GIVEN** conversation preview returned enough markers for the marker total height to exceed the rail viewport
- **WHEN** local or immersive conversation UI displays the preview rail
- **THEN** marker spacing MUST use one component-level fixed gap value
- **AND** marker spacing MUST NOT be recomputed or compressed from marker count, marker total height, or rail viewport height
- **AND** total rail content height MAY be based on `totalMarkers * markerRowHeight`
- **AND** frontend SHALL render marker DOM only near the current preview viewport and its preload threshold
- **AND** the preview rail MUST scroll internally
- **AND** scrollbar styling MUST remain a frontend component concern rather than a Web/API, runtime, session, or gateway contract field

#### Scenario: Preview tick click navigates with smooth scroll
- **GIVEN** the preview rail displays a compact tick marker for a visible USER message
- **WHEN** the user clicks the compact tick marker
- **THEN** frontend MUST trigger the same target-message navigation as clicking the corresponding preview card
- **AND** if the target message is already loaded, frontend MUST scroll smoothly to that message
- **AND** if the target message is not loaded, frontend MUST load the anchored window and then scroll smoothly to the anchor

#### Scenario: Preview tail refresh preserves historical hover and scroll
- **GIVEN** the preview rail has scrolled to an earlier marker range
- **AND** the pointer is hovering a loaded historical marker card
- **WHEN** a new USER submission succeeds
- **THEN** frontend SHALL refresh only the tail preview window and `totalMarkers`
- **AND** it MUST NOT reset the preview rail `scrollTop`
- **AND** it MUST NOT clear the current hover card because of the tail refresh
- **AND** if the new marker falls inside the current rendered preview range, it SHALL be added to that range
- **WHEN** the model response for that submission completes
- **THEN** frontend SHALL refresh the tail preview window again so the latest marker can include `answerPreviewText`

### Requirement: Conversation anchor loading preserves a continuous message window

系统 SHALL extend the existing conversation read API to support anchored loading while preserving the existing latest-window behavior.

Web API SHALL support:

```http
GET /api/v1/sessions/{sessionId}/conversation?limit=50
GET /api/v1/sessions/{sessionId}/conversation?cursor=<beforeCursor>&limit=50
GET /api/v1/sessions/{sessionId}/conversation?newerCursor=<newerCursor>&limit=50
GET /api/v1/sessions/{sessionId}/conversation?anchorMessageId=<messageId>&limit=50
```

Without `anchorMessageId`, `cursor`, or `newerCursor`, conversation history SHALL default to the latest visible message window. `cursor` SHALL remain the public older-record cursor compatibility parameter and map to internal `beforeCursor`; stores SHALL keep returning `nextBeforeCursor` for older-record pagination, and the Web channel SHALL project it to public `nextCursor`. `newerCursor` SHALL load visible records newer than the current newest boundary. `anchorMessageId` SHALL load a continuous visible message window containing the target message. `cursor`, `newerCursor`, and `anchorMessageId` MUST NOT be combined in one request.

The existing `includeCapabilityResults?` conversation query parameter SHALL remain supported and default to `false`. It MAY be combined with latest, older, newer, or anchor reads, and it SHALL only control whether visible Capability result messages are included in returned conversation items. It MUST NOT change anchor validation, scope validation, cursor continuity, response window mode, or preview marker behavior. The preview route MUST NOT accept `includeCapabilityResults`.

Conversation response SHALL keep items ordered by `createdAt asc, messageId asc` and MAY include:

```ts
interface ConversationResponse {
  readonly items: readonly ConversationMessage[];
  readonly nextCursor?: string;
  readonly newerCursor?: string;
  readonly activeRun?: ActiveRunSummary;
}
```

`nextCursor` SHALL be preserved only as the existing public compatibility alias for loading older records. Internal contracts SHALL preserve existing `beforeCursor` and `nextBeforeCursor` names for older-record pagination and add `newerCursor` only for newer-record pagination. `newerCursor` SHALL be present only when newer visible messages remain beyond the returned window. Backend MUST NOT return `windowMode` or `anchor` response fields; `recent` and `anchored` are frontend UI states derived from user actions and the request path.

For anchored loading, the target message MUST first be validated as same owner scope, same Agent scope, same session, and visible. The anchored window algorithm SHALL be:
- `limit` includes the anchor message.
- `before = floor((limit - 1) / 2)`.
- `after = limit - 1 - before`.
- Read up to `before` visible messages before the anchor, the anchor, and up to `after` visible messages after the anchor.
- If one side underflows, the other side MAY fill the remaining capacity.
- The returned item count MUST NOT exceed `limit`.
- Returned items MUST be ordered by `createdAt ASC, messageId ASC`.

Gateway-local SHALL implement recent, older, newer, anchor, and preview queries against the existing `messages` source facts with trusted owner scope, Agent scope, `sessionId`, and visibility filters. It MUST NOT load all messages for the session and slice in JS for anchor navigation. It MAY add ordinary B-tree indexes through existing migration rules to improve scoped message ordering, but MUST NOT add FTS/search document/sidecar tables, search-index rebuild operations, or public index DTOs.

#### Scenario: Clicking an already loaded preview card scrolls locally
- **GIVEN** the preview rail contains a preview card whose `messageId` is already present in the current conversation segment
- **WHEN** the user clicks that preview card
- **THEN** frontend SHALL scroll the existing conversation segment smoothly to that message
- **AND** frontend MUST NOT request an anchored conversation window

#### Scenario: Clicking an unloaded preview card loads an anchored window
- **GIVEN** the preview rail contains a preview card whose `messageId` is not present in the current conversation segment
- **WHEN** the user clicks that preview card
- **THEN** frontend SHALL request `GET /api/v1/sessions/{sessionId}/conversation?anchorMessageId=<messageId>&limit=<limit>`
- **AND** frontend SHALL replace the current segment with the returned anchored segment
- **AND** frontend SHALL scroll smoothly to the anchor message
- **AND** the visible conversation MUST contain only one continuous message segment

#### Scenario: Anchored segment supports older and newer loading
- **GIVEN** the client is displaying an anchored conversation segment
- **WHEN** the user scrolls upward and older records remain
- **THEN** frontend SHALL request the older page using the older cursor and prepend returned items
- **WHEN** the user deliberately scrolls downward and newer records remain
- **THEN** frontend SHALL request the newer page using `newerCursor` and append returned items
- **AND** after either load, the visible conversation order MUST remain `createdAt asc, messageId asc`
- **AND** idle pagination MUST NOT require a click-only load-more control

#### Scenario: Programmatic pagination movement does not cascade
- **GIVEN** an older or newer page has been loaded into the active continuous segment
- **WHEN** prepend compensation, page append, Preview positioning, or another programmatic layout change moves the viewport
- **THEN** frontend MUST NOT request another page from that programmatic movement alone
- **AND** another page MAY load only after continued same-direction user movement or a new same-direction input gesture

#### Scenario: Anchored segment does not append non-contiguous live updates
- **GIVEN** the client is displaying an anchored conversation segment
- **WHEN** a new latest message or live stream delta arrives outside the currently continuous anchored segment
- **THEN** frontend MUST NOT append it to the currently visible anchored segment
- **AND** frontend MAY update internal view state indicating that newer content exists
- **AND** latest/live content MAY become visible only after continuity is loaded through `newerCursor` or the user explicitly returns to latest
- **AND** submitting a new message MUST NOT by itself establish continuity or exit anchored mode

#### Scenario: Stale or hidden anchor fails safely
- **GIVEN** a preview marker references a message that later becomes hidden, deleted, or unavailable to the current owner or Agent scope
- **WHEN** the client requests `conversation?anchorMessageId=<messageId>`
- **THEN** Web API SHALL return not found or a validation/scope error
- **AND** it MUST NOT silently fall back to the latest conversation window as if the anchor succeeded
- **AND** it MUST NOT expose hidden or cross-scope message content

### Requirement: Anchored state has explicit latest-oriented escape behavior

Frontend SHALL maintain an explicit conversation UI state: `recent` or `anchored`. In `recent` state, the existing bottom button keeps its scroll-to-bottom/latest behavior. In `anchored` state, the same button SHALL mean "return to latest": clicking it SHALL reload the latest conversation window, clear the active anchor selection, and scroll to the latest visible message. It MUST NOT load every newer page from the anchor to latest.

Anchored state MAY also end through continuous user navigation. Frontend SHALL remain anchored while `newerCursor` exists. After deliberate downward scrolling has loaded pages until `newerCursor` is absent, frontend SHALL still remain anchored until the user actually reaches the physical bottom of that continuous segment. Only then SHALL frontend clear the active anchor, switch to `recent`, and resume bottom following. Programmatic scrolling, Preview positioning, layout growth, page append, or merely loading the final newer page MUST NOT independently exit anchored state.

The existing bottom button SHALL be the only direct return-latest affordance required by this behavior. Frontend MUST NOT add a separate new-message banner, badge, count, or prompt while anchored, and MUST NOT expose a generic reload-latest action as a third anchored escape path. New latest messages or live stream deltas MUST NOT be appended into a non-contiguous anchored segment; internal view state MAY remember that newer content exists without creating another user-visible indicator.

Submitting a new user message while anchored SHALL preserve the visible anchored segment, active anchor selection, bottom-following policy, and scroll position. Submission SHALL NOT switch the visible segment to `recent` and SHALL NOT automatically scroll to the bottom. If the visible segment is still non-contiguous with latest, the new request and its live content MUST remain outside that segment until continuity is loaded or the user explicitly returns to latest. If continuity is already established, new content MAY append at the end of the continuous segment but MUST NOT move the user's viewport.

#### Scenario: Return-latest button exits anchored state
- **GIVEN** the user is viewing an anchored conversation segment
- **WHEN** the user clicks the bottom button
- **THEN** frontend SHALL request or restore the latest conversation window
- **AND** frontend SHALL clear active anchor selection
- **AND** frontend SHALL scroll to the latest visible message
- **AND** frontend SHALL set conversation UI state back to `recent`

#### Scenario: Reaching the final continuous bottom exits anchored state
- **GIVEN** the user is viewing an anchored conversation segment
- **AND** deliberate downward scrolling has loaded pages until `newerCursor` is absent
- **WHEN** the user continues downward and reaches the physical bottom of the continuous segment
- **THEN** frontend SHALL clear active anchor selection
- **AND** frontend SHALL set conversation UI state to `recent`
- **AND** frontend SHALL resume bottom following

#### Scenario: Loading the final newer page does not exit before physical bottom
- **GIVEN** the user is viewing an anchored conversation segment
- **WHEN** a newer page load removes `newerCursor` but the viewport is not at the physical bottom
- **THEN** frontend SHALL remain anchored
- **AND** the existing return-latest button SHALL remain available

#### Scenario: Generic reload is not a third anchored escape path
- **GIVEN** the user is viewing an anchored conversation segment
- **WHEN** the composer actions are rendered
- **THEN** frontend MUST NOT expose a generic reload-latest action that exits anchored state
- **AND** the existing return-latest button SHALL remain available

#### Scenario: Submit while anchored preserves history review
- **GIVEN** the user is viewing an anchored conversation segment
- **WHEN** the user submits a new message
- **THEN** frontend SHALL preserve the active anchor and current scroll position
- **AND** frontend SHALL remain in `anchored` state
- **AND** frontend MUST NOT automatically scroll to the bottom
- **AND** frontend SHALL keep the existing return-latest button available

### Requirement: Anchored pagination results SHALL belong to the active window

Frontend SHALL apply an older or newer conversation page only when the response still belongs to the same session and conversation window that issued it. The current window identity SHALL include the local window generation, `recent` or `anchored` mode, active anchor when present, and originating cursor. Loading the latest window, loading another anchor, switching sessions, or clearing the session SHALL invalidate older and newer responses issued by the replaced window.

An invalidated pagination response MUST NOT append or prepend messages, overwrite current cursors, change the current window mode or active anchor, surface an error for the replacement window, or trigger bottom following. Pagination failure for the still-active window SHALL preserve its visible messages and reading position and MAY keep the existing retry entry available.

#### Scenario: Return to latest wins over an in-flight newer page
- **GIVEN** an anchored newer-page request is in flight
- **WHEN** the user returns to latest and the latest window becomes active before that page responds
- **THEN** the older response MUST NOT modify the latest window messages, cursors, mode, anchor, loading state, or scroll policy

#### Scenario: A new Preview anchor wins over an in-flight page
- **GIVEN** an older or newer page request for one anchored window is in flight
- **WHEN** the user navigates to another Preview marker and its anchored window becomes active
- **THEN** the previous response MUST NOT modify the new anchored window

#### Scenario: Active pagination failure preserves the reading window
- **GIVEN** the user remains in the anchored window that issued a pagination request
- **WHEN** the request fails
- **THEN** frontend SHALL preserve the current continuous message segment and reading position
- **AND** frontend MAY expose only the existing pagination retry entry

### Requirement: Preview interaction drives process hydration only after explicit navigation

The conversation preview rail MUST keep preview-data loading separate from run event hydration. Hovering a loaded marker or its card MUST use only the bounded preview response already available in browser state. Hovering an unloaded placeholder MUST remain inert. Neither hover path MUST query run event history or change the main conversation viewport.

Clicking a loaded marker/card, or an unloaded placeholder that resolves to a marker, MUST establish the latest preview-navigation target. Message navigation MUST complete as soon as the target message is locally available or the anchored message window has loaded; it MUST NOT wait for run event history. After the target turn and display run are known, frontend MUST select that run at the highest process-history hydration priority.

#### Scenario: Loaded marker hover does not query process history
- **GIVEN** a loaded preview marker has bounded user and answer preview text
- **WHEN** the user hovers the marker or moves into its card
- **THEN** frontend MUST render the card from the loaded preview marker
- **AND** MUST NOT query `GET /api/v1/sessions/:sessionId/runs/:runId/events`
- **AND** MUST NOT change the main conversation viewport

#### Scenario: Placeholder hover remains inert
- **WHEN** the user hovers an unloaded preview placeholder
- **THEN** frontend MUST NOT request the placeholder's preview window
- **AND** MUST NOT request run event history
- **AND** MUST NOT display a preview card

#### Scenario: Preview click navigates before process history finishes
- **GIVEN** the selected preview target message is not in the current message window
- **WHEN** the user clicks its loaded marker or card
- **THEN** frontend MUST load an anchored message window and scroll to the target after that message load succeeds
- **AND** MUST NOT delay the scroll while waiting for run event history
- **AND** after identifying the target display run it MUST select that run at the highest process-history hydration priority

#### Scenario: Rapid preview selections use the latest target
- **WHEN** the user selects preview targets A and B in that order before A's message or event work completes
- **THEN** B MUST be the only navigation target allowed to move the viewport
- **AND** event work unique to A MUST NOT delay B
- **AND** an already started A event request MUST continue to normal outcome while the session survives
- **AND** when the session survives, an identity-matched validated A result MUST update only A's run-scoped cache
- **AND** a late A response MUST NOT restore A's preview pin, move the viewport or enter B's turn

#### Scenario: Preview navigation pins only the current target
- **GIVEN** preview target A has selected a display run
- **WHEN** the user selects preview target B
- **THEN** B MUST replace A as the current preview pin source
- **AND** while A's session remains alive, an already active request for A MUST remain pinned only by its active-request lifecycle until its load outcome
- **AND** session teardown MUST instead cancel A and release its pin without publishing a process-history UI outcome

### Requirement: 会话预览查询校验返回确定字段级结果

系统 MUST 对 `GET /api/v1/sessions/:sessionId/conversation/preview` 的 `offset` 和 `limit` 查询参数执行字段级校验。校验失败 MUST 返回 HTTP `400` 与 `REQUEST_VALIDATION_FAILED`，并 MUST 使用本 Requirement 规定的确定消息；合法的前导零正整数 MUST 按其整数值处理。`offset` 范围 MUST 为 `0` 到 `10000`（含），`limit` 范围 MUST 为 `1` 到 `100`（含）。

**需求类别**：功能性需求

#### Scenario: 缺失或非法分页参数返回字段级消息

- **WHEN** 请求缺失 `limit`
- **THEN** 错误消息 MUST 为 `limit is required.`
- **WHEN** `offset` 或 `limit` 不是整数串
- **THEN** 错误消息 MUST 分别为 `offset must be an integer.` 或 `limit must be an integer.`
- **WHEN** `offset` 为负数
- **THEN** 错误消息 MUST 为 `offset must be a non-negative integer.`
- **WHEN** `offset` 大于 `10000`，或为长度超过 5 位的 digit string（如 `1e27`）
- **THEN** 错误消息 MUST 为 `offset must not exceed 10000.`
- **AND** 超大 digit string MUST 在数值解析前被长度守卫拦截，MUST NOT 返回 `offset must be a finite safe integer.`
- **WHEN** `limit` 小于 `1` 或大于 `100`
- **THEN** 错误消息 MUST 为 `limit must be a positive integer.`（小于 1）或 `limit must not exceed 100.`（大于 100）

#### Scenario: 额外查询参数返回 preview 专属消息

- **WHEN** 请求包含 `offset`、`limit` 之外的查询参数
- **THEN** 系统 MUST 返回 HTTP `400` 与 `REQUEST_VALIDATION_FAILED`
- **AND** 错误消息 MUST 为 `Conversation preview only supports offset and limit query parameters.`

#### Scenario: 前导零正整数 limit 被接受

- **WHEN** 请求使用 `limit=01`
- **THEN** 系统 MUST 按整数 `1` 处理该参数并返回成功响应

#### Scenario: Preview 分页参数范围被收紧且仍可读多 marker 会话

- **WHEN** 客户端请求 preview 且 `offset` 在 `0` 到 `10000` 之间、`limit` 在 `1` 到 `100` 之间
- **THEN** Web API SHALL 接受请求并返回对应 marker 窗口
- **AND** `offset=10000` 与 `limit=100` MUST 返回 `200`
- **WHEN** 客户端请求 preview 且 `offset` 大于 `10000` 或 `limit` 大于 `100`
- **THEN** Web API SHALL 返回 validation error
- **AND** runtime/session/gateway preview contracts MUST NOT 接收越界的 preview 查询
- **AND** 超过 100 个 visible USER marker 的会话 MUST 仍可通过合法 `offset` 与 `limit` 分页读取

### Requirement: Stale or hidden cursor/anchor fails safely

For `GET /api/v1/sessions/{sessionId}/conversation`, the Web channel MUST validate that a supplied `cursor`, `newerCursor`, or `anchorMessageId` resolves to a message within the requested session under the trusted owner and Agent scope before returning a conversation page. The validation SHALL use a same-session message lookup keyed by the cursor/anchor message ID; a cursor/anchor that does not resolve, or that resolves to a message belonging to a different session, MUST fail closed and the Web API SHALL return `404` with `SafeError { code: "SESSION_MESSAGE_ANCHOR_NOT_FOUND", category: "NOT_FOUND", retryable: false }`.

This applies to all three cursor modes:
- `anchorMessageId` MUST fail closed when the anchor message is stale, hidden, deleted, cross-owner, cross-agent, cross-session, or otherwise unavailable; it MUST NOT silently fall back to the latest conversation window as if the anchor succeeded, and MUST NOT expose hidden or cross-scope message content.
- `cursor` (older-record) and `newerCursor` (newer-record) MUST fail closed with `SESSION_MESSAGE_ANCHOR_NOT_FOUND` when the cursor message does not resolve within the session. A cursor that resolves but has no older/newer visible messages remaining (paging boundary) MUST return `200` with an empty items page and `hasMore: false`, and MUST NOT be treated as not-found.

The `cursor`, `newerCursor`, and `anchorMessageId` query parameters MUST each be 1–64 characters; the Web channel MUST reject a value exceeding 64 characters with `400` and a field-level `REQUEST_VALIDATION_FAILED` message. The three parameters MUST NOT be combined in one request.

**需求类别**：功能性需求

#### Scenario: Stale or hidden anchor fails safely
- **GIVEN** a preview marker references a message that later becomes hidden, deleted, or unavailable to the current owner or Agent scope
- **WHEN** the client requests `conversation?anchorMessageId=<messageId>`
- **THEN** Web API SHALL return `404` with `SafeError { code: "SESSION_MESSAGE_ANCHOR_NOT_FOUND" }`
- **AND** it MUST NOT silently fall back to the latest conversation window as if the anchor succeeded
- **AND** it MUST NOT expose hidden or cross-scope message content

#### Scenario: Non-existent anchor returns 404 even when the store returns an empty page
- **WHEN** the client requests `conversation?anchorMessageId=<messageId>` and the anchor does not resolve within the session (including a hidden anchor whose message-store lookup returns an empty visible page)
- **THEN** Web API SHALL return `404` with `SafeError { code: "SESSION_MESSAGE_ANCHOR_NOT_FOUND" }`
- **AND** it MUST NOT return `200` with `items: []`

#### Scenario: Non-existent cursor or newerCursor returns 404
- **WHEN** the client requests `conversation?cursor=<messageId>` or `conversation?newerCursor=<messageId>` and the cursor message does not resolve within the session (forged, deleted, or cross-session)
- **THEN** Web API SHALL return `404` with `SafeError { code: "SESSION_MESSAGE_ANCHOR_NOT_FOUND" }`
- **AND** it MUST NOT return `200` with `items: []`

#### Scenario: Paging boundary still returns an empty page
- **WHEN** the client requests `conversation?cursor=<messageId>` or `conversation?newerCursor=<messageId>`, the cursor resolves within the session, and no older/newer visible messages remain beyond it
- **THEN** Web API SHALL return `200` with `items: []` and `hasMore: false`
- **AND** it MUST NOT return `404`

#### Scenario: Cursor or anchor exceeding 64 characters returns 400
- **WHEN** the client requests `conversation?cursor=<over-64>` (or `newerCursor`/`anchorMessageId` exceeding 64 characters)
- **THEN** Web API SHALL return `400` with `REQUEST_VALIDATION_FAILED` and a field-level message (`cursor must not exceed 64 characters.` / `newerCursor must not exceed 64 characters.` / `anchorMessageId must not exceed 64 characters.`)
- **AND** it MUST NOT forward the value to the backing message store
