## MODIFIED Requirements

### Requirement: Bash 默认命令是本地且只读的

首个 release 的内建 allowlist SHALL 只包含以下受治理命令：

- `ls`
- `cat`
- `grep`
- `head`
- `tail`
- `wc`
- `python`
- `python3`
- `clipc`

`ls` SHALL 只接受 workspace 相对目录以及 `-l`、`-a` 或 `-la`。
`cat` SHALL 只接受 workspace 本地的常规文本文件。
`grep` SHALL 只接受 `-n`、`-i` 和 `-F`、一个有界的搜索 pattern 和显式的 workspace 本地文件；禁止递归搜索。
`head` 和 `tail` SHALL 只接受值为 1 到 1000 的 `-n` 和显式的 workspace 本地文件。
`wc` SHALL 只接受 `-l`、`-w` 或 `-c` 和显式的 workspace 本地文件。
`python` 和 `python3` SHALL 只执行可信 `allowedPythonScripts` 配置中精确的 workspace 相对 `.py` 路径。
`clipc query` SHALL 只接受 `clipc query <handler> <api-path>`，其中 `handler` 是一个有界的 lower-camel 标识符，`api-path` 是一个只包含有界字母数字、下划线、连字符和斜杠段落的绝对 URL 路径。

`clipc subscribe` SHALL 只接受 `clipc subscribe --timeout-ms <ms> --max-events <count> [--format <format>] <handler> <api-path>`。`ms` MUST 是 1 到 600000 的整数，`count` MUST 是 1 到 1000 的整数，`format` MUST 是 `sse` 或 `jsonl`。选项顺序固定，以使解析权威保持确定性。

#### Scenario: 配置不能扩展命令权限

- **WHEN** 可信的 Bash Tool 配置包含受治理默认集合之外的可执行文件
- **THEN** Bash descriptor MUST 因安全的配置原因而不可用
- **AND** 该可执行文件 MUST NOT 运行

#### Scenario: 受治理的 clipc 命令被接受

- **WHEN** model 提交 `clipc query getHealth /api/health`
- **THEN** Bash MUST 将其解析为可执行的 `clipc` 和三个显式参数
- **AND** 该命令 MUST 通过 sandbox 依赖提交，而不使用宿主 shell

#### Scenario: 畸形的 clipc 命令被拒绝

- **WHEN** 一条 `clipc` 命令使用了不支持的动词、畸形的 handler、畸形的 API 路径、缺失 handler、缺失或超范围的 subscribe 边界、不支持的 format、重排的选项、多余参数、可执行路径、环境展开或 shell 语法
- **THEN** 调用 MUST 以 code `COMMAND_NOT_ALLOWED` 和类别 `AUTHORIZATION` 失败
- **AND** gateway MUST NOT 被调用

### Requirement: Bash 受 workspace 作用域约束且网络 CLI 被拒绝

Bash 执行 SHALL 保持限定在可信 workspace 和只读诊断边界之内。首个 release MUST 在禁止效果发生之前拒绝一般网络 CLI、写入尝试、路径逃逸、设备文件和 symlink 逃逸。

唯一具备网络能力的 Bash 命令例外 SHALL 是本 capability 定义的受治理 `clipc` 形式。model MUST NOT 提供或覆盖 `clipc` 的可执行路径、endpoint、credential、环境变量或任意传输选项。

#### Scenario: 文件逃逸或网络 CLI 被拒绝

- **WHEN** 一条命令尝试写入、workspace 逃逸或受治理 `clipc` 形式之外的网络 CLI 执行
- **THEN** 执行 MUST 在禁止效果发生之前安全失败
- **AND** 该 negative case MUST 被可重复的测试覆盖

#### Scenario: model 不能重定向 clipc 执行权限

- **WHEN** 一条 model 提供的 `clipc` 命令尝试选择可执行路径、endpoint、credential、环境变量或不支持的选项
- **THEN** Bash MUST 在 sandbox 提交之前拒绝该命令
- **AND** 可信的 app composition 事实 MUST 仍然是可执行位置的唯一来源
