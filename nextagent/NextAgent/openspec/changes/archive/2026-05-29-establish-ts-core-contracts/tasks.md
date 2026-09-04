## 1. Contract Package Foundation

- [x] 1.1 建立或补齐 `agent-common` foundation package 和 `agent-contracts` package，配置 public export surface、tsconfig、build/test entry，并确保二者不依赖 implementation packages，且 `agent-common` 不依赖 `agent-contracts`。
- [x] 1.2 在 `agent-common` 中定义 shared ids、基础 value object、JSON value、时间/幂等键、当前身份值对象、secret reference、安全错误基线和跨边界基础 enum；不得新增 `agent-contracts/common` owning module。
- [x] 1.3 在 `agent-contracts` 中建立 owning export modules：runtime、channel、session、attachment、context、model、capability、core、gateway、observability、app，并按 design 中的 Core Contract Surface 导出稳定 DTO、enum、schema 和 port signature；各 subpath 复用 `agent-common` 的 foundation contracts，且不得为 reserved alias 或概念分类额外建立 identity、timeline、checkpoint、pending-input、hook、sandbox、content、errors、configuration 或 feedback owning subpath。
- [x] 1.4 建立 `agent-test-kit` 的 contract fixture 入口，用于构造稳定 ids、`tenantId`/`subjectId` 归属字段、AgentError/SafeError 和 event envelope。

## 2. Core Primitives And Safety Contracts

- [x] 2.1 在 `agent-common` 中定义稳定 id/value object：tenantId、subjectId、sessionId、messageId、requestRunId、capabilityId、artifactId、attachmentId、blobRef、checkpointId、pendingInputId、agentId、requestContextId、idempotencyKey 和 SecretReference。
- [x] 2.2 在 `agent-common` 中定义 identity context contract，并在 owner-scoped DTO 中显式使用 `tenantId`、`subjectId` 字段，不新增独立 owner scope DTO。
- [x] 2.3 在 `agent-common` 中定义 AgentErrorCategory、内部 AgentError 和 SafeError DTO，在 `agent-contracts/observability` 中定义 ErrorNormalizer，覆盖 stable error code、user-visible message、category、retryable 和 redaction boundary。
- [x] 2.4 在 `agent-common` 中定义 `RequestLocale` value object，并保留 `RequestLanguage` 作为 capability filtering、标题规则等窄场景的派生/兼容枚举。
- [x] 2.5 在 `agent-common` 中定义 `RunStatus`、`TerminalCommitState`、`TimelineEventType`、`CheckpointTriggerReason`、`CapabilityKind`、`CapabilityProviderKind`、`CapabilityReplayPolicy` 和 `CapabilityInvocationStatus`，确保 runtime、gateway、session/history、recovery、observability、channel projection、app configuration、assembly 和 capability 边界复用同一基础 enum。

## 3. Runtime, Timeline And Stream Contracts

- [x] 3.1 定义 runtime command contract，覆盖 submit、cancel、retry、edit/resubmit 的最小 command envelope 和 owner/session metadata。
- [x] 3.2 定义 RequestRun contract，覆盖 run status、terminal result、latest-request metadata、run version、claim/fencing 和 conditional update refs。
- [x] 3.3 定义 terminal commit contract，覆盖 terminal message、terminal event、RequestRun terminal state 和 idempotent terminal commit result。
- [x] 3.4 冻结 `agent-common` 中的 `RunStatus` 和 `TimelineEventType`、runtime-owned `LifecycleStage`、channel-owned `StreamEventType` enum，并提供 vocabulary contract tests。
- [x] 3.5 定义 timeline event envelope，包含 eventId、sessionId、runId、requestId、requestContextId、sequence、type、inlinePayload、contentRef? 和 createdAt。
- [x] 3.6 定义 stream projection envelope，确保 SSE/WebSocket 共用同一 event payload、sequence/replay 和 terminal/error semantics，并使用 requestId 表达请求关联。
- [x] 3.7 定义 RuntimeTimelinePort.stream、RuntimeTimelineStreamRequest 和 session-scoped TimelineSequence，使用 lastSeenSequence 表达恢复游标，并明确多实例 sequence 一致性、delta 事件非持久化、累计全量、可恢复 replay 和 history/message refresh 分工。

## 4. Context, Model And Capability Contracts

- [x] 4.1 定义 context assembly request/result contract；request 只表达位置和意图，context selection、budget 和 prompt shaping 由 Context Engine/Query Policy 决定，result 覆盖本次 system prompt、selectedMessageRefs、visibleCapabilities、modelInfo、modelOptions 和 modelSelectionReason。
- [x] 4.1a 定义 active context view contract，覆盖 append-only messages、summary message metadata、active context state、active context item 序列、activeContextVersion 和 prefix compact + recent tail 不变量。
- [x] 4.1b 定义附件和大内容引用 contract，覆盖 ID-only attachmentIds、RequestAttachment metadata、AttachmentMediaType、validation/availability status、opaque BlobRef 和 ContentRef 边界。
- [x] 4.2 定义 model request、stream delta、final result、usage metrics 和 model error contract，保留 token usage 与 provider request reference。
- [x] 4.3 定义 capability descriptor contract，覆盖 provider identity、`AvailabilityStatus`、compatibility metadata 和公共 kind；公共 kind 只包含 `TOOL`、`SKILL`、`AGENT`。
- [x] 4.4 定义 capability invocation request/result contract，覆盖 inputSchema、structuredPayload、generatedMessages、contextPatch、resultRef、artifactRefs、timeout/cancellation boundary 和 safe error。
- [x] 4.5 定义 Tool 幂等声明扩展位，默认不支持恢复重放，只有显式声明后才能用于恢复场景。
- [x] 4.6 定义 Agent assembly skeleton 和 AgentAssemblyRegistry lookup boundary，覆盖 agent id/version、workspaceDir、modelProfileIds、promptTemplateIds、AgentCapabilityBinding、typed runtimeSettings、active(agentId) 和 require(agentId, agentVersion)。
- [x] 4.7 定义 Agent.execute 运行边界，参数为 run、context、timeline、signal，返回 Promise<void>；Agent 通过 RunTimelineEventPort.emit 发布中间事件和最终 agent message，runtime 拥有终态事件。

