## ADDED Requirements

### Requirement: Core Contract Namespace
TS 后端 MUST 提供 `agent-common` foundation package 和 `agent-contracts` boundary namespace，承载最小内核和后续并行 change 共享的基础类型、public DTO、enum、port 和 schema skeleton。核心 value object、DTO、enum 和 port MUST 具备稳定名称、必需字段和调用签名。实现模块 MUST 通过 `agent-common` 使用共享 id、value object、语言/区域、身份、secret reference、安全错误形态和被多个边界共同消费的基础 enum，并通过 `agent-contracts` 交换 runtime、channel、session、attachment、context、model、capability、core、gateway、observability 和 app 契约，不得通过实现包 private 类型建立跨模块契约。

#### Scenario: 实现包消费核心契约
- **WHEN** runtime、channel、session、core、context、model、capability、gateway、observability 或 app package 需要跨模块交换请求、状态、事件、结果或诊断
- **THEN** 该交换 MUST 使用核心 contract namespace 中的 public contract
- **AND** implementation package 不得把自身 private DTO 作为其他 package 的 public dependency

#### Scenario: 基础类型归属 agent-common
- **WHEN** 团队定义或消费 shared id、基础 value object、JSON value、时间/幂等键、当前身份值对象、secret reference、安全错误形态或跨多个边界共同消费的基础 enum
- **THEN** 该 contract MUST 由 `agent-common` owning
- **AND** `agent-common` MUST NOT import `agent-contracts`
- **AND** `agent-contracts` subpath export MUST import and reuse these foundation contracts instead of redefining them
- **AND** TS 后端 MUST NOT introduce `agent-contracts/common` as an owning module for foundation contracts

#### Scenario: 契约按拥有模块导出
- **WHEN** 团队实现或消费核心 DTO、enum、schema skeleton 或 port
- **THEN** 每个 public contract MUST 具有唯一 owning export module
- **AND** `agent-contracts` MUST 提供 runtime、channel、session、attachment、context、model、capability、core、gateway、observability 和 app 的稳定 subpath export
- **AND** shared id、value object、identity context、locale/language value、secret reference、safe error shape、RunStatus、TerminalCommitState、TimelineEventType、CheckpointTriggerReason、CapabilityKind、CapabilityProviderKind、CapabilityReplayPolicy and CapabilityInvocationStatus MUST NOT be owned by any `agent-contracts/*` subpath
- **AND** subpath export MUST represent module public surface and dependency boundary, not a cosmetic namespace
- **AND** identity、timeline、checkpoint、pending-input、hook、sandbox、content、errors、configuration and feedback MUST NOT be introduced as separate owning subpaths unless a later architecture change creates a distinct owning module for that boundary
- **AND** checkpoint payload、pending input、hook lifecycle and timeline contracts MUST be owned by `agent-contracts/runtime`
- **AND** content references、artifact metadata and answer feedback domain contracts MUST be owned by `agent-contracts/session`
- **AND** sandbox execution request/result/port MUST be owned by `agent-contracts/gateway`
- **AND** ErrorNormalizer MUST be owned by `agent-contracts/observability`
- **AND** app configuration contracts MUST be owned by `agent-contracts/app`
- **AND** root `agent-contracts` re-exports, if provided, MUST only re-export stable public contracts and MUST NOT become an owning module
- **AND** implementation package MUST import from the owning subpath export when it depends on a specific module boundary

#### Scenario: Enum 归属按共享语义确定
- **WHEN** 团队定义或移动 enum
- **THEN** `agent-common` MUST own only cross-boundary, durable, system-level vocabulary consumed by multiple module boundaries
- **AND** business vocabulary private to a single domain boundary MUST remain in its owning `agent-contracts/*` subpath
- **AND** gateway-only persistence value vocabulary MUST use gateway-owned record value types instead of forcing domain enum ownership into `agent-common`
- **AND** implementation package MUST NOT 通过 adapter-private DTO、数据库 schema、provider SDK 类型、本地路径布局或其他 implementation package 暴露跨模块契约

#### Scenario: 契约面具备可实现字段和签名
- **WHEN** 团队实现 runtime、channel、context、model、capability、gateway、sandbox、hook、checkpoint、observability 或 app composition 的跨模块边界
- **THEN** 核心 contract namespace MUST 提供对应 public DTO、enum、schema 和 port signature
- **AND** contract tests MUST 能校验这些 public contract 的必需字段、enum vocabulary 和方法签名没有发生未声明漂移

#### Scenario: 后续 change 扩展核心契约
- **WHEN** 后续 change 需要改变 runtime command、event vocabulary、owner scope、safe error、capability descriptor、gateway port 或其他共享契约
- **THEN** 该 change MUST 修改或扩展核心 contract namespace
- **AND** 不得在单个实现包中创建竞争性的共享契约

### Requirement: Identity Owner Scope And Safe Error Baseline
TS 后端 MUST 在核心契约中定义当前 identity、owner scope 语义和 AgentError/SafeError baseline。Owner scope MUST 作为 `tenantId` 和 `subjectId` 两个稳定字段显式出现在需要归属边界的 DTO 中，不新增独立 owner scope DTO。Channel/auth boundary MUST 解析当前身份；请求体、客户端 metadata、模型输出或 capability args 中的 owner 字段 MUST NOT 覆盖当前身份。

#### Scenario: 当前身份进入运行时
- **WHEN** Web channel 接受来自用户或客户端的 request command
- **THEN** channel/auth boundary MUST 生成当前 identity context
- **AND** runtime、session、attachment、context、capability、gateway、audit 和 observability contract MUST 接收并传递 `tenantId` 和 `subjectId`

#### Scenario: 不可信 owner 字段被忽略
- **WHEN** 请求体、模型输出、capability input 或客户端 metadata 包含 tenant、subject、owner 或等价身份字段
- **THEN** TS 后端 MUST NOT 使用这些字段覆盖当前 identity context
- **AND** 如果这些字段与当前 identity context 冲突，系统 MUST 返回 safe error 或记录安全诊断

#### Scenario: 错误对外安全可见
- **WHEN** runtime、channel、context、model、capability、gateway、sandbox 或 observability boundary 返回失败
- **THEN** failure MUST 被归一化为 SafeError contract
- **AND** SafeError MUST 包含稳定错误码、用户可见消息、错误分类和 retryable 标识
- **AND** SafeError MUST NOT 暴露 cause、stack、raw provider error、raw secret、raw credential、未脱敏路径、未授权对象内容或未脱敏模型/工具输入

