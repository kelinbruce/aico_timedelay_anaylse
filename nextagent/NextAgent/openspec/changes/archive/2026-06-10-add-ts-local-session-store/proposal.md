# add-ts-local-session-store

## 背景与问题

`agent-platform-gateway-local` 内的 `SessionStoreGateway`（loadSession/listSessions/saveSession）和 `SessionMessageStoreGateway`（appendSessionMessage/loadMessage/listMessages/listCurrentRequestMessages）已有完整 SQLite 实现，覆盖了 session 创建→消息持久化→历史读取→终端回答的主链路。但以下能力存在缺口：

1. **`hideMessage` 是 no-op stub** — 方法签名不接受 `HideMessageRequest` 参数，返回 `undefined`，无法将 `visible` 列从 1 改为 0。`messages.visible` 列和 `listMessages` 的 `includeHidden` 过滤已就绪，但写路径缺失。
2. **active context compaction 缺少端到端验证** — `hideMessage` 是 active context compaction 的必要前提，当前无法验证 compaction 流程是否正确移除不可见消息的 active context items。此项由未来 compaction change 负责。
3. **contract/integration tests 不足** — 现有测试通过 runtime 间接覆盖，缺少直接针对 `SessionStoreGateway` 和 `SessionMessageStoreGateway` 的 contract tests，以及针对 owner scope/agent scope 边界的专项测试。
4. **sessions、messages、attachments、pending_inputs 四张表仍使用 `json TEXT` 列存储完整 Record** — 所有字段打包为单一 JSON blob，读写都依赖 `JSON.stringify`/`JSON.parse`。`touchSession()` 仅为了更新 `updated_at` 却要走读 json→解析→修改→写回 json 的完整链路。与已完成的 `checkpoints` 表独立列模式不一致，也不符合 AGENTS.md 「禁止用 generic records(store,key,json) 承载业务事实」的架构约束。

本 change 不再作为"本地 store 初始实现"——实际实现已存在且工作。本 change 追认当前已实现能力，补齐 `hideMessage` 和必要的测试，并完成四张表的独立列 schema 迁移。

## 变更范围

- 实现 `hideMessage(request: HideMessageRequest)` — UPDATE `messages.visible=0` 并写入 `hide_reason`/`hidden_at`/`hidden_by_context_id`，返回更新后的 `SessionMessageRecord | undefined`
- 补齐 `SessionMessageStoreGateway` contract test — 验证 `hideMessage` 的正确行为（隐藏后 listMessages 排除、loadMessage 仍返回、不存在的 messageId 返回 not-found）
- 补齐 `SessionStoreGateway` contract test — 验证 loadSession/listSessions/saveSession 的 owner scope + agent scope 边界
- **sessions 表 schema 迁移**：新增 `title TEXT`，删除 `json TEXT`，所有读写改为独立列
- **messages 表 schema 迁移**：新增 `content TEXT`、`content_type TEXT`、`metadata TEXT`，删除 `json TEXT`，所有读写改为独立列
- **attachments 表 schema 迁移**：新增 `file_name TEXT`、`media_type TEXT`、`storage_ref TEXT`，删除 `json TEXT`，所有读写改为独立列
- **pending_inputs 表 schema 迁移**：新增 `request_context_id TEXT`、`checkpoint_id TEXT`、`kind TEXT`、`created_at INTEGER`、`request TEXT`、`response_answers TEXT`，删除 `json TEXT`，所有读写改为独立列
- 架构测试更新：验证四张表无 `json` 列

**不在范围**：
- 已实现的 loadSession/listSessions/saveSession/appendSessionMessage/loadMessage/listMessages/listCurrentRequestMessages — 不重新实现，只改内部存储格式
- RequestRun/Timeline 持久化 → `add-ts-local-run-timeline-store`
- Checkpoint → `add-ts-local-checkpoint-store`
- Artifact → `add-ts-local-artifact-store`
- 恢复策略 → `add-ts-local-runtime-recovery`
- 新增或修改核心契约
- 数据迁移 — v1 无存量数据，直接修改 DDL，删除 json 列

## Capability 影响

| 类型 | Capability | 说明 |
|------|-----------|------|
| 补实 | `local-session-store` | hideMessage 从 stub 补为真实实现；contract/integration tests 补齐 |
| 改进 | `local-session-store` | sessions/messages/attachments/pending_inputs 四表从 json blob 改为独立列，与 checkpoints 表模式一致 |

## 影响范围

- `agent-platform-gateway-local`：`SqliteGatewayStores` 四张表的 DDL、INSERT/SELECT/UPDATE 全部改为独立列绑定；废弃 `parseJsonRow<T>()` 对四张表的使用
- `agent-context-engine`：compaction 流程获得可工作的 hideMessage 后端
- 测试：新增 contract tests 和 integration tests；架构测试更新

## 归档前基线提升计划

核心契约 `SessionStoreGateway` 和 `SessionMessageStoreGateway` 已在 `establish-ts-core-contracts` 中完成定义，本 change 归档时无需向 `openspec/designs/contracts/` 新增内容。