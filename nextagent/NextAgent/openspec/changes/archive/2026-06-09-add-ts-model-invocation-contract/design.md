## 背景和现状（Context）

本 change 关注 `ModelInvocationRequest`、`ModelInvocationService` 和 `ModelFinalResult` 在请求执行主流程中的长期目标语义。当前代码中的契约可以打通最小流程，但本 change 不应把过渡字段形状原样固化为终态。

## 黑盒目标（Blackbox Goal）

调用方提供完整 `ModelInvocationRequest` 后，`agent-model` 通过内部 provider adapter 执行一次模型调用，将 provider-native 接口、响应和失败转换为标准 `ModelFinalResult`；流式路径只暴露 provider-neutral `ModelStreamDelta` 并以同一终态收敛。同时审视当前请求字段、终态字段和 provider adapter 输入是否需要 contract refinement。

## 边界（Boundary）

- 负责：调用触发位置、前置条件、执行顺序、终态语义、stream 与 complete 的一致性
- 负责：审视最小流程契约是否适合作为长期 contract，并标记需要 refinement 的字段
- 负责：`agent-model` 内部 provider adapter capability 的落地边界，以及 provider-native 接口到标准 invocation / stream 结果边界的转换职责
- 不负责：定义 provider error taxonomy、定义 fallback policy、定义 channel/runtime stream 协议
- 不负责：定义 provider-native stream chunk 分类、tool-call fragment 拼接、malformed chunk 的流式归一化规则；这些由 `add-ts-model-stream-normalization` 承接
- 不负责：定义 provider/model failure 分类、脱敏、unknown error normalization 或跨边界 `SafeError` 输出规则；这些由 `add-ts-provider-error-safe-mapping` 承接
- owner：`agent-model`

## 相邻 Change 关系（Adjacent Change Relationship）

`add-ts-model-invocation-contract` 是模型调用公共契约。它定义一次模型调用如何进入执行主流程、调用前必须满足哪些条件、`complete()` 和 `stream()` 如何共享同一个 `ModelFinalResult` 终态，以及 provider adapter 如何把 provider-native access、raw response、raw failure 和 raw stream 转换或交给内部归一化边界。

`add-ts-model-stream-normalization` 是 `stream()` 路径的独立归一化行为。它定义 raw stream chunk 或 AI SDK raw-part abstraction 如何变成现有字段型 `ModelStreamDelta`，tool-call fragment 如何在 `agent-model` 内部保持顺序与关联、在完整调用可判定时通过 `ModelStreamDelta.toolCall` 暴露并最终保留到 terminal `toolCalls`，以及流式失败如何收敛为带 `safeError` 的 `ModelFinalResult`。

`add-ts-provider-error-safe-mapping` 是 provider/model failure 的安全映射行为。它定义 provider invocation failure、stream failure、normalization failure 和 unknown exception 如何归入 `AgentError` / `SafeError`，以及 raw provider detail 如何在跨边界前被裁剪。

因此，本 change 可以引用 `ModelStreamDelta` 的存在、统一终态关系和 `ModelFinalResult.safeError` 失败出口，但不得展开 stream delta vocabulary、chunk-level normalization rules、provider error taxonomy、redaction rules 或 fallback / observability 的安全消费规则。若审视结论要求修改 `agent-contracts/model` 字段，必须作为本 change 的 contract refinement 明确记录评审结论、影响范围和迁移边界后再实施。

## 输入输出（Inputs / Outputs）

输入：

- `requestId`
- `stepId`
- `locale`
- `providerKind`
- `modelName`
- `baseUrl`
- `credentialRef`
- `messages`
- `tools`
- `temperature`
- `maxTokens`
- `topP`
- `thinking`
- `providerOptions`
- `timeoutMs`

输出：

- `ModelFinalResult`
- 流式场景下输出有序的 `ModelStreamDelta` 增量事实，并以 `ModelFinalResult` 收敛终态
- provider adapter 内部中间产物：provider-native raw response、raw failure、raw stream 或 AI SDK raw part；这些中间产物不得越过 `agent-model` 公共边界

## 核心实现策略（Core Implementation Strategy）