#### Scenario: 内部错误使用标准错误形态
- **WHEN** 模块需要抛出可预期的业务或系统错误
- **THEN** 该错误 MUST 使用 AgentError 或在离开当前 boundary 前映射为 AgentError/SafeError
- **AND** AgentError MUST NOT 直接作为 API、stream、capability result、audit 或 log payload 序列化输出

### Requirement: Runtime Command And RequestRun Baseline
TS runtime MUST 是 request lifecycle 的唯一 owner。核心契约 MUST 定义 runtime command、RequestRun、RunStatus、latest-request 合法性、terminal result、terminal commit、run version、claim/fencing、CAS result 和 terminal commit result 的最小形态。Channel、session、core、context、model、capability 和 gateway MUST NOT 创建竞争性的 request lifecycle state machine。

#### Scenario: 请求通过 runtime command 进入系统
- **WHEN** 用户提交、取消、重试或编辑重新提交请求
- **THEN** channel MUST 将该操作表达为 runtime command
- **AND** runtime MUST 决定该 command 是否满足当前 session lane、latest-request 和 owner scope 约束
- **AND** submit, retry-latest and edit-latest acceptance MUST return sessionId、requestId、runId and attempt
- **AND** request acceptance response MUST NOT expose stream cursor or timeline sequence fields

#### Scenario: 控制类 command 携带可信身份
- **WHEN** channel 创建取消、重试或编辑重新提交 command
- **THEN** command MUST include IdentityContext injected by the trusted channel/auth boundary
- **AND** runtime MUST use identityContext.tenantId and identityContext.subjectId to validate session, latest request, message and run owner scope
- **AND** command field names MUST preserve stable semantics for sessionId, expectedLatestRequestId, action, editedInputText, attachmentIds and idempotencyKey
- **AND** client payload, client metadata, model output or capability input MUST NOT override command identity

#### Scenario: 请求附件引用只使用 id
- **WHEN** channel 创建提交或编辑重新提交 command
- **THEN** command MUST carry attachments as `attachmentIds: AttachmentId[]`
- **AND** command MUST NOT carry attachment fileName、mediaType、sizeBytes、validationStatus、availabilityStatus or storageRef
- **AND** runtime MUST load authoritative RequestAttachment records by tenantId、subjectId and attachmentId before accepting the request
- **AND** runtime MUST reject the request unless every referenced attachment is owner-scoped, validationStatus is ACCEPTED and availabilityStatus is AVAILABLE
- **AND** SessionMessage MUST persist only attachmentIds for message-to-attachment association

#### Scenario: RequestRun 状态由 runtime 推进
- **WHEN** request 从接受进入排队、计划、执行或终态
- **THEN** runtime MUST 推进 RequestRun status
- **AND** gateway MUST 只持久化 runtime 提交的 durable facts
- **AND** core、context、model 和 capability MUST 通过 runtime-owned execution context 产生可提交事实

#### Scenario: RequestContext 表达可恢复执行坐标
- **WHEN** runtime 调用 Agent core 执行一个 request run
- **THEN** RequestContext MUST contain requestContextId、sessionId、requestId、runId、identityContext、locale、agentId、agentVersion、agentAssemblyRef、optional activeStepId、nextLifecycleStage、optional currentToolBatchMessageId、toolCallStates and flowVariables
- **AND** RequestContext MUST NOT contain language、attempt、deadlineAt or messageRefs
- **AND** attempt and deadlineAt MUST be read from RequestRun when needed
- **AND** model-visible context MUST be loaded from ActiveContextView rather than RequestContext message references or full message history scans
- **AND** current request/run message records, when needed for recovery/tool-state reconstruction, MUST be loaded through SessionMessageStoreGateway.listCurrentRequestMessages(CurrentRequestConversationRecordQuery) and mapped by the domain module, but MUST NOT be the direct source of model context selection
- **AND** ContextAssembly.selectedMessageRefs MUST express which immutable active context messages are selected for model context
- **AND** locale MUST be the only user language/regionalization input fact in RequestContext and MUST represent a normalized BCP 47 locale used for model prompt language, date, number, currency, unit and user-visible copy regionalization
- **AND** channel or app composition MUST normalize locale and provide a default before runtime/core consumes RequestContext
- **AND** RequestLanguage, when needed for narrow internal/compatibility uses such as capability filtering or title rules, MUST be derived from locale or user input and MUST NOT be stored in RequestContext
- **AND** nextLifecycleStage MUST only use recoverable execution points such as BEFORE_MODEL_INVOKE、BEFORE_CAPABILITY_INVOKE and BEFORE_TERMINAL_EVENT
- **AND** currentToolBatchMessageId and toolCallStates MUST only be meaningful when nextLifecycleStage is BEFORE_CAPABILITY_INVOKE
- **AND** currentToolBatchMessageId MUST reference the assistant tool-use message for the active tool batch
- **AND** each ToolCallState MUST contain toolCallId、capabilityId、structured arguments and status so pending tool calls can resume without re-parsing model output during normal execution
- **AND** flowVariables MUST be a JSON-compatible request-scoped map

#### Scenario: 终态提交具有唯一性
- **WHEN** request 产生 completed、failed、canceled 或 superseded 终态
- **THEN** runtime MUST 通过 terminal commit contract 持久化 terminal message、terminal event 和 RequestRun terminal state
- **AND** terminal commit MUST 使用 compare-and-set 或等价 version check 防止双终态

### Requirement: Canonical Timeline And Stream Projection
TS 后端 MUST 在核心契约中冻结 canonical timeline 和用户可见 stream projection 的边界。TimelineEventType MUST 是 request 执行事实的 canonical vocabulary；StreamEventType MUST 是 channel 对 canonical timeline 和 runtime status 的投影。SSE 和 WebSocket MUST 共享同一 stream envelope 和 projection 语义。

#### Scenario: Timeline 记录 canonical 执行事实
- **WHEN** request 被接受、开始计划、调用模型、调用 capability、产生降级、hook 控制决策改变生命周期、等待用户输入、处理附件、压缩上下文或进入终态
- **THEN** runtime MUST 发布 canonical timeline event
- **AND** event MUST 包含 eventId、sessionId、runId、requestId、requestContextId、sequence、event type、inline payload、可选 content reference boundary 和 createdAt
- **AND** runtime MUST populate or overwrite eventId、sessionId、runId、requestId、requestContextId、sequence and createdAt before an event becomes canonical
- **AND** agent/core MUST NOT rely on runtime-owned fields supplied before timeline publication being preserved

