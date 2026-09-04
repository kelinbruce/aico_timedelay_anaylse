## 背景和现状（Context）

当前 Skill 体系已经有三层事实：

- `skill-manifest-contract`：`SKILL.md` frontmatter 是 manifest 权威输入，生成 `CapabilityDescriptor` 和 typed `SkillMetadata`。
- `skill-tool`：模型通过 `Skill({ name, args? })` 激活 governed Skill；inline 模式加载 `SKILL.md` canonical body，并以 hidden generated message 注入下一轮上下文。
- builtin/local/SkillHub source：负责 Skill candidate discovery、manifest 解析、provider-private loading facts 和 catalog governance，不对 runtime/core/context 暴露 source path 或 install layout。

缺口不是“缺一个新的资源读取工具”，而是 Skill resources 需要进入现有 `read`、`write`、`bash`、`python` 和 sandbox 承载方式时缺少统一文件访问边界。当前实现以 `AgentAssembly.workspaceDir` 为主，`WorkspaceFilePort` 只认单一 workspace，`SandboxExecutionRequest` 还没有 filesystem layout，restricted local sandbox 也只是 workspaceDir + best-effort validation。这个模型不能表达 Skill resources 的只读授权投影、用户/会话持久文件、run 级临时文件和 PaaS 容器强隔离；但目标态仍要保留运行期 `workspaceDir` 作为 workspace-only 消费者的最小路径视图。

本设计保留 change 名称 `add-ts-skill-resource-access`，因为触发目标是 Skill resources 安全访问；实际引入的基础能力是 execution file access policy。该 policy 首先服务 Skill resources，不把本 change 扩展成通用文件系统重构。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 从冻结 `paths.workspaceRoot` 派生 runtime workspace root，作为所有执行文件 root 的物理基座。
- 在 agent 装配阶段生成 runtime-facing `AgentAssembly.workspacePolicy`，声明 schema version、隔离策略和逻辑 root policy。
- 在 accepted run 执行时，用 trusted agent、owner、session、run facts 实例化 runtime execution workspace view，并为 prompt 派生 logical `workspaceDir = workspace/`；物理 workspace root 仅在 resolver-backed infrastructure 内部使用。
- 用同一 policy 管理三个物理 root，但只按消费者实际需要暴露路径语义：
  - `workspace/`：持久化读写。
  - `.nextagent/`：系统授权资源，只读。
  - `temp/`：run 级临时读写。
- 使用 deterministic `scope-key` 和 `run-key` 生成短物理路径，避免深目录、raw identity 泄漏和跨平台路径长度问题。
- 将 active Skill 的 resources 投影到 `.nextagent/skills/<skillProjectionKey>/<skill-name>/...`，并在同一条 Skill hidden generated message 中把 Skill resource root location 放在原始 body 前。
- 定义两层检查：工具/能力入口的 policy preflight，以及 file port / sandbox adapter 的执行层 enforcement。
- 支持 LOCAL development 和 REMOTE/PaaS production 两种 deployment mode：LOCAL dynamic execution best-effort；REMOTE/PaaS dynamic execution container-enforced。
- 保持 runtime/core/context/model/channel 不扫描 Skill 目录、不解析 provider-private loading facts。

**非目标：**

- 不新增模型侧 `SkillResource` Tool。
- 不修改 `SKILL.md` frontmatter 字段，不新增 manifest resource declaration。
- 不在首版改写 `SKILL.md` body 正文中的相对路径；只在同一条 hidden generated message 中把 Skill resource root location 放在原始 body 前。后续若模型路径拼接效果不足，再由独立 change 增加 body path rewrite。
- 不扩大 `bash-tool` baseline：不新增 pipeline、redirect、multi-command 或额外 command allowlist。
- 不实现 OS-level virtual filesystem、FUSE、WinFsp 或 Dokany。
- 不要求 LOCAL development mode 提供抵御恶意代码的 OS-enforced filesystem sandbox。
- 不实现用户可浏览的文件管理 UI 或 public Web API。
- 不把 Skill resource 注册成独立 Capability。
- 不支持脚本写回 Skill source 或 `.nextagent` 投影。

## 设计决策（Decisions）

### 决策 1：runtime workspace root 由 `paths.workspaceRoot` 派生

本 change 不新增用户可配置 path entry。用户配置仍只有 `paths.workspaceRoot` 作为 runtime output root；app composition 在配置冻结后派生：

```text
workspaceRoot = frozen paths.workspaceRoot
runtimeWorkspaceRoot = <workspaceRoot>/execution
```

`runtimeWorkspaceRoot` 是 execution file roots 的物理基座，例如本地部署的受控目录或 PaaS 挂载来源。该 root 是 app composition / platform configuration 的 trusted fact，不来自模型、客户端请求、Skill metadata 或 capability args。PaaS/REMOTE sandbox 可把该 root 的 scope view 映射到容器内 `/work`，但 public config 仍不新增 `executionRoot` 字段。

`workspaceRoot` 继续承载其他 runtime output，例如 `data/system/nextagent.sqlite`。因此 `runtimeWorkspaceRoot` MUST be a derived sibling of `data/` under `workspaceRoot`, not `workspaceRoot` itself:

```text
workspaceRoot/
  data/system/nextagent.sqlite
  execution/<scope-key>/
```

本 change 约束的最小 runtime directory layout 是：

```text
<workspaceRoot>/
  data/
    system/
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

该 layout 只覆盖本 change 依赖和新增的目录。其他 runtime output（例如 logs、future artifact stores 或 gateway-private state）不在本 change 中新增 contract；若它们存在，MUST NOT overlap `execution/`、`data/system/nextagent.sqlite` parent、`configRoot/skills`、`configRoot/agents` or provider-private/source-private roots.

App config validation MUST fail closed if the normalized/realpath `runtimeWorkspaceRoot` overlaps `dataDir`、`systemDataDir`、`sqliteFile` parent、`configRoot/skills`、`configRoot/agents` or any provider-private/source-private root. If `runtimeWorkspaceRoot` already exists as a file, symlink, junction, reparse point, or resolves outside normalized `workspaceRoot`, startup MUST fail safely. The same applies if `dataDir` or `systemDataDir` resolve inside `runtimeWorkspaceRoot`.

所有 execution scope 都在该 root 下先生成 internal isolation base，再生成实际 root：

```text
scopeBase = <runtimeWorkspaceRoot>/<scope-key>/

scopeBase/
  workspace/
  .nextagent/
  temp/<run-key>/
