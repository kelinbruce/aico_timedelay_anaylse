## 背景与问题（Why）

当前 context assembly 的 change 集合允许多个实现类 change 定义或重塑同一批 public contracts：

- `SystemPromptSection.sectionId` vs `sectionKey`
- `TraceableSummaryGenerationPort` 与摘要 DTO 的所有权
- `ContextCompressionEvidence` 与 runtime reconciliation 交接
- `SessionMessage.metadata.replacement` 与替换证据 schema
- `ContextAssemblyRequest.requestId` vs `rootMessageId`

这些契约影响 `agent-contracts/context`、`agent-contracts/runtime` 和 `agent-contracts/session`。它们必须在实现类 change 消费之前先被一次性 refine。

## 变更范围（What Changes）

- 冻结 `ContextAssemblyRequest.requestId` 作为当前根用户请求身份。不新增 `rootMessageId`。
- 保留 public 的 `SystemPromptSection.sectionId` 作为 canonical 分区标识符。Prompt shaping 可以新增受治理的 source/order metadata，但不得把 public key 重命名为 `sectionKey`。
- 为 `TraceableSummaryGenerationPort`、`TraceableSummaryGenerationRequest` 和 `TraceableSummaryDraft` 定义唯一 owner：`agent-contracts/context`。
- 定义唯一的 compression evidence surface：`ContextAssembly.compressionEvidence?: ContextCompressionEvidence`。
- 为 `CONTEXT_COMPACTED` 对账事实复用既有的 runtime checkpoint/timeline contracts（`CheckpointStoreGateway.saveCheckpoint(record, options)`，其中 `record.triggerReason = "CONTEXT_COMPACTED"`，以及 `RunTimelineEventPort.emit(event)`）。不引入 runtime 专属的 compression port。
- 为大内容替换证据定义唯一 owner：`agent-contracts/session`，包括 stable 的 `SessionMessage.metadata.replacement` shape 和 `replacement-evidence.schema.json`。

## Capability 影响（Capabilities）

- 新增 `context-assembly-contracts` 作为契约 refinement capability。
- 不实现历史选择、prompt 渲染、压缩、摘要生成或大内容 offload 行为。

## 影响范围（Impact）

- `add-ts-context-prompt-shaping` 消费冻结的 `SystemPromptSection.sectionId` 契约，而不是重命名它。
- `add-ts-context-compression` 消费在此冻结的摘要/证据/runtime 契约，而不是自己拥有这些 shape。
- `add-ts-traceable-summary-generation` 只拥有 generator 行为；它消费在此冻结的摘要 DTO。
- `add-ts-large-content-references` 只拥有 offload 行为；它消费在此冻结的 session 替换证据契约。

## 归档前基线提升计划（Baseline Promotion Plan）

实现并验证后，把这些契约 refinement 提升到：

- `openspec/specs/context-assembly-contracts/spec.md`
- `openspec/designs/architecture/core-contracts.md`
- `openspec/designs/contracts/context-spi.md`
- `openspec/designs/contracts/runtime-spi.md`
- `openspec/designs/contracts/session-spi.md`
