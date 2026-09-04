# skill-resource-access Specification

## Purpose
定义 Skill 资源访问的执行根、授权范围、可见资源投影和拒绝行为，使 Skill 只能读取当前调用明确允许的受控资源。
## Requirements
### Requirement: Skill resource access SHALL expose authorized resources through execution roots

Skill resource access SHALL 通过 builtin file tools 和 sandboxed dynamic execution 共用的 execution file access model 暴露有权访问的 Skill resources。成功的 Skill activation SHALL 把 `scripts/`、`references/` 和 `assets/` 中符合条件的 resources 投影到 `.nextagent/skills/<skillProjectionKey>/<skill-name>/...`，SHALL 在同一 hidden generated Skill load message 中把 Skill resource root location 放在原始 `SKILL.md` body 之前，并 SHALL 为 committed projection 建立 Skill projection scope authority。

同一可信 execution scope 的全部 accepted runs SHALL 能够通过文件工具读取该 scope 内身份与完整性有效的 committed Skill projections，并能够通过受治理 sandbox 以显式 Skill 资源路径执行其中允许执行的脚本。该权限 SHALL 不依赖 `runId`、历史上下文中的资源路径或当前 accepted Agent assembly 是否仍暴露对应 Skill runtime Capability。Skill runtime Capability 的发现、激活和调用仍 SHALL 服从当前 Agent assembly 与 capability governance，且不由文件访问结果扩大。

execution file model SHALL 向有权访问的 consumers 提供以下 logical roots：

- `workspace/`：durable read/write files；
- `.nextagent/`：system-managed authorized resources；
- `temp/`：run-scoped scratch files；
- `shared-data/`：仅供本地使用的 public shared input files 和显式 shared Python script paths；该 root MUST 只在 LOCAL deployment mode 中存在。

`.nextagent/` SHALL remain read-only to model、tool 和 script writes。文件工具和 sandbox SHALL 只暴露当前 execution scope 内有效的 committed Skill projection subtrees，MUST NOT 暴露整个 `.nextagent/` 管理根。

Host/source/provider-private locations 在 model-visible 和 tool-visible surfaces 中 SHALL 只表示为有界 logical execution paths、safe display paths 或稳定 safe reason codes。

**需求类别**：功能性需求

#### Scenario: 激活后的资源在同一 scope 内持续可达

- **WHEN** 一个 accepted run 激活包含 `references/guide.md` 的 governed Skill
- **THEN** 系统 SHALL 将引用暴露为 `.nextagent/skills/<skillProjectionKey>/<skill-name>/references/guide.md`
- **AND** hidden generated Skill load message SHALL 在原始 Skill body 前提供 `.nextagent/skills/<skillProjectionKey>/<skill-name>/`
- **AND** 同一 execution scope 的后续 accepted runs SHALL 能够读取该引用

#### Scenario: 后续 run 执行已有 Skill 脚本

- **GIVEN** 一个 committed Skill projection 包含允许执行的 `scripts/check.py`
- **WHEN** 同一 execution scope 的后续 accepted run 通过受治理 sandbox 执行 `.nextagent/skills/<skillProjectionKey>/<skill-name>/scripts/check.py`
- **THEN** sandbox SHALL 能够读取并执行该脚本
- **AND** run 切换 SHALL NOT 要求重新激活对应 Skill

#### Scenario: 当前 assembly 不再暴露 Skill 时资源权限仍属于 scope

- **GIVEN** 一个 Skill projection 已在当前可信 execution scope 内成功提交
- **AND** 后续 accepted Agent assembly 不再暴露对应 Skill runtime Capability
- **WHEN** 同一 execution scope 的 accepted run 使用已知逻辑路径读取该 projection
- **THEN** 系统 SHALL 允许读取身份与完整性仍然有效的 committed projection
- **AND** 系统 SHALL NOT 因文件访问结果允许发现、激活或调用已不可用的 Skill runtime Capability

#### Scenario: Skill 脚本通过 workspace 写入持久结果

- **WHEN** 一个有权访问的 Skill 脚本读取 `.nextagent/skills/<skillProjectionKey>/<skill-name>/references/input.md`
- **AND** 该脚本写入 `workspace/result.md`
- **THEN** 读取 SHALL 使用当前 execution scope 的有效 Skill projection subtree
- **AND** 写入 SHALL 使用 accepted run 的 durable workspace root

#### Scenario: Skill 执行使用 run-scoped scratch space

- **WHEN** generated code 或 Skill script 在 accepted run 中需要中间文件
- **THEN** 中间文件 SHALL 创建在 `temp/` 下
- **AND** 后续 durable use SHALL 要求显式授权复制或写入 `workspace/`

#### Scenario: Projection 始终保持只读

- **GIVEN** 一个 Skill projection 在当前 execution scope 内具有 scope authority
- **WHEN** 文件工具或 sandboxed script 尝试写入该 projection
- **THEN** 系统 SHALL 拒绝写入

