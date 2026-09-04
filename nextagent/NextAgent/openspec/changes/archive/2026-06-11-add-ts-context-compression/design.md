## 1. 黑盒效果是什么

本 change 交付的黑盒效果是：长会话继续请求时，系统能把较早历史压成一条 summary，并继续保留近期历史和当前请求。

模型最终看到的结构应是：

```text
system prompt
较早历史 summary
近期未压缩历史 tail
当前请求
tools
```

这不是“所有历史都摘要化”。它只在 prior active-context history 超预算时触发，并且必须保护 current request。

## 2. 解决的问题是什么

当前 context budget 策略可以判断 prior history 超预算，但实际处理仍偏向 omit。omit 可以保证不超窗，却会损失黑盒上用户期待被保留的上下文语义。

summary compression 要补上的缺口是：

- prior history 超预算时优先压缩，而不是只丢弃；
- 压缩结果是持久事实，而不是 render 时临时拼出来的投影；
- 后续请求和恢复路径都能从 canonical stores 重新得到压缩后的上下文。

## 3. 核心设计和规格

### 3.1 压缩发生位置

压缩发生在 `assemble()`。

原因是 `assemble()` 已经拥有：

- active context 读取；
- message refs 加载；
- history candidate selection；
- budget/window policy；
- diagnostics。

`render()` 不压缩。`render()` 只重新加载 `selectedMessageRefs`，然后把已提交的 summary、tail 和 current request 渲染成模型输入。

### 3.2 触发条件

`ContextBudgetPolicyPort.evaluate(...)` 产出的 `ContextCompactionPlan` 是压缩触发的唯一决策来源。当 `plan.decision == compact-degrade` 且 Context Engine 配置了 summary generation port 时，`assemble()` 可以尝试 summary compression。covered prefix 仍来自 `selectHistoryCandidates(...)` 产出的 eligible prior complete-turn prefix，不重新推导预算。

如果 `plan.decision` 不是 compact-degrade（例如 explicit-failure 或 insufficient-context），则不尝试 summary compression，而是保持 budget policy 给出的 outcome。

### 3.3 压缩范围

covered prefix 只能来自 `selectHistoryCandidates(...)` 已认定合法的 prior complete turns。

不得覆盖：

- current request root user message；
- current request tool state；
- invisible message；
- cross-session message；
- system prompt；
- capability disclosure；
- runtime context；
- attachment descriptor；
- memory disclosure。

不得拆分：

- complete conversation turn；
- assistant tool-use / capability-result pair；
- provider fragment。

### 3.4 Summary message

summary 作为普通 `SessionMessage`（领域对象）构造：

```ts
role: "SUMMARY"
contentType: "PLAIN_TEXT"
metadata: {
  kind: "CONTEXT_COMPRESSION_SUMMARY",
  strategy: "PREFIX_COMPACT_RECENT_TAIL",
  sourceActiveContextVersion: number,
  targetActiveContextVersion: number,
  coveredMessageRefs: MessageId[],
  retainedTailMessageRefs: MessageId[],
  tokenCount: number
}
```

`requestId` 仍表示当前 root user request identity，不新增 `rootMessageId`。

summary 的 `SessionMessage.requestId` 必须继承当前 `ContextAssemblyRequest.requestId`；原 covered messages 与 retained tail messages 的 `requestId` 保持不变；`retainedTailMessageRefs` 指向的原始消息不重新打上 summary 的 `requestId`。Context Engine 在领域层只构造 `SessionMessage`；转换为 `SessionMessageRecord` 仅发生在 `commitCompaction` 的 session 映射边界（见 3.5）。

### 3.5 原子提交

`ActiveContextStoreGateway.commitCompaction(...)` 是唯一持久提交路径。

它必须在一个原子边界里完成：

1. 校验 owner scope、agent scope、session id 和 expected active context version；`expectedActiveContextVersion` 取自 `ActiveContextStoreGateway.loadActiveContext(...)` 返回的 `activeContextVersion`，不新增 `ContextAssemblyRequest` 字段。
2. 在 session 映射边界把领域 summary `SessionMessage` 转换为 `SessionMessageRecord` 并写入。
3. 删除/替换旧 active context items。
4. 按顺序插入 `[summaryMessageId] + retainedTailMessageIds`。
5. 递增 `activeContextVersion`。

如果 version 不匹配，返回 `VERSION_CONFLICT`，不得写 summary，也不得替换 active context。

### 3.6 Render 行为

`render()` 遇到 `SUMMARY` message 时，将其渲染为历史摘要上下文，例如：

```text
Conversation summary:
<summary content>
```

渲染 role 应是普通历史上下文角色，不是 `SYSTEM`。summary 不能成为 system prompt、工具声明、附件状态或 runtime slot 的权威来源。

### 3.7 失败和降级

