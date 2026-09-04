## 背景和现状（Context）

TS 后端已经有架构边界，但还没有可供各团队共同实现的核心契约。最小内核需要 runtime、channel、session、core、context、model、capability、gateway、observability 和 app composition 在同一套对象和事件语义上协作；后续附件、Skill source、sandbox、pending input、feedback、恢复和发布门禁也必须复用同一套 contract。

本设计的相关方包括 runtime/session 团队、Web channel 团队、controller/context 团队、capability 团队、platform gateway 团队、observability/ops 团队和 frontend 团队。设计约束是：先冻结跨模块契约，再实现最小问答内核；契约必须足以支持并行开发，但不能提前实现具体 provider、store、tool 或业务 API 细节。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 建立唯一的 `agent-contracts` public namespace，承载核心 DTO、enum、port 和 schema skeleton。
- 明确哪些契约属于 runtime 真相，哪些属于 channel 投影、context 组装、capability catalog、gateway persistence、audit 和错误归一化边界。
- 冻结 owner scope、AgentError/SafeError、RequestRun、timeline、stream、context、model、capability、gateway、sandbox、routing、hook、checkpoint 和 observability 的最小可验证形态。
- 保留最小内核 no-op 边界，让 hook、checkpoint、audit 等直接依赖可被主流程调用但不阻塞一次问答成立。
- 为后续并行 change 提供稳定扩展点，避免各团队修改同一主流程契约。

**非目标：**

- 不实现完整 REST/SSE/WebSocket route、UI payload、runtime state machine 或数据库 schema。
- 不实现具体模型 provider、内置工具、Skill source、SkillHub、SubAgent、sandbox runtime、attachment parser、audit sink 或 metrics sink。
- 不定义具体 prompt 模板、领域工具参数、Skill manifest 全量校验、远端服务协议或 PaaS 多实例部署方案。
- 不把最小内核 no-op 变成长期行为；no-op 只用于一层直接依赖的替换边界。

## 设计决策（Decisions）

### 1. `agent-contracts` 是核心契约唯一出口

选择：新增 `agent-contracts` 作为 runtime、channel、session、attachment、context、model、capability、core、gateway、observability、app 等边界契约的唯一 public namespace。业务实现包只消费该包暴露的类型和 port；实现包之间不得通过 private 类型绕行。

理由：核心契约集中后，最小内核和配件团队可以并行开发，且 contract tests 可以直接针对 public namespace。放弃把契约分散在各实现包内的方案，因为它会使 runtime truth、stream projection 和 gateway persistence 难以统一。

### 2. Runtime 拥有 RequestRun、terminal commit 和 canonical timeline

选择：RequestRun、runtime command、latest-request 合法性、terminal result、terminal commit、run version/claim/fencing 和 canonical timeline 均属于 runtime contract。Channel 只能投影 stream；session/gateway 只保存事实；core/capability/context/model 只能通过 runtime-owned context 产生执行事实。

理由：请求生命周期必须有唯一真相来源，才能保证 cancel/retry/edit、恢复、断连 replay 和历史一致性。放弃由 channel、core 或 session 各自维护状态机的方案。

### 3. Stream 是 timeline 的用户可见投影

选择：冻结 `RunStatus`、`TimelineEventType` 和 `StreamEventType` vocabulary。所有用户可见 stream event 都从 canonical timeline 或 runtime status 派生；SSE 和 WebSocket 共用同一 projection contract。

理由：这样可以让 stream resume、history consistency 和 observability 使用同一事件事实。放弃 transport 自定义事件名的方案。

### 4. Owner scope 明确拆为 `tenantId` 和 `subjectId`

选择：owner scope 是 `tenantId` 和 `subjectId` 的组合语义，不引入单独 DTO。核心契约中所有需要归属边界的位置显式使用 `tenantId` 和 `subjectId`。Channel/auth 负责解析当前身份；请求体、模型输出、capability args 或客户端 metadata 不能覆盖当前身份。

理由：owner scope 是跨 session、attachment、capability、gateway、audit 的安全边界，字段必须稳定且可审计。

### 5. Gateway contract 只表达逻辑端口和并发语义

选择：gateway ports 只定义 session/message/run/timeline/checkpoint/artifact/pending input/feedback 等逻辑读写，以及 owner-scoped request、optimistic version、claim/fencing 和 idempotent terminal write 的语义。具体 local/remote adapter、SQLite schema、索引和 remote endpoint 不在本变更中定义。

理由：最小内核需要持久化边界，但不能把实现细节泄漏给 runtime、session 或 channel。放弃让上层模块依赖具体 store driver 的方案。

### 6. Capability 只冻结上位概念和执行边界

选择：Capability 公共 kind 为 `TOOL`、`SKILL`、`AGENT`。核心契约只定义 descriptor、provider identity、availability、invocation request/result、安全输出、审计/观测关联规则、取消/超时和幂等声明扩展位。具体工具集合、Skill source、Skill manifest、Agent execution 和冲突处理由后续 change 补实。

理由：能力治理是所有工具、Skill、SubAgent 和 API-backed Tool 的共同边界，但此 change 不应提前绑定具体 provider。

### 7. No-op 仅用于一层直接依赖

选择：hook、checkpoint save、audit sink 等一层直接依赖可以在最小内核中提供 no-op 实现，但 contract 必须是目标形态，主流程必须真实调用。

理由：这样最小内核能跑通问答，同时后续真实实现可以替换 provider 而不改主流程调用语义。放弃在最小内核中省略这些调用点的方案。

## 核心契约面（Core Contract Surface）

本节是领域对象字段、enum 和核心 port 签名的设计主承载。`specs/ts-core-contracts/spec.md` 只承载可验证行为，`tasks.md` 只承载实现和验证任务；实现阶段不得在单个实现包中重新定义本节已经冻结的跨模块字段、enum 或 port。

### 0. Public export modules

`agent-common` 是所有 contract 下方的独立 foundation package，承载 shared branded ids、基础 value object、JSON value、时间/幂等键、当前身份值对象、secret reference、安全错误基线和被多个边界共同消费的基础 enum；`agent-common` 不得导入 `agent-contracts`。`agent-contracts` 必须按拥有领域边界提供稳定 subpath export，承载 boundary DTO、enum、schema skeleton 和 port，不新增 `agent-contracts/common` owning module。每个 public contract 只能有一个 owning export surface；root `agent-contracts` 可以 re-export 稳定 public contract，但实现包应优先从 owning module import。实现包不得从其他实现包、adapter-private DTO、数据库 schema、provider SDK 类型或本地路径布局导入跨模块契约。

| Export surface | Owning objects and ports |
|---|---|
| `agent-common` | `Brand`、`TenantId`、`SubjectId`、`SessionId`、`MessageId`、`RequestRunId`、`CapabilityId`、`CapabilityInvocationId`、`ArtifactId`、`AttachmentId`、`BlobRef`、`CheckpointId`、`PendingInputId`、`AgentId`、`AgentVersion`、`RequestContextId`、`IdempotencyKey`、`EpochMillis`、`TimelineSequence`、`JsonValue`、`JsonObject`、`IdentityContext`、`RequestLocale`、`RequestLanguage`、`SecretReference`、`RunStatus`、`TerminalCommitState`、`TimelineEventType`、`CheckpointTriggerReason`、`CapabilityKind`、`CapabilityProviderKind`、`CapabilityReplayPolicy`、`CapabilityInvocationStatus`、`AgentErrorCategory`、`AgentErrorOptions`、`AgentError`、`SafeError` |
| `agent-contracts/runtime` | `LifecycleStage`、`SubmitRequestCommand`、`RequestControlCommand`、`EditLatestRequestCommand`、`RequestAccepted`、`RequestControlAccepted`、`RequestContext`、`ToolCallState`、`RequestRun`、`RunTimelineEvent`、`AgentAssembly`、`AgentCapabilityBinding`、`AgentRuntimeSettings`、`AgentAssemblyRegistry`、`RuntimeCommandPort`、`Agent`、`RunTimelineEventPort`、`RuntimeTimelinePort`、`RuntimeTimelineStreamRequest`、`CheckpointPayload`、`PendingInputKind`、`PendingInputStatus`、`PendingInputRequest`、`PendingInputQuestion`、`PendingInputOption`、`PendingInputAnswer`、`AnswerPendingInputCommand`、`PendingInputAnswerAccepted`、`PendingInput`、`HookExecutionMode`、`HookFailureMode`、`HookKind`、`HookDecision`、`HookInvocationStatus`、`LifecycleHookDefinition`、`AgentHookBinding`、`HookBoundary`、`BoundaryMutation`、`PendingInputIntent`、`HookInput`、`HookResult`、`HookInvocationEvent`、`LifecycleHookPort` |
| `agent-contracts/channel` | `StreamEventType`、`StreamEnvelope` |
| `agent-contracts/session` | `SessionMessageRole`、`MessageContentType`、`VisibilityReason`、`SessionMessage`、`SummaryMessageMetadata`、`ActiveContextState`、`ActiveContextItem`、`ActiveContextView`、`SessionHistoryQuery`、`SessionHistoryEntry`、`SessionHistoryPage`、`SessionConversationQuery`、`SessionConversationPage`、`CurrentRequestConversationQuery`、`ContentRef`、`ArtifactMetadata`、`Feedback`、`SubmitFeedbackRequest`、`ListFeedbackRequest` |
| `agent-contracts/attachment` | `AttachmentMediaType`、`AttachmentValidationStatus`、`AttachmentAvailabilityStatus`、`RequestAttachment` |
| `agent-contracts/context` | `ContextAssemblyRequest`、`SystemPromptSectionMetadata`、`SystemPromptSection`、`SystemPrompt`、`ContextAssembly`、`RenderedModelInput`、`ContextEnginePort` |
| `agent-contracts/model` | `ModelProviderKind`、`ChatMessageRole`、`ThinkingDepth`、`ThinkingOptions`、`ModelInfo`、`ModelOptions`、`ChatMessage`、`ModelToolCall`、`ModelInvocationRequest`、`ModelStreamDelta`、`ModelUsage`、`ModelFinalResult`、`ModelInvocationService` |
| `agent-contracts/capability` | `AvailabilityStatus`、`OsFamily`、`CpuArchitecture`、`CapabilityProvider`、`CapabilityCompatibility`、`CapabilityDescriptor`、`CapabilityInvocationRequest`、`CapabilityGeneratedMessage`、`CapabilityContextPatch`、`CapabilityInvocationResult`、`CapabilityCatalogRequest`、`CapabilityResolveRequest`、`CapabilityCatalogPort`、`CapabilityInvocationPort` |
| `agent-contracts/core` | `RoutingDecisionKind`、`AgentRoutingDecision` |
| `agent-contracts/gateway` | `VersionedUpdateStatus`、`VersionedUpdateResult`、`TerminalCommitStatus`、`TerminalCommitRecordResult`、`SessionMessageRecordRole`、`MessageContentRecordType`、`VisibilityRecordReason`、`AttachmentMediaRecordType`、`AttachmentValidationRecordStatus`、`AttachmentAvailabilityRecordStatus`、`BlobRecordPurpose`、`PendingInputRecordKind`、`PendingInputRecordStatus`、`PendingInputOptionRecord`、`PendingInputQuestionRecord`、`PendingInputRequestRecord`、`PendingInputAnswerRecord`、`RequestRunRecord`、`RunTimelineEventRecord`、`SessionRecord`、`SessionMessageRecord`、`SessionHistoryRecordQuery`、`SessionHistoryRecordEntry`、`SessionHistoryRecordPage`、`SessionConversationRecordQuery`、`SessionConversationRecordPage`、`CurrentRequestConversationRecordQuery`、`ActiveContextStateRecord`、`ActiveContextItemRecord`、`ActiveContextViewRecord`、`RequestAttachmentRecord`、`ArtifactMetadataRecord`、`CheckpointRecord`、`PendingInputRecord`、`FeedbackRecord`、`RequestRunWriteRequest`、`TerminalCommitRequest`、`RequestRunLookupRequest`、`ClaimRunRequest`、`SystemListRecoverableRunsRequest`、`RunTimelineEventAppendRequest`、`RunTimelineEventRecordQuery`、`SessionLookupRequest`、`SessionWriteRequest`、`SessionMessageWriteRequest`、`SessionMessageLookupRequest`、`HideMessageRequest`、`ActiveContextLookupRequest`、`AppendActiveContextItemRequest`、`ContextCompactionCommitRequest`、`SaveAttachmentRequest`、`LoadAttachmentRequest`、`ListAttachmentsByRequestIdRequest`、`UpdateAttachmentStatusRequest`、`StoreBlobRequest`、`LoadBlobRequest`、`DeleteBlobRequest`、`SaveArtifactMetadataRequest`、`LoadArtifactMetadataRequest`、`CheckpointWriteRequest`、`LoadCheckpointRequest`、`CreatePendingInputRecordRequest`、`LoadPendingInputRecordRequest`、`ResolvePendingInputRecordRequest`、`SubmitFeedbackRecordRequest`、`ListFeedbackRecordsRequest`、`SandboxExecutionRequest`、`SandboxExecutionResult`、`SandboxGatewayPort`、`RequestRunStoreGateway`、`RunTimelineEventStoreGateway`、`SessionStoreGateway`、`SessionMessageStoreGateway`、`ActiveContextStoreGateway`、`AttachmentStoreGateway`、`BlobStoreGateway`、`ArtifactGatewayPort`、`CheckpointStoreGateway`、`PendingInputStoreGateway`、`FeedbackStoreGateway` |
| `agent-contracts/observability` | `AttributeValue`、`Attributes`、`AuditEvent`、`AuditEventWriter`、`ErrorNormalizer` |
| `agent-contracts/app` | `AppConfiguration`、`ModelProfile`、`GatewayAdapterConfig`、`CapabilityProviderConfig`、`RetryConfig` |

