## MODIFIED Requirements

### Requirement: Bash 只接受严格单一命令

Bash Tool MUST 在 gateway 执行之前，将 `command` 严格解析为恰好一个可执行文件和一个参数数组。它 MUST 拒绝管道、重定向、复合操作符、变量赋值或展开、命令替换、glob 展开、response 文件、控制字符、畸形引号、绝对路径、父目录穿越、设备文件，以及任何无法被唯一解析的输入。

当 Bash 因引号语法畸形而在 sandbox 提交之前拒绝命令时，它 MUST 保持公共 safe error code `COMMAND_NOT_ALLOWED`，并 MUST 包含帮助 model 修复该命令的安全细节。对未闭合的带引号参数，安全细节 MUST 包含 reason code `BASH_COMMAND_UNCLOSED_QUOTE` 和一条告知 model 闭合带引号参数的提示。该工具 MUST NOT 自动闭合引号或向 sandbox 提交修复后的命令。

#### Scenario: 在执行前拒绝未闭合引号的 Python 查询

- **WHEN** model 以 `python .nextagent/skills/.../scripts/rag_query.py --query "SET BYPASSRM recovery command` 调用 Bash
- **THEN** Bash MUST 在 sandbox 提交之前拒绝该命令
- **AND** 该拒绝 MUST 是可重试的 `COMMAND_NOT_ALLOWED` 授权失败
- **AND** 安全细节 reason code MUST 为 `BASH_COMMAND_UNCLOSED_QUOTE`
- **AND** 安全提示 MUST 告知 model 闭合带引号的参数

#### Scenario: 在执行前拒绝 shell 组合

- **WHEN** model 以 `grep foo file | wc -l` 调用 Bash
- **THEN** Bash MUST 在 sandbox 提交之前拒绝该命令
- **AND** 该拒绝 MUST 是可重试的 `COMMAND_NOT_ALLOWED` 授权失败
