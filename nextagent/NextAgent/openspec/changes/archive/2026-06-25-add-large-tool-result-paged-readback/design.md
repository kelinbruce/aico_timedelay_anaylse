## 背景和现状（Context）

工具（capability）返回大结果时，NextAgent 当前在上下文装配阶段把超限 `CAPABILITY_RESULT` 在内存里截成约 1KB 预览喂给模型（`assemble-context.ts` 的 `truncateLargeToolResults` / `truncateRenderedToolResults`），预览块**不带 `contentRef`、不带路径**。完整原始内容留在 `SessionMessageStore`（SQLite `session_messages.content`），模型没有任何工具能读回，也不能分页。这是与 baseline `large-content-references` 已规定的"`PERSISTED_PREVIEW` MUST expose contentRef + access instruction"不一致的 **implementation-vs-spec gap**。

相关现状事实：

- `large-content/` 库能力（`applyReplacement` + `persistContent`、`classifyReplacement`）已完整且 **externalize-target 无关**（`persistContent` 由 caller 注入），可复用：F 方案下 `persistContent` = 写 workspace 文件，而非 `storeBlob`。
- `RuntimeOwnedRunMessagePort.appendMessage`（`agent-runtime/src/lifecycle/run-message-port.ts`）是所有 `SessionMessage`（含 `CAPABILITY_RESULT`）落库的**唯一咽喉点**，调用 `SessionMessageStoreGateway.appendSessionMessage`。
- `read` 工具（`agent-capability/src/builtins/read/read-tool.ts`）经 `workspaceFiles.readText` 读 workspace 文件，**已有**行级可选 `offset`/`limit` + `truncated`/`nextOffset` + 自管 `maxLines`/`maxTextBytes` 上限。
- execution workspace 由 `execution-workspace/resolver.ts` 按 `tenantId`/`subjectId`/`sessionId`（`isolationMode === "session"` 时含 sessionId）解析出 owner-scoped `workspace/` 根（readWrite）。
- `read` 当前**未豁免** large-content：`truncateLargeToolResults` 对所有 `CAPABILITY_RESULT` 一视同仁截断（按 `record.role`，不区分 `toolName`）。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 工具大结果在**写入消息库前**同步 externalize 到 execution workspace 文件（`workspace/tool-results/<refId>.txt`），模型可见形态为带 `file_path` + access instruction 的 `PERSISTED_PREVIEW`，消除"存了够不着"和"默默截断"。
- 模型用现有 `read` + `file_path` + 可选 `offset`/`limit` 读回该 workspace 文件；`read` 工具不新增参数，但实现需在单次读取过大时返回 paging-required 错误，提示模型分页读取。
- `read` 工具豁免 externalize + 自管分页，打断"读回→超限→再 externalize→再读回"循环。
- owner-scope 经 execution workspace resolver 强制；失败路径不泄漏原始内容。

**非目标：**

- 不改 micro-compact、auto-compact / traceable-summary、attachment 分类、budget explainability 入口。
- 不涉及 `BlobStoreGateway`（capability-result 改走 workspace 文件；attachment 仍走 blob 库，不变）。
- **不处理跨 session 耐久性**（execution workspace 按 sessionId 隔离 + 有清理任务）：本期接受该 deferred 风险（见风险节），未来如需跨 session 读回再迁移到持久存储。
- 不做历史存量消息迁移。
- 不新增模型可见工具、不新增 `read` 参数。

## 设计决策（Decisions）

### 决策 1：externalize 触发点 = `RuntimeOwnedRunMessagePort.appendMessage` 写入前同步 externalizer

**选定方案**：在 `RuntimeOwnedRunMessagePort.appendMessage` 调用 `appendSessionMessage` **之前**插入一个同步 externalizer。对 `draft.role === "CAPABILITY_RESULT"` 且内容超 `inlineMaxBytes`（8192）且 `toolName` 非豁免的 draft：写完整内容到 `workspace/tool-results/<refId>.txt` → 用 `applyReplacement`（kind=`PERSISTED_PREVIEW`，`persistContent` 注入为"写 workspace 文件并返回 `contentRef.refId = tool-results/<refId>.txt`"）生成 bounded preview + `ReplacementEvidence` → 将 `draft.content` 改写为 preview、`draft.metadata.replacement` 写入 evidence。已存在 `metadata.replacement` 的 draft（replay / 恢复）直接跳过（frozen）。

