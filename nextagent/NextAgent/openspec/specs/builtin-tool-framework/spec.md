# builtin-tool-framework Specification

## Purpose
Defines the provider-neutral Tool authoring, discovery, configuration, dependency, and execution framework used to expose builtin Tool implementations as governed NextAgent capabilities without introducing Tool-specific public descriptor, invocation, result, or source contracts.
## Requirements
### Requirement: Planning Tool Calling mode exposes exactly one planning tool family

The app configuration SHALL support `nextAgent.system.planning-tool-calling-mode` with values `todo-write` and `task-tools`. If omitted, the system SHALL default to `todo-write` to preserve existing behavior.

The mode SHALL be resolved during trusted app configuration and forwarded to the builtin Tool catalog. The mode SHALL only affect the model-visible builtin planning Tool family. It SHALL NOT create Tools from configuration, change provider identity, replace Tool schemas, or alter Tool execution semantics.

In `todo-write` mode, the builtin Tool catalog SHALL expose `TodoWrite` when otherwise available and SHALL suppress builtin Tool capability ids matching the `Task*` series. In `task-tools` mode, the builtin Tool catalog SHALL suppress `TodoWrite` and SHALL expose builtin `Task*` Tool descriptors when those Tools are registered and otherwise available.

#### Scenario: TodoWrite mode suppresses Task-series tools

- **WHEN** app configuration omits `nextAgent.system.planning-tool-calling-mode` or sets it to `todo-write`
- **AND** the builtin Tool list contains `TodoWrite` and one or more `Task*` Tools
- **THEN** model-visible builtin Tool descriptors MUST include `TodoWrite`
- **AND** MUST NOT include the `Task*` Tools.

#### Scenario: Task-series mode suppresses TodoWrite

- **WHEN** app configuration sets `nextAgent.system.planning-tool-calling-mode` to `task-tools`
- **AND** the builtin Tool list contains `TodoWrite` and one or more `Task*` Tools
- **THEN** model-visible builtin Tool descriptors MUST NOT include `TodoWrite`
- **AND** MUST include the `Task*` Tools when their ordinary dependency and config checks pass.

#### Scenario: App composition forwards the planning tool mode

- **WHEN** the app composes the capability subsystem from a ready system config
- **THEN** it MUST pass the normalized planning Tool Calling mode to the builtin Tool catalog
- **AND** the model invocation Tool projection MUST reflect the selected family for that app instance.

### Requirement: Capability descriptors expose structured output schema

`CapabilityDescriptor` SHALL include an optional `outputSchema` field. When present, `outputSchema` SHALL describe the successful `CapabilityInvocationResult.structuredPayload` shape for the capability. It SHALL NOT describe the entire `CapabilityInvocationResult` envelope and SHALL NOT constrain `safeError`, `generatedMessages`, `contextPatch`, `resultRef`, `artifactRefs`, or result metadata.

#### Scenario: Descriptor output schema describes structured payload

- **WHEN** a Tool metadata declares an output schema
- **THEN** the projected `CapabilityDescriptor` includes that schema as `outputSchema`
- **AND** a successful invocation result's `structuredPayload` is validated against that schema

### Requirement: Tool metadata is provider-neutral

The Tool framework SHALL define provider-neutral Tool metadata containing Tool name, safe description, input schema, output schema, optional config schema, optional required dependency names, and optional replay policy. Tool metadata MUST NOT contain provider identity. Provider identity SHALL continue to come from the existing `CapabilityProvider` contract.

#### Scenario: Metadata projects through existing provider identity

- **WHEN** builtin Tool metadata is composed with the builtin `CapabilityProvider`
- **THEN** the resulting descriptor uses `providerId="builtin-tools"` and `providerKind=BUNDLED`
- **AND** the Tool metadata does not define provider id, provider kind, or provider type

### Requirement: Builtin Tool descriptions expose governed model-facing guidance

Builtin Tool metadata `description` SHALL expose the model-facing guidance needed to choose and use the Tool safely. That guidance SHALL cover a one-line summary, applicable use cases, misuse-routing guidance when another Tool is a better fit, and key behaviors such as output shape interpretation, truncation, hard failures, degraded failures, or schema-hidden defaults.

Descriptions MUST reflect implemented behavior only. They MUST NOT promise capabilities, formats, defaults, or failure handling that are not enforced by the Tool implementation or schema. Descriptions MAY use explicit sections such as `When to use`, `When NOT to use`, and `Key behaviors`, or equivalent prose, as long as the same guidance is preserved.

