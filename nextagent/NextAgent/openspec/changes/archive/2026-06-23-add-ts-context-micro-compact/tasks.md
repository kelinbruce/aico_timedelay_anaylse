## 任务清单

### Phase 1: 契约扩展（agent-contracts）

- [x] **T001** `MicroCompactResult` 类型定义在 engine 内部（`micro-compact.ts`），不暴露在 `agent-contracts/context` 公共契约中
  - 字段：`newlyCompactedCount`、`totalCompactedCount`、`retainedCount`、`path: "no-op" | "compacted"`、`safeReason`
  - 通过 `diagnosticLogger` 输出可观测性信息，不通过 `ContextAssembly` 传递

- [x] **T002** Provider 级缓存保护（`CacheEditDirective`）deferred 到后续 change
  - 当前首版不修改 `RenderedModelInput`

- [x] **T003** `ContextAssembly` 不新增 `microCompactEvidence` 字段
  - 微压缩证据仅通过诊断日志输出，不在公共契约中暴露

- [x] **T004** `agent-contracts/gateway` 扩展 `ActiveContextViewRecord.metadata` 类型
  - 新增可选 `metadata?: JsonObject` 字段
  - 用于持久化 `microCompactState`（已压缩 messageId 集合）
  - JSON-compatible，向后兼容（缺失时视为空状态）

### Phase 2: 核心实现（agent-context-engine / micro-compact）

- [x] **T005** 新建 `packages/agent-context-engine/src/micro-compact/config.ts`
  - 导出 `COMPACTABLE_TOOL_NAMES`（ReadonlySet<string>，8 个工具名）
  - 导出 `MICRO_COMPACT_CONFIG`（triggerThreshold=10, keepRecent=5）
  - 所有常量带 JSDoc 注释说明设计原则

- [x] **T006** 新建 `packages/agent-context-engine/src/micro-compact/candidate-scanner.ts`
  - 实现 `scanCompactableCandidates(priorTurnCandidates, recordsByMessageId)` 纯函数
  - 从 CAPABILITY_RESULT 的 JSON content 中提取 toolName
  - 白名单过滤 + 保留 orderIndex
  - 不扫描 currentRequestRecords

- [x] **T007** 新建 `packages/agent-context-engine/src/micro-compact/state-manager.ts`
  - 实现 `readMicroCompactState(metadata)` — 安全读取，缺失或格式错误时返回空状态
  - 实现 `writeMicroCompactState(metadata, state)` — 不可变投影
  - 实现 `clearMicroCompactState(metadata)` — 摘要压缩后清空
  - 导出 `MicroCompactState` 类型和 `EMPTY_MICRO_COMPACT_STATE` 常量

- [x] **T008** 新建 `packages/agent-context-engine/src/micro-compact/content-replacer.ts`
  - 实现 `renderCompactedPlaceholder({ originalSize, toolName })` — 确定性 XML 占位符
  - 实现 `replaceCapabilityResultPayload(rawContent, placeholder)` — 保持 JSON 结构，替换 payload
  - 非 JSON 内容降级为整体替换

- [x] **T009** 新建 `packages/agent-context-engine/src/micro-compact/micro-compact.ts`
  - 实现 `microcompactHistory({ outcome, metadata })` 主编排函数
  - in-place 修改 recordsByMessageId，更新 metadata 状态
  - 实现 `applyMicroCompactReplacementAtRender(messages, compactedIds)` render 阶段重新应用
  - 产出 `MicroCompactResult`

- [x] **T010** 新建 `packages/agent-context-engine/src/micro-compact/index.ts`
  - public barrel export：`microcompactHistory`、`applyMicroCompactReplacementAtRender`、`COMPACTABLE_TOOL_NAMES`、`MICRO_COMPACT_CONFIG`、`MicroCompactResult`、`MicroCompactState`

### Phase 3: 管线集成（agent-context-engine / assembly）

- [x] **T011** 修改 `packages/agent-context-engine/src/assembly/assemble-context.ts`
  - 在 `selectHistory` 之后、`truncateLargeToolResults` 之前插入 `microcompactHistory` 调用
  - 传入 `outcome`、`active?.metadata`
  - 通过 `diagnosticLogger` 输出微压缩证据（不通过 `ContextAssembly` 传递）

- [x] **T012** 修改 `assemble-context.ts` render 阶段
  - 在 `truncateRenderedToolResults` 之后插入 `applyMicroCompactReplacementAtRender` 调用
  - 从重新加载的 active context metadata 中读取 compactedIds
  - 仅在 `compactedIds.size > 0` 时执行

