# add-ts-runtime-host-agent-selection

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Runtime Host Agent 选择

状态：candidate
类型：扩展候选 change
主要 owner：`agent-runtime`、`agent-app`、`agent-channel-web`
依赖：`establish-ts-core-contracts`、`add-ts-agent-package-assembly`、`add-ts-app-config-schema`、`add-ts-local-configured-auth`、`add-ts-local-session-store`

目标：
- 支持同一 runtime 托管多个 Host Agent 时，由可信 host/path/auth/app composition selection 为新 session 或无 session 请求确定 Agent Scope。
- 将“哪个 Agent 处理当前请求”的第一层选择与“已选 Agent 内部走 workflow / model loop / skill / handoff”的第二层 routing 分离。
- 已存在 session 的后续请求必须继续使用持久化 `Session.agentId`；请求体、模型输出、Capability 参数或客户端 metadata 不得覆盖。

规格输入：
- Host Agent selection 是 request acceptance 前或 acceptance 时的可信边界事实，来源只能是 app composition、已认证 host/path binding、trusted channel/auth identity、部署配置或已持久化 session/run。
- Runtime 在创建新 session 时必须把 selected `agentId` 固化到 `Session.agentId`；在接受 run 时必须固化 `RequestRun.agentId`、`agentVersion` 和 `agentAssemblyRef`。
- 对已有 session，runtime 必须先读取 `Session.agentId`，并校验当前 trusted host selection 与 session-bound Agent Scope 兼容；不兼容时 fail closed。
- 多 Host Agent selection 不得使用客户端请求体中的 agent override、未认证 query/body metadata、模型输出、Tool/Skill 参数或 remote provider response。
- Selection result 必须可观测和可审计，但不得泄漏 host auth 细节、credential、raw path、raw policy input 或高基数字段。
- 缺失、禁用、未授权或 assembly 不可用的 Agent 必须返回 safe error；不得 fallback 到默认 Agent，除非 trusted host policy 明确配置了安全 fallback 且 fallback 也通过权限校验。
- Runtime 只负责固化 Agent Scope、session/run lifecycle 和安全拒绝；不负责 workflow recipe、intent recognition、model loop 或 Skill routing 的业务决策。

实现约束：
- `agent-app` 负责启动期装配多个可托管 Agent、host selection config 和可信 selector。
- `agent-channel-web` 只传递可信 host/channel/auth selection 结果，不拥有 request lifecycle，不直接解释 Agent 内部业务路由。
- `agent-runtime` 是 Agent Scope 固化点：session 创建、session lookup、request acceptance 和 recovery 都必须使用同一可信 Agent Scope 来源。
- `agent-core` 只消费已固化的 Agent Scope，在该 Agent 内执行第二层 routing。

非目标：
- 不定义 Agent 内部 workflow vs model loop 路由；该能力由 `add-ts-agent-routing-recipe-dispatch` 和 Agent routing 能力组承载。
- 不定义远端 Agent Registry discovery 或远端 Agent execution。
- 不支持运行时动态新增/删除 Agent、hot reload、灰度发布或同版本 snapshot store。
- 不把 local auth 扩展成多用户 IAM 或公网认证系统。

验收要点：
- Contract：新 session 使用 trusted selected Agent；已有 session 使用 `Session.agentId`，显式 override 不生效。
- Security：客户端 body/query/metadata 中的 agent override 被拒绝或忽略，并有 safe diagnostic。
- Recovery：recovered run 使用持久化 `RequestRun.agentId` / `agentVersion` / `agentAssemblyRef`，不得重新按 active/default Agent 选择。
- Observability：selection success/failure 产出脱敏 structured diagnostic/audit fact。
- Architecture：channel 不拥有 lifecycle，runtime 不做 Agent 内部业务路由，core 不重新选择 Host Agent。

并行边界：
- 本 change 是多 Host Agent 第一层选择；Agent 内第二层 routing、workflow recipe dispatch 和 model loop fallback 不在本 change 中实现。
- 若需要新增 public Web route、runtime command 字段或 host selection DTO，必须先完成对应 OpenSpec contract refinement。
