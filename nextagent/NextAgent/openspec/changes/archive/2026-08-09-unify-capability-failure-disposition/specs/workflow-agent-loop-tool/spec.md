# workflow-agent-loop-tool Delta Specification

## REMOVED Requirements

### Requirement: Workflow Tool Availability

**Reason**：该 Requirement 同时定义 Workflow Tool 的统一 Capability 调用入口和 `WAITING → DEGRADED` 结果映射；前者属于 `FN-5.2 调用能力`，后者与本 change 的明确控制结果分类冲突。

**Migration**：完整黑盒行为迁入 `capability-catalog / Workflow Tool 通过统一入口忠实返回执行结果`；builtin Tool 可见性、输入、依赖、当前 scope、结构化结果、安全 metadata、visible delta 和失败行为均保留，recipe missing 使用统一 `NOT_FOUND`，合法 `WAITING` 改为 `SUCCEEDED`。

### Requirement: Workflow Result To Capability Result Mapping

**Reason**：该 Requirement 的全部状态映射属于 `FN-5.2 调用能力` 的 first-party Tool 结果闭包，且其中 `WAITING → DEGRADED` 与明确控制结果使用 `SUCCEEDED` 的统一规则冲突。

**Migration**：完整黑盒行为迁入 `capability-catalog / Workflow Tool 通过统一入口忠实返回执行结果`；`COMPLETED`、`FAILED`、`INTERRUPTED`、answer previews、outputVariables 安全过滤和 metadata 行为均保留，合法 `WAITING` 改为无 `safeError` 的 `SUCCEEDED`，无可用 pending context 的 `WAITING` 明确失败。