#### Scenario: Overlapping tools include routing guidance

- **WHEN** a builtin Tool overlaps with another builtin Tool for a common model task
- **THEN** the Tool `description` includes guidance routing the model toward the more appropriate Tool
- **AND** that guidance may appear in explicit sections or equivalent prose

#### Scenario: Description reflects actual output and failure semantics

- **WHEN** a builtin Tool `description` explains output shape, truncation, or failure behavior
- **THEN** the description matches the Tool implementation and projected schema
- **AND** it does not claim unimplemented formatting, unsupported defaults, or softer behavior than an actual hard failure

### Requirement: Tool implementation is separated from metadata

The framework SHALL separate Tool metadata from the Tool implementation. A Tool implementation SHALL expose an `execute(input, options?)` operation and MAY expose a `configure(config, deps?)` operation. Tool implementations SHALL NOT receive `CapabilityInvocationRequest` and SHALL NOT return `CapabilityInvocationResult`.

#### Scenario: Tool executes business input only

- **WHEN** the executor invokes a Tool
- **THEN** the Tool receives validated business input
- **AND** it may receive optional execution options containing context, dependencies, and abort signal
- **AND** it returns a business output object rather than a capability result envelope

### Requirement: defineTool simplifies Tool authoring without creating a registration path

The framework SHALL expose `defineTool` as a Tool authoring helper. `defineTool` SHALL return an explicit `ToolDefinition` containing Tool metadata and Tool implementation. It SHALL NOT register Tools, scan directories, rely on import side effects, read configuration, generate schemas automatically, or add Tools to any catalog.

`defineTool` SHALL support Tools with no configuration and no dependencies without requiring `configSchema`, `configure`, `requiredDependencies`, empty config objects, or empty dependency lists.

#### Scenario: Minimal Tool definition has no config or dependency ceremony

- **WHEN** a Tool author defines a Tool with name, description, input schema, output schema, and execute function only
- **THEN** `defineTool` returns a `ToolDefinition`
- **AND** the resulting metadata has no config schema and no required dependencies
- **AND** the definition can be added to the owned builtin Tool list

#### Scenario: defineTool does not register implicitly

- **WHEN** a module exports a Tool definition created by `defineTool`
- **THEN** the Tool is not discoverable until the owning package explicitly adds it to the builtin Tool list

### Requirement: Tool dependencies are optional and controlled

The Tool framework SHALL define optional controlled Tool dependencies. The supported dependency names SHALL include `sandbox`, `workspaceFiles`, `skillSources`, `approval`, and `todoState`. Tools MAY declare required dependency names in metadata. The catalog SHALL verify required dependencies before a Tool becomes executable.

Tool implementations MUST NOT receive workspace root, host absolute paths, sandbox internals, gateway-local private implementations, host process APIs, runtime-private state objects, channel-private state objects, or model-supplied scope identity through Tool input or `CapabilityInvocationRequest`.

The Tool-facing sandbox dependency SHALL expose narrow `runShell` and `runPython` operations. The Tool-facing `workspaceFiles` dependency SHALL expose governed read, write, glob, and run cleanup operations. The Tool-facing `skillSources` dependency SHALL expose governed Skill resource access. The reserved `approval` dependency SHALL provide readiness evidence only when a complete runtime-owned approval integration is present. The Tool-facing `todoState` dependency SHALL expose only scoped todo read/replace/clear operations needed by `TodoWrite`; it MUST NOT expose runtime lifecycle mutation, terminal commit, checkpoint mutation, Web channel projection internals, or persistent task scheduling.

Tool metadata SHALL NOT be used as the owner of capability-specific observability projection semantics. Tool metadata MAY expose model-facing descriptor facts, schema, dependency requirements, replay policy, and disclosure policy. Low-cardinality diagnostics for built-in Tools SHALL be derived by runtime, gateway, or observability owners from safe result shapes and trusted execution facts.

#### Scenario: Required dependency must be available

- **WHEN** Tool metadata declares a required dependency
- **AND** the capability subsystem does not provide that dependency
- **THEN** that Tool MUST NOT become executable
- **AND** the catalog MUST expose an unavailable descriptor with a safe availability reason.

#### Scenario: Workspace root is not exposed to Tool

- **WHEN** a Tool needs workspace file access
- **THEN** it MUST use the controlled `workspaceFiles` dependency
- **AND** it MUST NOT receive or derive workspace root from request arguments, client metadata, model output, or capability invocation payload.