跨边界 enum 的归属遵循三条规则：第一，跨多个核心模块共享、语义稳定、且不是单一业务领域私有状态的系统级 enum 归 `agent-common`，例如 `RunStatus`、`TerminalCommitState`、`TimelineEventType`、`CheckpointTriggerReason` 和基础 capability enum；第二，只服务单一业务边界的 enum 留在对应业务 subpath，例如 session message、attachment、pending input、hook、model 和 capability availability vocabulary；第三，只为持久化 record 形态存在、且不应反向决定领域归属的值，使用 gateway-owned record value type。

领域对象归其业务 owning module；read-model query 归提供该 read model 的业务 module；persistence DTO/PO 使用 `*Record` 命名并归 `agent-contracts/gateway`；logical gateway port、gateway write/request DTO 和 gateway-specific result type 也归 `agent-contracts/gateway`。例如 `SessionMessage`、`SessionHistoryQuery`、`SessionConversationQuery`、`ContentRef`、`ArtifactMetadata` 和 `Feedback` 归 `agent-contracts/session`，但 `SessionMessageRecord`、`SessionHistoryRecordQuery`、`ArtifactMetadataRecord`、`FeedbackRecord`、`SessionMessageStoreGateway`、`SessionMessageWriteRequest` 和 `HideMessageRequest` 归 `agent-contracts/gateway`；`RequestAttachment` 归 `agent-contracts/attachment`，但 `RequestAttachmentRecord` 和 `AttachmentStoreGateway` 归 `agent-contracts/gateway`；`CheckpointPayload`、pending input、hook lifecycle 和 runtime timeline 归 `agent-contracts/runtime`，但 `CheckpointRecord`、`PendingInputRecord`、`CheckpointStoreGateway` 和 `PendingInputStoreGateway` 归 `agent-contracts/gateway`；sandbox execution request/result/port 是 dynamic execution gateway boundary，归 `agent-contracts/gateway`。Gateway contract 不得引用上层领域 DO，也不得引用上层业务领域 subpath 的 enum/DTO；gateway Record 可引用 `agent-common` 中的系统级 durable vocabulary，但对 session、attachment、pending input、content 等业务领域 enum 必须使用 gateway-owned record value type。领域实现负责 DO 与 Record 的映射、值域一致性和校验。如果后续 change 增加 public contract，必须先选择 owning export module；除非新增独立领域边界，否则不得新增 export module。不得为了 reserved alias 或概念分类新增 owning subpath。

接口或 port 的 export 归属必须按模块依赖方向和调用边界判断，而不是按默认实现所在包判断。调用方需要依赖的抽象应放在调用方所属边界或稳定 contract 边界；实现类放在 provider/implementation package，通过 app composition 注入。例如 `Agent` 是 runtime 调用 agent-core 的执行 port，归 `agent-contracts/runtime`；agent-core 只实现该 port，不反向成为 runtime 的依赖。后续新增 port 时也必须先验证 package 依赖图不会形成循环依赖、向上依赖或实现包依赖实现包的跨层绕行。

虽然所有 contract 都由同一个 package 承载，但 subpath export 不是装饰性 namespace；它们代表各模块的 public surface 和依赖边界。实现包应从自身需要依赖的模块 subpath import，而不是把 root `agent-contracts` 当作无边界类型池使用。architecture lint 和 contract review 必须按 subpath import 检查 ownership、依赖方向和实现泄漏。

### 1. 通用 primitive 和安全对象

核心 contract 使用 branded string/number value object 表达稳定 id，不使用裸 `string` 在 public contract 中传递关键身份或事实引用。实现可以用 TypeBox schema 和 TypeScript brand 共同约束。

```ts
type Brand<T, Name extends string> = T & { readonly __brand: Name }
type TenantId = Brand<string, "TenantId">
type SubjectId = Brand<string, "SubjectId">
type SessionId = Brand<string, "SessionId">
type MessageId = Brand<string, "MessageId">
type RequestRunId = Brand<string, "RequestRunId">
type CapabilityId = Brand<string, "CapabilityId">
type CapabilityInvocationId = Brand<string, "CapabilityInvocationId">
type ArtifactId = Brand<string, "ArtifactId">
type AttachmentId = Brand<string, "AttachmentId">
type BlobRef = Brand<string, "BlobRef">
type CheckpointId = Brand<string, "CheckpointId">
type PendingInputId = Brand<string, "PendingInputId">
type AgentId = Brand<string, "AgentId">
type AgentVersion = Brand<string, "AgentVersion">
type RequestContextId = Brand<string, "RequestContextId">
type IdempotencyKey = Brand<string, "IdempotencyKey">
type EpochMillis = Brand<number, "EpochMillis">
type TimelineSequence = Brand<number, "TimelineSequence">
type JsonValue = string | number | boolean | null | JsonObject | readonly JsonValue[]
type JsonObject = { readonly [key: string]: JsonValue }
```

核心安全对象如下：

```ts
interface IdentityContext {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly displayName: string
}

type AgentErrorCategory =
  | "VALIDATION"
  | "AUTHORIZATION"
  | "POLICY_DENIED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "CANCELED"
  | "INTERNAL"

interface AgentErrorOptions {
  readonly code: string
  readonly message: string
  readonly category: AgentErrorCategory
  readonly retryable?: boolean
  readonly safeDetails?: JsonObject
  readonly cause?: unknown
}

class AgentError extends Error {
  readonly code: string
  readonly category: AgentErrorCategory
  readonly retryable: boolean
  readonly safeDetails?: JsonObject

  constructor(options: AgentErrorOptions)
}

interface SafeError {
  readonly code: string
  readonly message: string
  readonly category: AgentErrorCategory
  readonly retryable: boolean
  readonly safeDetails?: JsonObject
}

type RequestLocale = Brand<string, "RequestLocale">
type RequestLanguage = "ZH" | "EN" | "MIXED"

type SecretReference = Brand<`env:${string}` | `file:${string}`, "SecretReference">

type RunStatus =
  | "ACCEPTED"
  | "QUEUED"
  | "PLANNING"
  | "EXECUTING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED"
  | "SUPERSEDED"

type TerminalCommitState =
  | "NOT_STARTED"
  | "PENDING"
  | "RETRYING"
  | "COMMITTED"
  | "FAILED"

type TimelineEventType =
  | "REQUEST_ACCEPTED"
  | "PLANNING_STARTED"
  | "LLM_THINKING_DELTA"
  | "LLM_CONTENT_DELTA"
  | "CAPABILITY_RESULT_DELTA"
  | "CAPABILITY_STARTED"
  | "CAPABILITY_COMPLETED"
  | "DEGRADATION_NOTICE"
  | "REQUEST_COMPLETED"
  | "REQUEST_FAILED"
  | "REQUEST_CANCELED"
  | "REQUEST_SUPERSEDED"
  | "ATTACHMENT_ACCEPTED"
  | "ATTACHMENT_REJECTED"
  | "CONTEXT_COMPACTED"
  | "POLICY_APPLIED"
  | "HOOK_DECISION_APPLIED"
  | "USER_INPUT_REQUIRED"
  | "USER_INPUT_RECEIVED"
  | "USER_INPUT_TIMEOUT"
  | "USER_INPUT_CANCELED"

type CheckpointTriggerReason =
  | "RUN_ACCEPTED"
  | "STEP_STARTED"
  | "CAPABILITY_BEFORE_CALL"
  | "CAPABILITY_AFTER_RETURN"
  | "CONTEXT_COMPACTED"
  | "TERMINAL_COMMIT_PENDING"
  | "TERMINAL_COMMITTED"
  | "TERMINAL_PENDING_COMMIT_TAKEOVER"

type CapabilityKind = "TOOL" | "SKILL" | "AGENT"
type CapabilityProviderKind =
  | "BUNDLED"
  | "LOCAL_DIRECTORY"
  | "SKILL_HUB"
  | "MCP_SERVER"
  | "AGENT_REGISTRY"
  | "CUSTOM"
type CapabilityReplayPolicy = "NON_IDEMPOTENT" | "IDEMPOTENT"
type CapabilityInvocationStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "DEGRADED" | "TIMED_OUT"
```

不变量：

- `tenantId`、`subjectId`、`displayName`、所有 id 和 `IdempotencyKey` 必须非空。
- `EpochMillis` 表示 Unix epoch 起算的 UTC 毫秒数，只用于 wire、persistence、audit、metric、stream 和其他序列化 contract 边界；runtime 内部可以使用 `Date` 或受控 clock，并在进入边界 DTO 前转换为 `EpochMillis`。
- `TimelineSequence` 表示 session timeline 游标，取值必须是非负安全整数且不超过 `Number.MAX_SAFE_INTEGER`；canonical timeline event 的 sequence 从 1 开始，`lastSeenSequence=0` 表示调用方尚未接收任何事件。
- timeline sequence 在单个 session 内单调递增，不按 run 重置，不允许回绕、取模或复用。多实例部署下，同一 session 内并发产生的 timeline event 不得获得重复 sequence，也不得以破坏 sequence 顺序的方式对外发布；核心契约不规定具体协调机制。
- 日历型业务规则不得用 `EpochMillis` 表达；需要按地区日期、时间或时区计算时，后续 contract 必须显式建模 local date、local time 和 time zone。
- `RequestLocale` 必须是非空 BCP 47 locale 字符串；channel 或 app composition 负责归一化和默认值选择。
- `RunStatus`、`TerminalCommitState`、`TimelineEventType` 和 `CheckpointTriggerReason` 是跨 runtime、gateway、session/history、recovery、observability 或 channel projection 共同消费的系统级 durable vocabulary，归 `agent-common`；runtime、gateway、checkpoint 和 session subpath 不得重新定义等价 enum。
- `CapabilityKind`、`CapabilityProviderKind`、`CapabilityReplayPolicy` 和 `CapabilityInvocationStatus` 是跨 runtime、app configuration、assembly、capability 和 recovery 边界共同消费的基础 enum，归 `agent-common`；capability descriptor、Agent assembly 和 runtime recovery 不得在各自 subpath 中重新定义等价 enum。
- `tenantId` 和 `subjectId` 归属字段只来自可信 channel/auth boundary，不从请求体、模型输出或 capability 参数覆盖。
- `AgentError` 是内部 throw/catch 用的标准错误形态；`SafeError` 是跨 API、stream、capability result、audit 和 log boundary 的安全 DTO。
- `catch` 到的 `unknown` 必须通过错误归一化边界转换为 `SafeError` 后才能跨边界输出。
- `SafeError.message` 是用户可见安全消息；`safeDetails` 只能包含脱敏后、低敏感度、JSON-compatible 的诊断摘要；`cause`、stack、raw provider error、raw model/tool input、local path 和 credential 不得进入 `SafeError`。
- `SecretReference` 只表达 secret 来源，取值只能是 `env:` 或 `file:` 引用；raw secret value、inline secret、无凭据哨兵值不进入 config、log、stream、audit、metric 或 model context。
- 如果引用内容使用 `ENC(...)` 或等价加密 envelope，解析和解密属于 secret resolver 或 adapter 实现能力，不属于 `SecretReference` grammar；解密密钥必须来自独立 secret source。

### 2. Runtime、session、timeline 和 stream 对象

Runtime lifecycle 消费 `agent-common` 中冻结的 `RunStatus` 和 `TerminalCommitState`；runtime-owned lifecycle stage 与 session message vocabulary 如下：

