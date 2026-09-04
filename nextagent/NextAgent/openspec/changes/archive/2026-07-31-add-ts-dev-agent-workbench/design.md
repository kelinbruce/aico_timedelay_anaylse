## 背景和现状（Context）

当前 TS 后端已有几类事实面：

- `agent-runtime` 拥有 request lifecycle、scheduler、canonical timeline、terminal commit 和 run timeline listener。
- `agent-observability` 拥有 observation handoff、structured log、metrics、audit 和 trace projection，且正式观测面禁止 raw prompt、raw model output、raw tool args/result、路径、secret 等内容。
- `agent-execution-trajectory`、runtime timeline、messages、request run 和 safe observation 已能提供一部分执行骨架。
- `agent-app` 是 composition root，已有 Fastify server composition、local runtime package manifest 和 package profile/entrypoint 边界；本 change 需要让 local runtime package composition 默认携带开发者调测工作台，并保证生产打包 composition 排除该能力。
- `agent-channel-web` 拥有 Web route projection，但不拥有 request lifecycle。
- 当前 `TimelineEventType` 已包含 `MODEL_INVOCATION_STARTED`、`MODEL_INVOCATION_COMPLETED`、`MODEL_INVOCATION_FAILED`；`packages/agent-observability/src/model/model-invocation-wrapper.ts` 当前使用这些字符串作为 model observation operation label / safe error code，默认模型循环尚未形成稳定 persisted model invocation timeline fact。
- 当前 session/message/timeline/request run gateway 查询均按 owner/agent scope 设计；同端口工作台必须复用普通 Web 页面认证得到的可信 Owner Scope，并在当前 hosted root Agent 可达的 assembly graph 内查询。

现有机制适合生产运维和安全复盘，但不适合本地 Agent 开发者快速理解一次 request/run 的完整执行过程。开发者需要图形化查看一次对话请求经历的动作、耗时、状态、错误、Agent 生效配置、prompt/context/capability/model 选择、日志证据和可用详情。

本 change 的关键约束是：工作台必须只作为 local runtime package 的旁路内省面存在，优先基于已有事实 projection/reconstruction；不得为了调测台在 `agent-app` 里横切包装主路径 ports，也不得注册仅用于采集的系统 hook。该能力复用现有 local runtime package manifest、entrypoint 和 package profile 机制；不新增独立 runtime profile taxonomy、`dev` package profile 或可在生产发布包中临时打开的 feature flag。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 在 local runtime package 默认注册独立 Agent Dev Workbench 页面和 dev API。
- 支持开发者在当前认证 Owner Scope 与 trusted hosted root Agent/subagent assembly graph 内查看会话、对话和 request/run。
- 在 local with-frontend 形态向普通 Agent 页面注入 workbench-owned 悬浮入口，并可直接打开当前 session；未装配工作台时不出现入口。
- 为 completed run 基于已有 facts 生成 process graph，并支持点击节点查看 safe detail。
- 展示 reconstructed run effective view，帮助开发者理解本次 run 实际使用的 Agent 配置、prompt 模板、上下文、capability 暴露状态和模型有效请求。
- 在现有 facts 不足时，仅当对应 owner 从生产运行、审计、恢复或故障诊断角度独立需要时补充正式业务运行事实；仅为工作台展示需要的缺口保持 partial/unavailable。
- 展示 bounded log evidence，帮助开发者在同一页面查看与 run/action 关联的已有安全运行日志片段。
- 保证所有工作台查询、投影和 safe projection 失败都不影响正常 request lifecycle、terminal commit、stream、gateway persistence 和正式 observability。

**非目标：**

- 不实现生产诊断门户、远端诊断、多用户权限管理、集中日志检索、SIEM 或长期 raw 归档。
- 不新增生产 `/api/v1` Web API、StreamEventType、AuditEvent、Metric、Trace attribute 或 gateway record 来服务工作台。
- 不实时展示活动中的请求，不提供 retry/edit/cancel/replay/resume/fork/answer pending input 等修改命令。
- 不提供实时 log tail、全文日志检索、集中日志平台或基于日志文本的执行状态重建。
- 不通过 app-level raw decorators、dev raw buffer 或系统 lifecycle hook 捕获 model/capability/gateway/policy/context/hook raw input/output。
- 不把 raw prompt、raw model output、raw tool args/result、provider raw body、credential、secret、token、attachment content 或 path 写入 session message、timeline、checkpoint、memory、audit、metrics、trace、structured log 或业务 store。

## 设计决策（Decisions）

### 决策 0：复用 local runtime package 机制携带工作台

选定路径：复用 `LocalRuntimePackageManifest`、local package entrypoint 和 local package composition 机制。local runtime package 默认注册 Agent Dev Workbench route/page/API；生产打包 composition MUST NOT 包含 `agent-dev-workbench` package、workbench route/page/API 或 local scoped read adapter。工作台是否装配不得改变主路径产生的业务运行事实。

最小契约：

- local runtime package start path 创建 app 时注册 `agent-dev-workbench`。
- production packaging/build path 不依赖 `agent-dev-workbench`，产物中不包含 workbench route registration、页面 asset 或 dev read adapter。
- 不能通过配置、环境变量、客户端请求、模型输出、capability 参数或数据库事实在生产打包中打开 workbench。
- release/package evidence 和 production packaging tests MUST assert workbench is absent from production artifacts.

放弃路径：
- 不新增与 local runtime package 并行的 app-owned exposure gate。
- 不把不存在的 production/remote/release-test runtime profile taxonomy 作为实现前提。
- 不新增 `dev` package profile 或用户可配置 feature flag 来在生产发布包里打开 workbench。

