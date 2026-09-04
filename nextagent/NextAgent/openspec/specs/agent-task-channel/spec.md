# agent-task-channel Specification

## Purpose
定义面向后台服务系统的 Task Channel HTTP/JSON 契约，以 runtime requestId 为外部 taskId、以 runtime sessionId 为独立会话坐标，通过流式 SSE 和异步 callback 两条独立路由树交付任务生命周期事件，支持批量对账查询恢复，不拥有 request lifecycle 或 canonical timeline。

## Requirements

### Requirement: Task Channel Public Coordinates

Task Channel SHALL expose runtime request identity as `taskId` and preserve `sessionId` as a separate session coordinate. Channel responses and events MUST NOT expose `requestId`, `targetRequestId`, `runId`, `contextId`, or any other internal runtime diagnostic field. `attempt` SHALL be exposed only in retry responses. Public responses SHALL contain `sessionId`, `taskId`, and `taskStatus`.

#### Scenario: Create returns external task coordinates
- **WHEN** runtime accepts a request in a session
- **THEN** Task Channel MUST return `sessionId` equal to the runtime session id
- **AND** `taskId` MUST equal the runtime request id
- **AND** the response MUST NOT contain `runId` or `contextId`

#### Scenario: Create does not accept sessionId
- **WHEN** a create body contains `sessionId`
- **THEN** Task Channel MUST return HTTP 400
- **AND** MUST NOT create a session or submit a request

#### Scenario: Client cannot provide trusted scope
- **WHEN** a body, query, TaskMessage metadata, or callback metadata contains owner or agent scope fields
- **THEN** Task Channel MUST reject or ignore those fields according to its closed schema
- **AND** MUST derive IdentityContext and Agent Scope only from trusted boundaries

### Requirement: TaskMessage Contract

All Task Channel public task input and output data SHALL use `taskMessages: TaskMessage[]`. A TaskMessage SHALL contain exactly one of `text`, `data`, or `fileContent`; optional `metadata` SHALL be an untrusted JSON object. `fileContent` SHALL contain exactly one of base64 `raw` or remote `url`, plus required `filename` and `mediaType`.

The current execution version SHALL require exactly one TaskMessage for create and edit. Answer does not use `taskMessages`; it uses top-level `answers: string[][]` aligned with web channel. More than one input message for create/edit MUST return HTTP 400 without invoking runtime. The array contract is reserved for a later multi-message execution change.

#### Scenario: Text input is accepted
- **WHEN** create contains one TaskMessage with non-empty `text`
- **THEN** channel MUST submit that text as runtime input

#### Scenario: Structured data input is accepted
- **WHEN** create contains one TaskMessage with `data`
- **THEN** channel MUST use stable JSON serialization as runtime input text
- **AND** MUST persist the structured value through the existing accepted request facts inputVariables path so recovery can reconstruct it

#### Scenario: Inline raw file is accepted through attachment intake
- **WHEN** create contains one fileContent message with base64 `raw`, filename, and mediaType
- **THEN** channel MUST decode and submit the file through attachment intake validation
- **AND** MUST NOT log or expose the raw content

#### Scenario: Remote file is accepted through attachment intake
- **WHEN** create contains one fileContent message with `url`, filename, and mediaType
- **THEN** attachment runtime MUST enforce its remote locator, protocol, size, media type, and security policy
- **AND** channel MUST NOT directly download the URL

#### Scenario: Multiple input messages are rejected in the current version
- **WHEN** create or edit contains two or more TaskMessages
- **THEN** Task Channel MUST return HTTP 400
- **AND** MUST NOT produce runtime or attachment side effects

### Requirement: Batch Operation Semantics

Async create, async edit, async retry, cancel, and pending-input answer SHALL accept a `tasks` array body with a maximum of 20 items. Stream-task create, stream-task edit, and stream-task retry are single-task endpoints that do not use the `tasks` array wrapper; their response is an SSE stream.

Each item in a `tasks` array SHALL be processed independently. Partial failure SHALL NOT roll back successful items. The response SHALL be HTTP 200 with a `results` array when at least one item succeeds; each result SHALL contain the item `taskId`, `sessionId`, `taskStatus` on success, or an `error` object on failure. HTTP 400 SHALL be returned for request-level validation failures such as empty array, exceeding 20 items, or closed-schema violations, and when all items in a batch fail. In the all-items-failed case, the `results` array MUST still be returned with per-item `error` objects.

Request-level validation failures MUST reject the entire batch before any runtime invocation. Item-level failures MUST be reported per-item in `results` without affecting other items.

#### Scenario: Batch async create submits multiple tasks
- **WHEN** a caller posts an async create with 3 task items
- **THEN** Task Channel MUST submit 3 independent requests
- **AND** return 3 results in the same order as input

#### Scenario: Partial failure is isolated
- **WHEN** one task in a batch fails validation or runtime rejection
- **THEN** successful tasks MUST still be processed and returned with their `taskStatus`
- **AND** the failed task result MUST contain an `error` object
- **AND** HTTP status MUST be 200

