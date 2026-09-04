# add-large-tool-result-paged-readback

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Context Assembly

状态：active
类型：实施 change
主要 owner：`agent-runtime`（externalizer 咽喉点）、`agent-context-engine`（large-content 消费与装配透传）；externalizer 实现归 app composition 注入
依赖：`add-ts-large-content-references`（capability-result externalize baseline）

目标：
- 超限 `CAPABILITY_RESULT` 在写入消息库前同步 externalize 到 execution workspace 文件（`workspace/tool-results/<refId>.txt`），模型可见形态为带 `file_path` + access instruction 的 `PERSISTED_PREVIEW`，消除"存了够不着"和"默默截断"。
- 模型用现有 `read` + `file_path` + `offset`/`limit` 分页读回该 workspace 文件，`read` 工具 schema 与实现零改动。
- `read` 工具豁免 externalize + 自管分页，打断"读回 → 超限 → 再 externalize → 再读回"循环。
- owner-scope 经 execution workspace resolver 强制；失败路径不泄漏原始内容、跨 scope 内容或身份。

规格输入：
- 超限 `CAPABILITY_RESULT` 写入消息库前 MUST externalize 完整内容到 `workspace/tool-results/<refId>.txt`，并以 `PERSISTED_PREVIEW`（含 `file_path`、original size、bounded preview、指向 `read` 的 access instruction）作为模型可见形态。
- 模型 SHALL 经现有 `read` + `file_path` + `offset`/`limit` 行级分页读回，复用既有 `truncated`/`nextOffset` 语义；SHALL NOT 新增工具或参数。
- readback SHALL 经 execution workspace resolver 按 `tenantId`/`subjectId`/`sessionId` 强制 owner scope；跨 scope / 文件缺失 / 不可读 SHALL 返回 `read` 的 `error: "FILE_UNAVAILABLE"`，SHALL NOT 泄漏原始内容。
- `read` 工具 SHALL 豁免 externalization，其输出始终为 bounded page。
- 越界读回 SHALL 返回空页（`truncated=false`、无 `nextOffset`），SHALL NOT 抛错。
- 装配/渲染 SHALL 透传 conformant 形态，SHALL NOT 对新 oversized capability-result 产出无引用裸预览。

契约输入：
- `agent-contracts/runtime`：新增 `LargeContentExternalizerPort`（可选注入点，`externalize(draft, executionContext)`）。
- `agent-contracts/session`：复用 `ContentRef` / `ReplacementEvidence`；capability-result 的 `contentRef.refId` 语义为 workspace 相对路径（偏离 baseline 的 `BlobRef` 解析，需先提 contract refinement change 或显式修改前序计划）。
- `RuntimeOwnedRunMessagePort.appendMessage`：externalizer 咽喉点（写入前调用）。
- 既有 large-content 库（`applyReplacement` / `classifyReplacement` / `renderPersistedPreviewBlock`）、execution workspace resolver、`read` 工具 + `workspaceFiles.readText`（均不改）。

实现约束：
- externalizer 以 port 注入，`agent-runtime` 不直接依赖 `agent-context-engine` / `agent-capability`（架构防火墙）。
- `read` 工具 schema 与实现不改。
- capability-result externalize 目标偏离 baseline `large-content-references`（`BlobStoreGateway` → workspace 文件）；归档前须修改 baseline spec 或先提 contract refinement change，并消除 `ContentRef.refId` 在 attachment=BlobRef / capability-result=workspace 路径上的双语义。
- 不涉及 `BlobStoreGateway`；attachment 路径不变。
- 不处理跨 session 耐久性（execution workspace 按 `sessionId` 隔离且有清理任务，本期接受该 deferred 风险）。
- externalize 触发点为 `appendMessage` 写入前同步 externalizer，不在装配/渲染阶段回写已持久化消息。

非目标：
- 不改 micro-compact、auto-compact / traceable-summary、attachment 分类、budget explainability 入口。
- 不新增模型可见工具、不新增 `read` 参数、不引入虚拟 path 路由。
- 不做历史存量消息回填、不做跨 session 耐久性。

验收要点：
- 契约测试：oversized `CAPABILITY_RESULT` externalize 到 workspace 文件（`metadata.replacement` 存在、`content` 为 preview、`workspace/tool-results/<refId>.txt` 已写、含 `file_path` + access instruction）。
- 契约/negative 测试：readback 分页、越界空页、跨 scope 拒绝且无泄漏、文件缺失降级、`read` 豁免 externalize、externalize 幂等（replay 不重复写）、写文件失败走三步收口。
- e2e：模型经 `read` + `file_path` 分页取回 oversized 工具结果尾部，且模型可见形态明确声明截断。
- 架构 gate：无 `agent-runtime → agent-context-engine` / `agent-capability` 直接依赖。

并行边界：
- externalizer 咽喉点归 `agent-runtime`；上下文策略与装配透传归 `agent-context-engine`；`read` / workspace 写入归 `agent-capability`；externalizer 实现归 app composition。
- 不得重新定义 `add-ts-large-content-references` 已冻结 contract；需改变其 capability-result externalize 目标或 `contentRef.refId` 语义时，必须先提 contract refinement change 或显式修改前序计划。
- 不侵入 attachment blob 路径、compression / summary 路径、budget explainability 入口。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