```

`scopeBase` 只允许 resolver、Skill projection、sandbox adapter、capability cleanup job 等基础设施访问。它不是模型路径，不是 tool 默认 root，不进入 context prompt、tool result、safe error 或 public audit details。

`scope-key` 和 `run-key` 使用 deterministic hash 生成，目录名只使用短安全字符集，例如 lowercase base32/base64url without punctuation。hash 使用带版本的 namespace 常量，例如 `nextagent.execution-scope.v1` 和 `nextagent.execution-run.v1`。路径中不得包含 raw agent id、tenant id、subject id、session id、run id 或 credential-like identifier。`scope-key` 默认不包含 `agentVersion` 或 `agentAssemblyRef`，以保留同一 agentId + owner scope 下跨版本共享 durable `workspace/` 的能力。

为了降低 Windows/local development path length risk，首版目录 key 和 projection path MUST 使用固定长度预算：

- `scope-key`、`run-key` and `skillProjectionKey` MUST be deterministic short hashes, each no longer than 16 characters.
- `<skill-name>` in projection paths is required by the Skill resource location convention and MUST use the canonical name from the governed Skill identity. The system MUST NOT truncate, suffix or otherwise rewrite it for path optimization; an invalid or over-budget final path fails projection before write.
- projected resource relative paths under `scripts/`、`references/` and `assets/` MUST have bounded depth and length; any resource whose final physical path would exceed the configured path budget MUST be rejected with a safe reason before projection.
- implementation MUST include a Windows-oriented path budget test with a deep but valid `workspaceRoot`.

Skill resource projection 另有 `skillProjectionKey`，用于避免同一 `scopeBase` 下不同 Skill 版本覆盖 `.nextagent` resources。该 key 使用 `nextagent.skill-projection.v1` namespace，并从 governed Skill identity 派生：provider id、skill name 和 skill version。Governed provider id、skill name 和 skill version 的三元组 MUST be an immutable content identity: 同一三元组在 catalog/governance epoch 内必须代表完全相同的 Skill body、resource set 和 resource content。Capability discovery/catalog MUST fail closed when the same provider/name/version maps to different contents or different source facts; therefore projection does not add a separate consistency token.

### 决策 2：Agent 装配生成 `AgentAssembly.workspacePolicy`，run 时实例化

Agent 装配阶段生成 runtime-facing `AgentAssembly.workspacePolicy`，不生成完整物理路径。首版 policy 保留必要且有消费者的信息：版本、隔离策略和逻辑 root policy。它不包含 system runtime root、物理 root、deployment mode、trusted identity、session/run facts 或 provider-private loading facts。

```ts
type ExecutionIsolationMode = "subject" | "session";

interface AgentWorkspacePolicy {
  readonly schemaVersion: "nextagent.agent-workspace-policy.v1";
  readonly isolationMode: ExecutionIsolationMode; // default: "subject"
  readonly roots: readonly AgentWorkspaceRootPolicy[];
}

type ExecutionWorkspaceRootKind =
  | "workspace"
  | "systemResources"
  | "temp";

interface AgentWorkspaceRootPolicy {
  readonly kind: ExecutionWorkspaceRootKind;
  readonly logicalPath: "workspace" | ".nextagent" | "temp";
  readonly access: "read" | "readWrite";
}
```

这是 frozen `AgentAssembly` contract 变更：runtime-facing `AgentAssembly.workspaceDir` 被 `workspacePolicy` 替代。本 change 已完成 public contract review；兼容仅保留在 agent package source input 层，不能在 runtime-facing assembly 中继续保留平行 `workspaceDir` 字段。

默认 assembly policy 包含三个 root：`workspace` read/write，`systemResources` (`.nextagent`) read-only，`temp` read/write。root lifecycle 不作为 policy 字段；首版生命周期由 root kind 固定表达：`workspace` durable，`systemResources` system-managed/rebuildable，`temp` run-temporary。Limits 首版不做复杂 per-root 对象；已有大小、数量、路径长度、large-content 阈值继续由现有工具/系统配置和实现常量承载。只有出现明确 per-agent 消费者时，才在后续 change 中把 limit policy 升级为 assembly contract。

Deployment mode 是系统级 gateway/platform 配置，不进入 `AgentAssembly.workspacePolicy`。

现有 agent package 的 `agent.yaml.workspaceDir` 不再进入 runtime-facing `AgentAssembly`。首版兼容策略为：compiler MAY accept the existing field for source compatibility but MUST ignore it when producing runtime-facing assembly and MUST emit safe deprecation evidence; if the field is absolute, points at a system/provider-private directory, or would imply a physical execution root, compilation MUST fail closed. The prompt-facing workspace path is always the logical path `workspace/`; the physical workspace root is derived only inside resolver-backed infrastructure.

Accepted run 执行时，`agent-runtime` 用 `AgentAssembly.workspacePolicy` 和 trusted facts 实例化 run workspace view：

```ts
scopeKey = hash(
  "nextagent.execution-scope.v1",
  isolationMode,
  agentId,
  tenantId,
  subjectId,
  isolationMode === "session" ? sessionId : ""
)

runKey = hash("nextagent.execution-run.v1", runId)
```

Subject 隔离：

```text
scopeBase = <runtimeWorkspaceRoot>/<scope-key>/
roots[]:
  workspace       -> <scopeBase>/workspace/
  systemResources -> <scopeBase>/.nextagent/
  temp            -> <scopeBase>/temp/<run-key>/
