## REMOVED Requirements

### Requirement: Single Storage With History Reconstruction

**Reason**：该 legacy Requirement 同时承载 CLIP/ordinary Message-first history 与 Workflow Event-owned 例外，跨越 `FN-1.2 断线后从上次位置继续` 和 `FN-9.8 持久化和恢复工作流` 两个 Function。继续在未映射 canonical Function 的 legacy spec 中修改会保留重复规范 owner。

**Migration**：归档时必须在同一次 stable spec 更新中移除本 Requirement，并把其全部 CLIP/ordinary Message-first 行为无损迁入 `ts-stream-history-consistency` 的 `结构化过程正文使用单一 Message 恢复`。`appendCapabilityResultMessage` 白盒调用路径只迁入本 change design，不进入目标 Function spec。原 Requirement 的字符串载荷 deferred Scenario 原样保留在目标 Requirement，本 change 不实施该 deferred 行为。

### Requirement: Workflow Selective Persistence

**Reason**：Workflow product persistence 属于 `FN-9.8 持久化和恢复工作流`，继续留在 `tool-structured-delta` 会与新的 canonical `workflow-event-history` 形成重复 owner。

**Migration**：归档时必须在同一次 stable spec 更新中移除本 Requirement，并由 `workflow-event-history` 的 `Workflow 内部过程与模型会话事实分离` 与 `Workflow 完成态产品过程可从 Event 恢复` 无损承载 completed product durable Event、fragment live-only 和 history recovery 行为。`tool-structured-delta` 中其他未触及 Requirements 必须原位保留。
