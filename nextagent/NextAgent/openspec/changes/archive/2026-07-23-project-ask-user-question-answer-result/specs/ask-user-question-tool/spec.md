## ADDED Requirements

### Requirement: Accepted AskUserQuestion answer publishes a durable-first visible result

当 runtime 接受由 canonical `AskUserQuestion` 创建的 `QUESTION` pending input 回答时，系统 MUST 先为原始 tool call 持久化恰好一个可见 `CAPABILITY_RESULT` message，再向当前 session stream 发布对应的 `CAPABILITY_RESULT_DELTA` 安全结果投影，最后继续原始 run。该结果投影 MUST 使用 durable pending input 中的 `producerRef.toolCallId`、`producerRef.capabilityId`、`pendingInputId` 和已接受回答；MUST NOT 使用浏览器 request body、本地 composer state 或重新调用 `AskUserQuestion` 得到结果。

缺少当前 stream subscriber 或 live-only delivery 未到达客户端时，runtime MUST 保留 durable result 并继续既有恢复路径；MUST NOT 回滚已接受回答、重复恢复 run 或重复调用 `AskUserQuestion`。

#### Scenario: Accepted question answer is visible before resumed model output

- **WHEN** runtime 接受 canonical `AskUserQuestion` 的有效 `QUESTION` 回答
- **THEN** 系统 MUST 先持久化原始 tool call 的可见 `CAPABILITY_RESULT` message
- **AND** 当前 session stream MUST 在后续 resumed model output 之前发布该 tool call 的 `CAPABILITY_RESULT_DELTA` 安全结果投影
- **AND** result message 与 stream projection MUST 指向同一 request、run、tool call 和 pending input
- **AND** runtime MUST NOT 为该交互发布 `CAPABILITY_STARTED` 或 `CAPABILITY_COMPLETED`

#### Scenario: Durable result write failure does not publish an answer result

- **WHEN** pending input 已解析为 `RECEIVED`，但原始 tool call 的可见 `CAPABILITY_RESULT` message 未能持久化
- **THEN** runtime MUST NOT 发布声称回答结果已经可恢复的 `CAPABILITY_RESULT_DELTA`
- **AND** runtime MUST NOT 继续一个缺少该 durable result 的 AskUserQuestion producer tool call
- **AND** 既有 recoverable pending-input resume failure 行为 MUST 保持有效

#### Scenario: Replayed answer command does not duplicate the result

- **WHEN** 同一已接受 answer command 以相同 idempotency semantic 再次提交
- **THEN** runtime MUST NOT 写入第二个 `CAPABILITY_RESULT` message
- **AND** runtime MUST NOT 发布第二个 answer-result `CAPABILITY_RESULT_DELTA`
- **AND** runtime MUST NOT 再次恢复原始 run

#### Scenario: Missing live delivery preserves durable recovery

- **WHEN** durable `CAPABILITY_RESULT` message 已经写入，但当前没有匹配的 stream subscriber 或客户端没有收到 live-only answer result
- **THEN** runtime MUST 继续原始 run
- **AND** 后续 conversation/history 读取 MUST 仍能返回该 durable result
- **AND** 系统 MUST NOT 为补偿 live delivery 缺失而重复写入 result、重复恢复 run 或改变 pending input 状态

#### Scenario: Timeout and cancellation do not synthesize an answer result

- **WHEN** canonical `AskUserQuestion` pending input 超时或被取消，而不是解析为 `RECEIVED`
- **THEN** runtime MUST NOT 写入包含回答的 `CAPABILITY_RESULT`
- **AND** runtime MUST NOT 发布 `pendingInputAnswer` result projection

## MODIFIED Requirements

### Requirement: AskUserQuestion tool creates runtime-owned question pending input

The system SHALL expose `AskUserQuestion` as the built-in Tool entry whose canonical model/tool/capability id and display name are both `AskUserQuestion`. Calling that tool creates a runtime-owned `QUESTION` pending input request. The tool MUST NOT create a competing interaction state machine or wait for user response inside the tool handler. The model-facing descriptor MUST require one through three questions per call. When the model nevertheless returns four through twenty otherwise valid questions, Agent/core MUST accept that batch through the bounded compatibility path defined below; this fallback MUST NOT change or widen the model-facing descriptor. Runtime remains the owner of the final pending-input technical limit.

#### Scenario: Tool creates text question pending input

- **WHEN** the model calls `AskUserQuestion` with a valid text question
- **THEN** Agent/core MUST resolve the `AskUserQuestion` descriptor through the existing capability resolver/catalog path
- **AND** the system MUST apply only the deterministic model-output normalization defined by this change, then validate and safety-check the normalized question against the resolved descriptor schema and deterministic visible-text rules
- **AND** convert the accepted input to the existing `PendingInputIntent` contract with `kind="QUESTION"`
- **AND** create the pending input only through `AgentRunStatePort.requestPendingInput(run, context, intent)`
- **AND** immediately return `AgentExecutionOutcome{ status: "PENDING_INPUT" }` with only a safe pending input reference after the runtime-owned handoff accepts the pending input.

