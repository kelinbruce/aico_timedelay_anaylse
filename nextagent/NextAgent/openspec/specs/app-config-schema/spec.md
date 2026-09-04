# app-config-schema Specification

## Purpose

Define the stable startup app composition configuration baseline. This spec owns startup-only loading/validation/freeze, configuration ownership layers, first-release configuration groups, deterministic validation order, immutable `DefaultSystemConfig` projections, derived path and execution workspace rules, sandbox/observability/RAG/capability-provider configuration gates, and safe readiness diagnostics before the app can enter ready state.
## Requirements
### Requirement: App composition configuration is validated and frozen before ready state

The system SHALL execute app composition configuration loading, validation, and freeze exactly once during startup/bootstrap, outside the request lifecycle, before the system enters ready state or accepts any request, stream, history, or control operation.

This flow MUST be synchronous for the current process start and MUST complete before app composition, Agent assembly resolution, or readiness publication become externally visible.

#### Scenario: Startup reaches ready with a validated configuration fact

- **WHEN** the system reports ready after startup
- **THEN** app composition configuration has already been loaded, validated, and frozen
- **AND** downstream modules consume owning-boundary projections derived from `DefaultSystemConfig` rather than raw source configuration

#### Scenario: Normal request traffic does not trigger configuration validation

- **WHEN** a user submits a request, resumes a stream, reads history, or sends a control command
- **THEN** the system does not re-run app composition configuration validation as part of that request lifecycle

### Requirement: Configuration ownership stays split across framework, app composition, and Agent package layers

The system SHALL keep configuration ownership in three explicit layers:

- `framework/runtime config`
- `app composition config`
- `Agent package config`

`app composition config` SHALL be the only layer owned by the app composition boundary. Agent package configuration MUST NOT override deployment branch selection, gateway credential policy, channel transport boundary, or framework-owned runtime knobs.

#### Scenario: Ownership violations are rejected during startup

- **WHEN** a configuration key or value crosses an ownership boundary it does not own
- **THEN** startup validation MUST reject that configuration
- **AND** the system MUST return a safe configuration failure rather than silently reinterpreting the input

### Requirement: App composition schema exposes a stable first-release group baseline

The app composition configuration schema SHALL expose the following stable groups for the first release:

- `deployment`
- `paths`
- `identity`
- `channel`
- `hostedAgent`
- `modelProfiles`
- `nextAgent.system.capability-providers`
- `gateway`
- `observability`
- `rag`

Each group MUST have a stable owning contract under the configuration boundary. Future changes MAY extend a group or its narrow owning-boundary projection, but they MUST NOT bypass this baseline by introducing a competing app-level configuration fact source.

The `observability` group SHALL expose one operational logging object at `observability.logging`. It MUST NOT expose a parallel `observability.runtimeLogging` object.

Metrics exporter selection SHALL NOT introduce a second user-controlled app-level mode field in this change. Trusted composition SHALL derive the required profile from `deployment.mode`: LOCAL uses the fixed rolling history family `<paths.logDirectory>/nextagent-metrics.<YYYY-MM-DD>.<sequence>.ndjson[.gz]`; REMOTE requires an OTLP metric exporter injected by the remote deployment entrypoint; tests may inject an in-memory exporter. The LOCAL metrics base, extension, 60-second interval, 4 MiB line budget, 8 MiB buffer, 30 MiB/process-local daily rotation, gzip, at most 10 committed gzip archives and 7 elapsed-day retention are implementation-owned. Core app config MUST reject unknown user-supplied metrics file, exporter, endpoint, credential, interval, rotation, timezone, compression, retention or fallback fields. Standard OTel endpoint/header/compression environment variables remain owned and safely validated by the remote deployment package before injection.

`observability.logging` SHALL have the following shape after built-in and user application config composition:

- `diagnosticDetail`: optional `normal | debug`; absent means `normal`. This field only controls which already-safe policy-approved diagnostic fields remain visible. It MUST NOT disable or relax redaction, safe error mapping, field filtering or output budgets.
- `level`: optional `error | warn | info | debug`; absent means `info`.
- `console.enabled`: required boolean in the merged active configuration.
- `file.enabled`: required boolean in the merged active configuration.
- `file.directory`: optional safe path projection; absent means frozen `paths.logDirectory`; the resolved directory MUST remain under the trusted runtime path boundary.
- `file.name`: optional safe logical base name ending in `.jsonl`; absent means `nextagent-operational.log.jsonl`; pino-roll derives numbered physical segments from it, and it MUST NOT name or collide with an audit file.
- `file.rotation.maxFileSizeMiB`: optional integer from `1` through `30`; absent means `30`; implementation additionally applies a fixed daily safety rotation at process-local midnight that is not configurable. Size and midnight are independent rotation triggers.
- `file.retentionDays`: optional integer greater than or equal to 7; absent means `7`.
- `file.maxArchiveFiles`: optional integer from `1` through `10`; absent means `10`. It limits only committed gzip archives in the operational file family; metrics, audit and developer diagnostic owners independently use the fixed value `10`.

