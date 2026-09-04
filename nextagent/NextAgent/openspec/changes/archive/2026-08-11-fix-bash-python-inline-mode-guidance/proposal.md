# 修复 Bash Python 内联模式规划误导

## Why

Agent 可能按通用 Python CLI 经验规划 `python -c "..."`、`python -` 或其他 Python CLI mode。多数 mode 在普通 Python CLI 中合法，但 NextAgent 受控 sandbox 主要支持既有脚本执行和 `python -m package.module` 模块执行。`python --version` 是低风险解释器版本探测，可以作为精确例外保留。

当前拒绝发生在 local sandbox 内部，模型看到的是较底层的执行不可用或 unsupported invocation 结果，难以自动改用 Python Tool。

## Goals

- 在 Bash Tool 提交 sandbox 前识别不支持的 Python CLI mode。
- 返回可重试的 `CAPABILITY_INPUT_INVALID`，并提示模型：内联 Python 源码使用 Python Tool，已有脚本使用 `python <script.py>` 或 `python -m package.module`。
- 保留精确 `python --version` 作为版本探测能力。
- 减少模型规划后才在 sandbox 失败的场景。

## Non-Goals

- 不支持 `python -c` 或 `python -`。
- 不支持 `python --version` 之外的 option-only Python invocation。
- 不改变 Python Tool 的内联代码执行契约。
- 不改变 sandbox gateway 对 Python invocation mode 的最终 fail-closed 防线。

## What Changes

- Bash Tool 描述明确禁止 `python -c`、`python -` 等内联 Python CLI mode。
- Bash Tool 对 `python`/`python3` 参数做轻量校验，只允许脚本路径、合法 dotted module 的 `-m` 形式或精确 `--version` 进入 Python sandbox。
- 不支持的 Python CLI mode 在 capability 层返回可修正错误，不再提交给 sandbox。

## Function Impact

- **Owning Function**: Bash Tool。
- **Function Change Type**: MODIFIED。
- **Primary Spec**: `openspec/specs/bash-tool/spec.md`。
- **Behavior Boundary**: Bash 只负责在提交前识别无法被当前 Python sandbox 支持的 invocation mode，并给出模型修正提示；精确 `--version` 作为版本探测例外；最终执行安全边界仍由 sandbox gateway 拥有。
