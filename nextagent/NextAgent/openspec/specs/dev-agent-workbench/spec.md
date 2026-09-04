# dev-agent-workbench Specification

## Purpose
定义本地运行时中独立 Agent 开发工作台的可启动入口、诊断能力和用户边界，使开发者可在受控本地环境中运行和检查 Agent。

## Function

- **所属 Function**：`FN-10.11 开发工作台`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## Requirements
### Requirement: Local runtime package exposes an independent Agent Dev Workbench

系统 SHALL 在 local runtime 中默认提供 Agent Dev Workbench 独立页面和 dev-only 查询接口。客户端请求、模型输出、capability 参数、持久化业务事实、环境变量或普通配置 MUST NOT 在生产运行形态中打开该能力。工作台是否可用 MUST NOT 改变主路径业务运行事实。

Agent Dev Workbench SHALL 使用独立 dev namespace，例如 `/__nextagent/dev/workbench`，并 MUST NOT 复用最终用户对话页面、`/api/v1` 生产 Web API namespace 或用户可见 stream transport。工作台 MUST NOT 引入面向最终用户的路由或产品能力，也 MUST NOT 出现在生产运行产物中。

Production packaging、release-test、packaged production runtime、remote/prod deployment 和任何非 local runtime 形态，MUST NOT 暴露 Agent Dev Workbench 页面或 dev-only 查询接口。工作台 MUST NOT 为调测目的增加 raw capture、调测专用缓冲区或改变主路径行为的钩子。

#### Scenario: local runtime package exposes workbench
- **WHEN** app 使用 local runtime package 启动
- **THEN** `GET /__nextagent/dev/workbench` MUST 返回 Agent Dev Workbench 自包含页面
- **AND** dev-only 查询接口 MUST 可用
- **AND** 最终用户 `/api/v1` 对话接口和 stream transport 行为不因该页面存在而改变

#### Scenario: production package does not expose workbench
- **WHEN** app 使用 production runtime 形态启动
- **THEN** `GET /__nextagent/dev/workbench` MUST NOT 返回工作台页面
- **AND** workbench dev-only 查询接口 MUST NOT 被注册
- **AND** 新 run 的 canonical timeline MAY contain production-safe `MODEL_INVOCATION_*` events
- **AND** local 与 production 运行形态对相同 run-bound 动作 MUST 产生相同业务运行事实

### Requirement: Workbench reuses the authenticated Owner Scope and trusted Agent graph

Agent Dev Workbench SHALL 提供本地开发库内会话、对话和 request/run 的只读查询视图。同端口工作台页面/API MUST 与普通 Agent Web 页面复用相同认证和 trusted identity resolver，并 MUST 将所有查询限制在当前 `tenantId`/`subjectId` 与 trusted hosted root Agent 可达的 subagent assembly graph 内。工作台 MUST NOT 跨 owner 或跨无关 Agent 浏览数据，并 SHALL 支持在授权范围内按 `agentId`、`sessionId` 和 `requestRunId` 过滤。开发者选中 run 后，`对话` 与 `日志` MUST 在服务端以该 `requestRunId` 为必需过滤条件；节点 refs 只能在该 run 内进一步缩小日志结果。

#### Scenario: developer switches the selected run
- **WHEN** 一个 session 包含多个 run，开发者选择其中一个 run
- **THEN** 对话查询 MUST 只返回与该 session 和 `requestRunId` 同时匹配的消息
- **AND** 日志查询 MUST 只返回与该 `requestRunId` 匹配的 bounded entries
- **AND** 前端高亮或客户端过滤 MUST NOT 代替服务端 scope/filter 校验

Workbench 查询 MUST NOT 通过该读面修改 session、message、timeline、request run、gateway record、audit、metric、trace、memory、checkpoint 或任何业务事实。

该只读查询面 MUST NOT 进入生产 `/api/v1` Web API 或用户 stream transport。Owner Scope MUST 来自认证边界；允许访问的 Agent 范围 MUST 来自可信运行环境。客户端参数、模型输出、capability 参数或持久化 metadata MUST NOT 覆盖二者。

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

### Requirement: Workbench reports data gaps without changing business facts

