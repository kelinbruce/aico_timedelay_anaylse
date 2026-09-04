# ts-run-status-visibility Specification

## Purpose
定义 TS 后端中用户可见请求状态和 stream projection 的事实来源、投影顺序、canonical vocabulary、降级表达和失败可见性，确保前端、transport 和 projection cache 不创建与 Runtime 竞争的生命周期事实。

## Function

- **所属 Function**：`FN-2.4 查看请求状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Run status visibility 的事实源
TS 后端 SHALL 只从 canonical `RequestRun.status` 和 committed runtime timeline 生成用户可见请求状态与 stream projection。Web channel、frontend、transport adapter、模型输出、能力输出或 projection cache MUST NOT 创建与 runtime facts 竞争的请求生命周期状态、终态或执行事实。

#### Scenario: request accepted 事件可见
- **WHEN** runtime 接受用户请求、创建 durable `RequestRun` 并发布 `REQUEST_ACCEPTED`
- **THEN** stream projection MUST 使用 `REQUEST_ACCEPTED`
- **AND** 用户可见状态 MUST 暴露该 run 当前 canonical `RequestRun.status`
- **AND** 如果当前主路径将受理后的 run 持久化为 `QUEUED`，用户可见状态 MUST 暴露 canonical `QUEUED` 而不是伪造 `ACCEPTED`
- **AND** 输出 MUST 可追溯到产生该状态的 run 或 timeline fact

#### Scenario: canonical status 原样可见
- **WHEN** 用户可见状态读取或 stream projection 需要表达 run lifecycle
- **THEN** 输出 MUST 原样使用 `ACCEPTED`、`QUEUED`、`PLANNING`、`EXECUTING`、`COMPLETED`、`FAILED`、`CANCELED` 或 `SUPERSEDED`
- **AND** 输出 MUST NOT 使用 transport-private status、frontend-local status 或 deprecated projection name 代替 canonical status

#### Scenario: 降级不是 RunStatus
- **WHEN** 模型、能力、context、checkpoint、audit、metric 或 transport 发生降级但 request lifecycle 仍可继续
- **THEN** `RunStatus` MUST 保持当前生命周期状态
- **AND** 降级 MUST 通过 `DEGRADATION_NOTICE`、safe error、audit event 或 observability metric 表达
- **AND** 系统 MUST NOT 引入 `DEGRADED` 或任何降级专用 `RunStatus`

### Requirement: Status visibility 触发条件和前置条件
TS 后端 SHALL 在已提交的 request lifecycle fact 可用时触发状态可见性投影，包括 admission、queue、planning、execution、model delta、capability invocation、context compaction、pending input、degradation、cancel、supersede 和 terminal fact。Status projection SHALL 是异步观察流程，MUST NOT 推进 runtime lifecycle，MUST NOT 生产 pending input、cancel、supersede、policy 或 compaction facts，也 MUST NOT 重新执行模型、能力、hook、pending input、checkpoint 或 terminal commit。

#### Scenario: committed fact 触发 projection
- **WHEN** runtime 提交 run status transition 或 committed timeline event
- **THEN** status projection MUST 以该 committed fact 作为输入
- **AND** projection MUST NOT 在 fact 提交前向用户暴露对应状态或 stream event

#### Scenario: projection 前置条件满足
- **WHEN** Web channel 准备投影 run status 或 stream event
- **THEN** 系统 MUST 已具备可信 identity、owner-scoped `sessionId`、`rootMessageId`、可选 `runId`、canonical run/timeline reader、timeline sequence、redaction boundary 和 SafeError normalizer
- **AND** client-supplied owner、tenant、subject 或等价字段 MUST NOT 覆盖 channel/auth boundary 注入的可信 identity

#### Scenario: pending input 前置条件满足
- **WHEN** pending input lifecycle fact 或 safe summary 已由 runtime-owned pending input boundary 提交并需要投影给用户
- **THEN** projection MUST 使用 runtime-owned pending input fact 或 safe summary
- **AND** projection MUST NOT 接受模型输出、客户端 payload 或 transport-private state 自报的 pending input status

### Requirement: Canonical stream projection vocabulary 约束
TS 后端 SHALL 将用户可见 stream event 投影限制在 core contracts 已冻结的 first-release `StreamEventType` vocabulary。Projection MUST 只消费 canonical timeline event 或 runtime status；MUST NOT 发明 deprecated、transport-specific 或 frontend-only event name。

#### Scenario: 模型和能力事件使用 canonical 名称
- **WHEN** timeline 中存在模型 thinking、模型 content、能力开始、能力结果增量或能力完成事实
- **THEN** stream projection MUST 分别输出 `LLM_THINKING_DELTA`、`LLM_CONTENT_DELTA`、`CAPABILITY_STARTED`、`CAPABILITY_RESULT_DELTA` 或 `CAPABILITY_COMPLETED`
- **AND** 输出 MUST 保留来源 timeline event 的追溯引用

#### Scenario: terminal event 使用 canonical 名称
- **WHEN** runtime 发布 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED`
- **THEN** stream projection MUST 输出匹配的 terminal stream event
- **AND** Web channel MUST NOT 因 stream close、client disconnect、empty output、transport success 或 projection cache 命中而合成 `REQUEST_COMPLETED`

#### Scenario: timeline-only event 不进入首版 stream
- **WHEN** timeline 中出现 `HOOK_INVOKED` 或 `POLICY_APPLIED`
- **THEN** 首版 stream projection MUST NOT 将其输出为用户可见 stream event
- **AND** 需要暴露这类事件时 MUST 先通过 contract refinement change 修改核心 vocabulary

#### Scenario: deprecated projection name 被拒绝
- **WHEN** 任一投影路径尝试输出 `STREAM_STARTED`、`THINKING_SUMMARY`、`CONTENT_DELTA`、`CAPABILITY_PROGRESS`、`CAPABILITY_FINISHED` 或 `CAPABILITY_DISCOVERED`
- **THEN** 系统 MUST 将其视为 projection contract violation
- **AND** deprecated name MUST NOT 被发送给用户可见 stream
- **AND** 系统 MUST 记录 safe diagnostic log 或 metric

### Requirement: Projection decision order 约束
TS 后端 SHALL 使用确定的 status projection 判断顺序：先校验 trusted identity 和 owner scope，再校验 request/run/timeline 坐标，再校验 canonical status/event vocabulary，再执行 event-specific projection 与 redaction，最后输出 stream/status、safe diagnostic、audit event 或 observability metric。不同 transport MUST NOT 使用互相冲突的判断顺序。

#### Scenario: owner scope 优先
- **WHEN** 用户读取或订阅 status、stream event 或 pending input visibility
- **THEN** 系统 MUST 在返回任何 run、timeline、pending input、model output 或 capability result 事实前校验 owner scope
- **AND** 校验失败 MUST 返回 authorization/not found safe error
- **AND** 响应 MUST NOT 暴露未授权对象是否存在

#### Scenario: vocabulary 校验早于输出
- **WHEN** projection 输入包含未知 status、未知 timeline event type 或不允许的 stream event type
- **THEN** 系统 MUST 返回 safe projection failure 或记录 contract violation diagnostic
- **AND** 系统 MUST NOT 输出未知或 deprecated 用户可见 event

#### Scenario: redaction 早于 payload 输出
- **WHEN** timeline payload 需要投影为用户可见 payload
- **THEN** projection MUST 在输出前执行 channel-safe projection 和 redaction
- **AND** raw prompt、raw model output、tool args/result、attachment content、secret、credential、本地路径或未授权对象内容 MUST NOT 进入用户可见 stream、safe log、audit event 或 metric

### Requirement: Stream projection artifact contract 约束
TS 后端 SHALL 将 `StreamEnvelope` 作为用户可见 wire projection，而不是 durable execution fact。`StreamEnvelope` MUST 保留 core contracts 已定义的 business coordinates、sequence、canonical event type、optional `timelineEventRef`、transport hints、payload 和 `createdAt` 语义；projection diagnostic MUST NOT 替代 canonical timeline、RequestRun、checkpoint、pending input、artifact、memory record 或 learning event。

#### Scenario: StreamEnvelope 可追溯但不替代事实
- **WHEN** stream envelope 从 timeline event 投影生成
- **THEN** envelope MUST 保留 `sessionId`、`requestId`、optional run/context refs、sequence、canonical event type 和 `timelineEventRef`
- **AND** `timelineEventRef` MUST 只作为追溯引用
- **AND** 消费方 MUST NOT 因拥有 `timelineEventRef` 而获得 raw timeline payload、raw model output、raw tool result 或 raw attachment content 权限

#### Scenario: diagnostic 不是执行事实
- **WHEN** projection 记录 latency、projection failure、redaction failure、runtime unavailable 或 delivery failure
- **THEN** diagnostic MUST 作为 safe log、metric 或 audit event 安全摘要记录
- **AND** diagnostic MUST NOT 被写入 canonical execution timeline 作为业务执行事实

### Requirement: Pending input status visibility 约束
TS 后端 SHALL 在 runtime-owned pending input boundary 已提交 `USER_INPUT_*` fact 时，通过 canonical `USER_INPUT_*` stream event 和 status visibility 暴露 pending input 生命周期。Pending input visibility MUST 保持 runtime-owned pending input boundary，且 MUST 只暴露核心契约允许的安全字段。本 capability MUST NOT 实现 pending input 创建、回答、超时或取消的生产路径。

#### Scenario: 用户输入请求可见
- **WHEN** runtime 为 active run 创建 pending input request
- **THEN** stream projection MUST 输出 `USER_INPUT_REQUIRED`
- **AND** payload MUST 使用 safe `PendingInputRequest` 形态，只包含 `id`、`sessionId`、`kind`、`questions` 和 `timeoutAt`
- **AND** payload MUST NOT 包含 identity、idempotency key、timeout behavior、raw prompt、raw answer 或 model-formatted answer

#### Scenario: 用户输入结果可见
- **WHEN** pending input 被收到、超时或取消
- **THEN** stream projection MUST 输出 `USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT` 或 `USER_INPUT_CANCELED`
- **AND** payload MUST 只包含 pending input id、kind、status 和安全摘要字段
- **AND** raw answer content MUST NOT 通过 status visibility 输出

### Requirement: Flow integration 和 downstream consumption
TS 后端 SHALL 将 run status visibility 接入已存在的 runtime lifecycle facts、timeline publisher facts、pending input facts、terminal events 和 Web channel stream projection。本 change SHALL 产出可被未来 audit/observability owning changes 消费的 `StreamEnvelope`、safe diagnostic 或 canonical timeline refs；本 change MUST NOT 实现新的 audit sink、metric sink 或 observability contract。任何 downstream consumer MUST NOT consume adapter-private state as execution truth。

#### Scenario: Web channel 只投影 runtime facts
- **WHEN** SSE 或 WebSocket 向用户暴露请求进度
- **THEN** Web channel MUST 读取 runtime-owned run/timeline facts 并投影为用户可见输出
- **AND** Web channel MUST NOT 持久化 transport-private RequestRun lifecycle、terminal state 或 competing execution fact

#### Scenario: downstream 消费安全投影
- **WHEN** frontend 消费 status visibility 输出，或未来 audit/observability owning change 消费该输出
- **THEN** 消费方 MUST 使用 `StreamEnvelope`、safe diagnostic 或 canonical timeline reference
- **AND** 消费方 MUST NOT 依赖 Web adapter private buffer、connection state 或 frontend-local state 作为事实来源

### Requirement: 显式 projection failure visibility
TS 后端 SHALL 对 status projection 中的 timeout、unavailable、projection resource-limit、read failure、projection failure、dependency missing、redaction failure、serialization failure 和 terminal projection failure 执行显式安全失败或降级提示。系统 MUST NOT 静默截断、静默丢弃、静默吞错或把 projection failure 投影为 successful terminal status。

#### Scenario: runtime 或 timeline 不可用
- **WHEN** projection 无法读取 required run 或 timeline facts，因为 runtime/gateway/timeline reader 不可用、超时、projection resource-limit 或依赖缺失
- **THEN** 系统 MUST 返回 SafeError 或 safe diagnostic
- **AND** 系统 MUST 返回可被 structured log、audit event 或 metric consumer 使用的 safe diagnostic
- **AND** 系统 MUST NOT 输出伪造 terminal event

#### Scenario: redaction 或 serialization 失败
- **WHEN** event payload redaction、SafeError normalization 或 transport serialization 失败
- **THEN** 系统 MUST NOT 输出 raw payload
- **AND** 系统 MUST 返回 safe projection failure 或 safe transport error
- **AND** diagnostic MUST NOT 包含 raw prompt、raw model output、tool args/result、attachment content、secret、credential、本地路径或未授权对象内容

#### Scenario: terminal projection 失败
- **WHEN** terminal timeline event 无法被安全投影为 terminal stream event
- **THEN** 系统 MUST 返回 safe diagnostic 或 safe transport error
- **AND** 系统 MUST 返回可追溯的 safe diagnostic，供 safe log、audit event 或 metric consumer 使用
- **AND** 系统 MUST NOT 输出伪 `REQUEST_COMPLETED`

### Requirement: Run status visibility 验收样例
TS 后端 SHALL 用验收样例覆盖正常路径、边界路径和失败/降级路径。验收 MUST 证明同一 `RequestRun` 的用户可见 status 和 stream projection 不产生互相冲突的用户可见事实。

#### Scenario: 正常路径
- **WHEN** 一个 request 完整提交 `REQUEST_ACCEPTED`、model delta、capability events、content delta 和 `REQUEST_COMPLETED`
- **THEN** stream MUST 暴露 canonical event sequence
- **AND** 用户可见 status MUST 最终暴露 `COMPLETED`
- **AND** 每个从 timeline 投影的 stream event MUST 可追溯到 source timeline event

#### Scenario: 边界路径
- **WHEN** RequestRun 处于 `QUEUED`、`PLANNING` 或 `EXECUTING`
- **THEN** 用户可见 status MUST 原样暴露当前 canonical status
- **AND** stream projection MUST NOT 发明未冻结的 planning、queue 或 executing stream event name
- **AND** partial output MUST NOT 被标记为 final terminal state

#### Scenario: 失败和降级路径
- **WHEN** projection 遇到 timeline read timeout、terminal projection failure、redaction failure 或 runtime unavailable
- **THEN** 系统 MUST 返回 safe error、safe diagnostic 或 `DEGRADATION_NOTICE`
- **AND** 系统 MUST 返回可追溯的 safe diagnostic，供 safe log、audit event 或 metric consumer 使用
- **AND** 系统 MUST NOT 输出伪 completed 或 deprecated stream event

### Requirement: Capability result stream payload MUST expose only safe result projections

When Web channel projects a `CAPABILITY_RESULT_DELTA` stream envelope, it MAY include `payload.safeResult` as a bounded, user-visible projection of the capability result. `safeResult` MUST be derived only from allowlisted result fields and MUST NOT expose hidden assistant tool-use messages, raw tool arguments, raw command/code input, runtime correlation ids, or arbitrary capability metadata.

`payload.safeSummary` SHOULD carry a short safe summary derived from the upstream `safeSummary` or from `safeResult`. Generic technical placeholders such as `Capability result is available.` MUST NOT be propagated as effective `safeSummary`. `payload.text` and `payload.content` MUST contain safe detail text when such text is available, or empty strings otherwise. They MUST NOT contain generic technical placeholders.

When Web channel projects a Web-visible capability failure on `CAPABILITY_RESULT_DELTA` or `CAPABILITY_COMPLETED`, it MUST preserve only safe failure facts such as `safeErrorCode`, `safeErrorCategory`, `status`, and concrete safe summaries. It MUST NOT copy raw `safeError.message`, tool arguments, raw result fields, runtime correlation ids, or arbitrary failure metadata into user-visible payload fields.

#### Scenario: Command output is projected as bounded safe result

- **WHEN** a capability result contains command-style output fields such as `stdout`, `stderr`, and an exit code
- **THEN** stream projection MAY include a command-output `safeResult` with exit status and bounded stdout/stderr previews
- **AND** stream projection MAY include `safeSummary` and safe detail `text`/`content` derived from that allowlisted output
- **AND** the projection MUST NOT include the original command or invocation arguments
- **AND** when safe stderr is shaped as `CODE: message`, user-visible details SHOULD present the error code separately from the safe error information
- **AND** single-line safe error information SHOULD render inline with localized label punctuation, while multi-line error information MAY render as a labeled block
- **AND** policy-blocked command results SHOULD use a blocked command summary/status instead of presenting the result as ordinary command completion

#### Scenario: File read, write, and list results are projected as bounded safe results

- **WHEN** a capability result contains allowlisted file read, file write, or file list fields
- **THEN** stream projection MAY include a typed `safeResult` containing bounded content preview, selected read range, continuation position, filenames, operation, safe display path, truncation state, or count as appropriate
- **AND** file read, write, and list results SHOULD expose safe display paths so users can understand which workspace file was accessed
- **AND** safe display paths MUST NOT be host absolute paths, workspace root paths, temporary paths, or raw `file_path` fields
- **AND** unknown result fields MUST NOT be copied into `safeResult`
- **AND** frontend file read details SHOULD explain the selected line range and any omitted continuation in user-facing language, without requiring the user to understand `offset`, `limit`, or `nextOffset` field names

#### Scenario: Skill content is not exposed as result detail

- **WHEN** a Skill capability result contains loaded Skill content
- **THEN** stream projection MAY include the Skill name and loaded status in `safeResult`
- **AND** the Skill content body MUST NOT be copied into user-visible `safeResult`, `safeSummary`, `text`, or `content`

#### Scenario: Unknown result shape remains safely non-specific

- **WHEN** a capability result does not match an allowlisted safe projection shape
- **THEN** stream projection MUST NOT copy raw result fields into `safeResult`, `safeSummary`, `text`, or `content`
- **AND** the frontend MUST render a non-specific result-returned summary without exposing raw payload content

#### Scenario: Historical capability-result messages are sanitized before display

- **WHEN** the frontend reconstructs a history-loaded `CAPABILITY_RESULT_DELTA` from a stored conversation `CAPABILITY_RESULT` message
- **THEN** the reconstructed payload MUST NOT copy the stored raw message content into user-visible `text` or `content`
- **AND** allowlisted historical `safeResult` or `safeSummary` fields MAY still drive the same execution-detail rendering path as live stream envelopes
- **AND** a historical `safeSummary` fallback MUST NOT make raw stored capability payload content expandable or visible

#### Scenario: Failed capability completion carries safe failure facts

- **WHEN** Web channel projects a `CAPABILITY_COMPLETED` event for a failed capability invocation
- **THEN** the stream envelope payload MUST preserve safe failure code, safe failure category, and invocation status when present
- **AND** the frontend SHOULD render the corresponding tool row with a user-readable failure summary and keep code/category/status in second-level details
- **AND** degradation notices MAY remain visible as secondary system notices, but they MUST NOT be the only user-readable explanation of the failed tool
- **AND** raw safe error messages, raw result payload fields, tool arguments, and runtime correlation ids MUST NOT be exposed

#### Scenario: Historical failed capability results remain user-readable

- **WHEN** the frontend renders a history-loaded `CAPABILITY_RESULT_DELTA` with safe error code or category fields
- **THEN** the tool summary SHOULD use the mapped user-readable failure reason instead of a generic technical failure label
- **AND** second-level details MAY include the safe error code, safe category, and invocation status
- **AND** raw result payload fields, raw safe error messages, tool arguments, and runtime correlation ids MUST NOT be exposed

#### Scenario: History replay keeps full-process affordance for timeline-backed process events

