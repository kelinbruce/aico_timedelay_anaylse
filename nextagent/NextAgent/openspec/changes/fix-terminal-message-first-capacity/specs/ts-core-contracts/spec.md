## REMOVED Requirements

### Requirement: Runtime Request Summary Read Model

**Reason**：该 Requirement 的唯一 actor、输入、输出与失败语义属于 `FN-10.10 任务通道` 的 reconciliation read model；继续留在混合 legacy `ts-core-contracts` 会让同一 Function 契约分散，并阻止本次终态正文来源修改获得唯一规范 owner。

**Migration**：本 change 将目标态 Requirement 原子迁移到 `specs/agent-task-channel/spec.md`，保留既有 `RuntimeSessionPort.getRequestSummary` 方法名、query shape、read model shape、scope 校验和 Task Channel 使用方式，仅把 `terminalResult.content` 的 canonical 来源改为可信 terminal Assistant Message association。`ts-core-contracts` 的其他 Requirements 原位保留，该 legacy spec 不退役。

## MODIFIED Requirements

### Requirement: Agent Core Uses Runtime-Owned Run State Port

The system MUST expose an `AgentRunStatePort` under `agent-contracts/runtime` for Agent-owned execution logic to request runtime-owned run state side effects. `AgentRunStatePort` MUST support emitting run timeline events, appending run/session messages, saving checkpoints, and handing a Capability-origin terminal answer to Runtime with the accepted `RequestRun` and trusted `RequestContext`.

`AgentRunStatePort` MUST expose the required method `setCapabilityTerminalAnswer(run, context, { content }): Promise<void>`. The answer object MUST contain exactly one field, `content: string`; it MUST NOT contain content type, origin, Message id, content ref, metadata, identity or persistence command fields. Only a successfully completed Direct Workflow route or non-agentic `ApiCall` route MAY call this method. Ordinary Model Loop, model-driven Capability, Workflow-as-Tool and every other Capability route MUST NOT call it.

Runtime MUST accept at most one Capability terminal answer per accepted run. A duplicate submission, or coexistence of a final LLM terminal source and a Capability terminal answer in the same run, MUST fail closed without overwrite, concatenation or source precedence. Intermediate LLM deltas MUST NOT be treated as a final-source conflict. Only normal completed terminal selection MAY consume the Capability answer; failure, cancellation, supersession, pending input and discarded execution MUST clear it without committing it as a successful answer.

`Agent.execute` MUST accept only `RequestRun`, `RequestContext`, and `AbortSignal`. It MUST NOT accept timeline or message ports as execute-time parameters, and the implementation MUST NOT keep compatibility overloads for the old execute signature.

Runtime MUST implement `AgentRunStatePort` as a runtime-owned run state write service and inject it through Agent construction. The port MAY be a singleton service because every operation receives the accepted `RequestRun` and trusted `RequestContext`. Per-run terminal output aggregation, including the Capability terminal answer, MUST be kept in runtime-owned per-run state outside the Agent Core contract surface.

App composition MUST NOT synthesize a `SubmitRequestCommand` or submit-command-shaped object for Agent Core checkpoint writes. Checkpoint owner scope MUST come from the trusted `RequestContext.identityContext`; checkpoint idempotency for this checkpoint fact shape MUST be anchored by the accepted `run.runId`, `triggerReason`, and `run.version`.

Runtime MUST own Agent instance lifecycle management. It MUST receive app-composed `AgentConstructor[]` and Agent runtime dependencies, create the runtime-owned `AgentRunStatePort`, and decide when an Agent instance is created, reused, or executed for an accepted request run. Runtime MUST NOT import `agent-core` or `agent-app` for Agent implementation construction.

`AgentConstructor` MUST be a standard constructor contract whose class-level `getType()` returns an `AgentType`. `AgentAssembly` MUST carry the trusted `agentType`; runtime MUST resolve the constructor from `assembly.agentType` and MUST scope Agent reuse to the accepted assembly identity: `agentId`, `agentVersion`, and `agentAssemblyRef`. App composition MAY register Agent constructors and inject Agent runtime dependencies, but MUST NOT own Agent instance cache, reuse, or execution lifecycle policy. Agent implementation packages MAY provide convenience base classes, but external Agent compatibility MUST remain the `Agent` interface plus the `AgentConstructor` shape.