- [x] **T013** `buildAssemblyResult` 方法无变更
  - 微压缩证据不通过 `ContextAssembly` 传递，仅在诊断日志中输出

### Phase 4: 摘要压缩协调

- [x] **T014** 修改 `summary-compression-orchestrator.ts`
  - `commitCompaction` 成功后，确保新 ActiveContextView 的 metadata 不包含 `microCompactState`
  - 在 `createCompactionResultFromSessionMemory` 或 commit 后处理中使用 `clearMicroCompactState`

- [x] **T015** 修改 `postCompactCleanup`（如果存在）
  - 确保 `resetMicrocompactState()` 在压缩后清理中被调用
  - 与 `runPostCompactCleanup` 同级运行

### Phase 5: 可观测性

- [x] **T016** 在 `microcompactHistory` 中集成 diagnostic logger
  - 事件：`context.microCompact.evaluated`
  - 字段：`path`、`newlyCompactedCount`、`totalCompactedCount`、`retainedCount`
  - 非抛出：logging 失败不影响主管线

- [x] **T017** 在 `assemble()` 中集成 diagnostic logger
  - 微压缩失败时记录 `context.microCompact.failed`（safe reason）
  - 不阻塞后续管线阶段

### Phase 6: 测试

- [x] **T018** 单元测试：`candidate-scanner.test.ts`
  - 白名单工具被识别（8 个工具各一个 case）
  - 非白名单工具被排除（MCP 工具、Agent 工具各一个 case）
  - currentRequest 不扫描
  - 非 CAPABILITY_RESULT 角色不扫描
  - 非 JSON content 不扫描
  - 空 priorTurnCandidates 返回空数组

- [x] **T019** 单元测试：`state-manager.test.ts`
  - 空 metadata → 空状态
  - 缺失 microCompactState → 空状态
  - 格式错误 → 空状态
  - 正常读取 → 正确状态
  - writeMicroCompactState 不可变（原 metadata 不变）
  - clearMicroCompactState 移除字段

- [x] **T020** 单元测试：`content-replacer.test.ts`
  - renderCompactedPlaceholder 确定性（相同输入 → 相同输出）
  - renderCompactedPlaceholder 包含 originalSize 和 toolName
  - replaceCapabilityResultPayload 保持 toolCallId / toolName
  - replaceCapabilityResultPayload 非 JSON 降级

- [x] **T021** 单元测试：`micro-compact.test.ts`
  - ≤10 候选不触发（path = "no-op"）
  - 11 候选压缩 6 个保留 5 个
  - 15 候选压缩 10 个保留 5 个
  - 已压缩的不重复处理（幂等性）
  - 空候选不触发
  - 全部已压缩不触发新的替换

- [x] **T022** 集成测试：微压缩 + budget gate
  - 构造 12 个 Bash 结果 → 微压缩触发 → budget gate 看到更小的 token 估算
  - 验证 `HISTORY_OMITTED_TO_BUDGET` 减少

- [x] **T023** 集成测试：微压缩 + large-content truncation
  - 构造 12 个白名单结果（其中 3 个 >8KB）→ 微压缩先清理旧的 → large-content 只处理剩余的

- [x] **T024** 集成测试：微压缩 + summary compression
  - 摘要压缩成功后 → 微压缩状态被清空
  - 下次 assemble 从空状态开始

- [x] **T025** 集成测试：render 阶段重新应用
  - assemble 压缩了 3 个结果 → render 从 store 加载原始内容 → 重新应用替换
  - 验证 render 输出的消息中压缩结果是占位符

- [x] **T026** 架构边界测试
  - micro-compact 子模块不导入 provider SDK
  - micro-compact 子模块不导入 runtime lifecycle contract
  - micro-compact 子模块不新增 gateway port

### Phase 7: 文档和收尾

- [x] **T027** 更新 `openspec/designs/modules/agent-context-engine.md`
  - 新增 micro-compact 子模块说明
  - 说明与 large-content、budget、compression 的关系

- [x] **T028** 更新 `docs/developer/08-context-management.md`
  - 新增微压缩章节
  - 说明三层上下文管理机制：micro-compact + large-content truncation + summary compression

- [x] **T029** 更新 `packages/agent-context-engine/src/index.ts`
  - 从 micro-compact barrel 导出公共 API
