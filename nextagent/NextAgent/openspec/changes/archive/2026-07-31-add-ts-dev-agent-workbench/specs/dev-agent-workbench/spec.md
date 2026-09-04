## ADDED Requirements

### Requirement: Local runtime package exposes an independent Agent Dev Workbench

系统 SHALL 通过现有 local runtime package 机制默认注册 Agent Dev Workbench 独立页面和 dev-only 查询接口。该能力 SHALL 由 local runtime package entrypoint/composition 确定，MUST NOT 从客户端请求、模型输出、capability 参数、持久化业务事实、环境变量或普通配置在生产打包中打开。生产打包 composition MUST NOT include the workbench route/page/API, local scoped read adapter, or page assets；工作台装配状态 MUST NOT 改变主路径业务运行事实。

Agent Dev Workbench SHALL 使用 dev namespace，例如 `/__nextagent/dev/workbench`，并 MUST NOT 复用最终用户对话页面、`/api/v1` 生产 Web API namespace 或用户可见 stream transport。Workbench page SHALL be owned by `agent-dev-workbench` as a dev tooling page. It MAY use the same frontend technology stack and UI/graph libraries as `frontend/agent-web`, including React, Vite, Ant Design, and G6, but MUST NOT introduce any user-facing `agent-web` route, product feature, `agent-channel-web` ownership, production frontend hosting artifact, production package dependency, or reusable long-lived browser UI state architecture.

Production packaging、release-test、packaged production runtime、remote/prod deployment 和任何非 local runtime package composition，MUST NOT 注册 Agent Dev Workbench 页面或 dev-only 查询接口。工作台是否装配 MUST NOT 改变主路径产生的业务运行事实。Workbench v1 MUST NOT 在 `agent-app` 中为调测目的装配 model/capability/gateway/policy/context 的横切 raw decorator、dev raw buffer 或系统 lifecycle hook。

#### Scenario: local runtime package exposes workbench
- **WHEN** app 使用 local runtime package 启动
- **THEN** `GET /__nextagent/dev/workbench` MUST 返回 Agent Dev Workbench 自包含页面
- **AND** dev-only 查询接口 MUST 可用
- **AND** 最终用户 `/api/v1` 对话接口和 stream transport 行为不因该页面存在而改变

#### Scenario: production package does not expose workbench
- **WHEN** app 使用 production package composition 启动
- **THEN** `GET /__nextagent/dev/workbench` MUST NOT 返回工作台页面
- **AND** workbench dev-only 查询接口 MUST NOT 被注册
- **AND** 新 run 的 canonical timeline MAY contain production-safe `MODEL_INVOCATION_*` events
- **AND** local 与 production composition 对相同 run-bound 动作 MUST 产生相同业务运行事实

#### Scenario: workbench does not add app-level capture wrappers
- **WHEN** local runtime package 启动 Agent Dev Workbench
- **THEN** 系统 MUST NOT 为工作台在 `agent-app` composition 中包裹 `ModelInvocationService`、`CapabilityInvocationPort`、gateway public ports、policy evaluator、context assembly 或 lifecycle hook invocation 的 raw capture decorator
- **AND** 系统 MUST NOT 注册仅用于工作台采集的系统 lifecycle hook

### Requirement: Workbench reuses the authenticated Owner Scope and trusted Agent graph

Agent Dev Workbench SHALL 提供本地开发库内会话、对话和 request/run 的只读查询视图。同端口工作台页面/API MUST 与普通 Agent Web 页面复用相同认证和 trusted identity resolver，并 MUST 将所有查询限制在当前 `tenantId`/`subjectId` 与 trusted hosted root Agent 可达的 subagent assembly graph 内。工作台 MUST NOT 跨 owner 或跨无关 Agent 浏览数据，并 SHALL 支持在授权范围内按 `agentId`、`sessionId` 和 `requestRunId` 过滤。开发者选中 run 后，`对话` 与 `日志` MUST 在服务端以该 `requestRunId` 为必需过滤条件；节点 refs 只能在该 run 内进一步缩小日志结果。

#### Scenario: developer switches the selected run
- **WHEN** 一个 session 包含多个 run，开发者选择其中一个 run
- **THEN** 对话查询 MUST 只返回与该 session 和 `requestRunId` 同时匹配的消息
- **AND** 日志查询 MUST 只返回与该 `requestRunId` 匹配的 bounded entries
- **AND** 前端高亮或客户端过滤 MUST NOT 代替服务端 scope/filter 校验

Workbench 查询 MUST NOT 通过该读面修改 session、message、timeline、request run、gateway record、audit、metric、trace、memory、checkpoint 或任何业务事实。

该 scoped read surface MUST 由 local runtime package 专用 implementation-local read adapter 提供。它 MUST NOT 进入生产 `/api/v1` Web API、用户 stream transport 或稳定 `agent-contracts/gateway` public contract。Owner Scope MUST 来自认证边界；allowed Agent ids MUST 来自可信 app composition。客户端参数、模型输出、capability 参数或持久化 metadata MUST NOT 覆盖二者。

当 workbench SQLite 只读查询失败时，系统 MUST 在保持 bounded unavailable 响应的同时写入一条 error-level runtime diagnostic log。日志 MUST 只包含固定事件名、低基数查询操作名和稳定 safe reason code；MUST NOT 包含数据库路径、SQL 文本、原始 SQLite error、owner/session/run 标识或查询参数。

#### Scenario: SQLite read failure remains diagnosable
- **WHEN** workbench SQLite 只读查询因 schema 缺失、database busy、文件无法打开或其他读取错误失败
- **THEN** 查询 MUST 返回 bounded unavailable 状态且不得改变业务事实
- **AND** 系统 MUST 写入一条安全结构化错误日志
- **AND** 日志 MUST NOT 泄漏路径、SQL、原始异常或高基数 scope/query 字段