#### Scenario: Sandbox dependency is interface-only in the framework

- **WHEN** this framework exposes the `sandbox` dependency
- **THEN** it exposes only the Tool-facing `runShell` and `runPython` interface
- **AND** it does not implement sandbox execution
- **AND** it does not require `agent-capability` to import the gateway contract.

#### Scenario: TodoWrite uses scoped todo state dependency

- **WHEN** the `TodoWrite` Tool needs to read or replace a todo list
- **THEN** it MUST use the controlled `todoState` dependency
- **AND** it MUST pass trusted `ToolExecutionContext` facts to that dependency
- **AND** it MUST NOT receive todo scope, session id, agent id, owner id, runtime lifecycle object, channel projection object, or persistence implementation from model input.

#### Scenario: Tool metadata does not own observability projection

- **WHEN** a built-in Tool needs low-cardinality diagnostics
- **THEN** runtime, gateway, or observability owners MUST derive those diagnostics from safe result shapes and trusted execution facts
- **AND** Tool metadata MUST NOT define a Tool-specific observability projector.

### Requirement: Workspace File Dependency Supports Edit Operations

The controlled `workspaceFiles` Tool dependency SHALL own Edit operations alongside Read and Write filesystem operations. The `WorkspaceFilePort` interface SHALL expose an `editText` method that receives Tool input, execution context, and optional abort signal, and returns structured output.

The dependency SHALL reuse Read-before-Write snapshot guards for Edit authorization. Edit SHALL use the same `agentId + agentVersion + runId + normalized path` snapshot store as Write.

The dependency SHALL NOT own request lifecycle. `agent-capability` SHALL own run-scoped snapshot cleanup policy for `workspaceFiles` state and SHALL expose owner-provided cleanup hooks or jobs that app composition can register with runtime or gateway scheduling owners. `agent-app` MUST NOT directly call `WorkspaceFilePort` cleanup operations, observe terminal events to implement workspace cleanup policy, or keep `WorkspaceFilePort` as an app-owned dependency.

#### Scenario: Edit uses the same workspaceFiles dependency as Read and Write

- **WHEN** Read, Write, and Edit Tools access workspace files
- **THEN** all three MUST use the same `workspaceFiles` dependency boundary
- **AND** no Tool may directly import or invoke host filesystem APIs

#### Scenario: Edit shares snapshot store with Write

- **WHEN** the system tracks full-read freshness for Write and Edit
- **THEN** both tools MUST use one run-scoped snapshot authority
- **AND** snapshot cleanup MUST invalidate Write and Edit together

### Requirement: Tool catalog uses explicit registration and trusted configuration

Builtin Tool registration SHALL be explicit through an `agent-capability` owned builtin Tool list that feeds the trusted `builtin-tools` provider contribution. Each list entry SHALL be a `ToolDefinition` pairing Tool metadata with a Tool implementation. The Tool catalog SHALL NOT scan directories, perform runtime decorator discovery, rely on import side-effect self-registration, or create Tools from configuration.

The Tool catalog SHALL consume optional `ToolCatalogConfig` supplied by app composition, a later concrete Tool owner, or tests. `ToolCatalogConfig` is the framework config entry for safe description override and per-Tool config validation for already registered Tools; it is not the final user configuration file schema. The builtin-tools provider SHALL be enabled by default in this change and SHALL NOT be disabled by user configuration. Configuration MAY control safe description override and Tool config fields explicitly allowed by the Tool metadata config schema. Configuration MUST NOT create Tool names, disable the builtin provider, replace input or output schemas, change provider identity, change required dependencies, or define execution mapping. If configuration references a Tool name that is not present in the owned Tool list, Tool catalog creation SHALL fail with a safe configuration failure and SHALL NOT create descriptors or executable Tools for that name.

#### Scenario: Explicit builtin list is the only builtin registration path

- **WHEN** builtin Tools are composed
- **THEN** the catalog reads only the owned list of Tool definitions
- **AND** unknown Tool names in configuration do not create descriptors or executable Tools

#### Scenario: Unknown configured Tool fails catalog creation

- **WHEN** `ToolCatalogConfig` contains a Tool name that is not in the owned builtin Tool list
- **THEN** Tool catalog creation fails with a safe configuration failure
- **AND** no descriptor or executable Tool is created for that configured name