Gzip archive, fixed Node.js process-local daily safety rotation, timezone selection, 16 KiB entry budget and 4 MiB per-destination async buffer are implementation-owned and are not configurable in this release. User-supplied compression, frequency/time-rotation, timezone, count-deletion fields other than `maxArchiveFiles`, storage-watermark, entry-size, queue-size or backpressure-policy fields MUST be rejected rather than silently ignored.

Trusted entrypoint config sources SHALL provide these defaults:

- development (`dev:watch` / `dev:fullstack`): `console.enabled=true`, `file.enabled=false`;
- local runtime package (`backend-only` / `with-frontend`): `console.enabled=false`, `file.enabled=true`;
- test composition: silent unless the test explicitly requests or injects a sink.

Downstream packages MUST consume only the frozen `observability.logging` projection. The obsolete `observability.runtimeLogging` object and `observability.logging.redaction` field MUST be rejected as unknown configuration rather than accepted as aliases. Request body, client metadata, model output, capability input and other runtime user input MUST NOT override diagnostic detail, sink selection, threshold, path or retention.

Audit file/service selection SHALL remain deployment-owned and outside `observability.logging`. LOCAL SHALL use the fixed gateway-owned audit family under `paths.logDirectory` with 30 MiB/process-local daily rotation, gzip, at most 10 committed gzip archives and 7 elapsed-day retention; core application configuration and runtime input MUST NOT expose or accept audit file name, path, size/daily rotation, compression, retention, query, deduplication or fallback controls. REMOTE audit service configuration belongs to the remote gateway boundary and MUST NOT cause core app fallback to a local file or SQLite.

The `rag` group for this change SHALL expose only `rag.indexes`. That field is a frozen app-composition default logical index list used by the builtin `rag` Tool only when Tool input omits `indexes`. It MUST contain 1-5 unique provider-neutral logical index names. Each name MUST be non-empty, bounded to 128 characters, and use only the safe logical-index character set accepted by startup validation. If omitted, startup validation SHALL derive `rag.indexes=["local"]`. This configuration MUST NOT contain provider-private index bindings, endpoints, credentials, workspace paths, SQLite paths, raw FTS expressions or retrieval parameters.

#### Scenario: Disabled or inactive configuration branches remain non-authoritative

- **WHEN** a configuration entry is disabled or belongs to an inactive deployment branch
- **THEN** it MAY remain in source configuration
- **AND** it MUST NOT become part of the active validated runtime config for the current process

#### Scenario: observability diagnostic detail defaults to normal mode

- **WHEN** startup validates a configuration source set that omits `observability.logging.diagnosticDetail`
- **THEN** the frozen runtime configuration MUST behave as if `observability.logging.diagnosticDetail=normal`
- **AND** startup MUST NOT infer debug mode from environment, logger sink behavior or runtime failures

#### Scenario: Legacy logging configuration is rejected

- **WHEN** startup receives `observability.runtimeLogging` or `observability.logging.redaction`
- **THEN** startup validation MUST reject the configuration before ready state
- **AND** it MUST NOT merge, translate or prefer either legacy key over `observability.logging`

#### Scenario: Development entrypoint enables console without file

- **WHEN** the trusted development entrypoint composes its built-in runtime logging defaults
- **THEN** the frozen config MUST set `console.enabled=true` and `file.enabled=false`
- **AND** product code MUST NOT create an operational file unless user application config explicitly enables file logging

#### Scenario: Local package enables the operational file

- **WHEN** a backend-only or with-frontend local runtime package uses its built-in config
- **THEN** the frozen config MUST set `console.enabled=false` and `file.enabled=true`
- **AND** it MUST use `nextagent-operational.log.jsonl`, `maxFileSizeMiB=30`, fixed process-local-midnight daily safety rotation, `retentionDays=7` and `maxArchiveFiles=10` unless trusted user application config supplies valid overrides for the configurable fields

#### Scenario: Invalid runtime logging configuration fails closed

- **WHEN** startup receives an unknown level, non-boolean sink flag, unsafe directory/name, `maxFileSizeMiB` outside `1..30`, `retentionDays < 7`, `maxArchiveFiles` outside `1..10` or non-integer, compression option, user frequency/time-rotation/timezone option, storage watermark option, entry/queue size or backpressure option
- **THEN** startup validation MUST reject the active input before ready state
- **AND** the diagnostic MUST NOT expose raw path, credential, token, prompt, model output or stack trace

#### Scenario: Runtime input cannot mutate logging policy

- **WHEN** request body, client metadata, model output or capability input includes logging sink, path, threshold or retention overrides
- **THEN** those values MUST NOT change the frozen runtime logging policy

#### Scenario: Deployment mode selects metrics exporter boundary

- **WHEN** trusted startup freezes `deployment.mode=LOCAL`
- **THEN** app composition MUST select the fixed local rolling metrics history exporter
- **AND** request/config extensions MUST NOT redirect metrics to OTLP or another file
- **AND** request/config extensions MUST NOT override its interval, line/buffer budget, rotation, compression or retention
- **WHEN** trusted startup freezes `deployment.mode=REMOTE`
- **THEN** the remote entrypoint MUST inject an OTLP metric exporter
- **AND** core app composition MUST NOT fall back to the local metrics file

