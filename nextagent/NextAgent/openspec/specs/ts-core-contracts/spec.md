# ts-core-contracts Specification

## Purpose
定义 TS 后端最小内核和并行配件开发共享的核心运行时、事件、上下文、模型、能力、网关、安全、恢复和观测契约。
## Requirements
### Requirement: Core Contract Namespace

TS 后端 MUST 提供 `agent-common` foundation package 和 `agent-contracts` boundary namespace，承载最小内核和后续并行 change 共享的基础类型、public DTO、enum、port 和 schema skeleton。核心 value object、DTO、enum 和 port MUST 具备稳定名称、必需字段和调用签名。实现模块 MUST 通过 `agent-common` 使用共享 id、value object、语言/区域、身份、secret reference、安全错误形态和被多个边界共同消费的基础 enum，并通过 `agent-contracts` 交换 runtime、channel、session、attachment、context、model、capability、core、gateway、observability 和 app 契约，不得通过实现包 private 类型建立跨模块契约。

#### Scenario: 实现包消费核心契约

- **WHEN** runtime、channel、session、core、context、model、capability、memory、gateway、observability 或 app package 需要跨模块交换请求、状态、事件、结果或诊断
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
- **AND** identity、timeline、checkpoint、pending-input、hook、sandbox、content、errors、configuration and conversation annotation MUST NOT be introduced as separate owning subpaths unless a later architecture change creates a distinct owning module for that boundary
- **AND** `agent-contracts/channel` MUST own `LongTermMemoryManagementPort` and its management DTOs for the Channel-facing long-term-memory boundary, without importing or duplicating Gateway persistence contracts
- **AND** checkpoint payload、pending input、hook lifecycle and timeline contracts MUST be owned by `agent-contracts/runtime`
- **AND** content references and artifact metadata domain contracts MUST be owned by `agent-contracts/session`
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

- **WHEN** 团队实现 runtime、channel、context、model、capability、memory、gateway、sandbox、hook、checkpoint、observability 或 app composition 的跨模块边界
- **THEN** 核心 contract namespace MUST 提供对应 public DTO、enum、schema 和 port signature
- **AND** contract tests MUST 能校验这些 public contract 的必需字段、enum vocabulary 和方法签名没有发生未声明漂移

#### Scenario: 后续 change 扩展核心契约

- **WHEN** 后续 change 需要改变 runtime command、event vocabulary、owner scope、safe error、capability descriptor、long-term-memory management port、gateway port 或其他共享契约
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

### Requirement: Capability invocation runtime context supports safe in-flight result delta emission

TS 后端 MUST 允许 capability invocation caller 通过 `CapabilityInvocationRuntimeContext` 向下游 executor 提供一个安全的 in-flight result delta 发射入口。该入口用于在同一次 capability 调用尚未完成时，把累计的用户可见结果状态投影到 canonical timeline / stream；它 MUST 只承载安全、bounded、可序列化的 `JsonObject`，不得承载 raw provider chunk、credential、runtime-owned message id、timeline sequence 或其他高基数字段。

当 caller 未提供该入口时，capability invocation MUST 保持现有单次终态结果行为，不得因为缺少 delta emitter 而使调用失败。

#### Scenario: Invocation without delta emitter keeps current behavior

- **WHEN** `CapabilityInvocationPort.invoke(...)` 在没有 in-flight result delta emitter 的 `CapabilityInvocationRuntimeContext` 下执行
- **THEN** capability invocation MUST 保持现有行为
- **AND** capability executor MUST 仍然可以只返回终态 `CapabilityInvocationResult`

#### Scenario: Invocation with delta emitter forwards safe cumulative deltas

- **WHEN** caller 在 `CapabilityInvocationRuntimeContext` 中提供了安全 result delta emitter
- **AND** downstream builtin Tool 在调用期间发射一个或多个累计结果 delta
- **THEN** capability invocation path MUST 允许这些 delta 在 capability 完成前向上游传递
- **AND** 每个 delta MUST 表示该 capability 当前累计可见状态
- **AND** delta emitter MUST NOT 取代终态 `CapabilityInvocationResult`

#### Scenario: Timeline sequence is consistent across instances
- **WHEN** runtime assigns timeline event sequence in a single-instance or multi-instance deployment
- **THEN** the sequence MUST be greater than zero and MUST increase within the session timeline
- **AND** runtime MUST NOT wrap, reset, reuse, modulo or run-scope the sequence for the same session
- **AND** concurrent timeline events in the same session MUST NOT receive duplicate sequence values
- **AND** runtime MUST NOT publish same-session timeline events in a way that violates sequence order
- **AND** the core contract MUST NOT require a specific coordination mechanism

#### Scenario: Stream replay and history use different facts
- **WHEN** stream content is recovered after disconnect, refresh, or another device opening the session
- **THEN** runtime MUST recover runtime process facts from timeline events according to persistence and delta policies
- **AND** historical conversation display MUST use visible `SessionMessage` records as the final conversation content source
- **AND** stream replay MUST NOT reconstruct final conversation history from timeline events
- **AND** when delta or sequence continuity cannot restore an active display, the system MUST use a stream notice or equivalent safe outcome to trigger history refresh from visible messages

#### Scenario: Active run summary is available for bootstrap
- **WHEN** a session has a latest non-terminal `RequestRun`
- **THEN** `RuntimeSessionPort.getActiveRun(query: RuntimeGetActiveRunQuery)` MUST return `RuntimeActiveRunSummary { requestId, runId, status }`
- **AND** the summary MUST be derived from runtime-owned run state
- **AND** the summary MUST NOT be derived from frontend cache or conversation-message scanning

#### Scenario: Stream 从 timeline 投影
- **WHEN** channel 向用户发送 request stream
- **THEN** channel MUST 使用 `StreamEventType` 投影 canonical timeline 或 runtime status
- **AND** channel MUST NOT 发明与 canonical timeline 冲突的执行事实
- **AND** SSE 和 WebSocket 对同一 request MUST 暴露等价的 stream envelope、terminal event 和 error semantics
- **AND** stream envelope MUST carry eventId、sessionId、requestId、optional run/context refs、sequence、eventType、optional timeline event ref、transport hints、payload 和 createdAt
- **AND** requestId MUST identify the root user request message and `StreamEnvelope` MUST use requestId as its request correlation field
- **AND** when projected from a timeline event, timelineEventRef MUST reference the source timeline event id and payload MUST be the channel-safe projection of the timeline payload
- **AND** terminal state MUST be derived from `StreamEventType` rather than a separate envelope flag

#### Scenario: 事件 vocabulary 被校验
- **WHEN** contract tests 枚举 RunStatus、TimelineEventType 和 StreamEventType
- **THEN** tests MUST 验证 canonical vocabulary 中的状态和事件名称稳定
- **AND** degradation MUST NOT 作为 RunStatus value 表达，MUST 通过 timeline/stream event、result、safe error、audit event 或 observability metric 表达
- **AND** HOOK_INVOKED and POLICY_APPLIED MUST be timeline-only events and MUST NOT be part of first-release StreamEventType
- **AND** deprecated projection name MUST NOT 出现在 public stream contract 中

### Requirement: Capability Contract Baseline
TS 后端 MUST 把 Capability 定义为 Tool、Skill 和 Agent 的上位概念。核心契约 MUST 定义 capability descriptor、provider identity、version、availability、kind、compatibility metadata、input schema、safe extension metadata、invocation request/result、structured result payload、generated messages、context patch、artifact refs、timeout/cancellation boundary 和 idempotency declaration 的最小形态。公共 capability kind MUST 只使用 `TOOL`、`SKILL`、`AGENT`。

#### Scenario: Capability 进入统一 catalog
- **WHEN** bundled provider、本地目录、SkillHub、MCP server、Agent registry 或 app composition 注册的 custom provider 贡献 capability
- **THEN** provider MUST 通过 capability descriptor contract 进入统一 catalog
- **AND** descriptor MUST 声明 capability id、kind、provider identity、availability、safe description、compatibility metadata 和 invocation boundary refs
- **AND** descriptor contract MUST support optional version、supported languages、compatibility metadata and safe provider extension metadata
- **AND** provider kind MUST be one of `BUNDLED`、`LOCAL_DIRECTORY`、`SKILL_HUB`、`MCP_SERVER`、`AGENT_REGISTRY`、`CUSTOM`
- **AND** custom provider MUST include a non-empty providerType and MUST resolve to trusted composition-registered adapter support before any descriptor from that provider can be executable
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
TS 后端 MUST 在核心契约中定义 gateway logical ports，而不是暴露具体 adapter、数据库、文件路径或 remote SDK。Gateway ports MUST 支持 session、message、active context、RequestRun、timeline、checkpoint、attachment、blob、artifact、pending input 和 conversation annotation 等 durable facts 的最小读写边界，并提供 owner-scoped request、optimistic version、claim/fencing 和 idempotent terminal write 的语义。Gateway ports MUST use `*Record` persistence DTOs as their request/return data shape and MUST NOT depend on upper-layer domain objects such as RequestRun、SessionMessage、RunTimelineEvent、RequestAttachment、CheckpointPayload、PendingInput or ConversationAnnotation. RequestRun、active context、checkpoint、attachment、blob、pending input 和 conversation annotation 的持久化端口 MUST 分别命名为 RequestRunStoreGateway、ActiveContextStoreGateway、CheckpointStoreGateway、AttachmentStoreGateway、BlobStoreGateway、PendingInputStoreGateway 和 ConversationAnnotationStoreGateway。

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

#### Scenario: Session and message stores expose client history read models
- **WHEN** channel lists sessions or loads a session conversation
- **THEN** core contracts MUST define SessionStoreGateway with loadSession、listSessions and saveSession(record, options?) operations
- **AND** listSessions MUST use gateway-owned SessionHistoryRecordQuery and return SessionHistoryPage
- **AND** core contracts MUST define SessionMessageStoreGateway with appendSessionMessage、loadMessage、listMessages、listCurrentRequestMessages and hideMessage operations
- **AND** appendSessionMessage MUST be the only public message write contract for the minimal kernel
- **AND** listMessages MUST use gateway-owned ListSessionMessagesRecordQuery and return SessionMessageRecordPage
- **AND** listCurrentRequestMessages MUST use ListCurrentRequestMessagesRecordQuery and return SessionMessageRecordPage
- **AND** core contracts MUST define ActiveContextStoreGateway with loadActiveContext、appendItem and commitCompaction operations
- **AND** active context append and compaction commit MUST use activeContextVersion for optimistic conflict detection
- **AND** SessionHistoryRecordQuery、ListSessionMessagesRecordQuery、ListCurrentRequestMessagesRecordQuery、active context requests and message lookup/write records MUST carry tenantId、subjectId and agentId on main-path facts

