## ADDED Requirements

### Requirement: Skill resource access SHALL expose authorized resources through execution roots

Skill resource access SHALL make authorized Skill resources available through the same execution file access model used by builtin file tools and sandboxed dynamic execution. A successful Skill activation SHALL project eligible resources from `scripts/`、`references/` and `assets/` into `.nextagent/skills/<skillProjectionKey>/<skill-name>/...`, SHALL prepend that Skill resource root location before the original `SKILL.md` body in the same hidden generated Skill load message, and SHALL let file tools or sandboxed execution consume only the roots and Skill projection subtrees authorized for the current accepted run.

The execution file model SHALL present three logical roots to authorized consumers:

- `workspace/` for durable read/write files;
- `.nextagent/` for system-managed authorized resources;
- `temp/` for run-scoped scratch files.

Host/source/provider-private locations SHALL be represented to model-visible and tool-visible surfaces only as bounded logical execution paths, safe display paths, or stable safe reason codes.

#### Scenario: Authorized Skill reference is reachable by logical path
- **WHEN** an accepted run activates a governed Skill that contains `references/guide.md`
- **THEN** the run SHALL expose the reference as `.nextagent/skills/<skillProjectionKey>/<skill-name>/references/guide.md`
- **AND** the hidden generated Skill load message SHALL provide `.nextagent/skills/<skillProjectionKey>/<skill-name>/` before the original Skill body

#### Scenario: Skill script writes durable output through workspace
- **WHEN** an authorized Skill script reads `.nextagent/skills/<skillProjectionKey>/<skill-name>/references/input.md`
- **AND** writes `workspace/result.md`
- **THEN** the read SHALL use the authorized Skill projection subtree
- **AND** the write SHALL use the durable workspace root for the accepted run

#### Scenario: Skill execution uses run-scoped scratch space
- **WHEN** generated code or a Skill script needs intermediate files during an accepted run
- **THEN** those scratch files SHALL be created under `temp/`
- **AND** later durable use SHALL require an explicit authorized copy or write into `workspace/`

### Requirement: Accepted run SHALL derive scoped execution file roots and expose them by need

系统 SHALL 为每个 accepted run 通过 `ExecutionWorkspaceResolver.resolve(...)` 单入口派生 trusted execution workspace view。该 resolver SHALL 使用 app-composed `runtimeWorkspaceRoot`、runtime-facing `AgentAssembly.workspacePolicy`、trusted run facts 和 `agent-contracts/runtime` 的 `ExecutionDeploymentMode` 派生 internal `scopeBase` 以及 `workspace/`、`.nextagent/` 和 `temp/` 三个物理 root。`runtimeWorkspaceRoot` SHALL be derived by app composition from frozen `paths.workspaceRoot` as `<workspaceRoot>/execution`; `paths.workspaceRoot` remains the only user-configurable runtime output root in this change. 系统 SHALL 由 runtime resolver owner 暴露单一 run-scoped `ExecutionWorkspaceView`；模型上下文、工具和 capability 只接收与其 owner contract 匹配的 logical path view。

`workspace/` MUST be a durable read/write root for long-lived user-visible or session-visible files. `.nextagent/` MUST be a system-managed authorized resource root and MUST be read-only to model/tool/script writes. `temp/` MUST be a run-scoped temporary read/write root.

The run-derived `scopeBase` MUST equal `<runtimeWorkspaceRoot>/<scope-key>/` and is an infrastructure-only fact used by path resolver, Skill resource projection, sandbox adapter and capability cleanup jobs. Model-visible path surfaces use logical paths such as `workspace/`、`.nextagent/skills/...` and `temp/`; diagnostics and audit use safe bounded fields.

The prompt-facing `workspaceDir` MUST equal the logical path `workspace/`, relative to the execution view root. Context prompt assembly and other existing workspace-only consumers MUST continue to receive only this logical `workspaceDir` unless they have an explicit need for `.nextagent` or `temp` in their owner contract. The physical workspace root `<runtimeWorkspaceRoot>/<scope-key>/workspace/` is available only through resolver-backed infrastructure.

Model-visible file paths, tool results, safe errors, stream payloads, audit details and log fields SHALL use logical execution paths or safe display paths. Source roots, managed install roots, package layouts, runtime cache roots and provider-private loading keys remain private to their owner boundary.

Upload/intake temporary files, attachment quarantine storage and pre-acceptance validation storage SHALL remain attachment-owned system storage. After request acceptance, the system MAY migrate, link or project already-validated attachments into the run-derived `workspace/` or governed system resource view using the accepted run's `ExecutionWorkspaceView`.

Local development sandbox execution MAY use the physical `scopeBase` as its process cwd. PaaS sandbox execution MUST use `/work` as the sandbox execution view root and default cwd; `/work` maps to the internal `scopeBase` view, not to the physical host `scopeBase` path. Sandboxed execution MAY also accept canonical sandbox absolute paths under `/work`, such as `/work/workspace/...`、`/work/.nextagent/...` and `/work/temp/...`, when they normalize to one of the roots authorized for that sandbox request. Host absolute paths that do not normalize to an authorized execution root MUST be denied or made unreachable.

The internal base and physical roots MUST be derived under the app-composed runtime workspace root using deterministic scope and run keys:

- `scopeBase` -> `<runtimeWorkspaceRoot>/<scope-key>/`
- `workspace/` -> `<runtimeWorkspaceRoot>/<scope-key>/workspace/`
- `.nextagent/` -> `<runtimeWorkspaceRoot>/<scope-key>/.nextagent/`
- `temp/` -> `<runtimeWorkspaceRoot>/<scope-key>/temp/<run-key>/`