#### Scenario: Deployment mode selects the audit gateway boundary

- **WHEN** trusted startup freezes `deployment.mode=LOCAL`
- **THEN** gateway composition MUST select the fixed local file AuditEventStoreGateway
- **AND** request/config extensions MUST NOT redirect audit to SQLite, operational logging, metrics or another file
- **AND** request/config extensions MUST NOT override its fixed 30 MiB/daily rotation, at-most-10 archive count, gzip, 7 elapsed-day retention or duplicate semantics
- **WHEN** trusted startup freezes `deployment.mode=REMOTE`
- **THEN** core app MUST consume only an entrypoint-provided remote audit gateway when available
- **AND** it MUST NOT fall back to local audit file, SQLite or RuntimeLogger

#### Scenario: RAG default logical indexes are frozen

- **WHEN** startup validates a configuration source set with `rag.indexes=["local", "remote-netops"]`
- **THEN** the frozen runtime configuration MUST expose those values as the current process RAG default logical indexes
- **AND** downstream RAG Tool composition MAY use them only when Tool input omits `indexes`
- **AND** runtime requests, model output and Tool input MUST NOT mutate the frozen default list

#### Scenario: RAG default logical indexes fail closed

- **WHEN** startup validates a configuration source set with empty, duplicate, over-limit or unsafe `rag.indexes`
- **THEN** startup validation MUST reject the input safely before ready state
- **AND** the system MUST NOT reinterpret invalid values as provider-private index bindings or host paths

### Requirement: Validation follows a deterministic rule order

Startup validation MUST apply app composition rules in the following order:

1. resolve the startup configuration source set and precedence
2. enforce configuration ownership boundaries
3. validate mandatory top-level groups: `deployment`, `paths`, `identity`, `channel`, `hostedAgent`
4. determine the active deployment branch and selected adapter/source branches
5. apply full validation to active branches and structure-only validation to inactive branches
6. validate `modelProfiles` viability and derive the enabled runtime model profile set
7. validate app-level user capability source configuration and `gateway` selectors and references
8. validate required active-branch secret references, path references, and selected dependency references
9. derive readiness state and collect safe diagnostics
10. freeze `DefaultSystemConfig` and produce `ConfigValidationEvidence` as the readiness/release safety projection

The system MUST NOT defer these decisions to the first live request.

#### Scenario: No viable enabled model profile blocks ready state

- **WHEN** validation completes and the active configuration branch has no viable enabled model profile
- **THEN** startup MUST produce `BLOCKED`
- **AND** the system MUST NOT enter ready state

#### Scenario: Inactive remote branch does not block a local startup

- **WHEN** the current deployment branch selects a local gateway path and a remote-only branch is present but unresolved
- **THEN** the remote-only branch MAY produce a non-blocking diagnostic
- **AND** it MUST NOT block ready state for the active local branch

### Requirement: Sandbox function disable switch is startup validated and frozen

The local app composition configuration SHALL treat `sandbox.enabled` as the frozen validation-mode switch for the restricted local sandbox. If omitted, startup validation MUST derive `true`. If present with any non-boolean value or under an otherwise invalid `sandbox` shape, startup validation MUST fail safely before ready state. The derived value MUST be frozen into `DefaultSystemConfig.sandbox.enabled` and consumed by app composition when assembling the local sandbox gateway and Bash tool policy mode. Runtime requests MUST NOT re-read source configuration or mutate this value.

When `sandbox.enabled=true`, the local restricted sandbox and Bash tool MUST keep their strict validation behavior. When `sandbox.enabled=false`, local app composition MUST place the restricted local sandbox into trusted shell mode for Bash execution while still preserving sandbox gateway ownership.

#### Scenario: Missing sandbox enabled switch defaults to strict validation

- **WHEN** startup validates configuration without `sandbox.enabled`
- **THEN** the frozen config contains `sandbox.enabled=true`
- **AND** downstream sandbox composition consumes strict validation mode

#### Scenario: Disabled sandbox validation freezes trusted shell mode

- **WHEN** startup validates configuration with `sandbox.enabled=false`
- **THEN** the frozen config contains `sandbox.enabled=false`
- **AND** app composition passes that mode into the local restricted sandbox and Bash tool
- **AND** runtime requests cannot override it

### Requirement: Built-in defaults and user application config compose into two frozen roots

The system SHALL treat `packages/agent-app/config/default-system.yaml` as an internal default system configuration source, not as a user-editable configuration file. User system configuration MAY be supplied through `application.yaml`; when present, that file is an overlay over `default-system.yaml` and its containing directory defines the frozen `configRoot`.

The final frozen configuration SHALL expose two user-comprehensible roots:

- `configRoot`: configuration input root containing `application.yaml`, `skills/`, and `agents/`.
- `workspaceRoot`: runtime output root containing runtime data, SQLite data, logs, execution workspace state, and other runtime state.

