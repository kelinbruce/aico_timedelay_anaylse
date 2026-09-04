# establish-conversation-process-history-continuity

规划入口：[P0 local release roadmap](../roadmap/p0-local-release.md)

所属分组：Stream、状态和历史一致性

状态：complete / archived

类型：frontend history hydration + interaction change

主要 owner：`frontend/agent-web`

归档入口：[`openspec/changes/archive/2026-07-22-establish-conversation-process-history-continuity/`](../../openspec/changes/archive/2026-07-22-establish-conversation-process-history-continuity/)

## 已交付目标

- 浏览器先读取 conversation messages，再按可见 assistant turn 的 display `runId` 读取 run event history；message 与 event 保持独立 truth source。
- Live stream 与 history event page 复用同一 `StreamEnvelope` projection 和 process-entry reducer；完成 thinking 通过同一 `LLM_THINKING_DELTA` identity 更新，不生成第二份卡片。
- Event history 按 cursor 读取到结束；空 projected page 仍继续翻页，避免 timeline-only event 造成提前终止。
- Retry 只展示当前可见 attempt 的 display run；fork history 使用 child-owned `FORK_SNAPSHOT`，legacy fork 显示安全的详情不可用状态。
- Process Panel 在运行中展开，active thinking/capability entry 自动展开；entry 完成后保持 800ms 再折叠，request 终态后外层在 150ms 后折叠。
- 手动展开后完整过程仍可查看；cold history 默认折叠。`prefers-reduced-motion` 下跳过 800ms settle 和 200ms 动画但保持相同终态。
- local、immersive、collaborative 三宿主复用 shared chat workspace、history loader、reducer 与 `ProcessPanel`。

## 稳定设计与规格

- 端到端设计：[`conversation-process-history.md`](../../openspec/designs/architecture/conversation-process-history.md)
- UI 状态映射：[`conversation-ui-state.md`](../../openspec/designs/architecture/conversation-ui-state.md)
- 稳定 requirements：`agent-web-multi-host-modes`、`agent-web-process-panel`、`ts-stream-history-consistency`

## 明确非目标

- 不重新定义 backend persistence、event endpoint、fork snapshot 或 runtime lifecycle。
- 不持久化模型调用中的 partial delta；仅最后累计且 `completed=true` 的 `LLM_THINKING_DELTA` 持久化。不把 thinking 拼接到下一轮模型输入。
- 不实现 thinking 脱敏/限长、share/export、长答案折叠、并行批次元数据或其他独立 UCD gap。

## 验收基线

- Live 完成态与重开 history 后的 thinking/tool 顺序、内容、完成状态一致且无重复。
- FAILED、CANCELED、SUPERSEDED、retry、fork、分页和 opening reconcile 均有可重复验证路径。
- 三宿主浏览器旅程、frontend build/test 和 mode build 已由交付 change 验证；归档继续以 strict OpenSpec 和 architecture gate 校验稳定边界。