### 决策 1：使用 entrypoint-composed trusted local extension

选定路径：新增 `agent-dev-workbench` dev route module/package，由 local runtime entrypoint 作为 trusted local extension 选择。通用 `create-app` 只允许 owner-neutral 的 local diagnostic safe projection policy，不出现 `devWorkbenchRegistration`、`DevWorkbenchRegistrationContext` 或 workbench 专用 route enablement。local configured auth entrypoint 在与普通 Web API 相同的 protected Fastify scope 内调用通用 protected-route contribution；workbench extension 在该 contribution 中注册 route/page/API，并接收同一个 trusted identity resolver。

该 extension 不包裹 model/capability/gateway/policy/context 主路径 ports，不注册系统 lifecycle hook，不拥有 raw buffer，不成为 runtime lifecycle owner。

放弃路径：
- 不把工作台实现为普通用户 plugin，避免用户插件获得注册 Fastify route 或读取 owner-scoped 调测事实的能力。
- 不在 `agent-channel-web` 主生产 route 中混入工作台 route。
- 不让 `agent-channel-web` 拥有 workbench 页面/API 或 workbench scoped 查询。
- 不在 `agent-app` wrapper 链中插入 workbench decorator，避免和 observability wrapper、timeout、abort、safe error mapping 的语义冲突。

### 决策 2：package-owned dev frontend artifact，dev namespace 与生产 API 分离

选定路径：`agent-app` 装配 `agent-dev-workbench` 注册 `/__nextagent/dev/workbench` 页面和 `/__nextagent/dev/workbench/api/*` 查询接口。页面由 `agent-dev-workbench` 作为 dev tooling package 拥有，可使用与 `frontend/agent-web` 一致的 React、Vite、Ant Design 和 G6 技术栈来构建开发者工作台体验；构建产物只由 `agent-dev-workbench` 的 dev route 静态服务，并直接调用同 namespace dev API 渲染会话列表、对话、run 列表、process graph、节点详情和日志证据。

该页面是开发工具 surface，不是最终用户浏览器 UI、正式前端应用或 `agent-web` 的一部分。它 MUST NOT 在 `frontend/agent-web` 中新增 route、feature、状态管理或产品 artifact；MUST NOT 由 `agent-channel-web` 拥有；MUST NOT 随 backend-only、with-frontend 或 production packaging composition 发布。页面可以拥有本页所需的短生命周期浏览器状态和图形交互，但不得建立可被生产功能复用的长期 UI 状态架构。

local with-frontend entrypoint MAY 向通用 frontend hosting 提供受信任的 same-origin script contribution。`agent-dev-workbench` 拥有 launcher script；launcher 使用独立 custom element/Shadow DOM 添加悬浮按钮，只读取 `window.location.hash` 中的 `#/session/:sessionId`，并跳转到 `/__nextagent/dev/workbench?sessionId=...`。按钮默认使用不遮挡业务页面的半透明状态，hover、keyboard focus 和拖动时恢复完全不透明并增强视觉反馈；使用 Pointer Events 在 viewport 内拖动，超过小幅移动阈值后不得触发点击跳转，位置只保留在当前页面生命周期，不进入配置或持久化。frontend hosting 只验证和注入通用 script source；`frontend/agent-web` bundle 不引用、不探测、不渲染该入口。没有 workbench contribution 时，托管 HTML 保持无 launcher script、按钮和链接。

放弃路径：
- 不在 `frontend/agent-web` 或最终用户 chat UI 中实现工作台。
- 不把 dev API 放入 `/api/v1`。
- 不让 `agent-app`、`agent-channel-web` 或 runtime/core/context/model/capability package 拥有工作台 UI。
- 不把 workbench frontend artifact 纳入生产 package profile 或生产前端 hosting artifact。

### 决策 3：projection-first，历史和新 run 使用同一套还原原则

选定路径：工作台 process graph 和 detail 优先从已有 session/message/requestRun/timeline/trajectory/safe observation/log correlation refs 读取并查询时派生。新 run 和旧 run 使用同一套 projection 原则；工作台装配状态不改变新 run 的业务事实，旧 run 缺失正式事实时显示 partial/unavailable。

缺失信息通过 detail availability 明确展示为 unavailable/partial/truncated，而不是通过 workbench 私有采集补齐。

放弃路径：
- 不新增 durable raw snapshot table、本地临时 raw 文件或进程内 raw buffer。
- 不为了补旧数据回写 messages/timeline 或重新执行请求。
- 不用日志文本、trace span 或 log offset 反推执行事实。

### 决策 4：工作台不拥有生产事实，缺口先按业务语义归属

选定路径：如果当前 facts 不足以支撑调测台关键视图，必须先建立字段来源映射并判断 owning domain 是否独立需要该事实。只有生产运行、审计、恢复或故障诊断本身需要时，owner 才能增加正式、production-safe、schema-validated 的运行事实；否则工作台查询时派生或显示 partial/unavailable。

模型调用边界是 runtime 基础事实：所有 run-bound 模型调用都生产已有 `MODEL_INVOCATION_*` timeline events，并携带 production-safe 最小 payload。这是生产运行、审计和故障诊断事实，不是 workbench-only 能力。context selection、prompt template ref、capability disclosure 等字段只有在 owning domain 独立需要表达“本次实际选择/发送结果”时才可成为正式事实；不得通过 local runtime composition 增加另一套 enrichment。

KISS 字段原则：

