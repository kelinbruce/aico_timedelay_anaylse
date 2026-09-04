## REMOVED Requirements

### Requirement: Process Panel Entry Generation

**Reason**：该 Requirement 被本 change 实质修改后，不再属于独立 legacy structured-message spec。其稳定关联、标题/detail 累积、message type segments、ANSWER/EXPAND_PANEL 和同 sequence 排序行为迁入 `agent-web-process-panel` 的 `TOOL_STRUCTURED_DELTA 过程面板处理`；匹配 runtime Capability lifecycle 的结构化输出改为卡片内部过程，不再强制生成独立 `ProcessEntry`。

**Migration**：归档时删除本 Requirement，并把仍成立的目标行为只合并到 `openspec/specs/agent-web-process-panel/spec.md` 的同名 canonical Requirement。`agent-web-structured-message-rendering` 中未被本 change 触及的其他 Requirements 原位保留。

### Requirement: CAPABILITY_STARTED and COMPLETED Suppression for Structured Tool Calls

**Reason**：抑制 lifecycle 会把同一 runtime Capability 发生实例拆成独立结构化步骤和迟到的 completion 卡片，违反本 change 的单卡片因果投影目标。

**Migration**：归档时删除本 Requirement；目标行为由 `agent-web-process-panel` 的 `TOOL_STRUCTURED_DELTA 过程面板处理` 统一定义为相同 `toolCallId` 的 lifecycle、结构化过程、普通结果和终态聚合。
