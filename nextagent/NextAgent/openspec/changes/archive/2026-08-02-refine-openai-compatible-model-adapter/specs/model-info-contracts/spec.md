## REMOVED Requirements

### Requirement: ModelInfo carries the model context window size

**Reason**：完整 context window 和安全模型配置统一由 `ResolvedModelConfiguration` 表达。

**Migration**：安全模型配置与 resolved context window 迁入 `model-invocation-contract` 的“全局模型目录提供安全模型配置”；Context Engine 只消费选择结果中的安全配置。

### Requirement: Budget decision gate reads the real model window from ModelInfo

**Reason**：budget 应消费本次所选模型的 resolved configuration，而不是依赖 `ModelInfo` 作为第二个配置权威。

**Migration**：目标行为迁入 `context-engine` 的“上下文预算使用所选模型的已解析窗口”。该来源 spec 归档后清空，按 design 的退役门禁清理导航。
