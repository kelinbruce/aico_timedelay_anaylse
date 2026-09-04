# Add Bash PYTHONPATH 环境兼容设计

## 设计范围（Design Scope）

本 change 修改既有的 Bash Tool Function。它覆盖一个面向 Bash 调用 Python 脚本的窄域 Python 导入路径兼容路径，不引入通用环境变量支持。

受影响产物：

- 主 delta spec：`openspec/changes/add-bash-pythonpath-env-compat/specs/bash-tool/spec.md`
- 实现区域：Bash Tool 输入规范化、sandbox 执行请求构造和受限 local sandbox 环境准备。

## Bash Tool Function

### 目标与规格证据（Goal And Specification Evidence）

目标 requirement 是 `Bash Accepts Narrow Pythonpath Environment`。需要 Python 导入的 Bash 调用可以在结构化字段中提供 `PYTHONPATH`，带单个前导 `PYTHONPATH=<value>` token 的遗留命令文本会被规范化为同一个受治理请求。

### 当前实现（Current Implementation）

Bash Tool 对 `command` 字符串做 token 化，并把第一个 token 当作可执行文件。因此诸如 `PYTHONPATH=.nextagent/.../scripts python script.py` 的命令会被解释为名为 `PYTHONPATH=.nextagent/.../scripts` 的可执行文件。该请求不会路由到 Python sandbox，并可能作为不支持的 bash 可执行文件而失败。

sandbox 请求已经包含一个 `environment` 对象，用于附件文件路径等可信系统提供的值，但 Bash 输入目前不会填充模型控制的环境字段。

### 差距分析（Gap Analysis）

模型可见的 Bash Tool 契约可以表达可执行文件和 argv 条目，但无法在不依赖 shell 专属环境赋值语法的情况下表达 Python 导入路径。该语法不属于受治理的 Bash 命令 tokenizer 契约。

### 选定方案（Chosen Approach）

Bash Tool 接受一个结构化 `env` 对象，只支持一个 key：`PYTHONPATH`。解析出的环境通过既有的可执行事实 allowlist 进入 `SandboxExecutionInput`。

当没有提供结构化 `args` 时，Bash Tool 还识别单个前导 `PYTHONPATH=<value>` token。它把该 token 从可执行位置移除，把值存入同一结构化环境字段，并继续正常路由后续可执行文件。

受限 local sandbox 把请求的 `PYTHONPATH` 解析为 sandbox 逻辑路径。当值为空、非字符串、绝对路径、父目录穿越、路径列表形态或超出请求文件系统 roots 时，在进程启动前拒绝。`python -m` 模块执行继续优先使用既有的可信 Skill 模块 root，并忽略请求提供的 `PYTHONPATH`。

### 未选定方案（Non-Chosen Approaches）

- 未选择通用 `env` 支持，因为它会为路径、代理、home 目录、解释器和凭据相关变量暴露过宽的安全面。
- 未选择完整 shell 解释，因为 Bash Tool 仍是受治理的 sandbox 入口，shell 语义属于 sandbox gateway 策略。
- 未选择针对具体 Skill 的脚本修改，因为该问题是一个可复用的框架兼容缺口。

### 质量影响（Quality Impact）

安全性通过只接受 `PYTHONPATH` 并对照已授权 sandbox 逻辑 roots 解析来保持。可诊断性得到改善，因为有效的 Python Skill 脚本调用不再在 Python 路由之前以 `BASH_EXECUTION_UNAVAILABLE` 失败。

## 长期基线刷新计划（Long-Term Baseline Refresh Plan）

归档前更新：

- `openspec/specs/bash-tool/spec.md`
- `openspec/designs/modules/agent-capability.md`
- `openspec/designs/modules/agent-platform-gateway-local.md`
- `openspec/designs/spec-to-design-map.md`
