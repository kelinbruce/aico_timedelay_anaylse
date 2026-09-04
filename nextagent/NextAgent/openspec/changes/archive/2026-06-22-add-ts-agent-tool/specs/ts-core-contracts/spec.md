## MODIFIED Requirements

### Requirement: Runtime Command And RequestRun Baseline

TS runtime MUST 是 request lifecycle 的唯一 owner。核心契约 MUST 定义 runtime command、RequestRun、RunStatus、latest-request 合法性、terminal result、terminal commit、run version、claim/fencing、CAS result 和 terminal commit result 的最小形态。Channel、session、core、context、model、capability 和 gateway MUST NOT 创建竞争性的 request lifecycle state machine。

`SubmitRequestCommand` SHALL accept optional `sessionId?: SessionId` (was required, now optional). When `sessionId` is absent, `submit()` MUST create a new session using `agentId` from the command. When `sessionId` is present, `submit()` MUST validate session availability and user access, and the run's `agentId` MUST be `session.agentId` (session-bound Agent Scope). If `command.agentId` is present and differs from `session.agentId`, `submit()` MUST reject. This makes `submit()` the single control point for agent scheduling — it decides which agent to invoke and whether to use an existing session or create a new one.

`SubmitRequestCommand` SHALL accept optional `agentId?: AgentId`, `agentVersion?: AgentVersion`, `parentSessionId?: SessionId`, `parentRunId?: RequestRunId`, `parentRequestId?: MessageId`, and `priority?: RequestPriority`. When `sessionId` is present, the run MUST use `session.agentId` (session-bound Agent Scope); `command.agentId` MUST NOT override `session.agentId` — if `command.agentId` is present and differs from `session.agentId`, `submit()` MUST reject. `command.agentVersion` MAY be used to pin a specific assembly version (`require(session.agentId, agentVersion)`). When `sessionId` is absent, `agentId` is required and `submit()` creates a new session. `parentSessionId`/`parentRunId`/`parentRequestId` are used when `submit()` creates a child session for subagent invocation. `priority` defaults to `"NORMAL"` and is persisted to `RequestRun.priority`.

`CapabilityInvocationRequest` SHALL accept optional `locale?: RequestLocale` to propagate request locale to tool execution context. `tool-loop.ts` MUST pass `context.locale` into the `CapabilityInvocationRequest`. `BuiltinToolsExecutor` MUST pass `request.locale` into `ToolExecutionContext.locale`. This enables tools (such as the Agent tool) to access the request locale without direct `RequestContext` access.

`RequestRun` SHALL support optional `parentRunId?: RequestRunId`, `parentRequestId?: MessageId`, and `priority?: RequestPriority` for subagent invocation traceability and scheduling. These fields MUST be optional and MUST NOT affect existing run lifecycle, status transitions, or terminal commit semantics. This follows the same optional-relationship-field pattern as `retryOfRunId?: RequestRunId`.

#### Scenario: RequestRun 状态由 runtime 推进
- **WHEN** runtime accepts a submit, retry-latest, or edit-latest command
- **THEN** runtime MUST create or advance a `RequestRun` with stable `runId`, `sessionId`, `requestId`, `agentId`, `agentVersion`, `agentAssemblyRef`, `attempt`, `status`, `version`, `terminalCommitState`, `createdAt`, and `updatedAt`
- **AND** runtime MUST 推进 RequestRun status
- **AND** optional `retryOfRunId`, `parentRunId`, `parentRequestId`, and `priority` fields MUST NOT alter the status transition state machine.

#### Scenario: Submit with existing session uses session agentId
- **WHEN** `submit()` is called with `sessionId` and without `agentId`
- **THEN** the run MUST use `session.agentId`
- **AND** `submit()` MUST validate session availability and user access.

#### Scenario: Submit with existing session and explicit agentId override
- **WHEN** `submit()` is called with both `sessionId` and `agentId`, and `command.agentId` differs from `session.agentId`
- **THEN** `submit()` MUST reject the command (session-bound Agent Scope violation)
- **AND** the run MUST NOT be created.
- **WHEN** `command.agentId` matches `session.agentId` or is absent
- **THEN** the run MUST use `session.agentId`.

#### Scenario: Submit without sessionId creates new session
- **WHEN** `submit()` is called without `sessionId` but with `agentId`
- **THEN** `submit()` MUST create a new session with `command.agentId`
- **AND** it MUST create a run in the new session
- **AND** `agentId` MUST be required when `sessionId` is absent.

