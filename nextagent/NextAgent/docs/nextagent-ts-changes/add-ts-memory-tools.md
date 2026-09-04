# add-ts-memory-tools

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：扩展候选 / Long-term memory

状态：candidate
类型：扩展候选 change
主要 owner：Owner 12 Memory / Learning
依赖：add-ts-memory-core

目标：
- 提供 6 个模型驱动的记忆能力工具，覆盖跨会话知识检索、管理、按需用户特征获取和显式遗忘。

规格输入：

- 全部 6 个工具通过统一 capability tool 通道暴露：
  1. `search_memory`：queryText?、categoryFilter?、minConfidence?（默认 0.3）、limit（默认 20）、offset；返回 L1 级别按 hybridScore 降序排列的条目列表
  2. `get_memory_detail`：entryId；返回 L2 级别完整结构化内容；不存在返回 typed safe error
  3. `add_memory`：category、结构化 content、tags[]、briefIndex?（<=100 字符，超出机械截断）、confidence?（默认 0.5）
  4. `update_memory`：entryId、content（部分更新）、tags[]、confidence?、briefIndex?；不存在返回 typed safe error
   5. `forget_memory`：entryId、reason?；立即将 entry 状态置为 DELETED（soft-delete），记录 archiveReason
  6. `get_user_context`：purpose（必填，PERSONALIZATION/TROUBLESHOOTING/WORKFLOW_ADAPTATION/GENERAL）；返回当前用户 UserCharacteristics 条目列表（L1）；用途域过滤返回匹配的 trait；注入方式为 assistant message 非 system message

- briefIndex 由模型显式提供，无模型提供时机械截断 content 生成
- `get_user_context` 不接收 userId/tenantId 参数；身份来自可信 RequestContext
- `get_user_context` 每次调用记录审计事件：purpose、retrievedTraitNames（不记敏感值）、tenantId、subjectId、timestamp
- `get_user_context` 若 memory 禁用或无可用的 UserCharacteristics，返回空结果（非错误）
- 写入工具产生的 entry 初始 state 为 ACTIVE

契约输入：
- `SearchMemoryInput`、`SearchMemoryResult`
- `GetMemoryDetailInput`、`GetMemoryDetailResult`
- `AddMemoryInput`、`UpdateMemoryInput`、`ForgetMemoryInput`
- `GetUserContextInput`、`GetUserContextResult`
- `Purpose` enum（PERSONALIZATION / TROUBLESHOOTING / WORKFLOW_ADAPTATION / GENERAL）
- `UserContextAuditEvent`

实现约束：
- 工具实现位于 `agent-capability-builtins`，通过 capability tool 通道暴露，通过 `MemoryService` 访问长期记忆
- 所有权 scope（`tenantId`、`subjectId`）由 `RequestContext.identityContext` 注入，agent scope（`agentId`）由 `RequestContext.agentId` 注入；工具不得接受 owner/agent 参数
- briefIndex 由模型显式提供，无模型提供时机械截断 content 生成
- `get_user_context` 结果必须以 assistant message 注入，不得修改 system prompt
- `get_user_context` 审计不可变且 tenant 隔离

非目标：
- NOT 定义自动提取算法或后台老化策略
- NOT 定义 REST API 或 Web UI 管理入口
- NOT 定义知识共享协作模型
- NOT 定义配置 namespace 或覆盖路径

验收要点：
- Integration：每个工具在 memory 可用和禁用两种情况下的正确行为
- Contract test：search_memory 混合排序正确性（多维度权重）
- Contract test：get_user_context 用途域过滤正确性
- Security test：get_user_context 拒绝模型传入 userId/tenantId
- Security test：get_user_context 跨租户返回空非错误
- Audit test：get_user_context 每次调用产生正确审计记录

并行边界：
- 不得修改 agent-context-engine 的 context assembly 逻辑
- 不得创建从 agent-memory 到 agent-core/agent-runtime 的依赖
- 不得定义 platform endpoint 或 session store schema