- 上游先把 provider 身份与访问输入解析完整，再进入 `agent-model`。
- `agent-model` 内部按 provider 身份选择 provider adapter，并由 adapter 负责把 provider-native request/response/failure 转换为标准 invocation 结果边界。
- TS 首版 OpenRouter-backed adapter 使用 `@openrouter/ai-sdk-provider@2.9.0` 发起 provider 访问；这是 `agent-model` provider adapter 的内部实现选择，不新增 public contract，也不改变 invocation、stream normalization、safe mapping 或 fallback owner。
- AI SDK 类型、client、raw part、raw error 和 provider-native option shape 不得进入 `agent-contracts`、`agent-core`、`agent-runtime` 或 channel。
- AI SDK alignment policy：contracts 可以镜像经评审且 provider-neutral 的 AI SDK 稳定语义，例如 text/reasoning 输出、usage、finish reason vocabulary 和 tool-call completion；contracts 不得 import、暴露或承诺兼容 AI SDK DTO、stream part union、providerOptions wire shape、provider error、client object 或 provider-specific metadata。所有 AI SDK 到 NextAgent contract 的转换由 `agent-model` adapter 负责。
- TS 首版目标态的 `complete()` 必须调用 provider / AI SDK 原生 non-stream 接口，并在 invocation 边界内规整为统一 `ModelFinalResult`；不得通过聚合 `stream()` 实现。
- 流式原始结果交给 stream normalization 边界，再收敛为统一终态。
- provider 失败统一交给 safe mapping，再以失败终态暴露。

## AI SDK 对齐策略（AI SDK Alignment Policy）

本 change 采用“语义对齐、契约自有”的原则：

| 字段类别 | 策略 | 说明 |
|---|---|---|
| `content` / `reasoning` / `usage` / `providerResponseId` / `providerModelId` | 可高度语义对齐 AI SDK | 这些字段已经是 provider-neutral 输出事实，adapter 只做安全映射 |
| `ModelFinishReason` | 可对齐 AI SDK 稳定 vocabulary，但由 NextAgent 自定义枚举 | 不 import AI SDK `FinishReason` type，不透传 raw provider finish reason |
| `ModelCommonOptions` | 可吸收稳定 common option 语义 | temperature、max output tokens、topP、thinking 等作为 NextAgent-owned common option |
| adapter-owned `ModelProviderOptions` | 可定义经评审的 OpenRouter AI SDK provider-compatible subset | 只暴露 NextAgent schema / allowlist，不暴露 AI SDK providerOptions wire shape |
| `ModelMessage` / `ModelToolDescriptor` | 字段设计可参考 AI SDK 能力，但不得使用 AI SDK DTO | provider-neutral message/tool contract 由 `agent-model` adapter 映射到 AI SDK |
| `ModelStreamDelta` | 保持 NextAgent provider-neutral stream facts | 不暴露 AI SDK stream part union；必要时后续另行审视 NextAgent-owned discriminator |
| `providerKind` / `credentialRef` / `baseUrl` / `safeError` / `locale` / `requestId` / `stepId` | 必须保持 NextAgent 语义 | 这些字段承载 routing、安全、owner scope、诊断和 request lifecycle，不与 AI SDK 绑定 |

如果 AI SDK 后续版本改变 DTO 或 wire option shape，只允许修改 `agent-model` adapter / normalizer 内部映射；不得要求 `agent-core`、`agent-runtime`、channel 或 public contracts 跟随 SDK 类型变化。

## Contract Refinement Review Points

当前 `agent-contracts/model` 可以支撑最小流程，但以下字段不得未经审视直接作为长期终态；本 change 将 `finishReason`、`providerOptions`、`messages` / `tools` 收敛为明确 contract refinement 目标，但仍需通过后续 task 验证后才能落地到 `agent-contracts`：

