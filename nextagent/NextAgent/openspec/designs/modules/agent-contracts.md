# agent-contracts

## 职责

按 owning boundary 提供稳定 public subpath exports：agent-assembly、runtime、channel、session、attachment、context、model、capability、core、gateway、observability、app。

`agent-contracts` 是核心契约唯一 public namespace。它承载 runtime command、RequestRun、timeline、Request Execution Stream、Session Activity Projection、runtime-safe agent assembly facts、context assembly、model invocation、capability descriptor/provider config/catalog/invocation、Skill typed metadata/manifest diagnostics、gateway logical ports、sandbox gateway、audit/error normalization 和 app-facing model profile contracts。

## 非职责

不依赖实现包、adapter-private DTO、数据库 schema、provider SDK 类型或本地路径布局；不为 reserved alias 或概念分类新增 owning subpath。

不 owning shared id、基础 value object、identity context、locale/language value、secret reference、safe error shape、RunStatus、TerminalCommitState、TimelineEventType、CheckpointTriggerReason、SessionMessageRole、MessageContentType、VisibilityReason、AttachmentMediaType/status、PendingInputKind/status、CapabilityKind、CapabilityProviderKind、CapabilityReplayPolicy 或 CapabilityInvocationStatus；这些 foundation contracts 由 `agent-common` owning。

## 依赖

允许依赖 `agent-common`。不得依赖 implementation packages。

## 核心设计落点

- `agent-contracts/model` owning provider-neutral `ToolChoice = 'AUTO' | 'NONE' | 'REQUIRED'` 和 `ModelInferenceOptions.toolChoice`；Prompt、Skill、request 与 Hook 只能复用该字段，不得定义 named-tool object 或 provider-private平行词汇。
- `agent-contracts/capability` owning `CapabilityInvocationRequest.maxRetries?`、严格 `CapabilityInvocationResult` status/`safeError` 组合和 `fallbackTriggered?`；重试算法、结果 normalization 和容量 guard 留在 `agent-capability`。
- `agent-contracts/agent-assembly` owning `AgentRuntimeSettings.maxTurns?` 与 `maxToolCallsPerTurn?`；不存在 `maxToolIterations` alias。`agent-contracts/runtime` owning不含 Tool-call 数量预算的 `RoutingConstraints`、受治理 `RequestModelOptions.toolChoice?`，以及 `RequestContext`/`CheckpointPayload` 共用的 `agentTurnIndex`。
- Hook contract 的 `BEFORE_MODEL_INVOKE` mutation 复用 `ModelInferenceOptions.toolChoice`；`BEFORE_PLANNING` 不拥有 `maxRounds`、`maxCalls`、`maxTurns` 或 `maxToolCallsPerTurn` mutation authority。

- `agent-contracts/gateway` 是 `AuditEventRecord` 与 top-level `AuditEventStoreGateway` 的唯一 owner；port 只暴露 `appendAuditEvent(record): Promise<void>`。不得恢复 audit query、`SqliteGatewayStoreBindings.audit`、SQLite audit schema或平行 audit contract package。
- OTel SDK/exporter、operational envelope、local file policy和 metric raw history都不得进入 contracts。

