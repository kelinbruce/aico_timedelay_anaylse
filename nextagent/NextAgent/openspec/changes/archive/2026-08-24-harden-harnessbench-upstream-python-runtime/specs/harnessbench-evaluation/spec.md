## Function

- **所属 Function**：`FN-10.13 HarnessBench 评测`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Windows 上游 Python 命令使用已预检解释器

在 Windows 标准全量和定向 HarnessBench 运行中，系统 MUST 在第一个 task 执行前使上游子进程中的 `python3` 命令调用本次运行已通过候选模型前置验证的 Python 解释器。该命令 MUST 只在本次评测运行的 HarnessBench task 子进程环境中可见，MUST NOT 修改系统或用户级 `PATH`、Python 安装、固定 HarnessBench cache、task、Oracle 或 rubric。系统无法建立该命令，或该命令解析出的解释器身份与已预检解释器不一致时，MUST 在第一个 task 前终止且 MUST NOT 产生 `frameworkEffectScore`。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复、可测试性、审计/可追溯性
**适用范围**：该 Function

#### Scenario: 上游 Oracle 通过 python3 使用已预检解释器

- **GIVEN** Windows 评测入口已用选定 Python 解释器完成候选模型前置验证
- **WHEN** HarnessBench task 或 Oracle 在上游子进程中执行 `python3`
- **THEN** 该命令 MUST 启动同一个已预检 Python 解释器
- **AND** task MUST 继续使用固定 HarnessBench task、Oracle 与评分实现形成上游结果

#### Scenario: 运行级命令不污染主机和固定上游

- **WHEN** Windows 评测入口为上游子进程提供 `python3`
- **THEN** 该命令 MUST 仅对本次运行的 HarnessBench task 子进程生效
- **AND** 系统和用户级环境以及固定 HarnessBench cache MUST 保持不变

#### Scenario: 无法保证解释器身份时前置失败

- **WHEN** Windows 评测入口无法建立 `python3` 命令，或该命令不能解析到已预检解释器
- **THEN** 系统 MUST 在第一个 task 执行前终止
- **AND** 本次运行 MUST NOT 产生 `frameworkEffectScore`

## Function 变更汇总

### 前置条件

- **变更类型**：修改
- **目标内容**：Windows 评测运行除验证候选模型和 grader 外，还验证上游 `python3` 命令与已预检解释器身份一致；任一前置条件失败时不执行 task。
- **依据 Requirements**：`Windows 上游 Python 命令使用已预检解释器`

### 处理过程

- **变更类型**：修改
- **目标内容**：Windows 上游 task 与 Oracle 通过本次运行可见的 `python3` 命令使用已预检解释器，不改变主机全局环境或固定 HarnessBench 输入。
- **依据 Requirements**：`Windows 上游 Python 命令使用已预检解释器`