#### Scenario: 本地共享电信样例通过逻辑路径可达

- **WHEN** LOCAL mode 存在 `shared-data/cases/alarm.json`
- **AND** 一个 accepted run 读取 `shared-data/cases/alarm.json`
- **THEN** 读取 SHALL 使用 local shared data root
- **AND** 操作 MUST NOT 扩大到 `workspaceRoot/execution`、`workspaceRoot/data` 或其他 host directories

### Requirement: Accepted run SHALL derive scoped execution file roots and expose them by need

系统 SHALL 为每个 accepted run 通过 `ExecutionWorkspaceResolver.resolve(...)` 单入口派生 trusted execution workspace view。该 resolver SHALL 使用 app-composed `runtimeWorkspaceRoot`、runtime-facing `AgentAssembly.workspacePolicy`、trusted run facts 和 `agent-contracts/runtime` 的 `ExecutionDeploymentMode` 派生 internal `scopeBase` 以及 root policy 允许的 execution roots。`runtimeWorkspaceRoot` SHALL be derived by app composition from frozen `paths.workspaceRoot` as `<workspaceRoot>/execution`; local shared data physical root SHALL be derived by app composition from frozen `paths.workspaceRoot` as `<workspaceRoot>/shared-data` only in LOCAL deployment mode. 系统 SHALL 由 runtime resolver owner 暴露单一 run-scoped `ExecutionWorkspaceView`；模型上下文、工具和 capability 只接收与其 owner contract 匹配的 logical path view。

`workspace/` MUST be a durable read/write root for long-lived user-visible or session-visible files. `.nextagent/` MUST be a system-managed authorized resource root and MUST be read-only to model/tool/script writes. `temp/` MUST be a run-scoped temporary read/write root. `shared-data/` MUST be a LOCAL-only read-only root for public shared input files and explicit shared Python script paths. REMOTE/PaaS execution workspace resolution MUST fail closed if runtime-facing policy contains `sharedData`.

The run-derived `scopeBase` MUST equal `<runtimeWorkspaceRoot>/<scope-key>/` and is an infrastructure-only fact used by path resolver, Skill resource projection, sandbox adapter and capability cleanup jobs. Model-visible path surfaces use logical paths such as `workspace/`、`.nextagent/skills/...`、`temp/` and `shared-data/`; diagnostics and audit use safe bounded fields.

The prompt-facing `workspaceDir` MUST equal the logical path `workspace/`, relative to the execution view root. Context prompt assembly and other existing workspace-only consumers MUST continue to receive only this logical `workspaceDir` unless they have an explicit need for `.nextagent`, `temp` or `shared-data` in their owner contract. The physical workspace root `<runtimeWorkspaceRoot>/<scope-key>/workspace/` is available only through resolver-backed infrastructure.

Model-visible file paths, tool results, safe errors, stream payloads, audit details and log fields SHALL use logical execution paths or safe display paths. Source roots, managed install roots, package layouts, runtime cache roots and provider-private loading keys remain private to their owner boundary.

Upload/intake temporary files, attachment quarantine storage and pre-acceptance validation storage SHALL remain attachment-owned system storage. After request acceptance, the system MAY migrate, link or project already-validated attachments into the run-derived `workspace/` or governed system resource view using the accepted run's `ExecutionWorkspaceView`.

Local development sandbox execution MAY use the physical `scopeBase` as its process cwd. PaaS sandbox execution MUST use `/work` as the sandbox execution view root and default cwd; `/work` maps to the internal `scopeBase` view, not to the physical host `scopeBase` path. Sandboxed execution MAY also accept canonical sandbox absolute paths under `/work`, such as `/work/workspace/...`、`/work/.nextagent/...` and `/work/temp/...`, when they normalize to one of the roots authorized for that sandbox request. LOCAL sandbox execution MAY additionally accept `/work/shared-data/...` only when the local sandbox request includes `sharedData`. Host absolute paths that do not normalize to an authorized execution root MUST be denied or made unreachable.

The internal base and physical roots MUST be derived under trusted app-composed roots using deterministic scope and run keys:

- `scopeBase` -> `<runtimeWorkspaceRoot>/<scope-key>/`
- `workspace/` -> `<runtimeWorkspaceRoot>/<scope-key>/workspace/`
- `.nextagent/` -> `<runtimeWorkspaceRoot>/<scope-key>/.nextagent/`
- `temp/` -> `<runtimeWorkspaceRoot>/<scope-key>/temp/<run-key>/`
- `shared-data/` -> `<workspaceRoot>/shared-data/` in LOCAL deployment mode only; REMOTE/PaaS MUST fail closed before exposing this root