当现有事实无法支撑关键调测视图时，工作台 MUST 在查询时派生能够安全确定的信息，其余信息 MUST 显示为 `partial` 或 `unavailable`。工作台 MUST NOT 为填补显示缺口而回写、复制或伪造业务事实，也 MUST NOT 建立 raw capture 路径。

#### Scenario: workbench needs a field not present in existing facts
- **WHEN** 某个详情字段无法从已有正式事实读取或计算
- **THEN** 工作台 MUST 显示 `partial` 或 `unavailable`
- **AND** 工作台查询 MUST NOT 改变现有业务事实或请求结果

### Requirement: Workbench projects one canonical lifecycle per run-bound model attempt

对于属于 `RequestRun` 的每次模型尝试，工作台 SHALL 投影恰好一个 canonical `MODEL_INVOCATION_STARTED` 事件，以及一个 `MODEL_INVOCATION_COMPLETED` 或 `MODEL_INVOCATION_FAILED` 事件。同一次尝试的多个内部处理阶段 MUST NOT 在工作台中形成重复生命周期；`RequestRun` 外的模型调用 MUST NOT 显示为 run timeline action。

**需求类别**：功能性需求

#### Scenario: run 内的 workflow 或 context summary 调用模型
- **WHEN** 任一已接受 request run 的处理步骤调用模型
- **THEN** 每次模型 attempt MUST 恰好显示一个 started event 和一个 completed-or-failed event
- **AND** event coordinates MUST 来自可信 runtime run/context
- **AND** local 与 production 运行形态 MUST 应用相同事件规则

#### Scenario: 模型调用没有 RequestRun
- **WHEN** 模型在 `RequestRun` lifecycle 外被调用
- **THEN** 系统 MUST NOT 伪造 session、request、run、context 或 timeline coordinates
- **AND** 工作台 MUST NOT 把该调用显示为 canonical run timeline action

safe projection payload MUST NOT 包含 raw prompt、raw model output、raw tool args/result、provider raw body、credential、secret、token、attachment content、local path 或其他 production observability 禁止内容。safe projection payload SHOULD 优先使用 stable refs、ids、reason codes、counts、usage、selected refs、template refs、capability ids、canonical model ids、tool names、redacted summaries 和 bounded safe diagnostics。generic status、timing、coordinates 和 graph edges SHOULD 从既有 records/events 读取或计算。

safe projection payload MUST 通过其正式事实契约的 schema validation。validation、serialization、size-limit 或 projection failure MUST 丢弃 optional payload 或把它标记为 unavailable，并且 MUST NOT 使底层 runtime action 失败。工作台 MUST NOT 要求不存在真实业务事实的调测专用公共契约。

允许补充的投影信息限定为下列最小集合，且只有在字段来源映射证明现有 facts 不足时才补：

- request/planning：`agentAssemblyHash` 或 `agentAssemblySnapshotRef` 仅在 `agentAssemblyRef` 不能历史稳定解析时补；`laneKind`、`queueDepthBucket`、`schedulerDecisionCode` 仅在 scheduler owner 已有该决策且无法查询时补。
- model invocation start：`stepId`、`modelId`、`promptTemplateRef`、`promptTemplateVersion`、`selectedMessageRefs`、`disclosedCapabilityIds`、`modelMessageCount`、`modelOptionSummary`、`providerOptionKeys`。`stepId` MUST 是该请求运行步骤的可信原值投影，`modelId` MUST 是同一次模型调用的规范模型身份；canonical timeline、history 和 workbench projection MUST NOT 暴露 `modelProfileId`、`providerKind` 或 `modelName`。budget/compression/degradation 继续由对应 context lifecycle event 表达，并携带同一 `stepId`，不得复制到模型事件。
- model completion/failure：`finishReason`、`usage`、`toolCallCount`、`safeErrorCode`、`safeErrorCategory`；`outputSizeBucket` 只有无法从 persisted message 计算且 owner 已有安全值时才补。
- capability start/completion：保留既有 lifecycle fields；`CAPABILITY_STARTED` 仅补 `stepId`，多调用批次补实际 `toolBatchExecutionMode`、`toolBatchOrdinal`、`toolBatchSize`。能力描述、参数和结果详情 MUST 从该运行的可信配置与既有 tool-use/result messages 派生，不得重复写入 timeline。
- policy：`policyId`、`policyVersion`、`policyDomain`、`policyPoint`，现有 operation/outcome/reason/risk fields 不得重复。
- context compaction：`strategyCode`、token estimate buckets、`retainedMessageCount`、`droppedMessageCount`、`summaryMessageId`、`reasonCode`，前提是不能从 compaction commit/message facts 读取。
- gateway：v1 不新增 generic gateway event 或 speculative capability gateway summary public contract。缺失正式业务事实时 MUST 标记 partial/unavailable；log 只能作为 evidence，不能构建 graph truth。

