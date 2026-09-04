## 1. Baseline Alignment

- [x] 1.1 Document the implemented capability path in `design.md`: `read` descriptor -> `StaticCapabilityCatalog` -> app composition -> context/core query -> invocation result
  - Verification: code review confirms the design references the implemented objects and does not propose replacing them wholesale
- [x] 1.2 Confirm this change does not rename frozen public DTO/port fields in `agent-contracts/capability`
  - Verification: `git diff -- packages/agent-contracts/src/capability` shows only approved provider config DTO/schema additions and the approved catalog contract rename to `CapabilityCatalog`; no descriptor, invocation request, or invocation result fields are renamed
- [x] 1.3 Keep provider config owned by `agent-contracts/capability`
  - Verification: `CapabilityProviderConfig`, `CapabilityDiscoveryMode`, `CapabilityProviderOptions`, and provider option DTO/schema exports live under `packages/agent-contracts/src/capability`; `packages/agent-contracts/src/app` does not export a same-named provider config DTO

## 2. Provider Config And Factory Inputs

- [x] 2.1 Define provider config core DTO/schema in `agent-contracts/capability`
  - Verification: `CapabilityProviderConfig` uses `{ provider, discoveryMode, options }`; `CapabilityProviderOptions` distinguishes `LOCAL_DIRECTORY`, `SKILL_HUB`, `MCP_SERVER`, `AGENT_REGISTRY`, and `CUSTOM`; option object names are `SkillHubOptions`, `McpServerOptions`, and `AgentRegistryOptions`; config rejects `provider.providerKind=BUNDLED`; `CUSTOM` requires `provider.providerType` and `CustomProviderOptions.customOptions`
- [x] 2.2 Add provider config validation/normalization for discovery/executor factory inputs
  - Verification: tests cover `capabilityProviderConfigs` normalization, duplicate `provider.providerId` rejection, `provider.providerKind=BUNDLED` config rejection, provider-kind-specific options validation, and `CUSTOM` without matching adapter rejection
- [x] 2.3 Ensure `CapabilityProvider` remains lightweight descriptor identity only
  - Verification: descriptor provider contains only `providerId`, `providerKind`, and optional `providerType`; endpoint, credential, path, cache, and options do not enter descriptors
- [x] 2.4 Add trusted builtin provider for the `read` path inside `agent-capability`
  - Verification: builtin provider is created by `createCapabilitySubsystem([])` without external config, uses `providerId=builtin-tools`, `providerKind=BUNDLED`, `discoveryMode=EAGER`, and reaches discovery through the same provider -> discovery path
- [x] 2.4.1 Use the target builtin tools provider identity for `read`
  - Verification: `read` descriptor, default Agent capability binding, app resource view, and related tests use `providerId=builtin-tools`; `read` remains the only builtin tool descriptor discovered in this change
- [x] 2.5 Keep external config loading behavior out of this change
  - Verification: no task or implementation reads provider config files, applies env layering, tenant/Agent overrides, secret resolution, or hot reload; those behaviors remain assigned to `add-ts-capability-source-configuration`
- [x] 2.6 Keep capability subsystem app impact limited to capability port composition
  - Verification: `agent-app` calls `createCapabilitySubsystem(capabilityProviderConfigs)` and injects returned `CapabilityCatalog` / `CapabilityInvocationPort`; excluding separately scoped 6.4.1/6.6/6.7 owner-scope, run-state, and Agent constructor/runtime dependency refinements, runtime, context, model, gateway, observability, attachment, memory, and other non-capability subsystem composition remain unchanged except for consuming the same capability objects

## 2A. Assembly Compilation Boundary

- [x] 2A.1 Remove capability descriptor pre-discovery as an Agent assembly compilation prerequisite
  - Verification: assembly compiler validates capability binding shape, kind, provider id, and enabled binding intent, but does not require matching capability descriptors in `ResourceInventory` before producing `AgentAssembly.capabilityBindings`
- [x] 2A.2 Keep capability descriptor existence and executability in catalog runtime gates
  - Verification: tests prove a missing discovered descriptor does not fail assembly compilation, but is absent from `catalog.listAvailable` and cannot be resolved for invocation
- [x] 2A.3 Preserve `resource-inventory` as an app assembly resource view without capability provider governance
  - Verification: resource inventory may still validate model profiles, prompt templates, and other assembly resources, but capability provider `enabled` / `disabledCapabilityIds` no longer controls capability visibility or assembly compilation

## 3. Discovery Skeleton

- [x] 3.1 Add implementation-side `CapabilityDiscovery` and `CapabilityDiscoveryFactory` skeletons
  - Verification: one discovery factory creates discovery instances from builtin/configured `CapabilityProvider` by exact `provider.providerKind` and, for `CUSTOM`, exact `provider.providerType`; tests cover supported provider creation and unsupported provider kind/type failure; discovery instances are scoped to one provider identity
