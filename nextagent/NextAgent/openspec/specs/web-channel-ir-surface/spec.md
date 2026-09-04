# web-channel-ir-surface Specification

## Purpose

定义 web-channel 的机机交互 IR surface：在 `/api/v1/ir` URL prefix 下提供与 ER 协议对等的 6 个端点，通过 trusted-header 身份解析和独立认证隔离实现外部系统集成。IR surface 复用 ER 的 DTO、schema、stream envelope 和 runtime delegation，仅 URL prefix 和认证方式不同，不暴露 UI-only 端点、WebSocket 或 multipart 上传。
## Requirements
### Requirement: IR Surface Endpoint Set

web-channel SHALL provide an IR (machine-to-machine) surface under the `/api/v1/ir` URL prefix. The IR surface SHALL expose exactly the following 6 endpoints, mirroring the corresponding ER endpoint protocol, DTO, schema, and stream behavior:

- `POST /api/v1/ir/sessions` — create session
- `POST /api/v1/ir/sessions/:sessionId/requests` — submit request
- `GET /api/v1/ir/sessions/:sessionId/stream` — SSE stream consumption
- `POST /api/v1/ir/sessions/:sessionId/cancel` — cancel request
- `POST /api/v1/ir/sessions/:sessionId/retry` — retry latest request
- `POST /api/v1/ir/sessions/:sessionId/pending-inputs/:pendingInputId/answer` — answer pending input

The IR surface SHALL NOT expose any other ER endpoint. `registerWebChannel` SHALL accept a `routePrefix` parameter and construct route paths as `${routePrefix}/...`. ER registration SHALL pass `/api/v1` and IR registration SHALL pass `/api/v1/ir` with a route whitelist that registers only the 6 endpoints above.

#### Scenario: IR endpoints mirror ER protocol
- **WHEN** a caller sends a valid request to any of the 6 IR endpoints with correct identity headers
- **THEN** the response DTO, schema validation, stream envelope, and runtime delegation MUST be identical to the corresponding ER endpoint
- **AND** the only observable difference from ER MUST be the URL prefix

#### Scenario: IR surface does not expose UI-only ER endpoints
- **WHEN** the IR surface is registered
- **THEN** endpoints such as `/api/v1/ir/runtime/bootstrap`, `/api/v1/ir/skills`, `/api/v1/ir/frequent-questions`, `/api/v1/ir/sessions/:sessionId/conversation`, `/api/v1/ir/favorites`, and `/api/v1/ir/shares` MUST NOT be registered
- **AND** requesting those paths MUST return HTTP 404

#### Scenario: ER registration is unaffected by routePrefix parameterization
- **WHEN** ER routes are registered with `routePrefix` set to `/api/v1`
- **THEN** all existing ER endpoint paths MUST remain unchanged
- **AND** all existing ER behavior MUST remain identical

### Requirement: IR Identity From Trusted Headers

IR surface identity SHALL be derived from request headers `x-tenant-id`, `x-subject-id`, and `x-display-name` using the same `createTaskIdentityResolver` already used by task-channel. `x-tenant-id` and `x-subject-id` SHALL be required; `x-display-name` SHALL be optional and fall back to a configured default when absent.

The resolver SHALL operate in trusted-header mode: upstream gateway has already authenticated and injected these headers, and NextAgent SHALL read them without performing its own credential validation. Request body, query, metadata, and model output SHALL NOT override the identity derived from headers.

Agent scope SHALL NOT be derived from headers. It SHALL come from the persisted `session.agentId` returned by `requireSession`, identical to ER behavior.

#### Scenario: Valid headers produce trusted IdentityContext
- **WHEN** a request to an IR endpoint carries `x-tenant-id` and `x-subject-id` headers
- **THEN** the resolver MUST construct an `IdentityContext` with those values
- **AND** if `x-display-name` is present, it MUST be used as `displayName`; otherwise the configured default MUST be used

