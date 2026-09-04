# agent-web-ui-interaction

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：AgentWeb 前端

状态：active
类型：implementation
主要 owner：`agent-web`
协作 owner：`agent-channel-web`
依赖：`add-agent-web-multi-host-modes`、`agent-web-auth-control`

目标：
- AgentWeb 与同 Document 内其他 GUI 组件实时联动。
- 后端 ACTION 结构化指令驱动外部业务面板状态变更，前端负责安全投递和可观察交互状态。

规格输入：
- UI interaction actions MUST be structured and schema-validated before dispatch to host components.
- ACTION payload MUST NOT include credential, raw prompt, raw model output, local path or provider-private error.
- Host component dispatch MUST be scoped to the current document/session context and must not cross owner scope.
- Failed host dispatch MUST produce safe user-visible state and bounded diagnostic reason code.
- AgentWeb MUST keep the backend API boundary stable unless an explicit OpenSpec change defines new server-side events.

契约输入：
- Reuse host mode bootstrap context and auth-control ops.
- Frontend-host interaction schema is owned by `agent-web` unless a server-side stream/API contract is explicitly introduced.
- Backend remains owner of server-side auth and stream projection only.

实现约束：
- `agent-web` owns component registry, dispatch adapter and UI state.
- `agent-channel-web` may project safe structured action events only if covered by an active OpenSpec contract.
- Do not let client metadata, model output or host component state override identity, owner scope or agent scope.

非目标：
- 不新增 generic workflow engine 或 arbitrary plugin runtime。
- 不改变 request lifecycle、terminal commit、session persistence 或 capability governance。
- 不让外部 GUI 组件直接调用 backend private APIs。

验收要点：
- Frontend tests cover structured ACTION validation, dispatch success and dispatch failure state。
- Security tests cover forbidden payload content and cross-session dispatch rejection。
- Architecture tests confirm no backend private import or runtime lifecycle change。

并行边界：
- Can proceed with AgentWeb customization as long as custom operations consume the same auth-control ops and do not redefine ACTION dispatch semantics。
- Any new backend stream/API event must be split into its own OpenSpec-backed contract change。
