## 1. Execution File Policy Contract

- [x] 1.1 在 `agent-contracts/agent-assembly` 定义 `AgentWorkspacePolicy`，包含 `schemaVersion`、isolation mode 和 logical `roots[]`（kind、logicalPath、access）；在 `agent-contracts/runtime` 定义 `ExecutionDeploymentMode`、`ExecutionWorkspaceResolver`、`ResolveExecutionWorkspaceInput`、`ExecutionWorkspaceView` 和 `ExecutionWorkspaceRootView`；在 `agent-runtime` 实现唯一 resolver，消费 app-composed `runtimeWorkspaceRoot=<workspaceRoot>/execution`、runtime-facing `AgentAssembly.workspacePolicy`、trusted accepted-run context 和由 app config/gateway deployment mode 映射出的 `ExecutionDeploymentMode`，派生 internal `scopeBase = <runtimeWorkspaceRoot>/<scope-key>/` 与 run `ExecutionWorkspaceView`（logical `workspaceDir`、`defaultCwd`、`roots[]`）。
  验证：contract/unit tests 覆盖 resolver 单入口、policy schema version、`ExecutionDeploymentMode`、runtime root validation、isolation mode、scope-key/run-key shape、internal `scopeBase` shape、roots[] shape、view 字段 shape、permission enum、invalid root、safe reason code；断言 `ExecutionWorkspaceView` 只有 `workspaceDir`、`defaultCwd`、`roots[]`，不包含 `scopeBase`、`runtimeWorkspaceRoot`、`tempEnv`、`sandboxPath` 或 root `lifecycle`；断言 file tools 和 Skill resource projection 必须通过 `WorkspaceFilePort` 消费 view，sandbox 从同一 view 生成 filesystem layout，且不得自行派生 root；运行 `npm run test:contract`。
  来源：Requirement: Accepted run SHALL derive scoped execution file roots and expose them by need；Requirement: Execution roots SHALL use policy-declared deterministic scope keys；Requirement: Diagnostics and audit SHALL be safe and sufficient；Design 决策 1 和 2

- [x] 1.2 实现 deterministic `scope-key` 派生：默认 subject 级，支持 agent policy 开启 session 级；`scopeBase` 和三个 root 均位于 `<runtimeWorkspaceRoot>/<scope-key>/` 下，且不需要 per-scope metadata 文件；hash 使用版本化 namespace 常量，policy 对象保留 `schemaVersion`，但 runtime-derived view 不需要独立 schema version。
  验证：unit tests 覆盖 same agent/different subject、same subject/different agent、session policy on/off 的 scope-key；断言同一 agentId + owner scope 的不同 agentVersion/agentAssemblyRef 默认产生相同 scope-key，以保留跨版本共享 workspace；断言 `scope-key`、`run-key`、`skillProjectionKey` 均不超过 16 字符，Skill projection 使用 governed Skill identity 的 canonical `<skill-name>` 且不截断、不加 suffix、不重写；断言 client/model/capability args 不能覆盖 isolation mode、runtime root 或 key 输入；断言 policy 对象不包含 deployment mode/物理路径/trusted identity/request-run facts；Windows-oriented 深 `workspaceRoot` 路径长度预算通过。
  来源：Requirement: Execution roots SHALL use policy-declared deterministic scope keys；Design 决策 1 和 2

- [x] 1.3 实现 `temp/<run-key>` root 派生、默认 temp env contract 和后台 cleanup scheduling contract。
  验证：unit/integration tests 覆盖 temp 位于 `<runtimeWorkspaceRoot>/<scope-key>/` 下、不同 run 的 run-key/temp root 不同、gateway adapter 从 temp root 派生 `TMPDIR`/`TMP`/`TEMP` values、runtime terminal path 不删除 temp、expired temp cleanup job 可重复执行。
  来源：Requirement: `temp` SHALL carry run-scoped temporary file operations；Design 决策 3 和 8