1. `providerKind`：当前字段同时暗示 provider family、adapter selection 和部署接入形态。长期 contract 需要决定是否拆分为稳定 provider family / adapter kind / profile or route selection，避免 runtime、core 或 app composition 误用该字段做多层路由。
2. `finishReason`：当前 `ModelFinalResult.finishReason?: string` 易把 provider raw finish reason 泄漏给上游。目标 refinement 是新增 provider-neutral `ModelFinishReason` 稳定枚举，并将 `ModelFinalResult.finishReason?: string` 替换为 `ModelFinalResult.finishReason?: ModelFinishReason`。首版 vocabulary 至少覆盖 `stop`、`length`、`tool-calls`、`content-filter`、`error`、`unknown`；raw provider finish reason 只允许停留在 `agent-model` 内部诊断或 safe mapping 边界。
3. `providerOptions`：当前 `providerOptions: JsonObject` 能快速打通 provider-specific wire options，但长期风险是 raw AI SDK / provider option 形状泄漏到公共 contract。目标 refinement 是引入 provider-neutral `ModelCommonOptions` 和 adapter-owned `ModelProviderOptions` schema / allowlist：跨 provider 稳定选项必须提升为 common option；provider-specific options 必须按 provider family / adapter kind 挂在受控 namespace 下，并由 `agent-model` adapter 在 provider execution 前做 runtime schema validation。AI SDK `providerOptions` wire shape 不得进入 `agent-contracts`、`agent-core`、`agent-runtime` 或 channel。
4. `messages` / `tools`：当前 `ChatMessage.content: string`、`toolCallId?` 和 `tools: JsonObject[]` 只作为最小流程基线。目标 refinement 是引入 provider-neutral `ModelMessage`、`ModelMessageContentPart` 和 `ModelToolDescriptor`：`ModelMessage` 表达 system/user/assistant/tool 角色、multi-part text/attachment-ref 内容、tool-call 与 tool-result pairing；`ModelToolDescriptor` 表达 capability id、工具名、描述和输入 schema。AI SDK `CoreMessage`、tool set、tool part 或 provider-specific tool schema 不得进入 `agent-contracts`，只能由 `agent-model` adapter 从 NextAgent contract 内部映射。
5. `complete()` 实现路径：首版目标态必须使用 provider / AI SDK 原生 non-stream 接口，并保证与 `stream()` 共享同一 `ModelFinalResult` 语义。

## 关键约束（Key Constraints）

- 不得弱化稳定 `ModelInvocationRequest` 所需语义；当前字段形状只是最小流程基线，长期字段是否调整必须经 contract refinement 评审
- 调用前必须完成 identity、provider/model/access、messages、预算、取消状态校验
- `complete()` 与 `stream()` 都是正式模型步骤，不是后台副作用
- 所有终态必须收敛到 `ModelFinalResult`
- `ModelFinalResult.finishReason` 不得透传 raw provider finish reason；在 stable vocabulary 确认前，adapter 必须只输出经过归一化的安全值
- `providerOptions` contract refinement 落地前，现有 `JsonObject` 必须在 provider execution 前按 adapter-owned schema / allowlist 校验；落地后，public request 仍不得暴露 AI SDK provider option DTO 或 raw provider wire option shape
- `messages` / `tools` contract refinement 落地前，AI SDK message/tool 类型不得外泄到 `agent-contracts`、`agent-core`、`agent-runtime` 或 channel；落地后仍必须由 `agent-model` adapter 负责从 provider-neutral contract 映射到 AI SDK
- `agent-model` 在 invocation 边界内不得自行切换 profile
- provider-native raw content / raw chunk 只允许停留在 `agent-model` 内部 provider adapter 与 normalization 边界，不得直接上浮给 `agent-core`、`agent-runtime` 或 channel

## ModelFinalResult 消费语义（Terminal Consumption Semantics）

`ModelFinalResult` 的三种终态通过字段组合区分，下游据此进入不同消费分支：

- **成功（content completion）**：`content` 非空、`finishReason` 使用 provider-neutral stable value，`toolCalls` 为空数组。下游将 `content` 作为模型回答交付给用户或进入后续处理。
- **工具调用（tool-call completion）**：`content` 可为空或非空、`finishReason` 使用 provider-neutral tool-call value、`toolCalls` 包含一个或多个结构化调用 `{ toolCallId, capabilityId, arguments }`。下游基于 `toolCalls` 进入 capability dispatch。
- **失败（safe failure）**：`content` 为空、`safeError` 包含 `{ code, message, category, retryable }`。下游基于 `safeError` 字段做 fallback 评估、observability 记录和用户提示，不得解析 raw provider exception。

`ModelFinishReason` 的目标稳定 vocabulary 为：

- `stop`：模型自然结束或 provider 表达等价完成状态
- `length`：模型因输出长度、token 或预算限制结束
- `tool-calls`：模型产出一个或多个可执行工具调用
- `content-filter`：provider 或安全策略阻断内容输出
- `error`：模型调用以 provider-neutral 错误终态结束且没有更具体安全失败分类
- `unknown`：provider 返回无法识别但已被安全归一化的终止原因

