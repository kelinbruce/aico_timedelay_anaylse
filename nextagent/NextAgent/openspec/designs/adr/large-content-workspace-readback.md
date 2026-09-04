# ADR: Large tool result externalize 到 execution workspace 文件

## 背景

工具（capability）返回大结果时，需要把完整内容 externalize 并让模型能按需读回。baseline `large-content-references` 已规定 `PERSISTED_PREVIEW` MUST 暴露 `contentRef` + access instruction，但未固定 oversized textual capability-result 的 externalize 目标存储。可选方案：execution workspace 文件、`BlobStoreGateway`/`blobs` 表、或新增独立 readback 工具。

## 决策

oversized textual `CAPABILITY_RESULT` externalize 到 execution workspace 文件 `workspace/tool-results/<refId>.txt`，模型经现有 `read` 工具按 `file_path` + 可选 `offset`/`limit` 分页读回。attachment / artifact / model-summary 等 blob-backed 来源仍走 `BlobStoreGateway`，不变。

## 理由

- 复用现有 `read` 文件分页心智和 owner-scope 授权路径，模型零学习成本。
- 避免新增 readback tool、`read` 参数、blob id 暴露或虚拟 path router。
- execution workspace 已是 owner-scoped（`tenantId`/`subjectId`/`sessionId`）且 `read` 已自管上限 + 行级分页，天然满足读回需求。

被拒绝的方案：

- **externalize 到 blob 库 + 虚拟 path 路由**：跨 session 耐久更强，但需在 `workspaceFiles.readText` 加虚拟 path 路由分支 + 涉及 `BlobStoreGateway`，改动面更大。保留为未来跨 session 耐久性升级的候选。
- **externalize 到 blob 库 + `read` 新增 `content_ref` 参数**：需改 schema + execute 分支。
- **新增独立 readback 工具**：增加模型工具选择面，违背 KISS。

## 其他长期取舍

- **externalize 触发点 = `appendMessage`**：选 `RuntimeOwnedRunMessagePort.appendMessage`（所有 session message 落库的唯一咽喉点）而非装配时或工具执行时，保证"一次写入、跨 turn 一致"。装配时 lazy externalize 需向消息库回写已持久化消息，与 append-only 不变量冲突。

- **`read` 豁免 externalize**：`read` 是大内容的翻页入口，若其输出也 externalize，则形成"读回→超限→再 externalize→再读回"死循环。豁免 + 自管分页是打断循环的唯一确定路径。

- **跨 session 耐久性 deferred**：execution workspace 按 `sessionId` 隔离且有清理任务（`cleanupSkillProjections`/`cleanupLocalRunTemps`）。新 session 或清理后 `tool-results/<refId>.txt` 不可达 → `read` 返回 `FILE_UNAVAILABLE`，消息库 `content` 已是预览，原始内容在该场景下不可读。本期接受该风险；未来如需跨 session 耐久性，迁移到 blob 库（与 session 解耦）或把 `tool-results/` 纳入持久 workspace + 排除清理。

- **`tool-results/` 命名空间**：本期不处理模型或工具后续修改 `tool-results/` 目录的情况，也不为其引入普通 write/edit/sandbox 的 reserved-dir 禁写规则。后续如需审计级不可变性，再引入系统管理只读投影或迁移到 blob-backed authority。

- **`contentRef.refId` 语义偏离 BlobRef**：capability-result F 记录的 `contentRef.refId` 是 workspace 相对路径，非 `BlobRef`。约束 `readPersistedPreview` / 任何按 BlobRef 解析 contentRef 的路径 MUST NOT 作用于 capability-result F 记录；capability-result 读回只走 `read` 工具。
