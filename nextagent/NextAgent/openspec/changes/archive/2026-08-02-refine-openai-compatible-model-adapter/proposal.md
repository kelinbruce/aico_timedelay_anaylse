## Why

Agent 开发者会为一个 Agent 配置多个可用模型，并期望主对话、摘要、记忆提取、建议问题和工作流遵守同一模型范围。当前不同调用路径分别解释模型配置，可能为同一 Agent 选出不同默认模型、上下文窗口、超时或 fallback 顺序；模型地址和凭据引用也可能被重复传递到多个调用方。

使用者还期望模型切换后仍得到与新模型匹配的 prompt 和上下文预算，并希望系统在 provider 能提供 token usage 时保留该信息。现有 fallback 可能复用前一个模型的上下文结果，OpenAI-compatible 调用也没有统一、稳定的结果归一化路径。

平台运维人员需要看到模型接入的实际可用性，但应用 readiness 不应依赖 Model Gateway 模型信息服务。系统应在消费者首次查询模型安全配置时解析 Gateway 模型信息，并把失败影响限制在对应模型和依赖这些模型的 Agent 调用上；Agent 没有可用激活模型时，实际模型调用安全失败。

因此，本 change 统一平台模型目录、Agent 激活范围、单次选择、模型调用和 fallback 重装配，使不同模型调用目的获得一致且可验证的结果。

术语：

- **全局模型目录（Global Model Catalog）**：平台 ready 后供受信任系统功能查询的模型清单；启动阶段冻结已配置模型成员关系，首次安全查询按需解析模型可用性，不包含接入凭据或 endpoint。
- **Agent 激活模型集合（Agent-Activated Model Set）**：Agent 显式配置的模型子集及顺序，或省略配置时由启动编译从已校验系统模型清单继承的完整有序集合。
- **可信 App Host（Trusted App Host）**：在进程内直接创建或接收 `NextAgentApp`，负责启动、部署、readiness/release evidence 或测试生命周期的入口或宿主。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- Agent 开发者只从平台模型目录中为 Agent 激活模型；所有模型调用目的都在该集合内选择。
- 模型选择获得所选模型的可用性、上下文窗口和默认调用参数；不同 provider 可使用各自可信的信息来源，Gateway 模型信息由首次安全目录查询按需解析。
- 应用启动、Agent 激活发布和 primary health 只依赖已完成本地校验的模型配置，不调用 Gateway 模型信息服务；显式 post-ready deep model-provider health 或实际模型选择才通过安全目录按需解析；任一或全部 Gateway 模型的模型信息不可用时，只使对应模型不可选择，应用保持 ready，引用已知已配置模型的 Agent 激活模型集合保持已发布；没有可用候选的实际模型调用安全失败。
- Agent App 在 `modelProfiles[]` 中按 provider 分组配置模型；产品 `providerId` 清单恰好为 `openai-compatible | model-gateway`，平台使用该唯一 provider identity 绑定已装配 provider，使用全局唯一 model identity 贯穿 Agent 激活、选择和调用。
- 内置默认模型的显式调用画像在配置形态迁移后保持不变；目录缺省值只填充原本未配置的字段，不替换已配置值。
- 模型调用方只提交已选模型、真实调用范围、本次动态输入和受治理的可选调用参数；provider 接入事实由模型边界解析，provider 特有推理参数遵守统一来源治理。
- 主 Agent loop 允许 fallback 时，为下一模型重新执行选择、prompt compatibility、上下文预算和 render。
- 同一次上下文装配中的主 prompt 和摘要调用使用相同的受信 flow 条件完成模型与模板匹配；原始用户问题不成为 flow-variable 选择权威。
- OpenAI-compatible 非流式与流式调用遵循一套 Chat Completions 行为，并在 provider 返回 usage 时尽量保留；provider 不支持或不返回 usage 不改变成功结果。
- 模型调用使用一个生命周期中立的封闭调用范围；其中 operation identity 只用于关联、可观测和审计，真实 request-run 坐标只作为可选因果关联。可信调用路径决定 lifecycle，这些关联事实不改变模型行为。
- 模型调用边界为 outbound model HTTP request 集中生成既有 provider correlation headers。该固定集合为 `X-NextAgent-Agent-Id`、`X-NextAgent-Session-Id`、`X-NextAgent-Request-Id` 和 `X-NextAgent-Run-Id`：Agent header 始终发送，后三个只随完整 run 关联坐标一起发送。调用 request、hook 和 provider options 不能提供或覆盖 header；本 change 不引入额外 header policy。
- run-bound `MODEL_INVOCATION_*` 安全时间线投影原子使用 `stepId` 和 canonical `modelId`；系统在 accepted orchestration step 建立 `stepId`，并以同一值构造 scope `operationId`。同一步骤的同模型 retry 和 cross-model fallback 复用该 operation value；只有受信任 request-run lifecycle 才把它投影回既有 `stepId`。background 调用即使携带 completed-run 关联坐标也不产生 request-run timeline。
- 模型调用 observation 保留 duration、usage、first-visible 和 failure 语义，但不把 `stepId`、`modelId`、`providerId` 或 provider category 投影为 trace/log/metric 维度；model metrics 保留既有 name/value/dedup 语义并移除 `provider_kind` label。
- 可信 App Host 只通过不可变的 `NextAgentApp.systemConfig` 读取模型配置与 validation evidence；不再维护内容重复的 host-only model registry。`providerId` 是 provider selection 与 binding 的唯一身份，运行期模型功能通过应用内部依赖交付。
- Agent 开发者可以在升级框架版本前离线检查并转换自己维护的 system config、Agent definition、Prompt Template 和 Skill model metadata；默认检查不写文件，无法无损转换的输入明确失败，运行时仍只接受目标格式。