#### Scenario: developer browses local conversations
- **WHEN** 开发者打开 Agent Dev Workbench 会话列表
- **THEN** 系统 MUST 返回本地开发库内可用会话
- **AND** 每个会话条目 MUST 提供可用于进入 conversation 和 request/run 视图的稳定引用
- **AND** 开发者能按 Agent 或 session 过滤列表

#### Scenario: another owner or unrelated Agent is denied
- **WHEN** 工作台请求引用其他 `tenantId`/`subjectId` 的 session/run，或引用不属于当前 trusted root Agent assembly graph 的 Agent
- **THEN** 查询 MUST 返回 404、空结果或等价 bounded unavailable 状态
- **AND** MUST NOT 泄漏目标事实是否存在

#### Scenario: current session deep link is owner scoped
- **WHEN** 工作台以 `sessionId` 深链接打开
- **THEN** 服务端 MUST 在可信 Owner Scope 下解析 persisted Session 的 `agentId`
- **AND** MUST 校验该 Agent 属于 allowed assembly graph 后才返回 conversation/run
- **AND** 客户端提供的 `agentId` MUST NOT 作为授权依据

#### Scenario: workbench read does not mutate stored facts
- **WHEN** 开发者查询会话、对话、request/run 列表、过程图、动作详情或日志证据
- **THEN** 系统 MUST NOT 写入或更新任何已有业务 store、观测 store 或运行时事实

### Requirement: Workbench reconstructs completed request processing from existing facts first

Agent Dev Workbench SHALL 为一次 request/run 生成 process graph。Graph reconstruction MUST be projection-first：系统 SHALL 优先从已有 session、message、request run、canonical timeline、agent execution trajectory、safe observation-derived projection、runtime diagnostic log correlation refs 和 structured safe log correlation refs 还原过程图。

Graph node vocabulary SHALL include the following action types：`request`、`scheduler`、`context`、`context_compaction`、`model`、`capability`、`hook`、`policy`、`gateway`、`stream`、`terminal`。Graph edge SHALL 表示动作顺序、调用关系或 parent/child 关系。每个 graph node SHALL 包含稳定 `actionId`、动作类型、状态、开始时间或缺失标记、结束时间或缺失标记、耗时或缺失标记、关联 refs 和 detail availability。`gateway` node v1 MUST NOT be synthesized from logs, generic persistence calls, context gateway calls, policy gateway calls, runtime gateway calls, workbench local reads, or a workbench-only summary contract；没有正式业务事实时 gateway coverage MUST 标记 unavailable。

Graph node 类型 SHOULD 包含或关联以下 effective-state 节点：`agent_snapshot`、`prompt_template`、`capability_context`、`model_effective_request`。如果实现选择不新增独立节点，则 `context` 和 `model` 节点详情 MUST 提供等价信息。

Workbench MUST NOT parse log text to construct graph nodes, infer runtime state, or reconstruct raw action details. Workbench MUST NOT synthesize graph nodes that cannot be supported by existing facts or explicitly defined safe projection payload.

#### Scenario: completed run has graph
- **WHEN** 开发者选择一个已完成 request/run
- **THEN** 系统 MUST 返回该 run 的 process graph
- **AND** graph MUST 包含 terminal outcome 节点
- **AND** 从已有 timeline、message、request run、trajectory、safe observation 或 safe projection payload 能还原的动作 MUST 以节点呈现

#### Scenario: every startup shape records model invocation events
- **WHEN** app 使用任意启动形态执行一次包含模型调用的 request/run
- **THEN** 系统 MUST 为每次模型尝试持久化已有 `MODEL_INVOCATION_STARTED` 以及 `MODEL_INVOCATION_COMPLETED` 或 `MODEL_INVOCATION_FAILED` timeline event
- **AND** event payload MUST be production-safe minimal payload
- **AND** payload validation failure MUST NOT alter model invocation, fallback, terminal outcome, or other timeline events

#### Scenario: historical run lacks supporting facts
- **WHEN** 开发者查看一个无法还原完整过程的历史 run
- **THEN** 系统 MUST 尽量从已有 facts 生成 graph
- **AND** 无法还原的节点、时间、输入、输出或 refs MUST 标记为 `unavailable` 或等价缺失状态
- **AND** 系统 MUST NOT 回写、补写或伪造缺失 facts

### Requirement: Workbench data gaps do not create diagnostic-only business facts

当现有 facts 无法支撑关键调测视图时，系统 MUST 先判断对应 owning domain 是否从生产运行、审计、恢复或故障诊断角度独立需要该事实。只有存在独立业务需要时，owner MAY 增加 schema-validated、production-safe 的正式运行事实；否则工作台 MUST 查询时派生或显示 partial/unavailable，不得增加调测专用字段。

实现补充字段前，系统 MUST 建立字段来源映射。能从 `RequestRunRecord`、`RunTimelineEventRecord` 顶层字段、event `createdAt`、event sequence、session message、task trajectory、existing safe observation、已有 registry stable ref 或事件对计算得到的信息 MUST NOT 被重复新增。系统 MUST NOT 为工作台新增 durable `DevWorkbench*Record`、raw snapshot record、process graph store 或 generic workbench fact table。系统 SHOULD NOT 为 `RequestRunRecord`、`SessionMessageRecord`、`TaskTrajectoryRecord` 或 `ActiveContextViewRecord` 增加 workbench-only 顶层字段。

