## MODIFIED Requirements

### Requirement: Sandbox 失败与资源限制是显式的

Sandbox 不可用、policy 拒绝、超时、取消、命令失败、输出过大和资源超限条件 MUST 产生显式的安全失败 outcome。系统 MUST NOT 静默截断输出，且当 sandbox 执行失败时 MUST NOT 回退到未沙箱化的本地执行。

当本地受限 sandbox 以 `sandbox.enabled=false` 运行时，Bash 执行 SHALL 使用可信的 shell 解释器路径，而不是 builtin 可执行文件校验。该可信 shell 模式 MAY 执行 shell 内建命令和 shell 链式操作，但它 MUST 仍保持在 sandbox gateway 边界内，并 MUST 仍使用 adapter 拥有的 cwd、净化后的 environment、超时、取消和输出限制。

#### Scenario: 禁用校验时通过可信 shell 解释器运行 bash

- **WHEN** 本地可信启动配置设置 `sandbox.enabled=false`
- **AND** 一个 sandbox Bash 请求包含 `cd` 或 `&&`
- **THEN** 受限本地 sandbox MUST 从可信 token 序列重建 shell 命令行
- **AND** 通过可信的平台 shell 解释器执行它
- **AND** 仍然强制执行 adapter 拥有的 cwd、净化后的 environment、超时、取消和输出字节限制

#### Scenario: 严格校验仍拒绝不支持的可执行文件

- **WHEN** 本地启动配置省略 `sandbox.enabled` 或将其设置为 `true`
- **AND** 一个 sandbox 请求指定了不受支持的命令，例如 `cd`
- **THEN** 受限本地 sandbox MUST 安全地拒绝该请求
- **AND** 面向 capability 的失败 MUST 继续映射到 `COMMAND_NOT_ALLOWED`
