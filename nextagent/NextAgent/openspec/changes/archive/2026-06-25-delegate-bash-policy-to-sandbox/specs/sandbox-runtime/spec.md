# sandbox-runtime Specification Delta

## Modified Requirements

### Requirement: 执行前校验发生在 sandbox 提交之前

在向 sandbox 发送可执行工作之前，系统 MUST 至少校验 capability 可见性、调用参数、risk policy 结果、已组装 sandbox 依赖的存在性，以及工作目录约束。可执行文件 allow/deny policy SHALL 由组装好的 sandbox gateway policy 拥有，而不是由 Bash capability 拥有。

受限本地 sandbox gateway SHALL 使用可执行文件 denylist 作为其唯一的命令级校验。如果请求的可执行文件位于配置的 denylist 中，gateway MUST 安全地拒绝该请求。如果该可执行文件不在 denylist 中，gateway MUST 继续解析并执行它。该 gateway MUST NOT 校验路径参数、将路径限制在文件系统根内、检查 environment 变量或校验文件类型；这些关注点被委托给平台隔离。

#### Scenario: Gateway 拒绝被禁的可执行文件

- **WHEN** 一个 Bash capability 调用指定的可执行文件位于配置的 denylist 中
- **THEN** sandbox gateway MUST 安全地拒绝该请求
- **AND** Bash capability MUST NOT 绕过 gateway 或直接执行该命令

#### Scenario: Gateway 允许未被禁的可执行文件

- **WHEN** 一个 Bash capability 调用指定的可执行文件不在 denylist 中
- **THEN** sandbox gateway MUST 继续解析并执行该二进制文件
- **AND** gateway MUST 仍强制执行 adapter 拥有的 cwd、净化后的 environment、超时、取消和输出限制

### Requirement: 受限本地 sandbox 从可信配置解析受治理的业务可执行文件

受限本地 sandbox SHALL 为 Bash 请求拥有本地可执行文件 denylist policy。可信 app composition MAY 配置 adapter 的 `deniedExecutables` policy。该配置 MUST 保持为可信的启动/app composition 输入，MUST NOT 从 model 输入、client 元数据或 capability 参数读取。

Adapter MUST 仍通过其可信可执行文件 locator 解析 `clipc`，通过可信路径解析 python 解释器，并通过 git-bin 或 PATH 解析其他可执行文件。当二进制文件无法解析时，adapter MUST fail closed。

#### Scenario: 被禁的可执行文件被拒绝

- **WHEN** 可信 app composition 在受限本地 sandbox denylist 中配置了一个可执行文件名
- **AND** 一个 sandbox 请求指定了该可执行文件
- **THEN** 受限本地 sandbox MUST 安全地拒绝该请求
- **AND** 该拒绝 MUST 在 capability 边界映射到 `COMMAND_NOT_ALLOWED`

#### Scenario: 未被禁的可执行文件被解析并执行

- **WHEN** 一个 sandbox 请求指定的可执行文件不在 denylist 中
- **AND** 该二进制文件能从可信位置解析
- **THEN** 受限本地 sandbox MUST 通过 `shell: false` 执行该二进制文件
- **AND** 该执行 MUST 仍使用 adapter 拥有的 cwd、净化后的 environment、超时、取消和输出限制

#### Scenario: 无法解析的可执行文件 fail closed

- **WHEN** 一个 sandbox 请求指定的可执行文件不在 denylist 中
- **AND** 该二进制文件无法从可信位置解析
- **THEN** 受限本地 sandbox MUST 返回显式的不可用安全结果
- **AND** 它 MUST NOT 回退到未沙箱化的执行

#### Scenario: 缺失 clipc locator 时 fail closed

- **WHEN** Bash 提交 `clipc` 但可信 locator 缺失、为空、位于其声明目录之外、不存在或不是常规文件
- **THEN** 受限本地 sandbox MUST 返回显式的不可用安全结果
- **AND** 它 MUST NOT 搜索任意宿主位置或回退到未沙箱化的执行

#### Scenario: 带引号的 Windows environment 目录被规范化

- **WHEN** 可信 app composition 提供的 `clipc` 可执行文件目录被一对匹配的双引号包围
- **THEN** 受限本地 sandbox MUST 只移除该外层引号对再进行路径解析
- **AND** 解析出的二进制文件 MUST 仍通过相同的 realpath 和常规文件校验
