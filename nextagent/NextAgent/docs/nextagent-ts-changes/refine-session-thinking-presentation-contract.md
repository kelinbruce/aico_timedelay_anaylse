# refine-session-thinking-presentation-contract

规划入口：[P0 local release roadmap](../roadmap/p0-local-release.md)

所属分组：Stream、状态和历史一致性

状态：complete / archived

类型：contract refinement + backend vertical slice

主要 owner：`agent-runtime`

归档入口：[`openspec/changes/archive/2026-07-22-refine-session-thinking-presentation-contract/`](../../openspec/changes/archive/2026-07-22-refine-session-thinking-presentation-contract/)

## 已交付目标

- Thinking 保持 canonical timeline event，不是 message 或 assistant part。
- 调用中和完成态都复用 `LLM_THINKING_DELTA`；调用中累计 delta 为 `LIVE_ONLY`，单次模型调用最后一个非空累计 delta 以 `completed=true` 和 `PERSISTED` 保存。
- Event persistence policy 使用声明式类别规则；`LLM_CONTENT_DELTA`、`CAPABILITY_RESULT_DELTA` 等其他 live delta 不因本能力扩大持久化范围。
- `GET /api/v1/sessions/:sessionId/runs/:runId/events` 通过 `RuntimeSessionPort.listEvents` 查询安全、分页、run-scoped 的 event history；message query 继续负责最终对话内容。
- REST history、SSE、WebSocket 与 resume 复用 shared safe `StreamEnvelope` projector。
- Fork 在既有 composite transaction 中复制 message prefix 对应的 durable process events，重映射为 child-owned `FORK_SNAPSHOT`；不复制 `RequestRun`、checkpoint、pending input、context 或其他 lifecycle state。
- Event history 不进入 ActiveContext、模型输入或 prefix cache。

## 稳定设计与规格

- 端到端设计：[`conversation-process-history.md`](../../openspec/designs/architecture/conversation-process-history.md)
- 核心契约：[`core-contracts.md`](../../openspec/designs/architecture/core-contracts.md)
- 稳定 requirements：`local-run-timeline-store`、`session-fork-from-message`、`ts-core-contracts`、`ts-minimal-agent-kernel`、`ts-run-status-visibility`、`ts-stream-history-consistency`

## 明确非目标

- 不持久化 token/partial thinking frame，不回填升级前历史 thinking。
- 不新增 thinking event type、message role 或 history-only adapter。
- 不实现 thinking 字段级脱敏、限长、externalize、管理员策略或分享/导出。
- 不把 fork snapshot 变成可操作 runtime lifecycle fact。

## 验收基线

- Partial thinking 零持久化 row；每次有 thinking 的 model invocation 至多持久化一个完成累计 delta。
- Event API 按 Owner Scope、Agent Scope、session、run 和 cursor fail closed。
- Fork snapshot 在 source 删除后仍可由 child 独立查询，且不进入 stream、resume、cancel、retry、edit、recovery 或 context。
- `openspec validate --all --strict` 与 architecture gate 通过。
