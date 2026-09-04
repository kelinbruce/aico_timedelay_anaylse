## Function

- **所属 Function**：`FN-10.9 Cron 工具`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Cron task dashboard entry gate

Agent Web MUST 根据 `runtimeConfig.portalAbilityConfig.cronTasksEnabled` 控制定时任务入口可见性。字段为 `true` 或缺失时，入口 MUST 保持当前默认可见行为；字段为 `false` 时，入口 MUST NOT 渲染。

Local、Immersive、Collaborative/PIU 三种宿主 MUST 使用同一个 `cronTasksEnabled` 值控制所有定时任务入口。关闭入口 MUST NOT 影响直达 `/cron-tasks` 路由的既有行为，也 MUST NOT 修改 Cron 任务 API 或任务执行语义。

**需求类别**：功能性需求

#### Scenario: 默认显示定时任务入口

- **WHEN** `cronTasksEnabled` 为 `true` 或缺失
- **THEN** Local、Immersive、Collaborative/PIU 宿主中的定时任务入口 MUST 保持当前可见行为

#### Scenario: 关闭定时任务入口

- **WHEN** `cronTasksEnabled` 为 `false`
- **THEN** Local、Immersive、Collaborative/PIU 宿主中的定时任务入口 MUST NOT 渲染
- **AND** 直达 `/cron-tasks` 路由的既有行为 MUST 保持不变
- **AND** Cron 任务 API 和任务执行语义 MUST 保持不变

#### Scenario: 三宿主入口一致

- **WHEN** `cronTasksEnabled` 为 `false`
- **THEN** Local、Immersive、Collaborative/PIU 中的所有定时任务入口 MUST 均不可见
- **AND** MUST NOT 出现一个宿主隐藏、另一个宿主仍可见的行为

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：定时任务入口由 `cronTasksEnabled` 统一控制，默认可见，`false` 时在三种宿主中隐藏。
- **依据 Requirements**：`Cron task dashboard entry gate`

### 规格

- **规格项**：定时任务入口开关
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`cronTasksEnabled` 默认 `true`；仅 `false` 时隐藏入口。
- **依据 Requirements**：`Cron task dashboard entry gate`
