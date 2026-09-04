## 背景与问题（Why）

NextAgent 已经通过 `skill-manifest-contract` 定义 `SKILL.md` frontmatter，通过 `skill-tool` 定义授权后的 `SKILL.md` body 加载，通过 builtin、local 和 SkillHub source 定义 Skill 发现、安装和 catalog 治理。但是 Agent Skills 标准不仅包含 `SKILL.md`，还允许 Skill 目录携带 `scripts/`、`references/`、`assets/` 等按需资源。

当前规格对这些资源只留下“后续 change 承接”的边界。与此同时，现有 workspace 主要是 agent 级目录，不能完整表达运行时文件访问的三类行为：读取系统授权资源、写入长期存在的用户/会话文件、使用 run 级临时文件。如果直接让模型按 Skill source path、managed install path 或宿主路径调用 `read`、`write`、`bash`、`python`，会破坏 Agent Scope、Owner Scope、sandbox、审计和 source-private layout 边界。

本变更的必要性在于：为 Skill resources 建立安全访问路径，并为此引入 execution file access policy。该 policy 统一派生运行期隔离 base 和必要的物理 root，但各消费者只接收自己实际需要的路径视图；现有需要 `workspaceDir` 的 prompt-facing 路径继续消费 logical `workspace/`，物理 workspace root 只在 resolver-backed infrastructure 内使用。Change 名称保留 `add-ts-skill-resource-access`，但正文明确：基础能力是 execution file access policy，Skill resources 是首个用例，不把本 change 扩展成通用文件系统重构。

## 变更范围（What Changes）

- 新增 execution file access 行为契约，要求每次 accepted run 先派生 internal isolation base，再派生三个物理 root，并按消费者实际需要暴露对应路径视图：
  - `scopeBase`：内部隔离 base，形如 `<runtimeWorkspaceRoot>/<scope-key>/`，只允许 resolver、projection、sandbox adapter、capability cleanup job 等基础设施访问，不暴露给模型、普通工具结果、safe error 或 prompt。
  - `workspace/`：持久化读写目录，用于长期存在的用户/会话文件和工具结果。
  - `.nextagent/`：系统授权资源目录，只读，用于 Skill resources 等运行时授权投影。
  - `temp/`：run 级临时目录，读写，用于脚本中间文件、生成代码暂存和 scratch。
