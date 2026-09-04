# agent-package-assembly Delta Specification

所属 Function：`FN-3.2 编译智能体装配`

Function 变更类型：修改

spec 角色：主规格

## ADDED Requirements

### Requirement: Agent 运行设置只定义轮次上限和单轮工具调用上限

Runtime-ready `AgentAssembly.runtimeSettings` MUST 使用 `maxTurns` 表达一个 request 的普通 Agent model turn 上限，并 MUST 使用 `maxToolCallsPerTurn` 表达一个普通 model turn 可接纳的 Tool call 上限。`maxTurns` MUST 是正安全整数且缺失时 effective default MUST 为 `50`；`maxToolCallsPerTurn` MUST 是 `1..100` 的安全整数且缺失时 effective default MUST 为 `30`。

`maxTurns` MUST 同时约束有 Tool 和无 Tool 的普通 Agent model turns。`maxToolCallsPerTurn` MUST 统一计数一个 turn 中按模型顺序返回的全部 Tool calls，不区分 read-only 与 side-effecting Tool，也不按 Tool 名称去重。runtime settings MUST NOT 建立平行的 read-only/side-effecting call limits、Tool-call recovery limit 或 request 累计 Tool-call budget。

Agent package compilation MUST 在发布 runtime-ready assembly 前校验显式值；非法类型、非安全整数、`maxTurns < 1` 或 `maxToolCallsPerTurn` 超出 `1..100` MUST fail closed。默认值 MUST 在可信 assembly/config resolution 边界产生，MUST NOT 由不可信 request、模型输出、Capability 参数或 provider options 覆盖。

**需求类别**：功能性需求

#### Scenario: 运行设置使用规范循环上限

- **WHEN** Agent package 声明合法 `runtimeSettings.maxTurns` 和 `runtimeSettings.maxToolCallsPerTurn`
- **THEN** startup compilation MUST 把两个 canonical fields 发布到 runtime-ready `AgentAssembly`
- **AND** Agent loop MUST 使用 `maxTurns` 作为唯一 loop-count bound
- **AND** Agent loop MUST 使用 `maxToolCallsPerTurn` 作为唯一 per-turn Tool-call admission bound

#### Scenario: 运行设置省略循环上限

- **WHEN** Agent package 未声明 `maxTurns` 或 `maxToolCallsPerTurn`
- **THEN** effective `maxTurns` MUST 为 `50`
- **AND** effective `maxToolCallsPerTurn` MUST 为 `30`
- **AND** request 或模型输出 MUST NOT 改写这些 assembly-owned defaults

#### Scenario: 运行设置包含非法循环上限

- **WHEN** Agent package 声明非整数、非安全整数、`maxTurns < 1` 或不在 `1..100` 的 `maxToolCallsPerTurn`
- **THEN** Agent package compilation MUST fail closed before assembly publication
- **AND** 系统 MUST NOT 截断、猜测或静默替换显式非法值

## Function 变更汇总

### 描述

- 变更类型：修改
- 目标内容：runtime-ready Agent assembly 使用 canonical `maxTurns` 和 `maxToolCallsPerTurn` 表达唯一 loop-count 与 per-turn Tool-call admission limits。
- 依据 Requirements：`Agent 运行设置只定义轮次上限和单轮工具调用上限`

### 输入

- 变更类型：修改
- 目标内容：Agent package runtime settings 接受可选合法 `maxTurns` 与 `maxToolCallsPerTurn`，非法显式值 fail closed；runtime-ready assembly 只发布这两个 canonical fields。
- 依据 Requirements：`Agent 运行设置只定义轮次上限和单轮工具调用上限`

### 输出

- 变更类型：修改
- 目标内容：runtime-ready `AgentAssembly.runtimeSettings` 发布两个 canonical limits；缺失时 effective defaults 分别为 50 和 30。
- 依据 Requirements：`Agent 运行设置只定义轮次上限和单轮工具调用上限`

### 处理过程

- 变更类型：修改
- 目标内容：startup compiler 在 assembly publication 前完成 closed-schema 与数值范围校验，不允许 request 或模型覆盖 assembly-owned limits。
- 依据 Requirements：`Agent 运行设置只定义轮次上限和单轮工具调用上限`

### 结果

- 变更类型：修改
- 目标内容：所有 Agent loop 使用同一组可信、可诊断且无平行预算的 runtime settings。
- 依据 Requirements：`Agent 运行设置只定义轮次上限和单轮工具调用上限`

### 规格

- 规格项：Agent loop 运行上限
- 变更类型：新增
- 原规格值：不适用（新增）
- 目标规格值：每个 request 的普通 model turn 上限使用正安全整数，缺省为 50 个 turns；每个普通 model turn 的 Tool call 接纳上限缺省为 30 个 calls、可配置范围为 1..100 个 calls；不存在其他 Tool-call 数量预算
- 依据 Requirements：`Agent 运行设置只定义轮次上限和单轮工具调用上限`