#### Scenario: Runtime timeline stream supports resume and live events
- **WHEN** channel opens a runtime timeline stream
- **THEN** channel MUST provide sessionId and lastSeenSequence
- **AND** lastSeenSequence MUST be a non-negative safe integer and MUST NOT exceed Number.MAX_SAFE_INTEGER
- **AND** runtime MUST treat timeline sequence as a session-scoped monotonically increasing cursor
- **AND** runtime MUST return recoverable timeline events from the same session with sequence greater than lastSeenSequence and then continue with newly emitted events
- **AND** requestId and runId filters, when supplied, MUST only narrow the stream and MUST NOT change sequence ownership or reset sequence numbering
- **AND** delta timeline events MUST be non-persistent
- **AND** each delta timeline event MUST contain the cumulative full state for that delta stream
- **AND** replay MUST resume from the nearest recoverable event after lastSeenSequence according to delta persistence policy and MUST NOT require every sequence to be replayed
- **AND** channel MUST project runtime timeline events to StreamEnvelope and MUST NOT own canonical replay semantics

#### Scenario: Timeline sequence is consistent across instances
- **WHEN** runtime assigns timeline event sequence in a single-instance or multi-instance deployment
- **THEN** the sequence MUST be greater than zero and MUST increase within the session timeline
- **AND** runtime MUST NOT wrap, reset, reuse, modulo or run-scope the sequence for the same session
- **AND** concurrent timeline events in the same session MUST NOT receive duplicate sequence values
- **AND** runtime MUST NOT publish same-session timeline events in a way that violates sequence order
- **AND** the core contract MUST NOT require a specific coordination mechanism

#### Scenario: Stream replay and history use different facts
- **WHEN** channel resumes a stream
- **THEN** runtime MUST recover runtime process facts from timeline events according to persistence and delta policies
- **AND** historical conversation display MUST use visible SessionMessage records as the final conversation content source
- **AND** stream replay MUST NOT reconstruct final conversation history from timeline events
- **AND** when delta or sequence continuity cannot restore an active display, the system MUST use a stream notice or equivalent safe outcome to trigger history refresh from visible messages

#### Scenario: Stream 从 timeline 投影
- **WHEN** channel 向用户发送 request stream
- **THEN** channel MUST 使用 StreamEventType 投影 canonical timeline 或 runtime status
- **AND** channel MUST NOT 发明与 canonical timeline 冲突的执行事实
- **AND** SSE 和 WebSocket 对同一 request MUST 暴露等价的 stream envelope、terminal event 和 error semantics
- **AND** stream envelope MUST carry eventId、sessionId、requestId、optional run/context refs、sequence、eventType、optional timeline event ref、transport hints、payload 和 createdAt
- **AND** requestId MUST identify the root user request message and StreamEnvelope MUST use requestId as its request correlation field
- **AND** when projected from a timeline event, timelineEventRef MUST reference the source timeline event id and payload MUST be the channel-safe projection of the timeline payload
- **AND** terminal state MUST be derived from StreamEventType rather than a separate envelope flag

#### Scenario: 事件 vocabulary 被校验
- **WHEN** contract tests 枚举 RunStatus、TimelineEventType 和 StreamEventType
- **THEN** tests MUST 验证 canonical vocabulary 中的状态和事件名称稳定
- **AND** degradation MUST NOT 作为 RunStatus value 表达，MUST 通过 timeline/stream event、result、safe error、audit event 或 observability metric 表达
- **AND** HOOK_DECISION_APPLIED and POLICY_APPLIED MUST be timeline-only events and MUST NOT be part of first-release StreamEventType
- **AND** deprecated projection name MUST NOT 出现在 public stream contract 中

### Requirement: Context And Model Contract Baseline
TS 后端 MUST 在核心契约中定义 context assembly request/result、rendered model input、model request、model stream delta、model final result 和 model usage/provider request reference 的最小形态。Context Engine MUST 拥有 context selection、budget、prompt shaping 和 large-content reference boundary；model provider MUST 只通过 model contract 接收模型请求并返回模型事实。

#### Scenario: Context Engine 组装模型输入
- **WHEN** core 需要调用模型处理 request
- **THEN** core MUST 调用 Context Engine contract 获取 context assembly result
- **AND** context assembly request MUST 只表达 session、root message、run、step、agent、locale 和 purpose 等组装入口
- **AND** Context Engine MUST read ActiveContextView as the authoritative model-visible message reference sequence before reading immutable SessionMessage content
- **AND** context assembly result MUST 包含本次生成的 system prompt、选中的 active context message refs、可见 capability metadata、有效 model info、有效 model options 和 model selection reason
- **AND** context assembly result MUST NOT 直接包含最终 ChatMessage 数组；最终 ChatMessage MUST 在 render 阶段由 system prompt、选中的不可变 session messages 和 capability metadata 生成

#### Scenario: Active context view controls model-visible history
- **WHEN** a model-visible raw message is persisted for a session
- **THEN** the message MUST be appended to the session active context view in message order
- **AND** messages MUST remain append-only and MUST NOT be rewritten by context compression
- **AND** active context items MUST be represented as ordered per-message references so storage implementations can join active context items with immutable session messages
- **AND** active context item ordinal MUST be generated or maintained by ActiveContextStoreGateway and MUST NOT come from client, channel, model output or capability arguments
- **AND** ordinal MUST be unique within one active context view and MUST restore model-visible order when sorted ascending, without requiring a specific numbering strategy
- **AND** active context view MUST expose an activeContextVersion for optimistic conflict detection and checkpoint recovery
- **AND** append and compaction write requests MUST carry expectedActiveContextVersion and MUST fail with version conflict instead of overwriting a changed active context
- **AND** model invocation MUST read selected history from active context items, not by scanning all session messages

#### Scenario: Context compression commits prefix compact with recent tail
- **WHEN** Context Engine compresses older history for a session
- **THEN** compression MUST write a summary SessionMessage
- **AND** compression MUST store covered active items, generated summary message and retained tail message refs in the summary SessionMessage metadata
- **AND** summary SessionMessage metadata MUST be a JSON-compatible typed metadata object that conforms to the SessionMessage metadata contract
- **AND** compression MUST replace the covered prefix in active context items with the summary message while preserving retained tail order
- **AND** summary message write, active context item replacement and activeContextVersion increment MUST commit with one transaction boundary or equivalent atomicity
- **AND** ContentRef with refType MODEL_SUMMARY MUST point to the summary SessionMessage id rather than an independent summary store record

#### Scenario: Context Engine 渲染模型输入
- **WHEN** core 已获得 context assembly result
- **THEN** core MUST 通过 Context Engine render contract 获取 rendered model input
- **AND** rendered model input MUST 包含 ChatMessage 数组、tools、本次有效模型信息、thinking/model options 和 provider options
- **AND** rendered model input MUST include only minimal execution coordinates and MUST NOT embed full ContextAssembly
- **AND** ChatMessage MUST 能通过结构化 model tool call 表达 assistant tool calls，并通过 toolCallId 表达 tool result 关联
- **AND** context selection, capability visibility, model selection reason, omitted or compaction diagnostics MUST be recorded at assembly/render time through timeline, audit event, structured log or observability metric rather than carried by rendered model input