- 能从 `RequestRunRecord` 读取的字段不新增：`runId`、`sessionId`、`requestId`、`agentId`、`agentVersion`、`agentAssemblyRef`、`attempt`、`retryOfRunId`、`parentRunId`、`priority`、`status`、`createdAt`、`updatedAt`。
- 能从 `RunTimelineEventRecord` 顶层读取的字段不新增：`eventId`、`sequence`、`type`、`requestContextId`、`createdAt` 和 owner/agent/run 坐标。
- 能从事件对计算的字段不新增：通用 `startedAt`、`endedAt`、`durationMs`、顺序 edge、terminal status。只有 owner 已经因为边界语义写入 `durationMs`，或者没有可靠 start/end 事件对时，才允许保留/补充该 owner 的 duration。
- 能从 session message、trajectory、existing safe observation 或 registry stable ref 查询的字段不新增。历史 registry 可能漂移且 run-specific 归因需要历史权威时，才允许补充 stable ref/hash/version。
- 不新增 `DevWorkbench*Record`、canonical process graph store、raw snapshot table、dev raw buffer 或 workbench 私有 fact table。
- 不为了工作台给 `RequestRunRecord`、`SessionMessageRecord`、`TaskTrajectoryRecord` 或 `ActiveContextViewRecord` 增加顶层字段；除非该字段被 owning domain 独立需要，而不是 workbench-only。

默认承载：在已有 `RunTimelineEventRecord.inlinePayload` 中，为已有 `TimelineEventType` 定义 schema-validated safe projection payload。Workbench dev DTO 只作为查询结果，不作为 durable fact。

Schema owner：正式运行事实的 payload schema 由对应事实 owner 定义和通过 owner public export 暴露；v1 不新增 `agent-contracts/runtime` shared timeline payload schema，也不新增没有实际 producer 的 capability gateway summary public contract。Model invocation result metadata 由 `agent-model` 以 provider-neutral result 表达，runtime-owned invocation boundary 负责将其映射为 canonical timeline payload；context、capability、policy/runtime planning facts仍由对应业务 owner 定义。若后续必须提升 shared timeline payload schema 或修改冻结 model/runtime contract，必须先做独立 contract confirmation/refinement，不能在本 change 实施阶段临时选择。Producer 在 emit timeline event 前进行 runtime validation；可选 payload validation/serialization 失败时标记 `projectionUnavailable`，不得阻断模型结果、terminal commit 或 request execution。

字段补充清单：

| 事件/来源 | 不新增，直接读/算 | 允许新增的最小 payload |
|---|---|---|
| `REQUEST_ACCEPTED` + `RequestRunRecord` | run/session/request/agent 坐标、agent version、agent assembly ref、attempt、priority、status、created/updated time；runtime settings/workspace policy 优先由 `agentAssemblyRef` 解析 | 仅当 `agentAssemblyRef` 不能历史稳定解析时，补 `agentAssemblyHash` 或 `agentAssemblySnapshotRef`；不作为首批字段补 runtime/workspace summary |
| `PLANNING_STARTED` | queue wait 可由 `PLANNING_STARTED.createdAt - RequestRunRecord.createdAt` 计算；planning start time 读 event `createdAt` | `laneKind`、`queueDepthBucket`、`schedulerDecisionCode`，仅在 scheduler owner 已有该决策且无法查询时补 |
| `MODEL_INVOCATION_STARTED` | run/request/context/agent 坐标读 event 顶层；start time 读 event `createdAt`；通用 tool/message 数量可从正式 request/result 计算时不另写 | 所有 run-bound 调用统一 payload：`stepId`、`modelProfileId`、`providerKind`、`modelName`、`modelOptionSummary`、`providerOptionKeys`；本次实际 disclosure 只保留 owner 独立需要的单一正式事实，不另写平行工具/能力列表 |
| `MODEL_INVOCATION_COMPLETED` / `MODEL_INVOCATION_FAILED` | end time 读 event `createdAt`；duration 由 start/end 事件计算；status 由 event type 计算；输出长度优先从 terminal/session message 计算 | 所有 run-bound 调用统一 payload：`finishReason`、`usage`、`toolCallCount`、`safeErrorCode`、`safeErrorCategory`；不增加 local-only output summary |
| `CAPABILITY_STARTED` | capability node start time 读 event `createdAt`；capability id/tool call id 已有时不重复；descriptor 和参数从 exact run-bound catalog/assembly 与 persisted tool-use message 读取 | `stepId`；多调用仅补实际 `toolBatchExecutionMode`、`toolBatchOrdinal`、`toolBatchSize` |
| `CAPABILITY_COMPLETED` | end time 读 event `createdAt`；duration/status/safe error 使用既有字段；结果与 effect detail 按 `toolCallId` 读取 persisted result/lifecycle facts | 不新增调测详情字段 |
| `POLICY_APPLIED` | operation/outcome/reason/risk/capability/tool fields 已有时不重复 | `policyId`、`policyVersion`、`policyDomain`、`policyPoint`，仅在 policy owner 能提供 stable id/version 时补 |
| `CONTEXT_COMPACTED` | compaction time 读 event `createdAt`；message refs 能从 compaction commit/message facts 读取时不重复 | `strategyCode`、`beforeTokenEstimateBucket`、`afterTokenEstimateBucket`、`retainedMessageCount`、`droppedMessageCount`、`summaryMessageId`、`reasonCode` |
| `HOOK_INVOKED` | hook id/stage/status/duration/effects/safe error 当前已有，默认不新增 | 暂无；除非 hook owner 后续定义新的 safe reason/version |
| gateway 边界 | v1 不新增 generic gateway event，不把 DB persistence、context、policy、runtime gateway 调用入图；结构化日志只能作为 evidence，不作为 graph truth | 不新增没有实际 producer 的 summary contract；缺失时显示 partial/unavailable |

