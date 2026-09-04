## 设计（Design）

Bash 解析器已经在 sandbox 执行前拒绝未闭合引号。本 change 不放宽该行为，也不自动修复畸形的 shell 文本。

Bash tool 对 `COMMAND_NOT_ALLOWED` 失败进行包装以便模型纠正。该包装器现在会检测提交的命令是否存在未闭合的单引号或双引号，并返回：

- `safeError.code = COMMAND_NOT_ALLOWED`
- `safeDetails.reasonCode = BASH_COMMAND_UNCLOSED_QUOTE`
- 一条安全提示，告诉模型闭合被引号包裹的参数并优先使用 `--query "..."`

其他策略拒绝继续使用既有的 `BASH_POLICY_DENIED` 原因和通用重试提示。

## 验证（Verification）

- Bash capability 测试验证未闭合引号的 Python 查询在 sandbox 执行前以 `BASH_COMMAND_UNCLOSED_QUOTE` 失败。
- 既有 Bash capability 测试继续覆盖允许的带引号 CJK Python 参数和通用策略拒绝。