#### Scenario: All items fail returns HTTP 400
- **WHEN** every item in a batch fails validation or runtime rejection
- **THEN** Task Channel MUST return HTTP 400
- **AND** each result MUST contain an `error` object
- **AND** the `results` array MUST be returned in the response body

#### Scenario: Batch limit is enforced
- **WHEN** a caller posts more than 20 task items
- **THEN** Task Channel MUST return HTTP 400
- **AND** MUST NOT invoke runtime for any item

#### Scenario: Empty batch is rejected
- **WHEN** a caller posts an empty `tasks` array
- **THEN** Task Channel MUST return HTTP 400

#### Scenario: Stream-task is single-task
- **WHEN** a caller posts to `POST /api/v1/stream-task`
- **THEN** the request body MUST be a single task object, not a `tasks` array
- **AND** the response MUST be an SSE stream, not a JSON batch response

### Requirement: Task Create and Stream SSE

`POST /api/v1/stream-task` SHALL accept a single task body containing `taskMessages`, optional `sessionId`, optional `locale`, optional `idempotencyKey`, and optional `reportEvents`. Public create schema MUST NOT accept `mode`, `callbackTarget`, `inputText`, `routingConstraints`, `callbackClipTarget`, `runId`, `contextId`, owner scope, or agent scope fields.

The response SHALL be an SSE stream (`text/event-stream`) directly returned as the HTTP response body. The first event MUST be `TASK_ACCEPTED` carrying `sessionId` and `taskId`. The stream SHALL push all process events (except filtered types), terminal events, and `USER_INPUT_REQUIRED`. The stream SHALL remain open until a terminal event is emitted, after which the stream closes.

`reportEvents` parameter accepts an event type list or `"ALL"`/`"TERMINAL"`; it is reserved and the event filtering engine is not implemented in this version. Current behavior is equivalent to `ALL` (except the 4 always-filtered event types).

Channel-layer event filtering: `BACKGROUND_TASK_STARTED`, `BACKGROUND_TASK_COMPLETED`, `BACKGROUND_TASK_FAILED`, and `OUTPUT_GUARD_BLOCKED` SHALL NOT be pushed to SSE or callback consumers.

`GET /api/v1/task/:taskId/stream` SHALL NOT be registered as a route; requests to it return HTTP 404. The `lastSeenSequence` replay design is preserved for future enablement.


#### Scenario: Stream-task create returns SSE directly
- **WHEN** a caller posts a valid single-task body to `POST /api/v1/stream-task`
- **THEN** the response Content-Type MUST be `text/event-stream`
- **AND** the SSE stream MUST include all process events and terminal events
- **AND** MUST close after the terminal event

#### Scenario: First event is TASK_ACCEPTED
- **WHEN** a caller posts a valid create body
- **THEN** the first SSE event MUST be `TASK_ACCEPTED` carrying `sessionId` and `taskId`

#### Scenario: GET stream returns 404
- **WHEN** a caller requests `GET /api/v1/task/:taskId/stream`
- **THEN** Task Channel MUST return HTTP 404
- **AND** MUST NOT establish any stream connection

#### Scenario: Create always creates new session
- **WHEN** a valid create body is posted
- **THEN** Task Channel MUST create a new session and submit one request
- **AND** MUST return the request id as `taskId` in the first SSE event
- **AND** the session is 1:1 with the task

#### Scenario: Stream-task create submit failure cleans up session
- **WHEN** the channel creates a new session and `RuntimeCommandPort.submit` throws before run acceptance
- **THEN** Task Channel MUST best-effort delete the newly created session via `RuntimeSessionPort.deleteSession`
- **AND** the original error MUST be returned to the caller
- **AND** the session MUST NOT remain in the session list

#### Scenario: External routing constraints are rejected
- **WHEN** a create or edit body contains `routingConstraints`
- **THEN** Task Channel MUST return HTTP 400
- **AND** skill or recipe routing MUST remain owned by the existing trusted Agent/core routing path

#### Scenario: Legacy fields are rejected
- **WHEN** a create body contains `mode` or `callbackTarget`
- **THEN** Task Channel MUST return HTTP 400

#### Scenario: Filtered event types are not pushed
#### Scenario: SSE stream interruption recovery via POST query
- **WHEN** a stream-task SSE connection is interrupted mid-stream
- **THEN** the caller MUST recover via `POST /api/v1/tasks/query` to obtain current taskStatus and data
- **AND** Task Channel MUST NOT provide a GET stream replay endpoint (GET stream returns 404)
- **AND** the `lastSeenSequence` replay design is preserved for future enablement but not implemented in this version

- **WHEN** a `BACKGROUND_TASK_STARTED`, `BACKGROUND_TASK_COMPLETED`, `BACKGROUND_TASK_FAILED`, or `OUTPUT_GUARD_BLOCKED` event occurs
- **THEN** Task Channel MUST NOT push it to SSE or callback consumers