- **WHEN** the frontend receives history-loaded process envelopes that carry real timeline event references
- **THEN** the execution details summary and full-process timeline affordance SHOULD use the same rendering rules as live process events
- **AND** conversation-history capability-result messages without timeline event references MUST NOT be treated as a complete process timeline by themselves

#### Scenario: Failed terminal history keeps only real partial answer content

- **WHEN** the frontend reconstructs answer content from history-loaded terminal events
- **THEN** a `REQUEST_FAILED` terminal event MAY be used as partial answer fallback only when its content is not a safe failure placeholder
- **AND** safe failure placeholders such as `Request failed`, `Request failed: ...`, or `Request failed safely: CODE` MUST NOT be rendered as assistant answer content
- **AND** failed-turn notices SHOULD distinguish turns with restored partial answer content from turns with no answer content

#### Scenario: Execution details expand and collapse without visual overlap

- **WHEN** the frontend expands or collapses the execution details panel while streamed content is present
- **THEN** the panel SHOULD transition using measured height and opacity instead of switching abruptly
- **AND** panel content MUST remain clipped during the transition so execution details cannot visually overlap the answer body below it
- **AND** the spacing between the execution-details summary row and the expanded details panel MUST be 12px

### Requirement: Frontend local view state MUST remain visually and navigationally stable

The frontend MUST apply the same themed scrollbar treatment to the chat viewport and the sidebar session-list viewport. In dark themes, reserved scrollbar gutter and track areas MUST use the themed page background and MUST NOT fall back to a light browser-default track.

The sidebar session-list expanded/collapsed state MUST be stored as a sessionStorage-backed local UI preference. When the preference is restored as expanded after refresh in the same browser tab, session-list refresh entry points MUST keep the expanded history data window rather than collapsing to the recent-session page size. This includes mount-time refreshes and later request-control or stream recovery refreshes that reload session history without explicit pagination.

Normal-mode Composer drafts MUST remain isolated by route while the browser tab is alive: each session MUST have its own draft and the pre-session root route MUST have a separate draft. Switching routes MUST save the departing normal draft and restore the target route draft without exposing the departing text as the target route draft before hydration completes. Unavailable browser-session storage MUST NOT prevent editing during the current page lifetime. A successful normal submit MUST clear the submitted route draft, while a failed normal submit MUST preserve it. Edit-mode replacement text and active pending-input responses MUST NOT overwrite a normal route draft. Entry-path-specific edit restoration, including consumption of the exact `/edit` command, remains owned by `request-edit-resubmit` and is not redefined by this requirement.

#### Scenario: Sidebar session list uses the same themed scrollbar as chat

- **WHEN** the sidebar session list is expanded and scrollable
- **THEN** its scrollbar thumb, track, gutter, and dark-mode color-scheme SHOULD match the main chat viewport scrollbar treatment
- **AND** the styling MUST NOT introduce horizontal content shift in either viewport when scrolling becomes available or unavailable

#### Scenario: Restored expanded session list requests the expanded page size

- **GIVEN** the user previously expanded the sidebar session list
- **WHEN** the frontend loads again
- **THEN** the sidebar MUST restore the expanded state from sessionStorage
- **AND** mount-time session-list refresh requests MUST use the expanded history page size
- **AND** later non-pagination session-list refreshes MUST preserve the current expanded history data window
- **AND** collapse MUST update the stored preference so the next refresh returns to the recent-session page size

#### Scenario: Composer draft is restored for the selected session

- **GIVEN** the user typed an unsent normal-mode draft in session A
- **WHEN** the user switches to session B and then returns to session A in the same browser tab
- **THEN** the Composer MUST restore session A's unsent draft
- **AND** session B's draft MUST remain isolated from session A's draft
- **AND** switching from session A to session B MUST NOT publish session A's currently visible input as session B's normal draft before session B is hydrated
- **AND** successfully submitted drafts MUST be cleared for that session
- **AND** edit-mode text and pending-input response text MUST NOT be stored as the normal session draft

#### Scenario: Pre-session root draft remains separate

- **GIVEN** the user typed an unsent normal-mode draft on the pre-session root route
- **WHEN** the user enters a session route and later returns to the root route in the same browser tab
- **THEN** the frontend MUST restore the pre-session draft
- **AND** MUST NOT expose it as that session's normal draft

#### Scenario: Storage failure does not block current-page editing

- **GIVEN** browser-session storage is unavailable
- **WHEN** the user edits the normal Composer
- **THEN** the Composer MUST remain usable for the current page lifetime

#### Scenario: Failed normal submit preserves its draft

- **GIVEN** a route has a non-blank normal Composer draft
- **WHEN** normal submission fails before acceptance
- **THEN** the frontend MUST preserve that route's draft for correction or retry

### Requirement: Attachment Accepted Stream Event Visibility

TS Web channel SHALL project `ATTACHMENT_ACCEPTED` as a stream-visible `StreamEnvelope` when an attachment passes trusted validation and is accepted into the request scope. The envelope payload SHALL expose only safe fields: `attachmentId`, `status`, `mediaType`, and optional `safeSummary`. The envelope MUST NOT expose attachment content, local file path, credential, or raw validation detail. Frontend consuming this event SHALL render an attachment-accepted indication bound to the `attachmentId` that owns the attachment, and MUST NOT render attachment body content from this event.

#### Scenario: Accepted attachment produces stream-visible envelope
- **WHEN** runtime accepts an attachment into the request scope after trusted validation
- **THEN** Web channel MUST project an `ATTACHMENT_ACCEPTED` `StreamEnvelope` with `attachmentId`, `status`, and `mediaType`
- **AND** the envelope MUST NOT contain attachment content, file path, or credential
- **AND** frontend MUST render an accepted-state indication bound to the owning `attachmentId`

#### Scenario: Accepted attachment event does not leak sensitive content
- **WHEN** the accepted attachment carries content bytes or local path metadata
- **THEN** the projected `ATTACHMENT_ACCEPTED` envelope MUST omit content bytes and local path
- **AND** only `attachmentId`, `status`, `mediaType`, and optional `safeSummary` MAY appear in the payload

#### Scenario: Historical conversation does not reconstruct attachment accepted event
- **WHEN** a frontend opens a historical conversation without an active run
- **THEN** the frontend MUST NOT reconstruct `ATTACHMENT_ACCEPTED` from visible `SessionMessage` records
- **AND** historical attachment status SHALL rely only on persisted attachment metadata in the owning USER message, not on stream replay

### Requirement: Attachment Rejected Stream Event Visibility

TS Web channel SHALL project `ATTACHMENT_REJECTED` as a stream-visible `StreamEnvelope` when an attachment fails trusted validation, security policy, or capacity limit. The envelope payload SHALL expose only safe fields: `attachmentId`, `status`, `mediaType`, optional `reasonCode`, and optional `safeSummary`. The envelope MUST NOT expose the rejected content, raw validation error, local path, or policy internals. Frontend consuming this event SHALL render a rejection indication bound to the `attachmentId` with a user-readable reason derived only from `reasonCode` and `safeSummary`.

#### Scenario: Rejected attachment produces stream-visible envelope with safe reason
- **WHEN** runtime rejects an attachment due to validation, security policy, or capacity limit
- **THEN** Web channel MUST project an `ATTACHMENT_REJECTED` `StreamEnvelope` with `attachmentId`, `status`, and `mediaType`
- **AND** the envelope MAY include `reasonCode` and `safeSummary` when a safe reason exists
- **AND** the envelope MUST NOT contain rejected content, raw validation error, local path, or policy internals

#### Scenario: Frontend renders rejection with safe reason only
- **WHEN** frontend receives an `ATTACHMENT_REJECTED` envelope
- **THEN** frontend MUST render a rejection indication bound to the owning `attachmentId`
- **AND** the user-visible reason MUST be derived only from `reasonCode` and `safeSummary`
- **AND** frontend MUST NOT display raw validation error text or policy internals

#### Scenario: Historical conversation does not reconstruct attachment rejected event
- **WHEN** a frontend opens a historical conversation without an active run
- **THEN** the frontend MUST NOT reconstruct `ATTACHMENT_REJECTED` from visible `SessionMessage` records
- **AND** historical rejection status SHALL rely only on persisted attachment metadata, not on stream replay

### Requirement: Context Compacted Stream Event Visibility

TS Web channel SHALL project `CONTEXT_COMPACTED` as a stream-visible `StreamEnvelope` when the context engine completes a compaction (micro-compact or summary compression) that changes the active context version during a run. The envelope payload SHALL expose only safe fields: `contextVersion`, optional `summaryMessageId`, optional `safeSummary`, and optional `tokenEstimate`. The envelope MUST NOT expose compacted prompt content, model output, raw message bodies, or internal context-engine state. Frontend consuming this event SHALL render a compaction notice that communicates context was compacted, and MUST NOT render compacted content.

#### Scenario: Compaction produces stream-visible envelope
- **WHEN** the context engine completes a compaction that changes the active context version during a run
- **THEN** Web channel MUST project a `CONTEXT_COMPACTED` `StreamEnvelope` with `contextVersion`
- **AND** the envelope MAY include `summaryMessageId`, `safeSummary`, or `tokenEstimate`
- **AND** the envelope MUST NOT contain compacted prompt content, model output, raw message bodies, or internal context-engine state

#### Scenario: Frontend renders compaction notice without content
- **WHEN** frontend receives a `CONTEXT_COMPACTED` envelope
- **THEN** frontend MUST render a compaction notice communicating that context was compacted
- **AND** frontend MUST NOT render compacted content or internal context-engine state
- **AND** the notice MAY reference `contextVersion` or `safeSummary` for user orientation

#### Scenario: Historical conversation reconstructs compaction notice from persisted record
- **WHEN** a frontend opens a historical conversation
- **THEN** the frontend SHALL reconstruct `CONTEXT_COMPACTED` from persisted compaction notice records so that the compaction notice is visible in history
- **AND** the `SUMMARY` message produced by compaction SHALL be filtered out of historical conversation envelopes
- **AND** historical browsing SHALL display a compaction notice with the same content as seen in live mode after completion

### Requirement: Capability Path Rejected Failure Visibility

TS Web channel SHALL 在 Capability invocation 确因路径访问策略而被阻止时，把 `safeErrorCode=CAPABILITY_PATH_REJECTED`、`safeErrorCategory=AUTHORIZATION` 或 `POLICY_DENIED`，以及不含被拒绝路径、文件系统细节或策略内部信息的安全失败事实投影到 `CAPABILITY_RESULT_DELTA` 或 `CAPABILITY_COMPLETED` envelope。可信后端共享 projector MUST 在该 code 与上述任一 category 组合时产生路径访问被策略阻止的语言中立失败摘要语义。`CAPABILITY_PATH_REJECTED` 携带其他受支持 category 时，共享 projector MUST 使用当前 category 的事实性失败语义。该 code 的 category 缺失时，共享 projector MUST 使用通用事实性失败语义。共享 projector MUST NOT 仅凭该 code 声称路径被策略阻止。前端 SHALL 只根据后端闭合失败摘要语义渲染本地化失败文案。所有组合均 MUST NOT 暴露被拒绝路径、文件系统细节或策略内部信息，也 MUST NOT 暗示 Capability 执行成功。

#### Scenario: 路径策略阻止产生安全错误事实

- **WHEN** 一个 Capability invocation 确因路径访问策略而被阻止
- **THEN** Web channel MUST 投影 `safeErrorCode=CAPABILITY_PATH_REJECTED`
- **AND** Web channel MUST 投影 `safeErrorCategory=AUTHORIZATION` 或 `POLICY_DENIED`
- **AND** 投影 MUST 使用路径访问被策略阻止的语言中立安全摘要语义
- **AND** envelope MUST NOT 暴露被拒绝路径、文件系统细节或策略内部信息

#### Scenario: 路径拒绝的相容组合产生策略语义

- **GIVEN** 一个安全失败事实携带 `safeErrorCode=CAPABILITY_PATH_REJECTED`
- **AND** `safeErrorCategory` 为 `AUTHORIZATION` 或 `POLICY_DENIED`
- **WHEN** 可信后端共享 projector 生成 Web 投影
- **THEN** 投影 MUST 携带路径访问被策略阻止的语言中立失败摘要语义
- **AND** 前端 MUST 依据该闭合语义显示本地化失败文案
- **AND** Web 投影和前端 MUST NOT 显示被拒绝路径、策略内部信息或成功状态

#### Scenario: 路径错误码与冲突类别服从类别语义

- **GIVEN** 一个 Capability 安全失败事实携带 `safeErrorCode=CAPABILITY_PATH_REJECTED`
- **AND** `safeErrorCategory=CONFLICT`
- **WHEN** 可信后端共享 projector 生成 Web 投影
- **THEN** 投影 MUST 携带状态冲突的语言中立失败摘要语义
- **AND** 前端 MUST 显示对应的本地化失败文案
- **AND** Web 投影和前端 MUST NOT 声称路径访问被策略阻止

#### Scenario: 路径错误码缺少类别时安全降级

- **GIVEN** 一个 Capability 安全失败事实携带 `safeErrorCode=CAPABILITY_PATH_REJECTED`
- **AND** 该事实没有 `safeErrorCategory`
- **WHEN** 可信后端共享 projector 生成 Web 投影
- **THEN** 投影 MUST 携带通用事实性失败摘要语义
- **AND** 前端 MUST 显示对应的本地化失败文案
- **AND** Web 投影和前端 MUST NOT 声称路径访问被策略阻止

#### Scenario: 路径拒绝步骤不单独提升为请求失败

- **WHEN** 一个 Capability 因路径策略被阻止但当前 request 仍可继续
- **THEN** `RunStatus` MUST NOT 仅因 `CAPABILITY_PATH_REJECTED` 转换为 `FAILED`
- **AND** 该失败 MUST 通过 Capability 失败投影和既有 `DEGRADATION_NOTICE` 规则保持可见
- **AND** 后续 Capability 或模型轮次 MAY 按既有 routing policy 继续

### Requirement: AskUserQuestion answer result exposes only a bounded safe projection

当 Web channel 把 canonical `AskUserQuestion` 的已接受 `QUESTION` answer result 投影到 session stream 或 conversation capability-result item 时，两条路径 MUST 复用同一个 AskUserQuestion answer projector，并输出相同的有界安全投影。stream `CAPABILITY_RESULT_DELTA` payload MUST 合并该投影；conversation capability-result item MUST 通过可选 `pendingInputAnswer` 字段携带同一投影。投影 MUST 携带同一原始 tool call 的 `capabilityId`、`toolCallId`、`pendingInputId`、`kind="QUESTION"` 和 `status="RECEIVED"`。其中 `safeResult` MUST 使用 `kind="pendingInputAnswer"`，并只包含有序 `answers` 与 `truncated`。`answers` 的可信来源 MUST 是 durable `CAPABILITY_RESULT` 所代表的 runtime-accepted answer，不得是 Web answer request body 或 frontend local state。

安全投影 MUST 按 group、group 内 item 和字符串中的 Unicode code point 顺序遍历，接受至多 20 个 answer group、每组至多 9 个字符串、每个字符串至多 4096 个 Unicode code point，并把全部 projected answer string 的总长度限制为 24576 个 Unicode code point。任一 group、item、字符串或总长度被裁剪时，`truncated` MUST 为 `true`；没有裁剪时 MUST 为 `false`。总长度预算耗尽后，channel MUST 省略后续 item 和 group，不得生成空 answer string。除上述字段外，projector MUST NOT 把 stored result 或 runtime event 中的其他字段复制到 `safeResult`、`text`、`safeSummary` 或 `metadata`。conversation message 的既有 canonical `content` 保持兼容，但 frontend MUST NOT 从该字段推导回答展示。

只有 `capabilityId="AskUserQuestion"`、pending kind 为 `QUESTION`、状态为 `RECEIVED`、`toolCallId` 与 `pendingInputId` 均为非空字符串且 `answers` 为有序非空字符串数组时，channel 才能输出该 safe result。任一条件不成立时，channel MUST 省略 `safeResult` 并使用不包含回答正文的安全摘要；MUST NOT 猜测或修复关联坐标。

#### Scenario: Valid accepted answers keep order in the safe result

- **WHEN** Web channel 从 live event 或 durable capability-result message 收到 canonical `AskUserQuestion` 的有效已接受 answer result
- **THEN** projected `safeResult.kind` MUST 为 `pendingInputAnswer`
- **AND** answer group、group 内 answer 和字符串内容 MUST 保持 runtime-accepted order
- **AND** `pendingInputId` MUST 只作为 envelope payload 的受控关联字段，不得复制进 `safeResult`
- **AND** safe projector 输出中的 `text`、`content`、`safeSummary` 和 `metadata` MUST NOT 复制回答正文
- **AND** 该限制 MUST NOT 改变 conversation message 既有 canonical `content`

#### Scenario: Stream and conversation use the same safe projection

- **WHEN** 同一 runtime-accepted AskUserQuestion answer fact 同时通过 session stream 和 conversation API 投影
- **THEN** stream payload 与 conversation item `pendingInputAnswer` 中的 capability identity、pending input correlation、status、`safeResult`、safe summary 和 truncation state MUST 相同
- **AND** frontend MUST NOT 从 conversation message canonical `content` 再次解析或裁剪回答

#### Scenario: Over-budget accepted answer is deterministically truncated

- **WHEN** 可投影 answer result 的 group 数、任一 group 的 item 数、任一字符串长度或全部 answer string 总长度超过安全投影边界
- **THEN** Web channel MUST 按有序遍历保留至多前 20 个 group、每组前 9 个 item、每个 item 的前 4096 个 Unicode code point 和总计前 24576 个 Unicode code point
- **AND** projected `safeResult.truncated` MUST 为 `true`
- **AND** safe projector MUST NOT 把被裁剪内容复制到 projector 输出的其他字段

#### Scenario: Malformed or non-question result fails closed

- **WHEN** capability id、pending kind、status、tool call id、pending input id 或 answers shape 不满足该 safe projection 的全部前置条件
- **THEN** stream projection MUST 省略 answer `safeResult`，conversation projection MUST 省略 item 的 `pendingInputAnswer` 字段
- **AND** safe projector 输出 MUST NOT 包含任一 answer value
- **AND** frontend MUST 仍能显示不包含回答正文的安全 result summary

#### Scenario: USER_INPUT_RECEIVED remains answer-free

- **WHEN** Web channel 投影同一 pending input 的 `USER_INPUT_RECEIVED`
- **THEN** 该 event MUST NOT 携带 `answers`、`safeResult` 或任一回答正文
- **AND** answer 正文 MUST 仅通过对应 `CAPABILITY_RESULT_DELTA` 的 allowlisted safe result 或 durable history result 可见

### Requirement: In-progress and completed thinking reuse the existing public envelope

Shared channel projector SHALL把调用中和completed两种canonical `LLM_THINKING_DELTA`都投影为既有public event type。两者必须使用相同reasoning/content/text/contentType、stepId、requestId和runId规则；调用中delta的metadata必须恰为`{ accumulated:true }`，completed delta的metadata必须包含`{ accumulated:true, completed:true }`。

Projector MUST NOT把thinking投影成assistant final answer、message role或新public event type。

#### Scenario: Live in-progress delta omits completion state
- **WHEN**projector处理省略completed的LIVE_ONLY thinking event
- **THEN**envelope metadata MUST包含accumulated=true
- **AND**MUST省略completed

#### Scenario: Completed projection marks completion
- **WHEN**projector处理completed=true的PERSISTED thinking event
- **THEN**envelope MUST保持完整reasoning和stepId
- **AND**metadata.completed MUST为true