这些 payload 不要求一次性全部实现。Task 3.1 必须先产出字段来源映射；如果某字段已有来源或可计算，对应 implementation task 应删除该新增字段或标记为不新增。

放弃路径：
- 不让 `agent-dev-workbench` 直接读取 owner 私有对象。
- 不新增只服务工作台的 raw DTO、raw event、durable record 或 graph store。
- 不为了工作台放宽 production observability redaction。

### 决策 4.1：统一 run-bound model invocation boundary 持久化模型调用 timeline events

选定路径：app composition 向所有 run-bound 模型调用方提供一个统一 invocation boundary。调用方传入 runtime-owned run/context 坐标、provider-neutral `ModelInvocationRequest` 和 `AbortSignal`；该边界在调用 `agent-model` 前写 `MODEL_INVOCATION_STARTED`，并根据标准化 final result、safe error、abort 或 throw 写 `MODEL_INVOCATION_COMPLETED` 或 `MODEL_INVOCATION_FAILED`。canonical event 仍经 runtime timeline port 写入。该能力不新增 `TimelineEventType`，但会让默认 Agent loop、workflow、context summary 等所有 RequestRun 内模型调用使用同一规则。

最小行为：

- 每次模型尝试开始时发 `MODEL_INVOCATION_STARTED`，payload 只包含 owning domains 已正式定义的 production-safe 字段。
- 模型尝试成功完成时发 `MODEL_INVOCATION_COMPLETED`。
- provider error、safe error、abort/cancel 或模型调用异常时发 `MODEL_INVOCATION_FAILED`；如果请求随后 fallback 到下一模型尝试，下一次尝试重新发 started/completed/failed。
- model event payload validation/serialization 失败时跳过可选 payload 或标记 unavailable；不得影响模型调用结果。基础模型事件写入失败按既有 timeline failure policy 处理，不得引入 workbench-specific failure path。

生产打包 composition 和 local composition 对相同 run-bound 模型调用产生相同的 `MODEL_INVOCATION_*` 事实；二者只在是否注册工作台页面/API 上不同。User stream 不新增 event vocabulary，因为这些 event types 已存在；实现必须验证现有 stream projection 对这些事件保持安全、兼容和 bounded。

### 决策 5：process graph 是 derived projection，不是业务事实

选定路径：工作台 process graph 由 graph projector 在查询时根据已有 facts 和 safe projection payload 组装。Graph node 使用 dev-only DTO，包含 `actionId`、type、status、time/duration、refs、detailAvailability。Action detail 从已有 facts 或 safe projection payload 读取；缺失时显示 unavailable/partial/truncated。

放弃路径：
- 不新增 canonical process graph store。
- 不让 runtime/core 为工作台发布新的 graph event。

Gateway node 处理：`gateway` 是 graph vocabulary，不是 v1 必须出现的节点。v1 不新增 capability gateway summary public contract；context、policy、runtime persistence、workbench local read 和其他 gateway 慢边界不进入 v1 graph，统一显示 partial/unavailable 或通过 log evidence 辅助查看，但日志不构建 graph truth。

Action detail 关联规则：模型 Token 用量直接读取配对后的 `MODEL_INVOCATION_COMPLETED.usage`；provider 未返回 usage 时显示 unavailable，不估算。Capability 参数和结果不新增 timeline payload，而是用节点已有 `toolCallId` 精确关联同一 run 中已经持久化的 `ASSISTANT_TOOL_USE` 与 `CAPABILITY_RESULT` messages；参数取 tool-use message 中该调用的 `arguments`，结果取 result message 的 `payload`。无法关联时只标记 unavailable，不扫描其他调用兜底，也不把一个 run 的全部工具消息堆到当前节点。

Prompt 近似视图只在 workbench 查询时组装。`agent-app` local runtime composition 向 workbench 注入只读 resolver；resolver 仅从已有 `PromptTemplateRegistry.templatesFor(run.agentId, run.agentVersion)` 中按模型节点的 `promptTemplateRef` 精确匹配模板。Workbench 再按 `selectedMessageRefs` 关联已有持久化消息，并从 `disclosedCapabilityIds × exact run-bound catalog/assembly` 派生能力名称和分类。该结果始终标记为非 provider-authoritative，并列出无法重放的动态模板变量、capability-generated messages、attachment blocks、完整 tool schemas、render-time transforms 和 `BEFORE_MODEL_INVOKE` hook mutations；不重新调用 context assembly、renderer 或 model request builder，也不新增 raw prompt 事实。

### 决策 12：模型调用事实不通过 RenderedModelInput 平行投影搬运

删除 `RenderedModelInputSafeContextProjection` 与 `RenderedModelInput.safeContextProjection`。run-bound invocation boundary 接收 core-internal、非 public-contract 的 prompt/selection refs，并直接从最终 `ModelInvocationRequest` 计算 `disclosedCapabilityIds` 和 `modelMessageCount`。预算、压缩、附件降级继续由 context lifecycle events 表达并补 `stepId`；不得复制为 model-start payload。这样正式 timeline 完整记录本次调用的关键选择，同时不建立 workbench-oriented contract 或重复字段通道。

### 决策 13：工具调用 timeline 只保留不可可靠派生的业务事实

`CAPABILITY_STARTED` 保留既有 `capabilityId`、`toolCallId`，并记录用于模型轮次关联的 `stepId`；多调用批次额外记录实际 execution mode、ordinal 和 size。descriptor、timeout、argument keys/size、result/effect summary 不再为了工作台复制到 timeline：工作台通过 `toolCallId` 读取 persisted tool-use/result messages，并通过 exact run-bound catalog/assembly 解析 descriptor。`CAPABILITY_COMPLETED` 沿用既有 status/duration/safe error 和 owner 已有 observation fields。缺失历史事实显示 partial/unavailable。

