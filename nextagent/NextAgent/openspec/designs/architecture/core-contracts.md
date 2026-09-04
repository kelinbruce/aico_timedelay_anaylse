# 核心契约设计

## 背景和现状（Context）

TS 后端已经有架构边界，但还没有可供各团队共同实现的核心契约。最小内核需要 runtime、channel、session、core、context、model、capability、gateway、observability 和 app composition 在同一套对象和事件语义上协作；后续附件、SkillHub/remote Skill source installation、sandbox、pending input、conversation annotation、恢复和发布门禁也必须复用同一套 contract。

本设计的相关方包括 runtime/session 团队、Web channel 团队、controller/context 团队、capability 团队、platform gateway 团队、observability/ops 团队和 frontend 团队。设计约束是：先冻结跨模块契约，再实现最小问答内核；契约必须足以支持并行开发，但不能提前实现具体 provider、store、tool 或业务 API 细节。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 建立唯一的 `agent-contracts` public namespace，承载核心 DTO、enum、port 和 runtime schema。
- 明确哪些契约属于 runtime 真相，哪些属于 channel 投影、context 组装、capability catalog、gateway persistence、audit 和错误归一化边界。
- 冻结 owner scope、AgentError/SafeError、RequestRun、timeline、stream、context、model、capability、gateway、sandbox、routing、hook、checkpoint 和 observability 的最小可验证形态。
- 保留最小内核 no-op 边界，让 hook、checkpoint、audit 等直接依赖可被主流程调用但不阻塞一次问答成立。
- 为后续并行 OpenSpec change 提供稳定扩展点，避免各团队修改同一主流程契约。

**非目标：**

- 不实现浏览器 UI payload、WebSocket route、完整 cancel/retry/edit 用户控制、完整多实例 recovery 或数据库物理 schema；SSE/WS stream transport、request cancel/retry、本地单实例 recovery 和 replay guard 已进入稳定契约，但具体 adapter/driver 实现仍由对应模块拥有。
- 不实现除当前稳定 builtin Tool/Skill/Agent tool、本地 Agent discovery/subagent execution、OpenAI 最小 provider path 和已归档 sandbox/capability slices 之外的完整模型 provider 生态、SkillHub remote refresh/cache、远端 AgentRegistry 执行、继承父上下文的 subagent execution、attachment parser、audit sink 或 metrics sink。
- Attachment intake / request attachment flow 由 `openspec/designs/architecture/attachment-intake.md` 和 `openspec/designs/architecture/attachment-lifecycle.md` 承载；稳定行为契约见 `openspec/specs/ts-attachment-intake/spec.md` 与 `openspec/specs/request-attachments/spec.md`。
- 不定义具体业务 prompt 正文、领域工具参数、Skill FORK/body loading 扩展、远端服务协议或 PaaS 多实例部署方案。
- 不把最小内核 no-op 变成长期行为；no-op 只用于一层直接依赖的替换边界。

## 设计决策（Decisions）

### 1. `agent-contracts` 是核心契约唯一出口

选择：新增 `agent-contracts` 作为 runtime、channel、session、attachment、context、model、capability、core、gateway、observability、app 等边界契约的唯一 public namespace。业务实现包只消费该包暴露的类型和 port；实现包之间不得通过 private 类型绕行。

理由：核心契约集中后，最小内核和配件团队可以并行开发，且 contract tests 可以直接针对 public namespace。放弃把契约分散在各实现包内的方案，因为它会使 runtime truth、stream projection 和 gateway persistence 难以统一。

### 2. Runtime 拥有 RequestRun、terminal commit 和 canonical timeline

选择：RequestRun、runtime command、latest-request 合法性、terminal result、terminal commit、run version/claim/fencing 和 canonical timeline 均属于 runtime contract。Channel 只能投影 stream；session/gateway 只保存事实；core/capability/context/model 只能通过 runtime-owned context 产生执行事实。

理由：请求生命周期必须有唯一真相来源，才能保证 cancel/retry/edit、恢复、断连 replay 和历史一致性。放弃由 channel、core 或 session 各自维护状态机的方案。

### 3. Request Execution Stream 是 timeline 的用户可见投影

选择：冻结 `RunStatus`、`TimelineEventType` 和 `StreamEventType` vocabulary。Request Execution Stream 的用户可见 event 都从 canonical timeline 或 runtime status 派生；SSE 和 WebSocket 共用同一 projection contract。Session Activity Projection Stream 是唯一封闭例外，使用独立的 session attention snapshot/delta contract，不进入 `StreamEnvelope` 或 timeline。

理由：这样可以让 execution stream resume、history consistency 和 observability 使用同一事件事实，同时允许浏览器在不复制 runtime lifecycle 的前提下观察跨会话活动。放弃 transport 自定义事件名或把 Activity 包装成 execution event 的方案。

### 4. Owner scope 明确拆为 `tenantId` 和 `subjectId`

选择：owner scope 是 `tenantId` 和 `subjectId` 的组合语义，不引入单独 DTO。核心契约中所有需要归属边界的位置显式使用 `tenantId` 和 `subjectId`。Channel/auth 负责解析当前身份；请求体、模型输出、capability args 或客户端 metadata 不能覆盖当前身份。

理由：owner scope 是跨 session、attachment、capability、gateway、audit 的安全边界，字段必须稳定且可审计。

### 5. Gateway contract 只表达逻辑端口和并发语义

选择：gateway ports 只定义 session/message/run/timeline/checkpoint/artifact/pending input/conversation annotation 等逻辑读写，以及 owner-scoped request、optimistic version、claim/fencing 和 idempotent terminal write 的语义。具体 local/remote adapter、SQLite schema、索引和 remote endpoint 不在当前核心契约基线中定义。

理由：最小内核需要持久化边界，但不能把实现细节泄漏给 runtime、session 或 channel。放弃让上层模块依赖具体 store driver 的方案。

### 6. Capability 只冻结上位概念和执行边界

选择：Capability 公共 kind 为 `TOOL`、`SKILL`、`AGENT`。核心契约定义 descriptor、provider identity、availability、Skill typed metadata/diagnostic contract、invocation request/result、安全输出、审计/观测关联规则、取消/超时和幂等声明扩展位。本地 Agent discovery 和 Tool-kind Agent tool 已通过 capability-owned resolver/subagent execution contract 进入稳定基线；远端 AgentRegistry execution、继承父上下文、更多 provider/source 类型和更复杂 Skill execution mode 仍由后续 change 补实。

理由：能力治理是所有工具、Skill、Agent delegation 和 API-backed Tool 的共同边界。核心契约冻结共享 envelope 和 owner，不把具体 provider implementation、source loading details 或 runtime lifecycle implementation 泄漏给 capability descriptor。

### 7. No-op 仅用于一层直接依赖

选择：hook、checkpoint save、audit sink 等一层直接依赖可以在最小内核中提供 no-op 实现，但 contract 必须是目标形态，主流程必须真实调用。

理由：这样最小内核能跑通问答，同时后续真实实现可以替换 provider 而不改主流程调用语义。放弃在最小内核中省略这些调用点的方案。

## 核心契约面（Core Contract Surface）

本节是领域对象字段、enum 和核心 port 签名的设计主承载。`specs/ts-core-contracts/spec.md` 只承载可验证行为，`tasks.md` 只承载实现和验证任务；实现阶段不得在单个实现包中重新定义本节已经冻结的跨模块字段、enum 或 port。

### 0. Public export modules

`agent-common` 是所有 contract 下方的独立 foundation package，承载 shared branded ids、基础 value object、JSON value、时间/幂等键、当前身份值对象、secret reference、安全错误基线和被多个边界共同消费的 durable scalar vocabulary；`agent-common` 不得导入 `agent-contracts`，不得定义 DO、DTO、Record、port 或 service contract。`agent-contracts` 必须按拥有领域边界提供稳定 subpath export，承载 boundary DTO、enum、runtime schema 和 port，不新增 `agent-contracts/common` owning module。每个 public contract 只能有一个 owning export surface；产品实现包不得从 `agent-contracts` root aggregate import，必须从架构授权的 owning subpath import。实现包不得从其他实现包、adapter-private DTO、数据库 schema、provider SDK 类型或本地路径布局导入跨模块契约。

| Export surface | Owning objects and ports |
|---|---|
| `agent-common` | `Brand`、`TenantId`、`SubjectId`、`SessionId`、`MessageId`、`RequestRunId`、`CapabilityId`、`CapabilityInvocationId`、`ArtifactId`、`AttachmentId`、`BlobRef`、`CheckpointId`、`PendingInputId`、`AgentId`、`AgentType`、`AgentVersion`、`RequestContextId`、`IdempotencyKey`、`EpochMillis`、`TimelineSequence`、`JsonValue`、`JsonObject`、`IdentityContext`、`RequestLocale`、`RequestLanguage`、`RequestPriority`、`SecretReference`、`SessionMessageRole`、`MessageContentType`、`VisibilityReason`、`AttachmentMediaType`、`AttachmentValidationStatus`、`AttachmentAvailabilityStatus`、`PendingInputKind`、`PendingInputStatus`、`RunStatus`、`TerminalCommitState`、`TimelineEventType`、`CheckpointTriggerReason`、`CapabilityKind`、`CapabilityProviderKind`、`CapabilityReplayPolicy`、`CapabilityInvocationStatus`、`LongTermMemoryId`、`TaskTrajectoryId`、`MemoryCategory`、`LongTermMemoryState`、`TaskTrajectoryKind`、`TaskTrajectoryBuildStatus`、`TaskOutcomeStatus`、`OutcomeEvidenceLevel`、`AgentErrorCategory`、`AgentErrorOptions`、`AgentError`、`SafeError` 、`WorkflowNodeType` |
| `agent-contracts/agent-assembly` | `AgentAssembly`、`AgentWorkspacePolicy`、`AgentWorkspaceRootPolicy`、`AgentCapabilityBinding`、`AgentRuntimeSettings`、`AgentAssemblyRegistry`；只承载 runtime-safe assembly facts，不承载 Agent execution、raw AgentDefinition、raw config、provider credentials、gateway config、physical execution roots 或 app compiler contract |
| `agent-contracts/runtime` | `ExecutionDeploymentMode`、`ExecutionWorkspaceResolver`、`ResolveExecutionWorkspaceInput`、`ExecutionWorkspaceView`、`ExecutionWorkspaceRootView`、`LifecycleStage`、`SubmitRequestCommand`、`RequestControlCommand`、`EditLatestRequestCommand`、`HideRunMessagesCommand`、`RecordInputGuardBlockCommand`、`RuntimeForkSessionFromMessageCommand`、`RuntimeForkSessionFromRequestCommand`、`ForkSessionFromMessageResult`、`RequestAccepted`、`RequestControlAccepted`、`RequestContext`、`ToolCallState`、`RequestRun`、`RunTimelineEvent`、`RuntimeCommandPort`、`RuntimeSessionPort`、`RuntimeListSessionsQuery`、`RuntimeListSessionMessagesQuery`、`RuntimeConversationPreviewQuery`、`RuntimeSessionStreamEventsQuery`、`RuntimeGetActiveRunQuery`、`RuntimeActiveRunSummary`、`RuntimeConversationAnnotationPort`、`RuntimeUpsertAnnotationCommand`、`RuntimeListFavoriteSessionsQuery`、`RuntimeListSessionAnnotationsQuery`、`ConversationAnnotationView`、`ConversationFavoriteSessionEntry`、`ConversationFavoriteSessionPage`、`Agent`、`AgentConstructor`、`AgentRunStatePort`、`RunTimelineEventPort`、`RunMessagePort`、`CheckpointPayload`、`PendingInputRequest`、`PendingInputQuestion`、`PendingInputOption`、`PendingInputAnswer`、`AnswerPendingInputCommand`、`PendingInputAnswerAccepted`、`PendingInput`、`HookEffect`、`HookOutcome`、`HookFailureMode`、`HookKind`、`HookInvocationStatus`、`LifecycleHook`、`LifecycleHookExecutable`、`LifecycleHookDefinition`、`LifecycleHookInvocationCoordinates`、`LifecycleHookInvocationPort`、`LifecycleHookInvocationRequest`、`LifecycleHookInvocationResult`、`LifecycleHookControlInterruption`、`HookBoundaryByStage`、`HookMutationByStage`、`PendingInputIntent`、`HookInput`、`HookResult` |
| `agent-contracts/channel` | `StreamEventType`、`StreamEnvelope` |
| `agent-contracts/session` | `SessionMessage`、`SessionMessageDraft`、`SummaryMessageMetadata`、`ModelVisibilityMetadata`、`ActiveContextState`、`ActiveContextItem`、`ActiveContextView`、`UserSession`、`CreateUserSessionCommand`、`RequireUserSessionQuery`、`ListUserSessionsQuery`、`UserSessionPage`、`ListSessionMessagesQuery`、`ConversationPreviewQuery`、`ConversationPreviewMarker`、`ConversationPreviewPage`、`SessionMessagePage`、`ListCurrentRequestMessagesQuery`、`ForkNotice`、`UserSessionPort`、`GenerateSessionTitleCommand`、`UpdateSessionTitleCommand`、`ContentRef`、`ArtifactMetadata` |
| `agent-contracts/attachment` | `AttachmentMediaType`、`AttachmentValidationStatus`、`AttachmentAvailabilityStatus`、`RequestAttachment` |
| `agent-contracts/context` | `ModelSelectionRequest`、`ModelSelectionResult`、`ModelSelectionService`、`ContextAssemblyRequest`、`SystemPromptSectionMetadata`、`SystemPromptSection`、`SystemPrompt`、`ContextAssembly`、`RenderedModelInput`、`ContextEnginePort`、`ForkActiveContextSelectionRequest`、`ForkActiveContextSelectionResult`、`ForkActiveContextSelectionPort` |
| `agent-contracts/model` | `ModelProviderId`、`ModelMessageRole`、`ThinkingDepth`、`ThinkingOptions`、`ModelInferenceOptions`、`ModelProviderProfile`、`ModelProfile`、`ResolvedModelConfiguration`、`ModelCatalogEntry`、`ModelCatalogQueryService`、`ModelMessage`、`ModelToolCall`、`ModelInvocationScope`、`ModelInvocationRequest`、`ModelStreamDelta`、`ModelUsage`、`ModelFinalResult`、`ModelInvocationService`、`ModelGatewayProvider` |
| `agent-contracts/capability` | `AvailabilityStatus`、`OsFamily`、`CpuArchitecture`、`SkillManifestValidationOutcome`、`SkillManifestDiagnosticSeverity`、`SkillManifestDiagnosticReasonCode`、`SkillMetadata`、`SkillManifestDiagnostic`、`CapabilityProvider`、`CapabilityDiscoveryMode`、`CapabilityProviderConfig`、`CapabilityProviderOptions`、`LocalDirectoryProviderOptions`、`SkillHubOptions`、`McpServerOptions`、`AgentRegistryOptions`、`CustomProviderOptions`、`CapabilityCompatibility`、`CapabilityDescriptor`、`CapabilityInvocationRequest`、`CapabilityGeneratedMessage`、`CapabilityContextPatch`、`CapabilityInvocationResult`、`CapabilityCatalogRequest`、`CapabilityResolveRequest`、`CapabilityCatalog`、`CapabilityInvocationPort`、`RuntimeCapabilityResolveRequest`、`RuntimeCapabilityResolver`、`SubagentExecutionRequest`、`SubagentExecutionResult`、`SubagentExecutionPort` |
| `agent-contracts/core` | `RoutingDecisionKind`、`AgentRoutingDecision` 、`RecipeDefinition`、`FlowGraph`、`WorkflowNodeDef`、`WorkflowBranchDef`、`WorkflowExecutionService`、`WorkflowExecutionRequest`、`WorkflowExecutionResult`、`WorkflowNodeResult`、`WorkflowExecutionEvent`、`WorkflowExecutionObserver`、`WorkflowVisibleDelta` |
| `agent-contracts/gateway` | `OwnerScoped`、`FetchGateway`、`VersionedUpdateStatus`、`VersionedUpdateResult`、`TerminalCommitStatus`、`TerminalCommitRecordResult`、`IdempotentWriteOptions`、`VersionedWriteOptions`、`BlobRecordPurpose`、`SessionTitleSource`、`RequestRunRecord`、`RunTimelineEventRecord`、`SessionRecord`、`SessionMessageRecord`、`SessionHistoryRecordQuery`、`SessionHistoryEntry`、`SessionHistoryPage`、`ConversationPreviewRecordQuery`、`ConversationPreviewMarkerRecord`、`ConversationPreviewRecordPage`、`ListSessionMessagesRecordQuery`、`ListCurrentRequestMessagesRecordQuery`、`SessionMessageRecordPage`、`ActiveContextStateRecord`、`ActiveContextItemRecord`、`ActiveContextViewRecord`、`RequestAttachmentRecord`、`ArtifactMetadataRecord`、`CheckpointRecord`、`PendingInputRecord`、`ConversationAnnotationRecord`、`ConversationFavoriteSessionSummary`、`ListFavoriteSessionsQuery`、`ListSessionAnnotationsQuery`、`DeleteAnnotationsByRunRequest`、`ForkSourceRecord`、`ListForkSourcePrefixMessagesQuery`、`ForkSessionFromMessageWriteRequest`、`ForkSessionFromMessageWriteResult`、`StageForkPromotionRequest`、`ForkPromotedContentRecord`、`ForkPromotionAbortRequest`、`ForkPromotionCleanupRequest`、`ForkPromotionCleanupResult`、`LongTermMemoryRecord`、long-term memory request/query/result DTO、`TaskTrajectoryRecord`、task trajectory request/query/result DTO、`WorkingMemoryGatewayBindings`、`LongTermMemoryGatewayBindings`、`SqliteGatewayStoreBindings`、`GatewayBindings`、`TerminalCommitRequest`、lookup/list/CAS/composite request objects、`SandboxExecutionRequest`、`SandboxFilesystemLayout`、`SandboxFilesystemRoot`、`ScheduledMaintenanceJob`、`ScheduledMaintenanceGatewayPort`、`SandboxExecutionResult`、`SandboxGatewayPort`、`RequestRunStoreGateway`、`RunTimelineEventStoreGateway`、`SessionStoreGateway`、`SessionMessageStoreGateway`、`ActiveContextStoreGateway`、`AttachmentStoreGateway`、`BlobStoreGateway`、`ArtifactGatewayPort`、`CheckpointStoreGateway`、`PendingInputStoreGateway`、`ConversationAnnotationStoreGateway`、`LongTermMemoryStoreGateway`、`LongTermMemoryRetrieverGateway`、`TaskTrajectoryStoreGateway`、`TaskTrajectoryQueryGateway`、`FeedbackRecord`、`FeedbackStoreGateway`、`PendingInputProducerRef` |
| `agent-contracts/gateway` (续) | `ConversationShareRecord`、`LoadShareRequest`、`DeleteSharesBySessionRequest`、`ConversationShareStoreGateway` |
| `agent-contracts/runtime` (续) | `RuntimeConversationSharePort`、`CreateShareCommand`、`ShareResult`、`LoadSharedConversationQuery`、`SharedConversationMessage`、`SharedConversationPage` |
| `agent-contracts/observability` | `AttributeValue`、`Attributes`、`AuditEvent`、`AuditEventWriter`、`ErrorNormalizer` |
| `agent-contracts/app` | 兼容 re-export `ModelProviderProfile`、`ModelProfile` 与对应 schema；模型契约 owner 仍为 `agent-contracts/model` |