### Requirement: Async Task Create

`POST /api/v1/async-tasks` SHALL require body `tasks` array; each item SHALL contain `taskMessages` and `callbackTarget` with `url`, and MAY contain `sessionId`, `locale`, and `reportEvents`. The body SHALL NOT accept `idempotencyKey` or `mode`.

Each async task item SHALL trigger callback delivery through the Task Channel-owned `TaskCallbackDeliveryPort`. The callback target URL SHALL be validated against the trusted allowlist before request submission. If callback delivery is not configured, async create SHALL fail with HTTP 503.

The `reportEvents` parameter controls callback event scope:
- `"TERMINAL"` (default): callback pushes only `TASK_COMPLETED`, `TASK_FAILED`, `TASK_CANCELED`, and `USER_INPUT_REQUIRED`.
- `"ALL"`: callback additionally pushes process events.
- Event type list: reserved, event filtering engine not implemented; current behavior is equivalent to `"ALL"`.

The response SHALL be `{ results: TaskControlResponse[] }` where each `TaskControlResponse` contains `sessionId`, `taskId`, and `taskStatus`.

#### Scenario: Async create triggers callback delivery
- **WHEN** an async create item is accepted
- **THEN** Task Channel MUST register callback delivery for that task
- **AND** return `taskStatus` TASK_ACCEPTED in the result

#### Scenario: Async create requires callbackTarget
- **WHEN** an async create item omits `callbackTarget`
- **THEN** Task Channel MUST return HTTP 400

#### Scenario: Async callback unavailable
- **WHEN** callback delivery port is not configured
- **THEN** Task Channel MUST return HTTP 503
- **AND** MUST NOT submit any task

#### Scenario: reportEvents ALL pushes process events via callback
- **WHEN** an async create request has `reportEvents="ALL"`
- **THEN** callback delivery MUST push process events in addition to terminal events

#### Scenario: reportEvents TERMINAL pushes only terminal events
- **WHEN** an async create request has `reportEvents="TERMINAL"` (or omitted)
- **THEN** callback delivery MUST push only `TASK_COMPLETED`, `TASK_FAILED`, `TASK_CANCELED`, and `USER_INPUT_REQUIRED`

#### Scenario: Failed async item does not trigger callback delivery
- **WHEN** an async create item fails validation or runtime rejection
- **THEN** Task Channel MUST NOT trigger callback delivery for that item
- **AND** the failed item result MUST contain an `error` object
#### Scenario: Async create submit failure cleans up session
- **WHEN** an async create item's `RuntimeCommandPort.submit` throws before run acceptance
- **THEN** Task Channel MUST best-effort delete that item's newly created session via `RuntimeSessionPort.deleteSession`
- **AND** the failed item result MUST contain the original `error` object
- **AND** other items in the batch MUST NOT be affected

### Requirement: Stream-task Edit and Retry

`POST /api/v1/stream-task/:taskId/edit` SHALL accept a single task body containing `taskId` (path parameter), `sessionId`, `taskMessages`, required `idempotencyKey`, optional `locale`, and optional `reportEvents`. The response SHALL be an SSE stream (`text/event-stream`) directly returned as the HTTP response body.

`POST /api/v1/stream-task/:taskId/retry` SHALL accept a body containing `taskId` (path parameter) and `sessionId` only. The channel generates the idempotencyKey internally. The response SHALL be an SSE stream.

Edit creates a new `requestId` (new `taskId`); the SSE stream MUST carry the new `taskId` in the first `TASK_ACCEPTED` event. Retry preserves the same `requestId` (same `taskId`); the SSE stream MUST carry `attempt` in the `TASK_ACCEPTED` event payload.

Stream-task edit SHALL support multipart form-data for file upload, reusing the create multipart parsing logic. Multipart fields MUST be limited to `taskMessages`, `sessionId`, `locale`, `idempotencyKey`, and `reportEvents`.

Both endpoints MUST NOT accept `mode`, `callbackTarget`, `routingConstraints`, `runId`, `contextId`, or `callbackClipTarget`.

#### Scenario: Stream-task edit returns SSE with new taskId
- **WHEN** a caller posts a valid edit body to `POST /api/v1/stream-task/:taskId/edit`
- **THEN** the response Content-Type MUST be `text/event-stream`
- **AND** the first SSE event MUST be `TASK_ACCEPTED` carrying the new `taskId`

#### Scenario: Stream-task retry returns SSE with same taskId and attempt
- **WHEN** a caller posts a valid retry body to `POST /api/v1/stream-task/:taskId/retry`
- **THEN** the response Content-Type MUST be `text/event-stream`
- **AND** the first SSE event MUST be `TASK_ACCEPTED` carrying the same `taskId` and `attempt`

#### Scenario: Stream-task edit requires idempotencyKey
- **WHEN** a stream-task edit request omits `idempotencyKey`
- **THEN** Task Channel MUST return HTTP 400