```

Prompt-facing `workspaceDir` MUST equal the logical path `workspace/`, relative to the execution view root. Context prompt、现有 workspace file port 兼容路径、以及其他只需要 durable workspace 的消费者 SHOULD 只接收该 logical `workspaceDir`。The physical workspace root `<runtimeWorkspaceRoot>/<scope-key>/workspace/` is available only inside resolver-backed infrastructure and MUST NOT be injected into prompt text.

Session 隔离使用相同目录形状，只是 `scope-key` 的 hash 输入包含 `sessionId`。不需要 per-scope metadata 文件；路径可由 versioned hash namespace、policy 和 trusted runtime facts 重新推导。Cleanup 不能靠反解析目录名获取身份，必须使用 trusted facts、deterministic key、mtime/TTL 或显式 retention policy。

### 决策 3：职责划分

`agent-contracts` owner：

- `agent-contracts/agent-assembly` 定义 `AgentWorkspacePolicy`。
- `agent-contracts/runtime` 定义跨 runtime/capability/gateway-adapter 边界的 `ExecutionWorkspaceResolver` port、`ResolveExecutionWorkspaceInput`、`ExecutionWorkspaceView` 和 root view 接口。view 是进程内 contract，不持久化、不远程传输，因此首版不需要自己的 `schemaVersion`。
- `agent-contracts/capability` 不新增 execution workspace 字段。现有 `CapabilityInvocationRequest` 和 `ToolExecutionContext` 已携带 `identityContext`、`agentId`、`agentVersion`、`sessionId`、`requestId`、`runId`、`requestContextId`、`stepId` 和 `timeoutMs`，足以作为 file/sandbox port 解析 run workspace view 的 trusted facts。
- `agent-contracts/runtime` 同时定义 `ExecutionDeploymentMode = "LOCAL" | "REMOTE"` 作为 resolver 输入的公共 vocabulary。`agent-app` 现有 app config / gateway `deploymentMode` 只映射到该 contract，不把 `agent-app` 私有 `DeploymentMode` 类型反向暴露给 contracts。
- `agent-contracts/gateway` 只定义 sandbox request 需要的 filesystem layout/cwd 字段。

`agent-app` / assembly owner：

- 从冻结 `paths.workspaceRoot` 派生并校验 `runtimeWorkspaceRoot=<workspaceRoot>/execution`。
- 编译 runtime-facing `AgentAssembly.workspacePolicy`。
- 装配 resolver implementation、派生的 `runtimeWorkspaceRoot` 和既有 gateway/platform deployment 配置。
- app 启动期不得把 `workspaceDir` 固化注入 `createCapabilitySubsystem(...)`、sandbox port 或 file port；只能装配 resolver/factory/provider 这类 per-run dependency。
- 不承载 execution workspace resolver 的业务实现，也不把 deployment mode 写入 `workspacePolicy`。

`agent-runtime` owner：

- 拥有 execution workspace resolver 的实现。
- 在 accepted run 时用 app-composed `runtimeWorkspaceRoot`、`AgentAssembly.workspacePolicy`、trusted run facts 和 `ExecutionDeploymentMode` 实例化 internal execution workspace。
- 派生 internal `scopeBase`、deterministic root physical paths、deployment-mode-specific default cwd，并生成单一 run-scoped `ExecutionWorkspaceView`。
- 负责派生 run-scoped `ExecutionWorkspaceView`：包含 logical `workspaceDir`、三类 root 和 default cwd，不包含 `scopeBase`。`scopeBase` 不暴露给模型、safe error 或 public audit。
- 不新增 capability invocation decorator。需要文件访问的 product path 由 `WorkspaceFilePort`、sandbox port、context prompt owner 或 Skill projection owner 使用现有 request/context facts 调用 resolver；缺少 trusted run facts 时必须 fail closed。

`agent-capability` owner：

- 消费现有 `CapabilityInvocationRequest` / `ToolExecutionContext` 中的 trusted run facts。
- 做 Layer A preflight：路径归一、root permission、capability/Skill/risk policy、预算和明显越权拒绝。
- 执行 file tool 调用、Skill resource projection 请求、Skill hidden generated message 注入和 dynamic execution request preparation。
- `WorkspaceFilePort` 是 read/write/glob 和 Skill resource projection 的中心文件访问边界。工具只把 path、operation、现有 `ToolExecutionContext` 和必要的 governed Skill facts 交给 `WorkspaceFilePort`；view 解析、路径匹配、normalization、realpath containment、read/write 权限和 safe diagnostics 都在 `WorkspaceFilePort` 内完成。
- sandbox port 使用同一个 `ToolExecutionContext` 和 resolver 派生 `SandboxExecutionRequest.filesystem`；file tools、Skill Tool、bash/python/generated code staging MUST NOT 各自拼接物理路径、缓存启动期 workspaceDir 或维护独立 root allowlist。

`agent-core` owner：

- tool loop 继续负责 capability resolution、tool call ordering、checkpoint、timeline 和 safe result handling。
- tool loop MAY pass `CapabilityInvocationRuntimeContext.capabilityResolver` when invoking `CapabilityInvocationPort`.
- tool loop MUST NOT create, resolve, authorize or inspect execution workspace roots; it only forwards the existing trusted facts already present on `CapabilityInvocationRequest` and optional `capabilityResolver`.

`agent-contracts/gateway` owner：

- 只承载 sandbox gateway 必须消费的 request filesystem layout，例如 workspace/systemResources/temp physical directories 和 cwd。
- 不承载 Skill source loading facts，不决定业务授权，不自行派生 scope/root。
- 承载最小 scheduled maintenance job execution contract：job id、cadence/retention hints、overlap policy 和 `run(signal, now)`。Gateway 只负责按部署形态调度执行，不解释 Skill identity 或 cleanup policy。

`agent-platform-gateway-local/remote` owner：

- gateway 只按 runtime/capability 从同一 `ExecutionWorkspaceView` 派生的 filesystem layout 执行 enforcement。
- REMOTE/PaaS deployment mode 通过容器/Pod mount 强制三 root。
- LOCAL development mode 可以使用 Git Bash、本机 Python 或 restricted adapter best-effort 执行，但必须声明不是强隔离。
- LOCAL scheduled job execution MAY use an in-process self-rescheduling timer with jitter, overlap prevention, abort/stop support and safe diagnostics.
- REMOTE/PaaS scheduled job execution MUST use platform lifecycle, CronJob, singleton maintenance worker or a gateway-adapter-configured platform scheduled worker when cleanup touches shared storage. PaaS sandbox temp MAY be platform-managed by sandbox/Pod volume lifecycle such as `emptyDir`.

### 决策 3.1：resolver 是单入口 accepted-run port，runtime 输出单一 run view

resolver 只保留一个 accepted-run 入口。没有 `runId` 的 upload/intake、quarantine、预校验流程不调用 execution workspace resolver。它们属于各自 owner 的系统临时生命周期；request accepted 后再迁移到 execution workspace。

```ts
interface ExecutionWorkspaceResolver {
  resolve(input: ResolveExecutionWorkspaceInput): ExecutionWorkspaceView;
}

