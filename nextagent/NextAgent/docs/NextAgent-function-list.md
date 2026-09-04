# NextAgent Function List（功能清单）

> 定位：面向测试与智能体开发者，按能力域列出系统提供的黑盒能力单元。Function 的主角是系统，描述系统能做什么；一个 Feature 由一个或多个 Functions 形成。
>
> 本文档与现有文档职责区分：`NextAgent测试特性树.md` 含符合性评估与业务流程图（偏测试视角对比）；本文档为按能力域组织的功能索引，聚焦“系统具体提供哪些功能、对应哪些 Feature、追溯到哪个 spec”，不含符合性评估、规范性 Requirement、白盒实现或流程图。stable spec 是 Function 行为、系统质量属性和目标规格的唯一规范来源。
>
> 配套文档：[NextAgent Feature List（特性清单）](./NextAgent-feature-list.md)。Function 与 Feature 通过清单列和长期叶子文档显式关联，不按 `FN-*` 与 `F-*` 编号推断一一对应关系。新 Function 只能导航到一个 spec；现有多 spec 行保留为 legacy baseline，不授权新增多对多映射。
>
> 状态定义同 Feature List：稳定 / 在建 / 稳定基线 + 在建补齐。

## D1 会话与流式交互

| 编号 | 功能 | 接口/入口 | spec 追溯 | 覆盖 feature |
|---|---|---|---|---|
| FN-1.1 | SSE 流式读取 timeline envelope | `GET /api/v1/sessions/:sessionId/stream` | `ts-web-sse-ws-transports` | F-1.1 |
| FN-1.2 | WebSocket 流式读取 timeline envelope | `GET /api/v1/sessions/:sessionId/ws` | `ts-web-sse-ws-transports` | F-1.1 |
| FN-1.3 | 断点续传重放（lastSeenSequence） | SSE/WS 携带 lastSeenSequence | `ts-stream-resume-replay` | F-1.2 |
| FN-1.4 | 冷启动全量 replay（lastSeenSequence=0） | SSE/WS 显式 0 | `ts-stream-resume-replay` | F-1.2 |
| FN-1.5 | stream/history 终态一致性 | stream + RequestRun + visible history | `ts-stream-history-consistency` | F-1.2 |
| FN-1.6 | 创建会话（owner+agent scoped） | `POST /api/v1/sessions` | `ts-minimal-agent-kernel` | F-1.3 |
| FN-1.7 | 列出会话（分页/搜索过滤） | `GET /api/v1/sessions` | `session-history-search` | F-1.3 |
| FN-1.8 | 删除会话及从属 | `DELETE /api/v1/sessions/:sessionId` | `session-delete` | F-1.3 |
| FN-1.9 | 会话预览与导航（cursor 翻页/锚点） | `GET /api/v1/sessions/:sessionId/conversation` | `session-conversation-preview` | F-1.3 |
| FN-1.10 | 会话标题（自动生成/手动更新） | `PUT /api/v1/sessions/:sessionId/title` | `session-title-generation`、`session-title-update` | F-1.3 |
| FN-1.11 | 对话标注 upsert（sentiment 点赞/点踩 + 收藏；comment 仅持久层定义，Web DTO 未暴露） | `POST /api/v1/sessions/:sessionId/runs/:runId/annotations` | `conversation-annotation` | F-1.4 |
| FN-1.12 | 收藏列表（分页） | `GET /api/v1/favorites` | `conversation-annotation` | F-1.4 |
| FN-1.13 | 创建分享链接 | `POST /api/v1/sessions/:sessionId/shares` | `conversation-share` | F-1.4 |
| FN-1.14 | 只读查看分享会话 | `GET /api/v1/shares/:shareId/conversation` | `conversation-share` | F-1.4 |
| FN-1.15 | 从消息派生子会话 | session fork from message | `session-fork-from-message`；在建 `fix-agent-web-fork-inherited-retry-edit-disable`(0/8) | F-1.5 |
| FN-1.16 | 分类问题查询 | `GET /api/v1/category-questions` | `category-question-api`、`category-question-source` | F-1.6 |
| FN-1.17 | 高频问题查询（动态排序） | `GET /api/v1/frequent-questions` | `frequent-question-api` | F-1.6 |
| FN-1.18 | 输入联想查询 | `GET /api/v1/question-association` | `question-association-api` | F-1.6 |
| FN-1.19 | 用户问题活动持久化（ask_frequency） | submit 时 fire-and-forget | `user-question-activity` | F-1.6 |
| FN-1.20 | 用户问题 pin（已移除，迁移中） | `POST /api/v1/user-questions/pin`（已返回 404） | 在建 `migrate-question-pin-to-annotation` | F-1.6 |
| FN-1.21 | 推荐问题查询 | `POST /api/v1/sessions/:sessionId/requests/:requestId/suggested-questions` | `question-recommendation` | F-1.6 |

