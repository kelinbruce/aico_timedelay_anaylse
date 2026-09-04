## 契约决策（Contract Decisions）

### Request 身份（Request Identity）

`ContextAssemblyRequest.requestId` 是 context assembly 与渲染中当前根用户请求的 canonical 身份。本次 refinement 不引入 `rootMessageId`。

### SystemPrompt 分区身份（SystemPrompt Section Identity）

`SystemPromptSection.sectionId` 保持为 core contracts 的 public stable 分区标识符。Prompt shaping 可以在本次 refinement 之后新增顶层 `source` 与 `order` metadata，但不得把 `sectionId` 重命名为 `sectionKey`。

如果某个实现需要内部 template key，必须从 `sectionId` 派生该 key，或把它保留在 prompt-template 私有数据内。它不能作为 `sectionId` 的替代品跨越 `agent-contracts/context` 的 public 边界。

### 摘要生成 DTO（Summary Generation DTOs）

`agent-contracts/context` 拥有：

- `TraceableSummaryGenerationPort`
- `TraceableSummaryGenerationRequest`
- `TraceableSummaryDraft`

traceable summary generation 的实现消费这些 DTO 并提供 generator 行为。它不得创建平行的 DTO shape。

`TraceableSummaryDraft` 是 Context Engine 消费的内部 port DTO。它只承载摘要内容以及 presentation-safe 的 traceability metadata；它不是可持久化的 message 对象。持久化的摘要复用既有的领域摘要 `SessionMessage` 机制：Context Engine 取 `draft.content` 构造领域 `SUMMARY` `SessionMessage`，并通过 `ActiveContextStoreGateway.commitCompaction(...)` 提交。generator MUST NOT 返回可持久化的 message，也不引入平行的 message 对象。

### 压缩证据（Compression Evidence）

`agent-contracts/context` 拥有 `ContextCompressionEvidence`。

唯一的跨边界证据面是：

```ts
ContextAssembly.compressionEvidence?: ContextCompressionEvidence
```

不存在等价的替代 surface，没有 `lastCompressionEvidence(...)` 查询 fallback，也没有针对该证据的运行时 read-back helper。

### 运行时对账（Runtime Reconciliation）

`CONTEXT_COMPACTED` 只是 checkpoint/timeline 事实的一个触发原因。它复用 `agent-contracts/runtime` 中既有的 runtime contracts：

```ts
CheckpointStoreGateway.saveCheckpoint(
  record, // record.triggerReason = "CONTEXT_COMPACTED"
  { idempotencyKey }
): Promise<...>

// canonical timeline reconciliation reuses the existing timeline entry points:
AgentRunStatePort.emitEvent(run, context, event): Promise<void>          // runtime execution path
RunTimelineEventStoreGateway.appendEvent(record, options?): Promise<...> // canonical timeline persistence path
```

本次 refinement 不引入 runtime 专属的 compression port（没有 `RuntimeCompressionReconciliationPort.recordCompression(...)`）。context compaction 成功后，由 runtime 负责 checkpoint 与 canonical timeline 的对账。Context Engine 不得直接写 runtime checkpoint 或 canonical timeline 事实；agent-core 转发 `ContextAssembly.compressionEvidence`，runtime 通过上述既有入口写入该事实。

### 大内容替换证据（Large-Content Replacement Evidence）

`agent-contracts/session` 拥有：

- stable 的 `SessionMessage.metadata.replacement` shape
- 替换原因词汇表
- `agent-contracts/session/replacement-evidence.schema.json`

大内容 reference 实现在外置内容时消费该契约。它不定义第二个 schema owner，也不在 `agent-contracts/session` 之外定义新的 stable export subpath。

## 被否决的备选方案（Rejected Alternatives）

- 把 `sectionId` 重命名为 `sectionKey`：否决，因为 `sectionId` 已在 core contracts 中冻结，下游 public contract 用户不得因实现变更而被破坏。
- 让 compression 与 traceable summary generation 各自定义 `TraceableSummaryDraft`：否决，因为这会给同一个 DTO 造成相互竞争的 owner。
- 在 `ContextAssembly.compressionEvidence` 之外新增第二个或替代的 compression-evidence surface（例如 `lastCompressionEvidence(...)` 查询或 runtime read-back helper）：否决，因为 runtime 对账需要一条可审计的交接路径。
- 新增 `rootMessageId`：否决，因为 `requestId` 已经承载当前根用户请求身份。