## 5. Gateway, Hook, Checkpoint And Observability Ports

- [x] 5.1 定义 gateway logical ports 的最小接口，覆盖 SessionStoreGateway、SessionMessageStoreGateway、ActiveContextStoreGateway、RequestRunStoreGateway、RunTimelineEventStoreGateway、AttachmentStoreGateway、BlobStoreGateway、CheckpointStoreGateway、artifact、PendingInputStoreGateway 和 FeedbackStoreGateway durable facts；gateway ports 必须使用 gateway-owned `*Record` persistence DTO/PO，不得接收或返回上层领域 DO；SessionStoreGateway 必须覆盖 session history record list，SessionMessageStoreGateway 必须覆盖 conversation message record page、current-request message record page 和 hideMessage visibility update，ActiveContextStoreGateway 必须覆盖 active context record 读取、模型可见 message append 和 compaction commit，RunTimelineEventStoreGateway 查询必须按 sessionId 和 afterSequence 查询，并可选按 requestId/runId 过滤；AttachmentStoreGateway 只管理附件 record metadata/status，BlobStoreGateway 只管理 opaque bytes。
- [x] 5.2 定义 gateway owner-scoped request、Record DTO、gateway-owned record value type、CAS result 和 terminal commit record result；领域模块负责 DO/read model 与 Record 的映射；gateway Record 只能引用 `agent-common` foundation contract 或 gateway-owned record value type，不引用上层领域 subpath enum/DTO；普通写入返回持久化 Record，CAS 分支区分 updated、version conflict、not found，terminal commit 分支区分 committed、already committed、version conflict、not found。
- [x] 5.3 定义 checkpoint payload 和 checkpoint write contract，字段覆盖 checkpointId、sessionId、requestId、runId、requestContextId、runVersion、triggerReason、lastSequence、activeContextVersion、flowVariables、savedAt 和 idempotencyKey。
- [x] 5.4 定义 hook definition/binding、hook input/result、typed boundary/mutation base、invocation event、structured log/metric 和 no-op provider contract，并复用 runtime-owned `LifecycleStage`。
- [x] 5.5 定义 runtime-owned pending input boundary skeleton，覆盖 PendingInputRequest、PendingInputAnswer、PendingInput 三个核心对象，并定义 AnswerPendingInputCommand、PendingInputAnswerAccepted runtime command 边界；覆盖 kind、questions、answers、timeoutAt、status 和恢复锚点；不得在客户端 answer 或持久化对象中引入 origin、timeout behavior、answer schema、audit linkage、run version、step id、identity、idempotency key 或 model-formatted answer 字段。
- [x] 5.6 在 `agent-contracts/gateway` 中定义 sandbox gateway contract skeleton，覆盖 executable request、working directory boundary、environment allowlist、timeout、stdout/stderr limit、exit code 和 safe failure。
- [x] 5.7 定义 audit event、audit writer 和错误归一化边界，明确 tracing、metrics 和 logging 由 observability 实现层通过 middleware/interceptor、port decorator、auto-instrumentation 或 timeline/event subscriber 处理，核心契约不定义独立 trace 对象、metric record 或 SDK 类型。
- [x] 5.8 在 `agent-contracts/app` 中定义 app configuration skeleton，覆盖 model profiles、gateway adapters、capability providers、`agent-common` secret references、secret resolver 加密 envelope 边界、safe unavailable error 和显式 degradation event/result。

## 6. Verification

- [x] 6.1 添加 contract tests，验证 id/value object、`tenantId`/`subjectId` 归属字段、AgentError/SafeError、核心 DTO 必需字段、port signature、event vocabulary、stream envelope、capability descriptor 和 gateway conditional result。
- [x] 6.2 添加 architecture boundary tests，验证 `agent-contracts` 不依赖 implementation packages，implementation packages 不通过 private DTO 建立跨包契约。
- [x] 6.3 添加 no-op boundary smoke tests，验证 hook、checkpoint、audit 或等价 no-op provider 可被主流程调用且不改变调用语义。
- [x] 6.4 添加 recovery contract tests，验证 run version、claim/fencing、terminal commit idempotency、checkpoint payload、CAS result 和 terminal commit result 的组合语义。
- [x] 6.5 添加 safe-data tests，验证 raw secret、raw credential、未脱敏路径和 raw tool/model input 不进入 safe error、stream event、metric attributes 或 audit event。
- [x] 6.6 运行 OpenSpec 校验、contract test suite 和 architecture test suite，并清理实现中产生的临时 fixture 或未使用 public export。

## 归档前基线提升检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前基线提升计划”处理：

- 将 `ts-core-contracts` 行为契约提升到 `openspec/specs/ts-core-contracts/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/runtime-boundaries.md`、`owner-scope-security.md` 和相关 observability 设计文档。
- 按需更新 `openspec/designs/domain/request-run.md`。
- 按需更新 `openspec/designs/contracts/core-contracts.md`。
- 按需更新 `openspec/designs/modules/agent-contracts.md`。
- 按需新增或更新契约先行相关 ADR。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