### 决策 14：前端构建产物不进入源码版本控制

`agent-dev-workbench/web` 是源码 owner，`web-dist` 由 workspace build 在开发、测试打包或 local package staging 前生成，并被 Git ignore。源码仓库不提交 hash asset、bundle 或生成 HTML；local pack 仍从构建目录复制产物。未构建时 dev route 返回已有的 bounded build-unavailable 页面。

Run graph 与 action detail 共用同一组 scoped inspection messages：查询按 run 的 owner、agent、session scope 读取当前 run 的 tool messages 以及模型节点显式引用的 selected messages。Capability 参数/结果、Bash command preview 和 Prompt selected messages 均从该集合按稳定 ref 精确关联。Bash 节点只对 `toolName === "Bash"` 且参数中存在 string `command` 的调用生成 bounded single-line preview；详情继续呈现完整参数。这样不会形成独立消息解析路径，也不会把 command 写入 timeline 或 log。

Subagent 节点规则：`CAPABILITY_*` 配对节点的 `capabilityKind === "AGENT"` 时投影为 workbench graph vocabulary `subagent`。目标 Agent 和 delegated prompt 继续从该节点 `toolCallId` 对应的 persisted tool-use message 读取；结果从对应 capability result message 读取。Child Session 使用 canonical `deriveCapabilityInvocationIdempotencyKey(parentRunId, toolCallId)` 对 `sessions.idempotency_key` 精确查询，并校验 tenant、subject、`parent_session_id`、`parent_run_id`、`parent_request_id` 以及目标 `agent_id`；child run 再校验 persisted `RequestRunRecord.parentRunId/parentRequestId`。任一步不唯一或不匹配即 unavailable，不做时间/顺序兜底。成功关联后 graph refs 只增加 child Agent/Session/Run/status stable refs，raw prompt/result 仍只在 action detail 中读取已有 message。

Gateway 缺失规则：没有已有正式业务事实时只显示 gateway detail unavailable；工作台 MUST NOT 从日志推断 gateway 节点。persistence/database gateway、terminal commit、checkpoint、workbench 查询永远不生成 gateway 节点。

### 决策 6：run effective view 是重建视图，不是 raw snapshot

选定路径：工作台展示 reconstructed run effective view。该 view 从已接受的 request/run scope、Agent assembly refs、context safe projection、capability disclosure projection、prompt template refs 和 model invocation safe projection 派生。v1 必达内容是 run-specific 安全归因；runtime settings summary 和 workspace policy summary 优先由 `agentAssemblyRef` 解析，无法历史稳定解析时标记为 `partial` 或 `current-view`，不新增首批 payload。

- Agent identity、version、assembly ref、assembly summary refs，以及可从 assembly ref 历史稳定解析的 runtime settings/workspace policy summary。
- model profile selection、provider/model、effective option safe values、timeout、tool count。
- prompt template ref、purpose、selected message refs、context budget/compression/truncation/degradation evidence。
- capability binding/disclosure summary、visible capability ids、rendered tool names/count、实际 invoked capability ids。

Agent 完整配置读取规则：local runtime composition 把现有 `AgentAssemblyRegistry` 作为只读 trusted source 提供给 workbench read adapter。Adapter 只调用 `require(run.agentId, run.agentVersion)`，并继续校验返回对象的 `agentAssemblyRef === run.agentAssemblyRef`；三项精确匹配后才投影完整 compiled `AgentAssembly`。该对象包含 assembly contract 中已有的 identity metadata、model profile ids、capability bindings、runtime settings、workspace policy、routing、hooks 和 policies，不包含 provider credential 的解析值。模型节点的 Tool、Skill、Agent 分类必须以本次模型调用实际 disclosure ids 与该 run-bound assembly 的 `capabilityBindings.capabilityType` 精确关联；不得依赖 capability 是否已被调用、不得把“非工具”猜成 Skill，也不得展示 assembly 中未向本次模型调用披露的能力。registry 缺失、require 失败、ref 不匹配或 disclosure id 无法分类时返回明确 partial/unavailable，不回退到 `active()` 或当前默认配置。

历史 run 如果缺少 run-specific projection payload，只允许展示 best-effort reconstructed/current-registry view，并必须标记为非历史权威视图。

Selected-node effective view：`AgentDevWorkbenchEffectiveView` 仍是 run-wide derived projection，但 UI 必须把它拆成 run-wide Agent configuration 和 selected-node execution context。Agent identity/version/assembly/configuration 属于 run-wide；model profiles、prompt refs、rendered tools 和 model options 只在 selected model node 展示；capability/subagent 节点只展示该 invocation 的 capability/target/child refs。Action detail 中的 `effectiveViewSummary` 同样按 node type 最小化，不能给普通 capability 节点附带 run 聚合 rendered tools。

Agent 列表来源：local runtime composition 将当前启动时编译完成的 `AgentAssembly[]` 作为只读 resolver 注入 workbench，不扩展稳定 `AgentAssemblyRegistry` contract。Workbench 将这些 assembly 与 SQLite session counts 合并；assembly 中有 `parentAgentScope`、`agentInvocation === "PARENT"`，或同时满足 `userInvocable === false` 与 `agentInvocation === "BOUND"` 的条目标记为 subagent。前两者是 parent-scoped local subagent，后一种是只能经显式 Agent binding 调用的 invoked-only Agent；列表保留准确 invocation policy，且不得为 `BOUND` 条目伪造 parent scope。没有 assembly、只有历史 session 的 agentId 可作为 historical unavailable entry 出现。完整配置沿用 compiled assembly JSON，不读取 credential resolver。