interface ResolveExecutionWorkspaceInput {
  readonly runtimeWorkspaceRoot: string;
  readonly workspacePolicy: AgentWorkspacePolicy;
  readonly agentId: AgentId;
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly sessionId?: SessionId;
  readonly runId: RequestRunId;
  readonly deploymentMode: ExecutionDeploymentMode;
}
```

`deploymentMode` 使用 `agent-contracts/runtime` 的 `ExecutionDeploymentMode = "LOCAL" | "REMOTE"`。`agent-app` 现有系统配置/gateway 选择中的部署模式映射到该 contract；本 change 不新增 `executionProfile` 字段。

运行时传递链路：

```text
request accepted / run resumed
  -> runtime loads frozen AgentAssembly by agentId + agentVersion
  -> agent-core tool loop invokes CapabilityInvocationPort with request + optional capabilityResolver only
  -> capability executor copies existing request facts into ToolExecutionContext
  -> builtin file/Skill tools call WorkspaceFilePort with path + operation + ToolExecutionContext
  -> WorkspaceFilePort resolves ExecutionWorkspaceView from context facts and enforces filesystem access
  -> bash/python sandbox port resolves the same view from ToolExecutionContext and builds SandboxExecutionRequest.filesystem
```

`createCapabilitySubsystem(...)` 仍可在 app 启动期创建 capability catalog、providers 和 static tool descriptors，但 MUST NOT bake in a physical `workspaceDir` for product execution. Product path workspace/file/sandbox access is resolved per operation from the existing trusted request/context facts. Unit tests may keep fixture-only helpers that construct a static fake workspace view, but production composition MUST use resolver-backed file/sandbox ports.

`CapabilityInvocationRuntimeContext` 保持现有形状，不新增 workspace 字段：

```ts
interface CapabilityInvocationRuntimeContext {
  readonly capabilityResolver?: RuntimeCapabilityResolver;
}

interface ToolExecutionContext {
  // existing identity/run fields omitted
  readonly capabilityResolver?: RuntimeCapabilityResolver;
}
```

resolver 的内部结果分两层：一层是 infrastructure-only state，包含 `scopeBase` 等不能外泄的派生值；另一层是给消费者的 `ExecutionWorkspaceView`，只表达该消费者需要的 root layout。

```ts
interface ExecutionWorkspaceView {
  readonly workspaceDir: string;
  readonly defaultCwd: string;
  readonly roots: readonly ExecutionWorkspaceRootView[];
}

interface ExecutionWorkspaceRootView {
  readonly kind: ExecutionWorkspaceRootKind;
  readonly logicalPath: string;   // workspace, .nextagent/skills/<skillProjectionKey>/<skill-name>, temp
  readonly physicalPath: string;  // host/container physical path visible to the adapter
  readonly access: "read" | "readWrite";
}
```

`ExecutionWorkspaceView` 不带独立 `schemaVersion`。它是由当前 runtime 代码从 versioned `AgentWorkspacePolicy` 和 trusted facts 现场派生的进程内 view；除非未来需要跨进程、持久化或作为远程 gateway durable contract 传输，否则不增加第二套 version。

`agent-contracts/runtime` 中的 resolver/view 是 public TypeScript contract，但不是 durable persistence schema。稳定性规则：

- 字段名、root kind、access 和 deployment mode vocabulary 在本 change 内视为 frozen contract，后续破坏性修改必须走独立 OpenSpec change。
- `physicalPath` 只给基础设施 consumer，不得进入 prompt、tool result、safe error、stream event 或 public audit。
- `logicalPath` 是模型/工具可见 root-qualified 前缀；对 Skill resources 可以是 `.nextagent/skills/<skillProjectionKey>/<skill-name>` 子树，不要求等于 policy root `.nextagent`。
- sandbox target path 不作为 root 字段传输；gateway adapter MUST derive it from `filesystem.defaultCwd` + normalized root `logicalPath`。

`ExecutionWorkspaceView` 是传给 capability 的唯一 run workspace view。

Context prompt 只读取 `workspaceDir`。File tools、Skill resource projection 和 capability cleanup jobs 不直接操作 `roots[]`，而是通过 `WorkspaceFilePort` 或 resolver-backed cleanup file operation 使用现有 trusted facts 解析 view 并执行访问。Sandbox request builder 从同一 resolver/view 生成 `SandboxExecutionRequest.filesystem`，不得维护第二套 root allowlist。

`systemResources` root 在 `ExecutionWorkspaceView` 中只表达 `.nextagent` 的物理基座。普通 file read/sandbox access MUST 由 `WorkspaceFilePort` 根据 governed Skill identity 约束到当前 run/activation 授权的 Skill projection 子树，例如 `.nextagent/skills/<skillProjectionKey>/<skill-name>/`，不得把整个 `.nextagent/` 作为 read root 交给 file tool、bash、python 或 generated code。`ExecutionWorkspaceRootView.access` 表达普通消费者权限；Skill resource projection service 的系统写入权限是 `WorkspaceFilePort` 的受控 system projection operation，不通过普通 write policy 暴露为 `.nextagent` readWrite root。

需要 file、Skill resource 或 sandbox access 的 Tool 在缺少 trusted run facts 或 resolver-backed file/sandbox port 时 MUST fail closed。普通 Capability/Tool 不能自己组装 `ResolveExecutionWorkspaceInput`，不能根据 `AgentAssembly.workspacePolicy` 或 system runtime root 自行派生路径；只有 `WorkspaceFilePort`、sandbox port、context prompt owner 和 Skill projection owner 可以作为基础设施消费者调用 resolver。

File port 不接收第二套 policy/facade，只接收 path、operation、`ToolExecutionContext` 和必要的 governed Skill facts：

```text
1. 用 ToolExecutionContext facts + workspacePolicy provider + runtime root 调 resolver
2. 判断路径属于哪个 view root 或当前授权 Skill projection 子树
3. 做 normalization / containment / realpath / symlink check
4. 检查 root 权限 readOnly/readWrite
5. 执行 read/write/glob
```

File port 不决定当前 run 有哪些 roots、不决定 Skill 是否授权、不决定 subject/session 隔离；它只把这些上游事实落实为 normalization、containment、realpath/symlink、权限和真实 filesystem 操作。Sandbox gateway 同理，只执行传入的 root/cwd/mount/env，不决定业务授权。

`agent-contracts/gateway` 的 `SandboxExecutionRequest` 只扩展 sandbox adapter 必需字段，不依赖 resolver，也不接收 full `ExecutionWorkspaceView`：

```ts
interface SandboxExecutionRequest {
  // existing fields remain
  readonly filesystem?: SandboxExecutionFilesystemLayout;
}

