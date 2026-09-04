# @nextagent 包依赖接口使用方式汇总

> 生成时间: 2026-07-29
> 范围: `agent-platform-gateway-remote/` 和 `agent-remote-deployment/`

---

## @nextagent/agent-app

| 接口 | 方式 | 说明 |
|------|------|------|
| `createNextAgentApp` | 函数调用 | `createNextAgentApp({ ...appOptions })` 返回 `NextAgentApp` |
| `createNextAgentAppAsync` | 函数调用 | 异步版本，remote-start.ts 内部调用 |
| `CreateNextAgentAppOptions` | 类型注解 | `options: CreateNextAgentAppOptions` |
| `NextAgentApp` | 类型注解 | 变量类型、返回值类型 |

---

## @nextagent/agent-common

| 接口 | 方式 | 说明 |
|------|------|------|
| `AgentError` | instanceof | `error instanceof AgentError` 分支判断 |
| `AgentErrorCategory` | 类型注解 | `category: AgentErrorCategory` |
| `AgentErrorCause` | 类型注解 | 错误对象结构字段 |
| `AgentId` | 类型注解 | brand 标记的 ID 类型 |
| `brand<T, B>` | 函数调用 | `brand<number, "EpochMillis">(value)` 类型标记 |
| `BlobRef` | 类型注解 | brand 标记的 blob 引用字符串 |
| `ConversationId` | 类型注解 | 对话 ID 字段类型 |
| `createRuntimeLogger` | 函数调用 | `createRuntimeLogger("module-name")` 创建日志实例 |
| `EpochMillis` | 类型注解 | brand 标记的时间戳毫秒数 |
| `getLogger` | 函数调用 | 获取全局 logger（remote-start.ts） |
| `JsonObject` | 类型注解 | JSON 对象映射类型 |
| `JsonValue` | 类型注解 | JSON 联合值类型 |
| `RuntimeLogger` | 类型注解 | 日志实例类型，可选属性 `runtimeLogger?: RuntimeLogger` |
| `SafeError` | 返回类型 | `{ code, message, category, retryable, ...safeDetails }` 对象 |
| `SecretReference` | 类型注解 | brand 标记的秘钥引用 `brand<`env:${string}`, "SecretReference">` |
| `SessionId` | 类型注解 | 会话 ID 字段类型 |
| `SubjectId` | 类型注解 | 用户主体 ID 字段类型 |
| `TenantId` | 类型注解 | 租户 ID 字段类型 |
| `RunStatus` | 类型注解 | 运行状态枚举 |

---

## @nextagent/agent-contracts

### gateway 子模块

