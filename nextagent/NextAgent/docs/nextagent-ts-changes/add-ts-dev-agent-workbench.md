# add-ts-dev-agent-workbench

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：周期任务与开发者体验

状态：ready
类型：开发者体验实施 change
主要 owner：`agent-app`、`agent-dev-workbench`
协作 owner：`agent-runtime`、`agent-core`、`agent-context-engine`、`agent-model`、`agent-capability`
依赖：`add-ts-trace-log-linking`、`add-ts-agent-execution-trajectory-observability`、`add-ts-structured-logging`、`add-ts-runtime-logging`、`add-ts-local-runtime-package`、`refine-ts-fullstack-packaging-boundary`

## 一页结论

NextAgent 已规划并实现多类可观测机制，包括 runtime timeline、structured logging、trace/log linking、metrics、audit、runtime diagnostic log 和 agent execution trajectory。它们能支撑生产运维和安全复盘，但智能体开发者在本地调测 Agent 时仍需要自己在日志、事件、模型调用、上下文选择和工具调用之间拼线索，无法在一次 request/run 维度上直观看到执行过程与 Agent 生效配置之间的关系。

本 change 规划一个 local runtime package 默认携带的 Agent 调测工作台。它复用现有 local package manifest、packageProfile 和 entrypoint 机制；生产打包形态不包含工作台。它不放宽生产可观测规则，也不修改 production terminal commit、structured log、audit、metrics、trace 或 redaction policy。目标路径是 projection-first：优先消费已有 session/message/requestRun/timeline/trajectory/safe observation/log correlation facts；缺数据时先做字段来源映射，能读取或计算的不新增，确需补充时由对应 owner 在已有 timeline `inlinePayload` 中补 schema-validated minimal safe projection payload；最后按 `requestRunId` 聚合为开发期自包含页面和 API 查询视图。

## 当前缺口

- 开发者需要跨 `nextagent-runtime.log`、`nextagent-observability.log`、timeline event、audit、trace 和运行时消息记录手动关联一次 Agent 执行。
- 现有日志可以辅助定位问题，但没有按 run/action 关联到处理图；如果让调测台解析日志来重建过程，又会引入脆弱的 log parser 和事实来源混乱。
- 安全可观测面只输出 refs、reason code、duration、usage 和 safe summary，适合生产，但不足以调试 prompt shaping、context assembly、tool schema、capability disclosure 或模型有效参数。
- Agent 生效配置、prompt 模板、模型推理参数、capability 默认激活/可见/渲染/调用链路分散在 assembly registry、context engine、model request builder 和 capability catalog 中；缺少 run 维度归因视图时，开发者难以判断问题来自配置、prompt、上下文、capability 暴露还是模型调用参数。
- decorator 和 hook 作为调测采集手段有实现风险：decorator 需要插入 `agent-app` wrapper 链，可能和 observability wrapper、timeout、abort、safe error mapping 冲突；系统 hook 会进入 hook 调用链路，容易污染开发者看到的执行过程。
- 如果直接把 raw 数据加入 structured log、audit、metrics、trace 或 canonical timeline，会破坏既有生产机制和 redaction 边界。

## 目标