`paths.workspaceRoot` is the only user-facing path entry in this model. `paths.systemSkillsRoot`, `paths.agentsRoot`, `paths.workingMemorySqliteFile`, `paths.longTermMemorySqliteFile`, `paths.sqliteFile`, `paths.runtimeWorkspaceRoot`, `paths.executionRoot`, and any other execution-root path entries MUST NOT be accepted as writable user path entries. App composition SHALL derive:

- `systemSkillsRoot = configRoot/skills`
- `agentsRoot = configRoot/agents`
- `workingMemorySqliteFile = workspaceRoot/data/system/working-memory.sqlite`
- `longTermMemorySqliteFile = workspaceRoot/data/system/long-term-memory.sqlite`
- `sqliteFile = workspaceRoot/data/system/nextagent.sqlite`
- `runtimeWorkspaceRoot = workspaceRoot/execution`

`runtimeWorkspaceRoot` is the physical base for execution file roots. It MUST be derived only after `workspaceRoot` is normalized and frozen. It MUST NOT be read from user config, client input, model output, Skill metadata, capability arguments, or gateway responses.

The runtime directory layout constrained by this change SHALL be:

```text
<workspaceRoot>/
  data/
    system/
      working-memory.sqlite
      long-term-memory.sqlite
      nextagent.sqlite
  execution/
    <scope-key>/
      workspace/
      .nextagent/
        skills/
          <skillProjectionKey>/
            <skill-name>/
              scripts/
              references/
              assets/
      temp/
        <run-key>/
```

This layout defines only the directories required by execution file roots and the provider-owned SQLite locations. Other runtime outputs MAY exist only when owned by their own specs and MUST NOT overlap `execution/`, the SQLite parent, config roots, provider-private roots, or source-private roots.

Startup validation SHALL fail closed when the normalized or realpath-derived `runtimeWorkspaceRoot` overlaps `dataDir`, `systemDataDir`, the SQLite parent directory, `configRoot/skills`, `configRoot/agents`, provider-private source roots, or source-private Skill/package roots. Startup validation SHALL also fail closed if `runtimeWorkspaceRoot` already exists as a file, symlink, junction, reparse point, or resolves outside normalized `workspaceRoot`.

Raw `capabilityProviders.providers` MUST NOT be a `default-system.yaml` or `application.yaml` entry for framework or reserved providers. Built-in and reserved providers such as `builtin-tools`, `builtin-skills`, `builtin-agents`, `local-skills-system`, `local-skills-agent-owned`, `local-agents`, `local-subagents`, and `memory-tools` are owner-owned startup provider contributions assembled by `agent-capability` from trusted internal contributions, external owner contributions, and config-driven provider inputs. Internal and external owner contributions are known before config-driven provider configs are normalized, so user config cannot override reserved provider identities. `agent-app` MUST NOT maintain a separate hand-authored framework/reserved provider list as the authoritative provider registry.

#### Scenario: application.yaml overlays default-system.yaml

- **WHEN** startup supplies a user `application.yaml`
- **THEN** app composition MUST apply it as an overlay over the internal `default-system.yaml`
- **AND** the resulting frozen config MUST use the `application.yaml` containing directory as `configRoot`
- **AND** absent user fields MUST continue to come from the internal default source

#### Scenario: Derived paths are not user path entries

- **WHEN** user configuration contains any internal derived SQLite path, `paths.systemSkillsRoot`, `paths.agentsRoot`, `paths.runtimeWorkspaceRoot`, `paths.executionRoot`, or another execution-root path entry
- **THEN** startup validation MUST reject the input safely
- **AND** app composition MUST continue to derive those paths only from frozen `configRoot` and `workspaceRoot`

#### Scenario: Runtime workspace root is derived from workspaceRoot

- **WHEN** final system config freezes `paths.workspaceRoot`
- **THEN** app composition MUST derive `runtimeWorkspaceRoot` as `<workspaceRoot>/execution`
- **AND** execution `scopeBase` values MUST be created under that derived root
- **AND** all three SQLite files MUST remain under `<workspaceRoot>/data/system/`
- **AND** execution roots MUST follow `<workspaceRoot>/execution/<scope-key>/{workspace,.nextagent,temp/<run-key>}`

#### Scenario: Runtime workspace root does not overlap system data

- **WHEN** startup validates derived runtime paths
- **THEN** `runtimeWorkspaceRoot` MUST be separate from `dataDir`, `systemDataDir`, and the SQLite parent directory
- **AND** `runtimeWorkspaceRoot` MUST NOT resolve outside normalized `workspaceRoot`
- **AND** unsafe files, symlinks, junctions, reparse points, or overlapping directories MUST fail closed with safe diagnostics

#### Scenario: default-system does not declare framework providers

- **WHEN** product composition loads the built-in `default-system.yaml`
- **THEN** the file MUST NOT contain raw `capabilityProviders.providers`
- **AND** app readiness MUST NOT depend on a user raw config entry for `providerId=builtin-tools`
- **AND** framework providers MUST be registered through owner-owned startup provider contributions assembled by the capability subsystem