| 接口 | 方式 | 说明 |
|------|------|------|
| `BlobStoreGateway` | implements | `class X implements BlobStoreGateway` |
| `ClaimCronTriggerRequest` | 字面量 | `const req: ClaimCronTriggerRequest = { tenantId, subjectId, ... }` |
| `CronTaskGatewayPort` | 类型注解 | `{ readonly current?: CronTaskGatewayPort }` 端口对象 |
| `CronTaskRecord` | 解构 | `dueTasks.find((t) => t.taskId === taskId)` 获取字段 |
| `CronTriggerCallbackInput` | 返回类型 | async 函数返回类型 |
| `CronTriggerCallbackAuthentication` | 字面量 | `{ algorithm: "HMAC-SHA256", signature }` |
| `DeleteSessionCascadeRequest` | 类型注解 | 函数参数类型 |
| `DeleteSessionCascadeResult` | 类型注解 | 函数返回类型 |
| `GatewayAdapterKind` | 类型注解 | `readonly GatewayAdapterKind[]` |
| `GatewayBindings` | 类型注解 | 返回对象类型 |
| `GatewayProvider` | implements | `createRemoteGatewayProvider()` 返回 implements GatewayProvider 的对象 |
| `GatewayProviderCreateInput` | 参数类型 | `create(input: GatewayProviderCreateInput)` |
| `GuardrailGatewayPort` | 类型注解 | RobotRouter guardrail remote provider 返回的 guardrail 端口 |
| `GuardrailCheckQuestionInput` | 参数类型 | `checkQuestion(input)` 用户问题护栏检查入参 |
| `GuardrailCheckQuestionResult` | 返回类型 | `checkQuestion(...)` 用户问题护栏检查结果 |
| `GuardrailCheckAnswerInput` | 参数类型 | `checkAnswer(input)` 模型回答护栏检查入参 |
| `GuardrailCheckAnswerResult` | 返回类型 | `checkAnswer(...)` 模型回答护栏检查结果 |
| `GuardrailCheckKnowledgeInput` | 参数类型 | `checkKnowledge(input)` 知识片段护栏检查入参 |
| `GuardrailCheckKnowledgeResult` | 返回类型 | `checkKnowledge(...)` 知识片段护栏检查结果 |
| `GuardrailCheckNl2PythonInput` | 参数类型 | `checkNl2Python(input)` Python 能力代码护栏检查入参 |
| `GuardrailCheckNl2PythonResult` | 返回类型 | `checkNl2Python(...)` Python 能力代码护栏检查结果 |
| `IdempotentWriteOptions` | 可选参数 | `options?: IdempotentWriteOptions` |
| `ListBlobsRequest` | 参数类型 | `async listBlobs(request: ListBlobsRequest)` |
| `ListBlobsResult` | 返回类型 | 函数返回类型 |
| `LoadBlobRequest` | 参数类型 | `async loadBlob(request: LoadBlobRequest)` |
| `LongTermMemoryGateway` | 类型注解 | bindings 对象属性 |
| `LongTermMemoryGatewayBindings` | 类型注解 | 类型字段 |
| `MaterializeBlobRequest` | 参数类型 | `async materializeBlob(request: MaterializeBlobRequest)` |
| `ModelGateway` | 类型注解 | bindings 对象属性 |
| `ListFrequentHistoryQuestionsRequest` | 参数类型 | 高频历史问题 canonical 查询入参 |
| `ListFrequentHistoryQuestionsResult` | 返回类型 | 高频历史问题 canonical 查询结果 |
| `RecommendSimilarPresetQuestionsRequest` | 参数类型 | 相似预置问题 canonical 查询入参 |
| `RecommendSimilarPresetQuestionsResult` | 返回类型 | 相似预置问题 canonical 查询结果 |
| `QuestionRecommendationGateway` | implements | remote adapter 实现的问题推荐端口 |
| `RagGateway` | 类型注解 | bindings 对象属性 |
| `RagRetrievalRequest` | 类型注解 | 函数参数类型 |
| `RagRetrievalResult` | 类型注解 | 函数返回类型 |
| `SandboxExecutionRequest` | 类型注解 | 函数参数类型 |
| `SandboxGateway` | 类型注解 | bindings 对象属性 |
| `ScheduledMaintenanceJob` | 类型注解 | 测试用例字面量 |
| `SessionHistoryPage` | 返回类型 | 函数返回类型 |
| `SessionHistoryRecordQuery` | 参数类型 | 函数参数类型 |
| `SessionLookupRequest` | 参数类型 | 函数参数类型 |
| `SessionRecord` | 参数/返回类型 | 函数参数和返回类型 |
| `SessionStoreGateway` | implements | `class X implements SessionStoreGateway` |
| `StoreBlobRequest` | 参数类型 | `async storeBlob(request: StoreBlobRequest)` |
| `WorkflowRemoteExecutionGateway` | 类型注解 | 接口类型 |
| `WorkflowRemoteExecutionFailureReasonCode` | 类型注解 | SSE 解析分支判断 |
| `WorkflowRemoteExecutionResult` | 类型注解 | 流式结果处理 |
| `WorkflowRemoteExecutionStreamItem` | 返回类型 | `WorkflowRemoteExecutionStreamItem[]` |
| `WorkingMemoryGateway` | 类型注解 | bindings 对象属性 |
| `WorkingMemoryGatewayBindings` | 类型注解 | 类型字段 |

### model 子模块

