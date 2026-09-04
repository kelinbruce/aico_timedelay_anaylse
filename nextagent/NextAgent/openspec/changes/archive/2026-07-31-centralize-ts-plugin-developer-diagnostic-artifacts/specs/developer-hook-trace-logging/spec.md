## REMOVED Requirements

### Requirement: SDK developer hook trace logging is caller-owned

**Reason**：caller-owned file sink 允许插件自行选择文件路径并同步写入，无法提供统一容量、轮转、压缩、保留和降级边界。

**Migration**：该 Requirement 的 trace 内容与坐标语义迁入 `plugin-developer-diagnostic-artifacts` 的 `内置调测插件提交统一记录`；物理输出与失败语义迁入同一主规格的统一 sink、独立文件族和非干扰 Requirements。

### Requirement: SDK can write a formal developer hook trace plugin artifact

**Reason**：现有正式 artifact 通过 activation config 接受 `logDirectory` 与 `logFile` 并直接写盘，与统一 developer diagnostic artifact 边界冲突。

**Migration**：正式 artifact 继续由 SDK 生成并通过现有 loader 加载，但其输出改为消费宿主提供的 `DeveloperDiagnosticArtifactSink`，相关公共行为由 `plugin-developer-diagnostic-artifacts` 主规格承载。
