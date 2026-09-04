## 1. Contracts — SubagentExecutionPort + RequestPriority

- [x] 1.1 Define `SubagentExecutionRequest` in `agent-contracts/capability`: `targetAgentId`, `targetAgentVersion?` (from descriptor), `targetProviderKind` (from descriptor.provider.providerKind), `prompt`, `parentSessionId`, `parentRunId`, `parentRequestId`, `parentToolCallId`, `identityContext`, `locale`, `idempotencyKey`. No `timeoutMs` (port resolves from assembly) and no `targetAgentAssemblyRef` (unused).
- [x] 1.2 Define `SubagentExecutionResult` in `agent-contracts/capability`: `status` (`"COMPLETED" | "FAILED" | "TIMED_OUT" | "CANCELED"`), `terminalText` (max `100_000` UTF-8 bytes), `childSessionId?`, `childRunId?`, `safeError?`.
- [x] 1.3 Define `SubagentExecutionPort` interface in `agent-contracts/capability`: `executeSubagent(request, signal): Promise<SubagentExecutionResult>`.
- [x] 1.4 Define `RequestPriority = "HIGH" | "NORMAL" | "LOW"` in `agent-common`.
- [x] 1.5 Export new types from respective index files and keep shared UTF-8 truncation in `agent-common`.

## 2. Contracts — SubmitRequestCommand, SessionRecord, UserSession, RequestRun changes

- [x] 2.1 Modify `SubmitRequestCommand` in `agent-contracts/runtime`: `sessionId` from required to optional; add optional `agentId?`, `agentVersion?`, `parentSessionId?`, `parentRunId?`, `parentRequestId?`, `priority?`.
- [x] 2.2 Add optional `parentRunId?: RequestRunId`, `parentRequestId?: MessageId`, `priority?: RequestPriority` to `RequestRun` in `agent-contracts/runtime`.
- [x] 2.3 Add optional `parentSessionId?: SessionId`, `parentRunId?: RequestRunId`, `parentRequestId?: MessageId` to `SessionRecord` in `agent-contracts/gateway`.
- [x] 2.4 Add optional `parentSessionId?: SessionId`, `parentRunId?: RequestRunId`, `parentRequestId?: MessageId` to `UserSession` in `agent-contracts/session`.
- [x] 2.5 Verify existing submit/session/run creation paths are unaffected by optional fields (no breaking change; existing callers still pass `sessionId`).

## 3. Runtime — submit() modifications + scheduler architecture