| 接口 | 方式 | 说明 |
|------|------|------|
| `ModelFinalResult` | 返回类型 | `Promise<ModelFinalResult>`；可选 `incompleteOutputReason` 使用 `output-limit | truncated-tool-call` 表达独立于 `finishReason` 的可恢复输出不完整事实 |
| `ModelFinalResultSchema` | runtime schema 校验 | remote Model Gateway adapter 校验 canonical 终态结果 |
| `ModelFinishReason` | 类型注解 | `finishReason: "guardrail-blocked" as ModelFinishReason` |
| `ModelGatewayModelInformationService` | 类型注解 | Model Gateway 按 canonical `modelId` 查询模型窗口信息的端口 |
| `ModelGatewayProvider` | implements | `class X implements ModelGatewayProvider` |
| `ModelInvocationRequest` | 参数类型 | `complete(request: ModelInvocationRequest, signal)`；可选 `contextWindowTokens` 是框架预算元数据，不进入 provider-native request 或模型消息 |
| `ModelInvocationService` | implements | 返回对象 `{ complete, stream }` 实现该接口 |
| `ModelMessage` | 类型注解 | `readonly ModelMessage[]` 消息数组 |
| `ModelMessageRole` | 类型注解 | `msg.role === "USER"` 角色判断 |
| `ModelStreamDelta` | 类型注解 | `stream(..., onDelta)` 回调参数；唯一 `ModelFinalResult` 由返回的 Promise 单独交付 |
| `ModelStreamDeltaSchema` | runtime schema 校验 | remote Model Gateway adapter 校验 canonical 流式 delta |
| `ModelToolCall` | 类型注解 | 工具调用结构类型 |
| `ModelUsage` | 类型注解 | usage 字段类型 |

### core 子模块

| 接口 | 方式 | 说明 |
|------|------|------|
| `WorkflowExecutionRequest` | 参数类型 | 函数参数、as 类型转换 |
| `WorkflowExecutionResult` | 解构 | `result.outputVariables` 字段访问 |
| `WorkflowExecutionService` | 类型注解 | 接口类型 |
| `WorkflowPendingInputQuestion` | 类型注解 | 数组类型 |

---

## @nextagent/agent-observability

| 接口 | 方式 | 说明 |
|------|------|------|
| `createTraceProjector` | 函数调用 | `const projector = createTraceProjector()` 动态 import 后调用 |

---

## @nextagent/agent-platform-gateway-local

| 接口 | 方式 | 说明 |
|------|------|------|
| `createLocalGatewayBindings` | 函数调用 | 创建本地网关绑定 |
| `createLocalGatewayProvider` | 函数调用 | `createLocalGatewayProvider("name", { blobStore })` |
| `createLocalCronTaskScheduler` | 函数调用 | 作为 `cronTaskSchedulerFactory` 传入 app options |
| `createSqliteLongTermMemoryGatewayProvider` | 函数调用 | 创建 SQLite LTM provider |
| `createSqliteWorkingMemoryGatewayProvider` | 函数调用 | 创建 SQLite WM provider |
| `createSqliteCronTaskGateway` | 函数调用 | 创建 SQLite cron 持久化 |
| `LocalGatewayBindingsConfig` | 类型注解 | `{ blobStore: BlobStoreGateway }` |

---

## @nextagent/agent-platform-gateway-remote

| 接口 | 方式 | 说明 |
|------|------|------|
| `ReferenceRemoteQuestionRecommendationClient` | implements | provider 高频问题与相似问题 HTTP client 边界 |
| `createReferenceRemoteQuestionRecommendationGateway` | 函数调用 | 创建带 canonical request/result 及 provider wire response 校验的 remote adapter |
| `HttpQuestionRecommendationClientOptions` | 参数类型 | provider endpoint 与 fetch 注入选项 |
| `createHttpQuestionRecommendationClient` | 函数调用 | 创建问题推荐 HTTP client |

---

## 使用方式分类汇总

### 函数调用

| 包 | 函数 |
|----|------|
| agent-app | `createNextAgentApp`, `createNextAgentAppAsync` |
| agent-common | `brand`, `createRuntimeLogger`, `getLogger` |
| agent-observability | `createTraceProjector` |
| agent-platform-gateway-local | `createLocalGatewayBindings`, `createLocalGatewayProvider`, `createLocalCronTaskScheduler`, `createSqliteLongTermMemoryGatewayProvider`, `createSqliteWorkingMemoryGatewayProvider`, `createSqliteCronTaskGateway` |
| agent-platform-gateway-remote | `createReferenceRemoteQuestionRecommendationGateway`, `createHttpQuestionRecommendationClient` |