## D2 请求运行时

| 编号 | 功能 | 接口/入口 | spec 追溯 | 覆盖 feature |
|---|---|---|---|---|
| FN-2.1 | 便捷提交（自动创建会话） | `POST /api/v1/requests` | `ts-minimal-agent-kernel`、`ts-web-command-idempotency`；在建 `refine-ts-input-guard-blocked-round-as-run`(0/13) | F-2.1 |
| FN-2.2 | session-scoped 提交（same-lane 排队） | `POST /api/v1/sessions/:sessionId/requests` | `ts-minimal-agent-kernel`、`session-lane-scheduling` | F-2.1 |
| FN-2.3 | 命令幂等（idempotencyKey 重复返回首次结果） | submit/cancel/retry 携带 idempotencyKey | `ts-web-command-idempotency`、`idempotency-contract` | F-2.1 |
| FN-2.4 | 取消最新活动请求 | `POST /api/v1/sessions/:sessionId/cancel` | `request-cancel` | F-2.2 |
| FN-2.5 | AbortSignal 级联取消（模型/工具/Skill/Agent） | runtime internal | `request-cancel` | F-2.2 |
| FN-2.6 | 重试最新已结束请求（新 run/attempt+1） | `POST /api/v1/sessions/:sessionId/retry` | `request-retry` | F-2.3 |
| FN-2.7 | same-session lane 串行调度 | SessionLaneScheduler | `session-lane-scheduling` | F-2.4 |
| FN-2.8 | 单 session 单 active run 拒绝并发 | submit 时 safe conflict | `session-lane-scheduling`、`ts-minimal-agent-kernel` | F-2.4 |
| FN-2.9 | routing policy 决策（accepted 后、context 前） | AgentRoutingPolicy | `agent-routing-core` | F-2.5 |
| FN-2.10 | directive routing（`$skill:`/`$workflow:`） | submit routingConstraints | `directive-capability-routing`、`agent-routing-core` | F-2.5 |
| FN-2.11 | 目标 Skill 路由约束校验 | routingConstraints.targetSkill | `targeted-skill-routing`、`routing-evidence-and-fallback` | F-2.5 |
| FN-2.12 | 用户可见运行状态投影 | stream event + run status | `ts-run-status-visibility` | F-2.6 |
| FN-2.13 | terminal commit（唯一权威终态） | runtime commitTerminal | `ts-minimal-agent-kernel`（terminal consistency） | F-2.7 |
| FN-2.14 | 后台任务完成通知 | background task completion event | `background-task-completion` | F-2.8 |
| FN-2.15 | 后台任务控制 | agent-web background task control | `agent-web-background-task-control` | F-2.8 |
| FN-2.16 | 编辑重提（新 root 用户消息 + 新 run） | `POST /api/v1/sessions/:sessionId/edit` | `request-edit-resubmit` | F-2.3 |

## D3 Agent 装配与主链路

| 编号 | 功能 | 接口/入口 | spec 追溯 | 覆盖 feature |
|---|---|---|---|---|
| FN-3.1 | Agent package 装配（agent.yaml/skills/subagents/prompts） | `agents/{agentId}` package | `agent-package-assembly` | F-3.1 |
| FN-3.2 | AgentAssembly 启动期编译（request path 不 reparse） | app composition | `agent-package-assembly`、`extension-registration` | F-3.1 |
| FN-3.3 | Agent Scope 绑定（Session.agentId） | session create/bind | `ts-minimal-agent-kernel`（架构约束） | F-3.2 |
| FN-3.4 | RequestRun acceptance 固化 agentId/agentVersion/agentAssemblyRef | runtime submit | `ts-minimal-agent-kernel`、`ts-core-contracts` | F-3.2 |
| FN-3.5 | context assembly（history selection/window budget） | ContextEnginePort.assemble | `context-engine`、`context-assembly-contracts` | F-3.3 |
| FN-3.6 | prompt template assembly（purpose-aware） | PromptTemplateAssembly | `prompt-template-assembly` | F-3.3 |
| FN-3.7 | model invocation（complete/stream） | ModelInvocationService | `model-invocation-contract` | F-3.3 |
| FN-3.8 | capability invocation（统一调用） | CapabilityInvocationPort.invoke | `capability-catalog`、`ts-core-contracts` | F-3.3 |
| FN-3.9 | tool loop 编排 | agent-core tool loop | `ts-core-contracts` | F-3.3 |
| FN-3.10 | 子 Agent 调用（Agent tool / fresh-context child session） | Agent tool + SubagentExecutionPort | `agent-tool`、`invoked-agent-discovery` | F-3.4 |
| FN-3.11 | 工具循环收敛保护（maxTurns 唯一收敛上限 + toolChoice=NONE 收尾 turn） | tool loop convergence guard | `tool-loop` | F-3.5 |