- [x] 1.4 实现 runtime resolver 的最小 view 策略：`ExecutionWorkspaceView` 只包含 logical `workspaceDir`、`defaultCwd`、`roots[]`；context prompt 只读取 logical `workspaceDir=workspace/`；file tools、Skill resource projection 和 capability cleanup jobs 只通过 `WorkspaceFilePort` 或 resolver-backed cleanup operation 使用该 view；sandbox/generated code 只从该 view 生成 `SandboxExecutionRequest.filesystem`。
  验证：unit tests 覆盖 view 字段最小化，断言 `scopeBase`、`runtimeWorkspaceRoot` 和无关 source/private facts 不出现在 view 中；architecture/source tests 断言 capability、file tools 和 sandbox gateway 不调用 scope/root 派生 helper，不维护独立 root allowlist，file tools/Skill projection 只能通过 `WorkspaceFilePort` 访问文件，cleanup jobs 只能通过 resolver-backed cleanup operation 访问文件。
  来源：Requirement: Accepted run SHALL derive scoped execution file roots and expose them by need；Requirement: File access SHALL use two-layer checking；Design 决策 3.1

- [x] 1.5 明确附件 upload/intake 不调用 execution workspace resolver：upload/quarantine/pre-validation 使用 attachment-owned system temp 或 gateway attachment store；request accepted 后才通过 accepted run 的 `ExecutionWorkspaceView` 迁移、链接或投影 validated attachments 到 `workspace/` 或 governed system resource view。
  验证：contract/unit tests 覆盖没有 trusted `runId` 时不能构造 `ResolveExecutionWorkspaceInput`，attachment intake 不使用 run `temp/`，accepted request 后 attachment migration/projection 使用 run-derived view 和 root permission。
  来源：Requirement: Accepted run SHALL derive scoped execution file roots and expose them by need；Design 决策 3.2

- [x] 1.6 更新 agent package assembly compiler 对 legacy `agent.yaml.workspaceDir` 的处理：为 source compatibility 可接受该字段，但不得写入 runtime-facing `AgentAssembly`，不得用它派生物理 root；绝对路径、未解析路径、系统目录或 provider-private/source-private 目录必须 fail closed，并产生 safe deprecation/validation evidence。
  验证：assembly contract/unit tests 覆盖 legacy relative workspaceDir 被忽略且 assembly 只有 `workspacePolicy`、unsafe workspaceDir fail closed、prompt-facing workspaceDir 仍等于 logical `workspace/`，physical workspace root 只能由 resolver-backed infrastructure 得到。
  来源：Requirement: Runtime-Ready AgentAssembly Contains Only Runtime-Facing Fields；Requirement: Workspace Resolution And Package Validation Are Compile-Time Preconditions

- [x] 1.7 落地已审视的 frozen public contract 变更和兼容性检查：实现 `AgentAssembly.workspaceDir -> workspacePolicy`、`agent-contracts/runtime` resolver/view/root view types、`WorkspaceFilePort` 中央 enforcement、`agent-contracts/gateway` sandbox filesystem layout 字段和最小 scheduled maintenance job execution contract；`agent-contracts/capability` 不新增 workspace view 字段，继续使用现有 `CapabilityInvocationRequest` / `ToolExecutionContext` facts。
  验证：contract tests 断言 runtime-facing `AgentAssembly` 不再含 `workspaceDir`，`CapabilityInvocationRuntimeContext` 仍只需要现有 `capabilityResolver` 字段，`ToolExecutionContext` 仍携带 identity/agent/session/request/run facts 且不暴露 resolver/scopeBase，file tools 和 Skill resource projection 只通过 `WorkspaceFilePort` 访问文件，gateway sandbox request 只接收 `filesystem.defaultCwd`、`filesystem.roots[]`，scheduled job contract 只表达 job id、cadence/retention hints、overlap policy 和 `run(signal, now)`。
  来源：Design 决策 2 和 3.1；Impact: Frozen contract impact