`scope-key` MUST be derived from a versioned hash namespace, isolation mode, trusted agent id, trusted tenant id, trusted subject id and optional trusted session id. `scope-key` MUST NOT include `agentVersion` or `agentAssemblyRef` by default, because durable `workspace/` is intended to be shared across versions of the same trusted agent and owner scope. `run-key` MUST be derived from a versioned hash namespace and trusted run id. Directory names MUST NOT contain raw owner, agent, session or run identifiers.

The system MUST enforce a path length budget for local and Windows-compatible deployments. `scope-key`、`run-key` and `skillProjectionKey` MUST be deterministic short hashes no longer than 16 characters. The `<skill-name>` segment in projection paths MUST use the canonical name from the governed Skill identity and MUST NOT be truncated, suffixed or rewritten for path optimization. Projected resource relative paths MUST have bounded depth and length, and resources whose final physical path would exceed the configured path budget MUST be rejected before projection with a safe reason.

The app-composed runtime workspace root MUST be a derived sibling of runtime data under `paths.workspaceRoot`, for example `<workspaceRoot>/execution`, while SQLite remains under `<workspaceRoot>/data/system/nextagent.sqlite`. Startup validation MUST fail closed when this derived execution root or the local shared data root overlaps runtime data, SQLite parent directories, `configRoot/skills`, `configRoot/agents`, provider-private source roots, or resolves outside the normalized `workspaceRoot`.

Relative paths MUST be interpreted by consumer kind:

- unqualified relative paths such as `alarm/current.log` default to `workspaceDir` for workspace-only consumers;
- root-qualified paths such as `workspace/a.txt`、`.nextagent/skills/<skillProjectionKey>/foo/references/a.md`、`temp/work.csv` and `shared-data/cases/a.json` resolve only when the consumer is root-aware and authorized for that root or Skill projection subtree;
- Skill body relative references such as `references/a.md` MUST be resolved by the model against the injected Skill resource root, not by an implicit tool cwd;
- sandbox commands resolve root-qualified relative paths from deployment-mode-specific cwd: LOCAL physical `scopeBase`, REMOTE/PaaS `/work`.

#### Scenario: Context prompt receives only workspaceDir
- **WHEN** context prompt assembly needs the workspace location for an accepted run
- **THEN** it MUST receive the run-derived `workspaceDir`
- **AND** `workspaceDir` MUST equal `workspace/`
- **AND** the prompt MUST NOT be forced to include `.nextagent/`、`temp/` or `shared-data/` root instructions

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

#### Scenario: Local sandbox cwd resolves Skill resources, workspace paths and shared data
- **WHEN** a local development sandbox command runs with default cwd
- **THEN** cwd MAY be the physical `scopeBase`
- **AND** `.nextagent/skills/<skillProjectionKey>/foo/scripts/analyze.py` MUST resolve under the authorized Skill projection subtree
- **AND** `workspace/input.log` MUST resolve under the authorized workspace root
- **AND** `shared-data/cases/alarm.json` MUST resolve under the local shared data root when that root is authorized in the sandbox request
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

When the `Skill` Tool successfully loads a governed Skill body for the current request/run, its governed resources with safe relative paths SHALL be projected into `.nextagent/skills/<skillProjectionKey>/<skill-name>/...` before the hidden generated Skill load message is assembled. 首版 MUST NOT project path traversal entries, absolute paths, drive-qualified paths, URL-like paths, symlinks, hardlinks, special files, unsafe package cache paths or resources that exceed configured limits.

Skill resource projection physical writes MUST be owned by the Skill resource projection service and MUST go through `WorkspaceFilePort` using the run `ExecutionWorkspaceView` and governed Skill identity facts for the current active Skill subtree. The projection target MUST include `skillProjectionKey` before the safe Skill name. `skillProjectionKey` MUST be derived from a versioned hash namespace and governed Skill identity facts: provider id, skill name and skill version. Governed provider id、skill name and skill version MUST be an immutable content identity: the same triple MUST identify the same Skill body, eligible resource set and resource content within the governed catalog/source epoch. Capability discovery/catalog MUST fail closed when the same provider/name/version maps to different contents or different source facts; after discovery, the governed Skill identity entering catalog MUST be unique. Different Skill versions MUST produce different projection paths. This system write authority MUST NOT be exposed to builtin file tools, sandboxed commands, Skill scripts or generated code as `.nextagent` readWrite access. Builtin、system-local、Agent-owned-local and SkillHub providers MAY use provider-private loading facts to locate source files, zip entries, blob objects or package resources, but they MUST only return normalized safe metadata and per-entry content streams with safe Skill-root relative paths. Providers MUST NOT receive runtime physical roots or write `.nextagent` directly. The projected view MUST contain only safe Skill-root relative paths under `.nextagent`. The system MUST NOT expose raw source path, SkillHub managed install path, staging path, package layout, resource URI or provider-private loading key.