工作台 MUST NOT 拥有或触发新增生产事实。字段只有在 owning domain 从生产运行、审计、恢复或故障诊断角度独立需要时，才可作为正式业务运行事实写入已有 `RunTimelineEventRecord.inlinePayload`，并使用 runtime-validated owner schema；不得以工作台展示为理由增加、复制或 local-only 持久化字段。能从已有 Record、event 顶层、事件配对、session message、run-bound AgentAssembly 或其他正式事实读取/计算的字段 MUST NOT 重复写入。仅有调测展示价值的缺口 MUST 在查询时派生，无法派生时 MUST 显示 `partial` 或 `unavailable`。

#### Scenario: workbench needs a field not present in existing facts
- **WHEN** 某个详情字段无法从已有正式事实读取或计算
- **THEN** implementation MUST first determine whether the owning domain independently needs that field for production execution, audit, recovery, or diagnosis
- **AND** if no independent business need exists, the workbench MUST show `partial` or `unavailable`
- **AND** the implementation MUST NOT add a workbench enrichment flag, local-only timeline payload, duplicate Record field, or private fact table

### Requirement: Run-bound model invocations use one runtime timeline boundary

Every model invocation belonging to a `RequestRun` SHALL pass through one run-bound model invocation boundary. The boundary SHALL call the provider-neutral `ModelInvocationService` owned by the model contract and SHALL publish canonical `MODEL_INVOCATION_STARTED` plus `MODEL_INVOCATION_COMPLETED` or `MODEL_INVOCATION_FAILED` through the runtime-owned timeline port. `agent-core`, workflow, context summary, and other run-bound callers MUST NOT independently duplicate this event lifecycle. `agent-model` SHALL normalize provider requests/results/errors but MUST NOT depend on or write the runtime timeline. Model calls outside a `RequestRun` MUST NOT fabricate run timeline events.

#### Scenario: a workflow or context summary invokes a model inside a run
- **WHEN** any run-bound caller invokes the model through the composed boundary
- **THEN** exactly one started event and one completed-or-failed event MUST be recorded for each model attempt
- **AND** event coordinates MUST come from the trusted runtime run/context
- **AND** local and production compositions MUST apply the same event rule

#### Scenario: a model call has no RequestRun
- **WHEN** a provider-neutral model service is used outside a RequestRun lifecycle
- **THEN** `agent-model` MUST NOT fabricate session, request, run, context, or timeline coordinates
- **AND** no canonical run timeline event SHALL be written for that call

Safe projection payload MUST NOT contain raw prompt, raw model output, raw tool args/result, provider raw body, credential, secret, token, attachment content, local path, or other production observability forbidden content. Safe projection payload SHOULD prefer stable refs, ids, reason codes, counts, usage, selected refs, template refs, capability ids, model/profile ids, tool names, redacted summaries, and bounded safe diagnostics. Generic status, timing, coordinates and graph edges SHOULD be read or computed from existing records/events rather than written again.

Safe projection payload schema MUST be owned by the package that owns the producing fact and exported only through that owner public surface. v1 MUST NOT add shared timeline payload schema or dev DTO to `agent-contracts/runtime`, and MUST NOT add a capability gateway summary public contract without an actual business producer. Producer-side schema validation MUST be best-effort: validation, serialization, size-limit, or projection failures MUST drop the optional payload or mark it unavailable and MUST NOT fail the underlying runtime action.

允许补充的投影信息限定为下列最小集合，且只有在字段来源映射证明现有 facts 不足时才补：
- request/planning：`agentAssemblyHash` 或 `agentAssemblySnapshotRef` 仅在 `agentAssemblyRef` 不能历史稳定解析时补；`laneKind`、`queueDepthBucket`、`schedulerDecisionCode` 仅在 scheduler owner 已有该决策且无法查询时补。
- model invocation start：`stepId`、`modelProfileId`、`providerKind`、`modelName`、`promptTemplateRef`、`promptTemplateVersion`、`selectedMessageRefs`、`disclosedCapabilityIds`、`modelMessageCount`、`modelOptionSummary`、`providerOptionKeys`。其中 disclosure ids 和 message count MUST 从最终 `ModelInvocationRequest` 计算；budget/compression/degradation 继续由对应 context lifecycle event 表达，并携带同一 `stepId`，不得复制到模型事件。
- model completion/failure：`finishReason`、`usage`、`toolCallCount`、`safeErrorCode`、`safeErrorCategory`；`outputSizeBucket` 只有无法从 persisted message 计算且 owner 已有安全值时才补。
- capability start/completion：保留既有 lifecycle fields；`CAPABILITY_STARTED` 仅补 `stepId`，多调用批次补实际 `toolBatchExecutionMode`、`toolBatchOrdinal`、`toolBatchSize`。descriptor、参数和结果详情 MUST 从 exact run-bound catalog/assembly 与 persisted tool-use/result messages 派生，不得重复写入 timeline。
- policy：`policyId`、`policyVersion`、`policyDomain`、`policyPoint`，现有 operation/outcome/reason/risk fields 不得重复。
- context compaction：`strategyCode`、token estimate buckets、`retainedMessageCount`、`droppedMessageCount`、`summaryMessageId`、`reasonCode`，前提是不能从 compaction commit/message facts 读取。
- gateway：v1 不新增 generic gateway event 或 speculative capability gateway summary public contract。缺失正式业务事实时 MUST 标记 partial/unavailable；log 只能作为 evidence，不能构建 graph truth。

#### Scenario: gateway detail has no formal business fact
- **WHEN** workbench cannot obtain gateway detail from an existing formal business fact
- **THEN** gateway coverage MUST be marked partial or unavailable
- **AND** workbench MUST NOT add a capability payload contract or parse structured log text to discover gateway nodes