Session Activity 的 contract ownership 进一步固定如下：`agent-contracts/session` owning `SessionActivityStatus`、`SessionActivityEntry`、`SessionActivityMessage`、session coordinates/query/consume command 和 `SessionActivityPort`；`agent-contracts/runtime` 只 owning app/channel 可见的 `RuntimeStreamSessionActivitiesQuery`、`RuntimeConsumeSessionActivityCommand` 和 `RuntimeSessionActivityPort` facade。`agent-contracts/channel` 仍只 owning Request Execution Stream 的 `StreamEventType` 与 `StreamEnvelope`；Activity snapshot/delta 不属于 channel contract，也不得包装成 execution event。

跨边界 enum/vocabulary 的归属遵循三条规则：第一，跨多个核心模块共享、语义稳定、且不是单一业务领域私有状态的 durable scalar vocabulary 归 `agent-common`，例如 `RunStatus`、`TerminalCommitState`、`TimelineEventType`、`CheckpointTriggerReason`、session message role/content/visibility、attachment media/status、pending input kind/status、基础 capability enum，以及长期记忆和 task trajectory 的 id/category/state/outcome/evidence vocabulary；第二，只服务单一业务边界且不需要被 Record 复用的 enum 留在对应业务 subpath；第三，只为持久化机制存在、且不应反向决定领域归属的值，使用 gateway-owned persistence-only vocabulary，例如 `VersionedUpdateStatus`、`TerminalCommitStatus` 和 `BlobRecordPurpose`。Gateway 不定义 `SessionMessageRecordRole`、`MessageContentRecordType`、`VisibilityRecordReason`、`AttachmentMediaRecordType`、`AttachmentValidationRecordStatus`、`AttachmentAvailabilityRecordStatus`、`PendingInputRecordKind` 或 `PendingInputRecordStatus` 这类业务 vocabulary 副本。

Workflow 执行与路由扩展了上述核心契约：`agent-common` 新增 `WorkflowNodeType` 节点分类 vocabulary；`agent-contracts/core` 新增 workflow DSL/port/DTO/event 最小契约集（`RecipeDefinition`/`FlowGraph`/`WorkflowNodeDef`/`WorkflowBranchDef`/`WorkflowExecutionService`/`WorkflowExecutionRequest`/`WorkflowExecutionResult`/`WorkflowNodeResult`/`WorkflowExecutionEvent`/`WorkflowExecutionObserver`/`WorkflowVisibleDelta`），`inputs`/`outputs`/`outputParser` 保持 opaque；`agent-contracts/gateway` 的 `PendingInputProducerRef` 扩展 `WORKFLOW_NODE` 变体；`agent-contracts/runtime` 的 `AgentRunStatePort.requestPendingInput` 增加可选 `RequestPendingInputOptions`。这些是兼容性扩展（可选参数 + union 扩展），非破坏性重定义。跨模块协作、pending-input 桥接、owner/agent scope 传递与 deferred 范围见 `architecture/workflow-execution-and-routing.md` 与 `modules/agent-workflow.md`。

领域对象归其业务 owning module；read-model query 归提供该 read model 的业务 module；persistence DTO 使用 `*Record` 命名并归 `agent-contracts/gateway`；logical gateway port、query/filter request、CAS/composite request 和 gateway-specific result type 也归 `agent-contracts/gateway`。例如 `SessionMessage`、`SessionMessageDraft`、`UserSession`、`ListSessionMessagesQuery`、`SessionMessagePage`、`ContentRef`、`ArtifactMetadata` 和 `Feedback` 归 `agent-contracts/session`，但 `SessionMessageRecord`、`SessionHistoryRecordQuery`、`ListSessionMessagesRecordQuery`、`ListCurrentRequestMessagesRecordQuery`、`SessionMessageRecordPage`、`FeedbackRecord`、`ConversationAnnotationRecord`、`ConversationFavoriteSessionSummary`、`SessionMessageStoreGateway`、`ConversationAnnotationStoreGateway` 和 `HideMessageRequest` 归 `agent-contracts/gateway`。长期记忆和 task trajectory 也是同一原则：retained `LongTermMemoryRecord`、`TaskTrajectoryRecord`、查询 DTO、mutation DTO 和 store/query/retriever ports 归 `agent-contracts/gateway`；`agent-memory` 只拥有业务编排和工具/provider factory。Gateway contract 不得引用上层领域 DO，也不得依赖上层业务 subpath 来复用 vocabulary；gateway Record 可引用 `agent-common` 中的 durable scalar vocabulary。领域实现负责 DO 与 Record 的映射、值域一致性和校验。如果后续 change 增加 public contract，必须先选择 owning export module；除非新增独立领域边界，否则不得新增 export module。

Gateway provider bindings are capability-specific rather than one optional catch-all store bundle. `WorkingMemoryGatewayBindings` is the complete request/session working-fact bundle, `LongTermMemoryGatewayBindings` is the complete memory store/retriever bundle, and `SqliteGatewayStoreBindings` is the explicitly retained local SQLite store set. Downstream domain packages consume these public ports and must not observe SQLite files, schema owners, provider-private DTOs or incomplete optional bundles.

`agent-contracts/gateway` 是用户查询公共契约的唯一 owner。`UserQueryGateway.queryUsers` 接收 `UserQueryRequest` 和可选 `AbortSignal`，返回 `UserQueryResult | SafeError`。`UserQueryRequest` 包含作为可信授权上下文的 `tenantId`、当前调用者 `subjectId`，以及 1..10000 个互不重复 `SubjectId` 的 `targetSubjectIds`。`UserQueryResult.users` 是 `UserProfileRecord` 数组，每项只包含 required `subjectId` 和 required `userName`（1..256 个 Unicode code point 的非空字符串）；结果中的每个 `subjectId` 必须来自本次 `targetSubjectIds`、不得重复并按请求相对顺序返回。Gateway MAY 省略不存在或调用者无权查看的目标用户，且不得通过错误、占位字段或诊断泄漏该用户是否存在。取消时返回 category 为 `CANCELED` 的 `SafeError`，不返回部分成功结果。结果、`SafeError` 和诊断不得包含未请求用户、credential、token、原始 provider payload 或未经授权的用户属性。`GatewayBindings.userQuery?: UserQueryGateway` 是该单一 port 的唯一 binding 位置，不增加只包含它的聚合 bindings，也不放入 Working Memory、Long-term Memory 或 SQLite bindings。稳定 `GatewayAdapterKind` 集合包含 `user-query`；LOCAL 默认 gateway entries 包含 `gatewayId=local-user-query`、`gatewayKind=user-query`、`deploymentMode=LOCAL`，LOCAL provider 为每个目标标识返回 `userName="${subjectId}-name"`。REMOTE selection 缺少 provider 时启动在 ready 前失败，不回退 LOCAL；REMOTE transport、认证 header、wire DTO 和 provider 错误映射不属于本契约，但 REMOTE 实现必须满足同一输入、输出、取消和安全语义。

`agent-contracts/gateway` 是正式问题推荐外部查询契约的唯一 owner。`QuestionRecommendationGateway` 提供 `listFrequentHistoryQuestions(request, signal?)` 与 `recommendSimilarPresetQuestions(request, signal?)` 两个异步方法；请求必须显式携带可信 `OwnerScoped` 和 `agentId`，并分别使用 `limit=1..10`、`query=1..512` 与 `limit=1..20` 的有界输入。成功结果只返回 canonical `questions` 数组：历史问题项为非空 `content` 加非负整数 `frequency`，预置问题项为非空 `questionId` 加非空 `content`；adapter 必须保持 provider 相对顺序、截断到请求 `limit`，并把无数据规范化为 `{ questions: [] }`。两类 request/result 都有 `additionalProperties=false` 的 runtime schema，外部调用前验证 request，返回 consumer 前验证 canonical result。

`WorkingMemoryGatewayBindings.questionRecommendations?` 是该 gateway 的唯一 binding 位置；不得增加顶层 `GatewayBindings` 字段、专用 `GatewayAdapterKind` 或 `SqliteGatewayStoreBindings` 成员。binding 缺失只表示正式问题推荐不可用，不允许回退为 Pin、用户问题活动、高频问题或问题联想 persistence contract。adapter 失败只使用 `QUESTION_RECOMMENDATION_INVALID_INPUT`、`QUESTION_RECOMMENDATION_CANCELED`、`QUESTION_RECOMMENDATION_UNAVAILABLE` 和 `QUESTION_RECOMMENDATION_INVALID_PROVIDER_RESULT` 四类 `SafeError.code`，不得暴露 provider error body、URL、credential、query、推荐内容或原始异常。

远端 wire DTO 只能停留在 adapter：历史高频查询将 `subjectId` 映射为 provider `userId`、`limit` 映射为 `searchCriteria.questionTopN`，并固定 `portraitType=["QUESTION"]`；预置相似查询将 `limit` 映射为 `topn`，`agentId` 与 Owner Scope 仅用于可信调用上下文，不进入 provider body。provider 的 `userId`、`portraitType`、`topn`、`errorCode`、`errorMsg` 和 `agentName` 不进入 canonical contract；`agentId` 也不得静默改名为语义不同的 `agentName`。contract 本身不启用 adapter、application service、Web API 或前端产品路径。

Session fork 的 contract owner 也按同一原则切分：runtime subpath 只承载 fork command/result facade；session subpath 只承载 `ForkNotice` read model 和 conversation page projection；context subpath 只承载 `ForkActiveContextSelectionPort`；gateway subpath 承载 prefix query、fork source record、promotion staging metadata 和 fork composite write。`ForkSourceRecord` 与 `ForkPromotedContentRecord` 只能作为 gateway persistence DTO，不得进入 session/Web DTO 或模型上下文。

相同语义类别、生命周期阶段、架构边界和安全/一致性不变量的对象或操作，必须使用同一 owner、命名规则、contract shape、write/storage/idempotency 策略和验证方式；不得为同类情况新增平行 DTO、Record、Request、enum、port、store 或 helper。真实例外必须先在 OpenSpec design 中说明原因、适用范围、owner 和验证路径。

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
type AgentType = Brand<string, "AgentType">
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
type RequestPriority = "HIGH" | "NORMAL" | "LOW"

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
  | "MODEL_INVOCATION_STARTED"
  | "MODEL_INVOCATION_COMPLETED"
  | "MODEL_INVOCATION_FAILED"
  | "LLM_THINKING_DELTA"
  | "LLM_CONTENT_DELTA"
  | "CAPABILITY_RESULT_DELTA"
  | "CAPABILITY_STARTED"
  | "CAPABILITY_COMPLETED"
  | "TOOL_STRUCTURED_DELTA"
  | "DEGRADATION_NOTICE"
  | "REQUEST_COMPLETED"
  | "REQUEST_FAILED"
  | "REQUEST_CANCELED"
  | "REQUEST_SUPERSEDED"
  | "ATTACHMENT_ACCEPTED"
  | "ATTACHMENT_REJECTED"
  | "CONTEXT_COMPACTED"
  | "BACKGROUND_TASK_STARTED"
  | "BACKGROUND_TASK_COMPLETED"
  | "BACKGROUND_TASK_FAILED"
  | "POLICY_APPLIED"
  | "HOOK_INVOKED"
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
- `TimelineSequence` 表示 session timeline 游标，取值必须是非负安全整数且不超过 `Number.MAX_SAFE_INTEGER`；canonical timeline event 的 sequence 从 1 开始；显式 `lastSeenSequence=0` 表示调用方请求从 session timeline 开头 replay，省略 `lastSeenSequence` 不等同于 `0`。
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
  | "BEFORE_AGENT_TERMINAL"

type SessionMessageRole = "USER" | "ASSISTANT" | "CAPABILITY_RESULT" | "SUMMARY"
type MessageContentType = "PLAIN_TEXT" | "MARKDOWN" | "MERMAID"
type VisibilityReason = "RETRY_REPLACED" | "EDIT_REPLACED" | "CAPABILITY_GENERATED" | "GUARD_BLOCKED"
```

核心 request/run/message 对象如下：

```ts
interface SubmitRequestCommand {
  readonly sessionId?: SessionId
  readonly agentId?: AgentId
  readonly agentVersion?: AgentVersion
  readonly identityContext: IdentityContext
  readonly inputText: string
  readonly attachmentIds: readonly AttachmentId[]
  readonly locale: RequestLocale
  readonly routingConstraints?: RoutingConstraints
  readonly requestModelOptions?: RequestModelOptions
  readonly idempotencyKey: IdempotencyKey
  readonly parentSessionId?: SessionId
  readonly parentRunId?: RequestRunId
  readonly parentRequestId?: MessageId
  readonly priority?: RequestPriority
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
  readonly acceptedInputText?: string
  readonly routingConstraints?: RoutingConstraints
  readonly requestModelOptions?: RequestModelOptions
  readonly agentId: AgentId
  readonly agentVersion: AgentVersion
  readonly agentAssemblyRef: string
  readonly agentTurnIndex: number
  readonly activeStepId?: string
  readonly nextLifecycleStage: LifecycleStage
  readonly currentToolBatchMessageId?: MessageId
  readonly toolCallStates: readonly ToolCallState[]
  readonly flowVariables: JsonObject
}

interface RoutingConstraints {
  readonly targetSkill?: string
  readonly targetRecipe?: string
  readonly forbiddenCapabilityIds?: readonly CapabilityId[]
  readonly executionMode?: "default" | "model-only"
  readonly locale?: RequestLocale
  readonly allowHumanInput?: boolean
  readonly allowSubagents?: boolean
}

