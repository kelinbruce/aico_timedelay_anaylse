## 背景与问题（Why）

工具（capability）执行返回大结果时，NextAgent 当前在上下文装配阶段把超限的 `CAPABILITY_RESULT` **在内存里截成约 1KB 预览**喂给模型（`assemble-context.ts` 的 `truncateLargeToolResults` / `truncateRenderedToolResults`）。完整原始内容仍留在 `SessionMessageStore`，没有丢失，但存在三个黑盒问题：

### 存储与取回现状（事实基线）

- **原始内容当前存于** `SessionMessageStore`（本地实现 = SQLite `session_messages` 表的 `content` 字段），完整未动。装配时的截断只发生在内存副本上，**从不写回落库**，因此数据库里保留的就是全文。
- **工具结果当前未进 blob 存储**：`BlobStoreGateway.storeBlob` 的唯一生产用途是 `agent-attachment-runtime` 存附件，与工具结果无关。
- **模型当前无法取回预览以外内容**：wired 的 `<large-content-preview>` 块不带 `contentRef`、不带路径；现有工具中 `read` 按文件路径读文件，而原始内容在 SQLite 消息库、不是文件，无路径可读；不存在"按 `messageId` 或 `contentRef` 读回"的模型可调用能力。
- **`readPersistedPreview()` 不是模型可调用工具**：它是引擎内部函数，默认返回 1KB 预览、`authorizedFullRead: true` 返回全文，且不支持分页，供 audit / 渲染路径使用，并非模型入口。

1. **模型取不回完整内容**：模型可见形态是裸的 `<large-content-preview>`，**不带 `contentRef`、不带路径**，运行时也没有任何模型可调用的工具能按引用读回原始内容。等于"数据存了但模型够不着"。
2. **取回时不能分页**：模型即便想读回，也没有按行翻页的入口。
3. **模型不知道内容被截断**：裸预览块没有 access instruction，模型无法感知信息不全，**可能基于不完整内容作答而不自知**。

**现在处理的必要性**：电信网络智能体场景下，工具结果常为长日志、配置快照、批量巡检输出，**尾部往往是关键信息**（错误、告警、结论）。模型够不着尾部 = 决策依据缺失。当前"存了但够不着 + 默默截断"的组合是最坏形态：既不丢数据又让模型误以为信息完整。

## 变更范围（What Changes）

- **接通 externalize 到 execution workspace 文件**：超限 `CAPABILITY_RESULT` 在 `appendMessage` 写入消息库前，externalize 到 execution workspace 的真实文件 `workspace/tool-results/<refId>.txt`（owner-scoped，经 execution workspace resolver 解析）。模型可见形态为 `PERSISTED_PREVIEW`，携带 `file_path`（`tool-results/<refId>.txt`）+ bounded preview + access instruction。**不再以无引用的内存预览作为最终模型可见形态**。
- **读回折入现有 `read` 工具，复用 `file_path`（不新增参数、不新增工具）**：模型用现有 `read` + `file_path`（`tool-results/<refId>.txt`）+ 可选 `offset`/`limit` 读回该 workspace 文件。`workspaceFiles.readText` 当普通 workspace 文件读取（owner scope 经 workspace resolver、自管 `maxLines`/`maxTextBytes`、行级 `offset`/`limit`/`truncated`/`nextOffset`）。`offset`/`limit` 可以省略并使用现有默认值；当默认读取或显式范围过大、无法在单次响应预算内完整返回时，`read` MUST 返回安全的 paging-required 错误，提示模型用显式 `offset`/`limit` 分页，而不是静默截断。**不新增参数、不新增工具、不引入虚拟 path 路由、不涉及 `BlobStoreGateway`**。
- **`read` 工具豁免 externalize + 自管（防循环不变量）**：`read` 工具的输出 SHALL 始终是 bounded page，**SHALL NOT 被外部化**，避免"读回 → 输出超限 → 再 externalize → 再读回"死循环。当前 `read` 未豁免（`truncateLargeToolResults` 对所有 `CAPABILITY_RESULT` 一视同仁截断），本 change 将其纳入豁免。
- **强制完整性感知**：模型可见的截断形态 MUST 明确声明"内容已截断"并给出"用 `read` + `file_path` 取回"的 access instruction，避免模型基于不完整内容作答。
- **完整性感知机制取舍（不采用抛错）**：不采用"超限抛错逼模型分页"。理由：原始工具结果的截断发生在系统侧（模型未发起分页请求，无处抛错），而 `read` 的分页参数为现有必填语义。越界返回空页 + `truncated=false`/无 `nextOffset` 而非错误。
- **安全边界**：读回 owner scope 经 execution workspace resolver（`tenantId`/`subjectId`/`sessionId`）强制；跨 scope 文件不可达 → `read` 返回 `error: "FILE_UNAVAILABLE"`，不泄漏原始内容。
- **baseline 修改（scope 扩大）**：冻结基线原先把 large capability results 列入 `BlobStoreGateway` 的共享 opaque bytes store。本 change 明确把 **oversized textual capability-result** 的 externalize 目标改为 execution workspace 文件（经 workspace files port 解析），并同步修改 `ts-core-contracts` / `large-content-references` 基线；attachment、artifact、model summary 等其它 blob-backed 来源仍走 `BlobStoreGateway` 不变。选择 workspace 的理由是复用现有 `read` 文件分页心智和授权路径，避免新增 readback tool、read 参数、blob id 暴露或虚拟 path router。
- **已知 deferred 风险（本期不处理）**：execution workspace 按 `sessionId` 隔离且有清理任务（`cleanupSkillProjections`/`cleanupLocalRunTemps`），跨 session 读回可能失效、文件可能被清理。本期接受该风险（详见 design 风险节），未来如需跨 session 耐久性再迁移到持久存储。
- **不改范围**：micro-compact、auto-compact / traceable-summary、attachment 分类、budget explainability 入口均不在本 change 范围。

