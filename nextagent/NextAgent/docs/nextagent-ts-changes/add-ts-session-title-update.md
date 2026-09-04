# add-ts-session-title-update

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Session Title Management

状态：active
类型：实施 change
主要 owner：`agent-session`、`agent-channel-web`
依赖：`add-ts-local-session-store`

目标：
- 支持 session owner 手动修改 4-40 字符 session title，持久化为 user title source 并更新历史列表展示；修改必须校验长度、空值、安全字符、敏感内容和 owner 权限，并记录 audit。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 为本地多会话使用提供可读 session title，首版纳入自动标题生成和用户手动修改标题。

共享规格输入：
- Session title generation 在首个用户请求完成后触发，不阻塞回答 terminal commit。
- 生成方式采用确定性规则提取问题短语，不调用模型。
- 标题长度限制为 4-40 字符。
- 生成过程必须清理换行、控制字符和不安全内容，并执行 redaction policy。
- 标题不允许 raw secret、path、token 等敏感内容。
- 如果用户已经手动修改过标题，自动生成不得覆盖。
- 只有 session owner 可以修改标题。
- 手动标题长度同自动生成，为 4-40 字符。
- 空值、全空白、超长、包含控制字符或敏感内容时返回 safe error。
- 修改后设置 `titleSource=user`，自动标题生成不得覆盖 `titleSource=user` 的标题。
- 修改操作写 audit event `session.title.updated`，至少记录 sessionId、tenantId、subjectId、operator subject、oldTitleRef 或 safe summary、newTitleRef 或 safe summary、timestamp。
- 首版不提供恢复自动标题或重新生成标题。

并行边界：
- title generation 不得改写 request terminal result，不得阻塞回答终态提交。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