#### Scenario: Invalid completed payload fails closed
- **WHEN**thinking event包含completed=false、空reasoning或非法stepId
- **THEN**projector MUST返回projection failure
- **AND**MUST不降级成generic text或assistant answer

### Requirement: Live transports and REST history share one projector

SSE、WebSocket、timeline resume和REST event history SHALL调用同一个`projectTimelineEventToStreamEnvelope`。REST route不得手工复制字段、修改payload或建立第二套allowlist。

#### Scenario: REST history matches completed live state
- **WHEN**同一completed persisted event先在live publication出现、随后由REST history读取
- **THEN**两次envelope的event type、payload、run/request correlation和canonical time MUST等价

#### Scenario: Resume includes completed but not in-progress deltas
- **WHEN**client从durable sequence恢复已结束run
- **THEN**resume MUST返回persisted final thinking
- **AND**MUST不生成先前live-only调用中delta frames

#### Scenario: Resume includes completed but not in-progress deltas
- **WHEN**client从durable sequence恢复已结束run
- **THEN**resume MUST返回persisted final thinking
- **AND**MUST不生成先前live-only调用中delta frames

#### Scenario: Timeline-only events are filtered consistently
- **WHEN**persisted page包含shared projector判定为timeline-only的event
- **THEN**所有transport MUST使用相同过滤结果
- **AND**不得因REST查询而扩大public payload surface

### Requirement: Run event-history Web API is scoped and schema validated

Web SHALL暴露`GET /api/v1/sessions/:sessionId/runs/:runId/events`。Query `afterSequence`缺省0且必须为non-negative safe integer；`limit`缺省100且必须在1..1000。Route只调用`RuntimeSessionPort.listEvents`。

AVAILABLE response包含projected StreamEnvelope items和optional nextAfterSequence；LEGACY unavailable response只能包含availability、空items且无cursor。任何runtime或projection failure MUST返回safe error，不得返回partial page或raw payload。

#### Scenario: Route delegates by session and run
- **WHEN**authorized client使用合法params/query读取events
- **THEN**route MUST把trusted identity、sessionId、runId和pagination传给runtime facade
- **AND**MUST不调用session或timeline gateway

#### Scenario: Invalid query is rejected before runtime
- **WHEN**afterSequence或limit非法
- **THEN**Web schema MUST返回validation failure
- **AND**runtime facade MUST不被调用

#### Scenario: Empty projected page preserves canonical cursor
- **WHEN**canonical page只包含timeline-only events且仍有下一页
- **THEN**public items MAY为空
- **AND**response MUST保留runtime提供的nextAfterSequence

### Requirement: Capability 结果呈现策略受平台安全上限约束

系统 MUST 在用户查看 Capability 执行结果时先确定平台安全上限，再把启动期冻结的集成呈现级别收窄到该上限；任何集成配置 MUST NOT 提高平台安全上限、改变 canonical Capability Result Message、改变模型上下文或把未列入安全投影白名单的字段发送给浏览器。

**需求类别**：功能性需求

呈现级别从低到高依次为 `STATUS_ONLY`、`SUMMARY`、`DETAIL`。`STATUS_ONLY` 只携带公开身份、关联标识、有效级别和状态；`SUMMARY` 只增加非空、非通用且通过既有白名单与容量校验的安全摘要；`DETAIL` 才允许增加既有 projector 已批准的 `safeResult` 和详情文本。AskUserQuestion accepted answer 继续作为公开对话事实独立保留。安全失败继续按安全失败契约呈现，三种成功结果级别 MUST NOT 改变失败字段集合。

平台安全上限 MUST 继续按已识别 Capability 身份、结果 schema 和可信来源确定。未知身份、未知 shape、schema 失败、内部 Skill 正文或无法证明安全来源的结果最高为 `STATUS_ONLY`。配置级别只允许 `STATUS_ONLY`、`SUMMARY`、`DETAIL`；`default-level` 缺失时仍为 `SUMMARY`；exact `capability-id` 规则、256 项上限、标识长度、重复项、未知字段和 ready gate 规则保持不变。

内置策略基线 MUST 把 `Skill`、`Agent`、`ApiCall`、`search_memory`、`get_memory_detail`、`add_memory`、`acquire_skill` 设为 `STATUS_ONLY`；把 `AskUserQuestion`、`TodoWrite`、`Cron`、`Rag`、`Bash`、`Python` 设为 `DETAIL`；把 `Read`、`Write`、`Edit`、`Glob`、`Grep`、`ToolSearch`、`Workflow` 设为 `SUMMARY`。已识别 CLIP 和其他没有精确规则的扩展 Tool 继续使用有效 `default-level`，但没有平台管理 projector 时最高为 `STATUS_ONLY`。`ApiCall` 的规范路径和防御性 `STATUS_ONLY` 上限保持不变。

#### Scenario: 默认命令和程序结果使用既有安全详情

- **GIVEN** 集成方没有配置 Capability 结果呈现精确规则
- **AND** `Bash` 或 `Python` 成功结果通过既有命令输出安全 schema
- **WHEN** 用户查看该步骤
- **THEN** 有效呈现级别 MUST 为 `DETAIL`
- **AND** 用户主动展开时 MUST 只看到既有 exit code、stdout/stderr preview、timeout 和截断事实
- **AND** 浏览器 MUST NOT 收到原始命令、Python 代码、脚本名、调用参数或超出既有边界的输出

#### Scenario: 集成规则仍可收窄命令结果

- **GIVEN** 集成规则把 `Bash` 或 `Python` 精确配置为 `STATUS_ONLY` 或 `SUMMARY`
- **WHEN** 用户查看该步骤
- **THEN** 有效级别 MUST 使用该更低级别
- **AND** 被该级别排除的 `safeResult` 和详情 MUST NOT 进入浏览器

#### Scenario: 默认 RAG 结果使用既有详情

- **GIVEN** 集成方没有配置 Capability 结果呈现精确规则
- **AND** `Rag` 成功结果通过既有安全 schema
- **WHEN** 用户查看该步骤
- **THEN** 有效级别 MUST 为 `DETAIL`
- **AND** 投影 MUST 继续使用既有来源、预览和截断边界

#### Scenario: 未知与无 projector 结果继续安全降级

- **GIVEN** 配置请求 `DETAIL`
- **AND** 结果属于未知扩展 Tool，或属于仍无成功 projector 的 `Agent`、Memory Tool 或 `acquire_skill`
- **WHEN** 系统生成用户可见投影
- **THEN** 有效级别 MUST 为 `STATUS_ONLY`
- **AND** 系统 MUST NOT 透传任意 JSON、原始结果或产品自报安全字段

#### Scenario: 非法配置继续阻止应用 ready

- **GIVEN** 启动配置包含重复 `capability-id`、`HIDDEN`、未知级别、未知字段或超出既有数量和长度边界的规则
- **WHEN** 系统校验并冻结配置
- **THEN** 校验 MUST 失败
- **AND** 应用 MUST NOT 进入 ready 状态

### Requirement: 请求终态失败只在有可靠行动依据时提供指导

Web chat workspace MUST 使用可信 request terminal event 以及既有 safe code、category 和 retryable 确定请求终态失败呈现。失败阶段只允许为 `MODEL_INVOCATION`、`CAPABILITY_INPUT`、`CAPABILITY_EXECUTION`、`CAPABILITY_OUTPUT`、`REQUEST_RUNTIME` 或 `UNKNOWN`。系统 MUST 由 terminal event 与稳定 code 确定阶段。系统 MUST NOT 从错误 message、raw exception、prompt、模型输出或 Capability payload 推断阶段。local、immersive、collaborative 三种宿主 MUST 复用同一终态失败解释逻辑。

请求终态失败 MUST 显示本地化事实原因。失败阶段 MUST 显示在请求终态失败卡片中。稳定错误码、错误类别和本地化调用状态标签 MUST 默认收起为技术详情。当稳定 code 对应已定义行动且当前 surface 提供该行动或明确指导目标时，系统 MUST 显示固定本地化指导。前述条件任一不成立时，系统 MUST NOT 生成行动指导。模型认证失败的指导 MUST 指向检查模型凭据与配置或联系有权限的管理员。模型不存在的指导 MUST 指向检查模型配置或联系有权限的管理员。限流或网络失败只有在 `retryable=true` 且当前 surface 提供 request retry control 时，才 MUST 提示重试。内部错误或未知 code MUST 只显示事实原因和技术详情。内部错误或未知 code MUST NOT 生成通用修复建议。

非终态 Capability 步骤失败 MUST NOT 由本 Requirement 推断 request terminal、整轮重试或用户行动；其呈现由 `Capability 安全失败投影必须只陈述已确认事实` 约束。

**需求类别**：功能性需求

#### Scenario: 模型认证终态失败给出可执行的管理指引

- **GIVEN** 一个 turn 以 `MODEL_AUTHENTICATION_FAILED` 终态失败
- **WHEN** 用户查看请求失败信息
- **THEN** 三种宿主 MUST 显示阶段 `MODEL_INVOCATION`
- **AND** 界面 MUST 显示不可直接重试
- **AND** 界面 MUST 指向检查模型凭据与配置或联系有权限的管理员
- **AND** 界面 MUST NOT 显示 credential、provider body、stack 或 endpoint

#### Scenario: 可重试错误没有请求级重试入口时不建议重试

- **GIVEN** 一个请求因模型限流终态失败且 `retryable=true`
- **AND** 当前 surface 没有可用的 request retry control
- **WHEN** 用户查看该失败
- **THEN** 界面 MUST 显示模型调用失败的事实原因
- **AND** 界面 MUST NOT 显示无法执行的重试行动入口或承诺自动重试

#### Scenario: 未识别终态错误使用事实性通用降级

- **GIVEN** 一个请求以未识别的稳定错误码终态失败
- **WHEN** 用户查看该失败
- **THEN** 失败阶段 MUST 为 `UNKNOWN`
- **AND** 界面 MUST 显示当前语言的通用事实性原因
- **AND** 稳定错误码 MUST 只在用户主动展开的技术详情中显示
- **AND** 界面 MUST NOT 因映射缺失而隐藏 process panel、抛出渲染异常或生成通用修复建议

#### Scenario: Capability 步骤失败不被当作请求终态

- **GIVEN** 一个 Capability 步骤失败但当前 request 尚未产生 terminal event
- **WHEN** 用户查看该步骤
- **THEN** 界面 MUST NOT 显示 request terminal 阶段、整轮重试建议或请求失败结论
- **AND** 后续模型或 Capability 事实 MUST 继续按实际时序呈现

### Requirement: Capability 安全失败投影必须只陈述已确认事实

系统 MUST 把已经产生安全失败事实的 Capability 步骤呈现为失败状态。系统 MUST 提供由可信后端生成、可按当前界面语言解释的事实性失败原因。系统 MUST 按已审计且与 category 一致的具体 `safeErrorCode`、九类 `safeErrorCategory`、通用失败的优先顺序选择唯一语言中立失败 `safeSummaryCode`。具体 code 与当前 category 冲突时，系统 MUST 使用 category。category 缺失时，系统 MUST 只对无歧义且已审计的 code 使用专属语义。code 和 category 都缺失或不受支持时，系统 MUST 使用通用失败。失败 `safeSummaryArgs` MUST 为空对象。

Capability 失败卡片 MUST 以该步骤的 `CAPABILITY_RESULT_DELTA` 或 `CAPABILITY_COMPLETED` 安全失败事实为权威输入。仅携带 code 的 `DEGRADATION_NOTICE` 或 request terminal fact MUST NOT 覆盖、降级或改写同一步骤中已经存在的 code/category 联合语义。独立 code-only `DEGRADATION_NOTICE` 需要用户可见且其 code 不属于无歧义的已审计映射时，系统 MUST 使用通用事实性语义。系统 MUST NOT 把该 notice 合并为某个 Capability 的专属失败原因。request terminal fact 的独立呈现 MUST 继续遵守 `请求终态失败只在有可靠行动依据时提供指导`。

具体 code 规则 MUST 区分命令被拒绝、输入无效、路径被拒绝、结果过大、文件修改前未完整读取、目标已变化、平台不支持和执行依赖不可用。category 规则 MUST 穷尽 `AUTHORIZATION`、`POLICY_DENIED`、`VALIDATION`、`NOT_FOUND`、`CONFLICT`、`UNAVAILABLE`、`TIMEOUT`、`CANCELED`、`INTERNAL`。被多个 category 复用的 code MUST NOT 覆盖当前 category。同一用户语义的多个底层错误 MUST 复用同一个失败摘要语义。同一失败事实 MUST 只产生一个失败摘要语义。

失败卡片默认 MUST 只显示 Capability 公开身份、失败状态标签和一条事实性原因。失败卡片 MUST NOT 再以“执行结果”或其他字段重复同一原因。用户主动展开技术详情时，系统 MUST 显示当前失败事实中已经存在的 `safeErrorCode`、`safeErrorCategory` 和本地化调用状态标签。前述安全技术字段缺失时，系统 MUST 省略对应字段。技术详情未展开时，这些字段 MUST 保持不可见。原始内部状态枚举 MUST NOT 作为正文或技术详情值显示。技术详情 MUST NOT 包含 raw exception message、stack、文件或资源路径、工具参数、结果正文、provider error、credential、token 或 runtime correlation id。

`STATUS_ONLY`、`SUMMARY`、`DETAIL` 只控制成功结果披露。三种配置 MUST 显示同一条失败状态和事实性原因。`DETAIL` MUST NOT 放宽失败技术详情的安全字段集合。

单个 Capability 的错误码、错误类别或 `SafeError.retryable` 只说明本次步骤事实。失败卡片 MUST NOT 仅根据这些字段生成自动恢复承诺、自动重试承诺、用户操作建议或 Capability 级 CTA。当系统另外存在契约可见的 AskUser 输入请求、显式上传要求、可重试 request terminal control 或已配置授权流程时，对应交互 owner MUST 呈现其用户行动入口。模型后续调用其他 Capability 或输出 Assistant Message 时，界面 MUST 按新产生的事实呈现。界面 MUST NOT 把旧失败步骤改写为已经恢复。

**需求类别**：功能性需求

#### Scenario: 写入前未完整读取只显示事实原因

- **GIVEN** `Write` 失败携带 `safeErrorCode=WRITE_REQUIRES_FULL_READ`
- **WHEN** 用户查看该步骤的默认失败卡片
- **THEN** 卡片 MUST 显示“未能完成”和“修改文件前需要先完整读取最新内容”的本地化语义
- **AND** 卡片 MUST NOT 显示“请先读取文件”“系统将重新读取”或“系统将继续处理”
- **AND** 卡片 MUST NOT 把该失败呈现为 request terminal failure

#### Scenario: 平台不支持不生成无法兑现的行动建议

- **GIVEN** Capability 失败携带 `safeErrorCode=PLATFORM_UNSUPPORTED`
- **AND** 当前请求没有授权、上传、用户输入或 request retry 交互事实
- **WHEN** 用户查看该失败
- **THEN** 卡片 MUST 显示“无法执行”和“当前运行环境不支持此能力”的本地化语义
- **AND** 卡片 MUST NOT 建议用户安装依赖、修改部署或稍后重试

#### Scenario: 未命中的错误码使用完整类别兜底

- **GIVEN** Capability 失败携带一个不在后端已审计具体 code/category 映射表中的 `safeErrorCode`
- **AND** `safeErrorCategory=CONFLICT`
- **WHEN** 可信后端生成失败投影
- **THEN** 投影 MUST 使用状态冲突语义而不是通用失败语义
- **AND** 浏览器 MUST NOT 显示未知 `safeErrorCode` 作为主文案

#### Scenario: 一码多类错误不得覆盖当前类别

- **GIVEN** 一个 Capability 失败携带 `safeErrorCode=EXECUTION_FAILED`
- **AND** `safeErrorCategory=CANCELED`
- **WHEN** 可信后端生成失败投影
- **THEN** 投影 MUST 使用已取消语义
- **AND** 投影 MUST NOT 因 code 名称显示通用执行失败或内部异常语义

#### Scenario: 路径错误码与冲突类别组合使用冲突语义

- **GIVEN** 一个 Capability 失败携带 `safeErrorCode=CAPABILITY_PATH_REJECTED`
- **AND** `safeErrorCategory=CONFLICT`
- **WHEN** 可信后端生成失败投影
- **THEN** 投影 MUST 使用状态冲突语义
- **AND** 投影 MUST NOT 声称该路径被安全策略阻止

#### Scenario: 缺失错误语义安全降级

- **GIVEN** Capability 失败没有受支持的精确 code 和 category
- **WHEN** 用户在中文或英文界面查看该失败
- **THEN** 界面 MUST 显示当前语言的通用失败状态和事实性原因
- **AND** 界面 MUST NOT 显示上游错误文本、未知 code 或 descriptor 名称作为原因

#### Scenario: 三种成功结果策略不隐藏失败原因

- **GIVEN** 同一 Capability 失败分别应用 `STATUS_ONLY`、`SUMMARY` 和 `DETAIL` 配置
- **WHEN** 用户查看三条失败卡片
- **THEN** 三条卡片 MUST 显示相同的失败状态和事实性原因
- **AND** 用户主动展开时 MUST 显示相同的安全技术详情
- **AND** `DETAIL` MUST NOT 返回失败原始结果或额外诊断正文

#### Scenario: 技术详情默认收起且不重复原因

- **GIVEN** 失败投影包含安全错误码、错误类别和调用状态
- **WHEN** 失败卡片首次显示
- **THEN** 卡片 MUST 只显示一次事实性失败原因
- **AND** 错误码、错误类别和本地化调用状态标签 MUST 默认收起
- **WHEN** 用户主动展开技术详情
- **THEN** 卡片 MUST 显示安全错误码、安全错误类别和本地化调用状态标签
- **AND** 卡片 MUST NOT 显示原始内部状态枚举
- **AND** 卡片 MUST NOT 再显示“执行结果：”加同一失败原因

#### Scenario: 模型后续动作作为新事实呈现

- **GIVEN** 一个 `Write` 步骤因未完整读取而失败
- **WHEN** 后续模型轮次实际产生一个 `Read` 调用并再次调用 `Write`
- **THEN** 界面 MUST 把 `Read` 和新的 `Write` 分别显示为后续过程步骤
- **AND** 原失败步骤 MUST 保持其原始失败状态
- **AND** 原失败卡片 MUST NOT 在后续动作发生前预告或承诺这些动作

#### Scenario: code-only 降级事实不覆盖完整 Capability 失败

- **GIVEN** 一个 `CAPABILITY_COMPLETED` 失败事实携带 `safeErrorCode=CAPABILITY_PATH_REJECTED` 和 `safeErrorCategory=CONFLICT`
- **AND** 同一 request 随后产生一个只携带 `code=CAPABILITY_PATH_REJECTED` 的 `DEGRADATION_NOTICE`
- **WHEN** 用户在 live 或 history 查看该 Capability 步骤
- **THEN** Capability 失败卡片 MUST 保持 code/category 联合确定的事实性原因
- **AND** code-only notice MUST NOT 覆盖、降级或改写该卡片
- **AND** code-only notice MUST NOT 作为该卡片的第二条失败原因呈现
- **AND** 该 notice 如果作为独立事实可见，MUST 因该 code 缺少可区分 category 而使用通用事实性语义

### Requirement: Capability 生命周期事件不得显示内部协议标识