#### Scenario: Submit with parent linkage creates child session
- **WHEN** `submit()` is called with `agentId` and `parentSessionId` but without `sessionId`
- **THEN** `submit()` MUST create a child session with `parentSessionId`/`parentRunId`/`parentRequestId` linkage
- **AND** the child session's `agentId` MUST be `command.agentId`
- **AND** the child run MUST carry `parentRunId` and `parentRequestId`.

#### Scenario: Submit with priority persists to RequestRun
- **WHEN** `submit()` is called with `priority`
- **THEN** the created `RequestRun` MUST have `priority` persisted
- **AND** when `priority` is omitted, the run MUST default to `"NORMAL"`.

#### Scenario: Submit with agentVersion pins assembly version
- **WHEN** `submit()` is called with `agentId` and `agentVersion`
- **THEN** `submit()` MUST use `assemblyRegistry.require(agentId, agentVersion)` to resolve the assembly
- **AND** when `agentVersion` is omitted, `submit()` MUST use `assemblyRegistry.active(agentId)` (backward compatible).

#### Scenario: CapabilityInvocationRequest propagates locale to tool context
- **WHEN** `tool-loop.ts` constructs a `CapabilityInvocationRequest`
- **THEN** it MUST include `locale` from `RequestContext.locale`
- **AND** `BuiltinToolsExecutor` MUST pass `request.locale` into `ToolExecutionContext.locale`
- **AND** tools MAY read `context.locale` for locale-aware behavior (e.g., subagent invocation).

#### Scenario: submit() auto-injects no-nesting constraints for child runs
- **WHEN** `submit()` is called with `parentRunId` present (child run)
- **THEN** `submit()` MUST automatically inject `forbiddenCapabilityIds: ["Agent"]` into the routing constraints
- **AND** it MUST automatically set `allowSubagents: false` in the routing constraints
- **AND** these constraints MUST NOT be overridable by the caller
- **AND** the child run's capability catalog MUST NOT contain the Agent tool.

#### Scenario: No-nesting constraints merge with caller-provided routing constraints
- **WHEN** `submit()` is called with `parentRunId` present and caller-provided `routingConstraints.forbiddenCapabilityIds`
- **THEN** the framework-injected `"Agent"` MUST be union-merged with caller-provided IDs (result: `["Agent", ...callerProvided]`)
- **AND** the caller MUST NOT be able to remove `"Agent"` from the merged list
- **AND** framework-injected `allowSubagents: false` MUST override any caller-provided `allowSubagents: true`
- **AND** other caller-provided `routingConstraints` fields (`targetSkill`/`executionMode`/`maxToolCalls` etc.) MUST remain unaffected.

#### Scenario: Subagent run carries parent linkage
- **WHEN** a child run is created for a subagent invocation
- **THEN** the child `RequestRun` MUST carry `parentRunId` and `parentRequestId` linking to the parent run and request
- **AND** these fields MUST be optional on the `RequestRun` contract
- **AND** existing runs without parent linkage MUST remain valid.

#### Scenario: Parent run lifecycle is independent of child run linkage
- **WHEN** a parent run has child runs linked via `parentRunId`
- **THEN** the parent run's status transitions, terminal commit, and lifecycle MUST NOT be blocked or altered by the presence of child runs
- **AND** child run lifecycle MUST be owned independently by the runtime.

## ADDED Requirements

### Requirement: RequestPriority for scheduling differentiation

The system SHALL define `RequestPriority = "HIGH" | "NORMAL" | "LOW"` in `agent-common`. `NORMAL` is the default for top-level user requests. `LOW` is used for subagent requests to ensure they do not starve top-level requests. The runtime scheduler SHALL be a separate async component: `submit()` only enqueues work and wakes the scheduler; the scheduler independently dispatches work from queues by priority when concurrency slots are available. The scheduler SHALL enforce a global concurrent execution limit (`maxConcurrent`) and dispatch higher-priority runs before lower-priority runs across all session lanes. Priority scheduling MUST be separate from session lane scheduling — within a lane, runs are still serialized (one at a time); priority affects which lane's work is dispatched next when a global concurrency slot is free. The scheduler MUST reserve work, lane ownership, and a global execution slot synchronously before fire-and-forget dispatch. The scheduler MUST maintain a global execution gate: when `executingRuns.size + inflightCount >= maxConcurrent`, new work remains queued; when a run completes, the scheduler is woken and dispatches the highest-priority queued work across all lanes.

