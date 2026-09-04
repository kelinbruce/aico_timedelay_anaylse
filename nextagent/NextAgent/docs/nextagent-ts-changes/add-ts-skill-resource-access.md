# add-ts-skill-resource-access

状态：active
类型：实施 change
主要 owner：`agent-runtime` / `agent-capability`；配合 owner：`agent-platform-gateway-local` / `agent-platform-gateway-remote`
依赖：`add-ts-skill-manifest-contract`、`add-ts-builtin-skill-source`、`add-ts-skill-tool`、`add-ts-read-tool`、`add-ts-write-tool`、`add-ts-bash-tool`、`add-ts-python-tool`、`add-ts-app-config-schema`、`add-ts-agent-package-assembly`

目标：
- 为授权 Skill resources 建立安全访问路径，使 `scripts/`、`references/`、`assets/` 可通过 `.nextagent/skills/<skillProjectionKey>/<skill-name>/...` 被文件工具和 sandboxed dynamic execution 按需访问。
- 引入 execution file access policy，由 accepted run 派生同一隔离 base 下的 `workspace/`、`.nextagent/` 和 `temp/` 三个物理 root。
- 继续让只需要 workspace 的消费者只看到派生后的 `workspaceDir`，不默认暴露 `.nextagent` 或 `temp`。

规格输入：
- accepted run 必须从系统级 `runtimeWorkspaceRoot=<paths.workspaceRoot>/execution`、`AgentAssembly.workspacePolicy`、可信 Agent Scope、Owner Scope、session/run facts 和 deployment mode 派生 execution workspace view。
- 本 change 固定的最小 runtime layout：`<workspaceRoot>/data/system/nextagent.sqlite` 与 `<workspaceRoot>/execution/<scope-key>/{workspace,.nextagent,temp/<run-key>}`，其中 Skill resources 位于 `.nextagent/skills/<skillProjectionKey>/<skill-name>/{scripts,references,assets}`。
- 路径长度风险按短 key 和投影预算控制：`scope-key`、`run-key`、`skillProjectionKey` 不超过 16 字符，`<skill-name>` 使用 Skill governed identity 中符合规范的名称且不得截断或重写，超预算 resource path 写入前 fail closed。
- Prompt-facing `workspaceDir` 是 logical `workspace/`，不是宿主绝对路径；物理 workspace root 只在 resolver-backed file/sandbox infrastructure 内使用。
- 默认按 agent + owner subject 隔离，可由 agent policy 选择 session 级隔离；三个 root 必须位于同一 `scope-key` base 下，`temp` 还必须按 run 隔离。
- `.nextagent` 是系统授权资源投影 root，普通文件工具、Skill script、bash/python 和模型生成代码不得写入。
- Skill resource projection 首版只投影顶层 `scripts/`、`references/`、`assets/` 三个目录，不投影 root-level `README*`、`LICENSE*`、`NOTICE*` 或其他文件。
- Projection 的唯一实施路径匹配当前代码：扩展 `SkillSourceDiscovery` 的 governed resource list/read，扩展 `WorkspaceFilePort.projectSkillResources(...)`，由现有 `Skill` Tool 在 body load 成功后同步调用；写入策略固定为 `.locks/<skillProjectionKey>` lock、`.staging/<operation-key>/<skill-name>` 完整写入校验、删除旧 target、rename 到 `.nextagent/skills/<skillProjectionKey>/<skill-name>/`、写 `.projection.json` manifest，manifest 匹配时复用 target，lock 已存在时 bounded-wait 并复查 manifest。
- Skill hidden generated message 必须在同一条 message 中先注入 Skill resource root location，再附加原始 `SKILL.md` body；首版不改写 body 正文。
- 动态执行必须走 sandbox gateway boundary；PaaS/REMOTE 通过容器/Pod 强隔离，LOCAL development mode 只声明 best-effort dynamic execution containment。
- cleanup 不进入 runtime request lifecycle；`agent-capability` 提供 Skill projection cleanup 和 LOCAL temp cleanup jobs，gateway 提供 scheduled job execution，app 只注册 jobs。PaaS sandbox temp 主要由 `emptyDir` 等平台 lifecycle 清理，shared projection cleanup 由 CronJob、singleton maintenance worker 或 gateway adapter 配置的平台级 scheduled worker 承载。