- 定义 prompt-facing `workspaceDir = workspace/`。Context prompt 和其他现有只需要 workspace 的模型可见路径继续只接收该 logical `workspaceDir`，不强制暴露 `.nextagent/`、`temp/` 或宿主物理路径。
- 定义系统级 runtime workspace root 来源：不新增用户配置字段，复用最终冻结的 `paths.workspaceRoot` 作为 runtime output root，并由 app composition 派生 `runtimeWorkspaceRoot = <workspaceRoot>/execution` 作为 execution file roots 的物理基座；同时在 agent 装配阶段生成 `AgentAssembly.workspacePolicy`。该 policy 只承载稳定的 agent 级执行文件授权输入：`schemaVersion`、隔离策略和逻辑 root policy（kind、logicalPath、access）；不承载 lifecycle、deployment mode、物理路径、trusted identity、session/run facts 或 provider-private loading facts。
- 定义 deterministic 短路径：`<runtimeWorkspaceRoot>/<scope-key>/workspace/`、`<runtimeWorkspaceRoot>/<scope-key>/.nextagent/`、`<runtimeWorkspaceRoot>/<scope-key>/temp/<run-key>/`；`scope-key` 由 versioned hash namespace、agent id、tenant id、subject id、isolation mode 和可选 session id hash 得到，`run-key` 由 versioned hash namespace 和 run id hash 得到。
- 定义 unified isolation base：Agent policy 声明隔离策略，默认 subject 级，可选 session 级；三个 root 都必须位于同一个 `scope-key` base 下，`temp/` 在 base 内再按 run 隔离。
- 定义 `ExecutionWorkspaceResolver` port、`ResolveExecutionWorkspaceInput`、`ExecutionDeploymentMode` 和 `ExecutionWorkspaceView` contract。resolver 只有一个 accepted-run 入口：根据 system root、`AgentAssembly.workspacePolicy`、trusted agent/owner/session/run facts 和既有 deployment mode 映射出的 `ExecutionDeploymentMode` 派生 internal `scopeBase` 与 run `ExecutionWorkspaceView`。该 view 使用 `roots[]` 表达 root layout，避免把 `workspaceDir/systemResourcesDir/tempDir` 固化为顶层字段。
- 定义 runtime resolver owner 负责输出单一 run-scoped `ExecutionWorkspaceView`。内置 `read`、`write`、`glob` 和 Skill resource projection 必须通过 `WorkspaceFilePort` 消费该 view；`bash`、`python`、模型生成代码等动态执行承载方式必须从同一 view 生成 sandbox filesystem layout。各工具不得自行派生 root、拼接物理路径或维护独立 allowlist。
- 定义两层检查：第一层在工具/能力入口基于 runtime-supplied view 做 path normalization、root permission、capability/Skill/risk policy、预算和明显越权校验；第二层由 `WorkspaceFilePort` 或 sandbox adapter 基于同一个 view 和当前操作事实执行真实 enforcement。REMOTE/PaaS deployment mode 必须由容器/Pod 强制三 root；LOCAL development mode 对动态执行只承诺 best-effort enforcement。
- 定义 active Skill resources 在 `Skill` Tool 成功加载 body 后投影到 `.nextagent/skills/<skillProjectionKey>/<skill-name>/...`；`skillProjectionKey` 由 governed Skill provider id、skill name 和 skill version 派生。Governed `providerId + skillName + skillVersion` MUST be an immutable content identity：若 discovery/catalog 阶段发现同 provider/name/version 对应不同内容或不同来源，必须 fail closed，最终进入 catalog 的 governed Skill identity 必须唯一；projection 不再引入额外 consistency token。File tool 和 sandbox 只能获得当前 run/activation 授权的 Skill projection 子树，不默认获得整个 `.nextagent/`；Skill hidden generated message MUST 在同一条 message 中先放 Skill resource root location，再放原始 `SKILL.md` body，不在首版改写 body 正文。
- 定义唯一的当前代码实施方案：扩展现有 `SkillSourceDiscovery`，在 `loadCanonicalBodyView(...)` 旁新增 governed resource list/read；扩展现有 `WorkspaceFilePort`，在 read/write/glob/clearRun 旁新增 system-only `projectSkillResources(...)`；`Skill` Tool 在 body load 和 boundary validation 后、generated message 组装前调用该 projection operation，并把 provider list/read 作为 lazy 回调交给 `WorkspaceFilePort`。Projection 写入固定采用 committed marker 复用、`.locks/<skillProjectionKey>` filesystem lock、`.staging/<operation-key>/<skill-name>` 完整写入校验、删除未提交/旧格式 target、rename staged target、写 `.projection.json` committed marker 的顺序；marker 命中同一 immutable identity 时复用现有 target 且不 list、不打开 resource stream，lock 已存在时 bounded-wait 并复查 marker，超时仍不可验证则 safe fail。
- 定义 `.nextagent/` 默认只读；其中 `scripts/` 下被授权的脚本可以作为 sandbox 执行输入，但脚本不得写回 `.nextagent/`。
- 定义脚本执行必须走 sandbox gateway boundary，使用受控 cwd、allowed roots、argv/stdin/env/deadline/cancellation，输出只能写入 `workspace/` 或 `temp/`；local development adapter 的实际进程 cwd MAY 是物理 `scopeBase`，PaaS sandbox 的 canonical execution view root 和默认 cwd MUST 是 `/work`；默认临时目录必须映射到 run-scoped `temp/`。
- 定义 cleanup 不进入 runtime request lifecycle：`agent-capability` 提供 Skill projection cleanup 和 LOCAL temp cleanup jobs，`agent-platform-gateway-*` 提供 scheduled job execution，`agent-app` 只注册 jobs；PaaS sandbox temp 主要由 sandbox/Pod volume lifecycle（如 `emptyDir`）清理，shared projection cleanup 必须由 CronJob、singleton maintenance worker 或 gateway adapter 配置的平台级 scheduled worker 承载。
- 定义文件大小、数量、路径规范化、symlink/special file、防 traversal、审计、诊断和 large-content 边界。
- 明确附件 upload/intake 阶段不属于 execution workspace：附件可先进入系统 upload temp/quarantine 并完成可信校验；request accepted 后，才使用同一个 resolver 得到 run view，并把已验证附件迁移、链接或投影到 `workspace/` 或受控系统资源位置。
- 不新增模型侧专用 `SkillResource` Tool；不新增 public Web API、stream event 或用户文件浏览 UI；不修改 `SKILL.md` frontmatter；不扩大 `bash-tool` 语法或命令 allowlist。

## Capability 影响（Capabilities）

### 新增 Capability
- `skill-resource-access`: 定义 Skill resources 如何通过 execution file roots 暴露给内置文件工具和 sandboxed dynamic execution。
- 基础能力说明：本 change 同时定义 `execution-file-access-policy` 作为 Skill resource access 的支撑机制，但不单独改名 change。