The built-in `default-system.yaml` for this release SHALL carry the default `observability.logging.redaction=normal`. User `application.yaml` MAY override that field. The frozen config MUST preserve the final enum value after overlay as the only authoritative logging-mode input for the current process.

#### Scenario: application config can enable safe debug logging

- **WHEN** user `application.yaml` sets `observability.logging.redaction=debug`
- **THEN** the frozen runtime configuration MUST mark the current process logging mode as `debug`
- **AND** startup MUST NOT reinterpret that setting as permission to disable redaction or emit raw sensitive fields

### Requirement: Configuration artifacts have explicit safe shapes and lifecycle semantics

The system SHALL keep the following minimum artifact semantics:

- `RawDefaultSystemConfig`
  - is the parsed source input and MUST NOT be treated as validated runtime fact
- `DefaultSystemConfig`
  - contains deployment mode, runtime paths, local auth/identity config, channel config, hosted agent ref, validated model profiles, validated user capability source configuration, selected gateway config, noop boundary config, and release/readiness evidence input
  - contains secret references only, never resolved secret values
  - remains internal to `agent-app` and is not exported from `agent-contracts`
- readiness state
  - MUST be one of `READY`, `DEGRADED_READY`, or `BLOCKED`
- safe diagnostics
  - contain reason code, scope or field ref, safe message, and readiness impact
- `ConfigValidationEvidence`
  - contains readiness state, safe issues, declared degradations, optional evidence refs, and evaluation time

These artifacts are startup/readiness diagnostics, not request truth, checkpoint payloads, pending input objects, memory records, or user-visible conversation history.

#### Scenario: Configuration diagnostics stay traceable but non-business

- **WHEN** the system surfaces configuration diagnostics to readiness checks or release qualification
- **THEN** those diagnostics MUST remain traceable through stable refs or issue fields
- **AND** they MUST NOT become part of request history, terminal messages, or canonical runtime timeline facts

### Requirement: Safe configuration failures and diagnostics are explicit

Configuration failures and diagnostics MUST be presentation-safe and explicit. The system SHALL emit safe configuration failures or safe diagnostics instead of raw exceptions, raw provider bodies, raw local paths, or raw credential material.

Syntactic or schema failures MUST surface as validation-safe failures. Missing or unresolved active critical dependency references MUST surface as safe unavailable or validation failures. The system MUST NOT silently discard invalid active configuration.

#### Scenario: Invalid active secret reference blocks startup safely

- **WHEN** an active selected branch requires a secret reference that is missing, malformed, or not resolvable
- **THEN** startup MUST return a safe configuration failure
- **AND** the failure MUST NOT expose the raw secret value, unresolved file content, or framework-native exception text

### Requirement: Degradation and blocking rules are explicit and fail-closed

The system SHALL use the following bounded outcome rules:

- missing mandatory top-level group -> `BLOCKED`
- ownership violation -> `BLOCKED`
- invalid active critical branch -> `BLOCKED`
- invalid active required secret/path/dependency reference -> `BLOCKED`
- invalid inactive branch -> non-blocking diagnostic only
- invalid non-critical active entry with remaining viable active set -> `DEGRADED_READY`

The system MUST fail closed whenever it cannot safely classify or redact a configuration problem.

#### Scenario: Non-critical active entry is removed with degraded-ready result

- **WHEN** a non-critical active configuration entry is invalid but the remaining active set still satisfies the current deployment branch minimum runtime prerequisites
- **THEN** startup MAY continue with `DEGRADED_READY`
- **AND** the dropped entry MUST be absent from `DefaultSystemConfig`
- **AND** the system MUST preserve a safe diagnostic identifying the dropped entry and reason code

### Requirement: Configuration flow integrates with downstream composition and release gates

The frozen app configuration flow SHALL connect the startup path to:

- app composition
- Agent assembly resolution
- model profile selection baseline
- capability provider enablement baseline
- gateway adapter selection baseline
- readiness/health diagnostics
- release qualification evidence

No downstream module MAY create a competing app-level configuration state machine or a request-time fallback path that bypasses the frozen startup result.

The system MUST NOT introduce a public catch-all configuration object or a new `agent-contracts/configuration` owning surface in this change. Any future public configuration contract change requires an explicit contract refinement change.

`ConfigValidationEvidence` SHALL be the single safe configuration evidence shape used inside `agent-app` for readiness publication and release input construction. It SHALL contain readiness state, safe issues, declared degradations, optional evidence refs, and evaluation time. This requirement MUST NOT create an implementation-package dependency on `agent-app`.

Actual candidate startup SHALL expose only an opaque `configValidationEvidenceRef` for package/release handoff. The release input builder SHALL resolve that ref to the same internal `ConfigValidationEvidence`. Package, E2E gate, and qualification consumers MUST NOT copy its fields into or define an alternative configuration evidence shape.

#### Scenario: Ready-state publication waits for configuration freeze

- **WHEN** the system is preparing to publish readiness or startup success
- **THEN** configuration freeze and readiness-state derivation have already completed
- **AND** health/readiness consumers can read a stable readiness state

### Requirement: App composition configuration is restart-scoped, not hot-reloaded implicitly

