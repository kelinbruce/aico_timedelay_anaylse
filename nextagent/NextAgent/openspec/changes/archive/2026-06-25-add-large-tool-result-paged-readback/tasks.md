## 任务清单

### Phase 1: 契约扩展（agent-contracts）
- [x] **T001** 在 `agent-contracts/runtime` 新增 `LargeContentExternalizerPort` 契约
  - 方法形态：`externalize(draft: SessionMessageDraft, executionContext): Promise<SessionMessageDraft>`（`executionContext` 提供 `identityContext` + `agentId`/`sessionId`/`runId` 以解析 execution workspace）  - 语义：输入 draft + execution context，返回可能改写后的 draft（content→preview、metadata.replacement 写入 evidence、workspace 文件已写）；非 CAPABILITY_RESULT / 未超限 / 已 frozen / 豁免工具 直接返回原 draft
  - 契约为可选注入点，缺失时 caller 直通  - 来源：design 决策 2
  - 验证：`agent-contracts` 契约测试断言 port 类型可被实现并注入；`openspec validate --strict` 通过

### Phase 2: externalizer 实现与接入
- [x] **T002** 由 app composition 提供 `DefaultLargeContentExternalizer` 实现（*不在 `agent-context-engine` 内*，避免其反向依赖 `agent-capability`/`agent-runtime`）  - 组合 `agent-context-engine` 的 `classifyReplacement` + `applyReplacement`（`persistContent` 注入为"写 workspace 文件"）、`agent-runtime` 的 execution workspace resolver + `agent-capability` 的 workspace 写入
  - 对 `draft.role === "CAPABILITY_RESULT"`、内容 > `inlineMaxBytes`、`toolName !== "Read"`、且 `metadata.replacement` 缺失的 draft：解析 execution workspace → `mkdirSync tool-results/` → 写完整内容到 `workspace/tool-results/<refId>.txt`（`refId` 由确定性 id factory 基于 messageId+kind 生成，保证 append 重试幂等、不产生孤儿文件）→ `applyReplacement` 生成 `PERSISTED_PREVIEW`（`contentRef.refId = tool-results/<refId>.txt`）→ 改写 `draft.content` 为 preview、`draft.metadata.replacement` 为 evidence
  - 写文件失败走 `applyReplacement` 三步收口（inline-fallback / overflow 显式失败），不静默丢内容
  - 来源：design 决策 1 + 决策 3 + spec "Capability-result large content is externalized to the execution workspace as a readable file"
  - 验证：`packages/agent-context-engine/tests/large-content-externalizer.test.ts` 断言 oversized draft 改写后 `metadata.replacement` 存在、`content` 为 preview、`workspace/tool-results/<refId>.txt` 已写

- [x] **T003** `RuntimeOwnedRunMessagePort` 增加可选 `largeContentExternalizer` 依赖并在 `appendMessage` 写入前调用  - `RuntimeOwnedRunMessagePortDependencies` 增加可选 `largeContentExternalizer?: LargeContentExternalizerPort`
  - `appendMessage` 在 `appendSessionMessage` 之前调用 `externalize(draft, executionContext)`（从 `run` + `context` 构造 executionContext），用返回 draft 落库
  - 未注入时直通（向后兼容）  - 来源：design 决策 1
  - 验证：`packages/agent-runtime/tests/run-message-port-externalize.test.ts` 断言 externalizer 被调用且其返回 draft 被持久化；未注入时行为不变
- [x] **T004** app composition 注入 `DefaultLargeContentExternalizer` 到 `RuntimeOwnedRunMessagePort`
  - 在 app composition 装配处把 workspace resolver + workspace 写入 + externalizer 注入 RunMessagePort
  - 来源：design 决策 2
  - 验证：架构检查（dependency-cruiser）确认无 `agent-runtime → agent-context-engine`/`agent-capability` 直接依赖；e2e 集成测试断言 oversized 工具结果落库后带 `metadata.replacement` 且 workspace 文件存在