Projection writes SHALL use the existing capability code boundaries. `SkillSourceDiscovery` SHALL add resource listing and content-stream operations that use the same governed Skill name and Skill version inputs as `loadCanonicalBodyView(...)`; source implementations SHALL list safe metadata before opening resource content streams and SHALL support provider-private layouts that are not directories. Provider-private locators, manifest paths, artifact refs, package layout details and fallback checks such as `frontmatterHash` MAY be retained inside the selected provider, but they SHALL NOT be required fields in the public `SkillSourceDiscovery` list/read signatures and SHALL NOT participate in projection identity. The Skill Tool SHALL pass governed Skill identity facts and lazy list/read callbacks to `WorkspaceFilePort`, not preloaded resource metadata or content. `WorkspaceFilePort` SHALL add a system-only Skill projection operation used by the Skill Tool; ordinary read/write/glob tools SHALL NOT receive this operation.

The system-only projection operation SHALL implement the first-version committed-marker write strategy. It SHALL derive `skillProjectionKey` and check the existing target's internal projection committed marker before calling provider resource listing or reading. If the existing target and marker identify the same provider id, skill name, skill version and projection format, the service SHALL reuse the target without calling list/read callbacks and without copying resource files. Otherwise it SHALL acquire a filesystem lock directory under `.nextagent/skills/.locks/<skillProjectionKey>/`. If that lock already exists, the service SHALL bounded-wait using the current operation timeout, re-check the committed marker after the lock is released, and fail safely if the target still cannot be verified as committed. After acquiring the lock, the service SHALL re-check the committed marker, list safe metadata containing only eligible resource relative paths, kind and size, read each eligible resource entry on demand, write the complete target tree into `.nextagent/skills/.staging/<operation-key>/<skill-name>/`, verify the staged tree against the files read for this projection attempt, remove any existing uncommitted or old-format `.nextagent/skills/<skillProjectionKey>/<skill-name>/` target, and rename the staged `<skill-name>/` directory into that target path. The projection committed marker SHALL be internal to `.nextagent/skills/<skillProjectionKey>/.projection.json` and outside the model-authorized `<skill-name>/` subtree. The Skill hidden generated message SHALL be assembled only after the target rename and marker write both succeed.

Projection MUST apply deterministic path normalization and filtering: use `/`, reject empty segment、`.`、`..`、absolute path、drive-qualified path、URL-like path、unsafe depth/length、symlinks、hardlinks、special files、`node_modules/` and package manager cache. Skill source discovery MUST include safe resources under the governed top-level resource directories `scripts/`、`references/`、`assets/` and `api/`. Projection MUST allow dot-prefixed directory segments such as `.hidden/skip.py`、`assets/.schemas/input.json`、`references/.vendor/guide.md` or `scripts/.helpers/tool.py` when all other projection safety checks pass. 首版每个 Skill projected resource count MUST be bounded by system/tool limits and MUST NOT exceed 200 files unless a later change defines a higher bound.

#### Scenario: Safe governed Skill resources are projected
- **WHEN** a Skill source contains safe relative resources such as `README.md`, `scripts/tool.py`, `assets/schema.json` and `.hidden/skip.py`
- **THEN** projection MUST include each safe governed resource path
- **AND** each projected path MUST remain under `.nextagent/skills/<skillProjectionKey>/<skill-name>/...`

#### Scenario: Dot-prefixed directories are projected when otherwise safe
- **WHEN** an accepted run activates a governed Skill that contains `assets/.schemas/chatbi.yaml`
- **THEN** the run projection MUST make it available as `.nextagent/skills/<skillProjectionKey>/<skill-name>/assets/.schemas/chatbi.yaml`
- **AND** authorized file tools or sandboxed execution MUST be able to read that projected file through the authorized Skill projection subtree
- **AND** a safe root-level dot directory resource such as `.hidden/skip.py` MUST also be projected and readable through the same authorized subtree

#### Scenario: API resources are discovered and projected
- **WHEN** an accepted run activates a governed Skill that contains `api/a.yaml`
- **THEN** the run projection MUST make it available as `.nextagent/skills/<skillProjectionKey>/<skill-name>/api/a.yaml`
- **AND** authorized file tools or sandboxed execution MUST be able to read that projected file through the authorized Skill projection subtree

#### Scenario: Unsafe relative path segments remain rejected
- **WHEN** a Skill source lists resources with empty segments, `.`, `..`, absolute paths, drive-qualified paths, URL-like paths, symlink entries, hardlink entries or special files
- **THEN** those resources MUST NOT be projected
- **AND** no unauthorized `.nextagent/skills/.locks/`、`.nextagent/skills/.staging/` or projection marker path MUST become authorized for the run

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
- **WHEN** a Skill source contains a symlink, parent traversal entry, special file or unsafe path
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

### Requirement: Skill resource projection SHALL refresh on its first activation in each service process