`scope-key` MUST be derived from a versioned hash namespace, isolation mode, trusted agent id, trusted tenant id, trusted subject id and optional trusted session id. `scope-key` MUST NOT include `agentVersion` or `agentAssemblyRef` by default, because durable `workspace/` is intended to be shared across versions of the same trusted agent and owner scope. `run-key` MUST be derived from a versioned hash namespace and trusted run id. Directory names MUST NOT contain raw owner, agent, session or run identifiers.

The system MUST enforce a path length budget for local and Windows-compatible deployments. `scope-key`、`run-key` and `skillProjectionKey` MUST be deterministic short hashes no longer than 16 characters. The `<skill-name>` segment in projection paths MUST use the canonical name from the governed Skill identity and MUST NOT be truncated, suffixed or rewritten for path optimization. Projected resource relative paths MUST have bounded depth and length, and resources whose final physical path would exceed the configured path budget MUST be rejected before projection with a safe reason.

The app-composed runtime workspace root MUST be a derived sibling of runtime data under `paths.workspaceRoot`, for example `<workspaceRoot>/execution`, while SQLite remains under `<workspaceRoot>/data/system/nextagent.sqlite`. Startup validation MUST fail closed when this derived execution root overlaps runtime data, SQLite parent directories, `configRoot/skills`, `configRoot/agents`, provider-private source roots, or resolves outside the normalized `workspaceRoot`.

Relative paths MUST be interpreted by consumer kind:

- unqualified relative paths such as `alarm/current.log` default to `workspaceDir` for workspace-only consumers;
- root-qualified paths such as `workspace/a.txt`、`.nextagent/skills/<skillProjectionKey>/foo/references/a.md` and `temp/work.csv` resolve only when the consumer is root-aware and authorized for that root or Skill projection subtree;
- Skill body relative references such as `references/a.md` MUST be resolved by the model against the injected Skill resource root, not by an implicit tool cwd;
- sandbox commands resolve root-qualified relative paths from deployment-mode-specific cwd: LOCAL physical `scopeBase`, REMOTE/PaaS `/work`.

#### Scenario: Context prompt receives only workspaceDir
- **WHEN** context prompt assembly needs the workspace location for an accepted run
- **THEN** it MUST receive the run-derived `workspaceDir`
- **AND** `workspaceDir` MUST equal `workspace/`
- **AND** the prompt MUST NOT be forced to include `.nextagent/` or `temp/` root instructions

#### Scenario: Scope base is internal only
- **WHEN** an accepted run derives execution file paths
- **THEN** `scopeBase` MAY be used by infrastructure code to derive roots
- **AND** `scopeBase` MUST NOT appear in model-visible prompt text, tool output, safe error details or public audit fields

#### Scenario: Consumers receive only needed roots
- **WHEN** a file-related tool or sandbox request is prepared for an accepted run
- **THEN** the request MUST consume the `ExecutionWorkspaceView` produced by the runtime execution workspace resolver owner for the accepted run
- **AND** it MUST include only the workspace path or additional roots/subtrees required by that consumer
- **AND** the capability layer, file port or sandbox gateway MUST NOT independently derive scope roots, create alternate access views or expand root access
- **AND** the system MUST NOT instruct the model to use host absolute paths, Skill source paths or managed install paths

#### Scenario: Attachment intake does not use execution workspace temp
- **WHEN** a file is uploaded before a request is accepted
- **THEN** the upload/intake path MUST use attachment-owned system temporary storage, quarantine storage or gateway attachment storage
- **AND** it MUST NOT call `ExecutionWorkspaceResolver` without a trusted accepted run id
- **AND** run-scoped `temp/` MUST NOT be used as upload temp

#### Scenario: Accepted attachment is moved into the execution view
- **WHEN** a request with validated attachment references is accepted
- **THEN** the system MAY derive an `ExecutionWorkspaceView` for that accepted run
- **AND** it MAY migrate, link or project the validated attachment into `workspace/` or a governed system resource root
- **AND** the resulting path MUST follow the same root permission, scope isolation and safe diagnostic rules as other execution workspace files

#### Scenario: Sandbox absolute path is normalized
- **WHEN** a sandboxed command references `/work/workspace/input.txt`
- **THEN** the system MAY normalize it to `workspace/input.txt`
- **AND** the resulting access MUST still pass root permission and scope policy

#### Scenario: Local sandbox cwd resolves Skill resources and workspace paths
- **WHEN** a local development sandbox command runs with default cwd
- **THEN** cwd MAY be the physical `scopeBase`
- **AND** `.nextagent/skills/<skillProjectionKey>/foo/scripts/analyze.py` MUST resolve under the authorized Skill projection subtree
- **AND** `workspace/input.log` MUST resolve under the authorized workspace root
- **AND** cwd MUST NOT default to the physical `workspaceDir`

#### Scenario: PaaS sandbox cwd resolves Skill resources and workspace paths
- **WHEN** a sandboxed command runs with default cwd
- **THEN** cwd MUST be `/work`
- **AND** `.nextagent/skills/<skillProjectionKey>/foo/scripts/analyze.py` MUST resolve under the authorized Skill projection subtree
- **AND** `workspace/input.log` MUST resolve under the authorized workspace root
- **AND** cwd MUST NOT default to `/work/workspace`

#### Scenario: Host absolute path is rejected
- **WHEN** a file tool or sandboxed command attempts to access a host absolute path, parent traversal path, drive-qualified path, URL-like path or provider-private loading key that cannot normalize to an execution root
- **THEN** the system MUST deny the access or make it unreachable through sandbox filesystem policy
- **AND** the diagnostic MUST use a stable safe reason without exposing the raw path

### Requirement: Execution workspace public contracts SHALL be minimal and stable

