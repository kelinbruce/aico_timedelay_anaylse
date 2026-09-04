## Function

- **所属 Function**：`FN-2.6 指定技能处理`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 定向 Skill 加载必须发布 Capability lifecycle facts

当可信 `routingConstraints.targetSkill` 指定的 Skill 已通过治理校验并实际进入受治理 Capability 调用边界时，系统 MUST 发布 `CAPABILITY_STARTED`；该调用产生最终结果后，系统 MUST 发布 `CAPABILITY_COMPLETED`。同一调用的两个事件 MUST 逐值复用相同 `capabilityKind`、`capabilityId`、`targetCapabilityId` 和 `toolCallId`，且 `targetCapabilityId` MUST 等于已解析的目标 Skill id。`CAPABILITY_STARTED` MUST 引用已持久化的 Tool-use message，`CAPABILITY_COMPLETED` MUST 引用已持久化的 Capability result message。目标 Skill 在 Capability 调用开始前被拒绝、不可用或因请求取消而未开始时，系统 MUST NOT 发布这两类 Capability lifecycle facts；已有 routing evidence 和安全失败语义 MUST 保持不变。

**需求类别**：功能性需求

#### Scenario: 定向 Skill 成功加载

- **WHEN** 请求指定 `targetSkill=alarm-diagnosis`，且该 Skill 通过当前 Agent Scope、Owner Scope 和 capability governance 校验并开始加载
- **THEN** 系统 MUST 发布引用持久化 Tool-use message 的 `CAPABILITY_STARTED`
- **AND** 该事件 MUST 使用 `capabilityKind=TOOL`、`capabilityId=Skill`、`targetCapabilityId=alarm-diagnosis` 和同一 directed Skill 调用的 `toolCallId`
- **AND** 加载产生最终成功结果后，系统 MUST 发布引用持久化 Capability result message 的 `CAPABILITY_COMPLETED`
- **AND** completion MUST 逐值复用 started 事件中的 Capability 身份

#### Scenario: 定向 Skill 在调用前不可用

- **WHEN** 请求指定 `targetSkill=alarm-diagnosis`，但该 Skill 被禁止、超出 Agent Scope 或在 Capability 调用开始前不可用
- **THEN** 系统 MUST NOT 发布 `CAPABILITY_STARTED` 或 `CAPABILITY_COMPLETED`
- **AND** 系统 MUST 保留现有 routing evidence、安全错误或请求失败语义

#### Scenario: 定向 Skill 降级或最终失败

- **WHEN** 定向 Skill 已开始受治理调用，并返回合法降级、失败或超时结果
- **THEN** 系统 MUST 发布引用持久化 Capability result message 的 `CAPABILITY_COMPLETED`
- **AND** 该事件 MUST 表达对应最终状态和安全失败事实，且 MUST NOT 重新解释目标 Skill 身份

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：指定技能处理在目标 Skill 实际进入受治理调用时，同步产生可追溯的 Capability lifecycle facts；调用前失败仍只保留 routing evidence 和安全失败语义。
- **依据 Requirements**：`定向 Skill 加载必须发布 Capability lifecycle facts`

### 规格

- **规格项**：定向 Skill lifecycle 身份
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：started 与 completed 必须复用相同 `capabilityKind=TOOL`、`capabilityId=Skill`、已解析 `targetCapabilityId` 和 `toolCallId`。
- **依据 Requirements**：`定向 Skill 加载必须发布 Capability lifecycle facts`

### 主规格

- **变更类型**：修改
- **目标内容**：`targeted-skill-routing`
- **依据 Requirements**：`定向 Skill 加载必须发布 Capability lifecycle facts`