#### Scenario: Initial producer request bypasses ordinary capability invocation

- **WHEN** `AskUserQuestion` creates a pending input for the current tool call
- **THEN** Agent/core MUST handle the initial request in the AskUserQuestion producer branch before ordinary capability invocation
- **AND** the branch MUST be limited to the resolved descriptor with `kind="TOOL"`, `capabilityId="AskUserQuestion"`, `provider.providerId="builtin-tools"`, `provider.providerKind="BUNDLED"` and `availabilityStatus="AVAILABLE"` after normal descriptor resolution
- **AND** MUST NOT call `CapabilityInvocationPort.invoke(...)` to create the initial pending request
- **AND** MUST NOT introduce a generic pending producer registry, descriptor flag, metadata marker or capability-discovered pending route
- **AND** MUST NOT depend on `CapabilityDescriptor.metadata` for routing, authorization, replay safety or pending lifecycle decisions
- **AND** MUST NOT depend on display name, description, schema shape, string similarity or natural-language inference to decide routing
- **AND** MUST NOT import agent-capability implementation paths.
- **AND** if the same model tool batch contains multiple `AskUserQuestion` calls, Agent/core MUST process only the currently executing call and MUST NOT create pending inputs for later `AskUserQuestion` calls until resumed execution reaches them.

#### Scenario: Similar tool names or descriptors do not create pending input

- **WHEN** the model calls `question`, `AskUser`, `ask_user_question`, `askUserQuestion`, `askUser`, `ask_user`, `ask_user_questions`, a normal tool with a matching input schema, or a non-bundled descriptor with `capabilityId="AskUserQuestion"`
- **THEN** Agent/core MUST NOT enter the AskUserQuestion producer branch for that call
- **AND** MUST NOT create a pending input through the AskUserQuestion path.

#### Scenario: Descriptor unavailable does not create pending input

- **WHEN** the model calls `AskUserQuestion` but the resolved capability descriptor is missing, disabled or unavailable
- **THEN** Agent/core MUST return the existing safe capability-unavailable outcome
- **AND** MUST NOT create a pending input.

#### Scenario: Tool creates select question pending input

- **WHEN** the model calls `AskUserQuestion` with valid options and optional `multiple` or `custom` constraints
- **THEN** the accepted pending request MUST preserve those constraints for runtime answer validation
- **AND** the tool response MUST NOT include answer schema, answer values, identity, or idempotency material.

#### Scenario: Tool normalizes limited model-output drift

- **WHEN** the model calls `AskUserQuestion` with `questions` encoded as a bounded JSON string array, or with a question containing an underspecified `options` array with fewer than two options
- **THEN** Agent/core MAY normalize the input to the canonical question array and text-question shape before descriptor-schema validation
- **AND** the normalized input MUST still satisfy the resolved descriptor schema, visible text budgets, question count, and forbidden-purpose rules, except that the bounded compatibility path MUST relax only the top-level `questions.maxItems` from 3 to 20 while preserving every other resolved descriptor constraint
- **AND** the accepted pending request MUST NOT preserve the underspecified `options`, `multiple`, or text-question `custom=true` compatibility marker.

#### Scenario: Tool rejects invalid option question constraints

- **WHEN** the model calls `AskUserQuestion` with duplicate option `value` entries within one question, or with `multiple` or `custom=false` on a text question that has no options
- **THEN** the system MUST reject the request with a safe `INVALID_INPUT` validation outcome
- **AND** MUST NOT create a pending input.

#### Scenario: Tool accepts bounded model count drift without changing the model contract

- **WHEN** the model calls `AskUserQuestion` with 4 through 20 otherwise valid questions
- **THEN** Agent/core MUST accept the batch as one `QUESTION` pending input
- **AND** MUST preserve the original question order and constraints
- **AND** MUST NOT reject the batch solely because it contains more than 3 questions
- **AND** MUST validate it through a request-local view derived from the resolved descriptor that changes only `questions.maxItems`
- **AND** MUST NOT mutate the descriptor or expose the fallback count through model context or provider tool schema
- **AND** MUST NOT split the call into multiple pending inputs.

#### Scenario: Over-limit question batch is corrected before persistence