- 提供开发期 Agent 调测工作台，按 session/request/run 关联展示一次 Agent 执行的主轨迹、上下文、模型调用、能力/工具调用、capability-owned gateway 慢边界、stream 可见输出和 terminal outcome。
- 在 local runtime package 中默认可用，不要求开发者额外打开功能开关；生产打包形态不注册调测台 route/page/API。
- 通过现有 runtime timeline、agent execution trajectory、observability safe projection、runtime diagnostic signal 和 event history 构建执行骨架，不创建新的 workbench 私有事实来源。
- 所有启动形态下，默认模型循环持久化已有 `MODEL_INVOCATION_STARTED`、`MODEL_INVOCATION_COMPLETED`、`MODEL_INVOCATION_FAILED` timeline event types，并只携带 production-safe 最小 payload；这是生产 timeline 行为变化。local runtime package 可额外附加 workbench-oriented enrichment。
- 在现有 facts 无法支撑关键调测视图时，由对应 owner 补充最小 safe projection payload；能从 `RequestRunRecord`、`RunTimelineEventRecord` 顶层字段、事件时间/顺序、session message、trajectory、existing safe observation 或 registry stable ref 读取/计算的字段不得新增。
- 默认不新增 `DevWorkbench*Record`、raw snapshot record、process graph store 或 workbench 私有 fact table；也不为了工作台给 `RequestRunRecord`、`SessionMessageRecord`、`TaskTrajectoryRecord`、`ActiveContextViewRecord` 增加顶层字段。
- 展示 reconstructed run effective view，包括本次 run 可还原的 Agent assembly refs、model profile/selection、prompt template ref、context budget/compression/selection evidence、capability disclosure summary、rendered tool names/count、实际 invoked capability ids 和最终模型请求安全参数；runtime settings/workspace policy summary 仅在可从历史稳定 assembly ref 解析时展示，否则标记 partial/current-view/unavailable。
- 展示 log evidence，按 run/action 关联已有 runtime diagnostic log / structured safe log 的 bounded excerpts，用于辅助阅读上下文，但不从日志文本重建 process graph 或 runtime truth。
- 以 `requestRunId`、`requestId`、`sessionId`、`requestContextId`、`capabilityInvocationId`、`agentId` 和 `agentVersion` 作为主关联键，不使用 trace id/span id、log offset 或文件路径作为业务主键。
- 保证调测台查询、投影、日志证据读取和页面渲染失败不影响 request lifecycle、terminal commit、stream projection、capability execution、model invocation 或 gateway persistence。

## 规格输入

- Dev Agent Workbench SHALL be a local runtime package surface, not a production observability surface.
- The existing local runtime package mechanism SHALL compose the workbench by default. Production packaging MUST NOT include workbench routes, page assets, dev-admin read adapter, or workbench enrichment.
- Workbench v1 MUST NOT compose app-level raw decorators, dev raw buffer, or system lifecycle hooks for capture.
- The workbench SHALL consume existing runtime timeline events, agent execution trajectory, observation-derived safe projections, runtime diagnostic events, audit navigation refs, metrics summaries, trace navigation refs, and stable persisted refs as read-only inputs.
- Missing data SHALL be supplied only through owner-owned minimal safe projection payload when necessary. Before adding a field, the implementation MUST prove it cannot be read or computed from existing facts. These payloads MUST be schema-validated and MUST NOT contain raw prompt, model output, tool args/result, provider raw body, credentials, secrets, tokens, attachment content, or paths.
- The workbench query surface SHALL be dev-only and runtime-schema-validated. It SHALL NOT be treated as a stable product API. The workbench page SHALL be a self-contained lightweight dev tooling page owned by `agent-dev-workbench`, without a separate frontend module, Vite/React build pipeline, external dev tooling artifact, or user-facing `agent-web` route.
- The local dev-admin read surface SHALL use an implementation-local read adapter and MUST NOT enter `/api/v1` or stable `agent-contracts/gateway`.
- The workbench SHALL act as a local-development dev-admin read surface for the local database and MAY browse across owner and Agent data only inside the local runtime package. This cross-owner/cross-agent read capability MUST NOT be exposed through production packaging or `/api/v1`.
- The workbench SHALL expose reconstructed run effective views from run-specific persisted facts and safe projection payload. Historical runs without sufficient facts MAY show best-effort reconstructed/current-registry views, but they MUST be marked as non-authoritative.
- The workbench SHALL expose bounded log evidence from existing runtime diagnostic log and structured safe log sources, filtered by stable refs and time windows.
- Log evidence SHALL be auxiliary only: the workbench MUST NOT parse log text to construct process graph, infer runtime state, reconstruct raw details, or use log offset/file path as business identifiers.
- Projection failure, serialization failure, page rendering failure, log evidence failure, or query failure MUST NOT alter request acceptance, scheduling, execution, terminal commit, stream delivery, recovery, or persistence.