- [x] 3.1 Update `submit()`: when `sessionId` is absent, create new session using `command.agentId` (required); when `parentSessionId` is present, create child session with parent linkage.
- [x] 3.2 Update `submit()`: when `sessionId` present, run MUST use `session.agentId` (session-bound Agent Scope). If `command.agentId` present and differs from `session.agentId`, reject. `command.agentVersion` may pin version via `require(session.agentId, agentVersion)`. When `sessionId` absent, use `command.agentId` and `assemblyRegistry.require(agentId, agentVersion)` when version present, else `active(agentId)`.
- [x] 3.3 Update `submit()`: persist `command.priority` (default `"NORMAL"`) to `RequestRun.priority`.
- [x] 3.4 Update `submit()`: persist `parentSessionId`/`parentRunId`/`parentRequestId` to child `SessionRecord` and `parentRunId`/`parentRequestId` to child `RequestRun`.
- [x] 3.5 Update `submit()`: when `parentRunId` is present (child run), auto-inject `forbiddenCapabilityIds: ["Agent"]` (union-merge with caller-provided IDs; `"Agent"`不可移除) and `allowSubagents: false` (overrides caller-provided `true`) into routing constraints. Other caller-provided `routingConstraints` fields remain unaffected.
- [x] 3.6 Update `submit()`: orphan session handling — when `submit()` fails after creating child session (no `sessionId`), log diagnostic with orphan sessionId, parentRunId, and failure reason. Do NOT modify SessionRecord fields (no title pollution). Orphan sessions are harmless (no runs, no concurrency impact). `SessionStoreGateway` has no `deleteSession`. Background cleanup deferred. For calls with `sessionId` (external session), no action needed.
- [x] 3.7 Add `maxConcurrent?: number` to `scheduler` config in runtime dependencies.
- [x] 3.8 Implement `wakeScheduler()`: if `schedulerRunning` is true, return; else set `schedulerRunning = true` and `void runSchedulerLoop()`.
- [x] 3.9 Implement `reserveNextWork()`: synchronously scan all lane queues, skip `drainingLanes`, pick highest priority (`HIGH > NORMAL > LOW`, same priority FIFO), `queue.shift()`, `drainingLanes.add(laneKey)`, and `inflightCount++`. This synchronous reservation is the only place that selects work for fire-and-forget dispatch.
- [x] 3.10 Implement `runSchedulerLoop()`: while `(executingRuns.size + inflightCount) < maxConcurrent`, call `reserveNextWork()`; if none found, break; `void dispatchReservedWork(reservation)`. Set `schedulerRunning = false` when the loop exits; if dispatchable work and capacity remain after clearing the flag, call `wakeScheduler()` to cover the loop-end wake window.
- [x] 3.11 Implement `dispatchReservedWork(reservation)`: replace `drainLane`. It MUST only consume already reserved work. Run supersession/terminal snapshot checks; if work is skipped before execution, release `inflightCount` and `drainingLanes` and call `wakeScheduler()`. If work starts execution, atomically transfer the reservation by decrementing `inflightCount` in the same synchronous section that registers `executingRuns.set(runId, state)`.
- [x] 3.12 Update `enqueueWork()`: replace `void this.drainLane(work.laneKey)` with `this.wakeScheduler()`.
- [x] 3.13 Update `executeQueuedWork()` finally: replace `void this.drainLane(work.laneKey)` with `executingRuns.delete(runId)`, `drainingLanes.delete(laneKey)`, and `wakeScheduler()` so the next highest-priority queued work can run.
- [x] 3.14 Delete `drainLane()` method (replaced by `reserveNextWork` + `dispatchReservedWork` + `runSchedulerLoop`).
- [x] 3.15 Replace `drainAllLanes()` and recovery-gate direct drain calls with scheduler wake/drain semantics; no caller may bypass `wakeScheduler()` to dispatch lane work.
- [x] 3.16 Update `close()`: idle condition MUST include `pendingWorkCount() === 0`, `drainingLanes.size === 0`, `executingRuns.size === 0`, `inflightCount === 0`, and `schedulerRunning === false`; close may repeatedly call `wakeScheduler()` while waiting.
- [x] 3.17 Recovery: on startup, scan QUEUED runs from store, `enqueueWork({ startDispatch: false })`, then release the recovery gate and call `wakeScheduler()`; scheduler picks up naturally.
- [x] 3.18 Verify `maxPendingQueueDepth` still limits global pending depth; `maxConcurrent` limits global executing + inflight count.

## 4. Contracts — Agent tool descriptor

- [x] 4.1 Define `Agent` tool descriptor with input schema `{ agentId: string, prompt: string }` (`additionalProperties: false`) and output schema `{ agentId: string, status: "completed", result: { text: string } }`.
- [x] 4.2 Register `Agent` tool as `kind="TOOL"` builtin Tool descriptor, separate from `AGENT` capability kind.
- [x] 4.3 Define `prompt` max `8192` UTF-8 bytes and `result.text` max `100_000` UTF-8 bytes.
- [x] 4.4 Define safe failed reason codes: `INVALID_INPUT`, `AGENT_NOT_AVAILABLE`, `SELF_INVOCATION_REJECTED`, `TIMEOUT`, `ABORTED`, `EXECUTION_FAILED`.

## 5. Tool dependencies bridge

