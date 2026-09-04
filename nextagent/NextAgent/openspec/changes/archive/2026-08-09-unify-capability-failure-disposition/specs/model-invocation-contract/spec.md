# model-invocation-contract Delta Specification

所属 Function：`FN-4.1 调用模型`

Function 变更类型：修改

spec 角色：主规格

## MODIFIED Requirements

### Requirement: Target-state request fields are stable invocation inputs

`ModelInvocationRequest` SHALL 保持封闭对象。其 required 顶层字段 MUST 恰好为可信 `invocationScope`、`modelId`、`messages` 和 `tools`；optional 顶层字段 MUST 恰好为 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`toolChoice`、`providerOptions`、`modelParams`、正整数 `timeoutMs`、非负整数 `maxRetries` 和正整数 `contextWindowTokens`。

`contextWindowTokens` MUST 只由已解析的模型配置经可信调用路径提供，并仅用于 framework-owned final-input budget admission 与 `BEFORE_MODEL_INVOKE` Hook 边界。该字段 MUST NOT 由客户端、模型、Capability、Hook mutation 或 providerOptions 提供或覆盖，MUST NOT 映射为 provider-native request、framework-owned header 或模型可见消息。调用方缺失该字段时不改变模型调用语义。

public provider-neutral scalar type MUST 命名为 `ToolChoice`，MUST NOT 命名为 `ModelToolChoice` 或其他带 `Model` 前缀的平行类型；其允许值 MUST 恰好为 `AUTO | NONE | REQUIRED`。`ModelInferenceOptions.toolChoice?: ToolChoice` MUST 由 `ModelProfile`、`ResolvedModelConfiguration`、Prompt Template `modelOptions`、受治理 Capability context patch、可信 render/invocation request 和 `BEFORE_MODEL_INVOKE` mutation 复用；不得为这些边界建立平行字段。除 resolved profile default 外，任一来源省略该字段 MUST 表示不覆盖。首版 MUST NOT 接受 named-tool object。

普通 invocation 的 effective precedence MUST 与其他 provider-neutral inference fields 相同：profile、selected Prompt Template、governed Capability patch、trusted request、governed hook，后层逐字段覆盖前层。当 runtime-owned model-only 或 finalizing hard constraint 生效时，模型调用前的 post-Hook effective `toolChoice` MUST 收窄为 `NONE`，任何层 MUST NOT 把该 hard constraint 扩大为 `AUTO` 或 `REQUIRED`。`NONE` MUST 在保留 `tools` descriptor 集合的同时映射为 selected provider 的禁止 Tool 选择；`AUTO` 允许模型自行选择普通文本或 Tool；`REQUIRED` 要求模型选择至少一个当前已提供 Tool，且与空 `tools` 组合时 MUST 在 provider access 前安全失败。`providerOptions` 或 `modelParams` 中的 `toolChoice`、`tool_choice` 或规范化同名 key MUST 作为 authority collision 被拒绝。`modelParams` MUST 保持 optional non-null `JsonObject`；除上述 collision 外，其有效输入与透传语义 MUST 由自身 owning contract 决定，MUST NOT 被 `toolChoice` 改写。

**需求类别**：功能性需求

#### Scenario: 受信 Hook 使用模型窗口预算
- **WHEN** 已解析模型配置的调用进入 `BEFORE_MODEL_INVOKE`
- **THEN** `ModelInvocationRequest` 和 Hook boundary MUST 携带相同的 `contextWindowTokens`
- **AND** 下游 provider request 和模型消息 MUST NOT 因该字段增加 provider 参数、header 或内容
#### Scenario: NONE 保留 Tool descriptor 但禁止 Tool 选择

- **WHEN** effective `toolChoice=NONE` 且 invocation request 携带一个或多个可见 Tool descriptors
- **THEN** provider-facing request MUST 保留同一 `tools` 集合
- **AND** selected provider MUST 收到其 native none tool-choice control
- **AND** 系统 MUST NOT 通过 `tools=[]` 表达该限制

#### Scenario: REQUIRED 没有可选 Tool

- **WHEN** effective `toolChoice=REQUIRED` 但 invocation request 的 `tools` 为空
- **THEN** provider execution MUST NOT 启动
- **AND** 模型调用 MUST 返回安全 validation failure