#### Scenario: Session message visibility is updated through hideMessage only
- **WHEN** runtime hides a superseded or replaced conversation message from the default history view
- **THEN** SessionMessageStoreGateway MUST expose hideMessage(HideMessageRequest)
- **AND** HideMessageRequest MUST contain tenantId、subjectId、messageId、reason、hiddenByContextId and idempotencyKey
- **AND** hiddenByContextId MUST be a RequestContextId
- **AND** hiddenAt MUST be assigned by the store using a controlled clock
- **AND** appendSessionMessage MUST NOT modify visibility fields of an existing message
- **AND** SessionMessageStoreGateway MUST NOT expose standalone saveMessage as a public message write contract
- **AND** hideMessage MUST be one-way and MUST NOT support unhide
- **AND** hiding an already hidden message MUST return the current persisted message without overwriting the original hide metadata
- **AND** hiding a missing message MUST return undefined
- **AND** default history queries MUST exclude hidden messages unless includeHidden is explicitly true
- **AND** visible=false MUST NOT be used as the model context removal mechanism; active context view owns model-visible context

#### Scenario: Timeline events use a durable store gateway
- **WHEN** runtime appends or queries canonical timeline events
- **THEN** core contracts MUST define RunTimelineEventStoreGateway
- **AND** appendEvent MUST use RunTimelineEventRecord plus write options and return RunTimelineEventRecord
- **AND** listEvents MUST use RunTimelineEventRecordQuery and return RunTimelineEventRecord records
- **AND** RunTimelineEventRecordQuery MUST use tenantId、subjectId、agentId、sessionId and afterSequence, with optional requestId and runId filters
- **AND** RunTimelineEventStoreGateway MUST NOT be represented by execution trace storage or channel replay buffers

#### Scenario: Attachment metadata and blob content use separate ports
- **WHEN** attachment runtime stores, validates, queries or cleans up uploaded content
- **THEN** core contracts MUST define AttachmentStoreGateway for RequestAttachmentRecord metadata, validationStatus, availabilityStatus and request/session/run association
- **AND** core contracts MUST define BlobStoreGateway as the shared opaque bytes store for attachments, artifacts, model summaries and other blob-backed large objects; oversized textual capability results are externalized to execution workspace files by the `large-content-references` / `large-content-readback` capabilities so the existing `read` tool can page them without exposing blob ids
- **AND** RequestAttachment.storageRef MUST be a BlobRef returned by BlobStoreGateway
- **AND** BlobRef MUST be opaque and MUST NOT be parsed, exposed as local path or treated as a business id by callers
- **AND** BlobStoreGateway MUST NOT own attachment status, artifact visibility, session/run binding, content parsing results or context descriptor generation
- **AND** attachment and artifact MUST remain separate durable facts with separate ids and metadata stores

### Requirement: Hook And Pending Boundary Baseline

TS 后端 MUST 在核心契约中保留 lifecycle hook 和 human interaction pending boundary 的最小形态。Hook MUST 能在 request、planning、model、capability、context compact 和 terminal stages 接入；需要用户澄清、确认、授权或人工接管时，系统 MUST 使用 runtime-owned pending input boundary。核心契约 MUST NOT 定义泛化 `PolicyPort`；risk、routing、context budget 和 model selection policy MUST 由后续具体 change 定义各自接口。

#### Scenario: Lifecycle hook stages 稳定
- **WHEN** runtime、core、context engine 或 capability 到达 request acceptance、planning、model invocation、model result、capability invocation、capability result、context compact 或 terminal event 前后的 hook point
- **THEN** 系统 MUST 使用核心契约中的 hook stage 标识和 hook input
- **AND** 未注册 hook 时 default provider MUST 表现为空执行

#### Scenario: Lifecycle hook object and Agent assembly activation are separated
- **WHEN** Agent 装配 lifecycle hook
- **THEN** developer-facing hook object MUST describe hookId、kind、supportedStages、effects、failureMode、optional order、optional timeoutMs、optional configSchema、optional configure and execute
- **AND** runtime-internal hook definition MUST describe hookId、kind、supportedStages、effects、derived executionStrategy、failureMode、order and timeoutMs
- **AND** AgentAssembly hook activation MUST describe only hookId、enabled、disabled、stages、order、timeoutMs and config
- **AND** activation MUST NOT modify kind、effects、executionStrategy、failureMode 或 hook 支持边界
- **AND** activation stages MUST be empty or a subset of definition supportedStages
- **AND** SYSTEM hooks MUST run before CUSTOM hooks
- **AND** SYSTEM hooks MAY be disabled by the current Agent with enabled=false or disabled=true
- **AND** SYSTEM hooks MUST use FAIL failureMode and framework-owned explicit order
- **AND** failureMode MUST be CONTINUE or FAIL
- **AND** failureMode MUST apply only to impact hook timeout, hook failure, missing hook handler, or invalid hook result
- **AND** hook DENY、BLOCK and PEND outcomes MUST be treated as normal control outcomes rather than hook failures

#### Scenario: Hook execution deterministic reduction
- **WHEN** multiple lifecycle hooks are effective for the same stage
- **THEN** runtime MUST run observe-only hooks in a bounded parallel observe group
- **AND** runtime MUST invoke impact hooks in deterministic order with SYSTEM before CUSTOM and CUSTOM before/after graph constraints
- **AND** runtime MUST apply a valid mutation to the effective boundary before invoking the next blocking hook
- **AND** runtime MUST stop invoking subsequent impact hooks when a hook returns DENY、BLOCK or PEND
- **AND** runtime MUST NOT require parallel impact outcome or mutation merge semantics
- **AND** observe-only hooks MUST NOT control flow or mutate boundaries

#### Scenario: Hook 只通过控制信号和边界 mutation 影响 runtime
- **WHEN** hook 被调用
- **THEN** hook input MUST include hookId、agentId、agentVersion、agentAssemblyRef、stage、stage-specific HookBoundary、safe idempotency key or digest and hookInvocationId
- **AND** hook result contract MUST support outcome、pendingInputIntent、mutation、safeReason and SafeError fields
- **AND** `HookDecision` and `HookResult.decision` MUST NOT remain public core contract fields
- **AND** mutation MUST match the current lifecycle stage boundary before runtime applies it
- **AND** effective boundary MUST be produced by runtime after applying a valid mutation, not returned as authoritative hook state
- **AND** missing mutation MUST be treated as no-op
- **AND** PASS and SKIP outcomes MUST allow flow to continue
- **AND** DENY and BLOCK outcomes MUST stop the current flow and SHOULD include a safeReason
- **AND** PEND outcome MUST stop the current flow and MUST include pendingInputIntent
- **AND** when DENY、BLOCK or PEND is returned with mutation, runtime MUST ignore the mutation and honor the control outcome

#### Scenario: Hook boundary and mutation base contracts stay minimal
- **WHEN** core contracts define HookBoundary and BoundaryMutation
- **THEN** the base contracts MUST NOT include payload、patch 或 duplicated stage fields
- **AND** stage MUST remain on HookInput as the invocation coordinate
- **AND** concrete stage boundary and mutation schemas MUST be defined by the lifecycle hook execution change
- **AND** requestContextId MUST NOT be part of generic HookInput

#### Scenario: Hook invocation timeline event is observability evidence
- **WHEN** runtime invokes a lifecycle hook
- **THEN** runtime MUST emit a timeline-only `HOOK_INVOKED` with requestRunId、sessionId、requestId、agentId、agentVersion、hookId、stage、kind、effects、executionStrategy、status、timing、outcome、safe reason/error and mutation summary when available
- **AND** runtime MUST publish structured logs and hook metrics for invocation count、latency、timeout and failure outcomes
- **AND** runtime MUST NOT expose a separate `HookInvocationEvent` contract or listener mechanism
- **AND** `HOOK_INVOKED` MUST NOT be projected as a public user conversation stream event by default
- **AND** runtime MUST NOT provide a first-release hook invocation query API
- **AND** mutationSummary MUST include the stage-derived mutation kind and changed field names, never field values or full boundary/mutation/input/result content

#### Scenario: Hook outcome recorded in HOOK_INVOKED
- **WHEN** a hook outcome changes request lifecycle by denying, blocking, or pending for user/system input
- **THEN** runtime MUST record the outcome in the `HOOK_INVOKED` timeline event
- **AND** runtime MUST NOT emit a separate `HOOK_OUTCOME_APPLIED` event
- **AND** hook timeout or failure that does not change request lifecycle MUST remain in `HOOK_INVOKED`、structured logs、metrics or audit sink only

#### Scenario: Pending input 由 runtime 拥有
- **WHEN** a lifecycle hook or a later explicitly defined upstream producer requests user input, confirmation, authorization or human handoff
- **THEN** the request MUST enter the runtime-owned pending input contract through a frozen producer boundary
- **AND** channel 只负责展示和提交 answer
- **AND** model output, client payload and capability-private state MUST NOT create or own pending lifecycle
- **AND** standalone policy logic, runtime-internal steps or capability governance MUST NOT become independent pending producers without a separate contract change
- **AND** a visible or durable partial pending input lifecycle MUST NOT be created unless the owning lifecycle also guarantees checkpoint-before-visible, same-session lane protection, and defined answer, cancel and timeout recovery paths

#### Scenario: Pending input 边界对象保持精简
- **WHEN** runtime 创建 pending input
- **THEN** 持久化对象 MUST 只保存 pendingInputId、requestRunId、sessionId、requestId、requestContextId、checkpointId、kind、questions、timeoutAt、status、createdAt、updatedAt、responseAnswers 和 runtime-owned `producerRef`
- **AND** `producerRef` MUST be limited to `{ kind: "LIFECYCLE_HOOK", stage?, toolCall? }` or `{ kind: "CAPABILITY_INVOCATION", capabilityId, toolCallId }`
- **AND** `producerRef` MUST be derived from trusted runtime/core execution context and MUST NOT be supplied by model output, client payload, channel metadata, capability args, gateway records or tool input
- **AND** lifecycle hook `toolCall` producer coordinates MAY carry only the resumable capability hook's capabilityId、toolCallId and JSON arguments snapshot needed to resume the same before-capability protected operation
- **AND** `producerRef` MUST NOT carry identity、owner scope、agent scope、policy、risk level、operation scope、idempotency key、timeout behavior、answer schema 或 capability-private state
- **AND** question 对象 MUST support optional `multiple`，仅表示该 question 的 answer entry 是否允许多个值，缺省 MUST 等价于 `false`
- **AND** question 对象 MUST support optional `custom`，仅表示该 question 是否允许非选项值文本，缺省 MUST 等价于 `false`
- **AND** 发给客户端的 request MUST 只包含 id、sessionId、kind、questions 和 timeoutAt
- **AND** 客户端提交的 answer MUST 只包含 sessionId、pendingInputId 和按问题顺序排列的 answers
- **AND** answers MUST 使用 string 二维数组表达，外层数组与 questions 顺序一致
- **AND** 文本题 answer entry MUST contain exactly one non-empty string
- **AND** 单选题 answer entry MUST contain exactly one string matching an allowed option unless `custom=true`
- **AND** 多选题 answer entry MAY contain multiple unique strings when the accepted question has `multiple=true`
- **AND** option question with `custom=true` MAY include at most one non-option custom text value
- **AND** single-select question with `custom=true` MUST contain exactly one total value, either one allowed option or one non-option custom text value
- **AND** multi-select question with `custom=true` MAY contain multiple unique allowed options and at most one non-option custom text value
- **AND** identity、idempotency key、audit linkage、timeout behavior、origin、run version、step id、answer schema 和 model-formatted answer MUST NOT 出现在 pending input 客户端 answer 或核心持久化对象中

