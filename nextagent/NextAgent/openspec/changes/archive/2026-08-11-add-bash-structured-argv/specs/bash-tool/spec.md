## Function

- **所属 Function**: 现有 Bash Tool Function
- **Function 变更类型**: MODIFIED
- **spec 角色**: 主规格增量

## ADDED Requirements

### Requirement: Bash Accepts Structured Argv Input

内置 Bash Tool MUST 接受可选的 `args` 字符串数组。当 `args` 存在时，`command` MUST 只标识单个可执行文件，Bash Tool MUST 将 `args` 中的每个字符串作为独立 argv entry 原样提交给 sandbox gateway。Bash Tool MUST NOT 对结构化 `args` 中的引号、空格、括号、反斜杠或 JSON 内容执行 shell tokenization、字符串拼接或自动转义。

如果 `args` 存在且 `command` 解析后包含可执行文件之外的参数、shell composition 或其他 token，Bash Tool MUST 在 sandbox submission 前拒绝该输入，并返回可重试的 `CAPABILITY_INPUT_INVALID`。safe details MUST 包含 reason code `BASH_STRUCTURED_ARGS_COMMAND_NOT_EXECUTABLE_ONLY`，并提示模型 Bash 只支持二选一模式：command-string mode 将完整命令放在 `command` 且不提供 `args`；argv mode 将 `command` 设为唯一可执行文件 token，并把 `-m`、脚本路径、flags、JSON 和用户文本等全部放入 `args`。提示 MUST 明确禁止把同一条命令拆分在 `command` 和 `args` 之间，并说明 `env` 当前只支持 `PYTHONPATH`，其他 key 会被拒绝。

**需求类别**: Functional / Security

#### Scenario: JSON argument is preserved as one argv entry

- **WHEN** Bash is invoked with `command: "python"` and `args` containing a script path followed by a JSON string with nested Gremlin double quotes
- **THEN** the Python sandbox request MUST receive that JSON string as one unchanged argument
- **AND** the tool MUST NOT tokenize or reinterpret quotes inside that JSON argument

#### Scenario: Existing command string input still works

- **WHEN** Bash is invoked without `args`
- **THEN** the tool MUST preserve the existing command-string tokenization path

#### Scenario: Structured Python invocation keeps Python sandbox routing

- **WHEN** Bash is invoked with `command: "python"` or `command: "python3"` and structured `args`
- **THEN** the tool MUST route execution through the Python sandbox dependency

#### Scenario: Mixed command string is rejected with a repair hint

- **WHEN** Bash is invoked with `command: "python scripts/http_request.py"` and `args: ["{\"limit\":200}"]`
- **THEN** Bash MUST reject the input before sandbox submission
- **AND** the result MUST be a retryable `CAPABILITY_INPUT_INVALID`
- **AND** safe details reason code MUST be `BASH_STRUCTURED_ARGS_COMMAND_NOT_EXECUTABLE_ONLY`
- **AND** the safe hint MUST tell the model to choose either command-string mode with no `args` or argv mode with `command` as only the executable
- **AND** the safe hint MUST tell the model never to split one command between `command` and `args`
- **AND** the safe hint MUST state that `env` currently supports only `PYTHONPATH`