interface SandboxExecutionFilesystemLayout {
  readonly defaultCwd: string;
  readonly roots: readonly SandboxExecutionRoot[];
}

interface SandboxExecutionRoot {
  readonly kind: ExecutionWorkspaceRootKind;
  readonly logicalPath: string;
  readonly physicalPath: string;
  readonly access: "read" | "readWrite";
}
```

这些 gateway 字段的生产者是 capability 从同一个 `ExecutionWorkspaceView` 派生出的 sandbox layout；消费者是 local/remote gateway adapter。Gateway contract 不承载 `AgentWorkspacePolicy`、trusted identity、Skill source loading facts 或授权判断。

### 决策 3.2：附件 upload temp 不属于 execution workspace

附件 upload/intake 阶段可能发生在 request acceptance 之前，没有 `runId`，也不应为了写入 workspace 而伪造 run facts。首版将该阶段视为 attachment owner 的系统临时生命周期：

```text
channel-web -> agent-attachment-runtime
  -> system upload temp / quarantine / attachment store
  -> validation, type detection, size/security checks
  -> no Agent workspace path

accepted request/run
  -> ExecutionWorkspaceResolver.resolve(...)
  -> migrate/link/project accepted attachments into workspace or governed system resource view
```

因此 `temp/` 只表示 run-scoped execution temp，不表示 upload temp。`workspace/` 只接收已经通过附件可信校验、并在 accepted run 阶段由可信 owner 迁移/投影的内容。

### 决策 4：三个 root 语义固定

| Root | 权限 | 物理位置 | 生命周期 | 用途 |
|---|---|---|---|---|
| `workspace/` | read/write/list，默认不可直接 execute | `<runtimeWorkspaceRoot>/<scope-key>/workspace/` | durable | 长期文件、用户/会话可见结果 |
| `.nextagent/` | read/list，只对显式脚本允许 execute，不允许 write | `<runtimeWorkspaceRoot>/<scope-key>/.nextagent/` | rebuildable | Skill resources、系统授权参考资料 |
| `temp/` | read/write/list，可用于 generated code staging | `<runtimeWorkspaceRoot>/<scope-key>/temp/<run-key>/` | run-scoped | 中间文件、scratch、临时脚本 |

`.nextagent/` 不是用户持久事实；它是 system-managed authorized projection，可重建。`temp/` 后续 run 不能依赖，除非内容被显式写入 `workspace/`。

### 决策 5：保留 `workspaceDir`，显式定义 relative path root 和 deployment-mode-specific sandbox cwd

现有 context prompt 和只需要 workspace 的模型可见路径继续使用 `workspaceDir`。该值是逻辑路径，不是宿主绝对路径：

```text
workspaceDir = workspace/
```

`workspaceDir` 相对于 execution view root 解析：LOCAL dynamic execution 的 view root 可对应物理 `scopeBase`，REMOTE/PaaS 的 view root 是 `/work`。普通 file tools 对 unqualified relative paths 仍默认解析到 workspace root；需要物理路径时必须通过 resolver-backed `WorkspaceFilePort` 或 sandbox port 获取，不从 prompt 读取。

系统 prompt 不应默认注入 `.nextagent` 或 `temp`，也不应把三 root 作为所有模型交互的通用说明。Skill activation 会在 Skill hidden generated message 中单独注入 `.nextagent/skills/<skillProjectionKey>/<skill-name>/` resource root；sandbox/dynamic execution 会在 sandbox request 中获得它实际需要的 root mapping。

相对路径必须按消费者显式规则解析，不依赖隐式 cwd 猜测：

| Path form | Example | Resolution |
|---|---|---|
| unqualified relative | `alarm/current.log` | workspace-only consumer 默认解析到 `workspaceDir` |
| root-qualified workspace | `workspace/alarm/current.log` | root-aware consumer 解析到 workspace root |
| root-qualified system resource | `.nextagent/skills/k123/foo/references/guide.md` | 仅在该 consumer 被授权访问对应 Skill projection 子树时解析 |
| root-qualified temp | `temp/work.csv` | 仅在 run temp consumer / sandbox 中解析 |
| sandbox absolute | `/work/.nextagent/skills/k123/foo/...` | 仅 sandbox 内有效，映射到 execution view root |
| host absolute | `C:\...`、`/home/...`、MSYS `/c/...` | 默认拒绝或 safe-fail |

Root-aware 模型可见路径首选 root-qualified form：

```text
workspace/a.txt
.nextagent/skills/k123/foo/references/guide.md
temp/work.csv
```

Sandbox 里的 root-qualified relative paths 必须在 LOCAL 和 REMOTE/PaaS 中保持一致，但实际 cwd 按 deployment mode 区分。

Local development adapter 可以把实际进程 cwd 设为物理 `scopeBase`：

```text
<scopeBase>              cwd
<scopeBase>/workspace/a.txt
<scopeBase>/.nextagent/skills/k123/foo/references/guide.md
<scopeBase>/temp/<run-key>/work.csv
```

REMOTE/PaaS sandbox 内 canonical execution view root 和默认 cwd 固定为 `/work`：

```text
/work                 cwd and execution view root
/work/workspace/a.txt
/work/.nextagent/skills/k123/foo/references/guide.md
/work/temp/work.csv
```

因此脚本可以同时使用 workspace 和 Skill resource 的 root-qualified relative path：

```text
python .nextagent/skills/k123/foo/scripts/analyze.py workspace/input.log
```

如果 cwd 被设为 workspace root（LOCAL 的 `<scopeBase>/workspace` 或 REMOTE/PaaS 的 `/work/workspace`），`.nextagent/...` 会错误解析到 workspace 内，因此本 change MUST NOT 将 sandbox 默认 cwd 设为 workspace root。LOCAL mode 允许物理 cwd，因此模型、prompt、safe error 和系统生成的普通工具结果仍不得主动暴露 `scopeBase`；LOCAL development mode 对命令自身输出物理 cwd 的情况只承诺 best-effort，不作为生产安全边界。

入口检查不简单拒绝所有 absolute path，而是判断其是否能归一到当前消费者被授权的 root 内。Host absolute path、drive-qualified path、MSYS `/c/...` host path、URL-like path 和无法归一到授权 root 的路径必须拒绝或 safe-fail；`/work/...` 可以在 sandbox consumer 中归一到对应 root-relative path。

### 决策 6：两层检查模型

所有文件相关操作都经过两层检查：

```text
Layer A: tool/capability entry policy check
  - path normalization
  - root permission check
  - capability / Skill / risk policy
  - timeout, size, output budget
  - obvious unsafe intent rejection

