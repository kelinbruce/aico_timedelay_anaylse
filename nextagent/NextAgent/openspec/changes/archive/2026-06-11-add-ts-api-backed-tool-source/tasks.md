## 1. Provider Adapter And Configuration

- [x] 1.1 Register `clip_server` as an app-composition custom provider adapter without adding a new `CapabilityProviderKind`.
  来源：spec requirement "CLIP Server Provider Uses The Unified Capability Contract"
- [x] 1.2 Ensure `clip_server` registration is accepted only when matching discovery adapter, executor adapter, and injected runner wiring are present.
  来源：spec scenarios "Registered clip_server provider can activate" and "Adapter registration without wiring is rejected"
- [x] 1.3 Validate `clip_server` configuration from existing `CapabilityProviderConfig.options.customOptions` at the adapter boundary.
  来源：spec requirement "Source Configuration Is Validated At The Adapter Boundary"
- [x] 1.4 Reject missing, malformed, unregistered, or unsafe CLIP source configuration with safe diagnostics and no partial executable descriptors.
  来源：spec scenarios "Unregistered clip_server provider cannot contribute executable tools" and "Invalid configuration blocks source activation"

## 2. Injected Runner And Execution Boundary

- [x] 2.1 Add a `ClipCommandRunner` or equivalent internal injected interface in `agent-capability` for `list`, `describe`, and `execute` operations.
  来源：spec requirement "Startup Discovery Uses An Injected Runner Backed By The Existing Execution Boundary"
- [x] 2.2 Compose the runner production implementation in `agent-app` and back it with the existing sandbox/gateway execution boundary; do not add a CLIP-specific public gateway port.
  来源：spec requirement "Startup Discovery Uses An Injected Runner Backed By The Existing Execution Boundary"
- [x] 2.3 Ensure the runner production implementation does not add a new `SandboxExecutionRequest.executable` value and uses existing sandbox/gateway executable shapes with a controlled command template.
  来源：spec scenario "Sandbox executable vocabulary is not expanded"
- [x] 2.4 Ensure `agent-capability` never executes `clipc` or host-process commands directly and never imports gateway-local implementation.
  来源：spec scenario "Startup scan registers validated tools"
- [x] 2.5 Validate runner responses before they are used by discovery or invocation.
  来源：spec scenarios "Discovered descriptor facts are validated before catalog entry" and "Invocation result is normalized after runner execution"

## 3. Startup Discovery

- [x] 3.1 Implement `ClipBackedToolDiscovery` through the existing `CapabilityDiscoveryFactory` path for `providerType="clip_server"`.
  来源：spec requirement "Startup Discovery Uses An Injected Runner Backed By The Existing Execution Boundary"
- [x] 3.2 Run only startup eager discovery for this change; do not add polling, manual refresh, dynamic unregister, hot update, or cache invalidation flows.
  来源：spec scenario "Periodic sync is outside this change"
- [x] 3.3 Map each valid CLIP API/capability returned by discovery to a separate ordinary `CapabilityDescriptor(kind=TOOL)`.
  来源：spec requirement "Discovered CLIP APIs Become Ordinary Tool Capabilities"
- [x] 3.4 Store capability id to provider-private CLIP id/primitive mapping in a provider-scoped internal registry shared with `ClipToolExecutor`.
  来源：spec scenario "Provider-private mapping stays internal"
- [x] 3.5 Verify no generic `clipc`, `clip_api_call`, or `api_name + args` dispatch Tool descriptor is produced.
  来源：spec scenario "Discovered API capabilities are the model-visible tools"
- [x] 3.6 Exclude or mark unavailable invalid CLIP-backed candidates with safe diagnostics while allowing unrelated valid candidates to remain available.
  来源：spec scenario "Discovery failure marks affected tools unavailable without blocking unrelated tools"

## 4. Invocation

- [x] 4.1 Implement `ClipToolExecutor` so its product entrypoint accepts only `CapabilityInvocationRequest` and `AbortSignal` or the existing executor cancellation context.
  来源：spec requirement "Invocation Uses Unified Request And Result Contracts"
- [x] 4.2 Add `ClipToolExecutor` to the existing `CapabilityExecutorFactory` path for CLIP-backed descriptors.
  来源：spec scenario "CLIP-backed descriptor has an executor"
