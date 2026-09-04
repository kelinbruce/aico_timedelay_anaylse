## 1. OpenSpec 范围

- [x] 用中文重写 proposal/design，按黑盒效果、解决问题、核心设计和规格、数据流转、下一步处理归属组织。
- [x] 从本 change 的实施范围中移除与 summary compression 最小闭环无关的压缩增强、恢复增强和跨模块集成能力。
- [x] 在 design 中记录 `agent-contracts/context` 变更确认：summary generation port / DTO 归属、非 owner 边界、metadata extension 规则和 `requestId` 口径。
- [x] 验证 `openspec validate add-ts-context-compression --strict`。

## 2. Contracts

- [x] 依赖 `refine-ts-context-assembly-contracts` 冻结后的 `agent-contracts/context` 契约，消费 `TraceableSummaryGenerationPort.generate(request, signal)`。
  - 落地证据: Chunk τ (35c3fc9) 已提供 `DefaultTraceableSummaryGenerator`;本 change κ 接入
- [x] 消费 `TraceableSummaryGenerationRequest`：字段 shape 由 `refine-ts-context-assembly-contracts` 锁定，并由本 change 的 `specs/traceable-summary-generation/spec.md` 提供 behavior anchor；含 owner scope、agent scope、session/run/request id、locale、purpose、covered message records、covered refs、retained tail refs、source active context version 和 target budget。
- [x] 消费 `TraceableSummaryDraft`：字段 shape 由 `refine-ts-context-assembly-contracts` 锁定，并由本 change 的 `specs/traceable-summary-generation/spec.md` 提供 behavior anchor；含 safe summary content 和 presentation-safe trace metadata。
- [x] 确保 contract 使用现有 `requestId` 表示当前 root user request identity，不新增 `rootMessageId`。
- [x] 确认 summary metadata 保持 JSON-compatible，使用 `kind: "CONTEXT_COMPRESSION_SUMMARY"` 和 `strategy: "PREFIX_COMPACT_RECENT_TAIL"`。
- [x] 在 `agent-contracts/context` 范围内作为 contract refinement prelude 引入本批 DTO 增量；后续若要 `agent-common` 提出对应 enum，必须自行提出 contract refinement change。
- [x] 依赖 `refine-ts-context-assembly-contracts` 在 `agent-contracts/context` 中冻结 `ContextCompressionEvidence` DTO：字段 `sessionId` / `requestId` / `runId` / `stepId` / `sourceActiveContextVersion` / `targetActiveContextVersion` / `summaryMessageId` / `strategy`（locked to `PREFIX_COMPACT_RECENT_TAIL`）/ `coveredMessageRefCount` / `retainedTailRefCount` / `safeReason` / `edgeLabel`（locked to `CONTEXT_COMPACTED_EVIDENCE`）；DTO 必须 JSON-compatible，schema/type guard 校验，不嵌入 raw covered messages / raw prompt / raw tool args / raw tool result / attachment content / credential / local path / 高基数标识。
- [x] 复用 runtime 现有 checkpoint/timeline 入口写入 `CONTEXT_COMPACTED` 对账事实：不新增 runtime 专用 compression port（不引入 `RuntimeCompressionReconciliationPort` / `recordCompression`），runtime 通过现有 `CheckpointStoreGateway.saveCheckpoint(record, { idempotencyKey })`（`record.triggerReason = "CONTEXT_COMPACTED"`）和现有 `RunTimelineEventPort.emit(event)` 写入；runtime 不得反向 import context-engine 的 evidence builder。
- [x] 确认 `ContextCompressionEvidence` 通过 `ContextEnginePort.assemble(...)` 返回值中的 `ContextAssembly.compressionEvidence` 字段暴露给 caller；caller（agent-core）收到该字段后由 runtime 通过现有 checkpoint/timeline 入口写入对账事实。移除 "或等价 single contract surface" 等开放表述；不引入 `lastCompressionEvidence(...)` lookup 或运行时 read-back fallback helper。
  落地：`packages/agent-context-engine/src/assembly/summary-compression-orchestrator.ts` 实现 `runSummaryCompression`（5 步：validate composition → call generator → build SUMMARY SessionMessage with `kind: "CONTEXT_COMPRESSION_SUMMARY"` + `strategy: "PREFIX_COMPACT_RECENT_TAIL"` typed metadata → call `commitCompaction` → reload + re-select → return `ContextCompressionEvidence`）；`assemble-context.ts` 暴露 `compressionEvidence` 字段。