- [x] 5.1 Add `"subagentExecution"` to `ToolDependencyName` in `agent-capability/src/tools/tool-spi.ts`.
- [x] 5.2 Add `subagentExecution?: SubagentExecutionPort` to `ToolDependencies`.
- [x] 5.3 Add `toolCallId: string` and `locale?: RequestLocale` to `ToolExecutionContext` in `agent-capability/src/tools/tool-spi.ts` (`toolCallId` for parentToolCallId traceability; `locale` for SubagentExecutionRequest).
- [x] 5.4 Update `BuiltinToolsExecutor.invoke()` in `agent-capability/src/execution/executor.ts` to pass `request.toolCallId` and `request.locale` into `ToolExecutionContext`.
- [x] 5.5 Add optional `locale?: RequestLocale` to `CapabilityInvocationRequest` in `agent-contracts/capability`; update `tool-loop.ts` to pass `context.locale` into the request.

## 6. Agent tool executor adapter — input validation

- [x] 6.1 Validate input schema with `additionalProperties: false`; reject unknown fields with `INVALID_INPUT`.
- [x] 6.2 Reject `prompt` over `8192` UTF-8 bytes with `INVALID_INPUT`; do not resolve target.
- [x] 6.3 Reject self-invocation (`agentId === context.agentId`) with `SELF_INVOCATION_REJECTED`; do not resolve target.

## 7. Agent tool executor adapter — target resolution

- [x] 7.1 Resolve target only via `RuntimeCapabilityResolver.resolveCapability({ kind: "AGENT", capabilityId: agentId })`; do not read raw `agent.yaml` or scan `subagents/`.
- [x] 7.2 Verify descriptor: `kind === "AGENT"`, `availabilityStatus === "AVAILABLE"`, `modelInvocable === true`; reject with `AGENT_NOT_AVAILABLE` on mismatch. Resolver returning `undefined` (not bound, not default-visible, or disabled) also returns `AGENT_NOT_AVAILABLE` — no separate binding check needed.
- [x] 7.3 Ignore client/model supplied scope fields; trusted scope comes from `ToolExecutionContext` only.

## 8. Agent tool executor adapter — invocation and result

- [x] 8.1 Extract `version` (→ `targetAgentVersion`) and `provider.providerKind` (→ `targetProviderKind`) from descriptor. Tool does NOT resolve assembly — port handles assembly resolution.
- [x] 8.2 Call `deps.subagentExecution.executeSubagent({ targetAgentId: agentId, targetAgentVersion: descriptor.version, targetProviderKind: descriptor.provider.providerKind, prompt, parentSessionId: context.sessionId, parentRunId: context.runId, parentRequestId: context.requestId, parentToolCallId: context.toolCallId, identityContext: context.identityContext, locale: context.locale, idempotencyKey: deriveSubagentIdempotencyKey(context.runId, context.toolCallId) }, signal)`. No `timeoutMs` in request — port resolves from target assembly.
- [x] 8.3 Map `SubagentExecutionResult` to tool output: `COMPLETED` → `{ agentId, status: "completed", result: { text: terminalText } }`; `TIMED_OUT` → `TIMEOUT`; `CANCELED` → `ABORTED`; `FAILED` → `EXECUTION_FAILED`.
- [x] 8.4 Truncate `terminalText` to `100_000` UTF-8 bytes safely if exceeded via the shared `agent-common.truncateUtf8` helper.
- [x] 8.5 Do not expose raw prompt, provider error, or internal child run state in tool output.

## 9. SubagentExecutionPort — runtime implementation (thin orchestration over submit())

