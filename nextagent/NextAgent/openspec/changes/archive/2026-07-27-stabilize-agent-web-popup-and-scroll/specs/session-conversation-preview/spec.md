## MODIFIED Requirements

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

## ADDED Requirements

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
