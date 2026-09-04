[返回 Roadmap V2](../nextagent-ts-change-roadmap-v2.md)

## P4 — 完成整体能力出口

在 P3 执行范式基础上，收敛面向客户和二次开发者的整体能力出口：安全护栏与策略扩展、Session 与前端扩展、远端 Agent 能力、周期任务和开发者 facade。P4 不改变 P0-P3 已冻结的核心契约与运行时边界，所有 change 复用既有 gateway port、capability governance 和 owner scope 约束。

### 安全与策略扩展

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-safety-guardrails`](../nextagent-ts-changes/add-ts-safety-guardrails.md) | candidate | 安全护栏 gateway port，对接外部安全检测 API，输入/输出检查点，enable/disable 配置和 audit 记录。 | [详情](../nextagent-ts-changes/add-ts-safety-guardrails.md) |
| [`add-ts-routing-policy-extension`](../nextagent-ts-changes/add-ts-routing-policy-extension.md) | candidate | routing policy 扩展、非白名单 policy 扩展、remote/script hook extension、动态插件加载和热加载。 | [详情](../nextagent-ts-changes/add-ts-routing-policy-extension.md) |
| [`add-ts-risk-policy-extension`](../nextagent-ts-changes/add-ts-risk-policy-extension.md) | candidate | risk policy 扩展与动态插件加载。 | [详情](../nextagent-ts-changes/add-ts-risk-policy-extension.md) |
| [`add-ts-operational-log-hardening`](../nextagent-ts-changes/add-ts-operational-log-hardening.md) | ready | 运行日志级别、console/file sink 分流、运行态文件落盘、rotation、压缩、默认至少 7 天保留、磁盘水位保护、写入失败降级、flush/close 语义和丢失风险指标。 | [详情](../nextagent-ts-changes/add-ts-operational-log-hardening.md) |

### Session 与前端扩展

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`agent-web-session-bookmark`](../nextagent-ts-changes/agent-web-session-bookmark.md) | candidate | 会话收藏 bookmark API，收藏 session 排除 aging，owner scope 校验和 audit。 | [详情](../nextagent-ts-changes/agent-web-session-bookmark.md) |
| [`agent-web-session-sharing`](../nextagent-ts-changes/agent-web-session-sharing.md) | candidate | 会话分享 `shareToken`、有效期、read-only 问答视图，不暴露思考/工具/用户 metadata。 | [详情](../nextagent-ts-changes/agent-web-session-sharing.md) |
| [`agent-web-session-text-share-download`](../nextagent-ts-changes/agent-web-session-text-share-download.md) | ready | 将会话整理为可外发的纯文本转写，并提供 owner-scoped 复制/下载入口；只暴露用户消息和 agent 最终回答文本。 | [详情](../nextagent-ts-changes/agent-web-session-text-share-download.md) |
| [`agent-web-question-recommendations`](../nextagent-ts-changes/agent-web-question-recommendations.md) | candidate | `GET /api/v1/questions/recommended` 两级分类推荐问题，welcome state 展示。 | [详情](../nextagent-ts-changes/agent-web-question-recommendations.md) |
| [`agent-web-customization`](../nextagent-ts-changes/agent-web-customization.md) | candidate | 产品配置驱动 UI 定制：header icon/service name、操作栏自定义功能注入。 | [详情](../nextagent-ts-changes/agent-web-customization.md) |
| [`agent-web-user-personalization`](../nextagent-ts-changes/agent-web-user-personalization.md) | candidate | `user_profile` 存储，role + knowledgePreferences，前端编辑和 json 导入，作为 context 输入。 | [详情](../nextagent-ts-changes/agent-web-user-personalization.md) |
| [`add-ts-user-facing-i18n-contract`](../nextagent-ts-changes/add-ts-user-facing-i18n-contract.md) | candidate | 客户端可见消息 messageKey、参数化、安全 fallback 和前端 bundle 渲染。 | [详情](../nextagent-ts-changes/add-ts-user-facing-i18n-contract.md) |

### 服务间 Channel 与接口路由

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-ir-channel-request-routing`](../nextagent-ts-changes/add-ts-ir-channel-request-routing.md) | assumption-ready | 新增面向服务间 IR 接口的 channel adapter，请求经 schema 校验与 trusted identity/agent scope 注入后，统一路由到 runtime command boundary。 | [详情](../nextagent-ts-changes/add-ts-ir-channel-request-routing.md) |

### 远端 Agent 能力

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-remote-invoked-agent-execution`](../nextagent-ts-changes/add-ts-remote-invoked-agent-execution.md) | candidate | 远端 Agent 执行。 | [详情](../nextagent-ts-changes/add-ts-remote-invoked-agent-execution.md) |
| [`add-ts-remote-agentregistry-discovery`](../nextagent-ts-changes/add-ts-remote-agentregistry-discovery.md) | candidate | 远端 AgentRegistry discovery。 | [详情](../nextagent-ts-changes/add-ts-remote-agentregistry-discovery.md) |

### 周期任务与开发者体验

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-recurring-agent-tasks`](../nextagent-ts-changes/add-ts-recurring-agent-tasks.md) | candidate | 用户级周期性智能体任务：自然语言建档、模板生成、到期触发、错过触发策略、重叠保护、管理面和审计。 | [详情](../nextagent-ts-changes/add-ts-recurring-agent-tasks.md) |
| [`add-ts-simple-agent-facade`](../nextagent-ts-changes/add-ts-simple-agent-facade.md) | candidate | 面向二次开发者的 `SimpleAgent` facade、默认 profile 推导和最小起步体验。 | [详情](../nextagent-ts-changes/add-ts-simple-agent-facade.md) |
| [`add-ts-dev-agent-workbench`](../nextagent-ts-changes/add-ts-dev-agent-workbench.md) | ready | 开发期 Agent 调测工作台：通过 projection-first 读取既有 session/message/requestRun/timeline/trajectory/safe observation/log evidence，并由 owner-owned minimal safe projection payload 补足必要缺口；不使用 observe-only hook、raw decorator 或 raw snapshot collector。 | [详情](../nextagent-ts-changes/add-ts-dev-agent-workbench.md) |
