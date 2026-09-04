# api-backed-tool-source Specification

## Purpose
Defines how CLIP Server (a custom capability provider/source) is integrated through the unified capability contract. Each discovered CLIP API becomes an ordinary Tool capability descriptor, with discovery and execution routed through the existing sandbox/gateway boundary.
## Requirements
### Requirement: CLIP Server Provider Uses The Unified Capability Contract

The system MUST support CLIP Server as a custom capability provider/source using the existing unified capability contract. The provider MUST use `providerKind=CUSTOM` and `providerType="clip_server"`. This change MUST NOT introduce a new `CapabilityProviderKind`, a new public invocation envelope, or a second tool catalog.

#### Scenario: Registered clip_server provider can activate

- **WHEN** app composition registers the `clip_server` custom provider adapter
- **AND** provider configuration uses `providerKind=CUSTOM` and `providerType="clip_server"`
- **THEN** the provider MAY create CLIP-backed discovery and execution adapters through the existing capability composition path
- **AND** adapter registration MUST be backed by matching discovery wiring, executor wiring, and injected runner wiring

#### Scenario: Adapter registration without wiring is rejected

- **WHEN** app composition marks `clip_server` as a registered custom adapter type
- **AND** the matching discovery adapter, executor adapter, or injected runner is not wired
- **THEN** the system MUST reject `clip_server` activation safely
- **AND** CLIP-backed descriptors MUST NOT enter executable availability

#### Scenario: Unregistered clip_server provider cannot contribute executable tools

- **WHEN** provider configuration references `providerType="clip_server"`
- **AND** app composition has not registered the `clip_server` custom provider adapter
- **THEN** no CLIP-backed descriptor from that provider MUST enter the executable catalog
- **AND** the system MUST emit a safe diagnostic with a stable reason code

### Requirement: Discovered CLIP APIs Become Ordinary Tool Capabilities

The CLIP Server MUST be modeled as a provider/source. Each valid API or capability discovered from that CLIP Server MUST be normalized as its own ordinary `CapabilityDescriptor` with `kind=TOOL`. The system MUST NOT expose a single model-visible `clipc`, `clip_api_call`, or `api_name + args` dispatch tool for this source.

#### Scenario: Discovered API capabilities are the model-visible tools

- **WHEN** a registered `clip_server` provider discovers remote API capabilities A, B, and C
- **THEN** A, B, and C MUST each be represented as separate ordinary `TOOL` capability descriptors
- **AND** Agent binding, conflict resolution, prompt disclosure, invocation, and audit MUST use those ordinary Tool descriptors as the governed capability identity
- **AND** the model-visible tool contract MUST NOT require callers to invoke a generic CLIP dispatch tool with an API name argument

#### Scenario: Provider-private mapping stays internal

- **WHEN** a CLIP-backed API is mapped to a Tool descriptor
- **THEN** the mapping from descriptor `capabilityId` to provider-private CLIP id, command name, or primitive MUST stay in a provider-scoped internal registry shared by discovery and execution
- **AND** provider-private routing facts MUST NOT appear in descriptor metadata, model context, stream output, safe errors, or user-visible output

#### Scenario: Discovered descriptor facts are validated before catalog entry

- **WHEN** discovery receives a CLIP-backed tool definition
- **THEN** the source MUST validate the capability id, safe description, input schema, provider identity, safe metadata, and availability state before catalog registration
- **AND** invalid descriptors MUST NOT enter executable availability
- **AND** adapter-private ids, raw CLIP payloads, credentials, local paths, endpoint secrets, and raw provider errors MUST NOT be exposed in descriptor metadata, model context, stream output, safe error, or diagnostics

### Requirement: Startup Discovery Uses An Injected Runner Backed By The Existing Execution Boundary

API-backed Tool source MUST obtain CLIP-backed tool facts through an injected CLIP command runner backed by the existing sandbox/gateway execution boundary rather than direct host-process execution from `agent-capability`. This change MUST NOT add a CLIP-specific public gateway port.

The runner production implementation MUST NOT require a new `SandboxExecutionRequest.executable` enum value. If it invokes `clipc`, it MUST do so through the existing sandbox/gateway execution boundary using existing executable shapes and a controlled command template.

When CLIP disclosure mode is the default list mode, the source MUST preserve the existing startup discovery behavior and register successfully validated CLIP-backed tools through the normal capability governance path without adding deferred disclosure policy. When CLIP disclosure mode is `tool-search`, startup discovery MAY still use the existing discovery pass to obtain governed CLIP descriptors, but default model disclosure MUST be ToolSearch-deferred and MUST NOT put the full CLIP API set into the initial model tool list.