Capability audit MUST be centralized behind the observability/audit boundary and derivable from runtime-owned canonical lifecycle events. Capability executors and Agent Core MUST NOT call `AuditEventWriter` directly for capability audit; Agent Core MUST emit safe capability lifecycle events, runtime MUST canonicalize them with trusted owner/agent/run/session coordinates, and observability/audit code MAY derive audit events from those canonical events without changing request lifecycle outcome. Capability audit derivation MUST NOT depend on before/after capability hook execution; hooks MAY produce their own hook audit/diagnostic facts, but they MUST NOT be the authoritative carrier for capability invocation audit.

**需求类别**：功能性需求

#### Scenario: Agent execute is limited to run context and signal

- **WHEN** runtime dispatches an accepted request run to Agent Core
- **THEN** it MUST construct or provide an Agent with a runtime-owned `AgentRunStatePort`
- **AND** it MUST call `Agent.execute(run, context, signal)`
- **AND** it MUST NOT pass timeline or message ports through `Agent.execute`
- **AND** runtime-owned per-run terminal output state MUST be isolated by accepted run id

#### Scenario: Core checkpoint writes do not synthesize submit commands in app composition

- **WHEN** Agent Core saves a capability checkpoint before a capability call
- **THEN** it MUST call `AgentRunStatePort.saveCheckpoint(run, context, "CAPABILITY_BEFORE_CALL")`
- **AND** runtime-owned code MUST perform the checkpoint write
- **AND** checkpoint idempotency MUST use the accepted run id, trigger reason, and run version
- **AND** `agent-app` MUST NOT construct a fake submit command for this checkpoint path

#### Scenario: Runtime instantiates Agents through registered constructors

- **WHEN** runtime dispatches an accepted request run
- **THEN** it MUST resolve the accepted `AgentAssembly.agentType` through registered `AgentConstructor[]`
- **AND** Agent instance creation and reuse decisions MUST be owned by runtime and scoped to accepted `agentId`, `agentVersion`, and `agentAssemblyRef`
- **AND** it MUST pass the runtime-owned `AgentRunStatePort` in the Agent runtime kit
- **AND** `agent-runtime` MUST NOT import `agent-core` or `agent-app`

#### Scenario: Capability audit is derived from canonical events

- **WHEN** Agent Core consumes a capability invocation result
- **THEN** it MUST emit a safe capability terminal lifecycle event for the current run
- **AND** runtime MUST canonicalize the event before observability/audit derivation
- **AND** capability executors and Agent Core MUST NOT write capability audit events directly
- **AND** capability audit derivation MUST be owned by the observability/audit boundary rather than capability hooks
- **AND** observability/audit derivation MUST NOT alter request lifecycle outcome

#### Scenario: Direct producer hands one Capability answer to Runtime

- **WHEN** a Direct Workflow or non-agentic `ApiCall` route has obtained its expected successful final result
- **THEN** Agent Core MUST call `AgentRunStatePort.setCapabilityTerminalAnswer(run, context, { content })` exactly once
- **AND** it MUST NOT emit a final `LLM_CONTENT_DELTA` for that result
- **AND** the answer MUST remain run-local until normal completed terminal selection

#### Scenario: Other producers cannot use Capability terminal handoff

- **WHEN** ordinary Model Loop, model-driven Capability, Workflow-as-Tool or another Capability route completes
- **THEN** it MUST NOT call `AgentRunStatePort.setCapabilityTerminalAnswer`
- **AND** it MUST retain its existing Model or Tool-result path

#### Scenario: Conflicting terminal sources fail closed

- **GIVEN** a run already has a final LLM terminal source or a Capability terminal answer
- **WHEN** the other final source is submitted for the same run
- **THEN** Runtime MUST fail the run safely
- **AND** MUST NOT overwrite, concatenate or select either source by precedence
- **AND** intermediate LLM deltas alone MUST NOT trigger this failure