#### Scenario: 未声明 named-tool choice

- **WHEN** profile、template、patch、request 或 hook 提供 named-tool choice object
- **THEN** runtime schema MUST 在 provider access 前拒绝该值

#### Scenario: modelParams 不能覆盖 canonical tool choice

- **WHEN** `modelParams` 包含 `toolChoice`、`tool_choice` 或规范化比较后为 `toolchoice` 的字段
- **THEN** provider execution MUST NOT 启动
- **AND** 系统 MUST 只使用 canonical 顶层 `toolChoice` 生成 provider-native control
- **AND** 不含上述 collision 的 `modelParams` MUST 按其 owning contract 继续透传

### Requirement: 全局模型目录提供安全模型配置

系统 MUST 在启动配置完成本地校验后建立进程生命周期内不可变的全局模型目录已配置模型集合。每个通过本地校验并保留在配置中的 `ModelProfile` MUST 进入该集合，并 MUST 以系统内唯一 `modelId` 同时作为 Agent 激活、模型选择、模型调用身份和传给 provider 的模型标识；其父级 `ModelProviderProfile.providerId` MUST 解析到唯一受信 provider access。已配置模型的成员关系、配置顺序和可由本地配置确定的模型事实 MUST 在 ready 前冻结；系统 MUST NOT 因目录发布或 Agent assembly publication 在 ready 前调用 Gateway model-information service。可选 `displayName` 只用于人类可读展示，MUST NOT 参与模型选择、provider 路由或授权。目录消费者 MUST 只观察本 Requirement 定义的安全目录项，MUST NOT 观察或推导 provider 接入配置。

