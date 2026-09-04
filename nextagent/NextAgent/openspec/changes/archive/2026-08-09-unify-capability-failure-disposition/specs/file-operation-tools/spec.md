# file-operation-tools Delta Specification

所属 Function：`FN-5.3 读写编辑文件`

Function 变更类型：修改

spec 角色：主规格

## ADDED Requirements

### Requirement: Read Tool 只读取受控工作区内的有界文件页

Read Tool MUST 只接受 `file_path` 作为 workspace-relative 单文件路径。绝对路径、路径逃逸、目录、glob pattern 或权限拒绝 MUST 在读取未授权内容前返回 safe Capability failure；timeout MUST 保持 `TIMED_OUT`，abort MUST 保持父请求取消。缺失文件 MUST 返回 `FAILED + FILE_UNAVAILABLE + NOT_FOUND`；其他普通 I/O failure MUST 返回 `FAILED + CAPABILITY_EXECUTION_FAILED + INTERNAL`。上述结果、日志、stream 和 history MUST NOT 暴露 credential、未授权对象内容或 host absolute path。

`offset` MUST 表示从 `0` 开始的起始行并缺省为 `0`；`limit` MUST 表示最大行数并缺省为 `2000`。两者 MUST 为整数，`offset >= 0`，`1 <= limit <= 2000`；非法值 MUST 在 Tool input schema validation 失败。成功 payload MUST 包含 `file_path`、`offset`、`limit`、`content`、`truncated` 和 optional `nextOffset`；其中 `file_path` MUST 是 normalized workspace-relative path。结果 MUST 同时受行数和统一单结果容量约束；仍有后续内容时 MUST 显式返回 `truncated=true` 和 `nextOffset`。

Read Tool MUST 在返回任何文件内容前执行 Agent Scope、Owner Scope 和 workspace policy 校验。系统 MUST NOT 让模型或调用方读取授权 workspace view 之外的文件，也 MUST NOT 让 host absolute path 进入结果或其他公共投影。

**需求类别**：功能性需求

#### Scenario: Read 返回有界文件页

- **WHEN** 模型使用合法 workspace-relative `file_path`、`offset` 和 `limit` 调用 Read Tool
- **THEN** Tool MUST 只读取受控工作区中的目标单文件
- **AND** successful payload MUST 包含 normalized `file_path`、effective `offset`、effective `limit`、`content` 和 `truncated`
- **AND** 仍有后续内容时 MUST 包含 `nextOffset`

#### Scenario: Read 使用缺省分页参数

- **WHEN** 合法 Read input 省略 `offset` 或 `limit`
- **THEN** effective `offset` MUST 为 `0`
- **AND** effective `limit` MUST 为 `2000`

#### Scenario: Read 拒绝非法路径或分页参数

- **WHEN** input 使用绝对路径、路径逃逸、目录、glob pattern、负数 offset、零 limit、超过 2000 的 limit 或非整数分页参数
- **THEN** invocation MUST 在未授权文件内容读取前安全失败
- **AND** model-visible failure MUST 提供可修正约束且不回显未授权路径或内容

#### Scenario: Read 保持取消与超时事实

- **WHEN** Read 分别遭遇 abort 或 timeout
- **THEN** abort MUST 保持 request cancellation，timeout MUST 返回 `TIMED_OUT`
- **AND** 任何结果 MUST NOT 暴露 host absolute path、credential 或未授权内容

#### Scenario: Read 明确缺失文件和普通 I/O 失败

- **WHEN** Read 分别遭遇缺失文件或其他普通 I/O failure
- **THEN** 缺失文件 MUST 返回 `FAILED + FILE_UNAVAILABLE + NOT_FOUND`
- **AND** 其他普通 I/O failure MUST 返回 `FAILED + CAPABILITY_EXECUTION_FAILED + INTERNAL`
- **AND** 两类失败都 MUST 通过统一 Capability 结果反馈模型，且不得暴露 host absolute path、credential 或未授权内容

## Function 变更汇总

### 描述

- 变更类型：修改
- 目标内容：文件操作 Function 的主规格定义 Read Tool 的受控路径、分页、容量、取消、超时和安全失败行为。
- 依据 Requirements：`Read Tool 只读取受控工作区内的有界文件页`

### 输入

- 变更类型：修改
- 目标内容：Read 接受 workspace-relative 单文件路径和 optional `offset`/`limit`，拒绝越界路径与非法分页参数。
- 依据 Requirements：`Read Tool 只读取受控工作区内的有界文件页`

### 输出

- 变更类型：修改
- 目标内容：返回有界内容页、normalized path、effective 分页坐标、truncation flag 和 optional continuation。
- 依据 Requirements：`Read Tool 只读取受控工作区内的有界文件页`

### 处理过程

- 变更类型：修改
- 目标内容：系统先校验 workspace-relative 单文件路径、可信 scope 和 workspace policy，再返回受分页与统一结果容量约束的文件内容或确定的安全失败。
- 依据 Requirements：`Read Tool 只读取受控工作区内的有界文件页`

### 结果

- 变更类型：修改
- 目标内容：合法读取返回可分页结果；非法路径、参数、权限、timeout 和 abort 保持真实且安全的结果语义。
- 依据 Requirements：`Read Tool 只读取受控工作区内的有界文件页`

### 规格

- 规格项：Read 单次分页范围
- 变更类型：新增
- 原规格值：不适用（新增）
- 目标规格值：起始行为从 0 开始且缺省为 0；单次最多读取 2000 行，缺省 2000 行；仍有后续内容时显式返回截断事实和下一起始行
- 依据 Requirements：`Read Tool 只读取受控工作区内的有界文件页`
