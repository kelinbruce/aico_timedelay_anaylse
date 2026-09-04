## 黑盒目标

- prior active-context history 超过安全预算时，Context Engine 在 `assemble()` 阶段把它压成一条 SUMMARY 消息并原子提交。
- 模型最终看到：system prompt + 较旧历史 summary + 近期未压缩 tail + 当前请求 + tools。
- 当前请求与已选 prior tail 永远不被摘要覆盖或省略。
- 摘要边界严格按完整 turn / 完整 tool pair 切分，绝不拆分。
- 通过 `ActiveContextStoreGateway.commitCompaction` 在一个原子边界内完成提交；版本冲突时绝不留半提交状态。
- 任一环节（generator / 校验 / commit）失败必须回退到现有预算降级路径并输出 presentation-safe 诊断。
- 压缩 fallback 必须输出 machine-readable reason code 与 `add-ts-context-budget-explainability` 之后归档的 reason vocabulary 保持兼容；包括 SUMMARY_GENERATOR_UNCONFIGURED / SUMMARY_GENERATION_FAILED / SUMMARY_DRAFT_INVALID / ACTIVE_CONTEXT_VERSION_CONFLICT / ACTIVE_CONTEXT_PERSISTENCE_FAILED 五个 reason code（report 不得继承 raw covered messages / raw prompt / raw tool args / attachment content / credential / local path / 高基数标识）。
- 压缩 reason code 诊断由 `RedactionPolicy` 等 safe-data 净化口径过滤；不同 reason code 必须显示失败类型、关键 boundary 和 owning module 的安全类别。
- 当发生 reason code 复合失败时（例如 generator failure 与 commit conflict 同时触发），最终 reason code 由 controlling boundary 决定：以触发该失败的 boundary module 的 reason code 为准（例如 `commitCompaction` 的 version conflict 由 commit handler 拥有 ownership）。该 reason code 仍受同一净化口径约束，不得继承 raw payload。
- failure reason code 在 summary message metadata 与 `ContextCompressionEvidence.safeReason` 之间复用同一套 reason code，但不可以 reason code 代替 failure detection 本身。
- 接收 generator failure / draft invalid / commit conflict 使用 reason code，避免在系统 reason vocabulary 与 enum helper 间导航。
- 如果下一步修改需要将 reason code 引入 `agent-common`，必须由自身提出 contract refinement change；不让本 change 的范围提前占据基础 enum 位置。
- 压缩后的上下文可从 `session_messages` / `active_context_items` / summary metadata 重新加载；process-local 状态不作为权威来源。
- 压缩 commit 成功后，runtime 或 runtime 协调路径必须记录 `CONTEXT_COMPACTED` checkpoint / timeline 对账事实；Context Engine 不拥有 runtime checkpoint 或 canonical timeline。

## 2. 解决的问题是什么

`add-ts-context-budget-explainability` 已经能解释 prior history 超预算，但当前实现主要是省略较早历史。这样会产生两个问题：

- 用户仍期待系统记得前面排障结论、网络对象、工具结果和上下文状态，但模型实际看不到。
- 预算 diagnostics 能说明“丢了历史”，却没有提供“把历史压缩成可继续使用状态”的持久闭环。

本 change 解决的是最小 summary compression 闭环：当 prior active-context history 超预算时，Context Engine 在 `assemble()` 中把合法的较早历史 prefix 压成 summary message，并通过 active context 原子提交，让后续 assemble/render 都消费这个已提交状态。

## 3. 核心设计和规格

本 change 的核心规格是：