放弃路径：
- 不把 Agent 完整 raw 配置快照写入业务表或生产 timeline。
- 不在查询历史 run 时用当前 registry 值伪装历史真实配置。
- 不从 log 文本、客户端请求体或模型输出反推 Agent 生效配置。

### 决策 7：同端口工作台复用 Owner Scope 与 trusted Agent graph

选定路径：工作台读面在 local runtime package 下复用普通 Web 页面认证产生的 `IdentityContext`。每个查询由 route 从 trusted identity resolver 得到 `tenantId`/`subjectId`，并由 local composition 提供当前 hosted root Agent 以及通过 parent scope 或启用的 `AGENT` capability binding 可达的 subagent assembly graph。read adapter 必须在 SQL 查询中同时约束 Owner Scope 和 allowed Agent ids；客户端 query/body 不得提供或覆盖 owner scope。

实现边界：新增 implementation-local `AgentDevWorkbenchLocalReadPort`，由 `agent-dev-workbench` 消费、由 local gateway/app composition 提供。它不进入稳定 `agent-contracts/gateway` public contract，不暴露给 `agent-channel-web`。最小查询能力包括：

- list owner/agent-scoped sessions with optional `agentId` filter。
- load conversation messages by `sessionId` and selected `requestRunId`; server-side query 默认只返回当前 run messages，并同时校验 Owner Scope、Agent Scope、session/run binding。完整 session conversation 仅可作为显式次级视图，不得替代 run-scoped 默认结果。
- list request runs by `sessionId` / `requestRunId`。
- list timeline events by `requestRunId`。
- list trajectory records/log correlation refs when existing stores support them。

SQLite read adapter 在捕获查询失败时通过现有 runtime logger 写入 `agent_dev_workbench.sqlite_read_failed` error event。字段只允许稳定 `safeReasonCode` 与固定 `operation` vocabulary；实现可在进程内检查原始异常以区分 `SQLITE_SCHEMA_UNAVAILABLE`、`SQLITE_BUSY`、`SQLITE_OPEN_FAILED` 和 `SQLITE_READ_FAILED`，但不得把原始异常、数据库路径、SQL、Owner Scope 或 run/session refs 写入日志。日志失败不得改变 bounded fallback 结果。

已有 session 深链接只传 `sessionId`。服务端先在可信 Owner Scope 下读取 session-bound `agentId`，再校验该 Agent 属于 allowed assembly graph；不得信任客户端同时传入的 `agentId`。child subagent 导航继续校验相同 owner、canonical idempotency key、parent refs 和 allowed child Agent。

放弃路径：
- 不保留无认证的本地全库查询或跨 owner/无关 Agent 浏览能力。
- 不把 workbench 查询加入普通 `/api/v1/sessions`。
- 不改变生产 Owner Scope 和 Agent Scope 数据隔离。

### 决策 7.1：工作台页面以 current session 深链接初始化

选定路径：workbench 页面读取 `sessionId` query parameter，完成 owner/agent-scoped session list 后只在该 session 存在于授权结果中时选中它，并打开其 run。参数缺失时进入授权范围内的默认会话；参数无权或不存在时显示 bounded unavailable 状态，不回退到其他 owner/agent 的同名 session。

右侧上下文页签固定为 `对话`、`详情`、`运行配置`、`日志`。删除重复的 `Agent` 页签；当前 Agent 基本 identity 保留在 selector/breadcrumb，完整 run-bound Agent assembly/configuration 只在 `运行配置` 页签展示。`对话` 和 `日志` 均以当前选中 `requestRunId` 为必需过滤坐标；节点 refs 只能在该 run 内进一步缩小日志结果。

### 决策 8：log evidence 是只读辅助证据面，不是执行事实来源

选定路径：工作台在 local runtime package 下提供 bounded log evidence view。该视图从现有 runtime diagnostic log 和 structured safe log source 读取安全日志片段，并按 `requestRunId`、`requestId`、`sessionId`、`agentId`、`agentVersion`、`requestContextId`、`capabilityInvocationId` 和时间窗口过滤。页面可从 run、graph node 或 action detail 跳转到相关日志证据。

Log evidence 只用于帮助开发者阅读已有日志上下文。Process graph、action detail、effective view 和 raw availability 不依赖解析日志文本生成。日志 offset、文件路径或物理日志位置不得成为业务主键。

日志读取必须 bounded：限制时间窗口、返回条数、总字节、单条字节和扫描范围。日志缺失、轮转、不可访问、过大或解析失败时，只返回 unavailable/truncated/bounded diagnostic。

放弃路径：
- 不提供实时 tail/SSE/WS 日志订阅。
- 不新增生产日志字段来服务工作台。
- 不把 raw prompt、model output、tool args/result、provider raw body、credential、secret、token、附件内容或路径写入日志来增强工作台展示。
- 不基于日志文本反推 runtime lifecycle 或 action graph。

### 决策 9：Tool batch 实际执行模式属于 capability runtime trajectory

- 多 Tool call 是否并行只能在 preparation、pending-input 分流和 request-local serialization policy 完成后确定，不能由工作台根据相同 `stepId`、事件顺序、耗时重叠或日志推断。
- `agent-core` 在 `CAPABILITY_STARTED` 写入 bounded `toolBatchExecutionMode`、`toolBatchOrdinal`、`toolBatchSize`；这些字段服务生产故障诊断、容量与并发行为审计，local/production 一致，不是 workbench enrichment。
- 单调用不写 batch 字段。多调用即使因 request-local effects 串行，也明确写 `SERIAL`，避免把“同一模型轮次”误当作“并行执行”。
- workbench 只消费 canonical timeline：`PARALLEL` 组生成 fork/join edges，`SERIAL` 组保留 sequence edges；旧 run 缺少字段时保持原顺序投影，不猜测并行。