The runtime-facing `AgentAssembly` public contract MUST replace raw `workspaceDir` with `workspacePolicy`. `agent-contracts/runtime` SHALL define `ExecutionWorkspaceResolver`、`ResolveExecutionWorkspaceInput`、`ExecutionDeploymentMode`、`ExecutionWorkspaceView` and `ExecutionWorkspaceRootView`. `agent-contracts/capability` MUST NOT add a parallel workspace view field: existing `CapabilityInvocationRequest` and `ToolExecutionContext` facts SHALL remain the carrier for `identityContext`、`agentId`、`agentVersion`、`sessionId`、`requestId`、`runId`、`requestContextId`、`stepId` and `timeoutMs`. These contracts MUST contain only the fields required by their consumers.

The run workspace view contract MUST be stable within this change:

- `ExecutionWorkspaceView` contains only `workspaceDir`、`defaultCwd` and `roots[]`;
- `ExecutionWorkspaceRootView` contains only root kind, logical path, physical path and access;
- `scopeBase` and `runtimeWorkspaceRoot` MUST NOT be included in `ExecutionWorkspaceView`.

`agent-contracts/gateway` SHALL extend `SandboxExecutionRequest` only with the sandbox filesystem layout needed by gateway adapters: `filesystem.defaultCwd` and `filesystem.roots[]`. Gateway sandbox requests MUST NOT carry `AgentWorkspacePolicy`、`ExecutionWorkspaceResolver`、full `ExecutionWorkspaceView`、trusted identity facts、Skill source loading facts、authorization decisions、sandbox target paths or temp env values. Sandbox target paths MUST be derived by gateway adapters from `filesystem.defaultCwd` + normalized root `logicalPath`; standard temp env values MUST be derived from the temp root.

Product-path capability execution MUST use the trusted facts already carried by `CapabilityInvocationRequest` and `ToolExecutionContext`. `agent-core` MAY pass `capabilityResolver` in the runtime context, but MUST NOT create, resolve or authorize execution workspace roots; it only forwards capability invocation requests. Capability executors and tools that require file, Skill resource or sandbox access MUST fail closed when the required trusted facts or resolver-backed file/sandbox ports are missing. `createCapabilitySubsystem(...)`、file ports、sandbox ports and tool descriptors MUST NOT rely on an app-startup static `workspaceDir` for product execution.

`WorkspaceFilePort` MUST be the central path interpreter and filesystem enforcement boundary for builtin file tools and Skill resource projection. Tools MUST pass path, operation, existing `ToolExecutionContext` and any governed Skill identity facts to `WorkspaceFilePort`; `WorkspaceFilePort` MUST resolve the run-scoped `ExecutionWorkspaceView` internally from trusted facts and MUST NOT expose `ResolveExecutionWorkspaceInput`、`runtimeWorkspaceRoot` or raw `scopeBase` to ordinary capability/tool code. Tools MUST NOT independently join physical paths, derive roots or maintain root allowlists.

#### Scenario: Workspace-only contract stays minimal
- **WHEN** context prompt assembly requests the workspace location
- **THEN** it MUST receive only the `workspaceDir` field from the run `ExecutionWorkspaceView`
- **AND** the prompt MUST NOT contain `.nextagent`、`temp`、`scopeBase` or sandbox layout fields

#### Scenario: Gateway request receives only sandbox layout
- **WHEN** a sandbox execution request is built
- **THEN** the request MAY contain `filesystem.defaultCwd` and `filesystem.roots[]`
- **AND** it MUST NOT contain resolver input, full execution workspace view, workspace policy, trusted identity facts or Skill source loading facts

#### Scenario: Tool invocation uses existing trusted facts
- **WHEN** a builtin file tool is invoked for an accepted run
- **THEN** the capability executor MUST pass the existing request facts through `ToolExecutionContext`
- **AND** the builtin file tool MUST perform path resolution and filesystem access through `WorkspaceFilePort`
- **AND** `WorkspaceFilePort` MUST resolve the run workspace view from those facts and the configured workspace policy provider
- **AND** `agent-core` MUST NOT construct or modify execution workspace roots
- **AND** the tool MUST NOT use a workspace root captured when the capability subsystem was created

#### Scenario: Existing core runtime context remains valid
- **WHEN** `agent-core` invokes `CapabilityInvocationPort` with a runtime context containing only `capabilityResolver`
- **THEN** that caller-supplied context MUST remain valid product-path input
- **AND** file, Skill resource or sandbox access MUST derive workspace layout from `CapabilityInvocationRequest` / `ToolExecutionContext` facts instead of adding a second runtime-context field
- **AND** direct product-path invocation without trusted run facts or resolver-backed file/sandbox ports MUST fail closed before file, Skill resource or sandbox access occurs

#### Scenario: Skill activation requests projection through runtime access
- **WHEN** the Skill Tool has loaded a governed active Skill for an accepted run
- **THEN** Skill resource projection MUST use `WorkspaceFilePort` with existing `ToolExecutionContext` facts and the governed Skill identity facts
- **AND** it MUST pass governed Skill identity facts such as provider id, skill name and skill version
- **AND** it MUST NOT derive `.nextagent` paths directly from `workspaceDir`, package source paths or model-visible Skill text

### Requirement: Execution roots SHALL use policy-declared deterministic scope keys

Agent policy SHALL declare the execution file isolation mode for an accepted run. The default mode MUST derive `scope-key` from trusted Agent Scope and Owner Scope. A session-scoped mode MAY derive `scope-key` from trusted Agent Scope, Owner Scope and `sessionId`.

All three roots MUST be located under the same internal `scopeBase` (`<runtimeWorkspaceRoot>/<scope-key>/`). `workspace/` and `.nextagent/` MUST be direct logical roots under that base. `temp/` MUST be located under the same base and further isolated by `run-key`, for example `temp/<run-key>/`. Model output, client metadata, capability arguments, Skill manifest metadata or remote response MUST NOT override runtime root, isolation mode, scope-key input, `scopeBase` or root scope fields.