#### Scenario: Pending input answer enters runtime through command boundary
- **WHEN** channel submits a pending input answer to runtime
- **THEN** runtime command MUST include trusted IdentityContext and idempotencyKey injected by the channel/auth boundary
- **AND** runtime MUST resolve the pending input to RECEIVED through the runtime-owned pending lifecycle
- **AND** channel MUST NOT provide identity or idempotency through the client answer payload

#### Scenario: Agent execution can pause for pending input
- **WHEN** Agent/core creates a pending input through a frozen runtime-owned handoff
- **THEN** `Agent.execute(...)` MUST return `AgentExecutionOutcome`
- **AND** `AgentExecutionOutcome` MUST be limited to `{ status: "COMPLETED" }` or `{ status: "PENDING_INPUT", pendingInput: PendingInputRequest }`
- **AND** `AgentExecutionOutcome.status="COMPLETED"` MUST be the only outcome that allows runtime to continue to the existing terminal commit path
- **AND** `AgentExecutionOutcome.status="PENDING_INPUT"` MUST mean a runtime-owned pending input fact has been created and the original run is paused but not terminal
- **AND** `PENDING_INPUT` MUST include the safe `PendingInputRequest` reference needed for projection
- **AND** `PENDING_INPUT` MUST NOT carry a reason, lifecycle stage, producerRef, toolCallId, resume hint or other producer coordinate
- **AND** runtime MUST NOT treat `PENDING_INPUT` as completed, failed or canceled
- **AND** `PENDING_INPUT` MUST NOT introduce a new `RunStatus`
- **AND** pending pause MUST NOT be represented by a normal thrown failure/control exception from Agent/core
- **AND** after a runtime-owned pending handoff returns successfully, Agent/core MUST immediately return `AgentExecutionOutcome.status="PENDING_INPUT"` before invoking later tool calls or appending an ordinary capability result
- **AND** runtime MUST stop the current dispatch before terminal output aggregation and terminal commit
- **AND** runtime MUST NOT treat the run as idle or completed for same-session dispatch while the pending lifecycle owns the pause
- **AND** runtime MUST NOT overwrite a same-run accepted active pending fact with completed or failed terminal facts because of the post-handoff Agent return path

#### Scenario: Capability invocation producer uses runtime-owned handoff
- **WHEN** a Capability invocation producer needs to submit a validated `PendingInputIntent`
- **THEN** Agent/core MUST call `AgentRunStatePort.requestPendingInput(run, context, intent)`
- **AND** the call MUST include the accepted `RequestRun`, trusted `RequestContext` and validated `PendingInputIntent`
- **AND** the method MUST return a safe `PendingInputRequest` on acceptance
- **AND** runtime MUST still perform final acceptance validation before the pending input becomes visible
- **AND** the method MUST NOT wait for a human answer
- **AND** the method MUST NOT return answer, terminal, resume or lifecycle-stage decisions
- **AND** the method MUST NOT expose a public Web command, gateway store API or capability-private wait/resume state
- **AND** the method MUST return `PendingInputRequest` only after acceptance succeeds
- **AND** if the owning runtime pending lifecycle is unavailable, checkpoint or pending acceptance fails, an active pending conflict exists, abort occurs, or an unexpected producer failure occurs, the method MUST fail closed through the existing runtime/capability safe failure path rather than returning `PendingInputRequest`
- **AND** a failed handoff MUST NOT create a partial pending input fact
- **AND** a failed handoff MUST NOT be converted into `AgentExecutionOutcome.status="PENDING_INPUT"`
- **AND** a failed handoff MUST NOT introduce a third `AgentExecutionOutcome` status
- **AND** ordinary `CapabilityInvocationPort.invoke(...)` failure semantics MUST continue to use existing `CapabilityInvocationResult.safeError` or producer-specific safe reason code paths

### Requirement: Agent Core Execution Boundary
TS 后端 MUST 在核心契约中定义 runtime 调用 Agent core 的执行边界。Agent MUST 通过 runtime-owned `AgentRunStatePort` 请求发布中间事件、追加执行期消息和保存 checkpoint；runtime MUST 拥有 RequestRun lifecycle、canonical timeline 和 runtime terminal event。

#### Scenario: Runtime invokes Agent core
- **WHEN** runtime accepts a request and creates a RequestRun
- **THEN** runtime MUST construct or provide an Agent with a runtime-owned `AgentRunStatePort`
- **AND** runtime MUST invoke `Agent.execute(run, context, signal)`
- **AND** runtime MUST NOT pass timeline or message ports through `Agent.execute`
- **AND** Agent.execute MUST return Promise<void>
- **AND** normal resolution MUST mean Agent execution completed
- **AND** rejection or thrown error MUST be normalized by runtime into the request failure path

#### Scenario: Agent publishes execution facts through runtime-owned run state
- **WHEN** Agent produces planning、model、capability、pending-input-related or final agent message facts
- **THEN** Agent MUST publish them through `AgentRunStatePort.emitEvent(run, context, event)`
- **AND** `AgentRunStatePort.emitEvent` MUST return Promise<void>
- **AND** Agent MUST publish the final agent message through runtime-owned run state rather than returning final answer content from execute
- **AND** Agent MUST NOT publish REQUEST_COMPLETED、REQUEST_FAILED、REQUEST_CANCELED or REQUEST_SUPERSEDED terminal lifecycle events
- **AND** runtime MUST publish terminal lifecycle events based on Agent.execute completion, failure, cancellation or supersession

### Requirement: Agent Assembly And Routing Skeleton

TS 后端 MUST 在核心契约中保留 runtime-facing Agent assembly 和 request routing skeleton。Agent assembly MUST 表达 agent id/version、已校验 workspace policy、canonical model ids、可选默认 model id、显式 capability binding facts 和最小 runtime settings。Prompt template availability、selection、fallback 和 prompt template identity MUST be owned by `agent-context-engine` registered prompt facts, not by runtime-facing `AgentAssembly` fields. Request routing MUST 位于 Agent 内部，并输出 deterministic flow、model-driven loop、clarify、reject、human handoff 或 directed capability flow 等受控 decision。

#### Scenario: Agent assembly 提供运行期输入

- **WHEN** app composition 或 Agent loader 装配 Agent
- **THEN** runtime-ready AgentAssembly MUST contain agentId、agentVersion、displayName、description、workspacePolicy、modelIds、capabilityBindings and runtimeSettings，并 MAY contain `defaultModelId`
- **AND** runtime-ready AgentAssembly MUST NOT contain `promptTemplateIds`
- **AND** AgentRuntimeSettings MUST NOT contain `defaultPromptTemplateId` 或 `defaultModelProfileId`
- **AND** workspacePolicy MUST be resolved and validated before entering runtime-facing assembly
- **AND** legacy package `workspaceDir` input MUST NOT enter runtime-facing AgentAssembly
- **AND** prompt-facing `workspaceDir` MUST equal the logical path `workspace/` when a downstream consumer needs the model-visible workspace directory
- **AND** physical workspace roots MUST be derived only by resolver-backed infrastructure, not stored on AgentAssembly
- **AND** capabilityBindings MUST contain explicit enabled or disabled binding facts
- **AND** each capability binding MUST contain capabilityId、capabilityType and providerId, and MAY contain optional enabled where a missing value means enabled=true
- **AND** AgentAssembly MUST NOT contain raw Agent definition, provider configuration, capabilityProviderRefs, routingHints, hook bindings, deny rules, shadowing records, raw workspaceDir, provider secrets, prompt template id allowlists, default prompt template ids, prompt contents, prompt root paths, prompt template refs, prompt binding/version summaries, model access/profile details beyond `modelIds/defaultModelId`, Skill/SubAgent package contents, or request/run-specific execution roots
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

### Requirement: Runtime owns request-carried RoutingConstraints contract
The system SHALL define request-carried `RoutingConstraints` under the `agent-contracts/runtime` boundary. `SubmitRequestCommand` and accepted `RequestContext` SHALL be able to carry optional `routingConstraints`. Runtime SHALL carry this typed value to Agent execution without interpreting business routing semantics.

#### Scenario: Submit command carries routing constraints
- **WHEN** channel/auth boundary constructs a request submission with allowed routing constraint fields
- **THEN** `SubmitRequestCommand` MAY carry `routingConstraints`
- **AND** accepted `RequestContext` MAY carry the same typed constraints for Agent Core
- **AND** runtime MUST NOT resolve a Skill, Tool, Agent capability, provider, model profile, or business path based on those constraints

#### Scenario: Request has no routing constraints
- **WHEN** channel/auth boundary constructs a request submission without routing constraints
- **THEN** `SubmitRequestCommand.routingConstraints` MAY be absent
- **AND** accepted `RequestContext.routingConstraints` MAY be absent
- **AND** the request lifecycle MUST preserve existing default routing behavior

### Requirement: Routing core contract shapes have a single owner
The system SHALL define the minimal routing-core contract shapes in the same contract refinement owner before downstream router changes consume them. Those shapes SHALL cover routing configuration, policy input, and policy result without introducing a new routing subpath or new decision kind.

#### Scenario: Routing config shape is declared
- **WHEN** downstream routing core needs trusted routing configuration
- **THEN** the contract owner MUST define a minimal shape equivalent to `AgentRoutingConfig`
- **AND** that shape MUST support `mode?: "default" | "policy"`
- **AND** when `mode=policy`, it MUST support `policy.method`
- **AND** in this change `policy.method` MUST be `policy:intent-recognition`

#### Scenario: Policy input and result shapes are declared
- **WHEN** downstream routing core needs policy input and output contracts
- **THEN** the contract owner MUST define minimal shapes equivalent to `AgentRoutingPolicyInput` and `AgentRoutingPolicyResult`
- **AND** policy input MUST be limited to accepted `run`, accepted `context`, frozen `agentAssembly`, and `signal`
- **AND** policy result MUST include a frozen routing `decisionKind` and `safeReason`
- **AND** policy result MAY include `skillName`
- **AND** `skillName` MUST NOT imply direct authorization or bypass governance

### Requirement: Runtime carries but does not govern RoutingConstraints
Runtime SHALL treat `routingConstraints` as request facts carried from submission to accepted execution context. Runtime SHALL NOT treat schema-valid constraints as authorization, policy decision, capability resolution, provider selection, or model selection.

#### Scenario: Runtime accepts constraints
- **WHEN** runtime accepts a request with typed `routingConstraints`
- **THEN** runtime MUST preserve the current trusted Agent Scope and Owner Scope
- **AND** runtime MUST pass typed constraints to Agent execution as request facts
- **AND** Agent Core routing policy remains responsible for later governance before use

#### Scenario: Downstream governance is unavailable
- **WHEN** routing constraint validation or targeted Skill routing is not implemented or unavailable
- **THEN** runtime MUST NOT substitute its own business governance
- **AND** it MUST NOT silently reinterpret constraints as routing authorization

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

### Requirement: Contract Subpaths Remain Architecture-Owned

TS core contracts SHALL remain consumable through architecture-owned public subpaths. A contract subpath SHALL represent a stable boundary owned by its module responsibility, not a catch-all shared type bucket.

#### Scenario: Product modules consume only authorized contract subpaths