#### Scenario: 模型调用被隔离在 model contract
- **WHEN** core 或 runtime 需要调用模型 provider
- **THEN** core 或 runtime MUST convert rendered model input into a flat model invocation request
- **AND** model invocation request MUST include requestId、stepId、providerKind、modelName、baseUrl、credentialRef、ChatMessage 数组、tools、model options、provider options and timeoutMs
- **AND** providerKind MUST be required so agent-model can select the provider adapter without leaking SDK types into core contracts
- **AND** model invocation request MUST NOT contain full ContextAssembly、RenderedModelInput、streaming context or stream mode
- **AND** model invocation service MUST expose separate complete and stream methods so the caller explicitly selects non-streaming or streaming inference
- **AND** model result MUST 通过 model stream delta 或 model final result contract 返回
- **AND** model final result MUST preserve content、reasoning/thinking when available、finishReason、usage、tool calls、response id/model id metadata and safe error boundary
- **AND** model usage MUST 保留 token metrics 的扩展位置

### Requirement: Capability Contract Baseline
TS 后端 MUST 把 Capability 定义为 Tool、Skill 和 Agent 的上位概念。核心契约 MUST 定义 capability descriptor、provider identity、version、availability、kind、compatibility metadata、input schema、safe extension metadata、invocation request/result、structured result payload、generated messages、context patch、artifact refs、timeout/cancellation boundary 和 idempotency declaration 的最小形态。公共 capability kind MUST 只使用 `TOOL`、`SKILL`、`AGENT`。

#### Scenario: Capability 进入统一 catalog
- **WHEN** bundled provider、本地目录、SkillHub、MCP server、Agent registry 或 app composition 注册的 custom provider 贡献 capability
- **THEN** provider MUST 通过 capability descriptor contract 进入统一 catalog
- **AND** descriptor MUST 声明 capability id、kind、provider identity、availability、safe description、compatibility metadata 和 invocation boundary refs
- **AND** descriptor contract MUST support optional version、supported languages、compatibility metadata and safe provider extension metadata
- **AND** provider kind MUST be one of `BUNDLED`、`LOCAL_DIRECTORY`、`SKILL_HUB`、`MCP_SERVER`、`AGENT_REGISTRY`、`CUSTOM`
- **AND** custom provider MUST include a non-empty providerType and MUST be explicitly registered by app composition before any descriptor from that provider can be executable
- **AND** provider-internal entry refs MUST NOT be required by the core descriptor contract

#### Scenario: Capability compatibility metadata is part of descriptor
- **WHEN** capability descriptor declares runtime compatibility
- **THEN** compatibility metadata contract MUST support optional supported OS families、supported CPU architectures、required executable names、required environment keys、required configuration keys、network requirement and runtime tags
- **AND** missing compatibility metadata MUST default to unrestricted compatibility
- **AND** missing compatibility metadata fields MUST default to empty collections or networkRequired=false
- **AND** compatibility metadata MUST be treated as capability metadata and MUST NOT be replaced by an opaque availability computation result

#### Scenario: Capability extension metadata remains non-authoritative
- **WHEN** capability descriptor carries provider extension metadata
- **THEN** metadata MUST be optional and MUST contain only non-sensitive provider-supplied descriptive information
- **AND** runtime and core MUST NOT use metadata to decide model visibility、authorization、routing、availability or replay safety
- **AND** metadata MUST NOT contain secret、raw path、raw provider response、user input、model input/output or credential material
- **AND** metadata MUST NOT be copied verbatim into model context or client output
- **AND** any metadata key shared by multiple providers and used for behavior MUST be promoted to an explicit core field or a typed extension defined by a later change

#### Scenario: Capability availability controls model visibility
- **WHEN** catalog resolves capability visibility for model selection or execution
- **THEN** capability availability MUST use the `AvailabilityStatus` type
- **AND** `AvailabilityStatus` MUST use only `AVAILABLE`、`DISABLED` or `UNAVAILABLE`
- **AND** capabilities MUST NOT enter model-visible capability lists or execution paths unless their availability is `AVAILABLE`
- **AND** disabled, missing configuration, unavailable dependency, failed health check, invalid descriptor or unregistered custom provider MUST NOT be model-visible or executable
- **AND** availabilityReason MUST contain only a safe reason code or safe summary
- **AND** availabilityReason MUST NOT include raw path、secret、provider response or sensitive configuration

#### Scenario: Capability 调用使用统一边界
- **WHEN** Agent 调用 Tool、Skill 或 Agent capability
- **THEN** 调用 MUST 使用 capability invocation request contract
- **AND** capability invocation request MUST contain invocationId、capabilityId、optional toolCallId、arguments、sessionId、requestId、runId、requestContextId、stepId、identityContext、agentId、agentVersion、timeoutMs and optional idempotencyKey
- **AND** requestId MUST identify the root user request message and runId MUST identify the current RequestRun
- **AND** identityContext MUST be injected by trusted runtime/channel boundary and MUST NOT be read from arguments
- **AND** workspaceDir and recoveryReplay MUST NOT be part of the core capability invocation request
- **AND** runtime MUST decide recovery replay eligibility before invoking capability; when replay is allowed it MUST use stable idempotencyKey
- **AND** result MUST 使用 capability invocation result contract 表达 status、structuredPayload、generatedMessages、contextPatch、artifact refs、safe error、fallbackTriggered 和 metadata

#### Scenario: Capability result consumption is explicit
- **WHEN** capability execution completes
- **THEN** structuredPayload MUST contain the safe structured result body that can be projected into model-visible capability result content
- **AND** capability invocation result contract MUST support optional resultRef for the complete result or external content when the result is too large, truncated, or unsuitable for inline projection
- **AND** capability invocation result contract MUST support artifactRefs for artifact metadata managed by artifact gateway for files, generated outputs, or Agent result attachments
- **AND** user-input attachments MUST be referenced through attachmentIds and authoritative RequestAttachment records unless they are explicitly converted into generated output artifacts
- **AND** generatedMessages MUST contain only USER-role messages
- **AND** generatedMessages with meta=true MUST be hidden from end-user presentation while still being eligible for later model context
- **AND** contextPatch MUST apply only to later model steps in the current request/run
- **AND** contextPatch MUST NOT permanently modify Agent assembly, session configuration, provider configuration, or capability catalog state
- **AND** contextPatch allowedTools MUST NOT expand beyond capabilities already authorized and visible for the current Agent
- **AND** contextPatch modelName and modelOptions MUST pass model selection and governance validation before use
- **AND** duration, audit linkage, and persisted result message id MUST be produced by runtime, wrapper, timeline, audit, or gateway layers rather than capability executor output