#### Scenario: Missing required headers are rejected
- **WHEN** a request to an IR endpoint omits `x-tenant-id` or `x-subject-id`
- **THEN** the resolver MUST throw an auth error
- **AND** the channel MUST return a safe 401 response
- **AND** MUST NOT create session, request run, message, attachment, pending input, or capability state

#### Scenario: Body cannot override header identity
- **WHEN** a request to an IR endpoint includes `tenantId`, `subjectId`, `agentId`, or other scope fields in the body
- **THEN** schema validation MUST reject or ignore those fields
- **AND** the trusted `IdentityContext` from headers MUST be the sole owner-scope input

#### Scenario: Agent scope is not from headers
- **WHEN** an IR request is processed
- **THEN** agent scope MUST be derived from the persisted session's `agentId`
- **AND** MUST NOT be derived from any request header

### Requirement: IR and ER Authentication Isolation

IR routes SHALL authenticate exclusively via trusted headers; ER routes SHALL authenticate exclusively via local cookie auth. The two authentication paths SHALL NOT cross-accept: a request with cookie but no headers MUST be rejected on IR routes, and a request with headers but no cookie MUST be rejected on ER routes.

Route classification SHALL direct each request to its corresponding auth gate before any runtime invocation. A failed or missing credential on either path SHALL produce a safe 401 response and MUST NOT produce any durable side effect.

#### Scenario: Cookie-only request is rejected on IR routes
- **WHEN** a request to an IR endpoint carries a valid ER cookie but no identity headers
- **THEN** the IR auth gate MUST reject it with a safe 401
- **AND** MUST NOT invoke any runtime port

#### Scenario: Header-only request is rejected on ER routes
- **WHEN** a request to an ER endpoint carries identity headers but no valid cookie
- **THEN** the ER auth gate MUST reject it with a safe 401 or challenge
- **AND** MUST NOT invoke any runtime port

#### Scenario: Auth failure produces no side effect
- **WHEN** any auth failure occurs on an IR or ER route
- **THEN** the system MUST NOT create or modify session, RequestRun, message, attachment, memory, pending input, checkpoint, timeline, or capability state

### Requirement: IR Stream Consumption

The IR SSE endpoint `GET /api/v1/ir/sessions/:sessionId/stream` SHALL behave identically to the ER stream endpoint in terms of replay, live-tail, terminal projection, abort, and cleanup semantics. It SHALL accept `lastSeenSequence`, `requestId`, and `runId` query parameters with the same validation and default behavior as ER.

Stream envelopes on the IR surface SHALL include the same canonical fields as ER. The guardrail forward relay, when a guardrail binding is present, SHALL apply to IR streams identically to ER streams.

#### Scenario: IR stream replays from lastSeenSequence
- **WHEN** a caller opens an IR stream with a valid `lastSeenSequence`
- **THEN** the stream MUST replay events with sequence greater than that value
- **AND** then continue with live events

#### Scenario: IR stream validates session scope
- **WHEN** a caller opens an IR stream for a session outside the trusted Owner Scope
- **THEN** stream establishment MUST fail with a safe not-found response
- **AND** MUST NOT subscribe to RuntimeSessionPort.streamEvents

### Requirement: IR Safe Error And Capacity Boundary

All IR endpoints SHALL use runtime schema validation on every untrusted boundary. Safe errors, logs, metrics, traces, and audit facts SHALL NOT contain prompt, model output, stream delta, credential, token, raw file content, or unsafe URL details. Cross-owner or cross-agent requests SHALL produce a safe not-found response without revealing existence.

#### Scenario: Cross-scope request is hidden
- **WHEN** a caller accesses an IR endpoint for a session owned by another owner or agent scope
- **THEN** the channel MUST return a safe 404 or equivalent safe error
- **AND** MUST NOT reveal the existence of the session

#### Scenario: Safe error does not leak sensitive data
- **WHEN** an IR request fails validation, runtime rejection, or guardrail block
- **THEN** the safe error response MUST NOT contain prompt, model output, credential, token, raw file content, or callback body

