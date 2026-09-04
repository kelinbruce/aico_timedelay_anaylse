# ship-ts-minimal-agent-kernel

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：串行底座

状态：complete
类型：串行核心 change
主要 owner：agent-runtime、agent-channel-web、agent-core、agent-context-engine、agent-model、agent-session、agent-app
依赖：`establish-ts-core-contracts`

目标：
- 基于核心契约跑通 Web submit -> runtime -> Agent core -> context -> model -> capability -> timeline/SSE -> terminal commit -> history 的问答主流程。

规格输入：
- 用户通过 Web 入口提交一个问题。
- 系统创建或使用会话。
- Runtime 接受请求并进入执行生命周期。
- Runtime 必须保证同一 session 同时最多一个 active `RequestRun`；已有 active run 时，新 submit 返回 safe conflict/rejection，不创建 queued run，不实现 FIFO lane、scheduler queue、latest-submit replacement 或 terminal-pending dispatch protection。
- Runtime 接受请求时必须通过 `AgentAssemblyRegistry.active(agentId)` 解析当前 active Agent assembly，并把 resolved `agentId`、`agentVersion`、`agentAssemblyRef` 固化到 `RequestRun` 和 `RequestContext`。
- 请求被接受后，core、context 和 capability routing 必须通过 `AgentAssemblyRegistry.require(agentId, agentVersion)` 或由它派生的 assembly-scoped wrapper 读取同一个 assembly，不得重新按 active version 选择。
- Runtime single-run dispatcher/scheduler 是本 change 主流程能力：只调度已持久化、assembly 已固化且未进入 terminal 的 accepted run；启动前使用 `RequestRunWriteRequest.expectedVersion` 和 `idempotencyKey` 将同一 run 从 `status=ACCEPTED` CAS 推进到 `status=EXECUTING`，CAS 未更新时不得调用 Agent。
- Runtime 通过 `Agent.execute(run, context, timeline, messages, signal): Promise<void>` 调用 Agent core；`messages` 是 runtime-owned `RunMessagePort`，用于追加执行中产生的 session message。
- `RequestContext` 必须使用核心契约确认的可恢复执行坐标，不包含 `attempt`、`deadlineAt` 或 `messageRefs`；`attempt` 和 `deadlineAt` 从 `RequestRun` 读取，当前 request/run 消息通过 `SessionMessageStoreGateway.listCurrentRequestMessages(ListCurrentRequestMessagesRecordQuery)` 查询，再由 session/runtime 领域层映射。
- `ToolCallState` 必须包含 `toolCallId`、`capabilityId`、结构化 `arguments` 和 `status`；`currentToolBatchMessageId` 指向当前 tool batch 的 assistant tool-use message。
- Agent 组装上下文并调用模型。
- Agent 的中间事件必须通过 `RunTimelineEventPort.emit(event): Promise<void>` 发布；assistant tool-use、capability result 和其它执行中 session message 必须通过 `RunMessagePort.appendMessage(run, context, SessionMessageDraft)` 追加；runtime 负责填充或复写 timeline/message 的 runtime-owned 字段并发布终态事件。
- 用户看到流式输出。
- 请求产生唯一终态。
- 历史读取能看到一致结果。
- 错误以 safe error 形式返回。
- 最小内核必须包含一个最小真实 model provider；测试 provider 可以作为测试替身存在，但不能替代真实 provider。
- 最小内核调用模型必须通过 `ModelInvocationService.complete(...)` 或 `ModelInvocationService.stream(...)`；调用模式由方法选择，不在 request 字段中表达。
- Context Engine assemble request 只携带 `sessionId`、`requestId`、`requestContextId`、`agentId`、`agentVersion`、`runId`、`stepId`、`locale`、`purpose`；当前 root user message id 使用核心契约已有的 `requestId`，不得新增 `rootMessageId` 同义字段；不得携带 `historyRefs`、`attachmentRefs`、`capabilityDisclosureRefs`、`currentMessage`、`agentAssembly` 或 `budget`。
- 进入 `ModelInvocationService` 前，core/runtime 必须把 `RenderedModelInput` 转换为扁平 `ModelInvocationRequest`；`agent-model` 不接收完整 `ContextAssembly` 或 `RenderedModelInput`。
- `ModelInvocationRequest` 必须包含必填 `providerKind`、模型 endpoint/credential、`ChatMessage[]`、tools、模型参数、providerOptions 和 timeout；provider SDK、AI SDK 或 runtime streaming context 不得进入核心调用契约。
- 最小 Web stream 先支持 SSE；WebSocket 和 SSE/WebSocket 双 transport 一致性由后续 change 补齐。
- 最小 Web stream 必须通过 `RuntimeEventStreamPort.stream({ sessionId, lastSeenSequence })` 读取 runtime event stream，channel 只负责投影为 `StreamEnvelope`。
- 提交后打开 stream 使用 `lastSeenSequence=0`；`RequestAccepted` 只返回 `sessionId`、`requestId`、`runId`、`attempt`，不返回 stream cursor 或 timeline sequence 字段。
- 最小 history 读取由 session service 将 channel-facing read model query 映射为 gateway-owned `SessionHistoryRecordQuery` / `ListSessionMessagesRecordQuery`，再分别调用 `SessionStoreGateway.listSessions(...)` 和 `SessionMessageStoreGateway.listMessages(...)`；gateway query 必须携带 `tenantId`、`subjectId` 和 `agentId`。
- 当前 request/run 范围内的消息读取使用 `SessionMessageStoreGateway.listCurrentRequestMessages(ListCurrentRequestMessagesRecordQuery)`，不得只按 `requestId` 查询，也不得引入 `rootMessageId` 作为旁路查询键。
- 最小内核必须使用 capability catalog descriptor resolution 和 `CapabilityInvocationPort` 调用形态；`CapabilityInvocationRequest` 字段为 `invocationId`、`capabilityId`、`toolCallId?`、`arguments`、`sessionId`、`requestId`、`runId`、`requestContextId`、`stepId`、`identityContext`、`agentId`、`agentVersion`、`timeoutMs`、`idempotencyKey?`，不得包含 `workspaceDir` 或 `recoveryReplay`；当前产品 assembly 只启用内置 `read` 工具，未启用 capability 不进入模型可见 tools，若被调用必须 safe rejected。
- hook 调用点必须存在，默认 no-op。
- `CheckpointStoreGateway` 调用点必须存在，默认 no-op。
- `AuditEventWriter` 调用点必须存在，默认 no-op。

