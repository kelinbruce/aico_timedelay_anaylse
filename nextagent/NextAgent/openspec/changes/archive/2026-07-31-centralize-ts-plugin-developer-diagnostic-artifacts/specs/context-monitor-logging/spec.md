## REMOVED Requirements

### Requirement: Context monitor records per-session context evolution

**Reason**：Requirement 把 context evolution 内容语义与 `compact-*.json`、`last-*.json` 物理文件布局及文件数量耦合，无法统一插件调测产物生命周期。

**Migration**：pre-compression、post-compression、summary、latest messages 与 latest answer 内容语义迁入 `plugin-developer-diagnostic-artifacts` 的 `内置调测插件提交统一记录`；物理输出改为统一 compaction 与 terminal records。

### Requirement: Context monitor logging is caller-owned

**Reason**：caller-owned file sink 允许插件自行选择目录并同步写盘，无法提供统一容量与安全边界。

**Migration**：迁入 `plugin-developer-diagnostic-artifacts` 的统一 sink、独立文件族、生命周期和失败非干扰 Requirements。

### Requirement: SDK can write a formal context-monitor plugin artifact

**Reason**：现有正式 artifact 通过 activation config 接受 `logDirectory` 并直接写盘，与统一 developer diagnostic artifact 边界冲突。

**Migration**：正式 artifact 继续由 SDK 生成并通过现有 loader 加载，但其输出改为消费宿主提供的 `DeveloperDiagnosticArtifactSink`，相关公共行为由 `plugin-developer-diagnostic-artifacts` 主规格承载。