#### Scenario: Tool 幂等声明默认为否
- **WHEN** capability descriptor 表示 Tool capability
- **THEN** Tool MUST 默认不支持恢复重放幂等
- **AND** 只有显式声明幂等且提供稳定 operation/idempotency boundary 的 Tool 才能在恢复场景中被 runtime 重新发起调用

### Requirement: Gateway Port And Durable Fact Baseline
TS 后端 MUST 在核心契约中定义 gateway logical ports，而不是暴露具体 adapter、数据库、文件路径或 remote SDK。Gateway ports MUST 支持 session、message、active context、RequestRun、timeline、checkpoint、attachment、blob、artifact、pending input 和 feedback 等 durable facts 的最小读写边界，并提供 owner-scoped request、optimistic version、claim/fencing 和 idempotent terminal write 的语义。Gateway ports MUST use `*Record` persistence DTOs as their request/return data shape and MUST NOT depend on upper-layer domain objects such as RequestRun、SessionMessage、RunTimelineEvent、RequestAttachment、CheckpointPayload、PendingInput or Feedback. RequestRun、active context、checkpoint、attachment、blob、pending input 和 feedback 的持久化端口 MUST 分别命名为 RequestRunStoreGateway、ActiveContextStoreGateway、CheckpointStoreGateway、AttachmentStoreGateway、BlobStoreGateway、PendingInputStoreGateway 和 FeedbackStoreGateway。

#### Scenario: 上层模块只依赖 logical gateway port
- **WHEN** runtime、session、channel、context、capability 或 observability 需要持久化或查询 durable fact
- **THEN** 该模块 MUST 依赖 gateway logical port
- **AND** 该模块 MUST NOT 直接依赖具体数据库 driver、local path layout、remote endpoint SDK 或 adapter-private query object

#### Scenario: Gateway ports use Record DTOs
- **WHEN** gateway port reads, writes, claims, hides, resolves or commits a durable fact
- **THEN** the gateway request and return types MUST use gateway-owned `*Record` DTOs
- **AND** gateway contracts MUST NOT import or expose upper-layer domain objects as store request or return values
- **AND** gateway record DTOs MUST use foundation vocabulary owned by `agent-common` when they need shared id、time、JSON、owner or shared durable vocabulary fields
- **AND** gateway record DTOs MUST NOT import upper-domain subpath enum or DTO types
- **AND** session、attachment、pending-input and content-specific record fields MUST use gateway-owned record value types or `agent-common` foundation types
- **AND** domain modules MUST map between their DOs/read models and gateway Records at the module boundary
- **AND** gateway adapters MUST store and return Records without enforcing domain state machines or lifecycle policies

#### Scenario: Owner-scoped request 和 CAS 结果保持简单
- **WHEN** gateway port 读取或写入 owner-scoped durable fact
- **THEN** request MUST 直接包含 tenantId and subjectId, including unique-id lookup requests
- **AND** core contracts MUST NOT define a generic OwnerScope or GatewayLookupRequest base object
- **AND** system recovery or maintenance scans MUST use explicitly named system-scoped ports and MUST NOT reuse owner-scoped lookup contracts
- **AND** ordinary persistence writes MUST return the persisted object when the caller needs a value
- **AND** run version update、claim/fencing and pending input resolve MUST use a CAS result that distinguishes updated、version conflict and not found
- **AND** terminal commit MUST use a dedicated result that distinguishes committed、already committed、version conflict and not found
- **AND** infrastructure failures MUST be represented as gateway errors normalized by the error boundary, not as CAS result statuses

#### Scenario: Session and conversation stores expose client history read models
- **WHEN** channel lists sessions or loads a session conversation
- **THEN** core contracts MUST define SessionStoreGateway with loadSession、listSessions and saveSession operations
- **AND** listSessions MUST use gateway-owned SessionHistoryRecordQuery and return SessionHistoryRecordPage
- **AND** core contracts MUST define SessionMessageStoreGateway with saveMessage、loadMessage、listConversationMessages、listCurrentRequestMessages and hideMessage operations
- **AND** listConversationMessages MUST use gateway-owned SessionConversationRecordQuery and return SessionConversationRecordPage
- **AND** listCurrentRequestMessages MUST use CurrentRequestConversationRecordQuery and return SessionConversationRecordPage
- **AND** core contracts MUST define ActiveContextStoreGateway with loadActiveContext、appendItem and commitCompaction operations
- **AND** active context append and compaction commit MUST use activeContextVersion for optimistic conflict detection
- **AND** SessionHistoryRecordQuery、SessionConversationRecordQuery、CurrentRequestConversationRecordQuery、active context requests and message lookup/write requests MUST carry tenantId and subjectId

#### Scenario: Session message visibility is updated through hideMessage only
- **WHEN** runtime hides a superseded or replaced conversation message from the default history view
- **THEN** SessionMessageStoreGateway MUST expose hideMessage(HideMessageRequest)
- **AND** HideMessageRequest MUST contain tenantId、subjectId、messageId、reason、hiddenByContextId and idempotencyKey
- **AND** hiddenByContextId MUST be a RequestContextId
- **AND** hiddenAt MUST be assigned by the store using a controlled clock
- **AND** saveMessage MUST NOT modify visibility fields of an existing message
- **AND** hideMessage MUST be one-way and MUST NOT support unhide
- **AND** hiding an already hidden message MUST return the current persisted message without overwriting the original hide metadata
- **AND** hiding a missing message MUST return undefined
- **AND** default history queries MUST exclude hidden messages unless includeHidden is explicitly true
- **AND** visible=false MUST NOT be used as the model context removal mechanism; active context view owns model-visible context

#### Scenario: Timeline events use a durable store gateway
- **WHEN** runtime appends or queries canonical timeline events
- **THEN** core contracts MUST define RunTimelineEventStoreGateway
- **AND** appendEvent MUST use RunTimelineEventAppendRequest and return RunTimelineEventRecord
- **AND** listEvents MUST use RunTimelineEventRecordQuery and return RunTimelineEventRecord records
- **AND** RunTimelineEventRecordQuery MUST use sessionId and afterSequence, with optional requestId and runId filters
- **AND** RunTimelineEventStoreGateway MUST NOT be represented by execution trace storage or channel replay buffers