以下情况不得产生半提交：

- summary generator 未配置；
- generator canceled / failed；
- draft 为空或无效；
- commit version conflict；
- commit persistence failure。

失败时 Context Engine 回到已有预算降级路径，并输出 presentation-safe diagnostics。

失败原因由 machine-readable reason code 表达，每个 reason code 与 `add-ts-context-budget-explainability` 之后归档的 reason vocabulary 保持兼容：

- summary generator 未配置 → `SUMMARY_GENERATOR_UNCONFIGURED`；
- generator canceled / failed → `SUMMARY_GENERATION_FAILED`；
- draft 为空或无效 → `SUMMARY_DRAFT_INVALID`；
- commit version conflict → `ACTIVE_CONTEXT_VERSION_CONFLICT`；
- commit persistence failure → `ACTIVE_CONTEXT_PERSISTENCE_FAILED`。

reason code 由 `RedactionPolicy` 等 safe-data 净化口径过滤，不嵌入 raw covered messages / raw prompt / raw tool args / attachment content / credential / local path / 高基数标识。复合失败时由 controlling boundary 的 reason code 决定 ownership。

### 3.8 Runtime 后置对账 checkpoint payload

runtime 端在 `commitCompaction` 成功后写 `CONTEXT_COMPACTED` checkpoint。`CheckpointPayload` 字段与 `agent-contracts/runtime` 已有定义保持一致（`checkpointId` / `sessionId` / `requestId` / `runId` / `requestContextId` / `runVersion` / `triggerReason` / `lastSequence` / `activeContextVersion` / `flowVariables` / `savedAt`）：

- `checkpointId`：新生成的 checkpoint 主键；
- `sessionId` / `requestId` / `runId` / `requestContextId`；
- `runVersion`：RequestRun 已推进为 `EXECUTING` 之后的版本；
- `triggerReason = "CONTEXT_COMPACTED"`；
- `lastSequence`：canonical timeline 最新事件的 sequence；
- `activeContextVersion`：commit 后的最新 `activeContextVersion`，由 evidence 提供；
- `flowVariables`：按 `CheckpointPayload` 设计；
- `savedAt`：verification timestamp。

幂等性不作为 payload 字段：runtime 调用 `CheckpointStoreGateway.saveCheckpoint(record, { idempotencyKey })` 时，通过 write option 传入由 `commitCompaction` 派生的稳定 `idempotencyKey`（与 `agent-contracts/runtime` 一致，`idempotencyKey` 不进入 `CheckpointPayload` / `*Record`）。

恢复时使用 `runVersion` / `lastSequence` / `activeContextVersion` 对账，不依赖旧消息范围推断压缩边界。

### 3.9 命名映射

| 标识 | 类型 | 归属 |
|---|---|---|
| `ContextCompressionEvidence` | DTO 类型 | `agent-contracts/context` |
| `compressionEvidence` | `ContextAssembly` 字段 | `agent-contracts/context` |
| `CONTEXT_COMPACTED_EVIDENCE` | runtime handoff edge label | `agent-contracts/runtime` |
| `CONTEXT_COMPRESSION_SUMMARY` | `SessionMessage.metadata.kind` | `SessionMessage` typed extension |
| `PREFIX_COMPACT_RECENT_TAIL` | compression strategy（locked） | summary metadata |

三者一一对应：`ContextCompressionEvidence.edgeLabel` 锁为 `CONTEXT_COMPACTED_EVIDENCE`，`SessionMessage.metadata.kind` 锁为 `CONTEXT_COMPRESSION_SUMMARY`，`SessionMessage.metadata.strategy` 锁为 `PREFIX_COMPACT_RECENT_TAIL`。

## 4. 数据是怎么流转的

```text
assemble(request)
  -> load ActiveContextView
  -> load active SessionMessage
  -> select current request + eligible prior turns
  -> apply budget/window policy
  -> if prior dropped:
       covered = dropped prior complete-turn prefix
       retainedTail = selected prior tail + current request
       draft = TraceableSummaryGenerationPort.generate(...)
       summaryMessage = build SUMMARY SessionMessage
       commitCompaction(summaryMessage, retainedTail)  // session 映射边界转为 SessionMessageRecord
       reload active context
       assemble selection once again
  -> return ContextAssembly

render(assembly)
  -> reload selected refs
  -> render SUMMARY as historical summary
  -> render USER / ASSISTANT / TOOL messages
  -> render tool schemas
  -> return RenderedModelInput
```

压缩后的权威数据只有：

- append-only `session_messages` 中的原始消息；
- append-only `session_messages` 中的新 summary message；
- `active_context_items` 中的 summary + retained tail；
- summary metadata。

不引入进程内状态、外部 markdown、read-time projection log 或独立 summary store 作为权威来源。

### 4.1 Runtime 后置对账