The app composition configuration fact SHALL be restart-scoped for the first release. Changing app-level configuration after startup MUST require a new process startup/bootstrap cycle before the new configuration becomes authoritative.

#### Scenario: Editing configuration during runtime does not mutate the active config

- **WHEN** an operator edits an app-level configuration source while the process is already serving traffic
- **THEN** the current `DefaultSystemConfig` remains authoritative for that process
- **AND** the new configuration does not become active until a new startup/bootstrap cycle completes

### Requirement: Typical startup outcomes remain explicit and reproducible

The system SHALL produce explicit and reproducible startup outcomes for complete, degraded, and blocked configuration paths.

#### Scenario: Local startup reaches READY with one viable active path

- **WHEN** the active deployment branch has valid mandatory groups, at least one viable enabled model profile, a resolvable active Agent reference, and resolvable active secret/path/dependency references
- **THEN** startup MUST produce readiness state `READY`
- **AND** the system MUST freeze `DefaultSystemConfig` before downstream consumers are composed

#### Scenario: Invalid fallback-only active entry yields DEGRADED_READY

- **WHEN** the active deployment branch still has a viable minimum runtime set, but a non-critical active entry such as a fallback-only model profile is invalid
- **THEN** startup MAY produce readiness state `DEGRADED_READY`
- **AND** the invalid non-critical entry MUST be removed from `DefaultSystemConfig`
- **AND** the system MUST preserve a safe diagnostic for the dropped entry

#### Scenario: The only viable active model path fails and blocks startup

- **WHEN** the only viable enabled active model profile becomes invalid because its configuration, provider kind, or active secret reference is not valid
- **THEN** startup MUST produce readiness state `BLOCKED`
- **AND** the system MUST NOT publish ready state or a usable runtime configuration projection

#### Scenario: Inactive branch failure remains non-blocking

- **WHEN** an inactive deployment branch or inactive adapter/source branch is structurally present but not selected for the current startup path, and that branch is incomplete or not serviceable
- **THEN** the system MAY emit a safe non-blocking diagnostic for that branch
- **AND** the inactive branch failure MUST NOT by itself block the active deployment branch from reaching `READY` or `DEGRADED_READY`

### Requirement: Workspace File Authority Is Trusted And Agent Scoped

Trusted SDK/Agent configuration MAY define `workspaceFiles.readDirectories`, `workspaceFiles.writeDirectories`, and `workspaceFiles.maxTextBytes`. App composition SHALL validate and compile these values into an Agent-scoped workspace file dependency associated with the accepted Agent assembly/version.

`readDirectories` SHALL preserve the existing whole-workspace default when absent. `writeDirectories` SHALL default to empty for Agent definitions that do not explicitly configure it and SHALL be included in the effective Read authority. The built-in `default-agent` definition SHALL explicitly configure `writeDirectories=["."]`, granting write authority only within that Agent's trusted workspace. `maxTextBytes` SHALL default to `256000`, SHALL have a system hard maximum of `256000`, and MAY only be reduced by configuration.

Invalid directory entries, invalid numeric values, or authority escaping the validated workspace SHALL fail compilation of the affected Agent assembly without changing other Agent assemblies.

#### Scenario: Model input cannot expand workspace authority

- **WHEN** a request, model output, Tool input, capability metadata, or client payload contains directory or size authority
- **THEN** app composition and the workspace file dependency MUST ignore it as authorization input
- **AND** only the compiled trusted Agent-scoped configuration may determine effective file authority

#### Scenario: Built-in default Agent receives explicit write authority

- **WHEN** app composition loads the built-in `default-agent` definition
- **THEN** its compiled `writeDirectories` MUST contain only the workspace root `"."`
- **AND** the authority MUST remain scoped to the resolved workspace of that accepted Agent assembly

### Requirement: Recipe YAML Parsing

`agent-app` 的 `parseBuiltInConfig` MUST 提供一个入参为文本字符串、出参为 JavaScript 值的纯解析接口，使用业界标准 YAML 解析器（`js-yaml`）解析非 JSON 内容，替换手写扁平解析器。该接口只负责把文本解析为对象，不关注谁触发解析、不关注解析结果的业务语义。

**接口契约**：
- 入参：`content: string`（文本内容，来源不限）
- 出参：`unknown`（与文本结构对应的 JavaScript 值）
- 纯函数：无 I/O 副作用，无日志，无状态变更

**触发机制**：纯解析接口，不自行触发，由调用方在读取文件后同步调用。不在 request lifecycle 内，无预算检查、无后台 job、无调度机制、无用户动作触发。

**输入与前置条件**：仅需文本字符串，无对象/状态/refs/预算/安全上下文/已完成依赖。文件读取、扫描、信任校验均由调用方在调用前完成。

**输出与副作用**：返回与文本结构对应的 JavaScript 值；不产生事件、状态、日志、audit、metric、用户可见提示或后续可消费 ref；不产生 summary/artifact/checkpoint/pending input/配置状态/诊断状态/memory record/learning event。

**核心判断逻辑**：
1. 先尝试 `JSON.parse`；
2. 若抛错，走 `js-yaml` 的 `load` 解析；
3. 解析结果交由调用方处理。