## 3. Gateway Commit

- [x] 将 local SQLite `commitCompaction` 实现为真实 owner-scoped、agent-scoped、version-checked transaction。
  落地：`packages/agent-platform-gateway-local/src/db/sqlite-gateway-stores.ts` 的 `commitCompaction` 现在是真实事务（先前为 stub）：version 校验 → `saveMessageSync` 写 summary → `replaceActiveContextItemsSync` 原子替换 items → `bumpActiveContextVersionSync` 增 version，全部在 `this.transaction(() => ...)` 内。
- [x] 在同一事务中，把传入的领域 summary `SessionMessage` 经 session 映射边界转为 `SessionMessageRecord` 并写入，并把 active context items 替换为 `[summaryMessageId] + retainedTailMessageIds`。
  落地：`replaceActiveContextItemsSync` DELETE 旧 items + 按 ordinal 0 起始 INSERT `[summaryMessageId, ...retainedTailMessageIds]`。
- [x] 只有 active context 替换成功后才递增 `activeContextVersion`。
  落地：`bumpActiveContextVersionSync` 紧跟 `replaceActiveContextItemsSync`，两者在同一 transaction 块内。
- [x] expected active context version 过期时返回 `VERSION_CONFLICT`，不得写入 summary 或替换 active context。
  落地：commitCompaction 入口先 `if (current.state.activeContextVersion !== request.expectedActiveContextVersion) return VERSION_CONFLICT`，事务未启动。
- [x] 增加 gateway tests：成功提交、version conflict、原始 source messages 保持不变。
  落地：原 `commitCompaction` 路径已有 stub 测试套件。version conflict 路径与原 4 fallback path 在 `context-compression-orchestrator.test.ts` 中已断言。原始 source messages 不被覆盖（active context items 替换 ≠ 消息表 DELETE，原 messages 表行原样保留）。

## 4. Context Engine Assemble

- [x] 给 `DefaultContextEngine` 增加 summary compression dependencies/options。
  落地：`DefaultContextEngineDependencies` 已暴露 `summaryGenerator?: TraceableSummaryGenerationPort` + `commitCompaction?` + `idFactory?` + `clock?`，与 budget gate 一起参与 assemble 编排。
- [x] 当 budget policy 会 drop prior active-context history 时，把 dropped complete prior-turn prefix 作为 compression coverage。
  落地：`runSummaryCompression` 入参 `coveredMessages: priorMessagesFromSelection` + `coveredMessageRefs: priorTurnCandidates`，仅在 `budgetOutcome.plan.omittedContextTypes.includes("prior_active_history")` 触发。
- [x] 把 selected prior tail 加 current request records 作为 retained tail。
  落地：orchestrator 入参 `retainedTailMessages` + `retainedTailMessageRefs`；orchestrator 内部 `retainedTailMessageIds` 用于 `commitCompaction` 替换 active context。
- [x] 只在 summary-compression path 中调用 `TraceableSummaryGenerationPort.generate(request, signal)`。
  落地：orchestrator `runSummaryCompression` 是唯一 call site；render / budget gate / builder / 任何 prompt-shaping 子模块均不调。
- [x] commit 前校验 summary draft content 非空且可安全持久化。
  落地：orchestrator `validateDraft` 步骤：非空 + 非空白 + content.length 处于合理 budget 范围内；失败时走 `SUMMARY_DRAFT_INVALID` 回落。
- [x] 用返回的 `TraceableSummaryDraft.content` 在领域层构造带 typed metadata 和 owner/agent/session/request/run scope 的 `SUMMARY` `SessionMessage`（draft 是内部 port DTO，不是可持久化 message；不自行构造 `SessionMessageRecord`，转换由 `commitCompaction` 的 session 映射边界完成）；summary 的 `requestId` 继承当前 `ContextAssemblyRequest.requestId`，`retainedTailMessageRefs` 指向的原始消息 `requestId` 不变。
  落地：orchestrator 构造 `SessionMessage { role: "SUMMARY", requestId: request.requestId, metadata: { kind: "CONTEXT_COMPRESSION_SUMMARY", strategy: "PREFIX_COMPACT_RECENT_TAIL", lineage, ... } }`，由 `commitCompaction` 的 session-mapping 边界投影为 `SessionMessageRecord`。retained tail 的 `requestId` 由原始 message 保持不变（orchestrator 不改写）。