**理由**：`appendMessage` 是所有消息落库的唯一咽喉点，在此 externalize 保证"一次写入、跨 turn 一致"，符合 baseline 触发点"消息写入或更新前的同步 externalizer"。装配/渲染阶段不再承担 externalize 职责。

**放弃的备选**：
- *装配时 lazy externalize*：需向消息库回写已持久化消息，与"SHALL NOT overwrite already persisted SessionMessage"冲突，且涉及版本/CAS 与并发。放弃。
- *工具执行时（tool-loop）externalize*：非唯一落库点，分散 externalize 易漏。放弃，统一到 `appendMessage` 咽喉点。

### 决策 2：externalizer 以 port 注入，保持模块边界

**选定方案**：新增 `LargeContentExternalizerPort`（契约归 `agent-contracts/runtime`），方法形态 `externalize(draft, executionContext): Promise<SessionMessageDraft>`——`executionContext` 提供 `identityContext` + `agentId`/`sessionId`/`runId` 以解析 execution workspace。返回可能改写后的 draft（含写文件副作用）。`RuntimeOwnedRunMessagePortDependencies` 增加可选 `largeContentExternalizer?: LargeContentExternalizerPort`；`appendMessage` 在写入前调用，缺失时直通（向后兼容）。Port 实现由 app composition 注入，内部组合 `agent-context-engine` 的 `applyReplacement` + `agent-capability` 的 workspace 写入能力 + execution workspace resolver。

**理由**：`agent-runtime` 不直接依赖 `agent-context-engine` / `agent-capability`（架构防火墙）；port 注入与既有 `TraceableSummaryGenerationPort` / `commitCompaction` 注入模式一致（SOLID 依赖倒置）。

### 决策 3：externalize 到 execution workspace 文件；复用 `read` 的 `file_path`

**选定方案**：externalize 把完整内容写到 execution workspace 的真实文件 `workspace/tool-results/<refId>.txt`（`refId` 由 id factory 生成；目录由 externalizer 经 workspace resolver 解析后 `mkdirSync` 创建）。`contentRef.refId` = workspace 相对路径 `tool-results/<refId>.txt`。`PERSISTED_PREVIEW` 模型可见块携带该 `file_path` + access instruction。

模型读回：用现有 `read` + `file_path`（`tool-results/<refId>.txt`）+ 可选 `offset`/`limit` → `workspaceFiles.readText` 当普通 workspace 文件读取（经 `resolveView` owner-scope 解析 + `resolveTarget` 路径校验 + 自管 `maxLines`/`maxTextBytes` + 行级切片）。**`read` 工具不新增参数、不新增工具选择面**；`offset`/`limit` 可省略并使用现有默认值，但当默认读取或显式范围过大、无法在单次响应预算内完整返回时，`read` MUST 返回安全的 paging-required 错误，提示模型用显式 `offset`/`limit` 分页，而不是静默截断成看似完整的页。owner scope 由 workspace resolver 在 `resolveView` 强制；跨 scope / 文件缺失 / 不可读 → `read` 返回 `error: "FILE_UNAVAILABLE"`（复用现有错误枚举），不泄漏原始内容。

**理由**：模型零学习成本（完全复用"读 workspace 文件"心智与现有参数）；无需虚拟 path 路由分支、无需 `BlobStoreGateway` 介入。execution workspace 已是 owner-scoped + `read` 已自管上限 + 行级分页，天然满足读回需求；oversized single-read 显式报错可让模型知道不能一次性读完整文件，并转向分页。

**放弃的备选**：
- *externalize 到 blob 库（`BlobStoreGateway`/`blobs` 表）+ 虚拟 path 路由*：跨 session 耐久更强，但需在 `workspaceFiles.readText` 加虚拟 path 路由分支 + 涉及 `BlobStoreGateway`。本期按用户决策选 workspace 文件，理由是复用现有 `read` 文件分页路径，避免新增 readback tool、read 参数、blob id 暴露或虚拟 path router；blob 库路径作为未来跨 session 耐久性升级的候选。
- *externalize 到 blob 库 + `read` 新增 `content_ref` 参数*：需改 schema + `execute` 分支，改动面更大。放弃。
- *新增独立 readback 工具*：增加模型工具选择面，违背 KISS。放弃。

### 决策 4：`read` 工具豁免 externalize

**选定方案**：externalizer（决策 1）与装配/渲染侧 `truncateLargeToolResults`/`truncateRenderedToolResults` 均按 `toolName === "Read"`（`readCapabilityId`）跳过。`read` 工具输出由其自身默认/显式 `limit`（≤2000 行）+ `maxTextBytes` + `truncated`/`nextOffset` 自管，永不 externalize；当请求范围超过单次文本预算时返回 paging-required 错误，要求模型带显式 `offset`/`limit` 重试。

