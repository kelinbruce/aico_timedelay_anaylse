## 背景与问题（Why）

Issue 5 显示 `network-explorer` 的 RAG 调用失败并返回 `SCOPE_MISMATCH`，尽管本地 RAG 索引存在。本地 RAG 治理 scope 检查把检索绑定到默认 Agent id/version，导致同一 composition 内的 Agent 在查询 workspace 索引之前就被拒绝。

本地 RAG 治理是 workspace 级语料索引。同一可信 owner 和 workspace scope 下的多个 Agent 应当都能从该共享本地索引检索。

## 变更范围（What Changes）

- 把本地 RAG 检索 scope 视为 owner + workspace knowledge scope。
- 不再仅因 `agentId` 或 `agentVersion` 不同而拒绝本地 RAG 检索。
- 保留 tenant、subject、knowledge scope kind 和逻辑 workspace root 作为硬安全边界。
- 保持 provider、workspace root、SQLite 路径、FTS 表达式和索引权威对 Tool 输入和模型输出不可用。

## 影响范围（Impact）

- `agent-platform-gateway-local`：本地 RAG scope 匹配不再把 Agent id/version 用作拒绝条件。
- 测试：为同 owner 跨 Agent 检索和 owner 不匹配拒绝新增本地 RAG 回归覆盖。