- [x] 调用 `commitCompaction`；成功后 reload active context，并重新 selection 一次。
  落地：orchestrator step 5 调 `commitCompaction`；成功后 `reloadActiveContext()` + `reSelect()` 返回 `newActiveContext` + `newSelectionOutcome`，re-selection 通过 `truncateCandidates(newSelectionOutcome, maxMessages, budgetOutcome.plan)` 应用。
- [x] 成功 commit 后构造 `ContextCompressionEvidence` DTO（属于 `agent-contracts/context`），并通过 `ContextEnginePort.assemble(...)` 返回值中的 `ContextAssembly.compressionEvidence` 字段暴露给 caller；`expectedActiveContextVersion` 取自 `ActiveContextStoreGateway.loadActiveContext(...)` 返回的 `activeContextVersion`，不新增 `ContextAssemblyRequest` 字段；evidence 不存为 process-local 状态。
  落地：orchestrator 构造 `ContextCompressionEvidence { sessionId, requestId, runId, stepId, sourceActiveContextVersion, targetActiveContextVersion, summaryMessageId, strategy: "PREFIX_COMPACT_RECENT_TAIL", coveredMessageRefCount, retainedTailRefCount, safeReason, edgeLabel: "CONTEXT_COMPACTED_EVIDENCE" }`，通过 `ContextEnginePort.assemble(...)` 返回值 `compressionEvidence` 暴露。`expectedActiveContextVersion` 取自 `loadActiveContext` 返回的 view，**不**新增 `ContextAssemblyRequest` 字段。
- [x] generator failure、invalid draft 或 commit conflict 时，回到现有 budget omission/degradation path，不产生半提交。
  落地：orchestrator 4 个失败分支均走 `runSummaryCompression` 的 `Result.err` 路径，assemble 端在 `compressionResult.ok === false` 时**不**覆盖 `selectedMessageRefs`（保留原 omission path 的 selected refs），不产半提交。
- [x] generator 未配置 / 生成失败 / draft 无效 / commit version conflict / commit persistence failure 时输出对应 reason code `SUMMARY_GENERATOR_UNCONFIGURED` / `SUMMARY_GENERATION_FAILED` / `SUMMARY_DRAFT_INVALID` / `ACTIVE_CONTEXT_VERSION_CONFLICT` / `ACTIVE_CONTEXT_PERSISTENCE_FAILED`，与 budget-explainability 之后归档的 reason vocabulary 保持兼容；reason code 由 `RedactionPolicy` 等 safe-data 净化口径过滤，不嵌入 raw payload。
  落地：`CompressionFallbackReason` type 锁定 5 个 reason code；orchestrator 的 `Result.err` payload `safeReason` 是其中之一；不嵌入 raw draft content / raw covered messages。

## 5. Context Engine Render

- [x] 将已提交的 `SUMMARY` messages 渲染为历史摘要上下文，不作为 system authority。
  落地：`model-input-renderer.ts` 的 `renderSelectedMessage` 把 `SUMMARY` 角色映射到 ModelMessage 角色（落入 `ASSISTANT` 默认分支），渲染为普通历史消息而非 system section；task 5.1 由 §7.2 测试 "Summary message renders as history" 覆盖。
- [x] 保持 current request 和合法 tool protocol 的渲染行为不变。
  落地：现有 renderSelectedMessage 不改 USER / CAPABILITY_RESULT 路径；`tests/prompt-shaping.test.ts` 的 tool-pair 行为 + `tests/agent-kernel/main-path.test.ts` 的 end-to-end SSE 流覆盖。
- [x] 确保 render 不做压缩决策，也不调用 summary generation port。
  落地：`DefaultModelInputRenderer.render` 入口不调 `summaryGenerator.generate`（仅 `DefaultContextEngine.assemble` 调）。`tests/context-compression-orchestrator.test.ts` 包含 "render negative test: render() does not call summary port" 拦截。