- [x] 1.8 实现 accepted-run workspace view 解析边界：runtime 提供 resolver；resolver-backed `WorkspaceFilePort`、sandbox port、context prompt owner 和 Skill projection owner 用现有 trusted request/context facts resolve `ExecutionWorkspaceView`；`agent-core` tool loop 只传 capability invocation request 和可选 `capabilityResolver`，不得创建、授权、替换或检查 execution workspace roots；`createCapabilitySubsystem(...)`、file port、sandbox port 和 tool descriptors 在产品路径不得捕获 app 启动期静态 `workspaceDir`。
  验证：runtime/capability integration tests 覆盖同一个 app 进程内两个不同 subject/run 调用同一 tool 时，`WorkspaceFilePort` 根据各自 `ToolExecutionContext` facts 解析出不同 run-derived `workspaceDir`；缺少 trusted run facts 或 resolver-backed file/sandbox port 时 fail closed；agent-core tests/source assertions 断言 tool loop 只构造/转发 `CapabilityInvocationRequest` facts 和 `capabilityResolver`，不引用 `ExecutionWorkspaceResolver` 或 `ExecutionWorkspaceView`；source/architecture tests 断言 product composition 不再把 `compiledAssembly.activeAssembly.workspaceDir` 注入 `createCapabilitySubsystem(... read.workspaceDir ...)`、`createWorkspaceFilePort(...)` 或 sandbox port；允许 test-only fixture 使用 fake static workspace view。
  来源：Requirement: Execution workspace public contracts SHALL be minimal and stable；Design 决策 3.1

- [x] 1.9 更新 app config runtime paths：不新增用户可配置 path entry，继续只接受 `paths.workspaceRoot`，在 app composition 中派生 `runtimeWorkspaceRoot=<workspaceRoot>/execution`；更新 config validation/schema，拒绝 `paths.runtimeWorkspaceRoot`、`paths.executionRoot` 或其他用户可配置 execution-root 字段，并校验 execution root 与 `dataDir`、`systemDataDir`、SQLite parent、`configRoot/skills`、`configRoot/agents`、provider/source-private roots 不重叠。
  验证：app config schema/validation tests 覆盖默认派生 `<workspaceRoot>/execution`、完整 runtime layout `<workspaceRoot>/data/system/nextagent.sqlite` 与 `<workspaceRoot>/execution/<scope-key>/{workspace,.nextagent,temp/<run-key>}`、用户配置 execution root 被拒绝、execution root 与 data/system/sqlite parent/source roots overlap fail closed、file/symlink/junction/reparse point fail closed、runtime resolver 收到的 root 是派生 `runtimeWorkspaceRoot` 而不是 raw `workspaceRoot`。
  来源：Requirement: Built-in defaults and user application config compose into two frozen roots；Requirement: Accepted run SHALL derive scoped execution file roots and expose them by need；Design 决策 1

## 2. Builtin File Tool Integration

- [x] 2.1 将现有 `WorkspaceFilePort`/file port 改为使用 `ToolExecutionContext` facts 解析 run `ExecutionWorkspaceView`：read/write/glob、Skill resource projection 和相关 path normalization 都通过该 port 完成；workspace-only unqualified path 默认解析到 `workspaceDir`，root-qualified path 通过 view roots 和 operation policy 解析。
  验证：file port unit tests 覆盖 workspace-only unqualified relative path 默认解析到 run-derived `workspaceDir`、containment、root-qualified path、授权 `.nextagent/skills/<skillProjectionKey>/foo/...` 可读、未授权 `.nextagent/skills/<otherSkillProjectionKey>/bar/...` 拒绝或不可见、Skill projection 只能通过 system projection operation 写 `.nextagent`、host absolute path/`../`/drive path/URL-like path 拒绝；断言 file port 只通过 injected resolver/policy provider 解析 view，不读取 startup `workspaceDir`、不自行添加 unauthorized roots/subtrees。
  来源：Requirement: File access SHALL use two-layer checking；Requirement: Accepted run SHALL derive scoped execution file roots and expose them by need；Design 决策 5 和 9

- [x] 2.2 更新 `read` / `glob` 工具，使其按 policy 读取 `workspace/`、`.nextagent/` 和 `temp/`，并保持 safe diagnostics。
  验证：tool integration tests 覆盖读取 workspace 文件、读取 `.nextagent` Skill reference、读取 temp 文件、越界路径失败且不泄漏 raw path。
  来源：Requirement: File access SHALL use two-layer checking；Requirement: Diagnostics and audit SHALL be safe and sufficient

