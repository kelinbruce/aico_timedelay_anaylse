## ADDED Requirements

### Requirement: 本地共享数据根 SHALL 暴露稳定的只读共享输入

Local deployment 模式 SHALL 把 `paths.workspaceRoot/shared-data/` 暴露为逻辑根 `shared-data/`，用于公开的、仅限本地的共享输入文件。该根 SHALL 用于需要在 Agent/Owner 执行工作区之间共享的电信诊断 fixture、导出的告警/网络数据、拓扑文件、参考数据集和可复用的本地脚本。

`shared-data/` 对内建 file tool、Bash/Python sandbox 执行、Skill 脚本和生成代码 MUST 是只读的。系统 MUST NOT 把 `shared-data/` 用于 model/tool 输出、terminal commit 状态、tool-result 外置化、临时文件、生成的 Skill 写入、runtime 数据、sqlite 文件、日志或 provider 私有存储。

Remote/PaaS deployment 模式 MUST NOT 从这一本地 contract 推断宿主 shared-data 路径。当 `sharedData` root 被配置在 LOCAL deployment 模式之外时，面向 runtime 的 assembly composition 和执行 workspace 解析 MUST fail closed。本 capability MUST NOT 定义或启用任何远程共享数据机制。

#### Scenario: 本地共享文件可通过逻辑路径读取
- **WHEN** 本地启动带有 `paths.workspaceRoot=workspaces`
- **AND** 宿主文件 `workspaces/shared-data/cases/alarm.json` 存在
- **AND** 一个已接受的 run 以 `shared-data/cases/alarm.json` 或匹配的 `shared-data/...` 搜索路径调用 Read、Glob 或 Grep
- **THEN** 系统 SHALL 把该请求解析到本地共享数据根
- **AND** 结果 SHALL 受既有文件大小、编码和安全错误策略治理

#### Scenario: 共享数据不可写入
- **WHEN** 一个 model、内建 write/edit tool、sandbox 命令、Skill 脚本或生成代码试图创建、修改、重命名或删除 `shared-data/cases/alarm.json`
- **THEN** 系统 MUST 拒绝该操作或使该路径只读
- **AND** 结果 MUST 使用稳定的安全权限原因

#### Scenario: 共享数据仅限本地
- **WHEN** deployment 模式为 REMOTE 或 PaaS
- **THEN** 面向 runtime 的 assembly composition 或执行 workspace 解析 MUST 在为该 assembly 暴露工具之前 fail closed
- **AND** 系统 MUST NOT 因本 capability 而挂载或暴露宿主 `paths.workspaceRoot/shared-data/` 目录作为 sandbox root
- **AND** 本地 `shared-data/` 路径在 REMOTE/PaaS deployment 模式下 MUST 不可用

### Requirement: 共享数据路径安全性 SHALL 与执行根安全性一致

对 `shared-data/` 的访问 SHALL 使用与其他执行根相同的 root 感知路径规范化和包含规则。系统 MUST 拒绝绝对路径、drive 限定路径、URL 形态路径、控制字符、父级穿越、不安全分隔符以及 symlink 或 hardlink 逃逸尝试。

共享数据访问的诊断和 audit/log 事实 MUST 使用逻辑路径或安全的展示路径。它们 MUST NOT 泄露宿主绝对路径、文件内容、credential、raw prompt/model 输出、脚本源码或 raw stdout/stderr。

#### Scenario: 穿越被拒绝
- **WHEN** 一个 file tool 或 sandbox 路径参数引用 `shared-data/../data/system/nextagent.sqlite`
- **THEN** 系统 MUST 在读取 runtime 数据之前拒绝该路径
- **AND** 诊断 MUST 使用稳定的安全原因，且不暴露物理 sqlite 路径

#### Scenario: 链接逃逸被拒绝
- **WHEN** `shared-data/link-to-outside` 是指向 `paths.workspaceRoot/shared-data` 之外宿主路径的 symlink 或等价链接
- **THEN** 内建文件访问 MUST 拒绝该路径或使逃逸目标不可达
- **AND** sandbox 执行 MUST NOT 把逃逸目标当作已授权的 shared-data 文件

### Requirement: 共享数据脚本 SHALL 只通过显式解释器路径执行

系统 SHALL 仅在 model 或 tool 调用使用显式解释器和显式 root 限定脚本路径（例如 `python shared-data/scripts/diagnose.py`）时，支持执行存储在 `shared-data/` 之下的 Python 脚本。`shared-data/` MUST NOT 被加入 `PATH`、`PYTHONPATH`、模块搜索路径、可执行搜索目录或隐式命令查找。

从 `shared-data/` 直接执行任意文件（包括 shebang 脚本、二进制和 shell 脚本）MUST 保持不受支持，除非未来的 OpenSpec change 定义更严格的可执行权限。共享脚本 MAY 读取 `shared-data/`，且只 MAY 把输出写入该已接受 run 已可写的根，例如 `workspace/` 或 `temp/`。

#### Scenario: Python 脚本通过显式路径执行
- **WHEN** 本地 `shared-data/scripts/diagnose.py` 存在
- **AND** Bash 提交 `python shared-data/scripts/diagnose.py --case shared-data/cases/alarm.json`
- **THEN** sandbox request SHALL 通过 `shared-data/` root 解析脚本路径和 case 路径
- **AND** 该脚本 MUST 通过 sandbox gateway 边界执行
- **AND** 输出写入 MUST 进入 `workspace/` 或 `temp/`，而不是 `shared-data/`

#### Scenario: 共享数据不是可执行搜索权限
- **WHEN** `shared-data/scripts/diagnose.py` 存在
- **AND** Bash 提交 `diagnose.py`，或 Python 仅因某模块存在于 `shared-data/scripts` 之下而 import 它
- **THEN** 系统 MUST NOT 通过共享数据搜索权限解析该名称
- **AND** 除非既有的显式解释器、脚本路径或语言机制独立授权，否则执行或 import MUST 失败