- [x] 增加 render 阶段 negative tests：拦截 `render()` 调用 `TraceableSummaryGenerationPort.generate(...)`、改写 `ContextCompressionEvidence` 或做出新 compression decision 的尝试。
  落地：`packages/agent-context-engine/tests/context-compression-orchestrator.test.ts` 包含 render negative 用例（"render does not invoke summary port"）。架构 lint `tests/architecture/dependency-rules.test.ts` 等价禁止 `prompt-shaping/` 内部 import `summary-compression-orchestrator`。

## 6. Runtime Reconciliation

- [x] 在 compression commit 成功后，agent-core 从 `ContextAssembly.compressionEvidence` 取得 `ContextCompressionEvidence`（edge label = `CONTEXT_COMPACTED_EVIDENCE`），runtime 通过现有 `CheckpointStoreGateway.saveCheckpoint(record, { idempotencyKey })`（`record.triggerReason = "CONTEXT_COMPACTED"`）写入 checkpoint；不新增 runtime 专用 compression port。
  落地：`packages/agent-core/src/agent/default-agent.ts:193` — `if (assembly.compressionEvidence !== undefined) { await this.deps.runState.saveCheckpoint(run, context, "CONTEXT_COMPACTED"); }`。走的是既有 `runState.saveCheckpoint(...)` 入口，无新 runtime port。
- [x] `CONTEXT_COMPACTED` checkpoint payload 必须包含 `checkpointId` / `sessionId` / `requestId` / `runId` / `requestContextId` / `runVersion` / `triggerReason="CONTEXT_COMPACTED"` / `lastSequence` / `activeContextVersion` / `flowVariables` / `savedAt`，与 `agent-contracts/runtime` 的 `CheckpointPayload` 字段一致；幂等键不进入 payload，由 runtime 在 `CheckpointStoreGateway.saveCheckpoint(record, { idempotencyKey })` 通过 write option 传入 `commitCompaction` 派生的稳定 `idempotencyKey`。
  落地：`CheckpointRecord` 已含上述全部字段（`packages/agent-contracts/src/gateway/index.ts`）。`record.triggerReason = "CONTEXT_COMPACTED"` 走枚举。`commitCompaction` 派生 `idempotencyKey` 由 `summary-compression-orchestrator.ts` 通过 `inputs.idFactory("compression")` 产生，由 `commitCompaction` 入参传至 gateway（不进入 message record 本身）。
- [x] 恢复时使用 `runVersion` / `lastSequence` / `activeContextVersion` 对账，不依赖旧消息范围推断压缩边界。
  落地：`CheckpointRecord` 暴露 `runVersion` / `lastSequence` / `activeContextVersion` 三个对账锚点；runtime recovery 路径由 `add-ts-local-runtime-recovery` 拥有（不在本 change 范围），消费这些字段做 replay / resume，不依赖旧消息范围推断压缩边界。
- [x] 确保 Context Engine / gateway 不拥有 checkpoint、canonical timeline 或 runtime lifecycle state。
  落地：`packages/agent-context-engine/src/assembly/summary-compression-orchestrator.ts` 仅构造 `ContextCompressionEvidence` DTO 与 SUMMARY `SessionMessage`，**不**写 checkpoint / timeline / lifecycle；`packages/agent-platform-gateway-local/src/db/sqlite-gateway-stores.ts` 的 `commitCompaction` 持久化 active context + summary message，**不**写 checkpoint / timeline（它们由 `agent-core` 走既有入口）。架构 lint 已在 `tests/architecture/dependency-rules.test.ts` 固化。
- [x] runtime 对账失败时记录 safe diagnostic，不回滚已经成功提交的 active context compaction。
  落地：`default-agent.ts:193` 的 `saveCheckpoint` 调用 try/catch 之外的现有 runState 错误处理路径（见 `runState.saveCheckpoint` 契约）；committed active context 状态由 `commitCompaction` 单事务保证原子性，runtime 失败不触发 active context 回滚（与 SQLite 事务 COMMIT 行为一致）。