- **WHEN** product packages import `agent-contracts`
- **THEN** they MUST import from explicit subpaths such as `agent-contracts/runtime`、`agent-contracts/channel` or `agent-contracts/model`
- **AND** product packages MUST NOT import from the `agent-contracts` root aggregate export
- **AND** each product package MUST consume only the subpaths authorized by `openspec/designs/architecture/ts-backend-architecture.md` and the corresponding `openspec/designs/modules/<module>.md`
- **AND** new subpath consumption MUST be introduced through an OpenSpec update that explains the architecture owner and cycle risk

#### Scenario: Agent assembly facts use a narrow contract subpath

- **WHEN** runtime、core、context or capability code needs accepted Agent assembly facts
- **THEN** it MUST consume `AgentAssembly`, `AgentCapabilityBinding`, `AgentRuntimeSettings` and `AgentAssemblyRegistry` from `agent-contracts/agent-assembly`
- **AND** `agent-contracts/agent-assembly` MUST NOT export the `Agent` execution interface, raw `AgentDefinition`, AgentDefinition parser/loader types, `AgentAssemblyCompiler`, `ResourceInventory`, `SystemConfig`, provider credentials, gateway config or channel config
- **AND** the `Agent` execution interface MUST remain in `agent-contracts/runtime`
- **AND** context and capability packages MUST NOT import `agent-contracts/runtime` only to obtain assembly facts

#### Scenario: Contracts do not encode convenience dependencies

- **WHEN** a module needs a type owned by another architecture boundary only because of current implementation convenience
- **THEN** the type MUST either move to the owning contract subpath, be exposed through a narrower owning port, or be passed by `agent-app` composition
- **AND** implementation convenience MUST NOT justify adding broad subpath imports such as core-to-gateway or context-to-runtime lifecycle dependencies

#### Scenario: Channel management contract does not duplicate Gateway contract

- **WHEN** Channel or another upper adapter needs user-facing long-term memory operations
- **THEN** it MUST consume `LongTermMemoryManagementPort` from `agent-contracts/channel`
- **AND** `agent-contracts/channel` MUST own long-term-memory management commands、queries、views and results
- **AND** `agent-contracts/gateway` MUST continue to own persistence Records、Gateway requests/queries、write options and Store/Retriever/Sharing ports
- **AND** neither subpath MUST re-export the other subpath's DTOs as aliases
- **AND** the dependency direction MUST remain `agent-channel-web -> agent-contracts/channel.LongTermMemoryManagementPort -> agent-memory implementation -> agent-contracts/gateway`, with `agent-app` limited to composition and wiring

#### Scenario: Equivalent cases use one policy

- **WHEN** two contract, persistence or runtime shapes share the same semantic category, lifecycle phase, boundary and safety/consistency invariants
- **THEN** they MUST use the same owner, naming rule, contract shape and validation strategy
- **AND** equivalent cases MUST NOT introduce parallel DTOs, Records, Requests, enums, ports, stores or helper APIs with the same semantics
- **AND** changing the policy for one equivalent case MUST update the OpenSpec design and apply the same policy to all equivalent cases in scope
- **AND** exceptions MUST be documented in OpenSpec design with the reason, owner, scope and verification path before implementation

#### Scenario: Shared durable vocabulary stays in common

- **WHEN** a scalar vocabulary is used by multiple contract subpaths such as a domain view and its gateway Record
- **THEN** the vocabulary MUST be defined once in `agent-common`
- **AND** `agent-common` MUST NOT define DO、DTO、Record、port or service contracts
- **AND** `agent-contracts/gateway` MUST NOT import sibling business subpaths such as `agent-contracts/session`、`agent-contracts/runtime`、`agent-contracts/attachment` or `agent-contracts/channel` only to reuse enum-like vocabulary
- **AND** gateway MUST NOT define duplicate `*RecordRole`、`*RecordType`、`*RecordKind` or `*RecordStatus` aliases for vocabulary that already exists in `agent-common`

#### Scenario: Runtime owns run message append boundary

- **WHEN** Agent core needs to append assistant tool-use, capability result or other execution-time session messages
- **THEN** it MUST call `AgentRunStatePort.appendMessage(run, context, draft)` from `agent-contracts/runtime`
- **AND** the appended content MUST be represented as a `SessionMessageDraft` from `agent-contracts/session`
- **AND** `SessionMessageDraft` MUST contain message content fields such as role、content、contentType、visible、metadata and a required idempotency key, not complete owner/agent/session/run/timestamp coordinates
- **AND** runtime implementation MUST combine trusted `RequestRun` and `RequestContext` with the draft before writing gateway records or appending active context
- **AND** Agent core MUST NOT import `agent-contracts/gateway` to persist intermediate messages

### Requirement: App Configuration Contract Refinement For Minimal Kernel
TS core contracts SHALL expose only stable runtime-facing configuration outcomes. Raw configuration DTOs, component config DTOs, AgentDefinition parser/loader types, resource inventory and assembly compiler input/output SHALL remain app-internal unless a downstream package has a concrete public contract need.

#### Scenario: App contracts do not become a configuration bus
- **WHEN** `agent-contracts/app` defines minimal-kernel app contracts
- **THEN** it MUST NOT export a catch-all `SystemConfig` that includes gateway, channel, observability, provider adapter, prompt, capability provider and Agent definition details in one public DTO
- **AND** it MUST NOT export component-owned adapter config DTOs such as SQLite driver config、Fastify listen config、OpenTelemetry/Pino wiring or no-op provider implementation config as a generic app contract
- **AND** it MUST NOT require runtime、core、context、model、capability、session or gateway public contracts to accept raw configuration input types
- **AND** app-local `SystemConfig`, `AgentDefinition`, resource registry and compiler input/output MAY exist inside `agent-app` when they are not consumed across package boundaries

#### Scenario: Runtime-facing contracts use compiled assembly and registries
- **WHEN** `agent-app` compiles product configuration for composition
- **THEN** the runtime-facing output MUST be a runtime-ready `AgentAssemblyRegistry` from `agent-contracts/agent-assembly` plus typed registries or ports required by downstream packages
- **AND** runtime-facing contracts MUST use `AgentAssemblyRegistry.active(agentId)` for acceptance and `AgentAssemblyRegistry.require(agentId, agentVersion)` after acceptance
- **AND** runtime-safe `AgentAssembly` MUST exclude raw config, loader/parser details, provider implementation, datasource/channel wiring and secrets
- **AND** product code MUST NOT bypass compiler output with hardcoded default assembly objects

### Requirement: User Session Contract Refinement For Minimal Kernel
TS core contracts SHALL refine user session contracts so public Web DTO compatibility names remain isolated in `agent-channel-web`, runtime owns Agent Scope resolution for session-facing Web flows, `agent-session` exposes domain `UserSessionPort`, and gateway contracts use canonical internal record fields with explicit owner and agent scope.

#### Scenario: Session domain port uses domain objects
- **WHEN** `agent-contracts/session` defines minimal-kernel user session contracts
- **THEN** it MUST define a domain `UserSessionPort` for create, require, list and conversation history operations
- **AND** `UserSessionPort` command/query types MUST carry trusted `IdentityContext` and trusted `agentId`
- **AND** `UserSession` MUST contain `tenantId`, `subjectId`, `agentId`, `sessionId`, optional `title`, `createdAt` and `updatedAt`
- **AND** `UserSessionPort` MUST NOT return gateway `*Record` types
- **AND** `UserSessionPort` MUST NOT expose Web public aliases such as `displayTitle`, `lastActivityAt`, `cursor` or `nextCursor`
- **AND** stale session read-model names such as `SessionHistoryQuery`, `SessionConversationQuery`, `CurrentRequestConversationQuery`, `ListUserSessionConversationQuery` and `UserSessionConversationPage` MUST either be removed or replaced by `UserSessionPort` domain command/query/page names so `agent-contracts/session` does not define a second parallel history API
- **AND** `UserSessionPage.entries` MUST be `UserSession[]` rather than a duplicate `UserSessionListEntry`

#### Scenario: Session list gateway uses internal fields
- **WHEN** `agent-session` lists owner-scoped and agent-scoped sessions through `SessionStoreGateway.listSessions`
- **THEN** `SessionHistoryRecordQuery` MUST contain `tenantId`, `subjectId`, `agentId`, `offset` and `limit`
- **AND** gateway contract MAY reuse owner scope fields through a neutral owner-scoped contract such as `OwnerScoped`, but `*Record` types MUST NOT extend a `*Request` interface
- **AND** `SessionHistoryRecordQuery` MUST NOT contain public or non-minimal query fields such as `includeSuperseded`
- **AND** `SessionHistoryEntry` MUST contain internal fields `tenantId`, `subjectId`, `agentId`, `sessionId`, optional `title`, `createdAt` and `updatedAt`
- **AND** `SessionHistoryEntry` MUST NOT contain public Web alias fields `displayTitle` or `lastActivityAt`
- **AND** `SessionHistoryEntry` MUST NOT contain non-minimal summary fields such as `lastMessagePreview`, `lastRequestStatus` or `hasInFlightRequest`
- **AND** `agent-channel-web` MUST be the boundary that projects internal `title?` and `updatedAt` to public `displayTitle` and `lastActivityAt`

#### Scenario: Conversation gateway uses before-cursor semantics
- **WHEN** `agent-session` lists conversation messages through `SessionMessageStoreGateway.listMessages`
- **THEN** `ListSessionMessagesRecordQuery` MUST contain `tenantId`, `subjectId`, `agentId`, `sessionId`, optional `requestId`, optional `locale`, `includeHidden`, `includeCapabilityResults`, optional `beforeCursor` and `limit`
- **AND** `ListSessionMessagesRecordQuery` MUST NOT contain public Web alias `cursor`
- **AND** `ListSessionMessagesRecordQuery` MUST NOT use offset pagination for the minimal-kernel conversation history path
- **AND** `SessionMessageRecordPage` MUST return items, limit, hasMore and optional internal `nextBeforeCursor`
- **AND** `SessionMessageRecordPage` MUST NOT return public Web alias `nextCursor`
- **AND** `agent-channel-web` MUST map public `cursor` to internal `beforeCursor` and internal `nextBeforeCursor` to public `nextCursor`

#### Scenario: Channel consumes runtime session facade instead of session implementation
- **WHEN** `agent-channel-web` handles session create, list, conversation or submit routes
- **THEN** it MUST call runtime-facing ports
- **AND** it MUST NOT import `agent-session`
- **AND** it MUST NOT define a channel-owned session abstraction such as `WebSessionPort`
- **AND** runtime-facing session operations MUST resolve trusted `agentId` inside runtime before calling `agent-session`

### Requirement: Capability Governance Refines Core Capability Contracts

The system MUST refine the core capability contract surface for capability governance by renaming the existing catalog public contract from `CapabilityCatalogPort` to `CapabilityCatalog`. The public catalog contract under `agent-contracts/capability` MUST be named `CapabilityCatalog`; implementations, context assembly, Agent core, and app composition MUST NOT introduce or continue a parallel public catalog contract name.