interface RequestModelOptions {
  readonly thinking?: { readonly depth: "OFF" }
  readonly toolChoice?: ToolChoice
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
  readonly parentRunId?: RequestRunId
  readonly parentRequestId?: MessageId
  readonly priority?: RequestPriority
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

type ModelVisibilityMetadata = JsonObject & {
  readonly excluded: boolean
  readonly reason: VisibilityReason
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

`identityContext` 由可信 channel/auth boundary 注入，不来自客户端 payload。`SubmitRequestCommand.sessionId` 省略表示创建新 session；正常用户 submit 的 trusted Agent scope 来自 channel/app composition 或显式 hosted-agent selection，child Agent submit 的 `agentId/agentVersion` 和 parent linkage 来自 runtime-owned `SubagentExecutionPort`。`parentSessionId`、`parentRunId`、`parentRequestId` 和 `priority` 是 runtime/capability composition 产生的执行事实，不得由模型输出或 capability 参数覆盖。`SubmitRequestCommand` 和 `EditLatestRequestCommand` 使用 `attachmentIds` 表达本次请求引用的已上传附件 id，command 不承载附件名称、类型、大小、状态或存储引用。`RequestControlCommand` 和 `EditLatestRequestCommand` 使用 `expectedLatestRequestId` 表达 latest-request 乐观校验语义；使用 `editedInputText` 表达编辑后的用户输入文本；这些字段名属于核心 command contract 的稳定语义，后续 change 不得用泛化的 `owner`、`targetId`、`input` 或 `metadata` 字段替代。`routingConstraints` 是 request-scoped typed fact，由 `agent-contracts/runtime` owning；它只允许 `targetSkill`、`targetRecipe`、`forbiddenCapabilityIds`、`executionMode`、`locale`、`allowHumanInput` 和 `allowSubagents`，不得承载 Tool-call 数量预算、owner override、provider override、raw prompt、raw policy、raw tool authority、credential、path 或 provider-private 字段。`requestModelOptions` 是独立的受治理模型选项收窄面，只允许关闭 reasoning 和设置 canonical `toolChoice`，不能改变模型身份或 Agent-owned loop limits。Runtime 必须使用 `identityContext.tenantId` 和 `identityContext.subjectId` 校验 session、latest request、message 和 run 的 owner scope。

`RequestAccepted` 表达 runtime 已接受并创建对应执行实例，字段固定为 `sessionId`、`requestId`、`runId` 和 `attempt`，不暴露 stream cursor 或 timeline sequence 字段。`requestId` 是请求的根用户消息 id；retry 保持同一个 `requestId` 并创建新的 `runId`；edit 创建新的 `requestId`。`retryLatest` 和 `editLatest` 会创建新的执行实例，因此成功受理时返回 `RequestAccepted`。`RequestRun` 不直接接受客户端传入 owner 字段；`tenantId` 和 `subjectId` 通过 runtime command、gateway lookup/write request 和 audit event 传递。`attempt` 从 1 开始；`version` 从 1 开始并在恢复相关边界递增；`retryOfRunId` 只能在 `attempt > 1` 时存在。`parentRunId/parentRequestId` 表达 child Agent run 的父执行坐标，`priority` 表达 scheduler 排队优先级。终态为 `COMPLETED`、`FAILED`、`CANCELED`、`SUPERSEDED`。降级不属于 `RunStatus`；降级通过 timeline/stream event、capability/model result、safe error、audit event 或 observability metric 表达。

会话标题和 edit-resubmit 复用上述边界而不形成平行 lifecycle。普通 submit 的 `REQUEST_ACCEPTED` durable fact 写入后，runtime 可把本次 command input 交给 session title owner 做非阻塞自动标题尝试；手工标题由 Web channel 注入 trusted identity 后经 `RuntimeSessionPort.updateTitle` 下沉到 session/gateway。edit 由 Web JSON projection 进入 `RuntimeCommandPort.editLatest`，runtime 拥有 latest/idempotency/lane replacement、新 request/run/context 和 append-only durable facts，session/gateway 只保存事实，Agent Web 的 optimistic hide/temporary root 只属于本地 presentation。当前 Web edit 只接受文本和空 `attachments` 兼容形态；internal command 的 `attachmentIds` 仍由 runtime 在 acceptance 前按 trusted owner、Agent 和 session scope 重验，不能把浏览器限制解释为取消 attachment authority。

`RequestContext` 是 runtime/core 之间的可恢复执行坐标，不重复保存由其他 durable fact 拥有的字段。`attempt` 和 `deadlineAt` 的事实源是 `RequestRun`，不得复制到 `RequestContext`。`routingConstraints` 与 `requestModelOptions` 只作为 accepted request facts 被原样携带到 Agent boundary，runtime 不把 schema-valid constraint 或 model option 当作 capability、provider、模型身份或 loop-budget 授权。`agentTurnIndex` 是同一 accepted `RequestRun` 的唯一 logical Agent turn coordinate；normal turn 使用 `0..maxTurns-1`，`index=maxTurns` 唯一表示 finalizing turn，pause、resume 和 crash recovery 必须保留该值，不能引入 phase 或重置计数。`RequestContext` 不包含 `messageRefs`；模型上下文永远从 active context view 读取，具体进入模型上下文的消息由 `ContextAssembly.selectedMessageRefs` 表达。工具轮后下一次模型调用需要看到当前 run 已产生消息时，runtime/session 必须在保存模型可见消息时同步维护 active context view；恢复重建 pending tool call 时才按 `sessionId`、`requestId` 和 `runId` 从 message store 查询当前 run messages。恢复执行点参照当前运行逻辑从 persisted messages、checkpoint `lastSequence`/`triggerReason`/`agentTurnIndex`、tool call state、timeline、`activeContextVersion` 和 run version 对账重建，不通过 `RequestContext.messageRefs` 表达。`currentToolBatchMessageId` 指向当前 tool batch 的 assistant tool-use message；`toolCallStates` 保存该 batch 中每个 tool call 的 `toolCallId`、`capabilityId`、结构化 `arguments` 和 `status`，用于恢复后继续执行 pending tool call。checkpoint 不保存完整 `toolCallStates`，只保存恢复边界和校验所需字段；恢复时优先按 checkpoint 的 run/version/sequence/trigger/turn 约束，从 message store 读取当前 run messages，定位 assistant tool-use message 及 capability result messages 后重建 `RequestContext`。`locale` 是核心上下文中唯一的用户语言/区域化输入事实，表示客户端或 channel 归一化后的 BCP 47 locale，例如 `zh-CN`、`en-US`；它用于 prompt 中的回答语言、日期、数字、货币、单位和用户可见文案区域化要求。`RequestLanguage` 只作为从 `locale` 或用户输入派生出的内部/兼容枚举，用于 capability language filtering、标题规则等窄场景，不进入 `RequestContext`、`ContextAssemblyRequest` 或 `ContextAssembly`。`nextLifecycleStage` 只允许表达可恢复执行点，包括 `BEFORE_MODEL_INVOKE`、`BEFORE_CAPABILITY_INVOKE` 和 `BEFORE_AGENT_TERMINAL`；`currentToolBatchMessageId` 和 `toolCallStates` 仅在 `nextLifecycleStage=BEFORE_CAPABILITY_INVOKE` 时有效。`flowVariables` 是 request-scoped JSON-compatible map，用于恢复和执行内的轻量流程变量，不作为跨 request 业务事实。

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
  | "TOOL_STRUCTURED_DELTA"
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
  | "BACKGROUND_TASK_STARTED"
  | "BACKGROUND_TASK_COMPLETED"
  | "BACKGROUND_TASK_FAILED"
  | "OUTPUT_GUARD_BLOCKED"

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

interface RuntimeSessionStreamEventsQuery {
  readonly identityContext: IdentityContext
  readonly sessionId: SessionId
  readonly lastSeenSequence?: TimelineSequence
  readonly requestId?: MessageId
  readonly runId?: RequestRunId
  readonly signal?: AbortSignal
}

interface RuntimeGetActiveRunQuery {
  readonly identityContext: IdentityContext
  readonly sessionId: SessionId
  readonly signal?: AbortSignal
}

interface RuntimeActiveRunSummary {
  readonly requestId: MessageId
  readonly runId: RequestRunId
  readonly status: RunStatus
}

interface RuntimeListSessionEventsQuery {
  readonly identityContext: IdentityContext
  readonly sessionId: SessionId
  readonly runId: RequestRunId
  readonly afterSequence: TimelineSequence
  readonly limit: number // 1..1000
  readonly signal?: AbortSignal
}

interface RuntimeResolveProcessMessagesQuery {
  readonly identityContext: IdentityContext
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId: RequestRunId
  readonly messageIds: readonly MessageId[] // 1..1000 after dedup; empty only for legacy candidate mode
  readonly includeLegacyCandidates?: boolean
  readonly signal?: AbortSignal
}

type RuntimeSessionEventHistoryPage =
  | {
      readonly availability: "AVAILABLE"
      readonly events: readonly RunTimelineEvent[]
      readonly nextAfterSequence?: TimelineSequence
    }
  | {
      readonly availability: "LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE"
      readonly events: readonly []
    }
```

`RunTimelineEvent` 同时作为 agent/core authoring event、runtime-origin canonical timeline event 和 runtime-safe history read shape。agent/core 通过 runtime 提供的 timeline port 发布事件时，只需要提供 `type`、`inlinePayload` 和必要的 `contentRef`；runtime MUST 在接收时填充或复写 `eventId`、`sessionId`、`runId`、`requestId`、`requestContextId`、`sequence` 和 `createdAt`。进入持久化、stream、replay、audit 关联或 terminal commit 后的 runtime-origin canonical timeline event MUST 具备这些 runtime-owned 字段。agent/core 不得依赖自己传入的 runtime-owned 字段被保留。

Persistence-only `FORK_SNAPSHOT` 是受控例外：它使用 child-owned event/session/request/run identities 和 child sequence，MUST 省略 `requestContextId` 与 `contentRef`，只能由 fork composite 创建并通过 run-scoped event-history facade 读取。它不得进入普通 append、stream、resume、cancel、retry、edit、recovery、active-run 或模型上下文路径，也不得被解释为对应 RequestRun 存在。

Request Execution Stream 只能投影 canonical timeline、runtime status 或已规格化的 `OUTPUT_GUARD_BLOCKED` delivery relay；不得暴露本节未列出的用户可见 stream event 名称。`requestId` 表示当前用户请求的 root message id；StreamEnvelope 使用 `requestId` 作为请求关联字段。从 timeline 投影时，`requestId` 来自 `RunTimelineEvent.requestId`，`runId` 来自 `RunTimelineEvent.runId`，`requestContextId` 来自 `RunTimelineEvent.requestContextId`，`timelineEventRef` 指向来源 `RunTimelineEvent.eventId`。`StreamEnvelope.eventId` 是 stream event 自身 id，不要求复用来源 timeline event id。`payload` 是经 channel 投影、脱敏和转换后的用户可见 payload，不要求等同于 timeline `inlinePayload`。Web/channel execution stream 必须通过 `RuntimeSessionPort.streamEvents` 进入 runtime session-facing stream path；`RuntimeSessionStreamEventsQuery.lastSeenSequence` 表示调用方最后成功接收的 session timeline sequence，只有字段显式存在时才是 replay anchor。runtime stream 在显式 `lastSeenSequence` 下返回同一 session 中 `sequence > lastSeenSequence` 的可恢复事件和后续 live 事件；省略 `lastSeenSequence` 且没有 `requestId/runId` 时进入 no-cursor session live-tail，只订阅 runtime 建立 tail boundary 之后的新事件，不 replay 既有 timeline。`requestId` 和 `runId` 只作为过滤条件，不重置 session-scoped sequence；省略 `lastSeenSequence` 却携带 `requestId/runId` 不是合法 bounded recovery。`RuntimeSessionPort.getActiveRun` 为 conversation bootstrap 提供当前 non-terminal run 的 `RuntimeActiveRunSummary { requestId, runId, status }`，该 summary 只能来自 runtime-owned run state。`RuntimeSessionPort.resolveProcessMessages` 只供 server-side projector 在 trusted scope 下批量解析 process event message refs，返回 `SessionMessage` 而非 Record，且不得暴露 Web route。调用中 delta 可保持 live-only；累计 `LLM_THINKING_DELTA` 的最后非空 delta 以 `completed=true` 持久化。SSE、WebSocket、resume 和 run-scoped REST history 必须消费同一 event vocabulary 和 projection service。历史最终体验由 `SessionMessage` 与持久化 run events 组合：final answer 和 recoverable public process body 来自 message，event 提供 process order/status/reference；event history 不进入 context。完整规则见 `conversation-process-history.md`。

Session Activity Projection Stream 是上述 execution event 限制之外唯一封闭例外。它由 `agent-session` 从已提交的 session/run/pending-input/terminal facts 派生，经 app 组合的 `RuntimeSessionActivityPort` 向 channel 暴露 `SNAPSHOT | DELTA`，不进入 `StreamEnvelope`、canonical timeline、`RuntimeSessionPort.streamEvents(...)`、request/run cursor 或 IR route。它只表达跨会话 attention projection，不拥有或推进 request lifecycle、pending-input timeout、terminal commit、session list refresh 或 frontend presentation。

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
  readonly modelConfiguration: ResolvedModelConfiguration
  readonly modelOptions: ModelInferenceOptions
  readonly modelSelectionReason: string
}
```

附件引用在 runtime command 和 `SessionMessage` 中只保存 `AttachmentId`。`fileName`、`mediaType`、`sizeBytes`、`storageRef`、`validationStatus` 和 `availabilityStatus` 的权威事实只存在于 `RequestAttachment`，由 attachment metadata store 查询。Runtime 接受请求前必须按 `identityContext.tenantId`、`identityContext.subjectId` 和 `attachmentIds` 加载 `RequestAttachment`，校验附件属于当前 owner/request 可见范围，且 `validationStatus="ACCEPTED"`、`availabilityStatus="AVAILABLE"` 后才能接受请求。Context Engine 生成附件 descriptor 或加载 Markdown 附件内容时，也必须通过 `AttachmentId` 查询权威 `RequestAttachment`；不得信任 command、message metadata、模型输出或 capability 参数中的附件名称、类型、大小或存储引用。

`BlobRef` 是通用内容存储引用，不是业务 id。附件、artifact 内容、model summary 和其他 blob-backed 大对象可以共用 `BlobStoreGateway` 保存 bytes；上层只能保存和传递 opaque `BlobRef`，不得解析、拼接或把它当成本地路径、URL、bucket/key/version 结构使用。`BlobRef` 不得进入模型上下文、用户可见 stream、SafeError、audit 明细或结构化日志；用户可见名称、类型、大小和摘要必须来自对应 metadata。附件和 artifact 是并列 durable fact：附件表达用户输入文件生命周期，artifact 表达输出或大内容 metadata；两者可以通过 `ContentRef`、`ArtifactMetadata` 或业务 metadata 关联，但不得共享 id 或合并 store。oversized textual `CAPABILITY_RESULT` 不走 `BlobStoreGateway`：其完整内容 externalize 到 execution workspace 文件 `tool-results/<refId>.txt`，`ContentRef.refId` 为该 workspace 相对路径（非 BlobRef），模型经现有 `read` 工具按 `file_path` 分页读回；attachment / artifact / model-summary 等 blob-backed 来源仍由 `BlobStoreGateway` 承载。capability-result F 记录的 `contentRef` 不得被 BlobRef-resolver（如 `readPersistedPreview`）解析。

Active context view 是模型可见上下文的唯一 durable 引用序列。`messages` 保存完整原始消息和压缩生成的 summary message，并保持 append-only；`active_context_items` 按一行一个 `messageId` 保存当前模型上下文可见序列，便于和 `session_messages` 联合查询。`ordinal` 只表达同一 session active context view 内的稳定排序，必须由 `ActiveContextStoreGateway` 在 append 或 compaction commit 时生成/维护，不得来自客户端、channel、模型输出或 capability 参数；核心契约只要求同一 active context view 内 `ordinal` 唯一且按升序还原模型上下文，不规定连续编号、间隔编号或重排策略。Context Engine 组装模型输入时 MUST 先读取 `ActiveContextView.items`，再按 item `messageId` 和 `ordinal` 从不可变 `SessionMessage` store/cache 获取内容；不得直接从全量 messages 按时间范围拼装模型上下文。初始 active context 等于 raw messages 的引用序列；后续模型可见消息写入时必须追加 active context item。压缩采用 prefix compact + recent tail：将被压缩前缀生成一个 `role="SUMMARY"` 的 `SessionMessage`，其 `metadata` 必须符合 `SummaryMessageMetadata`。`SummaryMessageMetadata` 是 `JsonObject` 的 typed extension，所有字段必须是 JSON-compatible value；实现应通过 schema/type guard 在写入和读取 summary message 时校验。压缩保留 recent tail 的原顺序，用 summary message id 替换被压缩前缀。提交压缩时，写入 summary message、替换 active context items 和递增 `activeContextVersion` 必须具备同一事务语义；`activeContextVersion` 是 active context view 的 optimistic lock version，由 store 在模型可见 message append 和 compaction commit 成功时递增；写请求必须携带 `expectedActiveContextVersion`，版本不匹配时返回 version conflict，不得覆盖当前 active context。`ContentRef.refType="MODEL_SUMMARY"` 指向 summary `SessionMessage.messageId`，不指向独立 summary store。raw messages 只用于审计、UI、导出和必要时重新构造 active context，不作为模型调用的直接来源。

Context Engine 的 history candidate selection 在一次同步 `assemble()` 流程内完成，并以 `ActiveContextView` 为模型可见历史的唯一 authority：先读取单一 snapshot；再以 `ContextAssemblyRequest.requestId` 为根用户消息 identity 解析全部 required current-request records（root user message + 同一 `requestId` / `runId` 下的 assistant tool-use / capability-result 等协议必需消息 + latest-request-required attachment / tool state），current request 永远先于 prior conversation 建立；prior conversation 必须按 `requestId` 边界分组，对每个 raw unit 先从具有 `metadata.visibility.reason="RETRY_REPLACED"` 且 `runId` 已定义的非 USER message 收集被替换 run，排除该 request unit 内所有属于这些 run 的非 USER messages（含 Retry 前已 `visible=false` 且无 replacement reason 的 assistant tool-use），再对剩余消息只保留 complete visible turn（含 root user message + 完整有序 tool-use / capability-result 协议序列 + 终态非 tool-use assistant response）；具有 `RETRY_REPLACED` 但缺少 `runId` 的 message 只排除自身，不扩展到其他 messages。Context Engine MUST NOT 按消息时间、run 顺序或 `runId` 值猜测 latest attempt，也 MUST NOT 在没有明确 `RETRY_REPLACED` message 时推断被替换 run。非 `RETRY_REPLACED` 的其他 hidden replacement reason、不完整 turn、pending or orphan tool fragment 整体排除，不因 Retry 规则恢复为模型可见。`ContextAssembly.selectedMessageRefs` MUST 只来自本次 `assemble()` 读取的同一 `ActiveContextView` snapshot；render 阶段不得静默跳过缺失或不再可见的 selected ref（缺失 / 不可见必须 explicit failure 或 explicit degrade）。Required current-request context 无法建立（active context 非空但 root user message id 不在其中）、或任一 `ActiveContextView` 引用的 message ref 在 owner / session / agent scope 下无法安全加载或校验时，`assemble()` MUST 返回显式 safe failure（`CONTEXT_CURRENT_REQUEST_UNRESOLVABLE` / `CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE` / `CONTEXT_ACTIVE_VIEW_UNRESOLVABLE` 之一），不得静默退化为 current-request-only assembly，也不得把 unresolvable ref 当作 prior history 继续。History selection 阶段只输出全部合法候选集，不执行窗口预算、压缩、替换或预算降级；任何合法候选被省略只能归因于既有 downstream policy（budget explainability、summary compression、prompt shaping、large-content references），不得归因于 history selection 自身。`selectedMessageRefs` 的排列顺序遵循自然对话时序（最旧 prior turn 在前、current request 在末），render 据此构造的 model-input message 序列与对话历史一致。

Fork active context initialization 是窄化选择流程，不是模型 assembly。Runtime 只能通过注入的 `ForkActiveContextSelectionPort` 把已经重写到 child scope 的 copied prefix 交给 context-engine；selector 复用 context-engine package-internal prior-history candidate helper，先校验 anchor、child session、一致 message ids 和 metadata refs，再输出 child message ids。该流程不得复制 parent active context、不得读取 parent history/context/timeline、不得调用模型、不得压缩或生成新 summary；child active context state/items 必须在 fork composite write 中以 version `0` 初始化。

> 备注（2026-06-10）：核心契约里曾计划让 `selectedMessageRefs` 每条 ref 携带 `activeContextVersion` 作为 per-ref 解析锚点供 render 回校。spec-to-impl 审查后判定为对当前架构的过度设计（`SessionMessage` append-only + same-session lane 串行 + 当前架构无跨 request 并发 compaction，anchor 想防的 race 不存在），相关 sub-requirement 已在 spec 中删除。本契约段亦不再要求 `selectedMessageRefs` 在 type 层承载 version 字段。

模型目录、选择和调用对象如下：

```ts
type ModelProviderId = "openai-compatible" | "model-gateway"
type ModelMessageRole = "SYSTEM" | "USER" | "ASSISTANT" | "TOOL"
type ThinkingDepth = "OFF" | "LOW" | "MEDIUM" | "HIGH"
type ToolChoice = "AUTO" | "NONE" | "REQUIRED"

interface ThinkingOptions {
  readonly depth: ThinkingDepth
}

interface ModelInferenceOptions {
  readonly temperature?: number
  readonly maxOutputTokens?: number
  readonly topP?: number
  readonly topK?: number
  readonly presencePenalty?: number
  readonly frequencyPenalty?: number
  readonly thinking?: ThinkingOptions
  readonly toolChoice?: ToolChoice
  readonly providerOptions?: JsonObject
  readonly modelParams?: JsonObject
}

interface ModelProviderProfile {
  readonly providerId: ModelProviderId
  readonly baseUrl?: string
  readonly credentialRef?: SecretReference
  readonly models: readonly ModelProfile[]
}

interface ModelProfile extends ModelInferenceOptions {
  readonly modelId: string
  readonly displayName?: string
  readonly contextWindowTokens?: number
  readonly fallbackEligible: boolean
  readonly timeoutMs?: number
  readonly maxRetries?: number
}

interface ResolvedModelConfiguration extends Omit<ModelInferenceOptions, "providerOptions"> {
  readonly modelId: string
  readonly contextWindowTokens: number
  readonly temperature: number
  readonly maxOutputTokens: number
  readonly topP: number
  readonly defaultTimeoutMs: number
  readonly defaultMaxRetries: number
}

type ModelCatalogEntry =
  | { readonly availability: "AVAILABLE"; readonly fallbackEligible: boolean; readonly configuration: ResolvedModelConfiguration }
  | { readonly modelId: string; readonly availability: "UNAVAILABLE"; readonly fallbackEligible: boolean; readonly unavailableReason: ModelUnavailableReason }

interface ModelCatalogQueryService {
  list(signal: AbortSignal): Promise<readonly ModelCatalogEntry[]>
  get(modelId: string, signal: AbortSignal): Promise<ModelCatalogEntry | undefined>
}

interface ModelInvocationScope {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly agentId: AgentId
  readonly agentVersion: AgentVersion
  readonly agentAssemblyRef: string
  readonly operationId: string
  readonly sessionId?: SessionId
  readonly requestId?: MessageId
  readonly runId?: RequestRunId
}

interface ModelInvocationRequest extends ModelInferenceOptions {
  readonly invocationScope: ModelInvocationScope
  readonly modelId: string
  readonly messages: readonly ModelMessage[]
  readonly tools: readonly ModelToolDescriptor[]
  readonly timeoutMs?: number
  readonly maxRetries?: number
}

interface ModelStreamDelta {
  readonly content?: string
  readonly reasoning?: string
  readonly toolCall?: ModelToolCall
}

interface ModelUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
}

interface ModelFinalResult {
  readonly content: string
  readonly reasoning?: string
  readonly finishReason?: ModelFinishReason
  readonly usage?: ModelUsage
  readonly toolCalls?: readonly ModelToolCall[]
  readonly providerResponseId?: string
  readonly safeError?: SafeError
}

interface ModelInvocationService {
  complete(request: ModelInvocationRequest, signal: AbortSignal): Promise<ModelFinalResult>
  stream(request: ModelInvocationRequest, signal: AbortSignal, onDelta: (delta: ModelStreamDelta) => Promise<void>): Promise<ModelFinalResult>
}
```

模型调用层只接受稳定 `modelId` 和 provider-neutral message/tool；base URL、credential ref、provider binding 与 SDK client 保留在 `agent-model` 内部。`ModelCatalogQueryService` 是唯一模型查询接口，Context Engine 的 `ModelSelectionService` 使用 `AgentAssembly.modelIds/defaultModelId` 与 catalog 返回 `ResolvedModelConfiguration`。`RenderedModelInput` 保留渲染后的 messages/tools、模型配置与推理选项；core 将其与可信 `ModelInvocationScope` 组装为调用请求。`stream(...)` 以 callback 交付 delta，并以 Promise 返回唯一终态，调用方不得再从 delta shape 推断 terminal。run/timeline sequencing 不进入模型 provider adapter。

### 4. Capability、Agent assembly 和 routing 对象

Capability 是 Tool、Skill 和 Agent 的统一上位概念。核心 contract 只定义 descriptor、catalog、调用和结果边界，不定义具体工具集合或 source 实现。

```ts
type AvailabilityStatus = "AVAILABLE" | "DISABLED" | "UNAVAILABLE"
type OsFamily = "WINDOWS" | "LINUX" | "MACOS" | "OTHER"
type CpuArchitecture = "X86_64" | "AARCH64" | "X86" | "ARM" | "OTHER"
type SkillManifestValidationOutcome = "accepted" | "rejected" | "degraded"
type SkillManifestDiagnosticSeverity = "INFO" | "WARNING" | "ERROR"
type SkillManifestDiagnosticReasonCode =
  | "SKILL_MD_MISSING"
  | "INVALID_NAME"
  | "NAME_MISMATCH"
  | "INVALID_DESCRIPTION"
  | "INVALID_OFFICIAL_FIELD"
  | "INVALID_CONTEXT"
  | "INVALID_AGENT"
  | "AGENT_REQUIRES_FORK_CONTEXT"
  | "INVALID_INVOCABILITY"
  | "INVALID_TOOL_CONSTRAINTS"
  | "UNSAFE_MODEL_DECLARATION"
  | "CONFLICTING_MODEL_DECLARATION"
  | "SOURCE_METADATA_OMITTED"
  | "DESCRIPTOR_MAPPING_FAILED"

interface SkillMetadata {
  readonly metadataKind: "nextagent.skill"
  readonly context: "inline" | "fork"
  readonly userInvocable: boolean
  readonly modelInvocable: boolean
  readonly agent?: AgentId
  readonly allowedTools?: readonly string[]
  readonly deniedTools?: readonly string[]
  readonly model?: string
  readonly modelOptions?: JsonObject
  readonly sourceMetadata?: Readonly<Record<string, string>>
}

interface SkillManifestDiagnostic {
  readonly reasonCode: SkillManifestDiagnosticReasonCode
  readonly severity: SkillManifestDiagnosticSeverity
  readonly outcome: SkillManifestValidationOutcome
  readonly message: string
  readonly providerId?: string
  readonly skillName?: string
}

interface CapabilityProvider {
  readonly providerId: string
  readonly providerKind: CapabilityProviderKind
  readonly providerType?: string
}

type CapabilityDiscoveryMode = "EAGER" | "SEARCH"

interface CapabilityProviderConfig {
  readonly provider: CapabilityProvider
  readonly discoveryMode: CapabilityDiscoveryMode
  readonly options: CapabilityProviderOptions
}

type CapabilityProviderOptions =
  | LocalDirectoryProviderOptions
  | SkillHubOptions
  | McpServerOptions
  | AgentRegistryOptions
  | CustomProviderOptions

interface LocalDirectoryProviderOptions {
  readonly directoryRef: string
}

interface SkillHubOptions {
  readonly endpoint: string
  readonly credentialRef?: SecretReference
  readonly managedInstallRef: string
}

interface McpServerOptions {
  readonly endpoint: string
  readonly credentialRef?: SecretReference
  readonly timeoutMs?: number
}

interface AgentRegistryOptions {
  readonly registryRef: string
  readonly credentialRef?: SecretReference
}

interface CustomProviderOptions {
  readonly customOptions: JsonObject
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
  readonly displayName: string
  readonly description: string
  readonly inputSchema?: JsonObject
  readonly outputSchema?: JsonObject
  readonly availabilityStatus: AvailabilityStatus
  readonly replayPolicy?: CapabilityReplayPolicy
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
  readonly maxRetries?: number
  readonly idempotencyKey?: IdempotencyKey
}

interface CapabilityGeneratedMessage {
  readonly role: "USER"
  readonly content: string
  readonly meta: boolean
}

interface CapabilityContextPatch {
  readonly allowedTools?: readonly string[]
  readonly deniedTools?: readonly string[]
  readonly discoveredSkills?: readonly string[]
  readonly modelId?: string
  readonly modelOptions?: ModelInferenceOptions
}

interface CapabilityInvocationResult {
  readonly status: CapabilityInvocationStatus
  readonly resultRef?: string
  readonly structuredPayload: JsonObject
  readonly generatedMessages: readonly CapabilityGeneratedMessage[]
  readonly contextPatch?: CapabilityContextPatch
  readonly artifactRefs: readonly ArtifactId[]
  readonly safeError?: SafeError
  readonly fallbackTriggered?: boolean
  readonly metadata?: JsonObject
}
```

`CapabilityDescriptor.outputSchema?` 描述成功 `CapabilityInvocationResult.structuredPayload` 的 JSON object 形态，不描述整个 invocation result envelope，也不约束 `safeError`、`generatedMessages`、`contextPatch`、`resultRef`、`artifactRefs` 或 result metadata。Tool framework 继续复用 `CapabilityProvider`、`CapabilityDescriptor`、`CapabilityInvocationRequest`、`CapabilityInvocationResult` 和 `CapabilityInvocationPort`，不得新增 public `ToolDescriptor`、`ToolInvocationRequest`、`ToolInvocationResult` 或 `ToolSource` 平行契约。

`RuntimeCapabilityResolver` 和 `SubagentExecutionPort` 是 capability-owned contract，因为 Agent tool 需要依赖这些抽象而不能依赖 runtime subpath。Runtime 实现可以提供这些 port 并由 app composition 注入。`SubagentExecutionRequest` 只接受 governed target Agent、prompt、parent run/session/request/tool-call coordinates、trusted identity、locale 和 idempotency key；不接受 owner override、workspace root、raw session record、model/provider credential 或 filesystem authority。`SubagentExecutionResult` 只返回 safe terminal status、terminal text、child session/run ids 和 safe error。

`CapabilityProvider.providerKind` 表达核心系统理解的 provider 大类；`providerId` 表达具体 provider 实例；`providerType` 仅在 `providerKind="CUSTOM"` 时必填，用于标识 app composition 显式注册的自定义 provider adapter。未注册的 custom provider 不得进入可执行 catalog。`CapabilityProvider` 不承载 Agent 绑定、scope、优先级、shadowing 或 agentId/agentVersion；这些语义由 Agent assembly、catalog governance 和 conflict resolution 处理。`CapabilityProviderConfig` 是 capability-owned provider 实例配置契约，使用 `{ provider, discoveryMode, options }` 形态，配置非 `BUNDLED` provider；`BUNDLED` provider 只能由 `agent-capability` 子系统可信创建。`options` 必须按 `provider.providerKind` 校验，`CUSTOM` 还必须按非空 `provider.providerType` 校验并使用 `CustomProviderOptions.customOptions`，不得用裸 `JsonObject` 作为 provider options union 分支。外部配置文件位置、层级合并、tenant/Agent override、secret resolver 和 hot reload 不属于核心 contract，本设计只冻结其归一化目标模型。

`version` 表达 capability 元数据或实现版本；provider 执行所需的内部 entry ref 不进入核心 descriptor，由 provider adapter 内部映射。`supportedLanguages` 缺省表示不限制语言。`CapabilityCompatibility` 是 capability descriptor 的静态兼容性元数据，用于描述 OS、CPU、可执行文件、环境变量、配置键、网络和 runtime tag 约束；`compatibility` 缺省语义为 unrestricted，`CapabilityCompatibility` 内字段缺省为空集合或 `networkRequired=false`。`metadata` 只承载 provider 提供的扩展描述信息，不得作为 runtime/core 决定可见性、授权、routing、availability 或 replay safety 的依据；如果某个 metadata key 被多个 provider 共同使用并影响行为，必须提升为显式核心字段或后续 change 定义的 typed extension。Skill descriptor 的 `metadata` 必须通过 `SkillMetadata` schema/accessor 校验后才可作为 Skill-specific 治理输入；unknown source metadata 只能保留在 `SkillMetadata.sourceMetadata`，不得直接驱动权限、routing、model selection、prompt shaping、sandbox、owner scope 或 availability。只有 `availabilityStatus="AVAILABLE"` 的 capability 可以进入模型可见列表和执行路径；`DISABLED` 表示被配置、Agent binding、治理策略或显式禁用列表关闭；`UNAVAILABLE` 表示非人为禁用但当前不可执行，包括缺配置、credential、路径、依赖、探活失败、descriptor 无效或 custom provider 未注册。`availabilityReason` 只能是安全 reason code 或 safe summary，不得包含 raw path、secret、provider response 或敏感配置；`metadata` 同样不得包含 secret、raw path、raw provider response、用户输入、模型输入/输出或认证凭据，且不得原样进入模型上下文或客户端输出。

`CapabilityInvocationRequest` 是 agent-capability 的执行领域对象，不是模型 tool_use DTO。`toolCallId` 仅用于保留模型工具调用或上游调用关联，非模型触发的 capability 调用可以省略。`arguments` 是按 capability `inputSchema` 校验后的执行参数。`requestId` 对齐当前用户请求的 root message id；`runId` 对齐当前 RequestRun。`identityContext` 必须由可信 runtime/channel boundary 注入，capability 不得从 `arguments` 读取 tenant、subject 或 owner。`workspaceDir` 和 full execution workspace view 不进入核心 invocation request；需要文件、Skill resource 或 sandbox access 的 capability/provider 通过 `ToolExecutionContext` 既有 trusted facts、resolver-backed file port 或 sandbox port 解析 accepted-run execution workspace view。`timeoutMs` 是每次 execution attempt 的完整预算；`maxRetries` 表示额外同参 retry 次数，有效域为 `0..5`、缺省为 `1`，非法值按 `0` 处理但仍执行初始 attempt。只有最终错误为 `UNAVAILABLE`/`TIMEOUT`、`safeError.retryable=true` 且 descriptor `replayPolicy=IDEMPOTENT` 时，统一执行边界才可在父 `AbortSignal` 未取消时重试。恢复场景下 runtime 必须在调用 capability 前根据 descriptor replay policy 和当前场景完成重放检查；不允许重放时不得调用 capability，允许重放时通过稳定 `idempotencyKey` 调用 capability，request 不携带 `recoveryReplay` 标志。

`CapabilityInvocationResult.structuredPayload` 承载 capability 产生的安全结构化结果，可投影为后续模型可见的 capability result content。`SUCCEEDED` 不得携带 `safeError`；`FAILED`、`TIMED_OUT` 必须携带 `safeError`；`DEGRADED` 只允许表达复合目标至少一个可独立使用子结果成功且至少一个声明子结果缺失或失败，并同时携带安全 payload 与 `safeError`。无可用结果的失败/超时使用空对象，只有显式声明的安全部分结果或恢复事实允许非空且必须通过 output schema。`fallbackTriggered` 只说明实际执行路径触发 fallback，与最终 status 正交。`resultRef` 指向完整结果或外部内容引用，用于结果过大或完整内容不适合内联时的 fallback/ref boundary；失败与成功共用 `256000` UTF-16 code unit 单结果容量，容量内诊断不得截断，超限必须返回显式容量失败并通过既有外置回读能力提供完整安全结果。`artifactRefs` 指向由 artifact gateway 管理的文件、生成输出或 Agent 结果附件 metadata。用户输入附件通过 `attachmentIds` 和 `RequestAttachment` 管理，只有被显式转化为输出产物时才进入 artifact metadata。`generatedMessages` 用于 inline Skill 等 capability 把受控 `USER` message 注入同一 request/run 后续模型上下文；`meta=true` 表示该消息对最终用户隐藏但仍可进入模型上下文。`contextPatch` 只表达当前 request/run 后续模型步骤的受控上下文补丁，允许收窄或指定 `allowedTools`、`modelId` 和 `modelOptions`；runtime/core 必须在应用前校验 patch 不越权扩大当前 Agent 已授权能力，且模型选择和模型参数必须经过 model selection/governance 校验。`contextPatch` 不得永久修改 Agent assembly、session 配置或 provider 配置。耗时、审计关联信息和持久化后的 result message id 由 runtime、wrapper、timeline、audit 或 gateway 层产生，不由 capability executor 返回。

`CapabilityInvocationResult.metadata` 中的顶层 `toolDiagnostics` 和 `sourceTrace` 是有界内部诊断 key，只供本地 canonical `toolOutput` 使用，不进入后续模型输入、durable `CAPABILITY_RESULT`、Web/stream/timeline、SafeError、audit、metric、trace 或 `ObservabilityObservationEvent`。通用 Capability result 模型投影边界以 exact top-level key 删除这两个 key，不递归扫描 `structuredPayload`、不解析 Tool 业务 payload、不按 capability id 或 Tool 名称建立例外，并保留其他已接受的安全 metadata。`metadata.sourceTrace` 由 memory owner 把 `get_memory_detail` 的 retained source 按 `longTermMemoryId` 关联写入，使本地 `toolOutput` 可一步定位来源；该 metadata 与 `structuredPayload` 一并计入公共单结果容量，不得通过移入 metadata 绕过容量约束。memory retained source、来源融合、Gateway storage 和授权 management 查询保持不变；会话分支的通用 source-run 引用检查不按 Tool 名称放行，canonical 新 `get_memory_detail` 结果因不再携带 source run ID 可安全复制，历史形态或人为携带源运行引用的消息仍在 composite write 前以 `SESSION_FORK_SOURCE_RUN_REF` 原子失败。

Agent 装配和路由对象如下：

```ts
interface AgentAssembly {
  readonly agentId: AgentId
  readonly agentType: AgentType
  readonly agentVersion: AgentVersion
  readonly agentAssemblyRef: string
  readonly displayName: string
  readonly description: string
  readonly workspacePolicy: AgentWorkspacePolicy
  readonly modelIds: readonly string[]
  readonly defaultModelId?: string
  readonly capabilityBindings: readonly AgentCapabilityBinding[]
  readonly userInvocable: boolean
  readonly agentInvocation: "NONE" | "BOUND" | "PARENT"
  readonly sourceKind?: "BUILTIN" | "LOCAL"
  readonly parentAgentScope?: {
    readonly agentId: AgentId
    readonly agentVersion: AgentVersion
    readonly agentAssemblyRef: string
  }
  readonly runtimeSettings: AgentRuntimeSettings
  readonly routing?: AgentRoutingConfig
}

type ExecutionIsolationMode = "subject" | "session"
type ExecutionWorkspaceRootKind = "workspace" | "systemResources" | "temp"
type ExecutionWorkspaceAccess = "read" | "readWrite"

interface AgentWorkspacePolicy {
  readonly schemaVersion: "nextagent.agent-workspace-policy.v1"
  readonly isolationMode: ExecutionIsolationMode
  readonly roots: readonly AgentWorkspaceRootPolicy[]
}

interface AgentWorkspaceRootPolicy {
  readonly kind: ExecutionWorkspaceRootKind
  readonly logicalPath: "workspace" | ".nextagent" | "temp"
  readonly access: ExecutionWorkspaceAccess
}

interface AgentCapabilityBinding {
  readonly capabilityId: CapabilityId
  readonly capabilityType: CapabilityKind
  readonly providerId: string
  readonly enabled?: boolean
}

interface AgentRuntimeSettings {
  readonly defaultLanguage?: string
  readonly maxTurns?: number
  readonly maxToolCallsPerTurn?: number
  readonly maxContextMessages?: number
  readonly requestTimeoutMs?: number
}

interface AgentAssemblyRegistry {
  active(agentId: AgentId): Promise<AgentAssembly>
  require(agentId: AgentId, agentVersion: AgentVersion): Promise<AgentAssembly>
}

type ExecutionDeploymentMode = "LOCAL" | "REMOTE"

interface ResolveExecutionWorkspaceInput {
  readonly runtimeWorkspaceRoot: string
  readonly workspacePolicy: AgentWorkspacePolicy
  readonly agentId: AgentId
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly sessionId?: SessionId
  readonly runId: RequestRunId
  readonly deploymentMode: ExecutionDeploymentMode
}

interface ExecutionWorkspaceRootView {
  readonly kind: ExecutionWorkspaceRootKind
  readonly logicalPath: "workspace" | ".nextagent" | "temp"
  readonly physicalPath: string
  readonly access: ExecutionWorkspaceAccess
}

interface ExecutionWorkspaceView {
  readonly workspaceDir: "workspace/"
  readonly defaultCwd: string
  readonly roots: readonly ExecutionWorkspaceRootView[]
}

interface ExecutionWorkspaceResolver {
  resolve(input: ResolveExecutionWorkspaceInput): ExecutionWorkspaceView
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

interface AgentRoutingConfig {
  readonly mode?: "default" | "policy"
  readonly policy?: {
    readonly method: "policy:intent-recognition"
  }
}

interface AgentRoutingPolicyInput {
  readonly run: RequestRun
  readonly context: RequestContext
  readonly agentAssembly: AgentAssembly
  readonly signal: AbortSignal
}

interface AgentRoutingPolicyResult {
  readonly decisionKind: Exclude<RoutingDecisionKind, "DIRECTED_CAPABILITY">
  readonly safeReason: string
  readonly skillName?: string
}
```

`AgentAssembly` 是 runtime-facing 已解析装配结果，不是 Agent definition、Agent package manifest、provider/source 配置或 discovery 中间态。Agent package、`agent.yaml`、`skills/`、`subagents/` 和 `prompts/` 是装配输入；provider discovery、scope priority、conflict resolution、disable/deny 和 capability availability 是装配过程；runtime-facing assembly 只保留执行期需要的 Agent identity、implementation selector、已校验 workspace policy、允许的 model ids、用户显式 capability binding facts、invocation visibility facts 和最小 runtime settings。`agentType` 是 runtime constructor selector，source `agent.yaml.agentType` 可省略并默认 `default`；它不表达业务身份、routing policy、model selection、capability binding 或 prompt/resource selection。`workspacePolicy` 声明 execution file access 的 schema version、isolation mode 和 logical root policies，不包含 physical execution roots、deployment mode、trusted identity、request/run facts、Skill source paths、provider-private loading facts 或 managed install paths。legacy package `workspaceDir` 可作为 source compatibility input 被 compiler 接受或拒绝，但不得进入 runtime-facing `AgentAssembly`，也不得决定 physical execution roots。prompt-facing `workspaceDir` 由 runtime resolver 派生为 logical `workspace/`；physical roots 只由 resolver-backed infrastructure 从 app-composed `runtimeWorkspaceRoot`、workspace policy 和 trusted accepted-run facts 派生。`capabilityBindings` 使用 `providerId` 对齐 capability provider identity；`enabled` 缺省或 `true` 表示显式启用，`enabled=false` 表示对同 key framework-default builtin capability 的显式禁用或对非默认 capability 的 exclusion-only override。`userInvocable`、`agentInvocation`、`sourceKind` 和 `parentAgentScope` 是 Agent discovery/delegation visibility facts，不携带 execution authority；实际可见性仍由 catalog governance 决定。deny、shadowing、source priority 和 provider 配置不进入 runtime-facing assembly。routing policy 配置可以由可信 Agent 配置源提供，但其 runtime-facing contract shape 由 `AgentRoutingConfig` 单独拥有，不内嵌为任意 routing hints 或 provider-private payload。hook declaration 和 Agent hook binding 由 hook contract 单独表达，不内嵌到 `AgentAssembly`。

`AgentAssemblyRegistry` 是 runtime-facing assembly lookup boundary，位于 `agent-contracts/agent-assembly`。`active(agentId)` 只用于 request acceptance 阶段解析当前 active Agent version；runtime 必须把解析后的 `agentId`、`agentVersion` 和 `agentAssemblyRef` 固化到 `RequestRun` 和 `RequestContext`。已接受请求、恢复、context engine、core 和 capability routing 必须用 `require(agentId, agentVersion)` 读取同一个已解析 assembly，不得重新按 active version 选择。registry 返回 `AgentAssembly`，不返回 Agent package 原始定义或 manifest。registry 由 app composition 在启动期 eager compile 后以内存形式提供；核心契约不定义 persistent assembly store、lazy compilation、hot reload、gray release 或 same-version snapshot id。缺失 assembly 必须作为明确的 missing assembly/not found 失败处理，不得 fallback 到默认 Agent。模块可以直接依赖 registry，也可以依赖由 registry 派生的 assembly-scoped wrapper，但不得自行解析 Agent package 或管理装配输入。

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

type BlobRecordPurpose =
  | "ATTACHMENT"
  | "ARTIFACT"
  | "CAPABILITY_RESULT"
  | "MODEL_SUMMARY"

interface OwnerScoped {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
}

interface IdempotentWriteOptions {
  readonly idempotencyKey?: IdempotencyKey
}

interface VersionedWriteOptions extends IdempotentWriteOptions {
  readonly expectedVersion?: number
}

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
  readonly kind: PendingInputKind
  readonly questions: readonly PendingInputQuestionRecord[]
  readonly timeoutAt?: EpochMillis
}

type PendingInputAnswerRecord = readonly (readonly string[])[]

interface RequestRunRecord extends OwnerScoped {
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

interface RunTimelineEventRecordBase extends OwnerScoped {
  readonly agentId: AgentId
  readonly agentVersion: AgentVersion
  readonly eventId: string
  readonly sessionId: SessionId
  readonly runId: RequestRunId
  readonly requestId: MessageId
  readonly sequence: TimelineSequence
  readonly type: TimelineEventType
  readonly inlinePayload: JsonObject
  readonly createdAt: EpochMillis
}

interface RuntimeRunTimelineEventRecord extends RunTimelineEventRecordBase {
  readonly recordOrigin?: never
  readonly requestContextId: RequestContextId
  readonly contentRef?: string
}

interface ForkSnapshotRunTimelineEventRecord extends RunTimelineEventRecordBase {
  readonly recordOrigin: "FORK_SNAPSHOT"
  readonly requestContextId?: never
  readonly contentRef?: never
}

type RunTimelineEventRecord = RuntimeRunTimelineEventRecord | ForkSnapshotRunTimelineEventRecord

type ForkProcessSnapshotStatus = "AVAILABLE" | "LEGACY_UNAVAILABLE"

interface ForkProcessSnapshotStatusRecord extends OwnerScoped {
  readonly agentId: AgentId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId: RequestRunId
  readonly status: ForkProcessSnapshotStatus
}

interface TerminalCommitRequest extends OwnerScoped {
  readonly runId: RequestRunId
  readonly expectedVersion: number
  readonly terminalStatus: Extract<RunStatus, "COMPLETED" | "FAILED" | "CANCELED" | "SUPERSEDED">
  readonly terminalMessage: SessionMessageRecord
  readonly terminalEvent: RunTimelineEventRecord
  readonly idempotencyKey: IdempotencyKey
}

type SessionTitleSource = "automatic" | "manual"

interface SessionRecord extends OwnerScoped {
  readonly agentId: AgentId
  readonly sessionId: SessionId
  readonly title?: string
  readonly titleSource?: SessionTitleSource
  readonly createdAt: EpochMillis
  readonly updatedAt: EpochMillis
}

interface SessionMessageRecord extends OwnerScoped {
  readonly agentId: AgentId
  readonly messageId: MessageId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId?: RequestRunId
  readonly role: SessionMessageRole
  readonly content: string
  readonly contentType: MessageContentType
  readonly metadata: JsonObject
  readonly visible: boolean
  readonly createdAt: EpochMillis
}

interface SessionHistoryRecordQuery extends OwnerScoped {
  readonly agentId: AgentId
  readonly offset: number
  readonly limit: number
  readonly questionSearchText?: string
  readonly createdAtFrom?: EpochMillis
  readonly createdAtTo?: EpochMillis
}

interface SessionHistoryEntry extends OwnerScoped {
  readonly agentId: AgentId
  readonly sessionId: SessionId
  readonly createdAt: EpochMillis
  readonly title?: string
  readonly updatedAt: EpochMillis
}

interface SessionHistoryPage {
  readonly entries: readonly SessionHistoryEntry[]
  readonly offset: number
  readonly limit: number
  readonly hasMore: boolean
}

interface SessionLookupRequest extends OwnerScoped {
  readonly agentId: AgentId
  readonly sessionId: SessionId
}

interface SessionMessageLookupRequest extends OwnerScoped {
  readonly agentId: AgentId
  readonly messageId: MessageId
}

interface ConversationPreviewRecordQuery extends OwnerScoped {
  readonly agentId: AgentId
  readonly sessionId: SessionId
  readonly offset?: number
  readonly limit: number
}

interface ConversationPreviewMarkerRecord {
  readonly messageId: MessageId
  readonly requestId?: MessageId
  readonly createdAt: EpochMillis
  readonly previewText: string
  readonly previewTruncated: boolean
  readonly answerPreviewText?: string
  readonly answerPreviewTruncated?: boolean
}

interface ConversationPreviewRecordPage {
  readonly sessionId: SessionId
  readonly totalMarkers: number
  readonly offset: number
  readonly limit: number
  readonly markers: readonly ConversationPreviewMarkerRecord[]
}

interface HideMessageRequest extends OwnerScoped {
  readonly agentId: AgentId
  readonly messageId: MessageId
  readonly reason: VisibilityReason
  readonly hiddenByContextId: RequestContextId
  readonly idempotencyKey: IdempotencyKey
}

interface ListSessionMessagesRecordQuery extends OwnerScoped {
  readonly agentId: AgentId
  readonly sessionId: SessionId
  readonly requestId?: MessageId
  readonly locale?: RequestLocale
  readonly includeHidden: boolean
  readonly includeCapabilityResults: boolean
  readonly beforeCursor?: string
  readonly afterCursor?: string
  readonly anchorMessageId?: MessageId
  readonly limit: number
}

interface ListCurrentRequestMessagesRecordQuery extends OwnerScoped {
  readonly agentId: AgentId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId: RequestRunId
  readonly includeHidden: boolean
  readonly offset: number
  readonly limit: number
}

interface SessionMessagePage {
  readonly items: readonly SessionMessage[]
  readonly limit: number
  readonly hasMore: boolean
  readonly nextBeforeCursor?: string
  readonly newerCursor?: string
}

interface SessionMessageRecordPage {
  readonly items: readonly SessionMessageRecord[]
  readonly limit: number
  readonly hasMore: boolean
  readonly nextBeforeCursor?: string
  readonly newerCursor?: string
}

interface ListCurrentRequestMessagesQuery {
  readonly identityContext: IdentityContext
  readonly agentId: AgentId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId: RequestRunId
  readonly includeHidden: boolean
  readonly offset: number
  readonly limit: number
}

interface ActiveContextStateRecord extends OwnerScoped {
  readonly agentId: AgentId
  readonly sessionId: SessionId
  readonly activeContextVersion: number
  readonly updatedAt: EpochMillis
}

interface ActiveContextItemRecord extends OwnerScoped {
  readonly agentId: AgentId
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
  readonly agentId: AgentId
  readonly runId: RequestRunId
}

interface ClaimRunRequest {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly agentId: AgentId
  readonly runId: RequestRunId
  readonly expectedVersion: number
  readonly lockedBy: string
  readonly lockExpiresAt: EpochMillis
}

interface AgentListRecoverableRunsRequest {
  readonly agentId: AgentId
  readonly now: EpochMillis
  readonly limit: number
}

interface RunTimelineEventRecordQuery extends OwnerScoped {
  readonly agentId: AgentId
  readonly sessionId: SessionId
  readonly afterSequence: TimelineSequence
  readonly requestId?: MessageId
  readonly runId?: RequestRunId
  readonly limit: number
  readonly recordOrigin?: "RUNTIME" | "FORK_SNAPSHOT"
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
  readonly mediaType: AttachmentMediaType
  readonly sizeBytes: number
  readonly storageRef: BlobRef
  readonly validationStatus: AttachmentValidationStatus
  readonly availabilityStatus: AttachmentAvailabilityStatus
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
  readonly validationStatus: AttachmentValidationStatus
  readonly availabilityStatus: AttachmentAvailabilityStatus
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
  listSessions(request: SessionHistoryRecordQuery): Promise<SessionHistoryPage>
  saveSession(record: SessionRecord, options?: IdempotentWriteOptions): Promise<SessionRecord>
}

interface SessionMessageStoreGateway {
  appendSessionMessage(record: SessionMessageRecord, options?: IdempotentWriteOptions): Promise<SessionMessageRecord>
  loadMessage(request: SessionMessageLookupRequest): Promise<SessionMessageRecord | undefined>
  listMessages(request: ListSessionMessagesRecordQuery): Promise<SessionMessageRecordPage>
  listCurrentRequestMessages(request: ListCurrentRequestMessagesRecordQuery): Promise<SessionMessageRecordPage>
  hideMessage(request: HideMessageRequest): Promise<SessionMessageRecord | undefined>
}

interface ActiveContextStoreGateway {
  loadActiveContext(request: ActiveContextLookupRequest): Promise<ActiveContextViewRecord | undefined>
  appendItem(request: AppendActiveContextItemRequest): Promise<VersionedUpdateResult<ActiveContextViewRecord>>
  commitCompaction(request: ContextCompactionCommitRequest): Promise<VersionedUpdateResult<ActiveContextViewRecord>>
}

interface RequestRunStoreGateway {
  saveRun(record: RequestRunRecord, options: VersionedWriteOptions): Promise<VersionedUpdateResult<RequestRunRecord>>
  loadRun(request: RequestRunLookupRequest): Promise<RequestRunRecord | undefined>
  claimRun(request: ClaimRunRequest): Promise<VersionedUpdateResult<RequestRunRecord>>
  listRecoverableRuns(request: AgentListRecoverableRunsRequest): Promise<readonly RequestRunRecord[]>
  commitTerminal(request: TerminalCommitRequest): Promise<TerminalCommitRecordResult>
}

interface RunTimelineEventStoreGateway {
  appendEvent(record: RunTimelineEventRecord, options?: IdempotentWriteOptions): Promise<RunTimelineEventRecord>
  listEvents(request: RunTimelineEventRecordQuery): Promise<readonly RunTimelineEventRecord[]>
}

interface AttachmentStoreGateway {
  saveAttachment(record: RequestAttachmentRecord): Promise<RequestAttachmentRecord>
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
  saveArtifactMetadata(record: ArtifactMetadataRecord): Promise<ArtifactMetadataRecord>
  loadArtifactMetadata(request: LoadArtifactMetadataRequest): Promise<ArtifactMetadataRecord | undefined>
}

interface PendingInputStoreGateway {
  createPendingInput(request: CreatePendingInputRecordRequest): Promise<PendingInputRecord>
  loadPendingInput(request: LoadPendingInputRecordRequest): Promise<PendingInputRecord | undefined>
  loadActivePendingInput(request: LoadActivePendingInputRecordRequest): Promise<PendingInputRecord | undefined>
  listUnresolvedPendingInputTimeoutFacts(request: AgentListUnresolvedPendingInputTimeoutFactsRequest): Promise<readonly PendingInputRecord[]>
  resolvePendingInput(request: ResolvePendingInputRecordRequest, options?: ResolvePendingInputRecordOptions): Promise<PendingInputResolveResult>
}

interface ConversationAnnotationStoreGateway {
  saveAnnotation(
    record: ConversationAnnotationRecord,
    options: { readonly idempotencyKey: IdempotencyKey }
  ): Promise<ConversationAnnotationRecord | undefined>
  deleteAnnotationsByRun(request: DeleteAnnotationsByRunRequest): Promise<void>
  listFavoriteSessions(request: ListFavoriteSessionsQuery): Promise<readonly ConversationFavoriteSessionSummary[]>
  listSessionAnnotations(request: ListSessionAnnotationsQuery): Promise<readonly ConversationAnnotationRecord[]>
}

interface QuestionRecommendationGateway {
  listFrequentHistoryQuestions(
    request: ListFrequentHistoryQuestionsRequest,
    signal?: AbortSignal
  ): Promise<ListFrequentHistoryQuestionsResult | SafeError>
  recommendSimilarPresetQuestions(
    request: RecommendSimilarPresetQuestionsRequest,
    signal?: AbortSignal
  ): Promise<RecommendSimilarPresetQuestionsResult | SafeError>
}
```

`loadActivePendingInput(...)` 只按 trusted Owner + Agent + Session scope 返回当前 active pending fact。`listUnresolvedPendingInputTimeoutFacts(...)` 只接受 trusted `agentId`、`limit` 和可选 `{ timeoutAt, pendingInputId }` keyset cursor；`limit` 固定校验为 `1..1000`，gateway 不接收 `now` 或 `dueBefore`，也不负责 clock、timer 或 timeout 决策。查询按 `(timeoutAt ASC, pendingInputId ASC)` 返回所有 future/due `PENDING` 与 owning RequestRun terminal commit 尚未完成的 `TIMED_OUT` fact；cursor 只服务一次有界扫描。旧的 due-only query 名称和 contract 必须删除，不得作为平行 API 保留。runtime 如何以该事实查询驱动 deadline scheduling 见 `pending-input-lifecycle.md`。

Gateway port 使用 `*Record` persistence DTO/PO 作为边界数据形态，不直接接收或返回 `RequestRun`、`SessionMessage`、`RunTimelineEvent`、`RequestAttachment`、`CheckpointPayload`、`PendingInput`、`ConversationAnnotationView` 等上层 DO/DTO。领域模块负责在调用 gateway port 前将 DO 投影为 Record，并在读取 Record 后重建 DO 或 read model；gateway adapter 只负责存取 Record，不解释领域状态机、latest-request policy、terminal commit 可见性、active context selection、annotation supersede policy 或 capability recovery 规则。Record 可以包含持久化边界需要的 owner scope、索引字段、版本字段和序列化时间字段；这些字段不得反向污染 DO 的最小领域形态。

Owner-scoped durable fact 的 logical gateway request/record 必须直接携带 `tenantId` 和 `subjectId`，主路径 session/message/active-context/timeline/run fact 还必须显式携带 `agentId`。Gateway 可复用中性 `OwnerScoped` 字段 contract，但 `*Record` 不得继承名为 `*Request` 的接口。系统恢复扫描等内部维护能力必须使用独立 system-scoped port，不得复用用户请求路径的 lookup contract。simple write 使用 `Record + write options`；query/filter、CAS transition 和 composite operation 可以使用专用 request object。普通持久化写入返回持久化后的 Record；只有 run version update、claim/fencing、pending input resolve 等 CAS 操作返回 `VersionedUpdateResult<TRecord>`。Terminal commit 有终态幂等语义，使用独立 `TerminalCommitRecordResult`。`VERSION_CONFLICT`、`NOT_FOUND` 和 `ALREADY_COMMITTED` 是预期控制分支；数据库不可用、序列化失败、连接超时或认证失败属于 gateway error，由 error normalizer 处理，不进入 CAS result vocabulary。`BlobStoreGateway` 只负责 opaque bytes lifecycle，不表达附件状态、artifact 可见性、session/run 绑定或内容解析结果；这些业务事实必须留在对应 metadata gateway 中。

`appendSessionMessage` 是最小内核 message write 的唯一 public gateway write 入口。SQLite gateway-local 必须在同一个 transaction 内完成 message anchor、session `updatedAt` 和 active context item 更新；runtime 不得拆成 standalone message write 后再 append active context。`hideMessage` 是 `SessionMessage` visibility 的唯一持久化变更入口；隐藏是单向操作，不提供 unhide。默认历史查询排除 hidden message，显式 `includeHidden=true` 才返回 hidden message。`visible=false` 只影响会话历史默认视图，不负责移除模型上下文；模型可见上下文由 active context view 控制。

`SessionMessage.metadata.modelVisibility` 是 `agent-contracts/session` 拥有的 additive typed extension（`ModelVisibilityMetadata = { excluded: boolean, reason: VisibilityReason }`），与 `visible` 字段解耦：`visible` 表达会话历史默认视图是否返回该消息（页面可见性），`metadata.modelVisibility.excluded` 表达 context assembly 是否应排除该消息（模型可见性）。一条 `visible=true` 且 `metadata.modelVisibility.excluded=true` 的消息会被 conversation 接口返回供页面渲染，但不进入后续轮次的 model context。该扩展不影响现有 `visible`、`replacement`、`visibility` 等 metadata 字段语义。典型用途是输入护栏拦截轮：Web channel 经 `RuntimeCommandPort.recordInputGuardBlock` 持久化一对 `visible=true` 的用户输入与拒答消息（共享 `requestId`、无 `runId`、`metadata.modelVisibility = { excluded: true, reason: "GUARD_BLOCKED" }`），使刷新/锚定/游标分页后该轮按真实时序可见，同时被 context assembly 排除。

`RuntimeCommandPort` 的两个 guard-related 可选方法构成对称的护栏持久化边界，均以 trusted owner/Agent/session scope 调用，identity 不接受客户端 metadata override，runtime 实现内部均经 `SessionMessageStoreGateway.appendSessionMessage` 或 `hideMessage` 写入，不新增 message role、stream event type、gateway port 或数据库表：

- `hideRunMessages` 隐藏已有 run 的 assistant 消息为 `visible=false`（`VisibilityReason="GUARD_BLOCKED"`），由 OUTPUT 护栏在终态提交前或提交后兜底调用，使该 run 的 assistant 终态不进入下一轮 model context 与默认会话历史。
- `recordInputGuardBlock` 记录无 run 的输入拦截轮：写入 `visible=true` 的用户输入与拒答消息对，`requestId` 由调用方生成、不关联 `runId`（无 run），由 `metadata.modelVisibility.excluded=true` 使 context assembly 排除。两者复用同一 `SessionMessageRecord`/`SessionMessageStoreGateway` 持久化面与 `VisibilityReason="GUARD_BLOCKED"` vocabulary，只是可见性与模型排除策略按 input-guard（页面可见、模型排除）与 output-guard（页面隐藏、模型排除）各自需要选择。

Session fork materialization 不走逐条 `appendSessionMessage`。Gateway contract 提供单一 fork composite write：在同一事务内创建或 replay child session idempotency anchor、写入 copied child messages、初始化 child active context state/items、保存 fork source metadata，并把同一 `forkAttemptId + childSessionId` 下匹配的 staged promotions 标记为 `COMMITTED`。Gateway-local 不读取宿主路径、不解析 source execution-bound ref、不决定 message projection 语义；runtime/session/context 必须在调用前提供已经校验和重写后的 records。`StageForkPromotionRequest` 只接收 owner+agent、forkAttempt、source/child 坐标、refType、bytes、mimeType 和 sizeBytes；`promotedContentId`、status、timestamp、`BlobRef` 和可见性字段由 gateway 生成或推进。失败路径中 runtime 必须同步调用 `abortForkPromotions`，cleanup job 只收敛 `STAGED`/`ABORTED` residue，永远不处理 `COMMITTED` promotion。

`idempotencyKey` 属于 command/write option 或 composite request，不进入 gateway `*Record`。SQLite gateway-local 可以把它作为锚点事实表列保存。session create、accepted run create、message append、timeline append 和 checkpoint save 通过各自事实表锚点保存 scoped `idempotency_key`；terminal commit 锚定 `request_runs.terminalCommitState` 和 version CAS。不增加领域外 `operationKind` 或 request hash conflict detection。

### 6. Checkpoint、pending input、hook、policy 和 sandbox 对象

Checkpoint payload 和 write contract 如下：

```ts
interface CheckpointPayload {
  readonly agentId: AgentId
  readonly checkpointId: CheckpointId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId: RequestRunId
  readonly requestContextId: RequestContextId
  readonly runVersion: number
  readonly triggerReason: CheckpointTriggerReason
  readonly lastSequence: TimelineSequence
  readonly activeContextVersion: number
  readonly flowVariables: JsonObject
  readonly savedAt: EpochMillis
  readonly idempotencyKey: IdempotencyKey
}

interface CheckpointRecord extends OwnerScoped {
  readonly agentId: AgentId
  readonly checkpointId: CheckpointId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId: RequestRunId
  readonly requestContextId: RequestContextId
  readonly runVersion: number
  readonly triggerReason: CheckpointTriggerReason
  readonly lastSequence: TimelineSequence
  readonly activeContextVersion: number
  readonly flowVariables: JsonObject
  readonly savedAt: EpochMillis
}

interface LoadCheckpointRequest extends OwnerScoped {
  readonly agentId: AgentId
  readonly sessionId: SessionId
  readonly requestId: MessageId
  readonly runId: RequestRunId
}

interface CheckpointStoreGateway {
  saveCheckpoint(record: CheckpointRecord, options: { readonly idempotencyKey: IdempotencyKey }): Promise<CheckpointRecord>
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
  readonly kind: PendingInputKind
  readonly request: PendingInputRequestRecord
  readonly timeoutAt?: EpochMillis
  readonly status: PendingInputStatus
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
  readonly expectedStatus: Extract<PendingInputStatus, "PENDING">
  readonly status: Exclude<PendingInputStatus, "PENDING">
  readonly answer?: PendingInputAnswerRecord
}
```

risk policy contract 继续收敛在既有 owning surface，而不是创建新的 policy namespace。跨边界共享 vocabulary `RiskPolicyOutcome`、`RiskLevel` 和 `RestrictedOperationKind` 归 `agent-common` owning；runtime-facing evaluator contract `RestrictedOperationSummary`、`RiskPolicyEvaluationInput`、`RiskPolicyDecision`、`RiskPolicyAuthorizationIntent` 和 `RiskPolicyEvaluator` 归 `agent-contracts/runtime` owning；authorization scope durable fact `AuthorizationScopeRecord` 与 `PendingInputRecord.authorizationScope?` 归 `agent-contracts/gateway` owning；结构化观测事实 `RiskPolicyEvaluation` 归 `agent-contracts/observability` owning。该最小 surface 允许 runtime、capability、sandbox 和 observability 复用同一 typed contract，而不修改 `CapabilityInvocationRequest`、`CapabilityInvocationResult`、`SandboxExecutionRequest`、`SandboxExecutionResult` 或新增 `agent-contracts/policy`。

`AuthorizationScopeRecord` 只表达当前 owner、当前 run 和目标受限操作绑定的服务端事实。它附着在 authorization pending input durable fact 上，不形成独立 authorization store，也不把客户端 answer 变成授权真相。runtime 只能从已绑定 scope 且 answer 匹配的 pending input 派生当前 run 内一次性执行许可；该许可不跨 run、跨 session 或长期持久化。

`RiskPolicyEvaluation` 只承载安全摘要、稳定 reason code、risk outcome 和 refs，可被日志、指标、audit sink 和安全 gate 消费，但不是 RequestRun、PendingInput、SessionMessage、Gateway Record 或用户可见 stream truth。它不得包含 raw prompt、raw model output、raw tool args/result、raw attachment content、raw secret、credential、本地路径、完整 sandbox request 或 provider raw response。`POLICY_APPLIED` 仍是 runtime canonical timeline 的 timeline-only evidence，不新增用户可见 stream event type。

Lifecycle hook contract 如下：

```ts
type HookFailureMode = "CONTINUE" | "FAIL"
type HookKind = "SYSTEM" | "CUSTOM"
type HookEffect = "OBSERVE" | "TRANSFORM" | "CONTROL"
type HookOutcome = "PASS" | "SKIP" | "DENY" | "BLOCK" | "PEND"
type HookExecutionStrategy = "OBSERVE_PARALLEL" | "SERIAL_IMPACT"
type HookInvocationStatus = "SUCCESS" | "TIMEOUT" | "FAILED"

interface LifecycleHook<TStages extends readonly LifecycleStage[] = readonly LifecycleStage[]> {
  readonly hookId: string
  readonly kind: HookKind
  readonly supportedStages: TStages
  readonly effects: readonly HookEffect[]
  readonly failureMode: HookFailureMode
  readonly order?: { readonly priority?: number; readonly before?: string | readonly string[]; readonly after?: string | readonly string[] }
  readonly timeoutMs?: number
  readonly configSchema?: unknown
  configure?(config: JsonObject): LifecycleHookExecutable<TStages>
  execute(input: HookInput<TStages[number]>, signal?: AbortSignal): Promise<HookResult<TStages[number]>>
}

interface LifecycleHookExecutable<TStages extends readonly LifecycleStage[] = readonly LifecycleStage[]> {
  execute(input: HookInput<TStages[number]>, signal?: AbortSignal): Promise<HookResult<TStages[number]>>
}

interface LifecycleHookDefinition {
  readonly hookId: string
  readonly kind: HookKind
  readonly supportedStages: readonly LifecycleStage[]
  readonly effects: readonly HookEffect[]
  readonly failureMode: HookFailureMode
  readonly order?: { readonly priority?: number }
}

interface AgentAssemblyHookEntry {
  readonly hookId: string
  readonly enabled?: boolean
  readonly disabled?: boolean
  readonly stages?: readonly LifecycleStage[]
  readonly order?: { readonly priority?: number; readonly before?: readonly string[]; readonly after?: readonly string[] }
  readonly timeoutMs?: number
  readonly config?: JsonObject
}

type HookBoundaryByStage = {
  readonly BEFORE_REQUEST_ACCEPT: RequestAcceptBoundary
  readonly BEFORE_PLANNING: PlanningBoundary
  readonly BEFORE_MODEL_INVOKE: ModelInvokeBoundary
  readonly AFTER_MODEL_RESULT: ModelResultBoundary
  readonly BEFORE_CAPABILITY_INVOKE: CapabilityInvokeBoundary
  readonly AFTER_CAPABILITY_RESULT: CapabilityResultBoundary
  readonly BEFORE_CONTEXT_COMPACT: ContextCompactBeforeBoundary
  readonly AFTER_CONTEXT_COMPACT: ContextCompactAfterBoundary
  readonly BEFORE_AGENT_TERMINAL: AgentTerminalBoundary
}

type HookMutationByStage = {
  readonly BEFORE_REQUEST_ACCEPT: never
  readonly BEFORE_PLANNING: PlanningMutation
  readonly BEFORE_MODEL_INVOKE: ModelInvokeMutation
  readonly AFTER_MODEL_RESULT: ModelResultMutation
  readonly BEFORE_CAPABILITY_INVOKE: CapabilityInvokeMutation
  readonly AFTER_CAPABILITY_RESULT: CapabilityResultMutation
  readonly BEFORE_CONTEXT_COMPACT: ContextCompactBeforeMutation
  readonly AFTER_CONTEXT_COMPACT: ContextCompactAfterMutation
  readonly BEFORE_AGENT_TERMINAL: AgentTerminalMutation
}

interface PlanningMutation {
  readonly kind: "planning"
  readonly flowVariables?: JsonObject
  readonly capabilityGeneratedMessages?: readonly CapabilityGeneratedMessage[]
  readonly capabilityContextPatch?: CapabilityContextPatch
}

interface ModelInvokeMutation {
  readonly kind: "model.invoke"
  readonly messages?: readonly ModelMessage[]
  readonly tools?: readonly ModelToolDescriptor[]
  readonly temperature?: number
  readonly maxOutputTokens?: number
  readonly topP?: number
  readonly topK?: number
  readonly presencePenalty?: number
  readonly frequencyPenalty?: number
  readonly thinking?: ThinkingOptions
  readonly toolChoice?: ToolChoice
  readonly providerOptions?: JsonObject
  readonly modelParams?: JsonObject
  readonly timeoutMs?: number
  readonly maxRetries?: number
}

interface ModelResultMutation {
  readonly kind: "model.result"
  readonly content?: string
  readonly reasoning?: string
  readonly toolCalls?: readonly ModelToolCall[]
}

interface CapabilityInvokeMutation {
  readonly kind: "capability.invoke"
  readonly arguments?: JsonObject
  readonly timeoutMs?: number
}

interface CapabilityResultMutation {
  readonly kind: "capability.result"
  readonly structuredPayload?: JsonObject
  readonly generatedMessages?: readonly CapabilityGeneratedMessage[]
  readonly contextPatch?: CapabilityContextPatch
}

interface ContextCompactBeforeMutation {
  readonly kind: "context.compact.before"
  readonly targetBudgetUnits?: number
}

interface ContextCompactAfterMutation {
  readonly kind: "context.compact.after"
  readonly content?: string
}

interface AgentTerminalMutation {
  readonly kind: "agent.terminal"
  readonly finalContent?: string
  readonly toolCalls?: readonly ModelToolCall[]
}

interface PendingInputIntent {
  readonly kind: PendingInputKind
  readonly questions: readonly PendingInputQuestion[]
  readonly timeoutAt?: EpochMillis
}

interface HookInput<S extends LifecycleStage = LifecycleStage> {
  readonly hookId: string
  readonly agentId: AgentId
  readonly agentVersion: AgentVersion
  readonly stage: S
  readonly boundary: HookBoundaryByStage[S]
  readonly idempotencyKey: IdempotencyKey
}

interface HookResult<S extends LifecycleStage = LifecycleStage> {
  readonly outcome: HookOutcome
  readonly pendingInputIntent?: PendingInputIntent
  readonly mutation?: HookMutationByStage[S]
  readonly safeReason?: string
  readonly error?: SafeError
}

interface LifecycleHookInvocationCoordinates {
  readonly sessionId?: SessionId
  readonly requestId?: MessageId
  readonly requestRunId?: RequestRunId
  readonly agentId: AgentId
  readonly agentVersion: AgentVersion
  readonly agentAssemblyRef: string
  readonly stageOccurrenceKey: string
}

interface LifecycleHookInvocationRequest<S extends LifecycleStage = LifecycleStage> {
  readonly stage: S
  readonly coordinates: LifecycleHookInvocationCoordinates
  readonly ownerScope: { readonly tenantId: TenantId; readonly subjectId: SubjectId }
  readonly boundary: HookBoundaryByStage[S]
}

interface LifecycleHookControlInterruption {
  readonly stage: LifecycleStage
  readonly hookInvocationId: string
  readonly outcome: Extract<HookOutcome, "DENY" | "BLOCK" | "PEND">
  readonly safeReason?: string
  readonly pendingInput?: PendingInputRequest
  readonly safeError?: SafeError
}

type LifecycleHookInvocationResult<S extends LifecycleStage = LifecycleStage> =
  | { readonly status: "CONTINUE"; readonly boundary: HookBoundaryByStage[S] }
  | { readonly status: "INTERRUPT"; readonly interruption: LifecycleHookControlInterruption }

interface LifecycleHookInvocationPort {
  invoke<S extends LifecycleStage>(
    request: LifecycleHookInvocationRequest<S>,
    signal?: AbortSignal
  ): Promise<LifecycleHookInvocationResult<S>>
}
```

Lifecycle hook 的 developer-facing object 和 Agent activation 分离。`LifecycleHook` / `defineLifecycleHook(...)` 描述 hook implementation object；`LifecycleHookDefinition` 是 app startup 从 canonical object 物化出的 runtime-safe 声明；`AgentAssembly.hooks` 中的 hook entry 描述某个 AgentAssembly 如何启用、关闭、收窄 stage、配置 timeout、配置 startup-only `config` 或约束 custom hook relative order。entry 不携带独立 `bindingId`、`agentId`、`agentVersion` 或 `agentAssemblyRef`，这些 scope fact 来自 accepted AgentAssembly 和 RequestRun。`CUSTOM` hook 只有当前 accepted AgentAssembly 显式 entry 才生效；`SYSTEM` hook 默认生效，但当前 Agent 可用 `enabled=false` 或 `disabled=true` 显式关闭。Agent activation entry 不得修改 `kind`、`effects`、`failureMode` 或 execution strategy。`SYSTEM` hook 必须 `failureMode=FAIL` 并由 framework order 固定；`CUSTOM` hook 可在同 stage custom group 内使用 `priority`、`before` 和 `after` 形成稳定拓扑顺序。

执行策略只从 `effects` 派生：只有 `OBSERVE` 的 hook 进入 `OBSERVE_PARALLEL` group；包含 `TRANSFORM` 或 `CONTROL` 的 hook 进入 `SERIAL_IMPACT` group。observe-only hook 获得 stage entry boundary 和 stable idempotency key，必须在 timeout 内 settle-or-timeout，失败或超时只形成观测降级，不改变 request truth、terminal commit、checkpoint、pending input、canonical timeline 或 effective boundary。impact hook 按 system group 再 custom group 顺序串行执行，`PASS` / `SKIP` 继续并可应用合法 mutation，`DENY` / `BLOCK` / `PEND` 中断当前 stage 后续 impact hook 和 protected operation；mutation 与中断型 outcome 同时出现时忽略 mutation 或 fail closed，具体按 stage contract 执行。`PEND` 只允许在明确支持的 stage 通过 runtime-owned pending input contract 创建 pending。

`HookInput<S>` 以 `stage` 作为 TypeScript discriminant，`boundary` 和 `mutation` 由 stage-indexed contract 收窄。`defineLifecycleHook(...)` 是 canonical authoring helper，保留 literal `supportedStages` 类型、推导 config 类型、触发启动期静态 shape 校验，并返回满足 `LifecycleHook` interface 的 hook implementation object。运行期 `HookInput` 不携带装配期 `config`；`configSchema` 只在 startup / AgentAssembly materialization 阶段校验，并通过 `configure(config)` 闭包为当前 AgentAssembly 的 configured executable；相同 `hookId` 被不同 AgentAssembly 使用不同 config 时，startup materialization 必须生成彼此隔离的 configured executable，runtime 按 accepted run 固化的 `agentAssemblyRef` 选择 executable。Boundary 是只读 runtime projection；hook code 对 enabled stage boundary 有进程内读取权限，但不能通过引用修改 stage owner 内部状态。Mutation 是 closed object，只允许 stage contract 列出的同名字段完整替换，不支持 JSON Patch、expression DSL、owner/agent override 或 runtime state mutation 字段。

Boundary 运行期不可变性通过 per-field finalization 策略保证，TypeScript `readonly` 不是唯一保护：

| 策略 | 用途 | 运行期要求 |
|---|---|---|
| immutable projection | 暴露 hook 需要读取的结构化字段 | 构造新的 projection object / array graph，不复用 owner-owned mutable reference |
| stable ref / digest / count / safe summary | hook 不需要完整内容、只需要识别或统计事实 | 只暴露不可反向读取 raw object 的 ref、digest、count 或 summary |
| structural sharing | 源对象已由 owner 声明为 immutable value | 共享对象不得被 owner 后续原地修改 |
| copy-on-write / lazy projection | 大字段需要避免立即全量复制 | hook 可见对象必须表现为 immutable；accepted replacement 仍必须 detach/canonical clone 后再应用 |

`BEFORE_MODEL_INVOKE` 是一个有意暴露完整 model request boundary 的例外：`ModelInvokeMutation.messages` 允许 hook 完整替换当前 `ModelInvocationRequest.messages`，该 stage 的 hook code 必须能够在内存中读取当前 effective `messages`，其中可能包含完整 prompt、对话历史、系统指令和 context assembly 结果。`HOOK_INVOKED`、mutation summary、logs、metrics、audit 和 safe diagnostics 的 redaction 规则仍然禁止输出 raw prompt / messages；但这些规则不限制被 startup-composed、当前 Agent 启用并执行到该 stage 的 hook implementation 在进程内访问 boundary 内容。

Runtime executor 提供单一通用 `reduceBoundaryMutation` 操作：mutation 中出现的同名字段完整替换 effective boundary 字段，未出现字段保持不变。hook 要表达追加、删除或过滤时，基于当前 boundary 计算并返回完整替换后的字段值。stage-specific 逻辑只负责 mutation schema、allowed fields 和字段安全 invariant validation。accepted mutation replacement 必须在应用前 canonicalize 到 owner-owned value（通过 schema parse、structured clone、field-specific projector 或 typed DTO constructor），后续 hook 对原 replacement object 的修改不得影响 applied effective boundary。

跨 stage 的间接影响只通过 stage owner 的正常执行链路自然传递。Runtime MUST NOT 维护跨 stage effective-boundary cache，MUST NOT 把前一 stage boundary 复制到后一 stage。stage owner 消费当前 stage 的 effective boundary 后，后续 stage boundary MUST 由该 owner 的真实执行结果重新构造。

Observe-only hook 的 `HookInput` 必须包含 stable idempotency key，格式为 `stageOccurrenceKey + ":" + hookId`。`stageOccurrenceKey` 由 stage owner 提供为 replay-stable coordinate，不得依赖恢复后会丢失的进程内自增计数：

| Stage | Replay-stable occurrence coordinate |
|---|---|
| `BEFORE_REQUEST_ACCEPT` | pre-acceptance submit idempotency key、channel request coordinate 或 runtime acceptance attempt id |
| `BEFORE_PLANNING` | planning step id + round index（来自 agent loop state / checkpoint） |
| `BEFORE_MODEL_INVOKE` | step id + round index + model invocation ordinal，或 provider invocation id |
| `AFTER_MODEL_RESULT` | same model invocation coordinate + result phase |
| `BEFORE_CAPABILITY_INVOKE` | `toolCallId` + `invocationId` 或可恢复 capability invocation ordinal |
| `AFTER_CAPABILITY_RESULT` | same capability invocation coordinate + result phase |
| `BEFORE_CONTEXT_COMPACT` | compaction operation id、summary idempotency key 或 context compaction idempotency coordinate + before phase |
| `AFTER_CONTEXT_COMPACT` | same real compaction coordinate + after phase |
| `BEFORE_AGENT_TERMINAL` | step id + terminal attempt coordinate；hook 返回 toolCalls 后继续 loop，后续 normal-exit attempt 必须使用新 occurrence |

`HOOK_INVOKED` 是 runtime 生成的 timeline-only hook invocation evidence。首版必须输出结构化日志和 hook 指标，可以发送到 audit sink，但不得提供 hook invocation 查询 API，也不得把完整 boundary、mutation、hook input、hook result、模型消息、工具参数、工具结果、附件内容或 secret 写入 event。`mutationSummary` 由 runtime 生成：无 mutation 时不填；有 mutation 时记录具体 mutation 类型或稳定 mutation kind，以及被修改的字段名，不记录字段值，例如 `ModelRequestMutation{appendMessages,modelOptionsPatch,restrictedToolIds}`。

每次 hook invocation 都写入 timeline-only `HOOK_INVOKED`。`DENY` / `BLOCK` / `PEND` 等改变 request lifecycle 的 hook outcome 也记录在同一条 `HOOK_INVOKED.outcome` 中，不再发布单独的 `HOOK_OUTCOME_APPLIED` event。risk policy 执行结果如需形成执行事实，写入 timeline-only `POLICY_APPLIED`。`HOOK_INVOKED` 和 `POLICY_APPLIED` 不进入首版 `StreamEventType`；channel 默认不向用户对话流投影这类事件。hook timeout/failed 如果未改变主流程，只通过 `HOOK_INVOKED`、结构化日志、指标或 audit sink 表达。

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
  readonly filesystem: SandboxFilesystemLayout
  readonly environment: JsonObject
  readonly timeoutMs: number
  readonly stdoutLimitBytes: number
  readonly stderrLimitBytes: number
}

interface SandboxFilesystemLayout {
  readonly defaultCwd: string
  readonly roots: readonly SandboxFilesystemRoot[]
}

interface SandboxFilesystemRoot {
  readonly kind: "workspace" | "systemResources" | "temp"
  readonly logicalPath: "workspace" | ".nextagent" | "temp"
  readonly physicalPath: string
  readonly access: "read" | "readWrite"
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

type ScheduledMaintenanceOverlapPolicy = "SKIP_IF_RUNNING" | "ALLOW_CONCURRENT"

interface ScheduledMaintenanceJob {
  readonly jobId: string
  readonly cadenceMs?: number
  readonly retentionMs?: number
  readonly overlapPolicy: ScheduledMaintenanceOverlapPolicy
  run(signal: AbortSignal, now: EpochMillis): Promise<void>
}

interface ScheduledMaintenanceGatewayPort {
  register(job: ScheduledMaintenanceJob): Promise<void>
}
```

Sandbox gateway request 只携带 adapter 需要的 execution filesystem layout。Gateway adapter 从 `filesystem.defaultCwd` 和 `filesystem.roots[]` 派生 sandbox target paths、cwd 和标准 temp env；request 不携带 `AgentWorkspacePolicy`、`ExecutionWorkspaceResolver`、完整 `ExecutionWorkspaceView`、trusted identity facts、Skill source loading facts 或 authorization decisions。Capability-owned scheduled maintenance jobs 只通过 job identity、cadence/retention hints、overlap policy 和 `run(signal, now)` 注册；gateway adapter 负责 deployment-mode-specific scheduling/execution，不解释 Skill identity、cleanup candidate 或 execution workspace authorization。

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
  readonly agentId?: AgentId
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

interface ModelProviderProfile {
  readonly providerId: ModelProviderId
  readonly baseUrl?: string
  readonly credentialRef?: SecretReference
  readonly models: readonly ModelProfile[]
}

interface ModelProfile extends ModelInferenceOptions {
  readonly modelId: string
  readonly displayName?: string
  readonly contextWindowTokens?: number
  readonly fallbackEligible: boolean
  readonly timeoutMs?: number
  readonly maxRetries?: number
}

interface ConversationAnnotationView {
  readonly annotationId: string
  readonly sessionId: SessionId
  readonly requestRunId: RequestRunId
  readonly sentiment: "UP" | "DOWN" | null
  readonly isFavorited: boolean
  readonly comment: string | null
  readonly createdAt: EpochMillis
}

interface ConversationFavoriteSessionEntry {
  readonly sessionId: SessionId
  readonly favoriteCount: number
  readonly sessionTitle?: string
  readonly sessionUpdatedAt: EpochMillis
}

interface ConversationFavoriteSessionPage {
  readonly entries: readonly ConversationFavoriteSessionEntry[]
  readonly offset: number
  readonly limit: number
  readonly hasMore: boolean
}

interface RuntimeUpsertAnnotationCommand {
  readonly identityContext: IdentityContext
  readonly sessionId: SessionId
  readonly requestRunId: RequestRunId
  readonly sentiment?: "UP" | "DOWN" | null
  readonly isFavorited?: boolean
  readonly comment?: string | null
  readonly idempotencyKey: IdempotencyKey
}

interface RuntimeListFavoriteSessionsQuery {
  readonly identityContext: IdentityContext
  readonly offset: number
  readonly limit: number
}

interface RuntimeListSessionAnnotationsQuery {
  readonly identityContext: IdentityContext
  readonly sessionId: SessionId
}

interface RuntimeConversationAnnotationPort {
  upsertAnnotation(command: RuntimeUpsertAnnotationCommand): Promise<ConversationAnnotationView | undefined>
  listFavoriteSessions(query: RuntimeListFavoriteSessionsQuery): Promise<ConversationFavoriteSessionPage>
  listSessionAnnotations(query: RuntimeListSessionAnnotationsQuery): Promise<readonly ConversationAnnotationView[]>
}

interface ConversationAnnotationRecord extends OwnerScoped {
  readonly agentId: AgentId
  readonly annotationId: string
  readonly sessionId: SessionId
  readonly requestRunId: RequestRunId
  readonly sentiment: "UP" | "DOWN" | null
  readonly isFavorited: boolean
  readonly isQuestionFavorited?: boolean
  readonly comment: string | null
  readonly createdAt: EpochMillis
  readonly updatedAt: EpochMillis
}

interface DeleteAnnotationsByRunRequest extends OwnerScoped {
  readonly agentId: AgentId
  readonly requestRunId: RequestRunId
}

interface ListFavoriteSessionsQuery extends OwnerScoped {
  readonly agentId: AgentId
  readonly offset: number
  readonly limit: number
}

interface ConversationFavoriteSessionSummary {
  readonly sessionId: SessionId
  readonly favoriteCount: number
}

interface ListSessionAnnotationsQuery extends OwnerScoped {
  readonly agentId: AgentId
  readonly sessionId: SessionId
}
```

Capability replay/idempotency 的长期基线固定为一条最小规则：`CapabilityReplayPolicy` 是唯一跨 runtime、assembly、capability provider 和 recovery guard 共享的可重放声明；Tool 默认 `NON_IDEMPOTENT`，只有显式 `IDEMPOTENT` 时 runtime/recovery 才允许把同一调用视为可安全重放。允许重放时，runtime 使用稳定 `CapabilityInvocationRequest.idempotencyKey` 传递 replay anchor；provider 负责在同一 key 下避免第二次不可逆 side effect。`CapabilityInvocationRequest` 不引入 `recoveryReplay`、`isIdempotent`、独立 validator SPI、通用 cache contract 或全局 duplicate store，避免在核心契约中形成第二套重复判断语义。

Capability catalog 继续拥有 request-scope governed view。`CapabilityCatalog.listAvailable()` 和 `resolve()` 必须共享同一冲突裁决结果：同一 provider scope 中无法证明为 stable duplicate 的同名 candidate 必须整体拒绝；跨 scope 同名 candidate 必须按 governed priority 产生唯一 visible winner，其余 candidate 进入 shadowed/rejected 诊断，而不是把多个候选同时暴露给 model-visible catalog 或 invocation path。冲突诊断只允许 stable business identifiers、provider kind、priority 和 safe reason code，不得泄漏 raw path、manifest、Skill body 或 source loading detail。

`AuditEvent.agentId` 是 audit envelope 的 stable Agent Scope 扩展位。它保持 optional，以兼容未来非 run 上下文的 system audit；但任何 run-bound runtime lifecycle、capability lifecycle 或 request terminal audit，都必须从已固化 `RequestRun.agentId` 透传 `agentId`，不得从默认 Agent、全局配置、客户端 metadata、模型输出或 capability 参数补值。audit sink、writer 和 query 能力继续留在 observability implementation boundary，不进入 `agent-contracts`。

Session history and conversation contracts use internal read-model fields. Public Web DTO aliases such as `displayTitle`, `lastActivityAt`, `q`, `createdFrom`, `createdTo`, `cursor` and `nextCursor` are channel projection names and do not enter `agent-session` or gateway contracts. Session list records expose `title?` and `updatedAt`; the Web channel projects them to public labels and may apply a safe default title. Session list search uses canonical `questionSearchText?`, `createdAtFrom?` and `createdAtTo?` after Web validation, remains scoped to session title plus visible USER message text, and does not define conversation search, snippet, highlight or rank semantics. Conversation history uses `beforeCursor?` for loading older messages and `afterCursor?` for loading newer messages; stores return `nextBeforeCursor?` and `newerCursor?`, while the Web channel maps public older `cursor`/`nextCursor` and public `newerCursor` to the internal cursor fields. `beforeCursor`/`afterCursor`/`anchorMessageId` are mutually exclusive, and anchor reads must return one continuous visible segment or fail closed. Current-session conversation preview is a separate paged marker read model over visible USER messages, returns `totalMarkers`, `offset`, `limit` and `markers[]`, and may include bounded same-request visible ASSISTANT answer preview; it must not expose search match semantics, hidden/tool/Capability-result content, `windowMode` or `anchor` response fields. Minimal session list records do not carry run-summary or preview fields such as last message preview, last request status or in-flight status; those are separate read-model extensions.

Fork notice is a narrow session conversation read-model extension. `forkNotice` contains only `sourceSessionId` and source title snapshot, is derived from server-side fork source metadata plus child conversation state, and is projected only for default/latest child conversation reads before the first child user message after the fork boundary. It is not a message, not an active context item, not a source availability check, and not returned for cursor/newer/anchor conversation reads. Internal fork source metadata such as source anchor, child anchor, idempotency key, timeline, checkpoint, run or promotion fields must not enter the public DTO.

### 8. 核心调用 port 汇总

核心跨模块调用只能通过以下 port 或后续 change 对这些 port 的显式 refinement 发生：

```ts
interface RuntimeCommandPort {
  submit(command: SubmitRequestCommand): Promise<RequestAccepted>
  cancel(command: RequestControlCommand): Promise<RequestControlAccepted>
  retryLatest(command: RequestControlCommand): Promise<RequestAccepted>
  editLatest(command: EditLatestRequestCommand): Promise<RequestAccepted>
  answerPendingInput(command: AnswerPendingInputCommand): Promise<PendingInputAnswerAccepted>
  hideRunMessages?(command: HideRunMessagesCommand): Promise<void>
  recordInputGuardBlock?(command: RecordInputGuardBlockCommand): Promise<void>
}

interface HideRunMessagesCommand {
  readonly identityContext: IdentityContext
  readonly agentId: AgentId
  readonly sessionId: SessionId
  readonly runId: RequestRunId
  readonly reason: VisibilityReason
  readonly hiddenByContextId?: RequestContextId
  readonly idempotencyKey: IdempotencyKey
}

interface RecordInputGuardBlockCommand {
  readonly identityContext: IdentityContext
  readonly agentId: AgentId
  readonly sessionId: SessionId
  readonly inputText: string
  readonly refusalMessage: string
  readonly requestId: MessageId
  readonly idempotencyKey: IdempotencyKey
}

interface Agent {
  execute(run: RequestRun, context: RequestContext, signal: AbortSignal): Promise<void>
}

interface AgentConstructor<TKit extends object = object> {
  new (kit: TKit): Agent
  getType(): AgentType
}

interface AgentRunStatePort {
  emitEvent(run: RequestRun, context: RequestContext, event: RunTimelineEvent): Promise<void>
  appendMessage(run: RequestRun, context: RequestContext, draft: SessionMessageDraft): Promise<MessageId>
  saveCheckpoint(run: RequestRun, context: RequestContext, triggerReason: CheckpointTriggerReason): Promise<void>
}

interface RunTimelineEventPort {
  emit(event: RunTimelineEvent): Promise<void>
}

interface RunMessagePort {
  appendMessage(run: RequestRun, context: RequestContext, draft: SessionMessageDraft): Promise<MessageId>
}

interface RuntimeSessionPort {
  streamEvents(query: RuntimeSessionStreamEventsQuery): AsyncIterable<RunTimelineEvent>
  listEvents(query: RuntimeListSessionEventsQuery): Promise<RuntimeSessionEventHistoryPage>
  getActiveRun(query: RuntimeGetActiveRunQuery): Promise<RuntimeActiveRunSummary | undefined>
}

interface ContextEnginePort {
  assemble(request: ContextAssemblyRequest): Promise<ContextAssembly>
  render(assembly: ContextAssembly): Promise<RenderedModelInput>
}

interface ModelInvocationService {
  complete(request: ModelInvocationRequest, signal: AbortSignal): Promise<ModelFinalResult>
  stream(request: ModelInvocationRequest, signal: AbortSignal, onDelta: (delta: ModelStreamDelta) => Promise<void>): Promise<ModelFinalResult>
}

interface CapabilityCatalog {
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
- 跨模块架构：`openspec/designs/architecture/runtime-boundaries.md`、`owner-scope-security.md` 和 `observability-boundaries.md`。
- RequestRun 生命周期和领域不变量：`openspec/designs/architecture/request-run.md`。
- API/SPI/event/schema：`openspec/designs/architecture/core-contracts.md`。
- 模块职责：`openspec/designs/modules/agent-contracts.md`。
- ADR：当前不单独新增 ADR；若后续需要保留“契约先行”作为长期技术决策，可新增 ADR。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [风险] 核心契约覆盖面较大，容易把后续配件细节提前固化。 -> 只提升已归档最小内核和跨模块稳定事实；WebSocket、SkillHub/remote Skill source installation、完整附件、长期记忆、远端 gateway、sandbox runtime、完整 cancel/retry/edit 和多实例 recovery 仍通过后续 change 定义。
- [风险] contract 太薄会导致最小内核实现时再次发散。 -> 对 runtime truth、`tenantId`/`subjectId` 归属语义、event vocabulary、gateway concurrency 和 capability kind 采用明确 enum/port，不留关键语义空白。
- [风险] no-op 被误用为真实能力。 -> spec 和 tasks 明确 no-op 只能用于一层直接依赖，后续真实 provider 替换不得改变主流程调用语义。
- [取舍] 先建立 `agent-contracts` 会增加一个前置 change。 -> 该前置能让 Web、runtime、context、capability、gateway 和 observability 团队并行推进，减少主流程返工。

## 发布计划（Release Plan）

无运行中系统升级或数据转换。当前核心契约基线建立新的 TS 核心契约；后续实现 change 必须依赖本契约，而不是在实现包中重新定义跨模块对象。

## Capability 失败处置主设计

本页冻结公共形状及字段语义；`CapabilityInvocationResult` 状态不变量、`maxRetries`、`ToolChoice` precedence、`maxTurns/maxToolCallsPerTurn` 和 `agentTurnIndex` 如何形成一条端到端执行路径，由 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md` 说明。公共字段增删或默认值变化必须同步更新该主设计、stable specs、Function 规格项及 contract tests。