### Requirement: Existing read Tool uses the Tool framework without behavior changes

The read Tool SHALL be represented as a `defineTool`-created Tool definition in the owned builtin Tool list. Read input, output, read-only semantics, workspace restrictions, offset/limit behavior, and safe failure behavior SHALL continue to be governed by the read Tool specification.

Read SHALL NOT use the sandbox dependency. It SHALL use the controlled workspace file dependency and SHALL become unavailable when the required workspace file dependency is not supplied.

#### Scenario: Read descriptor is projected from Tool metadata

- **WHEN** the builtin Tool catalog lists descriptors
- **THEN** the read descriptor is projected from the read Tool definition metadata
- **AND** it includes read input schema and read output schema

#### Scenario: Read executes through BuiltinToolExecutor

- **WHEN** read is invoked after the capability catalog resolves the builtin read descriptor
- **THEN** `BuiltinToolExecutor` validates input, calls the read Tool implementation, validates output, and wraps the result
- **AND** read is exposed and executed only through ToolCatalog and BuiltinToolExecutor in the capability product path

#### Scenario: Read does not use sandbox

- **WHEN** read is configured and executed
- **THEN** the read Tool does not require or call the sandbox dependency
- **AND** missing workspace file dependency makes read unavailable before execution

#### Scenario: Tool config is validated by metadata schema

- **WHEN** trusted configuration provides a config object for a Tool with `configSchema`
- **THEN** the catalog validates that config against the Tool metadata config schema before the Tool becomes executable
- **AND** invalid config prevents that Tool from becoming executable
- **AND** the catalog exposes an unavailable descriptor with a safe availability reason

### Requirement: Tool catalog implements existing discovery boundary and executable lookup

The Tool catalog SHALL combine a `CapabilityProvider`, explicit `ToolDefinition` entries, trusted configuration, and available dependencies to produce Tool descriptors and provider-aware executable lookup. For descriptor discovery, it SHALL implement the existing provider-bound `CapabilityDiscovery` boundary using `provider`, `discoveryMode`, and `listAll(signal)`. It MUST NOT introduce replacement discovery methods such as `discover(toolName)` or `scanAndRegister(catalog)`.

For the trusted builtin provider, the capability subsystem SHALL assemble a `builtin-tools` provider contribution that carries the Tool catalog as its `EAGER` discovery support and binds builtin Tool executor support into the normal invocation lookup. The existing capability catalog SHALL consume Tool descriptors only through `CapabilityDiscovery.listAll(signal)` and SHALL continue to own request-visible descriptor views, conflict resolution, Agent binding filtering, and capability id uniqueness.

Descriptor projection SHALL preserve the existing capability public contract and SHALL set `kind=TOOL`.

Executable lookup MUST use provider identity and capability id. It MUST NOT rely on capability id alone when resolving executable Tools. External capability invocation remains provider-free and uses `CapabilityInvocationRequest.capabilityId`; the provider coordinate comes from the already resolved `CapabilityDescriptor`. If the capability catalog cannot resolve a unique descriptor for a capability id, invocation MUST fail safely before Tool execution.

#### Scenario: Catalog lists descriptors through CapabilityDiscovery

- **WHEN** the capability subsystem asks the Tool catalog for startup descriptors
- **THEN** it calls `CapabilityDiscovery.listAll(signal)`
- **AND** catalog registration remains owned by the capability subsystem
- **AND** the Tool catalog does not mutate a capability catalog directly

#### Scenario: Builtin Tool contribution carries Tool catalog discovery

- **WHEN** the capability subsystem assembles the `providerId="builtin-tools"` contribution with `discoveryMode=EAGER`
- **THEN** the contribution carries the Tool catalog discovery backed by the owned builtin Tool list
- **AND** the capability catalog consumes it as a normal `CapabilityDiscovery`
- **AND** request-visible uniqueness and conflict resolution remain owned by the capability catalog

#### Scenario: Metadata is projected to descriptor

- **WHEN** a registered Tool metadata entry is composed with a provider
- **THEN** the catalog produces a `CapabilityDescriptor` whose `capabilityId` and `displayName` come from metadata name
- **AND** whose `description` comes from metadata description or trusted override
- **AND** whose `inputSchema` and `outputSchema` come from metadata
- **AND** whose provider comes from the supplied `CapabilityProvider`

#### Scenario: Executable lookup is provider-aware

