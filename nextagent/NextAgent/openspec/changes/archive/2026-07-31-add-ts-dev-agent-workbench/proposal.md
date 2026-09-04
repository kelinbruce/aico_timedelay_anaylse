## 背景与问题（Why）

NextAgent 已具备 runtime timeline、structured logging、trace/log linking、metrics、audit、runtime diagnostic log 和 agent execution trajectory 等观测基础。这些机制适合生产运维、审计和安全复盘，但智能体开发者在本地调测 Agent 时仍需要跨日志、timeline、messages、safe observation、模型调用和工具调用手动拼接一次 request/run 的处理过程。

开发调测的关键问题不是缺少生产可观测信号，而是缺少一个本地开发期聚合视图：开发者需要按会话和对话查看已完成请求的完整动作链，能看到每个动作的状态、耗时、错误、关联引用和可用详情，并能理解 Agent 生效配置、prompt 模板、上下文选择、模型有效请求、capability 暴露和工具调用之间的关系。

本 change 采用 projection-first 方案：工作台只基于已有持久化事实、timeline、agent execution trajectory、safe observation projection 和安全日志证据进行投影/还原。现有事实无法支撑关键调测视图时，必须先做字段来源映射；能从 `RequestRunRecord`、`RunTimelineEventRecord` 顶层字段、事件时间、session message、run-bound `AgentAssembly`、trajectory 或现有 safe observation 计算/读取的字段不得新增。字段只有在对应 owning domain 从生产运行、审计、恢复或故障诊断角度独立需要时，才可作为正式业务运行事实增加；不得以工作台展示为理由增加、复制或持久化字段。仅有调测展示价值的数据必须查询时派生，无法派生时显示 `partial`/`unavailable`，不得新增 workbench enrichment、私有持久化对象、record 顶层调测字段、raw decorator、dev raw buffer 或系统 lifecycle hook。

## 变更范围（What Changes）

- 新增 local runtime package 默认携带的 Agent Dev Workbench，用独立页面/API 呈现，不复用最终用户对话页面。该能力复用现有 local package manifest、packageProfile 和 entrypoint 机制；生产打包形态不包含工作台 route/page/API。
- 新增 dev-only route namespace，例如 `/__nextagent/dev/workbench`，提供由 `agent-dev-workbench` 拥有的独立开发者工作台页面工件和查询接口；这些接口不属于 `/api/v1` 生产 API，不承诺稳定产品 contract。页面 MAY 复用 `frontend/agent-web` 的前端技术栈和 UI/图形库版本，但 MUST NOT 作为 `agent-web` 路由、产品功能或生产前端 artifact 的一部分。
- 工作台与同端口的智能体访问页面复用同一认证入口和可信 Owner Scope；所有会话、对话、request/run 和日志查询同时限制在当前 `tenantId`/`subjectId` 与当前 trusted hosted root Agent 及其可达 subagent assembly graph 内。该 owner/agent-scoped 读面由 local runtime package 专用的 implementation-local read adapter 承载，不进入生产 `/api/v1` 或稳定 gateway contract。
- local with-frontend 形态由 `agent-dev-workbench` 向通用 frontend hosting 注入 package-owned 悬浮入口；入口从普通页面当前 `#/session/:sessionId` 路由生成工作台深链接。未装配工作台时不注入脚本、按钮或链接，`frontend/agent-web` 不包含 workbench route、组件或条件分支。
- 工作台只读展示已有 facts、安全投影 payload 和安全日志证据；不实时订阅活动中对话，不提供 retry、edit、cancel、replay、配置修改或任何状态变更操作。
- 新增 dev-only process graph projection：按 request/run 生成动作图，节点覆盖 request 调度、context assembly、context compaction、model invocation、capability/tool invocation、hook、policy、stream 和 terminal outcome；gateway detail 在没有正式业务事实时标记 unavailable，不从日志推断。
- 新增 reconstructed run effective view：展示本次 run 可还原的 Agent assembly refs、model profile/selection、prompt template ref、context selection/budget/compression evidence、capability binding/disclosure summary、visible capability ids、rendered tool names/count 和最终模型请求安全参数；runtime settings/workspace policy summary 仅在可从历史稳定 assembly ref 解析时展示，否则标记 partial/current-view/unavailable。
- 新增 dev-only log evidence view：按 `requestRunId`、`requestId`、`sessionId`、`agentId` 和时间窗口查看已有 runtime diagnostic log / structured safe log 的 bounded excerpts，并允许从 graph node 跳转到相关安全日志证据；日志证据不作为 process graph 的事实来源。
- 补齐 owning domain 独立需要的 production-safe 运行事实；v1 不为工作台新增 capability gateway summary public contract，gateway detail 缺失时显示 partial/unavailable。正式事实默认落在已有 `RunTimelineEventRecord.inlinePayload`，不新增 `DevWorkbench*Record`、raw snapshot record、generic workbench fact table 或 local-only timeline payload；这些事实不包含 raw prompt、raw model output、raw tool args/result、provider raw body、credential、secret、token、attachment content 或 path。
- 所有属于 `RequestRun` 的模型调用 SHALL 经过统一的 run-bound model invocation boundary；该边界调用 `agent-model` 的 provider-neutral `ModelInvocationService`，并通过 runtime-owned timeline port 持久化已有 `MODEL_INVOCATION_STARTED`、`MODEL_INVOCATION_COMPLETED`、`MODEL_INVOCATION_FAILED` event types。`agent-core`、workflow、context summary 等调用方不得各自重复生产模型事件，`agent-model` 不直接依赖或写入 canonical timeline。非 `RequestRun` 模型调用不得伪造 run timeline。该生产行为不因工作台是否装配而改变。
- Workbench v1 不新增 dev raw buffer，不在 app composition 中为调测包裹 model/capability/gateway/policy/context raw decorators，不注册仅用于采集的系统 lifecycle hook。
- 生产打包形态不注册工作台页面或查询接口。

