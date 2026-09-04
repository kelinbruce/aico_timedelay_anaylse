## 背景和现状（Context）

本 change 关注如何把 `@openrouter/ai-sdk-provider@2.9.0` stream part / provider-native stream 归一化为 provider-neutral 的 `ModelStreamDelta`，并在结束时统一收敛为 `ModelFinalResult`。

## 黑盒目标（Blackbox Goal）

在 `stream(request, signal)` 路径上，把 `@openrouter/ai-sdk-provider@2.9.0` stream part / provider-native stream 归一化为 `ModelStreamDelta`，完整 tool call 一旦可判定就尽快通过 `ModelStreamDelta.toolCall` 暴露，并在结束时统一收敛为 `ModelFinalResult`。

同时通过引入成熟的 `@openrouter/ai-sdk-provider@2.9.0` stream abstraction，减少 `agent-model` 自研 provider stream parsing、tool-call fragment handling 和 provider-specific branching 代码量，降低 provider-native chunk 处理错误概率，并让后续更多 provider 通过 OpenRouter-backed 内部 adapter 映射接入，而不改变 public `ModelStreamDelta` / `ModelFinalResult` contract。

## 边界（Boundary）

- 负责：`@openrouter/ai-sdk-provider@2.9.0` stream part / chunk 分类、tool-call fragment 归属、partial aggregate、完整 tool call delta 暴露、terminal result 收敛
- 不负责：平行的公共调用协议、SSE/WS envelope、runtime timeline、UI 分片协议
- 不负责：重新定义 `ModelInvocationRequest`、模型调用触发时机、调用前置条件、fallback policy 或 provider adapter 选择规则；这些由相邻 change 或既有 contract 承接
- owner：`agent-model` 主责

## 相邻 Change 关系（Adjacent Change Relationship）

`add-ts-model-invocation-contract` 定义模型调用公共契约：调用何时发生、调用前必须满足什么条件、provider adapter 如何接收 raw response / raw stream，以及 `complete()` 和 `stream()` 如何共享 `ModelFinalResult` 终态。

本 change 定义 `stream()` 路径内部的归一化行为：`@openrouter/ai-sdk-provider@2.9.0` stream part / provider-native raw stream chunk 如何分类成现有字段型 `ModelStreamDelta`，tool-call fragment 如何在 `agent-model` 内部保序和关联，完整 tool call 何时通过 `ModelStreamDelta.toolCall` 尽快暴露，partial aggregate 如何维护，以及 completion / failure 如何形成唯一 `ModelFinalResult`。

因此，本 change 可以依赖 invocation contract 提供的 `ModelInvocationRequest`、`ModelStreamDelta` 和 `ModelFinalResult` 边界，但不得修改调用生命周期、请求字段、fallback 选择、runtime timeline 或 channel stream envelope。

## 输入输出（Inputs / Outputs）

输入：

- `@openrouter/ai-sdk-provider@2.9.0` stream parts or provider-native stream chunks
- 当前 invocation identity
- 内部 partial aggregate

输出：

- `ModelStreamDelta` 序列
- 最终输出一个 `ModelFinalResult`

## 核心实现策略（Core Implementation Strategy）

- provider adapter 在内部接收 raw stream，不把 raw chunk 暴露给上层。
- stream normalizer 逐 part / chunk 分类为 reasoning、content、tool-call completion 或 safe failure 等现有 `ModelStreamDelta` 增量事实。
- TS 首版 provider 组件选型固定为 `@openrouter/ai-sdk-provider@2.9.0`，并继续使用 `ai@^6.0.195` runtime API；该 `ai` 版本满足 OpenRouter provider 的 `ai@^6.0.0` peer dependency。该组件暴露的 AI SDK stream part vocabulary 是本 change 的映射基线，后续升级只能在 `agent-model` adapter / normalizer 内部重映射，不得改变 public `ModelStreamDelta` / `ModelFinalResult` 语义。
- normalizer 应优先复用 `@openrouter/ai-sdk-provider@2.9.0` 已稳定抽象出的 stream part，而不是为每个 upstream provider 重写 provider-native chunk parser；仅在 OpenRouter AI SDK provider abstraction 无法表达目标语义时，才允许在 `agent-model` 内部补充最小 adapter 映射。
- `@openrouter/ai-sdk-provider@2.9.0` stream parts 到 NextAgent 的目标映射如下：
  - Core `text` 或 UI `text-delta` / provider content delta -> `ModelStreamDelta.content`
  - Core `reasoning` 或 UI `reasoning-delta` / provider reasoning delta -> `ModelStreamDelta.reasoning`
  - Core `tool-call-streaming-start` / `tool-call-delta`、UI `tool-input-start` / `tool-input-delta` 或 provider 等价 function-call fragment -> 内部 tool-call partial aggregate；不得直接暴露 fragment
  - Core `tool-call`、UI `tool-input-available`，或由 fragment 聚合并能成功解析为 `{ toolCallId, capabilityId, arguments }` 的时刻 -> 立即产出一个 `ModelStreamDelta.toolCall`
  - start / finish / start-step / finish-step / usage / response metadata -> 更新内部 terminal aggregate；不得单独产出 terminal delta kind
  - error / malformed part / unparseable tool arguments -> 收敛为带 `safeError` 的 `ModelFinalResult`
