## Function

- **所属 Function**：`FN-5.6 向用户提问`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: AskUserQuestion default timeout uses portal ability config

当 canonical builtin `AskUserQuestion` 创建 pending input 且 pending input intent 未显式提供 `timeoutAt` 时，runtime MUST 使用 effective `ask-user-question-time-minutes` 计算默认 accepted `timeoutAt`。该值必须为 `1..1440` 分钟，非法配置回退 `30` 分钟。pending input intent 显式提供 `timeoutAt` 时，显式值 MUST 优先，MUST NOT 被配置值覆盖。

该配置 MUST 只影响 canonical builtin `AskUserQuestion` 产生的新 pending input。其他 QUESTION producer、CONFIRMATION、AUTHORIZATION、HUMAN_HANDOFF 和 Workflow interrupt pending input MUST 继续使用既有默认 timeout。REMOTE 配置变化后，已 accepted pending input 的 `timeoutAt` MUST 保持不变，只有之后新创建的 canonical `AskUserQuestion` pending input 使用新 effective 值。

**需求类别**：功能性需求

#### Scenario: 配置值成为默认等待时间
- **WHEN** canonical `AskUserQuestion` 创建未显式提供 `timeoutAt` 的 pending input
- **AND** effective `ask-user-question-time-minutes=5`
- **THEN** accepted `timeoutAt` MUST 等于 pending input 创建时刻后 5 分钟

#### Scenario: 非法配置回到默认等待时间
- **WHEN** canonical `AskUserQuestion` 创建未显式提供 `timeoutAt` 的 pending input
- **AND** effective 配置解析结果为非法回退
- **THEN** accepted `timeoutAt` MUST 等于创建时刻后 30 分钟

#### Scenario: 显式 timeout 优先
- **WHEN** canonical `AskUserQuestion` 的 pending input intent 显式提供合法 `timeoutAt`
- **THEN** runtime MUST 使用显式 `timeoutAt`
- **AND** MUST NOT 用 portal ability 配置值覆盖该值

#### Scenario: 只影响 canonical AskUserQuestion
- **WHEN** Hook、Workflow 或其他 Capability producer 创建未显式提供 `timeoutAt` 的 pending input
- **THEN** runtime MUST 继续使用既有默认 30 分钟
- **AND** MUST NOT 使用 `ask-user-question-time-minutes`

#### Scenario: 配置变化不影响已接受提问
- **WHEN** canonical `AskUserQuestion` pending input 已被 accepted
- **AND** REMOTE 模式下 `ask-user-question-time-minutes` 之后发生变化
- **THEN**该 pending input 的 accepted `timeoutAt` MUST 保持不变
- **AND** 之后新创建的 canonical `AskUserQuestion` pending input MUST 使用新的 effective 值

## Function 变更汇总

### 规格

- **规格项**：AskUserQuestion 默认等待时间
- **变更类型**：新增
- **原规格值**：固定 30 分钟
- **目标规格值**：受信 `ask-user-question-time-minutes`，integer，`1..1440` 分钟，默认 30 分钟；仅影响未显式指定 `timeoutAt` 的新 canonical `AskUserQuestion` pending input。
- **依据 Requirements**：`AskUserQuestion default timeout uses portal ability config`