## 契约输入

- `agent-app` owns local runtime package workbench composition and production packaging exclusion. It must not inject workbench raw decorators, dev raw buffer, or system hook.
- `agent-dev-workbench` owns self-contained dev-only route/page projection, graph projector, log evidence reader, dev DTO runtime schema validation, and local read adapter consumption. It must not introduce a separate frontend module or build pipeline.
- `agent-observability` only supplies existing safe observation/log inputs or helpers. It must not own workbench runtime truth, redefine structured logging, audit, metrics, trace, or redaction policy.
- `agent-channel-web` does not own workbench routes and must not add user-facing `/api/v1` DTO or stream event for the workbench.
- `agent-runtime` continues to own request lifecycle, scheduler, terminal commit and canonical timeline. It must not add workbench-specific lifecycle truth.
- `agent-core`, `agent-context-engine`, `agent-model`, and `agent-capability` may add minimal safe projection payload at their own public boundaries in local runtime package when required for reconstruction. Gateway slow boundary v1 is limited to capability-owned optional `gatewayOperations?: readonly GatewayOperationSummary[]` projected through `CAPABILITY_COMPLETED`; `GatewayOperationSummary` is owned by `agent-capability` public export. They must prefer existing `RunTimelineEventRecord.inlinePayload`, avoid workbench-only durable records, and must not add production-only raw observability fields for the workbench.
- `agent-contracts` SHOULD NOT gain a generic production `DevWorkbench` public contract unless the formal OpenSpec change proves a stable backend dev API is required. Dev-only DTOs should stay in the owning implementation surface with runtime schema validation.

## 实现约束

- Use existing facts and stable refs first. Do not add a second production event bus, surface-private observability carrier, app-level raw decorator chain, system hook, or parser that reconstructs execution state from log text.
- Use existing runtime diagnostic log and structured safe log sources for log evidence. Apply bounded query limits; do not add production log fields or change redaction to improve the workbench.
- Workbench projection is derived evidence for developer debugging. Runtime durable facts remain authoritative when workbench output and runtime state disagree.
- Safe projection payload must be bounded, schema-validated, owner-owned, and reusable outside the workbench projection. They should prefer refs, ids, reason codes, counts, usage, selected refs, template refs, capability ids, model/profile ids, tool names, redacted summaries, and bounded diagnostics. Generic timing, status, run/session/request/agent coordinates and graph edges should be read or computed from existing records/events rather than written again.
- Producer-side safe projection validation is best-effort. Validation, serialization, size-limit, or projection failure must drop optional payload or mark it unavailable and must not fail request execution or terminal commit.
- The workbench page should be a development tool surface. It must not become the main user chat UI, session history UI, audit UI, metrics dashboard, trace explorer or production operations console.
- The route namespace should be clearly dev-scoped, for example `/__nextagent/dev/workbench`, and must not overlap `/api/v1` production user-facing contracts.
- The self-contained workbench page must stay inside `agent-dev-workbench` as lightweight dev tooling assets and must not introduce a separate frontend package, Vite/React build pipeline, or browser UI ownership into runtime/core/context/model/capability packages.

## 非目标

- 不修改生产 structured logging、audit、metrics、trace、health、runtime logging 或 redaction policy。
- 不新增 canonical timeline event、stream event、audit event、metric label、trace attribute 或 gateway record 来服务调测台。
- 不在生产打包形态生产 workbench-oriented safe projection enrichment。
- 不通过 app-level decorator、系统 hook、dev raw buffer 捕获 raw prompt、raw model output、tool args/result、provider raw body 或内部对象。
- 不把 raw prompt、raw model output、tool args/result、attachment content、provider raw body、credential、secret、token 或路径写入正式观测面。
- 不提供远端生产诊断门户、集中日志检索、SIEM 集成、长期 raw 归档、多人权限管理或合规审计查询。
- 不提供实时 log tail、全文日志搜索或基于日志文本的执行状态重建。
- 不让调测台执行重放、重试、恢复、编辑请求、修改 Agent 配置、修改 capability binding 或改变任何运行时状态。
- 不以 trace id/span id、log offset 或文件路径作为主关联键。