### 类型注解 / implements / extends

| 用途 | 接口 |
|------|------|
| class implements | `BlobStoreGateway`, `GatewayProvider`, `ModelGatewayProvider`, `ModelInvocationService`, `SessionStoreGateway` |
| 返回类型 | `NextAgentApp`, `ModelFinalResult`, `ModelStreamDelta`, `WorkflowExecutionResult` |
| 参数类型 | `ModelInvocationRequest`, `GatewayProviderCreateInput`, `WorkflowExecutionRequest`, `ClaimCronTriggerRequest` |
| 字段类型 | `AgentId`, `TenantId`, `SubjectId`, `SessionId`, `ConversationId`, `SecretReference`, `BlobRef`, `EpochMillis`, `JsonObject`, `JsonValue`, `RuntimeLogger`, `AgentErrorCategory`, `SafeError` |
| 模型信息端口 | `ModelGatewayModelInformationService` |

### 对象构造

| 用途 | 接口 |
|------|------|
| 字面量对象 | `ClaimCronTriggerRequest`, `CronTriggerCallbackInput`, `CronTriggerCallbackAuthentication` |
| brand 标记 | `brand<T, B>(value)` — EpochMillis, BlobRef, SecretReference, AgentId 等 |

### instanceof / 条件判断

| 接口 | 方式 |
|------|------|
| `AgentError` | `error instanceof AgentError` |
| `ModelFinishReason` | `finishReason: "guardrail-blocked" as ModelFinishReason` |
| `WorkflowRemoteExecutionFailureReasonCode` | switch case 分支判断 |


# @nextagent 包依赖接口使用方式汇总

> 生成时间: 2026-07-21
> 范围: `agent-channel-aico/` (AICO Service)

---

## @nextagent/agent-common

| 接口 | 方式 | 说明 |
|------|------|------|
| `AgentError` | new / instanceof | `new AgentError({ code, message, category, retryable, ... })` 错误抛出和判断 |
| `IdentityContext` | 类型注解 | 身份上下文类型，包含 tenantId, subjectId, displayName |
| `AgentId` | brand 标记 | `brand<string, "AgentId">()` |
| `TenantId` | brand 标记 | `brand<string, "TenantId">()` |
| `SubjectId` | brand 标记 | `brand<string, "SubjectId">()` |
| `SessionId` | brand 标记 | `brand<string, "SessionId">()` |
| `MessageId` | brand 标记 | `brand<string, "MessageId">()` |
| `RequestRunId` | brand 标记 | `brand<string, "RequestRunId">()` |
| `IdempotencyKey` | brand 标记 | `brand<string, "IdempotencyKey">()` |
| `PendingInputId` | brand 标记 | `brand<string, "PendingInputId">()` |
| `TimelineSequence` | brand 标记 | `brand<number, "TimelineSequence">()` |
| `AttachmentId` | brand 标记 | `brand<string, "AttachmentId">()` |
| `RequestLocale` | 类型注解 | `locale: "zh-CN" as RequestLocale` |
| `TimelineEventType` | 类型注解 | 时间线事件类型枚举 |
| `brand<T, B>` | 函数调用 | 品牌化类型标记，如 `brand<string, "AgentId">("value")` |
| `createRuntimeLogger` | 函数调用 | `createRuntimeLogger("module-name")` 创建日志实例 |

---

## @nextagent/agent-contracts

### runtime 子模块

