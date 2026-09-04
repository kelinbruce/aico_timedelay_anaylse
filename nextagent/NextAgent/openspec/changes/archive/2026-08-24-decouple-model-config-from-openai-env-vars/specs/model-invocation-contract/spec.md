## Function

- **所属 Function**：`FN-4.1 调用模型`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: 全局模型目录提供安全模型配置

系统 MUST 在启动配置完成本地校验后建立进程生命周期内不可变的全局模型目录已配置模型集合。每个通过本地校验并保留在配置中的 `ModelProfile` MUST 进入该集合，并 MUST 以系统内唯一 `modelId` 同时作为 Agent 激活、模型选择、模型调用身份和传给 provider 的模型标识；其父级 `ModelProviderProfile.providerId` MUST 解析到唯一受信 provider access。已配置模型的成员关系、配置顺序和可由本地配置确定的模型事实 MUST 在 ready 前冻结；系统 MUST NOT 因目录发布或 Agent assembly publication 在 ready 前调用 Gateway model-information service。可选 `displayName` 只用于人类可读展示，MUST NOT 参与模型选择、provider 路由或授权。目录消费者 MUST 只观察本 Requirement 定义的安全目录项，MUST NOT 观察或推导 provider 接入配置。

`ModelProfile.modelId` MUST 是去除首尾空白后不为空、长度为 `1..256` 个 Unicode code point 且不包含控制字符的字符串。产品配置允许的 `ModelProviderProfile.providerId` 清单 MUST 恰好为区分大小写的 `openai-compatible | model-gateway`：`openai-compatible` 允许 optional `baseUrl` 和 optional `credentialRef`；`model-gateway` 只在可信启动配置提供恰好一个 `ModelGatewayProvider` 时可用，禁止 `baseUrl` 并允许 optional `credentialRef`。任一 optional credential 缺失都表示不发送 credential。`openai-compatible` 父项在 `baseUrl` 缺失时视为未配置：该父项的子 profile MUST 保留在已配置模型集合中，并在模型目录中以 `UNAVAILABLE`、`unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED` 呈现；这些子 profile MAY 被 Agent assembly 引用，但 MUST NOT 提供可用于选择或调用的 resolved model configuration，模型调用 MUST 返回安全 model-unavailable failure。该父项 MUST NOT 阻止其他 viable provider profile 进入目录。其他 `providerId` 或不符合对应 access shape 的配置 MUST 在目录发布前安全失败；后续增加 provider 类型必须通过独立 extension/config contract change 扩展该清单，不能仅靠配置字符串启用。可选 `displayName` MUST 使用与 `modelId` 相同的非空字符串约束。`fallbackEligible` MUST 为 required boolean。profile 中的 optional `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`toolChoice`、`providerOptions`、`timeoutMs` 和 `maxRetries` MUST 使用 `Target-state request fields are stable invocation inputs` 定义的同名字段约束。每个通过 closed schema、安全校验和 provider access validation 的配置项 MUST 成为目录项；父项已配置接入参数时目录项按本 Requirement 解析 `AVAILABLE`，父项未配置接入参数时目录项 MUST 为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`；部署停用模型时 SHALL 从配置中移除该子项。显式 `null` 和 closed schema 未列出的字段 MUST 在目录发布前被拒绝。

公共目录契约 MUST 使用封闭判别联合 `ModelCatalogEntry`。`availability="AVAILABLE"` 分支的 required fields MUST 恰好为 `availability`、`fallbackEligible` 和 `configuration: ResolvedModelConfiguration`，optional field MUST 恰好为 `displayName`，且 MUST NOT 包含顶层 `modelId` 或 `unavailableReason`。`availability="UNAVAILABLE"` 分支的 required fields MUST 恰好为 `modelId`、`availability`、`fallbackEligible` 和 `unavailableReason`，optional field MUST 恰好为 `displayName`，且 MUST NOT 包含 `configuration`。`unavailableReason` 的允许值 MUST 恰好为 `MODEL_PROVIDER_NOT_CONFIGURED | MODEL_INFORMATION_UNAVAILABLE | MODEL_NOT_FOUND | MODEL_INFORMATION_AMBIGUOUS | CONTEXT_WINDOW_INVALID`。

