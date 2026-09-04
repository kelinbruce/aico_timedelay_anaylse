# add-ts-framework-skill-compatibility

规划入口：[roadmap-v2 扩展候选](../nextagent-ts-change-roadmap-v2.md)
所属分组：Capability
对应能力：F3 AF2.0 Skill 规范支持
优先级：P2

状态：assumption-ready
类型：实施 change
主要 owner：`agent-capability`
依赖：`add-ts-skill-tool`、`add-ts-capability-core-governance`、`add-ts-skill-manifest-contract`

目标：
- 兼容 AF 1.0 定制执行逻辑，新增 `API` / `StreamingAPI` / `Recipe` / `Subagent` 四种 `CapabilityProviderKind`。
- 业务可通过 SDK/API 注册对应 provider，所有执行路径走统一 AgenticLoop + capability governance。
- AI2H 场景支持自定义 Subagent 转发函数。
- 每次调用携带可信 owner scope + agent scope，结果映射为安全结构化结果或流式事件。

规格输入：
- `CapabilityProviderKind`（`agent-common`）新增 `API`、`STREAMING_API`、`RECIPE`、`SUBAGENT` 四个值；现有 `BUNDLED`/`LOCAL_DIRECTORY`/`SKILL_HUB`/`MCP_SERVER`/`AGENT_REGISTRY`/`CUSTOM` 不变。
- `API` provider kind：业务通过 SDK 注册 adapter，返回 `CapabilityInvocationResult.structuredPayload`（安全结构化结果），不支持流式。
- `STREAMING_API` provider kind：业务通过 SDK 注册 streaming adapter，返回安全流式事件，归一化到现有 stream delta/final 格式。
- `RECIPE` provider kind：capability invocation 路由到 workflow engine（`add-ts-workflow-engine-contracts`），以 recipe name 作为 capabilityId；执行结果映射为 `CapabilityInvocationResult`。
- `SUBAGENT` provider kind：支持 AI2H 自定义转发函数，将 invocation 转发给外部 subagent handler；结果映射为 `CapabilityInvocationResult.structuredPayload`。
- 所有四种新 kind MUST 通过 `add-ts-capability-core-governance` 的统一 catalog 注册、descriptor 描述、availability 管理和 invocation boundary，不引入 bypass 路径。
- 每次调用 MUST 携带可信 `identityContext`（owner scope）和 `agentId`（agent scope），不得来自 provider 自有逻辑或客户端参数。
- provider adapter 由 app composition 注册（`providerKind=CUSTOM` 已有的注册机制），不在 `agent-capability` 内硬编码 provider 实现。
- `STREAMING_API` 的流式事件 MUST 经过 stream normalization（与 `add-ts-model-stream-normalization` 一致的 delta/final 归一化），MUST NOT 绕过 safe error mapping。
- `RECIPE` kind 的 workflow 执行 MUST 复用 workflow engine 的 lifecycle、timeout、retry 和 cancellation 语义，不在 capability 层重新实现。
- `SUBAGENT` kind 的转发函数 MUST 接收 `AbortSignal`，超时或取消时返回 safe error。

契约输入：
- `CapabilityProviderKind`（`agent-common`）：扩展 enum，新增四个值。
- `CapabilityDescriptor`（`agent-contracts/core`）：现有 `provider.providerKind` 字段消费新值，不修改 descriptor 结构。
- `CapabilityInvocationRequest` / `CapabilityInvocationResult`（`agent-contracts/core`）：现有结构，不修改；`STREAMING_API` 的流式归一化复用 `generatedMessages` 和 `structuredPayload`。
- `CapabilityProvider`（`agent-contracts/core`）：现有 `providerKind` 字段消费新值。
- provider adapter registration（`agent-app` composition）：复用 CUSTOM provider 注册机制。
- workflow engine routing（`agent-contracts/core` + `agent-workflow`）：`RECIPE` kind 的执行路径。

实现约束：
- `agent-capability` 只提供统一 governance 入口和 invocation boundary，不实现具体 provider adapter。
- provider adapter 实现归 app composition 层或业务 SDK，通过 `providerKind=CUSTOM` 的已有注册机制接入。
- `STREAMING_API` 的 stream normalization 复用 `agent-model` 的 stream normalization 逻辑或等价实现，不在 capability 层重新实现 delta 拼接。
- `RECIPE` kind 的 workflow 执行通过 `agent-core` 路由到 workflow engine，capability 层只负责声明 kind 和转发 invocation。
- `SUBAGENT` kind 的转发函数签名 MUST 在 `agent-contracts/core` 定义，app composition 注册实现。
- 新增 provider kind 不改变 `CapabilityKind`（`TOOL`/`SKILL`/`AGENT`）的定义；provider kind 描述来源/执行方式，capability kind 描述类型。

非目标：
- 不定义 AF 1.0 SDK 的完整 API surface（由业务 SDK 承载）。
- 不定义 provider adapter 的 hot reload 或动态注册。
- 不定义 `RECIPE` kind 的 recipe DSL（由 `add-ts-workflow-engine-contracts` 承载）。
- 不定义 `SUBAGENT` kind 的子 Agent 隔离执行语义（由 `add-ts-agent-tool` 和 `add-ts-invoked-agent-context-inheritance` 承载）。
- 不改变现有 `BUNDLED`/`LOCAL_DIRECTORY`/`SKILL_HUB`/`MCP_SERVER`/`AGENT_REGISTRY`/`CUSTOM` provider kind 的行为。

验收要点：
- contract test：`CapabilityProviderKind` 新增四个值的契约覆盖。
- contract test：每种新 kind 的 `CapabilityInvocationRequest` → `CapabilityInvocationResult` 映射。
- architecture test：新 kind provider 不绕过 `add-ts-capability-core-governance` 的 catalog 注册和 invocation boundary。
- security test：owner scope 和 agent scope 从 trusted context 强制，provider 自有逻辑不得覆盖。
- 验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`。

并行边界：
- 扩展 `CapabilityProviderKind`（`agent-common`）属于共享 vocabulary 变更，必须先提出 OpenSpec change 并通过 review。
- 不修改 `CapabilityDescriptor`、`CapabilityInvocationRequest`、`CapabilityInvocationResult` 的结构（只消费新 provider kind 值）。
- 不侵入 `agent-workflow` 的 engine 契约（只消费 workflow execution service port）。
- 不侵入 `agent-model` 的 provider adapter 契约。
- `add-ts-skill-tool`、`add-ts-capability-core-governance` 可并行推进，本 change 只扩展 provider kind 不修改 governance 逻辑。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
- 标为 `assumption-ready` 的条目在 proposal 阶段需显式固化默认假设（`STREAMING_API` 归一化策略、`RECIPE` 路由约定、`SUBAGENT` 转发函数签名）。