契约输入：
- `agent-contracts/agent-assembly`：`AgentWorkspacePolicy` 替代 runtime-facing `AgentAssembly.workspaceDir`。
- `agent-contracts/runtime`：`ExecutionWorkspaceResolver`、`ResolveExecutionWorkspaceInput`、`ExecutionDeploymentMode`、`ExecutionWorkspaceView` 和 root view。
- `agent-contracts/capability`：不新增 workspace view 字段；现有 `CapabilityInvocationRequest` / `ToolExecutionContext` 中的 identity、agent、session、request、run facts 作为 file/sandbox port 解析 workspace view 的输入。
- `agent-contracts/gateway`：sandbox request 增加受控 filesystem layout，包括 `defaultCwd` 和 `roots[]`；sandbox target paths 和 temp env values 由 gateway adapter 从 root layout 派生；增加最小 scheduled maintenance job execution contract，字段限于 job id、cadence/retention hints、overlap policy 和 `run(signal, now)`；gateway 只负责按部署形态调度执行 capability-provided jobs。

实现约束：
- resolver 只有 accepted-run 单入口；capability、file port、sandbox gateway 和 Skill projection service 不得自行派生 scope/root 或维护独立 root allowlist。
- `agent-core` tool loop 只转发 capability invocation request 和可选 `capabilityResolver`，不得创建、授权、替换或检查 execution workspace roots。
- `WorkspaceFilePort` 是 read/write/glob 和 Skill resource projection 的中心文件访问边界；工具只把 path、operation、现有 `ToolExecutionContext` 和 governed Skill facts 交给 `WorkspaceFilePort`，由 port 内部解析 view 并执行 enforcement；Skill projection 只能通过 system-only `projectSkillResources(...)` 进入。
- app composition 只负责从冻结 config 派生并校验 `runtimeWorkspaceRoot`、装配 resolver，不承载 resolver 业务逻辑。
- app composition 只注册 capability-provided cleanup jobs；不承载 cleanup policy。
- Skill source providers 只产出 normalized resource entries/content bytes、safe display path 和 metadata，不接收 runtime physical roots，也不写 `.nextagent`。
- `scopeBase` 是 internal-only，不得进入 prompt、普通工具结果、safe error、public audit 或模型可见路径。

非目标：
- 不新增模型侧专用 `SkillResource` tool。
- 不新增 public Web API、stream event、用户文件浏览 UI 或附件 upload 行为。
- 不修改 `SKILL.md` frontmatter。
- 不扩大 bash/python 语法、管道、重定向或命令 allowlist。
- 不实现完整通用虚拟文件系统；本 change 只定义 execution roots、resolver-backed view 解析和 `WorkspaceFilePort` enforcement。

验收要点：
- contract tests 覆盖 policy/view/sandbox filesystem layout shape、`AgentAssembly.workspacePolicy`、`WorkspaceFilePort` enforcement、root permission 和 safe reason code。
- unit/integration tests 覆盖 `scope-key`、`run-key`、root 派生、path normalization、projection filtering、projection manifest reuse、staging commit failure、`.nextagent` read-only、temp env、LOCAL/PaaS cwd、capability cleanup jobs 和 gateway scheduled execution。
- security negative tests 覆盖 absolute path、parent traversal、symlink/special file、wrong agent/subject/session/run、unauthorized Skill resource、direct source path 和 sandbox escape。
- architecture tests 覆盖 runtime/core/context/model/channel 不扫描 Skill source directories，file tools/capability/sandbox 不自行派生 root，不使用 app 启动期静态 `workspaceDir`。

并行边界：
- 不修改 Web/channel lifecycle、stream projection 或 public DTO。
- 不把附件 intake 前置阶段并入 execution workspace；附件验证后的 run view 接入由附件 owner 后续定义。
- 不把完整 PaaS multi-instance runtime、remote service discovery、memory 或 artifact download 纳入首版范围。