- **WHEN** normalized `questions` exceeds the internal compatibility ceiling of 20
- **THEN** Agent/core MUST detect the count violation before persisting the assistant tool-use batch
- **AND** MUST NOT create a pending input, publish `USER_INPUT_REQUIRED`, truncate questions or modify tool-call state
- **AND** MUST NOT execute any other tool call from the rejected batch
- **AND** MUST inject a model-visible request-local correction that states only the actual count, model-facing maximum of 3 and correction attempt, asks the model to consolidate or select at most three currently necessary questions, and asks it to reissue any other still-required tool call
- **AND** MUST publish a non-terminal `DEGRADATION_NOTICE` with safe code `ASK_USER_QUESTION_COUNT_EXCEEDED` and only low-cardinality count, maximum and attempt fields
- **AND** the correction, logs and safe error MUST NOT contain question text or other raw tool arguments
- **AND** the rejected assistant tool-use batch MUST NOT be persisted without a paired result.

#### Scenario: Corrected question batch continues the original run

- **GIVEN** a count-overflow correction has been provided to the model
- **WHEN** the model retries `AskUserQuestion` with at most 3 questions and the remaining validation succeeds
- **THEN** Agent/core MUST create exactly one pending input for the corrected call
- **AND** MUST preserve the original session, request and run
- **AND** MUST NOT expose the rejected question batch to the user.

#### Scenario: Repeated count overflow fails after the bounded correction budget

- **WHEN** the model continues to exceed the compatibility ceiling of 20 for `minimalToolLoopLimits.toolCallLimitRecoveryLimit` correction attempts
- **THEN** Agent/core MUST stop retrying and terminate with a safe `INVALID_INPUT`
- **AND** question-count attempts MUST use an independent consecutive counter and MUST NOT consume or reset tool-call-count or empty-tool-name recovery attempts
- **AND** MUST NOT persist any rejected assistant tool-use batch or create a partial pending input
- **AND** MUST NOT turn the count correction into an unbounded model loop.

#### Scenario: Count-compliant non-count validation failures are not retried by count recovery

- **WHEN** AskUserQuestion input is within the compatibility ceiling of 20 but violates option uniqueness, visible-text budgets, forbidden-purpose rules, descriptor availability or another non-count constraint
- **THEN** the existing safe failure mapping MUST remain in effect
- **AND** Agent/core MUST NOT label that failure as recoverable question-count overflow.

#### Scenario: Tool rejects empty or over-budget visible question text

- **WHEN** the model calls `AskUserQuestion` with an empty visible text field, a `prompt` longer than 500 characters, an option `value` longer than 500 characters, or an option `label` longer than 500 characters
- **THEN** the system MUST reject the request with a safe `INVALID_INPUT` validation outcome
- **AND** MUST NOT create a pending input.

#### Scenario: Tool descriptor exposes visible text and question-count budgets to the model

- **WHEN** context rendering exposes `AskUserQuestion` as a callable model tool
- **THEN** the rendered tool input schema MUST include concrete string length bounds for `questions[].prompt`, `questions[].options[].value`, and `questions[].options[].label` when the provider-facing tool schema supports JSON Schema-compatible string constraints
- **AND** the rendered schema MUST expose one through three questions as the accepted count and its description MUST clearly tell the model to ask no more than three currently necessary questions
- **AND** the rendered schema and description MUST NOT expose the internal 20-question compatibility ceiling as a normal callable allowance
- **AND** Agent/core MUST validate normalized returned tool arguments against the resolved descriptor schema or the count-only fallback view defined by this requirement before creating pending input
- **AND** provider inability to express those bounds MUST NOT relax Agent/core validation.

#### Scenario: Tool descriptor explains question kind shapes to the model

- **WHEN** context rendering exposes `AskUserQuestion` as a callable model tool
- **THEN** the model-facing tool schema and field descriptions MUST explain that a text question omits `options` and may redundantly carry `custom=true` as a compatibility no-op, a single-select question has `options` with `multiple` absent or false, a multi-select question has `options` with `multiple=true`, and a custom option question has `options` with `custom=true`
- **AND** context rendering and provider adapters MUST preserve supported schema item counts, string bounds and field descriptions from the resolved descriptor
- **AND** the tool input MUST NOT add `questionType`, `kind`, `header`, option `description`, annotations, answer schema, identity, idempotency, timeout behavior or producer coordinates
- **AND** Agent/core MUST still derive the accepted question kind from the validated argument shape before creating pending input.

#### Scenario: Tool descriptor preserves exact canonical name

- **WHEN** context rendering or a model provider adapter exposes the callable tool to the model
- **THEN** the callable tool name MUST remain exactly `AskUserQuestion`
- **AND** the adapter MUST NOT normalize the name to `AskUser`, `ask_user_question`, `askUserQuestion`, `askUser`, `ask_user`, or any provider-local alias
- **AND** if the provider cannot expose `AskUserQuestion` exactly, the adapter MUST fail safely and MUST NOT accept an aliased return tool call as AskUserQuestion.

