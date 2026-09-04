## REMOVED Requirements

### Requirement: Python tool returns structured execution result

**Reason**：Python 的正常结构化结果、非零退出、guard、internal、timeout 和安全部分输出属于同一个 `FN-5.5 执行命令和脚本` 行为，必须由 canonical `command-script-tools` Requirement 原子承载，避免 legacy `python-tool` 与 canonical spec 并行定义失败语义。

**Migration**：完整行为迁入 `command-script-tools / Python guard 和执行失败使用统一安全语义`。