#### Scenario: implementation adds missing safe projection field
- **WHEN** process graph 或 action detail 需要现有 facts 没有的调测信息
- **THEN** 实现 MUST 先证明该字段不能从已有 facts 读取或计算
- **AND** 新增信息 MUST 由该事实的 owner package 产生和命名
- **AND** 新增信息 MUST 通过 schema validation
- **AND** 新增信息 MUST NOT 包含 raw prompt、raw model output、raw tool args/result、credential、secret、token、attachment content 或 path

#### Scenario: field can be computed from existing facts
- **WHEN** graph node timing、status、refs、edge 顺序、agent/run/session/request 坐标或 terminal outcome 能从已有 record、event 顶层字段或事件对计算
- **THEN** 系统 MUST 在 workbench projector 中计算该字段
- **AND** 系统 MUST NOT 为该字段新增 safe projection payload、durable record 字段或 workbench 私有事实

#### Scenario: raw detail is unavailable
- **WHEN** 某动作只有 safe projection，没有 raw input/output
- **THEN** 工作台 MUST 显示 safe projection detail 和 `rawUnavailable` 或等价状态
- **AND** 系统 MUST NOT 通过 app-level decorator、系统 hook、日志解析或业务事实回写来补齐 raw

### Requirement: Workbench exposes a reconstructed run effective view

Agent Dev Workbench SHALL expose a reconstructed effective view for each request/run when supporting facts are available. The view SHALL describe what configuration and inputs shaped the run, including Agent identity/version/assembly reference, Agent assembly summary refs, model profile selection, prompt template ref, context selection/budget/compression evidence, capability binding/disclosure summary, rendered model tool names/count, and final model invocation safe parameters. Runtime settings summary and workspace policy summary are optional v1 details shown only when historically resolvable from stable assembly refs.

The effective view MUST be derived from trusted app composition, accepted request/run facts, persisted session/request facts, context safe projection payload, capability catalog/disclosure safe projection payload, model invocation safe projection payload, and stable refs. Runtime settings summary and workspace policy summary SHALL be derived from `agentAssemblyRef` when it is historically resolvable; otherwise they MUST be marked `partial`, `current-view`, or `unavailable` and MUST NOT become first-wave workbench payload fields. The effective view MUST NOT be reconstructed from client request body values, model output, raw logs, log text, or mutable current defaults when run-specific facts exist.

When the local assembly registry can resolve the run's exact `agentId`, `agentVersion`, and `agentAssemblyRef`, the effective view SHALL expose the complete compiled `AgentAssembly` configuration, including identity metadata, model profile ids, capability bindings, runtime settings, workspace policy, routing, hooks, and policies that are present in that assembly. The workbench MUST require all three coordinates to match. A missing assembly or mismatched assembly ref MUST be reported as unavailable and MUST NOT fall back to the active or current Agent configuration. Credential values and provider-resolved secrets are not part of `AgentAssembly` and MUST NOT be added to this view.

For historical runs without sufficient run-specific facts, the workbench MAY show a best-effort reconstructed or current-registry view, but it MUST clearly mark that view as `reconstructed`, `current-view`, `partial`, `unavailable`, or an equivalent non-authoritative status.

#### Scenario: run exposes effective view from safe facts
- **WHEN** 开发者查看已完成 request/run 且相关 safe projection payload 存在
- **THEN** 开发者 MUST 能查看该 run 的 Agent identity/version/assembly reference、assembly summary refs、model profile/selection、prompt template ref、context selection evidence、visible capability ids、rendered model tool names/count 和 final model invocation safe parameters
- **AND** runtime settings summary 和 workspace policy summary MUST be shown only when derivable from historically stable assembly refs, otherwise marked partial/current-view/unavailable
- **AND** 这些信息 MUST 关联到 process graph 中的 effective-state 节点或对应 `context`/`model` 节点详情

#### Scenario: historical run only has partial effective view
- **WHEN** 开发者查看缺少 run-specific projection payload 的历史 run
- **THEN** 工作台 MAY 根据已有持久化事实和当前 registry 展示 best-effort 配置视图
- **AND** 该视图 MUST 标记为非历史权威或 partial
- **AND** 系统 MUST NOT 将当前配置伪装为该历史 run 当时实际生效的配置

#### Scenario: run exposes its exact Agent assembly configuration
- **WHEN** local assembly registry can resolve the run's `agentId` and `agentVersion`
- **AND** the resolved assembly ref exactly equals the persisted `agentAssemblyRef`
- **THEN** 生效视图 MUST 展示该 compiled `AgentAssembly` 的完整非密钥配置
- **AND** capability bindings MUST be usable to classify bound Tool、Skill 和 Agent capabilities
- **AND** assembly 不存在或 ref 不匹配时 MUST 显示配置不可用，且不得回退到 active/current Agent 配置

### Requirement: Workbench action details expose safe detail availability

Agent Dev Workbench SHALL provide action detail for graph nodes. Action detail SHALL be read from existing facts and safe projection payload, and SHALL include available input/output summaries, status, error code, timing, refs, usage, counts, selected refs, capability ids, model/profile ids, prompt template refs, and detail availability.

If raw content already exists in an existing authorized local development fact, such as persisted messages that the developer can already inspect, the workbench MAY link to or display that content according to the fact owner's existing contract. Workbench MUST NOT create a new raw capture path solely to provide action details.

Model invocation detail SHALL display `inputTokens`, `outputTokens`, and `totalTokens` when `MODEL_INVOCATION_COMPLETED.usage` contains them. When the provider does not return usage, the detail SHALL explicitly mark token usage unavailable instead of omitting the section or inventing an estimate.

Capability detail SHALL use the node's `toolCallId` to correlate existing persisted `ASSISTANT_TOOL_USE` and `CAPABILITY_RESULT` messages. When those authorized local facts exist, the detail SHALL display that tool call's original arguments and result. It MUST NOT mix arguments or results from another tool call in the same run, and MUST NOT add a new raw timeline payload, log field, decorator, buffer, or durable store for this purpose.