#### Scenario: gateway detail 没有正式业务事实
- **WHEN** 工作台不能从既有正式业务事实取得 gateway detail
- **THEN** gateway coverage MUST 标记为 partial 或 unavailable
- **AND** 工作台 MUST NOT 增加 capability payload contract 或解析 structured log text 来发现 gateway nodes

#### Scenario: 实现补充缺失的安全投影字段
- **WHEN** process graph 或 action detail 需要现有 facts 没有的调测信息
- **THEN** 实现 MUST 先证明该字段不能从已有 facts 读取或计算
- **AND** 新增信息 MUST 由产生该正式事实的领域定义和命名
- **AND** 新增信息 MUST 通过 schema validation
- **AND** 新增信息 MUST NOT 包含 raw prompt、raw model output、raw tool args/result、credential、secret、token、attachment content 或 path

#### Scenario: 字段可从既有事实计算
- **WHEN** graph node timing、status、refs、edge 顺序、agent/run/session/request 坐标或 terminal outcome 能从已有 record、event 顶层字段或事件对计算
- **THEN** 系统 MUST 在 workbench projection 中计算该字段
- **AND** 系统 MUST NOT 为该字段新增 safe projection payload、durable record 字段或 workbench 私有事实

#### Scenario: raw detail 不可用
- **WHEN** 某动作只有 safe projection，没有 raw input/output
- **THEN** 工作台 MUST 显示 safe projection detail 和 `rawUnavailable` 或等价状态
- **AND** 系统 MUST NOT 通过调测专用捕获、日志解析或业务事实回写来补齐 raw

#### Scenario: 模型时间线使用 canonical identity
- **WHEN** 工作台重建任一 `MODEL_INVOCATION_*` event
- **THEN** process graph、event label、action detail、effective view 和 browser projection MUST 使用相同 `stepId/modelId`
- **AND** 没有 run-bound timeline event 的 background recommendation MUST NOT 显示为工作台 model action

### Requirement: Workbench exposes a reconstructed run effective view

Agent Dev Workbench SHALL 在 supporting facts 可用时为每个 request/run 暴露 reconstructed effective view。该视图 SHALL 描述形成该 run 的配置和输入，包括 Agent identity/version/assembly reference、Agent assembly summary refs、canonical model selection、prompt template ref、context selection/budget/compression evidence、capability binding/disclosure summary、rendered model tool names/count 和 final model invocation safe parameters。runtime settings summary 和 workspace policy summary 是 optional v1 details，只在可从 stable assembly refs 历史解析时显示。

effective view MUST 从可信 Agent 配置、已接受的请求运行事实、持久化会话事实、安全投影和稳定引用派生。runtime settings summary 和 workspace policy summary SHALL 在 `agentAssemblyRef` 可历史解析时从该 ref 派生；否则 MUST 标记为 `partial`、`current-view` 或 `unavailable`。存在 run-specific facts 时，effective view MUST NOT 从 client request body values、model output、raw logs、log text 或 mutable current defaults 重建。

当系统能按 run 的 exact `agentId`、`agentVersion` 和 `agentAssemblyRef` 解析历史稳定配置时，effective view SHALL 暴露该 Agent 的完整非密钥配置，包括 identity metadata、canonical `modelIds` 与 optional `defaultModelId`、capability bindings、runtime settings、workspace policy、routing、hooks 和 policies。工作台 MUST 要求三个 coordinates 全部匹配。配置缺失或引用不匹配 MUST 报告为 unavailable，并且 MUST NOT 回退到 active 或 current Agent configuration。credential values 和 provider-resolved secrets MUST NOT 加入该视图。