**非目标：**

- 模型目录不提供后台预热、周期刷新或运行期配置热变更；每个模型首次完成解析后的安全目录项保持到下一次进程启动。
- 模型注册和接入配置继续由可信应用装配边界拥有。
- 公共模型调用参数保持为首批封闭集合。
- OpenAI-compatible 调用范围保持为 Chat Completions 和既定 provider client compatibility baseline。
- cross-model fallback 仅覆盖主 Agent loop；摘要、记忆提取、建议问题和工作流保留各自既有失败或降级语义。
- request lifecycle、terminal commit、Owner Scope、Web stream 和前端行为保持不变；`MODEL_INVOCATION_*` 只改变安全 identity，不改变 timeline 事务语义。
- 模型 reasoning 在本 change 中保持输出归一化与既有展示/时间线用途；模型输入消息、工具轮续接和跨轮上下文沿用现有契约。需要回传 reasoning 或 provider continuation state 的模型兼容由独立 change 定义。
- 离线升级工具不解析任意 YAML 特性，不扫描 NextAgent 仓库资产、依赖目录或未显式授权的相邻目录，不为其他历史版本或未来 authoring schema 建立通用迁移框架。

## What Changes

- **BREAKING**：模型配置、Agent 激活、模型选择、调用请求、provider 调用和 run-bound timeline 统一使用 canonical `modelId`；产品 provider registration 使用清单内的 canonical `providerId=openai-compatible | model-gateway`。Agent definition 可省略 `modelIds` 以在 assembly 编译时继承 frozen system config 中全部已校验模型；显式 `modelIds` 必须 non-empty、ordered、unique，runtime `AgentAssembly` 始终携带解析后的非空集合。`defaultModelId` 可省略且存在时必须属于该集合。`ModelFinalResult` 只表达 provider-neutral 终态事实与安全 response correlation，模型身份由对应 request 持有。
- **BREAKING**：Agent App system config 以唯一两层 `modelProfiles[]` 同时表达 provider access 和其子模型；配置通过校验的子模型进入全局目录，Host 不再获得重复的扁平 registry 投影。
- 全局目录在 ready 前只冻结 configured model identity、顺序与 provider binding；Gateway 模型信息由本 change 新增的 app-private `ModelCatalogQueryService.list/get` 首次查询按需解析并逐模型冻结，启动、Agent assembly publication 和 primary health 不访问该远程能力；显式 post-ready deep model-provider health 可以作为 safe `get` consumer 触发目标模型解析。available entry 的唯一模型身份位于 `configuration.modelId`，selection 原样复用该 frozen configuration。
- **BREAKING**：模型调用请求收敛为 selected model、既有 `ModelInvocationScope` 的单一 flat closed target shape、动态模型输入和受治理可选参数；run-bound 与 background owner 分别从自身真实生命周期事实构造关联 identity。
- outbound model HTTP request 的 framework-owned correlation headers 固定为既有 Agent/Session/Request/Run 四个名称，并由模型调用边界集中生成：Agent header 始终存在，后三个只随完整关联坐标一起存在。调用 request/hook/provider options 不接受 header，本 change 不建立额外 header policy。
- 模型配置、Prompt Template、Skill、可信 Agent 调用和受治理 hook 使用同一推理参数 vocabulary、明确的覆盖顺序和缺省语义；`providerOptions` 是开放的 selected-provider 扩展对象，未知字段保持可扩展，仅拒绝与 canonical 顶层参数或受保护 identity/access/transport authority 重复的字段；执行超时和 retry 继续受 runtime budget 约束。
- **BREAKING**：全部模型调用目的使用统一、异步、可取消的模型选择契约；request 复用 `identityContext` 并显式携带 accepted Agent fields，`mode` 只允许 `INITIAL | FALLBACK`，选择只考虑 accepted Agent 激活且当前可用的模型。
- 摘要模型选择和 prompt assembly 不再丢弃当前上下文装配的受信 flow 条件；runtime 投影排除保存原始用户问题的 `input_question` 和非 string state，防止用户输入控制模板或模型匹配。
- **BREAKING**：Capability result 的 request-local 模型 patch 使用 canonical model identity 和统一封闭推理参数；provider 特有参数只接受受治理 Skill metadata mapping。
- **BREAKING**：`BEFORE_MODEL_INVOKE` mutation 与封闭扁平模型调用参数对齐。
- **BREAKING**：主 Agent loop fallback 切换模型后重新完成模型相关上下文装配；模型调用边界负责同模型调用和可恢复错误重试。
- **BREAKING**：production `NextAgentApp` 删除没有独立运行期语义的 `productModelProviderKind` 与重复的 `modelProfileRegistry`；公共模型投影只保留 immutable `systemConfig`，不新增 catalog/query/binding API。provider selection 与 binding 只使用 canonical `providerId`。
- OpenAI-compatible 调用统一支持 messages、tools、可选推理参数、同模型可恢复错误重试、非流式/流式结果和安全失败；usage 为 best-effort provider fact，不是成功前置条件。`timeoutMs` 是 initial request、全部 retry 与 backoff 的 logical-invocation 总时限，调用方不得叠加同模型 retry。
- `agent-contracts/gateway` 提供环境中立的可选 `FetchGateway` transport port，`GatewayBindings.fetch` 可供 app composition 下的 outbound HTTP consumer 复用；本 change 只在 Gateway bindings 完成后把该可选能力装配给 OpenAI-compatible adapter，不迁移其他 REST client。LOCAL 未装配时使用平台默认 fetch，REMOTE 实现留给仓库外 provider。本 change 不定义额外 header policy 或自定义 header 语义。
- provider-call W3C trace context 继续由独立 observability/transport instrumentation 管理。
- run-bound 模型调用产生 canonical `MODEL_INVOCATION_*` 安全事实；三个 lifecycle events 使用由同一 scope `operationId` 投影得到的 `stepId` 和相同 `modelId`，持久化与查询结果保持同一 identity。
- 模型 observability projection 从 canonical timeline 继续产生 duration、usage、first-visible 和 failure observations；trace/log 不导出模型或 operation identity，model metric descriptors 移除 `provider_kind` label，不用 `modelId/providerId` 替代。
- RESERVED model policy metadata 与实际选择和 fallback 责任保持一致，可激活范围保持不变。
- NextAgent release 源码提供可独立复制执行的单文件离线升级工具，但不随 runtime 运行包交付。Agent 开发者从目标 release/tag 源码取得该工具后，可在任意位置以自己的项目根目录或显式覆盖路径为输入执行。工具默认 dry-run，统一转换 system config、Agent model references、Prompt Template model match 和 Skill model metadata，并在写入前完成跨文件映射与歧义校验；开发者文档同步以目标格式、工具获取方式和升级命令为准。