## Capability 影响（Capabilities）

### 新增 Capability

- `large-content-readback`: 模型可调用的、按 `file_path` 分页读回外部化（workspace 文件）工具结果的能力。定义读回的授权语义（owner scope 经 workspace resolver）、可选分页参数（offset/limit）、bounded page 返回形态、oversized single-read 的 paging-required 错误、`read` 豁免 externalize 与越界空页的安全信号。由现有 `read` 工具 realize（不新增参数、不新增工具），复用其行级 `offset`/`limit` 语义。

### 修改的 Capability

- `large-content-references`: capability-result 的 externalize 目标由 baseline 的 `BlobStoreGateway`/`blobs` 表改为 execution workspace 文件（`workspace/tool-results/<refId>.txt`）；超限 `CAPABILITY_RESULT` MUST 以 durable `PERSISTED_PREVIEW` 形态（`file_path` + access instruction 指向 `read`）作为模型可见形态，禁止无引用的裸内存预览作为最终形态。

## 影响范围（Impact）

- **agent-runtime**：`RuntimeOwnedRunMessagePort.appendMessage` 在写入前调用可选 externalizer（externalizer 解析 execution workspace 并写文件）。
- **agent-contracts/runtime**：新增 `LargeContentExternalizerPort` 契约（externalize 注入点，需 execution context 以解析 workspace，详见 design 决策 2）。
- **agent-context-engine**：提供 `DefaultLargeContentExternalizer`（组合既有 `applyReplacement` + workspace 写文件 persistContent）；`assemble-context.ts` 的 `truncateLargeToolResults` / `truncateRenderedToolResults` 增加 `Read` 豁免 + conformant 透传，不再承担 externalize 职责（由 `appendMessage` externalizer 承担）。
- **agent-capability / capability-catalog**：为 externalizer 提供 `tool-results/` workspace 写入能力；`read` 工具 schema **不新增参数**，但实现需在单次读取过大时返回 paging-required 错误；将 `read` 纳入 large-content 豁免。
- **agent-contracts/gateway**：无契约变更（capability-result 不再走 `BlobStoreGateway`；attachment 仍走，不变）。
- **agent-platform-gateway-local**：无变更。
- **测试**：`large-content-references` 契约测试覆盖"capability-result externalize 到 workspace 文件 + conformant form"；新增 `large-content-readback` 契约 + e2e（分页、越界、跨 scope 拒绝、截断信号、`read` 豁免、externalize 幂等）。
- **baseline 修改**：同步修改 `openspec/specs/ts-core-contracts/spec.md` 与 `openspec/specs/large-content-references/spec.md`，使 oversized textual capability-result 的 full-content authority 指向 execution workspace 文件；其它 blob-backed 来源仍由 `BlobStoreGateway` 承载。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-core-contracts/spec.md`：修改——`BlobStoreGateway` 不再声明承载 oversized textual capability-result；该来源由 large-content/readback 走 execution workspace 文件。
- `openspec/specs/large-content-references/spec.md`：修改——capability-result externalize 目标改为 execution workspace 文件 + conformant PERSISTED_PREVIEW（access instruction 指向 `read` + `file_path`）。
- `openspec/specs/large-content-readback/spec.md`：新增——读回能力（经 `read` + `file_path`、owner-scope 经 workspace resolver、`read` 豁免、越界空页）。

长期背景：
- `openspec/overview.md`：补充"工具大结果 externalize 到 workspace 文件、可被模型按需分页读回"的产品级背景与目标。

设计视图：
- `openspec/designs/modules/agent-runtime.md` / `agent-capability.md` / `agent-context-engine.md`：externalizer hook（写 workspace 文件）、`tool-results/` readback 目录、large-content 消费落点、oversized single-read paging-required 错误。
- `openspec/designs/architecture/<topic>.md`：externalize 咽喉点、port 注入、读回跨模块流程、数据 ownership（归现有 large-content/context 主题）。
- `openspec/designs/adr/<id>.md`：workspace 文件 externalize 取舍、跨 session 耐久性 deferred 风险、`read` 豁免防循环、externalize 触发点=appendMessage。
- `openspec/designs/spec-to-design-map.md`：更新 `large-content-references` / `large-content-readback` 到 design 的导航。

验证入口：
- 契约测试：capability-result externalize 到 workspace 文件（含 `file_path` + access instruction）；读回分页 / oversized single-read paging-required 错误 / 越界 / 跨 scope 拒绝 / 截断信号；`read` 豁免 externalize；externalize 幂等。
- e2e：模型对超限工具结果能通过 `read` + `file_path` 分页取回尾部内容，且模型可见形态明确声明截断。