Layer B: execution enforcement
  - builtin file tools: execution file port enforces physical path containment
  - PaaS dynamic execution: container/Pod enforces mounted root permissions
  - local dynamic execution: Git Bash/local Python/restricted adapter applies best-effort cwd/env/path/argument guardrails
```

Layer A 对动态执行不能模拟 sandbox，也不能因为安全考虑过度剪掉当前工具 baseline 内的合法能力。本 change 不扩大 `bash-tool` baseline；pipeline、redirect、multi-command shell syntax 仍然 deferred，除非后续 `bash-tool` change 明确修改。

### 决策 7：Skill resources 投影并注入 resource root

当 `Skill` Tool 成功加载 governed Skill body 后、hidden generated message 组装前，Skill resource projection service 将该 active Skill 授权 resources 投影到：

```text
.nextagent/skills/<skillProjectionKey>/<skill-name>/references/...
.nextagent/skills/<skillProjectionKey>/<skill-name>/assets/...
.nextagent/skills/<skillProjectionKey>/<skill-name>/scripts/...
```

投影规则：

- 首版只投影当前 active Skill 中位于顶层 `scripts/`、`references/`、`assets/` 三个目录下的授权 resources。
- 首版不投影 root-level `LICENSE*`、`NOTICE*`、`README*` 或其他不在这三个目录下的文件；这些文件如需支持，必须由后续 change 定义明确 allowlist 和测试。
- projection path MUST include `skillProjectionKey` before the safe Skill display name. Different provider、Skill name or Skill version MUST produce different projection keys; the same governed Skill identity MAY reuse the same projection path. If the same provider/name/version would resolve to different content, discovery/catalog MUST reject it before projection.
- 不改写 `SKILL.md` body 正文；同一条 hidden generated message MUST 先注入 root-relative resource root location `.nextagent/skills/<skillProjectionKey>/<skill-name>/`，再附加原始 Skill body。
- Sandbox execution cwd 已是 execution view root（REMOTE/PaaS 为 `/work`），同一 root-relative path 在 sandbox 中按 cwd 解析；hidden generated message MUST NOT 额外注入 `/work/...` sandbox absolute resource root。
- 模型应按 body 前的 resource root 解析 Skill 文档中的相对资源路径，例如 `references/a.md` -> `.nextagent/skills/<skillProjectionKey>/<skill-name>/references/a.md`。系统不为普通 file tool 维护隐式 “current Skill cwd”。
- `.nextagent` 下内容只读，run 中脚本和模型不得修改。
- source provider 只负责用 provider-private facts 读取 source，并产出规范化的 safe relative path、resource kind、size metadata 和按项 resource content stream。它不接收 runtime root，不写 `.nextagent`，不暴露 source path。Directory、zip、blob cache、HTTP object 或 registry-backed provider 都必须通过同一 list/read 边界表达资源，不要求把 provider-private package 解压成目录。
- 当前代码匹配的唯一实施路径是扩展现有边界，而不是新增独立 projection port：`SkillSourceDiscovery` 在现有 `loadCanonicalBodyView(...)` 旁新增 `listSkillResources(...)` 和 `readSkillResource(...)`；Skill Tool 用 provider id 选择 source provider，并只把 skill name、skill version 和 lazy provider callbacks 交给 provider / `WorkspaceFilePort`。Provider 内部可以保存 manifest path、artifact ref 或 `frontmatterHash` 等私有事实作为兜底校验，但这些事实不进入 `SkillSourceDiscovery` 公共调用签名，也不参与 projection identity。`WorkspaceFilePort` 在现有 read/write/glob/clearRun 旁新增 system-only `projectSkillResources(...)`，只由 Skill Tool 调用。
- Skill resource projection service 消费 source provider entries、run `ExecutionWorkspaceView` 和 governed Skill facts，并通过 `WorkspaceFilePort.projectSkillResources(...)` 写入 `.nextagent/skills/<skillProjectionKey>/<skill-name>/...`。`WorkspaceFilePort` 负责 projection path normalization、symlink/special file 拒绝、size/count 限制、锁、staging、target commit 和 safe diagnostics。该写入权限不得传给普通 file tool、sandbox、Skill script 或模型生成代码。
- 每次 Skill activation 复用同一 immutable identity 的 committed projection；未授权 Skill 不投影。过期内容由 cleanup job 按授权、mtime 或 retention policy 清理。普通 activation 路径不对已 committed 的同一 `skillProjectionKey` target 做 in-place refresh。

首版 projection 写入/覆盖策略固定如下：

```text
Skill Tool loads governed body
  -> WorkspaceFilePort.projectSkillResources(context, governedSkillFacts, lazy list/read callbacks)
     1. derive skillProjectionKey from provider id, skill name and skill version
     2. if target exists and .nextagent/skills/<skillProjectionKey>/.projection.json is a committed marker for the same provider id, skill name and skill version, reuse target without calling list/read callbacks
     3. mkdir .nextagent/skills/.locks/<skillProjectionKey>/ as filesystem lock
        - if lock exists, bounded-wait until it is released, then re-check committed marker
        - if timeout expires before target verifies, fail safely
     4. after lock acquisition, re-check committed marker and reuse if another caller completed it
     5. source.listSkillResources(...) returns safe metadata only after marker miss
     6. normalize and sort safe metadata: relativePath, kind, size
     7. source.readSkillResource(...) returns one eligible content stream at a time and WorkspaceFilePort writes it to .nextagent/skills/.staging/<operation-key>/<skill-name>/ while computing size/hash
     8. verify staged files against the plan
     9. rm existing uncommitted or old-format .nextagent/skills/<skillProjectionKey>/<skill-name>/ if present
    10. rename staged <skill-name>/ to final target
    11. write .nextagent/skills/<skillProjectionKey>/.projection.json committed marker
  -> Skill Tool injects resource root only after step 11 succeeds