The system MUST NOT require per-scope metadata files to recover identity or authorization. Cleanup MUST use trusted runtime facts, deterministic keys, mtime/TTL or explicit retention policy rather than parsing raw directory names.

#### Scenario: Subject workspace isolation is enforced
- **WHEN** two accepted runs have different trusted subjects for the same agent
- **THEN** their `scope-key` values MUST be different
- **AND** files authorized for one subject MUST NOT be visible to the other subject

#### Scenario: Agent policy enables session workspace isolation
- **WHEN** an agent policy requires session-scoped files
- **AND** two sessions for the same subject use the same agent
- **THEN** their `scope-key` values MUST be different
- **AND** session-local files and authorized projections MUST NOT cross sessions

#### Scenario: Temp stays inside isolation base
- **WHEN** an accepted run derives a `scope-key`
- **THEN** its model-visible `temp/` root MUST resolve under `<runtimeWorkspaceRoot>/<scope-key>/temp/<run-key>/`
- **AND** `temp/` MUST NOT resolve to a shared global temp directory outside the isolation base

#### Scenario: Scope path is deterministic without metadata
- **WHEN** the same trusted facts and policy are used to derive execution roots
- **THEN** the same `scope-key` and root paths MUST be produced
- **AND** the system MUST NOT depend on a per-scope metadata file to recover the path

#### Scenario: Path length budget rejects excessive projection paths
- **WHEN** a Skill resource projection would produce a physical path that exceeds the configured path budget
- **THEN** projection MUST reject that resource before writing files
- **AND** the diagnostic MUST use a safe reason without exposing raw source paths

#### Scenario: Agent versions share durable workspace by default
- **WHEN** two accepted runs have the same trusted agent id and owner scope but different `agentVersion` or `agentAssemblyRef`
- **THEN** their default subject-scoped `scope-key` values MUST be the same
- **AND** their durable `workspace/` root MUST be shared
- **AND** Skill resource projection version isolation MUST be provided by `skillProjectionKey`, not by adding version facts to `scope-key`

### Requirement: File access SHALL use two-layer checking

系统 SHALL derive builtin file-tool access and sandbox filesystem layout from the `agent-runtime` execution workspace view for the accepted run whenever they need governed file paths. `read`、`write`、`glob`、future file edit tools、`bash`、`python`、script execution and model-generated code staging MUST NOT implement independent root derivation or root allowlists that can diverge from the runtime view.

Workspace-only consumers MAY continue to consume `workspaceDir` as their minimal path contract, but that `workspaceDir` MUST be derived from the same runtime execution workspace view.

The first check layer SHALL run at the tool/capability entry and MUST normalize paths, map sandbox `/work` absolute paths to root-relative paths when possible for sandbox consumers, check root permissions, enforce capability/Skill/risk policy, enforce timeout/size/output budgets, and reject inputs that are deterministically outside the roots authorized for that consumer.

The second check layer SHALL perform enforcement in the concrete access path using the same runtime-produced `ExecutionWorkspaceView` and operation facts. Builtin file tools MUST enforce containment through the execution file port. REMOTE/PaaS dynamic execution MUST enforce the three-root mapping through container/Pod filesystem isolation. LOCAL development dynamic execution SHOULD apply best-effort cwd/env/path/argument restrictions and MUST NOT claim OS-enforced filesystem containment unless a strong local backend is configured.

For `systemResources`, `WorkspaceFilePort` and sandbox layout preparation MUST narrow access to only the current run/activation's authorized Skill projection subtree or subtrees, such as `.nextagent/skills/<skillProjectionKey>/foo/`. They MUST NOT grant file tools, `bash`、`python` or generated code access to the whole `.nextagent/` root by default. REMOTE/PaaS sandbox enforcement MUST mount or expose only the authorized subtree or make unauthorized `.nextagent` paths unreachable.

Any tool-specific wrapper MAY add stricter limits, but MUST NOT expand access beyond the shared policy.

#### Scenario: Read tool and bash use the same authorized Skill resource policy
- **WHEN** `.nextagent/skills/<skillProjectionKey>/foo/references/guide.md` is authorized for the run
- **THEN** the builtin read tool MAY read that model-visible path
- **AND** a sandboxed bash or python command MAY read the same model-visible path
- **AND** both accesses MUST resolve through the same trusted runtime execution workspace view
- **AND** an unprojected or unauthorized path such as `.nextagent/skills/<otherSkillProjectionKey>/bar/references/secret.md` MUST be denied or unreachable

#### Scenario: Workspace-only tool uses workspaceDir
- **WHEN** an existing file tool operation only needs durable workspace access
- **THEN** unqualified relative paths MAY operate through the run-derived `workspaceDir`
- **AND** the system MUST NOT require that operation to receive `.nextagent` or `temp` roots
- **AND** the operation MUST still fail closed for paths outside `workspaceDir`

#### Scenario: File port enforces the run view
- **WHEN** a file tool operation is invoked
- **THEN** the capability/file-tool layer MUST pass the file port the runtime-produced `ExecutionWorkspaceView`, operation and any governed Skill facts needed for the operation
- **AND** the file port MUST enforce normalization, containment, realpath/symlink checks and root permission from that view and those operation facts
- **AND** the file port MUST NOT decide Skill authorization, owner/session isolation, or additional root visibility

#### Scenario: Tool-specific rules cannot expand root access
- **WHEN** a builtin file tool or sandbox adapter is configured
- **THEN** it MAY restrict file size, media type, command timeout or output size further
- **AND** it MUST NOT allow a path outside the roots authorized for that tool or adapter