`ResolvedModelConfiguration` MUST 是封闭不可变对象：required fields MUST 恰好为 `modelId`、正安全整数 `contextWindowTokens`、`temperature`、`maxOutputTokens`、`topP`、required `toolChoice`、单位为 ms 的正安全整数 `defaultTimeoutMs` 和非负安全整数 `defaultMaxRetries`；optional fields MUST 恰好为 `topK`、`presencePenalty`、`frequencyPenalty` 和 `thinking`，并使用 `Target-state request fields are stable invocation inputs` 定义的同名字段约束。available catalog entry 和 `ModelSelectionResult.status="SELECTED"` MUST 复用同一 resolved configuration shape；selection MUST 原样返回命中 available entry 的 frozen `configuration`，MUST NOT 复制、重命名或再次嵌套模型身份。`ModelProfile` 未配置 `temperature`、`maxOutputTokens`、`topP`、`toolChoice`、`timeoutMs` 或 `maxRetries` 时，对应 resolved 值 MUST 分别为 `0.55`、`32,000`、`1`、`AUTO`、`30,000` 和 `2`。

canonical identity、Agent 激活、exact template matching、模型调用请求和 provider invocation MUST 使用同一个 `modelId`；模型边界 MUST 把该值传给命中的 provider。`ModelFinalResult` 的字段集合由 `Non-streaming and streaming invocation share one terminal result contract` 定义。公共模型目录、模型选择、prompt input、模型调用请求和模型调用时间线 MUST NOT 暴露或依赖 `providerId` 或 provider access implementation class。`providerOptions` 和 locale 不属于安全 resolved configuration。所有目录对象 MUST 拒绝 `null`、未知字段、混合判别分支和非法数值。

`ModelProfile` optional fields MUST 使用以下缺省语义：

- `displayName` 缺失时保持缺失，系统 MUST NOT 从 `modelId` 合成 display name；
- `temperature` 缺失时 effective profile default MUST 为 `0.55`；
- `maxOutputTokens` 缺失时 effective profile default MUST 为 `32,000`；
- `topP` 缺失时 effective profile default MUST 为 `1`；
- `toolChoice` 缺失时 effective profile default MUST 为 `AUTO`；
- `timeoutMs` 缺失时 effective profile default MUST 为 `30,000` ms；
- `maxRetries` 缺失时 effective profile default MUST 为 `2`；
- `topK`、`presencePenalty`、`frequencyPenalty`、`thinking` 和 `providerOptions` 缺失时保持缺失。

模型目录与 provider access 解析 MUST 区分三类配置问题：access shape 违反（例如 `openai-compatible` 提供非法 `baseUrl` 值）、provider 未配置（`openai-compatible` 缺失 `baseUrl`）和 provider identity 解析失败（`providerId` 未命中或命中多个受信 provider access）。access shape 违反 MUST 在目录发布前安全失败；provider 未配置 MUST 使该父项子 profile 的目录项为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`，并产生不影响 readiness 的安全 validation evidence；provider identity 解析失败 MUST 在目录发布前安全失败。

**需求类别**：功能性需求

#### Scenario: 内置默认配置未配置模型 provider
- **WHEN** 系统加载内置 `default-system.yaml`，其 `openai-compatible` 父项未提供 `baseUrl` 和 `credentialRef`
- **AND** 未通过配置 overlay 注入真实接入参数
- **THEN** 应用 MUST 启动成功并进入 `DEGRADED_READY`
- **AND** 该父项的子 profile 在模型目录中 MUST 为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`
- **AND** 模型调用 MUST 返回安全 model-unavailable failure
- **AND** 安全诊断 MUST 只含相关 `providerId` 和安全 code，MUST NOT 包含 raw secret、endpoint 或本地路径

