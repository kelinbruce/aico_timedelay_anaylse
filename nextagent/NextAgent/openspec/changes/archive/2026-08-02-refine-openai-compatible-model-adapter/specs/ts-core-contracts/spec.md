## REMOVED Requirements

### Requirement: Configuration And Secret Reference Baseline

**Reason**：原 Requirement 混合模型目录、secret reference、gateway 和 Capability provider 四类 Function 行为。

**Migration**：模型配置行为迁入 `model-invocation-contract`；secret、Gateway 与 Capability provider 行为分别迁入 `secret-configuration-boundary`、`gateway-configuration` 和 `capability-source-configuration` 的目标 Requirements。secret reference grammar、最底层 encrypted-envelope 处理和独立 key source 行为原样迁移，本 change 不修改 Secret 逻辑或新增 ENC 支持。

### Requirement: Context And Model Contract Baseline

**Reason**：原 Requirement 混合 Context Engine 黑盒契约、模型调用契约及 active-context transaction/CAS 等白盒实现。

**Migration**：模型调用行为迁入 `model-invocation-contract`；context 选择、预算与 render 行为迁入 `context-engine`；未变化的 history、active-context 和 compression 黑盒行为继续由 `context-engine` stable spec 既有 Requirements 承载；transaction、CAS 和内部调用链只保留在 design。

### Requirement: Model invocation requests carry trusted run coordinates for provider correlation

**Reason**：可信 invocation scope 属于模型调用请求的安全前置条件；原 Requirement 把 run coordinates 与 provider correlation 绑定在各 adapter，未定义 background 无真实 run 的 shape、统一 operation identity 或集中 header owner。

**Migration**：目标行为迁入 `model-invocation-contract` 的“Invocation scope represents real lifecycle coordinates”和“模型 transport 通过可选 Gateway fetch 装配”。`ModelInvocationScope` 使用单一 closed object，required `operationId` 分别由 run-bound `stepId` 或 background cycle/post-terminal identity 同值映射；`sessionId/requestId/runId` 只作为 all-or-none 的可选真实关联坐标。Owner/Agent/run coordinates 可用于内部授权与诊断，`operationId` 只用于 correlation/observability/audit，不参与推理、选择、routing、授权、幂等或 retry。模型调用边界为 outbound model HTTP request 集中生成固定的 `X-NextAgent-Agent-Id`、`X-NextAgent-Session-Id`、`X-NextAgent-Request-Id`、`X-NextAgent-Run-Id` correlation header 集合：Agent header 始终使用可信 raw `agentId`，后三个只在完整 run coordinates 存在时一起生成。本 change 不定义额外 header policy。

### Requirement: Capability Context Patch Supports Governed Model Selection

**Reason**：原 Requirement 同时承载 Capability result 的模型 patch vocabulary、模型选择治理和 Context Assembly owner-scope 输入，且继续使用不唯一的 `contextPatch.modelName`。

**Migration**：Capability result 的 request-local patch 行为迁入 `capability-catalog` 的“Executors Return Results Without Owning Runtime Side Effects”，字段原子替换为 `modelId`，`modelOptions` 收敛为八字段 closed schema，其中 `providerOptions` 只接受受治理 Skill metadata 来源；模型选择消费和 required trusted `ContextAssemblyRequest.identityContext` 迁入 `context-engine`。`modelName` 不保留 alias。