#### Scenario: Startup scan registers validated tools

- **WHEN** the `clip_server` provider is enabled with valid configuration
- **THEN** startup discovery MUST invoke the CLIP-backed discovery path through the injected CLIP command runner
- **AND** discovery MUST call the injected CLIP command runner to list or describe available CLIP-backed tools
- **AND** the runner production implementation MUST be composed outside `agent-capability` and backed by the existing sandbox/gateway execution boundary
- **AND** successfully validated tools MUST be registered through the normal capability governance path
- **AND** ToolSearch-deferred CLIP disclosure MUST keep those registered tools out of the default model-visible tool list until ToolSearch activates them through request-local `allowedTools`

#### Scenario: Sandbox executable vocabulary is not expanded

- **WHEN** the runner production implementation invokes `clipc`
- **THEN** it MUST use the existing sandbox/gateway execution contract without adding a new CLIP-specific executable kind
- **AND** `agent-capability` MUST NOT depend on the concrete sandbox or gateway-local implementation

#### Scenario: Periodic sync is outside this change

- **WHEN** the system needs periodic polling, dynamic unregister, manual refresh, hot update, or long-lived cache invalidation for CLIP-backed tools
- **THEN** those behaviors MUST be defined by a later change
- **AND** this change MUST NOT add a polling task, manual refresh command, or catalog mutation path outside startup discovery

### Requirement: Source Configuration Is Validated At The Adapter Boundary

The API-backed tool source MUST require validated configuration before discovery or execution can proceed. The configuration MUST be supplied through the existing custom provider configuration shape and validated by the `clip_server` adapter.

#### Scenario: Invalid configuration blocks source activation

- **WHEN** required source configuration is missing, malformed, or violates trusted path or endpoint rules
- **THEN** the source MUST fail activation safely
- **AND** the system MUST NOT register partial executable descriptors from that source
- **AND** the failure MUST produce a safe diagnostic outcome

### Requirement: Invocation Uses Unified Request And Result Contracts

The API-backed tool source MUST execute CLIP-backed tools through the existing `CapabilityInvocationRequest` and `CapabilityInvocationResult` boundaries. It MUST NOT define a separate invocation envelope, result shape, or audit vocabulary.

#### Scenario: Invocation request is normalized before CLIP execution

- **WHEN** runtime invokes a CLIP-backed tool
- **THEN** `CapabilityInvocationRequest.capabilityId` MUST identify the discovered ordinary Tool capability to execute
- **AND** any mapping from that Tool capability to a CLIP primitive, command name, or provider-private capability id MUST be read from the provider-scoped internal registry and remain inside the registered `clip_server` adapter, injected runner, or existing sandbox/gateway execution boundary
- **AND** the runner request MUST be derived from the invoked Tool capability identity, not from a model-supplied `clipc` command, CLIP primitive, or API selector field
- **AND** the source MUST preserve timeout, cancellation, idempotency, and safe-input boundaries required by the unified capability contract

#### Scenario: CLIP-backed descriptor has an executor

- **WHEN** a CLIP-backed descriptor enters executable availability
- **THEN** the existing capability executor factory path MUST be able to resolve a `clip_server` executor for that descriptor
- **AND** invocation MUST NOT fail solely because only the builtin tool executor was registered

#### Scenario: Invocation result is normalized after runner execution

- **WHEN** the injected runner returns a CLIP-backed execution result
- **THEN** the source MUST validate and normalize that result into `CapabilityInvocationResult`
- **AND** it MUST preserve governed availability, safe diagnostics, generated messages, and structured payload semantics where applicable
- **AND** it MUST NOT expose raw adapter-private responses directly to runtime, model context, stream output, safe error, or user-visible output

### Requirement: Failure And Diagnostics Are Explicit And Safe

Discovery or execution failures in the API-backed tool source MUST be explicit. The source MUST NOT silently drop failing tools, silently downgrade provider identity, directly execute host commands from `agent-capability`, or silently bypass the injected runner and existing sandbox/gateway execution boundary.

#### Scenario: Discovery failure marks affected tools unavailable without blocking unrelated tools

- **WHEN** discovery cannot load or validate a subset of CLIP-backed tools
- **THEN** the source MAY continue serving other successfully validated tools
- **AND** each failed tool MUST be excluded from executable availability or marked unavailable through governed catalog state
- **AND** the source MUST emit safe diagnostics for the failed discovery outcome

#### Scenario: Runner or daemon unavailability is not silent

