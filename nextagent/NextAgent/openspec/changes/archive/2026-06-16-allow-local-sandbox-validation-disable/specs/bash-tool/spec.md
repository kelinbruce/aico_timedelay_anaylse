## ADDED Requirements

### Requirement: Bash policy 跟随冻结的本地 sandbox 禁用开关

内建 `bash` tool SHALL 通过可信 app composition 消费冻结的本地 `sandbox.disable` 值。当该值被省略或为 `false` 时，Bash SHALL 保持既有的严格单命令 allowlist、命令专属参数 policy、路径检查和 Python 脚本 allowlist 行为。当该值为 `true` 时，Bash SHALL 在 sandbox 提交之前跳过 tool 级命令 allowlist、命令专属参数授权、路径授权和 Python 脚本 allowlist 检查。在该模式下，Bash 仍 MUST 将 model 可见命令解析为确定性的 `command` 和 `args`，仍 MUST 通过 sandbox 依赖提交，MUST NOT 直接使用宿主 shell，并且 MUST NOT 接受对 policy 模式的请求时点、model 输出、capability 参数或客户端 metadata 覆盖。

#### Scenario: 默认 Bash policy 保持严格
- **WHEN** app composition 省略 `sandbox.disable` 或将其设置为 `false`
- **THEN** Bash 在 sandbox 提交之前拒绝不支持的命令、复杂 shell 语法、不安全路径、畸形的命令专属选项和不受信任的 Python 脚本路径
- **AND** 对被拒绝的输入不发起 sandbox 依赖调用

#### Scenario: 禁用校验在 sandbox 提交前放宽 Bash policy
- **WHEN** 可信的本地启动配置设置 `sandbox.disable=true`
- **AND** model 以严格 Bash allowlist 之外的命令调用 Bash
- **THEN** Bash 将该命令分词为可执行文件和参数
- **AND** 通过 sandbox 依赖提交解析后的命令
- **AND** 不直接通过宿主 shell API 执行

#### Scenario: 请求输入不能放宽 Bash policy
- **WHEN** 请求 payload、model 输出、tool 输入、capability 参数或客户端 metadata 尝试禁用 Bash policy 校验
- **THEN** Bash 将该输入忽略为授权状态
- **AND** 只有可信的 app composition 配置决定 policy 模式
