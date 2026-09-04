## REMOVED Requirements

### Requirement: Target-State TS Configuration Ownership And Agent Assembly Compilation

**Reason**：该 legacy Requirement 混合 app 配置读取、Agent assembly 编译、模型目录、模型选择、文件布局和大量私有 composition 细节。

**Migration**：模型目录与调用授权行为迁入 `model-invocation-contract`；Context Engine 模型选择迁入 `context-engine`；Agent assembly 的启动期编译、模型激活引用和 request path 不 reparse 行为迁入 `agent-package-assembly`；其他未触及 package/Capability 黑盒行为继续由对应 canonical Requirements 承载；配置 freeze、文件路径、package owner 和 compiler wiring 只保留在 design。

### Requirement: Context 和 Model 调用边界

**Reason**：该 Requirement 同时承载 Context Engine 与模型调用两个 Function，并包含 gateway transaction/CAS 和私有调用链。

**Migration**：context assembly、selection、budget 和 render 行为迁入 `context-engine`；扁平调用请求、真实 lifecycle scope 和调用模式迁入 `model-invocation-contract`；transaction、CAS 与 request-builder 路径归 design。

### Requirement: 最小真实 Model Provider

**Reason**：真实 provider、stream、tool、timeout 和安全失败是 `FN-4.1 调用模型` 的产品行为，不应继续留在最小内核 bridge spec。

**Migration**：目标行为迁入 `model-invocation-contract` 的“OpenAI-compatible 调用遵循统一 Chat Completions 语义”“流式输出只暴露完整的 provider-neutral 事实”“成功调用尽量保留 provider usage”和“Failure exits are explicit and safe”；测试 fixture 与 E2E 实现边界归 design/tasks。
