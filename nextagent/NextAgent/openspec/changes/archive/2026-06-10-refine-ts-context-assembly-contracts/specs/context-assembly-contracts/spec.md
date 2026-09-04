## ADDED Requirements

### Requirement: Context assembly 请求使用唯一请求标识

Context assembly 契约 SHALL 使用 `ContextAssemblyRequest.requestId` 作为当前根用户请求的 canonical 标识。它们 SHALL NOT 引入 `rootMessageId` 作为同义词或替代。

#### Scenario: 渲染当前请求
- **WHEN** context 渲染需要当前请求消息
- **THEN** 它使用 `requestId` 从已受理的 request/session 边界解析该消息
- **AND** `ContextAssemblyRequest` 不要求也不接受任何 `rootMessageId` 字段

### Requirement: SystemPromptSection 保持 sectionId

`SystemPromptSection.sectionId` SHALL 保持为公开稳定的 section 标识符。Prompt shaping MAY 添加受治理的 section 元数据（例如 `source` 和 `order`），但 SHALL NOT 将该公开标识符改名为 `sectionKey`。

#### Scenario: Prompt shaping 消费 section 标识
- **WHEN** prompt shaping 组装或渲染 SystemPrompt section
- **THEN** 它使用来自 `agent-contracts/context` 的公开 `sectionId` 标识
- **AND** 任何实现本地的模板 key 都以私有方式派生，不作为替代性的公开 contract 字段

### Requirement: Summary generation DTO 具有唯一 owner

`TraceableSummaryGenerationPort`、`TraceableSummaryGenerationRequest` 和 `TraceableSummaryDraft` SHALL 由 `agent-contracts/context` 拥有。Context compression 与 traceable summary generation 实现 SHALL 从该 owner 消费这些 DTO，并 SHALL NOT 定义平行形状。`TraceableSummaryDraft` SHALL 只是携带内容以及 presentation-safe 可追溯元数据的内部 port DTO；它 SHALL NOT 成为可持久化的 message 对象，generator SHALL NOT 返回可持久化的 message。Context compression SHALL 复用既有的领域 summary `SessionMessage` 机制，取 `draft.content` 构造领域 `SUMMARY` `SessionMessage`。

#### Scenario: 压缩调用 summary generation
- **WHEN** context compression 调用 summary generator
- **THEN** request 与 draft DTO 来自 `agent-contracts/context`
- **AND** generator 实现不重新定义这些 DTO
- **AND** generator 返回 `TraceableSummaryDraft` 而不是可持久化的 message 对象
- **AND** context compression 用 `draft.content` 构造领域 `SUMMARY` `SessionMessage`

### Requirement: 压缩证据具有唯一 handoff surface

`ContextCompressionEvidence` SHALL 由 `agent-contracts/context` 拥有。成功压缩证据唯一的跨边界 surface SHALL 是 `ContextAssembly.compressionEvidence`。

#### Scenario: Runtime 协调一次 compaction
- **WHEN** context assembly 返回压缩证据
- **THEN** runtime 从 `ContextAssembly.compressionEvidence` 读取它
- **AND** 不使用任何等价的替代 surface、lookup fallback 或 runtime read-back helper

### Requirement: Runtime 拥有压缩协调

`CONTEXT_COMPACTED` 协调事实 SHALL 复用 `agent-contracts/runtime` 和 `agent-contracts/gateway` 中既有的 runtime 契约：带 `record.triggerReason = "CONTEXT_COMPACTED"` 的 `CheckpointStoreGateway.saveCheckpoint(record, options)`，以及既有的 timeline entry points（runtime 执行路径上的 `AgentRunStatePort.emitEvent(run, context, event)` 和 canonical timeline 持久化路径上的 `RunTimelineEventStoreGateway.appendEvent(record, options)`）。本次 refinement SHALL NOT 引入 runtime 专用的压缩 port（不引入 `RuntimeCompressionReconciliationPort.recordCompression(...)`）。Runtime SHALL 在 context compaction 成功后拥有 checkpoint 与 canonical timeline 协调。Context Engine SHALL NOT 直接写 runtime checkpoint 或 canonical timeline 事实。

#### Scenario: 压缩提交成功
- **WHEN** Context Engine 报告 `ContextCompressionEvidence`
- **THEN** agent-core 从 `ContextAssembly.compressionEvidence` 转发它，runtime 通过既有的 `CheckpointStoreGateway.saveCheckpoint(record, options)`（`record.triggerReason = "CONTEXT_COMPACTED"`）和既有的 timeline entry points（`AgentRunStatePort.emitEvent` / `RunTimelineEventStoreGateway.appendEvent`）记录该协调
- **AND** 不引入任何 runtime 专用的压缩 port
- **AND** Context Engine 不导入 runtime checkpoint writer 或 canonical timeline emitter

### Requirement: Session 拥有大内容替换证据

稳定的大内容替换证据 shape、reason vocabulary、`SessionMessage.metadata.replacement` 和 `agent-contracts/session/replacement-evidence.schema.json` SHALL 由 `agent-contracts/session` 拥有。

#### Scenario: 大内容被外置
- **WHEN** 大内容引用替换模型可见的 message 内容
- **THEN** 替换证据符合 session 拥有的 schema
- **AND** 任何实现变更都不得为同一证据创建第二个 schema owner 或稳定导出路径
