## REMOVED Requirements

### Requirement: Bash Rejects Unsupported Python Invocation Modes Before Sandbox Submission

**Reason**：本 Requirement 被实质修改后应归属于 `FN-5.5 执行命令和脚本` 的 canonical spec `command-script-tools`，不得继续由 legacy `bash-tool` 承载。目标行为同时增加零参数 Python REPL 的拒绝。

**Migration**：归档时删除本 Requirement，并把 inline、stdin、option、module、version、script、修复提示和零参数 REPL 的完整目标行为只合并到 `openspec/specs/command-script-tools/spec.md` 的 `Bash 在 sandbox 提交前拒绝不支持的 Python 调用模式`。`bash-tool` 中未被本 change 触及的其他 Requirements 原位保留。