对于缺少充分 run-specific facts 的历史 run，工作台 MAY 显示 best-effort reconstructed 或 current-view，但 MUST 明确标记为 `reconstructed`、`current-view`、`partial`、`unavailable` 或等价 non-authoritative status。

**需求类别**：功能性需求

#### Scenario: run 从安全事实暴露 effective view
- **WHEN** 开发者查看已完成 request/run 且相关 safe projection payload 存在
- **THEN** 开发者 MUST 能查看该 run 的 Agent identity/version/assembly reference、assembly summary refs、canonical `modelId` selection、prompt template ref、context selection evidence、visible capability ids、rendered model tool names/count 和 final model invocation safe parameters
- **AND** runtime settings summary 和 workspace policy summary MUST 只在可从 historically stable assembly refs 派生时显示，否则 MUST 标记为 partial/current-view/unavailable
- **AND** 这些信息 MUST 关联到 process graph 中的 effective-state 节点或对应 `context`/`model` 节点详情

#### Scenario: 历史 run 只有部分 effective view
- **WHEN** 开发者查看缺少 run-specific projection payload 的历史 run
- **THEN** 工作台 MAY 根据已有持久化事实和当前配置展示 best-effort 配置视图
- **AND** 该视图 MUST 标记为非历史权威或 partial
- **AND** 系统 MUST NOT 将当前配置伪装为该历史 run 当时实际生效的配置

#### Scenario: run 暴露 exact Agent configuration
- **WHEN** 系统能解析 run 的 `agentId` 和 `agentVersion`
- **AND** resolved configuration ref 恰好等于 persisted `agentAssemblyRef`
- **THEN** 生效视图 MUST 展示该 Agent 的完整非密钥配置
- **AND** capability bindings MUST 可用于分类 bound Tool、Skill 和 Agent capabilities
- **AND** 配置不存在或 ref 不匹配时 MUST 显示配置不可用，且不得回退到 active/current Agent 配置

### Requirement: Workbench action details expose safe detail availability

Agent Dev Workbench SHALL provide action detail for graph nodes. Action detail SHALL be read from existing facts and safe projection payload, and SHALL include available input/output summaries, status, error code, timing, refs, usage, counts, selected refs, capability ids, model/profile ids, prompt template refs, and detail availability.

If raw content already exists in an existing authorized local development fact, such as persisted messages that the developer can already inspect, the workbench MAY link to or display that content according to the fact owner's existing contract. Workbench MUST NOT create a new raw capture path solely to provide action details.

Model invocation detail SHALL display `inputTokens`, `outputTokens`, and `totalTokens` when `MODEL_INVOCATION_COMPLETED.usage` contains them. When the provider does not return usage, the detail SHALL explicitly mark token usage unavailable instead of omitting the section or inventing an estimate.

Capability detail SHALL use the node's `toolCallId` to correlate existing persisted `ASSISTANT_TOOL_USE` and `CAPABILITY_RESULT` messages. When those authorized local facts exist, the detail SHALL display that tool call's original arguments and result. It MUST NOT mix arguments or results from another tool call in the same run, and MUST NOT add a new raw timeline payload, log field, decorator, buffer, or durable store for this purpose.

Model detail SHALL present the capabilities actually disclosed to that model invocation as separately classified `工具`, `Skill`, and `Agent` capability ids. Classification MUST join the invocation disclosure ids with the exact run-bound `AgentAssembly.capabilityBindings` by capability id and use `capabilityType`; it MUST NOT depend on whether a capability was invoked, infer Skill from “not a tool”, or include assembly bindings not disclosed to that invocation. Missing assembly, ref mismatch, or unclassifiable disclosure MUST be shown as partial/unavailable. The detail SHALL NOT repeat disclosure ids, rendered tool names, or model usage in the generic safe projection section when those facts already have dedicated detail sections. The overview SHALL omit generic detail availability. For `HOOK_INVOKED`, the graph node SHALL present the lifecycle hook point (`stage`) while `hookId` and invocation metadata remain in action detail.

