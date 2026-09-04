# Add Bash PYTHONPATH 环境兼容

## 背景与问题（Why）

Agent 有时需要运行来自投影 Skill 资源的既有 Python 脚本。当导入相对于 Skill 的 `scripts/` 树时，模型可能规划一条普通 shell 命令，例如：

```bash
PYTHONPATH=.nextagent/skills/<projection>/<skill>/scripts python .nextagent/skills/<projection>/<skill>/scripts/nl2sql/sql_recall_main.py "query"
```

Bash Tool 是受治理的 sandbox 入口，不是完整的 shell 解释器。它的 tokenizer 把前导 `PYTHONPATH=...` token 当作可执行文件，因此执行被路由为 bash 命令，受限 sandbox 可能在 Python 启动之前返回 `BASH_EXECUTION_UNAVAILABLE`。

## 目标（Goals）

- 为 Bash Tool 调用支持窄域的结构化 `env.PYTHONPATH` 输入。
- 为向后兼容，把单个前导 `PYTHONPATH=...` 命令前缀规范化为同一结构化环境。
- 保持 Python/Python3 路由通过既有的 Python sandbox 路径。
- 在把请求的 `PYTHONPATH` 传给本地进程之前，对照已授权的 sandbox 逻辑 roots 校验。

## 非目标（Non-Goals）

- 不新增通用环境变量支持。
- 不允许来自模型输入的 `PATH`、`HOME`、`PYTHONHOME`、代理变量、凭据或类密钥 key。
- 不启用完整 shell 解释或任意赋值前缀。
- 不改变 sandbox 可执行授权。

## 变更范围（What Changes）

- Bash Tool schema 接受可选的 `env: { PYTHONPATH: string }`。
- Bash Tool 命令解析识别单个前导 `PYTHONPATH=...` token，并提交后续可执行文件加参数。
- Sandbox 执行输入把过滤后的环境携带到 gateway 请求。
- 受限 local sandbox 只在路径被请求文件系统授权时，才把 `PYTHONPATH` 从 sandbox 逻辑路径解析为物理路径。

## Function 影响（Function Impact）

- **拥有 Function**：Bash Tool。
- **Function 变更类型**：MODIFIED。
- **主 spec**：`openspec/specs/bash-tool/spec.md`。
- **行为边界**：Bash Python 调用可以提供受治理的 Python 导入路径，而无需依赖完整 shell 环境赋值语义。
- **质量属性**：安全与可诊断性。该兼容路径在进程启动前拒绝不安全的导入路径，并避免对有效 Python Skill 脚本调用产生误导性的 `BASH_EXECUTION_UNAVAILABLE` 失败。

## 影响范围（Impact）

- 既有普通命令字符串和结构化 `args` 行为保持兼容。
- 之前失败的 `PYTHONPATH=... python ...` Skill 脚本调用可以通过 Python sandbox 执行。
- 安全态势保持窄域：只接受 `PYTHONPATH`，local adapter 拒绝绝对路径、父目录穿越、路径列表或未授权值。
