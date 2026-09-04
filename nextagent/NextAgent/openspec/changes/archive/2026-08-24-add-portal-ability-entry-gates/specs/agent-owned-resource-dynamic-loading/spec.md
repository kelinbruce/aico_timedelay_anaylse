## Function

- **所属 Function**：`FN-5.2 调用能力`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：补充规格

## ADDED Requirements

### Requirement: Portal ability entry configuration fields and defaults

Agent package 的 `config/config.json` 顶层 `portal-ability-config` MUST 支持以下三个 boolean 字段：

- `cron-tasks-enabled`
- `long-term-memory-management-enabled`
- `knowledge-import-enabled`

三个字段的默认值 MUST 均为 `true`。字段值仅接受 boolean；缺失、类型非法或值不是 boolean 时，对应字段 MUST 回退为 `true`，MUST NOT 抛出异常、阻断请求或把字符串 `"false"` 视为关闭。

三个字段 MUST 独立解析和回退。一个字段非法或缺失 MUST NOT 影响其他字段的 effective 值。未知字段 MUST 被忽略，MUST NOT 改变任何已解析字段的 effective 值。

字段值 MUST 来自 active Agent package 的受信 `config/config.json`，MUST NOT 来自请求体、客户端 metadata、模型输出或 Capability 参数。

**需求类别**：功能性需求

#### Scenario: 缺失字段使用默认值

- **WHEN** `portal-ability-config` 不存在，或缺少任一入口字段
- **THEN** 对应字段 effective 值 MUST 为 `true`

#### Scenario: 明确 false 关闭入口

- **WHEN** 任一入口字段为 `false`
- **THEN** 对应字段 effective 值 MUST 为 `false`

#### Scenario: 非法值回退默认值

- **WHEN** 任一入口字段不是 boolean
- **THEN** 对应字段 effective 值 MUST 为 `true`
- **AND** MUST NOT 抛出异常或阻断请求

#### Scenario: 字段独立回退

- **WHEN** 一个入口字段为 `false`，另一个入口字段为非法值
- **THEN** `false` 字段 MUST 保持 `false`
- **AND** 非法字段 MUST 回退为 `true`

#### Scenario: 未知字段不改变有效配置

- **WHEN** `portal-ability-config` 包含三个合法入口字段和一个未知字段
- **THEN** 三个入口字段 effective 值 MUST 保持不变
- **AND** 未知字段 MUST NOT 改变任何入口字段

## Function 变更汇总

### 规格

- **规格项**：Portal ability 入口配置字段
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`cron-tasks-enabled`、`long-term-memory-management-enabled`、`knowledge-import-enabled` 三个 boolean 字段，默认均为 `true`，仅明确 `false` 时关闭对应入口。
- **依据 Requirements**：`Portal ability entry configuration fields and defaults`