For each service process and execution scope, the first activation of a governed Skill resource projection identity SHALL rebuild the committed projection from the currently governed `SKILL.md` and eligible `scripts/`、`references/`、`assets/` resources, even when a committed projection manifest from a prior process already exists in the execution workspace. The rebuild SHALL use the existing lock, staging validation and atomic publication path. Concurrent first activations of the same identity in one scope and process SHALL share the same initialization and SHALL not publish competing projections.

After the first successful activation in that scope and process, later activations of the same projection identity SHALL reuse the committed immutable projection without re-enumerating or recopying source resources. Changes to a local Skill source while the process remains running SHALL NOT change the projection; the operator MUST restart the service or use a future explicit refresh capability.

#### Scenario: Restarted service refreshes an edited Skill script path

- **WHEN** a prior service process projected a governed Skill at version `unversioned` with `SKILL.md` directing execution to `scripts/query.py`
- **AND** an operator changes the governed Skill before service restart so that `SKILL.md` directs execution to `scripts/query1.py`, removes `scripts/query.py` and adds `scripts/query1.py` without changing the Skill version
- **AND** a new service process first activates that Skill using the same execution workspace
- **THEN** the returned Skill resource root SHALL contain `scripts/query1.py`
- **AND** it SHALL NOT contain `scripts/query.py`

#### Scenario: Later activation in the same process reuses the refreshed projection

- **WHEN** a service process has successfully completed the first activation of a governed Skill projection identity
- **AND** the source resources remain unchanged for that process
- **WHEN** the same Skill is activated again
- **THEN** the system SHALL reuse the committed projection without listing or reading source resources again

### Requirement: Authorized Skill Projection Supplies A Bounded Python Module Root

对于 Python script-path mode，受治理 sandbox MUST 仅从显式脚本路径匹配的当前 execution scope committed Skill projection 派生 Skill root。对于 Python module mode，sandbox MUST 仅在当前 execution scope 恰好存在一个可用 Skill projection root 时将其用作 Python module root。系统 MUST NOT 通过 descriptor、generated Skill message、model-visible workspace path、Web response、audit detail 或 safe error 发布 physical root。

系统 MUST 保留当前 execution scope 内全部有效 committed Skill projection roots，且 MUST NOT 按提交顺序、词法顺序、module name 或 source filesystem layout 隐式选择其中一个。Python module mode 面对空 root 集合或多 root 集合时 MUST 以显式安全失败结束。

**需求类别**：功能性需求

#### Scenario: Script path 使用同一 scope 的匹配 projection

- **GIVEN** 当前 execution scope 包含一个身份与完整性有效的 committed Skill projection
- **WHEN** sandbox 以该 projection 下的显式逻辑路径执行 Python script
- **THEN** sandbox MUST 仅使用与该路径匹配的 projection 作为 Skill root
- **AND** 其他 execution scope 的 projection MUST 不可用

#### Scenario: 单一 projection 支持 Python module mode

- **GIVEN** 当前 execution scope 恰好包含一个可用 Skill projection root
- **WHEN** Python module mode 请求 module root
- **THEN** sandbox MUST 使用该 scope-authorized projection root
- **AND** 系统 MUST NOT 发布该 root 的 physical path

#### Scenario: 多个 projection roots 不得被隐式选择

- **GIVEN** 当前 execution scope 包含多于一个可用 Skill projection root
- **WHEN** Python module mode 请求 module root
- **THEN** sandbox MUST 以显式安全失败结束
- **AND** sandbox MUST NOT 隐式选择任一 projection root

### Requirement: Skill Scripts Use Workspace For Results And Temp For Intermediate Files

系统 SHALL 通过 sandbox 提供的 process environment 定义 Skill Python scripts 的 output-root contract。当 Skill Python script 产生文件且对应环境变量存在时，脚本 SHOULD 把最终 user-visible 或 session-visible result data 写入 `NEXTAGENT_WORKSPACE_DIR` 标识的 process path，并 SHOULD 把 intermediate data、scratch files 和 transient execution artifacts 写入 `NEXTAGENT_TEMP_DIR`。只有脚本不产生对应类别的文件或 sandbox 未提供对应环境变量时才允许偏离；偏离时脚本 MUST NOT 改为写入其他 host physical path。

sandbox adapter MAY 仅在以下两种结果之一派生出恰好一个 trusted Skill projection root 时，向 child process 暴露 `NEXTAGENT_SKILL_ROOT`：当前 execution scope 的显式 script path 匹配结果，或 Python module mode 的单一有效 committed projection 选择结果。该值 MUST 来自当前 execution scope 的 Skill projection scope authority，且 MUST NOT 授予 `.nextagent` 写权限。条件不成立或 adapter 不选择暴露该可选环境变量时，child process 中 `NEXTAGENT_SKILL_ROOT` MUST 缺失；显式 script-path execution 仍 MUST 通过 sandbox filesystem layout 访问已匹配的只读 projection。

