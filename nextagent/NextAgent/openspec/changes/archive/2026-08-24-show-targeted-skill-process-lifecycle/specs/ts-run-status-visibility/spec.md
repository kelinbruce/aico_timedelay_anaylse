## Function

- **所属 Function**：`FN-2.4 查看请求状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: ProcessDetail 必须显示定向 Skill lifecycle

当 canonical runtime timeline 包含定向 Skill 的 `CAPABILITY_STARTED` 或 `CAPABILITY_COMPLETED` 时，用户可见 stream projection 和 Agent Web ProcessDetail MUST 按既有 Capability lifecycle 规则显示该步骤。标题 MUST 使用与普通模型 function call 选择的 Skill 相同的身份解析和业务标题规则，例如 `capabilityId=Skill` 与 `targetCapabilityId=alarm-diagnosis` 显示为“加载技能：alarm-diagnosis”或当前有效显示名。live stream 与刷新后的 history MUST 对同一 timeline facts 输出相同步骤；前端 MUST NOT 从用户消息 metadata、`POLICY_APPLIED`、前端本地 state 或 Skill 列表选择状态推导 Capability 步骤。旧 history 不包含该事实时，系统 MUST NOT 补造步骤。

**需求类别**：功能性需求

#### Scenario: 手动 Skill 与嵌套 Skill 都显示

- **WHEN** 用户手动选择 `alarm-diagnosis`，该 Skill 实际加载并产生 Capability lifecycle facts，随后模型通过 function call 加载 `network-diagnostics`
- **THEN** ProcessDetail MUST 按时间顺序显示“加载技能：alarm-diagnosis”
- **AND** ProcessDetail MUST 继续按既有规则显示“加载技能：network-diagnostics”
- **AND** 两个步骤 MUST 使用同一 Skill 标题模板和状态规则

#### Scenario: 刷新后的历史保持一致

- **WHEN** 请求完成后用户重新打开该历史会话
- **THEN** ProcessDetail MUST 从持久化 timeline facts 重新渲染手动选择 Skill 的 lifecycle 步骤
- **AND** 该步骤的标题、顺序和状态 MUST 与 live stream 中基于同一 facts 的呈现一致

#### Scenario: 旧历史不补造步骤

- **WHEN** 旧请求的持久化 timeline 不包含定向 Skill 的 `CAPABILITY_STARTED` 或 `CAPABILITY_COMPLETED`
- **THEN** ProcessDetail MUST NOT 根据用户消息 metadata、`POLICY_APPLIED` 或当前 Skill 列表状态补造该步骤

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：请求状态可见性将定向 Skill lifecycle 纳入既有 Capability 过程展示，并保持 live/history 一致；不展示调用前未发生的执行事实。
- **依据 Requirements**：`ProcessDetail 必须显示定向 Skill lifecycle`

### 规格

- **规格项**：定向 Skill 过程标题
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`Skill + targetCapabilityId` 使用与普通 Skill 调用相同的“加载技能：<目标 Skill>”标题规则。
- **依据 Requirements**：`ProcessDetail 必须显示定向 Skill lifecycle`

### 主规格

- **变更类型**：修改
- **目标内容**：`ts-run-status-visibility`
- **依据 Requirements**：`ProcessDetail 必须显示定向 Skill lifecycle`