- [x] 9.1 Dispatch based on `request.targetProviderKind`: `BUNDLED`/`LOCAL_DIRECTORY` → local path (below); `AGENT_REGISTRY` → return `EXECUTION_FAILED` with safe error "Remote agent execution is not yet supported."
- [x] 9.2 Resolve target assembly: `assemblyRegistry.require(targetAgentId, targetAgentVersion)` when version present; `assemblyRegistry.active(targetAgentId)` when absent. Extract `timeoutMs` from `assembly.runtimeSettings.requestTimeoutMs` (fallback 120_000ms).
- [x] 9.3 Call `RuntimeCommandPort.submit({ agentId: targetAgentId, agentVersion: assembly.agentVersion, identityContext, inputText: prompt, attachmentIds: [], locale: request.locale, parentSessionId, parentRunId, parentRequestId, priority: "LOW", idempotencyKey: request.idempotencyKey })`. No `sessionId` — `submit()` creates child session internally. Do NOT set `forbiddenCapabilityIds` or `allowSubagents` — `submit()` auto-injects when `parentRunId` present.
- [x] 9.4 Synchronously wait for child run terminal state via `RuntimeEventStreamPort.streamEvents` (listen for `REQUEST_COMPLETED`/`REQUEST_FAILED`/`REQUEST_CANCELED`), respecting `timeoutMs` (from step 9.2) and `AbortSignal`.
- [x] 9.5 On `AbortSignal` or timeout: cancel child run via `RequestControlCommand` with `action="CANCEL"`; wait for `REQUEST_CANCELED` confirmation; return `CANCELED`/`TIMED_OUT`.
- [x] 9.6 Extract safe `terminalText` from child run via `RuntimeSessionPort.listMessages`: take last `role="ASSISTANT"` message's `content`; if no assistant message, `terminalText` is empty string. Cap at `100_000` UTF-8 bytes.
- [x] 9.7 Return `SubagentExecutionResult` with `status`, `terminalText`, `childSessionId`, `childRunId`, and `safeError` on failure, including child ids when failure happens after child submit acceptance.
- [x] 9.8 Error recovery: if `streamEvents` breaks mid-stream, call `RuntimeSessionPort.getActiveRun({ sessionId: childSessionId })` to check child run status. If the active run is absent, first call `RuntimeSessionPort.listMessages` to recover terminal text because the run may already be terminal; distinguish missing messages from an empty message page. If still executing, retry `streamEvents` from last seen sequence.
- [x] 9.9 Error recovery: if `listMessages` fails, return `EXECUTION_FAILED` with safe error but still include `childSessionId`/`childRunId` for traceability.

## 10. Composition wiring