## Feature 影响（Features）

### 新增 Feature

无。

### 修改的 Feature

- `F-4.1 接入多种模型`：Agent App system config 分离 canonical model profile 与 provider access，Agent 从统一目录激活模型；启动直接按已校验且冻结的 `systemConfig.modelProfiles` 校验模型引用，Gateway 模型信息由首次安全目录查询解析，任一或全部 Gateway profile 不可用时影响被限制在对应模型调用；模型调用使用安全目录解析的接入配置。
- `F-4.2 模型失败降级`：fallback 使用下一模型重新完成选择和上下文装配。
- `F-4.3 自动管理上下文窗口`：上下文预算使用本次所选模型的已解析窗口。
- `F-5.1 统一能力治理`：Capability result 的 request-local 模型选择字段由不唯一的 `modelName` 原子迁移为 canonical `modelId`，模型 options 保持封闭且 provider-neutral。
- `F-10.2 装配插件`：RESERVED model policy point 的责任描述与实际边界一致；可激活范围不变。
- `F-10.4 自定义工具与提示词`：`match.model` 直接使用 canonical `modelId` string；prompt compatibility 向唯一模型选择服务提供 canonical compatible `modelId` 集合。
- `F-10.1 扩展生命周期钩子`：`BEFORE_MODEL_INVOKE` mutation 与封闭扁平模型调用契约对齐，并继续拒绝模型身份、scope、provider access、transport 和 owner/agent authority 变更。
- `F-10.11 开发工作台`：模型调用过程图、详情和 effective view 使用 runtime canonical `stepId/modelId/modelIds/defaultModelId`，background 模型调用不形成 run-bound 工作台事件。
- `F-7.4 运行指标`：model metrics 保留调用次数、耗时、usage 和 stream timing，但不再按 provider kind 分组，避免在 canonical provider identity 收敛后恢复第二套 provider 分类。
- `F-1.9 智能问题推荐`：terminal 预计算与 Web 按需生成通过统一模型选择服务获得 canonical selected configuration；推荐服务在每次实际模型调用前建立可信 operation identity。completed run 坐标只作为真实因果关联保留，不改变 background lifecycle；推荐调用与其他 concrete provider invocation 使用同一个 `ModelInvocationService` 并执行 Agent 已激活的 model hook，但不产生 request-run model/hook timeline，background `PEND` 在 provider execution 前安全失败。
- `F-8.2 长期记忆`：后台 LLM extraction 通过统一模型选择服务选择 active accepted Agent 的模型，以 accepted extraction cycle identity 作为 `operationId`，并省略不存在的 request-run 关联坐标。
- `F-5.6 Skill 系统`：Skill model metadata 原样映射为 canonical `modelId`；Skill `modelOptions` 支持与模型配置一致的全部八个推理字段。