**理由**：`read` 是大内容的翻页入口，若其输出也 externalize，则"读回→超限→再 externalize→再读回"死循环。豁免 + 自管分页是打断循环的唯一确定路径。

### 决策 5：装配/渲染侧降为 defense-in-depth + conformant 透传

**选定方案**：`truncateLargeToolResults` / `truncateRenderedToolResults` 保留为防御性兜底，但：(a) 跳过 `toolName === "Read"`；(b) 对已带 `metadata.replacement` 的记录直通（其 `content` 已是 ≤8KB preview，`classifyReplacement` 自然返回 INLINE，幂等）。新写入的 oversized 记录由决策 1 在写入时已 conformant，装配侧不再产生无引用裸预览。遗留存量（变更前落库、无 `replacement` metadata 的 oversized 记录）由兜底产生 bounded preview（无 `file_path`），属 legacy 降级，记 diagnostic。

### 决策 6：access instruction 指向 `read` + `file_path`

`PERSISTED_PREVIEW` 模型可见块（`renderPersistedPreviewBlock`）的 access instruction 改为显式指引："invoke the read tool with file_path=tool-results/<refId>.txt; if the file is too large, page it with offset and limit"，并暴露 `file_path`（`refId` 来自 `metadata.replacement.contentRef.refId`），使模型可直接拷贝调用。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 读回 owner-scope 经 execution workspace resolver（`resolveView` 按 tenant/subject/session 解析）+ `resolveTarget` 路径穿越/符号链接防护；跨 scope / 文件缺失 / 不可读 → `FILE_UNAVAILABLE`，不下发原始字节或跨 scope 内容。externalize 写文件同样落在 owner-scoped workspace 内。`file_path` 是 workspace 相对路径，模型不接触 tenant/物理路径。按用户决策，本期不处理模型/工具后续修改 `tool-results/` 文件的情况。 | 契约测试：跨 scope 读回返回 `FILE_UNAVAILABLE` 且无原始内容；文件缺失降级 |
| 性能/容量 | externalize 一次写入、跨 turn 不重复（frozen）。读回即普通 workspace 文件读（无 blob roundtrip）。`tool-results/` 文件增长由 workspace 清理任务覆盖（见风险）。模型上下文只承载 bounded preview/页。 | 集成测试：externalize 幂等（重复 append 不重复写文件）；读回单页延迟 |
| 可靠性/恢复 | externalize 在 `appendMessage` 同步完成；写文件失败走 `applyReplacement` 三步收口（inline-fallback / overflow 显式失败），不静默丢内容。replay/恢复时 `metadata.replacement` 已存在 → frozen 跳过。**已知 deferred**：workspace 按 sessionId 隔离 + 清理任务，跨 session 读回可能失效（见风险）。 | resilience 测试：写文件失败 → 显式 degradation；replay 不重复 externalize |
| 可维护性 | externalizer 以 port 注入，`agent-runtime` 不依赖 `agent-context-engine`/`agent-capability`；`read` 工具不新增参数/工具，只补 oversized single-read paging-required 错误；复用既有 `large-content/` 库（`persistContent` 注入）与 workspace 写入能力，无新持久化。 | 架构检查（dependency-cruiser）：无 `agent-runtime → agent-context-engine`/`agent-capability` 直接依赖 |
| 可测试性 | externalizer port 可注入 test double；workspace 写入 + resolver 可替身；`applyReplacement`/`classifyReplacement` 已为纯函数。owner-scope 用 fake workspace resolver 注入跨 scope 场景。 | unit/contract 测试：externalizer、读回分页、跨 scope、越界空页 |
| 审计/可追溯性 | `metadata.replacement` 持久化 kind/reason/contentRef(=file_path)/originalSize/previewSize/lineage；读回不写消息库（纯读）。externalize 产出的 evidence 与 baseline `ReplacementEvidence` schema 一致（仅 `contentRef.refId` 语义为 workspace 路径）。 | 契约测试：replacement evidence schema 稳定；diagnostic log 含 externalize/readback 事件 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| oversized CAPABILITY_RESULT 写入前 externalize 到 workspace 文件为 PERSISTED_PREVIEW（含 file_path + access instruction） | T-externalize | 契约测试：appendMessage 后 `metadata.replacement` 存在、`content` 为 preview、`workspace/tool-results/<refId>.txt` 已写 |
| 装配/渲染不产出无引用裸预览（新记录） | T-assembly-pass-through | 集成测试：externalized 记录装配后模型可见形态含 file_path |
| `read` 经 `file_path` 行级分页读回（不新增参数） | T-read-workspace-file | unit 测试：read + file_path + offset/limit 返回正确行页 + nextOffset；默认/过大单次读取返回 paging-required 错误 |
| `read` 豁免 externalize（所有 read 输出） | T-read-exempt | 契约测试：Read 的 CAPABILITY_RESULT 不被 externalize/truncate |
| owner-scope 读回强制 + 失败不泄漏 | T-owner-scope | 契约测试：跨 scope → `FILE_UNAVAILABLE`，无原始内容 |
| 越界返回空页 + `truncated=false`/无 nextOffset，不抛错 | T-out-of-range | unit 测试：offset 超长 → 空页 + truncated=false/无 nextOffset |
| externalize 幂等（replay 不重复写文件） | T-idempotent | resilience 测试：重复 append / replay 不重复写文件 |
| access instruction 指向 read + file_path | T-access-instruction | 契约测试：PERSISTED_PREVIEW 块含 file_path + read 指引 |

