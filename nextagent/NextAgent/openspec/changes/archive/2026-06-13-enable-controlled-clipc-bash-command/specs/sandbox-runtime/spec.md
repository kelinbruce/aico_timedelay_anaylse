## ADDED Requirements

### Requirement: 受限本地 sandbox 从可信配置解析受治理的业务可执行文件

受限本地 sandbox SHALL 通过 app composition 提供的可信 executable locator 支持受治理的 `clipc` 命令。该 locator MUST 专用于 `clipc`；它 MUST NOT 创建运行时可配置的任意可执行文件注册表，也 MUST NOT 扩展 model 控制的命令权限。

adapter MUST 规范化可信配置目录外围一对匹配的双引号，使用平台特定的 `clipc` 文件名从该目录解析二进制文件，验证解析后的目标是常规文件，并以 `shell: false`、结构化参数数组、可信的 workspace 工作目录、既有的 timeout 和 cancellation 上下文以及有界的 stdout/stderr 处理来执行它。

#### Scenario: 已配置的 clipc 可执行文件通过 sandbox gateway 运行

- **WHEN** Bash 提交一条已授权的 `clipc` 命令，且可信 app composition 提供有效的 `clipc` 可执行目录
- **THEN** 受限本地 sandbox MUST 通过既有 `SandboxGatewayPort` 执行该二进制文件
- **AND** 它 MUST 保留提交的结构化参数，而不调用宿主 shell

#### Scenario: 缺失 clipc locator 时 fail closed

- **WHEN** Bash 提交 `clipc`，但可信 locator 缺失、为空、位于其声明目录之外、不存在或不是常规文件
- **THEN** 受限本地 sandbox MUST 返回显式的不可用安全结果
- **AND** 它 MUST NOT 搜索任意宿主位置或回退到非 sandbox 执行

#### Scenario: 带引号的 Windows 环境目录被规范化

- **WHEN** 可信 app composition 提供的 `clipc` 可执行目录外围带有一对匹配的双引号
- **THEN** 受限本地 sandbox MUST 在路径解析前只移除该外围引号对
- **AND** 解析后的二进制文件 MUST 仍通过相同的 realpath 和常规文件校验

#### Scenario: 未知可执行文件保持被拒绝

- **WHEN** 一条 sandbox 请求指定了内建受治理集合之外的可执行文件
- **THEN** 受限本地 sandbox MUST 拒绝该请求
- **AND** 配置 MUST NOT 能够动态注册该可执行文件