```ts
type LifecycleStage =
  | "BEFORE_REQUEST_ACCEPT"
  | "BEFORE_PLANNING"
  | "BEFORE_MODEL_INVOKE"
  | "AFTER_MODEL_RESULT"
  | "BEFORE_CAPABILITY_INVOKE"
  | "AFTER_CAPABILITY_RESULT"
  | "BEFORE_CONTEXT_COMPACT"
  | "AFTER_CONTEXT_COMPACT"
  | "BEFORE_TERMINAL_EVENT"

type SessionMessageRole = "USER" | "ASSISTANT" | "CAPABILITY_RESULT" | "SUMMARY"
type MessageContentType = "PLAIN_TEXT" | "MARKDOWN" | "MERMAID"
type VisibilityReason = "RETRY_REPLACED" | "EDIT_REPLACED" | "CAPABILITY_GENERATED"
```

核心 request/run/message 对象如下：

```ts
interface SubmitRequestCommand {
  readonly sessionId: SessionId
  readonly identityContext: IdentityContext
  readonly inputText: string
  readonly attachmentIds: readonly AttachmentId[]
  readonly locale: RequestLocale
  readonly idempotencyKey: IdempotencyKey
}

interface RequestControlCommand {
  readonly sessionId: SessionId
  readonly identityContext: IdentityContext
  readonly expectedLatestRequestId: MessageId
  readonly action: "CANCEL" | "RETRY_LATEST"
  readonly idempotencyKey: IdempotencyKey
}

interface EditLatestRequestCommand {
  readonly sessionId: SessionId
  readonly identityContext: IdentityContext
  readonly expectedLatestRequestId: MessageId
  readonly editedInputText: string
  readonly attachmentIds: readonly AttachmentId[]
  readonly idempotencyKey: IdempotencyKey
}

interface RequestAccepted {
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId: RequestRunId
  readonly attempt: number
}

interface RequestControlAccepted {
  readonly sessionId: SessionId
  readonly targetRequestId: MessageId
  readonly action: "CANCEL" | "RETRY_LATEST"
  readonly idempotencyKey: IdempotencyKey
}

interface RequestContext {
  readonly requestContextId: RequestContextId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId: RequestRunId
  readonly identityContext: IdentityContext
  readonly locale: RequestLocale
  readonly agentId: AgentId
  readonly agentVersion: AgentVersion
  readonly agentAssemblyRef: string
  readonly activeStepId?: string
  readonly nextLifecycleStage: LifecycleStage
  readonly currentToolBatchMessageId?: MessageId
  readonly toolCallStates: readonly ToolCallState[]
  readonly flowVariables: JsonObject
}

interface ToolCallState {
  readonly toolCallId: string
  readonly capabilityId: CapabilityId
  readonly arguments: JsonObject
  readonly status: CapabilityInvocationStatus
}

interface RequestRun {
  readonly runId: RequestRunId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly agentId: AgentId
  readonly agentVersion: AgentVersion
  readonly agentAssemblyRef: string
  readonly attempt: number
  readonly retryOfRunId?: RequestRunId
  readonly status: RunStatus
  readonly version: number
  readonly terminalCommitState: TerminalCommitState
  readonly lockedBy?: string
  readonly lockExpiresAt?: EpochMillis
  readonly deadlineAt?: EpochMillis
  readonly createdAt: EpochMillis
  readonly updatedAt: EpochMillis
}

interface SessionMessage {
  readonly messageId: MessageId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId?: RequestRunId
  readonly role: SessionMessageRole
  readonly content: string
  readonly contentType: MessageContentType
  readonly attachmentIds: readonly AttachmentId[]
  readonly metadata: JsonObject
  readonly sequence: number
  readonly visible: boolean
  readonly hideReason?: VisibilityReason
  readonly hiddenAt?: EpochMillis
  readonly hiddenByContextId?: RequestContextId
  readonly createdAt: EpochMillis
}

type SummaryMessageMetadata = JsonObject & {
  readonly kind: "CONTEXT_COMPRESSION_SUMMARY"
  readonly sourceActiveContextVersion: number
  readonly targetActiveContextVersion: number
  readonly coveredMessageRefs: readonly MessageId[]
  readonly retainedTailMessageRefs: readonly MessageId[]
  readonly strategy: "PREFIX_COMPACT_RECENT_TAIL"
  readonly tokenCount: number
}

interface ActiveContextState {
  readonly sessionId: SessionId
  readonly activeContextVersion: number
  readonly updatedAt: EpochMillis
}

interface ActiveContextItem {
  readonly sessionId: SessionId
  readonly ordinal: number
  readonly messageId: MessageId
}

interface ActiveContextView {
  readonly state: ActiveContextState
  readonly items: readonly ActiveContextItem[]
}
```

`identityContext` 由可信 channel/auth boundary 注入，不来自客户端 payload。`SubmitRequestCommand` 和 `EditLatestRequestCommand` 使用 `attachmentIds` 表达本次请求引用的已上传附件 id，command 不承载附件名称、类型、大小、状态或存储引用。`RequestControlCommand` 和 `EditLatestRequestCommand` 使用 `expectedLatestRequestId` 表达 latest-request 乐观校验语义；使用 `editedInputText` 表达编辑后的用户输入文本；这些字段名属于核心 command contract 的稳定语义，后续 change 不得用泛化的 `owner`、`targetId`、`input` 或 `metadata` 字段替代。Runtime 必须使用 `identityContext.tenantId` 和 `identityContext.subjectId` 校验 session、latest request、message 和 run 的 owner scope。

`RequestAccepted` 表达 runtime 已接受并创建对应执行实例，字段固定为 `sessionId`、`requestId`、`runId` 和 `attempt`，不暴露 stream cursor 或 timeline sequence 字段。`requestId` 是请求的根用户消息 id；retry 保持同一个 `requestId` 并创建新的 `runId`；edit 创建新的 `requestId`。`retryLatest` 和 `editLatest` 会创建新的执行实例，因此成功受理时返回 `RequestAccepted`。`RequestRun` 不直接接受客户端传入 owner 字段；`tenantId` 和 `subjectId` 通过 runtime command、gateway lookup/write request 和 audit event 传递。`attempt` 从 1 开始；`version` 从 1 开始并在恢复相关边界递增；`retryOfRunId` 只能在 `attempt > 1` 时存在；终态为 `COMPLETED`、`FAILED`、`CANCELED`、`SUPERSEDED`。降级不属于 `RunStatus`；降级通过 timeline/stream event、capability/model result、safe error、audit event 或 observability metric 表达。

`RequestContext` 是 runtime/core 之间的可恢复执行坐标，不重复保存由其他 durable fact 拥有的字段。`attempt` 和 `deadlineAt` 的事实源是 `RequestRun`，不得复制到 `RequestContext`。`RequestContext` 不包含 `messageRefs`；模型上下文永远从 active context view 读取，具体进入模型上下文的消息由 `ContextAssembly.selectedMessageRefs` 表达。工具轮后下一次模型调用需要看到当前 run 已产生消息时，runtime/session 必须在保存模型可见消息时同步维护 active context view；恢复重建 pending tool call 时才按 `sessionId`、`requestId` 和 `runId` 从 message store 查询当前 run messages。恢复执行点参照当前运行逻辑从 persisted messages、checkpoint `lastSequence`/`triggerReason`、tool call state、timeline、`activeContextVersion` 和 run version 对账重建，不通过 `RequestContext.messageRefs` 表达。`currentToolBatchMessageId` 指向当前 tool batch 的 assistant tool-use message；`toolCallStates` 保存该 batch 中每个 tool call 的 `toolCallId`、`capabilityId`、结构化 `arguments` 和 `status`，用于恢复后继续执行 pending tool call。checkpoint 不保存完整 `toolCallStates`，只保存恢复边界和校验所需字段；恢复时优先按 checkpoint 的 run/version/sequence/trigger 约束，从 message store 读取当前 run messages，定位 assistant tool-use message 及 capability result messages 后重建 `RequestContext`。`locale` 是核心上下文中唯一的用户语言/区域化输入事实，表示客户端或 channel 归一化后的 BCP 47 locale，例如 `zh-CN`、`en-US`；它用于 prompt 中的回答语言、日期、数字、货币、单位和用户可见文案区域化要求。`RequestLanguage` 只作为从 `locale` 或用户输入派生出的内部/兼容枚举，用于 capability language filtering、标题规则等窄场景，不进入 `RequestContext`、`ContextAssemblyRequest` 或 `ContextAssembly`。`nextLifecycleStage` 只允许表达可恢复执行点，包括 `BEFORE_MODEL_INVOKE`、`BEFORE_CAPABILITY_INVOKE` 和 `BEFORE_TERMINAL_EVENT`；`currentToolBatchMessageId` 和 `toolCallStates` 仅在 `nextLifecycleStage=BEFORE_CAPABILITY_INVOKE` 时有效。`flowVariables` 是 request-scoped JSON-compatible map，用于恢复和执行内的轻量流程变量，不作为跨 request 业务事实。

`LifecycleStage` 由 runtime ownership 定义，表达 request lifecycle 中可执行 hook、checkpoint、recovery 或 terminal boundary 的稳定阶段。Hook contract 只能消费 `LifecycleStage`，不得重新拥有 lifecycle stage vocabulary；后续新增 lifecycle stage 必须先确认 runtime 恢复语义、hook 执行点和 terminal commit 边界。

Timeline event vocabulary 由 `agent-common` 中的 `TimelineEventType` 冻结；channel-owned stream projection enum 和 envelope 如下：

```ts
type StreamEventType =
  | "REQUEST_ACCEPTED"
  | "LLM_THINKING_DELTA"
  | "LLM_CONTENT_DELTA"
  | "CAPABILITY_STARTED"
  | "CAPABILITY_RESULT_DELTA"
  | "CAPABILITY_COMPLETED"
  | "DEGRADATION_NOTICE"
  | "REQUEST_COMPLETED"
  | "REQUEST_FAILED"
  | "REQUEST_CANCELED"
  | "REQUEST_SUPERSEDED"
  | "USER_INPUT_REQUIRED"
  | "USER_INPUT_RECEIVED"
  | "USER_INPUT_TIMEOUT"
  | "USER_INPUT_CANCELED"
  | "ATTACHMENT_ACCEPTED"
  | "ATTACHMENT_REJECTED"
  | "CONTEXT_COMPACTED"

interface RunTimelineEvent {
  readonly eventId?: string
  readonly sessionId?: SessionId
  readonly runId?: RequestRunId
  readonly requestId?: MessageId
  readonly requestContextId?: RequestContextId
  readonly sequence?: TimelineSequence
  readonly type: TimelineEventType
  readonly inlinePayload: JsonObject
  readonly contentRef?: string
  readonly createdAt?: Date
}

interface StreamEnvelope {
  readonly eventId: string
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId?: RequestRunId
  readonly requestContextId?: RequestContextId
  readonly sequence: TimelineSequence
  readonly eventType: StreamEventType
  readonly timelineEventRef?: string
  readonly transportHints: readonly string[]
  readonly payload: JsonObject
  readonly createdAt: EpochMillis
}

interface RuntimeTimelineStreamRequest {
  readonly sessionId: SessionId
  readonly lastSeenSequence: TimelineSequence
  readonly requestId?: MessageId
  readonly runId?: RequestRunId
}
```

`RunTimelineEvent` 同时作为 agent/core authoring event 和 runtime canonical timeline event。agent/core 通过 runtime 提供的 timeline port 发布事件时，只需要提供 `type`、`inlinePayload` 和必要的 `contentRef`；runtime MUST 在接收时填充或复写 `eventId`、`sessionId`、`runId`、`requestId`、`requestContextId`、`sequence` 和 `createdAt`。进入持久化、stream、replay、audit 关联或 terminal commit 后的 canonical timeline event MUST 具备这些 runtime-owned 字段。agent/core 不得依赖自己传入的 runtime-owned 字段被保留。