范围规则：
- 最小内核只展开问答主流程的一层直接依赖。
- 直接依赖中，影响问答结果、流式可见性、终态一致性、用户可操作状态或安全边界的行为，必须满足本 change 对应的接口、状态机、schema、事件和验证项。
- 直接参与流程但不影响一次问答成立的行为，必须保留 public contract 调用点，但实现为 no-op。
- 二层或更深依赖不得因为架构引用进入最小内核，除非它直接决定问答功能成立。

实现级别：

| 级别 | 含义 | 最小内核处理 |
|---|---|---|
| `real` | 不实现就不能完成问答或会破坏终态一致性 | 满足本 change 对应的接口、状态机、schema、事件和验证项 |
| `minimal` | 支撑问答所需的最小真实能力 | 实现最小可用版本 |
| `noop` | 主流程必须调用，但不影响问答功能 | 提供对应 public contract 上的产品 no-op 实现 |
| `deferred` | 不属于主问答链路的一层直接依赖 | 不进入最小内核 |

模块范围：

| 模块或边界 | 最小内核级别 | 说明 |
|---|---|---|
| `agent-app` | `real` | 负责 composition root、产品默认装配和测试替身隔离。 |
| `agent-channel-web` | `real` | 支持最小 submit、stream 和 history 读取。 |
| `agent-runtime` | `real` | 拥有 runtime command、request lifecycle、timeline 和 terminal commit。 |
| `agent-session` | `minimal` | 支撑会话、消息、请求结果的必要读写。 |
| `agent-core` | `real` | 提供最小 Agent loop 和请求处理路径。 |
| `agent-context-engine` | `minimal` | 组装当前请求、必要会话历史、locale、owner metadata、默认 prompt/profile、术语保留指令和最小 window/budget guard。 |
| `agent-model` | `real` | 提供一个可配置模型调用路径和测试可替换 provider。 |
| `agent-capability` | `minimal` | 保留统一 capability catalog/invocation 边界；当前产品只暴露 read，其它工具集合不展开。 |
| Gateway ports | `minimal` | 支撑问答所需的状态和模型边界。 |
| Hook stages | `noop` | 调用点存在；无注册 hook 时为空执行。 |
| Checkpoint save | `noop` | 主流程调用接口；最小内核不保存 checkpoint。 |
| Audit writer | `noop` | 主流程调用 `AuditEventWriter` 接口；最小内核不要求真实审计落库。 |
| Memory | `deferred` | 长期记忆不进入最小内核；仅保留架构预留，后续 memory changes 再定义 contract 和实现。 |
| Attachment | `deferred` | 除非首个问答范围明确要求附件。 |
| 多 store 实现 | `deferred` | 不进入最小内核。 |
| 多 Skill source | `deferred` | 不进入最小内核。 |
| 远端 Agent | `deferred` | 不进入最小内核。 |
| 多实例 lease/recovery | `deferred` | 不进入最小内核。 |

No-op 约束：
- no-op 只能用于最小内核的一层直接依赖。
- no-op 接口形态必须与对应 public contract 一致。
- 主流程必须真实调用该接口。
- 默认 no-op 不失败。
- 后续真实实现替换时不得改变主流程调用语义。
- 不得用 no-op 掩盖影响问答结果、终态一致性或安全边界的行为。

非目标：
- 不提供请求取消、重试、编辑重提的完整用户能力。
- 不提供附件。
- 不提供多模型 provider。
- 不提供多 capability provider、多 Skill source 或复杂 capability governance。
- 不提供完整上下文预算解释、压缩、memory retrieval 或 prompt profile governance；当前 change 仍需实现默认 prompt/profile 和最小 window/budget guard。
- 不提供断连恢复和 replay 完整语义。
- 不提供真实 checkpoint/recovery、terminal retry/takeover 或多实例 recovery；这些由既有 runtime recovery 计划承接。
- 不提供 output continuation；roadmap 已标记为 not-planned，当前目标是超限时 degradation + safe failed terminal。
- 不提供多实例部署能力。
- 不提供同 session FIFO lane、scheduler queue、latest-submit replacement、queued run 可见性或 terminal-pending dispatch protection；这些由 `add-ts-session-lane-scheduling` 承接。

验收要点：
- 最小端到端问答测试。
- stream 到 terminal result 一致性测试。
- safe error 测试。
- owner scope smoke test。
- no-op boundary 调用测试。