普通 Agent Web MUST NOT 把 Event type、`safeSummaryCode`、内部状态枚举或其他协议标识显示为用户可读正文。`CAPABILITY_STARTED` 契约不定义受治理的安全业务说明字段，因此可信后端 MUST 省略其自由文本，Agent Web MUST 忽略任何不属于受治理字段的启动事件自由文本。模型在调用 Capability 前生成的公开执行说明 MUST 继续作为独立的过程 Message / `LLM_CONTENT_DELTA` 投影，不得伪装成生命周期正文。Agent Web MUST 使用结构化事件类型、Capability 公开身份和状态渲染本地化生命周期标签。本地化生命周期标签和本地化调用状态标签是界面语义，不是内部状态枚举的直接显示。Agent Web 无法安全解释其他生命周期附加说明时 MUST 省略该说明。

该约束 MUST 在 live、run-event history、SSE、WebSocket 以及 local、immersive、collaborative 三种宿主中保持一致。未知失败 `safeSummaryCode` MUST 使用通用本地化失败语义。未知失败 `safeSummaryCode` MUST NOT 显示 descriptor 本身。安全错误码和错误类别只受 `Capability 安全失败投影必须只陈述已确认事实` 定义的技术详情规则约束。

**需求类别**：系统质量属性

**质量属性**：安全、可靠性/恢复
**适用范围**：该 Function

#### Scenario: 活动步骤不显示 CAPABILITY_STARTED

- **GIVEN** `CAPABILITY_STARTED` 事件不具有受治理的安全业务说明字段
- **AND** 输入携带未被该契约定义的任意 `text`
- **WHEN** 用户在 live 执行过程中查看该活动步骤
- **THEN** 界面 MUST 使用当前语言显示 Capability 公开身份和执行中状态
- **AND** 界面 MUST NOT 显示字符串 `CAPABILITY_STARTED`
- **AND** 界面 MUST NOT 把该任意 `text` 当作业务说明显示

#### Scenario: 刷新后不恢复内部协议文本

- **GIVEN** 一个生命周期事件的 live 投影没有用户可读附加说明
- **WHEN** 用户刷新页面并从 run-event history 恢复该步骤
- **THEN** history MUST 保持与 live 相同的本地化身份和状态
- **AND** history MUST NOT 从 Event type、descriptor 或 canonical Message 补出内部协议文本

#### Scenario: 未知摘要 descriptor 不直接显示

- **GIVEN** 浏览器收到一个不属于当前闭合集合的 `safeSummaryCode`
- **WHEN** 前端渲染 Capability 步骤
- **THEN** 前端 MUST NOT 显示该 code 的原始字符串
- **AND** 失败步骤 MUST 使用通用本地化失败语义
- **AND** 非失败步骤 MUST 省略无法解释的摘要并保留结构化状态

### Requirement: Capability 结果的用户可见投影由可信后端统一产生

所有普通 Agent Web 用户可见的 Capability 结果 MUST 由可信后端依据同一份启动期策略快照产生；SSE、WebSocket、run-event history 以及 local、immersive、collaborative 三种宿主 MUST 对同一 canonical Capability 结果输出相同的有效呈现级别、`safeSummaryCode`、`safeSummaryArgs`、兼容 `safeSummary`、`safeResult`、截断状态和安全失败事实。普通 conversation history 请求 MUST NOT 把 Capability Result Message 作为过程详情来源；浏览器 MUST NOT 从 canonical Message 的原始或隐藏 `content`、工具参数、Capability payload 或 frontend local state 重新构造结果详情。前端 MUST 使用当前界面语言解释平台闭合集合内的摘要 code，界面语言切换只重新渲染既有投影，MUST NOT 重新请求或改写历史事实。

**需求类别**：系统质量属性

**质量属性**：安全、可靠性/恢复
**适用范围**：该 Function

Message 的 `visible` 字段只控制该 Message 是否作为普通会话消息返回，不直接决定对应过程投影是否可见。后端只有在关联的 canonical timeline fact、Capability 身份、tool call 坐标和 Message 内容均通过校验时，才能按呈现策略产生过程投影；关联缺失、坐标冲突、内容解析失败或策略不可用时 MUST 省略详情并降级为不高于 `STATUS_ONLY` 的安全结果，MUST NOT 回退为浏览器解析原始 Message。对于需要根据执行时可信 descriptor 区分 projector 的扩展 Tool，持久化 completion Event MAY 保存闭合集合内、版本化且不含正文的 `resultProjectionKind` 控制事实；该字段只能选择共享安全 projector，MUST NOT 作为 Web 内容返回，也 MUST NOT 携带摘要、详情或结果副本。conversation API 即使收到 `includeCapabilityResults=true`，也 MUST 将非 AskUserQuestion Capability Result item 的 `content` 投影为空字符串，并 MUST NOT 在其他字段复制原始结果 payload 或未白名单 metadata。只读 share 响应 MUST 排除普通 Capability Result Message，不能把 canonical 工具结果原文作为共享对话内容返回。既有 AskUserQuestion accepted-answer conversation compatibility 继续由其专用 bounded projector 约束，本 change MUST NOT 扩大该兼容字段或把它作为普通工具结果详情来源。

#### Scenario: live 与 history 使用同一安全投影

- **GIVEN** 一条已完成 Capability 结果在 live 阶段按有效级别 `SUMMARY` 可见
- **WHEN** 用户刷新页面并通过 run-event history 重新查看同一结果
- **THEN** history MUST 仍以 `SUMMARY` 呈现相同安全摘要
- **AND** live 与 history MUST 返回相同的 `safeSummaryCode` 和 `safeSummaryArgs`
- **AND** history MUST NOT 新增 `safeResult`、详情正文或原始 Message 内容

#### Scenario: 界面语言切换复用同一摘要语义

- **GIVEN** 同一 `Read` SUMMARY 投影包含平台生成的 `safeSummaryCode` 与有界 `safeSummaryArgs`
- **WHEN** 用户在中文和英文界面之间切换
- **THEN** 前端 MUST 使用现有 i18n 资源显示对应语言摘要
- **AND** Web payload、timeline 和 Message MUST 保持不变，浏览器 MUST NOT 为语言切换新增结果请求

#### Scenario: 可信 CLIP 分类恢复 live 与 history

- **GIVEN** 执行时可信 descriptor 被验证为受支持的 CLIP provider，completion Event 保存 `resultProjectionKind=CLIP_STREAM_V1`
- **WHEN** live result delta 与刷新后的 history 分别投影同一 canonical 结果
- **THEN** 两条路径 MUST 使用同一个共享 CLIP 安全 projector 并产生相同的摘要、详情和截断状态
- **AND** 没有该可信分类的自定义 Capability 即使伪造 CLIP 结果形状也 MUST 降级为 `STATUS_ONLY`
- **AND** 浏览器 MUST NOT 收到 `resultProjectionKind`

#### Scenario: 普通 Read 与内部资源读取被正确区分

- **GIVEN** 普通工作区 `Read` 和内部 Skill 资源加载分别产生包含文件路径与正文形状的结果
- **WHEN** 用户在 live 或 history 中查看两条过程记录
- **THEN** 普通工作区 `Read` MUST 按配置和文件读取安全上限显示允许的安全预览
- **AND** 内部 Skill 资源加载 MUST NOT 因字段形状相似而显示正文或源路径
- **AND** 两条结果在 SSE、WebSocket 和刷新后的 history 中 MUST 保持各自相同的投影

#### Scenario: Message 可见性与过程投影职责分离

- **GIVEN** canonical Capability Result Message 不作为普通会话消息返回
- **AND** 对应 timeline fact 与 Message 关联校验成功
- **WHEN** 用户查看执行过程
- **THEN** 后端 MUST 按有效呈现级别返回安全过程投影
- **AND** 成功结果 MUST 至少包含 Capability 身份、关联标识和状态
- **AND** 浏览器 MUST NOT 获得或解析该 Message 的原始 `content`

#### Scenario: Conversation history 不再提供工具结果详情输入

- **GIVEN** 用户打开或分页浏览包含多个已完成 Capability 调用的会话
- **WHEN** Agent Web 请求 conversation history
- **THEN** 请求 MUST NOT 要求返回 Capability Result Message 作为过程详情输入
- **AND** 过程详情 MUST 通过对应 run 的 run-event history 安全投影加载
- **AND** 既有 AskUserQuestion accepted-answer 兼容投影 MUST NOT 被解释为普通工具结果详情

#### Scenario: 显式请求 Capability Result Message 也不返回普通工具原文

- **GIVEN** Web 调用方设置 `includeCapabilityResults=true`
- **AND** conversation page 包含非 AskUserQuestion Capability Result Message
- **WHEN** 后端投影 conversation response
- **THEN** 该 item 的 `content` MUST 为空字符串
- **AND** response 的其他字段 MUST NOT 包含原始结果 payload、工具参数或未经过共享 projector 的结果详情

#### Scenario: 共享对话不携带普通工具结果原文

- **GIVEN** 一个被分享的完整请求包含用户问题、一个或多个普通 Capability Result Message 和最终 Assistant Message
- **WHEN** 访客加载只读共享对话
- **THEN** 响应 MUST 保留用户问题与最终回答并排除普通 Capability Result Message
- **AND** 响应 MUST NOT 包含原始工具结果、工具参数或结果 metadata 中的未白名单字段

#### Scenario: Message 关联不可用时安全降级

- **GIVEN** history 事件引用的 Message 缺失、越过当前 owner/agent/session/run scope 或 tool call 坐标不匹配
- **WHEN** 后端生成用户可见过程投影
- **THEN** 后端 MUST 省略结果详情并输出不高于 `STATUS_ONLY` 的安全结果或既有安全不可用状态
- **AND** 后端 MUST NOT 搜索其他 Message 猜测关联，也 MUST NOT 把原始事件 payload 作为详情回退

### Requirement: 工具结果投影不得因 Skill 或发现来源而变化

Skill manifest 的 `allowed-tools`、`tools` 和 `metadata.denied-tools` MUST 只作为 Capability 治理约束，MUST NOT 定义新 Tool 实现、新结果投影身份或更高的用户可见上限。工具被直接调用、Skill 激活、ToolSearch 激活或其他受治理路径激活时，后端 MUST 使用 Capability Catalog 最终解析的 Tool-kind descriptor `capabilityId` 选择呈现规则和平台安全 projector；Skill id、Skill 内容、激活来源和调用路径 MUST NOT 参与该选择。

同一工具以不同受治理来源执行时，对同一 canonical 结果和策略快照 MUST 产生相同的有效级别、`safeSummary`、`safeResult`、详情文本、截断标记和安全失败事实。Skill 激活的扩展 Tool 没有平台管理的安全 projector 时，即使有效配置请求 `SUMMARY` 或 `DETAIL`，结果也 MUST 降级为 `STATUS_ONLY`。不存在、非 Tool-kind、未绑定或未授权的引用 MUST 由 Capability 治理拒绝，用户界面 MUST NOT 出现伪造的成功结果或从 Skill 内容派生的详情。

#### Scenario: 内置工具直接调用与经 Skill 激活的投影相同

- **GIVEN** `Read` 以直接模型工具调用和 Skill `allowed-tools` 激活两种路径分别执行
- **AND** 两次执行具有等价的 canonical 安全结果、`capabilityId=Read` 和同一策略快照
- **WHEN** 后端生成 live 或 history 结果投影
- **THEN** 两条投影 MUST 具有相同的有效级别、摘要、详情和截断行为
- **AND** 投影 MUST NOT 包含 Skill id、Skill 源路径或 Skill 正文

#### Scenario: Skill 激活未配置安全 projector 的扩展工具

- **GIVEN** Skill `allowed-tools` 激活一个经 Capability Catalog 授权的扩展 Tool
- **AND** 该 Tool 没有平台管理的结果安全 projector
- **AND** 集成规则请求 `DETAIL`
- **WHEN** 用户查看该 Tool 结果
- **THEN** 有效级别 MUST 为 `STATUS_ONLY`
- **AND** 系统 MUST NOT 复制扩展结果 JSON、Skill 内容或上游自定义摘要

#### Scenario: Skill 无权激活工具时不伪造成功投影

- **GIVEN** Skill 引用不存在、非 Tool-kind、未绑定或未授权的 Capability
- **WHEN** Capability 治理解析该引用
- **THEN** 系统 MUST 拒绝激活或执行
- **AND** channel 最多只能投影已产生的安全失败事实
- **AND** 用户界面 MUST NOT 出现成功结果卡、原始 Skill 内容或未经安全 projector 的工具结果

### Requirement: 大结果历史浏览不得产生逐结果请求放大

当用户加载包含 Capability 结果的多轮历史时，run-event history 响应 MUST 随每个已返回的过程事件携带其当前安全投影或安全降级结果；浏览器 MUST NOT 为获得 `safeSummary`、`safeResult`、详情文本或呈现级别而按结果发起额外网络请求。该约束 MUST 在既有最多 500 个用户可见过程步骤的单请求边界内成立。自动加载 run-event history 的并发请求数 MUST 不超过 4，单次稳定视口更新自动保留的目标 run MUST 不超过 16；同一 run 的已完成或进行中请求 MUST 去重。

**需求类别**：系统质量属性

**质量属性**：性能/容量
**适用范围**：该 Function

#### Scenario: 500 个混合工具过程步骤不产生 N 加一请求

- **GIVEN** 一个历史会话包含一个具有 500 个用户可见过程步骤的请求
- **AND** 步骤混合三种呈现级别、内置 Tool、Skill 激活 Tool、已识别扩展 Tool 和 unknown/custom Tool
- **WHEN** 用户打开会话并持续浏览到该请求的全部已加载步骤
- **THEN** 浏览器为获得 Capability 结果投影而新增的网络请求数 MUST 为 0
- **AND** 所有已返回结果 MUST 直接使用所属 history 页面中的安全投影或安全降级结果

#### Scenario: 快速导航不重复加载已取得的结果详情

- **GIVEN** 大数据量多轮会话的某个 history 页面及其 Capability 结果投影已经加载
- **WHEN** 用户通过预览区跳转、拖动滚动条、滚轮快速滚动或点击滚动条反复进入该页面覆盖的可视区域
- **THEN** 浏览器 MUST NOT 因结果详情进入或离开视口而重新请求或重新获取该页面的 Capability 结果内容
- **AND** 结果进入视口时 MUST 使用已加载的安全投影渲染

#### Scenario: 多轮快速滚动限制 run history 请求并发

- **GIVEN** 快速滚动连续命中超过 16 个包含过程历史的 run
- **WHEN** Agent Web 调度自动 history 加载
- **THEN** 同时进行的 run-event history 请求 MUST 不超过 4
- **AND** 单次稳定视口更新保留的自动目标 MUST 不超过 16
- **AND** 同一 run MUST NOT 存在两个并发加载请求

### Requirement: Capability 过程标题必须使用最小公开身份生成

系统 MUST 为普通 Agent Web 中每个用户可见 Capability 步骤显示非空标题和独立状态。标题 MUST 只使用 lifecycle 公开的 `capabilityKind + capabilityId`、optional `targetCapabilityId`、当前已验证的 Capability presentation resources 和平台固定动作模板生成；系统 MUST NOT 从调用参数、结果正文、模型输出、description、metadata、Provider 配置或浏览器非受信状态猜测名称。

**需求类别**：功能性需求

Agent Web MUST 对一个 `CapabilityPresentationResource` 按以下确定顺序选择名称：

1. `locales.language` 精确包含当前 UI locale 时，使用该 entry 的合法 `displayName`；
2. 第一步未命中且 `locales.language['en-US']` 存在时，使用其合法 `displayName`；
3. 前两步未命中时，使用合法 stable `displayName`；
4. resource 缺失时，使用合法 public `capabilityId`。

Resolver MUST NOT 执行语言前缀匹配、`zh`/`en` 猜测、任意其他语言 fallback 或 description fallback。Resource name、fallback id 和动作模板参数 MUST 作为纯文本 React child 渲染，MUST NOT 解析为 HTML、Markdown、URL 或可执行内容。

普通 Tool MUST 直接使用 `TOOL + capabilityId` 对应 resource 的选定名称。直接 Agent、Skill、Workflow MUST 分别使用平台固定动作模板包装 `AGENT`、`SKILL`、`WORKFLOW` resource 的选定名称。`Agent`、`Skill`、`Workflow` wrapper MUST 根据执行入口推导目标 kind：`Agent → AGENT`、`Skill → SKILL`、`Workflow → WORKFLOW`。合法 `targetCapabilityId` 存在时，标题 MUST 使用目标 resource 名称或目标 id；目标 identity 缺失或非法时，标题 MUST 使用平台固定中性动作。系统 MUST NOT 增加 `targetCapabilityKind`。

状态 MUST 继续由既有 lifecycle phase 与安全失败事实确定，并以单个 ` · ` 与标题连接。执行中、已完成、失败、超时和已取消状态 MUST 使用当前 UI locale 的平台静态 i18n 文案；未知内部枚举 MUST NOT 原样显示。固定动作模板、状态、错误和详情标签属于 Agent Web i18n 资源，MUST NOT 从 Capability presentation resource query 取得。

`AskUserQuestion` 的问题、选项、回答和等待输入 MUST 继续由专用交互呈现。`ApiCall` 的规范路径 MUST NOT 新增普通结果卡。Capability name adaptation MUST NOT 增加、删除、重排或重新分层过程条目，MUST NOT 改变 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 或最终答案。

#### Scenario: Builtin Read 使用 Provider 中文名称

- **GIVEN** `Read` 步骤公开 `capabilityKind=TOOL` 和 `capabilityId=Read`
- **AND** 当前 resource 包含 `zh-CN.displayName=读取文件`、`en-US.displayName=Read file`
- **WHEN** 用户在 `zh-CN` 界面查看正在执行步骤
- **THEN** 标题 MUST 显示“读取文件 · 执行中”
- **AND** 标题 MUST NOT 同时拼接 `Read` 或重复状态

#### Scenario: 扩展 Tool 未配置当前语言时回退英文

- **GIVEN** 扩展 Tool `lookup-alarm` 的 resource 只包含 `en-US.displayName=Look up alarms`
- **WHEN** 用户在 `zh-CN` 界面查看该步骤
- **THEN** 标题 MUST 使用“Look up alarms”和中文状态
- **AND** resolver MUST NOT 伪造中文名称

#### Scenario: Resource 没有 locales 时使用 stable displayName

- **GIVEN** 一个 Capability resource 不包含 `locales`
- **WHEN** resource 具有合法 stable `displayName`
- **THEN** 标题 MUST 使用 stable `displayName`
- **AND** Agent Web MUST NOT 把缺少 `locales` 解释为 resource missing

#### Scenario: Resource 缺失时回退 capabilityId

- **GIVEN** 当前 projection 不包含一个合法 Capability identity
- **WHEN** Agent Web 为该过程生成标题
- **THEN** 标题 MUST 使用合法 `capabilityId`
- **AND** 系统 MUST NOT 从其他 Capability、结果或 description 猜测名称

#### Scenario: Skill wrapper 使用目标 Skill resource

- **GIVEN** lifecycle 公开 `capabilityId=Skill` 和 `targetCapabilityId=network-diagnosis`
- **AND** `SKILL + network-diagnosis` 的 `zh-CN` 名称为“网络诊断”
- **WHEN** 用户查看已完成步骤
- **THEN** 标题 MUST 显示“加载技能：网络诊断 · 已完成”
- **AND** 标题 MUST NOT 使用 wrapper Tool resource 替代目标 Skill resource

#### Scenario: wrapper 目标缺失时显示中性动作

- **GIVEN** lifecycle 公开 `capabilityId=Workflow`
- **AND** `targetCapabilityId` 缺失或不合法
- **WHEN** 用户查看该步骤
- **THEN** 标题 MUST 显示当前语言的 Workflow 中性动作和既有状态
- **AND** 系统 MUST NOT 从结果、description 或其他步骤补充目标名称

