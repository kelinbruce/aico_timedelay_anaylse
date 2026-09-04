## Function

- **所属 Function**：`FN-10.13 HarnessBench 评测`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 候选任务固定使用可信 shell 模式

系统为 HarnessBench 清单中每个状态为 `execute` 的 task 启动 NextAgent 候选运行时，MUST 在候选配置中显式设置 `sandbox.enabled=false`。该值 MUST 对全部 task 和全部执行 attempt 保持固定，MUST NOT 从 task id、task 输入、prompt、模型输出或客户端 metadata 派生或被其覆盖。动态 Bash、Python 和脚本执行仍 MUST 经过产品既有 sandbox gateway 边界；本 Requirement MUST NOT 改变 HarnessBench 评测之外的产品 sandbox 默认值或配置语义。

**需求类别**：功能性需求

#### Scenario: 执行任务生成固定候选配置

- **WHEN** 系统为任一状态为 `execute` 的 HarnessBench task 准备候选运行时
- **THEN** 该候选配置包含 `sandbox.enabled=false`
- **AND** task 的每个执行 attempt 使用相同配置值

#### Scenario: 任务内容不得改变候选执行模式

- **WHEN** task 输入、prompt、模型输出或客户端 metadata 包含 sandbox 配置或本地 API 信息
- **THEN** 系统仍以 `sandbox.enabled=false` 启动候选运行时
- **AND** 系统 MUST NOT 根据这些不可信输入启用受限 sandbox 或生成 task-specific allowlist

#### Scenario: 评测外产品配置保持原有语义

- **WHEN** NextAgent 在 HarnessBench 候选运行之外启动
- **THEN** 本 Requirement 不改变其 `sandbox.enabled` 默认值、显式配置值或 sandbox gateway 执行边界

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：对状态为 `execute` 的 task，通过固定采用可信 shell 模式的 NextAgent 候选运行时提交任务并等待 terminal result；task 内容不得改变该执行模式。
- **依据 Requirements**：`候选任务固定使用可信 shell 模式`

### 规格

- **规格项**：HarnessBench 候选 sandbox 模式
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：全部 `execute` task 和全部执行 attempt 固定 `sandbox.enabled=false`；评测外产品配置不变
- **依据 Requirements**：`候选任务固定使用可信 shell 模式`
