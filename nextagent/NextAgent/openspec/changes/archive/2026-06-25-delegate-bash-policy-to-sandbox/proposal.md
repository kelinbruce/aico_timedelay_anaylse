# Change: delegate-bash-policy-to-sandbox

## 背景与问题（Why）

Bash 命令权限当前有一部分在 builtin Bash tool 中、于提交 sandbox 之前强制执行。这使 sandbox 业务策略更难定制，因为面向模型的 capability 会在 sandbox gateway 应用部署特定的 allow/deny 规则之前就拒绝命令。

Python 已经通过 sandbox gateway 执行，没有 tool 拥有的命令 allowlist。Bash 应遵循同一所有权原则：capability 拥有输入 shape、token 化、预算和 sandbox 路由；sandbox gateway 拥有可执行策略和文件系统/网络强制执行。

远程 sandbox 实现不会校验命令，因为容器隔离负责限制。local sandbox 应与同一模型同步，而不是维护一个与远程路径不一致的更严格 allowlist。

## 变更范围（What Changes）

- Bash capability 不再拥有 executable allowlist 和按命令的参数授权。
- Bash capability 仍然把模型命令 token 化为确定性的 `command` 和 `args`，强制执行 schema/超时/输出预算，并要求 sandbox 依赖。
- sandbox gateway 从 executable allowlist 切换为 denylist。唯一的执行前校验是请求的可执行文件是否在已配置的 denylist 中；如果不在，继续执行。路径参数校验、文件系统 root 限制、环境 allowlist 检查和文件类型检查从 sandbox gateway 移除。
- sandbox gateway 仍然拥有可信 shell 模式、超时、取消、readonly root 保护、净化环境和 safe 拒绝。
- Python 行为保持不变：它已经经 sandbox 路由，不受 Bash 命令规则治理。

## 非目标（Non-Goals）

- 不新增无 sandbox 的宿主执行。
- 不向 `agent-contracts` 新增公开的任意可执行注册表。
- 不削弱 sandbox gateway 缺失时的 deny-by-default 行为。
- 不改变 owner scope、agent scope 或风险策略所有权。
- 不把路径、文件系统或环境校验加回 sandbox gateway；这些关注点被委托给平台隔离（容器、VM、OS sandbox）。
