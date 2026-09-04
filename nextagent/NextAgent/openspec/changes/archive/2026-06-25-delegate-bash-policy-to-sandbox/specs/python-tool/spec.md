# python-tool Specification Delta

## Modified Requirements

### Requirement: Python 工具只通过 sandbox gateway 执行

Python 工具执行已经经由 sandbox gateway 路由，且不使用工具拥有的命令 allowlist。在 Bash 可执行文件 policy 被委托给 sandbox gateway policy 期间，该行为 SHALL 保持不变。

#### Scenario: Python 保持独立于 Bash 命令 policy

- **WHEN** Bash 命令 policy 拥有权发生变化
- **THEN** Python 工具调用 MUST 继续经由 Python 工具 handler 路由
- **AND** Python 输入 MUST NOT 使用 Bash 命令规则进行解析或授权
