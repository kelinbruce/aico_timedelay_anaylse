# 修复 Bash Python 内联模式规划误导设计

## 设计范围

本 change 修改现有 Bash Tool Function 的输入整形与模型提示，不新增 Tool、Capability 或 sandbox 执行模式。

## Bash Tool Function

### 目标与规范依据

目标 Requirement 是 `Bash Rejects Unsupported Python Invocation Modes Before Sandbox Submission`。Bash Tool 在提交 sandbox 前识别 `python -c`、`python -`、无效 `python -m` 和其他不支持的 Python CLI mode，并返回可修正的输入错误。精确 `python --version` 保留为版本探测例外。

### 当前实现

Bash Tool 当前只把 `command` 解析为 executable 和 argv。只要 executable 是 `python` 或 `python3`，就直接调用 Python sandbox dependency。local sandbox 在 `classifyPythonInvocation` 中再拒绝 `-c`、`-`、无效 `-m`、`--version` 和其他 option-only invocation。

### GAP 分析

拒绝发生在执行边界内，模型无法从 Bash Tool 的模型可见说明中清楚知道这些 Python CLI mode 不可用，也无法得到明确的“改用 Python Tool”提示。

### 修改方案

Bash Tool 在解析完成后，如果 executable 是 `python` 或 `python3`，先检查 argv 的第一个参数：

- 为空时保持既有行为。
- 第一个参数不是 `-m` 且不是 `-` 开头时，视为脚本路径，保持既有行为。
- 第一个参数是 `-m` 时，第二个参数必须是 dotted module name。
- 第一个参数是 `--version` 且没有其他参数时，作为解释器版本探测请求进入 Python sandbox。
- 第一个参数是 `-c`、`-` 或其他 `-` 开头参数时，返回 `CAPABILITY_INPUT_INVALID`，`retryable=true`，safe details 携带 reason code 和修正提示。

local sandbox 的 `unsupported-python-invocation` 拒绝保持不变，作为最后安全防线。

### 质量影响

可诊断性提升：模型能看到明确修正方向。安全性保持：未放开新的 Python 执行模式，sandbox 的 fail-closed 行为保留。

## 长期基线刷新计划

归档前同步：

- `openspec/specs/bash-tool/spec.md`
- `openspec/designs/modules/agent-capability.md`
- `openspec/designs/modules/agent-platform-gateway-local.md`
- `openspec/designs/spec-to-design-map.md`
