# 为 Bash Tool 增加结构化 argv 输入

## Why

Agent 有时会通过 Bash 调用 Skill 中的 Python 脚本，并把 JSON 对象作为单个命令行参数传入。现有 Bash Tool 只有 `command` 字符串输入，模型需要手写整条 shell 命令；当 JSON 内部包含 Gremlin、SQL、正则或自然语言中的双引号时，shell 引号层和 JSON 引号层容易互相干扰，导致脚本侧 `json.loads` 收到非法 JSON。

典型失败形态是：

```bash
python "scripts/http_request.py" '{"gremlin":"g.V().hasLabel("LTP")"}'
```

这里 `gremlin` 字段中的 `"LTP"` 没有经过 JSON 层合法转义，最终在 Python 3 脚本内解析失败。这个问题不是脚本业务逻辑问题，而是命令规划把结构化参数降级为 shell 字符串后引入的转义问题。

## Goals / Non-Goals

- 在现有 Bash Tool Function 上增加可选结构化 `args` 输入，避免模型为复杂参数手写 shell 引号。
- 当提供 `args` 时，`command` 只表示可执行文件，`args` 逐项作为 argv 原样提交给 sandbox gateway。
- 保持未提供 `args` 时的既有 `command` 字符串解析路径不变。
- 继续让 Python/Python3 调用走既有 Python sandbox 路由。
- 在模型可见描述中提示 JSON、Gremlin、SQL、regex、自然语言和路径参数优先使用结构化 `args`。

**非目标：**

- 不改变 sandbox gateway 的可执行文件授权、文件系统策略或执行边界。
- 不为结构化 `args` 增加 shell 解释能力。
- 不自动修复脚本内部收到的非法 JSON。
- 不新增独立 Tool、Capability 或 Function。

## What Changes

- 在现有 Bash Tool Function 上增加可选结构化 `args` 输入，并保持未提供 `args` 时的既有 `command` 字符串调用不变。
- 约束提供 `args` 时的 `command` 只表示单个可执行文件，拒绝混合命令字符串并返回可重试的安全修复提示。
- 保持 Python/Python3 路由与 sandbox gateway 的既有边界不变。

## Function 影响

- **所属 Function**: 现有 Bash Tool Function。
- **Function 变更类型**: MODIFIED。
- **主规格**: `openspec/specs/bash-tool/spec.md`。
- **影响范围**: `agent-capability` 内置 Bash Tool 的输入 schema、模型可见描述、命令入参整形和聚焦测试。

## 影响

- 兼容性：只新增可选字段；旧的 `command` 字符串调用保持原行为。
- 安全性：结构化参数仍通过原 sandbox gateway；Bash Tool 不新增 capability-owned 授权策略。
- 可诊断性：当 `args` 与复合 `command` 混用时，返回可重试的 `CAPABILITY_INPUT_INVALID`，提示模型把 `command` 改为单个可执行文件。