#### Scenario: Stream-task edit supports multipart
- **WHEN** a caller posts multipart form-data to `POST /api/v1/stream-task/:taskId/edit`
- **THEN** the response MUST be an SSE stream
- **AND** multipart fields MUST be limited to `taskMessages`, `sessionId`, `locale`, `idempotencyKey`, and `reportEvents`

### Requirement: Async-tasks Edit and Retry

`POST /api/v1/async-tasks/edit` SHALL accept a `tasks` array body (maxItems=20); each item SHALL contain `taskId`, `sessionId`, `taskMessages`, required `idempotencyKey`, and optional `locale`. The response SHALL be `{ results: TaskControlResponse[] }`.

`POST /api/v1/async-tasks/retry` SHALL accept a `tasks` array body (maxItems=20); each item SHALL contain `taskId` and `sessionId` only. The channel generates the idempotencyKey internally. The response SHALL be `{ results: TaskControlResponse[] }` where each retry result additionally contains `attempt`.

Async edit result `taskId` MUST be the new runtime request id. Async retry result `taskId` MUST remain the same runtime request id, with `attempt` incremented.

Both endpoints MUST NOT accept `reportEvents`, `mode`, `callbackTarget`, `routingConstraints`, `runId`, `contextId`, or `callbackClipTarget`.

#### Scenario: Async edit returns JSON with new taskId
- **WHEN** a caller posts a valid edit batch to `POST /api/v1/async-tasks/edit`
- **THEN** each result MUST contain `sessionId`, `taskId` (new), and `taskStatus`

#### Scenario: Async retry returns JSON with attempt
- **WHEN** a caller posts a valid retry batch to `POST /api/v1/async-tasks/retry`
- **THEN** each result MUST contain `sessionId`, `taskId` (same), `taskStatus`, and `attempt`

#### Scenario: Async edit requires idempotencyKey per item
- **WHEN** an async edit item omits `idempotencyKey`
- **THEN** that item result MUST contain an `error` object


### Requirement: Pending-input Answer

`POST /api/v1/tasks/pending-inputs/answer` SHALL accept a `tasks` array body (maxItems=20); each item SHALL contain `taskId`, `pendingInputId`, `sessionId`, and top-level `answers: string[][]`. The body SHALL NOT accept `taskMessages`, `idempotencyKey`, `mode`, `runId`, `contextId`, or `callbackClipTarget`.

Answer uses top-level `answers` aligned with web channel, not `taskMessages` wrapper. Channel SHALL validate answer cardinality (non-empty ordered string arrays), body `sessionId`/`taskId`/`pendingInputId` three-way consistency, and owner/agent scope before projecting to runtime `AnswerPendingInputCommand`. Channel generates an internal idempotency key when submitting to runtime.

PendingInput answer differentiation by kind is handled by user-check, not by Task Channel. Channel does not interpret `kind` or apply kind-specific terminal state logic.

#### Scenario: Answer with top-level answers is accepted
- **WHEN** a caller posts a valid answer with top-level `answers: string[][]`
- **THEN** Task Channel MUST project to runtime and return `taskStatus`

#### Scenario: Answer with taskMessages wrapper is rejected
- **WHEN** an answer item contains `taskMessages` instead of top-level `answers`
- **THEN** Task Channel MUST return HTTP 400

#### Scenario: Answer three-way consistency is enforced
- **WHEN** body `taskId` does not match the active run for `sessionId`
- **OR** `pendingInputId` does not belong to the `taskId` request
- **THEN** Task Channel MUST return a safe not-found or conflict error
- **AND** MUST NOT reveal cross-owner data

#### Scenario: Cross-scope answer is hidden
- **WHEN** a caller answers a pending input owned by another owner or agent scope
- **THEN** Task Channel MUST return a safe not-found error

- **AND** other successful items in the batch MUST still receive callback delivery
### Requirement: Unified Task Control Response

Async create, async edit, async retry, cancel, and pending-input answer SHALL return a common response containing `sessionId`, `taskId`, and `taskStatus`. The response MUST NOT contain `runId`, `contextId`, `requestId`, or `targetRequestId`. Every successful task control response MUST contain `taskStatus`. Batch responses SHALL wrap individual responses in a `results` array.

Async retry response SHALL additionally contain `attempt` (the incremental retry sequence number from runtime `RequestAccepted.attempt`). Stream-task retry SSE events SHALL carry the same `attempt` in the `TASK_ACCEPTED` event payload.

Edit and Retry taskId behavior:
- **Edit**: runtime `editLatest` creates a new `requestId`; channel returns the new `requestId` as `taskId`. The old request is superseded. `attempt` is reset to 1.
- **Retry**: runtime `retryLatest` preserves the same `requestId`; channel returns the same `taskId`. `attempt` is incremented.