### 决策 10：并行批次使用独立布局块和正交分叉/汇聚走线

- UI 从 graph DTO 的 `parallel` edges 与 batch refs 识别并行成员，不新增业务字段。
- 主 sequence backbone 使用紧凑网格；遇到并行批次时先结束当前主链行，在后续完整行中按可用宽度排列 sibling nodes，批次结束后再恢复主链，避免主链节点占用并行区域。
- 同批成员超出一行时 bounded wrap；任何节点不得出现负坐标或超出布局宽度。
- fork/join edges 使用共享的水平 routing corridor 与正交 control points，颜色与 sequence/child edge 区分；route 不穿过节点，汇聚目标位于批次最后一行之后。
- 布局只属于 workbench frontend artifact，不改变 graph facts、runtime timeline 或生产前端。

### 决策 11：并行语义必须显式可见，不能只靠拓扑推断

- 每个 parallel batch 在 G6 data 中派生一个 workbench-only combo，显示 `并行执行 · N`，浅蓝背景和虚线边界覆盖全部 sibling nodes；combo 不进入 graph API 或 runtime facts。
- 每个成员 secondary line 显示 `并行 ordinal/size`，即使截图裁掉分叉/汇聚上下文也能识别为并行。
- frontend visual projection 将 backend 的 member-level parallel edges 折叠为两条 group-level edge：`前序 action -> combo -> 后序 action`。盒内不画成员级连线；成员之间没有执行顺序或调用关系。
- 两条 group-level edge 使用 G6 orthogonal polyline，并设置 bounded corner radius/offset；避免前后节点与 combo 中心不对齐时产生穿过盒子或相邻流程的斜线。
- sequential backbone 在 parallel group 之间使用 bounded multi-column serpentine grid，避免单列纵向布局浪费空间；同一行 sequence edge 使用 side-to-side anchor，换行使用 bottom-to-top orthogonal route。parallel member grid 仍作为独立 block；combo ingress/egress 固定 top/bottom anchor，child edge 保持侧向自动连接。
- backend graph DTO 继续保留精确 member-level fork/join facts，折叠只发生在 G6 visual data，避免把 UI 简化反向污染 graph semantics。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 工作台只在 local runtime package 的 dev namespace 中可见；只读取已有 facts、安全投影 payload 和安全日志；生产打包 composition 不注册该能力；正式 redaction、audit、metrics、trace 不变。 | local package route tests、negative route tests、separation tests、architecture review |
| 性能/容量 | Graph/detail 按查询派生；log evidence 有扫描/时间/条数/字节上限；safe projection payload 是 bounded fields，不写 raw。 | projection unit tests、log evidence limit tests、schema tests |
| 可靠性/恢复 | Workbench route/page/projection/log evidence 失败不影响主流程；safe projection payload 失败只导致工作台 partial/unavailable。 | non-interference tests、projection failure tests |
| 可维护性 | 工作台作为 app-composed dev extension，只拥有 route/page/API/projector；生产 channel/runtime/observability 边界不扩散。 | dependency-cruiser/architecture tests、code review |
| 可测试性 | Graph projector、effective view projector、log evidence reader 和 safe projection schema 都可用 fake stores/ports 做 deterministic tests。 | unit tests、route tests、integration tests |
| 审计/可追溯性 | 工作台不是审计事实；graph 使用 stable refs 导航 runtime/timeline/message/safe projection/log evidence。 | graph ref assertions、audit non-write tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| local runtime package 注册、生产打包不注册 | 1.1 | local package route tests、production packaging exclusion tests |
| dev API/page 使用独立 namespace 且不进入 `/api/v1` | 1.2, 1.3 | route registration tests |
| 不装配 raw decorators/dev buffer/system hook | 1.4, 5.1 | composition negative tests、architecture tests |
| 会话/对话/run Owner/Agent-scoped 只读查询 | 2.1, 2.2, 6.2 | scoped dev session query tests、negative isolation tests、no-mutation assertions |
| process graph projection-first 且处理缺失 facts | 2.3, 2.4, 4.1 | graph reconstruction tests |
| 模型节点展示 token usage，工具节点按 toolCallId 展示原始参数/结果 | 4.1a | action detail projection tests、browser smoke tests |
| 详情专用字段去重、Hook 点标签、exact-ref Agent 完整配置 | 4.1b | detail/browser tests、assembly ref mismatch negative tests |
| Prompt 近似视图和 Bash 命令预览只关联现有消息/registry facts | 4.1c | inspection projection tests、missing-ref/other-tool negative tests、browser smoke tests |
| selected-node effective view 不污染非模型节点；subagent 列表、节点、child 导航精确关联 | 4.1d | node-context tests、assembly/session merge tests、idempotency correlation negative tests、browser smoke tests |
| safe projection payload 补齐关键缺口 | 3.1-3.5, 4.6 | field source map、owner projection tests、schema tests、negative leakage tests |
| effective view 展示 Agent/prompt/context/capability/model 安全归因 | 2.5, 3.1-3.5, 4.1, 4.7 | effective view tests、current-view marking tests |
| log evidence 只读、bounded、不构建 graph、不改变日志 schema | 2.6, 4.8, 4.9 | log evidence route tests、negative parser tests、separation tests |
| projection 失败不影响主流程 | 4.5 | non-interference integration tests |
| raw 不进入正式 observability 或业务 store | 4.6, 4.9 | negative leakage/no-mutation tests |
| 生产兼容性 | 5.1a | production packaging exclusion tests、stream projection tests、route inventory tests |

