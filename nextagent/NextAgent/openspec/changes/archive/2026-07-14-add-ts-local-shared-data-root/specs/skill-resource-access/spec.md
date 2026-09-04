## MODIFIED Requirements

### Requirement: Skill resource access SHALL expose authorized resources through execution roots

Skill resource access SHALL make authorized Skill resources available through the same execution file access model used by builtin file tools and sandboxed dynamic execution. A successful Skill activation SHALL project eligible resources from `scripts/`、`references/` and `assets/` into `.nextagent/skills/<skillProjectionKey>/<skill-name>/...`, SHALL prepend that Skill resource root location before the original `SKILL.md` body in the same hidden generated Skill load message, and SHALL let file tools or sandboxed execution consume only the roots and Skill projection subtrees authorized for the current accepted run.

The execution file model SHALL present these logical roots to authorized consumers:

- `workspace/` for durable read/write files;
- `.nextagent/` for system-managed authorized resources;
- `temp/` for run-scoped scratch files;
- `shared-data/` for local-only public shared input files and explicit shared Python script paths. This root MUST be present only in LOCAL deployment mode.

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

#### Scenario: Shared telecom fixture is reachable by logical path
- **WHEN** local mode has `shared-data/cases/alarm.json`
- **AND** an accepted run reads `shared-data/cases/alarm.json`
- **THEN** the read SHALL use the local shared data root
- **AND** the operation MUST NOT expand access to `workspaceRoot/execution`, `workspaceRoot/data` or other host directories

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

### Requirement: Dynamic execution SHALL use deployment-mode-specific sandbox enforcement

`bash`、`python`、Skill script execution and model-generated code execution MUST go through the sandbox gateway boundary. The sandbox MUST receive a physical filesystem layout derived from the same runtime `ExecutionWorkspaceView`:

- `workspace/`: read/write according to durable file policy;
- `.nextagent/`: read-only, with execute allowed only for explicitly authorized script resources or copied/staged execution wrapper;
- `temp/`: read/write run scratch;
- `shared-data/`: LOCAL-only read-only public shared inputs and explicit Python script paths; absent and fail-closed in REMOTE/PaaS.

REMOTE/PaaS deployment mode MUST enforce access control by container/Pod root mapping, permissions, cwd and deny-by-default filesystem policy and MUST fail closed if `sharedData` is requested by runtime-facing policy. LOCAL development mode MAY use Git Bash, local Python or restricted local adapters with best-effort enforcement, but MUST disclose that it does not provide strong malicious-code filesystem isolation unless an OS/container-enforced local backend is configured.

LOCAL development mode MAY apply host ACL/chmod read-only protection directly to authorized read-only roots. Because `providerId + skillName + skillVersion` is an immutable content identity, successful committed Skill projection targets are not refreshed by ordinary activation paths. Cleanup of protected local projection directories is best-effort and MAY be delayed by host ACLs or running local processes; cleanup failure MUST NOT affect request terminal handling or committed projection reuse.

The system MUST NOT rely on parsing shell command strings as the REMOTE/PaaS security boundary. Parsing and preflight checks are entry guardrails; production filesystem security MUST come from sandbox enforcement.

#### Scenario: Python reads Skill reference and writes workspace
- **WHEN** a sandboxed python command reads `.nextagent/skills/<skillProjectionKey>/foo/references/guide.md`
- **AND** writes `workspace/analysis.txt`
- **THEN** both operations MUST be governed by the same physical root mapping
- **AND** the command MUST NOT see any other host directory

#### Scenario: Python reads shared data and writes workspace
- **WHEN** a local sandboxed python command reads `shared-data/cases/alarm.json`
- **AND** writes `workspace/analysis.txt`
- **THEN** the read MUST use the local shared-data read-only root
- **AND** the write MUST use the accepted run workspace root
- **AND** the command MUST NOT be authorized to write to `shared-data/`

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
- **AND** local host `shared-data/` MUST NOT be exposed
- **AND** if runtime-facing policy requests `sharedData`, execution workspace resolution MUST fail closed before sandbox invocation