#### Scenario: 名称按纯文本渲染

- **GIVEN** 合法名称文本包含 `<img onerror=...>`、Markdown 标记或 URL-like 字符串
- **WHEN** Agent Web 渲染 Capability 标题
- **THEN** 标题 text content MUST 逐字包含该名称
- **AND** 名称 MUST NOT 创建元素、链接、图片、脚本或 Markdown 节点

#### Scenario: 结果披露保持不变

- **GIVEN** 一个 Capability 使用既有专用交互或结果披露策略
- **WHEN** 系统应用 Provider 名称
- **THEN** 专用交互、过程结构、摘要和详情字段 MUST 保持既有行为
- **AND** 名称适配 MUST NOT 提高任何结果披露级别

### Requirement: Capability 生命周期必须公开最小执行身份

系统 MUST 在用户可见且代表受治理 Capability 的 `CAPABILITY_STARTED` 与 `CAPABILITY_COMPLETED` 中公开执行入口身份。新产生的该类事件 MUST 包含合法 `capabilityKind`、既有 `capabilityId` 和 `toolCallId`；`Agent`、`Skill`、`Workflow` 通用入口在能够确定合法目标时 MUST 额外包含一个 `targetCapabilityId`。

**需求类别**：系统质量属性

**质量属性**：安全、可靠性/恢复、可维护性、可测试性、审计/可追溯性
**适用范围**：Capability lifecycle public stream 与 history

新增公共字段契约如下：

| 字段 | 类型 | 必填性 | 合法值与字段关系 | 非法值行为 |
|---|---|---|---|---|
| `capabilityKind` | string | 公共 schema optional；新受治理 Capability producer 必须输出 | 仅允许 `TOOL`、`SKILL`、`AGENT`、`WORKFLOW` | 局部省略，保留合法既有字段 |
| `targetCapabilityId` | string | optional、non-null | trim 后 1 至 128 个 Unicode code point且不含 Unicode control character；只允许 `capabilityId=Agent|Skill|Workflow` | 局部省略，执行和其他步骤不受影响 |

`targetCapabilityId` MUST 只表示本次调用的具体目标能力：`Agent` 使用已解析的 `agentId`，`Skill` 使用已解析的 `name`，`Workflow` 使用已解析的 `recipeName`。公开 payload MUST NOT 同时增加这些入口专属字段，也 MUST NOT 包含 prompt、args、inputText、inputVariables、路径、结果、状态文案或业务名称。

同一次调用的 started 与 completed MUST 逐值复用相同 `capabilityKind`、`capabilityId` 和已存在的 `targetCapabilityId`。成功、失败、超时、取消和结果校验失败 MUST NOT 重新解释目标身份。合法 completion-only 路径 MUST 输出能够安全确定的入口身份；不能确定目标时 MUST 省略 `targetCapabilityId`。

`CAPABILITY_RESULT_DELTA` MUST NOT 因本 change 新增 `capabilityKind` 或 `targetCapabilityId`，并 MUST 继续通过既有 `toolCallId` 与 started/completed 关联。SSE、WebSocket、live run-event history 与刷新后的 history MUST 对同一 lifecycle 事实输出相同身份。

Workflow 外层 wrapper lifecycle MUST 使用 `TOOL + Workflow + targetCapabilityId` 表示本次调用的 Recipe，内部 Tool、Skill、Agent、Subflow 节点 MUST 分别使用 `TOOL`、`SKILL`、`AGENT`、`WORKFLOW` 与其直接目标 id 公开身份，并 MUST NOT 再携带 `targetCapabilityId`。内层事件 MUST 保留既有 `parentToolCallId` 与外层 wrapper 关联。业务标题适配 MUST NOT 增加或删除任何外层或内层过程条目；非 Capability Workflow 节点 MUST 保持既有呈现，不得伪造 Capability kind。

旧 backend 或旧 history 缺少新增字段时 MUST 继续可读取。单条新增字段不合法时，系统 MUST 局部省略该字段并保留合法 `capabilityId`、状态、安全失败事实、其他步骤和最终答案。

#### Scenario: Agent started 与 completed 复用同一目标能力标识

- **GIVEN** Agent 通用入口在执行前解析为 `capabilityKind=TOOL`、`capabilityId=Agent` 和 `targetCapabilityId=network-diagnostic-agent`
- **WHEN** 后端先后产生 started 与 completed
- **THEN** 两个事件 MUST 携带逐值相同的三项身份
- **AND** 中间 result delta MUST NOT 重复携带 `capabilityKind` 或 `targetCapabilityId`

#### Scenario: Skill 只公开归一化目标能力标识

- **GIVEN** Skill 调用参数包含 `name=network-diagnosis` 和其他参数
- **WHEN** 系统公开 started/completed
- **THEN** payload MUST 包含 `targetCapabilityId=network-diagnosis`
- **AND** payload MUST NOT 包含 `name`、Skill 参数正文、源路径或完整调用参数

#### Scenario: 普通 Read 不公开目标能力标识

- **GIVEN** 普通 `Read` Tool 的调用参数中存在任意字段
- **WHEN** 系统公开其 lifecycle
- **THEN** started/completed MUST 包含 `capabilityKind=TOOL` 和 `capabilityId=Read`
- **AND** started/completed MUST NOT 包含 `targetCapabilityId`

#### Scenario: 非 wrapper 携带目标字段时局部降级

- **GIVEN** 一个事件包含 `capabilityId=Write` 和 `targetCapabilityId=unexpected-target`
- **WHEN** Web channel 投影该事件
- **THEN** 投影 MUST 省略 `targetCapabilityId`
- **AND** 投影 MUST 保留合法 `capabilityId=Write` 和既有状态

#### Scenario: Workflow 保持既有外层与内层结构

- **GIVEN** Workflow wrapper 调用 `recipeName=workflow-title-mapped-test`
- **AND** 该 Recipe 执行一个 `recipe_name=alarm-recovery` 的 Subflow 节点
- **WHEN** 系统公开外层和内层 lifecycle
- **THEN** 外层 MUST 使用 `capabilityKind=TOOL`、`capabilityId=Workflow` 和 `targetCapabilityId=workflow-title-mapped-test`
- **AND** Subflow 节点 MUST 使用 `capabilityKind=WORKFLOW` 和 `capabilityId=alarm-recovery`
- **AND** Subflow MUST 通过既有 `parentToolCallId` 关联外层，系统 MUST NOT 因目标名称增加或删除条目

#### Scenario: completion-only 路径保留兼容身份

- **GIVEN** 一个合法 preflight 或恢复路径只产生 `CAPABILITY_COMPLETED`
- **AND** 该路径只能确定合法 `capabilityId`
- **WHEN** 浏览器渲染该步骤
- **THEN** completed MUST 保留该 `capabilityId`
- **AND** 浏览器 MUST 使用该 id 和完成状态降级显示

#### Scenario: 旧历史缺少新增字段

- **GIVEN** history 中一个步骤只有合法 `capabilityId=Read` 和 `toolCallId`
- **WHEN** 新前端加载该历史
- **THEN** history MUST 正常显示该步骤
- **AND** 前端 MUST NOT 查询后端 Capability 目录或调用参数补充身份

### Requirement: Agent Web 必须集中维护 Capability 业务名称映射

Agent Web MUST 按 Session 使用一个共享 presentation resource store 和一个共享纯函数 resolver 管理 Capability identity 到当前显示名称的映射。local、immersive、collaborative 三种宿主、live process 和 history process MUST 使用同一 store、resolver、fallback 顺序和固定动作模板；任一宿主 MUST NOT 建立并行名称配置或宿主专属 resolver。

**需求类别**：功能性需求

Agent Web MUST 在 Session 创建成功或 Session 激活后，对 `GET /api/v1/sessions/:sessionId/capability-presentation-resources` 发起异步完整查询，并 MUST 与 conversation/history 加载并行。展示资源查询 MUST NOT 阻塞用户提交、event ingestion、history、stream 或最终答案。切换 UI locale MUST 只依据当前 Session projection 同步重新计算 live 和 history 标题，MUST NOT 发起 locale-specific query，MUST NOT 修改 history event，MUST NOT 要求重新执行 Capability。

Agent Web MUST 在以下条件之一成立时为对应 Session 调度完整刷新：

1. 一个新接受的 live `CAPABILITY_COMPLETED` 表示 `capabilityId=acquire_skill` 且 `status=SUCCEEDED`；
2. live、history 或延迟加载的 process history 首次出现既不在当前 resource projection、也未被当前完整成功 projection 确认为 missing 的合法 Capability identity 或 wrapper target identity。

同一 accepted acquisition completion 的 replay MUST NOT 重复触发刷新。每个 Session 同时 MUST 至多存在一个 in-flight query；刷新期间再次出现触发时，Agent Web MUST 记录 pending invalidation，并 MUST 在当前请求完成后至多追加一次 trailing refresh。系统 MUST NOT 按过程条目、Tool call 或 render 独立查询。

完整查询成功时，store MUST 原子替换该 Session 的 current projection。已观察 identity 出现在结果中时 MUST 视为 resolved；resource 不包含 `locales` 时也 MUST 视为 resolved。已观察 identity 在完整成功结果中仍缺失时 MUST 在当前 Session projection 中确认为 missing；该 identity 的重复 Tool call 或重复 render MUST NOT 再次触发查询，直到 Session 激活、成功 Skill acquisition 或其他本 Requirement 定义的明确刷新触发重新读取。

查询失败、超时、取消或 response schema invalid 时，store MUST 保留该 Session 的 last-good projection，MUST NOT 增加 confirmed missing。没有 last-good 的 identity MUST 按 id 降级。失败后的自动重试 MUST 按 Session 合并并冷却，MUST NOT 由每次 Tool call 触发。刷新成功或失败均 MUST NOT 阻止其他界面继续显示。

Resource response MUST 只更新发起请求时捕获的 Session。Session 切换、清理或新请求 epoch 产生后，迟到 response MUST NOT 覆盖其他 Session 或复活已清理状态。Resource 更新 MUST 触发使用相同 event 引用的 live/history title 重新计算，并 MUST NOT 改变 process entry key、展开状态或事件对象。

History MUST 只依赖 event 中已有的稳定 Capability identity。当前 locale、resource response 或 Provider name 变化后，当前页重渲染或重新激活 Session MUST 使用 current last-good projection 重新选择名称；系统 MUST NOT 把执行时名称写入 event、conversation、sessionStorage、Gateway 或数据库。没有明确刷新信号的同一 identity 元数据变化 MUST 在当前 Session 内继续使用 last-good；该 Session 再次激活时 MUST 重新读取 current projection。

现有 Skill Catalog 页面 MUST 保持 `/api/v1/skills` 的分页、搜索和可见性语义。系统 MUST NOT 因本 change 给 `SkillCatalogQueryRequest` 增加 locale，MUST NOT 用 Capability presentation resource query 替代 Skill list query。

#### Scenario: 新 Session 与 conversation 并行预取

- **WHEN** Agent Web 创建成功并开始使用一个 Session
- **THEN** 浏览器 MUST 立即调度该 Session 的完整 presentation resource query
- **AND** 用户提交、conversation、history 和 stream MUST NOT 等待该 query 完成

#### Scenario: Capability event 早于展示资源返回

- **GIVEN** 一个 Capability event 已进入当前 Session，但 presentation resource query 尚未返回
- **WHEN** Agent Web 首次渲染该过程条目
- **THEN** 标题 MUST 先按 `capabilityId` 安全降级
- **AND WHEN** resource response 后续成功返回
- **THEN** 不需要新 event 就 MUST 原位更新为当前 locale 的名称
- **AND** process entry key、展开状态和 event 对象 MUST 保持不变

#### Scenario: 中英文切换即时重渲染 live 和 history

- **GIVEN** 同一 Capability resource 包含 `zh-CN` 和 `en-US` 名称
- **AND** live 与 history 都包含相同公开 identity
- **WHEN** 用户从中文切换到英文
- **THEN** live 与 history 标题 MUST 在不请求后端的情况下使用 `en-US` 名称重新渲染
- **AND** 切回中文 MUST 使用 `zh-CN` 名称

#### Scenario: Skill 获取成功触发一次刷新

- **GIVEN** 当前 Session 接受一个 `acquire_skill` 成功 completion
- **WHEN** 该 completion 第一次进入 live accepted event 集合
- **THEN** Agent Web MUST 调度一次完整 presentation resource refresh
- **AND** 同一 completion 的 transport replay MUST NOT 再次触发刷新

#### Scenario: 新 runtime-generated Skill 没有 locales

- **GIVEN** 当前 projection 不包含一个新 runtime-generated Skill identity
- **AND** 该 Skill descriptor 只有 stable `displayName`，没有 `locales`
- **WHEN** 该 identity 首次出现在 process event 并且刷新成功返回该 descriptor
- **THEN** Agent Web MUST 把该 resource 视为 resolved 并使用 stable `displayName`
- **AND** 后续相同 Tool call 或 render MUST NOT 再次触发查询

#### Scenario: 刷新期间的新 identity 触发一次尾随刷新

- **GIVEN** 当前 Session 已有一个 presentation resource query in flight
- **WHEN** 期间出现一个新的合法未知 identity
- **THEN** Agent Web MUST NOT 启动并行 query
- **AND** 当前 query 完成后 MUST 至多追加一次 trailing refresh

#### Scenario: 完整成功后确认 missing

- **GIVEN** 一个已观察 identity 在完整成功结果中仍不存在
- **WHEN** 相同 identity 再次出现在该 Session 的过程事件中
- **THEN** Agent Web MUST 继续按 id 降级
- **AND** 该重复出现 MUST NOT 单独触发新的 query

#### Scenario: 刷新失败保留 last-good

- **GIVEN** 浏览器已有该 Session 的成功 projection
- **WHEN** 后续刷新失败、超时、取消或返回非法 response
- **THEN** 浏览器 MUST 继续使用 last-good resource
- **AND** 系统 MUST NOT 把失败中缺失的 identity 确认为 missing

#### Scenario: 迟到 response 不污染其他 Session

- **GIVEN** Session A 的 resource query 尚未完成且用户已切换到 Session B
- **WHEN** Session A 的 response 随后到达
- **THEN** response MUST NOT 修改 Session B 的 projection
- **AND** Session A 已被清理时该 response MUST NOT 重新创建其状态

#### Scenario: Skill Catalog 查询保持独立

- **WHEN** 用户打开 Skill Catalog 页面并切换界面语言
- **THEN** Skill 列表 MUST 继续通过 `/api/v1/skills` 的既有 request 和分页结果加载
- **AND** `SkillCatalogQueryRequest` MUST NOT 增加 locale

### Requirement: Capability 业务呈现必须与结果显示策略正交

系统 MUST 在 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 下使用同一身份解析、业务标题、状态与安全失败事实。业务名称映射 MUST NOT 改变有效结果级别、平台安全上限、安全投影字段或 AskUserQuestion accepted-answer；结果显示策略也 MUST NOT 改变标题身份。

**需求类别**：功能性需求

`SUMMARY` 只有在后端提供已识别的 `safeSummaryCode`、所需参数通过既有白名单和容量校验、且本地化结果 trim 后非空并具有标题和状态之外的独立业务信息时才有效。没有有效摘要时，界面 MUST 省略摘要，只保留标题与状态；MUST NOT 显示“暂无摘要”“结果已返回”“命令执行完成”“程序执行完成”“工作流执行完成”“收到流事件”或语义等价的占位/重复文字，也 MUST NOT 从 raw detail、JSON、技术 id、关键词或详情首句推导摘要。

当既有 `DETAIL` 或安全失败技术详情允许展开时，界面 MUST 只本地化平台拥有的区块标题、字段标签、标点、截断提示、状态标签和安全失败说明。技术证据值的内容、顺序、单位、精度和既有截断结果 MUST 保持不变。业务语言适配 MUST NOT 增加详情字段、展开入口或可见内容。

过程面板和单步骤的既有 disclosure 行为 MUST 保持不变。完成态普通步骤默认收起；摘要 MUST NOT 因配置为 `SUMMARY` 或 `DETAIL` 而成为收起条目下方的常驻正文。没有有效详情的步骤 MUST NOT 显示空展开入口。

#### Scenario: 成功命令直接呈现已有详情而不显示废话摘要

- **GIVEN** `Bash` 或 `Python` 的有效级别为 `DETAIL`
- **AND** 已有安全结果包含可显示 stdout、stderr、非零 exit code、timeout 或截断事实
- **WHEN** 用户展开完成态步骤
- **THEN** 展开区 MUST 直接呈现已有安全执行结果
- **AND** 界面 MUST NOT 在结果上方重复“执行完成”“返回了输出”或语义等价摘要
- **AND** 用户收起步骤后 MUST 只看到标题与状态

#### Scenario: 空成功命令没有摘要和空展开入口

- **GIVEN** `Bash` 或 `Python` 成功结果 exit code 为零且没有 stdout、stderr、timeout 或截断事实
- **WHEN** 用户查看完成态步骤
- **THEN** 界面 MUST 只显示标题与状态
- **AND** 界面 MUST NOT 显示成功占位摘要或空展开入口

#### Scenario: Workflow 外层成功摘要不重复状态

- **GIVEN** Workflow outer result 的唯一摘要只表达 recipe 已完成、等待或中断，且标题和状态已表达同一事实
- **WHEN** 用户查看该 ordinary Capability 步骤
- **THEN** 界面 MUST 省略重复摘要
- **AND** Workflow inner product 和 terminal answer MUST 继续遵守各自既有呈现契约

#### Scenario: 前端不从 raw JSON 生成摘要

- **GIVEN** 一个 ordinary Capability result 没有有效受信摘要和 recognized `safeResult`
- **AND** 事件携带 legacy text、可解析 JSON 或任意技术详情
- **WHEN** 前端构建过程步骤
- **THEN** 前端 MUST 只显示标题与状态
- **AND** 前端 MUST NOT 截取首句、匹配关键词或显示“工具输出已生成”

### Requirement: Grep 结果按实际模式生成有界安全投影

当 Web channel 投影 `capabilityId="Grep"` 的成功结果时，可信后端共享 projector MUST 校验 canonical result 的 `output_mode` 与模式专属字段，并 MUST 按实际模式生成闭合集合内的 `safeSummaryCode`、白名单化 `safeSummaryArgs` 和可选 `safeResult`。local、immersive、collaborative 三种宿主以及 live stream、run event history MUST 使用同一投影结果。浏览器 MUST NOT 从原始 Capability result、调用参数、普通消息或本地缓存推断模式或补充被投影删除的字段。

`SUMMARY` 的穷尽映射如下：

| `output_mode` | `safeSummaryCode` | `safeSummaryArgs` 必填字段 |
|---|---|---|
| `files_with_matches` | `CAPABILITY_RESULT_GREP_FILES_WITH_MATCHES` | `totalFilesWithMatches`、`truncated` |
| `content` | `CAPABILITY_RESULT_GREP_CONTENT_MATCHES` | `totalMatches`、`totalFilesWithMatches`、`truncated` |

两个总数字段 MUST 为非负整数，`truncated` MUST 为 boolean，且 `safeSummaryArgs.truncated` MUST 等于 canonical result 的 `truncated`。`SUMMARY` MUST NOT 携带 `safeResult`、文件路径、行号、匹配行、pattern 或 glob filter。零匹配 MUST 使用与实际 `output_mode` 对应的同一个 summary code 和数值为 `0` 的计数，浏览器 MUST 将其解释为合法完成但没有匹配。