### Phase 3: `read` 豁免 + 装配侧透传（`read` 工具不改）
- [x] **T005** externalizer 与装配/渲染侧按 `toolName === "Read"` 豁免
  - `DefaultLargeContentExternalizer` 跳过 `toolName === "Read"` 的 draft
  - `assemble-context.ts` 的 `truncateLargeToolResults` / `truncateRenderedToolResults` 跳过 `toolName === "Read"` 的记录（从 CAPABILITY_RESULT content JSON 解析 toolName）  - `read` 工具 schema 不新增参数；`offset`/`limit` 继续可选并使用现有默认值  - `workspaceFiles.readText` 对默认读取或显式范围过大且无法在单次响应预算内完整返回的请求，返回安全 paging-required 错误，提示模型用显式 `offset`/`limit` 分页；不得静默截断为看似完整的页
  - 来源：design 决策 4 + spec "Read tool is exempt from externalization to prevent readback loops"
  - 验证：`packages/agent-context-engine/tests/read-exempt.test.ts` 断言 Read 的 oversized CAPABILITY_RESULT 不被 externalize；`packages/agent-capability/tests/read-large-file-paging-required.test.ts` 断言 oversized single-read 返回 paging-required 错误

- [x] **T006** 装配/渲染侧 conformant 透传 + 防御性兜底  - 已带 `metadata.replacement` 的记录直通（含 content 为预览 KB preview，幂等）
  - 遗留无 `replacement` 的 oversized 记录由兜底产出 bounded preview（无 file_path、有 diagnostic，属 legacy 降级
  - 来源：design 决策 5
  - 验证：`packages/agent-context-engine/tests/assembly-pass-through.test.ts` 断言 externalized 记录装配后模型可见形态保留 file_path；遗留记录降级且带 diagnostic

### Phase 4: access instruction

- [x] **T007** `renderPersistedPreviewBlock` access instruction 指向 `read` + `file_path`
  - 模型可见块显式指引："invoke the read tool with file_path=tool-results/<refId>.txt; if the file is too large, page it with offset and limit"，并暴露 `file_path`（来自 `metadata.replacement.contentRef.refId`）  - 来源：design 决策 6 + spec "Capability-result large content is externalized to the execution workspace as a readable file"
  - 验证：`packages/agent-context-engine/tests/persisted-preview-block.test.ts` 断言块含 file_path 与 read 指引文本

### Phase 5: 契约 / negative / characterization / e2e 测试

- [x] **T008** negative: 跨 scope 读回实际触发失败并断言无泄漏  - 构造 owner scope A 的 workspace 写入 `tool-results/<refId>.txt`，以 owner scope B 的 context 调 `read` 该 file_path → 断言返回 `FILE_UNAVAILABLE` 且响应不含原始内容字节、跨 scope 内容/身份
  - 来源：spec "Readback is owner-scoped via the execution workspace"（forbidden behavior）  - 验证：`packages/agent-capability/tests/read-workspace-file-cross-scope.test.ts` 实际触发跨 scope 调用并断言失败 + 无泄漏
- [x] **T009** negative: 文件缺失 / 不可读降级不泄漏
  - `tool-results/<refId>.txt` 不存在 / 不可读 → 断言 `FILE_UNAVAILABLE` 且无原始内容
  - 来源：spec "Readback is owner-scoped via the execution workspace"
  - 验证：同 T008 测试文件内缺文件 / 不可读场景
- [x] **T010** negative: 越界返回空页 + `truncated=false`/无 nextOffset，不抛错
  - `offset` ≥ 行数 → 断言空页、`truncated=false`、无 `nextOffset`、不抛异常  - 来源：spec "Out-of-range readback returns an empty page rather than an error"
  - 验证：`packages/agent-capability/tests/read-workspace-file-out-of-range.test.ts`

- [x] **T010a** negative: 超大文件默认/单次读取返回 paging-required 错误
  - 对超过单次响应文本预算的 `tool-results/<refId>.txt` 调 `read` 且不带 `offset`/`limit`（或传入会超过预算的范围）→ 断言返回安全 paging-required 错误，错误文本提示使用显式 `offset`/`limit` 分页，且不返回静默截断的 ambiguous content
  - 来源：spec "Oversized single read tells the model to page"
  - 验证：`packages/agent-capability/tests/read-large-file-paging-required.test.ts`

- [x] **T011** negative: `read` 豁免实际触发——Read oversized 输出不被 externalize
  - 构造 oversized Read CAPABILITY_RESULT 经 externalizer → 断言 workspace 文件未写、`metadata.replacement` 未写入、content 原样
  - 来源：spec "Read tool is exempt from externalization"（forbidden behavior）  - 验证：`packages/agent-context-engine/tests/read-exempt-negative.test.ts` 实际触发并断言未 externalize