Model detail SHALL present the capabilities actually disclosed to that model invocation as separately classified `工具`, `Skill`, and `Agent` capability ids. Classification MUST join the invocation disclosure ids with the exact run-bound `AgentAssembly.capabilityBindings` by capability id and use `capabilityType`; it MUST NOT depend on whether a capability was invoked, infer Skill from “not a tool”, or include assembly bindings not disclosed to that invocation. Missing assembly, ref mismatch, or unclassifiable disclosure MUST be shown as partial/unavailable. The detail SHALL NOT repeat disclosure ids, rendered tool names, or model usage in the generic safe projection section when those facts already have dedicated detail sections. The overview SHALL omit generic detail availability. For `HOOK_INVOKED`, the graph node SHALL present the lifecycle hook point (`stage`) while `hookId` and invocation metadata remain in action detail.

The effective view SHALL distinguish run-wide Agent configuration from selected-node execution facts. Run Agent identity, version, assembly ref, and exact compiled configuration MAY remain visible for every selected node because they govern the entire run. Model profiles, prompt templates, selected messages, rendered tools, model options, and token usage SHALL be presented as selected-node context only for model nodes. Non-model nodes MUST NOT present the run's aggregate model/prompt facts as if they were facts of the selected action.

Model detail SHALL provide a clearly labelled Prompt approximation assembled at query time from the model node's existing `promptTemplateRef`, persisted selected messages referenced by `selectedMessageRefs`, and capabilities classified from `disclosedCapabilityIds`. The workbench MAY resolve the exact referenced template from the local prompt registry for the run's `agentId` and `agentVersion`, but MUST NOT present the approximation as the provider's final request. It SHALL expose missing refs and explicit limitations for dynamic template values, capability-generated messages, attachments, complete tool schemas, render-time transforms, and `BEFORE_MODEL_INVOKE` hook mutations that cannot be replayed from existing facts. It MUST NOT re-run context assembly or prompt rendering, modify the business invocation path, or add raw prompt capture, workbench-only timeline payload, log fields, buffers, or durable stores.

`RenderedModelInput` MUST NOT carry a parallel safe/debug projection of `ContextAssembly`. `promptTemplateRef`、`promptTemplateVersion` and `selectedMessageRefs` SHALL flow directly from the current `ContextAssembly` into the run-bound invocation fact author; `disclosedCapabilityIds` and `modelMessageCount` SHALL be computed from the final provider-neutral model request. The workbench MUST derive tool names and capability classification from these ids plus the exact run-bound catalog/assembly rather than persist `renderedToolNames` or `visibleCapabilityIds` aliases.

For a Bash capability node, the process graph SHALL display a bounded single-line command preview when the command can be correlated from the existing persisted `ASSISTANT_TOOL_USE` message by the node's `toolCallId`. The full original command SHALL remain available in the capability detail arguments. The preview MUST NOT use another tool call as fallback and MUST NOT add the command to timeline, logs, or a new durable fact.

The workbench SHALL list compiled top-level Agents and invoked Agents even when they have no persisted session. For developer-facing classification, a compiled Agent SHALL be presented as a subagent when it is parent-scoped (`agentInvocation="PARENT"` or has `parentAgentScope`) or when it is invocation-only (`userInvocable=false` and `agentInvocation="BOUND"`). Agent entries SHALL preserve the exact invocation policy and identify Agent/subagent kind, version, assembly ref, source, parent Agent scope when one exists, session count, and complete non-secret compiled configuration when available. Persisted sessions for an Agent no longer present in the current compiled list MAY appear as historical Agent entries and SHALL be marked as such.

An `AGENT` capability invocation in a parent run SHALL be projected as a dedicated subagent graph node rather than a generic tool node. Its detail SHALL show the target Agent, delegated prompt, result, and exact child Session/Run refs when existing facts permit correlation. Child correlation SHALL use the capability invocation idempotency key derived from the parent `runId` and `toolCallId` against the persisted child Session, then validate the child run's parent refs. The workbench MUST NOT infer a child run by temporal proximity or attach another subagent invocation's child refs. Developers SHALL be able to navigate from the parent subagent node to the child Agent session/run and inspect that child run normally.

#### Scenario: action has safe detail
- **WHEN** 开发者点击 graph node
- **THEN** 系统 MUST 返回该 action 的 safe detail、timing、status、refs 和 detail availability
- **AND** raw 不存在时 MUST 明确显示 unavailable，而不是显示空白或伪造内容

#### Scenario: model action displays token usage
- **WHEN** 开发者点击带有 `MODEL_INVOCATION_COMPLETED.usage` 的模型调用节点
- **THEN** 节点详情 MUST 分别显示输入 Token、输出 Token 和总 Token
- **AND** provider 未返回 usage 时 MUST 明确显示 Token 用量不可用

#### Scenario: capability action displays its arguments and result
- **WHEN** 开发者点击带有 `toolCallId` 且存在对应 persisted tool-use/result messages 的 capability 节点
- **THEN** 节点详情 MUST 显示该 `toolCallId` 对应的原始参数和结果
- **AND** MUST NOT 显示同一 run 中其他 capability invocation 的参数或结果
- **AND** MUST NOT 为此新增 raw capture 或 raw durable fact

#### Scenario: dedicated action details do not repeat generic projection fields
- **WHEN** 开发者查看模型调用节点
- **THEN** 工具、Skill、Agent 和 Token 消耗 MUST 各自在专用详情中展示
- **AND** generic safe projection section MUST NOT repeat usage、visible capability ids 或 rendered tool names
- **AND** 概览 MUST NOT 显示 generic availability