`commitCompaction` 成功只表示 session message 和 active context 原子提交成功。压缩成功后的 checkpoint、timeline event 和恢复锚点仍由 `agent-runtime` 或 runtime 协调路径拥有。

Context Engine 不写 checkpoint，也不发布 canonical timeline。它只向 runtime 暴露一个 `ContextCompressionEvidence` DTO（edge label = `CONTEXT_COMPACTED_EVIDENCE`），该 DTO 属于 `agent-contracts/context`，包含 `sessionId` / `requestId` / `runId` / `stepId` / `sourceActiveContextVersion` / `targetActiveContextVersion` / `summaryMessageId` / `strategy`（锁定为 `PREFIX_COMPACT_RECENT_TAIL`）/ `coveredMessageRefCount` / `retainedTailRefCount` 和 presentation-safe `safeReason` 原因码。agent-core 从 `ContextEnginePort.assemble(...)` 返回值中的 `ContextAssembly.compressionEvidence` 字段获取该 DTO 后，runtime 通过现有 `CheckpointStoreGateway.saveCheckpoint(record, { idempotencyKey })`（`record.triggerReason = "CONTEXT_COMPACTED"`）和现有 `RunTimelineEventPort.emit(event)`（`CONTEXT_COMPACTED`）写入对账事实；不新增 runtime 专用 compression port。其他边界不得再自己生产或传递 compression evidence。

如果 runtime 后置对账失败，不得回滚已经成功提交的 active context compaction；失败必须按 runtime 的恢复 / observability 规则记录 safe diagnostic，并在后续恢复时以 canonical `session_messages`、`active_context_items` 和 `activeContextVersion` 为准。

## 5. 下一步的处理是谁

本 change 下一步实施责任分配：

  - 变更确认：`TraceableSummaryGenerationPort`、`TraceableSummaryGenerationRequest` 和 `TraceableSummaryDraft` 的 public DTO shape 由 `refine-ts-context-assembly-contracts` 冻结并归属 `agent-contracts/context`；本 change 只消费这些冻结契约，因为调用方是 Context Engine 的 summary compression 编排路径。具体生成实现由 `agent-context-engine` 或 app composition 注入，不进入 contracts。
  - 变更确认：该 port 只返回 summary draft，不拥有 active context、session persistence、checkpoint、timeline、runtime lifecycle 或 compression commit。
  - 变更确认：`ContextCompactionCommitRequest` 继续使用已冻结 gateway commit 语义；本 change 不新增平行 commit request、并发控制或持久化 owner。
  - 变更确认：`SUMMARY` metadata 作为 `SessionMessage.metadata: JsonObject` 的 typed extension 读取和校验，不把 `SessionMessage.metadata` 收窄为只接受 summary metadata。
  - 变更确认：`requestId` 表示当前 root user request identity；本 change 不新增 `rootMessageId`，也不修改 `ContextAssemblyRequest` 的 location + intent 边界。
  - 变更确认：该 DTO 的字段 shape 锁定在 `specs/traceable-summary-generation/spec.md`（包含 `TraceableSummaryGenerationRequest` 必备字段、`coveredMessages` 序列化规则、port 取消语义和 JSON-compatible 校验规则）；上游 change 已有的 `Traceable Summary Generation SHALL include minimal traceability fields` 要求留在被提供 requirements 作为该 shape 的 behavioral anchor。
  - 变更确认：`ContextCompressionEvidence` DTO 同样由 `refine-ts-context-assembly-contracts` 冻结并归属 `agent-contracts/context`，这是 runtime handoff 的 single contract surface。DTO 字段：`sessionId` / `requestId` / `runId` / `stepId` / `sourceActiveContextVersion` / `targetActiveContextVersion` / `summaryMessageId` / `strategy`（locked to `PREFIX_COMPACT_RECENT_TAIL`）/ `coveredMessageRefCount` / `retainedTailRefCount` / `safeReason` / `edgeLabel`（locked to `CONTEXT_COMPACTED_EVIDENCE`）；字段 shape 锚定到 `refine-ts-context-assembly-contracts` 和本 change 的 `specs/context-engine/spec.md` 的 `Evidence is produced after a successful commit` scenario。DTO 必须 JSON-compatible、schema/type guard 校验、不嵌入 raw covered messages / raw prompt / raw tool args / raw tool result / attachment content / credential / local path / 高基数标识。运行时 handoff 路径收敛为清晰唯一一条：agent-core 收到 `ContextEnginePort.assemble(...)` 返回值中的 `ContextAssembly.compressionEvidence` 后，runtime 通过现有 `CheckpointStoreGateway.saveCheckpoint(record, { idempotencyKey })`（`record.triggerReason = "CONTEXT_COMPACTED"`）和现有 `RunTimelineEventPort.emit(event)`（`CONTEXT_COMPACTED`）写入对账事实；不新增 runtime 专用 compression port，也不在 runState 上新增 `recordCompression`。本 change 不再保留 “`ContextAssembly.compressionEvidence` 字段或等价 single surface” 的开放表述；不引入 `lastCompressionEvidence(...)` lookup 或运行时 read-back fallback helper。
  - 变更确认：不管是 `TraceableSummaryGeneration*` 还是 `ContextCompressionEvidence`，默认以 `kind` / `edgeLabel` 字符串传递 evidence label（`CONTEXT_COMPRESSION_SUMMARY`、`CONTEXT_COMPACTED_EVIDENCE`），不从 `agent-common` 创建新 enum；后续若要 `agent-common` 提出相应 enum 时，必须自己提出 contract refinement change。
  - 变更确认：本 change 作为 contract refinement prelude，向 `agent-contracts/context` 提出 DTO 字段 shape、`compression evidence surface`、`edgeLabel` 值。与其他修改已有 public contract 的命令一起，这些 DTO 增量属于由未来 `agent-contracts` contract refinement change 拱入 baseline 的要点之一。当下次进行更大动作的 `agent-contracts` 改成 baseline 时，必须先提出与之具配的 contract refinement change。
  - 定义 summary generation port 和 DTO。