当 canonical result 通过模式专属 schema 且有效呈现级别为 `DETAIL` 时，投影 MUST 在摘要基础上增加一个 `kind="grepResult"` 的 `safeResult`。该对象 MUST 恰好匹配以下两个 variant 之一，未知字段 MUST 被拒绝：

- 文件模式 variant：必填 `kind="grepResult"`、`outputMode="files_with_matches"`、非负整数 `totalFilesWithMatches`、非负整数 `totalMatches`、boolean `truncated` 和 `filenames`；`filenames` MUST 是最多 50 个非空 execution-view-relative 规范化逻辑路径组成的有序数组。
- 内容模式 variant：必填 `kind="grepResult"`、`outputMode="content"`、非负整数 `totalFilesWithMatches`、非负整数 `totalMatches`、boolean `truncated` 和 `locations`；`locations` MUST 是最多 50 个条目的有序数组，每个条目恰好包含非空 execution-view-relative `filePath` 与不小于 `1` 的整数 `lineNumber`。

只要 canonical result 的 `truncated=true` 或 projector 因 50 个条目上限省略至少一个条目，`safeResult.truncated` MUST 为 `true`；两种情况都不成立时 MUST 为 `false`。任一呈现级别的投影 MUST NOT 携带匹配行正文、文件正文、pattern、glob filter、物理路径、调用参数、credential 或 token。缺少 `output_mode`、模式未知、模式与字段不一致、总数非法或任一将进入 `DETAIL` 的路径条目未通过安全 schema 时，平台安全上限 MUST 降为 `STATUS_ONLY`，系统 MUST NOT 根据其他字段猜测或修复结果。

**需求类别**：系统质量属性
**质量属性**：安全、性能/容量
**适用范围**：该 Function

#### Scenario: 文件模式摘要只显示文件计数
- **GIVEN** Grep canonical result 通过文件模式 schema 且 `output_mode="files_with_matches"`
- **WHEN** 有效呈现级别为 `SUMMARY`
- **THEN** 投影 MUST 使用 `CAPABILITY_RESULT_GREP_FILES_WITH_MATCHES`
- **AND** `safeSummaryArgs` MUST 只包含 `totalFilesWithMatches` 与 `truncated`
- **AND** 投影 MUST NOT 携带 `safeResult`、文件路径或匹配正文

#### Scenario: 内容模式摘要显示匹配和文件计数
- **GIVEN** Grep canonical result 通过内容模式 schema 且 `output_mode="content"`
- **WHEN** 有效呈现级别为 `SUMMARY`
- **THEN** 投影 MUST 使用 `CAPABILITY_RESULT_GREP_CONTENT_MATCHES`
- **AND** `safeSummaryArgs` MUST 只包含 `totalMatches`、`totalFilesWithMatches` 与 `truncated`
- **AND** 投影 MUST NOT 携带 `safeResult`、行号或匹配正文

#### Scenario: 内容模式详情只增加路径和行号
- **GIVEN** Grep canonical result 通过内容模式 schema 且包含 75 个安全匹配条目
- **WHEN** 有效呈现级别为 `DETAIL`
- **THEN** `safeResult` MUST 携带 `kind="grepResult"` 与 `outputMode="content"`
- **AND** `locations` MUST 按 canonical result 顺序包含前 50 个路径与行号条目
- **AND** `safeResult.truncated` MUST 为 `true`
- **AND** 投影 MUST NOT 携带任一匹配行正文

#### Scenario: 文件模式详情只增加有界文件路径
- **GIVEN** Grep canonical result 通过文件模式 schema 且包含 2 个安全文件路径
- **WHEN** 有效呈现级别为 `DETAIL`
- **THEN** `safeResult` MUST 携带 `kind="grepResult"` 与 `outputMode="files_with_matches"`
- **AND** `filenames` MUST 按 canonical result 顺序包含这 2 个文件路径
- **AND** 投影 MUST NOT 携带行号、匹配行正文或 `locations`

#### Scenario: 零匹配摘要保留内容模式
- **GIVEN** Grep canonical result 携带 `output_mode="content"` 且两个总数都为 `0`
- **WHEN** 有效呈现级别为 `SUMMARY` 或 `DETAIL`
- **THEN** 投影 MUST 使用 `CAPABILITY_RESULT_GREP_CONTENT_MATCHES`
- **AND** 浏览器 MUST 显示内容搜索合法完成但没有匹配的本地化语义
- **AND** 系统 MUST NOT 把该结果显示为失败结果或文件模式结果

#### Scenario: 旧结果缺少模式时安全降级
- **GIVEN** live 或 history 中的 Grep 成功结果缺少 `output_mode`
- **WHEN** 可信后端生成用户可见投影
- **THEN** 有效呈现级别 MUST 为 `STATUS_ONLY`
- **AND** 投影 MUST NOT 携带摘要、`safeResult`、详情文本或内容
- **AND** 浏览器 MUST NOT 从空数组或非空数组推断模式

### Requirement: Capability 生命周期可显示受限技术目标名称

当 `CAPABILITY_STARTED` 对应的运行时 Capability 为 `Skill`、`Agent` 或普通 Tool 生命周期下的 `ApiCall`，且可信后端能够证明该事件与同一 owner、Agent、session、request、run、tool call 和 Capability 的模型工具调用唯一关联时，Web stream projection MUST 输出该调用的受限技术目标名称。`Skill` MUST 使用模型工具调用中已校验的 `name`，`Agent` MUST 使用已校验的 `agentId`，`ApiCall` MUST 使用已校验的 `apiName`；该名称 MUST 作为 optional、non-null string 字段 `capabilityTargetName` 输出。

