## MODIFIED Requirements

### Requirement: Bash policy 跟随冻结的本地 sandbox 禁用开关

Builtin `bash` 工具 SHALL 通过可信 app composition 消费冻结的本地 `sandbox.enabled` 值。当该值被省略或为 `true` 时，Bash SHALL 保持既有的严格单命令 allowlist、按命令的参数 policy、路径检查和 Python 脚本 allowlist 行为。当该值为 `false` 时，Bash SHALL 在提交 sandbox 之前跳过工具层的命令 allowlist、按命令的参数授权、路径授权和 Python 脚本 allowlist 检查。

在该模式下，Bash MUST 仍将 model 可见命令解析为确定性的 `command` 和 `args`，MUST 将 `&&` 或 `||` 等 shell 操作符 token 保留为供 sandbox adapter 使用的普通解析 token，MUST 仍通过 sandbox 依赖提交，并 MUST NOT 在 capability 层直接执行。

#### Scenario: 禁用校验时保留 shell 链式 token 以供 sandbox 提交

- **WHEN** 可信的本地启动配置设置 `sandbox.enabled=false`
- **AND** model 以 `cd logs && python script.py` 调用 Bash
- **THEN** Bash 将命令 tokenize 为可执行的 `cd` 和包括 `&&` 在内的参数 token
- **AND** 通过 sandbox 依赖提交解析后的命令
- **AND** 不在 capability 层通过宿主 shell API 执行
