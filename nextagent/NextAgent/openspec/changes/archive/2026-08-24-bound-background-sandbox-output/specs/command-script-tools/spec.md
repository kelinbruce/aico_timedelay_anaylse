## Function

- **所属 Function**：`FN-5.5 执行命令和脚本`（command-script-tools）
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Bash 在 sandbox 提交前拒绝不支持的 Python 调用模式

Bash Tool MUST 在提交 sandbox 前拒绝 `python` 和 `python3` 的不支持 CLI 模式。不支持模式 MUST 包括 `-c` inline source、`-` stdin source、除精确单参数 `--version` 以外的 interpreter option-only 调用、缺少 module 或 module 不是 dotted Python module name 的 `-m` 调用，以及会启动交互式 REPL 的零参数调用。Bash Tool MUST 允许 `python <script.py> ...`、`python3 <script.py> ...`、合法 `python -m package.module ...` 以及只有一个 `--version` 参数的版本检查。

拒绝结果 MUST 为 `status=FAILED`、`safeError.code=CAPABILITY_INPUT_INVALID`、`safeError.category=VALIDATION` 和 `safeError.retryable=true`。safe details MUST 包含稳定 reason code，并 MUST 提供使用 Python Tool `code` 字段执行 inline source，或者使用 Bash 调用现有 script/module 的修复提示。零参数调用的 reason code MUST 为 `BASH_PYTHON_REPL_UNSUPPORTED`。拒绝发生后，Bash Tool MUST NOT 调用 sandbox dependency。restricted sandbox gateway MAY 对相同模式保留 fail-closed 纵深校验；若保留，它不得建立不同的允许集合或错误语义。

**需求类别**：系统质量属性
**质量属性**：安全、可维护性
**适用范围**：该 Function

#### Scenario: 零参数 Python 和 Python3 调用被拒绝

- **WHEN** Bash 收到 command 为 `python` 或 `python3` 且 args 为空的调用
- **THEN** Bash MUST 返回 retryable `CAPABILITY_INPUT_INVALID`
- **AND** safe details 的 reason code MUST 为 `BASH_PYTHON_REPL_UNSUPPORTED`
- **AND** Python sandbox dependency MUST NOT 被调用

#### Scenario: Inline Python 调用返回修复提示

- **WHEN** Bash 收到 `python -c print(1)`、`python -` 或对应的结构化 argv
- **THEN** Bash MUST 在 sandbox 提交前拒绝
- **AND** safe details MUST 提示使用 Python Tool 执行 inline source

#### Scenario: 非法 module 和 option-only 调用被拒绝

- **WHEN** Bash 收到缺少合法 dotted module name 的 `-m`，或者除精确 `--version` 以外的 option-only 调用
- **THEN** Bash MUST 在 sandbox 提交前拒绝
- **AND** sandbox dependency MUST NOT 被调用

#### Scenario: 支持的脚本和模块调用保持可路由

- **WHEN** Bash 收到 `python path/to/script.py arg` 或 `python -m package.module arg`
- **THEN** Bash MUST 继续通过 Python sandbox dependency 路由

#### Scenario: 精确版本检查保持可路由

- **WHEN** Bash 收到只有一个 `--version` 参数的 `python` 或 `python3` 调用
- **THEN** Bash MUST 继续通过 Python sandbox dependency 路由
- **AND** `--version` 后包含额外参数时 MUST 拒绝

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：Bash 在 sandbox 前统一拒绝不支持的 Python/Python3 CLI 模式，并把零参数交互式 REPL 纳入同一可纠正诊断。
- **依据 Requirements**：`Bash 在 sandbox 提交前拒绝不支持的 Python 调用模式`

### 规格

| 规格项 | 变更类型 | 原规格值 | 目标规格值 | 依据 Requirements |
|---|---|---|---|---|
| Bash Python 调用模式 | 修改 | legacy spec 定义 inline、stdin、option、module 与 version 行为 | canonical spec 统一承载原有行为，并增加 `python`/`python3` 零参数 REPL 拒绝和 `BASH_PYTHON_REPL_UNSUPPORTED` | `Bash 在 sandbox 提交前拒绝不支持的 Python 调用模式` |