#### Scenario: Producer failures map to safe reason codes

- **WHEN** `AskUserQuestion` cannot proceed
- **THEN** descriptor missing, disabled, unavailable, or non-bundled resolution MUST map to `CAPABILITY_UNAVAILABLE`
- **AND** schema, budget, option constraint, forbidden-purpose validation failure, or exhausted count correction MUST map to `INVALID_INPUT`
- **AND** pending boundary unavailable, checkpoint/pending acceptance failure, or active pending conflict MUST map to `PENDING_INPUT_UNAVAILABLE`
- **AND** abort or cancellation before pending acceptance completes MUST map to `ABORTED`
- **AND** unexpected producer failure MUST map to `EXECUTION_FAILED`.

#### Scenario: Pending question is not an immediate capability result

- **WHEN** `AskUserQuestion` creates a pending input successfully
- **THEN** Agent/core MUST stop the current dispatch through `AgentExecutionOutcome.status="PENDING_INPUT"`
- **AND** Agent/core MUST NOT append a model-visible `CAPABILITY_RESULT` for the `AskUserQuestion` tool call before the pending input is answered
- **AND** Agent/core MUST NOT continue to later tool calls in the same dispatch after the pending handoff succeeds
- **AND** runtime MUST NOT terminal-commit the run because `AskUserQuestion` returned a pending reference.

#### Scenario: Trusted coordinates are not supplied by tool input

- **WHEN** `AskUserQuestion` submits the pending input intent
- **THEN** accepted `RequestRun`, trusted `RequestContext`, owner scope, session id, request id and run id MUST come from the Agent/core runtime invocation path
- **AND** tool input MUST NOT supply or override identity, idempotency key, session id, request id, run id, timeout behavior or answer schema
- **AND** `multiple` and `custom` MAY appear only as accepted question constraints and MUST NOT be supplied by the client answer payload.

#### Scenario: Tool rejects forbidden prompt purpose

- **WHEN** the tool input asks the user for credentials, raw secrets, authorization grants, approval for protected operations, high-risk confirmation decisions, or human handoff/escalation
- **THEN** the tool MUST reject the request with a safe `INVALID_INPUT` validation outcome
- **AND** MUST NOT create a pending input
- **AND** AskUserQuestion MUST only create `QUESTION` pending input and MUST NOT create `CONFIRMATION`, `AUTHORIZATION` or `HUMAN_HANDOFF` pending input
- **AND** the tool MUST NOT forward, upgrade, transform, or reroute the rejected request to another pending input kind, hook, guard, policy path, or handoff producer
- **AND** forbidden-purpose validation MUST be deterministic and fixture-driven
- **AND** this change MUST NOT introduce a policy engine, risk classifier, semantic intent classifier, model moderation call or configurable moderation rule system
- **AND** ambiguous non-hard cases MUST be handled by model-facing guidance and schema bounds rather than new policy logic in this change.

#### Scenario: Survey and long-form guidance does not create a policy engine

- **WHEN** model-facing guidance describes appropriate `AskUserQuestion` usage
- **THEN** that guidance MUST discourage broad surveys or forms and recommend only currently necessary clarification
- **AND** that guidance MUST NOT introduce a policy engine, risk classifier, or survey/form classifier in this change
- **AND** the system MUST reject such input only when it also violates the descriptor schema/budgets or asks for a forbidden prompt purpose.

#### Scenario: Tool does not own resume state

- **WHEN** the user later answers the pending input
- **THEN** runtime-owned pending input flow MUST handle answer validation and resume
- **AND** runtime/core MUST materialize the accepted answer as exactly one safe `CAPABILITY_RESULT` for the original `AskUserQuestion` tool call identified by the durable runtime-owned `producerRef.toolCallId`
- **AND** when multiple `AskUserQuestion` tool calls exist in the same current tool batch, each pending input MUST materialize only the tool call identified by its own `producerRef.toolCallId`; later calls are handled only after resumed execution reaches them
- **AND** runtime/core MUST NOT re-invoke `AskUserQuestion` while resuming
- **AND** the tool handler MUST NOT own terminal state, timeout handling, answer validation or request lifecycle.

#### Scenario: No new capability pending facade

- **WHEN** `AskUserQuestion` integrates with pending input
- **THEN** this change MUST NOT introduce `CapabilityInvocationRuntimeContext.requestPendingInput(...)`
- **AND** this change MUST NOT introduce a generic pending producer registry, public create-pending command, generic policy port, a new `RunStatus`, a new lifecycle stage, a new checkpoint trigger or pending record producer/tool-call fields beyond the runtime-owned minimal `producerRef` defined by the contract/core pending changes.