### 修改的 Capability
- `read-tool` / `write-tool` / `bash-tool` 相关行为需要在归档时吸收：它们必须从同一 runtime `ExecutionWorkspaceView` 派生实际需要的 logical `workspaceDir`、可访问 root、权限和路径诊断；物理路径只在 resolver-backed infrastructure 内使用。
- `skill-tool` 相关行为需要在归档时吸收：Skill body 加载后，相关 resources 的模型可见路径必须指向 `.nextagent/skills/<skillProjectionKey>/<skill-name>/...` 的受控投影；resource root 必须在同一个 hidden generated message 中位于 body 前，而不是暴露 source path。
- `agent-package-assembly` / `ts-core-contracts` 相关行为需要在归档时吸收：runtime-facing `AgentAssembly.workspaceDir` 由 `AgentAssembly.workspacePolicy` 替代；物理 root 不再由 agent package workspaceDir 单独决定。
- `app-config-schema` 相关行为需要在归档时吸收：`paths.workspaceRoot` 继续是唯一用户可配 runtime output root；`runtimeWorkspaceRoot` 是派生路径 `<workspaceRoot>/execution`，不得新增用户可配 path entry。

## 影响范围（Impact）

- Frozen contract impact：`AgentAssembly.workspaceDir -> workspacePolicy`、`agent-contracts/runtime` 新增 resolver/view/root view types、`agent-contracts/gateway` 扩展 sandbox filesystem layout，并增加最小 scheduled maintenance job execution contract。`agent-contracts/capability` 不新增 workspace view 字段；现有 `CapabilityInvocationRequest` / `ToolExecutionContext` 中的 trusted facts 作为 file/sandbox port 解析 workspace view 的输入。本 change 已完成 public contract review，字段名、root kind、access、resolver 输入、deployment mode vocabulary、gateway scheduled job shape 和 owner 边界在本 change 内按 frozen contract 处理；实现阶段必须按这些已审视 contract 落 contract tests。
- `agent-contracts/agent-assembly`：定义 `AgentWorkspacePolicy`，替代 runtime-facing `workspaceDir` raw path。`agent-contracts/runtime` 承载 `ExecutionWorkspaceResolver` port、`ResolveExecutionWorkspaceInput`、`ExecutionDeploymentMode`、`ExecutionWorkspaceView` / root view 接口；view 字段在 design 中完整定义。View 不需要独立 `schemaVersion`，除非未来成为 durable/remote contract。
- `agent-contracts/gateway`：如果现有 sandbox request 无法表达 root mapping 和 cwd，需要扩展 `SandboxExecutionRequest.filesystem` 的必要字段（`defaultCwd`、`roots[]`）；deployment mode 继续来自系统级 gateway/platform 配置，gateway 只实施从 runtime view 派生出的 filesystem layout，不拥有授权判断。sandbox target paths 和 temp env values 由 gateway adapter 从 `defaultCwd`、root `logicalPath` 和 temp root 派生。Gateway 还提供最小 scheduled maintenance job execution contract，只负责调度执行 capability-provided cleanup jobs，不解释 Skill identity、catalog 授权或 cleanup candidates。
- `agent-app` / assembly：从冻结 app config 的 `paths.workspaceRoot` 派生并校验 `runtimeWorkspaceRoot=<workspaceRoot>/execution`，装配 resolver implementation，并在 agent 装配阶段生成 `AgentAssembly.workspacePolicy`；不承载 resolver 业务实现。
- `agent-runtime`：实现 execution workspace resolver，accepted run 时用 `AgentAssembly.workspacePolicy`、app-composed `runtimeWorkspaceRoot`、trusted run context 和 `ExecutionDeploymentMode` 派生 `ExecutionWorkspaceView`；`agent-core` 只转发 capability invocation request 和可选 `capabilityResolver`，不得创建或修改 execution workspace roots。
- `agent-attachment-runtime`：upload/intake 阶段使用自己的系统临时区或 gateway attachment store，不调用 execution workspace resolver；request accepted 后的附件迁移/投影使用 run `ExecutionWorkspaceView`。
- `agent-capability`：继续使用现有 `CapabilityInvocationRequest` / `ToolExecutionContext` facts；file tools 和 Skill resource projection 必须通过 resolver-backed `WorkspaceFilePort` 执行路径解释、权限检查和 filesystem enforcement；sandbox port 必须用同一 facts/resolver 生成 gateway filesystem layout；提供 Skill projection cleanup job 和 LOCAL temp cleanup job，但不自行启动 timer；不得新增绕过 `WorkspaceFilePort` 的资源读取入口，也不得自行拼接 scope/root 或缓存启动期 `workspaceDir`。Skill resource projection 的唯一实现路径是扩展 `SkillSourceDiscovery` resource list/read、扩展 `WorkspaceFilePort.projectSkillResources(...)`、并在现有 `Skill` Tool body load 成功后同步调用。
- `agent-platform-gateway-local` / `agent-platform-gateway-remote`：sandbox gateway 需要按 runtime/capability 传入的 filesystem layout 构造 root 映射：`workspace/` 可读写、`.nextagent/` 只读、`temp/` 可读写；REMOTE/PaaS mode 必须容器强隔离，LOCAL development mode 只能声明 best-effort dynamic execution containment。Gateway scheduled execution 承载 capability cleanup jobs：LOCAL 可使用 in-process self-rescheduling timer；REMOTE/PaaS 对共享 storage 必须使用 CronJob、singleton maintenance worker 或 gateway adapter 配置的平台级 scheduled worker，PaaS sandbox temp 可由 `emptyDir` 等平台 lifecycle 管理。
- Skill source providers：builtin、local、SkillHub source 只负责从 provider-private source 产出规范化 safe metadata，并在 projection 未命中时按单项 resource 返回 content stream；物理 `.nextagent` 写入由 `WorkspaceFilePort.projectSkillResources(...)` 通过 run `ExecutionWorkspaceView`、governed Skill facts 和 lazy provider callbacks 完成。source provider 不向模型、runtime、core、context、channel 暴露 source path，也不接收 runtime root。
- `agent-observability` / audit：记录 root kind、operation、safe skill id、resource kind、safe display path、status、reason、duration 和 byte counts，不记录 raw path、正文、stdout/stderr 大块或 provider-private facts。
- 测试：需要新增 contract、unit、integration、architecture 和 security negative cases，覆盖 root permission、scope isolation、path traversal、symlink/special file、unauthorized Skill resource、script sandbox escape、oversized resource、capability cleanup jobs、gateway scheduled execution 和 raw path 泄漏。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/skill-resource-access/spec.md`：新增 execution file roots 与 Skill resource projection baseline。
- `openspec/specs/app-config-schema/spec.md`：补充 `runtimeWorkspaceRoot=<workspaceRoot>/execution` 派生路径、禁止用户配置 execution root、以及 runtime data/execution root 隔离校验。
- 归档时按实际 owner 将 `read-tool`、`write-tool`、`bash-tool`、`skill-tool` 的相关 requirement 同步或交叉引用。

长期背景：
- `openspec/overview.md`：补充 NextAgent 通过 `workspace/`、`.nextagent/`、`temp/` 三个执行文件 root 支持 Agent Skills progressive disclosure。

设计视图：
- `openspec/designs/architecture/skill-invocation-and-disclosure.md`：补充 Skill body、resource projection、file tools、sandbox gateway 的跨模块流程。
- `openspec/designs/modules/agent-runtime.md`：补充 execution workspace resolver、scope/root 派生和 run view lifecycle。
- `openspec/designs/modules/agent-capability.md`：补充 `ExecutionWorkspaceView` 的消费、`WorkspaceFilePort` enforcement、Skill resource projection path、cleanup jobs 和 safe result mapping。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充 sandbox 物理 root 映射、权限和 scheduled job execution。
- `openspec/designs/spec-to-design-map.md`：新增 `skill-resource-access` 到 architecture/module design 的导航。

验证入口：
- Contract tests：`AgentAssembly.workspacePolicy` shape、run workspace view 派生出的 root layout、local cwd `scopeBase`、PaaS cwd `/work`、root permission、safe reason code。
- Unit tests：path normalization、root selection、projection filtering、permission denied、size/count limits。
- Integration tests：read Skill reference、execute Skill script via sandbox、script writes workspace output/temp scratch、`.nextagent` write denied、default/session scope-key、different Skill versions do not overwrite projections、committed marker match reuses projection without listing or reading resources、uncommitted leftover rebuilds target、projection failure does not inject resource root。
- Security negative tests：absolute path、parent traversal、symlink、wrong subject/agent/session、unauthorized Skill、direct source path、sandbox escape。
- Architecture tests：core/context/model/channel 不得扫描 Skill source directories；dynamic execution 不得直接使用宿主进程权限；product composition 不得把 app 启动期静态 `workspaceDir` 注入 capability/file/sandbox product path；file tools 和 Skill resource projection 必须通过 `WorkspaceFilePort` 使用现有 `ToolExecutionContext` facts 解析 run `ExecutionWorkspaceView`，sandbox 必须从同一 facts/resolver 生成 filesystem layout，不得自行派生 root。