- [x] 3.2 Implement minimal builtin EAGER discovery for the `read` descriptor
  - Verification: `createCapabilitySubsystem([])` creates `providerId=builtin-tools` / `providerKind=BUNDLED`, calls the single discovery factory with `discoveryMode=EAGER`, obtains only the `read` descriptor with `providerId=builtin-tools`, and does not let Agent assembly bindings change builtin discovery output
- [x] 3.3 Add SEARCH discovery registration seam evaluated by catalog queries
  - Verification: SEARCH discovery instances are not executed at startup; `catalog.listAvailable` calls the SEARCH discovery hook for providers bound by the current Agent assembly and merges returned descriptors through the normal catalog gates
- [x] 3.4 Prove discovery does not own global visibility, conflict, or final availability decisions
  - Verification: unit tests or architecture assertions show discovery only returns descriptors/facts and catalog applies gates

## 4. Catalog Governance Skeleton

- [x] 4.1 Evolve the existing `StaticCapabilityCatalog` path inside `agent-capability`; do not add catalog implementation classes to `agent-contracts`
  - Verification: implementation remains in `packages/agent-capability`; `agent-contracts` only exports DTO/schema/port contracts
- [x] 4.2 Ensure `listAvailable` filters by current Agent assembly bindings, provider identity when present, and `availabilityStatus=AVAILABLE`
  - Verification: tests cover bound available, unbound, and unavailable descriptors
- [x] 4.3 Ensure `listAvailable` produces a conflict-resolved visible/executable view that is unique by `capabilityId` for the current request scope
  - Verification: tests or review confirm catalog can use provider identity internally, but does not expose ambiguous executable descriptors to core/context
- [x] 4.4 Ensure `resolve` applies the same gate as `listAvailable` and resolves by existing `CapabilityResolveRequest.capabilityId`
  - Verification: tests prove an unavailable, unbound, unresolved-conflict, or SEARCH-only capability absent from the current visible executable view cannot be resolved for invocation
- [x] 4.5 Add one shared conflict extension point used by eager registration and future search result merge
  - Verification: no concrete priority/shadowing behavior is implemented in this change; conflict-specific behavior remains deferred
- [x] 4.6 Ensure SEARCH candidates are scoped to current Agent bindings
  - Verification: tests prove `listAvailable` passes current tenant, subject, assembly, and bound capability ids to SEARCH discovery; descriptors returned for unbound provider/capability ids are not visible or resolvable

## 5. Execution Skeleton

- [x] 5.1 Add implementation-side executor factory and invocation routing skeleton
  - Verification: one executor factory receives the resolved `CapabilityDescriptor` and returns an executor by exact `descriptor.provider.providerId` plus `descriptor.kind`; tests cover one match, no match safe failure, duplicate match safe failure, and prove invocation does not pick an executor only because it shares `providerKind`
- [x] 5.2 Keep existing `CapabilityInvocationPort` as the only core/runtime invocation boundary
  - Verification: `agent-core` still calls `CapabilityInvocationPort.invoke(request, signal)` and does not import provider-specific executor implementation
- [x] 5.3 Wire `read` invocation through the skeleton or preserve it behind a documented adapter seam
  - Verification: read capability tests pass and prove `read` returns a `CapabilityInvocationResult`
- [x] 5.4 Ensure executor implementations do not write runtime timeline, session messages, checkpoints, audit sinks, or terminal commits
  - Verification: architecture assertions or code review confirm executor packages do not depend on runtime/session write ports or audit sink implementations

## 6. Result Consumption

- [x] 6.1 Update `agent-core` result consumption rules for `CapabilityInvocationResult`
  - Verification: tests cover `SUCCEEDED`, `DEGRADED`, `FAILED`, and `TIMED_OUT`; `SUCCEEDED` and `DEGRADED` produce safe model-visible capability result content, `DEGRADED` emits a degradation notice, and `FAILED` / `TIMED_OUT` terminate the current Agent loop through a safe failure path
- [x] 6.2 Enforce request-local `generatedMessages` consumption
  - Verification: tests reject non-`USER` generated messages; accepted generated messages are appended to later model request messages in the same request/run and are not persisted as user session messages or executor-owned writes
- [x] 6.3 Enforce `contextPatch.allowedTools` authority limits
  - Verification: tests prove `contextPatch.allowedTools` can only narrow to capability ids that are both authorized by the current Agent assembly and visible through catalog gates; invalid expansion fails safely and does not mutate catalog or assembly state