idempotencyKey differentiation:
- Create: optional; channel generates UUID when absent.
- Edit: required; runtime enforces non-empty idempotencyKey.
- Retry: not accepted; channel generates UUID internally, same as cancel.
- Answer: optional; channel generates UUID when absent.
- Query: not accepted; query is a read-only operation and does not require idempotencyKey.
Edit, retry, and cancel request body items SHALL require `sessionId` and `taskId`. Task Channel SHALL pass body `sessionId` to the existing runtime command and body `taskId` as `expectedLatestRequestId`; runtime SHALL enforce latest-request and owner/agent scope checks. These controls MUST NOT require a new request lookup contract.

Edit request body SHALL NOT accept `reportEvents` in the async path. Async edit returns a JSON response and does not establish an SSE stream. Stream-task edit (`POST /api/v1/stream-task/:taskId/edit`) returns SSE directly.

Stream-task edit and stream-task retry SHALL support multipart form-data for file upload, reusing the create multipart parsing logic.

Cancel success MUST return the common response with `TASK_CANCELED`. Duplicate cancel calls return the current task status without error.

#### Scenario: Cancel returns unified response
- **WHEN** cancel transitions a task to canceled
- **THEN** result MUST contain its sessionId and taskId
- **AND** `taskStatus` MUST be `TASK_CANCELED`
- **AND** the response MUST NOT contain `runId` or `contextId`

#### Scenario: Edit creates new taskId
- **WHEN** edit creates a new attempt for the request
- **THEN** result taskId MUST be the new runtime request id
- **AND** the old request MUST be superseded
- **AND** `attempt` MUST be 1

#### Scenario: Retry preserves taskId and increments attempt
- **WHEN** retry creates a new attempt for the request
- **THEN** result taskId MUST remain the same runtime request id
- **AND** `attempt` MUST be incremented

#### Scenario: Duplicate cancel is safe
- **WHEN** cancel is called on an already-canceled task
- **THEN** the result MUST return the current `taskStatus` without error

#### Scenario: Edit requires idempotencyKey
- **WHEN** an edit request omits `idempotencyKey`
- **THEN** Task Channel MUST return HTTP 400

### Requirement: TaskStatus Projection

TaskStatus SHALL contain `TASK_ACCEPTED`, `TASK_QUEUED`, `TASK_PLANNING`, `TASK_EXECUTING`, `TASK_PENDING`, `TASK_COMPLETED`, `TASK_FAILED`, `TASK_CANCELED`, and `TASK_SUPERSEDED`.

When an active PendingInput exists for the request's current run, projection MUST return `TASK_PENDING`; otherwise projection MUST prefix the current RunStatus with `TASK_`. This projection MUST NOT add `PENDING` to runtime RunStatus.

#### Scenario: Active PendingInput projects pending
- **WHEN** a request has RunStatus EXECUTING and an active PendingInput with status PENDING
- **THEN** Task Channel MUST return `TASK_PENDING`

#### Scenario: Non-pending run maps normally
- **WHEN** a request has no active PendingInput
- **THEN** Task Channel MUST project its RunStatus using the TASK_ prefix

### Requirement: Task Batch Reconciliation Query

Task Channel SHALL implement `POST /api/v1/tasks/query` as an owner-scoped and agent-scoped reconciliation endpoint over persisted runtime request facts. Its primary scenario is recovering from lost `USER_INPUT_REQUIRED` callback notifications or service restarts: the caller queries `taskStatus` and compares it against its own status to determine the next action.

Request body SHALL be `{ tasks: [{ sessionId, taskId }] }` with a maximum of 20 items. Each item carries its own `sessionId` and `taskId`, supporting cross-session batch queries. Query is a read-only operation and does not require `idempotencyKey`. Single-task path-based query endpoints SHALL NOT be provided.

Response SHALL be `{ results: [...] }`. Each result item SHALL contain `sessionId`, `taskId`, and `taskStatus`. Results MUST NOT include tasks outside the trusted Owner Scope and Agent Scope. Task Channel MUST resolve `taskId` as `requestId` and call `RuntimeSessionPort.getRequestSummary` to retrieve the request summary. If the summary is undefined, the per-item result MUST be a safe not-found error.

When the summary contains `activePendingInput`, the projected status MUST be `TASK_PENDING` and the result MUST inline a flat `data` field containing `pendingInputId`, `kind`, `questions`, and optional `overtime`.

The `kind` field SHALL be one of `QUESTION`, `CONFIRMATION`, `AUTHORIZATION`, or `HUMAN_HANDOFF`. The `questions` field SHALL be an array of structured question objects. Each question object SHALL contain `prompt` (non-empty string) and `options` (array of option objects). Each option object SHALL contain `label` (string) and `value` (string), and MAY contain `requiresTextInput` (boolean) and `inputPlaceholder` (string). Each question object MAY additionally contain `multiple` (boolean) and `custom` (boolean). The channel MUST project these fields verbatim from the runtime `PendingInputRequest` without interpretation or filtering.

