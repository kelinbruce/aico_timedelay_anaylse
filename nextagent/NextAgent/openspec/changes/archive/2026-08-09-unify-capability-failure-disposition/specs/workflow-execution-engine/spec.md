# workflow-execution-engine Delta Specification

## REMOVED Requirements

### Requirement: Timeout and Retry

**Reason**：该 legacy Requirement 同时覆盖全部节点 retry，无法表达 Capability 自动重试 owner 与 Workflow 显式 exception 的目标边界。

**Migration**：非 Capability 节点的每 attempt timeout、声明 retry 次数、retry 耗尽后的 exception/skipped/failed 结果，以及 Capability 最终失败的零节点重试处置完整迁入 `workflow-contracts / Workflow 节点重试不重放 Capability 最终失败`；`workflow-execution-engine` 的其他 Requirements 原位保留。
