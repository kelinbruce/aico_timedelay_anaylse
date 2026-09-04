# Design: delegate-bash-policy-to-sandbox

## 所有权（Ownership）

Bash tool 仍然是面向模型的 executable capability，但不再决定哪些可执行文件名被允许。它把提交的命令字符串转换为结构化的 executable token 和参数向量，然后通过既有的 sandbox 依赖提交。

sandbox gateway 使用 denylist 拥有可执行策略。如果请求的可执行文件在已配置的 denylist 中，gateway 安全地拒绝请求。如果不在，gateway 继续解析并执行二进制文件。gateway 不再校验路径参数、把路径限制在文件系统 roots 内、检查环境变量或校验文件类型。这些关注点在远程路径上被委托给平台隔离（容器、VM、OS sandbox），在本地路径上被委托给宿主进程边界。

对受限 local adapter 而言，denylist 是来自可信 app composition 的 `deniedExecutables`。默认 denylist 为空，意味着所有能在宿主上解析到的可执行文件都被允许。运维人员可以通过系统配置向 denylist 添加危险命令。

## 安全模型（Safety Model）

- sandbox 依赖缺失仍然在执行前失败。
- capability 层仍然拒绝空或畸形的命令 token 化。
- gateway 拒绝 denylist 中列出的可执行文件。
- gateway 仍然从可信位置（git-bin、PATH、executable overrides）解析可执行文件，并在找不到二进制文件时 fail closed。
- gateway 仍然强制执行 adapter 拥有的 cwd、净化后的环境、超时、取消、输出上限和 readonly root 保护。
- 路径参数校验、文件系统 root 限制、环境 allowlist 检查和文件类型检查被有意移除。远程 sandbox 实现依赖容器隔离做限制；local sandbox 与同一模型同步。
- 自定义 denylist 扩展是 sandbox/app composition 的策略决定，不是 Bash tool 的策略决定。
- Python 保持独立并经 sandbox 路由；本 change 不把 Python 路由经过 Bash。

## 兼容性（Compatibility）

既有 Bash 配置字段（`allowedCommands`、`allowedPythonScripts`）仍作为已废弃的兼容字段被接受。sandbox 配置字段 `builtinExecutables`（allowlist）被替换为 `deniedExecutables`（denylist）。App composition 把 `sandbox.deniedExecutables` 投影到受限 local sandbox gateway；denylist 是权威来源。