#### Scenario: effective view follows the selected node
- **WHEN** 开发者在同一 run 中依次选择 request、hook、capability 和 model 节点
- **THEN** run Agent identity、assembly ref 和完整 Agent 配置 MAY 在所有节点下保持可见
- **AND** model profile、Prompt、selected messages、rendered tools、model options 和 Token facts MUST 只在 model 节点上下文显示
- **AND** 非模型节点 MUST NOT 把 run 聚合的模型事实显示成当前 action 的事实

#### Scenario: model action displays a bounded Prompt approximation
- **WHEN** 开发者查看带有 prompt template ref 和 selected message refs 的模型调用节点
- **THEN** 节点详情 MUST 分区显示可解析的模板、按引用顺序关联的持久化消息和渲染工具名
- **AND** MUST 明确标记该视图为 Prompt 近似视图而非 provider 最终请求
- **AND** MUST 列出缺失消息引用以及无法从现有事实重放的动态变量、能力生成消息、附件、完整工具 schema、渲染时变换和 hook 修改
- **AND** MUST NOT 重新执行 context/prompt 业务逻辑或新增 raw prompt capture

#### Scenario: Bash graph node displays its command preview
- **WHEN** process graph contains a Bash capability node with a correlated persisted tool-use message
- **THEN** 节点 MUST 显示该 `toolCallId` 对应命令的 bounded single-line preview
- **AND** 节点详情 MUST 继续显示完整原始 command 参数
- **AND** MUST NOT 显示同一 run 中其他工具调用的命令

#### Scenario: Agent list includes a subagent without sessions
- **WHEN** compiled assembly registry contains a parent-scoped subagent that has no persisted session
- **THEN** Agent 列表 MUST 仍显示该 subagent 及其 parent Agent scope、invocation policy 和完整非密钥配置
- **AND** 该 subagent 的 session count MUST 为 0

#### Scenario: Agent list identifies an invocation-only bound Agent
- **WHEN** compiled assembly registry contains an Agent with `userInvocable=false` and `agentInvocation="BOUND"`
- **THEN** Agent 列表 MUST 将其标记为 Subagent，并保留 `BOUND` invocation policy
- **AND** MUST NOT 伪造 `parentAgentScope`，因为其可调用父范围仍由显式 Agent binding 和 Catalog governance 决定

#### Scenario: parent run displays and opens a subagent invocation
- **WHEN** parent run contains an `AGENT` capability invocation and its child Session/Run exists
- **THEN** process graph MUST 显示专用 subagent 节点及目标 Agent
- **AND** 节点详情 MUST 显示 delegated prompt、result、child Session/Run refs
- **AND** 开发者 MUST 能从该节点进入 child Agent 的 Session/Run 并查看其处理过程

#### Scenario: subagent child refs cannot be correlated exactly
- **WHEN** derived invocation idempotency key 找不到唯一 child Session 或 child run parent refs 不匹配
- **THEN** 节点详情 MUST 标记 child link unavailable
- **AND** MUST NOT 按时间邻近、Agent id 或同一 parent run 的其他 child session 猜测关联

#### Scenario: hook graph node presents lifecycle point
- **WHEN** process graph contains a `HOOK_INVOKED` node
- **THEN** 节点主标签 MUST 呈现该 hook 的 lifecycle `stage`
- **AND** `hookId`、hook invocation id、kind、strategy、outcome 和 effects MUST 在节点详情中展示

#### Scenario: action detail projection fails
- **WHEN** 工作台动作详情查询发生序列化失败、payload 过大或 projection failure
- **THEN** 查询 MUST 返回 bounded dev diagnostic 或 `truncated` / `unavailable` 状态
- **AND** 系统 MUST NOT 修改任何运行时、持久化或观测事实

### Requirement: Workbench exposes bounded log evidence for request/run debugging

Agent Dev Workbench SHALL expose a dev-only log evidence view for request/run debugging in local runtime package. The view SHALL return bounded excerpts from existing runtime diagnostic log and structured safe log sources when those sources are available, filtered by stable refs such as `requestRunId`, `requestId`, `sessionId`, `agentId`, `agentVersion`, `requestContextId`, `capabilityInvocationId`, and a bounded time window.

Log evidence SHALL be auxiliary debugging evidence only. The workbench MUST NOT parse log text to construct process graph nodes, infer runtime state, reconstruct raw action details, or treat log offset/file path as a business identifier. Process graph and action detail truth MUST continue to come from persisted runtime facts, safe observation-derived projections, safe projection payload, and existing authorized local development facts.

Log evidence MUST preserve the existing production logging and redaction contract. The workbench MUST NOT force structured log, runtime diagnostic log, audit, metric, trace, timeline, session message, gateway record, checkpoint, or memory to carry raw prompt, raw model output, raw tool args/result, provider raw body, credential, secret, token, attachment content, or path values for the purpose of log display.

The log evidence view SHALL be read-only, non-realtime, bounded by count/byte/time-window limits, and unavailable in production package composition. Missing, rotated, inaccessible, oversized, or unparsable log sources MUST be reported as `unavailable`, `truncated`, or bounded dev diagnostics without affecting request execution.

#### Scenario: developer views log evidence for a completed run
- **WHEN** 开发者在 local runtime package 下查看 completed request/run 的日志证据
- **THEN** 系统 MUST 返回与该 run 关联的 bounded safe log excerpts 或明确的 unavailable 状态
- **AND** 日志条目 MUST 使用 stable refs 与 run、graph node 或 action detail 关联
- **AND** 系统 MUST NOT 通过日志文本生成新的 process graph 节点

#### Scenario: log evidence is unavailable or too large
- **WHEN** 关联日志文件缺失、日志源不可访问、日志已轮转或匹配结果超过上限
- **THEN** 工作台 MUST 返回 `unavailable`、`truncated` 或 bounded diagnostic
- **AND** 系统 MUST NOT 修改任何运行时、持久化或观测事实