## D4 模型与上下文

| 编号 | 功能 | 接口/入口 | spec 追溯 | 覆盖 feature |
|---|---|---|---|---|
| FN-4.1 | 模型调用（complete/stream） | ModelInvocationService.complete/stream | `model-invocation-contract`；在建 `restore-model-gateway-bypass`(0/11) | F-4.1 |
| FN-4.2 | provider adapter 隔离（SDK/request/stream/tool-use） | agent-model internal | `model-provider-adapter` | F-4.1 |
| FN-4.3 | model profile registry（启动期 stabilize） | ModelProfileRegistry | `app-config-schema`（modelProfiles 契约）、`model-provider-adapter` | F-4.1 |
| FN-4.4 | 流式归一化（chunk 归一） | agent-model internal | `model-stream-normalization` | F-4.2 |
| FN-4.5 | provider 错误安全映射（SafeError） | agent-model internal | `provider-error-safe-mapping` | F-4.2 |
| FN-4.6 | fallback 评估与 routing evidence | Agent Core orchestration | `model-fallback-semantics`、`routing-evidence-and-fallback` | F-4.3 |
| FN-4.7 | context assembly + budget evidence（render 前计算） | ContextEnginePort.assemble/render | `context-engine` | F-4.4 |
| FN-4.8 | token 估算 | ContextTokenEstimator | `context-token-estimator` | F-4.4 |
| FN-4.9 | 摘要压缩（模型生成摘要/可取消） | summary compression orchestration | `context-engine` | F-4.5 |
| FN-4.10 | 微压缩（旧工具结果 whitelisted 压缩） | micro-compaction | `context-engine`（micro-compact） | F-4.5 |
| FN-4.11 | 大内容转储（largest fresh blocks → preview 引用） | large-content offload | `large-content-references` | F-4.5 |
| FN-4.12 | 最小安全上下文保护（latest/current request 不丢弃） | context engine internal | `context-engine` | F-4.6 |
| FN-4.13 | 大内容分页读回（read + file_path） | read 工具 + execution workspace | `large-content-readback` | F-4.7 |
| FN-4.14 | 电信双语输出（跟随用户语言/术语保留英文） | system prompt rule | `telecom-bilingual-output` | F-4.8 |

## D5 Capability 能力体系