- [x] 2.3 更新 `write` / future edit 工具，使其只能写 `workspace/` 和 `temp/`，拒绝写 `.nextagent/`。
  验证：tool integration tests 覆盖写 workspace 成功、写 temp 成功、写 `.nextagent` 失败、覆盖策略和 size limit 生效。
  来源：Requirement: `.nextagent` SHALL be read-only and system-managed；Requirement: `workspace` SHALL carry durable file writes

- [x] 2.4 添加架构测试，确保内置文件工具不维护绕过 runtime execution workspace resolver / `WorkspaceFilePort` enforcement 的独立 root allowlist。
  验证：`npm run lint:architecture` 或 source-level architecture test 覆盖 forbidden direct path resolver / raw workspaceDir use / file port root derivation。
  来源：Requirement: File access SHALL use two-layer checking

- [x] 2.5 更新 context prompt assembly，使其继续只注入 run-derived `workspaceDir`，不默认注入 `.nextagent` 或 `temp`。
  验证：context-engine tests 断言 workspace prompt 中 `workspaceDir` 等于 logical `workspace/`，且不包含 host physical workspace root、`.nextagent` / `temp` root 说明；Skill hidden generated message 单独携带 Skill resource root。
  来源：Requirement: Accepted run SHALL derive scoped execution file roots and expose them by need；Design 决策 5

## 3. Skill Resource Projection

- [x] 3.1 扩展现有 Skill source 和 file port 边界来实现唯一 projection 路径：`SkillSourceDiscovery` 在 `loadCanonicalBodyView(...)` 旁新增 governed `listSkillResources(...)` / `readSkillResource(...)`；Skill Tool 用 `providerId` 选择 provider 后只传 `skillName` 和 `skillVersion`，builtin/local/SkillHub source 在 provider 内部用 manifest path、artifact ref 或 `frontmatterHash` 等私有事实做兜底校验，list 只返回 safe metadata，read 按单项 resource 返回 content stream，且 provider 可来自目录、zip、blob 或 registry 私有布局；`WorkspaceFilePort` 在 read/write/glob/clearRun 旁新增 system-only `projectSkillResources(...)`，由该方法解析 run view、计算 `skillProjectionKey`、先查 committed marker，miss 后才调用 lazy list/read callbacks 执行流式 projection 写入和返回 root location。
  验证：source fixture tests 覆盖 builtin/local/SkillHub source 不接收 runtime root、不写 `.nextagent`、不泄漏 source path，只枚举当前 Skill 目录顶层 `scripts/`、`references/`、`assets/`；projection service tests 覆盖 projection path、`skillProjectionKey` 只由 provider id / skill name / skill version 派生、不同 version 不同 key、same provider/name/version 不同 content/source facts 在 discovery/catalog 阶段 fail closed、safe display path、resource kind、size/hash metadata、超深或超长 resource relative path 在写入前 safe fail，并断言 root-level `README.md`、`LICENSE`、`NOTICE` 和其他不在三目录内的文件不被投影，projection 写权限不暴露为普通 file tool/sandbox `.nextagent` readWrite root；Skill Tool tests 断言 projection target 由 `WorkspaceFilePort.projectSkillResources(...)` 使用 `ToolExecutionContext` facts 和 governed Skill facts 解析，而不是 workspaceDir 拼接。
  来源：Requirement: Skill resources SHALL be projected into `.nextagent`；Design 决策 4 和 7