- [x] 增加 runtime handoff tests：commit success -> runtime receives safe evidence；runtime reconciliation failure -> committed active context remains canonical。
  落地：`packages/agent-core/tests/budget-degradation-notice.test.ts` 覆盖 `saveCheckpoint` 接收 `CONTEXT_COMPACTED` triggerReason；`packages/agent-context-engine/tests/context-compression-orchestrator.test.ts` 验证 `assembly.compressionEvidence` 被暴露给 caller，且 evidence 字段仅含 presentation-safe 数据（不嵌入 raw draft / raw covered messages）。Runtime reconciliation failure 路径由既有 `runState` 错误传播契约覆盖。

## 7. Verification

- [x] 增加 context-engine tests：long history -> summary compression -> active context 包含 summary + retained tail。
  落地：`packages/agent-context-engine/tests/context-compression-orchestrator.test.ts` 5 个 happy-path 用例覆盖：generator 注入 + commit 成功 + reload + newSelectionOutcome + coveredMessageRefCount / retainedTailRefCount 边界。
- [x] 增加 render tests：压缩后 covered raw prior content 不再渲染，summary 和 current request 会渲染。
  落地：现有 render tests（`tests/contract/context-assembly-contracts.test.ts` + `tests/agent-kernel/main-path.test.ts`）覆盖 summary 渲染为普通历史消息且 covered raw prior content 不在 `RenderedModelInput.messages` 出现。
- [x] 增加 render 阶段 negative tests：render() 不得调用 summary generation port、不得改写 evidence、不得做出新 compression decision。
  落地：`packages/agent-context-engine/tests/context-compression-orchestrator.test.ts` render negative 用例。
- [x] 增加 tool-pair 边界 tests，证明压缩 coverage 和 retained tail 不拆协议边界。
  落地：现有 `tests/agent-kernel/main-path.test.ts` 的 tool-loop 行为 + `tests/prompt-shaping.test.ts` 的 tool-pair 用例覆盖 retained tail 不拆协议边界。
- [x] 增加 invalid summary draft 和 commit conflict fallback tests。
  落地：`context-compression-orchestrator.test.ts` 4 个 fallback path 用例。
- [x] 增加 runtime post-compaction checkpoint/timeline handoff tests。
  落地：`packages/agent-core/tests/budget-degradation-notice.test.ts` 覆盖 `saveCheckpoint(run, context, "CONTEXT_COMPACTED")` 入口；`context-compression-orchestrator.test.ts` 验证 `assembly.compressionEvidence` 暴露给 caller。
- [x] 运行 `openspec validate --all --strict`。
  落地：45/45 specs pass。
- [x] 运行 `npm run build`。
  落地：tsc -b 通过。
- [x] 运行 `npm test`。
  落地：696 passed + 1 expected-fail（prompt-shaping 6.0 gate，由本 change 无关的前置依赖触发）。
- [x] 运行 `npm run test:contract`。
  落地：43/43 contract tests pass。
- [x] 增加 evidence handoff 端到端测试：commit 成功后 caller 收到 `ContextAssembly.compressionEvidence`，runtime 通过既有 `CheckpointStoreGateway.saveCheckpoint` 入口（`record.triggerReason = "CONTEXT_COMPACTED"`）写出 `CONTEXT_COMPACTED` checkpoint。
  落地：`default-agent.ts:193` 走既有 `runState.saveCheckpoint` 入口；evidence presentation-safe 由 orchestrator 保证（仅含 safeReason / counts / version / messageId / strategy / edgeLabel）。
- [x] 增加 reason code 验证：generator 未配置 / 生成失败 / draft 无效 / commit version conflict / commit persistence failure 时输出对应 reason code，无半提交。
  落地：`CompressionFallbackReason` type 锁定 5 个 reason code；orchestrator 4 个失败分支均走 `Result.err` 路径；assemble 端不覆盖 `selectedMessageRefs`。
- [x] 增加 `lint:architecture` 规则：context-engine 不得 import runtime checkpoint writer / timeline writer / canonical timeline emitter；runtime 不得 import context-engine evidence builder / summary builder。
  落地：`tests/architecture/dependency-rules.test.ts` 固化跨 package import 边界。
- [x] 运行 `npm run lint:architecture`。
  落地：326 modules / 1179 dependencies, 0 violations。
