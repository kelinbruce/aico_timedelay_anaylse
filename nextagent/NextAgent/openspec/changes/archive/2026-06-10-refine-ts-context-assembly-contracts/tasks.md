## 1. 契约更新（Contract Updates）

- [x] 1.1 保留 `ContextAssemblyRequest.requestId` 作为当前根用户请求身份，并断言没有新增 `rootMessageId`。
- [x] 1.2 保留 public 的 `SystemPromptSection.sectionId`；新增受治理的 prompt-shaping metadata，不把它重命名为 `sectionKey`。
- [x] 1.3 在 `agent-contracts/context` 中新增或 refine `TraceableSummaryGenerationPort`、`TraceableSummaryGenerationRequest` 和 `TraceableSummaryDraft`。
- [x] 1.4 在 `agent-contracts/context` 中新增或 refine `ContextCompressionEvidence` 和 `ContextAssembly.compressionEvidence`。
- [x] 1.5 为 `CONTEXT_COMPACTED` 事实复用既有的 runtime/gateway contracts（`CheckpointStoreGateway.saveCheckpoint(record, options)`，其中 `record.triggerReason = "CONTEXT_COMPACTED"`，加上既有的 timeline 入口 `AgentRunStatePort.emitEvent(run, context, event)` 和 `RunTimelineEventStoreGateway.appendEvent(record, options)`）；断言 `agent-contracts/runtime` 中没有新增 runtime 专属的 compression port（`RuntimeCompressionReconciliationPort.recordCompression(...)`）。
- [x] 1.6 在 `agent-contracts/session` 中新增或 refine `SessionMessage.metadata.replacement` 和 `replacement-evidence.schema.json`。

## 2. 契约测试（Contract Tests）

- [x] 2.1 契约测试断言 `SystemPromptSection.sectionId` 保持 public，且 public contracts 不要求任何 `sectionKey` 替代品。
- [x] 2.2 契约测试断言 compression 与 summary generation 实现从 `agent-contracts/context` 导入摘要生成 DTO。
- [x] 2.3 契约测试断言压缩证据只通过 `ContextAssembly.compressionEvidence` 跨边界。
- [x] 2.4 契约测试断言 runtime 通过既有的 `CheckpointStoreGateway.saveCheckpoint(record, options)`（`record.triggerReason = "CONTEXT_COMPACTED"`）和既有的 timeline 入口（`AgentRunStatePort.emitEvent` / `RunTimelineEventStoreGateway.appendEvent`）写入 `CONTEXT_COMPACTED` 事实，且没有引入 runtime 专属的 compression port。
- [x] 2.5 契约测试断言替换证据 schema 属于 `agent-contracts/session` 并被大内容 references 使用。

## 3. 架构门禁（Architecture Gates）

- [x] 3.1 架构 lint 阻止 runtime 导入 context-engine 的 evidence builder 或 summary builder。
- [x] 3.2 架构 lint 阻止 context-engine 直接写 runtime checkpoint 或 canonical timeline 事实。
- [x] 3.3 架构 lint 阻止对新契约 DTO 和 schema 的 private-path import。

## 4. 验证（Validation）

- [x] 4.1 运行 `openspec validate refine-ts-context-assembly-contracts --strict`。
- [x] 4.2 运行 `openspec validate --all --strict`。
