## REMOVED Requirements

### Requirement: Stream deltas are provider-neutral

**Reason**：本次触及的 stream 输出、SDK 隔离和完整 tool call 行为属于 `FN-4.1 调用模型` canonical spec。

**Migration**：目标行为迁入 `model-invocation-contract` 的“流式输出只暴露完整的 provider-neutral 事实”。

### Requirement: Tool-call fragments preserve order and association

**Reason**：fragment 归一化是统一流式调用结果的一部分，不再由 legacy stream spec 重复定义。

**Migration**：目标行为迁入 `model-invocation-contract` 的“流式输出只暴露完整的 provider-neutral 事实”。

### Requirement: Streaming converges to the same terminal result contract

**Reason**：流式和非流式共享终态、best-effort usage 与失败终态属于统一模型调用契约。

**Migration**：目标行为迁入 `model-invocation-contract` 的“Non-streaming and streaming invocation share one terminal result contract”和“成功调用尽量保留 provider usage”。
