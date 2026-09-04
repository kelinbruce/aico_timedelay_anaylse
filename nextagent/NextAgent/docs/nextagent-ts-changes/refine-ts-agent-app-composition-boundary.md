# refine-ts-agent-app-composition-boundary

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Composition / Extension Refinement

状态：ready
类型：架构 refinement + 实施 change
主要 owner：`agent-app`
协作 owner：`agent-capability`、`agent-model`、`agent-context-engine`、`agent-memory`、`agent-observability`、`agent-platform-gateway-local`、`agent-runtime`、`agent-session`
依赖：`establish-ts-backend-architecture`、`add-ts-app-config-schema`、`add-ts-capability-core-governance`、`add-ts-model-provider-configuration`、`add-ts-prompt-template-assembly`、`add-ts-memory-core`、`add-ts-structured-logging`

目标：
- 收敛 `agent-app` 为 composition root：只负责配置解析与冻结、contribution registry 装配、模块 dependency injection、产品入口选择、server/plugin 注册和生命周期启动/关闭。
- 将 memory、context、observability、capability、model、gateway、health/readiness 等业务行为工厂和策略归位到 owning package，或拆成窄 composition adapter。
- 降低新增 provider/capability/业务模块时对 `agent-app` 的修改压力，避免 app composition 变成业务实现聚合包。

规格输入：
- `agent-app` SHALL 是 composition root，不拥有 request lifecycle、Agent 内 routing、context assembly semantics、model provider semantics、capability business semantics、memory extraction/aging semantics、gateway persistence semantics、observability projection semantics 或 channel transport semantics。
- `agent-app` MAY own app configuration source loading, validation orchestration, frozen config artifacts, product entrypoint selection, dependency graph construction, readiness publication wiring and lifecycle start/close.
- Owning packages MUST expose narrow factory/adapter APIs for their own behavior where composition is required. `agent-app` MUST inject already-frozen config projections, ports, registries, clocks/loggers and dependencies rather than inline business algorithms.
- Context summary generation, prompt-template model selection helpers and compaction wiring MUST be owned by `agent-context-engine` or a context-owned composition adapter; `agent-app` only supplies model invocation service, model profile selector and persistence ports.
- Memory extraction, trajectory projection, aging hooks and memory tool adapter behavior MUST be owned by `agent-memory` or a memory-owned composition adapter; `agent-app` only supplies gateway ports, identity/agent scopes, model/context ports and observability sinks.
- Capability tool/provider composition details MUST be owned by `agent-capability`; `agent-app` supplies frozen provider configs, contribution snapshots and controlled dependencies such as workspace files, sandbox, remote service call and memory tool port.
- Model provider adapter selection MUST remain inside `agent-model`; `agent-app` must not grow provider-specific request construction or adapter switches.
- Observability event shaping, projector construction and safe diagnostic mapping SHOULD be owned by `agent-observability` except for product-level sink selection and wiring.
- Gateway-local private row/entity mapping, maintenance jobs and store-specific behavior MUST remain in gateway owner packages; `agent-app` may instantiate selected gateway adapters but must not reinterpret persistence facts.
- Health probes MUST be expressed as module-owned probe factories or narrow app-level readiness checks. `agent-app` must not embed provider/capability/memory business validation beyond dependency wiring and frozen config readiness.
- Product entrypoints MAY choose different dependency graphs, but optional feature inclusion must be explicit through entrypoint/profile/manifest, not by runtime directory probing or broad `if` branches that import every optional package.
- Refactoring MUST preserve existing public runtime, channel, model, capability, gateway, session and observability contracts unless an explicit contract refinement is included.

契约输入：
- `establish-ts-backend-architecture` 中的 package ownership、composition root、gateway/adapter、runtime/channel/context/model/capability/observability 边界。
- `app-config-schema` 中关于 `DefaultSystemConfig` 内部性、startup-only validation/freeze 和 downstream narrow projection 的约束。
- `agent-contracts/*` public ports and DTOs；不得新增 catch-all config contract 或 generic app service contract。
- `refine-ts-extension-registration` 若已完成，本 change 应消费其 frozen contribution registry/snapshot，而不是重新定义注册机制。

实现约束：
- 优先按 owner package 抽出 factory，而不是在 `agent-app` 内创建新的 `composition/*` 大杂烩模块。
- 新 factory 的入参必须是窄依赖对象或 owner-owned options，不得接收完整 `DefaultSystemConfig`，除非该 factory 仍位于 `agent-app` 私有边界。
- Owner package 不得反向依赖 `agent-app`；跨 package 只通过 public exports、`agent-contracts` 和 `agent-common` 协作。
- 不得为了搬移代码新增第二套 model profile registry、capability provider state、config validation state、health state 或 observability event vocabulary。
- 每次 owner boundary 调整必须保持行为可回归验证；高风险区域需要 characterization tests 先固定现有黑盒行为，再调整 ownership。
- 删除或移动 `agent-app` 代码时，只清理本 change 触达产生的 dead code，不做无关重构。

非目标：
- 不改变 request lifecycle、scheduler、same-session lane、cancellation、checkpoint、terminal commit、canonical timeline 或 stream projection。
- 不改变 Agent Scope / Owner Scope 固化规则。
- 不引入 runtime plugin system、hot reload、dynamic DI container、service locator 或全局 mutable registry。
- 不重新设计 app config schema、model profile contract、capability catalog contract、gateway contracts 或 observability public contracts。

验收要点：
- Architecture tests 覆盖 `agent-app` 不 private-import provider SDK、gateway-local row/entity、capability implementation internals、context/memory private modules 或 frontend private paths。
- Unit/contract tests 覆盖迁出的 context summary, memory extraction/aging, capability composition, health probe and observability mapping factories 的 owner package 行为。
- Characterization tests 覆盖 owner boundary 调整前后的 startup composition、health/readiness、model selection、capability availability、memory tool availability 和 safe diagnostics 输出一致。
- Dependency-cruiser tests 覆盖 owner package 不反向依赖 `agent-app`，runtime/core/channel 不依赖 app-private composition modules。
- Build/test gate 覆盖 `npm run build`、相关 package tests、architecture lint 和 OpenSpec strict validation。
- Code size/ownership review 证明 `agent-app` 只保留 composition root、entrypoints、config、packaging/release 和 product wiring，不再承载模块业务算法。

并行边界：
- 本 change 可分阶段实施，但每个阶段必须以可验证的 owner boundary 改善为单位，不得留下双实现路径。
- 若 owner boundary 调整需要新增 public factory/port，必须明确 owner export surface；涉及 frozen contract 的修改必须拆成或包含 contract refinement。
- 与 `refine-ts-extension-registration` 并行时，extension registry 由该 change 定义，本 change 只消费其结果并收敛 `agent-app` wiring。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