| 编号 | 功能 | 接口/入口 | spec 追溯 | 覆盖 feature |
|---|---|---|---|---|
| FN-5.1 | capability descriptor 统一契约（TOOL/SKILL/AGENT） | CapabilityDescriptor | `capability-catalog`、`ts-core-contracts` | F-5.1 |
| FN-5.2 | capability catalog 发现/可用性/Agent binding 过滤 | CapabilityCatalog | `capability-catalog`、`capability-source-configuration`、`extension-registration` | F-5.1 |
| FN-5.3 | capability invocation 统一调用 | CapabilityInvocationPort.invoke | `capability-catalog` | F-5.1 |
| FN-5.4 | read 工具 | CapabilityInvocationPort(TOOL) | `read-tool`；在建 `refine-builtin-tool-guidance`(9/13) | F-5.2 |
| FN-5.5 | write 工具 | CapabilityInvocationPort(TOOL) | `write-tool`、`builtin-tool-framework` | F-5.2 |
| FN-5.6 | edit 工具 | CapabilityInvocationPort(TOOL) | `edit-tool`、`builtin-tool-framework` | F-5.2 |
| FN-5.7 | glob 工具 | CapabilityInvocationPort(TOOL) | `glob-tool`、`builtin-tool-framework` | F-5.2 |
| FN-5.8 | grep 工具 | CapabilityInvocationPort(TOOL) | `grep-tool`、`builtin-tool-framework` | F-5.2 |
| FN-5.9 | bash 工具（sandbox 执行/命令下沉 sandbox denylist） | CapabilityInvocationPort(TOOL) + SandboxGatewayPort | `bash-tool`、`cross-platform-executable-semantics` | F-5.2、F-5.6 |
| FN-5.10 | python 工具（sandbox 执行） | CapabilityInvocationPort(TOOL) + SandboxGatewayPort | `python-tool`、`cross-platform-executable-semantics` | F-5.2、F-5.6 |
| FN-5.11 | AskUserQuestion 工具（创建 QUESTION pending input） | CapabilityInvocationPort(TOOL) | `ask-user-question-tool`、`ask-user-question-trigger-policy` | F-5.2 |
| FN-5.12 | Agent 工具（子 Agent 调用） | CapabilityInvocationPort(TOOL) | `agent-tool` | F-5.2 |
| FN-5.13 | Skill 工具（governed Skill 转接） | CapabilityInvocationPort(TOOL) | `skill-tool` | F-5.2 |
| FN-5.14 | ToolSearch 工具 | CapabilityInvocationPort(TOOL) | `tool-search-tool` | F-5.2 |
| FN-5.15 | TodoWrite 工具 | CapabilityInvocationPort(TOOL) | `todo-write-tool` | F-5.2 |
| FN-5.16 | Memory 工具（search/detail/add） | CapabilityInvocationPort(TOOL) | `memory-tools` | F-5.2 |
| FN-5.17 | Rag 工具 | CapabilityInvocationPort(TOOL) + RagRetrievalGateway | `rag-tool`、`rag-knowledge-governance`；在建 `refine-rag-retrieval-display`(0/11)、`remove-rag-provenance-field`(0/7) | F-5.4 |
| FN-5.18 | builtin/system Skill EAGER 发现 | configRoot/skills | `builtin-skill-source`、`local-skill-source` | F-5.3 |
| FN-5.19 | agent-owned Skill SEARCH 发现 | configRoot/agents/{agentId}/skills | `local-skill-source` | F-5.3 |
| FN-5.20 | SKILL.md manifest 解析 | SKILL.md parser | `skill-manifest-contract`；在建 `restore-extension-array-support`(0/5)、`refine-skill-manifest-keys`(6/6 已完成待归档) | F-5.3 |
| FN-5.21 | Skill 资源受控访问（workspace/temp roots） | execution file access policy | `skill-resource-access` | F-5.3 |
| FN-5.22 | SkillHub 远端 Skill 获取（refresh/search/download/install） | remote gateway | `skillhub-source` | F-5.3 |
| FN-5.23 | Skill 列表查询 API | `GET /api/v1/skills` | `web-skill-catalog` | F-5.3 |
| FN-5.24 | ToolSearch request-local 激活 | request-local allowedTools/discoveredSkills | `tool-search-tool` | F-5.5 |
| FN-5.25 | API-backed tool source（CLIP） | CLIP provider | `api-backed-tool-source` | F-5.7 |
| FN-5.26 | capability disclosure / deferred 候选披露 | system prompt available-deferred-* | `tool-search-tool`、`capability-catalog` | F-5.5 |

## D6 安全与治理

| 编号 | 功能 | 接口/入口 | spec 追溯 | 覆盖 feature |
|---|---|---|---|---|
| FN-6.1 | owner scope 校验（tenantId/subjectId，所有持久化事实） | trusted boundary + OwnerScoped | `ts-minimal-agent-kernel`、`ts-core-contracts`、`owner-scope-security`（design 文档：`openspec/designs/architecture/owner-scope-security.md`，非 stable spec） | F-6.1 |
| FN-6.2 | agent scope 校验（主路径运行数据访问） | session-bound agentId + RequestRun 固化 | `ts-minimal-agent-kernel`（架构约束） | F-6.1 |
| FN-6.3 | sandbox gateway 执行（pre-validation/timeout/stdout/env/cwd） | SandboxGatewayPort.execute | `sandbox-runtime` | F-6.2 |
| FN-6.4 | deny-by-default 兜底 | 默认 adapter | `sandbox-deny-by-default-adapter` | F-6.2 |
| FN-6.5 | risk policy 评估（ALLOW/DENY/REQUIRE_AUTHORIZATION/DEGRADED/POLICY_FAILED） | RiskPolicyEnforcement | `risk-policy-enforcement` | F-6.3 |
| FN-6.6 | QUESTION pending input（澄清/恢复/超时/终止） | pending input lifecycle | `question-pending-input`、`human-pending-input-core`；在建 `enable-ask-user-question-free-text-answer`(3/13) | F-6.4 |
| FN-6.7 | CONFIRMATION pending input | pending input lifecycle | `confirmation-pending-input`、`human-pending-input-core` | F-6.4 |
| FN-6.8 | AUTHORIZATION pending input（绑定 run 内一次受限操作） | pending input lifecycle | `authorization-pending-input` | F-6.4 |
| FN-6.9 | human handoff（转人工接管/终结或恢复） | pending input lifecycle | `human-handoff` | F-6.4 |
| FN-6.10 | pending input 超时/恢复/终止 | pending input lifecycle | `human-pending-input-timeout`、`human-pending-input-core` | F-6.4 |
| FN-6.11 | 脱敏策略（log/metric/trace/audit/stream/health） | observation redaction | `redaction-policy` | F-6.5 |
| FN-6.12 | SafeError 归一化（跨边界输出） | safe error normalization | `provider-error-safe-mapping`、`ts-core-contracts` | F-6.5 |
| FN-6.13 | SecretReference（env:/file:） | secret resolver | `secret-configuration-boundary` | F-6.6 |
| FN-6.14 | 本地认证 login/logout（signed HttpOnly cookie） | `POST /api/v1/auth/local/login`、`POST /api/v1/auth/local/logout` | `ts-local-configured-auth` | F-6.7 |

