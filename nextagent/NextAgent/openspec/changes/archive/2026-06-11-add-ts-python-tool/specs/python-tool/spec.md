## ADDED Requirements

### Requirement: Python 是独立的 builtin tool

系统 SHALL 提供 `python` 作为执行 Python 代码片段的独立 builtin tool capability。`python` SHALL 是一等 tool 身份，SHALL NOT 被实现为 `bash` 子命令、`bash` 包装或 `bash` 拥有的别名。
该独立性要求适用于本 change 中模型可见的 `python` tool 身份和执行路径。它本身 SHALL NOT 移除或重定义具有不同语义的既有 `bash` 拥有的受限 Python 脚本路径。

#### Scenario: python 作为独立 tool 被发现

- **WHEN** 列出 builtin tool descriptor
- **THEN** `python` 以自己的 tool id 出现
- **AND** `bash` 和 `python` 保持为相互独立的 builtin tools

#### Scenario: python 调用不经 bash 语义路由

- **WHEN** 模型调用 `python`
- **THEN** 系统把该请求路由到 Python tool handler
- **AND** 它 MUST NOT 先用 Bash 命令规则解析或授权该输入

#### Scenario: 既有 bash 拥有的受限 Python 路径不在范围内

- **WHEN** 产品还包含一条 `bash` 拥有的、带可信 allowlist 语义的受限 Python 脚本路径
- **THEN** 本 change SHALL NOT 要求删除或静默重定义该路径
- **AND** 本 change 中独立的 `python` tool 仍 MUST 在模型可见性和执行上与该路径保持区分

### Requirement: Python tool 接受代码片段输入

Python tool MUST 接受以下输入 schema：

- `code`（string，必需）：要执行的 Python 代码片段
- `args`（string 数组，可选）：脚本参数
- `timeout_ms`（大于 0 的整数，可选）：以毫秒为单位的执行超时

如果省略 `timeout_ms`，有效超时 SHALL 为 `10000` ms。如果 `timeout_ms` 超过 `120000`，有效超时 SHALL 被限制在 `120000` ms。`args` SHALL NOT 超过 `100` 个条目或总计 `8192` UTF-8 bytes。

#### Scenario: python 接受有效代码片段

- **WHEN** 模型提供带 `code` 的有效 Python 输入
- **THEN** Python handler MUST 接受该输入
- **AND** 通过 Python 执行路径执行该代码

#### Scenario: python 拒绝超长 args

- **WHEN** 调用 `python` 时 args 超过 `100` 个或总计超过 `8192` UTF-8 bytes
- **THEN** 该调用 MUST 安全失败
- **AND** 系统 MUST NOT 把该请求提交给 sandbox 执行

### Requirement: Python tool 返回结构化执行结果

Python 执行完成时，该 tool SHALL 返回以下结构化输出：

- `exit_code`（integer）
- `stdout`（string）
- `stderr`（string）
- `timed_out`（boolean）

Stdout 和 stderr SHALL 各自被限制在 `65536` UTF-8 bytes，并只在有效的 UTF-8 边界上截断。
如果 Python 执行完成并返回非零 exit code，该调用 SHALL 仍返回带该 `exit_code` 的结构化执行结果；SHALL NOT 仅因 exit code 非零就把它转换为 capability 级别的失败结果。

#### Scenario: python 返回进程输出

- **WHEN** Python 执行提交的代码且 sandbox 在超时前返回
- **THEN** 它 MUST 返回执行输出
- **AND** 返回的输出包含 `exit_code`、`stdout`、`stderr` 和 `timed_out`

#### Scenario: python 非零退出仍是结构化的

- **WHEN** Python 执行以 `exit_code != 0` 完成
- **THEN** 该调用 MUST 仍返回结构化执行输出
- **AND** 它 MUST NOT 仅因 exit code 非零就变成 capability 级别的失败结果

#### Scenario: python 超时是结构化的

- **WHEN** Python 执行超出有效超时
- **THEN** 结果以安全的结构化方式指示超时
- **AND** 系统 MUST NOT 泄露 raw 代码或宿主执行细节

### Requirement: Python tool 只经 sandbox gateway 执行

Python tool 是可执行 capability，MUST 经 sandbox gateway 路由执行。它 MUST 尊重超时和取消。系统 MUST NOT 直接在宿主进程上执行代码，也 MUST NOT 在 sandbox 执行不可用或被拒绝时回退到未沙箱化执行。

#### Scenario: python 经 sandbox 执行

- **WHEN** 调用 Python
- **THEN** Python tool handler MUST 通过面向 tool 的 Python sandbox 依赖路由该请求
- **AND** 该依赖 MUST 向 `SandboxGatewayPort.execute()` 提交一个 `SandboxExecutionRequest`
- **AND** 该代码 MUST NOT 直接在宿主进程上执行

#### Scenario: python 不得绕过 sandbox

- **WHEN** 有人尝试为 Python 执行绕过 sandbox
- **THEN** 系统 MUST 拒绝该请求
- **AND** 它 MUST NOT 在 sandbox 之外执行该代码

#### Scenario: sandbox 不可用不触发宿主回退

- **WHEN** sandbox adapter 返回不可用、拒绝或等价的安全失败
- **THEN** 该调用 MUST 安全失败
- **AND** 系统 MUST NOT 通过直接使用宿主执行 API 重试同一代码

#### Scenario: sandbox 提交使用可信 runtime 事实

- **WHEN** Python tool 准备 sandbox 执行
- **THEN** 产出的 `SandboxExecutionRequest` MUST 从可信 capability/runtime context 派生 run 身份、owner scope、超时、cancellation context 和输出预算
- **AND** 系统 MUST NOT 从模型提供的 `code`、`args` 或客户端 metadata 读取 tenant、subject、workspace 或宿主执行配置

### Requirement: 第一版中 Python 调用是隔离的

第一版 Python tool SHALL 把每次调用视为隔离执行。它 SHALL NOT 要求跨调用的 notebook 式持久 interpreter 状态。

#### Scenario: 一次 python 调用不依赖之前的 interpreter 状态

- **WHEN** 在前一次 `python` 调用完成之后再发起一次 python 调用
- **THEN** 后一次调用作为全新的隔离调用求值
- **AND** 不要求系统保留上一次调用的变量、内存中状态或打开的句柄
