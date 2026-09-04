## MODIFIED Requirements

### Requirement: Sandbox 失败与资源限制是显式的

Sandbox 不可用、policy 拒绝、超时、取消、命令失败、输出过大和资源超限条件 MUST 产生显式的安全失败 outcome。系统 MUST NOT 静默截断输出，且当 sandbox 执行失败时 MUST NOT 回退到未沙箱化的本地执行。

受限本地 sandbox 的请求拒绝 MUST 与 adapter 不可用区分开。当受限本地 sandbox 因可执行文件不受支持而拒绝请求时，面向 capability 的安全结果 MUST 映射到 `COMMAND_NOT_ALLOWED`。当它因路径不安全或逃逸可信文件系统边界而拒绝请求时，面向 capability 的安全结果 MUST 映射到 `CAPABILITY_PATH_REJECTED`。这些请求拒绝情形 MUST NOT 以 `SANDBOX_UNAVAILABLE` 的形式呈现。

#### Scenario: 受限本地 sandbox 不支持的可执行文件映射为命令被拒绝

- **GIVEN** 受限本地 sandbox 校验处于激活状态
- **WHEN** 一个 sandbox 请求指定的可执行文件或命令不在可信内置集合内
- **THEN** adapter MUST 安全地拒绝该请求
- **AND** 面向 capability 的失败 MUST 映射到 `COMMAND_NOT_ALLOWED`
- **AND** 它 MUST NOT 以 `SANDBOX_UNAVAILABLE` 呈现

#### Scenario: 受限本地 sandbox 不安全路径映射为路径被拒绝

- **GIVEN** 受限本地 sandbox 校验处于激活状态
- **WHEN** 一个 sandbox 请求包含不安全、缺失或逃逸的路径参数
- **THEN** adapter MUST 安全地拒绝该请求
- **AND** 面向 capability 的失败 MUST 映射到 `CAPABILITY_PATH_REJECTED`
- **AND** 它 MUST NOT 以 `SANDBOX_UNAVAILABLE` 呈现

#### Scenario: 受限本地 sandbox 的拒绝与不可用可分别观测

- **WHEN** 受限本地 sandbox 在执行开始之前拒绝一个请求
- **THEN** 系统 MUST 发出安全的拒绝执行诊断
- **AND** 它 MUST NOT 为该情形复用 sandbox 不可用事件名

#### Scenario: Sandbox 不可用仍映射为不可用 capability outcome

- **WHEN** 需要 sandbox 执行，且组装好的 sandbox gateway adapter 因缺少前提条件或 adapter 侧不可用而无法执行
- **THEN** 系统 MUST 将该 `SandboxExecutionResult` 映射为安全的不可用 capability outcome
- **AND** 它 MUST NOT 通过在 sandbox 之外的本地运行来重试相同的可执行工作