- `agent-context-engine`
  - 接入 assemble 阶段 summary compression。
  - 校验 draft、构造 summary message、处理 fallback。
  - render summary message。
- `agent-platform-gateway-local`
  - 实现真实 `commitCompaction` 事务。
- `agent-runtime`
  - 在 compression commit 成功后拥有 checkpoint / timeline 对账，不把 runtime lifecycle 状态写入 `ContextCompactionCommitRequest`。
- 测试
  - 覆盖 summary commit、render、boundary、conflict、invalid draft、source message append-only、runtime post-compaction checkpoint/timeline handoff。

## 6. 平行 change 边界

本 change 与其他 active 的微关联 change 共享 boundary，这些 change 的 contract 变更不能摆动本 change 的设计路径，依赖顺序由 roadmap 通过 `nextagent-ts-change-roadmap-v2.md` 记录。本 change 不扩张对其他平行 change 的 public contract 作新增。平行 boundary 列表：
  - `add-ts-traceable-summary-generation`：提供 `TraceableSummaryGenerationPort.generate(...)` 的默认实现。本 change 作为 summary draft 的 consumer，不持久化草稿。
  - `add-ts-context-budget-explainability`：提供 Query Policy 的 prior-history pressure evidence 作本触发。本 change 使用该 evidence 决定是否开始 summary compression，不修改 explainability 字段语义。
  - `add-ts-context-history-selection`：提供 `selectHistoryCandidates(...)` 返回的合格 prior complete-turn prefix 作为 covered range。
  - `add-ts-large-content-references`：提供 covered messages 中已有的 large-content replacement 形式。本 change 消费该 replacement 作为 frozen model-visible 形式，不重新内联外部大内容。
  - `add-ts-attachment-intake`：不在本 change 消费边界；covered messages 中受附件引用投影、检索规则影响，该 change 自身为 `latest-request-required attachment context` 提供提示。
上述平行 change 的 boundary 变更必须先经由 contract refinement change 确认，不得直接重写本 change 的路径。

**单 owner 边界确认**：

- `ContextCompressionEvidence` 构造与暴露：由 `agent-context-engine` 拥有（port / DTO owning，从 `agent-contracts/context` 导出）；不允许任何其他模块构造该 DTO。
- evidence 读取与 checkpoint / timeline 写入：由 `agent-runtime` 拥有；runtime 端复用现有 `CheckpointStoreGateway.saveCheckpoint(record, { idempotencyKey })`（`record.triggerReason = "CONTEXT_COMPACTED"`）和现有 `RunTimelineEventPort.emit(event)` 入口写入对账事实，不新增 runtime 专用 compression port，不允许其他模块直接写 `CONTEXT_COMPACTED` checkpoint。
- runtime 不得直接 import `agent-context-engine` 的 evidence builder / summary builder / port 实现类；runtime 只能通过 `agent-contracts/context` 读取 DTO 定义。
- context-engine 不得 import `agent-runtime` 的 checkpoint writer / timeline writer / canonical timeline emitter / runtime lifecycle state 实现类。
- `lint:architecture` 必须增加 `no-context-engine-runtime-state-write` 和 `no-runtime-context-engine-write` 两个依赖规则，阻断模块双向错误 / 越位 import。
明确不在本 change 里继续处理：任何超出 summary compression 最小闭环的压缩增强、SessionMemory snapshot / pre-extraction worker、long-term memory 集成、MicroCompact / Full Compact 分层流水线、后台维护触发器或跨模块集成能力。需要时由后续 change 重新提出黑盒目标、规格和任务。