#### Scenario: Attachment metadata and blob content use separate ports
- **WHEN** attachment runtime stores, validates, queries or cleans up uploaded content
- **THEN** core contracts MUST define AttachmentStoreGateway for RequestAttachmentRecord metadata, validationStatus, availabilityStatus and request/session/run association
- **AND** core contracts MUST define BlobStoreGateway as the shared opaque bytes store for attachments, artifacts, large capability results, model summaries and other large objects
- **AND** RequestAttachment.storageRef MUST be a BlobRef returned by BlobStoreGateway
- **AND** BlobRef MUST be opaque and MUST NOT be parsed, exposed as local path or treated as a business id by callers
- **AND** BlobStoreGateway MUST NOT own attachment status, artifact visibility, session/run binding, content parsing results or context descriptor generation
- **AND** attachment and artifact MUST remain separate durable facts with separate ids and metadata stores

### Requirement: Checkpoint Recovery Contract Baseline
TS 后端 MUST 在核心契约中定义 checkpoint payload、checkpoint write idempotency key 和 recovery-safe boundary。Checkpoint save 可以在最小内核中使用 no-op provider，但主流程 MUST 通过目标 CheckpointStoreGateway 发起调用。

#### Scenario: Checkpoint payload 具备恢复锚点
- **WHEN** runtime 保存 checkpoint
- **THEN** checkpoint payload MUST 包含 checkpointId、sessionId、requestId、runId、requestContextId、runVersion、triggerReason、lastSequence、activeContextVersion、flowVariables 和 savedAt
- **AND** checkpoint write MUST 包含 idempotencyKey
- **AND** triggerReason MUST be one of `RUN_ACCEPTED`、`STEP_STARTED`、`CAPABILITY_BEFORE_CALL`、`CAPABILITY_AFTER_RETURN`、`CONTEXT_COMPACTED`、`TERMINAL_COMMIT_PENDING`、`TERMINAL_COMMITTED`、`TERMINAL_PENDING_COMMIT_TAKEOVER`
- **AND** checkpoint payload MUST NOT persist complete toolCallStates or messageRefs
- **AND** recovery MUST use checkpoint runVersion、triggerReason、lastSequence and activeContextVersion as validation anchors, then rebuild RequestContext tool batch state from persisted assistant tool-use messages and capability result messages for the same session、requestId and runId

#### Scenario: Checkpoint lookup 使用 run 级锚点
- **WHEN** runtime 加载 checkpoint 用于恢复
- **THEN** lookup request MUST 包含 sessionId、requestId 和 runId
- **AND** runId MUST NOT be optional
- **AND** CheckpointStoreGateway MUST expose loadCheckpoint rather than latest-checkpoint lookup semantics

#### Scenario: 最小内核使用 no-op checkpoint provider
- **WHEN** 最小内核运行一次不依赖真实 checkpoint 恢复的问答
- **THEN** runtime MUST 仍调用 CheckpointStoreGateway.saveCheckpoint
- **AND** no-op provider MUST 返回成功或可诊断的 no-op outcome
- **AND** no-op provider MUST NOT 改变主流程调用语义

### Requirement: Hook And Pending Boundary Baseline
TS 后端 MUST 在核心契约中保留 lifecycle hook 和 human interaction pending boundary 的最小形态。Hook MUST 能在 request、planning、model、capability、context compact 和 terminal stages 接入；需要用户澄清、确认、授权或人工接管时，系统 MUST 使用 runtime-owned pending input boundary。核心契约 MUST NOT 定义泛化 `PolicyPort`；risk、routing、context budget 和 model selection policy MUST 由后续具体 change 定义各自接口。

#### Scenario: Lifecycle hook stages 稳定
- **WHEN** runtime、core、context engine 或 capability 到达 request acceptance、planning、model invocation、model result、capability invocation、capability result、context compact 或 terminal event 前后的 hook point
- **THEN** 系统 MUST 使用核心契约中的 hook stage 标识和 hook input
- **AND** 未注册 hook 时 default provider MUST 表现为空执行

#### Scenario: Lifecycle hook 声明和绑定分离
- **WHEN** Agent 装配 lifecycle hook
- **THEN** hook definition MUST describe hookId、name、source、kind、supportedStages、defaultOrder、defaultTimeoutMs、executionMode、failureMode 和 defaultConfig
- **AND** Agent hook binding MUST describe bindingId、agentId、hookId、enabled、stages、order、timeoutMs 和 config
- **AND** binding MUST NOT modify kind、executionMode、failureMode、source 或 hook 支持边界
- **AND** binding stages MUST be empty or a subset of definition supportedStages
- **AND** SYSTEM hooks MUST run before CUSTOM hooks
- **AND** SYSTEM hooks MUST NOT be disabled by Agent hook binding
- **AND** SYSTEM hooks MUST use FAIL failureMode
- **AND** failureMode MUST be CONTINUE or FAIL
- **AND** failureMode MUST apply only to hook timeout, hook failure, missing hook handler, or invalid hook result
- **AND** hook REJECT and PEND decisions MUST be treated as normal control decisions rather than hook failures

#### Scenario: Hook execution deterministic reduction
- **WHEN** multiple blocking lifecycle hooks are registered for the same stage
- **THEN** runtime MUST invoke them synchronously in deterministic order by kind, then order, then hookId
- **AND** runtime MUST apply a valid mutation to the effective boundary before invoking the next blocking hook
- **AND** runtime MUST stop invoking subsequent blocking hooks when a hook returns REJECT or PEND
- **AND** runtime MUST NOT require parallel decision or mutation merge semantics in the first release
- **AND** NON_BLOCKING hooks MUST be observe-only and MUST NOT control flow or mutate boundaries

#### Scenario: Hook 只通过控制信号和边界 mutation 影响 runtime
- **WHEN** hook 被调用
- **THEN** hook input MUST include hookId、optional bindingId、agentId、agentVersion、stage、stage-specific HookBoundary 和 config
- **AND** hook result contract MUST support optional decision、pendingInputIntent、mutation、safeReason and SafeError fields
- **AND** hook observation MUST be performed by hook implementation itself and MUST NOT require runtime to execute observation from hook result
- **AND** mutation MUST match the current lifecycle stage boundary before runtime applies it
- **AND** effective boundary MUST be produced by runtime after applying a valid mutation, not returned as authoritative hook state
- **AND** missing mutation MUST be treated as no-op
- **AND** NO_OPINION and APPROVE decisions MUST allow flow to continue
- **AND** REJECT decision MUST stop the current flow and MUST include a safeReason
- **AND** PEND decision MUST stop the current flow and MUST include pendingInputIntent
- **AND** when REJECT or PEND is returned with mutation, runtime MUST ignore the mutation and honor the control decision