- **WHEN** two providers contain Tools with the same capability id
- **AND** capability governance resolves one provider's descriptor as the unique executable descriptor
- **THEN** executable lookup MUST distinguish executable Tools by descriptor provider identity
- **AND** invoking the resolved descriptor MUST NOT execute another provider's Tool

#### Scenario: Unresolved provider conflict fails before Tool execution

- **WHEN** two providers contain Tools with the same capability id
- **AND** capability governance cannot resolve a unique descriptor
- **THEN** a provider-free invocation by `capabilityId` MUST return a safe unavailable or conflict result
- **AND** the Tool executor MUST NOT execute either provider's Tool

### Requirement: Builtin Tool executor adapts capability invocation to Tool execution

The builtin Tool executor SHALL receive a resolved `CapabilityDescriptor`, `CapabilityInvocationRequest`, and `AbortSignal`. It SHALL resolve an executable Tool by descriptor provider and request capability id, validate request arguments against Tool input schema, construct safe execution options from trusted request/runtime facts, execute the Tool, validate returned output against Tool output schema, and wrap the output in `CapabilityInvocationResult.structuredPayload`.

The builtin Tool executor SHALL plug into the existing capability execution path as a provider-neutral `CapabilityExecutor` bound to the `builtin-tools` provider contribution by capability subsystem assembly. The assembled executor lookup SHALL return exactly one `BuiltinToolExecutor` for descriptors with `kind=TOOL` and `provider.providerId="builtin-tools"`. Agent core and runtime SHALL continue to call only `CapabilityInvocationPort`; they SHALL NOT import or call `BuiltinToolExecutor`, `ToolCatalog`, or Tool implementations directly.

The executor SHALL return safe failed results for unknown executable Tool, invalid input, invalid output, missing dependency, configuration failure, timeout, abort, or Tool execution failure. It SHALL NOT leak raw host exceptions, raw command text, raw Python code, file content, stdout, stderr, credentials, tokens, host absolute paths, or high-cardinality fields through logs, stream payloads, safe errors, audit fields, or result metadata.

#### Scenario: Executor validates input before Tool execution

- **WHEN** a Tool invocation contains arguments that do not match the Tool input schema
- **THEN** the executor MUST NOT call `Tool.execute`
- **AND** it returns a safe failed result with a stable reason code

#### Scenario: Contribution executor lookup routes builtin Tools

- **WHEN** `CapabilityInvocationPort` invokes a resolved descriptor whose provider id is `builtin-tools` and kind is `TOOL`
- **THEN** it uses the executor lookup assembled from provider contributions
- **AND** the lookup returns exactly one `BuiltinToolExecutor`
- **AND** zero or multiple matching executors produce a safe capability failure before Tool execution
- **AND** invocation does not choose an executor by provider kind or registration order

#### Scenario: Executor validates output after Tool execution

- **WHEN** `Tool.execute` returns an object that does not match the Tool output schema
- **THEN** the executor returns a safe failed result
- **AND** it does not expose the invalid raw output

#### Scenario: Executor wraps successful Tool output

- **WHEN** `Tool.execute` returns output matching the Tool output schema
- **THEN** the executor returns `CapabilityInvocationResult.status=SUCCEEDED`
- **AND** the Tool output is placed in `structuredPayload`

### Requirement: Tool framework preserves capability contract uniqueness

The Tool framework MUST reuse `CapabilityProvider`, `CapabilityDescriptor`, `CapabilityInvocationRequest`, `CapabilityInvocationResult`, and `CapabilityInvocationPort`. It MUST NOT introduce public `ToolDescriptor`, `ToolInvocationRequest`, `ToolInvocationResult`, `ToolSource`, or parallel capability kind vocabularies.

#### Scenario: Tool is not a parallel public invocation protocol

- **WHEN** Agent Core invokes a Tool capability
- **THEN** it continues to call `CapabilityInvocationPort.invoke(...)` with `CapabilityInvocationRequest`
- **AND** it receives `CapabilityInvocationResult`
- **AND** it does not use a Tool-specific public request or result envelope

### Requirement: Tool framework exposes a config entry without owning user configuration

The Tool framework SHALL NOT read final user configuration files directly and SHALL NOT define the external Tool configuration schema in this change. It SHALL expose `ToolCatalogConfig` as a trusted object accepted by `createToolCatalog({ config })` so future concrete Tool changes or app composition can pass configuration for already registered Tools.

#### Scenario: Framework consumes supplied ToolCatalogConfig