**流程接入**：本接口是被调用的工具，不接入特定主流程。上游=各调用方（系统配置加载、agent 定义加载、recipe 加载，传入文本字符串）；下游=各调用方（消费解析得到的 JavaScript 值，自行做归一化与 schema 校验）。后续流程如何消费由各调用方 owner 负责，本接口不关心。

**边界**：
- 不关注调用方与触发时机（系统配置、agent 定义、recipe 加载均可是调用方）；
- 不关注解析结果是否为合法 recipe / agent 定义 / 系统配置（由各调用方自行校验）；
- 不关注文件扫描、加载目录、信任校验、失败日志（由各调用方负责）。

**失败与降级**：
- 解析失败 MUST 抛异常交由调用方处理；MUST NOT 静默返回空值或默认值掩盖失败（不得静默吞错）；
- 本接口为同步纯函数，无超时、无不可用、无超预算、无外部依赖缺失风险（`js-yaml` 是本地库）；
- 失败后是否跳过单文件、是否阻断启动、是否记录日志，均由调用方决定，本接口不兜底、不截断、不丢弃。

#### Scenario: Standard YAML Parsing
- **WHEN** 入参是合法 YAML（含缩进块、嵌套 map、块序列、混合标量）
- **THEN** `parseBuiltInConfig` MUST 返回与 YAML 结构对应的 JavaScript 值

#### Scenario: Nested Structure Parsing
- **WHEN** 入参包含嵌套 map（如 `nodes`、`next`、`inputs`、`outputs`）与块式数组
- **THEN** 解析器 MUST 将其解析为对应的嵌套对象与数组

#### Scenario: Scalar Type Inference
- **WHEN** YAML value 是数字字面量（如 `5000`）
- **THEN** 解析器 MUST 将其推断为 number 类型
- **AND** 字符串 value（如 `demo_recipe`）MUST 保持为 string
- **AND** 形如 `1.1.0` 的非合法数字字面量 MUST 保持为 string

#### Scenario: JSON Fallback Preserved
- **WHEN** 入参是合法 JSON
- **THEN** `parseBuiltInConfig` MUST 优先使用 `JSON.parse`
- **AND** 返回值 MUST 与 JSON 结构一致

#### Scenario: Flat YAML Parser Removed
- **WHEN** 入参包含嵌套缩进或块式数组等非扁平语法
- **THEN** `parseBuiltInConfig` MUST NOT 抛 `Built-in YAML uses unsupported syntax.`
- **AND** MUST 成功解析为嵌套结构

#### Scenario: Parse Failure Propagation
- **WHEN** 入参是非法 YAML
- **THEN** `parseBuiltInConfig` MUST 抛异常
- **AND** MUST NOT 静默返回空值或默认值

#### Scenario: Pure Function No Side Effects
- **WHEN** 调用 `parseBuiltInConfig`
- **THEN** 接口 MUST NOT 执行 I/O
- **AND** MUST NOT 记录日志
- **AND** MUST NOT 修改任何状态

### Requirement: Agent workspace file extension authority

可信 Agent 配置 SHALL 支持可选的 `workspaceFiles.readAllowedExtensions`、`workspaceFiles.readDeniedExtensions`、`workspaceFiles.writeAllowedExtensions` 和 `workspaceFiles.writeDeniedExtensions` 字符串数组。每个条目 MUST 匹配 `^\.[a-z0-9]+$`，MUST 使用小写 ASCII，并以目标文件名最终一个 `.` 起始的后缀精确匹配；每个数组内部 MUST NOT 包含重复条目。任一 allowlist 缺省 SHALL 表示未被同类 denylist 拒绝的后缀均获授权；显式空 allowlist SHALL 表示不授权该类操作的任何文件后缀。任一 denylist 缺省 SHALL 等价于空 denylist。配置解析 MUST 拒绝非数组、非字符串、空字符串、无前导点、大写、路径分隔符、glob、仅为 `.` 或同数组重复条目；同一后缀同时存在于同类 allowlist 和 denylist SHALL 被接受，并在运行期由 denylist 优先拒绝。

#### Scenario: Valid extension allowlists and denylists are accepted
- **WHEN** Agent 配置声明 `readAllowedExtensions: [".json", ".log"]`、`readDeniedExtensions: [".pem"]`、`writeAllowedExtensions: [".json"]` 和 `writeDeniedExtensions: [".sh"]`
- **THEN** 配置 SHALL 被接受并保留规范化顺序和值

#### Scenario: Both lists missing preserves unrestricted compatibility
- **WHEN** 一个 Agent 同时缺省某类操作的 allowlist 和 denylist
- **THEN** 该类文件 Tool SHALL 保持所有后缀均获授权的兼容行为

#### Scenario: Denylist without allowlist excludes only denied extensions
- **WHEN** Agent 声明 `readDeniedExtensions: [".pem"]` 且缺省 `readAllowedExtensions`
- **THEN** `.pem` SHALL 被拒绝，其他后缀和无后缀文件 SHALL 获得读取授权