```

该方案匹配当前 Node/TS 代码能力：`WorkspaceFilePort` 已是工具依赖，已集中 path security、safe failure、write lock 和 `fs.promises` 文件操作；实现只扩展该 port 的 system projection operation，不让 Skill source provider 接触 runtime root，也不让普通 Tool 获得 `.nextagent` 写权限。Staging、lock 和 manifest 路径都位于 `.nextagent/skills/` 的 internal 子目录或 `<skillProjectionKey>` 父目录，不在模型授权的 `<skill-name>/` subtree 内。

### 决策 8：动态执行按 deployment mode enforcement

`bash`、`python`、node、Skill script 或模型生成代码执行必须通过 sandbox gateway boundary。它们都消费 run `ExecutionWorkspaceView` 派生出的 sandbox filesystem layout。

REMOTE/PaaS deployment mode 必须在容器/Pod 边界把物理 roots 映射到 `/work` execution view：

```text
/work/workspace     RW
/work/.nextagent    RO
/work/temp          RW
cwd                 /work
```

REMOTE/PaaS deployment mode 必须禁止 hostPath/privileged escape，配置 non-root、read-only root filesystem、resource limits、deadline/cancellation 和 network policy。`.nextagent` 的只读必须由 filesystem mount 和 container policy 强制。

LOCAL deployment mode 可以使用 Git Bash、本机 Python 或 restricted local adapter 做 best-effort 执行，但不得把它描述为 OS-enforced sandbox。LOCAL mode 仍必须使用同一 visible path、cwd、env、timeout 和 output policy。
LOCAL mode 的实际进程 cwd MAY 是物理 `scopeBase`，以便 `workspace/...`、`.nextagent/...` 和 `temp/<run-key>/...` 这些 root-qualified relative paths 在本机进程中自然解析。local adapter MUST NOT use `workspaceDir` as cwd for root-aware dynamic execution.

LOCAL restricted adapter MAY apply host ACL/chmod read-only protection to the authorized committed `.nextagent/skills/<skillProjectionKey>/<skill-name>/` subtree. This is acceptable only because governed provider id、skill name and skill version are immutable content identity and ordinary activation paths do not refresh committed canonical targets. LOCAL/no-Docker cleanup remains best-effort: ACL or running-process failures are recorded as safe diagnostics and retried later, not surfaced into request terminal handling.

### 决策 9：默认临时目录映射到 `temp`

Sandbox 执行必须把语言和系统默认临时目录映射到 run-scoped temp lifecycle。`SandboxExecutionRequest.filesystem` 不携带 temp env value；gateway adapter MUST find the `temp` root and derive the target temp path from its own execution view:

```text
REMOTE/PaaS: defaultCwd=/work + logicalPath=temp -> /work/temp
LOCAL: temp root physicalPath -> <scopeBase>/temp/<run-key>
```

Gateway adapter MUST set standard temp env keys `TMPDIR`、`TMP` and `TEMP` to that derived target path. Runner/deployment adapter 应尽量把语言专用临时目录指向同一位置，例如 Java 使用 `-Djava.io.tmpdir=<derived-temp-path>`，Python `tempfile.gettempdir()`、Node `os.tmpdir()`、Go `os.TempDir()` 使用上述 env。Sandbox internal `/tmp` 可以存在，但必须是 run-scoped temp 或与 `temp/` 同生命周期清理。

### 决策 10：source-private loading facts 只在 provider 边界内使用

Builtin、system-local、Agent-owned-local 和 SkillHub source 可以保存 resource loading 所需的 private facts，但这些 facts 只用于生成 `.nextagent` 投影。runtime/core/context/model/channel 不得 import source loader、扫描 Skill source directory 或解析 managed install layout。

投影结果使用 safe display path、resource kind 和 size/hash metadata 记录内部诊断；raw source path、temporary source path、download URL、package layout、loading key 不进入 public result。

### 决策 11：清理由 capability job 定义、gateway 定时执行

首版不引入独立跨 run cache；`.nextagent/skills/<skillProjectionKey>/<skill-name>/` 本身是 immutable identity 的 committed projection。每次 Skill activation 根据授权复用 committed projection；缺少 committed marker 时才通过 lock/staging 创建或重建，文件数量和大小由 policy 限制。Cleanup 不进入 runtime request lifecycle，也不在 run terminal path 同步删除执行文件。责任划分如下：

- `agent-capability` owns cleanup jobs and policy for capability execution artifacts: Skill projection directories、projection staging directories、stale projection lock directories and LOCAL run temp directories.
- `agent-platform-gateway-local/remote` owns scheduled job execution: LOCAL can run a best-effort in-process timer; REMOTE/PaaS uses platform lifecycle、CronJob、singleton maintenance worker or a gateway-adapter-configured platform scheduled worker for shared cleanup.
- `agent-app` only registers capability-provided jobs with the gateway scheduler during composition.
- `agent-runtime` does not delete `temp` or `.nextagent` from terminal commit、scheduler、recovery or cancellation paths.
- PaaS sandbox temp cleanup is primarily provided by sandbox/Pod lifecycle such as `emptyDir`; the PaaS gateway MAY skip/no-op temp cleanup. LOCAL mode relies on the capability temp cleanup job as best-effort TTL cleanup.
- `workspace/` 不自动删除，除非后续 owner lifecycle/retention policy 明确定义。

必须保证未授权 resources 不会因为复用 `.nextagent` 而继续可见。

最小 scheduled job contract 只表达 job identity、cadence/retention hint、overlap policy 和 `run(signal, now)`。Gateway 不理解 Skill catalog、`skillProjectionKey` 或授权状态，不枚举 Skill cleanup candidate；这些都由 capability job 通过 resolver-backed file access 和 catalog/governance facts 处理。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 所有文件访问由同一 resolver 生成的 runtime `ExecutionWorkspaceView` 派生；`scopeBase` 只给基础设施；workspace-only 消费者只接收 `workspaceDir`，需要 Skill resources/temp/sandbox 的基础设施 port 才解析 `.nextagent` 或 `temp`；三个 root 同属 deterministic scope-key；PaaS dynamic execution 由容器强隔离，local dynamic execution best-effort。 | traversal、wrong scope、write `.nextagent`、PaaS sandbox escape、raw path leak tests |
| 性能/容量 | 首版直接物理投影；committed marker 命中时不调用 provider list/read、不重新复制；未命中时 list safe metadata，再逐项读取并写 staging，用文件数、大小、深度、路径长度限制控制成本；短 hash path 降低 Windows path 风险。 | size/count/path-length limit tests；projection integration tests |
| 可靠性/恢复 | cleanup 与 runtime terminal path 解耦；`temp/<run-key>` 通过 PaaS sandbox volume lifecycle 或 LOCAL capability cleanup job 延迟清理；projection 可重建；路径由 policy + trusted facts 确定性派生，不依赖 metadata 文件。 | cleanup job tests；crash/expired directory cleanup tests；gateway scheduler tests |
| 可维护性 | 行为按 root kind、`AgentAssembly.workspacePolicy`、runtime view、deployment mode 和权限集中表达；内置工具通过 `WorkspaceFilePort`、sandbox 通过 sandbox port 从同一 resolver/view 派生。 | architecture tests for resolver-backed file/sandbox ports |
| 可测试性 | file port 和 sandbox layout 可用 fake physical roots 测试；source provider 可用 resource entry fixture 测试，projection service 可用 fake `ExecutionWorkspaceView` 和 Skill facts 测试。 | unit + integration + fake sandbox tests |
| 审计/可追溯性 | 记录 operation、root kind、safe skill/resource facts、status、reason、duration、byte counts，不记录 raw path/content。 | observability redaction tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `scopeBase` internal-only，三个 root 由 `agent-runtime` resolver 派生，普通消费者只能通过 `ExecutionWorkspaceView` 或 `workspaceDir` 使用 | T1.1, T2.1, T4.5, T5.1 | contract + integration + architecture |
| runtime root + deterministic scope-key/run-key | T1.1, T1.2, T5.3 | policy unit + path-length/security tests |
| `temp/<run-key>` 隔离和后台清理 | T1.3, T5.6 | integration + cleanup job tests |
| `.nextagent` 只读 | T2.3, T3.4, T5.2 | read/write/sandbox negative tests |
| Skill resources 投影和 resource root 注入 | T3.1-T3.5 | source entry fixture + projection service + skill-tool tests |
| workspace-only 消费者继续使用派生 `workspaceDir`，read/write/glob 通过 `WorkspaceFilePort` 使用 `ToolExecutionContext` facts 解析 run view 并执行操作 | T2.1-T2.4 | file tool integration + architecture |
| bash/python/generated code 使用 deployment-mode-specific cwd 和从同一 run view 派生的 sandbox filesystem layout | T4.1-T4.6 | fake sandbox + LOCAL/REMOTE integration |
| source-private facts 不泄漏 | T3.6, T5.4 | redaction + architecture |
| large content 和安全诊断 | T5.1, T5.2 | contract/observability tests |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/skill-resource-access/spec.md`，名称保留但正文明确基础能力是 execution file access policy。
- 架构和跨模块设计：`openspec/designs/architecture/skill-invocation-and-disclosure.md` 主承载 Skill activation、resource projection、file tools、sandbox gateway、deployment mode 和 large-content 协作。
- 模块设计：`openspec/designs/modules/agent-runtime.md` 主承载 execution workspace resolver、scope/root 派生和 run view lifecycle；`openspec/designs/modules/agent-capability.md` 主承载 resolver-backed `WorkspaceFilePort` enforcement、sandbox filesystem layout preparation、Skill resource root injection、cleanup job definitions 和 safe result mapping；`openspec/designs/modules/agent-platform-gateway-local.md` 主承载 sandbox root mapping enforcement、default temp env、scheduled job execution 和 LOCAL/REMOTE 差异。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 `skill-resource-access` 映射。

