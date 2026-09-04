## REMOVED Requirements

### Requirement: ModelProfile carries the model context window size

**Reason**：`ModelProfile` 继续承载 compatible 模型的静态 `contextWindowTokens` 和默认调用画像，但 Gateway 模型需要由可信 model-information 查询解析窗口；两类来源的统一目录行为迁入 canonical model invocation spec。

**Migration**：provider-specific 窗口来源与安全目录查询迁入 `model-invocation-contract` 的“全局模型目录提供安全模型配置”。

### Requirement: Context window is the assembly budget window source

**Reason**：Agent assembly 只以 `modelIds` 表达激活关系，不能充当 provider-resolved 模型窗口权威。

**Migration**：Context budget 行为迁入 `context-engine` 的“上下文预算使用所选模型的已解析窗口”。该来源 spec 归档后清空，按 design 的退役门禁清理导航。