| 接口 | 方式 | 说明 |
|------|------|------|
| `RuntimeCommandPort` | 类型注解 | 运行时命令端口，包含 submit, cancel, answerPendingInput 方法 |
| `RuntimeSessionPort` | 类型注解 | 运行时会话端口，包含 streamEvents, requireSession, getActiveRun 方法 |
| `SubmitRequestCommand` | 类型注解 | 提交请求命令，包含 agentId, identityContext, inputText 等字段 |
| `AnswerPendingInputCommand` | 类型注解 | 回答 pending input 命令 |
| `RequestControlCommand` | 类型注解 | 请求控制命令，用于 CANCEL 等操作 |
| `RequestAccepted` | 解构 | `const { sessionId, requestId, runId } = submitResult` |
| `PendingInputAnswerAccepted` | 解构 | `const { sessionId } = answerResult` |
| `UserSession` | 类型注解 | 用户会话类型 |
| `RunTimelineEvent` | 类型注解 | 运行时间线事件类型 |

### gateway 子模块

| 接口 | 方式 | 说明 |
|------|------|------|
| `SessionMessageStoreGateway` | 类型注解 | 会话消息存储网关，用于 listMessages 查询 |
| `ListSessionMessagesRecordQuery` | 类型注解 | 查询参数类型，包含 tenantId, subjectId, agentId, sessionId 等 |
| `GatewayProviderCreateInput` | 参数类型 | 网关提供者创建输入类型 |

---

## @nextagent/agent-platform-gateway-local

| 接口 | 方式 | 说明 |
|------|------|------|
| `createLocalGatewayProvider` | 函数调用 | 创建本地网关提供者，作为 app options 或 gatewayProviders 元素 |

---

## @nextagent/agent-app

| 接口 | 方式 | 说明 |
|------|------|------|
| `NextAgentApp` | 类型注解 | NextAgent 应用实例类型，包含 runtime, sessions, server, gateway 等 |
| `createNextAgentApp` | 函数调用 | 创建 NextAgent 应用实例 |
| `CreateNextAgentAppOptions` | 类型注解 | 创建应用实例的选项类型 |

---

## @nextagent/agent-context-engine

| 接口 | 方式 | 说明 |
|------|------|------|
| `createForkActiveContextSelector` | 函数调用 | 为remote deployment中仍由LOCAL SQLite承载的Working Memory注入会话派生上下文选择器；不属于REMOTE WorkingMemory服务端实现 |

---

## 使用方式分类汇总

### 函数调用

| 包 | 函数 |
|----|------|
| agent-app | `createNextAgentApp` |
| agent-common | `brand`, `createRuntimeLogger` |
| agent-context-engine | `createForkActiveContextSelector` |
| agent-platform-gateway-local | `createLocalGatewayProvider` |
| agent-platform-gateway-remote | `createRemoteGatewayProvider`, `createVendorRemoteGatewayProvider`, `createReferenceRemoteModelGatewayProvider`, `createReferenceRemoteRagRetrievalGateway`, `createReferenceRemoteSandboxGateway`, `startRemoteRuntimePackage`, `stopRemoteServices` |
| agent-remote-deployment | `startRemoteRuntimePackage` |

### 类型注解 / 参数类型

| 用途 | 接口 |
|------|------|
| 端口接口 | `RuntimeCommandPort`, `RuntimeSessionPort` |
| 命令类型 | `SubmitRequestCommand`, `AnswerPendingInputCommand`, `RequestControlCommand` |
| 结果类型 | `RequestAccepted`, `PendingInputAnswerAccepted`, `RunTimelineEvent` |
| 消息网关 | `SessionMessageStoreGateway` |
| 应用类型 | `NextAgentApp` |
| 网关类型 | `ReferenceRemoteModelGatewayClient`, `ReferenceRemoteRagRetrievalClient`, `ReferenceRemoteSandboxClient` |

### 对象构造 / brand 标记

| 用途 | 接口 |
|------|------|
| brand 标记 ID | `brand<string, "AgentId">`, `brand<string, "SessionId">`, `brand<string, "TenantId">`, `brand<string, "SubjectId">`, `brand<string, "MessageId">`, `brand<string, "IdempotencyKey">`, `brand<number, "TimelineSequence">` |
| 身份构造 | `{ tenantId: brand<string, "TenantId">(...), subjectId: brand<string, "SubjectId">(...), displayName: ... }` |

### instanceof / 条件判断

| 接口 | 方式 |
|------|------|
| `AgentError` | `error instanceof AgentError`, `error.code === "SESSION_NOT_FOUND"` |

---