#### Scenario: production package does not expose log evidence
- **WHEN** app 使用 production package composition 启动
- **THEN** log evidence API MUST NOT 被注册
- **AND** 生产日志 schema、redaction 和写入行为 MUST NOT 因工作台存在而改变

### Requirement: Workbench is non-realtime and read-only

Agent Dev Workbench SHALL NOT 订阅 request stream、SSE 或 WebSocket 来实时展示活动中对话。运行中的 request/run 可以显示为 running 或 unavailable for process detail；完整 process graph 只要求在终态后可查询。

Workbench MUST NOT 提供 retry、edit、cancel、replay、resume、fork、answer pending input、修改 Agent 配置、修改 capability binding、执行 capability 或任何改变运行时状态的操作。

#### Scenario: running request is not streamed
- **WHEN** 开发者查看仍在运行的 request/run
- **THEN** 工作台 MUST NOT 打开用户 stream transport 来实时追踪该 run
- **AND** 系统 MAY 显示 running 状态和已有只读摘要
- **AND** 完整 process graph MUST 只在终态后要求可用

#### Scenario: workbench exposes no mutation commands
- **WHEN** 开发者查看会话、对话、graph、动作详情或日志证据
- **THEN** 页面和 dev-only 查询接口 MUST NOT 暴露任何改变 request、session、Agent、capability、gateway 或 runtime state 的命令

### Requirement: Local frontend receives a workbench-owned current-session launcher

local with-frontend composition SHALL 在装配 Agent Dev Workbench 时通过通用 frontend hosting contribution 注入 workbench-owned launcher script。launcher SHALL 以独立 custom element 或等价隔离机制呈现悬浮按钮，不得成为 `frontend/agent-web` route、component、state 或 bundle dependency。按钮 SHALL 默认半透明，在 hover、keyboard focus 和拖动时恢复完全不透明并提供明确视觉反馈；按钮 SHALL 使用 Pointer Events 支持 viewport 内拖动，并区分点击与超过小幅阈值的拖动，拖动结束不得误触发跳转。位置只在当前页面生命周期内保留，不得写入业务配置或持久化。未装配 workbench 时，普通页面 MUST NOT 包含该 script、按钮或链接。

#### Scenario: developer moves the launcher
- **WHEN** 开发者拖动悬浮入口超过移动阈值
- **THEN** launcher MUST follow the pointer and remain within the viewport
- **AND** releasing the pointer MUST NOT navigate to the workbench
- **AND** hover、focus 和 dragging states MUST be visually distinct from the default semi-transparent state

launcher SHALL 从普通页面现有 `#/session/:sessionId` 路由读取当前 session，并跳转到 `/__nextagent/dev/workbench?sessionId=<id>`。工作台 SHALL 在授权 session 列表中选择该 session；session 参数不得覆盖 Owner Scope 或 Agent Scope。

#### Scenario: local developer opens the current session in workbench
- **WHEN** local with-frontend 页面当前路由为 `#/session/:sessionId`
- **AND** workbench extension 已装配
- **THEN** 页面 MUST 显示 workbench-owned 悬浮入口
- **AND** 点击后 MUST 打开同一 `sessionId` 的工作台视图

#### Scenario: workbench is absent
- **WHEN** frontend composition 未装配 workbench extension
- **THEN** hosted HTML MUST NOT 注入 workbench launcher script
- **AND** 普通页面 MUST NOT 显示 workbench 按钮或链接

### Requirement: Workbench uses four non-duplicated context tabs

Workbench 右侧上下文区域 SHALL 只显示 `对话`、`详情`、`运行配置`、`日志` 四个页签。当前 Agent identity MAY 在 selector 或 breadcrumb 展示；独立 `Agent` 页签 MUST NOT 存在。完整 compiled Agent configuration SHALL 只在 run-bound `运行配置` 页签展示，不得形成第二套配置视图。

#### Scenario: developer inspects run context
- **WHEN** the developer opens the workbench context area
- **THEN** exactly the four tabs `对话`、`详情`、`运行配置`、`日志` SHALL be displayed
- **AND** an independent `Agent` tab MUST NOT be displayed

### Requirement: Workbench run summaries and graph interactions remain stable

Each run list entry SHALL derive its message summary from that run's persisted root request message, independent of which run is currently selected. Capability graph projection SHALL correlate lifecycle events by `toolCallId`; one logical tool or Agent capability invocation MUST produce one graph node even when events are interleaved, repeated, or include deltas. Selecting a graph node MUST preserve the developer's current canvas zoom and pan; only explicit fit action, run change, or initial graph load MAY fit the canvas.

The capability owner SHALL record the actual same-round Tool batch execution mode as a production-safe runtime trajectory fact after preparation and serialization policy evaluation. A multi-call batch SHALL carry its `toolBatchExecutionMode` (`PARALLEL` or `SERIAL`), `toolBatchOrdinal`, and `toolBatchSize` on `CAPABILITY_STARTED`; these fields describe production execution and MUST NOT depend on workbench assembly. The workbench SHALL project `PARALLEL` members as one fork/join group and SHALL keep `SERIAL` members on the sequence path. It MUST NOT infer parallel execution from timestamps, event ordering, logs, or shared `stepId` alone.

Parallel groups SHALL be visually separated from the sequential backbone. Members of one batch SHALL use a bounded multi-row sibling grid when they do not fit on one row; the following sequential action SHALL be placed after the complete batch block. External edges SHALL terminate on the parallel group boundary, MUST NOT pass through member nodes, and SHOULD minimize crossings. Node labels and status text MUST remain unobscured at the initial fitted viewport.