## Capability 影响（Capabilities）

### 新增 Capability
- `dev-agent-workbench`: 定义本地开发期 Agent 调测工作台在 local runtime package 中的自包含 dev-only 页面、查询接口、projection-first process graph、reconstructed effective view、正式业务运行事实复用、log evidence 和 non-interference 行为。

### 修改的 Capability
- 无。

## 影响范围（Impact）

- `agent-app`：只提供通用 local protected-route 与 frontend hosting contribution 装配能力；具体 workbench route/page/API、owner/agent scope resolver 和 launcher contribution 仅由 local runtime entrypoint 选择。通用 `create-app` 不包含 workbench 专用 registration/context/enablement；生产打包 composition 不包含该能力。
- 新增 `agent-dev-workbench` dev route module/package：负责 dev-only 页面/API projection、graph projector、log evidence reader、dev DTO runtime schema validation、local dev read adapter 协作，以及 package-owned dev workbench frontend artifact；不拥有 request lifecycle；不得进入 `frontend/agent-web`、`agent-channel-web` 或生产打包 artifact。
- `agent-channel-web`：不拥有 workbench route/page，不新增 workbench user-facing `/api/v1` DTO 或 stream event；只保持既有最终用户 Web projection 不变。
- `agent-observability`：只提供已有 safe observation/log source 的只读输入或 helper；不得拥有 workbench runtime truth，不得改变正式 observability surfaces、log schema 或 redaction policy。
- `agent-runtime`：拥有 run-bound model invocation boundary 的 canonical timeline 写入；`agent-model` 只拥有 provider 调用、stream normalization 与 safe result/error；`agent-core`、workflow、context summary 等调用方复用统一边界。各业务 owner 只能补充其从生产运行、审计、恢复或故障诊断角度独立需要的正式事实；不得新增 workbench 私有 durable record、local-only timeline payload、重复字段或 raw capture path。
- 测试影响：需要新增 local runtime package composition、production packaging exclusion、owner/agent scope negative cases、launcher injection/deep-link、API schema、graph reconstruction、safe projection payload schema、effective view、log evidence、non-interference、no-mutation、compatibility 和 architecture boundary 测试。
- 运维影响：生产和发布包中该能力不可访问；本地开发查询和日志证据读取受条数、字节、时间窗口和扫描范围上限约束。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/dev-agent-workbench/spec.md`：新增本地开发期工作台行为契约。

长期背景：
- `openspec/overview.md`：补充 Agent 开发者调测体验和生产可观测分层的长期背景。

设计视图：
- `openspec/designs/architecture/observability.md`：补充 dev workbench 与正式 observability/logging surface 的分离关系。
- `openspec/designs/architecture/runtime-boundaries.md`：补充 workbench 不拥有 runtime truth、不装配 raw decorator/system hook 的边界。
- `openspec/designs/modules/agent-app.md`：补充 local runtime package 装配 dev workbench route/page/API，以及生产打包排除该能力的职责。
- `openspec/designs/modules/agent-channel-web.md`：补充 channel-web 不拥有 workbench route/page、不新增用户 stream projection 的边界。
- `openspec/designs/modules/agent-dev-workbench.md`：新增 dev route/projector/log reader/read adapter consumer 的模块设计。
- `openspec/designs/adr/dev-agent-workbench-projection-first-boundary.md`：记录 projection-first、minimal safe projection payload 和禁止 workbench raw capture 的取舍。
- `openspec/designs/spec-to-design-map.md`：新增 `dev-agent-workbench` 到 architecture/modules/ADR 的导航。

验证入口：
- local runtime package composition tests、production packaging exclusion tests、dev route/API schema tests、process graph reconstruction tests、safe projection payload tests、effective view tests、log evidence tests、non-interference tests、no-mutation tests、compatibility tests、architecture dependency tests、`openspec validate add-ts-dev-agent-workbench --strict`。