Stream 只能投影 canonical timeline 或 runtime status；不得暴露本节未列出的用户可见 stream event 名称。`requestId` 表示当前用户请求的 root message id；StreamEnvelope 使用 `requestId` 作为请求关联字段。从 timeline 投影时，`requestId` 来自 `RunTimelineEvent.requestId`，`runId` 来自 `RunTimelineEvent.runId`，`requestContextId` 来自 `RunTimelineEvent.requestContextId`，`timelineEventRef` 指向来源 `RunTimelineEvent.eventId`。`StreamEnvelope.eventId` 是 stream event 自身 id，不要求复用来源 timeline event id。`payload` 是经 channel 投影、脱敏和转换后的用户可见 payload，不要求等同于 timeline `inlinePayload`。`RuntimeTimelineStreamRequest.lastSeenSequence` 表示调用方最后成功接收的 session timeline sequence；runtime stream 返回同一 session 下 `sequence > lastSeenSequence` 的可恢复事件和后续 live 事件，`requestId` 和 `runId` 只作为过滤条件。Delta 事件不要求持久化，且每个 delta event 必须携带当前 delta stream 的累计全量；replay 可以从 `lastSeenSequence` 之后最近的可恢复事件继续，不要求补齐每一个 sequence。历史对话展示以 `SessionMessage` 为最终内容事实来源，不通过 timeline event 重建最终会话内容；stream replay 恢复运行过程事实，gap 或 delta 不可恢复时应通过 stream notice 和 history refresh 读取 visible messages 协助恢复展示。

### 3. Context、model 和 large-content 引用对象

Context Engine 负责上下文选择、预算和大内容引用边界。核心对象如下：

```ts
type AttachmentMediaType = "WORD" | "EXCEL" | "PDF" | "MARKDOWN"
type AttachmentValidationStatus = "PENDING" | "ACCEPTED" | "REJECTED"
type AttachmentAvailabilityStatus = "STAGED" | "AVAILABLE" | "UNAVAILABLE"

interface ContentRef {
  readonly refId: string
  readonly refType: "ATTACHMENT" | "CAPABILITY_RESULT" | "MODEL_SUMMARY" | "ARTIFACT"
  readonly attachmentId?: AttachmentId
  readonly artifactId?: ArtifactId
  readonly mimeType?: string
  readonly sizeBytes?: number
  readonly safeSummary?: string
}

interface RequestAttachment {
  readonly attachmentId: AttachmentId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId?: RequestRunId
  readonly agentId: AgentId
  readonly fileName: string
  readonly mediaType: AttachmentMediaType
  readonly sizeBytes: number
  readonly storageRef: BlobRef
  readonly validationStatus: AttachmentValidationStatus
  readonly availabilityStatus: AttachmentAvailabilityStatus
  readonly createdAt: EpochMillis
}

interface ContextAssemblyRequest {
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly requestContextId: RequestContextId
  readonly agentId: AgentId
  readonly agentVersion: AgentVersion
  readonly runId: RequestRunId
  readonly stepId: string
  readonly locale: RequestLocale
  readonly purpose: string
}

interface SystemPromptSectionMetadata {
  readonly overridable: boolean
  readonly sectionKey?: string
  readonly order: number
  readonly dependencies: readonly string[]
}

interface SystemPromptSection {
  readonly sectionId: string
  readonly heading: string
  readonly content: string
  readonly metadata: SystemPromptSectionMetadata
}

interface SystemPrompt {
  readonly stableSections: readonly SystemPromptSection[]
  readonly dynamicSections: readonly SystemPromptSection[]
  readonly cacheBoundaryMarker: string
}

interface ContextAssembly {
  readonly requestContextId: RequestContextId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId: RequestRunId
  readonly stepId: string
  readonly agentId: AgentId
  readonly agentVersion: AgentVersion
  readonly locale: RequestLocale
  readonly purpose: string
  readonly producedAt: EpochMillis
  readonly systemPrompt: SystemPrompt
  readonly selectedMessageRefs: readonly MessageId[]
  readonly visibleCapabilities: readonly CapabilityDescriptor[]
  readonly modelInfo: ModelInfo
  readonly modelOptions: ModelOptions
  readonly modelSelectionReason: string
}
```

附件引用在 runtime command 和 `SessionMessage` 中只保存 `AttachmentId`。`fileName`、`mediaType`、`sizeBytes`、`storageRef`、`validationStatus` 和 `availabilityStatus` 的权威事实只存在于 `RequestAttachment`，由 attachment metadata store 查询。Runtime 接受请求前必须按 `identityContext.tenantId`、`identityContext.subjectId` 和 `attachmentIds` 加载 `RequestAttachment`，校验附件属于当前 owner/request 可见范围，且 `validationStatus="ACCEPTED"`、`availabilityStatus="AVAILABLE"` 后才能接受请求。Context Engine 生成附件 descriptor 或加载 Markdown 附件内容时，也必须通过 `AttachmentId` 查询权威 `RequestAttachment`；不得信任 command、message metadata、模型输出或 capability 参数中的附件名称、类型、大小或存储引用。

`BlobRef` 是通用内容存储引用，不是业务 id。附件、大的 capability result、artifact 内容和其他大对象可以共用 `BlobStoreGateway` 保存 bytes；上层只能保存和传递 opaque `BlobRef`，不得解析、拼接或把它当成本地路径、URL、bucket/key/version 结构使用。`BlobRef` 不得进入模型上下文、用户可见 stream、SafeError、audit 明细或结构化日志；用户可见名称、类型、大小和摘要必须来自对应 metadata。附件和 artifact 是并列 durable fact：附件表达用户输入文件生命周期，artifact 表达输出或大内容 metadata；两者可以通过 `ContentRef`、`ArtifactMetadata` 或业务 metadata 关联，但不得共享 id 或合并 store。

Active context view 是模型可见上下文的唯一 durable 引用序列。`messages` 保存完整原始消息和压缩生成的 summary message，并保持 append-only；`active_context_items` 按一行一个 `messageId` 保存当前模型上下文可见序列，便于和 `session_messages` 联合查询。`ordinal` 只表达同一 session active context view 内的稳定排序，必须由 `ActiveContextStoreGateway` 在 append 或 compaction commit 时生成/维护，不得来自客户端、channel、模型输出或 capability 参数；核心契约只要求同一 active context view 内 `ordinal` 唯一且按升序还原模型上下文，不规定连续编号、间隔编号或重排策略。Context Engine 组装模型输入时 MUST 先读取 `ActiveContextView.items`，再按 item `messageId` 和 `ordinal` 从不可变 `SessionMessage` store/cache 获取内容；不得直接从全量 messages 按时间范围拼装模型上下文。初始 active context 等于 raw messages 的引用序列；后续模型可见消息写入时必须追加 active context item。压缩采用 prefix compact + recent tail：将被压缩前缀生成一个 `role="SUMMARY"` 的 `SessionMessage`，其 `metadata` 必须符合 `SummaryMessageMetadata`。`SummaryMessageMetadata` 是 `JsonObject` 的 typed extension，所有字段必须是 JSON-compatible value；实现应通过 schema/type guard 在写入和读取 summary message 时校验。压缩保留 recent tail 的原顺序，用 summary message id 替换被压缩前缀。提交压缩时，写入 summary message、替换 active context items 和递增 `activeContextVersion` 必须具备同一事务语义；`activeContextVersion` 是 active context view 的 optimistic lock version，由 store 在模型可见 message append 和 compaction commit 成功时递增；写请求必须携带 `expectedActiveContextVersion`，版本不匹配时返回 version conflict，不得覆盖当前 active context。`ContentRef.refType="MODEL_SUMMARY"` 指向 summary `SessionMessage.messageId`，不指向独立 summary store。raw messages 只用于审计、UI、导出和必要时重新构造 active context，不作为模型调用的直接来源。

模型调用对象如下：

```ts
type ModelProviderKind = "OPENAI" | "MINIMAX" | "DEEPSEEK" | "QWEN"
type ChatMessageRole = "SYSTEM" | "USER" | "ASSISTANT" | "TOOL"
type ThinkingDepth = "MINIMAL" | "LOW" | "MEDIUM" | "HIGH" | "XHIGH"

interface ThinkingOptions {
  readonly enabled?: boolean
  readonly depth?: ThinkingDepth
  readonly budget?: number
}

interface ModelInfo {
  readonly baseUrl: string
  readonly credentialRef: SecretReference
  readonly modelName: string
}

interface ModelOptions {
  readonly temperature?: number
  readonly maxTokens?: number
  readonly topP?: number
  readonly thinking: ThinkingOptions
  readonly providerOptions: JsonObject
}

interface ChatMessage {
  readonly role: ChatMessageRole
  readonly content: string
  readonly toolCalls: readonly ModelToolCall[]
  readonly toolCallId?: string
}

interface ModelToolCall {
  readonly toolCallId: string
  readonly toolName: string
  readonly args: JsonObject
}

interface RenderedModelInput {
  readonly requestContextId: RequestContextId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId: RequestRunId
  readonly stepId: string
  readonly messages: readonly ChatMessage[]
  readonly modelName: string
  readonly baseUrl: string
  readonly credentialRef: SecretReference
  readonly temperature?: number
  readonly maxTokens?: number
  readonly topP?: number
  readonly thinking: ThinkingOptions
  readonly providerOptions: JsonObject
  readonly tools: readonly JsonObject[]
}

interface ModelInvocationRequest {
  readonly requestId: MessageId
  readonly stepId: string
  readonly providerKind: ModelProviderKind
  readonly modelName: string
  readonly baseUrl: string
  readonly credentialRef: SecretReference
  readonly messages: readonly ChatMessage[]
  readonly tools: readonly JsonObject[]
  readonly temperature?: number
  readonly maxTokens?: number
  readonly topP?: number
  readonly thinking: ThinkingOptions
  readonly providerOptions: JsonObject
  readonly timeoutMs: number
}

interface ModelStreamDelta {
  readonly kind: "THINK_DELTA" | "CONTENT_DELTA" | "TOOL_CALL_DELTA"
  readonly delta?: string
  readonly toolCallId?: string
  readonly toolName?: string
  readonly toolIndex?: number
  readonly finishReason?: string
  readonly complete: boolean
}

interface ModelUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
  readonly providerRequestId?: string
}

interface ModelFinalResult {
  readonly responseId?: string
  readonly modelId?: string
  readonly content: string
  readonly thinking?: string
  readonly finishReason?: string
  readonly usage: ModelUsage
  readonly toolCalls: readonly ModelToolCall[]
  readonly safeError?: SafeError
}
```

`ThinkingOptions.depth` 和 `ThinkingOptions.budget` 不得同时存在；未显式配置时由 provider/profile default 决定有效值。

`ChatMessage` 是模型调用层的 provider-neutral chat message，命名对齐现有模型调用边界；它归 `agent-contracts/model`，不归 context subpath。`ContextAssembly` 是 Context Engine render 的输入，不是 `RenderedModelInput` 的组成部分。`RenderedModelInput` 是已渲染模型输入，只保留 request/session/run/message/step 最小执行坐标和模型调用所需字段。context selection、capability visibility、model selection reason、omitted/compaction reason 等审计或诊断信息 MUST 在 assembly/render 生成时记录到 timeline、audit event、structured log 或 observability metric，而不是通过 `RenderedModelInput` 传递。进入 `ModelInvocationService` 前，core/runtime MUST 将 `RenderedModelInput` 转换为扁平 `ModelInvocationRequest`；`agent-model` 不接收完整 `ContextAssembly` 或 `RenderedModelInput`，只接收模型调用所需字段。`providerKind` 是必填字段，用于让 `agent-model` 选择内部 provider adapter 并构造实际模型客户端；provider SDK、AI SDK 或平台推理网关类型不得进入核心契约。`ModelInvocationRequest` 不包含 `stream` 字段；调用模式由 `ModelInvocationService.complete(...)` 或 `ModelInvocationService.stream(...)` 方法选择。runtime、timeline 和 channel sequencing 不进入 `ModelInvocationRequest`。

### 4. Capability、Agent assembly 和 routing 对象

Capability 是 Tool、Skill 和 Agent 的统一上位概念。核心 contract 只定义 descriptor、catalog、调用和结果边界，不定义具体工具集合或 source 实现。