`messages` / `tools` 的目标 refinement 结构只定义 NextAgent provider-neutral 语义，不定义 AI SDK public DTO。`ModelMessageContentPart` 的首版目标至少支持 text；attachment-ref、tool-result content 和 multi-part content 作为 contract review 子项明确是否进入本 change 或延期。`ModelToolDescriptor` 必须以 capability binding 为中心，输入 schema 只能作为 provider-neutral JSON schema / TypeBox-compatible schema 进入 contract，provider-specific tool schema 由 adapter 内部映射。

`providerOptions` 的目标 refinement 结构只定义 NextAgent provider-neutral 输入边界，不定义 AI SDK public DTO。`ModelCommonOptions` 承载跨 provider 稳定选项；adapter-owned `ModelProviderOptions` schema / allowlist 承载 provider-specific option，并必须满足：

- provider-specific options 按 provider family / adapter kind 使用受控 namespace，例如 OpenRouter-backed options 只能进入对应 adapter namespace
- 未声明 option、未知 namespace、错误类型、raw AI SDK object、function、class instance 或 credential-like value 必须在 provider execution 前失败
- adapter 只能把 allowlist 后的 provider option 映射为 AI SDK `providerOptions` wire shape，不得把 AI SDK wire shape 作为 public request contract
- validation failure 必须返回安全失败或启动/调用边界错误，不得把 raw option value、credential、路径或 provider-native error 暴露给上游

## Provider Adapter Capability（Internal Capability）

`model-provider-adapter` 是 `agent-model` 内部的落地能力，负责把稳定的 `ModelInvocationRequest` 转换为 provider-specific access，并把 provider-native 接口结果转换为标准 invocation / stream 结果边界。

其职责固定为：

1. TS 首版 baseline 根据当前 `providerKind` 选择内部 provider adapter；长期按 provider identity refinement 结论执行
2. 将 `ModelInvocationRequest` 映射为 provider-specific request
3. 发起 provider 调用；TS 首版 OpenRouter-backed adapter 使用 provider / AI SDK 原生 non-stream 接口实现 `complete()`，使用流式接口实现 `stream()`
4. 通过 `@openrouter/ai-sdk-provider@2.9.0` 在 adapter 内部发起访问；`credentialRef` 仍由安全 resolver 解析为 raw credential，AI SDK fetch/client/options 只允许停留在 `agent-model`
5. 在内部接收 provider-native raw content、raw tool-call payload、raw stream chunk 或 AI SDK raw-part abstraction
6. provider-native 非流式结果必须由 adapter 交给 invocation result 规整边界，转换为统一 `ModelFinalResult`，不能绕过统一终态
7. 将流式原始 chunk 交给 stream normalization 边界
8. 将 provider-native failure 交给 error safe mapping 边界

这部分能力是 `agent-model` 内部实现能力，不是新的对外 public contract。

## 关键业务流程（Key Flow）

1. 上游完成 context render 与 profile/provider 解析
2. 调用方构造完整 `ModelInvocationRequest`
3. invocation boundary 校验 identity、messages、预算、取消状态
4. `agent-model` 内部 provider adapter 按当前 `providerKind` 或 refinement 后 provider identity 发起 raw provider 访问
5. 非流式 raw response 交给 invocation result 规整并转换为 `ModelFinalResult`；流式 raw chunk 或 AI SDK raw part 交给 stream normalization
6. 在执行过程中保持 locale 语义关联，并将 provider 响应收敛为统一 `ModelFinalResult`
7. 若失败，则通过 `safeError` 暴露终态失败

## TS 首版闭环与遗留事项（TS First-Release Closure and Deferred Work）

本 change 的 TS 首版闭环范围：

- profile `timeoutMs` 必须与上层 cancellation signal 合并，并实际约束 provider fetch 与 stream 读取。
- message、tools 和 `providerOptions` 必须在 provider execution 前完成 runtime shape validation；长期还必须完成 common option / provider-specific option 边界审视。
- `locale` 通过 `ModelInvocationRequest`、request context 和 runtime-owned timeline 的 `requestContextId` 关联保留，不重复扩展 delta / terminal DTO。
- `providerKind` 首版只执行 OpenRouter-backed `OPENAI` adapter；其他 kind fail closed 为安全失败，不做隐式 fallback。

明确延期：

- `thinking` 的 provider-specific wire mapping。OpenRouter-backed 首版不发明非标准 wire 字段。
- provider-native non-stream implementation。首版目标态的 `complete()` 使用原生 non-stream 调用，并与 `stream()` 保持相同公共终态语义。

## 典型用例（Typical Use Cases）