#### Scenario: 未配置 provider 不影响其他 viable profile
- **WHEN** 配置同时包含一个未配置 `baseUrl` 的 `openai-compatible` 父项和一个 viable `model-gateway` 父项
- **THEN** 未配置 `openai-compatible` 父项的子 profile MUST 在模型目录中为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`
- **AND** viable `model-gateway` profile MUST 正常进入目录并可调用
- **AND** 系统 MUST NOT 因未配置 `openai-compatible` 父项而 fail closed

#### Scenario: 已知 Gateway 模型被 Agent 激活
- **WHEN** Agent assembly 激活已配置模型集合中的 Gateway profile
- **THEN** assembly publication MUST NOT 依赖该 profile 的模型信息或可用性
- **AND** 后续模型选择 MUST 通过安全目录查询取得其 frozen `AVAILABLE | UNAVAILABLE` 结果

#### Scenario: 已发布 Agent 的全部模型解析为不可用
- **WHEN** 已发布 Agent assembly 的非空激活模型集合全部经安全目录查询解析为 `UNAVAILABLE`
- **THEN** 应用 MUST 保持 ready
- **AND** Agent assembly MUST 保持已发布
- **AND** 目录不为这些 profile 提供 resolved model configuration

#### Scenario: Agent 激活未知 profile
- **WHEN** Agent assembly 引用目录外的 `modelId`
- **THEN** assembly publication 安全失败

### Requirement: Agent App system config 使用 canonical model/provider 配置

`DefaultSystemConfig` 的模型配置 MUST 只使用 recursively frozen app-owned `modelProfiles: readonly ModelProviderProfile[]` 与 `modelProfileValidationEvidence: readonly ModelProfileValidationEvidence[]`。每个 closed `ModelProviderProfile` 的 required fields MUST 恰好为唯一 `providerId` 和至少包含一个元素的 `models: readonly ModelProfile[]`；optional fields MUST 恰好为合法 `baseUrl` 和合法 `credentialRef`。产品配置允许的 exact `providerId` MUST 恰好为 `openai-compatible | model-gateway`，语义和装配前置条件由本规格的 `全局模型目录提供安全模型配置` 唯一定义。每个 closed 子 `ModelProfile` 的 required fields MUST 恰好为 `modelId` 和 `fallbackEligible`；optional fields MUST 恰好为 `displayName`、`contextWindowTokens`、`temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`providerOptions`、`reasoningTextMode`、`timeoutMs` 和 `maxRetries`。子 profile 出现在 `models[]` 中即表示配置并进入后续目录装配。`providerId` MUST NOT 在子 profile 重复出现；全部父项中的 `modelId` MUST 全局唯一。父项和子项 MUST 拒绝显式 `null`、未知字段、重复 identity 和空 `models`。

`ModelProfileValidationEvidence` 的 required fields MUST 恰好为 `modelId`、低基数 `code` 和安全 `message`。`modelProfiles` MUST 保持父项配置顺序与每个父项的子项顺序；模型配置对象、嵌套 inference/provider options、validation evidence 数组及每个 evidence item MUST 在配置校验完成后冻结。Host 若需扁平模型清单、fallback-eligible ids 或 exact model lookup，MUST 直接从该冻结配置快照派生，系统 MUST NOT 为这些无独立生命周期的视图维护第二个 public registry 或 index。

每个父项的 `providerId` MUST 解析到恰好一个受信 provider access。该 provider access MUST 对父层 `baseUrl/credentialRef` 执行封闭校验：`baseUrl` 存在时 `openai-compatible` MUST 接受合法 http/https URL、`model-gateway` MUST 拒绝该字段；`credentialRef` 存在时 MUST 是合法 `env:`/`file:` reference。`openai-compatible` 的 `baseUrl` 为 optional，缺失时该父项视为未配置接入参数；`credentialRef` 为 optional，支持 credential 的 provider 在 `credentialRef` 缺失时不发送 credential。unknown 或重复 provider access MUST 在目录发布前安全失败，且解析 MUST 只使用 exact `providerId`。