## D7 可观测与审计

| 编号 | 功能 | 接口/入口 | spec 追溯 | 覆盖 feature |
|---|---|---|---|---|
| FN-7.1 | structured logging projector（安全字段 allowlist） | observation handoff | `structured-logging` | F-7.1 |
| FN-7.2 | runtime logging（编排诊断，不拼装完整 trajectory） | runtime internal | `runtime-logging` | F-7.1 |
| FN-7.3 | audit event 写入（关键执行事实/run-bound agentId） | audit projector | `audit-event-contract` | F-7.2 |
| FN-7.4 | audit sink | audit sink port | `audit-sink`；在建 `add-ai-log-reporting`(0/10) | F-7.2 |
| FN-7.5 | TraceProjector（unified） | TraceProjector | `otel-observability-adapter` | F-7.3 |
| FN-7.6 | unified MetricsRegistry（安全字段 allowlist） | MetricsRegistry | `agent-runtime-metrics` | F-7.3 |
| FN-7.7 | OTel adapter / OTLP export（W3C Trace Context） | agent-app composition | `otel-observability-adapter`、`add-otlp-trace-export`；在建 `adjust-trace-reporting`(18/18 已完成待归档) | F-7.3 |
| FN-7.8 | trace-log linking | diagnostic context | `trace-log-linking` | F-7.3 |
| FN-7.9 | Agent 执行轨迹投影（ObservabilityObservationEvent stream） | observation event stream | `agent-execution-trajectory`；在建 `add-workflow-execution-trace`(0/11) | F-7.4 |
| FN-7.10 | health/readiness（safe facts） | `GET /api/v1/health` 等 | `system-health-check` | F-7.5 |
| FN-7.11 | 内部生命周期可观测 + hook trace logging | runtime lifecycle observation | `internal-lifecycle-observability`、`developer-hook-trace-logging` | F-7.6 |

## D8 数据与记忆

| 编号 | 功能 | 接口/入口 | spec 追溯 | 覆盖 feature |
|---|---|---|---|---|
| FN-8.1 | working memory provider（request/session/message/timeline/checkpoint/pending-input/annotation/share） | WorkingMemoryProvider | `gateway-store-provider-ownership`（含 sessions/checkpoints store）、`local-run-timeline-store` | F-8.1 |
| FN-8.2 | long-term memory provider（store + retriever） | LongTermMemoryProvider | `gateway-store-provider-ownership` | F-8.1 |
| FN-8.3 | SQLite local gateway（attachment/trajectory/todo/user-question/audit） | gateway-local SQLite | `gateway-store-provider-ownership` | F-8.1 |
| FN-8.4 | 三库分离（working-memory/long-term-memory/nextagent，不双写） | LOCAL 部署派生 | `gateway-store-provider-ownership` | F-8.1 |
| FN-8.5 | 长期记忆 search/list/detail/count/state transition | memory core port | `memory-core`；在建 `add-ts-response-memory-disclosure`(1/26)、`add-ts-system-reminder-memory-v1` | F-8.2 |
| FN-8.6 | 长期记忆 graceful degradation（不阻塞 terminal commit） | memory core | `memory-core`、`memory-configuration` | F-8.2 |
| FN-8.7 | memory tools（search_memory/get_memory_detail/add_memory） | CapabilityInvocationPort(TOOL) | `memory-tools`；在建 `refine-memory-add-memory-guidance`(0/19) | F-8.3 |
| FN-8.8 | task trajectory 学习输入层（post-terminal） | task trajectory port | `task-trajectory` | F-8.4 |
| FN-8.9 | memory extraction（默认关闭 dreaming） | extraction helper | `memory-extraction` | F-8.5 |
| FN-8.10 | memory aging（默认关闭 lifecycle） | aging helper | `memory-aging` | F-8.5 |
| FN-8.11 | 附件 intake（校验类型/大小/数量/owner scope/暂存/引用） | attachment intake port | `ts-attachment-intake` | F-8.6 |
| FN-8.12 | 附件 cleanup（显式 port/owner scope/audit） | attachment cleanup port | `ts-attachment-cleanup` | F-8.6 |
| FN-8.13 | artifact metadata/ref 保存 | artifact ref | `large-content-references`（baseline） | F-8.7 |
| FN-8.15 | 管理长期记忆 | immersive Shell 记忆管理内容区 + `/api/v1/memory/long-term-mem` 12 端点 | `long-memory-web-management` | F-8.2 |

