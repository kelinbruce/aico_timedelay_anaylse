# tool-loop Delta

## ADDED Requirements

### Requirement: 重复的非终态 capability 失败停止当前 run

Agent Core SHALL 跟踪单个 request run 内的非终态 capability 失败。如果同一 capability 调用形状在同一 run 中产生三次相同的状态、safe error 和结构化失败输出，Agent Core SHALL 在投影第三次结果之后，以安全的 `CAPABILITY_REPEATED_FAILURE` 错误停止当前 run。

重复失败 fingerprint SHALL 包含 capability id、normalized arguments、结构化失败输出、result status、safe error code 和 safe error category。该 fingerprint SHALL NOT 包含 tool call id。

#### Scenario: 重复的 degraded Bash 结果停止循环

- **GIVEN** 模型先以参数 `{ "command": "python failing.py" }` 调用 `Bash`
- **AND** capability 结果为 `DEGRADED`，safe error code 为 `SANDBOX_EXECUTION_FAILED`
- **WHEN** 后续两个 tool round 以相同参数再次调用 `Bash`
- **AND** 两次后续 capability 结果再次为 `DEGRADED`，带相同的 safe error code、category 和结构化输出
- **THEN** Agent Core MUST 允许第二次匹配结果正常继续
- **AND** Agent Core MUST 把第三次 capability 结果追加为模型可见的上下文
- **AND** Agent Core MUST 发出 code 为 `CAPABILITY_REPEATED_FAILURE` 的 degradation notice
- **AND** Agent Core MUST 安全地使 run 失败，而不是继续进入下一个模型 round。