- 落实 `architecture/core-contracts.md` 的唯一 public contract namespace 和 owning subpath export。
- 每个 public contract 只能有一个 owning export surface；root aggregate 不能成为产品代码依赖入口。
- `agent-contracts/capability` owning `CapabilityCatalog`、`CapabilityProviderConfig`、`CapabilityDiscoveryMode` 和 provider option DTO/schema；`agent-contracts/app` 不定义同名 provider config DTO。
- `agent-contracts/capability` owning `CapabilityDescriptor.description`、`CapabilityDescriptor.outputSchema`、`SkillMetadata` 和 `SkillManifestDiagnostic` public schema/type；`outputSchema` 只描述成功 `CapabilityInvocationResult.structuredPayload`，不定义 Tool-specific public descriptor/invocation/result envelope。Skill parser-only frontmatter DTO 和 diagnostic production implementation 留在 `agent-capability`。
- `agent-contracts/runtime` owning request-carried `RoutingConstraints`、`SubmitRequestCommand.routingConstraints` 和 `RequestContext.routingConstraints`；`agent-contracts/core` 只保留 frozen routing decision vocabulary，routing configuration/policy input/policy result 的最小 contract shape 由既有 owning surface 统一定义，不新增 `agent-contracts/routing` subpath。
- `agent-contracts/runtime` owning owner/Agent/session/run-scoped `RuntimeSessionPort.listEvents` query、`AVAILABLE | LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE` runtime-safe page，以及 server-only `resolveProcessMessages` query/result；resolver 返回 `SessionMessage` 领域对象，不引入 gateway Record 或 browser DTO。`agent-contracts/gateway` owning `RunTimelineEventRecord.recordOrigin`、fork snapshot status 和 timeline/fork composite persistence shapes；`agent-contracts/channel` owning public `StreamEnvelope`。Thinking 继续使用 `agent-common` 的 `LLM_THINKING_DELTA` vocabulary，不新增 message role、segment event 或平行 event-history contract subpath。
- Session Activity 保持既有 subpath ownership：`agent-contracts/session` owning `SessionActivityStatus`、strict `SessionActivityEntry` / `SessionActivityMessage`、session coordinates/query/consume command 和 `SessionActivityPort`；`agent-contracts/runtime` owning app/channel facade 的 `RuntimeStreamSessionActivitiesQuery`、`RuntimeConsumeSessionActivityCommand` 和 `RuntimeSessionActivityPort`。`agent-contracts/channel` 不 owning Activity DTO；Activity 不使用 `StreamEnvelope`、execution event vocabulary、timeline cursor 或 request/run filter。
- `agent-contracts/runtime` 还 owning risk policy evaluator contracts：`RestrictedOperationSummary`、`RiskPolicyEvaluationInput`、`RiskPolicyDecision`、`RiskPolicyAuthorizationIntent` 和 `RiskPolicyEvaluator`；`agent-contracts/gateway` owning `AuthorizationScopeRecord` 与 `PendingInputRecord.authorizationScope?`；`agent-contracts/observability` owning `RiskPolicyEvaluation`。系统不得新增 `agent-contracts/policy`、通用 `PolicyPort`、独立 authorization store 或用户可见 `POLICY_APPLIED` stream contract。
- pending input refinement 继续停留在既有 owning surface：`agent-contracts/runtime` owning `answerPendingInput` command、question/confirmation/authorization/handoff answer DTO 和 timeout-facing lifecycle contract；`agent-contracts/gateway` owning `PendingInputRecord`、authorization scope、answer resolve CAS result、`LoadActivePendingInputRecordRequest`、`PendingInputTimeoutFactCursor` 和 `AgentListUnresolvedPendingInputTimeoutFactsRequest`。unresolved query 只接受 trusted `agentId`、`limit=1..1000` 和可选完整 `(timeoutAt, pendingInputId)` keyset，返回 future/due `PENDING` 与 terminal 未提交的 `TIMED_OUT`，不接收当前时间、不决定 due，并且不得保留旧全局 due query 或语义重叠 alias。系统不得为 AskUserQuestion、handoff 或 timeout 引入新的 `agent-contracts/pending-input` subpath。
- Gateway contract 使用 gateway-owned `*Record` persistence DTO，不依赖上层领域 DO 或 sibling business subpath 来复用 vocabulary。
- `agent-contracts/gateway` owns long-term memory、task trajectory 和 conversation annotation persistence DTOs and ports：`LongTermMemoryRecord` / `LongTermMemoryStoreGateway` / `LongTermMemoryRetrieverGateway`、`TaskTrajectoryRecord` / `TaskTrajectoryStoreGateway` / `TaskTrajectoryQueryGateway`，以及 `ConversationAnnotationRecord` / `ConversationAnnotationStoreGateway`。这些 contracts 引用 `agent-common` 的 durable scalar vocabulary，并显式携带 `OwnerScoped` + `agentId`；不得新增 `agent-contracts/memory` 或让 gateway contract 依赖 `agent-memory`、session/runtime/context subpath 来复用字段。
- `agent-contracts/channel` owns `LongTermMemoryManagementPort`、`LongTermMemoryManagementScope`、batch create item/command/result 和 `batchCreateLongTermMemory` operation；port 精确定义 13 个 management operation，不增加 count/batch delete 等别名。`LongTermMemoryManagementScope` 由完整 `IdentityContext` 和独立 `agentId` 组成，只来自 trusted channel/auth boundary 与 app composition/hosted-Agent selection；batch item 不出现 owner 或 Agent 字段。`agent-contracts/gateway` owns 对应的 batch create gateway method，复用 `saveLongTermMemory` 的 scoped anchor 和 write options；Channel contract 不依赖 Gateway contract。
- `agent-contracts/gateway` 还唯一 owning `QuestionRecommendationGateway`、两组 canonical request/result/item 和四个 runtime JSON schema。该 gateway 只通过可选的 `WorkingMemoryGatewayBindings.questionRecommendations` 暴露，提供有界、可取消的历史高频问题与预置相似问题查询；不得增加顶层 binding、专用 adapter kind、SQLite recommendation binding 或 provider wire DTO。缺少 binding 时能力不可用，不得回退到 Pin、用户问题活动、高频问题或问题联想 persistence contract。`SafeError` 只允许 `QUESTION_RECOMMENDATION_INVALID_INPUT`、`QUESTION_RECOMMENDATION_CANCELED`、`QUESTION_RECOMMENDATION_UNAVAILABLE` 和 `QUESTION_RECOMMENDATION_INVALID_PROVIDER_RESULT`，不得携带 query、推荐内容、provider raw error、URL 或 credential。
- `ConversationAnnotationRecord.isQuestionFavorited?` 表示用户问题收藏，与回答/turn 收藏 `isFavorited` 独立。`undefined` 只在 partial upsert 输入中表示不修改；持久化读取必须投影显式布尔值。两个 favorite 字段仍锚定同一个 owner+agent scoped request-run annotation fact，不新增 `QuestionFavoriteRecord`、独立 store 或专用写入 port。
- `agent-contracts/gateway` owns conversation share persistence DTOs and ports：`ConversationShareRecord` / `ConversationShareStoreGateway` / `LoadShareRequest` / `DeleteSharesBySessionRequest`。`ConversationShareRecord` extends `OwnerScoped` 并携带 `agentId`，不含 `idempotencyKey`；`loadShare` 不带 owner scope（`shareId` 是全局唯一凭证），`deleteSharesBySession` 带 scope。
- `agent-contracts/runtime` owns `RuntimeConversationSharePort` 及其 `CreateShareCommand`、`ShareResult`、`LoadSharedConversationQuery`、`SharedConversationMessage`、`SharedConversationPage` DTO。
- `agent-contracts/runtime` owns `RuntimeConversationAnnotationPort` 及其 command/query/result DTO；`agent-contracts/session` 不再 owning `Feedback`、`SubmitFeedbackRequest` 或 `ListFeedbackRequest` 这类旧反馈契约。