- **WHEN** the injected runner, backing sandbox/gateway execution boundary, or backing daemon is unavailable during discovery or execution
- **THEN** the source MUST return or record a safe unavailable outcome
- **AND** it MUST NOT pretend that discovery or execution succeeded
- **AND** diagnostics MUST NOT include raw credentials, local paths, endpoint secrets, raw arguments, raw tool results, or adapter-private failure details

### Requirement: CLIP Tool Disclosure Supports ToolSearch-Deferred Lazy Loading

当 `clip_server` provider 被配置为 ToolSearch-deferred CLIP disclosure 时，系统 MUST 将 CLIP API 候选作为可搜索的 deferred CLIP Tool 候选处理。初始模型上下文 MUST 只披露 `<available-deferred-clipc>` 中的候选 `capabilityId`，不得把所有 CLIP API 的描述和 schema 默认拼入 system prompt 或模型工具列表。

ToolSearch 命中 CLIP-backed Tool 后，系统 MUST 生成 `<available-clipc>` 元消息，并 MUST 通过 request-local `CapabilityContextPatch.allowedTools` 激活命中的具体 CLIP Tool。后续模型 step MUST 看到被激活 CLIP Tool 的普通 model tool descriptor，包括该 Tool 的 `inputSchema`，以便模型进行参数提取。系统 MUST NOT 为 CLIP source 暴露单一 `clipc`、`clip_api_call` 或 `api_name + args` 泛化分发工具。

#### Scenario: 初始上下文只披露 deferred CLIP id

- **WHEN** `clip_server` provider 处于 ToolSearch-deferred CLIP disclosure 模式
- **AND** 该 provider 发现多个可用 CLIP-backed Tool
- **THEN** 初始 system prompt MUST 包含 `<available-deferred-clipc>` 和 `</available-deferred-clipc>`
- **AND** `<available-deferred-clipc>` 内 MUST 只列出候选 CLIP Tool 的 `capabilityId`
- **AND** 初始模型工具列表 MUST NOT 包含这些 deferred CLIP Tool，除非其中某个 Tool 同时被 request-local `allowedTools` 激活

#### Scenario: ToolSearch 命中 CLIP Tool 后激活普通工具

- **WHEN** ToolSearch 搜索命中一个或多个 deferred CLIP Tool
- **THEN** ToolSearch result MUST 包含这些 CLIP Tool 的安全 metadata
- **AND** ToolSearch MUST 生成 `<available-clipc>` 元消息，列出 `capability_id`、`name`、`kind=TOOL`、`defer_loading=true` 和安全描述
- **AND** ToolSearch MUST 在 `contextPatch.allowedTools` 中包含命中的 CLIP Tool `capabilityId`
- **AND** 下一次模型输入 MUST 将命中的 CLIP Tool 作为普通 model tool descriptor 暴露
- **AND** 暴露的 model tool descriptor MUST 使用该 CLIP Tool 自身的 `inputSchema`，不得要求模型填写 provider-private CLIP id、primitive、command 或 API selector 字段

#### Scenario: ToolSearch 未命中时不激活 CLIP 工具

- **WHEN** ToolSearch 对 deferred CLIP Tool 的查询没有命中结果
- **THEN** ToolSearch MUST NOT 生成 `<available-clipc>`
- **AND** ToolSearch MUST NOT 在 `contextPatch.allowedTools` 中加入 CLIP Tool
- **AND** 后续模型工具列表 MUST 保持未命中 CLIP Tool 不可见

### Requirement: CLIP Disclosure Mode Is Configurable

系统 MUST 提供 CLIP disclosure 配置开关，使业务集成方能够选择 CLIP-backed Tool 的默认披露策略。未显式配置时，系统 MUST 保持既有默认披露行为，不额外把 CLIP-backed Tool 标记为 deferred。配置为 `tool-search` 时，CLIP-backed Tool MUST 使用 ToolSearch-deferred disclosure，并通过 ToolSearch 激活具体普通 Tool descriptor。

#### Scenario: 未配置时保持兼容行为

- **WHEN** 系统配置没有声明 CLIP disclosure mode
- **THEN** `clip_server` provider MUST 保持现有默认披露行为
- **AND** 已有 CLIP-backed Tool discovery、governance、invocation 行为 MUST 不因该配置缺省而改变

#### Scenario: 配置 tool-search 后启用 CLIP ToolSearch 懒加载

- **WHEN** 系统配置声明 CLIP disclosure mode 为 `tool-search`
- **THEN** `clip_server` provider 发现的 CLIP-backed Tool MUST 使用 ToolSearch-deferred disclosure
- **AND** 初始 system prompt、ToolSearch result、request-local `allowedTools` 激活和后续模型工具列表 MUST 满足 `CLIP Tool Disclosure Supports ToolSearch-Deferred Lazy Loading`