#### Scenario: Hook boundary and mutation base contracts stay minimal
- **WHEN** core contracts define HookBoundary and BoundaryMutation
- **THEN** the base contracts MUST NOT include payload、patch 或 duplicated stage fields
- **AND** stage MUST remain on HookInput as the invocation coordinate
- **AND** concrete stage boundary and mutation schemas MUST be defined by the lifecycle hook execution change
- **AND** requestContextId MUST NOT be part of generic HookInput

#### Scenario: Hook invocation event is observability evidence
- **WHEN** runtime invokes a lifecycle hook
- **THEN** runtime MUST emit a structured HookInvocationEvent with requestRunId、sessionId、requestId、agentId、agentVersion、hookId、optional bindingId、stage、status、timing、decision、safe reason/error and mutation summary when available
- **AND** runtime MUST publish structured logs and hook metrics for invocation count、latency、timeout and failure outcomes
- **AND** HookInvocationEvent MUST NOT be treated as a core business persistence object
- **AND** HookInvocationEvent MUST NOT be treated as a canonical timeline event
- **AND** runtime MUST NOT provide a first-release hook invocation query API
- **AND** mutationSummary MUST include only the mutation type or stable mutation kind and changed field names, never field values or full boundary/mutation/input/result content

#### Scenario: Hook decision enters timeline only when it changes lifecycle
- **WHEN** a hook decision changes request lifecycle by rejecting the flow or pending for user/system input
- **THEN** runtime MUST publish timeline-only HOOK_DECISION_APPLIED with safe hook id、optional binding id、stage、decision、safe reason and related pending/terminal refs when available
- **AND** runtime MUST NOT publish HOOK_DECISION_APPLIED for every hook invocation
- **AND** hook timeout or failure that does not change request lifecycle MUST remain in HookInvocationEvent、structured logs、metrics or audit sink only

#### Scenario: Pending input 由 runtime 拥有
- **WHEN** model、hook、policy、Tool、Skill、Agent capability 或 runtime 需要用户输入、确认、授权或人工接管
- **THEN** 该交互 MUST 使用 runtime-owned pending input contract
- **AND** channel 只负责展示和提交 answer
- **AND** capability 不得创建私有 pending lifecycle

#### Scenario: Pending input 边界对象保持精简
- **WHEN** runtime 创建 pending input
- **THEN** 持久化对象 MUST 只保存 pendingInputId、requestRunId、sessionId、requestId、requestContextId、checkpointId、kind、questions、timeoutAt、status、createdAt、updatedAt 和 responseAnswers
- **AND** 发给客户端的 request MUST 只包含 id、sessionId、kind、questions 和 timeoutAt
- **AND** 客户端提交的 answer MUST 只包含 sessionId、pendingInputId 和按问题顺序排列的 answers
- **AND** answers MUST 使用 string 二维数组表达，外层数组与 questions 顺序一致，内层数组保存单选、多选或自定义文本结果
- **AND** identity、idempotency key、audit linkage、timeout behavior、origin、run version、step id、answer schema 和 model-formatted answer MUST NOT 出现在 pending input 客户端 answer 或核心持久化对象中

#### Scenario: Pending input answer enters runtime through command boundary
- **WHEN** channel submits a pending input answer to runtime
- **THEN** runtime command MUST include trusted IdentityContext and idempotencyKey injected by the channel/auth boundary
- **AND** runtime MUST resolve the pending input to RECEIVED through the runtime-owned pending lifecycle
- **AND** channel MUST NOT provide identity through the client answer payload

### Requirement: Agent Core Execution Boundary
TS 后端 MUST 在核心契约中定义 runtime 调用 Agent core 的执行边界。Agent MUST 通过 runtime 提供的 timeline port 发布中间事件和最终 agent message；runtime MUST 拥有 RequestRun lifecycle 和 runtime terminal event。

#### Scenario: Runtime invokes Agent core
- **WHEN** runtime accepts a request and creates a RequestRun
- **THEN** runtime MUST invoke Agent.execute with run、context、timeline and signal
- **AND** Agent.execute MUST return Promise<void>
- **AND** normal resolution MUST mean Agent execution completed
- **AND** rejection or thrown error MUST be normalized by runtime into the request failure path

#### Scenario: Agent publishes execution facts through timeline
- **WHEN** Agent produces planning、model、capability、pending-input-related or final agent message facts
- **THEN** Agent MUST publish them through RunTimelineEventPort.emit
- **AND** RunTimelineEventPort.emit MUST return Promise<void>
- **AND** Agent MUST publish the final agent message through the timeline rather than returning final answer content from execute
- **AND** Agent MUST NOT publish REQUEST_COMPLETED、REQUEST_FAILED、REQUEST_CANCELED or REQUEST_SUPERSEDED terminal lifecycle events
- **AND** runtime MUST publish terminal lifecycle events based on Agent.execute completion, failure, cancellation or supersession

### Requirement: Agent Assembly And Routing Skeleton
TS 后端 MUST 在核心契约中保留 runtime-facing Agent assembly 和 request routing skeleton。Agent assembly MUST 表达 agent id/version、已校验 workspace、model profile ids、prompt template ids、已启用 capability bindings 和最小 runtime settings。Request routing MUST 位于 Agent 内部，并输出 deterministic flow、model-driven loop、clarify、reject、human handoff 或 directed capability flow 等受控 decision。

#### Scenario: Agent assembly 提供运行期输入
- **WHEN** app composition 或 Agent loader 装配 Agent
- **THEN** runtime-ready AgentAssembly MUST contain agentId、agentVersion、displayName、description、workspaceDir、modelProfileIds、promptTemplateIds、capabilityBindings and runtimeSettings
- **AND** workspaceDir MUST be resolved and validated before entering runtime-facing assembly
- **AND** capabilityBindings MUST contain only enabled bindings
- **AND** each capability binding MUST contain capabilityId、capabilityType and providerId
- **AND** AgentAssembly MUST NOT contain raw Agent definition, provider configuration, capabilityProviderRefs, routingHints, hook bindings, disabled capability bindings, deny rules, shadowing records, raw paths outside workspaceDir, provider secrets, prompt contents, model profile details, or Skill/SubAgent package contents
- **AND** Agent package inputs such as agent.yaml、skills/、subagents/ and prompts/ MUST be compiled before producing runtime-ready AgentAssembly