#### Scenario: Allowlist without denylist permits only allowed extensions
- **WHEN** Agent 声明 `readAllowedExtensions: [".json"]` 且缺省 `readDeniedExtensions`
- **THEN** 仅 `.json` SHALL 获得读取授权，其他后缀和无后缀文件 SHALL 被拒绝

#### Scenario: Denylist overrides allowlist
- **WHEN** `.json` 同时出现在同类 allowlist 和 denylist
- **THEN** `.json` MUST 被拒绝；未命中 denylist 的后缀 MUST 继续由 allowlist 决定

#### Scenario: Empty allowlist denies every extension
- **WHEN** Agent 显式声明某类操作的 allowlist 为空数组
- **THEN** 该类文件 Tool SHALL 不授权任何后缀，无论 denylist 是否缺省

#### Scenario: Unsafe extension entry is rejected
- **WHEN** 任一 extension 条目为 `.JSON`、`json`、`.tar.gz`、`*`、`.`、包含 `/` 或与同一数组已有条目重复
- **THEN** 受影响 Agent definition MUST 编译失败且不得进入 runtime-facing assembly

### Requirement: channel.routePrefix 配置公共路径前缀 P

`app composition config` 的 `channel` 组 SHALL 暴露可选字段 `routePrefix`，作为 NextAgent 自身暴露的全部 Web API 路由（主 Web channel、memory、auth-local、IR、health）的统一公共前缀 `P`。`P` 追加在固定 `/api/v1` 段之前，不替换 `/api/v1`：API 形态 `${P}/api/v1/...`。`P` 只影响 Web API 挂载，不改动页面入口、SPA 路由与静态资源托管（仍在根 `/`）。

`routePrefix` MUST 满足：以 `/` 开头，不以 `/` 结尾（单个 `/` 表示"无前缀"，允许），不包含 `..`、`//` 或空段，仅使用 `[A-Za-z0-9/_-]` 字符，长度不超过 64。startup validation MUST 在 ready 之前一次性校验 `routePrefix`，校验失败 MUST 产生阻断性 safe 配置诊断并阻止 ready。`routePrefix` 缺省时 MUST 取默认值 `/`（无前缀），使既有部署零迁移：API 仍在 `/api/v1/...`。

`routePrefix` 冻结后 MUST 进入 `DefaultSystemConfig.channel` 投影，供 app composition 透传给 Web channel、memory、auth-local 与 IR 路由注册；runtime request lifecycle MUST NOT 重新读取或修改 `routePrefix`。`routePrefix` MUST NOT 影响出站外部调用地址（model `baseUrl`、task callback `allowedOrigins`、gateway `endpoint`、rag indexes 等），这些保持各自配置独立。

前端 MUST 通过构建期 `import.meta.env.PREFIX_PATH` 解析同一 `P`（构建阶段注入，固化进产物）；前后端解析的 `P` MUST 一致才能联通，不一致时前端请求将命中 404。

**迁移**：原 `routePrefix: /api/v1` 的语义已从"API 挂载前缀"改为"公共前缀 P"。既有写 `/api/v1` 的配置在新语义下会产生 `/api/v1/api/v1/...` 双重前缀，MUST 迁移为 `/`（无前缀）或目标业务前缀。

#### Scenario: 默认前缀保持既有行为
- **WHEN** startup 校验的配置源未提供 `channel.routePrefix`
- **THEN** 冻结的 `DefaultSystemConfig.channel.routePrefix` MUST 为 `/`
- **AND** 所有 Web API 路由 MUST 挂载在 `/api/v1/...`
- **AND** 页面与静态资源 MUST 挂载在 `/`
- **AND** 既有客户端调用 `/api/v1/...` MUST 不受影响

#### Scenario: 自定义前缀生效（追加，不替换 /api/v1）
- **WHEN** startup 校验的配置源提供 `channel.routePrefix: /svcA`
- **THEN** 冻结的 `DefaultSystemConfig.channel.routePrefix` MUST 为 `/svcA`
- **AND** 主 Web channel、memory、auth-local、health 路由 MUST 挂载在 `/svcA/api/v1/...`
- **AND** IR channel MUST 挂载在 `/svcA/api/v1/ir/...`
- **AND** `/api/v1/...` 路径 MUST 不再命中上述 API 路由（404）
- **AND** 页面与静态资源 MUST 不受影响（仍在根 `/`）

#### Scenario: 非法前缀被拒绝
- **WHEN** startup 校验的配置源提供 `channel.routePrefix` 值含尾斜杠（非单个 `/`）、`..`、`//`、空段或非法字符
- **THEN** startup validation MUST 产生阻断性配置诊断
- **AND** 系统 MUST NOT 进入 ready 状态

#### Scenario: 出站外部调用不受前缀影响
- **WHEN** `channel.routePrefix` 配置为非默认值
- **THEN** model provider `baseUrl`、task callback `allowedOrigins`、gateway `endpoint`、rag indexes 等出站配置 MUST 保持各自独立值
- **AND** 系统 MUST NOT 把 `routePrefix` 拼接到上述出站地址