- [x] 3.2 实现首版 projection committed-marker 策略：`WorkspaceFilePort.projectSkillResources(...)` 先根据 governed identity 检查 target 和 `.nextagent/skills/<skillProjectionKey>/.projection.json` committed marker；marker 匹配同一 provider id、skill name、skill version 和 projection format 时复用 target 且不调用 provider list/read；不匹配时通过 `mkdir .nextagent/skills/.locks/<skillProjectionKey>/` 获取 filesystem lock，lock 已存在时 bounded-wait 并在释放后复查 marker，超时仍不可验证则 safe fail；获得 lock 并再次确认 marker miss 后才 list safe metadata、逐项 read resource、写入 `.nextagent/skills/.staging/<operation-key>/<skill-name>/`，校验 staged tree，删除未提交/旧格式 target，rename staged `<skill-name>/` 到 `.nextagent/skills/<skillProjectionKey>/<skill-name>/`，最后写 committed marker；任一步失败均不返回 resource root location。
  验证：unit/integration tests 覆盖 committed marker match 不调用 list/read 且不复制、缺少/旧格式 marker 时通过 staging rebuild target、lock exists 后等待并复用其他调用完成的 target、lock wait timeout safe fail、staging 校验失败不注入 resource root、rename/marker 写失败不授权、本地并发同一 `skillProjectionKey` 只有一个 projection commit 成功或复用成功、`.locks` 和 `.staging` 不出现在模型授权 subtree 中。
  来源：Requirement: Skill resources SHALL be projected into `.nextagent`

- [x] 3.3 在 `Skill` Tool 成功加载 body 并通过 body boundary validation 后，调用 `WorkspaceFilePort.projectSkillResources(...)`；projection 成功后组装同一条 hidden generated message：先注入 Skill resource root location，再附加原始 Skill body，不改写原始 Skill body 正文；projection 失败时返回 safe failed result，不注入 resource root。
  验证：skill-tool tests 断言 visible acknowledgement 不变，同一 hidden generated message 中 `.nextagent/skills/<skillProjectionKey>/<skill-name>/` 位于原始 body 前，且不额外注入 sandbox absolute `/work/...` resource root；原始 body 内容、代码块和示例未被重写，且不包含 source root/managed install path；断言系统没有为普通 file tool 设置隐式 Skill cwd；projection failure case 断言 generatedMessages 为空或不含 resource root，file/sandbox 未获得授权 subtree。
  来源：Requirement: Skill resources SHALL be projected into `.nextagent`；Requirement: Accepted run SHALL derive scoped execution file roots and expose them by need

- [x] 3.4 实现 `.nextagent` projection 的 read-only 权限，确保 file tools 和 sandbox 都不能修改 projection；LOCAL/no-Docker 只承诺 best-effort，可直接对 committed canonical projection subtree 施加只读 ACL/chmod，因为同一 immutable identity 的普通 activation 不 refresh target。
  验证：integration tests 覆盖 projection service 可写未 committed target，但 write tool、bash、python 尝试写 `.nextagent` 均失败，projection 内容保持不变；LOCAL cleanup 对 ACL/占用失败按 safe diagnostic best-effort 处理，不影响 request terminal path。
  来源：Requirement: `.nextagent` SHALL be read-only and system-managed

- [x] 3.5 实现未授权 Skill resource 不投影或不可见。
  验证：integration/security tests 覆盖未激活/未授权 Skill path read 返回 safe denied/not-found，且不泄漏 source location。
  来源：Requirement: Skill resources SHALL be projected into `.nextagent`；Requirement: Diagnostics and audit SHALL be safe and sufficient

- [x] 3.6 添加架构测试，禁止 runtime/core/context/model/channel import Skill source loader、扫描 Skill source directories 或解析 provider-private layout。
  验证：`npm run lint:architecture` 触发 forbidden dependency/source scan case。
  来源：Requirement: Skill resources SHALL be projected into `.nextagent`

## 4. Sandbox 和动态执行

- [x] 4.1 将 sandbox gateway request 构造改为由 sandbox port 使用 `ToolExecutionContext` facts 和 execution workspace resolver 生成 runtime `SandboxFilesystemLayout`，并转换为 `SandboxExecutionRequest.filesystem`，映射 `workspace/` read-write、授权 Skill projection 子树 read-only、`temp/` read-write；LOCAL deployment mode adapter MAY 使用物理 `scopeBase` 作为实际进程 cwd，REMOTE/PaaS sandbox MUST 使用 `/work` 作为 execution view root/default cwd；deployment mode 继续来自系统级 gateway/platform 配置，不进入 `workspacePolicy`。
  验证：fake sandbox integration tests 断言 sandbox request 只包含必要 `filesystem.defaultCwd`、`filesystem.roots[]` root/subtree mapping、权限正确、local cwd 可为 physical `scopeBase`、PaaS cwd `/work`、不包含 host source path、managed install path、sandboxPath 或 temp env values；断言 gateway 不自行派生 root、读取 startup workspaceDir 或扩大 root set，未授权 `.nextagent` 子树不可达。
  来源：Requirement: Dynamic execution SHALL use deployment-mode-specific sandbox enforcement；Design 决策 7

