# python-tool Specification Delta

## Function

- **所属 Function**：`FN-5.5 执行命令和脚本`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Python tool accepts code snippet input

The Python tool MUST accept the following input schema:

- `code` (string, required): Python code snippet to execute
- `preamble` (string, optional): Variable declaration lines prepended to `code` at execution time. MUST NOT be sent to the nl2py guardrail check. When present, the effective sandbox command SHALL be `preamble + "\n" + code`.
- `args` (string array, optional): script arguments
- `timeout_ms` (integer > 0, optional): execution timeout in milliseconds

If `timeout_ms` is omitted, the effective timeout SHALL be `10000` ms. If `timeout_ms` exceeds `120000`, the effective timeout SHALL be capped at `120000` ms. `args` SHALL NOT exceed `100` entries or `8192` UTF-8 bytes total.

#### Scenario: python accepts valid code snippet

- **WHEN** a model provides valid Python input with `code`
- **THEN** the Python handler MUST accept the input
- **AND** execute the code through the Python execution path

#### Scenario: python rejects oversized args

- **WHEN** `python` is invoked with more than `100` args or args exceeding `8192` UTF-8 bytes total
- **THEN** the invocation MUST fail safely
- **AND** the system MUST NOT submit the request to sandbox execution

#### Scenario: preamble is prepended to code at execution time

- **WHEN** `python` is invoked with both `code` and `preamble`
- **THEN** the sandbox MUST receive `preamble + "\n" + code` as the command
- **AND** the nl2py guardrail MUST only receive `code` as the content to check

#### Scenario: empty preamble is treated as absent

- **WHEN** `python` is invoked with `preamble` set to an empty or whitespace-only string
- **THEN** the handler MUST treat `preamble` as absent
- **AND** the sandbox MUST receive only `code` as the command