- [x] 4.3 Derive provider-private CLIP id, primitive, and runner execution request from the provider-scoped internal registry keyed by `CapabilityInvocationRequest.capabilityId`, not from model-supplied command fields.
  来源：spec scenario "Invocation request is normalized before CLIP execution"
- [x] 4.4 Normalize runner execution results into `CapabilityInvocationResult` without exposing raw adapter-private responses.
  来源：spec scenario "Invocation result is normalized after runner execution"
- [x] 4.5 Surface runner, sandbox/gateway execution boundary, or CLIP daemon unavailable as governed unavailable/failure outcomes with safe diagnostics.
  来源：spec scenario "Runner or daemon unavailability is not silent"

## 5. Safety And Observability

- [x] 5.1 Emit safe diagnostics for adapter unregistered, invalid configuration, descriptor validation failure, runner unavailable, and execution failure.
  来源：spec requirement "Failure And Diagnostics Are Explicit And Safe"
- [x] 5.2 Ensure diagnostics include only safe reason code, provider id, capability id, safe counts, and failure class.
  来源：spec requirement "Failure And Diagnostics Are Explicit And Safe"
- [x] 5.3 Ensure diagnostics, descriptors, safe errors, stream output, and model context do not include raw CLIP payloads, credentials, local paths, endpoint secrets, raw arguments, raw tool results, or adapter-private failure details.
  来源：spec scenarios "Discovered descriptor facts are validated before catalog entry" and "Gateway or daemon unavailability is not silent"

## 6. Verification

- [x] 6.1 Add tests for registered and unregistered `clip_server` provider adapter behavior.
  来源：spec requirement "CLIP Server Provider Uses The Unified Capability Contract"
- [x] 6.2 Add tests that `clip_server` registration without discovery adapter, executor adapter, or runner wiring is rejected.
  来源：spec scenario "Adapter registration without wiring is rejected"
- [x] 6.3 Add tests for valid and invalid `customOptions` configuration.
  来源：spec requirement "Source Configuration Is Validated At The Adapter Boundary"
- [x] 6.4 Add tests that A/B/C discovered CLIP APIs become separate ordinary Tool descriptors.
  来源：spec requirement "Discovered CLIP APIs Become Ordinary Tool Capabilities"
- [x] 6.5 Add a negative test that no generic `clipc`, `clip_api_call`, or `api_name + args` Tool descriptor is produced.
  来源：spec scenario "Discovered API capabilities are the model-visible tools"
- [x] 6.6 Add tests that provider-private mapping remains out of descriptor metadata, model context, stream output, safe errors, and user-visible output.
  来源：spec scenario "Provider-private mapping stays internal"
- [x] 6.7 Add tests that invocation derives runner execution from `CapabilityInvocationRequest.capabilityId` and rejects model-supplied routing fields.
  来源：spec scenario "Invocation request is normalized before CLIP execution"
- [x] 6.8 Add tests that a CLIP-backed descriptor resolves to `ClipToolExecutor` through the existing executor factory path.
  来源：spec scenario "CLIP-backed descriptor has an executor"
- [x] 6.9 Add tests for runner unavailable, invalid descriptor, and safe diagnostic redaction behavior.
  来源：spec requirement "Failure And Diagnostics Are Explicit And Safe"
- [x] 6.10 Add an architecture test or architecture lint assertion that `agent-capability` does not import `agent-platform-gateway-local` or execute host commands directly.
  来源：spec requirement "Startup Discovery Uses An Injected Runner Backed By The Existing Execution Boundary"
- [x] 6.11 Add a test or code review check that no new `SandboxExecutionRequest.executable` value is introduced for CLIP.
  来源：spec scenario "Sandbox executable vocabulary is not expanded"
- [x] 6.12 Run `npm run build`, `npm test`, `npm run test:contract`, and `npm run lint:architecture`.
  来源：AGENTS.md 验证门禁
- [x] 6.13 Run `openspec validate add-ts-api-backed-tool-source --strict`.
  来源：AGENTS.md 验证门禁

## Deferred Checks

- [x] 7.1 Confirm this change does not implement polling, manual refresh, dynamic unregister, hot update, long-lived cache invalidation, new `agent-contracts` public types, or a generic model-visible CLIP dispatch Tool.
  来源：proposal 非目标；design Deferred；spec scenario "Periodic sync is outside this change"