The sequential backbone SHALL use a bounded compact serpentine grid between parallel groups rather than forcing every action into one vertical column. Same-row sequence edges SHALL use side anchors; row transitions SHALL use orthogonal routes. Parallel group ingress SHALL terminate at the top-center boundary anchor and egress SHALL originate at the bottom-center boundary anchor; group-level flow MUST NOT attach to the left or right boundary.

Every parallel batch SHALL have an explicit visual group boundary and a visible `并行执行 · N` label derived from its batch size. Each member SHALL show its `并行 ordinal/size` position. Wrapped rows MUST remain sibling members. External flow SHALL connect once to the parallel group boundary and once from the group boundary to the following action using orthogonal routes; member-level fork/join lines SHALL NOT be rendered inside the group because they add no execution-order semantics and may imply relationships between siblings. Group-level routes MUST NOT use diagonal segments that cross the group or adjacent flow.

#### Scenario: session contains multiple runs
- **WHEN** the workbench lists multiple runs for one session
- **THEN** every run SHALL show its own persisted root message summary
- **AND** selecting one run MUST NOT cause other run summaries to become unavailable

#### Scenario: capability events are interleaved
- **WHEN** started/completed/failed/delta events for multiple tool calls are interleaved
- **THEN** events MUST be paired and deduplicated by `toolCallId`
- **AND** each logical tool call MUST produce exactly one capability or subagent node

#### Scenario: developer selects a zoomed graph node
- **WHEN** the developer has zoomed or panned the graph and clicks a node
- **THEN** the detail selection SHALL change without resetting zoom or pan

#### Scenario: model returns multiple parallel tool calls
- **WHEN** one model result produces multiple ordinary Tool calls and runtime selects parallel execution
- **THEN** every Tool call SHALL emit the same batch size and `PARALLEL` execution mode with a unique ordinal
- **AND** the process graph SHALL render the Tool calls as sibling branches between the preceding and following sequential actions

#### Scenario: parallel batch exceeds one visual row
- **WHEN** a parallel batch contains more members than fit in the available graph width
- **THEN** the workbench SHALL wrap the members into additional sibling rows without placing nodes outside the canvas
- **AND** the join target SHALL be positioned after the final sibling row
- **AND** fork/join edges MUST NOT obscure node labels or status text

#### Scenario: developer distinguishes wrapped parallel members from a serial chain
- **WHEN** one parallel batch is rendered across multiple rows
- **THEN** one labelled visual boundary SHALL contain every member of that batch
- **AND** every member SHALL display its parallel ordinal and batch size
- **AND** the preceding and following actions SHALL connect to the group boundary rather than to individual members
- **AND** no edge SHALL visually connect one parallel member as the predecessor of another member

#### Scenario: same-round tools require serialization
- **WHEN** one model result produces multiple Tool calls but request-local effects require serialization
- **THEN** the capability events SHALL record `SERIAL`
- **AND** the process graph SHALL retain their execution order instead of presenting a parallel group

### Requirement: Workbench can navigate both directions

When an Agent capability invocation can be correlated to a child Session and RequestRun using the canonical parent invocation key and persisted parent refs, the workbench SHALL expose an explicit drill-down action to that child run. Child RequestRun validation SHALL require matching child session, target Agent, `parentRunId`, and `parentRequestId`; it MUST NOT require the child RequestRun's own idempotency key to equal the parent capability invocation key. The workbench SHALL also expose an explicit same-origin action that returns to the normal Agent Web page for the currently selected session.

#### Scenario: developer drills into a subagent
- **WHEN** one child Session matches the canonical parent invocation key and one child run matches persisted parent refs
- **THEN** the parent Agent node detail MUST expose an action that opens the child session/run

#### Scenario: developer returns to normal Agent Web
- **WHEN** a session is selected in the workbench
- **THEN** the page MUST expose a return action to `/#/session/:sessionId`
- **AND** the action MUST preserve same-origin authentication

#### Scenario: developer inspects workbench tabs
- **WHEN** 工作台页面完成渲染
- **THEN** `对话`、`详情`、`运行配置`、`日志` MUST 完整可见
- **AND** 独立 `Agent` 页签 MUST NOT 存在
- **AND** 完整 Agent configuration MUST NOT 在多个页签重复展示

### Requirement: Workbench projection failures do not affect normal execution

Agent Dev Workbench route registration、page/API handler、graph projection、effective view projection、action detail projection 和 log evidence projection 的失败 MUST NOT 改变 request acceptance、scheduler、context assembly、model invocation、capability invocation、gateway call、policy decision、hook execution、stream projection、terminal commit、recovery 或 persistence 的业务 outcome。正式业务运行事实的 producer 失败继续遵循 owning domain 既有 failure policy，不得建立 workbench-specific failure path。

当 workbench projection、safe projection serialization、log evidence query 或 page rendering 失败时，系统 SHALL 在 workbench 内显示 bounded diagnostic 或缺失状态；正式 observability、audit、metrics、trace、runtime truth 和业务持久化 MUST 继续遵守各自既有契约。

#### Scenario: supporting projection fails
- **WHEN** 正式运行事实的可选 payload production 或 workbench projection 失败
- **THEN** 当前 request/run MUST 继续按原业务路径执行
- **AND** terminal outcome MUST NOT 因工作台投影失败而改变
- **AND** 工作台中对应详情 MUST 显示缺失或投影失败状态

#### Scenario: projection does not leak raw content
- **WHEN** 工作台生成 graph、effective view、action detail 或 log evidence
- **THEN** raw prompt、raw model output、raw tool args/result、provider raw body、credential、secret、token、attachment content 和 path MUST NOT 被新增写入 structured log、audit、metrics、trace、canonical timeline、session message、gateway record、checkpoint 或 memory