When the summary status is terminal (COMPLETED, FAILED, CANCELED, SUPERSEDED) and `terminalResult` is present, the result MUST inline the terminal result as a flat `data` field. For `TASK_COMPLETED`, `data` contains `content` and `contentType`. For `TASK_FAILED`, `data` contains `content`, `contentType`, and optional safe error fields (`code`, `retryable`). When `terminalResult` is absent, the result omits `data`.

Non-terminal, non-pending statuses (e.g., `TASK_EXECUTING`) return only `sessionId`, `taskId`, and `taskStatus` without `data`.

`overtime` SHALL equal the runtime `timeoutAt` absolute epoch-millisecond value. When `timeoutAt` is absent, `overtime` MUST be absent.

#### Scenario: Known task is queried
- **WHEN** a caller supplies an accessible sessionId and taskId
- **THEN** Task Channel MUST return the matching task summary with projected taskStatus
- **AND** the summary MUST be derived from persisted request facts via RuntimeSessionPort.getRequestSummary

#### Scenario: Terminal task returns result data
- **WHEN** a queried task has terminal status and `terminalResult` is present
- **THEN** the result MUST inline `data` containing the terminal content
- **AND** for TASK_COMPLETED `data` MUST contain `content` and `contentType`

#### Scenario: Lost pending notification is recovered
- **WHEN** a queried task has an active PendingInput
- **THEN** its status MUST be `TASK_PENDING`
- **AND** `data` MUST contain `pendingInputId`, `kind`, `questions`, and optional `overtime`
- **AND** status and pendingInput MUST describe the same logical snapshot

#### Scenario: Pending input questions expose structured fields
- **WHEN** a queried task has an active PendingInput with kind `QUESTION`
- **AND** the pending input contains questions with `prompt`, `options`, `multiple`, and `custom`
- **THEN** `data.questions` MUST be an array where each item contains `prompt`, `options`, `multiple`, and `custom`
- **AND** each `options` item MUST contain `label` and `value`
- **AND** each `options` item MAY contain `requiresTextInput` and `inputPlaceholder` when present in the runtime pending input

#### Scenario: Cross-session batch query succeeds
- **WHEN** a caller supplies tasks from different sessions
- **THEN** Task Channel MUST return each task result independently
- **AND** per-item failures MUST NOT block other items

#### Scenario: Task not found is a safe per-item error
- **WHEN** a queried taskId does not match any run in the session lane snapshot
- **THEN** the per-item result MUST be a safe not-found error
- **AND** MUST NOT reveal cross-owner data

#### Scenario: Cross-scope task is hidden
- **WHEN** a caller queries a task owned by another owner or agent scope
- **THEN** Task Channel MUST return a safe not-found error
- **AND** MUST NOT reveal its existence

### Requirement: Unified Task Event Structure

All SSE stream events and async callback events SHALL use a single unified `TaskEvent` structure. The structure SHALL align with channel-web `StreamEnvelope` field naming while removing internal diagnostic fields.

`TaskEvent` SHALL contain:
- `eventId`: stable event identifier
- `eventType`: `TaskEventType`
- `sessionId`: session coordinate
- `taskId`: request identity (mapped from runtime `requestId`)
- `sequence`: monotonic event sequence
- `createdAt`: epoch-millisecond timestamp (same field name as channel-web)
- `payload`: event-specific data as JSON object (same field name as channel-web)

`TaskEvent` MUST NOT contain `runId`, `requestContextId`, `transportHints`, `timelineEventRef`, `attempt`, or any internal runtime alias. The `payload` SHALL carry event-specific fields projected from the runtime timeline event, consistent with channel-web payload projection.

SSE events and callback events MUST use the same `TaskEvent` structure. The callback body SHALL be `{ events: TaskEvent[] }`.

Channel-layer event filtering: `BACKGROUND_TASK_STARTED`, `BACKGROUND_TASK_COMPLETED`, `BACKGROUND_TASK_FAILED`, and `OUTPUT_GUARD_BLOCKED` SHALL NOT be projected to SSE or callback consumers. The TaskEventType enum retains all 23 values for exhaustive mapping safety, but these 4 types are filtered at projection time.

#### Scenario: SSE event uses unified structure
- **WHEN** a POST stream-task SSE event is emitted
- **THEN** the event MUST contain `eventId`, `eventType`, `sessionId`, `taskId`, `sequence`, `createdAt`, and `payload`
- **AND** MUST NOT contain `runId`, `requestContextId`, `transportHints`, or `timelineEventRef`

#### Scenario: Callback event uses same structure as SSE
- **WHEN** an async callback event is delivered
- **THEN** the event structure MUST be identical to the SSE event structure
- **AND** the callback body MUST be `{ events: TaskEvent[] }`

#### Scenario: Filtered event types are not pushed
- **WHEN** a `BACKGROUND_TASK_STARTED`, `BACKGROUND_TASK_COMPLETED`, `BACKGROUND_TASK_FAILED`, or `OUTPUT_GUARD_BLOCKED` event occurs
- **THEN** Task Channel MUST NOT project it to SSE or callback consumers