`agent-contracts/capability` MUST own `CapabilityCatalog`, `CapabilityProviderConfig`, `CapabilityDiscoveryMode`, `CapabilityProviderOptions`, `LocalDirectoryProviderOptions`, `SkillHubOptions`, `McpServerOptions`, `AgentRegistryOptions`, and `CustomProviderOptions`. `agent-contracts/app` MUST NOT own or export a second `CapabilityProviderConfig`; app configuration that carries capability provider configuration MUST reference the capability-owned `CapabilityProviderConfig[]`.

This refinement MUST NOT rename `CapabilityProvider`, `CapabilityDescriptor`, `CapabilityInvocationRequest`, `CapabilityInvocationResult`, or `CapabilityInvocationPort`, and MUST NOT add implementation classes to `agent-contracts`.

#### Scenario: Catalog contract uses the governance name

- **WHEN** a package needs the capability catalog public contract
- **THEN** it MUST import and consume `CapabilityCatalog` from `agent-contracts/capability`
- **AND** it MUST NOT import or export `CapabilityCatalogPort` after this refinement is implemented
- **AND** catalog implementations MUST remain outside `agent-contracts`

#### Scenario: Provider config is capability-owned

- **WHEN** app composition receives provider configuration for capability governance
- **THEN** the typed configuration MUST be `CapabilityProviderConfig[]` from `agent-contracts/capability`
- **AND** `agent-contracts/app` MUST NOT define a same-named provider config DTO

### Requirement: Agent Core Uses Runtime-Owned Run State Port

The system MUST expose an `AgentRunStatePort` under `agent-contracts/runtime` for Agent-owned execution logic to request runtime-owned run state side effects. `AgentRunStatePort` MUST support emitting run timeline events, appending run/session messages, and saving checkpoints with the accepted `RequestRun` and trusted `RequestContext`.

`Agent.execute` MUST accept only `RequestRun`, `RequestContext`, and `AbortSignal`. It MUST NOT accept timeline or message ports as execute-time parameters, and the implementation MUST NOT keep compatibility overloads for the old execute signature.

Runtime MUST implement `AgentRunStatePort` as a runtime-owned run state write service and inject it through Agent construction. The port MAY be a singleton service because every operation receives the accepted `RequestRun` and trusted `RequestContext`. Per-run terminal output aggregation, if needed for terminal commit, MUST be kept in runtime-owned per-run state outside the Agent Core contract surface.

App composition MUST NOT synthesize a `SubmitRequestCommand` or submit-command-shaped object for Agent Core checkpoint writes. Checkpoint owner scope MUST come from the trusted `RequestContext.identityContext`; checkpoint idempotency for this checkpoint fact shape MUST be anchored by the accepted `run.runId`, `triggerReason`, and `run.version`.

Runtime MUST own Agent instance lifecycle management. It MUST receive app-composed `AgentConstructor[]` and Agent runtime dependencies, create the runtime-owned `AgentRunStatePort`, and decide when an Agent instance is created, reused, or executed for an accepted request run. Runtime MUST NOT import `agent-core` or `agent-app` for Agent implementation construction.

`AgentConstructor` MUST be a standard constructor contract whose class-level `getType()` returns an `AgentType`. `AgentAssembly` MUST carry the trusted `agentType`; runtime MUST resolve the constructor from `assembly.agentType` and MUST scope Agent reuse to the accepted assembly identity: `agentId`, `agentVersion`, and `agentAssemblyRef`. App composition MAY register Agent constructors and inject Agent runtime dependencies, but MUST NOT own Agent instance cache, reuse, or execution lifecycle policy. Agent implementation packages MAY provide convenience base classes, but external Agent compatibility MUST remain the `Agent` interface plus the `AgentConstructor` shape.

Capability audit MUST be centralized behind the observability/audit boundary and derivable from runtime-owned canonical lifecycle events. Capability executors and Agent Core MUST NOT call `AuditEventWriter` directly for capability audit; Agent Core MUST emit safe capability lifecycle events, runtime MUST canonicalize them with trusted owner/agent/run/session coordinates, and observability/audit code MAY derive audit events from those canonical events without changing request lifecycle outcome. Capability audit derivation MUST NOT depend on before/after capability hook execution; hooks MAY produce their own hook audit/diagnostic facts, but they MUST NOT be the authoritative carrier for capability invocation audit.

#### Scenario: Agent execute is limited to run context and signal

- **WHEN** runtime dispatches an accepted request run to Agent Core
- **THEN** it MUST construct or provide an Agent with a runtime-owned `AgentRunStatePort`
- **AND** it MUST call `Agent.execute(run, context, signal)`
- **AND** it MUST NOT pass timeline or message ports through `Agent.execute`
- **AND** runtime-owned per-run terminal output state MUST be isolated by accepted run id

#### Scenario: Core checkpoint writes do not synthesize submit commands in app composition

- **WHEN** Agent Core saves a capability checkpoint before a capability call
- **THEN** it MUST call `AgentRunStatePort.saveCheckpoint(run, context, "CAPABILITY_BEFORE_CALL")`
- **AND** runtime-owned code MUST perform the checkpoint write
- **AND** checkpoint idempotency MUST use the accepted run id, trigger reason, and run version
- **AND** `agent-app` MUST NOT construct a fake submit command for this checkpoint path

#### Scenario: Runtime instantiates Agents through registered constructors

- **WHEN** runtime dispatches an accepted request run
- **THEN** it MUST resolve the accepted `AgentAssembly.agentType` through registered `AgentConstructor[]`
- **AND** Agent instance creation and reuse decisions MUST be owned by runtime and scoped to accepted `agentId`, `agentVersion`, and `agentAssemblyRef`
- **AND** it MUST pass the runtime-owned `AgentRunStatePort` in the Agent runtime kit
- **AND** `agent-runtime` MUST NOT import `agent-core` or `agent-app`

#### Scenario: Capability audit is derived from canonical events

- **WHEN** Agent Core consumes a capability invocation result
- **THEN** it MUST emit a safe capability terminal lifecycle event for the current run
- **AND** runtime MUST canonicalize the event before observability/audit derivation
- **AND** capability executors and Agent Core MUST NOT write capability audit events directly
- **AND** capability audit derivation MUST be owned by the observability/audit boundary rather than capability hooks
- **AND** observability/audit derivation MUST NOT alter request lifecycle outcome

### Requirement: Session lane snapshot gateway 查询
Core contracts MUST 在 `RequestRunStoreGateway` 上定义 agent+owner-scoped session lane snapshot query。该 query MUST 允许 Runtime 读取 durable gateway-owned RequestRun facts，用于 scheduler dispatch、latest-submit replacement、latest-request legality、request control、recovery 和 terminal-pending protection，并且不得依赖 adapter-private database queries 或 process-local scheduler state。

#### Scenario: Runtime 通过 `RequestRunStoreGateway` 读取 lane facts
- **WHEN** Runtime needs to decide scheduler dispatch, latest-submit replacement, cancel, retry, edit or recovery legality for a session lane
- **THEN** Runtime MUST call `RequestRunStoreGateway.loadSessionLaneSnapshot`
- **AND** the query MUST include `tenantId`, `subjectId`, `agentId` and `sessionId`
- **AND** Runtime MUST NOT read adapter-private database schema, local file layout or Session/Channel-owned cache to determine queued/executing/latest lane facts

#### Scenario: Snapshot 返回 facts 而不是 decisions
- **WHEN** `RequestRunStoreGateway.loadSessionLaneSnapshot` returns a snapshot
- **THEN** the snapshot MUST expose durable gateway-owned facts for the agent+owner-scoped session lane
- **AND** the snapshot MUST include the current `latestRequestId` when known
- **AND** the snapshot MUST include `latestRun`, `executingRun`, `queuedRuns` and `terminalPendingRun` when those facts exist
- **AND** `queuedRuns` MUST be a list, because more than one accepted same-lane request can be waiting for scheduler dispatch
- **AND** the snapshot MUST NOT include decision fields such as `shouldQueue`, `shouldSupersede`, `shouldReject` or `shouldStartExecution`

#### Scenario: Snapshot 不是 scheduler queue
- **WHEN** Runtime reads `RequestRunStoreGateway.loadSessionLaneSnapshot`
- **THEN** Runtime MUST treat durable `RequestRun` state as the authoritative source for queued, executing and terminal-pending facts
- **AND** Runtime MUST treat any process-local scheduler pending queue as a rebuildable dispatch aid rather than an authoritative lifecycle store
- **AND** the snapshot MUST NOT allocate, reorder, dispatch, retain or remove scheduler work items

#### Scenario: Snapshot 保留 agent 和 owner scope
- **WHEN** the gateway reads RequestRun facts for a session lane snapshot
- **THEN** the gateway MUST filter by `tenantId`, `subjectId`, `agentId` and `sessionId`
- **AND** facts from a different tenant, subject or agent MUST NOT appear in the snapshot
- **AND** agent-scope or owner-scope mismatch MUST be handled through the safe error boundary or an empty scoped result without leaking hidden resource existence

#### Scenario: Snapshot 支持 terminal-pending protection
- **WHEN** a session lane contains a RequestRun whose `terminalCommitState` is `PENDING` or `RETRYING`
- **THEN** the snapshot MUST expose that run as `terminalPendingRun`
- **AND** Runtime MUST be able to distinguish terminal-pending protection from normal queued or executing facts using the snapshot

#### Scenario: Snapshot 保持 gateway 的 fact provider 职责
- **WHEN** Gateway returns `queuedRuns`, `executingRun`, `latestRun` or `terminalPendingRun`
- **THEN** Gateway MUST NOT decide whether Runtime starts execution, keeps a run queued, supersedes a run or rejects a command
- **AND** Gateway MUST only provide RequestRunRecord facts or a gateway-owned snapshot read model from durable state through the logical port contract

### Requirement: RequestRun gateway 主路径 scope foundation
Core contracts MUST 为 session lane scheduling、request control 和 local recovery 使用的 RequestRun 主路径 lookup、claim、terminal commit 和 submit idempotency handling 保留 Agent Scope 与 Owner Scope。凡是读取或修改 user/session lane run facts 的 RequestRun gateway request，MUST 携带 trusted `tenantId`、`subjectId`、`agentId` 以及相关 session/run coordinate。Runtime MUST 仅从 app composition、hosted-agent selection、persisted `Session.agentId` 或 persisted `RequestRun.agentId` 派生 `agentId`。

#### Scenario: Run lookup、claim 和 terminal commit 使用 agent scope
- **WHEN** Runtime looks up, claims or terminal-commits a RequestRun for scheduler, request control or recovery
- **THEN** the gateway request MUST include trusted `tenantId`, `subjectId`, `agentId` and the run coordinate
- **AND** gateway implementation MUST filter by all scoped fields before returning or mutating the run
- **AND** an agent-scope or owner-scope mismatch MUST return a safe not-found/forbidden outcome or scoped empty result without leaking hidden resource existence

#### Scenario: Submit idempotency 按 command semantics 作用域化
- **WHEN** Runtime accepts submit into the queued scheduler path
- **THEN** the idempotency anchor MUST include trusted agent+owner scope, `sessionId`, canonical submit command semantic and `idempotencyKey`
- **AND** the same key with the same semantic MUST return the same accepted run or an equivalent safe duplicate outcome
- **AND** the same key with a different semantic MUST return a safe idempotency conflict without creating another run, mutating the lane or publishing timeline/stream facts