```ts
type AvailabilityStatus = "AVAILABLE" | "DISABLED" | "UNAVAILABLE"
type OsFamily = "WINDOWS" | "LINUX" | "MACOS" | "OTHER"
type CpuArchitecture = "X86_64" | "AARCH64" | "X86" | "ARM" | "OTHER"

interface CapabilityProvider {
  readonly providerId: string
  readonly providerKind: CapabilityProviderKind
  readonly providerType?: string
}

interface CapabilityCompatibility {
  readonly supportedOsFamilies?: readonly OsFamily[]
  readonly supportedArchitectures?: readonly CpuArchitecture[]
  readonly requiredExecutables?: readonly string[]
  readonly requiredEnvironmentKeys?: readonly string[]
  readonly requiredConfigurationKeys?: readonly string[]
  readonly networkRequired?: boolean
  readonly runtimeTags?: readonly string[]
}

interface CapabilityDescriptor {
  readonly capabilityId: CapabilityId
  readonly kind: CapabilityKind
  readonly provider: CapabilityProvider
  readonly version?: string
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonObject
  readonly availability: AvailabilityStatus
  readonly replayPolicy: CapabilityReplayPolicy
  readonly supportedLanguages?: readonly RequestLanguage[]
  readonly compatibility?: CapabilityCompatibility
  readonly availabilityReason?: string
  readonly metadata?: JsonObject
}

interface CapabilityInvocationRequest {
  readonly invocationId: CapabilityInvocationId
  readonly capabilityId: CapabilityId
  readonly toolCallId?: string
  readonly arguments: JsonObject
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId: RequestRunId
  readonly requestContextId: RequestContextId
  readonly stepId: string
  readonly identityContext: IdentityContext
  readonly agentId: AgentId
  readonly agentVersion: AgentVersion
  readonly timeoutMs: number
  readonly idempotencyKey?: IdempotencyKey
}

interface CapabilityGeneratedMessage {
  readonly role: "USER"
  readonly content: string
  readonly meta: boolean
}

interface CapabilityContextPatch {
  readonly allowedTools?: readonly string[]
  readonly modelName?: string
  readonly modelOptions?: ModelOptions
}

interface CapabilityInvocationResult {
  readonly invocationId: CapabilityInvocationId
  readonly status: CapabilityInvocationStatus
  readonly resultRef?: string
  readonly structuredPayload: JsonObject
  readonly generatedMessages: readonly CapabilityGeneratedMessage[]
  readonly contextPatch?: CapabilityContextPatch
  readonly artifactRefs: readonly ArtifactId[]
  readonly error?: SafeError
  readonly fallbackTriggered: boolean
  readonly metadata: JsonObject
}
```

`CapabilityProvider.providerKind` 表达核心系统理解的 provider 大类；`providerId` 表达具体 provider 实例；`providerType` 仅在 `providerKind="CUSTOM"` 时必填，用于标识 app composition 显式注册的自定义 provider adapter。未注册的 custom provider 不得进入可执行 catalog。`CapabilityProvider` 不承载 Agent 绑定、scope、优先级、shadowing 或 agentId/agentVersion；这些语义由 Agent assembly、catalog governance 和 conflict resolution 处理。`version` 表达 capability 元数据或实现版本；provider 执行所需的内部 entry ref 不进入核心 descriptor，由 provider adapter 内部映射。`supportedLanguages` 缺省表示不限制语言。`CapabilityCompatibility` 是 capability descriptor 的静态兼容性元数据，用于描述 OS、CPU、可执行文件、环境变量、配置键、网络和 runtime tag 约束；`compatibility` 缺省语义为 unrestricted，`CapabilityCompatibility` 内字段缺省为空集合或 `networkRequired=false`。`metadata` 只承载 provider 提供的扩展描述信息，不得作为 runtime/core 决定可见性、授权、routing、availability 或 replay safety 的依据；如果某个 metadata key 被多个 provider 共同使用并影响行为，必须提升为显式核心字段或后续 change 定义的 typed extension。只有 `availability="AVAILABLE"` 的 capability 可以进入模型可见列表和执行路径；`DISABLED` 表示被配置、Agent binding、治理策略或显式禁用列表关闭；`UNAVAILABLE` 表示非人为禁用但当前不可执行，包括缺配置、credential、路径、依赖、探活失败、descriptor 无效或 custom provider 未注册。`availabilityReason` 只能是安全 reason code 或 safe summary，不得包含 raw path、secret、provider response 或敏感配置；`metadata` 同样不得包含 secret、raw path、raw provider response、用户输入、模型输入/输出或认证凭据，且不得原样进入模型上下文或客户端输出。

`CapabilityInvocationRequest` 是 agent-capability 的执行领域对象，不是模型 tool_use DTO。`toolCallId` 仅用于保留模型工具调用或上游调用关联，非模型触发的 capability 调用可以省略。`arguments` 是按 capability `inputSchema` 校验后的执行参数。`requestId` 对齐当前用户请求的 root message id；`runId` 对齐当前 RequestRun。`identityContext` 必须由可信 runtime/channel boundary 注入，capability 不得从 `arguments` 读取 tenant、subject 或 owner。`workspaceDir` 不进入核心 invocation request；本地工作目录、sandbox 和 provider 执行环境由 capability/provider 模块基于 `AgentAssembly.workspaceDir` 和 provider configuration 解析。恢复场景下 runtime 必须在调用 capability 前根据 descriptor replay policy 和当前场景完成重放检查；不允许重放时不得调用 capability，允许重放时通过稳定 `idempotencyKey` 调用 capability，request 不携带 `recoveryReplay` 标志。

`CapabilityInvocationResult.structuredPayload` 承载 capability 产生的安全结构化结果，可投影为后续模型可见的 capability result content。`resultRef` 指向完整结果或外部内容引用，用于结果过大、被截断或完整内容不适合内联时的 fallback/ref boundary；`artifactRefs` 指向由 artifact gateway 管理的文件、生成输出或 Agent 结果附件 metadata。用户输入附件通过 `attachmentIds` 和 `RequestAttachment` 管理，只有被显式转化为输出产物时才进入 artifact metadata。`generatedMessages` 用于 inline Skill 等 capability 把受控 `USER` message 注入同一 request/run 后续模型上下文；`meta=true` 表示该消息对最终用户隐藏但仍可进入模型上下文。`contextPatch` 只表达当前 request/run 后续模型步骤的受控上下文补丁，允许收窄或指定 `allowedTools`、`modelName` 和 `modelOptions`；runtime/core 必须在应用前校验 patch 不越权扩大当前 Agent 已授权能力，且模型选择和模型参数必须经过 model selection/governance 校验。`contextPatch` 不得永久修改 Agent assembly、session 配置或 provider 配置。耗时、审计关联信息和持久化后的 result message id 由 runtime、wrapper、timeline、audit 或 gateway 层产生，不由 capability executor 返回。

Agent 装配和路由对象如下：

```ts
interface AgentAssembly {
  readonly agentId: AgentId
  readonly agentVersion: AgentVersion
  readonly displayName: string
  readonly description: string
  readonly workspaceDir: string
  readonly modelProfileIds: readonly string[]
  readonly promptTemplateIds: readonly string[]
  readonly capabilityBindings: readonly AgentCapabilityBinding[]
  readonly runtimeSettings: AgentRuntimeSettings
}

interface AgentCapabilityBinding {
  readonly capabilityId: CapabilityId
  readonly capabilityType: CapabilityKind
  readonly providerId: string
}

interface AgentRuntimeSettings {
  readonly defaultLocale?: RequestLocale
  readonly defaultModelProfileId?: string
  readonly defaultPromptTemplateId?: string
  readonly maxToolIterations?: number
  readonly maxContextMessages?: number
  readonly requestTimeoutMs?: number
}

interface AgentAssemblyRegistry {
  active(agentId: AgentId): AgentAssembly
  require(agentId: AgentId, agentVersion: AgentVersion): AgentAssembly
}

type RoutingDecisionKind =
  | "DETERMINISTIC_FLOW"
  | "MODEL_DRIVEN_LOOP"
  | "CLARIFY"
  | "REJECT"
  | "HUMAN_HANDOFF"
  | "DIRECTED_CAPABILITY"

interface AgentRoutingDecision {
  readonly decision: RoutingDecisionKind
  readonly targetCapabilityId?: CapabilityId
  readonly evidence: JsonObject
  readonly safeReason: string
}
```

`AgentAssembly` 是 runtime-facing 已解析装配结果，不是 Agent definition、Agent package manifest、provider/source 配置或 discovery 中间态。Agent package、`agent.yaml`、`skills/`、`subagents/` 和 `prompts/` 是装配输入；provider discovery、scope priority、conflict resolution、disable/deny 和 capability availability 是装配过程；runtime-facing assembly 只保留执行期需要的 Agent identity、已校验工作目录、允许的 model/prompt ids、已启用 capability bindings 和最小 runtime settings。`workspaceDir` 指向已解析、已校验的 Agent package/workspace 根目录，用于 capability/provider/sandbox 解析执行环境；不得进入模型上下文、stream、safe error、audit 明细或 provider metadata。`capabilityBindings` 只包含已启用绑定，使用 `providerId` 对齐 capability provider identity；禁用、deny、shadowing、source priority 和 provider 配置不进入 runtime-facing assembly。routing policy 和 routing hints 由后续 routing changes 定义，不作为 `AgentAssembly` 字段。hook declaration 和 Agent hook binding 由 hook contract 单独表达，不内嵌到 `AgentAssembly`。

`AgentAssemblyRegistry` 是 runtime-facing assembly lookup boundary。`active(agentId)` 只用于 request acceptance 阶段解析当前 active Agent version；runtime 必须把解析后的 `agentId`、`agentVersion` 和 `agentAssemblyRef` 固化到 `RequestRun` 和 `RequestContext`。已接受请求、恢复、context engine、core 和 capability routing 必须用 `require(agentId, agentVersion)` 读取同一个已解析 assembly，不得重新按 active version 选择。registry 返回 `AgentAssembly`，不返回 Agent package 原始定义或 manifest。首版 registry 由 app composition 在启动期 eager compile 后以内存形式提供；核心契约不定义 persistent assembly store、lazy compilation、hot reload、gray release 或 same-version snapshot id。缺失 assembly 必须作为明确的 missing assembly/not found 失败处理，不得 fallback 到默认 Agent。模块可以直接依赖 registry，也可以依赖由 registry 派生的 assembly-scoped wrapper，但不得自行解析 Agent package 或管理装配输入。

### 5. Gateway durable fact、owner scope 和 CAS 原则

Gateway contract 只表达逻辑端口和并发语义；具体数据库、目录布局、remote endpoint 和 SDK 不进入本节。