### 移除的 Feature

无。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-4.1 调用模型`
  - canonical spec：`model-invocation-contract`
  - 本次触及的 legacy specs：`model-provider-configuration`、`model-profile-contracts`、`model-info-contracts`、`model-provider-adapter`、`model-stream-normalization`、`app-config-schema`、`ts-core-contracts`、`ts-minimal-agent-kernel`
  - 功能边界：原子同步 Agent App 两层 `modelProfiles` system config，以该冻结配置直接校验启动期 Agent 模型引用并作为唯一 Host 模型配置投影；同时提供按需解析、逐模型冻结的安全全局模型目录、唯一 `providerId` registration binding、单一 `modelId`、局部可用性、可选调用参数与开放但保留字段受控的 provider 扩展、隔离 provider access、消费可选通用 Gateway fetch、统一 Chat Completions 结果、总时限内同模型可恢复错误重试和 best-effort usage。
  - 系统质量属性：安全、可靠性/恢复、审计/可追溯性、可维护性、可测试性。
  - 映射说明：以 canonical spec 承载目标行为；legacy specs 只保留原子迁移来源或未触及行为。
- `FN-4.2 模型失败降级`
  - canonical spec：`model-fallback-semantics`
  - 本次触及的 legacy spec：`routing-evidence-and-fallback`
  - 功能边界：系统决定是否允许再次尝试；允许时由 Context Engine 选择下一可用模型并重新装配。
  - 系统质量属性：可靠性/恢复、审计/可追溯性。
  - 映射说明：以 canonical spec 承载目标行为。
- `FN-4.3 装配上下文`
  - canonical spec：`context-engine`
  - 本次触及的 legacy specs：`model-profile-contracts`、`model-info-contracts`、`ts-core-contracts`、`ts-minimal-agent-kernel`
  - 功能边界：全部模型调用目的只从 Agent 激活且当前可用的模型中选择；主 prompt 与摘要使用相同的受信 flow 条件；预算使用已选模型窗口；fallback 按新模型重新渲染。
  - 系统质量属性：可靠性/恢复。
  - 映射说明：以 canonical spec 承载目标行为。
- `FN-10.2 装配插件`
  - canonical spec：`agent-scoped-plugin-composition`
  - 功能边界：RESERVED model policy point 的责任描述与模型选择和 fallback owner 一致，可激活集合保持不变。
  - 系统质量属性：无。
  - 映射说明：既有 1:1 映射。
- `FN-5.2 调用能力`
  - canonical spec：`capability-catalog`
  - 本次触及的 legacy spec：`ts-core-contracts`
  - 功能边界：`CapabilityInvocationResult.contextPatch` 使用 canonical optional `modelId` 和八字段 closed `modelOptions`；`providerOptions` 仅接受受治理 Skill metadata mapping，合法 patch 只影响同一 request/run 的后续模型步骤，`modelName` 不保留 alias。
  - 系统质量属性：安全、可维护性。
  - 映射说明：Capability result vocabulary 由 `capability-catalog` 承载，模型选择消费由 `context-engine` 承载。
- `FN-10.4 自定义工具和提示词`
  - canonical spec：`prompt-template-assembly`
  - 功能边界：模板 authoring 使用只含 canonical `modelId` 的 closed match；template `modelOptions` 使用与模型配置一致的八字段 closed inference schema，省略字段不合成默认值，`providerOptions` 在最终模型确定后由 selected adapter 校验；预选择兼容性只消费排除原始用户问题后的受信 flow 条件并产出 canonical compatible model ids，最终模板装配只消费唯一模型选择结果。
  - 系统质量属性：安全、可维护性、可测试性。
  - 映射说明：prompt compatibility 由 prompt canonical spec 定义，最终模型选择仍由 `ModelSelectionService` 唯一决定。
- `FN-10.1 注册和执行钩子`
  - canonical spec：`lifecycle-hook-execution`
  - 功能边界：`BEFORE_MODEL_INVOKE` mutation 使用目标 `ModelInvocationRequest` 的扁平 optional 字段，并只在既有 transform authority、contract validation 与 selected-provider validation 下生效。
  - 系统质量属性：安全、可维护性、可测试性。
  - 映射说明：hook stage authority 与 mutation reduction 保持不变；模型默认值、provider options 和执行约束继续由模型调用契约决定。
- `FN-1.20 查看推荐问题`
  - canonical spec：`question-recommendation`
  - 功能边界：terminal 预计算与 Web 按需生成遵守同一模型选择、identity 和调用契约；每次实际模型调用使用 fresh trusted operation identity、canonical `modelId` 和真实 completed-run causal scope 执行非流式、无工具调用；`SuggestedQuestionRequest`、post-terminal callback、清洗、缓存、解析和返回语义不变。
  - 系统质量属性：安全、可维护性。
  - 映射说明：推荐业务语义仍由 `question-recommendation` 承载，模型选择契约由 `context-engine` 承载。
- `FN-8.3 记忆提取和老化`
  - canonical spec：`memory-extraction`
  - 功能边界：LLM extraction 使用 active accepted Agent、trusted background owner scope 和统一 selection result 装配 prompt/调用；规则提取、scheduler、候选、安全和降级行为不变。
  - 系统质量属性：安全、可靠性/恢复、可维护性。
  - 映射说明：memory lifecycle 保持不变，模型选择统一通过 `ModelSelectionService` 完成。
- `FN-5.9 调用技能`
  - canonical spec：`skill-tool`
  - 功能边界：`SkillMetadata.model` 按 canonical `modelId` 原样投影为 `contextPatch.modelId`；Skill manifest/runtime 的 `modelOptions` 使用与模型配置一致的八字段 closed inference schema，`providerOptions` 只来自已接受的受治理 Skill metadata，并在最终模型确定后由 selected adapter 校验；其他 Skill 执行行为不变。
  - 系统质量属性：安全、可维护性。
  - 映射说明：Skill 调用产生 Capability result；patch canonical schema 仍由 `capability-catalog` 承载。
- `FN-10.11 开发工作台`
  - canonical spec：`dev-agent-workbench`
  - 功能边界：run-bound model invocation 的过程图、事件标签、详情和 effective view 使用 runtime canonical `stepId/modelId/modelIds/defaultModelId`；background recommendation 不形成工作台 model action。
  - 系统质量属性：审计/可追溯性、可维护性、可测试性。
  - 映射说明：`add-ts-dev-agent-workbench` 先归档形成 stable source，本 change 再原子应用两个 `MODIFIED` Requirements。
- `FN-7.5 采集指标`
  - canonical spec：`agent-runtime-metrics`
  - 功能边界：model invocation、duration、token usage、TTFT、chunk latency 和 total stream latency metrics 继续从统一 observation 产生，但 label schema 移除 `provider_kind`，且不使用 `modelId/providerId` 或替代 provider category。
  - 系统质量属性：性能/容量、可维护性。
  - 映射说明：模型 identity 收敛后没有第二套低基数 provider kind；metric name/value/dedup 和其他 inventory 保持。

以下 Function 主要同步本 change 触及的混合 Requirement 映射；各项行为变化以对应条目为准：

- `FN-3.2 编译智能体装配`
  - canonical spec：`agent-package-assembly`
  - 迁移来源：`app-config-schema`、`ts-minimal-agent-kernel`
  - 修改行为：Agent assembly 在启动期编译；Agent definition 省略 `modelIds` 时继承 frozen system config 的全部已校验模型，显式配置保持 non-empty ordered unique 约束；runtime assembly 始终以解析后的非空 `modelIds` 和可选且必须属于该集合的 `defaultModelId` 表达模型激活范围。
- `FN-5.1 管理能力目录`
  - canonical spec：`capability-source-configuration`
  - 迁移来源：`ts-core-contracts`
  - 保留行为：custom Capability provider 只有获得可信 adapter registration 后才能进入能力目录。
- `FN-6.9 引用密钥`
  - canonical spec：`secret-configuration-boundary`
  - 迁移来源：`model-provider-configuration`、`ts-core-contracts`
  - 保留行为：`credentialRef` 从 legacy flat model profile 移到 `modelProfiles[]` 父层 provider access config；secret reference grammar、active validation、最底层 encrypted-envelope 处理、独立 key source 和 raw secret 不泄漏边界均不改变，本 change 不修改 Secret resolver/adapter 实现或增加 ENC 支持。
- `FN-10.5 集成外部系统`
  - canonical spec：`gateway-configuration`
  - 迁移来源：`ts-core-contracts`
  - 目标变化：Gateway model-information capability 与通用 Gateway selection、freeze、defaults 和既有 readiness/fallback 语义保持正交，capability 装配不在 ready 前发起模型信息查询；新增环境中立的 optional `FetchGateway` 与 `GatewayBindings.fetch`，单 binding 原样 merge、重复 binding 安全失败，LOCAL 不要求实现且当前 change 不迁移其他 REST client。

## 影响范围（Impact）

- Agent 开发者显式配置 `modelIds` 时需要确保每个 id 存在于平台模型目录；省略该字段时 Agent 在 assembly 编译阶段继承全部已校验系统模型。已知但暂不可用的模型不会阻塞 assembly，即使全部激活模型均不可用也保持该行为，但实际模型调用会因没有可用候选而安全失败。
- 模型配置、Agent 激活引用、调用请求和相关 host projection 需要原子迁移到 canonical provider/model identity 与封闭调用 contract；可信 Host 若读取 `productModelProviderKind`，需要改为读取 canonical provider/model 配置。
- Capability producer/consumer 需要把 `contextPatch.modelName` 原子迁移为 `contextPatch.modelId`；该字段不保留输入 alias，非法或越权 patch 安全失败。
- Lifecycle hook 开发者需要把 `BEFORE_MODEL_INVOKE.commonOptions` 迁移为规格列出的扁平字段；hook 不能修改 selected model、scope 或 provider binding。
- Skill 开发者的 `model` metadata 值按 canonical NextAgent `modelId` 解释；系统不再把它当作 provider model name 或 display name 反查。
- Prompt Template 与 Skill 开发者可以声明与模型配置一致的封闭推理参数；模型执行控制继续由模型配置和调用边界管理。
- 推荐问题和 memory extraction 使用统一模型选择契约获得模型。
- Prompt template 开发者需要把模型匹配迁移为 canonical `modelId`。
- 既有四个 NextAgent correlation header names 和 run-bound HTTP 调用语义保持不变：模型调用边界集中发送 Agent header，并在完整 run 关联坐标存在时发送 Session/Request/Run headers；真实 background 调用没有 run 坐标时，后三个 header 按 scope 事实省略。本 change 不定义额外 provider-facing header marker。
- `credentialRef` 配置字段从 legacy flat model profile 移到 `modelProfiles[]` 父层 provider access config；Secret grammar、active validation、resolver/adapter、encrypted-envelope 和 non-leakage 行为保持不变，不形成 Secret resolver/adapter 生产代码改动。
- 运维人员在首次安全目录查询解析 Gateway 模型后会获得 model-scoped metadata 安全诊断；应用 ready 不访问 Gateway 模型信息服务。
- 依赖 `provider_kind` label 的 model metric dashboard/alert 需要迁移为按 metric name、outcome 和 token type 聚合；系统不会以 `modelId`、`providerId` 或固定 `OTHER` 代替该 label。
- 可信 App Host 只读取 `NextAgentApp.systemConfig` 这一模型配置公共投影；`systemConfig.modelProfiles` 与 `modelProfileValidationEvidence` 使用 canonical model/provider 配置并保持冻结，内部功能模块和不可信边界不能把它当作运行期模型权威。`modelProfileRegistry` 与 `productModelProviderKind` 删除，不保留兼容 alias。
- `add-ts-dev-agent-workbench` 必须先归档为 stable 迁移 baseline，本 change 才能归档。
- 公共 contract、模型配置、主 Agent loop fallback、辅助模型消费者、Capability result、Gateway 集成、plugin policy metadata 和相应测试会被动受到影响。