- [x] 6.4 Enforce governed model context patch fields
  - Verification: tests prove `contextPatch.modelName` and `contextPatch.modelOptions` are applied only after validation through the existing `agent-context-engine` `ModelSelectionResolver` path; `agent-core` stores the patch as request-local state, passes it into the next context assembly/render step, and receives effective model info/options only after the resolver accepts the patch for the current `AgentAssembly`; invalid, unauthorized, or ungoverned model patches produce a safe capability failure and do not mutate Agent assembly, catalog, provider config, session config, or global model profile state
  - Verification: code review confirms this change does not introduce a public `ModelGovernancePort`; any broader model selection policy interface remains deferred to `add-ts-model-selection-governance`
- [x] 6.4.1 Carry trusted owner scope on context assembly requests
  - Verification: `ContextAssemblyRequest` includes `identityContext`; `agent-core` passes `RequestContext.identityContext` into context assembly; `agent-app` no longer stores per-run owner scope in a composition-local map; owner-scope tests cover runtime missing-owner failure and context assembly request-carried owner success
- [x] 6.5 Ensure `resultRef`, `artifactRefs`, `fallbackTriggered`, and safe metadata are treated as safe result metadata
  - Verification: tests or code review prove core passes only safe refs/summaries, does not read raw referenced content, does not expand local paths, and enforces metadata size/safety constraints during capability result handling
- [x] 6.6 Introduce runtime-owned `AgentRunStatePort` for Agent Core timeline/message/checkpoint side effects
  - Verification: `Agent.execute` accepts only `run`, `context`, and `signal`; `DefaultAgent` receives `AgentRunStatePort` through construction; runtime creates one `RuntimeOwnedAgentRunStatePort` run state write service and isolates terminal output through per-run accumulators; `agent-app` no longer synthesizes a submit-command-shaped object for core checkpoint writes; `npm run build` and targeted contract/runtime/core tests pass
- [x] 6.7 Move Agent instantiation lifecycle into runtime through registered constructors
  - Verification: `agent-contracts/runtime` exposes `AgentConstructor` with class-level `getType()`; `AgentAssembly` carries `agentType`; `agent-app` passes `AgentConstructor[]` and Agent runtime dependencies into runtime; `agent-runtime` owns `AgentInstanceManager`, resolves constructors by `assembly.agentType`, caches by `agentId + agentVersion + agentAssemblyRef`, and does not import `agent-core` or `agent-app`; `agent-core` provides `BaseAgent` and `DefaultAgent.getType()`; build, targeted runtime/core tests, architecture lint, and OpenSpec strict validation pass
- [x] 6.8 Derive capability audit from canonical runtime events
  - Verification: capability executors and `agent-core` do not depend on or call `AuditEventWriter` for capability audit; `agent-core` emits safe `CAPABILITY_COMPLETED` events for success/degraded/failed/timed-out results; runtime exposes a canonical timeline observer boundary; `agent-observability` derives `capability.completed`, `capability.failed`, and `security.rejected` audit events from canonical `CAPABILITY_COMPLETED`; tool-loop tests cover derived audit events and architecture lint passes

## 7. Deferred Scope Guardrails

- [x] 7.1 Remove Skill INLINE/FORK, nested invocation facts, content loader, and Skill tool handler implementation tasks from this change
  - Verification: tasks and specs refer to those behaviors only as deferred to Skill-specific changes
- [x] 7.2 Remove concrete MCP, SkillHub, local directory, Agent registry, remote cache/refresh, sandbox, audit, idempotency recovery, and conflict priority implementation tasks from this change
  - Verification: tasks only define skeleton seams and read-path validation
- [x] 7.3 Keep provider config file loading and dynamic configuration behavior deferred
  - Verification: tasks and specs require this change to define/normalize `CapabilityProviderConfig` while rejecting `provider.providerKind=BUNDLED`; external config file format/loading, env layering, tenant/Agent overrides, secret resolver, and hot reload remain deferred to `add-ts-capability-source-configuration`; builtin providers remain created only inside `agent-capability`

## 8. Validation

- [x] 8.1 Run package/unit tests covering capability catalog, discovery skeleton, executor skeleton, read invocation, and core result consumption
  - Verification: `npm test`
- [x] 8.2 Run contract tests for capability descriptor/catalog/invocation result behavior
  - Verification: `npm run test:contract`
- [x] 8.3 Run architecture lint to ensure implementation classes do not enter `agent-contracts` and executor/discovery boundaries do not depend on forbidden modules
  - Verification: `npm run lint:architecture`
- [x] 8.4 Validate OpenSpec change
  - Verification: `openspec validate add-ts-capability-core-governance --strict`

## 归档前基线提升检查（非实施任务）

归档时需要把长期有效内容提炼到以下基线：

- `openspec/specs/capability-catalog/spec.md`
- `openspec/specs/capability-descriptor/spec.md`
- `openspec/designs/contracts/capability-spi.md`
