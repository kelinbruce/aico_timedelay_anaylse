# 设计

## 设计约束

- `agent-capability` 只拥有内置 Bash Tool 的 schema、模型提示和 invocation shaping。
- sandbox gateway 继续拥有可执行文件授权、文件系统策略、进程创建、超时、取消和 safe error mapping。
- Agent Core 和 Runtime 仍只把 Bash 当作普通 Capability invocation，不新增直连 shell 或 Python 的特殊路径。
- 结构化 `args` 不能绕过既有 `prepareBuiltinExecutableFacts` 和 sandbox execution boundary。

## 方案

Bash Tool 输入增加可选字段：

- `command`: 必填字符串。未提供 `args` 时保持既有整条命令字符串语义；提供 `args` 时必须只包含单个可执行文件 token。
- `args`: 可选字符串数组。每一项都是一个 argv 参数，不再参与 shell tokenization。

执行规则：

1. 如果没有提供 `args`，继续使用既有 `parseBashCommandForModelCorrection(command)` 路径，保持兼容。
2. 如果提供 `args`，先用既有解析器确认 `command` 可以被唯一解析为一个 token。
3. 如果 `command` 中还包含脚本路径、参数、管道或其他 token，返回 `CAPABILITY_INPUT_INVALID`，safe details 给出 `BASH_STRUCTURED_ARGS_COMMAND_NOT_EXECUTABLE_ONLY`。
4. 校验通过后，以 `{ executable, args }` 进入既有 sandbox 分发逻辑；`python` 和 `python3` 仍由 Python sandbox dependency 执行。

## 为什么这是长期方案

短期可以继续提示模型手写更多反斜杠，但这会把 JSON、shell、DSL 三层转义问题交给模型临场处理，稳定性差。结构化 argv 把命令名和参数边界显式建模，等价于程序直接调用 `spawn(executable, args)` 的数据形态，可以稳定承载包含双引号、空格、括号和反斜杠的业务参数。

## 兼容性

- 旧调用未提供 `args`，行为不变。
- 新调用提供 `args` 时，禁止 `command` 同时携带参数，避免同一语义出现两套拼接规则。
- 不改变 sandbox gateway 的拒绝策略；危险命令、路径越界和环境问题仍由 gateway 拒绝。

## 验证策略

- schema/descriptor 测试覆盖模型可见描述和 `args` 字段。
- invocation 测试覆盖 JSON/Gremlin 参数作为单个 argv 原样传入 Python sandbox。
- negative test 覆盖 `command` 与 `args` 混用时的安全失败和模型修复提示。