- [x] 4.2 更新 `bash`、`python`、Skill script execution 和 generated code staging，使它们使用 root-qualified relative paths；local cwd 为 physical `scopeBase` 时可解析 `workspace/...`、`.nextagent/...` 和 `temp/<run-key>/...`，PaaS cwd `/work` 时可解析 `workspace/...`、`.nextagent/...` 和 `temp/...`。
  验证：integration tests 覆盖 python 在 local cwd `scopeBase` 与 PaaS cwd `/work` 下读取 `.nextagent` reference、读取 `workspace/input.log`、写 `workspace/result.txt`、写 temp 文件，并断言 cwd 不是 workspace root。
  来源：Requirement: Dynamic execution SHALL use deployment-mode-specific sandbox enforcement；Requirement: File access SHALL use two-layer checking

- [x] 4.3 实现 dynamic execution 入口 preflight：路径归一、预算、policy、明显越界拒绝；本 change 不扩大 `bash-tool` pipeline、redirect、multi-command 或 command allowlist。
  验证：unit/integration tests 覆盖 `/work/workspace/a.txt` 被归一、host absolute path 被拒绝、现有 bash forbidden syntax 仍失败、越权写 `.nextagent` 被拒绝。
  来源：Requirement: File access SHALL use two-layer checking；Requirement: Dynamic execution SHALL use deployment-mode-specific sandbox enforcement

- [x] 4.4 在 sandbox submission 前应用 capability binding、Skill metadata、request-local deniedTools、risk policy 和 sandbox policy。
  验证：negative integration tests 断言 denied policy 在 sandbox 调用前失败，fake sandbox 未收到调用。
  来源：Requirement: Skill script execution SHALL remain capability-governed

- [x] 4.5 传递 cwd、default temp env、deadline、AbortSignal 和 output policy 到 sandbox，并将 stdout/stderr 映射到 bounded/large-content result。
  验证：integration tests 覆盖 local cwd physical `scopeBase`、PaaS cwd `/work`、gateway adapter 从 temp root 派生 PaaS `TMPDIR`/`TMP`/`TEMP=/work/temp`、local temp env 指向 run temp root、timeout、abort、non-zero exit、oversized stdout/stderr externalization。
  来源：Requirement: Dynamic execution SHALL use deployment-mode-specific sandbox enforcement；Requirement: `temp` SHALL carry run-scoped temporary file operations；Requirement: Resource and file results SHALL obey size, content and large-output policy

- [x] 4.6 覆盖 LOCAL development 与 REMOTE/PaaS production deployment mode 的执行强度差异。
  验证：tests 断言 LOCAL mode 结果/descriptor 标明 best-effort dynamic execution containment；REMOTE/PaaS fake adapter 必须声明 container/Pod root enforcement，且 `.nextagent` 为 filesystem read-only。
  来源：Requirement: Dynamic execution SHALL use deployment-mode-specific sandbox enforcement；Design 决策 5 和 7

## 5. Policy、诊断和安全负例

- [x] 5.1 实现统一 safe failure mapping，覆盖 invalid path、root denied、read denied、write denied、execute denied、resource not authorized、not found、scope mismatch、too large、binary unsupported、consistency mismatch、sandbox unavailable、timeout、aborted、cleanup failed、execution failed。
  验证：contract/unit tests 覆盖所有 reason code，snapshot tests 断言 safe result 不含 raw path/content/stack。
  来源：Requirement: Diagnostics and audit SHALL be safe and sufficient