- tool-call fragment 在 `agent-model` 内部保序聚合；每个 tool call 一旦具备 stable id、capability id 和可解析 JSON arguments，就必须尽快通过 `ModelStreamDelta.toolCall` 暴露完整结构化调用，不等待整个 stream 结束。终态 `ModelFinalResult.toolCalls` 仍必须包含本次流中所有已归一化的完整结构化调用。
- normalizer 在内部维护 partial aggregate，并在 completion 或 failure 边界形成唯一终态。
- 流式失败最终也以统一终态暴露，而不是把 transport 事件当作业务终态。

## 关键约束（Key Constraints）

- 流式调用模式必须输出有序 `ModelStreamDelta` 增量事实，并以一个 `ModelFinalResult` 收敛终态
- `ModelStreamDelta` 必须是 provider-neutral 语义，不能透传 raw chunk
- 当前不修改 `agent-contracts/model`，因此 `ModelStreamDelta` 使用现有 `content?`、`reasoning?`、`toolCall?`、`safeError?` 字段形状，不新增 `kind` discriminator
- tool-call fragment 必须在 `agent-model` 内部保留顺序与关联；TS 首版不新增 public fragment vocabulary，但必须复用现有 `ModelStreamDelta.toolCall` 字段尽快输出完整结构化调用，不把 provider-native fragment 重组责任丢给上游
- `ModelStreamDelta.toolCall` 只能承载完整 `ModelToolCall`，不得承载 partial arguments、provider raw function-call payload、AI SDK raw part 或 AI SDK-specific tool state
- stream 过程可有多个 delta，但终态只能有一个 `ModelFinalResult`
- 终态只能由 `ModelFinalResult` 表达，不能把 terminal 语义再扩展成公共 delta kind
- transport close 或 provider sentinel 不能替代终态结果
- locale 语义关联通过 `ModelInvocationRequest`、request context 和 runtime-owned timeline 关联保留，不重复扩展 delta / terminal DTO

## 关键业务流程（Key Flow）

1. provider adapter 接收 provider-native stream
2. normalizer 对每个 chunk 做语义分类
3. 输出现有 `ModelStreamDelta.content` / `ModelStreamDelta.reasoning` 增量事实
4. 内部维护 content、reasoning 和 tool-call partial aggregate
5. tool-call partial aggregate 形成完整结构化调用时，立即输出一个 `ModelStreamDelta.toolCall`
6. 成功时收敛为一个包含完整 `toolCalls` 集合的 `ModelFinalResult`
7. 失败时收敛为带 `safeError` 的 `ModelFinalResult`

## 典型用例（Typical Use Cases）

