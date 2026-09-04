# memory-extraction Delta

## MODIFIED Requirements

### Requirement: 跨会话 dreaming 与知识融合

记忆提取 SHALL 通过本地 dreaming lifecycle 运行完整的长期记忆提取和跨会话知识融合。Dreaming 是本地策略提取、candidate 校验、跨会话融合和写入的唯一完整路径。Dreaming MUST NOT 定义 promotion、decay、curator 或 aging lifecycle 行为；confidence 融合仅限于跨会话佐证，不改变 confidence lifecycle 状态机。

证据融合 MUST 按 source evidence 幂等。`lookbackDays` 只是 trajectory 输入窗口，MUST NOT 导致针对相同 source refs 的重复 dreaming cycle 改变已保留的记忆事实。当等价 candidate 匹配到既有 ACTIVE 记忆时，提取 MUST 在保存前比较 candidate 的 `sourceTrace.refs` 与已保留记忆的 `sourceTrace.refs`：

- Source ref evidence identity MUST 包含 `sessionId`、`rootMessageId`、`runId` 和排序后的 `messageRefs`。
- Source ref evidence identity MUST NOT 包含 `extractionCycleId`。
- 如果 candidate 未新增 source evidence refs，提取 MUST 跳过融合，且 MUST NOT 调用 `store.saveLongTermMemory` 或 `store.adjustLongTermMemoryConfidence`。
- 如果 candidate 新增了 source evidence refs，提取 MAY 通过 `store.saveLongTermMemory` 合并这些 refs。
- Confidence corroboration MUST 只在新增独立 source evidence 时运行。独立 source evidence 以 `sessionId`、`rootMessageId` 和 `runId` 界定。

证据融合 MUST 精确使用核心 gateway 路径：通过以既有 `longTermMemoryId` 和新 `sourceTrace.refs` 调用 `store.saveLongTermMemory` 来追加新的提取 source refs；核心 gateway 负责 deterministic sourceTrace merge 和 `extractionCount` 递增。Confidence corroboration MUST 使用 `store.adjustLongTermMemoryConfidence`；提取 MUST NOT 通过 `saveLongTermMemory` 的 partial-update、直接存储写入或 memory tools 更新 confidence。Candidate 匹配、冲突消歧、candidate 拒绝和 confidence corroboration 属于 dreaming / extraction，MUST NOT 由面向模型的 `add_memory` 执行。

#### Scenario: 对同一 source evidence 的重复 dreaming 是幂等的

- **GIVEN** 一个 ACTIVE 记忆已保留某个 task trajectory 的 source ref
- **WHEN** 后续 dreaming cycle 扫描同一 trajectory 并产生带相同 `sessionId`、`rootMessageId`、`runId` 和 `messageRefs` 的等价 candidate
- **AND** 后续 candidate 具有不同的 `extractionCycleId`
- **THEN** 提取 MUST 跳过该 candidate 的融合
- **AND** MUST NOT 调用 `store.saveLongTermMemory`
- **AND** MUST NOT 调用 `store.adjustLongTermMemoryConfidence`。

#### Scenario: 同一 run 的新 source refs 不佐证 confidence

- **GIVEN** 一个 ACTIVE 记忆已保留来自某次 request run 的 source evidence
- **WHEN** 后续 dreaming cycle 产生等价 candidate，其新 message refs 来自相同的 `sessionId`、`rootMessageId` 和 `runId`
- **THEN** 提取 MAY 通过 `store.saveLongTermMemory` 合并新 source refs
- **AND** MUST NOT 提高该记忆的 confidence。

#### Scenario: 新的独立 source evidence 可以佐证 confidence

- **GIVEN** 一个 ACTIVE 记忆已保留来自某次 request run 的 source evidence
- **WHEN** 后续 dreaming cycle 产生等价 candidate，其新 source ref 来自不同的 `sessionId`、`rootMessageId` 或 `runId`
- **THEN** 提取 MAY 通过 `store.saveLongTermMemory` 合并新 source refs
- **AND** MAY 通过 `store.adjustLongTermMemoryConfidence` 运行有界的 confidence corroboration。