## 兼容性影响（Compatibility Impact）

- `/api/v1`：无新增 API、无 DTO 变更、无 mutation 行为。
- User stream：不新增 event vocabulary；`MODEL_INVOCATION_*` event types 已存在，但新 run 的所有 run-bound 模型调用会多出这些 persisted events。`agent-channel-web` 不为工作台增加用户可见 projection，并必须保持安全、兼容、bounded。
- Production timeline/log/audit/metric/trace：所有 run-bound 模型调用通过统一 boundary 持久化 production-safe `MODEL_INVOCATION_*` timeline events，不改变 log/audit/metric/trace redaction 或 schema。
- Local runtime package timeline：与 production 对相同 run-bound 动作产生相同业务运行事实；旧 run 缺失时显示 partial/unavailable，不以 local-only payload 补齐。
- Gateway contract：不新增稳定 `agent-contracts/gateway` workbench query port；local dev read adapter 是 implementation-local，并接收 trusted Owner Scope 与 allowed Agent graph。
- `agent-contracts/runtime`：v1 不新增 shared timeline payload schema 或 dev DTO；若后续必须提升为 public contract，必须先做独立 contract refinement / 群内确认。

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/dev-agent-workbench/spec.md` 主承载 dev workbench local runtime package composition、read-only、projection-first graph、safe projection payload、effective view、log evidence 和 non-interference 行为。
- 架构和跨模块设计：`openspec/designs/architecture/observability.md` 承载 dev workbench 与正式 observability/logging surface 分离；`openspec/designs/architecture/runtime-boundaries.md` 承载 workbench 不拥有 runtime truth、不装配 raw decorator/system hook 的边界。
- 模块设计：`openspec/designs/modules/agent-app.md` 承载 local runtime package 装配 workbench、生产打包排除 workbench 的职责；`openspec/designs/modules/agent-channel-web.md` 承载 channel-web 不拥有 workbench route/page、不新增用户 stream projection 的边界；`openspec/designs/modules/agent-dev-workbench.md` 承载 dev route/projector/log reader/read adapter consumer 和自包含轻页。
- ADR：`openspec/designs/adr/dev-agent-workbench-projection-first-boundary.md` 记录 projection-first、minimal safe projection payload 和禁止 workbench raw capture 的取舍。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 `dev-agent-workbench` 导航。

## 风险与取舍（Risks / Trade-offs）

- [本地调测读取绕过 owner/agent scope] -> workbench 与普通 Agent Web 复用 trusted identity resolver，并在 SQL 层同时限制 Owner Scope 和 allowed Agent graph；生产打包 composition 完全不存在该 route。
- [现有 facts 不足导致视图不完整] -> 先判断 owning domain 是否独立缺失正式业务事实；是则由 owner 统一补齐，否或仍缺失时显示 partial/unavailable。
- [日志查看退化为 brittle log parser] -> log evidence 只读取安全日志片段并按 stable refs 过滤；禁止用日志文本构建 graph、detail 或 runtime truth。
- [safe projection 演变成 raw observability] -> schema tests 和 leakage negative tests 断言 forbidden raw content 不进入 structured log、audit、metrics、trace、timeline、session message、gateway record、checkpoint 或 memory。
- [历史 run 配置归因不可靠] -> 旧 run 只展示 reconstructed/current-view/partial/unavailable，不把当前配置伪装为历史真实配置。
- [dev workbench 页面质量与生产前端边界冲突] -> 页面限定为 `agent-dev-workbench` package-owned dev tooling artifact，可复用 `agent-web` 技术栈改善交互和图形化展示，但不进入 `frontend/agent-web`、`agent-channel-web`、生产前端 hosting 或 production package profile。
- [调测字段形成第二套运行事实] -> source/architecture tests 断言不存在 workbench enrichment flag 或 local-only timeline payload，并比较 local/production 对相同动作产生相同业务事实。

## 迁移计划（Migration Plan）

无数据迁移。启用后 local runtime package 注册工作台 route/page/API。旧会话只通过已有持久化事实和 safe projection payload 尽量回放。回滚方式是停止注册 dev workbench extension；不会留下 workbench 私有业务数据或 raw snapshot。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/dev-agent-workbench/spec.md`：同步 dev workbench 行为契约。
- `openspec/overview.md`：补充本地 Agent 开发调测体验与生产可观测分层背景。
- `openspec/designs/architecture/observability.md`：补充 dev workbench safe projection 与正式 observability separation。
- `openspec/designs/architecture/runtime-boundaries.md`：补充 workbench 不拥有 runtime truth、不装配 raw decorator/system hook。
- `openspec/designs/modules/agent-app.md`：补充 local runtime package 装配工作台、生产打包排除工作台的职责。
- `openspec/designs/modules/agent-channel-web.md`：补充 channel-web 不拥有 workbench route/page、不新增用户 stream projection 的边界。
- `openspec/designs/modules/agent-dev-workbench.md`：新增模块设计，承载 dev route/projector/log reader/read adapter consumer。
- `openspec/designs/adr/dev-agent-workbench-projection-first-boundary.md`：记录 projection-first、minimal safe projection payload 和禁止 workbench raw capture 的决策。
- `openspec/designs/spec-to-design-map.md`：新增导航。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-10.11-开发工作台` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/dev-agent-workbench/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