- **WHEN** a caller supplies `ToolCatalogConfig`
- **THEN** the catalog validates config only for registered Tools
- **AND** Tool implementations never read configuration files directly

#### Scenario: ToolCatalogConfig is the framework config entry

- **WHEN** a caller needs to configure registered Tool behavior
- **THEN** it supplies `ToolCatalogConfig` to `createToolCatalog({ config })`
- **AND** the framework validates only this trusted object and per-Tool config schemas
- **AND** the framework does not define or parse the final external configuration file format

### Requirement: Tool execution context supports safe cumulative result deltas

The builtin Tool framework SHALL allow a Tool implementation to emit safe cumulative capability result deltas during a single invocation through `ToolExecutionContext`. This delta path MUST remain optional: Tools that do not emit deltas MUST preserve the existing single-result behavior.

The emitted delta payload MUST be a bounded `JsonObject` that is safe for downstream user-visible stream projection. The framework MUST NOT treat a delta payload as a terminal `CapabilityInvocationResult`, MUST NOT append it as the final capability result message by itself, and MUST NOT require it to create a parallel invocation protocol.

#### Scenario: Tool without deltas keeps existing behavior

- **WHEN** a Tool implementation never emits a result delta
- **THEN** the builtin Tool executor MUST preserve the existing behavior of returning only the final structured payload
- **AND** no new stream-only requirement is imposed on that Tool

#### Scenario: Tool emits cumulative result deltas through execution context

- **WHEN** a Tool implementation emits multiple result deltas during one invocation
- **THEN** the execution context MUST accept those deltas without requiring the Tool to construct a `CapabilityInvocationResult`
- **AND** each delta MUST represent the cumulative full visible state for that Tool-local delta stream
- **AND** the final successful or failed invocation outcome MUST still be returned through the normal capability invocation envelope

### Requirement: Tool delta emission fails closed on unsafe payloads

The builtin Tool framework MUST validate or otherwise guard Tool-emitted result deltas before downstream projection. If a delta payload is malformed, non-object, unserializable, or exceeds the bounded delta contract used by the owning Tool, the framework or downstream execution path MUST fail safely rather than projecting the unsafe delta.

#### Scenario: Unsafe Tool delta does not reach stream projection

- **WHEN** a Tool emits a malformed or unserializable result delta
- **THEN** the system MUST NOT project that delta to the user-visible capability stream
- **AND** the invocation MUST surface a safe failed or degraded outcome

### Requirement: Workspace File Dependency Supports Governed Read And Write State

The controlled `workspaceFiles` Tool dependency SHALL own both Read and Write filesystem operations needed by builtin file Tools. It SHALL accept trusted Tool execution context and SHALL NOT expose workspace root, host absolute paths, filesystem implementation objects, or raw host APIs to Tool implementations.

The dependency SHALL maintain process-local full Read snapshots scoped by accepted Agent identity/version and request run. It SHALL update the snapshot after a successful governed Write and SHALL NOT persist or reuse snapshots across run completion, restart, or recovery.

The dependency SHALL NOT own request lifecycle. `agent-capability` SHALL own cleanup policy for run-scoped workspace file snapshots and SHALL expose owner-provided cleanup hooks or jobs that app composition can register with the existing runtime/gateway scheduling facilities without creating a parallel scheduler, terminal event, or persistence model.

#### Scenario: Read and Write share one controlled dependency

- **WHEN** builtin Read and Write Tools access workspace files
- **THEN** both MUST use the same `workspaceFiles` dependency boundary
- **AND** neither Tool may directly import or invoke host filesystem APIs

### Requirement: Tool Dependencies May Require Approval Readiness

The Tool framework SHALL recognize `approval` as a controlled readiness dependency name. In this change the dependency SHALL provide no Tool-facing confirmation protocol and SHALL NOT authorize Tool implementations to create private pending state.

A Tool requiring `approval` SHALL be unavailable when app composition does not provide readiness evidence from a complete runtime-owned approval integration.

#### Scenario: Reserved approval dependency is absent

- **WHEN** a registered Tool requires `approval`
- **AND** no complete approval integration supplies that dependency
- **THEN** the descriptor MUST be `UNAVAILABLE`
- **AND** the Tool executable MUST NOT run

### Requirement: Tool invocation 支持同轮并行调用

Tool execution framework SHALL support multiple independent Tool capability invocations from the same Agent round running concurrently through the existing capability invocation boundary. This MUST NOT introduce Tool-specific public invocation contracts, bypass provider-aware executable lookup, bypass input/output schema validation, or weaken safe error mapping.