### Requirement: RequestRun idempotency anchor lookup 查询
Core contracts MUST 在 `RequestRunStoreGateway` 上暴露 agent+owner-scoped lookup，用于读取既有 `RequestRun` idempotency anchors。该 lookup MUST 只读取既有 `request_runs` facts，并且 MUST NOT 创建单独的 command outcome fact、table、store 或 `RuntimeControlCommandOutcomeRecord`。

#### Scenario: Runtime 从 RequestRun acceptance anchor reload accepted retry
- **WHEN** Runtime receives a duplicate retry command with the same `idempotencyKey` after the retry run has already reached the durable acceptance boundary
- **THEN** Runtime MUST call `RequestRunStoreGateway.loadRunByIdempotencyKey` with trusted `tenantId`, `subjectId`, `agentId`, `sessionId`, `anchor=ACCEPTANCE`, canonical `idempotencyKey` and retry command semantic
- **AND** a matching `RequestRunRecord` with the same semantic MUST let Runtime derive the original `RequestAccepted`
- **AND** a matching key with a different semantic MUST return a safe idempotency conflict without creating another run, mutating the lane or publishing timeline/stream facts

#### Scenario: Runtime 从 RequestRun terminal commit anchor reload accepted cancel
- **WHEN** Runtime receives a duplicate cancel command with the same `idempotencyKey` after the target run's cancel terminal attempt has reached pending or committed terminal metadata
- **THEN** Runtime MUST call `RequestRunStoreGateway.loadRunByIdempotencyKey` with trusted `tenantId`, `subjectId`, `agentId`, `sessionId`, `anchor=TERMINAL_COMMIT`, canonical `idempotencyKey` and cancel command semantic
- **AND** a matching `RequestRunRecord` with the same semantic MUST let Runtime derive the original or equivalent `RequestControlAccepted`
- **AND** a matching key with a different semantic MUST return a safe idempotency conflict without starting another cancellation transition or terminal commit attempt

#### Scenario: RequestRun idempotency lookup 保留 agent 和 owner scope
- **WHEN** the gateway reads a RequestRun idempotency anchor
- **THEN** the gateway MUST scope the lookup by `tenantId`, `subjectId`, `agentId`, `sessionId`, anchor kind and `idempotencyKey`
- **AND** runs from a different tenant, subject, agent, session or anchor kind MUST NOT be returned
- **AND** an agent-scope or owner-scope mismatch MUST be handled through a safe scoped result without leaking hidden resource existence

### Requirement: Gateway Contracts Carry Sandbox Filesystem Layout And Scheduled Maintenance Jobs

TS gateway contracts SHALL carry the minimal platform-facing execution inputs needed by gateway adapters for sandbox execution and scheduled maintenance. `SandboxExecutionRequest.filesystem` SHALL include only the sandbox filesystem layout required by adapters: `defaultCwd` and `roots[]`. Each root entry SHALL carry the root kind, logical path, adapter physical path or mount source, and access mode. Sandbox target paths and standard temp env values SHALL be derived by the gateway adapter from `filesystem.defaultCwd` and the matching root logical path.

Gateway scheduled maintenance contracts SHALL provide a single app-registration shape for capability-owned maintenance jobs: job id, cadence/retention hints, overlap policy, and `run(signal, now)`. Capability modules own cleanup policy and cleanup candidate selection. Gateway adapters own deployment-mode-specific scheduling and execution.

#### Scenario: Sandbox gateway receives filesystem layout only

- **WHEN** a sandbox execution request is submitted
- **THEN** the gateway request SHALL carry `filesystem.defaultCwd` and `filesystem.roots[]`
- **AND** gateway adapters SHALL derive sandbox target paths and temp env values from that layout
- **AND** the request SHALL NOT carry `AgentWorkspacePolicy`, `ExecutionWorkspaceResolver`, full `ExecutionWorkspaceView`, Skill source loading facts, or authorization decisions

#### Scenario: Capability cleanup job is scheduled by gateway

- **WHEN** app composition registers a capability-provided cleanup job
- **THEN** the gateway scheduled execution contract SHALL carry job id, cadence/retention hints, overlap policy and `run(signal, now)`
- **AND** the gateway adapter SHALL execute the job according to LOCAL or REMOTE/PaaS deployment mode
- **AND** cleanup policy, Skill identity interpretation and cleanup candidate selection SHALL remain owned by the capability job

### Requirement: RequestPriority for scheduling differentiation

The system SHALL define `RequestPriority = "HIGH" | "NORMAL" | "LOW"` in `agent-common`. `NORMAL` is the default for top-level user requests. `LOW` is used for subagent requests to ensure they do not starve top-level requests. The runtime scheduler SHALL be a separate async component: `submit()` only enqueues work and wakes the scheduler; the scheduler independently dispatches work from queues by priority when concurrency slots are available. The scheduler SHALL enforce a global concurrent execution limit (`maxConcurrent`) and dispatch higher-priority runs before lower-priority runs across all session lanes. Priority scheduling MUST be separate from session lane scheduling — within a lane, runs are still serialized (one at a time); priority affects which lane's work is dispatched next when a global concurrency slot is free. The scheduler MUST reserve work, lane ownership, and a global execution slot synchronously before fire-and-forget dispatch. The scheduler MUST maintain a global execution gate: when `executingRuns.size + inflightCount >= maxConcurrent`, new work remains queued; when a run completes, the scheduler is woken and dispatches the highest-priority queued work across all lanes.

The scheduler MUST NOT release `inflightCount` until the reserved work either atomically transfers into `executingRuns` or is skipped/terminally cleaned up before execution. Shutdown/close MUST wait for scheduler idle, including no pending work, no reserved lanes, no executing runs, no inflight reservations, and no running scheduler loop.

#### Scenario: Priority affects cross-lane dispatch order
- **WHEN** multiple lanes have queued work and a global concurrency slot becomes available
- **THEN** the scheduler MUST dispatch `HIGH` priority work first, then `NORMAL`, then `LOW`
- **AND** within the same priority level, dispatch order MAY follow lane queue order (FIFO).

#### Scenario: Global concurrency limit enforced
- **WHEN** `executingRuns.size + inflightCount` reaches `maxConcurrent`
- **THEN** the scheduler MUST NOT dispatch new work, even if lanes have queued items
- **AND** when a run completes (frees a slot), the scheduler MUST be woken and dispatch the highest-priority queued work across all lanes.

#### Scenario: Reservation prevents over-dispatch
- **WHEN** multiple `wakeScheduler()` calls happen before a reserved work has entered `executingRuns`
- **THEN** the reserved work MUST still count against `maxConcurrent`
- **AND** the same lane MUST NOT be selected for another dispatch while its first work is reserved or executing.

#### Scenario: submit() only enqueues, scheduler dispatches
- **WHEN** `submit()` is called
- **THEN** it MUST enqueue work to the lane queue and wake the scheduler
- **AND** it MUST NOT directly dispatch or execute the work
- **AND** the scheduler independently decides when to dispatch based on capacity and priority.

#### Scenario: close waits for scheduler idle
- **WHEN** runtime close waits for queued work to drain
- **THEN** close MUST consider the scheduler idle only when pending work, reserved lanes, executing runs, inflight reservations, and the running scheduler loop are all empty/inactive.

#### Scenario: Priority does not affect intra-lane serialization
- **WHEN** a lane has an executing run
- **THEN** queued work in the same lane MUST NOT be dispatched regardless of priority
- **AND** priority only affects which lane's work is dispatched next when a slot is free.

### Requirement: Session parent linkage for subagent invocation traceability

`SessionRecord` (gateway subpath) and `UserSession` (session subpath) SHALL support optional parent linkage fields `parentSessionId?: SessionId`, `parentRunId?: RequestRunId`, and `parentRequestId?: MessageId` for subagent invocation traceability. These fields MUST be optional and MUST NOT affect existing session creation, listing, or owner scope validation. When present, they link a child session to the parent session, run, and request that triggered the subagent invocation.

#### Scenario: Child session carries parent linkage
- **WHEN** a child session is created by `submit()` for a subagent invocation
- **THEN** `SessionRecord` and `UserSession` MUST carry `parentSessionId`, `parentRunId`, and `parentRequestId`
- **AND** these fields MUST be optional on both contracts
- **AND** existing sessions without parent linkage MUST remain valid.

#### Scenario: Session owner scope is independent of parent linkage
- **WHEN** a child session is created with parent linkage
- **THEN** the child session's `agentId` MUST be the target subagent's `agentId`, not the parent's
- **AND** the child session's `tenantId` and `subjectId` MUST be inherited from the parent's `identityContext`
- **AND** owner scope validation MUST use the child session's own `agentId` and `identityContext`, not the parent's.

#### Scenario: Session listing does not require parent linkage
- **WHEN** sessions are listed via `ListUserSessionsQuery` or `SessionHistoryRecordQuery`
- **THEN** parent linkage fields MUST NOT be required for listing
- **AND** sessions with and without parent linkage MUST be listable using the same query shape.

### Requirement: Orphan child session handling on submit failure

When `submit()` creates a child session internally (no `sessionId` in command) and a subsequent step (run save, checkpoint, message persist) fails, the child session MAY remain in the store as an orphan with no runs. This is harmless: orphan sessions have no runs, consume no concurrency slots, and do not affect functional correctness. `submit()` MUST log a diagnostic with the orphan session ID, parent run ID, and failure reason. `SessionStoreGateway` does not need a `deleteSession` method for this change. Background cleanup of orphan sessions is deferred to a future change.

#### Scenario: submit failure leaves orphan child session
- **WHEN** `submit()` creates a child session and then fails on a subsequent step
- **THEN** the child session MAY remain in the store with no runs
- **AND** `submit()` MUST log a diagnostic with the orphan session ID and failure reason
- **AND** the orphan session MUST NOT consume concurrency slots or affect other runs
- **AND** `SubagentExecutionPort` receives the error and returns `EXECUTION_FAILED` without needing to clean up the session.

### Requirement: Runtime owns risk policy evaluator contracts
TS 后端 SHALL 在 `agent-contracts/runtime` 下定义 risk policy 的 runtime-facing evaluator contracts：`RestrictedOperationSummary`、`RiskPolicyEvaluationInput`、`RiskPolicyDecision`、`RiskPolicyAuthorizationIntent` 和 `RiskPolicyEvaluator`。这些 contracts SHALL 表达受限操作的执行前治理输入、判定结果和授权意图；runtime、core、capability 和 app composition MUST 复用该 typed surface，而不是在实现包中定义平行 policy DTO、request context 字段或 helper-only contract。

#### Scenario: Restricted operation is evaluated through runtime-owned contract
- **WHEN** runtime 或受限操作执行前边界需要对 capability invocation、sandbox execution 或 authorization request 做 risk policy evaluation
- **THEN** 它 MUST 使用 `agent-contracts/runtime` 下的 risk policy evaluator contract 交换 typed input 和 typed decision
- **AND** 它 MUST NOT 通过修改 `CapabilityInvocationRequest`、`CapabilityInvocationResult`、`SandboxExecutionRequest` 或 `SandboxExecutionResult` 来承载 policy decision
- **AND** runtime-facing contract MUST 允许后续 change 在不重定义 public DTO 的前提下接入 capability、sandbox 和 authorization 路径