## 文档承载决策（Documentation Ownership）

- 行为契约（capability-result externalize 到 workspace 文件 + conformant form、readback 分页/授权/豁免/越界）→ `openspec/specs/large-content-references/spec.md`（修改 externalize 目标）+ `openspec/specs/large-content-readback/spec.md`（新增）。
- 架构/跨模块设计（externalize 咽喉点、port 注入、读回跨模块流程、数据 ownership）→ `openspec/designs/architecture/` 对应 topic（按现有 context/large-content 主题归属，不新增平行目录）。
- 模块设计（`agent-runtime` RunMessagePort externalizer hook、`agent-capability` workspace `tool-results/` 写入 + read paging-required 错误、`agent-context-engine` large-content 消费）→ `openspec/designs/modules/agent-runtime.md` / `agent-capability.md` / `agent-context-engine.md`。
- ADR（workspace 文件 externalize 取舍、跨 session 耐久性 deferred 风险、read 豁免防循环、externalize 触发点=appendMessage）→ `openspec/designs/adr/<id>.md`。
- 导航 → `openspec/designs/spec-to-design-map.md`。

`LargeContentExternalizerPort` 契约主承载归 `agent-contracts/runtime`（接口语义），其消费关系归模块设计文档，不在多处重复定义。

## 风险与取舍（Risks / Trade-offs）

- [跨 session 读回失效 / 文件被清理（**deferred，本期不处理**）] → execution workspace 按 `sessionId` 隔离（`deriveExecutionScopeKey` 含 sessionId），且 `execution-cleanup-jobs.ts` 有按年龄清理任务。后果：新 session 或清理后，`tool-results/<refId>.txt` 不可达 → `read` 返回 `FILE_UNAVAILABLE`，而消息库 `content` 已是预览 → 原始内容在该场景下不可读。缓解：本期接受（用户决策"先不考虑"），design + ADR 记录；未来如需跨 session 耐久性，迁移到 blob 库（`BlobStoreGateway`/`blobs` 表，与 session 解耦）或把 `tool-results/` 纳入持久 workspace + 排除清理。
- [遗留存量 oversized 记录无 `file_path`，模型读不回] → 缓解：按 legacy 降级（兜底 bounded preview + diagnostic），不做回填迁移；新记录全部 conformant。
- [externalize 在 `appendMessage` 同步路径增加写文件 I/O] → 缓解：本地文件写入低延迟；写文件失败走三步收口不阻塞正确性；幂等（`metadata.replacement` 存在则跳过）。
- [`tool-results/` 命名空间与真实 workspace 文件冲突 / 后续被模型或工具改写] → 本期按用户决策不处理模型和工具后续修改该目录的情况；`tool-results/` 是约定的 capability-result readback 目录，但不在本 change 中引入普通 write/edit/sandbox 的 reserved-dir 禁写规则。后续如需要审计级不可变性，再引入系统管理只读投影或迁移到 blob-backed authority。
- [`contentRef.refId` 语义偏离 baseline BlobRef] → F 记录的 `contentRef.refId` 是 workspace 相对路径，非 `BlobRef`。当前 wired 路径无消费者对 capability-result 记录调 `readPersistedPreview`（其仅用于 attachment），故暂不爆；但同一 `ReplacementEvidence.contentRef` 字段在 attachment=BlobRef、capability-result=workspace 路径。缓解：显式约束 `readPersistedPreview` / 任何按 BlobRef 解析 contentRef 的路径 MUST NOT 作用于 capability-result F 记录；capability-result 读回只走 `read` 工具。negative 测试断言 F 记录不被 BlobRef-resolver 触发。归档时在 `large-content-references` spec 注明 capability-result 的 `contentRef.refId` 语义为 workspace 路径。
- [`tool-results/` 可读性] → `readText` 经 `resolveTarget` + `policy.readDirectories` 校验；需确保 `tool-results/` 落在 read 允许的 workspace 读目录内，否则模型 `read` 调用被 `CAPABILITY_PATH_REJECTED`。缓解：externalizer 写入的 `tool-results/` 必须在 `read` 可读范围内（workspace 根 readWrite，子目录应可读）；实现时验证 + 测试。
- [refId 非确定 → append 重试产生孤儿文件] → 缓解：`refId` 由确定性 id factory（基于 messageId+kind）生成，重试写同一路径（覆盖/`wx` 幂等），不产生孤儿。
- [non-UTF-8 内容进 workspace 文件] → 缓解：binary 走 `SPECIALIZED_REF` 不应进此路径；`read` 已有 `decodeText` 处理，读回时按文本解码失败降级 `FILE_UNAVAILABLE`。