#### Scenario: Dynamic execution preflight preserves valid functionality
- **WHEN** a dynamic execution input uses a path such as `/work/workspace/input.txt`
- **THEN** the entry check SHOULD normalize and authorize the operation when every path and command component is within policy
- **AND** it MUST NOT expand the current `bash-tool` public syntax, pipeline, redirect, multi-command or command allowlist in this change

### Requirement: Skill resources SHALL be projected into `.nextagent`

When the `Skill` Tool successfully loads a governed Skill body for the current request/run, only its governed resources under the top-level `scripts/`、`references/` and `assets/` directories SHALL be projected into `.nextagent/skills/<skillProjectionKey>/<skill-name>/...` before the hidden generated Skill load message is assembled. 首版 MUST NOT project root-level `LICENSE*`、`NOTICE*`、`README*` or other files outside those three directories; support for additional resource files requires a later change with an explicit allowlist and tests.

Skill resource projection physical writes MUST be owned by the Skill resource projection service and MUST go through `WorkspaceFilePort` using the run `ExecutionWorkspaceView` and governed Skill identity facts for the current active Skill subtree. The projection target MUST include `skillProjectionKey` before the safe Skill name. `skillProjectionKey` MUST be derived from a versioned hash namespace and governed Skill identity facts: provider id, skill name and skill version. Governed provider id、skill name and skill version MUST be an immutable content identity: the same triple MUST identify the same Skill body, eligible resource set and resource content within the governed catalog/source epoch. Capability discovery/catalog MUST fail closed when the same provider/name/version maps to different contents or different source facts; after discovery, the governed Skill identity entering catalog MUST be unique. Different Skill versions MUST produce different projection paths. This system write authority MUST NOT be exposed to builtin file tools, sandboxed commands, Skill scripts or generated code as `.nextagent` readWrite access. Builtin、system-local、Agent-owned-local and SkillHub providers MAY use provider-private loading facts to locate source files, zip entries, blob objects or package resources, but they MUST only return normalized safe metadata and per-entry content streams with safe Skill-root relative paths. Providers MUST NOT receive runtime physical roots or write `.nextagent` directly. The projected view MUST contain only safe Skill-root relative paths under `.nextagent`. The system MUST NOT expose raw source path, SkillHub managed install path, staging path, package layout, resource URI or provider-private loading key.

Projection writes SHALL use the existing capability code boundaries. `SkillSourceDiscovery` SHALL add resource listing and content-stream operations that use the same governed Skill name and Skill version inputs as `loadCanonicalBodyView(...)`; source implementations SHALL list safe metadata before opening resource content streams and SHALL support provider-private layouts that are not directories. Provider-private locators, manifest paths, artifact refs, package layout details and fallback checks such as `frontmatterHash` MAY be retained inside the selected provider, but they SHALL NOT be required fields in the public `SkillSourceDiscovery` list/read signatures and SHALL NOT participate in projection identity. The Skill Tool SHALL pass governed Skill identity facts and lazy list/read callbacks to `WorkspaceFilePort`, not preloaded resource metadata or content. `WorkspaceFilePort` SHALL add a system-only Skill projection operation used by the Skill Tool; ordinary read/write/glob tools SHALL NOT receive this operation.

The system-only projection operation SHALL implement the first-version committed-marker write strategy. It SHALL derive `skillProjectionKey` and check the existing target's internal projection committed marker before calling provider resource listing or reading. If the existing target and marker identify the same provider id, skill name, skill version and projection format, the service SHALL reuse the target without calling list/read callbacks and without copying resource files. Otherwise it SHALL acquire a filesystem lock directory under `.nextagent/skills/.locks/<skillProjectionKey>/`. If that lock already exists, the service SHALL bounded-wait using the current operation timeout, re-check the committed marker after the lock is released, and fail safely if the target still cannot be verified as committed. After acquiring the lock, the service SHALL re-check the committed marker, list safe metadata containing only eligible resource relative paths, kind and size, read each eligible resource entry on demand, write the complete target tree into `.nextagent/skills/.staging/<operation-key>/<skill-name>/`, verify the staged tree against the files read for this projection attempt, remove any existing uncommitted or old-format `.nextagent/skills/<skillProjectionKey>/<skill-name>/` target, and rename the staged `<skill-name>/` directory into that target path. The projection committed marker SHALL be internal to `.nextagent/skills/<skillProjectionKey>/.projection.json` and outside the model-authorized `<skill-name>/` subtree. The Skill hidden generated message SHALL be assembled only after the target rename and marker write both succeed.

Projection MUST apply deterministic path normalization and filtering: use `/`, reject empty segment、`.`、`..`、absolute path、drive-qualified path、URL-like path、unsafe depth/length、hidden directories、symlinks、hardlinks、special files、`node_modules/` and package manager cache. 首版每个 Skill projected resource count MUST be bounded by system/tool limits and MUST NOT exceed 200 files unless a later change defines a higher bound.

#### Scenario: Only first-version resource directories are projected
- **WHEN** a Skill source contains files under `scripts/`、`references/`、`assets/`, and also contains root-level `README.md`, `LICENSE`, `NOTICE`, or another top-level file
- **THEN** projection MUST include only eligible files under `scripts/`、`references/` and `assets/`
- **AND** root-level files outside those directories MUST be excluded
- **AND** excluded file names MUST NOT become model-visible resource paths unless a later change defines an allowlist

首版 MUST inject the Skill resource root location instead of rewriting `SKILL.md` body content. The injected location MUST be prepended before the original body in the same hidden generated Skill load message. The injected location MUST include the root-relative path `.nextagent/skills/<skillProjectionKey>/<skill-name>/`. The hidden generated Skill load message MUST NOT add a separate sandbox absolute `/work/.nextagent/skills/<skillProjectionKey>/<skill-name>/` resource root because sandbox execution resolves the same root-relative path from its execution view cwd. The system MUST NOT rewrite arbitrary body text, code blocks or examples in this change.