- [x] **T012** characterization: externalize 幂等——replay / 重复 append 不重复写文件
  - 对已带 `metadata.replacement` 的 draft 再次经 externalizer → 断言 workspace 文件未被重复写、draft 不变
  - 来源：design 决策 1 + spec "Replacement decisions are durable session-message facts"（runtime lifecycle 变更需 characterization）  - 验证：`packages/agent-context-engine/tests/large-content-externalizer-idempotent.test.ts`

- [x] **T013** characterization: 写文件失败走三步收口（不静默丢内容）
  - fake workspace 写入抛错 + 已 block ≤ inline 阈值 → inline-fallback（`degradation:offload-failed-into-inline-fallback`）；超阈值 → overflow 显式失败 marker
  - 来源：design 决策 1 + baseline "Large content failures are explicit and recoverable"
  - 验证：`packages/agent-context-engine/tests/large-content-externalizer-failure.test.ts`

- [x] **T014** characterization: `tool-results/` 是普通 workspace readback 路径，本期不加 reserved-dir 禁写
  - 断言 externalizer 写入的 `tool-results/<refId>.txt` 能被 `read` 按普通 workspace 文件路径读取（无特殊绕过）  - 文档记录本期不处理模型工具后续修改 `tool-results/` 的情况；不得新增普通 write/edit/sandbox 的 reserved-dir 禁写规则
  - 来源：用户决策 + design 风险节（命名空间冲突 / 后续改写不处理）
  - 验证：`packages/agent-capability/tests/tool-results-readback-path.test.ts`

- [x] **T015** e2e: 模型用 `read` + `file_path` 分页取回 oversized 工具结果尾部
  - 端到端：工具产出 oversized 结果 → 落库 externalized 到 workspace 文件 → 模型收到 PERSISTED_PREVIEW（含 file_path + read 指引）→ 如默认读取过大则模型收到 paging-required 错误 → 模型调 `read` file_path + 显式 offset/limit 翻页取到尾部内容
  - 来源：proposal 目标 + spec "Model can read back externalized tool results via the workspace file path with bounded pages"
  - 验证：`tests/e2e/large-tool-result-readback.test.ts`（或既有 product-journey gate 内新增用例）

- [x] **T016** 架构边界检查：无 `agent-runtime → agent-context-engine`/`agent-capability` 直接依赖
  - externalizer 经 port 注入，`agent-runtime` 仅依赖 `agent-contracts/runtime` 的 port 契约
  - 来源：design 决策 2
  - 验证：`npm run lint:architecture`（dependency-cruiser）通过；code review 检查 `agent-runtime/package.json` 无 `agent-context-engine`/`agent-capability` 依赖（无法自动断言负向依赖时以 lint + review 双重确认）
- [x] **T017** negative: F 记录的 `contentRef.refId`（workspace 路径）不被 BlobRef-resolver 误解  - 构造 capability-result F 记录（`contentRef.refId = tool-results/<refId>.txt`），断言 wired 装配/渲染路径不会对其调用 `readPersistedPreview` / `BlobStoreGateway.loadBlob`（即不会把 workspace 路径当 BlobRef 解析而误判降级）；capability-result 读回只走 `read` 工具
  - 来源：design 风险节（contentRef 语义偏离）+ spec "Capability-result large content is externalized to the execution workspace"
  - 验证：`packages/agent-context-engine/tests/capability-result-contentref-not-blobresolved.test.ts` 实际触发并断言无 BlobRef 解析

- [x] **T018** `tool-results/` 可读性 + refId 幂等验证
  - 断言 `read` 能读取 externalizer 写入的 `tool-results/<refId>.txt`（在 `readDirectories` 允许范围内，不被 `CAPABILITY_PATH_REJECTED`）；断言同一 draft 重复 externalize（append 重试）写同一路径、不产生孤儿文件
  - 来源：design 风险节（tool-results 可读性 + refId 确定性）
  - 验证：`packages/agent-capability/tests/read-tool-results-dir.test.ts` + `packages/agent-context-engine/tests/externalize-refid-idempotent.test.ts`
