# refine-ts-extension-registration

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Composition / Extension Refinement

状态：ready
类型：架构 refinement + contract refinement 候选
主要 owner：`agent-capability`、`agent-model`、`agent-app`
协作 owner：`agent-contracts`、`agent-common`
依赖：`add-ts-builtin-tool-framework`、`add-ts-capability-source-configuration`、`add-ts-model-provider-configuration`、`add-ts-app-config-schema`

目标：
- 建立受控启动期 extension registration 机制，使 builtin capabilities、framework/reserved capability providers 和 model provider adapters 通过确定性 contribution manifest/registry 发现、校验和冻结。
- 让新增内置 capability、框架 provider 或模型 adapter 不再要求修改中心硬编码注册列表，同时保持启动可审计、可诊断、可测试和 fail-closed。
- 为二次开发者和产品集成团队提供清晰的贡献入口，但不把首版扩展机制扩大成运行时插件热加载或任意目录扫描。

规格输入：
- Extension registration SHALL 是 startup-only 机制；系统进入 ready 前必须完成 discovery、schema validation、conflict validation、safe diagnostics 和冻结快照。
- 贡献来源必须是确定性、受信任的 package export、构建期生成 manifest、显式 system config 引用或 framework-owned contribution registry；不得通过运行时递归扫描源码目录、import side effect、decorator self-registration、请求体、客户端 metadata、模型输出、SkillHub 下载内容或未授权 Agent package 路径触发注册。
- Builtin Tool / builtin capability contribution MUST 继续产出 `ToolDefinition` 或既有 capability candidate，不得创建并行 Tool invocation protocol、并行 descriptor DTO 或绕过 capability catalog/governance。
- Framework/reserved capability providers（例如 builtin、local/system/agent-owned、memory、agent discovery 等）MUST 通过 startup resource provider contributions 注册为 app-composition facts；`default-system.yaml` 和用户 `application.yaml` 不得声明 framework/reserved raw providers。
- User capability provider configuration 继续只解析用户显式配置的 provider entries；它消费已注册 adapter/support facts，不拥有 framework provider 注册机制。
- Model provider adapters MUST 由 `agent-model` 拥有 adapter registry 和 provider-specific normalization/error mapping；`agent-app` 只注入 frozen model registry / selected `ModelInvocationService`，不得按 provider kind 写业务 switch。
- 如果新增 provider kind 需要进入 public model/capability vocabulary，必须通过 contract refinement 更新 owning export surface、runtime schema、configuration validation 和 architecture tests；不得以 stringly custom escape hatch 绕过。
- Contribution id、provider id、capability id、adapter id 和 version MUST 在启动期执行唯一性与冲突检查；冲突不得静默覆盖。
- 注册失败、schema 非法、重复 id、未知 dependency、缺失 adapter 或 unsupported provider kind 必须产生 safe startup/config diagnostic；不得泄漏本地路径、raw config、credential、provider SDK error、stack trace、prompt、模型输出或工具参数。
- Frozen contribution snapshot MUST 被 downstream modules 消费；request lifecycle 不得重新扫描、重新导入或按默认 Agent/global state 重选贡献。
- Extension registration 的观测只包含低基数 reason code、contribution id、provider id、capability id、adapter id、agent id/version 等安全标识。

契约输入：
- 复用 `agent-contracts/capability` 的 `CapabilityProvider`、`CapabilityProviderConfig`、`CapabilityDescriptor`、catalog/discovery/invocation 边界。
- 复用 `agent-contracts/model` 的 `ModelInvocationService`、provider-neutral request/result/stream contracts。
- 复用 `agent-common` 的 provider/capability/model vocabulary；新增 durable vocabulary 前必须判断是否归 `agent-common` 或具体 `agent-contracts/*` subpath。
- App composition 私有的 contribution manifest/schema 可以先留在 owning implementation package；只有跨 package public consumer 必需时才提升为 public contract。

实现约束：
- `agent-capability` 拥有 builtin capability contribution collection、tool catalog composition 和 capability provider support facts。
- `agent-model` 拥有 model provider adapter registry，不把 provider SDK、AI SDK、raw provider DTO 或 adapter-private option types 暴露到 `agent-app`、runtime、core 或 contracts。
- `agent-app` 只负责读取冻结配置、加载受信 contribution registries、组装 provider/model/capability registries 和注入依赖；不得承载具体 Tool、model adapter 或 provider business semantics。
- 不得用 import side effect 完成注册；每个 contribution 必须可通过显式 manifest/registry 快照列举和测试。
- 不得为了消除一个中心数组引入多个隐式中心、全局 mutable registry 或 request-time fallback registry。

非目标：
- 不支持运行时热加载、watcher reload、远端插件下载、marketplace、签名信任链、插件依赖安装或任意本地目录自动扫描。
- 不重定义 capability catalog、conflict resolution、Tool executor、model invocation contract 或 provider safe error mapping 主路径。
- 不让用户配置直接创建 builtin Tool name、Tool schema、execution mapping、reserved provider 或 model adapter。
- 不开放任意 provider SDK 类型、filesystem API、shell/python 执行或 gateway-local 实现给贡献代码。

验收要点：
- Contract/config tests 覆盖合法 contribution manifest/registry、重复 id、未知 dependency、缺失 adapter、unsupported provider kind 和非法 schema fail closed。
- Capability tests 覆盖新增 builtin Tool/capability 只需声明 contribution 即可进入 existing catalog/discovery/invocation 主路径，并继续经过 conflict resolution、Agent binding、availability 和 input/output schema validation。
- Provider tests 覆盖 framework/reserved provider 由 startup resource provider contribution 注册，用户 raw config 不能声明或覆盖 reserved providers。
- Model tests 覆盖新增 model adapter 通过 `agent-model` registry 选择，不需要在 `agent-app` 增加 provider-specific switch，且 provider SDK 类型不出边界。
- Architecture tests 覆盖 request lifecycle 不重新扫描/导入 contributions，`agent-app` 不 private-import provider internals，runtime/core/context 不依赖 contribution implementation package。
- Security tests 覆盖 startup diagnostics 不泄漏 raw path、credential、raw config、provider error、prompt、模型输出或工具参数。

并行边界：
- 本 change 只定义受控启动期 extension registration，不改变 runtime request lifecycle、Agent Scope、Owner Scope、session/run persistence 或 terminal commit。
- `add-ts-agent-scoped-plugin-composition` 仍拥有 Agent-scoped plugin loading/activation；本 change 可以提供底层 contribution registry 原则，但不得提前实现插件热加载或 Agent-level activation 语义。
- `add-ts-simple-agent-facade` 可以消费本 change 的 registry 结果，但不得绕过 app composition 或 capability governance。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