- [x] 5.2 实现 size、file count、path depth/length、encoding/media type 和 large-content policy。
  验证：unit/integration tests 覆盖大 reference externalize/safe degraded、binary asset 不 stringify、oversized write/stdout/stderr 受控。
  来源：Requirement: Resource and file results SHALL obey size, content and large-output policy；Requirement: Skill resources SHALL be projected into `.nextagent`

- [x] 5.3 添加 cross-scope security tests，覆盖 wrong subject、wrong agent、session policy mismatch、wrong run temp、unauthorized Skill resource、direct source path。
  验证：security tests 断言全部 safe-fail 或不可达，且不泄漏资源是否存在于其他 scope。
  来源：Requirement: Execution roots SHALL use policy-declared deterministic scope keys；Requirement: Diagnostics and audit SHALL be safe and sufficient

- [x] 5.4 添加 observability/audit safe fields，记录 operation、root kind、safe Skill id/resource kind/display path、status、reason、duration、byte counts、sandbox outcome。
  验证：observability tests 断言 audit/log 不包含 prompt、model output、file body、script source、full stdout/stderr、raw path、credential。
  来源：Requirement: Diagnostics and audit SHALL be safe and sufficient

- [x] 5.5 添加 execution boundary 架构测试，确保 Skill scripts、bash、python、generated code 不绕过 sandbox gateway；REMOTE/PaaS mode 不通过普通宿主进程直接执行。
  验证：`npm run lint:architecture` 或 source-level architecture test 断言 direct spawn/import 被拒绝，local adapter 例外必须位于 sandbox gateway implementation boundary 内。
  来源：Requirement: Dynamic execution SHALL use deployment-mode-specific sandbox enforcement；Requirement: Skill script execution SHALL remain capability-governed

- [x] 5.6 实现并验证 cleanup jobs 和 gateway scheduled execution：`agent-capability` 提供 Skill projection cleanup job 和 LOCAL temp cleanup job；`agent-app` 注册 jobs；gateway 按部署形态执行 jobs；runtime terminal path 不触发 filesystem cleanup；过期 `.nextagent` projection、stale `.nextagent/skills/.staging/*`、stale `.nextagent/skills/.locks/*` 和 LOCAL expired `temp/<run-key>` 按 retention/mtime/catalog 授权状态清理。
  验证：cleanup integration tests 覆盖 normal terminal/cancelled run 不执行 runtime cleanup、gateway scheduled execution 触发 capability jobs、expired run temp cleanup、expired/unauthorized Skill projection cleanup、stale staging/lock cleanup、PaaS temp cleanup 可由 platform lifecycle no-op、shared projection cleanup 需要 singleton/CronJob 配置、cleanup failure safe diagnostic。
  来源：Requirement: `temp` SHALL carry run-scoped temporary file operations；Requirement: Cleanup jobs SHALL be capability-owned and gateway-scheduled；Design 决策 11

## 6. 收尾验证

- [x] 6.1 运行 OpenSpec strict validation。
  验证：`openspec validate add-ts-skill-resource-access --strict`
  来源：OpenSpec change 完整性门禁

- [x] 6.2 运行相关包测试、contract test 和架构测试。
  验证：`npm test`、`npm run test:contract`、`npm run lint:architecture`
  来源：proposal Impact、design Verification Map、AGENTS.md 验证门禁

- [x] 6.3 检查 task-to-spec 覆盖，确认每个 requirement 至少有一个实现任务和一个 negative/security 验证入口。
  验证：code review 检查点，逐项对照 `specs/skill-resource-access/spec.md` 与本 tasks；无法完全自动化，因为这是跨 artifact traceability 审查。
  来源：OpenSpec task 可追踪性规则

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/skill-resource-access/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/skill-invocation-and-disclosure.md`。
- 按需更新 `openspec/designs/modules/agent-runtime.md`。
- 按需更新 `openspec/designs/modules/agent-capability.md`。
- 按需更新 `openspec/designs/modules/agent-platform-gateway-local.md`。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义 root policy、source loader owner、sandbox execution owner 或文件工具权限语义。