`ModelProfile.modelId` MUST 是去除首尾空白后不为空、长度为 `1..256` 个 Unicode code point 且不包含控制字符的字符串。产品配置允许的 `ModelProviderProfile.providerId` 清单 MUST 恰好为区分大小写的 `openai-compatible | model-gateway`：`openai-compatible` 要求合法 `baseUrl` 并允许 optional `credentialRef`；`model-gateway` 只在可信启动配置提供恰好一个 `ModelGatewayProvider` 时可用，禁止 `baseUrl` 并允许 optional `credentialRef`。任一 optional credential 缺失都表示不发送 credential。其他 `providerId` 或不符合对应 access shape 的配置 MUST 在目录发布前安全失败；后续增加 provider 类型必须通过独立 extension/config contract change 扩展该清单，不能仅靠配置字符串启用。可选 `displayName` MUST 使用与 `modelId` 相同的非空字符串约束。`fallbackEligible` MUST 为 required boolean。profile 中的 optional `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`toolChoice`、`providerOptions`、`timeoutMs` 和 `maxRetries` MUST 使用 `Target-state request fields are stable invocation inputs` 定义的同名字段约束。每个通过 closed schema、安全校验和 provider access validation 的配置项 MUST 成为目录项；部署停用模型时 SHALL 从配置中移除该子项。显式 `null` 和 closed schema 未列出的字段 MUST 在目录发布前被拒绝。

公共目录契约 MUST 使用封闭判别联合 `ModelCatalogEntry`。`availability="AVAILABLE"` 分支的 required fields MUST 恰好为 `availability`、`fallbackEligible` 和 `configuration: ResolvedModelConfiguration`，optional field MUST 恰好为 `displayName`，且 MUST NOT 包含顶层 `modelId` 或 `unavailableReason`。`availability="UNAVAILABLE"` 分支的 required fields MUST 恰好为 `modelId`、`availability`、`fallbackEligible` 和 `unavailableReason`，optional field MUST 恰好为 `displayName`，且 MUST NOT 包含 `configuration`。`unavailableReason` 的允许值 MUST 恰好为 `MODEL_INFORMATION_UNAVAILABLE | MODEL_NOT_FOUND | MODEL_INFORMATION_AMBIGUOUS | CONTEXT_WINDOW_INVALID`。

`ResolvedModelConfiguration` MUST 是封闭不可变对象：required fields MUST 恰好为 `modelId`、正安全整数 `contextWindowTokens`、`temperature`、`maxOutputTokens`、`topP`、required `toolChoice`、单位为 ms 的正安全整数 `defaultTimeoutMs` 和非负安全整数 `defaultMaxRetries`；optional fields MUST 恰好为 `topK`、`presencePenalty`、`frequencyPenalty` 和 `thinking`，并使用 `Target-state request fields are stable invocation inputs` 定义的同名字段约束。available catalog entry 和 `ModelSelectionResult.status="SELECTED"` MUST 复用同一 resolved configuration shape；selection MUST 原样返回命中 available entry 的 frozen `configuration`，MUST NOT 复制、重命名或再次嵌套模型身份。`ModelProfile` 未配置 `temperature`、`maxOutputTokens`、`topP`、`toolChoice`、`timeoutMs` 或 `maxRetries` 时，对应 resolved 值 MUST 分别为 `0.55`、`32,000`、`1`、`AUTO`、`30,000` 和 `2`。

canonical identity、Agent 激活、exact template matching、模型调用请求和 provider invocation MUST 使用同一个 `modelId`；模型边界 MUST 把该值传给命中的 provider。`ModelFinalResult` 的字段集合由 `Non-streaming and streaming invocation share one terminal result contract` 定义。公共模型目录、模型选择、prompt input、模型调用请求和模型调用时间线 MUST NOT 暴露或依赖 `providerId` 或 provider access implementation class。`providerOptions` 和 locale 不属于安全 resolved configuration。所有目录对象 MUST 拒绝 `null`、未知字段、混合判别分支和非法数值。

`ModelProfile` optional fields MUST 使用以下缺省语义：

- `displayName` 缺失时保持缺失，系统 MUST NOT 从 `modelId` 合成 display name；
- `temperature` 缺失时 effective profile default MUST 为 `0.55`；
- `maxOutputTokens` 缺失时 effective profile default MUST 为 `32,000`；
- `topP` 缺失时 effective profile default MUST 为 `1`；
- `topK`、`presencePenalty`、`frequencyPenalty` 和 `thinking` 缺失时不建立 NextAgent 固定默认值；
- `toolChoice` 缺失时 effective profile default MUST 为 `AUTO`；
- `providerOptions` 缺失时表示该 profile 不提供 provider option 默认值，系统 MUST NOT 合成空对象作为公共事实；
- `timeoutMs` 缺失时 effective profile default MUST 为 `30,000 ms`；
- `maxRetries` 缺失时 effective profile default MUST 为 `2`。

`contextWindowTokens` MUST NOT 使用固定默认值：使用静态模型信息的 provider MUST 要求子 profile 提供合法正整数配置值；使用可信 model-information service 的 provider MUST 使用该查询值。任一路径缺少合法窗口时，该模型 MUST 为 `UNAVAILABLE`。

`ModelCatalogQueryService` SHALL 作为 lazy model-information resolution 的唯一安全查询契约，且不是 `NextAgentApp` public API。该 service MUST 恰好提供 `list(signal: AbortSignal): Promise<readonly ModelCatalogEntry[]>` 和 `get(modelId: string, signal: AbortSignal): Promise<ModelCatalogEntry | undefined>`。`get` 对 unknown id MUST 返回 `undefined`，MUST NOT 因该查询调用 provider；对已知 id MUST 在返回前解析该模型尚未解析的可信模型信息。`list` MUST 解析全部尚未解析的 locally valid configured entries，并按已校验 profile 配置顺序返回全部安全目录项；单个模型解析为 `UNAVAILABLE` MUST NOT 使 `list` 拒绝其他已解析目录项。两个方法都 MUST 接收 required cancellation signal，将其传播到本次尚未完成的模型信息查询，MUST NOT 启动脱离该调用生命周期的远程解析，MUST NOT 在取消后返回部分结果或把取消映射为 `UNAVAILABLE`。

Agent assembly publication MUST 直接按已校验且冻结的 `systemConfig.modelProfiles` 校验 activated `modelId` 引用，并 MUST NOT 为该校验调用 `ModelCatalogQueryService`、Gateway model-information service 或 provider。

每个模型首次完成解析后，系统 MUST 在本次进程生命周期内冻结同一个 `ModelCatalogEntry`，后续 `list` 或 `get` MUST 返回该 frozen entry，MUST NOT 再次查询其模型信息。同一尚未解析模型的并发 `list`/`get` MUST 共享至多一个进行中的 provider 查询；进行中的查询因其 owning cancellation signal 取消时，系统 MUST 保持该模型可再次解析，仍有未取消调用方时 MUST 由其中一个调用方重新发起至多一个查询。公共查询 MUST NOT 暴露内部未解析或解析中状态，也 MUST NOT 暴露 `providerId`、endpoint、credential reference、resolved credential、custom fetch、SDK object 或 provider-native metadata。

OpenAI-compatible 模型的完整上下文窗口 MUST 来自子 profile 配置的正整数 `contextWindowTokens`；单次输出上限 MUST 使用可选 `maxOutputTokens`。Model Gateway 模型的完整上下文窗口 MUST 来自首次安全目录查询触发的可信 model-information 查询。`ModelGatewayProvider` MUST 同时提供 `createModelService()` 和 required `createModelInformationService(): ModelGatewayModelInformationService`；该 service MUST 恰好提供 `get(modelId: string, signal: AbortSignal): Promise<ModelGatewayModelInformationResult>`。目录查询 MUST 以当前待解析 configured profile 的可信 `modelId` 查询；调用方 MUST NOT 提供另一个 provider-native id。

`ModelGatewayModelInformationResult` MUST 是封闭判别联合。`status="FOUND"` MUST 额外要求 `information: ModelGatewayModelInformation`，且 MUST NOT 包含 `reason`；`ModelGatewayModelInformation` MUST 是只含 required `modelId` 和 `contextWindowTokens` 的封闭对象，`modelId` MUST 与查询值相同，`contextWindowTokens` MUST 为正安全整数。`status="NOT_FOUND"` MUST NOT 包含 `information` 或 `reason`。`status="UNAVAILABLE"` MUST 额外要求 `reason: MODEL_INFORMATION_UNAVAILABLE | MODEL_INFORMATION_AMBIGUOUS`，且 MUST NOT 包含 `information`。显式 `null`、未知字段、混合判别分支、id 不匹配或非法窗口 MUST 被视为 malformed result；查询 MUST 遵守 required cancellation signal，取消 MUST 按统一 cancellation 语义结束而不是返回任一 result 分支。

Gateway authentication/transport failure、malformed result、`NOT_FOUND`、ambiguous unavailable result 或窗口非法时，系统 MUST 分别映射为 `MODEL_INFORMATION_UNAVAILABLE`、`MODEL_INFORMATION_UNAVAILABLE`、`MODEL_NOT_FOUND`、`MODEL_INFORMATION_AMBIGUOUS` 或 `CONTEXT_WINDOW_INVALID`，把对应模型的首次解析结果标记为 `UNAVAILABLE` 并产生安全诊断；该结果 MUST 按上一段冻结到进程重启。任一或全部 Gateway profile 因该原因变为 `UNAVAILABLE` 时，系统 MUST 保持应用 ready 和只引用已知 configured profile 的已发布 Agent assembly，不得撤销或重建 assembly。本地校验失败或由受控 degraded-ready 规则排除的 profile MUST NOT 触发远程 metadata 查询，也 MUST NOT 进入目录。

**需求类别**：功能性需求

#### Scenario: Compatible 模型进入目录
- **WHEN** configured 子 profile 使用 `providerId=openai-compatible`，且该 profile 通过本地校验并包含正整数 `contextWindowTokens`
- **THEN** 目录将该 profile 标记为 `AVAILABLE`
- **AND** 安全模型配置暴露该窗口、effective `temperature=0.55`、`maxOutputTokens=32,000`、`topP=1`、effective `toolChoice=AUTO`、其他已配置的可选通用参数、effective default timeout 和 effective default max retries

#### Scenario: Model id 重复
- **WHEN** 两个 locally valid configured profiles 声明相同 `modelId`
- **THEN** 应用 MUST 在模型目录发布前安全失败
- **AND** MUST NOT 以 `providerId`、配置顺序或 `displayName` 隐式消除歧义

#### Scenario: Provider access 不可用
- **WHEN** configured profile 的 `providerId` 无法解析到恰好一个可信 provider access
- **THEN** 应用 MUST 在模型目录发布前安全失败

#### Scenario: 产品配置使用未列出的 provider id
- **WHEN** `modelProfiles[]` 父项的 `providerId` 不是区分大小写的 `openai-compatible` 或 `model-gateway`
- **THEN** 应用 MUST 在模型目录发布前安全失败
- **AND** MUST NOT 根据字符串前缀、endpoint、credential 或模型 id 推断 provider 类型或接入方式

#### Scenario: Provider access shape 与清单不匹配
- **WHEN** `providerId=openai-compatible` 缺少 `baseUrl`，或 `providerId=model-gateway` 携带 `baseUrl`
- **THEN** 对应 provider access MUST 在模型目录发布前安全失败
- **AND** MUST NOT 从环境变量或另一个 provider entry 补齐或忽略该字段

#### Scenario: 启动与 Agent assembly 发布不访问 Gateway 模型信息
- **WHEN** 本地配置包含通过校验的 Gateway profiles，且 Agent assembly 只引用其中已知 configured `modelId`
- **THEN** 系统 MUST 仅根据冻结的已配置模型集合完成 assembly publication 并进入 ready
- **AND** ready 前 MUST NOT 调用 Gateway model-information service

#### Scenario: `get` 首次解析 Gateway 模型信息
- **WHEN** `get(modelId, signal)` 首次查询一个已知 configured Gateway profile，且可信 model-information 查询返回同一 `modelId` 和正整数 context window
- **THEN** 目录将该 profile 标记为 `AVAILABLE`
- **AND** 安全模型配置使用该查询结果
#### Scenario: `list` 解析全部尚未解析模型
- **WHEN** `list(signal)` 查询包含多个尚未解析 Gateway profiles 的目录
- **THEN** 系统 MUST 为每个尚未解析 profile 解析模型信息
- **AND** MUST 按配置顺序返回全部 frozen `AVAILABLE | UNAVAILABLE` 目录项
- **AND** 单个 profile 的不可用结果 MUST NOT 使 `list` 丢失其他目录项

#### Scenario: Gateway 模型信息不可用
- **WHEN** 首次安全目录查询触发的可信 Gateway model-information 查询失败或返回非法结果
- **THEN** 目录将该 profile 标记为 `UNAVAILABLE`
- **AND** 受影响 profile 不提供可用于选择或调用的 resolved model configuration
- **AND** 其他有效 profile、应用 ready 和已发布 Agent assembly 不受该失败影响
- **AND** 安全诊断不包含 raw provider response、endpoint、credential 或本地路径

#### Scenario: Gateway 模型不存在或存在歧义
- **WHEN** model-information service 返回 `NOT_FOUND` 或带 `MODEL_INFORMATION_AMBIGUOUS` reason 的 `UNAVAILABLE`
- **THEN** 目录项的 `unavailableReason` MUST 分别为 `MODEL_NOT_FOUND` 或 `MODEL_INFORMATION_AMBIGUOUS`
- **AND** 系统 MUST NOT 猜测模型或上下文窗口

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

#### Scenario: 可信消费者查询模型目录
- **WHEN** 可信系统功能查询模型目录
- **THEN** 查询 MUST 在返回前完成目标范围内尚未解析模型的信息解析
- **AND** 它获得 frozen 安全目录项和可用性
- **AND** available configuration 只使用 canonical `modelId` 表达模型身份
- **AND** available entry MUST NOT 在 `configuration.modelId` 之外重复顶层 `modelId`
- **AND** 它 MUST NOT 取得 provider access configuration

#### Scenario: Selection 原样复用 available configuration
- **WHEN** `ModelSelectionService` 选择一个 available catalog entry
- **THEN** selected result 的 `configuration` MUST 使用该 entry 的 frozen `configuration`
- **AND** 两个边界观察到的 `ResolvedModelConfiguration` shape 和值 MUST 完全一致
- **AND** selection result MUST NOT 重新包装第二个 `modelId`

#### Scenario: 查询未知模型不访问 provider
- **WHEN** 可信消费者调用 `get` 查询全局模型目录中不存在的 `modelId`
- **THEN** 查询 MUST 返回 `undefined`
- **AND** MUST NOT 调用任何 provider model-information service

#### Scenario: 重复与并发查询复用逐模型解析结果
- **WHEN** 多个 `list` 或 `get` 调用并发查询同一个尚未解析模型，或后续再次查询已完成解析的模型
- **THEN** 同一时刻对该模型 MUST 至多存在一个 provider model-information 查询
- **AND** 完成解析后全部调用 MUST 观察同一个 frozen `ModelCatalogEntry`

#### Scenario: 目录查询被取消
- **WHEN** `list` 或 `get` 的 required cancellation signal 在查询完成前被取消
- **THEN** 查询 MUST 按统一 cancellation 语义结束
- **AND** 查询 MUST NOT 返回部分目录或 provider access fact
- **AND** 取消 MUST NOT 把尚未完成解析的模型冻结为 `UNAVAILABLE`

#### Scenario: Gateway 模型信息结果不满足封闭对象 schema
- **WHEN** model-information service 返回 `null`、unknown field 或与查询不一致的 `modelId`
- **THEN** 对应目录项 MUST 为 `UNAVAILABLE`
- **AND** `unavailableReason` MUST 为 `MODEL_INFORMATION_UNAVAILABLE`

#### Scenario: Gateway 模型信息窗口非法
- **WHEN** model-information service 返回非正安全整数 `contextWindowTokens`
- **THEN** 对应目录项 MUST 为 `UNAVAILABLE`
- **AND** `unavailableReason` MUST 为 `CONTEXT_WINDOW_INVALID`

### Requirement: Provider options remain an open selected-provider extension

Optional inner `providerOptions` MAY 为 selected provider 提供未被 canonical 顶层字段表达的推理扩展参数，并 MUST 在各 authoring/invocation contract 中保持 optional non-null `JsonObject`。`providerOptions` 的授权来源 MUST 恰好为：启动期 schema 与安全校验通过的 `ModelProfile.providerOptions`；已编译并选中的 Prompt Template `modelOptions.providerOptions`；受治理 Skill Tool 从 accepted `SkillMetadata.modelOptions.providerOptions` 原样映射并通过 Capability result governance 的 request-local patch；可信 Agent 开发代码在 `ModelInputRenderRequest.providerOptions` 或 `ModelInvocationRequest.providerOptions` 契约边界提供的值；以及已激活且具有 model-invocation transform authority 的 `BEFORE_MODEL_INVOKE` hook 经 mutation schema 校验后产生的 `providerOptions`。中间处理只可传递已授权值，MUST NOT 构成新的授权来源。调用请求的 `providerOptions` MUST 只表示 inner provider options，MUST NOT 包含 provider namespace。前八个 provider-neutral inference fields 的 effective precedence MUST 固定为 profile、selected Prompt Template、governed Capability patch、trusted request、governed hook，后层逐字段覆盖前层；`providerOptions` MUST 使用相同层次顺序，但 Capability layer MUST 只接受 governed Skill patch，并 MUST 在各层之间执行顶层浅合并，同名嵌套对象 MUST 整体替换，MUST NOT 执行递归合并。

模型调用边界 MUST 根据 selected `modelId` 解析 `providerId`，并把 effective inner provider options 交给 selected provider 的扩展参数边界。该对象 MUST 保持开放：系统 MUST 接受并原样转交未知的 JSON 字段，MUST NOT 使用封闭 schema 或 allowlist 拒绝未来 provider 扩展。selected provider 明确定义的 option MAY 由 provider 解释，其他非保留字段 MUST 原样进入 provider-native request。canonical `toolChoice` MUST 由 adapter 映射为 provider-native `auto | none | required` 或语义等价值；它 MUST NOT 通过开放 `providerOptions` 传递。

开放扩展只受 authority collision 约束。provider options MUST 拒绝与 canonical 顶层模型请求字段或最终 provider body authority 重复的字段，包括 model/messages/tools/stream、顶层 inference/thinking/tool-choice controls、timeout/retry，以及 provider identity、endpoint、credential、headers、fetch/transport 和 Owner/Agent scope；比较 MUST 同时覆盖 NextAgent camelCase 名称与 provider-native 名称。除此之外的未知字段 MUST 被接受。顶层 `thinking` MUST 是 reasoning 语义的唯一权威，系统 MUST NOT 在顶层字段与 provider options 之间选择或合并第二套值。不可信 Web/client、RuntimeCommand、Capability 参数、非 Skill Tool Capability result、Skill Tool input/body、history、模型输出或 metadata MUST NOT 直接提供该字段；raw option 值 MUST NOT 进入 error、log、metric、trace、audit 或用户可见输出。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 调用覆盖 profile provider option
- **WHEN** profile 和调用请求都提供合法 `providerOptions`，并包含相同顶层字段
- **THEN** effective provider options 使用调用值
- **AND** 其他未被覆盖的 profile 顶层字段保持不变
- **AND** 同名嵌套对象不执行递归合并

#### Scenario: Adapter 接收有效 provider option
- **WHEN** effective provider options 包含未与受保护 authority 冲突的已知或未知 JSON 字段
- **THEN** 模型边界将其交给 selected provider 的 extension path
- **AND** 调用方不选择或提交 provider namespace

#### Scenario: Adapter 接收未来未知 provider option
- **WHEN** effective provider options 包含 NextAgent 未预定义、且不与受保护 authority 冲突的 JSON 字段
- **THEN** provider execution MUST 启动并把该字段和值原样交给 OpenAI-compatible provider request
- **AND** 系统 MUST NOT 因字段未知而拒绝调用

#### Scenario: 授权来源携带 provider option
- **WHEN** profile、已编译并选中的 Prompt Template、受治理 Skill metadata patch、可信 Agent 开发代码构造的 `ModelInvocationRequest`，或受治理的 `BEFORE_MODEL_INVOKE` mutation 为本次调用提供结构合法的 provider options
- **THEN** 系统 MUST 将该值送入 effective provider options 合并与 selected-provider 校验

#### Scenario: Provider option 尝试覆盖受治理字段
- **WHEN** effective provider options 包含受保护的身份、消息、工具、执行、接入或 transport 字段
- **THEN** provider execution 不启动
- **AND** failure 不暴露 option value

#### Scenario: Provider option 重复 thinking authority
- **WHEN** effective provider options 包含 `reasoning`、`thinking`、`reasoningEffort`、`reasoning_effort` 或其他与顶层 `thinking` 语义重复的字段
- **THEN** provider execution MUST NOT 启动
- **AND** 系统 MUST NOT 在顶层 `thinking` 与 provider options 之间选择或合并第二套 reasoning authority

#### Scenario: 不可信来源提供 provider option
- **WHEN** Web/client、RuntimeCommand、Capability 参数、非 Skill Tool Capability result、Skill Tool input/body、history、模型输出或不可信 metadata 携带 provider options
- **THEN** 该字段在进入 `ModelInvocationRequest` 前被拒绝
#### Scenario: Provider options 不能覆盖 canonical tool choice

- **WHEN** `providerOptions` 包含 `toolChoice`、`tool_choice` 或规范化比较后为 `toolchoice` 的字段
- **THEN** selected-provider reserved-field validation MUST 拒绝该 invocation
- **AND** adapter MUST 只使用 canonical 顶层 `toolChoice` 生成 provider-native control

## Function 变更汇总

### 描述

- 变更类型：修改
- 目标内容：模型调用契约以 canonical `toolChoice` 控制本轮 Tool 选择，同时保持 Tool descriptor、模型身份和 provider access owner 不变。
- 依据 Requirements：`Target-state request fields are stable invocation inputs`、`全局模型目录提供安全模型配置`、`Provider options remain an open selected-provider extension`

### 输入

- 变更类型：修改
- 目标内容：profile、Prompt Template、受治理 patch、trusted request 和 governed hook 可以按固定 precedence 提供 `AUTO | NONE | REQUIRED`。
- 依据 Requirements：`Target-state request fields are stable invocation inputs`

### 处理过程

- 变更类型：修改
- 目标内容：模型边界校验 effective `toolChoice`，拒绝 collision 和 `REQUIRED + tools=[]`，并由 selected adapter 映射 native control。
- 依据 Requirements：`Target-state request fields are stable invocation inputs`、`Provider options remain an open selected-provider extension`

### 结果

- 变更类型：修改
- 目标内容：`NONE` 保留 Tool descriptors 但禁止本轮 Tool 选择；省略 profile 值时 resolved default 为 `AUTO`。
- 依据 Requirements：`Target-state request fields are stable invocation inputs`、`全局模型目录提供安全模型配置`
