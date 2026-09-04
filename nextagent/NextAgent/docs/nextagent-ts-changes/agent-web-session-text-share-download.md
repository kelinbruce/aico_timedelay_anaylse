# agent-web-session-text-share-download

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Session 管理
对应能力：F9 会话分享文本化
优先级：P2

状态：ready
类型：实施 change
主要 owner：`agent-session`
协作 owner：`agent-channel-web`
依赖：`add-ts-local-session-store`、`add-ts-local-configured-auth`

目标：
- 支持把会话整理为可外发的纯文本 transcript，供用户复制或下载。
- 文本分享结果只包含用户消息和 agent 最终回答，不暴露 thinking、tool、timeline 或 owner metadata。
- 下载能力限定为会话文本导出，不扩展为通用 artifact download 平台。

规格输入：
- `POST /api/v1/sessions/{sessionId}/text-share` MUST 校验 owner scope，并生成当前会话的纯文本导出结果。
- 纯文本导出 MUST 按会话顺序输出 user message 与 agent final answer；MUST NOT 包含 thinking/reasoning、tool call arguments/results、timeline event、audit data、`tenantId`、`subjectId`、`agentId`、`agentVersion` 或内部 message metadata。
- 文本导出 MUST 经过 redaction policy，确保分享文本不泄露 secret、路径、原始 provider error 或高敏字段。
- 系统 MUST 提供 owner-scoped 下载入口，返回 `text/plain; charset=utf-8`，默认文件名包含 `sessionId` 和导出时间戳。
- 系统 MAY 同时返回可复制文本内容与下载引用，但两者内容口径必须一致。
- 若会话没有可见问答内容，系统 MUST 返回 safe validation error，而不是生成空文件。
- 生成和下载文本分享 MUST 产生 audit event（`session.text_share.generated`、`session.text_share.downloaded`）。
- 下载入口只允许导出当前 owner scope 下的会话文本，不得通过公开 token 或匿名链接访问。

契约输入：
- `SessionTextShareView`（`agent-channel-web`）：返回可复制文本、文件名和下载引用的 public DTO。
- `SessionTextExportRequest`（`agent-contracts/session` 或对应 session owning boundary）：表达按 owner scope 导出会话文本的领域请求。
- audit event（`agent-contracts/observability`）：`session.text_share.generated`、`session.text_share.downloaded`。

实现约束：
- `agent-session` 拥有会话文本口径：哪些 message 可见、如何按顺序拼接，以及只暴露最终回答文本。
- `agent-channel-web` 拥有 HTTP route、schema validation、content type、下载响应头和 safe error 投影。
- 不新增 `shareToken`、公开分享页或匿名访问能力；公开链接分享仍由 `agent-web-session-sharing` 单独承载。
- 不复用通用 artifact download 契约来偷渡会话文本导出；本 change 只处理 session-scoped text export。
- 文本导出生成过程不得改写既有 `SessionMessage`、`RequestRun` 或 timeline durable facts。

非目标：
- 不定义公开只读分享链接。
- 不定义 Markdown、PDF、HTML 或富文本导出。
- 不定义多会话批量导出。
- 不定义第三方分享平台 SDK 集成。

验收要点：
- integration test：owner 可以生成并下载当前会话纯文本。
- security test：导出内容不包含 thinking/tool/timeline/owner metadata。
- security test：跨 owner 或匿名访问下载入口失败。
- audit test：生成和下载都产生对应 audit event。
- 验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。

并行边界：
- 不修改 `agent-web-session-sharing` 的公开链接语义；文本导出与公开只读分享保持两个独立 change。
- 不侵入 `add-ts-artifact-downloads` 的通用产物下载边界。
- 不修改 `Session`、`SessionRecord` 或 `SessionMessageRecord` 的既有持久化 schema，除非后续设计明确需要独立导出缓存记录。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