Tool implementations MUST treat each invocation as an independent execution. A Tool implementation or controlled dependency that owns mutable state or side effects MUST protect its own consistency and MUST NOT rely on Agent core serializing same-round invocations. Agent core SHALL preserve result association by tool call id and original model order rather than by completion order.

#### Scenario: 多个 Tool invocation 可重叠执行

- **WHEN** Agent core invokes multiple Tool capabilities from the same model round
- **THEN** Tool execution framework MUST allow those invocations to overlap in time
- **AND** each invocation MUST still validate input before execution and output after execution
- **AND** each invocation MUST return its own `CapabilityInvocationResult`

#### Scenario: Tool invocation 仍保持调用隔离

- **WHEN** multiple Tool invocations overlap
- **THEN** each invocation MUST receive only its own validated input and trusted execution options
- **AND** one invocation MUST NOT receive another invocation's arguments, result payload, safe error, or mutable execution context
- **AND** shared controlled dependencies MUST preserve their own consistency under overlapping calls

#### Scenario: 并行调用不新增公共 Tool 协议

- **WHEN** same-round Tool invocations run concurrently
- **THEN** Agent core MUST continue to call `CapabilityInvocationPort`
- **AND** the Tool framework MUST NOT expose public `ToolInvocationRequest`, `ToolInvocationResult`, or Tool-specific execution protocols

### Requirement: Tool execution context SHALL support safe cumulative result deltas

The builtin Tool framework MUST allow a Tool implementation to emit safe cumulative capability result deltas during a single invocation through `ToolExecutionContext`. This delta path MUST remain optional: Tools that do not emit deltas MUST preserve the existing single-result behavior.

The emitted delta payload MUST be a bounded `JsonObject` that is safe for downstream user-visible stream projection. The framework MUST NOT treat a delta payload as a terminal `CapabilityInvocationResult`, MUST NOT append it as the final capability result message by itself, and MUST NOT require it to create a parallel invocation protocol.

#### Scenario: Tool without deltas keeps existing behavior

- **WHEN** a Tool implementation never emits a result delta
- **THEN** the builtin Tool executor MUST preserve the existing behavior of returning only the final structured payload
- **AND** no new stream-only requirement is imposed on that Tool

#### Scenario: Tool emits cumulative result deltas through execution context

- **WHEN** a Tool implementation emits multiple result deltas during one invocation
- **THEN** the execution context MUST accept those deltas without requiring the Tool to construct a `CapabilityInvocationResult`
- **AND** each delta MUST represent the cumulative full visible state for that Tool-local delta stream
- **AND** the final successful or failed invocation outcome MUST still be returned through the normal capability invocation envelope

### Requirement: Tool delta emission SHALL fail closed on unsafe payloads

The builtin Tool framework MUST validate or otherwise guard Tool-emitted result deltas before downstream projection. If a delta payload is malformed, non-object, unserializable, or exceeds the bounded delta contract used by the owning Tool, the framework or downstream execution path MUST fail safely rather than projecting the unsafe delta.

#### Scenario: Unsafe Tool delta does not reach stream projection

- **WHEN** a Tool emits a malformed or unserializable result delta
- **THEN** the system MUST NOT project that delta to the user-visible capability stream
- **AND** the invocation MUST surface a safe failed or degraded outcome

### Requirement: Builtin Tool descriptions follow unified model-facing guidance coverage

所有内置 Tool 的模型可见 `description` SHALL 覆盖统一的模型决策信息：一句话总结、适用场景、避免误用时的路由指引，以及关键行为（如输出格式、截断、失败语义和字段语义）。简单工具 MAY 省略不适用的信息；复杂工具 MAY 使用显式分段（如 "When to use" / "When NOT to use" / "Key behaviors"）或等价 prose 形态表达这些信息，只要语义覆盖保持一致。

描述 MUST 只描述已实现的行为，MUST NOT 承诺 schema 或实现未表达的能力。描述 MUST NOT 暴露 host 路径、credential、allowlist 具体命令或内部实现路径。

当多个内置 Tool 的功能存在重叠时（如 Bash 的 `grep`/`find`/`cat` 与 Grep/Glob/Read），相关 Tool 的描述 MUST 在 "When NOT to use" 段段中给出路由指引。