```ts
type VersionedUpdateStatus =
  | "UPDATED"
  | "VERSION_CONFLICT"
  | "NOT_FOUND"

interface VersionedUpdateResult<T> {
  readonly status: VersionedUpdateStatus
  readonly record?: T
  readonly currentVersion?: number
}

type TerminalCommitStatus =
  | "COMMITTED"
  | "ALREADY_COMMITTED"
  | "VERSION_CONFLICT"
  | "NOT_FOUND"

interface TerminalCommitRecordResult {
  readonly status: TerminalCommitStatus
  readonly record?: RequestRunRecord
  readonly currentVersion?: number
}

type SessionMessageRecordRole = "USER" | "ASSISTANT" | "CAPABILITY_RESULT" | "SUMMARY"
type MessageContentRecordType = "PLAIN_TEXT" | "MARKDOWN" | "MERMAID"
type VisibilityRecordReason = "RETRY_REPLACED" | "EDIT_REPLACED" | "CAPABILITY_GENERATED"

type AttachmentMediaRecordType = "WORD" | "EXCEL" | "PDF" | "MARKDOWN"
type AttachmentValidationRecordStatus = "PENDING" | "ACCEPTED" | "REJECTED"
type AttachmentAvailabilityRecordStatus = "STAGED" | "AVAILABLE" | "UNAVAILABLE"

type BlobRecordPurpose =
  | "ATTACHMENT"
  | "ARTIFACT"
  | "CAPABILITY_RESULT"
  | "MODEL_SUMMARY"
  | "OTHER"

type PendingInputRecordKind = "QUESTION" | "CONFIRMATION" | "AUTHORIZATION" | "HUMAN_HANDOFF"
type PendingInputRecordStatus = "PENDING" | "RECEIVED" | "TIMED_OUT" | "CANCELED"

interface PendingInputOptionRecord {
  readonly label: string
  readonly description: string
}

interface PendingInputQuestionRecord {
  readonly title: string
  readonly question: string
  readonly options: readonly PendingInputOptionRecord[]
  readonly multiple?: boolean
  readonly custom?: boolean
}

interface PendingInputRequestRecord {
  readonly id: PendingInputId
  readonly sessionId: SessionId
  readonly kind: PendingInputRecordKind
  readonly questions: readonly PendingInputQuestionRecord[]
  readonly timeoutAt?: EpochMillis
}

type PendingInputAnswerRecord = readonly (readonly string[])[]

interface RequestRunRecord {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly runId: RequestRunId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly agentId: AgentId
  readonly agentVersion: AgentVersion
  readonly agentAssemblyRef: string
  readonly attempt: number
  readonly retryOfRunId?: RequestRunId
  readonly status: RunStatus
  readonly version: number
  readonly terminalCommitState: TerminalCommitState
  readonly lockedBy?: string
  readonly lockExpiresAt?: EpochMillis
  readonly deadlineAt?: EpochMillis
  readonly createdAt: EpochMillis
  readonly updatedAt: EpochMillis
}

interface RunTimelineEventRecord {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly eventId: string
  readonly sessionId: SessionId
  readonly runId: RequestRunId
  readonly requestId: MessageId
  readonly requestContextId: RequestContextId
  readonly sequence: TimelineSequence
  readonly type: TimelineEventType
  readonly inlinePayload: JsonObject
  readonly contentRef?: string
  readonly createdAt: EpochMillis
}

interface RequestRunWriteRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly record: RequestRunRecord
  readonly expectedVersion?: number
  readonly idempotencyKey: IdempotencyKey
}

interface TerminalCommitRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly runId: RequestRunId
  readonly expectedVersion: number
  readonly terminalStatus: Extract<RunStatus, "COMPLETED" | "FAILED" | "CANCELED" | "SUPERSEDED">
  readonly terminalMessage?: SessionMessageRecord
  readonly terminalEvent: RunTimelineEventRecord
  readonly idempotencyKey: IdempotencyKey
}

interface SessionRecord {
  readonly sessionId: SessionId
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly title?: string
  readonly createdAt: EpochMillis
  readonly updatedAt: EpochMillis
}

interface SessionMessageRecord {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly messageId: MessageId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId?: RequestRunId
  readonly role: SessionMessageRecordRole
  readonly content: string
  readonly contentType: MessageContentRecordType
  readonly attachmentIds: readonly AttachmentId[]
  readonly metadata: JsonObject
  readonly sequence: number
  readonly visible: boolean
  readonly hideReason?: VisibilityRecordReason
  readonly hiddenAt?: EpochMillis
  readonly hiddenByContextId?: RequestContextId
  readonly createdAt: EpochMillis
}

interface SessionHistoryRecordQuery {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly offset: number
  readonly limit: number
  readonly includeSuperseded: boolean
}

interface SessionHistoryRecordEntry {
  readonly sessionId: SessionId
  readonly displayTitle: string
  readonly lastMessagePreview: string
  readonly lastRequestStatus: RunStatus
  readonly lastActivityAt: EpochMillis
  readonly hasInFlightRequest: boolean
}

interface SessionHistoryRecordPage {
  readonly entries: readonly SessionHistoryRecordEntry[]
  readonly offset: number
  readonly limit: number
  readonly hasMore: boolean
}

interface SessionLookupRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId: SessionId
}

interface SessionWriteRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly record: SessionRecord
  readonly idempotencyKey: IdempotencyKey
}

interface SessionHistoryQuery {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly offset: number
  readonly limit: number
  readonly includeSuperseded: boolean
}

interface SessionHistoryEntry {
  readonly sessionId: SessionId
  readonly displayTitle: string
  readonly lastMessagePreview: string
  readonly lastRequestStatus: RunStatus
  readonly lastActivityAt: EpochMillis
  readonly hasInFlightRequest: boolean
}

interface SessionHistoryPage {
  readonly entries: readonly SessionHistoryEntry[]
  readonly offset: number
  readonly limit: number
  readonly hasMore: boolean
}

interface SessionMessageWriteRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly record: SessionMessageRecord
  readonly idempotencyKey: IdempotencyKey
}

interface SessionMessageLookupRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly messageId: MessageId
}

interface HideMessageRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly messageId: MessageId
  readonly reason: VisibilityRecordReason
  readonly hiddenByContextId: RequestContextId
  readonly idempotencyKey: IdempotencyKey
}

interface SessionConversationQuery {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId: SessionId
  readonly requestId?: MessageId
  readonly locale?: RequestLocale
  readonly includeHidden: boolean
  readonly includeCapabilityResults: boolean
  readonly offset: number
  readonly limit: number
}

interface SessionConversationRecordQuery {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId: SessionId
  readonly requestId?: MessageId
  readonly locale?: RequestLocale
  readonly includeHidden: boolean
  readonly includeCapabilityResults: boolean
  readonly offset: number
  readonly limit: number
}

interface SessionConversationPage {
  readonly items: readonly SessionMessage[]
  readonly offset: number
  readonly limit: number
  readonly hasMore: boolean
}

interface SessionConversationRecordPage {
  readonly items: readonly SessionMessageRecord[]
  readonly offset: number
  readonly limit: number
  readonly hasMore: boolean
}

interface CurrentRequestConversationQuery {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId: RequestRunId
  readonly includeHidden: boolean
  readonly offset: number
  readonly limit: number
}

interface CurrentRequestConversationRecordQuery {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId: RequestRunId
  readonly includeHidden: boolean
  readonly offset: number
  readonly limit: number
}

interface ActiveContextStateRecord {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId: SessionId
  readonly activeContextVersion: number
  readonly updatedAt: EpochMillis
}

interface ActiveContextItemRecord {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId: SessionId
  readonly ordinal: number
  readonly messageId: MessageId
}

interface ActiveContextViewRecord {
  readonly state: ActiveContextStateRecord
  readonly items: readonly ActiveContextItemRecord[]
}

interface ActiveContextLookupRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId: SessionId
}

interface AppendActiveContextItemRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId: SessionId
  readonly messageId: MessageId
  readonly expectedActiveContextVersion: number
  readonly idempotencyKey: IdempotencyKey
}

interface ContextCompactionCommitRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId: SessionId
  readonly expectedActiveContextVersion: number
  readonly summaryMessage: SessionMessageRecord
  readonly coveredMessageRefs: readonly MessageId[]
  readonly retainedTailMessageRefs: readonly MessageId[]
  readonly idempotencyKey: IdempotencyKey
}

interface RequestRunLookupRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly runId: RequestRunId
}

interface ClaimRunRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly runId: RequestRunId
  readonly expectedVersion: number
  readonly lockedBy: string
  readonly lockExpiresAt: EpochMillis
}

interface SystemListRecoverableRunsRequest {
  readonly statuses: readonly RunStatus[]
  readonly terminalCommitStates: readonly TerminalCommitState[]
  readonly limit: number
}

interface RunTimelineEventAppendRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly record: RunTimelineEventRecord
  readonly idempotencyKey: IdempotencyKey
}

interface RunTimelineEventRecordQuery {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId: SessionId
  readonly afterSequence: TimelineSequence
  readonly requestId?: MessageId
  readonly runId?: RequestRunId
  readonly limit: number
}

interface SaveAttachmentRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly record: RequestAttachmentRecord
  readonly idempotencyKey: IdempotencyKey
}

interface RequestAttachmentRecord {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly attachmentId: AttachmentId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId?: RequestRunId
  readonly agentId: AgentId
  readonly fileName: string
  readonly mediaType: AttachmentMediaRecordType
  readonly sizeBytes: number
  readonly storageRef: BlobRef
  readonly validationStatus: AttachmentValidationRecordStatus
  readonly availabilityStatus: AttachmentAvailabilityRecordStatus
  readonly createdAt: EpochMillis
}

interface LoadAttachmentRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly attachmentId: AttachmentId
}

interface ListAttachmentsByRequestIdRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId: SessionId
  readonly requestId: MessageId
}

interface UpdateAttachmentStatusRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly attachmentId: AttachmentId
  readonly validationStatus: AttachmentValidationRecordStatus
  readonly availabilityStatus: AttachmentAvailabilityRecordStatus
  readonly rejectionReason?: string
}

interface StoreBlobRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly purpose: BlobRecordPurpose
  readonly content: Uint8Array
  readonly mediaType?: string
  readonly sizeBytes: number
  readonly safeName?: string
  readonly idempotencyKey?: IdempotencyKey
}

interface LoadBlobRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly blobRef: BlobRef
}

interface DeleteBlobRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly blobRef: BlobRef
}

interface ArtifactMetadata {
  readonly artifactId: ArtifactId
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId?: SessionId
  readonly requestRunId?: RequestRunId
  readonly sourceType: "ATTACHMENT" | "CAPABILITY_RESULT" | "OTHER"
  readonly contentRef: BlobRef
  readonly mimeType?: string
  readonly sizeBytes?: number
  readonly safeName?: string
  readonly visibility: "USER_VISIBLE" | "MODEL_ONLY" | "INTERNAL"
  readonly createdAt: EpochMillis
}

interface ArtifactMetadataRecord {
  readonly artifactId: ArtifactId
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId?: SessionId
  readonly requestRunId?: RequestRunId
  readonly sourceType: "ATTACHMENT" | "CAPABILITY_RESULT" | "OTHER"
  readonly contentRef: BlobRef
  readonly mimeType?: string
  readonly sizeBytes?: number
  readonly safeName?: string
  readonly visibility: "USER_VISIBLE" | "MODEL_ONLY" | "INTERNAL"
  readonly createdAt: EpochMillis
}

interface SaveArtifactMetadataRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly record: ArtifactMetadataRecord
  readonly idempotencyKey: IdempotencyKey
}

interface LoadArtifactMetadataRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly artifactId: ArtifactId
}
```

核心 gateway ports：

```ts
interface SessionStoreGateway {
  loadSession(request: SessionLookupRequest): Promise<SessionRecord | undefined>
  listSessions(request: SessionHistoryRecordQuery): Promise<SessionHistoryRecordPage>
  saveSession(request: SessionWriteRequest): Promise<SessionRecord>
}

interface SessionMessageStoreGateway {
  saveMessage(request: SessionMessageWriteRequest): Promise<SessionMessageRecord>
  loadMessage(request: SessionMessageLookupRequest): Promise<SessionMessageRecord | undefined>
  listConversationMessages(request: SessionConversationRecordQuery): Promise<SessionConversationRecordPage>
  listCurrentRequestMessages(request: CurrentRequestConversationRecordQuery): Promise<SessionConversationRecordPage>
  hideMessage(request: HideMessageRequest): Promise<SessionMessageRecord | undefined>
}

interface ActiveContextStoreGateway {
  loadActiveContext(request: ActiveContextLookupRequest): Promise<ActiveContextViewRecord | undefined>
  appendItem(request: AppendActiveContextItemRequest): Promise<VersionedUpdateResult<ActiveContextViewRecord>>
  commitCompaction(request: ContextCompactionCommitRequest): Promise<VersionedUpdateResult<ActiveContextViewRecord>>
}

interface RequestRunStoreGateway {
  saveRun(request: RequestRunWriteRequest): Promise<VersionedUpdateResult<RequestRunRecord>>
  loadRun(request: RequestRunLookupRequest): Promise<RequestRunRecord | undefined>
  claimRun(request: ClaimRunRequest): Promise<VersionedUpdateResult<RequestRunRecord>>
  listRecoverableRuns(request: SystemListRecoverableRunsRequest): Promise<readonly RequestRunRecord[]>
  commitTerminal(request: TerminalCommitRequest): Promise<TerminalCommitRecordResult>
}

interface RunTimelineEventStoreGateway {
  appendEvent(request: RunTimelineEventAppendRequest): Promise<RunTimelineEventRecord>
  listEvents(request: RunTimelineEventRecordQuery): Promise<readonly RunTimelineEventRecord[]>
}

interface AttachmentStoreGateway {
  saveAttachment(request: SaveAttachmentRequest): Promise<RequestAttachmentRecord>
  loadAttachment(request: LoadAttachmentRequest): Promise<RequestAttachmentRecord | undefined>
  listAttachmentsByRequestId(request: ListAttachmentsByRequestIdRequest): Promise<readonly RequestAttachmentRecord[]>
  updateAttachmentStatus(request: UpdateAttachmentStatusRequest): Promise<RequestAttachmentRecord | undefined>
}

interface BlobStoreGateway {
  storeBlob(request: StoreBlobRequest): Promise<BlobRef>
  loadBlob(request: LoadBlobRequest): Promise<Uint8Array | undefined>
  blobExists(request: LoadBlobRequest): Promise<boolean>
  deleteBlob(request: DeleteBlobRequest): Promise<boolean>
}

interface ArtifactGatewayPort {
  saveArtifactMetadata(request: SaveArtifactMetadataRequest): Promise<ArtifactMetadataRecord>
  loadArtifactMetadata(request: LoadArtifactMetadataRequest): Promise<ArtifactMetadataRecord | undefined>
}

interface PendingInputStoreGateway {
  createPendingInput(request: CreatePendingInputRecordRequest): Promise<PendingInputRecord>
  loadPendingInput(request: LoadPendingInputRecordRequest): Promise<PendingInputRecord | undefined>
  resolvePendingInput(request: ResolvePendingInputRecordRequest): Promise<VersionedUpdateResult<PendingInputRecord>>
}

interface FeedbackStoreGateway {
  submitFeedback(request: SubmitFeedbackRecordRequest): Promise<FeedbackRecord>
  listFeedback(request: ListFeedbackRecordsRequest): Promise<readonly FeedbackRecord[]>
}
```