## D9 Workflow 编排

| 编号 | 功能 | 接口/入口 | spec 追溯 | 覆盖 feature |
|---|---|---|---|---|
| FN-9.1 | workflow 执行分支（agent-core routing） | AgentRoutingPolicy → workflow | `workflow-routing` | F-9.1 |
| FN-9.2 | WorkflowExecutionService（单实例内存态） | agent-workflow internal | `workflow-execution-engine` | F-9.1 |
| FN-9.3 | 启动期本地 recipe 加载 | agent-workflow startup | `workflow-package` | F-9.1 |
| FN-9.4 | RECIPE capability 发现 | capability catalog | `workflow-package` | F-9.1 |
| FN-9.5 | gateway 节点 handler | node handler | `workflow-gateway-nodes` | F-9.4 |
| FN-9.6 | parallel-gateway 节点 handler | node handler | `workflow-parallel-gateway` | F-9.4 |
| FN-9.7 | capability 节点 handler | node handler | `workflow-capability-nodes` | F-9.4 |
| FN-9.8 | interaction 节点 handler | node handler | `workflow-interaction-nodes` | F-9.4 |
| FN-9.9 | knowledge 节点 handler | node handler | `workflow-knowledge-nodes`；在建 `enhance-ts-workflow-knowledge-qa`(57/60)、`enhance-ts-workflow-api-choice-node`(0/30) | F-9.4 |
| FN-9.10 | llm 节点 handler | node handler | `workflow-llm-nodes`；在建 `enhance-ts-workflow-llm-nodes`(0/17) | F-9.4 |
| FN-9.11 | workflow pending-input 桥接 | runtime-owned pending input | `workflow-interaction-nodes` | F-9.1 |
| FN-9.12 | Workflow 契约（FlowGraph/节点 DTO/package composition） | WorkflowExecutionService contract | `add-ts-workflow-engine-contracts`、`add-ts-workflow-package-composition` | F-9.2 |
| FN-9.13 | 执行引擎 v2 | WorkflowExecutionService v2 | `workflow-execution-engine` | F-9.2 |
| FN-9.14 | recipe v2 契约 | recipe DSL | `workflow-contracts` | F-9.3 |
| FN-9.15 | recipe 分类字段 | recipe metadata | `workflow-contracts`、`workflow-package` | F-9.3 |
| FN-9.16 | workflow 路由（显式 recipeId/intent recognition） | agent router | `workflow-routing` | F-9.3 |
| FN-9.17 | workflow snapshot/resume/recovery | workflow persistence | `workflow-execution-engine` | F-9.5 |
| FN-9.18 | workflow 远程执行模式 | remote execution | `workflow-remote-execution-mode` | F-9.6 |
| FN-9.19 | workflow 编排策略 | orchestration policy | 在建 `add-ts-workflow-orchestration-policy`(0/31 未启动) | F-9.7 |
| FN-9.20 | workflow event history（durable history） | event history | 在建 `add-ts-workflow-event-history`(0/28 PAUSED) | F-9.5 |
| FN-9.21 | workflow agent-loop-tool 节点 | node handler | `workflow-agent-loop-tool` | F-9.4 |
| FN-9.22 | workflow visible delta 限制 | projection limit | `workflow-contracts` | F-9.7 |

## D10 二次开发与平台集成