`capabilityTargetName` trim 后 MUST 匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`。字段缺失、关联无法唯一证明或值不匹配该闭合格式时，projection MUST 省略该字段并保留现有 wrapper 身份和状态；projection MUST NOT 因名称不可用而隐藏过程步骤、其他过程内容或最终答案。该字段的默认行为是缺失，旧服务、旧历史和旧客户端 MUST 继续按现有 wrapper 标题互操作。

Agent Web MUST 将 wrapper 身份、合法 `capabilityTargetName` 和当前本地化状态组合为同一标题。同一 `toolCallId` 的后续结果或完成事件未重复携带该名称时，Agent Web MUST 保留已经观察到的名称；没有先前名称时 MUST 使用 wrapper 标题。该行为 MUST 在 live、刷新后的 run-event history、SSE、WebSocket 以及 local、immersive、collaborative 三种宿主中一致。

**需求类别**：功能性需求

#### Scenario: Skill 显示实际技术名称

- **GIVEN** 一个 `Skill` 启动事件唯一关联到 `arguments.name=network-diagnostics` 的模型工具调用
- **WHEN** 用户在 live 或刷新后的 history 查看该步骤
- **THEN** stream payload MUST 包含 `capabilityTargetName=network-diagnostics`
- **AND** 中文 Agent Web 标题 MUST 显示 `SKILL · network-diagnostics` 和当前本地化状态

#### Scenario: Agent 名称在完成事件中保留

- **GIVEN** 一个 `Agent` 启动事件投影了 `capabilityTargetName=network-explorer`
- **AND** 同一 `toolCallId` 的结果和完成事件没有重复该字段
- **WHEN** Agent Web 将该调用聚合为已完成步骤
- **THEN** 标题 MUST 继续显示 `Agent · network-explorer` 和已完成状态
- **AND** 系统 MUST NOT 为恢复名称新增网络请求

#### Scenario: 普通 Tool 生命周期下的 ApiCall 显示 API 名称

- **GIVEN** 一个普通 Tool 生命周期下的 `ApiCall` 启动事件唯一关联到 `arguments.apiName=query-network-kpi` 的模型工具调用
- **WHEN** 用户查看该步骤
- **THEN** 标题 MUST 显示 `ApiCall · query-network-kpi` 和当前状态
- **AND** 当前未产生普通 Capability 卡片的直接 ApiCall 路径 MUST NOT 因本 Requirement 新增卡片

#### Scenario: completion-only 路径安全降级

- **GIVEN** 一个合法 completion-only 过程只有 `CAPABILITY_COMPLETED` 且此前没有可关联的启动名称
- **WHEN** Agent Web 显示该步骤
- **THEN** 标题 MUST 使用现有 wrapper 身份和完成状态
- **AND** 系统 MUST NOT 从结果正文恢复或猜测目标名称

### Requirement: 技术目标名称不得扩大结果披露边界

可信后端 MUST 只从已通过完整模型工具调用关联校验的 `Skill.name`、`Agent.agentId` 或 `ApiCall.apiName` 形成 `capabilityTargetName`，并 MUST NOT 投影该工具调用的其他参数。模型工具调用中的 `args`、`prompt`、路径、请求参数、credential、token、原始结果、Capability Result Message 正文和未白名单 metadata MUST NOT 因技术目标名称投影进入普通 Agent Web。

`capabilityTargetName` MUST 与 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 的有效结果级别独立。同一合法名称在三种配置级别下 MUST 相同；名称存在 MUST NOT 提高平台安全上限、创建 `safeSummary` 或 `safeResult`、开放结果正文或改变安全失败投影。没有平台安全 projector 的运行时 Capability 即使配置为 `DETAIL` 也 MUST 继续降级为 `STATUS_ONLY`。`Bash` 和 `Read` 配置为 `DETAIL` 时 MUST 继续只显示其已有安全 projector 允许的有界详情，且生产默认级别 MUST 保持不变。

**需求类别**：系统质量属性

**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 非白名单参数不随名称输出

- **GIVEN** 一个 `Skill` 模型工具调用同时包含合法 `name` 以及 `args`、`path` 和 `prompt`
- **WHEN** 后端投影对应 `CAPABILITY_STARTED`
- **THEN** payload MUST 只增加合法 `capabilityTargetName`
- **AND** payload MUST NOT 包含 `args`、`path`、`prompt` 或这些字段的值

#### Scenario: 非法名称被局部省略

- **GIVEN** 一个目标名称为空、超过 128 个 ASCII 字符、包含换行、控制字符、空白或路径分隔符
- **WHEN** 后端投影对应生命周期事件
- **THEN** payload MUST 省略 `capabilityTargetName`
- **AND** 该步骤 MUST 继续显示 wrapper 身份和状态

#### Scenario: 普通工具不能借同名参数获得目标名称

- **GIVEN** 一个 `Read` 或未知扩展 Tool 的模型工具调用包含 `name`、`agentId` 或 `apiName`
- **WHEN** 后端投影对应启动事件
- **THEN** payload MUST 省略 `capabilityTargetName`
- **AND** 该 Tool 的既有公开身份与有效结果级别 MUST 保持不变

#### Scenario: 结果显示级别不改变名称和安全上限

- **GIVEN** 同一个合法 wrapper 调用分别应用 `STATUS_ONLY`、`SUMMARY` 和 `DETAIL` 配置
- **WHEN** 后端投影其生命周期与结果
- **THEN** 三种配置下 MUST 输出相同的 `capabilityTargetName`
- **AND** 结果摘要、详情和正文 MUST 继续由各自有效结果级别与平台安全 projector 决定

### Requirement: 无业务标题的 Workflow 内部节点不得显示技术身份

对于可信 Workflow 内部、且不代表 runtime Capability 的节点 lifecycle，当 matching structured process 没有非空 `TITLE` 或 `SUB_TITLE` 时，用户可见过程 MUST NOT 把 `nodeId`、`capabilityId`、`toolCallId`、correlation id 或 `nodeType` 当作业务标题。该 lifecycle 的事实身份、状态、顺序和历史恢复资格 MUST 保持不变；本 Requirement 只约束用户可见过程投影。

该类无业务标题节点处于 started、successful completed、failed、timed-out 或 skipped 状态时，用户可见过程 MUST NOT 为 lifecycle 创建独立步骤。当 matching structured process 包含 `DETAIL`、`SUB_DETAIL` 或 `SUB_CONCLUSION` 时，用户可见过程 MUST 仅在该 occurrence 没有 failed 或 timed-out 终态时保留对应正文 occurrence，且 MUST NOT 为该正文生成空标题、独立状态图标、完成对勾或第二层展开入口；同一 occurrence failed 或 timed-out 时，其无标题正文 occurrence MUST NOT 显示。

同一节点 occurrence 已具有非空 `TITLE` 或 `SUB_TITLE` 时，用户可见过程 MUST 保留该 structured business title，并在 successful、failed 或 timed-out completion 上显示对应实际状态；matching structured detail MUST 沿用既有标题与正文层级。用户可见过程 MUST NOT 为同一终态增加第二个 lifecycle 或故障步骤。对于具有合法 `capabilityKind` 的 `TOOL`、`SKILL`、`AGENT` 或 `WORKFLOW` lifecycle，系统 MUST 沿用各自既有标题与状态规则。

当 Workflow 节点的标题可见且正文被 `show_content=false` 隐藏时，系统 MUST 在 successful completion 投影既有 shape 的 body-free terminal lifecycle，并 MUST NOT 因隐藏正文而丢失实际完成状态。该 terminal lifecycle MUST NOT 包含节点 output、structured content 或其他被正文可见性禁止的内容。

active live、settled live 与 cold history MUST 对相同的可信 Workflow lifecycle/product facts 应用上述同一规则，并形成相同的用户可见步骤、正文 occurrence 和顺序。

**需求类别**：功能性需求

#### Scenario: 无标题延时节点执行期间不显示技术标识

- **GIVEN** 可信 Workflow 投影了一个不代表 runtime Capability 的 `DELAY` 节点 lifecycle
- **AND** 该节点没有 matching 非空 `TITLE` 或 `SUB_TITLE`
- **WHEN** 用户在节点处于 started 状态时查看过程
- **THEN** 用户可见过程 MUST NOT 创建该 lifecycle 的独立步骤
- **AND** 用户可见内容 MUST NOT 包含该节点的 `nodeId`、`capabilityId`、`toolCallId`、correlation id 或 `nodeType`

#### Scenario: 无标题节点完成后只显示正文

- **GIVEN** 无业务标题的可信 Workflow 内部非 runtime Capability 节点已经 started
- **WHEN** 同一节点 successful completed 并产生 matching `DETAIL`、`SUB_DETAIL` 或 `SUB_CONCLUSION`
- **THEN** settled live MUST 只保留该 structured product 的正文 occurrence
- **AND** 正文 MUST NOT 具有空标题、独立状态图标、完成对勾或第二层展开入口
- **AND** started lifecycle 的独立步骤 MUST NOT 在 completion 时出现或消失

#### Scenario: 无标题且无正文的节点不论终态均不显示

- **GIVEN** 可信 Workflow 内部非 runtime Capability 节点没有 matching 非空 `TITLE` 或 `SUB_TITLE`
- **AND** 该 occurrence 没有 matching `DETAIL`、`SUB_DETAIL` 或 `SUB_CONCLUSION`
- **WHEN** 该节点 successful、failed 或 timed-out
- **THEN** 用户可见过程 MUST NOT 显示该节点的 lifecycle 或正文步骤

#### Scenario: 无标题但有正文的失败节点不显示

- **GIVEN** 可信 Workflow 内部非 runtime Capability 节点没有 matching 非空 `TITLE` 或 `SUB_TITLE`
- **AND** 该 occurrence 具有 matching `DETAIL`、`SUB_DETAIL` 或 `SUB_CONCLUSION`
- **WHEN** 该节点 successful completed
- **THEN** 用户可见过程 MUST 以不折叠的纯正文 occurrence 显示该正文
- **WHEN** 同一 occurrence failed 或 timed-out
- **THEN** 用户可见过程 MUST NOT 显示该 lifecycle 或 matching 正文 occurrence

#### Scenario: 已配置业务标题和 runtime Capability 保持既有呈现

- **WHEN** Workflow 节点具有 matching 非空 `TITLE` 或 `SUB_TITLE`，或者 lifecycle 具有合法 `capabilityKind=TOOL`、`SKILL`、`AGENT` 或 `WORKFLOW`
- **THEN** 用户可见过程 MUST 沿用该类别既有的业务标题、实际状态和 structured product 呈现规则
- **AND** 本 Requirement MUST NOT 删除或重命名其用户可见步骤

#### Scenario: 有业务标题的节点失败时保留标题

- **GIVEN** 可信 Workflow 内部非 runtime Capability 节点已经为一个 occurrence 产生非空 `TITLE` 或 `SUB_TITLE`
- **WHEN** 同一 occurrence 的 lifecycle 以 failed 或 timed-out 状态完成
- **THEN** 用户可见过程 MUST 在该业务标题上显示对应终态
- **AND** 用户可见过程 MUST NOT 把该标题替换为本地化通用故障标题
- **AND** 用户可见过程 MUST NOT 为同一 occurrence 增加第二个故障步骤

#### Scenario: 有业务标题的节点成功时保留正文和实际状态

- **GIVEN** 可信 Workflow 内部非 runtime Capability 节点已经为一个 occurrence 产生非空 `TITLE` 或 `SUB_TITLE` 及 matching structured detail
- **WHEN** 同一 occurrence 的 lifecycle 以 successful 状态完成
- **THEN** 用户可见过程 MUST 在该业务标题上显示成功终态
- **AND** matching structured detail MUST 保持可见
- **AND** 用户可见过程 MUST NOT 为同一 occurrence 增加第二个 lifecycle 步骤

#### Scenario: 有业务标题但隐藏正文的节点仍显示成功状态

- **GIVEN** Workflow 节点已经产生非空 `TITLE` 或 `SUB_TITLE`
- **AND** 该节点配置 `show_content=false`
- **WHEN** 同一 occurrence successful completed
- **THEN** runtime projection MUST 产生不含正文的 successful terminal lifecycle
- **AND** 用户可见过程 MUST 在该业务标题上显示成功状态
- **AND** lifecycle 与用户可见过程 MUST NOT 包含节点 output 或 structured detail

#### Scenario: 实时与历史使用同一无标题规则

- **GIVEN** settled live 与 cold history 输入包含相同的可信 Workflow lifecycle/product facts
- **WHEN** 用户分别查看实时完成态和重新打开后的历史过程
- **THEN** 两条路径 MUST 形成相同的用户可见步骤、正文 occurrence 和顺序
- **AND** cold history MUST NOT 因持久化 lifecycle identity 而重新显示技术标题

### Requirement: RAG 检索结果具有可展示的安全摘要

系统 MUST 为通过既有 RAG 安全 schema 的成功结果生成语言中立召回数量摘要；`SUMMARY` MUST 只携带既有 `safeSummaryCode` 和只含 `totalCount` 的白名单化 `safeSummaryArgs`，MUST NOT 携带 `safeResult`、来源、内容预览、完整内容、provenance、score、rankHint、诊断或其他原始字段。

**需求类别**：功能性需求

有效级别为 `DETAIL` 时，系统 MUST 在数量摘要基础上复用既有 `kind="ragRetrieval"` 安全详情。该详情继续包含 `totalCount` 和按原始顺序排列、最多 50 项的 `items`；每项只包含 `displaySource`、`sourceMissing`、`contentPreview` 和 `contentTruncated`。来源 basename、中文主导最多 40 个 Unicode code point、其他内容最多 100 个 Unicode code point，以及缺失字段和截断判断的既有规则保持不变。

#### Scenario: RAG SUMMARY 只显示召回数量

- **GIVEN** 集成规则把 `Rag` 精确配置为 `SUMMARY`
- **AND** RAG 结果通过既有安全 schema且召回 3 项
- **WHEN** 系统生成用户可见投影
- **THEN** 投影 MUST 包含召回数量 3 的语言中立摘要语义
- **AND** 投影 MUST NOT 包含 `safeResult`、来源或内容预览

#### Scenario: RAG DETAIL 复用既有来源和预览

- **GIVEN** `Rag` 的有效级别为 `DETAIL`
- **WHEN** 系统生成用户可见投影
- **THEN** 投影 MUST 包含既有白名单和既有边界生成的 `ragRetrieval` safe result
- **AND** 系统 MUST NOT 增加任何新的原始检索字段或更大的容量边界

#### Scenario: RAG 非法结果继续安全降级

- **GIVEN** RAG 结果没有通过既有安全 schema
- **WHEN** 系统生成用户可见投影
- **THEN** 平台安全上限 MUST 降为 `STATUS_ONLY`
- **AND** 浏览器 MUST NOT 从原始结果补建数量、来源或预览

### Requirement: RAG 过程详情以来源标签和单行预览呈现

当过程面板呈现 `ragRetrieval` 安全展示摘要时，系统 MUST 将每个 `displaySource` 渲染为与内容预览视觉分离的紧凑来源标签。系统 MUST 将 `contentPreview` 中连续的空白字符（包括换行和空行）替换为单个空格并去除首尾空白后再展示。`contentTruncated=true` 时，系统 MUST 仅在归一化后的预览末尾追加 `...`。

#### Scenario: 来源与多行预览分离展示
- **WHEN** 一个 RAG 摘要项包含 `displaySource="rag-upf-timeout.md"`，且其 `contentPreview` 包含换行或空行
- **THEN** 过程面板 MUST 将 `rag-upf-timeout.md` 呈现为独立来源标签
- **AND** 过程面板 MUST 将预览呈现为单行文本，换行或空行之间以单个空格分隔

### Requirement: Cancel 终端事件 content 不得进入前端答案正文区域

前端答案正文区域 MUST 只展示 `LLM_CONTENT_DELTA` 事件积累的内容，MUST NOT 展示 `REQUEST_CANCELED` 事件或 cancel-category `REQUEST_FAILED` 事件的终端 content。当 cancel 终端事件到达时，前端 MUST 通过 `CanceledNotice` 组件使用 i18n 文本渲染取消提示，终端 content 本身 MUST NOT 出现在答案正文区域。

**需求类别**：功能性需求

#### Scenario: REQUEST_CANCELED content 不进入答案正文区域

- **GIVEN** stream 或 history 中存在 `REQUEST_CANCELED` 事件
- **AND** 该事件 payload 包含终端 content
- **WHEN** 前端构建答案正文内容
- **THEN** `REQUEST_CANCELED` 事件 MUST NOT 出现在 `TERMINAL_ANSWER_FALLBACK_EVENTS` 中
- **AND** `readTerminalAnswerFact` MUST NOT 返回 `REQUEST_CANCELED` 事件的 content
- **AND** 答案正文区域 MUST 只展示 `LLM_CONTENT_DELTA` 积累的内容或为空

#### Scenario: cancel-category REQUEST_FAILED 归一化为 CANCELED

- **GIVEN** stream 或 history 中存在 `REQUEST_FAILED` 事件
- **AND** 该事件 payload 的 `category` 字段为 `'CANCELED'`
- **WHEN** 前端解析 run status
- **THEN** `resolveStatus` MUST 返回 `'CANCELED'` 而非 `'FAILED'`
- **AND** 前端 MUST 渲染 `CanceledNotice` 而非 `FailedNotice`
- **AND** 该事件的 content MUST NOT 进入答案正文区域

#### Scenario: cancel-category REQUEST_FAILED content 不作为答案 fallback

- **GIVEN** `TERMINAL_ANSWER_FALLBACK_EVENTS` 包含 `REQUEST_FAILED`
- **AND** 存在 cancel-category `REQUEST_FAILED` 事件
- **WHEN** `readTerminalAnswerFact` 遍历终端事件
- **THEN** 如果 `REQUEST_FAILED` 事件 payload 的 `category === 'CANCELED'`，MUST 跳过该事件
- **AND** 该事件的 content MUST NOT 作为答案 fallback 返回

#### Scenario: 固定占位文本不泄漏进答案正文区域

- **GIVEN** 终端消息 content 为 `'Request canceled by user.'`
- **AND** 该消息通过 history 加载映射为 stream envelope
- **WHEN** 前端构建答案正文内容
- **THEN** `FAILED_TERMINAL_PLACEHOLDER` 正则 MUST 匹配 `'Request canceled by user.'`
- **AND** 匹配的 content MUST NOT 进入答案正文区域
- **AND** 答案正文区域 MUST 只展示 `LLM_CONTENT_DELTA` 积累的内容或为空

#### Scenario: history 加载时终端消息不 fallback 到 LLM_CONTENT_DELTA

- **GIVEN** 一条 ASSISTANT 角色的终端消息通过 history 加载
- **AND** 该消息 `messageId` 以 `assistant-terminal-` 开头
- **AND** `resolveTerminalHistoryEventType` 无法从 `metadata` 或 content 匹配中识别终端类型（返回 `null`）
- **WHEN** `toHistoryEnvelope` 确定 event type
- **THEN** 该消息 MUST NOT fallback 到 `LLM_CONTENT_DELTA`
- **AND** 该消息 MUST NOT 生成 stream envelope
- **AND** 该消息的 content MUST NOT 进入答案正文区域

### Requirement: 无流式正文时答案正文区域展示 i18n 友好提示

当 cancel 终态到达且无流式正文内容（`hasAnswerContent === false`）时，前端 MUST 在答案正文区域内渲染居中的 i18n 提示文本，MUST NOT 让答案正文区域完全空白。该提示 MUST 使用已有 i18n key `turn.canceledWithoutAnswer` 随界面语言渲染。`CanceledNotice`（分割线上方灰色提示）MUST 继续保留，两者互补。

**需求类别**：功能性需求

#### Scenario: cancel 无内容时答案正文区域展示友好提示

- **GIVEN** run status 为 `CANCELED`
- **AND** `hasAnswerContent === false`
- **AND** 非 guard-blocked 场景
- **WHEN** 前端渲染 TurnBlock
- **THEN** 答案正文区域 MUST 渲染居中的 i18n 提示文本
- **AND** 该文本 MUST 使用 `turn.canceledWithoutAnswer` key
- **AND** 该文本 MUST 随界面语言变化
- **AND** `CanceledNotice` MUST 继续在分割线上方渲染

#### Scenario: cancel 有内容时答案正文区域保留流式内容

- **GIVEN** run status 为 `CANCELED`
- **AND** `hasAnswerContent === true`
- **WHEN** 前端渲染 TurnBlock
- **THEN** 答案正文区域 MUST 展示 `LLM_CONTENT_DELTA` 积累的内容
- **AND** 答案正文区域 MUST NOT 展示 `canceledWithoutAnswer` 提示
- **AND** `CanceledNotice` MUST 使用 `canceledWithPartialContent` key

### Requirement: 非执行中 run cancel 时前端状态正确收束

当 cancel 作用于非执行中 run（pending input 或 queued）时，前端 MUST 正确接收 `REQUEST_CANCELED` 终端事件并收束 run 状态。前端 `resolveStatus` MUST 返回 `CANCELED` 而非 `EXECUTING`，stop 按钮 MUST 消失，输入框 MUST 恢复为发送状态。conversation store MUST NOT 因 `requestContextId` 不一致而拒绝 `REQUEST_CANCELED` 终端事件。

**需求类别**：功能性需求

#### Scenario: pending input run cancel 后状态收束为 CANCELED

- **GIVEN** 一个 run 处于 pending input 状态（等待用户输入）
- **AND** 前端 turn 状态为 `EXECUTING`，stop 按钮显示
- **WHEN** API cancel 请求到达后端，`REQUEST_CANCELED` 终端事件通过 stream 到达前端
- **THEN** `resolveStatus` MUST 返回 `CANCELED`
- **AND** turn 状态 MUST 显示已取消（i18n）
- **AND** stop 按钮 MUST 消失，输入框 MUST 恢复为发送状态
- **AND** `handleTerminalEvent` MUST 被调用，`requestStatus` MUST 收束为 `canceled` 或 `idle`

#### Scenario: queued run cancel 后状态收束为 CANCELED

- **GIVEN** 一个 run 处于 queued 状态（排队中，未开始执行）
- **AND** 前端 turn 状态为 `EXECUTING`，stop 按钮显示
- **WHEN** API cancel 请求到达后端，`REQUEST_CANCELED` 终端事件通过 stream 到达前端
- **THEN** `resolveStatus` MUST 返回 `CANCELED`
- **AND** turn 状态 MUST 显示已取消（i18n）
- **AND** stop 按钮 MUST 消失，输入框 MUST 恢复为发送状态
- **AND** `handleTerminalEvent` MUST 被调用，`requestStatus` MUST 收束为 `canceled` 或 `idle`

#### Scenario: terminal 事件 attemptId 不匹配时仍被接受

- **GIVEN** conversation store 中存在 `rootMessageId` 匹配的 active bucket
- **AND** 到达的 terminal 事件 `attemptId` 与 active bucket 的 `attemptId` 不同
- **WHEN** `appendEnvelopes` 处理该 terminal 事件
- **THEN** 该 terminal 事件 MUST 被接受（出现在 `acceptedEnvelopes` 中）
- **AND** active bucket MUST 被移入 settled
- **AND** 该 terminal 事件 MUST 出现在 turn 的 events 中，供 `resolveStatus` 检查

#### Scenario: cancel 后同页面新 submit 不受旧 root 残留影响

- **GIVEN** 上一轮请求已被 cancel，`requestStatus` 为 `canceled`，`activeRequestRootMessageId` 保留上一轮 root
- **WHEN** 用户在同一页面发起新一轮 submit
- **THEN** 新请求在飞期间 `activeRequestRootMessageId` MUST 为 `null`（不继承上一轮 root）
- **AND** 新请求的 `pendingRequest` MUST NOT 被上一轮 settled bucket 中的 `REQUEST_CANCELED` 清空
- **AND** 新请求的流式过程事件 MUST 正常展示（思考、能力调用、等待补充信息）
- **AND** 新请求被 cancel 后，其 turn 状态 MUST 收束为 `CANCELED` 并展示已取消提示，不得停留在 `EXECUTING`

### Requirement: RAG SUMMARY 结果展示保持安全且可核验

当可信后端确认 `capabilityId=Rag`、结果状态为成功且其有效呈现级别为 `SUMMARY` 时，系统 MUST 在现有 RAG 摘要之外返回 `safeResult`。该 `safeResult` MUST 只包含既有 RAG 安全投影的 `kind="ragRetrieval"`、`totalCount` 和至多 50 个按召回顺序排列的 item。每个 item MUST 只包含安全来源显示名、来源缺失标记、有界内容预览和截断标记。该 Requirement 是 `SUMMARY` 不返回通用 `safeResult` 规则的唯一 RAG 特例。

系统 MUST 使用同一可信后端投影在 SSE、WebSocket、live run-event history 与刷新后的 run-event history 中产生该结果。浏览器 MUST 使用该 `safeResult` 渲染 RAG 条数、来源和预览，且 MUST NOT 从原始 Capability Result Message、工具参数、timeline payload 或本地状态补充字段。

系统 MUST NOT 在此特例中返回绝对路径、工作区根目录、provider-private 字段、`provenance`、分数、原始完整内容、原始查询、诊断或任意未白名单字段。RAG 失败、空的安全投影、`STATUS_ONLY`、`DETAIL` 以外的非 RAG Capability 和未知/自定义 Capability MUST 继续遵守既有呈现策略，且 MUST NOT 因本 Requirement 获得额外结果字段。

**需求类别**：系统质量属性

**质量属性**：安全、性能/容量、可靠性/恢复
**适用范围**：该 Function

#### Scenario: 默认 RAG SUMMARY 展示来源和预览

- **GIVEN** 一个成功的 `Rag` 结果包含 3 条受支持的召回结果
- **AND** 启动期策略将 `Rag` 的有效呈现级别确定为 `SUMMARY`
- **WHEN** 用户在任一浏览器宿主查看该 RAG 步骤
- **THEN** 后端 MUST 返回 `safeSummaryCode=CAPABILITY_RESULT_RAG_RETRIEVAL` 与 `totalCount=3`
- **AND** 后端 MUST 返回包含 3 个按召回顺序排列 item 的 `safeResult`
- **AND** 界面 MUST 显示召回条数、每个安全来源名称和各自的有界内容预览

#### Scenario: RAG SUMMARY 不泄露原始检索字段

- **GIVEN** 一个成功的 `Rag` 结果包含绝对 source path、`provenance`、分数、provider 诊断和超长内容
- **AND** 启动期策略将 `Rag` 的有效呈现级别确定为 `SUMMARY`
- **WHEN** 系统生成用户可见的结果投影
- **THEN** `safeResult` MUST 只包含既有 RAG 安全投影白名单字段和其既有截断结果
- **AND** 浏览器 payload MUST NOT 包含绝对路径、`provenance`、分数、provider 诊断或被截断内容的剩余部分

#### Scenario: 非 RAG SUMMARY 不获得详情字段

- **GIVEN** 一个 `Read` 成功结果的有效呈现级别为 `SUMMARY`
- **WHEN** 系统生成用户可见的结果投影
- **THEN** 该投影 MUST 继续不包含 `safeResult`
- **AND** 系统 MUST NOT 因 RAG 特例改变其他 Capability 的 `SUMMARY` 行为

### Requirement: Workflow 产品过程不受 Capability Result 呈现策略裁剪

`STATUS_ONLY`、`SUMMARY`、`DETAIL` Capability Result 呈现策略 MUST 只治理 ordinary `CAPABILITY_RESULT_DELTA` 以及从 canonical result Message 恢复的 Message-backed result completion。Workflow inner product 与 terminal answer MUST NOT 因该策略被隐藏、摘要化、替换或改变结构。

model loop 调用 Workflow Tool 时，outer invocation MUST 继续持有标准 Tool protocol lifecycle 与 result。outer Assistant Tool-use Message 写入成功后、调用 Workflow 且产生任何 inner Event 前，系统 MUST 发布一个使用相同 `toolCallId` 并引用该 Message 的 ordinary outer `CAPABILITY_STARTED`。canonical outer `CAPABILITY_RESULT` Message 写入成功后，`SUCCEEDED`、`DEGRADED` 和 `TIMED_OUT` 终态 MUST 各自产生 ordinary outer `CAPABILITY_RESULT_DELTA` 和一个 `messageId` 指向该 result Message 的 outer `CAPABILITY_COMPLETED`。Workflow inner lifecycle/product Event MUST NOT 替代、抑制或复制该 outer lifecycle/result。

Workflow product 的 `ANSWER` 或 `SUB_CONCLUSION` 只表示产品展示层级，MUST NOT 改变 terminal Assistant Message 对 canonical `TURN_ANSWER` 的持有关系，也 MUST NOT 使 ordinary structured content 获得 Workflow message-free history 例外。

**需求类别**：功能性需求

#### Scenario: 三档配置不改变 Workflow inner product

- **GIVEN** 同一 completed Workflow product 分别运行在 `STATUS_ONLY`、`SUMMARY` 和 `DETAIL` Capability Result 配置下
- **WHEN** 系统生成 live 或 history projection
- **THEN** 三次投影的产品事件层级、内容类型、content 与 Workflow identity MUST 相同
- **AND** terminal answer MUST 相同

#### Scenario: 普通 Capability Result 继续受策略治理

- **WHEN** ordinary model-loop Capability Result 分别使用 `STATUS_ONLY`、`SUMMARY` 和 `DETAIL`
- **THEN** 系统 MUST 继续按既有 Capability Result 策略产生对应安全投影
- **AND** 既有安全字段、长度限制和降级行为 MUST 保持不变

#### Scenario: Workflow-as-Tool 只治理 outer result

- **WHEN** model loop 调用 Workflow Tool
- **THEN** 系统 MUST 在调用 Workflow 和发布任何 inner Event 前，发布引用 canonical outer Tool-use Message 的 outer `CAPABILITY_STARTED`
- **AND** outer invocation 以 `SUCCEEDED`、`DEGRADED` 或 `TIMED_OUT` 结束且 canonical result Message 已写入
- **THEN** 系统 MUST 发布 ordinary outer `CAPABILITY_RESULT_DELTA` 与引用该 Message 的 outer `CAPABILITY_COMPLETED`
- **AND** outer Workflow Tool result MUST 继续受 matching Capability Result 策略治理
- **AND** inner Workflow product MUST NOT 受 outer 策略裁剪

#### Scenario: 产品层级不绕过 canonical answer 边界

- **WHEN** Workflow product 使用 `ANSWER` 或 `SUB_CONCLUSION` 展示层级
- **THEN** 该层级 MUST NOT 改变 terminal Assistant Message 的 canonical answer 语义
- **AND** ordinary structured Event MUST NOT 因相同字段获得 Event-owned cold-history 例外

### Requirement: Agent Web 系统过程事件必须使用事实性业务语言

普通 Agent Web 收到 `DEGRADATION_NOTICE`、`CONTEXT_COMPACTED` 或前端兼容 `HOOK_DEGRADED` 时，系统 MUST 按当前界面语言显示下表定义的固定业务语义。系统 MUST NOT 将 event type、内部阶段名称、Hook 名称或标识作为标题或基础摘要。系统 MUST NOT 从这三类事件推断请求终态、自动恢复、后续行动或最终答复内容。

**需求类别**：功能性需求

| 事件 | 标题语义 | 基础摘要语义 | 严重程度 |
|---|---|---|---|
| `DEGRADATION_NOTICE` | 本次任务有部分内容未完成 | 用户查看执行详情和本次答复，确认未完成的内容 | 警告 |
| `HOOK_DEGRADED` | 本次任务有部分内容未完成 | 用户查看执行详情和本次答复，确认未完成的内容 | 警告 |
| `CONTEXT_COMPACTED` | 已整理较早的对话 | 系统已整理较早的对话内容，以便继续处理本次任务 | 信息 |

表中事件集合是本 Requirement 的完整适用范围。标题和基础摘要 MUST 采用当前界面的受支持语言表达同一语义；缺少本地化资源时，系统 MUST 使用该界面的既有安全本地化回退，不得回退为 event type、内部阶段名称或 payload 文本。

#### Scenario: canonical 降级提示不承诺请求结果
- **WHEN** 普通 Agent Web 呈现一个 `DEGRADATION_NOTICE`
- **THEN** 折叠过程和完整运行图 MUST 将其显示为警告级“本次任务有部分内容未完成”语义
- **AND** 基础摘要 MUST 引导用户查看执行详情和本次答复，确认未完成的内容
- **AND** 折叠过程 MUST 使用橙黄色三角形感叹号警告图标，并 MUST NOT 使用绿色完成图标或红色失败图标
- **AND** 标题或基础摘要 MUST NOT 声称请求已继续、已恢复、已成功或已失败

#### Scenario: 前端兼容 Hook 提示隐藏内部术语
- **WHEN** 普通 Agent Web 的兼容路径收到 `HOOK_DEGRADED`
- **THEN** 可见提示 MUST 使用与 `DEGRADATION_NOTICE` 相同的警告级“本次任务有部分内容未完成”语义
- **AND** 折叠过程 MUST 使用与 `DEGRADATION_NOTICE` 相同的警告图标
- **AND** 标题或基础摘要 MUST NOT 显示 `HOOK_DEGRADED`、Hook 名称、Hook 标识或任意 payload 文本
- **AND** 系统 MUST NOT 因该事件新增 canonical timeline fact 或历史重建结果

#### Scenario: 上下文整理是信息提示
- **WHEN** 普通 Agent Web 呈现一个 `CONTEXT_COMPACTED`
- **THEN** 折叠过程、完整运行图和 live-only 短暂提示 MUST 使用“已整理较早的对话”语义
- **AND** 严重程度 MUST 为信息而不是警告
- **AND** 折叠过程 MUST 使用中性圆形信息图标，并 MUST NOT 使用绿色完成图标、橙黄色警告图标或红色失败图标
- **AND** 系统 MUST NOT 把上下文整理描述为请求失败

#### Scenario: 不适用事件继续由既有呈现规则处理
- **WHEN** 普通 Agent Web 呈现的事件不是 `DEGRADATION_NOTICE`、`CONTEXT_COMPACTED` 或 `HOOK_DEGRADED`
- **THEN** 本 Requirement MUST NOT 改写该事件的标题、摘要、严重程度或详情
- **AND** 请求终态、Pending Input、附件、后台任务、LLM 内容与思考、Capability 生命周期、Workflow 内容和 `OUTPUT_GUARD_BLOCKED` MUST 继续由各自既有呈现规则处理

#### Scenario: 请求终态失败总结保持独立
- **WHEN** 请求以 `FAILED` 结束，并且同一 request/run 还存在 `DEGRADATION_NOTICE`
- **THEN** 系统过程条目 MUST 使用本 Requirement 定义的固定业务标题与基础摘要
- **AND** 请求下方的事实原因、失败阶段、重试判断与行动指导 MUST 继续由既有请求终态失败契约根据可信 terminal fact 和安全错误事实生成
- **AND** 系统过程条目的标题或基础摘要 MUST NOT 覆盖、替代或复制请求终态失败总结

#### Scenario: 产品配置不能改写系统事件语义
- **WHEN** 任一 Agent Web 宿主输入试图为三类适用事件覆盖标题、基础摘要、严重程度或显示级别
- **THEN** 普通 Agent Web MUST NOT 消费该输入选择系统事件呈现
- **AND** 普通 Agent Web MUST 继续使用本 Requirement 定义的固定业务语义

#### Scenario: 产品配置不能整体隐藏降级事实
- **WHEN** `DEGRADATION_NOTICE` 按既有过程投影规则应在当前用户可见 request/run 的过程 surface 形成独立可见条目
- **THEN** 普通 Agent Web MUST 呈现该处理受限事实
- **AND** 任一宿主或产品配置 MUST NOT 额外删除该条目、把该事件改为信息提示或用成功语义替换该事件

### Requirement: 系统过程事件普通界面必须限制技术信息披露

普通 Agent Web 呈现 `DEGRADATION_NOTICE`、`CONTEXT_COMPACTED` 或 `HOOK_DEGRADED` 时，系统 MUST 只使用 event type 选择标题、基础摘要和严重程度。系统 MUST NOT 将 payload 中的 `message`、`content`、`summary`、`detail`、`reason`、`uiMessage` 或 `safeSummary` 文本显示为标题、基础摘要或默认展开内容。系统 MUST NOT 显示被整理的对话内容。仅当 `DEGRADATION_NOTICE` payload 的显式 `code` 字段为非空安全技术码时，系统 MUST 将该 code 作为默认收起的纯文本技术详情；系统 MUST NOT 从其他文本字段解析、合成或猜测技术码。

**需求类别**：系统质量属性

**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 任意事件文本不能替代固定业务语义
- **WHEN** 三类适用事件的 payload 同时携带 `message`、`content`、`summary`、`detail`、`reason`、`uiMessage` 或 `safeSummary` 中的任意一个或多个字段
- **THEN** 普通 Agent Web 的标题和基础摘要 MUST 仍使用 `Agent Web 系统过程事件必须使用事实性业务语言` 定义的固定业务语义
- **AND** 上述任意字段的文本 MUST NOT 出现在标题、基础摘要或默认展开内容中

#### Scenario: 显式技术码仅在用户主动展开后可见
- **WHEN** `DEGRADATION_NOTICE` 的 payload 携带非空显式 `code`
- **THEN** 折叠过程和完整运行图 MUST 默认收起该 code
- **AND** 仅在用户主动展开技术详情后，系统 MUST 将该 code 显示为纯文本
- **AND** code 是否已知 MUST NOT 改变固定标题、基础摘要、严重程度或请求终态

#### Scenario: 缺少显式技术码时不能从文本补充
- **WHEN** 三类适用事件未携带非空显式 `code`，但任意其他 payload 文本包含类似技术码的内容
- **THEN** 系统 MUST 只显示固定业务语义
- **AND** 系统 MUST NOT 从该文本解析、合成或猜测技术详情

### Requirement: 系统过程事件的实时与历史语义必须闭合

对可从 durable fact 重建的 `DEGRADATION_NOTICE` 和 `CONTEXT_COMPACTED`，普通 Agent Web 的 live 与 history 投影 MUST 使用相同的标题语义、基础摘要语义和严重程度。系统 MUST 保留 transport failure notice、上下文整理短暂动画和 `HOOK_DEGRADED` 的既有 live-only 边界，不得为追求界面一致而伪造 durable fact 或历史条目。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: canonical durable 事件刷新前后语义一致
- **WHEN** 同一 request/run 的 canonical `DEGRADATION_NOTICE` 或 `CONTEXT_COMPACTED` 先在 live stream 中呈现，随后从 run event history 重建
- **THEN** 两次呈现 MUST 使用相同的标题语义、基础摘要语义和严重程度
- **AND** 刷新 MUST NOT 改变该事件的业务含义或把信息提示提升为警告

#### Scenario: transport failure notice 保持 live-only
- **WHEN** Web transport 在没有对应 durable event 的情况下生成安全 transport failure notice
- **THEN** 该 notice MUST 只在当前 live 连接中呈现
- **AND** history MUST NOT 合成对应事件或提示

#### Scenario: 上下文整理短暂动画保持 live-only
- **WHEN** live stream 收到 `CONTEXT_COMPACTED` 并显示既有短暂提示
- **THEN** 该短暂提示 MUST 使用与 durable 过程条目相同的上下文整理业务语义
- **AND** history MUST 只重建 durable 过程条目，不得重播短暂动画

#### Scenario: Hook 兼容事件保持 live-only
- **WHEN** 前端兼容路径收到 `HOOK_DEGRADED`
- **THEN** 当前 live 界面 MUST 使用本 Requirement 定义的固定业务语义
- **AND** history MUST NOT 合成 `HOOK_DEGRADED` 条目

### Requirement: 请求终态同步返回 Hook 执行结果快照

每个 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 和 `REQUEST_SUPERSEDED` terminal stream event 的 `payload` MUST 包含 `hookResults` 或 `hookResultsErrorCode`，且两者 MUST NOT 同时存在。

当系统能够完整取得同一 request/run 在终态提交前已经持久化的全部 `HOOK_INVOKED` 时，`hookResults` MUST 是按 timeline `sequence` 严格升序排列的数组；没有 matching event 时 MUST 返回空数组。每个 matching event MUST 在数组中恰好产生一个条目。数组条目 MUST 是 object，并只允许包含以下字段：必填 `hookInvocationId: string`、`hookId: string`、`stage: LifecycleStage`、`status: HookInvocationStatus`、`failureMode: HookFailureMode`；当源 event 提供时，允许包含 `outcome: HookOutcome` 和 `resultSummary: JsonObject`。源 event 中的其他已有 timeline-only 字段 MUST NOT 进入快照条目；上述必填字段缺失或值非法时 MUST 将该源事实判定为非法。

仅当条目的 `status` 为 `SUCCESS` 时，条目 MUST 包含源 event 的真实 `outcome`，并在源 event 提供时包含 JSON 语义等价的 `resultSummary`。当 `status` 为 `TIMEOUT`、`FAILED`、`INVALID_RESULT` 或 `IGNORED` 时，条目 MUST 省略 `outcome` 和 `resultSummary`。快照 MUST NOT 包含 safe reason、error、diagnostic、duration、idempotency key、mutation summary、Owner Scope、Agent Scope、prompt、模型输入输出、Capability 输入输出、路径、credential、authentication token、附件内容或原始异常。

`HOOK_INVOKED` MUST 继续是单次 Hook invocation 的权威事实。`hookResults` MUST 是同一运行终态的只读快照；系统 MUST NOT 根据该数组重新执行 Hook、改变请求状态或建立第二个 Hook truth source。

**需求类别**：功能性需求

#### Scenario: 多个 Hook 按执行顺序同步返回

- **WHEN** 同一 request/run 在终态提交前已持久化三个合法 `HOOK_INVOKED`
- **THEN** terminal stream event MUST 包含三个 `hookResults` 条目
- **AND** 三个条目 MUST 按源 event 的 timeline `sequence` 严格升序排列
- **AND** 每个源 invocation MUST 恰好出现一次

#### Scenario: 无 Hook 的请求返回空数组

- **WHEN** 同一 request/run 在终态提交前不存在 `HOOK_INVOKED`
- **THEN** terminal stream event MUST 包含 `hookResults: []`
- **AND** terminal stream event MUST NOT 包含 `hookResultsErrorCode`

#### Scenario: 成功 Hook 保留显式结果

- **WHEN** 源 `HOOK_INVOKED` 包含 `status: "SUCCESS"`、真实 `outcome` 和 `resultSummary: { "a": 1, "b": 2 }`
- **THEN** 对应 terminal `hookResults` 条目 MUST 包含相同 `outcome`
- **AND** 该条目的 `resultSummary` MUST 为 `{ "a": 1, "b": 2 }`

#### Scenario: 非成功 Hook 不伪造结果

- **WHEN** 源 `HOOK_INVOKED.status` 为 `TIMEOUT`、`FAILED`、`INVALID_RESULT` 或 `IGNORED`
- **THEN** 对应 terminal `hookResults` 条目 MUST 保留真实 `status` 和 `failureMode`
- **AND** 该条目 MUST 省略 `outcome` 和 `resultSummary`

#### Scenario: 四类终态使用相同快照契约

- **WHEN** 同一 Hook 历史分别伴随 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED`
- **THEN** 每类 terminal stream event MUST 使用相同的 `hookResults` schema、排序规则和内容边界
- **AND** Hook 快照 MUST NOT 改变对应请求终态