The effective view SHALL distinguish run-wide Agent configuration from selected-node execution facts. Run Agent identity, version, assembly ref, and exact compiled configuration MAY remain visible for every selected node because they govern the entire run. Model profiles, prompt templates, selected messages, rendered tools, model options, and token usage SHALL be presented as selected-node context only for model nodes. Non-model nodes MUST NOT present the run's aggregate model/prompt facts as if they were facts of the selected action.

Model detail SHALL provide a clearly labelled Prompt approximation assembled at query time from the model node's existing `promptTemplateRef`, persisted selected messages referenced by `selectedMessageRefs`, and capabilities classified from `disclosedCapabilityIds`. When the exact referenced template for the run's `agentId` and `agentVersion` remains available, the workbench MAY use it, but MUST NOT present the approximation as the provider's final request. It SHALL expose missing refs and explicit limitations for dynamic template values, capability-generated messages, attachments, complete tool schemas, render-time transforms, and `BEFORE_MODEL_INVOKE` hook mutations that cannot be replayed from existing facts. It MUST NOT re-run context assembly or prompt rendering, modify the business invocation path, or add raw prompt capture, workbench-only timeline payload, log fields, buffers, or durable stores.

工作台 MUST 从已有 `promptTemplateRef`、`promptTemplateVersion`、`selectedMessageRefs`、`disclosedCapabilityIds` 和 `modelMessageCount` 派生模型详情，不得要求平行的安全调测快照。工具名称和能力分类 MUST 从这些可信引用与该运行的 Agent 配置派生，而不得要求 `renderedToolNames` 或 `visibleCapabilityIds` 别名。

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
- **WHEN** 当前可信 Agent 配置包含一个尚无持久化会话的 parent-scoped subagent
- **THEN** Agent 列表 MUST 仍显示该 subagent 及其 parent Agent scope、invocation policy 和完整非密钥配置
- **AND** 该 subagent 的 session count MUST 为 0

#### Scenario: Agent list identifies an invocation-only bound Agent
- **WHEN** 当前可信 Agent 配置包含一个 `userInvocable=false` 且 `agentInvocation="BOUND"` 的 Agent
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

The log evidence view SHALL be read-only, non-realtime, bounded by count/byte/time-window limits, and unavailable in production runtime. Missing, rotated, inaccessible, oversized, or unparsable log sources MUST be reported as `unavailable`, `truncated`, or bounded dev diagnostics without affecting request execution.

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
- **WHEN** app 使用 production runtime 形态启动
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

local with-frontend 运行形态 SHALL 在 Agent Dev Workbench 可用时提供独立悬浮入口，该入口不得成为最终用户产品路由或长期 UI 状态。按钮 SHALL 默认半透明，在 hover、keyboard focus 和拖动时恢复完全不透明并提供明确视觉反馈；按钮 SHALL 支持 viewport 内拖动，并区分点击与超过小幅阈值的拖动，拖动结束不得误触发跳转。位置只在当前页面生命周期内保留，不得写入业务配置或持久化。工作台不可用时，普通页面 MUST NOT 显示该按钮或链接。

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
- **WHEN** local frontend 未启用 workbench
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

系统 SHALL 以 production-safe 运行事实记录同一轮 Tool 批次的实际执行模式。多调用批次 SHALL 在 `CAPABILITY_STARTED` 中携带 `toolBatchExecutionMode`（`PARALLEL` 或 `SERIAL`）、`toolBatchOrdinal` 和 `toolBatchSize`；这些字段描述真实执行且不得依赖工作台是否可用。工作台 SHALL 将 `PARALLEL` 成员投影为一个 fork/join group，并将 `SERIAL` 成员保留在顺序路径中；MUST NOT 从时间戳、事件顺序、日志或共享 `stepId` 猜测并行执行。

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

Agent Dev Workbench 页面、查询、graph projection、effective view projection、action detail projection 和 log evidence projection 的失败 MUST NOT 改变 request acceptance、scheduler、context assembly、model invocation、capability invocation、gateway call、policy decision、hook execution、stream projection、terminal commit、recovery 或 persistence 的业务 outcome。正式业务运行事实自身的失败继续遵循原有 failure policy，不得建立 workbench-specific failure path。