| 编号 | 功能 | 接口/入口 | spec 追溯 | 覆盖 feature |
|---|---|---|---|---|
| FN-10.1 | lifecycle hook 执行（stage-scoped/observe/control/transform） | LifecycleHookPort.invoke | `lifecycle-hook-execution` | F-10.1 |
| FN-10.2 | hook directory loading（启动期扫描/冻结 snapshot） | app composition | `lifecycle-hook-execution`（hook directory loading） | F-10.1 |
| FN-10.3 | Agent-scoped startup plugin composition | app composition | `agent-scoped-plugin-composition` | F-10.2 |
| FN-10.4 | extension registration（startup-only/owner contributions） | capability provider registration | `extension-registration` | F-10.2 |
| FN-10.5 | AgentRoutingPolicy 自定义（controlled contracts/fail closed） | AgentRoutingPolicy | `agent-routing-core` | F-10.3 |
| FN-10.6 | RiskPolicy 自定义 | RiskPolicyEnforcement | `risk-policy-enforcement` | F-10.3 |
| FN-10.7 | defineTool 自定义工具 | defineTool | `builtin-tool-framework` | F-10.4 |
| FN-10.8 | CUSTOM provider kind（自定义 provider） | CustomProviderOptions | `capability-source-configuration` | F-10.4 |
| FN-10.9 | prompt template 自定义（purpose/模板/受控变量） | PromptTemplateAssembly | `prompt-template-assembly` | F-10.4 |
| FN-10.10 | gateway local/remote 集成边界 | gateway/adapter boundary | `gateway-configuration`、`gateway-store-provider-ownership`；在建 `refine-ts-agent-gateway-state-store-boundary`(0/22) | F-10.5 |
| FN-10.11 | Web API public DTO 投影（DO/Record/row 不外泄） | agent-channel-web projection | `ts-core-contracts`、`ts-backend-architecture` | F-10.6 |
| FN-10.12 | SSE/WS stream projection（同一 StreamEnvelope） | stream projection | `ts-web-sse-ws-transports` | F-10.6 |
| FN-10.13 | fullstack hosting（前端构建产物 npm 包托管） | agent-app static hosting | `fullstack-packaging-boundary` | F-10.7 |
| FN-10.14 | AICOConfig 配置契约 | AICOConfig | `aico-config-contract` | F-10.8 |
| FN-10.15 | agent-web host modes（多宿主） | runtime bootstrap | `agent-web-multi-host-modes` | F-10.8 |
| FN-10.16 | structured message rendering | agent-web rendering | `agent-web-structured-message-rendering` | F-10.8 |
| FN-10.17 | PIU 注入 | agent-web PIU | `aico-piu-injection` | F-10.8 |
| FN-10.18 | 布局模式/展示控制 | agent-web AICO | `aico-layout-mode`、`aico-display-control`；在建 `add-piu-panel-position-and-display-control`(20/25)、`harden-agent-web-request-acceptance-control`(0/7) | F-10.8 |
| FN-10.19 | agent-test-kit（schema samples/fake gateway/fixtures） | agent-test-kit | `ts-backend-architecture`（agent-test-kit package 边界） | F-10.9 |
| FN-10.20 | contract test gate | vitest contract config | `ts-contract-test-gate` | F-10.9 |
| FN-10.21 | E2E gates（alpha/product-journey/security/resilience/release/p1-p2 + 业务流/并发/非功能/UI 交互场景族） | E2E gates | `ts-e2e-alpha-kernel-gate`、`ts-e2e-product-journey-gate`、`ts-e2e-security-gate`、`ts-e2e-resilience-gate`、`ts-e2e-release-package-gate`、`ts-e2e-p1-p2-scenario-gate`、`e2e-business-flow`、`e2e-concurrency`、`e2e-non-functional`、`e2e-ui-interaction`、`e2e-spec-shall` | F-10.9 |
| FN-10.31 | 验证系统集成 | TestClaw 独立系统集成门禁 | `ts-system-integration-validation-gate`、`testclaw-test-framework` | F-10.9 |
| FN-10.22 | runtime operational log hardening | runtime logging | `add-ts-runtime-operational-log-hardening` | F-10.10 |
| FN-10.23 | OTLP trace export | OTLP export | `otel-trace-export` | F-10.10 |
| FN-10.24 | performance test gate | perf test gate | `ts-performance-test-gate` | F-10.10 |
| FN-10.25 | reliability test gate | reliability test gate | 在建 `add-ts-reliability-test-gate`(0/31 spec-only) | F-10.10 |
| FN-10.26 | Cron 工具 | CapabilityInvocationPort(TOOL) | `cron-tools` | F-10.11 |
| FN-10.27 | Task Channel 接入 | task channel | `agent-task-channel` | F-10.11 |
| FN-10.28 | Dev Agent Workbench | dev workbench | `dev-agent-workbench` | F-10.11 |
| FN-10.29 | Skill catalog source metadata | skill catalog | `skill-catalog-query` | F-10.11 |
| FN-10.30 | Skill metadata extension | skill manifest | `skill-manifest-contract`（metadata extension） | F-10.11 |
| FN-10.32 | Cron 任务管理 API（创建/查询/控制） | Web API | `cron-task-management-api` | F-10.11 |
| FN-10.33 | assistant markdown / mermaid 渲染 | agent-web rendering | `agent-web-assistant-markdown-rendering`、`agent-web-mermaid-rendering` | F-10.12 |
| FN-10.34 | turn-run graph / BI 报表生成 | agent-web rendering | `agent-web-turn-run-graph`、`agent-web-bi-report-generation` | F-10.12 |
| FN-10.35 | PIU 历史回放 / 知识渲染 / 最小化 | agent-web PIU | `agent-web-piu-historical-chat-replay`、`agent-web-piu-knowledge-render`、`agent-web-piu-minimize` | F-10.12 |
| FN-10.36 | composer 交互与输入上限 / pending input UI / 附件 composer | agent-web interaction | `agent-web-composer-interaction`、`agent-web-composer-input-limit`、`agent-web-pending-input-ui`、`agent-web-attachment-composer` | F-10.12 |
| FN-10.37 | 页面布局与样式族（chat pane/composer button/right pane/skill selector/welcome block/process panel/expand panel/page layout） | agent-web layout & styles | `agent-web-page-layout`、`agent-web-chat-pane-styles`、`agent-web-composer-button-styles`、`agent-web-right-pane-styles`、`agent-web-skill-selector-styles`、`agent-web-welcome-block-styles`、`agent-web-process-panel`、`agent-web-expand-panel` | F-10.12 |
| FN-10.38 | 知识导入 / cron 任务面板 / 认证控件 | agent-web views | `agent-web-knowledge-import`、`agent-web-cron-task-dashboard`、`agent-web-auth-control` | F-10.12 |