#### Scenario: Skill reference is readable through `.nextagent`
- **WHEN** an authorized Skill contains `references/REFERENCE.md`
- **THEN** the run projection MUST make it available as `.nextagent/skills/<skillProjectionKey>/<skill-name>/references/REFERENCE.md`
- **AND** the hidden generated Skill load message MUST provide `.nextagent/skills/<skillProjectionKey>/<skill-name>/` as the Skill resource root before the original Skill body
- **AND** the model MUST NOT need a source path, install path or opaque provider loading key to read it

#### Scenario: Different Skill versions do not overwrite projections
- **WHEN** two accepted runs share the same `scope-key` but load the same Skill name from different governed Skill versions
- **THEN** their `skillProjectionKey` values MUST be different
- **AND** each run MUST inject and authorize only its own `.nextagent/skills/<skillProjectionKey>/<skill-name>/` resource root

#### Scenario: Committed immutable projection is reused
- **WHEN** a governed Skill activation has the same provider id, Skill name and Skill version as an existing committed `.nextagent/skills/<skillProjectionKey>/<skill-name>/` target
- **THEN** projection MAY reuse the existing target without listing, reading or copying resource files
- **AND** the hidden generated Skill load message MAY be assembled after the committed marker is verified

#### Scenario: Uncommitted projection leftover is rebuilt
- **WHEN** `.nextagent/skills/<skillProjectionKey>/<skill-name>/` exists but the internal committed marker is absent, invalid or uses an unsupported projection format
- **THEN** a successful projection commit MUST rebuild the target through lock and staging before authorizing the resource root
- **AND** stale files from the uncommitted target MUST NOT remain in the newly committed target

#### Scenario: Projection write failure does not authorize resources
- **WHEN** staging, verification or commit fails before the projection target is ready
- **THEN** the Skill hidden generated message MUST NOT inject the resource root for that activation
- **AND** file tools and sandbox requests MUST NOT be authorized to read the failed projection
- **AND** staging or stale lock leftovers MUST be eligible for cleanup by the capability cleanup job

#### Scenario: Duplicate Skill identity conflicts before projection
- **WHEN** discovery finds the same provider id, Skill name and Skill version with different contents or different source facts
- **THEN** catalog publication MUST fail closed for that conflicting identity
- **AND** Skill resource projection MUST NOT create separate projection paths using content or consistency tokens to work around the conflict
- **AND** projection writes for one key MUST NOT overwrite or authorize reads from the other key

#### Scenario: Skill body is not rewritten
- **WHEN** the Skill body contains relative resource references, examples or code blocks
- **THEN** the system MUST prepend the Skill resource root location before the original body in the same hidden generated Skill load message
- **AND** it MUST NOT rewrite the original Skill body content in this change
- **AND** the system MUST NOT create an implicit file-tool cwd for that Skill

#### Scenario: Unsafe resource entry is not projected
- **WHEN** a Skill source contains a symlink, hidden directory, parent traversal entry, special file or unsafe path
- **THEN** projection MUST exclude that entry
- **AND** the diagnostic MUST NOT expose the raw source location

### Requirement: `.nextagent` SHALL be read-only and system-managed

`.nextagent/` SHALL be a system-managed authorized resource projection. Except for the Skill resource projection service's internal projection target write, builtin write/edit tools, sandboxed commands, Skill scripts and generated code MUST NOT create, modify, rename or delete files under `.nextagent/`.

Scripts under `.nextagent/skills/<skillProjectionKey>/<skill-name>/scripts/` MAY be executable only when execution is authorized by capability policy, sandbox policy and Skill metadata. Execute permission MUST NOT imply write permission to `.nextagent`.

#### Scenario: Write to `.nextagent` is denied
- **WHEN** a model calls a file write tool targeting `.nextagent/skills/<skillProjectionKey>/foo/references/guide.md`
- **THEN** the system MUST return a safe failed result with a stable permission reason
- **AND** the projected resource MUST remain unchanged

#### Scenario: Script cannot write its own projection
- **WHEN** a sandboxed Skill script attempts to modify `.nextagent/skills/<skillProjectionKey>/foo/scripts/tool.py`
- **THEN** the sandbox filesystem policy MUST deny the write
- **AND** the script MAY continue or fail according to sandbox behavior, but the projection MUST remain unchanged

### Requirement: `workspace` SHALL carry durable file writes

`workspace/` SHALL be the durable read/write root for files that are intended to outlive the current run. Builtin write/edit tools and sandboxed dynamic execution MAY create or update files under `workspace/` according to the accepted run policy, file size limits, overwrite policy and media/type restrictions.

`workspace/` MUST NOT be used as a Skill source root, provider-private cache root or hidden system authorization store. Files written to `workspace/` are user/session-visible runtime files and MUST remain subject to Agent Scope and Owner Scope.

#### Scenario: Script writes durable result
- **WHEN** a Skill script processes `.nextagent/skills/<skillProjectionKey>/foo/assets/input-schema.json`
- **AND** it writes `workspace/result.json`
- **THEN** the write MAY succeed when file write policy permits it
- **AND** the resulting file MUST be visible to subsequent authorized file reads within the same durable scope

#### Scenario: Workspace cannot read another subject's files
- **WHEN** a model attempts to read `workspace/` content that belongs to a different trusted subject scope
- **THEN** the system MUST deny the access or make the file unreachable
- **AND** the failure MUST NOT reveal whether the other subject's file exists