#### Scenario: Existing execution contracts remain execution-owned
- **WHEN** 团队扩展 risk policy contract surface
- **THEN** `CapabilityInvocationRequest` 和 `SandboxExecutionRequest` MUST 继续只承载执行输入
- **AND** risk policy outcome、authorization intent 和 policy evaluation fact MUST 有独立 contract 落点
- **AND** TS 后端 MUST NOT 引入新的 `agent-contracts/policy` owning subpath 或通用 `PolicyPort`

### Requirement: Risk policy shared vocabulary and facts are minimal and owner-aligned
TS 后端 SHALL 将 `RiskPolicyOutcome`、`RiskLevel` 和 `RestrictedOperationKind` 作为跨边界共享 vocabulary 归 `agent-common` owning；将 `RiskPolicyEvaluation` 作为结构化观测事实归 `agent-contracts/observability` owning。`RiskPolicyEvaluation` SHALL 只承载安全摘要、稳定 reason code、risk outcome 和 refs，MUST NOT 成为 runtime、session、gateway、channel 或 capability 的业务真相对象。

#### Scenario: Shared vocabulary is reused across boundaries
- **WHEN** runtime、capability、gateway、observability 或 app composition 需要表达 risk policy outcome、risk level 或 restricted operation kind
- **THEN** 它们 MUST 复用 `agent-common` owning vocabulary
- **AND** implementation package MUST NOT 在 `agent-contracts/*` 或私有实现包中重复定义同义 enum 或 string union

#### Scenario: Evaluation fact is observability-owned and safe
- **WHEN** 系统形成一次 risk policy evaluation 的结构化观测事实
- **THEN** 该事实 MUST 使用 `agent-contracts/observability` owning 的 `RiskPolicyEvaluation`
- **AND** 该 contract MUST NOT 包含 raw prompt、raw model output、raw tool args/result、raw attachment content、raw secret、credential、本地路径、完整 sandbox request 或 provider raw response
- **AND** 该 fact MAY 被 log、metric、audit 和 release/security gate 消费
- **AND** 它 MUST NOT 作为 RequestRun、PendingInput、SessionMessage、Gateway Record 或用户可见 stream event truth 使用

### Requirement: Authorization scope is stored as pending-input-bound gateway fact
TS 后端 SHALL 将 risk-policy-driven authorization scope 作为 `agent-contracts/gateway` owning 的 `AuthorizationScopeRecord` 表达，并允许 `PendingInputRecord.authorizationScope?` 持久化该服务端绑定事实。authorization scope SHALL 只绑定当前 owner、当前 run 和目标受限操作；它 MUST NOT 进入客户端 answer payload，MUST NOT 形成独立 authorization store，也 MUST NOT 被定义为跨 run 或跨 session 的长期授权记录。

#### Scenario: Authorization pending input carries server-bound scope
- **WHEN** 后续 change 为高风险受限操作创建 authorization pending input
- **THEN** gateway-visible pending input fact MAY 在 `PendingInputRecord.authorizationScope?` 中携带绑定的 authorization scope
- **AND** 该 scope MUST 由服务端 trusted owner scope、run scope 和目标 operation ref 组成
- **AND** 客户端 answer contract MUST NOT 直接提交、覆盖或伪造该 scope

#### Scenario: No parallel authorization persistence is introduced
- **WHEN** 团队实现 risk policy authorization contract
- **THEN** 系统 MUST NOT 引入独立 authorization durable truth、独立 authorization store 或平行 gateway record
- **AND** authorization permission MUST 继续作为 runtime 基于 pending input answer 和绑定 scope 派生的一次性执行许可
- **AND** `PendingInputRecord.authorizationScope?` 的存在 MUST NOT 改变现有 pending input lifecycle owner

### Requirement: Pending input resolve is idempotent

Core contracts SHALL make pending input resolve idempotent at the gateway write boundary without adding idempotency fields to the client answer payload or pending input business object.

#### Scenario: Same answer command replay returns equivalent outcome
- **WHEN** runtime resolves a pending input with a scoped `idempotencyKey` and `idempotencySemantic`
- **AND** the same owner+agent+session+pendingInput receives the same key and semantic again
- **THEN** gateway MUST return the equivalent resolved `PendingInputRecord`
- **AND** runtime MUST NOT publish a second `USER_INPUT_RECEIVED`, resume the run twice, or mutate responseAnswers a second time

#### Scenario: Runtime computes canonical answer resolve semantic
- **WHEN** runtime prepares an answer resolve command for a pending input
- **THEN** runtime MUST compute `idempotencySemantic` as a canonical string from `pendingInputId`, target resolve status and validated ordered `answers`
- **AND** the target resolve status for an accepted answer MUST be `RECEIVED`
- **AND** the canonical string MUST use a versioned deterministic array tuple encoding, such as stable JSON for `["pending-input-resolve-v1", pendingInputId, targetStatus, answers]`
- **AND** the semantic MUST preserve question order and validated answer entry order
- **AND** runtime MUST NOT reorder answers or apply trim, case-folding or other semantic normalization after answer validation
- **AND** the semantic MUST NOT include `answeredAt`, `idempotencyKey`, random ids, trace ids, audit ids, log fields, stream event ids, gateway row ids, adapter-private columns or wall-clock values
- **AND** gateway MUST treat `idempotencySemantic` as opaque write metadata used only for equality comparison within the same tenant+subject+agent+session+pendingInput scope
- **AND** gateway MUST NOT parse `idempotencySemantic`, validate answer business rules or derive lifecycle decisions from it

#### Scenario: Same idempotency key with different answer semantic conflicts
- **WHEN** runtime resolves a pending input with an `idempotencyKey` already used for a different answer semantic in the same owner+agent+session+pendingInput scope
- **THEN** gateway MUST return an idempotency conflict
- **AND** runtime MUST surface a safe conflict outcome
- **AND** the pending input fact MUST NOT be mutated by the conflicting command

#### Scenario: Different command after pending already resolved does not double-resume
- **WHEN** a second device or refreshed client submits a different answer command for a pending input that has already been resolved by another command
- **THEN** runtime MUST use the durable pending input status to reject or report the already-resolved outcome safely
- **AND** runtime MUST NOT mutate the resolved pending input back to `PENDING` or `RECEIVED`
- **AND** runtime MUST NOT resume or terminalize the owning run a second time

### Requirement: Runtime owns request-carried ModelOptions contract
系统 SHALL 在 `agent-contracts/runtime` 下定义 request-carried `RequestModelOptions` contract。`SubmitRequestCommand`、accepted `RequestContext`，以及 retry/recovery 重建出的等价 submit/context 形态 MUST 能携带可选的 request-scoped model options。runtime SHALL 把该 typed 值作为可信请求事实稳定传递到 Agent 执行路径，而不是把它当作 profile 配置、provider 配置或全局默认值。

#### Scenario: Submit command carries request-scoped model options
- **WHEN** channel/auth boundary 构造一个包含允许字段的 submit 请求
- **THEN** `SubmitRequestCommand` MAY carry `requestModelOptions`
- **AND** accepted `RequestContext` MAY carry同一 typed `requestModelOptions`
- **AND** runtime MUST NOT 将该字段解释为 owner override、agent override、provider override、model profile override 或全局配置变更

#### Scenario: Retry and recovery preserve request-scoped model options
- **WHEN** runtime 对一个已接受请求执行 retry、queue rebuild、claimed-run recovery 或 terminal-pending recovery
- **THEN** 重建出的 `SubmitRequestCommand` 与 `RequestContext` MUST 保留原请求的 `requestModelOptions`
- **AND** 同一请求的 thinking 关闭事实 MUST NOT 在 retry 或 recovery 时回退为 profile 默认值
- **AND** request-scoped model options 的存在或缺失 MUST 参与相同请求语义的 idempotency 判定

#### Scenario: Request has no request-scoped model options
- **WHEN** channel/auth boundary 构造请求时未提供 request-scoped model options
- **THEN** `SubmitRequestCommand.requestModelOptions` MAY be absent
- **AND** accepted `RequestContext.requestModelOptions` MAY be absent
- **AND** 请求生命周期 MUST 保持既有 model profile 与 prompt 驱动的默认 model option 行为

### Requirement: RequestModelOptions fields are minimal and safe
`RequestModelOptions` SHALL 只定义 request-scoped、provider-neutral、allowlist 的模型行为偏好字段。允许字段只有 `thinking.depth`（取值仅限 `OFF`）和 canonical `toolChoice`（取值仅限 `AUTO | NONE | REQUIRED`）。该 contract MUST NOT 定义 temperature、topP、maxOutputTokens、provider-private reasoning/tool-choice knobs、raw prompt、credential、路径、provider override、model profile override、owner/agent override、Agent loop limits 或其他未授权字段。

#### Scenario: Allowed field is represented
- **WHEN** 请求提供 `requestModelOptions.thinking.depth = "OFF"`
- **THEN** typed runtime contract MUST 能表示该字段
- **AND** 该字段 MUST 仅表示当前请求关闭 think 的偏好
- **AND** 该字段 MUST NOT 直接暴露 provider-specific reasoning 参数

#### Scenario: Forbidden model override is attempted
- **WHEN** 输入尝试通过 request-scoped model options 传入 `temperature`、`topP`、`maxOutputTokens`、provider reasoning/tool-choice object、provider options、Agent loop limits、owner/agent override、credential、路径或其他未授权字段
- **THEN** 这些字段 MUST NOT 在 `RequestModelOptions` contract 中可表示
- **AND** Web/runtime schema validation MUST fail closed before它们进入 accepted request execution path

#### Scenario: Canonical tool choice is represented
- **WHEN** 请求提供 `requestModelOptions.toolChoice = "NONE"`
- **THEN** typed runtime contract MUST 能表示该 canonical 字段
- **AND** 该字段 MUST 只收窄当前请求的 Tool 选择行为，不得改变模型身份、Tool descriptors 或 Agent-owned loop limits

### Requirement: Guard layer output-guard terminal event

`StreamEventType` SHALL 包含 `OUTPUT_GUARD_BLOCKED` 作为 terminal stream event。作为 "channel MUST 使用 `StreamEventType` 投影 canonical timeline 或 runtime status" 的受控例外，guard 层（经 `GuardrailGatewayPort` 对输出内容做 guard 检查时，无论由 guard proxy 代理 run 流还是由 NextAgent 在投影侧触发检查）MAY 在客户端流上注入 terminal `OUTPUT_GUARD_BLOCKED` 事件，其 payload 携带 guard reason 与 guard 服务返回的 `refusalMessage`。

约束（防止例外被滥用）：
- 除 `OUTPUT_GUARD_BLOCKED` 外，其他 stream event 仍 MUST 从 canonical timeline 或 runtime status 派生，MUST NOT 由 guard 层或其他外部服务注入。
- `OUTPUT_GUARD_BLOCKED` MUST 是 terminal 事件，其后 MUST NOT 再出现 `LLM_CONTENT_DELTA` 或 `TOOL_STRUCTURED_DELTA`。
- guard 层仍 MUST 经 `GuardrailGatewayPort`（受治理出口），MUST NOT 绕过 gateway 直连 guard 服务；前端/客户端仍只与 NextAgent 自有端点交互。
- `OUTPUT_GUARD_BLOCKED` 是 guard 层对客户端流的 terminal 信号，不替代 runtime 的 canonical terminal commit 事实；run 的 canonical terminal 状态仍由 runtime 拥有，二者各自独立。

