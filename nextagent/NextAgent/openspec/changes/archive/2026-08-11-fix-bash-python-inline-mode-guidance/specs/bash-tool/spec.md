## Function

- **Owning Function**: Bash Tool
- **Function Change Type**: MODIFIED
- **Spec Role**: Primary delta

## ADDED Requirements

### Requirement: Bash 在提交 sandbox 之前拒绝不支持的 Python 调用模式

内建 Bash Tool MUST 在提交 sandbox 之前拒绝请求了不受支持 Python CLI 模式的 Python 和 Python3 调用。不受支持的模式包括：带 `-c` 的 inline 源码执行、带 `-` 的 stdin 执行、除精确 `--version` 之外仅有解释器选项的调用，以及 `-m` 调用中 module 参数缺失或不是点分 Python module 名的情况。

内建 Bash Tool MUST 在 `--version` 是可执行文件之后唯一参数时允许精确的 `python --version` 和 `python3 --version` 调用。该 Tool MUST NOT 把这一例外扩展到 `--help`、`-V`、带附加参数的 `--version` 或其他解释器选项。

当 Bash 拒绝一个不受支持的 Python 调用模式时，它 MUST 返回可重试的 `CAPABILITY_INPUT_INVALID`。Safe details MUST 包含一个稳定的 reason code 和一个提示，告诉模型对 inline Python 源码使用带 `code` 字段的 Python Tool，或对既有脚本、module 使用 Bash 的 `python <script.py> ...` / `python -m package.module ...`。

受限 sandbox gateway MAY 保留其对相同不受支持模式的既有 fail-closed 拒绝，作为纵深防御边界。

**需求类别**：功能性需求 / 安全性需求

#### Scenario: Inline Python 命令被拒绝并带修复提示

- **WHEN** Bash 以 `python -c print(1)` 被调用
- **THEN** Bash MUST 在提交 sandbox 之前拒绝该输入
- **AND** 结果 MUST 是一个可重试的 `CAPABILITY_INPUT_INVALID`
- **AND** safe details MUST 告诉模型对 inline 源码使用 Python Tool

#### Scenario: 结构化 inline Python 参数被一致拒绝

- **WHEN** Bash 以 `command: "python"` 和 `args: ["-c", "print(1)"]` 被调用
- **THEN** Bash MUST 在提交 sandbox 之前拒绝该输入
- **AND** Python sandbox 依赖 MUST NOT 被调用

#### Scenario: 受支持的脚本与 module 调用保持可路由

- **WHEN** Bash 以 `python path/to/script.py arg` 被调用
- **OR** Bash 以 `python -m package.module arg` 被调用
- **THEN** Bash MUST 继续通过 Python sandbox 依赖路由该请求

#### Scenario: 精确的 Python 版本检查保持可路由

- **WHEN** Bash 以 `python --version` 被调用
- **THEN** Bash MUST 通过 Python sandbox 依赖路由该请求
- **AND** Bash MUST NOT 允许 `--version` 之后的附加参数

## Function Change Summary

### Specifications

| Specification Item | Change Type | Target Specification Value | Requirement Evidence |
| --- | --- | --- | --- |
| 不支持的 Python 调用引导 | ADDED | Bash 在提交 sandbox 之前拒绝不受支持的 Python CLI 模式，并返回可重试的修复提示。 | Bash 在提交 sandbox 之前拒绝不支持的 Python 调用模式 |
| 受支持的 Python 调用兼容性 | ADDED | Bash 继续把脚本路径、有效的点分 module 调用和精确的 `--version` 检查路由到 Python sandbox。 | Bash 在提交 sandbox 之前拒绝不支持的 Python 调用模式 |