- summary compression 发生在 `assemble()`，因为 assemble 负责加载 active context、选择历史、应用预算、产生 diagnostics。
- `render()` 不做压缩决策，只把 `assemble()` 已选中的 summary message 渲染成历史摘要上下文。
- 压缩只覆盖 prior active-context history，不覆盖 current request、system prompt、工具声明、runtime context、附件描述或 memory disclosure。
- 压缩边界只能来自已通过 history selection 的完整 turn，不得拆 assistant tool-use / capability-result pair。
- summary 作为 append-only `SessionMessage`（领域对象）构造，并在 `commitCompaction` 时经 session 映射边界持久化为 `SessionMessageRecord`：
  - `role = "SUMMARY"`
  - `contentType = "PLAIN_TEXT"`
  - `metadata.kind = "CONTEXT_COMPRESSION_SUMMARY"`
  - `metadata.strategy = "PREFIX_COMPACT_RECENT_TAIL"`
- active context 提交后形态为：

```text
[summaryMessageId] + retainedTailMessageIds
```

- 不新增独立 summary store，不修改原始 `SessionMessage.content`。
- 压缩成功后的 checkpoint / timeline 对账由 runtime owner 接入，Context Engine 只提供 summary commit 结果和 presentation-safe evidence。
- 超出 summary compression 最小闭环的能力不在本 change 中实现；需要时由后续 change 重新提出规格。本 change 不引入 SessionMemory snapshot、pre-extraction worker、long-term memory 集成、MicroCompact/Full Compact 分层流水线或后台维护触发器。

## 4. 数据是怎么流转的

数据流如下：

```text
ContextAssemblyRequest
  -> ActiveContextStoreGateway.loadActiveContext
  -> SessionMessageStoreGateway.loadMessage
  -> selectHistoryCandidates
  -> applyHistoryWindowPolicy
  -> TraceableSummaryGenerationPort.generate
  -> build SUMMARY SessionMessage
  -> ActiveContextStoreGateway.commitCompaction
  -> runtime-owned post-compaction checkpoint/timeline reconciliation
  -> reload ActiveContextView
  -> re-run selection
  -> ContextAssembly
  -> render
  -> RenderedModelInput
```

更具体地说：

1. `assemble()` 读取当前 active context 和对应 `SessionMessage`（领域 read model）。
2. history selection 选出 current request records 和 eligible prior turns。
3. `ContextBudgetPolicyPort` 产出 `ContextCompactionPlan`，若 `plan.decision == compact-degrade` 则触发 summary compression。
4. Context Engine 选择被丢弃的完整 prior-turn prefix 作为 covered messages。
5. Context Engine 调用 `TraceableSummaryGenerationPort.generate(...)` 生成 summary draft。
6. Context Engine 校验 draft 非空且可安全持久化。
7. Context Engine 构造 `SUMMARY` `SessionMessage`（领域对象）。
8. Gateway 用 `commitCompaction(...)` 在一个原子边界里写入 summary message，并把 active context 替换为 summary + retained tail。
9. Context Engine 重新加载 active context 并重新 assemble。
10. `render()` 看到 summary message 后，把它渲染成普通历史摘要上下文，而不是 system authority。

## 5. 下一步的处理是谁

- `agent-contracts/context`
  - 消费由 `refine-ts-context-assembly-contracts` 冻结的 `TraceableSummaryGenerationPort`、request DTO 和 draft DTO；本 change 不重新拥有这些 public DTO shape。
  - 消费由 `refine-ts-context-assembly-contracts` 冻结的 `ContextCompressionEvidence` DTO，作为 runtime handoff 的唯一 single contract surface 暴露点（字段 shape 锚定到 `refine-ts-context-assembly-contracts` 与本 change `specs/context-engine/spec.md` 的 `Evidence is produced after a successful commit` scenario；JSON-compatible、schema/type guard 校验，不嵌入 raw covered messages / raw prompt / raw tool args / raw tool result / attachment content / credential / local path / 高基数标识）。
  - `SessionMessage.metadata` 保持 JSON-compatible；`SUMMARY` metadata 以 `kind: "CONTEXT_COMPRESSION_SUMMARY"` / `strategy: "PREFIX_COMPACT_RECENT_TAIL"` 形式扩展。
  - 不新增 `rootMessageId`；`requestId` 仍表示当前 root user request identity。