custom fetch、provider SDK client 和 transport MUST NOT 进入 system config；模型调用使用的 custom fetch MUST 只来自 trusted gateway configuration 的 optional `GatewayBindings.fetch`，其余 provider runtime facts MUST 只来自 `providerId` 对应的受信 provider access。raw config 环境引用解析 MUST 解析父项的 `baseUrl`、`credentialRef` 和子项的 `modelId`；父项和子项均 MUST 按本 Requirement 的 closed schema 校验。raw config 环境引用解析 MUST NOT 把 `OPENAI_API_KEY` 或 `OPENAI_BASE_URL` 作为隐式默认环境变量名注入 `modelProfiles`；`baseUrl` 和 `credentialRef` 只能来自配置本身。

provider access 校验 MUST 遵守 fail-fast/degraded-ready 边界。除下一句的受控例外外，任一 model/provider 配置失败 MUST 阻止 ready，MUST NOT 被静默丢弃。唯一受控例外是：某个父项的 `credentialRef` grammar 非法，且其全部 configured 子 profiles 都是 `fallbackEligible=true`，并且排除这些 profiles 后仍至少存在一个 viable configured non-fallback profile；此时系统 MAY 排除全部受影响 profiles 并进入 degraded-ready，采用该例外时 MUST 产生只含相关 `providerId`、`modelId` 和安全 code 的 validation evidence，未采用时 MUST fail closed。`openai-compatible` 父项因 `baseUrl` 缺失而未配置时，其子 profile MUST 保留并通过安全 validation evidence 标记为未配置，evidence MUST 不影响 readiness；当配置中不存在任何 viable configured provider profile 时，应用 MUST 进入 `DEGRADED_READY` 并可启动，相关模型目录项 MUST 为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`。父项同时包含任一 configured non-fallback profile、排除后没有 viable profile，或失败属于 duplicate/unknown provider access、identity、access config、base URL 非法值、inference field、provider option、context window 或其他配置错误时，startup MUST fail closed；本句不适用于仅因 `openai-compatible` `baseUrl` 缺失导致的 provider 未配置。

**需求类别**：功能性需求

#### Scenario: Provider 父项包含多个模型
- **WHEN** raw system config 在一个 `modelProfiles[]` 父项声明 `providerId`、provider access config 和一个或多个子模型
- **THEN** validated system config MUST 在该父项只保存 raw config 提供且对应 provider access 接受的 optional `baseUrl/credentialRef`
- **AND** 每个 `models[]` 子项 MUST 只保存单一 `modelId`、模型画像、availability input、fallback policy、全部已配置的 provider-neutral 推理参数、`providerOptions`、`timeoutMs` 和 `maxRetries`
- **AND** 所有子模型 MUST 通过父项的同一 `providerId` exact lookup 到同一个可信 provider access

#### Scenario: 配置存在且已配置接入参数即进入模型目录
- **WHEN** `models[]` 包含通过 schema、security 和 provider-owned access validation 的子 profile
- **AND** 其父项已配置接入参数（`openai-compatible` 提供合法 `baseUrl`，或 `model-gateway` 不需要 `baseUrl`）
- **THEN** 该 profile MUST 进入模型目录装配并按其可解析事实提供 `AVAILABLE` 目录项

#### Scenario: 模型 profile 配置全部推理参数
- **WHEN** 子 profile 同时提供合法 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`providerOptions` 和 `reasoningTextMode`
- **THEN** validated frozen profile MUST 保留全部显式值
- **AND** 模型调用边界 MUST 对 `providerOptions` 执行 selected-provider reserved-field validation，并按 request-over-profile 规则解析 effective values
#### Scenario: openai-compatible 父项缺失 baseUrl
- **WHEN** 一个 `modelProfiles[]` `openai-compatible` 父项未提供 `baseUrl`
- **THEN** 该父项的子 profile MUST 在模型目录中为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`
- **AND** 系统 MUST NOT 因该父项缺失 `baseUrl` 而 fail closed；即使配置中不存在其他 viable provider profile，应用也 MUST 保持 `DEGRADED_READY`
- **AND** 安全诊断 MUST NOT 回显环境变量值、endpoint 或 credential