涉及 read-before-write 或 read-before-edit 硬性失败的 Tool（Write、Edit），其描述 MUST 在 "Key behaviors" 或 "Usage" 中说明该硬性失败和对应 reason code。

#### Scenario: Tool description includes routing guidance

- **WHEN** 一个内置 Tool 的功能与另一个内置 Tool 存在重叠
- **THEN** 该 Tool 的 `description` MUST 指引模型使用更合适的 Tool
- **AND** 该路由指引 MAY 位于显式 "When NOT to use" 段落中，或位于等价 prose 语句中

#### Scenario: Tool description reflects actual output format

- **WHEN** 一个内置 Tool 的 `description` 描述输出格式
- **THEN** 描述 MUST 与 `outputSchema` 和实现返回的真实结构一致
- **AND** 描述 MUST NOT 声称实现不提供的格式（如行号前缀、图片/PDF 支持等）

#### Scenario: Hard failure documented in description

- **WHEN** 一个内置 Tool 在特定条件下硬性失败（如 read-before-write、old_string 不唯一）
- **THEN** 该 Tool 的 `description` MUST 说明该硬性失败条件和对应的 reason code
- **AND** 描述 MUST NOT 把硬性失败描述为软性建议

### Requirement: Cron Tool 受控依赖
内置 Tool framework SHALL 通过 `cronTasks` async dependency 调用 Cron gateway，不得直接访问 SQLite、remote SDK、host timer 或 runtime 私有实现。依赖缺失时 Cron Tool MUST 返回稳定 unavailable safe result。

#### Scenario: Cron dependency 缺失
- **WHEN** capability provider 注册 Cron Tool 但 composition 未注入 `cronTasks`
- **THEN** 调用 MUST fail closed，且不得创建进程内临时任务

#### Scenario: Capability 治理保持生效
- **WHEN** 模型调用任一 Cron Tool
- **THEN** 调用 MUST 经过既有 resolver、schema validation、risk policy、executor 和 safe result boundary

### Requirement: ApiCallPort Tool Dependency

The Tool framework SHALL recognize `apiCallPort` as a controlled Tool dependency name. The `ToolDependencyName` type MUST include `"apiCallPort"`. The `ToolDependencies` interface MUST include an optional `apiCallPort?: ApiCallPort` field. The `ApiCallPort` interface MUST be owned by `agent-capability` and MUST expose API call operations without coupling to HTTP implementation details. The production implementation MUST be provided by `agent-platform-gateway-remote` and injected through `agent-app` composition.

#### Scenario: Tool requiring apiCallPort is unavailable when dependency absent

- **WHEN** a Tool declares `apiCallPort` in `requiredDependencies`
- **AND** the capability subsystem does not provide the `apiCallPort` dependency
- **THEN** that Tool MUST NOT become executable
- **AND** the catalog MUST expose an unavailable descriptor with a safe availability reason

#### Scenario: ApiCallPort is interface-only in the framework

- **WHEN** this framework exposes the `apiCallPort` dependency
- **THEN** it exposes only the Tool-facing API call interface
- **AND** it does not implement HTTP execution
- **AND** it does not require `agent-capability` to import the gateway contract

### Requirement: ParameterExtraction Tool Dependency

The Tool framework SHALL recognize `parameterExtraction` as a controlled Tool dependency name. The `ToolDependencyName` type MUST include `"parameterExtraction"`. The `ToolDependencies` interface MUST include an optional `parameterExtraction?: ParameterExtractionPort` field. The `ParameterExtractionPort` interface MUST be owned by `agent-contracts/capability` and MUST expose a `extractParams(input, signal)` operation that performs a single model `complete()` call. The production implementation MUST be in `agent-runtime`, wrapping `ModelInvocationService`, and injected through `agent-app` composition following the same pattern as `SubagentExecutionPort`.

#### Scenario: Tool requiring parameterExtraction is unavailable when dependency absent

- **WHEN** a Tool declares `parameterExtraction` in `requiredDependencies`
- **AND** the capability subsystem does not provide the `parameterExtraction` dependency
- **THEN** that Tool MUST NOT become executable
- **AND** the catalog MUST expose an unavailable descriptor with a safe availability reason

#### Scenario: ParameterExtractionPort is interface-only in the framework

- **WHEN** this framework exposes the `parameterExtraction` dependency
- **THEN** it exposes only the Tool-facing parameter extraction interface
- **AND** it does not implement model invocation directly
- **AND** it does not require `agent-capability` to import `ModelInvocationService`