### Requirement: `temp` SHALL carry run-scoped temporary file operations

`temp/` SHALL be the run-scoped temporary read/write root for scratch files, intermediate files, generated code staging and transient script inputs/outputs. `temp/` contents MUST NOT be treated as durable user/session facts and MUST NOT be relied on by later runs unless explicitly copied to `workspace/` through an authorized write.

The runtime request lifecycle MUST NOT synchronously delete `temp/` on terminal state. `temp/` cleanup SHALL be a background maintenance concern owned by capability execution infrastructure and scheduled through gateway-provided scheduled job execution. Crash, cancellation or process restart MUST be handled by delayed cleanup of expired run temp directories.

Sandboxed execution SHOULD map default language and process temporary locations to the run-scoped `temp/` root. `SandboxExecutionRequest.filesystem` MUST NOT duplicate temp paths as env values. REMOTE/PaaS deployment mode MUST derive the temp target path from `filesystem.defaultCwd` and the `temp` root logical path, yielding `/work/temp` in the canonical PaaS layout. LOCAL mode MUST derive the temp target path from the `temp` root physical path. Gateway adapters MUST set `TMPDIR`、`TMP` and `TEMP` to the derived temp target path, and runner/deployment adapters SHOULD configure language-specific temp settings such as Java `java.io.tmpdir`.

#### Scenario: Generated code uses temp
- **WHEN** the model or runtime stages generated code for sandbox execution
- **THEN** the code MAY be placed under `temp/`
- **AND** sandbox execution MAY read/write `temp/` during the run
- **AND** `temp/` MUST be eligible for delayed cleanup by the capability execution cleanup job

#### Scenario: Later run cannot depend on temp
- **WHEN** a later run starts for the same subject and agent
- **THEN** previous run `temp/` files MUST NOT be visible as durable inputs
- **AND** any needed durable artifact MUST have been copied to `workspace/`

#### Scenario: Python tempfile uses run temp
- **WHEN** Python code in REMOTE/PaaS deployment mode uses the default tempfile directory
- **THEN** it SHOULD resolve to the deployment-mapped run-scoped temp path, `/work/temp` in the canonical PaaS layout
- **AND** the resulting file MUST follow the same cleanup lifecycle as `temp/`

### Requirement: Cleanup jobs SHALL be capability-owned and gateway-scheduled

Cleanup for execution filesystem artifacts SHALL be split by responsibility:

- `agent-capability` SHALL own cleanup jobs and cleanup policy for capability execution artifacts: Skill projection directories under `.nextagent/skills/...`, projection staging directories, stale projection lock directories, and local run temp directories under `temp/<run-key>/`.
- `agent-platform-gateway-*` SHALL own scheduled job execution for the current deployment shape: LOCAL MAY run an in-process timer loop; REMOTE/PaaS MUST use platform-managed lifecycle, CronJob, singleton maintenance worker or a gateway-adapter-configured platform scheduled worker when cleanup touches shared storage.
- `agent-app` SHALL only register capability-provided jobs with the gateway scheduler during composition and SHALL NOT implement cleanup policy.
- `agent-runtime` SHALL NOT invoke filesystem cleanup from request terminal, recovery, scheduler or terminal commit paths.

The scheduled job contract MUST remain minimal. Capability-provided jobs MAY expose only job identity, cadence/retention hints, overlap policy and `run(signal, now)`. Gateway scheduled execution MUST NOT interpret Skill identity, derive Skill cleanup candidates, inspect Skill catalog authorization or expand execution workspace authorization. Cleanup path decisions MUST still go through resolver-backed infrastructure and filesystem containment checks.

PaaS sandbox temp cleanup MAY be primarily provided by sandbox/Pod volume lifecycle such as `emptyDir`; in that case the PaaS gateway MAY skip or no-op the temp cleanup job. LOCAL mode SHOULD schedule the temp cleanup job as best-effort retention cleanup.

#### Scenario: Runtime terminal path does not clean execution files
- **WHEN** a run reaches terminal state
- **THEN** runtime MUST complete terminal handling without deleting `temp/` or `.nextagent` projection directories
- **AND** cleanup failure MUST NOT affect terminal commit, recovery state or runtime timeline semantics

#### Scenario: App registers capability cleanup jobs with gateway scheduler
- **WHEN** app composition starts with Skill resource access enabled
- **THEN** it MUST register capability-provided cleanup jobs with the gateway scheduled execution facility
- **AND** the gateway MUST execute the jobs according to deployment mode without owning Skill cleanup policy

#### Scenario: PaaS shared cleanup is singleton or platform-managed
- **WHEN** REMOTE/PaaS deployment uses shared execution storage
- **THEN** cleanup for shared `.nextagent` projections MUST be executed by a singleton maintenance worker, platform CronJob or gateway-adapter-configured platform scheduled worker
- **AND** business pods MUST NOT all independently scan and delete shared projection directories unless a later change defines distributed locking

### Requirement: Dynamic execution SHALL use deployment-mode-specific sandbox enforcement

`bash`、`python`、Skill script execution and model-generated code execution MUST go through the sandbox gateway boundary. The sandbox MUST receive a physical filesystem layout derived from the same runtime `ExecutionWorkspaceView`:

- `workspace/`: read/write according to durable file policy;
- `.nextagent/`: read-only, with execute allowed only for explicitly authorized script resources or copied/staged execution wrapper;
- `temp/`: read/write run scratch.

REMOTE/PaaS deployment mode MUST enforce access control by container/Pod root mapping, permissions, cwd and deny-by-default filesystem policy. LOCAL development mode MAY use Git Bash, local Python or restricted local adapters with best-effort enforcement, but MUST disclose that it does not provide strong malicious-code filesystem isolation unless an OS/container-enforced local backend is configured.

