## Function

- **所属 Function**: Bash Tool
- **变更类型**: MODIFIED
- **spec 角色**: 主 delta

## ADDED Requirements

### Requirement: Bash 接受窄化 Pythonpath 环境

内置 Bash Tool MUST 接受一个仅包含 `PYTHONPATH` 的可选结构化 `env` 对象。当存在时，`env.PYTHONPATH` MUST 被视为 sandbox 环境请求，MUST NOT 被拼接进命令字符串。

`env` MUST 保持为窄化的 allowlist 运行时配置对象。Bash Tool MUST 拒绝 `PYTHONPATH` 之外的任何模型可控 `env` key。面向模型的指导 MUST 说明 `env` 当前只支持 `PYTHONPATH`，其他任何 key 都会被拒绝。

Bash Tool MUST 把 command-string 输入中单个前导 `PYTHONPATH=<value>` token 归一化为同样的结构化环境请求，然后正常路由其后的可执行文件和参数。Bash Tool MUST NOT 把其他环境赋值 key 当作受支持的兼容语法。

sandbox 边界 MUST 只传递模型可控 Bash 输入中被接受的 `PYTHONPATH` 值。受限 local sandbox MUST 在把该值传给子进程之前，将其解析为被 request filesystem 授权的 sandbox 逻辑路径。绝对路径、父目录穿越、路径列表分隔符、未授权的逻辑路径以及非字符串值 MUST 在进程启动前被拒绝。

**需求类别**：功能性需求

#### Scenario: 旧式 PYTHONPATH 前缀保持 Python sandbox 路由

- **WHEN** Bash 被以 `PYTHONPATH=.nextagent/skills/<projection>/<skill>/scripts python ...` 开头的命令文本调用
- **THEN** Bash Tool MUST 提交 `python` 作为可执行文件
- **AND** 它 MUST 把其余 token 作为 argv 传递
- **AND** 它 MUST 在过滤后的 sandbox 环境中包含 `PYTHONPATH`

#### Scenario: 结构化 env 传递 PYTHONPATH 而无需 shell 语法

- **WHEN** Bash 被以 `command: "python"`、结构化 `args` 和 `env.PYTHONPATH` 调用
- **THEN** Python sandbox 执行 MUST 原样接收结构化 argv
- **AND** sandbox 环境 MUST 只包含来自 Bash 输入的被接受 `PYTHONPATH` 值

#### Scenario: command-string 模式接受结构化 PYTHONPATH

- **WHEN** Bash 被以完整命令字符串、无 `args` 且带 `env.PYTHONPATH` 调用
- **THEN** Bash MUST 保持 command-string 的 tokenization
- **AND** 它 MUST 把被接受的 `PYTHONPATH` 值作为结构化 sandbox 环境传递

#### Scenario: 未授权的 PYTHONPATH 被拒绝

- **WHEN** 某次 Bash Python 调用把 `env.PYTHONPATH` 提供为绝对路径、父目录穿越路径、路径列表或未绑定逻辑根
- **THEN** 受限 local sandbox MUST 在进程启动前拒绝该请求
- **AND** safe error MUST 是授权/路径拒绝，而不是不支持可执行文件的 fallback

## Function 变更汇总

### 规格

| 规格项 | 变更类型 | 目标规格值 | 依据 Requirements |
| --- | --- | --- | --- |
| Python import 路径兼容性 | ADDED | Bash 只接受 `env.PYTHONPATH` 作为模型可控环境输入，并把单个前导 `PYTHONPATH=<value>` 前缀归一化为同一请求形态。 | Bash 接受窄化 Pythonpath 环境 |
| 环境安全边界 | ADDED | 受限 local sandbox 只从已授权的逻辑文件系统根解析 `PYTHONPATH`，并在进程启动前拒绝不安全或未授权的值。 | Bash 接受窄化 Pythonpath 环境 |
