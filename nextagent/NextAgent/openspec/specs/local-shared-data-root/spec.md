# local-shared-data-root Specification

## Purpose

定义仅限 LOCAL 的只读 `shared-data/` 执行 root，用于公共共享输入文件和显式解释器脚本用法。
## Requirements
### Requirement: 本地共享数据 root SHALL 暴露稳定的只读共享输入

LOCAL 部署模式 SHALL 把 `paths.workspaceRoot/shared-data/` 暴露为逻辑 root `shared-data/`，用于公共的、仅限本地的共享输入文件。该 root SHALL 面向电信诊断 fixture、导出的告警/网络数据、拓扑文件、参考数据集以及需要跨 Agent/Owner 执行工作区共享的可复用本地脚本。

`shared-data/` 对 builtin 文件工具、Bash/Python sandbox 执行、Skill 脚本和生成代码 MUST 为只读。系统 MUST NOT 将 `shared-data/` 用于 model/tool 输出、terminal commit 状态、tool-result 外部化、临时文件、生成的 Skill 写入、运行时数据、sqlite 文件、日志或 provider 私有存储。

REMOTE/PaaS 部署模式 MUST NOT 从本本地 contract 推断宿主 shared-data 路径。当 `sharedData` root 被配置在 LOCAL 部署模式之外时，runtime-facing assembly 组合和执行工作区解析 MUST fail closed。本 capability MUST NOT 定义或启用任何远程共享数据机制。

#### Scenario: 本地共享文件可按逻辑路径读取
- **WHEN** 本地启动时 `paths.workspaceRoot=workspaces`
- **AND** 宿主文件 `workspaces/shared-data/cases/alarm.json` 存在
- **AND** 一个已接受的 run 以 `shared-data/cases/alarm.json` 或匹配的 `shared-data/...` 搜索路径调用 Read、Glob 或 Grep
- **THEN** 系统 SHALL 把该请求解析到本地共享数据 root
- **AND** 结果 SHALL 受既有文件大小、编码和 safe error 策略治理

#### Scenario: 共享数据不可写
- **WHEN** 模型、builtin 写入/编辑工具、sandbox 命令、Skill 脚本或生成代码试图创建、修改、重命名或删除 `shared-data/cases/alarm.json`
- **THEN** 系统 MUST 拒绝该操作或使该路径只读
- **AND** 结果 MUST 使用稳定的 safe permission reason

#### Scenario: 共享数据仅限本地
- **WHEN** 部署模式为 REMOTE 或 PaaS
- **THEN** runtime-facing assembly 组合或执行工作区解析 MUST 在为该 assembly 暴露工具之前 fail closed
- **AND** 系统 MUST NOT 因本 capability 挂载或暴露宿主 `paths.workspaceRoot/shared-data/` 目录作为 sandbox root
- **AND** 本地 `shared-data/` 路径 MUST 在 REMOTE/PaaS 部署模式下不可用

### Requirement: 共享数据路径安全 SHALL 与执行 root 安全一致

对 `shared-data/` 的访问 SHALL 使用与其他执行 root 相同的 root-aware 路径规范化和包含规则。系统 MUST 拒绝绝对路径、带盘符的路径、URL 形式路径、控制字符、父级穿越、不安全分隔符以及 symlink 或 hardlink 逃逸尝试。

共享数据访问的诊断和 audit/log 事实 MUST 使用逻辑路径或安全 display path。它们 MUST NOT 泄露宿主绝对路径、文件内容、credential、原始 prompt/model 输出、脚本源码或 raw stdout/stderr。

#### Scenario: 穿越被拒绝
- **WHEN** 文件工具或 sandbox 路径参数引用 `shared-data/../data/system/nextagent.sqlite`
- **THEN** 系统 MUST 在读取运行时数据之前拒绝该路径
- **AND** 诊断 MUST 使用稳定的 safe reason，且不暴露物理 sqlite 路径

#### Scenario: 链接逃逸被拒绝
- **WHEN** `shared-data/link-to-outside` 是指向 `paths.workspaceRoot/shared-data` 之外宿主路径的 symlink 或等价链接
- **THEN** builtin 文件访问 MUST 拒绝该路径或使逃逸目标不可达
- **AND** sandbox 执行 MUST NOT 把逃逸目标当作已授权的 shared-data 文件

### Requirement: 共享数据脚本 SHALL 只通过显式解释器路径执行

系统 SHALL 只在模型或工具调用使用显式解释器和显式 root 限定脚本路径（例如 `python shared-data/scripts/diagnose.py`）时，支持执行存储在 `shared-data/` 下的 Python 脚本。`shared-data/` MUST NOT 被添加到 `PATH`、`PYTHONPATH`、模块搜索路径、可执行搜索目录或隐式命令查找。

对 `shared-data/` 中任意文件的直接执行（包括 shebang 脚本、二进制和 shell 脚本）MUST 保持不受支持，除非未来某个 OpenSpec change 定义更严格的可执行权威。共享脚本 MAY 读取 `shared-data/`，并只把输出写入对该已接受 run 已可写的 root，例如 `workspace/` 或 `temp/`。

#### Scenario: Python 脚本按显式路径执行
- **WHEN** 本地 `shared-data/scripts/diagnose.py` 存在
- **AND** Bash 提交 `python shared-data/scripts/diagnose.py --case shared-data/cases/alarm.json`
- **THEN** sandbox 请求 SHALL 通过 `shared-data/` root 解析脚本路径和 case 路径
- **AND** 脚本 MUST 通过 sandbox gateway 边界执行
- **AND** 输出写入 MUST 进入 `workspace/` 或 `temp/`，而不是 `shared-data/`

#### Scenario: 共享数据不是可执行搜索权威
- **WHEN** `shared-data/scripts/diagnose.py` 存在
- **AND** Bash 提交 `diagnose.py`，或 Python 仅因某模块存在于 `shared-data/scripts` 下而导入它
- **THEN** 系统 MUST NOT 通过共享数据搜索权威解析该名称
- **AND** 除非既有的显式解释器、脚本路径或语言机制独立授权，否则执行或导入 MUST 失败