- 聊天模型按 token 连续输出回答内容。上游看到的是连续 `content` delta，最后收敛为一个完整的 `ModelFinalResult`。
- 模型在流式过程中逐步构造工具调用参数。normalizer 在内部聚合 provider fragment，完整调用一旦可解析就输出 `ModelStreamDelta.toolCall`，并在终态结果中保留完整的结构化 `toolCalls`。
- provider 在流式中途返回 malformed chunk。normalizer 不把原始异常直接上抛，而是收敛为带 `safeError` 的失败 `ModelFinalResult`。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---------|---------|---------|
| 安全 | Provider-native raw chunk 不越过 `agent-model` 边界；malformed chunk 收敛为 safe error 不暴露 raw exception | 架构测试验证 raw chunk 不泄漏；contract 测试验证 error 收敛 |
| 性能/容量 | Tool-call fragment 尽快暴露完整调用，不等待 stream 结束；partial aggregate 内存有界 | Contract 测试验证 tool-call 及时暴露；unit 测试验证 aggregate 边界 |
| 可靠性/恢复 | Stream 失败统一收敛为 `ModelFinalResult.safeError`；transport close 不替代终态 | Contract 测试验证 failure 收敛；integration 测试验证 transport 边界 |
| 可维护性 | Stream normalizer 隔离 provider-specific chunk 分类；`ModelStreamDelta` 保持 provider-neutral | 架构测试验证 normalizer 隔离；code review 检查 delta 语义 |
| 可扩展性 | `@openrouter/ai-sdk-provider@2.9.0` 承担成熟 provider stream abstraction，新增 provider 优先通过 OpenRouter-backed 内部 adapter 映射接入，不扩展 public stream contract | Contract 测试验证 public delta 不随 provider 变化；code review 检查 provider-specific 分支不外泄 |
| 可测试性 | Normalizer 可独立测试；chunk 分类和 tool-call 聚合可分别验证 | Unit 测试覆盖 chunk 分类；contract 测试覆盖 tool-call 聚合 |
| 审计/可追溯性 | `ModelFinalResult` 包含完整 `toolCalls` 集合和 `usage`；`finishReason` 使用 provider-neutral vocabulary | Contract 测试验证 audit 字段；integration 测试验证 usage 统计 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|------|------|---------|
| `ModelStreamDelta` 必须是 provider-neutral 语义 | T1.1, T1.2 | `packages/agent-model/tests/stream-delta-neutrality.test.ts` |
| Tool-call fragment 在 `agent-model` 内部保序聚合 | T2.1, T2.2 | `packages/agent-model/tests/tool-call-aggregation.test.ts` |
| 完整 tool call 一旦可判定就通过 `ModelStreamDelta.toolCall` 暴露 | T3.1 | Contract 测试验证 tool-call 及时暴露 |
| Stream 失败收敛为带 `safeError` 的 `ModelFinalResult` | T4.1, T4.2 | Contract 测试验证 failure 收敛 |
| Provider-native raw chunk 不越过 `agent-model` 边界 | T5.1 | 架构测试验证 no raw chunk leakage |
| 终态只能有一个 `ModelFinalResult` | T6.1 | Contract 测试验证 terminal uniqueness |

## 文档承载决策（Documentation Ownership）

归档前需更新以下稳定文档：

- `openspec/specs/model-stream-normalization/spec.md`（新增）：定义 stream chunk 分类规则、tool-call fragment 聚合策略、partial aggregate 维护、failure 收敛语义
- `openspec/designs/architecture/model-routing-and-provider-adapter.md`（修改）：补充 stream normalizer 职责和 provider adapter 内部边界
- `openspec/designs/modules/agent-model.md`（修改）：补充 stream normalization 能力、chunk 分类策略、tool-call aggregate 机制
- `openspec/designs/spec-to-design-map.md`（更新）：添加 spec 到 design 的导航链接

## 风险与取舍（Risks / Trade-offs）

- [风险] OpenRouter AI SDK provider stream part vocabulary 变化可能破坏 chunk 分类规则 -> TS 首版固定 `@openrouter/ai-sdk-provider@2.9.0` 作为映射基线，通过 provider adapter 隔离 SDK 细节；升级时只改 adapter / normalizer 内部映射，不改变 public stream contract
- [风险] Tool-call fragment 聚合可能因 provider 乱序或丢失 fragment 而卡住 -> Partial aggregate 必须有 timeout 或 stream-end cleanup；未完成的 aggregate 走 safe error 路径
- [取舍] 当前不新增 `kind` discriminator 字段，使用现有 `ModelStreamDelta` 字段形状 -> 接受字段可选性带来的隐式类型判断，因为修改 contract 影响范围过大；长期可审视是否需要显式 kind
- [取舍] Tool-call 尽快暴露可能增加上游处理复杂度 -> 接受上游需要处理增量 tool-call，因为等待 stream 结束会增加延迟并破坏 tool-call 的及时处理语义

## 归档前更新基线（Baseline Promotion Plan）

归档前需将以下规格提升为稳定基线：

- 新增 `openspec/specs/model-stream-normalization/spec.md`：定义 stream chunk 分类、tool-call fragment 聚合、partial aggregate 维护、failure 收敛规则
- 更新 `openspec/designs/architecture/model-routing-and-provider-adapter.md`：补充 stream normalizer 职责和 provider adapter 内部边界
- 更新 `openspec/designs/modules/agent-model.md`：补充 stream normalization 能力、chunk 分类策略、tool-call aggregate 机制
- 更新 `openspec/designs/spec-to-design-map.md`：添加 spec 到 design 的导航链接