#### Scenario: Agent assembly registry resolves runtime-ready assemblies
- **WHEN** runtime accepts a request for an Agent id without an already resolved Agent version
- **THEN** runtime MUST resolve the current active AgentAssembly through AgentAssemblyRegistry.active(agentId)
- **AND** runtime MUST persist the resolved agentId、agentVersion and agentAssemblyRef in RequestRun and RequestContext
- **AND** once a request is accepted, runtime recovery、context engine、core and capability routing MUST resolve the same assembly through AgentAssemblyRegistry.require(agentId, agentVersion)
- **AND** active version selection MUST NOT be used for an already accepted request or recovery path
- **AND** AgentAssemblyRegistry MUST return runtime-ready AgentAssembly, not raw Agent package definitions or manifests
- **AND** missing assembly resolution MUST fail with an explicit missing assembly or not found error and MUST NOT fall back to a default Agent
- **AND** modules that need runtime-ready assembly resolution MUST depend on AgentAssemblyRegistry directly or on assembly-scoped wrappers derived from it, and MUST NOT parse Agent package files or own assembly compilation
- **AND** core contracts MUST NOT define a persistent assembly store, lazy compilation, hot reload, gray release or same-version snapshot id

#### Scenario: Routing 不在 channel 前置
- **WHEN** request 已通过 runtime 接受并进入 Agent 处理
- **THEN** Agent 内部 routing policy MUST 选择受控 routing decision
- **AND** channel 和 runtime MUST NOT 在 Agent 前绕过 routing policy 直接选择业务 Skill、Tool 或 Agent capability

### Requirement: Configuration And Secret Reference Baseline
TS 后端 MUST 在核心契约中定义 app configuration、model profile、gateway adapter 和 capability provider 的最小边界。产品配置 MUST 使用 `agent-common` 中的 secret reference，而不是 raw secret value。Fake/test provider MUST 只能作为测试 fixture，不得进入产品配置 contract。

#### Scenario: Model profile 配置稳定
- **WHEN** app 读取 model provider configuration
- **THEN** model profile MUST 至少包含 profileId、providerKind、modelName、baseUrl、apiKeySource、timeoutMs、enabled 和 fallbackEligible
- **AND** providerKind MUST 受产品配置允许列表约束
- **AND** raw API key MUST NOT 出现在日志、stream、audit、safe error 或模型上下文

#### Scenario: Secret reference 只表达来源
- **WHEN** app、gateway adapter、capability provider 或 model profile 需要引用 secret
- **THEN** secret reference MUST 使用 `env:` 或 `file:` 引用语法
- **AND** secret reference MUST NOT 表达 raw secret value、inline secret 或无凭据哨兵值
- **AND** 如果引用内容使用 `ENC(...)` 或等价加密 envelope，解密 MUST 由 secret resolver 或 adapter 在最底层处理，且解密密钥 MUST 来自独立 secret source

#### Scenario: Gateway 和 capability provider 使用安全配置
- **WHEN** app 配置 gateway adapter 或 capability provider
- **THEN** configuration contract MUST 表达 adapter/provider id、enabled state、endpoint/baseUrl、timeout/retry 和 credential reference
- **AND** custom capability provider configuration MUST include non-empty providerType and MUST resolve to an app-composition registered provider adapter before it can contribute executable descriptors
- **AND** unavailable dependency MUST produce a safe unavailable error; if degradation is supported it MUST be expressed through an explicit degradation event or result rather than an availability state

### Requirement: Audit And Error Observability Baseline
TS 后端 MUST 在核心契约中定义 audit event、audit writer、error normalizer 和安全诊断约束。核心契约 MUST NOT 定义独立 execution trace 对象、通用 observability facade、metric record、trace id 字段、span id 字段或 tracing/metrics/logging SDK 类型。Request、model、capability、gateway、hook、policy、checkpoint、terminal commit 和 safe error MUST 优先通过 sessionId、requestRunId、messageId、timeline event id、capability invocation id 和 audit id 关联；调用链、日志和指标关联由 observability 实现层处理。

#### Scenario: 可观测字段不污染领域契约
- **WHEN** request 从 channel 进入 runtime 并经过 core、context、model、capability、gateway 和 terminal commit
- **THEN** 核心领域对象 MUST 优先使用 sessionId、requestRunId、messageId、timeline event id 和 capability invocation id 表达业务事实关联
- **AND** trace id、span id、tracer、meter、logger 和 SDK context MUST 由 observability 实现、日志、trace 或 audit sink 处理，不得进入核心领域 DTO 或要求每个核心 DTO 携带统一诊断上下文对象

#### Scenario: 指标由实现层记录
- **WHEN** 系统记录 request、model 或 capability metrics
- **THEN** request 和 capability metrics MUST 在 observability 实现层保留响应时间维度
- **AND** model metrics MUST 在 observability 实现层保留 token usage 维度
- **AND** metric attributes MUST NOT 包含 raw user content、raw secret 或未脱敏 capability args

#### Scenario: 观测采集不侵入业务核心
- **WHEN** implementation packages 为 request lifecycle、transport、model、capability、gateway、sandbox、checkpoint、audit writer、hook executor、pending input 或 context compact 增加 tracing、metrics 或 structured logging
- **THEN** required cross-cutting collection MUST be implemented through middleware/interceptor、port decorator、auto-instrumentation、timeline/event subscriber or another approved observability extension point
- **AND** core business modules MUST NOT depend on tracing、metrics、logging SDK/API types
- **AND** ad hoc operational logs、manual spans 和 manual metrics MUST NOT 出现在业务核心路径中 unless they use an approved observability extension point
- **AND** 如果显式业务日志不可避免，MUST 使用 approved structured logging helper 并遵守 redaction policy

#### Scenario: 审计事件只包含安全摘要
- **WHEN** runtime、capability、hook、policy、checkpoint、terminal commit 或反馈流程需要记录审计事实
- **THEN** 该事实 MUST 使用 AuditEvent 和 AuditEventWriter 表达
- **AND** AuditEvent MUST 包含 auditId、eventName、tenantId、subjectId、可选 requestRunId、可选 capabilityInvocationId、safeSummary、attributes 和 occurredAt
- **AND** AuditEvent.safeSummary 和 attributes MUST NOT 包含 raw prompt、thinking、model output、tool args、tool result、附件内容、secret、credential、未脱敏路径或未授权对象内容

### Requirement: Contract Verification Baseline
TS 后端 MUST 为核心契约建立 contract tests、architecture boundary tests 和 smoke tests。测试 MUST 验证核心 vocabulary、schema compatibility、owner scope、安全错误、gateway conditional result、capability descriptor、stream projection 和 no-op provider 调用边界。

#### Scenario: Contract tests 阻止契约漂移
- **WHEN** 核心 enum、DTO、port 或 schema skeleton 发生变化
- **THEN** contract tests MUST 验证 public contract 的稳定性和预期变化
- **AND** 未通过 contract tests 的变更 MUST NOT 进入最小内核实现

#### Scenario: Architecture tests 阻止实现泄漏
- **WHEN** package dependency graph 被检查
- **THEN** tests MUST 验证 `agent-contracts` 不依赖 implementation package
- **AND** implementation package 不得通过 private 类型建立反向或横向跨包契约