返回给模型的 sandbox stdout 和 stderr SHALL 把当前 request filesystem roots 下的 physical paths 投影为 `workspace/`、`temp/`、`.nextagent/skills/...` 或 `shared-data/...` logical execution paths。在 LOCAL mode 中，当 sandbox result 包含 request `defaultCwd` subtree 内普通文件的精确 physical path，且存在 run-scoped `temp` root 时，adapter MAY 把该被引用文件以相同 relative path 复制到 `temp/`，并把 model-visible path 投影为 `temp/...`。adapter 不选择复制时 MUST 从 stdout/stderr 移除 host physical path，且 MUST NOT 发布该文件。adapter MUST NOT 扫描 `defaultCwd`、发布未引用文件、复制目录、复制 `defaultCwd` 外的文件，或在 capability result 中暴露 host physical path。

**需求类别**：功能性需求

#### Scenario: Skill 脚本分离中间文件与最终结果

- **WHEN** 一个 Skill script 处理其有权访问的 Skill projection 中的数据
- **AND** 该脚本通过 `NEXTAGENT_TEMP_DIR` 写入中间文件
- **AND** 该脚本通过 `NEXTAGENT_WORKSPACE_DIR` 写入最终结果
- **THEN** 中间文件 SHALL 保持为 run-scoped temp data
- **AND** 最终结果 SHALL 写入 durable workspace root

#### Scenario: Skill root 环境变量来自当前 scope 的唯一选择结果

- **GIVEN** sandbox 根据显式 script path 或 Python module mode 在当前 execution scope 中选择了恰好一个有效 committed Skill projection root
- **WHEN** sandbox adapter 向 child process 暴露 `NEXTAGENT_SKILL_ROOT`
- **THEN** 该值 MUST 指向被选择 projection 的只读 sandbox path
- **AND** 其他 execution scope 的 projection MUST 不可用
- **AND** child process MUST NOT 获得该 projection 的写权限

#### Scenario: 本地物理输出路径只以逻辑路径对模型可见

- **WHEN** 一个 LOCAL sandboxed Skill script 输出 `workspace`、`temp`、有权访问的 Skill projection root 或 execution `defaultCwd` 下的 physical path
- **THEN** capability result 的 stdout/stderr SHALL 只包含逻辑 execution paths
- **AND** 当 run-scoped `temp/` root 存在时，`defaultCwd` 下被明确引用的普通文件 SHALL 在该 `temp/` 逻辑 root 下可用，以供后续文件工具读取

### Requirement: Skill projection scope authority 必须可从有效提交事实恢复

本 Requirement 中，**Skill projection scope authority** 是指身份与完整性有效的 committed Skill projection 在其可信 execution scope 内形成的持续只读资源权限；该权限允许文件工具读取资源并允许受治理 sandbox 执行资源脚本，但不授予 projection 写权限或对应 Skill runtime Capability 的调用权限。系统 MUST 在 accepted run 切换、run terminal 和服务进程重启后，从当前可信 execution scope 内身份与完整性有效的 committed Skill projection 恢复相同的 Skill projection scope authority。恢复 MUST NOT 依赖先前 run 的内存状态、历史消息是否保留资源路径或当前 accepted Agent assembly 是否仍暴露对应 Skill runtime Capability。

当 projection 不存在、未提交、身份不匹配或完整性无效时，系统 MUST 将该 projection 视为没有 scope authority。系统 MUST NOT 因恢复失败而自动扩大文件访问范围；后续显式 Skill 激活可以重新建立有效 projection。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复

**适用范围**：该 Function

#### Scenario: 后续 run 恢复同一 scope 的资源权限

- **GIVEN** 一个 Skill projection 已在可信 execution scope 内成功提交
- **WHEN** 同一 execution scope 的先前 run 已 terminal，且后续 run 访问该 projection
- **THEN** 系统 MUST 允许后续 run 读取该 projection
- **AND** 系统 MUST NOT 要求先前 run 的历史消息包含该 projection 路径

#### Scenario: Subject isolation mode 跨 session 共享

- **GIVEN** workspace isolation mode 为 `subject`
- **AND** 两个 accepted runs 的可信 `agentId`、`tenantId` 和 `subjectId` 相同，但 `sessionId` 与 `runId` 不同
- **AND** 第一个 run 已在其 execution scope 内成功提交 Skill projection
- **WHEN** 第二个 run 读取或显式执行该 projection
- **THEN** 系统 MUST 允许该访问
- **AND** 不同 `sessionId` 和 `runId` MUST NOT 产生额外授权要求

#### Scenario: 进程重启后恢复资源权限

- **GIVEN** 一个 Skill projection 已在可信 execution scope 内成功提交
- **AND** 该 projection 在服务进程重启后仍然存在且身份与完整性有效
- **WHEN** 同一 execution scope 的 accepted run 访问该 projection
- **THEN** 系统 MUST 恢复其只读资源权限
- **AND** 恢复结果 MUST NOT 依赖重启前的内存授权集合

