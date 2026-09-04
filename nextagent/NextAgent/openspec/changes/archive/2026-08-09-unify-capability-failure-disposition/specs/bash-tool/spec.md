# bash-tool Delta Specification

## REMOVED Requirements

### Requirement: Bash Accepts Only Strict Single Commands

**Reason**：该 Requirement 明确把可通过修改 `command` 修正的 tokenization/quoted-syntax 错误定义为可重试 authorization failure，与统一参数错误分类冲突。

**Migration**：完整行为迁入 `command-script-tools / Bash 对可纠正命令格式错误返回完整诊断`；稳定 code `COMMAND_NOT_ALLOWED`、reason code `BASH_COMMAND_UNCLOSED_QUOTE`、sandbox 前拒绝、单 token sequence 和 sandbox policy owner 均保留，category、retryable、message 和 violations 改为统一目标。

### Requirement: Bash Results Are Bounded And Safe

**Reason**：该 Requirement 把所有正常完成的非零进程退出定义为 `DEGRADED`，并使 Capability status 偏离 sandbox 已返回的明确进程事实；同时该行为已属于 canonical `FN-5.5 / command-script-tools`。

**Migration**：完整行为迁入 `command-script-tools / Bash 结果有界且忠实表达进程完成事实`；有界 stdout/stderr、独立 truncation flags、安全日志边界和 execution-boundary failure 语义全部保留，正常完成的非零退出改为不受 stdout/stderr 是否为空影响的 `SUCCEEDED` 结构化结果。