#### Scenario: OUTPUT_GUARD_BLOCKED is a terminal stream event

- **WHEN** contract tests 枚举 `StreamEventType`
- **THEN** `StreamEventType` MUST 包含 `OUTPUT_GUARD_BLOCKED`
- **AND** `OUTPUT_GUARD_BLOCKED` MUST 表达 terminal 语义

#### Scenario: Guard-forward relay may inject OUTPUT_GUARD_BLOCKED

- **WHEN** guard-forward relay 路径上 guard 层检测到输出风控问题
- **THEN** guard 层 MAY 在 relay 的客户端流上注入 terminal `OUTPUT_GUARD_BLOCKED` 事件
- **AND** 其 payload MUST 携带 guard reason 与 guard 服务返回的 `refusalMessage`
- **AND** 该事件之后 MUST NOT 再出现 `LLM_CONTENT_DELTA` 或 `TOOL_STRUCTURED_DELTA`

#### Scenario: Only OUTPUT_GUARD_BLOCKED may be injected by the guard relay

- **WHEN** guard-forward relay 路径向客户端流投影事件
- **THEN** 除 `OUTPUT_GUARD_BLOCKED` 外的其他 stream event MUST 从 canonical timeline 或 runtime status 派生
- **AND** guard 层 MUST NOT 注入其他 stream event 名称

#### Scenario: OUTPUT_GUARD_BLOCKED does not replace runtime terminal facts

- **WHEN** guard-forward relay 注入 `OUTPUT_GUARD_BLOCKED`
- **THEN** run 的 canonical terminal commit 事实仍 MUST 由 runtime 拥有
- **AND** `OUTPUT_GUARD_BLOCKED` MUST NOT 被当作 runtime terminal commit 事实

### Requirement: Final thinking is a persisted form of LLM_THINKING_DELTA

TS核心契约SHALL使用既有`LLM_THINKING_DELTA`同时表达调用中的累计delta和单次模型调用的最后累计delta，MUST NOT新增completed thinking event type。两种形态都必须包含trim后非空但保留原始whitespace的`reasoning`和非空`stepId`。调用中的delta MUST省略`completed`并为`LIVE_ONLY`；最后累计delta MUST包含literal`completed=true`并为`PERSISTED`。`completed=false`、调用中delta+PERSISTED、完成delta+LIVE_ONLY及空reasoning均非法。

Canonical payload MUST NOT为本change增加segmentId、segmentOrdinal、content、text或presentation metadata。Public `StreamEventType` MUST保持不变。

#### Scenario: In-progress cumulative deltas remain live only
- **WHEN**模型调用producer连续产生同一step的多个累计thinking deltas且调用尚未结束
- **THEN** events MUST全部为`LLM_THINKING_DELTA`和`LIVE_ONLY`
- **AND** MUST省略`completed`
- **AND** MUST不创建durable timeline row或消耗sequence

#### Scenario: Producer persists the last cumulative delta
- **WHEN**单次model invocation结束且已累计非空reasoning
- **THEN**模型调用producer MUST在其model terminal event前完成并持久化恰好一个`completed=true`的`LLM_THINKING_DELTA`
- **AND**该event MUST包含本次调用最后完整累计reasoning，不得产生新的thinking内容或segment
- **AND** runtime MUST先持久化再发布该event

#### Scenario: Empty reasoning creates no completed thinking event
- **WHEN**model invocation结束但没有接收非空reasoning
- **THEN** MUST不生成completed thinking event
- **AND**既有model terminal flow MUST继续执行

#### Scenario: Workflow lifecycle does not complete model thinking
- **WHEN**workflow node进入`NODE_COMPLETED | NODE_FAILED | NODE_SKIPPED`
- **THEN**workflow projector MUST不据此生成或持久化completed thinking event
- **AND**只有实际模型调用producer MAY完成其自身thinking delta

### Requirement: Conversation message contracts remain unchanged by process history

Thinking process history SHALL NOT扩展session message data model。`SessionMessageRole` MUST继续只包含`USER | ASSISTANT | CAPABILITY_RESULT | SUMMARY`；`SessionMessage`、draft、record和`TerminalCommitRequest` MUST NOT增加thinking role、context participation、segment metadata或thinking bundle。

最终user/assistant内容、capability result和summary继续由visible message承载。Timeline event MUST NOT进入ActiveContext、Context Engine、prompt shaping、provider request、token budget或prefix cache。

#### Scenario: Persisted thinking does not create a message
- **WHEN**completed thinking delta成功持久化
- **THEN** message store MUST不产生thinking row
- **AND** ActiveContext state、items和version MUST保持不变

#### Scenario: Final answer remains a message fact
- **WHEN** request成功提交最终回答
- **THEN** final answer MUST继续作为visible ASSISTANT message持久化
- **AND** system MUST NOT从terminal或thinking event重建最终回答

#### Scenario: Event history cannot enter later model input
- **WHEN** session包含任意数量persisted process events
- **THEN** 下一轮provider input和cache boundary MUST仍只由既有ActiveContext message path决定
- **AND** 有无event history时生成的模型输入 MUST字节等价

### Requirement: RuntimeSessionPort exposes run-scoped event history

`agent-contracts/runtime` SHALL在`RuntimeSessionPort`增加`listEvents`，输入trusted identity、sessionId、必填runId、non-negative safe-integer afterSequence、`1..1000` safe-integer limit和可选AbortSignal。输出必须是exact union：`AVAILABLE`含runtime-safe events与optional cursor；`LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE`只能含空events且无cursor。

Runtime MUST通过`UserSessionPort.requireSession`解析可信Owner/Agent/session，再把runId解析为同session RequestRun或copied-run snapshot status。返回event MUST省略tenantId、subjectId、agentId、contentRef和gateway metadata；普通runtime event包含真实requestContextId，fork snapshot MUST省略。

#### Scenario: Authorized current run returns ordered events
- **WHEN** caller查询合法current run
- **THEN** runtime MUST只返回同owner、Agent、session、request和run的persisted events
- **AND** events MUST按sequence严格升序并支持无重复、无遗漏分页

#### Scenario: Authorized copied run returns child-owned snapshots
- **WHEN** caller查询AVAILABLE copied-run anchor
- **THEN** runtime MUST返回child session/request/run坐标的FORK_SNAPSHOT events
- **AND** MUST不暴露source坐标或requestContextId

#### Scenario: Legacy copied run is explicitly unavailable
- **WHEN** message membership证明runId属于升级前copied prefix但没有可靠snapshot status
- **THEN** runtime MUST返回exact unavailable union
- **AND** MUST不猜测、回读或泄露source run

#### Scenario: Scope and pagination validation fail closed
- **WHEN** identity、Agent、session或run不匹配，或者pagination非法
- **THEN** runtime MUST返回safe failure
- **AND** MUST不访问或返回其他scope的event、payload、sequence或存在性

### Requirement: Pending option contract supports attached text input

The pending input option contracts in core, runtime, gateway and Web projection SHALL support optional `requiresTextInput` and `inputPlaceholder` fields with one canonical meaning across boundaries. `requiresTextInput=true` means that selecting this specific option requires one attached text value; `inputPlaceholder` is bounded safe presentation text and MUST NOT carry identity, authorization, path authority, lifecycle ownership or answer data.

#### Scenario: Contract fields preserve one meaning across boundaries

- **WHEN** a trusted producer creates a `QUESTION` pending intent containing an option with `requiresTextInput=true`
- **THEN** core intent, runtime request, gateway Record and Web projection MUST preserve the same option value, label, `requiresTextInput` and optional `inputPlaceholder`
- **AND** persistence mapping MUST use the existing pending input fact and MUST NOT introduce a second pending store or private capability lifecycle.

#### Scenario: Existing answer envelope carries option and attached text

- **WHEN** the selected accepted option requires attached text
- **THEN** `PendingInputAnswer.answers` MUST remain an ordered string matrix
- **AND** that question's entry MUST contain exactly `[optionValue, inputText]`
- **AND** this refinement MUST NOT add a parallel answer DTO, runtime command or client-supplied answer schema.

#### Scenario: Agent-contracts refinement requires explicit review

- **WHEN** this change adds the two optional fields to public pending option contracts
- **THEN** contract review MUST confirm identical naming and semantics in `agent-contracts/runtime` and `agent-contracts/gateway`
- **AND** `WorkflowPendingInputOption` MUST remain unchanged
- **AND** contract tests MUST reject field drift, invalid combinations and unbounded presentation text before the change is eligible for push.

### Requirement: Runtime Request Summary Read Model

The existing `RuntimeSessionPort` SHALL expose an asynchronous `getRequestSummary(query)` application query for channel reconciliation. The query SHALL accept trusted `IdentityContext`, `sessionId`, and `requestId`. Runtime SHALL return a domain read model using canonical `sessionId`, `requestId`, `RunStatus`, `updatedAt`, optional `activePendingInput`, and optional `terminalResult`.

`terminalResult` SHALL be present when the request status is terminal (COMPLETED, FAILED, CANCELED, SUPERSEDED) and the terminal timeline event payload contains result content. It SHALL contain `content` (the terminal result text), `contentType`, and optional safe error fields (`code`, `category`, `retryable`) for failed requests. Runtime SHALL extract `terminalResult` from the last terminal timeline event for the request. When no terminal event is found or the request is not terminal, `terminalResult` MUST be absent.

The query SHALL validate Owner Scope and persisted Agent Scope before returning data. Runtime SHALL assemble request status and active PendingInput from existing dedicated persistence facts; it MUST NOT return gateway `*Record` objects or introduce Task Channel aliases into runtime contracts. The existing RuntimeSessionPort SHALL own this query; a parallel request-query port MUST NOT be introduced. The read model MUST NOT expose `runId`, `requestContextId`, `lastEventSequence`, or `attempt` to the channel; these remain internal runtime diagnostics.

#### Scenario: Runtime returns request summary with terminal result
- **WHEN** an authorized channel queries a terminal request
- **THEN** runtime MUST return the summary with `terminalResult` containing `content` and `contentType`
- **AND** for failed requests `terminalResult` MAY contain `code`, `category`, and `retryable`

#### Scenario: Runtime returns active pending input consistently
- **WHEN** a current request run has an active PendingInput
- **THEN** its summary MUST contain that PendingInput and the matching current run status from one logical snapshot

#### Scenario: Runtime returns summary without internal diagnostics
- **WHEN** a summary is returned for any request
- **THEN** it MUST NOT contain `runId`, `requestContextId`, `lastEventSequence`, or `attempt`
- **AND** it MUST use canonical runtime field names only

#### Scenario: Cross-scope query is hidden
- **WHEN** a caller queries a request outside the trusted Owner Scope or Agent Scope
- **THEN** runtime MUST return undefined
- **AND** MUST NOT reveal the existence of the request