#### Scenario: 内置默认模型名覆盖缺失
- **WHEN** 内置默认配置的子项 `modelId` 引用 `env:OPENAI_MODEL_NAME`
- **AND** 该环境变量未提供或为空
- **AND** 其 `openai-compatible` 父项未配置 `baseUrl`
- **THEN** raw config 解析 MUST 使用安全占位模型名 `default-model`
- **AND** 应用 MUST 保持 `DEGRADED_READY` 且 MUST NOT 因未解析的模型名环境引用阻止启动
- **AND** 该模型目录项 MUST 保持 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`

#### Scenario: 内置默认模型使用明确调用画像
- **WHEN** 系统加载内置 `default-system.yaml` 并完成环境引用解析
- **THEN** 默认子 profile MUST 显式包含 `temperature=0.2`、`maxOutputTokens=2048`、`topP=1` 和 `timeoutMs=300000`
- **AND** catalog 固定默认值 MUST NOT 覆盖这些显式值

#### Scenario: Provider id 不能唯一绑定
- **WHEN** 父项的 `providerId` 未命中可信 provider access、命中多个 provider access，或对应 provider 拒绝该父项 access config
- **THEN** 系统 MUST 在模型目录发布前安全失败
- **AND** MUST NOT 从字符串前缀、子 profile、环境变量自动发现或其他摘要字段推导 provider access

#### Scenario: Fallback-only provider credential grammar 非法
- **WHEN** 一个 `modelProfiles[]` 父项的 `credentialRef` grammar 非法
- **AND** 该父项的全部 configured 子 profiles 都是 fallback-eligible
- **AND** 排除这些 profiles 后仍存在 viable configured non-fallback profile
- **THEN** 系统 MAY 排除全部受影响 profiles 并进入 degraded-ready
- **AND** safe validation evidence MUST 标识相关 `providerId`、`modelId` 和安全 code

#### Scenario: Primary profile 引用无效 provider credential
- **WHEN** 一个 `modelProfiles[]` 父项的 `credentialRef` grammar 非法
- **AND** 该父项至少一个 configured 子 profile 不是 fallback-eligible，或排除全部受影响 profiles 后没有 viable profile
- **THEN** startup MUST fail closed

#### Scenario: 可信 Host 从唯一配置快照读取模型事实
- **WHEN** 可信 App Host 读取 `NextAgentApp.systemConfig.modelProfiles` 或 `modelProfileValidationEvidence`
- **THEN** 它 MUST 观察通过校验且冻结的 canonical `providerId/modelId` 配置与安全 validation evidence
- **AND** Host MAY 在自身调用栈中按需派生扁平清单、fallback ids 或 exact lookup 结果
- **AND** production App object MUST NOT 提供重复的 `modelProfileRegistry`、configured ids 或 membership index
- **AND** provider access route、assembly selection 和 model-information projection仍由各自 owning module 提供

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：`openai-compatible` provider 的 `baseUrl` 由必需改为 optional；`baseUrl` 缺失时该父项视为未配置，子 profile 在模型目录中为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`；应用保持 `DEGRADED_READY` 并可启动，模型调用返回安全 model-unavailable failure；raw config 环境引用解析不得把 `OPENAI_API_KEY`/`OPENAI_BASE_URL` 作为隐式默认环境变量名注入。
- **依据 Requirements**：`全局模型目录提供安全模型配置`、`Agent App system config 使用 canonical model/provider 配置`

### 规格

- **规格项**：`openai-compatible` 接入参数可缺省性
- **变更类型**：修改
- **原规格值**：`openai-compatible` 要求合法 `baseUrl`（必需），缺失时 fail closed
- **目标规格值**：`openai-compatible` 的 `baseUrl` 与 `credentialRef` 均 optional；`baseUrl` 缺失时该父项未配置，子 profile 的目录项为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`，应用为 `DEGRADED_READY`，模型调用安全失败
- **依据 Requirements**：`全局模型目录提供安全模型配置`、`Agent App system config 使用 canonical model/provider 配置`

### 主规格

- **变更类型**：修改
- **目标内容**：`model-invocation-contract`
- **依据 Requirements**：`全局模型目录提供安全模型配置`、`Agent App system config 使用 canonical model/provider 配置`