Gateway port 使用 `*Record` persistence DTO/PO 作为边界数据形态，不直接接收或返回 `RequestRun`、`SessionMessage`、`RunTimelineEvent`、`RequestAttachment`、`CheckpointPayload`、`PendingInput`、`Feedback` 等领域 DO。领域模块负责在调用 gateway port 前将 DO 投影为 Record，并在读取 Record 后重建 DO 或 read model；gateway adapter 只负责存取 Record，不解释领域状态机、latest-request policy、terminal commit 可见性、active context selection 或 capability recovery 规则。Record 可以包含持久化边界需要的 owner scope、索引字段、版本字段和序列化时间字段；这些字段不得反向污染 DO 的最小领域形态。

Owner-scoped durable fact 的 logical gateway request 必须直接携带 `tenantId` 和 `subjectId`，包括按唯一 id 查询的 request。核心契约不定义 `OwnerScope`、`GatewayLookupRequest` 或其他 owner 基类，避免安全语义被抽象隐藏。系统恢复扫描等内部维护能力必须使用独立 system-scoped port，不得复用用户请求路径的 lookup contract。普通持久化写入返回持久化后的 Record；只有 run version update、claim/fencing、pending input resolve 等 CAS 操作返回 `VersionedUpdateResult<TRecord>`。Terminal commit 有终态幂等语义，使用独立 `TerminalCommitRecordResult`。`VERSION_CONFLICT`、`NOT_FOUND` 和 `ALREADY_COMMITTED` 是预期控制分支；数据库不可用、序列化失败、连接超时或认证失败属于 gateway error，由 error normalizer 处理，不进入 CAS result vocabulary。`BlobStoreGateway` 只负责 opaque bytes lifecycle，不表达附件状态、artifact 可见性、session/run 绑定或内容解析结果；这些业务事实必须留在对应 metadata gateway 中。`ArtifactMetadataRecord.sourceType="ATTACHMENT"` 只表示该 artifact 由附件内容派生或转化而来，不表示用户输入附件本身由 ArtifactGateway 管理。

`hideMessage` 是 `SessionMessage` visibility 的唯一持久化变更入口。`saveMessage` 不得修改已存在 message record 的 visibility 字段；隐藏是单向操作，不提供 unhide。`hiddenAt` 由 store 使用受控时钟写入，不由调用方传入；`hiddenByContextId` 使用 `RequestContextId`，具体存储可序列化为字符串。重复隐藏已隐藏 message 必须幂等返回当前持久化 `SessionMessageRecord`，并保留首次隐藏的 `hideReason`、`hiddenAt` 和 `hiddenByContextId`；message 不存在时返回 `undefined`。默认历史查询排除 hidden message，显式 `includeHidden=true` 才返回 hidden message。`visible=false` 只影响会话历史默认视图，不负责移除模型上下文；模型可见上下文由 active context view 控制。

### 6. Checkpoint、pending input、hook、policy 和 sandbox 对象

Checkpoint payload 和 write contract 如下：

```ts
interface CheckpointPayload {
  readonly checkpointId: CheckpointId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId: RequestRunId
  readonly requestContextId: RequestContextId
  readonly runVersion: number
  readonly triggerReason: CheckpointTriggerReason
  readonly lastSequence: number
  readonly activeContextVersion: number
  readonly flowVariables: JsonObject
  readonly savedAt: EpochMillis
}

interface CheckpointRecord {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly checkpointId: CheckpointId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId: RequestRunId
  readonly requestContextId: RequestContextId
  readonly runVersion: number
  readonly triggerReason: CheckpointTriggerReason
  readonly lastSequence: number
  readonly activeContextVersion: number
  readonly flowVariables: JsonObject
  readonly savedAt: EpochMillis
}

interface CheckpointWriteRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly record: CheckpointRecord
  readonly idempotencyKey: IdempotencyKey
}

interface LoadCheckpointRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId: RequestRunId
}

interface CheckpointStoreGateway {
  saveCheckpoint(request: CheckpointWriteRequest): Promise<CheckpointRecord>
  loadCheckpoint(request: LoadCheckpointRequest): Promise<CheckpointRecord | undefined>
}
```

Pending input 核心对象如下：

```ts
type PendingInputKind = "QUESTION" | "CONFIRMATION" | "AUTHORIZATION" | "HUMAN_HANDOFF"
type PendingInputStatus = "PENDING" | "RECEIVED" | "TIMED_OUT" | "CANCELED"

interface PendingInputRequest {
  readonly id: PendingInputId
  readonly sessionId: SessionId
  readonly kind: PendingInputKind
  readonly questions: readonly PendingInputQuestion[]
  readonly timeoutAt?: EpochMillis
}

interface PendingInputQuestion {
  readonly title: string
  readonly question: string
  readonly options: readonly PendingInputOption[]
  readonly multiple?: boolean
  readonly custom?: boolean
}

interface PendingInputOption {
  readonly label: string
  readonly description: string
}

interface PendingInputAnswer {
  readonly sessionId: SessionId
  readonly pendingInputId: PendingInputId
  readonly answers: readonly (readonly string[])[]
}

interface AnswerPendingInputCommand {
  readonly sessionId: SessionId
  readonly identityContext: IdentityContext
  readonly pendingInputId: PendingInputId
  readonly answers: readonly (readonly string[])[]
  readonly idempotencyKey: IdempotencyKey
}

interface PendingInputAnswerAccepted {
  readonly sessionId: SessionId
  readonly pendingInputId: PendingInputId
  readonly status: Extract<PendingInputStatus, "RECEIVED">
}

interface PendingInput {
  readonly pendingInputId: PendingInputId
  readonly requestRunId: RequestRunId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly requestContextId: RequestContextId
  readonly checkpointId: CheckpointId
  readonly kind: PendingInputKind
  readonly questions: readonly PendingInputQuestion[]
  readonly timeoutAt?: EpochMillis
  readonly status: PendingInputStatus
  readonly createdAt: EpochMillis
  readonly updatedAt: EpochMillis
  readonly responseAnswers?: readonly (readonly string[])[]
}

interface PendingInputRecord {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly pendingInputId: PendingInputId
  readonly requestRunId: RequestRunId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly requestContextId: RequestContextId
  readonly checkpointId: CheckpointId
  readonly kind: PendingInputRecordKind
  readonly request: PendingInputRequestRecord
  readonly timeoutAt?: EpochMillis
  readonly status: PendingInputRecordStatus
  readonly createdAt: EpochMillis
  readonly updatedAt: EpochMillis
  readonly responseAnswers?: readonly (readonly string[])[]
}

interface CreatePendingInputRecordRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly record: PendingInputRecord
}

interface LoadPendingInputRecordRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly pendingInputId: PendingInputId
}

interface ResolvePendingInputRecordRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly pendingInputId: PendingInputId
  readonly expectedStatus: Extract<PendingInputRecordStatus, "PENDING">
  readonly status: Exclude<PendingInputRecordStatus, "PENDING">
  readonly answer?: PendingInputAnswerRecord
}
```

Lifecycle hook contract 如下：

```ts
type HookExecutionMode = "BLOCKING" | "NON_BLOCKING"
type HookFailureMode = "CONTINUE" | "FAIL"
type HookKind = "SYSTEM" | "CUSTOM"
type HookDecision = "NO_OPINION" | "APPROVE" | "REJECT" | "PEND"
type HookInvocationStatus = "SUCCESS" | "TIMEOUT" | "FAILED"

interface LifecycleHookDefinition {
  readonly hookId: string
  readonly name: string
  readonly source: string
  readonly kind: HookKind
  readonly supportedStages: readonly LifecycleStage[]
  readonly defaultOrder?: number
  readonly defaultTimeoutMs?: number
  readonly executionMode: HookExecutionMode
  readonly failureMode: HookFailureMode
  readonly defaultConfig?: JsonObject
}

interface AgentHookBinding {
  readonly bindingId: string
  readonly agentId: AgentId
  readonly hookId: string
  readonly enabled?: boolean
  readonly stages?: readonly LifecycleStage[]
  readonly order?: number
  readonly timeoutMs?: number
  readonly config?: JsonObject
}

interface HookBoundary {}

interface BoundaryMutation {}

interface PendingInputIntent {
  readonly kind: PendingInputKind
  readonly questions: readonly PendingInputQuestion[]
  readonly timeoutAt?: EpochMillis
}

interface HookInput<TBoundary extends HookBoundary = HookBoundary> {
  readonly hookId: string
  readonly bindingId?: string
  readonly agentId: AgentId
  readonly agentVersion: AgentVersion
  readonly stage: LifecycleStage
  readonly boundary: TBoundary
  readonly config?: JsonObject
}

interface HookResult<TMutation extends BoundaryMutation = BoundaryMutation> {
  readonly decision?: HookDecision
  readonly pendingInputIntent?: PendingInputIntent
  readonly mutation?: TMutation
  readonly safeReason?: string
  readonly error?: SafeError
}

interface HookInvocationEvent {
  readonly hookInvocationId: string
  readonly requestRunId: RequestRunId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly agentId: AgentId
  readonly agentVersion: AgentVersion
  readonly hookId: string
  readonly bindingId?: string
  readonly stage: LifecycleStage
  readonly status: HookInvocationStatus
  readonly startedAt: EpochMillis
  readonly finishedAt?: EpochMillis
  readonly decision?: HookDecision
  readonly safeReason?: string
  readonly safeError?: SafeError
  readonly mutationSummary?: string
}

interface LifecycleHookPort {
  invoke(input: HookInput): Promise<HookResult>
}
```

Lifecycle hook 的声明和 Agent 绑定分离。`LifecycleHookDefinition` 描述 hook 的稳定声明；`AgentHookBinding` 描述某个 Agent 如何启用该 hook。绑定可以收窄或覆盖 `stages`、`order`、`timeoutMs` 和 `config`，但不能修改 `kind`、`executionMode`、`failureMode`、`source` 或 hook 支持的边界。`SYSTEM` hook 早于 `CUSTOM` hook 执行，不得被 Agent binding 禁用，且 `failureMode` 必须为 `FAIL`。同 kind 内按 `order`、再按 `hookId` 稳定排序。`HookFailureMode` 只处理 hook 自身超时、异常、不可用或返回非法结果：`CONTINUE` 表示记录失败观测后主流程继续，`FAIL` 表示记录失败观测后按请求失败路径终止。`REJECT` 和 `PEND` 是 hook 正常返回的控制决策，不受 `failureMode` 控制。观察类行为由 hook 自己完成，不通过 `HookResult` 交给 runtime 代做；`HookResult` 只表达 runtime 必须处理的控制信号和边界修改请求。`BLOCKING` hook 按顺序同步执行，mutation 和 decision 按顺序归约；首版不支持会影响流程的并行 hook，也不定义并行 mutation 或 decision 合并规则。`NON_BLOCKING` hook 只能观察，不得返回 decision 或 mutation。

`HookDecision` 的默认语义为 `NO_OPINION`。`NO_OPINION` 表示 hook 对流程没有意见；`APPROVE` 表示明确通过；两者都允许流程继续，并允许 runtime 应用合法 mutation 后把 effective boundary 传给下一个 blocking hook 或主流程。`REJECT` 表示拒绝或终止当前流程，runtime 必须停止后续 blocking hook 和主流程，且应携带 `safeReason`。`PEND` 表示挂起等待条件满足，runtime 必须停止后续 blocking hook 和主流程，并基于 `pendingInputIntent` 创建 runtime-owned pending input。若 `REJECT` 或 `PEND` 与 mutation 同时出现，runtime MUST 以控制信号为准，不应用 mutation。通用 `PolicyPort` 不进入核心契约；具体 risk、routing、context budget 和 model selection policy 由后续具体 change 定义。

`HookBoundary` 和 `BoundaryMutation` 是核心契约中的统一基类语义，不携带 `stage`、`payload` 或 `patch` 字段。`stage` 是 `HookInput` 的调用坐标，具体 boundary/mutation 的字段由 `add-ts-lifecycle-hook-execution` 按 stage 定义。`mutation` 缺省表示 no-op，不定义 `NoopMutation`。通用 `HookInput` 不包含 `requestContextId`；需要 context 标识的 stage 必须在具体 `HookBoundary` 中显式定义。