The scheduler MUST NOT release `inflightCount` until the reserved work either atomically transfers into `executingRuns` or is skipped/terminally cleaned up before execution. Shutdown/close MUST wait for scheduler idle, including no pending work, no reserved lanes, no executing runs, no inflight reservations, and no running scheduler loop.

#### Scenario: Priority affects cross-lane dispatch order
- **WHEN** multiple lanes have queued work and a global concurrency slot becomes available
- **THEN** the scheduler MUST dispatch `HIGH` priority work first, then `NORMAL`, then `LOW`
- **AND** within the same priority level, dispatch order MAY follow lane queue order (FIFO).

#### Scenario: Global concurrency limit enforced
- **WHEN** `executingRuns.size + inflightCount` reaches `maxConcurrent`
- **THEN** the scheduler MUST NOT dispatch new work, even if lanes have queued items
- **AND** when a run completes (frees a slot), the scheduler MUST be woken and dispatch the highest-priority queued work across all lanes.

#### Scenario: Reservation prevents over-dispatch
- **WHEN** multiple `wakeScheduler()` calls happen before a reserved work has entered `executingRuns`
- **THEN** the reserved work MUST still count against `maxConcurrent`
- **AND** the same lane MUST NOT be selected for another dispatch while its first work is reserved or executing.

#### Scenario: submit() only enqueues, scheduler dispatches
- **WHEN** `submit()` is called
- **THEN** it MUST enqueue work to the lane queue and wake the scheduler
- **AND** it MUST NOT directly dispatch or execute the work
- **AND** the scheduler independently decides when to dispatch based on capacity and priority.

#### Scenario: close waits for scheduler idle
- **WHEN** runtime close waits for queued work to drain
- **THEN** close MUST consider the scheduler idle only when pending work, reserved lanes, executing runs, inflight reservations, and the running scheduler loop are all empty/inactive.

#### Scenario: Priority does not affect intra-lane serialization
- **WHEN** a lane has an executing run
- **THEN** queued work in the same lane MUST NOT be dispatched regardless of priority
- **AND** priority only affects which lane's work is dispatched next when a slot is free.

### Requirement: Session parent linkage for subagent invocation traceability

`SessionRecord` (gateway subpath) and `UserSession` (session subpath) SHALL support optional parent linkage fields `parentSessionId?: SessionId`, `parentRunId?: RequestRunId`, and `parentRequestId?: MessageId` for subagent invocation traceability. These fields MUST be optional and MUST NOT affect existing session creation, listing, or owner scope validation. When present, they link a child session to the parent session, run, and request that triggered the subagent invocation.

#### Scenario: Child session carries parent linkage
- **WHEN** a child session is created by `submit()` for a subagent invocation
- **THEN** `SessionRecord` and `UserSession` MUST carry `parentSessionId`, `parentRunId`, and `parentRequestId`
- **AND** these fields MUST be optional on both contracts
- **AND** existing sessions without parent linkage MUST remain valid.

#### Scenario: Session owner scope is independent of parent linkage
- **WHEN** a child session is created with parent linkage
- **THEN** the child session's `agentId` MUST be the target subagent's `agentId`, not the parent's
- **AND** the child session's `tenantId` and `subjectId` MUST be inherited from the parent's `identityContext`
- **AND** owner scope validation MUST use the child session's own `agentId` and `identityContext`, not the parent's.

#### Scenario: Session listing does not require parent linkage
- **WHEN** sessions are listed via `ListUserSessionsQuery` or `SessionHistoryRecordQuery`
- **THEN** parent linkage fields MUST NOT be required for listing
- **AND** sessions with and without parent linkage MUST be listable using the same query shape.

### Requirement: Orphan child session handling on submit failure

When `submit()` creates a child session internally (no `sessionId` in command) and a subsequent step (run save, checkpoint, message persist) fails, the child session MAY remain in the store as an orphan with no runs. This is harmless: orphan sessions have no runs, consume no concurrency slots, and do not affect functional correctness. `submit()` MUST log a diagnostic with the orphan session ID, parent run ID, and failure reason. `SessionStoreGateway` does not need a `deleteSession` method for this change. Background cleanup of orphan sessions is deferred to a future change.

#### Scenario: submit failure leaves orphan child session
- **WHEN** `submit()` creates a child session and then fails on a subsequent step
- **THEN** the child session MAY remain in the store with no runs
- **AND** `submit()` MUST log a diagnostic with the orphan session ID and failure reason
- **AND** the orphan session MUST NOT consume concurrency slots or affect other runs
- **AND** `SubagentExecutionPort` receives the error and returns `EXECUTION_FAILED` without needing to clean up the session.
