## Function
- **所属 Function**：`FN-10.1 生命周期 Hook`
- **Function 变更类型**：MODIFIED
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Every hook invocation produces a timeline-only observability fact

每次 hook invocation MUST 形成一条 timeline-only `HOOK_INVOKED` event。它至少 MUST 能追溯 `requestRunId`、`sessionId`、`requestId`、`agentId`、`agentVersion`、`hookId`、stage、执行状态、failure mode 与耗时。系统 MUST 对 event payload 执行安全投影；不得持久化或投影 prompt、模型输入输出、Hook mutation 值、Owner Scope、原始异常或其他不安全内容。

对于 `user-query-memory-recall`，系统 MUST 保持既有聚合 `diagnosticCode` 的含义，并以固定、无敏感内容的新增码区分坐标不完整、Assembly/RequestRun/根消息读取失败，以及 L1 搜索和 L2 详情读取的失败或取消。日志还 MUST 在路径适用时记录 L1 候选数、可用 L2 详情数和上下文准入结果。

**需求类别**：可观测性需求

#### Scenario: 主动召回输出可定位的安全摘要
- **GIVEN** `user-query-memory-recall` 已被调用
- **WHEN** Hook 被跳过、依赖读取失败、L1 未命中或失败、L2 失败、未准入上下文或成功注入
- **THEN** `HOOK_INVOKED` MUST 记录对应阶段的固定 `diagnosticCode`
- **AND** 运维人员 MUST 能仅通过该码区分前置条件、L1、L2、上下文准入和幂等跳过
- **AND** 任意诊断字段均 MUST NOT 包含 Query、Owner Scope、记忆 ID、记忆正文、模型消息、mutation 值或原始异常

## Function 变更汇总

### 输出
- **变更类型**：修改
- **目标内容**：主动召回 Hook 的安全诊断码可区分前置条件、L1、L2、上下文准入和幂等跳过。
- **依据 Requirements**：`Every hook invocation produces a timeline-only observability fact`