#### Scenario: 无效提交事实不恢复权限

- **GIVEN** 一个 projection 缺少有效 committed identity 或完整性证据
- **WHEN** 同一 execution scope 的 accepted run 尝试读取或执行该 projection
- **THEN** 系统 MUST 拒绝访问或使该 projection 不可达
- **AND** 系统 MUST NOT 把逻辑路径文本作为替代 authority

### Requirement: Skill projection scope authority 必须保持 execution scope 隔离

系统 MUST 仅向派生出同一可信 execution scope 的 accepted runs 授予 Skill projection scope authority。系统 MUST 同时校验 Agent Scope、Owner Scope 和当前 workspace isolation mode 所要求的可信 scope facts；不同 execution scope 的 projection MUST 不可读且不可执行。

模型输出、历史消息、客户端 metadata、Capability 参数、Skill manifest metadata 和远端响应 MUST NOT 创建、替换或扩大 Skill projection scope authority。`.nextagent/skills/.staging/`、`.nextagent/skills/.locks/`、projection marker 以及未验证的 projection subtree MUST NOT 成为文件工具或 sandbox 的可访问根。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：该 Function

#### Scenario: 不同 subject 不能共享 projection

- **GIVEN** 两个 accepted runs 的可信 `subjectId` 不同
- **WHEN** 其中一个 run 尝试访问另一个 execution scope 内的 Skill projection
- **THEN** 系统 MUST 拒绝访问或使目标不可达
- **AND** 失败结果 MUST NOT 泄漏目标 projection 是否存在

#### Scenario: 不同 Agent 或 tenant 不能共享 projection

- **GIVEN** 两个 accepted runs 的可信 `agentId` 或 `tenantId` 不同
- **WHEN** 其中一个 run 尝试访问另一个 execution scope 内的 Skill projection
- **THEN** 系统 MUST 拒绝访问或使目标不可达
- **AND** 失败结果 MUST NOT 泄漏目标 projection 是否存在

#### Scenario: Session isolation mode 不跨 session 共享

- **GIVEN** workspace isolation mode 为 `session`
- **AND** 两个 accepted runs 的可信 `sessionId` 不同
- **WHEN** 其中一个 run 尝试访问另一个 session scope 内的 Skill projection
- **THEN** 系统 MUST 拒绝访问或使目标不可达

#### Scenario: 构造的历史路径不产生 authority

- **GIVEN** 模型上下文包含 `.nextagent/skills/<skillProjectionKey>/<skill-name>/` 形式的路径
- **AND** 当前可信 execution scope 内没有与该路径对应的有效 committed projection
- **WHEN** accepted run 尝试读取或执行该路径
- **THEN** 系统 MUST 拒绝访问或使目标不可达
- **AND** 系统 MUST NOT 根据路径文本创建 projection authority

### Requirement: SKILL.md 必须保持为内部正文来源

系统 MUST 把 governed Skill 的 canonical `SKILL.md` 作为 Skill 正文加载和一致性校验的内部来源，MUST NOT 把该文件作为模型可读附属资源写入或暴露在 `.nextagent/skills/<skillProjectionKey>/<skill-name>/...` projection subtree 中。模型可读 Skill projection MUST 只包含来源在 `scripts/`、`references/`、`assets/` 或 `api/` 下且通过既有资源安全校验的附属资源。

当 Skill 没有符合条件的附属资源时，系统 MUST 将模型可读附属资源数量判定为零，并 MUST NOT 向模型披露该 Skill 的 resource root。`Glob`、`Read` 和 sandbox 对已披露 projection subtree 的既有只读、scope 和安全校验保持不变。

**需求类别**：功能性需求

#### Scenario: SKILL.md 不进入模型可读 projection

- **GIVEN** governed Skill 包含 canonical `SKILL.md`
- **WHEN** 系统为该 Skill 建立模型可读资源 projection
- **THEN** projection subtree MUST NOT 包含 `SKILL.md`
- **AND** `Glob` 或 `Read` MUST NOT 通过该 projection subtree 枚举或读取 canonical `SKILL.md`

#### Scenario: 符合条件的附属资源仍然可访问

- **GIVEN** governed Skill 包含通过既有资源安全校验的 `scripts/query.py` 和 `references/guide.md`
- **WHEN** 该 Skill 成功加载
- **THEN** 模型可读 projection MUST 包含这两个附属资源
- **AND** 系统 MUST 向模型披露对应 Skill resource root
- **AND** 已披露附属资源 MUST 继续服从既有只读、scope 和路径安全校验

#### Scenario: 只有 SKILL.md 时没有可披露资源根

- **GIVEN** governed Skill 只有 canonical `SKILL.md` 且没有符合条件的附属资源
- **WHEN** 该 Skill 成功加载
- **THEN** 模型可读附属资源数量 MUST 为零
- **AND** 系统 MUST NOT 向模型披露 Skill resource root