## D11 可靠性与韧性

| 编号 | 功能 | 接口/入口 | spec 追溯 | 覆盖 feature |
|---|---|---|---|---|
| FN-11.1 | bounded recovery pass（启动恢复/分类 durable facts） | runtime startup recovery | `local-runtime-recovery`；在建 `fix-runtime-recovery-startup-readiness`(5/5 已完成待归档) | F-11.1 |
| FN-11.2 | checkpoint save/load（owner scoped） | CheckpointStoreGateway | `gateway-store-provider-ownership`（checkpoints store） | F-11.1 |
| FN-11.3 | capability replay guard（幂等声明/默认非幂等/故障失败退出） | replay policy | `runtime-recovery-idempotency-guard`、`idempotency-contract` | F-11.1 |
| FN-11.4 | idempotency key 写入（非空必填/重复返回首次结果） | IdempotencyKey | `idempotency-contract`、`ts-web-command-idempotency` | F-11.2 |
| FN-11.5 | terminal commit 幂等（committed/already_committed） | commitTerminal | `idempotency-contract` | F-11.2 |
| FN-11.6 | composite gateway write（单一 composite write/单事务） | gateway composite write | `ts-backend-architecture`（架构约束） | F-11.3 |
| FN-11.7 | same-session lane 串行 | SessionLaneScheduler | `session-lane-scheduling` | F-11.4 |
| FN-11.8 | 单 session 单 active run 拒绝并发 | submit safe conflict | `session-lane-scheduling`、`ts-minimal-agent-kernel` | F-11.4 |
| FN-11.9 | performance test gate | perf test gate | `add-ts-performance-test-gate` | F-11.5 |
| FN-11.10 | reliability test gate | reliability test gate | 在建 `add-ts-reliability-test-gate`(0/31 spec-only) | F-11.5 |

---

## 统计

| 域 | 功能数 |
|---|---|
| D1 会话与流式交互 | 21 |
| D2 请求运行时 | 16 |
| D3 Agent 装配与主链路 | 11 |
| D4 模型与上下文 | 14 |
| D5 Capability 能力体系 | 26 |
| D6 安全与治理 | 14 |
| D7 可观测与审计 | 11 |
| D8 数据与记忆 | 14 |
| D9 Workflow 编排 | 22 |
| D10 二次开发与平台集成 | 38 |
| D11 可靠性与韧性 | 10 |
| **合计** | **197** |