当 workbench projection、safe projection serialization、log evidence query 或 page rendering 失败时，系统 SHALL 在 workbench 内显示 bounded diagnostic 或缺失状态；正式 observability、audit、metrics、trace、runtime truth 和业务持久化 MUST 继续遵守各自既有契约。

#### Scenario: supporting projection fails
- **WHEN** 正式运行事实的可选 payload production 或 workbench projection 失败
- **THEN** 当前 request/run MUST 继续按原业务路径执行
- **AND** terminal outcome MUST NOT 因工作台投影失败而改变
- **AND** 工作台中对应详情 MUST 显示缺失或投影失败状态

#### Scenario: projection does not leak raw content
- **WHEN** 工作台生成 graph、effective view、action detail 或 log evidence
- **THEN** raw prompt、raw model output、raw tool args/result、provider raw body、credential、secret、token、attachment content 和 path MUST NOT 被新增写入 structured log、audit、metrics、trace、canonical timeline、session message、gateway record、checkpoint 或 memory


### Requirement: Workbench consumes only the current active operational segment

The local Agent Dev Workbench log-evidence view SHALL read only the current transport-owned active operational segment. `agent-log` SHALL expose its current read-only active destination identity backed by `destination.file`; trusted `agent-app` composition SHALL pass a current-active provider to the workbench. The workbench MUST NOT discover operational evidence by scanning the log directory, testing filenames, or guessing the highest sequence.

For every successfully parsed complete entry, the workbench SHALL derive its existing evidence source from the writer-owned `surface` field:

- `runtime_diagnostic` maps to `runtime-diagnostic-log`;
- `observation_derived` maps to `structured-safe-log`.

Missing, unknown or invalid `surface` MUST NOT default to either evidence source. Log evidence remains auxiliary, read-only evidence filtered by authorized stable refs and MUST NOT create graph nodes, action details, runtime state, audit facts, metric samples or other business facts.

The active-file reader SHALL remain asynchronous and enforce existing result-count, byte, time-window and query-deadline limits. Reaching a limit MUST return bounded `truncated` evidence/status. Access, rotation-race or parse failure MUST return bounded `unavailable`/diagnostic status and MUST NOT fall back to directory scanning or change request execution.

Closed operational `.jsonl` sources, committed `.jsonl.gz` archives, metrics files, audit storage, developer traces, legacy logs, symlinks and unknown files MUST NOT be opened by the workbench. Retained operational history SHALL be inspected only through external operational file tooling outside the Agent Dev Workbench.

#### Scenario: Active unified entry preserves its surface

- **WHEN** an authorized developer queries a run whose current active operational segment contains matching complete entries from both surfaces
- **THEN** the workbench MUST return runtime diagnostics as `runtime-diagnostic-log`
- **AND** it MUST return observation-derived entries as `structured-safe-log`
- **AND** classification MUST use the parsed surface rather than the physical filename

#### Scenario: Active destination rotates during a query

- **WHEN** `agent-log` changes `destination.file` while a workbench query is reading the previously supplied active segment
- **THEN** the bounded query MAY return already read complete entries and `truncated` or `unavailable` status
- **AND** it MUST NOT scan for, guess or reopen either the closed segment or the new active segment
- **AND** a later query MUST obtain the then-current active identity from the provider

#### Scenario: Matching evidence exists only in retained history

- **WHEN** matching run evidence exists only in a closed `.jsonl` source or committed `.jsonl.gz` archive
- **THEN** the workbench MUST return no log evidence from that file
- **AND** it MUST NOT decompress or otherwise open retained history

#### Scenario: Workbench sees another output domain

- **WHEN** the log directory also contains metrics, audit, developer trace, legacy, symlink or unknown files
- **THEN** the workbench MUST ignore those files as operational evidence
- **AND** it MUST NOT classify them through filename heuristics

#### Scenario: Entry surface is absent or invalid

- **WHEN** the current active segment contains an unparsable line or a complete JSON object without an allowed operational surface
- **THEN** that line MUST NOT be mislabeled as runtime or observation-derived evidence
- **AND** the query MAY report only a bounded unavailable/parse diagnostic without changing any fact