LOCAL development mode MAY apply host ACL/chmod read-only protection directly to the authorized committed projection subtree. Because `providerId + skillName + skillVersion` is an immutable content identity, successful committed projection targets are not refreshed by ordinary activation paths. Cleanup of protected local projection directories is best-effort and MAY be delayed by host ACLs or running local processes; cleanup failure MUST NOT affect request terminal handling or committed projection reuse.

The system MUST NOT rely on parsing shell command strings as the REMOTE/PaaS security boundary. Parsing and preflight checks are entry guardrails; production filesystem security MUST come from sandbox enforcement.

#### Scenario: Python reads Skill reference and writes workspace
- **WHEN** a sandboxed python command reads `.nextagent/skills/<skillProjectionKey>/foo/references/guide.md`
- **AND** writes `workspace/analysis.txt`
- **THEN** both operations MUST be governed by the same physical root mapping
- **AND** the command MUST NOT see any other host directory

#### Scenario: Sandbox escape path is denied
- **WHEN** a sandboxed command attempts to access `../../outside.txt` or an absolute host path
- **THEN** the sandbox MUST deny the access or make the path unreachable
- **AND** any returned error MUST be safe and bounded

#### Scenario: Local development dynamic execution is best effort
- **WHEN** LOCAL development mode executes Python through a local adapter
- **THEN** it MUST still use the policy-derived `scopeBase`, workspace path and any additional roots required by the execution request, cwd, env, budgets and entry checks
- **AND** cwd MAY be the physical `scopeBase`
- **AND** cwd MUST NOT be the physical `workspaceDir` for root-aware dynamic execution
- **AND** it MUST NOT claim that a normal local Python process is prevented from all host filesystem access by OS enforcement

#### Scenario: PaaS dynamic execution is container-enforced
- **WHEN** REMOTE/PaaS deployment mode executes Python or bash
- **THEN** the process MUST see `workspace/`, `.nextagent/` and `temp/` through container/Pod filesystem isolation
- **AND** `.nextagent/` MUST be read-only by filesystem enforcement

### Requirement: Skill script execution SHALL remain capability-governed

The presence of a script under `.nextagent/skills/<skillProjectionKey>/<skill-name>/scripts/` MUST NOT grant automatic execution privilege. Script execution MUST remain governed by current Agent capability binding, owner scope, Skill metadata, request-local context patch, risk policy and sandbox policy.

When execution is denied, the system MUST fail before sandbox invocation. `SkillMetadata.allowedTools` and request-local activation policy MAY make a governed execution path visible or available, but MUST NOT grant arbitrary host permissions.

#### Scenario: Denied policy blocks script execution
- **WHEN** active Skill metadata, request-local policy or runtime risk policy prohibits script execution
- **THEN** execution MUST fail before sandbox invocation
- **AND** the system MUST NOT create script side effects

#### Scenario: Script location does not bypass tool governance
- **WHEN** a Skill body instructs the model to run `.nextagent/skills/<skillProjectionKey>/foo/scripts/process.py`
- **THEN** the execution MUST still pass governed capability visibility, invocation policy and sandbox policy
- **AND** the script MUST NOT bypass current Agent or owner policy because it is bundled with the Skill

### Requirement: Resource and file results SHALL obey size, content and large-output policy

Reads from `.nextagent/`, `workspace/` and `temp/`, writes to `workspace/` and `temp/`, script stdout/stderr and generated outputs MUST obey configured size, media type, encoding and large-content policies. Oversized content MUST be externalized, represented by a governed content/artifact ref, or fail with a safe reason. It MUST NOT be silently truncated, silently dropped, logged in full, streamed in full outside policy or inserted into safe errors.

#### Scenario: Large Skill reference is not inlined beyond policy
- **WHEN** `.nextagent/skills/<skillProjectionKey>/foo/references/large.md` exceeds the current inline threshold
- **THEN** read result MUST use existing large-content/capability result policy or safe degraded outcome
- **AND** the system MUST NOT silently truncate the authoritative content

#### Scenario: Oversized stdout is bounded
- **WHEN** a sandboxed script produces stdout or stderr larger than the configured inline threshold
- **THEN** the result MUST be externalized, replaced or bounded according to policy
- **AND** audit/log output MUST NOT contain the full stdout or stderr

### Requirement: Diagnostics and audit SHALL be safe and sufficient

Execution file access failures SHALL settle with stable safe reason codes and bounded diagnostics. 首版 reason code vocabulary MUST cover invalid path, root denied, read denied, write denied, execute denied, resource not authorized, resource not found, scope mismatch, too large, binary unsupported, consistency mismatch, sandbox unavailable, timeout, aborted, cleanup failed and execution failed.

Audit/log facts for file access and dynamic execution MUST be sufficient for telecom operations diagnosis: operation, root kind, safe Skill id when applicable, safe display path when applicable, status, reason code, duration, byte counts and sandbox outcome. Audit/log facts MUST NOT include prompt, model output, file body, script source, full stdout/stderr, raw provider error, raw path, credential or high-cardinality unbounded fields.

#### Scenario: Unauthorized Skill resource is diagnostic but not revealing
- **WHEN** a model attempts to read `.nextagent/skills/<otherSkillProjectionKey>/bar/references/secret.md` that was not authorized for the run
- **THEN** the system MUST return a safe denied or not-found result
- **AND** the diagnostic MUST NOT reveal source location, provider-private loading key or whether another subject/agent can access it

#### Scenario: Audit carries safe root facts
- **WHEN** a file read, file write or sandbox execution completes
- **THEN** audit/log facts MUST identify the operation, root kind, status, safe reason and bounded byte counts
- **AND** audit/log facts MUST NOT include raw file content, script source, raw path or credential