- `agent-context-engine`
  - 在 `assemble()` 中拥有 summary compression 编排。
  - 构造和校验 summary message。
  - 在 `render()` 中渲染已提交的 `SUMMARY` message。
- `agent-platform-gateway-local`
  - 把当前 no-op 的 `commitCompaction` 改成真实事务：写 summary message、替换 active context items、递增 active context version。
- `agent-contracts/runtime`
  - 不新增 runtime 专用 compression port；`CONTEXT_COMPACTED` 只是 checkpoint/timeline 的一种 trigger，复用该 subpath 已有的 `CheckpointStoreGateway.saveCheckpoint(record, options)`（`CheckpointPayload`）和 `RunTimelineEventPort.emit(event)`（`TimelineEvent`）作为写入入口。
- `agent-runtime`
  - agent-core 收到 `ContextEnginePort.assemble(...)` 返回值中的 `ContextAssembly.compressionEvidence` 后，runtime 通过现有 `CheckpointStoreGateway.saveCheckpoint(record, { idempotencyKey })`（`record.triggerReason = "CONTEXT_COMPACTED"`）和现有 `RunTimelineEventPort.emit(event)`（`CONTEXT_COMPACTED`）写入对账事实。
  - 接收路径收敛为清晰唯一一条：agent-core 从 `ContextAssembly.compressionEvidence` 取得 evidence 并触发上述现有 runtime 入口；不再保留 “等价 single contract surface” 等开放表述；不引入 `lastCompressionEvidence(...)` lookup 或运行时 read-back fallback helper。
  - 在 compression commit 成功后记录 runtime-owned checkpoint / timeline 对账事实，并保持 canonical timeline ownership。
- `add-ts-traceable-summary-generation`
  - 后续负责真实 LLM summary prompt、模型调用和输出解析。本 change 只定义并消费 port，可用 fake port 测试。
  - **跨 change 锚定条件**：两个 change 共享 `TraceableSummaryGenerationRequest` / `TraceableSummaryDraft` 的 DTO shape。该 shape 由 `refine-ts-context-assembly-contracts` 锁定；当任一实现 change 需要调整 `coveredMessages` 序列化规则、port 取消语义、invalid draft 判定等 shape 级字段时，必须先更新契约细化 change 或另开 `agent-contracts` contract refinement change。
  - **跨 change 验证事项**：本 change 归档前必须使 `TraceableSummaryGenerationPort` 使用隔离的 fake 实现与 `add-ts-traceable-summary-generation` 的 real 实现同时完成 commit 验证；不论哪一个先归档，另一个 change 必须同时复验 port 调用的 `assemble()` + `commitCompaction` 版本仍依赖 traceable-summary-generation 的 shape 表达。
  - **归档先后策略**：本 change 倾向于在 `add-ts-context-budget-explainability` / `add-ts-context-history-selection` / `add-ts-large-content-references` 之后、`add-ts-traceable-summary-generation` 之前完成归档，但允许同时或后归档；这取决于 traceable-summary-generation 的 real implementation 是否在同 release 提供。
  - **编译实现隔离**：本 change 服务的 assemble 阶段 default 实现必须禁用 `add-ts-traceable-summary-generation` 的 real implementation 已经在 `packages/agent-context-engine/src/summary/**` 路径部署的代码；其他代码用 `try-catch` 写为选中 fail-fast 形式，不使用 process-local 编译期 mock；real implementation 装配必须通过 app composition 获得。
  - 当 `add-ts-traceable-summary-generation` 归档时 real implementation 仍以 trigger reason 或 generator port configuration 使用隔离 fake port 时，本 change 当前范围决定继续使用 fake。
- 后续独立 changes
  - 超出本 change 的压缩增强、恢复增强、SessionMemory snapshot、后台 extraction 或跨模块集成能力，必须由后续 change 重新提出黑盒目标、规格和任务。