- 用户发起“总结这段告警日志”的普通问答请求。上游完成 rendered messages 和 provider 解析后，`agent-model` 执行一次 `complete()`，返回包含 `content` 的 `ModelFinalResult`。
- 用户请求“调用网络诊断工具定位基站异常”。模型调用返回带 `toolCalls` 的 `ModelFinalResult`，下游基于统一终态进入 capability dispatch，而不是解析 provider 原始 JSON。
- 请求在进入 provider 调用前已经超出预算。invocation boundary 直接拒绝执行，不发起外部 provider 调用。
- `agent-model` 内部 provider adapter 收到 provider-native 流式 chunk 或 AI SDK raw-part abstraction。该 raw input 不直接暴露给上游，而是先交给 stream normalization，最终由上游只看到 `ModelStreamDelta` 和 `ModelFinalResult`。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | `credentialRef` 由安全 resolver 解析，raw credential 不进入 `agent-contracts`；provider-native raw content 不得越过 `agent-model` 边界 | contract test: credential boundary |
| 性能/容量 | `timeoutMs` 必须与上层 cancellation signal 合并约束 provider fetch 和 stream 读取 | integration test: timeout enforcement |
| 可靠性/恢复 | 所有终态收敛到 `ModelFinalResult`，失败通过 `safeError` 暴露；`complete()` 与 `stream()` 共享统一终态语义 | contract test: terminal state convergence |
| 可维护性 | `agent-model` 内部按 provider identity 选择 adapter，AI SDK 类型不进入公共 contract | architecture test: no SDK type leakage |
| 可测试性 | invocation boundary 校验 identity、messages、预算、取消状态；provider-native 非流式结果必须交给统一规整边界 | integration test: boundary validation |
| 审计/可追溯性 | `ModelFinalResult` 包含 `modelId`、`usage`、`responseId?`；`finishReason` 使用 provider-neutral stable vocabulary | contract test: audit field coverage |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `ModelInvocationRequest` 完整字段校验 | T1.1, T1.2 | `packages/agent-model/tests/invocation-request-validation.test.ts` |
| `complete()` 与 `stream()` 共享 `ModelFinalResult` 终态 | T2.1, T2.2 | `packages/agent-model/tests/terminal-state-convergence.test.ts` |
| provider-native raw content 不越过 `agent-model` 边界 | T3.1 | architecture test: no raw provider type leakage |
| `finishReason` 使用 provider-neutral stable vocabulary | T4.1 | contract test: finish reason vocabulary |
| `ModelFinishReason` 替换 free-form string | T4.2 | contract test: no raw finish reason string |
| `messages` / `tools` 使用 provider-neutral target contract | T4.3 | contract test: no AI SDK DTO leakage in contracts |
| `providerOptions` 使用 adapter-owned schema / allowlist | T4.4 | contract test: no raw AI SDK providerOptions in public contract |
| `credentialRef` 安全解析 | T5.1 | integration test: credential resolver boundary |
| `timeoutMs` 与 cancellation signal 合并 | T6.1 | integration test: timeout and cancellation enforcement |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/model-invocation-contract/spec.md`（新增）
- 跨模块设计：`openspec/designs/architecture/model-routing-and-provider-adapter.md`（修改）
- 模块设计：`openspec/designs/modules/agent-model.md`（修改）
- 导航：`openspec/designs/spec-to-design-map.md`（更新）

## 风险与取舍（Risks / Trade-offs）

- [风险] provider-native non-stream 与 stream 结果细节可能存在差异。-> 通过统一 `ModelFinalResult` 归一化与一致性测试约束公共终态语义。
- [风险] `providerKind` 字段同时暗示多层路由，长期需 refinement。-> 首版只执行 `OPENAI` adapter，其他 kind fail closed；长期 contract refinement 审视拆分策略。
- [风险] `providerOptions` 作为 `JsonObject` 可能泄漏 provider-specific wire options。-> 将 providerOptions 收敛为 `ModelCommonOptions` + adapter-owned schema / allowlist refinement；首版至少执行 runtime shape validation，长期禁止 AI SDK providerOptions wire shape 进入 public contract。

## 归档前更新基线（Baseline Promotion Plan）

- 新增 `openspec/specs/model-invocation-contract/spec.md`
- 更新 `openspec/designs/architecture/model-routing-and-provider-adapter.md`
- 更新 `openspec/designs/modules/agent-model.md`
- 更新 `openspec/designs/spec-to-design-map.md`
