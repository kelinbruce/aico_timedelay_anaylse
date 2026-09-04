# bash-tool Specification Delta

## Modified Requirements

### Requirement: Bash 只接受严格单一命令

`bash` 工具 SHALL 在提交 sandbox 之前，将 model 提供的命令文本解析为确定性的可执行 token 和参数向量。Bash capability MUST 拒绝空或畸形的 tokenize 结果，但它 MUST NOT 拥有可执行文件 allowlist 或按命令的参数授权。可执行文件的 allow/deny 决策属于 sandbox gateway policy。

#### Scenario: 复杂 shell 语法以结构化 token 到达 sandbox policy

- **WHEN** model 提交带 shell 操作符 token 的命令
- **THEN** Bash MUST 将命令确定性地 tokenize 为 `command` 和 `args`
- **AND** Bash MUST 通过 sandbox 依赖提交结构化请求
- **AND** sandbox gateway policy MUST 决定拒绝还是执行它

### Requirement: Bash 默认命令是本地且只读的

受限本地 sandbox policy SHALL 使用可执行文件 denylist。默认 denylist MAY 为空，表示所有可解析的可执行文件都被允许。该 denylist MUST 被视为 sandbox gateway policy 配置，而不是 Bash capability 拥有的命令权威。

#### Scenario: 配置在 gateway 边界拒绝危险可执行文件

- **WHEN** 可信 app composition 在 sandbox gateway denylist 中配置了危险可执行文件
- **THEN** Bash MUST NOT 在提交 sandbox 之前拒绝该可执行文件
- **AND** sandbox gateway MUST 基于 denylist 拒绝它

### Requirement: Bash 受 workspace 约束且网络 CLI 被拒绝

可执行文件 deny 决策 SHALL 由 sandbox gateway denylist policy 或更强的平台 sandbox 强制执行。Bash MAY 提供 model 指导，但 MUST NOT 成为可执行文件 policy 的最终安全边界。路径限制、文件系统根检查、environment 校验和文件类型检查不由 sandbox gateway 强制执行；它们被委托给平台隔离。

#### Scenario: 被拒的可执行文件被 sandbox policy 拒绝

- **WHEN** Bash 提交一个位于配置 denylist 中的可执行文件
- **THEN** sandbox gateway MUST 安全地拒绝该请求
- **AND** 面向 capability 的结果 MUST 保留安全的 sandbox 拒绝 reason

### Requirement: Bash policy 跟随冻结的本地 sandbox 禁用开关

Builtin `bash` 工具 SHALL 消费冻结的 app composition，仅为保持面向 model 的配置兼容性。受限本地 sandbox gateway SHALL 消费 `sandbox.enabled` 作为校验模式开关。当校验启用时，gateway 检查 denylist。当校验禁用时，gateway 跳过所有检查并使用可信 shell 模式。Bash MUST 仍通过 sandbox 依赖提交，MUST NOT 在 capability 层直接执行。

#### Scenario: 禁用校验仍由 gateway 拥有

- **WHEN** 可信的本地启动配置设置 `sandbox.enabled=false`
- **THEN** 受限本地 sandbox gateway MAY 使用可信 shell 模式
- **AND** Bash capability MUST not 直接调用宿主 shell API