- [x] 10.1 Register `Agent` tool in `builtinToolDefinitions` (`agent-capability/src/builtins/index.ts`).
- [x] 10.2 Wire `SubagentExecutionPort` implementation into `ToolDependencies.subagentExecution` in `agent-app` composition. Port implementation (in `agent-runtime`) has access to `RuntimeCommandPort`/`RuntimeEventStreamPort`/`RuntimeSessionPort`/`AgentAssemblyRegistry` via runtime dependencies; tool context does NOT need `AgentAssemblyRegistry` access (assembly resolution is port's responsibility).

## 11. Gateway — persistence

- [x] 11.1 Update `SessionRecord` row mapping in `agent-platform-gateway-local` to persist optional `parentSessionId`/`parentRunId`/`parentRequestId`.
- [x] 11.2 Update `RequestRun` row mapping to persist optional `parentRunId`/`parentRequestId`/`priority`.
- [x] 11.3 Verify existing session/run queries (list, history) are unaffected by optional fields.

## 12. Validation — unit and contract tests

- [x] 12.1 Input validation: `additionalProperties: false` rejects unknown scope fields.
- [x] 12.2 Prompt budget boundary: exactly `8192` bytes accepted, `8193` rejected.
- [x] 12.3 Self-invocation rejection: `agentId === context.agentId` returns `SELF_INVOCATION_REJECTED`.
- [x] 12.4 Target unavailable: descriptor `availabilityStatus !== "AVAILABLE"` returns `AGENT_NOT_AVAILABLE`.
- [x] 12.5 Target not model-invocable: descriptor `modelInvocable !== true` returns `AGENT_NOT_AVAILABLE`.
- [x] 12.6 Resolver returns undefined (not bound/not visible/disabled) returns `AGENT_NOT_AVAILABLE`; no separate binding check.
- [x] 12.7 Completed output shape: success returns `{ agentId, status: "completed", result: { text } }` matching output schema.
- [x] 12.8 `result.text` safety: no raw prompt, credentials, provider-private metadata, paths, or high-cardinality fields.
- [x] 12.9 `SubagentExecutionPort` contract: request/result shape matches `agent-contracts/capability` definition.
- [x] 12.10 `SubmitRequestCommand` contract: `sessionId` optional, `agentId`/`parentSessionId`/`parentRunId`/`parentRequestId`/`priority` optional fields present.
- [x] 12.11 `RequestRun` contract: `parentRunId`/`parentRequestId`/`priority` optional fields present.
- [x] 12.12 `RequestPriority` enum: `"HIGH" | "NORMAL" | "LOW"` values defined.
- [x] 12.13 `submit()` without `sessionId` creates new session with `agentId`.
- [x] 12.14 `submit()` with `sessionId` and without `agentId` uses `session.agentId` (backward compatible).
- [x] 12.15 `submit()` with `sessionId` and mismatched `agentId` rejects (session-bound Agent Scope violation).
- [x] 12.16 `submit()` with `sessionId` and matching `agentId` uses `session.agentId`.
- [x] 12.17 `submit()` with `parentSessionId` creates child session with parent linkage.
- [x] 12.18 `submit()` with `priority` persists to `RequestRun.priority`; default `"NORMAL"`.
- [x] 12.19 Remote `providerKind` returns `EXECUTION_FAILED` with safe error.
- [x] 12.20 No-nesting: `submit()` with `parentRunId` auto-injects `forbiddenCapabilityIds: ["Agent"]` and `allowSubagents: false`.
- [x] 12.21 No-nesting: `SubagentExecutionPort` does NOT set `forbiddenCapabilityIds` or `allowSubagents` (framework auto-injects).
- [x] 12.22 No-nesting: child run capability catalog does not contain Agent tool.
- [x] 12.23 No-nesting: same agent as top-level has Agent tool available; as subagent has Agent tool denied.
- [x] 12.24 Orphan session: `submit()` failure after child session creation logs diagnostic; orphan has no runs, no concurrency impact.

## 13. Validation — integration tests

- [x] 13.1 Capability resolver is called with `kind="AGENT"` and requested `agentId`.
- [x] 13.2 `SubagentExecutionPort` calls `submit()` with `agentId`, `parentSessionId`, `parentRunId`, `parentRequestId`, `priority: "LOW"`, and no `sessionId`.
- [x] 13.3 `submit()` creates child session with target `agentId` and parent linkage.
- [x] 13.4 `submit()` creates child run with target scope, `parentRunId`/`parentRequestId`, and `priority: "LOW"`.
- [x] 13.5 Child run context is fresh (child session has no parent history/timeline/attachments).
- [x] 13.6 Port synchronously waits for terminal event via `RuntimeEventStreamPort.streamEvents`.
- [x] 13.7 `terminalText` extracted from child run terminal message via `RuntimeSessionPort.listMessages`, including recovery when terminal stream state is unavailable.
- [x] 13.8 Timeout and `AbortSignal` trigger `RequestControlCommand(CANCEL)` on child run; return `TIMEOUT` or `ABORTED`.
- [x] 13.9 Child run timeline persisted by `submit()` via existing `AgentRunStatePort`; no new timeline event kinds.
- [x] 13.10 Parent linkage persisted in `SessionRecord` and `RequestRun`.
- [x] 13.11 Priority scheduling: `NORMAL` priority run dispatched before `LOW` priority run when global concurrency is at capacity and a slot frees.
- [x] 13.12 Global concurrency limit: `executingRuns.size + inflightCount` does not exceed `maxConcurrent`; excess work stays queued.
- [x] 13.13 Subagent capability catalog does not contain Agent tool (auto-injected by `submit()`, not by `SubagentExecutionPort`).
- [x] 13.14 Same agent as top-level has Agent tool available; same agent as subagent has Agent tool denied.
- [x] 13.15 Orphan session handling: `submit()` failure after child session creation logs diagnostic; orphan session has no runs and no concurrency impact.
- [x] 13.16 Port error recovery: `streamEvents` break triggers `getActiveRun` status check; inactive child run triggers terminal message recovery with separate empty/not-found outcomes; non-terminal triggers `streamEvents` retry.
- [x] 13.17 Lane serialization maintained: one work per lane executing at a time, even with global dispatch.
- [x] 13.18 `submit()` only enqueues and wakes scheduler; does not directly dispatch.
- [x] 13.19 Scheduler wake on run completion: `executeQueuedWork` finally calls `wakeScheduler()`, next highest-priority work dispatched.
- [x] 13.20 Rapid repeated `wakeScheduler()` calls before reserved work enters `executingRuns` do not dispatch more than `maxConcurrent` work.
- [x] 13.21 Same-lane double-dispatch negative case: while a lane has reserved or executing work, another queued work in the same lane remains queued even if it has higher priority.
- [x] 13.22 Reservation transfer: `inflightCount` is released only when the run is registered in `executingRuns` or skipped before execution; skipped/terminal queued work releases reservation and wakes scheduler.
- [x] 13.23 `close()` waits for scheduler idle, including `inflightCount` and `schedulerRunning`, before returning.
- [x] 13.24 Recovery gate release wakes the scheduler once queued work has been rebuilt; no per-lane direct drain is used.

## 14. Validation — architecture tests

- [x] 14.1 Agent tool source does not import from `agent-runtime` session/run lifecycle, timeline store, or terminal commit modules.
- [x] 14.2 Agent tool does not create `Session`, `RequestRun`, call `submit()`, or call `Agent.execute` directly.
- [x] 14.3 Agent tool does not define new audit event kinds or timeline event kinds.
- [x] 14.4 Agent tool does not read raw `agent.yaml` or scan `subagents/` directories.
- [x] 14.5 `SubagentExecutionPort` implementation is in `agent-runtime`, not `agent-capability` or `agent-core`.
- [x] 14.6 `SubagentExecutionPort` does not directly call `AgentInstanceManager.getOrCreate` or `Agent.execute()`; it reuses `submit()`.
- [x] 14.7 `SubagentExecutionPort` does not call `RuntimeSessionPort.createSession` directly; `submit()` creates the session.
- [x] 14.8 Parent linkage and priority fields are optional on all modified contracts; existing contracts without them remain valid.
- [x] 14.9 `submit()` auto-injects no-nesting constraints when `parentRunId` present; constraints are non-overridable.
- [x] 14.10 `SubagentExecutionPort` does not set `forbiddenCapabilityIds` or `allowSubagents` (framework auto-injects).
- [x] 14.11 `runSchedulerLoop` reads `priority` from `RequestRun` and dispatches `HIGH`/`NORMAL` before `LOW` across lanes.
- [x] 14.12 `executingRuns.size + inflightCount` respects `maxConcurrent` limit; excess work remains queued.
- [x] 14.13 `submit()` does not directly call dispatch; it only enqueues and calls `wakeScheduler()`.
- [x] 14.14 `drainLane` method is deleted; replaced by `reserveNextWork` + `dispatchReservedWork` + `runSchedulerLoop`.
- [x] 14.15 No production path calls a per-lane direct drain helper; close, recovery, enqueue, and execution completion all enter dispatch through `wakeScheduler()`.

## 15. Validation — gates

- [x] 15.1 Run `npm run build`, `npm test`, `npm run test:contract`, `npm run lint:architecture`.
- [x] 15.2 Run `openspec validate add-ts-agent-tool --strict`.