## 验收要点

- Local runtime package：local runtime package 默认注册调测台；生产打包形态中 route/page/API 均不存在。
- No capture wrappers：`dev` profile 下也不得为工作台装配 model/capability/gateway/policy/context raw decorators、dev raw buffer 或系统 hook。
- Model timeline：所有启动形态下新 run 的模型调用尝试有 persisted `MODEL_INVOCATION_*` events；生产打包形态只产生 production-safe 最小 payload，不产生 workbench enrichment。
- Dev read adapter：跨 owner/agent 查询只存在于 implementation-local dev adapter，不进入 `/api/v1` 或稳定 gateway contract。
- Request/run view：给定 `requestRunId` 能从已有 facts 和 safe projection payload 展示 request lifecycle、context assembly、model invocation、capability/tool invocation、visible output start 和 terminal outcome 的关联视图。
- Gateway slow boundary：v1 只从 optional `CAPABILITY_COMPLETED.gatewayOperations` 展示 capability 范围内的 gateway 慢边界；context/policy/runtime/workbench gateway 慢边界不生成 graph 节点，只能显示 partial/unavailable 或作为 log evidence。
- Safe detail：动作详情能展示 safe summaries、refs、status、duration、usage/counts、selected refs 和 detail availability；raw 不存在时明确显示 unavailable，不伪造。
- Effective view：能查看 Agent 生效配置 refs、prompt template ref、context selection/compression、capability 可见性链路、rendered tool names/count、实际调用 capability 和模型有效参数；缺少 run-specific facts 时必须明确标记 reconstructed/current-view/partial/unavailable。
- Log evidence：能按 run/action 查看 bounded safe log excerpts；日志缺失、轮转、不可访问或超限时明确显示 unavailable/truncated；不得用日志解析生成 graph 或 raw detail。
- Non-interference：模拟 safe projection failure、serialization failure、page query failure 和 log evidence failure，主 request lifecycle 和 terminal commit 保持不变。
- Separation：safe projection payload 和日志证据不得让 raw prompt/model/tool/provider/credential/secret/token/attachment/path 进入 `ObservabilityObservationEvent`、structured log、audit event、metric sample、trace output、canonical timeline、gateway record、checkpoint 或 memory。
- Scope：跨 owner/agent 查询只允许出现在 local runtime package 的 dev-admin 工作台；生产打包形态和 `/api/v1` 必须不可用。
- Architecture：不得 private path import；不得让 `agent-channel-web` 拥有 request lifecycle；不得让 `agent-observability` 反向推断业务真相；不得在业务 package 中引入浏览器 UI ownership。

## 并行边界

- 本 change 可以在 trace/log linking、agent execution trajectory、structured/runtime logging 和 local runtime package 机制稳定后实施；workbench 由 local runtime package composition 装配，生产打包 composition 排除。
- 若正式设计发现现有 facts 无法支撑必要调测视图，必须优先在事实 owner 的 OpenSpec 约束下补 minimal safe projection payload，而不是让调测台私自读取 owner 私有对象。
- 页面必须作为 `agent-dev-workbench` 自包含轻页交付；不得新增独立前端/开发工具模块、Vite/React build pipeline 或外部 artifact。
- 不得与 production observability、audit、metrics、trace、runtime logging 或 Web 用户对话体验 change 竞争 owner。

## OpenSpec 起草建议

- 正式 change id：`add-ts-dev-agent-workbench`。
- Proposal 聚焦“开发期 Agent 调测体验”，明确它不是生产观测能力。
- Design 必须先裁决 profile composition、projection-first 数据来源、minimal safe projection payload、route/page surface、owner/agent scope 和 non-interference，再定义 UI 信息架构。
- Delta specs 至少覆盖 dev workbench behavior、safe projection payload、trace/log linking consumption、runtime logging/observability separation 和 local runtime package composition。