### Requirement: TaskEventType Exhaustive Projection

TaskEventType SHALL provide an exhaustive mapping for every StreamEventType. Mapping SHALL replace `REQUEST_` with `TASK_`, remove `LLM_`, and preserve all other names. It SHALL include `BACKGROUND_TASK_STARTED`, `BACKGROUND_TASK_COMPLETED`, `BACKGROUND_TASK_FAILED`, and `OUTPUT_GUARD_BLOCKED`.

Channel-layer filtering: these 4 event types SHALL NOT be pushed to SSE or callback consumers. The enum retains all values for compile-time exhaustive safety; filtering is a runtime projection behavior.

#### Scenario: New event types are mapped without assertion
- **WHEN** any currently defined StreamEventType is projected
- **THEN** exactly one TaskEventType MUST be returned
- **AND** implementation MUST NOT rely on an unchecked type assertion for missing cases

#### Scenario: Contract detects future drift
- **WHEN** StreamEventType gains a value without a corresponding TaskEventType mapping
- **THEN** compile-time exhaustive checking or contract tests MUST fail

### Requirement: HTTP IR Async Callback Delivery

Async task create SHALL require `callbackTarget.url` and deliver through a Task Channel-owned `TaskCallbackDeliveryPort` and narrowed HTTP implementation. The implementation SHALL only POST the fixed callback JSON schema and MUST NOT accept arbitrary method, headers, credentials, or body. Task Channel MUST NOT invoke CLIP or call a model-visible Tool provider.

One callback request SHALL contain `events: TaskEvent[]` with at least one event, allowing multiple ordered events in one request. The `reportEvents` parameter controls which events are pushed: `"TERMINAL"` (default) pushes only `TASK_COMPLETED`, `TASK_FAILED`, `TASK_CANCELED`, and `USER_INPUT_REQUIRED`; `"ALL"` additionally pushes process events. Event type list is reserved; the filtering engine is not implemented, and current behavior is equivalent to `"ALL"`. Each event SHALL use the unified `TaskEvent` structure.

Channel-layer event filtering: `BACKGROUND_TASK_STARTED`, `BACKGROUND_TASK_COMPLETED`, `BACKGROUND_TASK_FAILED`, and `OUTPUT_GUARD_BLOCKED` SHALL NOT be pushed via callback regardless of `reportEvents` setting.

`USER_INPUT_REQUIRED` payload SHALL additionally contain `overtime` as absolute epoch milliseconds when `timeoutAt` is present. Callback retries MUST retain eventId and ordering. Consumers SHALL be able to process duplicate eventId idempotently.

`callbackTarget` retains the existing `{ url }` structure. `parameters[]` enhancement is deferred.

#### Scenario: Multiple events are pushed in one call
- **WHEN** the callback projection has multiple ordered deliverable events ready
- **THEN** TaskCallbackDeliveryPort MAY send them in one events array
- **AND** their canonical sequence order MUST be preserved

#### Scenario: User input callback carries recovery data
- **WHEN** USER_INPUT_REQUIRED is projected
- **THEN** callback event payload MUST include pending input data and `overtime` when present

#### Scenario: reportEvents TERMINAL limits callback events
- **WHEN** `reportEvents="TERMINAL"` and a process event (e.g., CONTENT_DELTA) occurs
- **THEN** Task Channel MUST NOT send it through async callback

#### Scenario: reportEvents ALL pushes process events
- **WHEN** `reportEvents="ALL"` and a process event (e.g., CONTENT_DELTA) occurs
- **THEN** Task Channel MUST push it through async callback

#### Scenario: Filtered event types are never pushed
- **WHEN** a `BACKGROUND_TASK_*` or `OUTPUT_GUARD_BLOCKED` event occurs
- **THEN** Task Channel MUST NOT push it through async callback regardless of `reportEvents`

#### Scenario: Callback failure does not change runtime truth
- **WHEN** HTTP callback fails or times out after bounded retries
- **THEN** RequestRun, PendingInput, terminal result, and canonical timeline MUST remain unchanged
- **AND** the caller MUST be able to recover through POST reconciliation query
### Requirement: Task Callback Narrow Transport Boundary

HTTP callback implementation SHALL be owned by `agent-channel-task` as a dedicated outbound transport. TaskCallbackDeliveryPort SHALL accept only callback target, ordered TaskEvent array, and cancellation signal. It MUST NOT expose a generic HTTP request shape. Trusted app configuration MUST provide a non-empty exact-origin allowlist before network callback delivery is available. When no allowlist is configured, network callback delivery MUST remain unavailable and async create MUST fail with HTTP 503 before request submission. A remote UDS callback path MAY use the app composition-owned fixed local origin instead of a configured network origin. Trusted app configuration SHALL provide transport limits. When `tlsInsecure` is configured as true, callback delivery to an allowlisted HTTPS target SHALL skip TLS certificate verification for the callback channel only; all other HTTPS connections in the process remain unaffected.