### Requirement: Hook 终态快照必须保持作用域隔离

系统 MUST 只聚合与 terminal fact 完全相同的可信 Owner Scope、Agent Scope、session、request 和 run 坐标下的 `HOOK_INVOKED`。任一坐标不匹配的 event MUST NOT 进入 `hookResults`，系统 MUST NOT 搜索其他 scope、session、request 或 run 补足结果。

**需求类别**：系统质量属性

**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 跨作用域事件不能进入快照

- **WHEN** timeline 中存在其他 Owner Scope、Agent Scope、session、request 或 run 的 `HOOK_INVOKED`
- **THEN** terminal `hookResults` MUST NOT 包含这些 event
- **AND** 系统 MUST 只根据当前 terminal scope 的 matching events 形成结果或错误码

### Requirement: Hook 终态快照必须保持有界完整性

序列化后的完整 `hookResults` JSON 数组 MUST 不超过 `49_000 bytes` UTF-8。系统 MUST 在终态 event 提交前读取并验证完整 matching Hook history；无论内部读取是否分页，都 MUST NOT 因单次读取上限遗漏、重复或重排 invocation。

当存在非法 matching event 时，terminal payload MUST 省略 `hookResults`，并 MUST 包含 `hookResultsErrorCode: "HOOK_RESULTS_INVALID"`。当完整数组超过容量时，terminal payload MUST 省略 `hookResults`，并 MUST 包含 `hookResultsErrorCode: "HOOK_RESULTS_LIMIT_EXCEEDED"`。两类失败都 MUST NOT 返回部分数组，MUST NOT 截断、删除条目或改写 `resultSummary`。

**需求类别**：系统质量属性

**质量属性**：性能/容量、审计/可追溯性
**适用范围**：该 Function

#### Scenario: 较大 Hook 历史被完整聚合

- **WHEN** 当前 request/run 有多个 matching `HOOK_INVOKED`，且完整快照未超过容量上限
- **THEN** 系统 MUST 返回全部 invocation 形成的单个完整 `hookResults`
- **AND** 任一 invocation MUST NOT 因内部读取上限而丢失或重复

#### Scenario: 非法 Hook fact 显式降级

- **WHEN** matching `HOOK_INVOKED` 缺少快照必填字段或字段值不在允许集合
- **THEN** terminal payload MUST 包含 `hookResultsErrorCode: "HOOK_RESULTS_INVALID"`
- **AND** terminal payload MUST 省略 `hookResults`
- **AND** 系统 MUST NOT 返回合法条目的部分前缀

#### Scenario: 快照超限不截断

- **WHEN** 序列化后的完整 `hookResults` JSON 数组超过 `49_000 bytes` UTF-8
- **THEN** terminal payload MUST 包含 `hookResultsErrorCode: "HOOK_RESULTS_LIMIT_EXCEEDED"`
- **AND** terminal payload MUST 省略 `hookResults`
- **AND** 系统 MUST NOT 截断数组、删除条目或改写 `resultSummary` 以适应容量

### Requirement: Hook 终态快照不可用时必须保留原请求终态

当 Hook history 读取失败、超时或不完整时，terminal payload MUST 省略 `hookResults`，并 MUST 包含 `hookResultsErrorCode: "HOOK_RESULTS_UNAVAILABLE"`。该降级 MUST 保持原有 request terminal status、content、code、category 和 retryable 字段不变，MUST NOT 返回已读取 invocation 的部分前缀。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: 历史读取失败保持原终态

- **WHEN** Hook history 读取失败、超时或不完整
- **THEN** terminal payload MUST 包含 `hookResultsErrorCode: "HOOK_RESULTS_UNAVAILABLE"`
- **AND** terminal payload MUST 省略 `hookResults`
- **AND** request terminal status、content、code、category 和 retryable MUST 保持未聚合 Hook 快照时的值

### Requirement: Hook 终态快照在实时与历史中必须一致

SSE、WebSocket、timeline resume 和 REST run-event history MUST 调用同一个 terminal event projector 返回 `hookResults` 或 `hookResultsErrorCode`。对同一个 persisted terminal fact，这四个 surface 的字段存在性、数组顺序、条目字段和值 MUST 相同。普通 conversation history MUST NOT 从 assistant message、其他 timeline events 或浏览器状态重建 `hookResults`。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复、可测试性
**适用范围**：该 Function

#### Scenario: Live 与 REST history 返回相同快照

- **WHEN** 同一个 persisted terminal fact 先通过 SSE 或 WebSocket 返回，随后通过 REST run-event history 读取
- **THEN** 两次返回的 `hookResults` 或 `hookResultsErrorCode` MUST 相同
- **AND** REST history MUST NOT 再读取独立 Hook event 重新计算快照

#### Scenario: Resume 复用 persisted terminal 快照

- **WHEN** 客户端从 terminal event 之前的合法 sequence 恢复同一 run stream
- **THEN** resume 返回的 terminal payload MUST 与首次投影的 terminal payload 使用相同 Hook 快照事实
- **AND** 恢复过程 MUST NOT 产生新的 `HOOK_INVOKED` 或不同顺序的 `hookResults`

#### Scenario: Conversation history 不重建 Hook 快照

- **WHEN** 调用方只读取普通 conversation history
- **THEN** conversation response MUST NOT 从 assistant message metadata 或 content 合成 `hookResults`
- **AND** Hook 快照 MUST 只通过 terminal stream event 或 run-event history 返回

### Requirement: 已有 typed safe result 必须使用本地化结构呈现

前端 MUST 对共享后端已经提供的 `ToolSearch`、`Cron` 和 `TodoWrite` typed safe result 使用当前界面语言的专用结构呈现。该呈现 MUST 只消费 safe result 白名单字段，不得改变字段内容、顺序或既有截断结果。

**需求类别**：功能性需求

`ToolSearch` DETAIL MUST 显示已有工具名称、kind、capability id、description preview 和截断事实；`Cron` DETAIL MUST 按 create、delete、list 形态显示已有任务标识、human schedule、cron、recurring 和截断事实；`TodoWrite` MUST 本地化空列表、更新数量和 `pending/in_progress/completed` 状态。没有详情项且没有截断事实时，界面 MUST 省略展开入口。

#### Scenario: ToolSearch DETAIL 使用专用结构

- **GIVEN** `ToolSearch` 的有效级别为 `DETAIL` 且 safe result 包含两个工具
- **WHEN** 用户展开步骤
- **THEN** 界面 MUST 按原顺序显示两个工具的已有安全字段
- **AND** 界面 MUST NOT 退化为 raw JSON 或浏览器生成摘要

#### Scenario: Cron 三种结果使用专用结构

- **GIVEN** `Cron` safe result 分别表示 create、delete 或 list
- **WHEN** 用户展开步骤
- **THEN** 界面 MUST 使用与实际形态匹配的当前语言字段标签
- **AND** 界面 MUST NOT 显示 prompt、原始参数或未白名单字段

#### Scenario: TodoWrite 状态使用当前语言

- **GIVEN** `TodoWrite` safe result 包含 pending、in-progress 和 completed 项
- **WHEN** 用户使用中文或英文界面查看详情
- **THEN** 每个状态和空列表/更新文案 MUST 使用当前界面语言
- **AND** 切换语言 MUST NOT 改变 todo 内容、顺序或状态事实

### Requirement: ProcessDetail 必须显示定向 Skill lifecycle

当 canonical runtime timeline 包含定向 Skill 的 `CAPABILITY_STARTED` 或 `CAPABILITY_COMPLETED` 时，用户可见 stream projection 和 Agent Web ProcessDetail MUST 按既有 Capability lifecycle 规则显示该步骤。标题 MUST 使用与普通模型 function call 选择的 Skill 相同的身份解析和业务标题规则，例如 `capabilityId=Skill` 与 `targetCapabilityId=alarm-diagnosis` 显示为“加载技能：alarm-diagnosis”或当前有效显示名。live stream 与刷新后的 history MUST 对同一 timeline facts 输出相同步骤；前端 MUST NOT 从用户消息 metadata、`POLICY_APPLIED`、前端本地 state 或 Skill 列表选择状态推导 Capability 步骤。旧 history 不包含该事实时，系统 MUST NOT 补造步骤。

**需求类别**：功能性需求

#### Scenario: 手动 Skill 与嵌套 Skill 都显示

- **WHEN** 用户手动选择 `alarm-diagnosis`，该 Skill 实际加载并产生 Capability lifecycle facts，随后模型通过 function call 加载 `network-diagnostics`
- **THEN** ProcessDetail MUST 按时间顺序显示“加载技能：alarm-diagnosis”
- **AND** ProcessDetail MUST 继续按既有规则显示“加载技能：network-diagnostics”
- **AND** 两个步骤 MUST 使用同一 Skill 标题模板和状态规则

#### Scenario: 刷新后的历史保持一致

- **WHEN** 请求完成后用户重新打开该历史会话
- **THEN** ProcessDetail MUST 从持久化 timeline facts 重新渲染手动选择 Skill 的 lifecycle 步骤
- **AND** 该步骤的标题、顺序和状态 MUST 与 live stream 中基于同一 facts 的呈现一致

#### Scenario: 旧历史不补造步骤

- **WHEN** 旧请求的持久化 timeline 不包含定向 Skill 的 `CAPABILITY_STARTED` 或 `CAPABILITY_COMPLETED`
- **THEN** ProcessDetail MUST NOT 根据用户消息 metadata、`POLICY_APPLIED` 或当前 Skill 列表状态补造该步骤