## 迁移计划（Migration Plan）

无数据迁移、无破坏性 API 变更。部署步骤：

1. 新增 `LargeContentExternalizerPort` 契约 + 实现（app composition 注入，组合 `applyReplacement` + workspace 写入 + resolver）。
2. `RuntimeOwnedRunMessagePort` 增加可选 externalizer 依赖，写入前调用；未注入时直通（向后兼容，可灰度）。
3. 装配/渲染侧加 `Read` 豁免 + conformant 透传（`read` 工具不改）。
4. 全量发布后，新写入 oversized 工具结果自动 externalize 到 workspace 文件。

**回滚策略**：externalizer 为可选注入，回滚即停止注入 port（`appendMessage` 直通，回到裸截断行为）。`read` 工具无改动，旧调用不受影响。已 conformant 的记录仍可被旧逻辑读取（`content` 是 preview，`metadata.replacement` 被忽略不影响正确性）；其 `tool-results/` 文件可留存或由 workspace 清理任务回收。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-core-contracts/spec.md`：修改——`BlobStoreGateway` 不再声明承载 oversized textual capability-result；该来源由 large-content/readback 走 execution workspace 文件。
- `openspec/specs/large-content-references/spec.md`：修改——capability-result externalize 目标改为 execution workspace 文件 + conformant PERSISTED_PREVIEW（access instruction 指向 `read` + `file_path`）；attachment/artifact/model-summary 等 blob-backed 来源仍走 `BlobStoreGateway`。
- `openspec/specs/large-content-readback/spec.md`：新增 capability baseline（readback 经 `read` + `file_path`、owner-scope 经 workspace resolver、`read` 豁免、越界空页）。
- `openspec/overview.md`：补充"工具大结果 externalize 到 workspace 文件、可被模型按需分页读回"的产品级背景与目标。
- `openspec/designs/architecture/<topic>.md`：externalize 咽喉点、port 注入、读回跨模块流程、数据 ownership（归现有 large-content/context 主题）。
- `openspec/designs/modules/agent-runtime.md` / `agent-capability.md` / `agent-context-engine.md`：externalizer hook（写 workspace 文件）、`tool-results/` readback 目录、large-content 消费落点、oversized single-read paging-required 错误。
- `openspec/designs/adr/<id>.md`：workspace 文件 externalize 取舍、跨 session 耐久性 deferred 风险、不处理后续模型/工具改写 `tool-results/` 的取舍、read 豁免防循环、externalize 触发点取舍。
- `openspec/designs/spec-to-design-map.md`：新增/修改 capability 到 design 的导航。

## 待确认问题（Open Questions）

- `LargeContentExternalizerPort` 契约归 `agent-contracts/runtime` 还是 `agent-contracts/session` 子path，需与既有 port 归属惯例对齐（实现时确认，不影响设计决策本身）。
- externalizer 写 `tool-results/` 文件是复用 `workspaceFiles.writeText`（经其授权/路径校验）还是经更底层 writer，在 task 实现阶段按最小权限收敛；本 change 不要求 reserved-dir 禁写语义。