`HookInvocationEvent` 是 runtime 生成的结构化观测事件，不是核心业务持久化对象，也不是 canonical timeline event。首版必须输出结构化日志和 hook 指标，可以发送到 audit sink，但不得提供 hook invocation 查询 API，也不得把完整 boundary、mutation、hook input、hook result、模型消息、工具参数、工具结果、附件内容或 secret 写入 event。`mutationSummary` 由 runtime 生成：无 mutation 时不填；有 mutation 时记录具体 mutation 类型或稳定 mutation kind，以及被修改的字段名，不记录字段值，例如 `ModelRequestMutation{appendMessages,modelOptionsPatch,restrictedToolIds}`。

Hook invocation 不默认进入 timeline。只有 hook decision 改变 request lifecycle 时，runtime 才写入 timeline-only `HOOK_DECISION_APPLIED`，例如 `REJECT` 导致请求失败，或 `PEND` 触发 pending input。risk policy 执行结果如需形成执行事实，写入 timeline-only `POLICY_APPLIED`。`HOOK_DECISION_APPLIED` 和 `POLICY_APPLIED` 不进入首版 `StreamEventType`；channel 默认不向用户对话流投影这类事件。hook timeout/failed 如果未改变主流程，只通过 `HookInvocationEvent`、结构化日志、指标或 audit sink 表达。

Sandbox gateway contract 如下：

```ts
interface SandboxExecutionRequest {
  readonly executionId: string
  readonly requestRunId: RequestRunId
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly executable: "bash" | "python"
  readonly command: string
  readonly args: readonly string[]
  readonly workingDirectoryRef?: string
  readonly environment: JsonObject
  readonly timeoutMs: number
  readonly stdoutLimitBytes: number
  readonly stderrLimitBytes: number
}

interface SandboxExecutionResult {
  readonly executionId: string
  readonly exitCode?: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly durationMs: number
  readonly safeError?: SafeError
}

interface SandboxGatewayPort {
  execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>
}
```

### 7. Audit、error normalization 和 app configuration 对象

核心契约只暴露业务必须的审计事件和错误归一化边界，不定义通用 observability facade、metric record、trace 对象或 trace id 字段。Tracing、metrics 和 logging 使用既定 observability 实现及其上下文传播机制，核心 DTO 不携带 SDK 类型、span、tracer、meter、logger 或通用诊断上下文。

Tracing、metrics 和 structured logging 的实现优先通过 middleware/interceptor、port decorator、auto-instrumentation 和 timeline/event subscriber 完成。HTTP/SSE/WS 入口、transport 错误和 response boundary 使用 middleware/interceptor；model、capability、gateway、sandbox、checkpoint、audit writer 和 hook executor 使用 observed decorator 包装目标 port；request lifecycle、terminal commit、pending input 和 context compact 使用 timeline/event subscriber 派生指标和结构化日志。业务核心模块不得直接依赖 observability SDK/API 类型；除非某个局部业务分支无法通过 port 或 event 表达，否则不应在业务代码中散落 ad hoc operational log、manual span 或 manual metric。确需显式日志时，必须使用后续 observability change 定义的结构化日志 helper，并遵守 redaction policy。

```ts
type AttributeValue =
  | string
  | number
  | boolean
  | readonly string[]
  | readonly number[]
  | readonly boolean[]

type Attributes = Readonly<Record<string, AttributeValue>>

interface AuditEvent {
  readonly auditId: string
  readonly eventName: string
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly requestRunId?: RequestRunId
  readonly capabilityInvocationId?: CapabilityInvocationId
  readonly safeSummary: string
  readonly attributes: Attributes
  readonly occurredAt: EpochMillis
}

interface AuditEventWriter {
  write(event: AuditEvent): Promise<void>
}

interface ErrorNormalizer {
  normalize(error: unknown): SafeError
}

interface ModelProfile {
  readonly profileId: string
  readonly providerKind: ModelProviderKind
  readonly modelName: string
  readonly baseUrl: string
  readonly apiKeySource: SecretReference
  readonly timeoutMs: number
  readonly enabled: boolean
  readonly fallbackEligible: boolean
}

interface AppConfiguration {
  readonly modelProfiles: readonly ModelProfile[]
  readonly gatewayAdapters: readonly GatewayAdapterConfig[]
  readonly capabilityProviders: readonly CapabilityProviderConfig[]
}

interface GatewayAdapterConfig {
  readonly adapterId: string
  readonly kind: "local" | "remote"
  readonly enabled: boolean
  readonly baseUrl?: string
  readonly credential?: SecretReference
  readonly timeoutMs: number
  readonly retry: RetryConfig
}

interface CapabilityProviderConfig {
  readonly providerId: string
  readonly providerKind: CapabilityProviderKind
  readonly providerType?: string
  readonly enabled: boolean
  readonly locationRef?: string
  readonly credential?: SecretReference
  readonly disabledCapabilityIds: readonly CapabilityId[]
}

interface RetryConfig {
  readonly maxAttempts: number
  readonly backoffMs: number
}

interface Feedback {
  readonly feedbackId: string
  readonly sessionId: SessionId
  readonly requestRunId: RequestRunId
  readonly messageId: MessageId
  readonly rating: 1 | 2 | 3 | 4 | 5
  readonly reasonCode?: string
  readonly comment?: string
  readonly submittedAt: EpochMillis
}

interface FeedbackRecord {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly feedbackId: string
  readonly sessionId: SessionId
  readonly requestRunId: RequestRunId
  readonly messageId: MessageId
  readonly rating: 1 | 2 | 3 | 4 | 5
  readonly reasonCode?: string
  readonly comment?: string
  readonly submittedAt: EpochMillis
}

interface SubmitFeedbackRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly feedback: Feedback
  readonly idempotencyKey: IdempotencyKey
}

interface ListFeedbackRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId?: SessionId
  readonly requestRunId?: RequestRunId
  readonly messageId?: MessageId
  readonly limit: number
}

interface SubmitFeedbackRecordRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly record: FeedbackRecord
  readonly idempotencyKey: IdempotencyKey
}

interface ListFeedbackRecordsRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId?: SessionId
  readonly requestRunId?: RequestRunId
  readonly messageId?: MessageId
  readonly limit: number
}
```

### 8. 核心调用 port 汇总

核心跨模块调用只能通过以下 port 或后续 change 对这些 port 的显式 refinement 发生：

```ts
interface RuntimeCommandPort {
  submit(command: SubmitRequestCommand): Promise<RequestAccepted>
  cancel(command: RequestControlCommand): Promise<RequestControlAccepted>
  retryLatest(command: RequestControlCommand): Promise<RequestAccepted>
  editLatest(command: EditLatestRequestCommand): Promise<RequestAccepted>
  answerPendingInput(command: AnswerPendingInputCommand): Promise<PendingInputAnswerAccepted>
}

interface Agent {
  execute(
    run: RequestRun,
    context: RequestContext,
    timeline: RunTimelineEventPort,
    signal: AbortSignal
  ): Promise<void>
}

interface RunTimelineEventPort {
  emit(event: RunTimelineEvent): Promise<void>
}

interface RuntimeTimelinePort {
  stream(request: RuntimeTimelineStreamRequest): AsyncIterable<RunTimelineEvent>
}

interface ContextEnginePort {
  assemble(request: ContextAssemblyRequest): Promise<ContextAssembly>
  render(assembly: ContextAssembly): Promise<RenderedModelInput>
}

interface ModelInvocationService {
  complete(request: ModelInvocationRequest, signal: AbortSignal): Promise<ModelFinalResult>
  stream(request: ModelInvocationRequest, signal: AbortSignal): AsyncIterable<ModelStreamDelta | ModelFinalResult>
}

interface CapabilityCatalogPort {
  listAvailable(request: CapabilityCatalogRequest): Promise<readonly CapabilityDescriptor[]>
  resolve(request: CapabilityResolveRequest): Promise<CapabilityDescriptor | undefined>
}

interface CapabilityInvocationPort {
  invoke(request: CapabilityInvocationRequest, signal: AbortSignal): Promise<CapabilityInvocationResult>
}

interface CapabilityCatalogRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly agentAssembly: AgentAssembly
  readonly includeUnavailable: boolean
}

interface CapabilityResolveRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly agentAssembly: AgentAssembly
  readonly capabilityId: CapabilityId
}
```

未在本节定义字段全集的 request/record，只能在拥有该用户可见能力或持久化能力的后续 change 中补齐；补齐时必须保持本节已冻结的 `tenantId`/`subjectId` 归属语义、safe error、CAS/terminal commit 分支结果和 runtime ownership 语义。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | `tenantId`/`subjectId` 归属语义、safe error、secret reference、redaction hook、sandbox gateway 和 capability compatibility metadata 都进入核心 contract；请求体和模型输出不能覆盖当前身份。 | owner scope contract tests、safe error tests、secret leakage scan、architecture boundary tests |
| 性能/容量 | 核心契约只定义 envelope、refs、sequence、budget 和 backpressure 扩展位，不要求内联大内容；stream、context 和 artifact 使用 ref 边界。 | schema size tests、stream projection tests、context budget contract tests |
| 可靠性/恢复 | RequestRun version、claim/fencing、CAS result、checkpoint payload、terminal commit 幂等和 timeline/stream sequence replay 进入 contract。 | recovery contract tests、terminal commit idempotency tests、timeline replay tests |
| 可维护性 | `agent-contracts` 集中承载 public contract；实现包只能向下依赖 contract，不反向依赖实现。 | package dependency/architecture tests、contract API review |
| 可测试性 | 所有跨模块边界使用 port/interface 和可替换 test fixture；fake provider 只作为测试 fixture，不进入产品配置。 | contract tests、fixture tests、minimal kernel smoke tests |
| 审计/可追溯性 | requestRunId、sessionId、messageId、timeline sequence、capability invocation id、audit event 和 safe diagnostics 进入 contract；trace/log 关联由 observability 实现负责，不作为核心领域字段。 | trace/log tests、audit envelope tests |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-core-contracts/spec.md` 主承载核心可验证行为。
- 跨模块架构：归档前提升到 `openspec/designs/architecture/runtime-boundaries.md`、`owner-scope-security.md` 和 `observability-boundaries.md`。
- 领域模型/状态机：归档前提升到 `openspec/designs/domain/request-run.md`。
- API/SPI/event/schema：归档前提升到 `openspec/designs/contracts/core-contracts.md`。
- 模块职责：归档前提升到 `openspec/designs/modules/agent-contracts.md`。
- ADR：本变更不单独新增 ADR；若归档时仍需保留“契约先行”作为长期技术决策，可提升到 `openspec/designs/adr/0001-contract-first-ts-backend.md`。
- 导航：归档前更新 `openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [风险] 核心契约一次性覆盖面较大，容易把后续配件细节提前固化。 -> 只冻结跨模块最小 skeleton，具体 Tool、Skill、store schema 和业务 API 进入后续 change。
- [风险] contract 太薄会导致最小内核实现时再次发散。 -> 对 runtime truth、`tenantId`/`subjectId` 归属语义、event vocabulary、gateway concurrency 和 capability kind 采用明确 enum/port，不留关键语义空白。
- [风险] no-op 被误用为真实能力。 -> spec 和 tasks 明确 no-op 只能用于一层直接依赖，后续真实 provider 替换不得改变主流程调用语义。
- [取舍] 先建立 `agent-contracts` 会增加一个前置 change。 -> 该前置能让 Web、runtime、context、capability、gateway 和 observability 团队并行推进，减少主流程返工。

## 发布计划（Release Plan）

无运行中系统升级或数据转换。本变更建立新的 TS 核心契约基线；后续实现 change 必须依赖本契约，而不是在实现包中重新定义跨模块对象。

## 归档前基线提升计划（Baseline Promotion Plan）

- `openspec/specs/ts-core-contracts/spec.md`：提升核心契约行为要求。
- `openspec/overview.md`：提升契约先行、最小内核和并行配件开发的长期背景。
- `openspec/designs/architecture/runtime-boundaries.md`：提升 runtime ownership、terminal commit、timeline 和 stream projection 事实。
- `openspec/designs/architecture/owner-scope-security.md`：提升 owner scope、safe error、secret/redaction 和安全边界。
- `openspec/designs/contracts/core-contracts.md`：提升核心 port、enum、event、gateway、capability、context 和 model contract。
- `openspec/designs/domain/request-run.md`：提升 RequestRun lifecycle、version/claim/fencing、checkpoint 和 terminal facts。
- `openspec/designs/modules/agent-contracts.md`：提升 `agent-contracts` 模块职责。
- `openspec/designs/spec-to-design-map.md`：补充导航和验证入口。

## 待确认问题（Open Questions）

无。
