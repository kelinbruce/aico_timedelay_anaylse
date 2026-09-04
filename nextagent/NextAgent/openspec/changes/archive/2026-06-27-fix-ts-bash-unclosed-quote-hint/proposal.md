## 背景与问题（Why）

Issue 3 显示模型生成带起始引号但没有闭合引号的 Python Skill 查询后，Bash 反复出现 `COMMAND_NOT_ALLOWED` 失败。命令在 sandbox 执行前被正确拒绝，但通用的策略拒绝消息没有告诉模型如何修复畸形命令。

## 变更范围（What Changes）

- 保持 Bash 策略对畸形命令 fail-closed。
- 保持公开 safe error code 为 `COMMAND_NOT_ALLOWED`。
- 为未闭合引号参数新增模型可见的安全原因和提示。
- 澄清 Bash tool 描述中关于 Python Skill 自然语言查询的部分。

## 影响范围（Impact）

- `agent-capability`：Bash 策略拒绝的安全细节变得更具可操作性。
- 测试：为未闭合引号的 Python 查询参数新增聚焦的 Bash capability 回归覆盖。
