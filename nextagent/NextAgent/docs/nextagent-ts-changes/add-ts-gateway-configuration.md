# add-ts-gateway-configuration

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Runtime Configuration

状态：active
类型：实施 change
主要 owner：gateway adapter packages、`agent-app`
依赖：`add-ts-app-config-schema`

目标：
- 支持 local/remote gateway adapter 选择和配置校验，配置覆盖 endpoint/baseUrl、credential reference、timeout/retry 和安全校验。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 补实本地运行配置、组件启停、provider 选择和 secret 边界。

共享规格输入：
- 首版产品配置的 provider kind 只支持 `OPENAI`、`MINIMAX`、`DEEPSEEK`、`QWEN`。
- fake/test provider 只用于测试、契约验证和本地受控验证，不能进入产品配置，也不能替代最小内核的真实 provider。
- Provider 配置采用稳定的 `modelProfiles[]` baseline：`profileId`、`providerKind`、`modelName`、`baseUrl`、`apiKeySource`、`timeoutMs`、`enabled`、`fallbackEligible`。
- `profileId` 必须非空且唯一。
- `providerKind` 必须是 `OPENAI`、`MINIMAX`、`DEEPSEEK`、`QWEN` 之一。
- `providerKind` 和 `modelName` 必须非空。
- 模型调用进入 `agent-model` 前必须已经解析出必填 `providerKind`；provider route 不得依赖猜测或 adapter 内部默认值。
- provider SDK、AI SDK 或平台推理网关类型不得泄漏为跨模块 public contract。
- `timeoutMs` 必须为正数。
- 至少一个 profile 必须 enabled。
- `fallbackEligible=true` 要求该 profile 同时 enabled。
- 启用的 cloud provider 必须通过 `apiKeySource` 或等价 secret reference 提供凭据，不允许 raw API key 进入日志、trace、audit、stream、safe error 或模型上下文。
- 多 profile 选择和 fallback 必须保留可诊断 selection reason。
- Capability provider configuration 只承载 provider enabled/disabled、provider location/reference、managed install/cache dir、provider credential reference、explicit disabled capability ids。
- Capability source 的优先级和冲突处理不在配置 change 中重复定义，由 capability conflict resolution 和统一 catalog governance 负责，避免配置层形成第二套解析规则。
- Gateway configuration 支持 local/remote gateway adapter selection 和配置校验；local adapter 必须可完整运行，remote adapter 保留 schema 并允许被 SkillHub、sandbox gateway 等明确需要远端能力的 change 使用。
- Gateway 配置只负责 adapter selection、endpoint/baseUrl、credential reference、timeout/retry 和安全校验。
- 上层模块只能依赖 gateway ports，不得读取具体 adapter 配置。
- 未配置或不可用的 remote dependency 返回 safe unavailable error，并产生可观测诊断，不允许无界重试；如果支持降级，必须通过显式 degradation event 或 result 表达。

并行边界：
- 配置 schema 属于 app composition 边界。
- provider SDK 或 adapter 内部字段不得泄漏为跨模块 public contract。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