#### Scenario: Callback target is outside trusted policy
- **WHEN** callbackTarget.url does not satisfy configured protocol, credential, or fragment policy
- **THEN** the item MUST fail safely before callback subscription
- **AND** MUST NOT attempt the network request
- **AND** in a batch, the failed item MUST be reported in `results` without affecting other items

#### Scenario: Callback delivery with empty allowlist
- **WHEN** no callback URL allowlist is configured
- **AND** no remote UDS callback path is assembled
- **THEN** async create MUST fail with HTTP 503 before request submission
- **AND** the system MUST NOT attempt a network request

#### Scenario: Callback delivery with self-signed TLS certificate
- **WHEN** `tlsInsecure` is configured as true
- **AND** callbackTarget.url uses an allowlisted https origin
- **THEN** callback delivery SHALL skip TLS certificate verification
- **AND** other HTTPS connections in the process SHALL remain subject to standard TLS verification

#### Scenario: Narrow transport cannot become generic executor
- **WHEN** Task Channel invokes TaskCallbackDeliveryPort
- **THEN** caller MUST NOT be able to choose an arbitrary method, header set, credential, or request body
- **AND** delivery MUST use the fixed Task callback POST schema

### Requirement: Traceparent Header Transparency

All Task Channel endpoints SHALL accept the W3C `traceparent` request header without rejecting or filtering it. The channel SHALL NOT parse, validate, log, or process the header value in the current version. Trace context propagation to runtime, capability, and outbound CLIP calls is deferred to a separate change.

#### Scenario: Traceparent header is accepted
- **WHEN** a request includes a `traceparent` header
- **THEN** Task Channel MUST NOT reject the request based on that header
- **AND** MUST NOT parse or store the header value

#### Scenario: Absent traceparent header is accepted
- **WHEN** a request does not include a `traceparent` header
- **THEN** Task Channel MUST process the request normally

### Requirement: Task Channel Safe Error And Capacity Boundary

All Task Channel request, query, multipart, inline file, callback, and SSE stream boundaries SHALL use runtime schema validation. Safe errors, logs, metrics, traces, and audit facts MUST NOT contain raw file content, prompt/model output, callback body, credential, token, stack, or unsafe URL details.

#### Scenario: Oversized batch is rejected
- **WHEN** a query or mutation body contains more than 20 task items
- **THEN** Task Channel MUST return HTTP 400 without querying an unbounded dataset or invoking runtime

#### Scenario: Unsafe inline file is rejected
- **WHEN** raw encoding, media type, size, or remote URL violates attachment policy
- **THEN** Task Channel MUST reject it with a safe error
- **AND** MUST not submit the request

#### Scenario: Legacy public fields are rejected
- **WHEN** a client supplies `inputText`, `routingConstraints`, `mode`, `runId`, `contextId`, or `callbackClipTarget` to any endpoint, or `idempotencyKey` to cancel or answer endpoints
- **THEN** closed schema validation MUST return HTTP 400

#### Scenario: Deleted stream endpoints return 404
- **WHEN** a caller requests `WS /api/v1/task/:taskId/ws` or `GET /api/v1/task/:taskId/stream`
- **THEN** Task Channel MUST return HTTP 404
- **AND** MUST NOT establish any stream connection
- Query: not accepted; query is a read-only operation and does not require idempotencyKey.
Request body SHALL be `{ tasks: [{ sessionId, taskId }] }` with a maximum of 20 items. Each item carries its own `sessionId` and `taskId`, supporting cross-session batch queries. Query is a read-only operation and does not require `idempotencyKey`. Single-task path-based query endpoints SHALL NOT be provided.
`POST /api/v1/stream-task` SHALL accept a single task body containing `taskMessages`, optional `locale`, optional `idempotencyKey`, and optional `reportEvents`. Create SHALL NOT accept `sessionId`; channel always creates a new session and the task is 1:1 with the session. Public create schema MUST NOT accept `mode`, `callbackTarget`, `inputText`, `routingConstraints`, `sessionId`, `callbackClipTarget`, `runId`, `contextId`, owner scope, or agent scope fields.
Multipart form-data SHALL be accepted for file upload on stream-task create; the response is still SSE. Multipart fields MUST be limited to `taskMessages`, `locale`, `idempotencyKey`, and `reportEvents`.

## 规格

| 规范项 | 值 |
|---|---|
| 最大批量 item 数 | 20 |
| 当前版本 create/edit TaskMessage 数 | 1（数组契约保留供后续扩展） |
| 外部坐标 | taskId=runtime requestId, sessionId=runtime sessionId |
| 不对外暴露 | requestId, runId, contextId, attempt（仅 retry 响应暴露） |
| 事件过滤 | BACKGROUND_TASK_STARTED/COMPLETED/FAILED, OUTPUT_GUARD_BLOCKED 不推送给消费者 |
| callback 传输 | 固定 POST JSON schema，非通用 HTTP executor |