## 风险与取舍（Risks / Trade-offs）

- [风险] `.nextagent` 被误认为用户持久 workspace。-> spec 明确它是 system-managed read-only projection，可重建，不承载用户持久事实。
- [风险] 物理复制有性能成本。-> 首版资源数量和大小预期较小，用硬限制控制；不引入复杂 cache。
- [风险] bash/python 仍可尝试访问 host absolute path。-> Layer A 尽量归一和拒绝明显越界；REMOTE/PaaS Layer B 用容器强隔离；LOCAL mode 明确 best-effort。
- [风险] session 隔离需求不一致。-> agent policy 统一决定 scope-key 输入，目录形状保持不变。
- [取舍] 在同一 hidden generated message 中将 resource root 放在 body 前，而非改写 Skill body。-> 避免误改正文和代码块；代价是模型需要按 root 拼接相对路径，后续可用独立 change 增强。
- [取舍] 统一物理 root 而非虚拟路径。-> 实现简单，需要 additional roots 的工具路径一致；workspace-only 消费者继续使用派生 `workspaceDir`；代价是需要 projection 和 cleanup。

## 迁移计划（Migration Plan）

无数据迁移。实施顺序按 additive path 推进：

1. 定义 `runtimeWorkspaceRoot=<workspaceRoot>/execution` 派生规则、`AgentAssembly.workspacePolicy`、`agent-runtime` resolver、run workspace view 实例化和 deterministic key 规则。
2. 将现有 workspace consumer 改为通过 runtime resolver 获取 run-derived `workspaceDir`；只有需要 Skill resources 或 temp 的 file/sandbox path 才接入 additional roots，file port/gateway 只执行从同一 run view 和当前操作事实得到的文件访问边界。
3. 在 `Skill` Tool 成功加载 body 后投影 active Skill resources，并在同一 hidden generated message 的 body 前注入 Skill resource root location。
4. 将 sandbox gateway 接入同一 root mapping、default temp env 和 LOCAL/REMOTE deployment mode。
5. 添加 capability cleanup jobs、gateway scheduled execution、observability、architecture gates。

回滚策略：关闭 Skill resource projection，恢复 Skill body 只加载 `SKILL.md`；file tools 仍可继续使用既有 workspace root，dynamic execution 不获得 `.nextagent` resources。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/skill-resource-access/spec.md`：提炼本 change 的 ADDED requirements。
- `openspec/overview.md`：保留三 root 执行文件访问模型和 Skill progressive disclosure 背景。
- `openspec/designs/architecture/skill-invocation-and-disclosure.md`：提炼 Skill activation、resource projection、file tools、sandbox gateway 协作。
- `openspec/designs/modules/agent-runtime.md`：提炼 execution workspace resolver、scope/root 派生和 run view lifecycle。
- `openspec/designs/modules/agent-capability.md`：提炼 resolver-backed `WorkspaceFilePort` enforcement、sandbox filesystem layout preparation、resource root injection、cleanup job definitions 和 safe result mapping。
- `openspec/designs/modules/agent-platform-gateway-local.md`：提炼 sandbox physical root mapping、default temp env、scheduled job execution 和 LOCAL/REMOTE 差异。
- `openspec/designs/spec-to-design-map.md`：新增 spec 到设计文档的导航。

## 待确认问题（Open Questions）

无。首版采用物理投影，不做虚拟 filesystem、跨 run cache、body path rewrite 或 bash syntax expansion；session 隔离由 agent policy 决定；local dynamic execution 明确为 development best-effort。