- `agent-contracts/core` 新增 workflow 最小契约集（`RecipeDefinition`/`FlowGraph`/`WorkflowNodeDef`/`WorkflowBranchDef`/`WorkflowExecutionService`/`WorkflowExecutionRequest`/`WorkflowExecutionResult`/`WorkflowNodeResult`/`WorkflowExecutionEvent`/`WorkflowExecutionObserver`/`WorkflowVisibleDelta`），`inputs`/`outputs`/`outputParser` 保持 opaque `JsonObject`，节点私有 schema 由 `agent-workflow` 各节点 change 拥有；`agent-common` 新增 `WorkflowNodeType` 节点分类 vocabulary。`agent-contracts/gateway` 的 `PendingInputProducerRef` 扩展 `WORKFLOW_NODE` 变体，`agent-contracts/runtime` 的 `AgentRunStatePort.requestPendingInput` 增加可选 `RequestPendingInputOptions`——均为兼容性扩展。详见 `architecture/workflow-execution-and-routing.md`。

## 替换边界

否。`agent-contracts` 是稳定 public contract surface，不作为实现替换包。

## 验证关注点

- 不得导入 runtime、channel、app、gateway adapter、model implementation、capability implementation、Fastify、SQLite/Kysely、OTel SDK 或 provider SDK。
- 每个 public contract 只能有一个 owning subpath。
- gateway ports 使用 gateway-owned `*Record` persistence DTO/PO，不返回上层领域对象。
- root `agent-contracts` re-export 不能成为 owning module；产品实现包依赖具体边界时必须从 architecture allowlist 授权的 owning subpath import，不得从 root aggregate import。
- Activity contract 必须保持 session-domain contract 与 runtime facade 的唯一 ownership；channel subpath、`StreamEnvelope` 和 `RuntimeSessionPort.streamEvents(...)` 不得复制或承载 Activity。
- `agent-contracts/agent-assembly` 只承载 runtime-safe assembly facts；`Agent` execution port 留在 `agent-contracts/runtime`，raw config 和 compiler DTO 留在 `agent-app`。
- Gateway 不定义与 `agent-common` 重复的 record enum 副本；simple write 使用 `Record + write options`，message write 只暴露 `appendSessionMessage`。
- Long-term memory 和 task trajectory contract 必须保持 gateway-owned persistence DTO/port 形态；实现包不得从 `agent-memory` 或 gateway-local private row/schema 导入这些契约。
- identity、timeline、checkpoint、pending-input、hook、sandbox、content、errors、configuration 和 conversation annotation 不得作为概念分类新增独立 owning subpath，除非后续架构 change 创建明确 owning module。

## Capability 失败处置协作

本包只冻结 `CapabilityInvocationRequest`、`CapabilityInvocationResult`、`SafeError`、`ToolChoice`、`AgentRuntimeSettings.maxTurns/maxToolCallsPerTurn`、`RequestContext.agentTurnIndex` 与 checkpoint 对应字段。严格 result schema 约束这些字段的形状和组合，但 schema validator、retry predicate、finalizing controller 与 recovery implementation 必须留在各自 owner；不得为同一语义新增平行 request/result、loop phase 或 public finalization command。完整执行和消费关系见 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md`。

## Public Exports

`@nextagent/agent-contracts` 及声明的 public subpath。