### Requirement: Skill Projection Failures Emit Safe Runtime Diagnostics

系统 MUST 在 Skill 资源投影失败时保留模型可见结果的安全边界，并生成受控的本地运行诊断。

- **Owner Function**: Skill Tool Function
- **Function Change Type**: MODIFIED
- **Spec Role**: Incremental requirement
- **Requirement Category**: Observability / Security

When Skill resource projection fails after the Skill source has been resolved and the Skill body has passed validation, the Skill Tool MUST return the existing safe failure to the model-visible Tool result and MUST NOT expose raw projection internals through SafeError, Web API, stream, timeline, audit, or metric surfaces.

The same failure boundary MUST emit a runtime diagnostic event named `skill.tool.resource_projection_failed`. The event MUST contain only stable, low-cardinality fields needed for local troubleshooting, including the target Skill id, provider id, Skill version, source handle mode, source resource capability booleans, safe error code/category when available, normalized Node error code when available, a bounded failure kind, a bounded failure stage when available, a bounded failure reason code when available, and allowlisted numeric evidence when available.

The event MUST NOT include raw exception messages, stacks, host paths, source roots, projection target paths, Skill arguments, prompt text, model output, resource contents, credentials, tokens, or high-cardinality business values.

The failure kind vocabulary MUST distinguish at least the following categories when evidence is available:

- `RESOURCE_LIMIT`
- `PATH_REJECTED`
- `PERMISSION_DENIED`
- `MISSING_PATH`
- `FILESYSTEM_BUSY`
- `SAFE_ERROR`
- `UNKNOWN_EXCEPTION`

The failure stage and reason code vocabulary MUST be code-owned uppercase identifiers. Numeric evidence MUST be restricted to bounded counters and limits, such as resource count, maximum resource count, path length, maximum path length, observed size, expected size, and lock wait milliseconds.

#### Scenario: Permission-style projection failure keeps public result generic

- **WHEN** Skill resource projection fails with a local permission-style filesystem error
- **THEN** the Skill Tool result returned to the model MUST remain a safe generic projection failure
- **AND** the runtime diagnostic event MUST classify the failure as `PERMISSION_DENIED`
- **AND** the runtime diagnostic event MUST NOT include the raw filesystem path from the exception message

#### Scenario: Safe projection failure exposes only safe classifiers

- **WHEN** Skill resource projection fails with a SafeError such as `CAPABILITY_PATH_REJECTED` or `RESOURCE_TOO_LARGE`
- **THEN** the Skill Tool result returned to the model MUST preserve the existing SafeError code and safe message behavior
- **AND** the runtime diagnostic event MUST include only the SafeError code/category, bounded failure kind, allowlisted failure stage, allowlisted failure reason code, and allowlisted numeric evidence
- **AND** the runtime diagnostic event MUST NOT include raw resource paths, resource contents, or Skill arguments

#### Scenario: Diagnostic details are allowlisted

- **WHEN** a projection SafeError carries diagnostic details
- **THEN** the runtime diagnostic event MAY include `failureStage`, `failureReasonCode`, and bounded numeric evidence from the allowlist
- **AND** the runtime diagnostic event MUST NOT copy arbitrary detail fields, raw paths, raw messages, stacks, Skill arguments, or resource contents

### Requirement: Concurrent Skill Projection Reuses Committed Resources

系统 MUST 在同一执行作用域内安全处理同一 Skill 投影身份的并发激活。

- **Owner Function**: Skill Tool Function
- **Function Change Type**: MODIFIED
- **Spec Role**: Incremental requirement
- **Requirement Category**: Reliability

When multiple accepted runs in the same execution scope concurrently activate the same governed Skill projection identity, the projection boundary MUST protect publication with the existing projection lock and MUST allow a contending activation to reuse a committed projection that becomes complete while contention is observed.

The reuse decision MUST validate the committed projection identity and integrity before exposing the resource root. It MUST NOT derive trust from model-provided paths, historical prompt text, or process-local initialization state alone.

If the projection lock remains unavailable until the bounded wait expires and no valid committed projection can be reused, the Skill Tool failure returned for that lock contention MUST be retryable and MUST NOT be mapped to a non-retryable internal failure.

#### Scenario: Independent activations reuse the first committed projection

- **WHEN** two independent workspace file ports share the same execution scope and concurrently project the same Skill identity
- **AND** the first activation publishes a valid committed projection while the second activation has observed lock contention
- **THEN** the second activation MUST reuse the committed projection after validating its identity and integrity
- **AND** the second activation MUST NOT rebuild the same resource set

#### Scenario: Projection lock timeout is retryable

- **WHEN** Skill projection cannot acquire the projection lock before the bounded wait expires
- **AND** no valid committed projection is available for reuse
- **THEN** the Skill Tool result MUST use a safe retryable failure
- **AND** the failure MUST NOT expose the physical lock path, staging path, source path, or resource contents
