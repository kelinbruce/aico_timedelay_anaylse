## Function

- **所属 Function**：`FN-4.1 调用模型`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 全局模型目录提供安全模型配置

系统 MUST 在启动配置完成本地校验后建立进程生命周期内不可变的全局模型目录已配置模型集合。每个通过本地校验并保留在配置中的 `ModelProfile` MUST 进入该集合，并 MUST 以系统内唯一 `modelId` 同时作为 Agent 激活、模型选择、模型调用身份和传给 provider 的模型标识；其父级 `ModelProviderProfile.providerId` MUST 绑定唯一可信 provider registration。已配置模型的成员关系、配置顺序、provider binding 和可由本地配置确定的模型事实 MUST 在 ready 前冻结；系统 MUST NOT 因目录装配或 Agent assembly publication 在 ready 前调用 Gateway model-information service。可选 `displayName` 只用于人类可读展示，MUST NOT 参与模型选择、provider 路由或授权。目录消费者 MUST 只观察本 Requirement 定义的安全目录项，MUST NOT 观察或推导 provider 接入配置。

`ModelProfile.modelId` MUST 是去除首尾空白后不为空、长度为 `1..256` 个 Unicode code point 且不包含控制字符的字符串。产品配置在本 change 中允许的 `ModelProviderProfile.providerId` 清单 MUST 恰好为区分大小写的 `openai-compatible | model-gateway`：`openai-compatible` 命中 framework-owned OpenAI-compatible registration，要求合法 `baseUrl` 并允许 optional `credentialRef`；`model-gateway` 只在可信 App composition 已装配恰好一个 `ModelGatewayProvider` 时命中该 registration，禁止 `baseUrl` 并允许 optional `credentialRef`。任一 optional credential 缺失都表示不发送 credential。其他 `providerId` 或不符合对应 access shape 的配置 MUST 在目录发布前安全失败；后续增加 provider registration 必须通过独立 extension/config contract change 扩展该清单，不能仅靠配置字符串启用。可选 `displayName` MUST 使用与 `modelId` 相同的非空字符串约束。`fallbackEligible` MUST 为 required boolean。profile 中的 optional `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`providerOptions`、`timeoutMs` 和 `maxRetries` MUST 使用 `Target-state request fields are stable invocation inputs` 定义的同名字段约束。每个通过 closed schema、安全校验和 provider-owned access validation 的配置项 MUST 成为目录项；部署停用模型时 SHALL 从配置中移除该子项。显式 `null` 和 closed schema 未列出的字段 MUST 在目录发布前被拒绝。

公共目录契约 MUST 使用封闭判别联合 `ModelCatalogEntry`。`availability="AVAILABLE"` 分支的 required fields MUST 恰好为 `availability`、`fallbackEligible` 和 `configuration: ResolvedModelConfiguration`，optional field MUST 恰好为 `displayName`，且 MUST NOT 包含顶层 `modelId` 或 `unavailableReason`。`availability="UNAVAILABLE"` 分支的 required fields MUST 恰好为 `modelId`、`availability`、`fallbackEligible` 和 `unavailableReason`，optional field MUST 恰好为 `displayName`，且 MUST NOT 包含 `configuration`。`unavailableReason` 的允许值 MUST 恰好为 `MODEL_INFORMATION_UNAVAILABLE | MODEL_NOT_FOUND | MODEL_INFORMATION_AMBIGUOUS | CONTEXT_WINDOW_INVALID`。

`ResolvedModelConfiguration` MUST 是封闭不可变对象：required fields MUST 恰好为 `modelId`、正安全整数 `contextWindowTokens`、`temperature`、`maxOutputTokens`、`topP`、单位为 ms 的正安全整数 `defaultTimeoutMs` 和非负安全整数 `defaultMaxRetries`；optional fields MUST 恰好为 `topK`、`presencePenalty`、`frequencyPenalty` 和 `thinking`，并使用 `Target-state request fields are stable invocation inputs` 定义的同名字段约束。available catalog entry 和 `ModelSelectionResult.status="SELECTED"` MUST 复用同一 resolved configuration shape；selection MUST 原样返回命中 available entry 的 frozen `configuration`，MUST NOT 复制、重命名或再次嵌套模型身份。`ModelProfile` 未配置 `temperature`、`maxOutputTokens`、`topP`、`timeoutMs` 或 `maxRetries` 时，对应 resolved 值 MUST 分别为 `0.55`、`32,000`、`1`、`30,000` 和 `2`。

canonical identity、Agent 激活、exact template matching、模型调用请求和 provider invocation MUST 使用同一个 `modelId`；模型边界 MUST 把该值传给命中的 provider。`ModelFinalResult` 的字段集合由 `Non-streaming and streaming invocation share one terminal result contract` 定义。公共模型目录、模型选择、prompt input、模型调用请求和模型调用时间线 MUST NOT 暴露或依赖 `providerId` 或 provider registration class。`providerOptions` 和 locale 不属于安全 resolved configuration。所有目录对象 MUST 拒绝 `null`、未知字段、混合判别分支和非法数值。

`ModelProfile` optional fields MUST 使用以下缺省语义：

- `displayName` 缺失时保持缺失，系统 MUST NOT 从 `modelId` 合成 display name；
- `temperature` 缺失时 effective profile default MUST 为 `0.55`；
- `maxOutputTokens` 缺失时 effective profile default MUST 为 `32,000`；
- `topP` 缺失时 effective profile default MUST 为 `1`；
- `topK`、`presencePenalty`、`frequencyPenalty` 和 `thinking` 缺失时不建立 NextAgent 固定默认值；
- `providerOptions` 缺失时表示该 profile 不提供 provider option 默认值，系统 MUST NOT 合成空对象作为公共事实；
- `timeoutMs` 缺失时 effective profile default MUST 为 `30,000 ms`；
- `maxRetries` 缺失时 effective profile default MUST 为 `2`。

`contextWindowTokens` MUST NOT 使用固定默认值：使用静态模型信息的 provider registration MUST 要求子 profile 提供合法正整数配置值；使用可信 model-information service 的 provider registration MUST 使用该查询值。任一路径缺少合法窗口时，该模型 MUST 为 `UNAVAILABLE`。

本 change 新增 app-private `ModelCatalogQueryService`，作为 lazy model-information resolution 的唯一安全查询边界；它不是 `NextAgentApp` public API，也不在当前代码基线中预先存在。该 service MUST 恰好提供 `list(signal: AbortSignal): Promise<readonly ModelCatalogEntry[]>` 和 `get(modelId: string, signal: AbortSignal): Promise<ModelCatalogEntry | undefined>`。`get` 对 unknown id MUST 返回 `undefined`，MUST NOT 因该查询调用 provider；对已知 id MUST 在返回前解析该模型尚未解析的可信模型信息。`list` MUST 解析全部尚未解析的 locally valid configured entries，并按已校验 profile 配置顺序返回全部安全目录项；单个模型解析为 `UNAVAILABLE` MUST NOT 使 `list` 拒绝其他已解析目录项。两个方法都 MUST 接收 required cancellation signal，将其传播到本次尚未完成的模型信息查询，MUST NOT 启动脱离该调用生命周期的远程解析，MUST NOT 在取消后返回部分结果或把取消映射为 `UNAVAILABLE`。

app-private 模型运行时 MUST 只向 app composition 交付两个 owning ports：既有命名的 `ModelCatalogQueryService` 负责上述 `list/get` 安全目录查询，独立 `ModelInvocationService` 负责 `complete/stream` 模型调用；系统 MUST NOT 新增仅包装 configured id lookup、activation assertion 或二者与目录查询组合的第三个模型 port。Agent assembly publication MUST 在建立模型运行时前直接按已校验且冻结的 `systemConfig.modelProfiles` 校验 activated `modelId` 引用，并 MUST NOT 为该校验调用 `ModelCatalogQueryService`、Gateway model-information service 或 provider。

每个模型首次完成解析后，系统 MUST 在本次进程生命周期内冻结同一个 `ModelCatalogEntry`，后续 `list` 或 `get` MUST 返回该 frozen entry，MUST NOT 再次查询其模型信息。同一尚未解析模型的并发 `list`/`get` MUST 共享至多一个进行中的 provider 查询；进行中的查询因其 owning cancellation signal 取消时，系统 MUST 保持该模型可再次解析，仍有未取消调用方时 MUST 由其中一个调用方重新发起至多一个查询。公共查询 MUST NOT 暴露内部未解析或解析中状态，也 MUST NOT 暴露 `providerId`、endpoint、credential reference、resolved credential、custom fetch、SDK object 或 provider-native metadata。

OpenAI-compatible provider registration 的完整上下文窗口 MUST 来自子 profile 配置的正整数 `contextWindowTokens`；单次输出上限 MUST 使用可选 `maxOutputTokens`。Model Gateway provider registration 的完整上下文窗口 MUST 来自首次安全目录查询触发的可信 model-information 查询。`ModelGatewayProvider` MUST 在既有 `createModelService()` 之外提供 required `createModelInformationService(): ModelGatewayModelInformationService`；该 provider-private service MUST 恰好提供 `get(modelId: string, signal: AbortSignal): Promise<ModelGatewayModelInformationResult>`。catalog MUST 以当前待解析 configured profile 的可信 `modelId` 查询；调用方 MUST NOT 提供另一个 provider-native id。

`ModelGatewayModelInformationResult` MUST 是封闭判别联合。`status="FOUND"` MUST 额外要求 `information: ModelGatewayModelInformation`，且 MUST NOT 包含 `reason`；`ModelGatewayModelInformation` MUST 是只含 required `modelId` 和 `contextWindowTokens` 的封闭对象，`modelId` MUST 与查询值相同，`contextWindowTokens` MUST 为正安全整数。`status="NOT_FOUND"` MUST NOT 包含 `information` 或 `reason`。`status="UNAVAILABLE"` MUST 额外要求 `reason: MODEL_INFORMATION_UNAVAILABLE | MODEL_INFORMATION_AMBIGUOUS`，且 MUST NOT 包含 `information`。显式 `null`、未知字段、混合判别分支、id 不匹配或非法窗口 MUST 被视为 malformed result；查询 MUST 遵守 required cancellation signal，取消 MUST 按统一 cancellation 语义结束而不是返回任一 result 分支。

Gateway authentication/transport failure、malformed result、`NOT_FOUND`、ambiguous unavailable result 或窗口非法时，系统 MUST 分别映射为 `MODEL_INFORMATION_UNAVAILABLE`、`MODEL_INFORMATION_UNAVAILABLE`、`MODEL_NOT_FOUND`、`MODEL_INFORMATION_AMBIGUOUS` 或 `CONTEXT_WINDOW_INVALID`，把对应模型的首次解析结果标记为 `UNAVAILABLE` 并产生安全诊断；该结果 MUST 按上一段冻结到进程重启。任一或全部 Gateway profile 因该原因变为 `UNAVAILABLE` 时，系统 MUST 保持应用 ready 和只引用已知 configured profile 的已发布 Agent assembly，不得撤销或重建 assembly。本地校验失败或由受控 degraded-ready 规则排除的 profile MUST NOT 触发远程 metadata 查询，也 MUST NOT 进入目录。

**需求类别**：功能性需求

#### Scenario: Compatible 模型进入目录
- **WHEN** configured 子 profile 的父级 `providerId` exact lookup 命中 compatible provider registration，且该 profile 通过本地校验并包含正整数 `contextWindowTokens`
- **THEN** 目录将该 profile 标记为 `AVAILABLE`
- **AND** 安全模型配置暴露该窗口、effective `temperature=0.55`、`maxOutputTokens=32,000`、`topP=1`、其他已配置的可选通用参数、effective default timeout 和 effective default max retries

#### Scenario: Model id 重复
- **WHEN** 两个 locally valid configured profiles 声明相同 `modelId`
- **THEN** 应用 MUST 在模型目录发布前安全失败
- **AND** MUST NOT 以 `providerId`、配置顺序或 `displayName` 隐式消除歧义

#### Scenario: Provider runtime binding 不可用
- **WHEN** configured profile 的 `providerId` 无法解析到恰好一个可信 provider runtime registration
- **THEN** 应用 MUST 在模型目录发布前安全失败

#### Scenario: 产品配置使用未列出的 provider id
- **WHEN** `modelProfiles[]` 父项的 `providerId` 不是区分大小写的 `openai-compatible` 或 `model-gateway`
- **THEN** 应用 MUST 在模型目录发布前安全失败
- **AND** MUST NOT 根据字符串前缀、endpoint、credential 或模型 id 推断 provider registration

#### Scenario: Provider access shape 与清单不匹配
- **WHEN** `providerId=openai-compatible` 缺少 `baseUrl`，或 `providerId=model-gateway` 携带 `baseUrl`
- **THEN** 对应 registration MUST 在模型目录发布前安全失败
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

### Requirement: Invocation scope represents real lifecycle coordinates

`ModelInvocationScope` 已存在于当前 `agent-contracts/model` 代码基线，本 change 对其执行 breaking refinement。目标 scope MUST 是一个封闭扁平对象，required 字段 MUST 恰好为可信 `tenantId`、`subjectId`、`agentId`、`agentVersion`、`agentAssemblyRef` 和 `operationId`；optional 字段 MUST 恰好为 `sessionId`、`requestId` 和 `runId`，且这三个字段 MUST all-or-none 出现。owner 与 Agent fields 的来源和语义必须继续与现有 trusted `IdentityContext`、accepted Agent 和 run facts 一致。optional run coordinates 只表示真实、可信的调用关联事实；run-bound 或 background lifecycle 由可信调用上下文决定。`operationId` MUST 是去除首尾空白后非空、长度为 `1..256` 个 Unicode code point 且不含控制字符的字符串。未知字段、部分 run coordinates 或 synthetic coordinates MUST 在 provider access 前失败。

受信任 run-bound orchestration MUST 以 owning `stepId` 的同一值构造 `operationId`，并与 accepted run 的真实 `sessionId/requestId/runId` 原子写入 scope。owning background invocation boundary MUST 使用由自身可信 owner 建立的真实 operation identity：scheduler/cycle path 使用已冻结 cycle identity，按需 background service 在实际模型调用前建立 fresh identity。没有真实相关 run 时 MUST 省略全部 run coordinates，有真实相关 accepted/completed run 时 MAY 把完整三元组作为 causal correlation，但这不改变 background lifecycle。模型边界 MUST 使用 tenant/subject 与 Agent coordinates 校验 trusted Owner/Agent scope；当调用属于已接受的 request-run lifecycle 时，系统 MUST 额外把完整 run coordinates 与该 accepted run/context 一起校验。lifecycle authority MUST 来自可信调用上下文，MUST NOT 从 scope shape 推断。

`operationId` MUST 只用于内部 correlation、observability 和 audit，MUST NOT 参与模型选择、provider binding/routing、授权、幂等、logical-invocation identity、retry 决策或模型可见推理。对发起 outbound model HTTP request 的 adapter，模型调用边界 MUST 从已校验 scope 集中生成 framework-owned correlation headers；名称集合 MUST 恰好为 `X-NextAgent-Agent-Id`、`X-NextAgent-Session-Id`、`X-NextAgent-Request-Id` 和 `X-NextAgent-Run-Id`。每个该类 request MUST 发送 Agent header；完整 run coordinates 存在时 MUST 同时发送其余三个 headers，三者缺失时 MUST 全部省略。tenant/subject、agent version/assembly、operation 和其他 raw lifecycle coordinate MUST 限制在可信 invocation envelope，MUST NOT 进入 provider-native model body、模型可见输入或 framework-owned correlation header。`providerId=model-gateway` 的 trusted canonical invocation envelope MAY 按本规格的 Gateway scenario 携带完整 scope，但 Gateway adapter MUST NOT 把该 scope 转为下游模型可见输入或 provider-native body。`ModelInvocationRequest`、`providerOptions`、hook mutation 和 caller MUST NOT 接受、提供或覆盖 header/transport metadata。本 change 不定义额外 outbound header policy；`agentId` 按固定 `X-NextAgent-Agent-Id` header 原值发送，不因其为 raw value 而拒绝。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: Run-bound 调用模型
- **WHEN** 模型调用属于 accepted request run
- **THEN** session、request 和 run coordinates 完整存在并等于同一 accepted orchestration step 的可信 facts
- **AND** `operationId` 等于该 owning orchestration `stepId` 的同一值

#### Scenario: 没有相关 run 的 background cycle 调用模型
- **WHEN** 受治理 background cycle 在没有 request run 的情况下调用模型
- **THEN** scope 的 `operationId` MUST 等于 owning background lifecycle 已冻结的真实 cycle identity
- **AND** scope MUST 省略全部 session/request/run coordinates

#### Scenario: Background 调用保留 completed-run 因果关联
- **WHEN** 受治理 post-terminal background consumer 与一个真实 completed run 存在直接因果关系
- **THEN** scope MAY 携带该 completed run 的完整 session/request/run coordinates
- **AND** scope 的 `operationId` MUST 等于 owning background service 为本次实际模型调用建立的可信 operation identity
- **AND** 该三元组 MUST NOT 使调用进入 run-bound timeline 或改变其 background lifecycle；调用仍 MUST 通过统一 `ModelInvocationService` 执行当前 Agent 已激活的 model hook

#### Scenario: `operationId` 不改变模型行为
- **WHEN** 两次其他有效输入相同的调用仅使用不同的 schema-valid `operationId`
- **THEN** `operationId` MUST NOT 改变模型选择、provider binding、authorization、retry、idempotency 或模型可见输入
- **AND** 系统 MUST 把可观察差异限制为内部 correlation、observability 或 audit 关联

#### Scenario: Scope 不满足封闭 schema
- **WHEN** scope 包含部分 run coordinates、synthetic coordinates 或 closed schema 未列出的字段
- **THEN** provider execution 不启动
- **AND** 调用安全失败

#### Scenario: 完整 run 关联坐标生成既有 correlation headers
- **WHEN** schema-valid scope 携带完整 session/request/run coordinates，且 adapter 发起 outbound model HTTP request
- **THEN** outbound request 的 framework-owned correlation headers MUST 恰好为 scope `agentId` 与 session/request/run 分别对应的四个固定 `X-NextAgent-*` headers

#### Scenario: 无 run 关联坐标只生成 Agent header
- **WHEN** schema-valid scope 省略全部 session/request/run coordinates，且 adapter 发起 outbound model HTTP request
- **THEN** outbound request 的 framework-owned correlation headers MUST 恰好为 `X-NextAgent-Agent-Id`

### Requirement: 模型调用时间线使用 canonical identity

run-bound 模型调用产生 `MODEL_INVOCATION_STARTED | MODEL_INVOCATION_COMPLETED | MODEL_INVOCATION_FAILED` 事实时，三个事件的安全时间线 identity MUST 恰好使用 required `stepId` 和 `modelId`。`stepId` MUST 是同一 `ModelInvocationRequest.invocationScope.operationId` 在可信 run-bound lifecycle boundary 的原值投影，`modelId` MUST 使用 `ModelProfile.modelId` 的 scalar constraint 并来自本次调用的 canonical selected model。系统 MUST 只为已接受的 request-run 调用产生该投影，并 MUST 把 scope 中的 Owner/Agent/session/request/run/operation coordinates 与该 accepted run/context 作为同一组 facts 校验；可信调用路径决定是否进入 run-bound timeline。时间线 `stepId` MUST 只作为 request run 内的 orchestration grouping key，MUST NOT 被当作 logical invocation id；同一步骤内的多个顺序 logical invocations MUST 复用该值，并由 timeline event identity 和 sequence 区分各 started/terminal event pair。三个事件 MUST 对同一次 logical invocation 使用相同 `stepId` 和 `modelId`。

同一个 orchestration step 内的 initial model invocation、模型边界内部同模型 retry 和 Core 发起的 cross-model fallback MUST 在 scope `operationId` 复用 owning `stepId` 的同一值。同模型 retry MUST 保持在同一个 `MODEL_INVOCATION_STARTED` 与 terminal event 对内；cross-model fallback MUST 产生新的 started/terminal event 对，并以新的 `modelId` 与前一次调用区分。Agent loop、workflow node 或其他绑定 accepted request run 的消费者 MUST 把其 owning orchestration step 已建立的 `stepId` 映射到 scope `operationId` 并携带完整 accepted run coordinates；消费者没有 accepted run step 时 MUST 使用 background invocation path，MUST NOT 为产生 run-bound lifecycle facts 而合成 run coordinates 或 `stepId`。

所有可观察或持久化的 `MODEL_INVOCATION_*` 事实 MUST 使用上述 exact identity shape。background model invocation MUST 执行统一模型边界中的 model hook，但 MUST NOT 进入 run-bound timeline boundary 或产生 request-run `HOOK_INVOKED`/`MODEL_INVOCATION_*` 事实；即使它携带 completed-run causal correlation，其 `operationId` 也 MUST NOT 被投影成 request-run `stepId`。

该安全投影的 identity fields MUST 恰好为 `stepId` 和 `modelId`；endpoint、credential reference、resolved credential、header、custom fetch、provider metadata、raw lifecycle coordinates 和 provider option value MUST 留在 owning boundary。无法从 accepted run step 与可信 selected model 生成 schema-valid identity 时，run-bound invocation MUST 在 provider execution 前安全失败；MUST NOT 使用 default、空字符串或调用方输入伪造 identity。

**需求类别**：系统质量属性
**质量属性**：审计/可追溯性
**适用范围**：该 Function

#### Scenario: 收窄请求后生成模型调用开始事实
- **WHEN** schema-valid run-bound invocation 携带 canonical `modelId`、动态调用输入和完整 accepted run coordinates
- **AND** 该 scope 的 `operationId` 等于 owning orchestration `stepId`
- **THEN** `MODEL_INVOCATION_STARTED.modelId` MUST 等于该 canonical `modelId`
- **AND** 三个 lifecycle events 的 `stepId` MUST 等于该 `operationId`，且 `modelId` MUST 分别相同

#### Scenario: 同一步骤发生跨模型 fallback
- **WHEN** Core 在一个 accepted orchestration step 中对第一次 logical invocation 的安全失败执行 cross-model fallback
- **THEN** fallback invocation MUST 在 scope `operationId` 复用该 owning `stepId` 的同一值
- **AND** fallback invocation MUST 以重新选择结果的 `modelId` 产生新的 started/terminal event 对

#### Scenario: 同一步骤顺序执行多次模型调用
- **WHEN** owning orchestrator 在同一个 accepted orchestration step 中顺序执行多个 logical model invocations
- **THEN** 每次调用 MUST 在 scope `operationId` 复用该 owning `stepId` 的同一值
- **AND** 每个 started/terminal event pair MUST 由各自 event identity 和 sequence 区分

#### Scenario: 非 Agent loop 的 run-bound 消费者调用模型
- **WHEN** workflow node 或其他消费者在 accepted request run 的 owning orchestration step 中调用模型
- **THEN** 它 MUST 把该 owning `stepId` 的同一值作为 `operationId` 与同一 run coordinates 写入 scope
- **AND** 它 MUST 通过同一个 schema-valid scope 交付这些关联事实

#### Scenario: 没有 request-run step 的消费者调用模型
- **WHEN** background consumer 没有 accepted request-run orchestration step
- **THEN** 它 MUST 使用可信 background invocation path
- **AND** scope MUST 以 owning background lifecycle identity 填充 `operationId` 并省略不存在的 run coordinates
- **AND** 它 MUST 执行统一 `ModelInvocationService` 中的 model hook，但 MUST NOT 进入 run-bound timeline boundary 或产生 request-run hook/model 时间线事实

#### Scenario: 调用方尝试伪造可观测 identity
- **WHEN** 不可信 metadata 或未获 lifecycle authority 的 caller 尝试提供或覆盖 scope identity
- **THEN** provider execution MUST 在使用该 identity 前安全失败
- **AND** 时间线 identity 和 provider binding MUST 保持由可信 lifecycle 与 selected model 决定

### Requirement: 模型接入配置只在模型边界内解析

模型调用边界 MUST 根据已选 `modelId` 解析唯一 `ModelProfile` 及其父级 `providerId`，再以该 `providerId` 对可信 provider registry 做 exact lookup，取得唯一 provider implementation、endpoint、credential reference、transport 和其他接入事实，并且 MUST 以同一个 `modelId` 调用命中的 provider。系统 MUST NOT 根据 `providerId` 字符串格式、前缀或其他调用输入推断 provider class。调用方、Agent、Capability、客户端和模型输出 MUST NOT 提供或覆盖 `providerId` 或其他接入事实。模型调用边界 MUST NOT 选择初始模型或 fallback 模型。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 调用可用的 compatible 模型
- **WHEN** 调用请求选择已激活且 `AVAILABLE`、其父级 `providerId` exact lookup 命中 compatible provider registration 的 `modelId`
- **THEN** 模型边界使用该 registration 并把同一 `modelId` 传给 provider

#### Scenario: 调用可用的 Gateway 模型
- **WHEN** 调用请求选择已激活且 `AVAILABLE`、其父级 `providerId` exact lookup 命中 Gateway provider registration 的 `modelId`
- **THEN** 模型边界使用该 registration 的 Gateway invocation capability 并传入同一 `modelId`

#### Scenario: 调用方尝试提供接入配置
- **WHEN** 调用输入包含 `providerId`、provider kind、endpoint、credential、header、custom fetch 或 transport
- **THEN** 这些字段不被接受为调用权威
- **AND** provider execution 不启动

#### Scenario: 已选 provider adapter 不可用
- **WHEN** 私有 binding 无法解析到唯一已装配 adapter
- **THEN** 模型调用返回安全 provider-unavailable failure
- **AND** 不尝试其他模型

### Requirement: OpenAI-compatible 调用遵循统一 Chat Completions 语义

`providerId=openai-compatible` 的 registration MUST 以 Chat Completions 作为非流式与流式调用的唯一 endpoint capability，并 MUST 支持 provider-neutral messages、tools、规格允许的可选顶层推理参数、受控 `providerOptions`、cancellation、effective timeout 和同模型 recoverable retry。provider-specific thinking MUST 只根据该 registration 明确声明的 capability 从 validated 顶层 `ThinkingOptions` 映射，MUST NOT 从 `providerOptions` 建立第二套 reasoning authority。effective `thinking.depth="OFF"` 只有在 provider capability 提供显式关闭映射，或能够保证省略 provider reasoning option 时该模型不会执行 reasoning，才构成安全映射。无法保证请求语义的可选参数 MUST 在 provider access 前安全失败。

**需求类别**：功能性需求

#### Scenario: Compatible 非流式调用
- **WHEN** 调用方执行 `complete(...)`
- **THEN** provider 使用非流式 Chat Completions 能力
- **AND** 结果归一化为公共 `ModelFinalResult`

#### Scenario: Compatible 流式调用
- **WHEN** 调用方执行 `stream(...)`
- **THEN** provider 使用流式 Chat Completions 能力
- **AND** stream 与终态结果使用公共 provider-neutral contract

#### Scenario: Provider 显式支持请求的 thinking depth
- **WHEN** effective optional model parameters 包含 provider capability 已定义 provider-native 映射的 thinking depth
- **THEN** 模型调用边界按该映射生成 provider option
- **AND** provider-native option 只在模型边界内形成

#### Scenario: Provider 缺省行为保证关闭 thinking
- **WHEN** effective optional model parameters 包含 `thinking.depth="OFF"`
- **AND** provider capability 保证省略 provider reasoning option 时 selected model 不执行 reasoning
- **AND** 其他 invocation preconditions 均有效
- **THEN** 模型调用边界 MUST 省略 provider reasoning option 并启动调用
- **AND** 该调用的 thinking 语义为 `OFF`

#### Scenario: Provider 不能表达请求的 thinking 语义
- **WHEN** effective optional model parameters 包含 adapter 无法安全映射的 thinking 值，或包含 `thinking.depth="OFF"` 但 provider capability 不能保证显式关闭或省略后关闭
- **THEN** provider execution 不启动
- **AND** 调用返回安全失败

### Requirement: 模型 transport 通过可选 Gateway fetch 装配

当 `gateway-configuration` 提供 optional `GatewayBindings.fetch` 时，`agent-app` MUST 在 Gateway bindings 完成后把同一 binding 交给本 change 的 OpenAI-compatible provider registration；该 adapter MUST 把它适配到 AI SDK 的 custom fetch，并在 binding 缺失时省略 SDK custom fetch 以使用平台默认 fetch。`agent-model` MUST 只接收 app 适配后的 private fetch function，MUST NOT 依赖 gateway contract subpath。

custom fetch MAY 隔离 HTTPS/mTLS certificate、connection、proxy 或其他运行环境相关 transport 差异，并 MUST 通过 `RequestInit.signal` 接收本次调用 cancellation signal。调用请求、hook、provider options 和其他系统功能 MUST NOT 提供、替换或取得该 binding。模型边界仍只负责集中生成四个固定 correlation headers；本 change MUST NOT 增加 `ModelOutboundHeaderPolicy`、header-policy composition 或额外 custom-header 语义。transport failure MUST 映射为安全模型失败，certificate、private key、credential、endpoint、header value 和 raw transport error MUST NOT 进入公共输出或 observability payload。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 使用可信 custom fetch
- **WHEN** app composition 得到包含 `fetch` 的 trusted `GatewayBindings`
- **THEN** compatible adapter 使用该 Gateway port 执行 Chat Completions request
- **AND** 其他模块和调用请求 MUST NOT 读取或替换该 fetch

#### Scenario: 未装配 custom fetch
- **WHEN** `GatewayBindings.fetch` 缺失
- **THEN** compatible adapter 使用平台默认 fetch
- **AND** LOCAL app startup 不要求该可选 binding

#### Scenario: Custom transport 失败
- **WHEN** custom fetch 因 HTTPS identity、certificate、connection 或其他 transport 原因失败
- **THEN** 模型调用返回安全失败
- **AND** failure 不暴露 certificate、private key、credential、endpoint 或 raw transport error

### Requirement: 可恢复错误按受控次数重试

模型调用边界 MUST 是同模型 retry 的唯一 owner，并 MUST 只对 selected `modelId` 的 provider 或 SDK 明确标记为 recoverable 的错误执行 retry。effective `maxRetries` MUST 按“调用请求的非负整数值、否则 profile 的非负整数默认值、否则固定值 `2`”解析，并表示初始 provider request 之后最多允许的 retry 次数。summary、memory、recommendation、workflow、Core 和其他调用方 MUST 对一次 logical invocation 只调用模型边界一次，MUST NOT 再包裹同模型 retry loop、重置 timeout 或叠加 retry 次数。validation、authentication、unsupported option、invalid tool arguments、normalization failure、cancellation 和其他 non-recoverable failure MUST NOT 重试。

全部 retry 和 backoff MUST 受同一个 cancellation signal、effective timeout 和 execution budget 约束。流式调用产生任何 public delta 后 MUST NOT 重新发起 provider request。模型边界在 retry 耗尽后 MUST 返回当前 `modelId` 的安全失败，MUST NOT 自行选择其他模型；cross-model fallback 仍由受治理的 fallback flow 决定。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: Profile 和请求都未设置 max retries
- **WHEN** `ModelProfile.maxRetries` 和 `ModelInvocationRequest.maxRetries` 均缺失
- **THEN** effective `maxRetries` 为 `2`
- **AND** 最多执行一次初始 provider request 和两次 retry

#### Scenario: 请求覆盖 profile 默认值
- **WHEN** profile 声明非负整数 `maxRetries` 且调用请求声明另一个合法值
- **THEN** 本次调用使用请求值
- **AND** runtime execution budget 继续约束实际可执行次数

#### Scenario: 可恢复失败
- **WHEN** provider request 在尚未产生 public stream delta 时返回明确 recoverable failure
- **AND** cancellation、effective timeout、execution budget 和 effective max retries 允许再次尝试
- **THEN** 模型边界使用同一 `modelId` 和相同有效输入执行 retry

#### Scenario: 不可恢复失败
- **WHEN** failure 未被 provider 或 SDK 明确标记为 recoverable
- **THEN** 模型边界不执行 retry
- **AND** 返回归一化安全失败

#### Scenario: Stream 已产生可见增量
- **WHEN** 流式调用产生至少一个 public delta 后发生失败
- **THEN** 模型边界不重新发起 provider request
- **AND** stream 以一个安全失败终态结束

#### Scenario: 调用方不得叠加同模型 retry
- **WHEN** summary、memory、recommendation、workflow 或 Core 发起一次 logical model invocation
- **THEN** 调用方 MUST 只调用一次 `complete()` 或 `stream()`
- **AND** 全部同模型 retry、backoff 和 request count MUST 由模型边界在同一个 effective timeout 内完成

### Requirement: 成功调用尽量保留 provider usage

成功的非流式和流式终态结果 MUST 尽量保留 provider 报告的 token usage。`ModelFinalResult.usage` 和其中的 `inputTokens`、`outputTokens`、`totalTokens` MUST 保持 optional；provider 报告的每个非负整数值 MUST 原样保留，缺失、不支持或非法的单个值 MUST 被省略。系统 MUST NOT 合成、估算、从其他字段推导或用零填充 usage；usage 缺失、不支持、部分缺失或包含非法字段 MUST NOT 把其他方面成功的模型调用改为失败。

**需求类别**：功能性需求

#### Scenario: Provider 返回完整 usage
- **WHEN** 成功调用返回三个有效 token usage 值
- **THEN** 成功终态结果原样包含三个值

#### Scenario: Provider 返回部分 usage
- **WHEN** 成功调用只返回部分有效 token usage 值
- **THEN** 成功终态结果只包含有效值
- **AND** 系统不推导缺失值

#### Scenario: Provider 不返回或不支持 usage
- **WHEN** 其他方面成功的 provider result 没有 usage
- **THEN** 模型调用仍返回成功终态
- **AND** 终态结果省略 usage

#### Scenario: Provider 返回非法 usage 字段
- **WHEN** 成功结果中的某个 usage 值为负数、小数、非有限数或非数值
- **THEN** 终态结果省略该非法值
- **AND** 其他有效 usage 值和成功模型结果保持不变

### Requirement: 流式输出只暴露完整的 provider-neutral 事实

流式调用 MUST 只发送有序的 provider-neutral content、reasoning 和完整 tool-call delta。provider transport 内部的 tool-call fragments MUST 在模型边界内保持顺序和关联，直到形成带稳定 `toolCallId`、`toolName` 和结构化 JSON arguments 的完整 call；public stream MUST NOT 暴露 fragment、raw chunk 或 provider-native event。同一完整 tool call MUST 按相同顺序出现在终态结果中。无法归一化的 tool arguments 或 stream event MUST 产生恰好一个安全失败终态。

**需求类别**：功能性需求

#### Scenario: Stream 返回文本和 reasoning
- **WHEN** provider stream 报告 content 或 reasoning text
- **THEN** public stream 按接收顺序发送对应 provider-neutral delta

#### Scenario: Tool call 以 fragments 到达
- **WHEN** provider 内部通过多个 fragments 传递 tool call
- **THEN** public stream 不发送 fragments
- **AND** 完整且有效的 tool call 只发送一次，并按同一顺序进入终态结果

#### Scenario: Stream 无法安全归一化
- **WHEN** 完整 tool call arguments 非法或 stream event 无法映射
- **THEN** stream 以一个安全失败终态结束
- **AND** raw provider fact 不被暴露

### Requirement: Agent App system config 使用 canonical model/provider 配置

`DefaultSystemConfig` 的模型配置 MUST 只使用 recursively frozen app-owned `modelProfiles: readonly ModelProviderProfile[]` 与 `modelProfileValidationEvidence: readonly ModelProfileValidationEvidence[]`。每个 closed `ModelProviderProfile` 的 required fields MUST 恰好为唯一 `providerId` 和至少包含一个元素的 `models: readonly ModelProfile[]`；optional fields MUST 恰好为合法 `baseUrl` 和合法 `credentialRef`。产品配置允许的 exact `providerId` MUST 恰好为 `openai-compatible | model-gateway`，语义和装配前置条件由本规格的 `全局模型目录提供安全模型配置` 唯一定义。每个 closed 子 `ModelProfile` 的 required fields MUST 恰好为 `modelId` 和 `fallbackEligible`；optional fields MUST 恰好为 `displayName`、`contextWindowTokens`、`temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`providerOptions`、`timeoutMs` 和 `maxRetries`。子 profile 出现在 `models[]` 中即表示配置并进入后续目录装配。`providerId` MUST NOT 在子 profile 重复出现；全部父项中的 `modelId` MUST 全局唯一。父项和子项 MUST 拒绝显式 `null`、未知字段、重复 identity 和空 `models`。

`ModelProfileValidationEvidence` 的 required fields MUST 恰好为 `modelId`、低基数 `code` 和安全 `message`。`modelProfiles` MUST 保持父项配置顺序与每个父项的子项顺序；模型配置对象、嵌套 inference/provider options、validation evidence 数组及每个 evidence item MUST 在配置校验完成后冻结。Host 若需扁平模型清单、fallback-eligible ids 或 exact model lookup，MUST 直接从该冻结配置快照派生，系统 MUST NOT 为这些无独立生命周期的视图维护第二个 public registry 或 index。

每个父项的 `providerId` MUST 在可信模型 provider registry 中 exact lookup 到恰好一个 registration。该 registration MUST 定义并执行父层 `baseUrl/credentialRef` 的封闭接入校验：需要 `baseUrl` 的 provider 在缺失时 MUST 失败，不支持该字段的 provider 在字段存在时 MUST 失败；支持 credential 的 provider 在 `credentialRef` 缺失时不发送 credential。unknown 或重复 registration MUST 在目录发布前安全失败。provider lookup、冲突消解和 implementation binding MUST 只使用 exact `providerId`。

custom fetch、SDK client 和 transport MUST NOT 进入 system config；模型 adapter 的 custom fetch MUST 只来自 app composition 已完成的 optional `GatewayBindings.fetch`，其余 provider runtime facts MUST 只来自命中 `providerId` 的可信 registration。raw config 环境引用解析 MUST 解析父项的 `baseUrl`、`credentialRef` 和子项的 `modelId`；父项和子项均 MUST 按本 Requirement 的 closed schema 校验。

provider access 校验 MUST 保留既有 fail-fast/degraded-ready 边界。除下一句的受控例外外，任一 model/provider 配置失败 MUST 阻止 ready，MUST NOT 被静默丢弃。唯一受控例外是：某个父项的 `credentialRef` grammar 非法，且其全部 configured 子 profiles 都是 `fallbackEligible=true`，并且排除这些 profiles 后仍至少存在一个 viable configured non-fallback profile；此时系统 MAY 排除全部受影响 profiles 并进入 degraded-ready，采用该例外时 MUST 产生只含相关 `providerId`、`modelId` 和安全 code 的 validation evidence，未采用时 MUST fail closed。父项同时包含任一 configured non-fallback profile、排除后没有 viable profile，或失败属于 duplicate/unknown provider registration、identity、access config、base URL、inference field、provider option、context window 或其他配置错误时，startup MUST fail closed。

**需求类别**：功能性需求

#### Scenario: Provider 父项包含多个模型
- **WHEN** raw system config 在一个 `modelProfiles[]` 父项声明 `providerId`、provider access config 和一个或多个子模型
- **THEN** validated system config MUST 在该父项只保存 raw config 提供且命中的 registration 接受的 optional `baseUrl/credentialRef`
- **AND** 每个 `models[]` 子项 MUST 只保存单一 `modelId`、模型画像、availability input、fallback policy、全部已配置的 provider-neutral 推理参数、`providerOptions`、`timeoutMs` 和 `maxRetries`
- **AND** 所有子模型 MUST 通过父项的同一 `providerId` exact lookup 到同一个可信 provider registration

#### Scenario: 配置存在即进入模型目录
- **WHEN** `models[]` 包含通过 schema、security 和 provider-owned access validation 的子 profile
- **THEN** 该 profile MUST 进入模型目录装配

#### Scenario: 模型 profile 配置全部推理参数
- **WHEN** 子 profile 同时提供合法 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking` 和 `providerOptions`
- **THEN** validated frozen profile MUST 保留全部显式值
- **AND** 模型调用边界 MUST 对 `providerOptions` 执行 selected-provider reserved-field validation，并按 request-over-profile 规则解析 effective values

#### Scenario: 内置默认模型使用明确调用画像
- **WHEN** 系统加载内置 `default-system.yaml` 并完成环境引用解析
- **THEN** 默认子 profile MUST 显式包含 `temperature=0.2`、`maxOutputTokens=2048`、`topP=1` 和 `timeoutMs=120000`
- **AND** catalog 固定默认值 MUST NOT 覆盖这些显式值

#### Scenario: Provider id 不能唯一绑定
- **WHEN** 父项的 `providerId` 未命中可信 provider registration、命中多个 registration，或命中的 registration 拒绝该父项 access config
- **THEN** 系统 MUST 在模型目录发布前安全失败
- **AND** MUST NOT 从字符串前缀、子 profile、环境变量自动发现或其他摘要字段推导 binding

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

### Requirement: 可信 App Host 可读取配置快照但运行期模型功能不依赖它

production `NextAgentApp` MUST 只通过不可变 `systemConfig` 暴露模型配置与 validation evidence，供可信进程内 entrypoint、部署/package host、readiness/release evidence 和 test harness 履行宿主职责。production object MUST NOT 暴露 `modelProfileRegistry`、`productModelProviderKind` 或等价的模型索引/provider-class 摘要；canonical `providerId` MUST 是 provider selection 与 binding 的唯一身份。运行期 model catalog、query 和 binding MUST 使用独立的可信内部依赖。

运行期模型消费者 MUST 只通过本规格定义的安全目录 query 或对应窄化契约取得模型事实，MUST NOT 把上述公共 App 投影当作运行期目录、选择或 provider access 权威。这些字段 MUST 只停留在可信 App Host 边界，MUST NOT 被投影到 Web、stream、模型输入、Capability 输入、持久化 runtime fact 或 observability payload。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 可信 Host 读取配置快照
- **WHEN** 可信 App Host 读取 `NextAgentApp.systemConfig`
- **THEN** 它获得同一个不可变启动配置事实
- **AND** `modelProfiles` 使用父层 `providerId/baseUrl/credentialRef/models` 与子层单一 `modelId` 的 closed two-level config
- **AND** 该读取不向内部功能模块或不可信边界传播完整配置

#### Scenario: 内部功能模块需要模型配置
- **WHEN** Context Engine 或其他内部模型消费者需要模型配置
- **THEN** 它通过窄化模型目录 query 获取安全事实
- **AND** 它不读取 `NextAgentApp.systemConfig`

#### Scenario: 可信 Host 获得公共 App 对象
- **WHEN** 可信 App Host 获得 production `NextAgentApp`
- **THEN** 对象包含 immutable `systemConfig`
- **AND** `systemConfig` 的模型配置与 validation evidence 使用 canonical `modelId` 并保持冻结
- **AND** 对象 MUST NOT 包含 `modelProfileRegistry` 或其他重复模型配置索引
- **AND** 对象 MUST NOT 包含 `productModelProviderKind` 或等价 provider-class 摘要
- **AND** 对象不新增 model catalog/query/binding 公共 API

#### Scenario: Host 需要识别 provider
- **WHEN** 可信 App Host 需要检查已配置 provider
- **THEN** MUST 从 immutable canonical `systemConfig.modelProfiles[].providerId` 读取 provider identity
- **AND** 系统 MUST NOT 提供平行 provider-kind projection

### Requirement: Provider options remain an open selected-provider extension

Optional inner `providerOptions` MAY 为 selected provider 提供未被 canonical 顶层字段表达的推理扩展参数，并 MUST 在各 authoring/invocation contract 中保持 optional non-null `JsonObject`。`providerOptions` 的授权来源 MUST 恰好为：启动期 schema 与安全校验通过的 `ModelProfile.providerOptions`；已编译并选中的 Prompt Template `modelOptions.providerOptions`；受治理 Skill Tool 从 accepted `SkillMetadata.modelOptions.providerOptions` 原样映射并通过 Capability result governance 的 request-local patch；可信 Agent 开发代码在 `ModelInputRenderRequest.providerOptions` 或 `ModelInvocationRequest.providerOptions` 契约边界提供的值；以及已激活且具有 model-invocation transform authority 的 `BEFORE_MODEL_INVOKE` hook 经 mutation schema 校验后产生的 `providerOptions`。Context Engine render、Capability patch consumer 和 lifecycle wrapper 只 carry 已授权值，MUST NOT 构成新的授权来源。调用请求的 `providerOptions` MUST 只表示 inner provider options，MUST NOT 包含 provider namespace。前七个 provider-neutral inference fields 的 effective precedence MUST 固定为 profile、selected Prompt Template、governed Capability patch、trusted request、governed hook，后层逐字段覆盖前层；`providerOptions` MUST 使用相同层次顺序，但 Capability layer MUST 只接受 governed Skill patch，并 MUST 在各层之间执行顶层浅合并，同名嵌套对象 MUST 整体替换，MUST NOT 执行递归合并。

模型调用边界 MUST 根据 selected `modelId` 解析 `providerId`，并把 effective inner provider options 交给 selected adapter 对应的 AI SDK provider namespace。该对象 MUST 保持开放：selected adapter MUST 接受并原样转交未知的 JSON 字段，MUST NOT 使用封闭 schema 或 allowlist 拒绝未来 provider 扩展。AI SDK 明确定义的 provider option MAY 由 SDK 解释，其他字段 MUST 通过 SDK 的 OpenAI-compatible extension path 原样进入 provider-native request。

开放扩展只受 authority collision 约束。provider options MUST 拒绝与 canonical 顶层模型请求字段或最终 provider body authority 重复的字段，包括 model/messages/tools/stream、顶层 inference/thinking controls、timeout/retry，以及 provider identity、endpoint、credential、headers、fetch/transport 和 Owner/Agent scope；比较 MUST 同时覆盖 NextAgent camelCase 名称与 adapter 实际发送的 provider-native 名称。除此之外的未知字段 MUST 被接受。adapter MUST 私下把顶层 `thinking` 映射为 provider-native reasoning option，MUST NOT 在两套值之间选择或合并。不可信 Web/client、RuntimeCommand、Capability 参数、非 Skill Tool Capability result、Skill Tool input/body、history、模型输出或 metadata MUST NOT 直接提供该字段；raw option 值 MUST NOT 进入 error、log、metric、trace、audit 或用户可见输出。

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
- **THEN** 模型边界将其包装到该 adapter 对应的 SDK provider namespace 并交给 provider extension path
- **AND** 调用方不选择或提交 provider namespace

#### Scenario: Adapter 接收未来未知 provider option
- **WHEN** effective provider options 包含当前 NextAgent 和 AI SDK 均未预定义、且不与受保护 authority 冲突的 JSON 字段
- **THEN** provider execution MUST 启动并把该字段和值原样交给 OpenAI-compatible provider request
- **AND** adapter MUST NOT 因字段未知而拒绝调用

#### Scenario: 授权来源携带 provider option
- **WHEN** profile、已编译并选中的 Prompt Template、受治理 Skill metadata patch、可信 Agent 开发代码构造的 `ModelInvocationRequest`，或受治理的 `BEFORE_MODEL_INVOKE` mutation 为本次调用提供结构合法的 provider options
- **THEN** 系统 MUST 将该值送入 effective provider options 合并与 adapter 校验

#### Scenario: Provider option 尝试覆盖受治理字段
- **WHEN** effective provider options 包含受保护的身份、消息、工具、执行、接入或 transport 字段
- **THEN** provider execution 不启动
- **AND** failure 不暴露 option value

#### Scenario: Provider option 重复 thinking authority
- **WHEN** effective provider options 包含 `reasoning`、`thinking`、`reasoningEffort`、`reasoning_effort` 或其他与顶层 `thinking` 语义重复的字段
- **THEN** provider execution MUST NOT 启动
- **AND** adapter MUST NOT 在顶层 `thinking` 与 provider options 之间选择或合并第二套 reasoning authority

#### Scenario: 不可信来源提供 provider option
- **WHEN** Web/client、RuntimeCommand、Capability 参数、非 Skill Tool Capability result、Skill Tool input/body、history、模型输出或不可信 metadata 携带 provider options
- **THEN** 该字段在进入 `ModelInvocationRequest` 前被拒绝

## MODIFIED Requirements

### Requirement: Invocation semantics define one stable invocation capability

本 capability SHALL 通过 NextAgent-owned `ModelInvocationRequest`、`ModelInvocationService`、`ModelStreamDelta` 和 `ModelFinalResult` 定义统一模型调用语义。模型边界 SHALL 把 provider-native 调用和结果转换为该公共边界；public contract MUST NOT 暴露或承诺兼容 provider-native DTO、stream event、option wire shape、error、client object 或 metadata。

**需求类别**：系统质量属性
**质量属性**：可维护性
**适用范围**：该 Function

#### Scenario: Provider 返回 native result
- **WHEN** provider 返回 content、tool call、terminal metadata 或 failure
- **THEN** 模型边界先归一化为 NextAgent-owned contract
- **AND** 上游消费者不消费 provider-native object

#### Scenario: Model Gateway 接收 canonical invocation scope
- **WHEN** selected model 绑定 `providerId=model-gateway` 的 invocation capability
- **THEN** 模型边界 MUST 把已校验的单一 `ModelInvocationScope` 随 canonical request 完整交付给该 provider-private capability
- **AND** Gateway adapter MUST 使用同一 closed scope contract，并把 optional run coordinates 仅作为 correlation facts
- **AND** Gateway adapter MUST 把 scope 限制在 trusted invocation envelope，且 MUST NOT 将其放入下游模型可见消息、tool result 或 provider-native model body

### Requirement: Model invocation is triggered as a request-step execution stage

模型调用 SHALL 在模型选择及适用的 budget/cancellation 校验完成后，于受治理的 request-run 或 background lifecycle 中发生。调用方 MUST 提供已选 `modelId`、真实 invocation scope 以及渲染后的 messages 和 tools；调用方 MAY 提供规格允许的可选顶层推理参数、`providerOptions`、`timeoutMs` 和 `maxRetries`，但 MUST NOT 解析或复制 provider access configuration。受信任 run-bound orchestration MUST 把 owning `stepId` 的同一值作为 `operationId` 与 accepted run coordinates 原子写入单一 scope；owning background lifecycle MUST 把其已冻结 cycle/post-terminal identity 作为 `operationId`，并仅在存在真实相关 run 时携带完整 causal correlation。run-bound/background lifecycle 由可信调用路径决定，MUST NOT 从 scope shape 推断。locale 只用于上游模型选择、prompt template matching 和 rendering，MUST NOT 进入模型调用 request。provider 确有 locale-specific option 时，MUST 只由 selected-adapter reserved-field validated `providerOptions` 表达；本 change 不定义 locale header 或 generic locale 字段。

**需求类别**：功能性需求

#### Scenario: 请求进入模型执行步骤
- **WHEN** 请求进入模型执行 step
- **THEN** 调用方为已选择 `modelId` 提供完整渲染的 `ModelInvocationRequest`
- **AND** 模型边界从自身目录解析 provider access

### Requirement: Target-state request fields are stable invocation inputs

`agent-contracts/model` SHALL 暴露唯一 canonical `ModelInferenceOptions` contract。该 contract MUST 是封闭对象，optional fields MUST 恰好为 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking` 和 `providerOptions`，并 MUST 使用本 Requirement 定义的同名字段约束。Capability patch、Prompt Template 和 Skill metadata 的 `modelOptions` MUST 复用该结构与 runtime validation rules，MUST NOT 建立平行字段集合；source authority MUST 继续由各自 owning Requirement 校验。`ModelProfile` 和 `ModelInvocationRequest` MUST 继续使用 flat fields，MUST NOT 因复用该 vocabulary 新增 nested `modelOptions` wrapper。

`ModelInvocationRequest` SHALL 是封闭对象：required 顶层字段 MUST 恰好为可信 `invocationScope`、`modelId`、`messages` 和 `tools`；optional 顶层字段 MUST 恰好为 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`providerOptions`、正整数 `timeoutMs` 和非负整数 `maxRetries`。单一 scope 的 required `operationId` 及 all-or-none optional run coordinates MUST 由 `Invocation scope represents real lifecycle coordinates` 唯一定义。前七个推理参数 SHALL 按 profile、已编译且选中的 Prompt Template、受治理 Capability patch、可信 request、受治理 hook 的固定 precedence 解析；`providerOptions` SHALL 使用相同层次顺序，但 Capability layer SHALL 只接受受治理 Skill patch。全部适用层均未提供时，`temperature`、`maxOutputTokens` 和 `topP` SHALL 分别使用固定默认值 `0.55`、`32,000` 和 `1`，其余推理参数 SHALL 保持缺失并使用 provider 缺省语义。调用模式 MUST 由 `complete(...)` 或 `stream(...)` 方法选择。

`temperature` SHALL 为 `0..2` 的有限数，`maxOutputTokens` SHALL 为正安全整数，`topP` SHALL 为 `0..1` 的有限数，`topK` SHALL 为正安全整数，`presencePenalty` 和 `frequencyPenalty` SHALL 为 `-2..2` 的有限数；`thinking` SHALL 遵守既有 `ThinkingOptions` contract。`providerOptions` SHALL 为非 null `JsonObject`，`timeoutMs` SHALL 为单位为 ms 的正安全整数，`maxRetries` SHALL 为非负安全整数。显式 `null`、`NaN`、正负无穷和未知字段 SHALL 在 provider access 前被拒绝。请求和 profile 同时提供 `temperature` 与 `topP` 时，两者 SHALL 分别按调用值覆盖 profile 默认值并同时交给能够安全表达该组合的 adapter；adapter 无法安全表达该组合时 SHALL 在 provider access 前失败。

optional request fields MUST 使用以下解析顺序和缺省值：

| Fields | Effective value |
|---|---|
| `temperature` | profile → selected Prompt Template → governed Capability patch → trusted request → governed hook，后层优先；全部缺失时为 `0.55` |
| `maxOutputTokens` | 同一固定 precedence，全部缺失时为 `32,000` |
| `topP` | 同一固定 precedence，全部缺失时为 `1` |
| `topK`、`presencePenalty`、`frequencyPenalty`、`thinking` | 同一固定 precedence；全部缺失时保持缺失并使用 provider 缺省语义，不建立 NextAgent 固定默认值 |
| `providerOptions` | profile、selected Prompt Template、governed Skill patch、trusted request、governed hook 按固定顺序顶层浅合并，后层同名字段覆盖前层且嵌套对象整体替换；其他 Capability patch 不构成该字段来源；全部缺失时不向 provider 传递 provider options，也不合成空对象 |
| `timeoutMs` | governed hook 值优先，其次 trusted request、profile；三层均缺失时为 `30,000 ms`，之后再受 execution budget 剩余时长约束 |
| `maxRetries` | governed hook 值优先，其次 trusted request、profile；三层均缺失时为 `2` |

**需求类别**：功能性需求

#### Scenario: 装配模型调用请求
- **WHEN** 调用方准备 `ModelInvocationRequest`
- **THEN** 请求标识真实 lifecycle scope 和已选 `modelId`
- **AND** 请求不复制 provider identity 或 access field

#### Scenario: Background 调用使用统一 operation identity
- **WHEN** background consumer 准备模型调用
- **THEN** invocation scope MUST 以 owning background lifecycle 的真实 identity 填充 `operationId`
- **AND** session/request/run coordinates MUST 仅在存在真实相关 run 时完整出现

#### Scenario: Locale 在调用前已经消费
- **WHEN** model selection 和 prompt assembly 已使用可信 locale 完成选择与渲染
- **THEN** `ModelInvocationRequest` MUST NOT 包含 locale
- **AND** adapter MUST NOT 依据 generic locale 字段改变 provider request

#### Scenario: 可选推理参数缺失
- **WHEN** 调用请求省略一个或多个可选推理参数
- **THEN** 模型边界使用 selected profile 中存在的对应默认值
- **AND** profile 也未提供 `temperature`、`maxOutputTokens` 或 `topP` 时 MUST 分别使用 `0.55`、`32,000` 或 `1`
- **AND** profile 也未提供其他推理参数时对应参数保持缺失

#### Scenario: 可选推理参数位于边界值
- **WHEN** 调用请求或 selected profile 使用本 Requirement 允许的数值边界
- **THEN** runtime validation 接受该字段
- **AND** 模型调用边界按调用值优先规则解析 effective value

#### Scenario: 可选字段不满足类型或范围
- **WHEN** 调用请求或 selected profile 的可选调用字段为 `null`、非有限数、不满足整数要求或超出本 Requirement 定义的范围
- **THEN** provider execution 不启动
- **AND** 输入产生安全 validation failure

#### Scenario: 调用请求包含封闭 schema 外字段
- **WHEN** 经过 runtime validation 的调用输入包含本 Requirement 未列出的字段
- **THEN** 模型调用边界返回安全 validation failure
- **AND** provider execution 不启动

### Requirement: Invocation preconditions are validated before provider execution

provider execution 开始前，模型调用边界 MUST 校验真实 invocation scope、selected `modelId`、Agent activation、模型可用性、messages、tools、全部可选调用参数、cancellation 和 execution budget。run-bound 调用 MUST 在发布 started fact 前把 scope 的完整 session/request/run/operation coordinates 与 accepted run/context 原子校验；scope shape MUST NOT 决定 lifecycle。模型边界 MUST 在不发生 provider access 的情况下拒绝 unknown、`UNAVAILABLE` 或 non-activated model。

**需求类别**：功能性需求

#### Scenario: 已选模型可调用
- **WHEN** `modelId` 在目录中为 `AVAILABLE`，且属于 invocation scope 标识的 accepted Agent assembly
- **THEN** 调用 MUST 通过该 model profile 的私有 provider binding 继续

#### Scenario: 已选模型不可调用
- **WHEN** `modelId` unknown、`UNAVAILABLE` 或未被 accepted Agent 激活
- **THEN** provider execution 不启动
- **AND** 模型调用返回安全失败

#### Scenario: Budget 禁止执行
- **WHEN** request step 在调用开始前超出允许 budget
- **THEN** provider execution 不启动

### Requirement: Non-streaming and streaming invocation share one terminal result contract

非流式与流式调用 SHALL 收敛到相同 `ModelFinalResult` 语义。`ModelStreamDelta` 表示有序的 provider-neutral 增量事实，`ModelFinalResult` 表示唯一终态。`ModelFinalResult` MUST 为封闭对象：required field MUST 恰好为 `content`；optional fields MUST 恰好为 `reasoning`、`finishReason`、`usage`、`toolCalls`、`providerResponseId` 和 `safeError`。模型身份由对应 `ModelInvocationRequest.modelId` 拥有。provider 返回的 model identity 只作为边界内 normalization input；`providerResponseId` 只用于安全 response correlation。`complete()` MUST 使用 provider 支持的 native non-stream 调用，MUST NOT 聚合 `stream()`。`stream(request, signal, onDelta)` MUST 按顺序 `await` `onDelta` 交付零个或多个 `ModelStreamDelta`，并以 `Promise<ModelFinalResult>` 恰好返回一个终态；终态位置由该 Promise 的完成唯一确定，MUST NOT 把终态混入 delta event union，也 MUST NOT 要求 Core、Workflow 或其他调用方根据重叠字段自行判别最后一个 event。因终态与 delta 已由调用位置分离，流式终态使用与 `complete()` 相同的 `ModelFinalResult` shape，content-only 终态合法，不新增 public discriminator、terminal marker schema 或判断 helper。统一 model runtime MUST 在 hook 和调用方消费前校验 provider service 返回的终态与 delta；非法结果必须安全失败。成功终态 MUST 保留归一化 content、存在时的 reasoning、完整 tool calls、provider-neutral finish reason、存在时的安全 `providerResponseId`，以及 provider 可用时的 best-effort usage。系统 MUST 接受 `finishReason="stop"` 同时携带一个或多个完整 `toolCalls`，并依据非空 `toolCalls` 进入 Tool 分支；系统 MUST NOT 要求该字段只与 `finishReason="tool-calls"` 组合。cancellation、timeout、provider failure 或 normalization failure MUST 产生安全失败终态。

#### Scenario: Stream 调用方不判别终态事件
- **WHEN** provider-neutral stream 依次产生 delta 并完成模型调用
- **THEN** `ModelInvocationService.stream()` MUST 通过 `onDelta` 交付全部增量
- **AND** MUST 通过返回的 Promise 单独交付唯一 `ModelFinalResult`
- **AND** 调用方 MUST NOT 缓存最后一个 delta 或编译 terminal schema 来识别终态

**需求类别**：功能性需求

#### Scenario: 非流式调用完成
- **WHEN** native non-stream provider call 成功
- **THEN** 结果归一化为公共 `ModelFinalResult`
- **AND** 结果 MUST 通过 closed terminal-result schema

#### Scenario: 流式调用完成
- **WHEN** stream 成功结束
- **THEN** `ModelInvocationService.stream()` 返回的 Promise 恰好交付一个成功 `ModelFinalResult`
- **AND** 其语义与非流式成功结果一致

#### Scenario: Provider stream 没有结束事实
- **WHEN** provider stream 在交付零个或多个 delta 后结束，且没有产生 defined `finishReason` 或 provider failure
- **THEN** 模型调用边界 MUST 返回显式安全失败的 `ModelFinalResult`
- **AND** 系统 MUST NOT 把最后一个 delta 解释为成功终态

#### Scenario: Stop 终态同时返回 Tool call
- **WHEN** schema-valid 成功终态包含 `finishReason="stop"` 和一个或多个完整 `toolCalls`
- **THEN** 系统 MUST 保留这些 Tool calls
- **AND** Agent Core MUST 进入既有 Tool 执行与下一轮路径
- **AND** 系统 MUST NOT 仅因 finish reason 不是 `tool-calls` 而拒绝该结果

#### Scenario: Stream 被取消或失败
- **WHEN** cancellation、timeout、provider failure 或 normalization failure 终止 stream
- **THEN** `ModelInvocationService.stream()` 返回的 Promise 恰好交付一个安全失败 `ModelFinalResult`

### Requirement: Profile timeout constrains provider execution

`ModelProfile.timeoutMs` 和 `ModelInvocationRequest.timeoutMs` SHALL 为可选正整数默认值与调用级覆盖值。请求值存在时 MUST 覆盖 profile 默认值；请求值缺失时 MUST 使用 profile 值；两者都缺失时 MUST 使用 NextAgent 配置 schema 的固定默认值 `30,000 ms`。effective timeout MUST 再受当前 execution budget 剩余时长约束，并 MUST 覆盖一次 logical invocation 的 initial provider request、全部 retry 和全部 backoff 的总墙钟耗时；每次 retry 只能获得该总时限的剩余时长，MUST NOT 重置 timeout。cancellation MUST 独立生效；模型边界 SHALL 以该 effective timeout 作为 provider request、retry 和 backoff 的唯一时限机制。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: 请求未提供 timeout
- **WHEN** `ModelInvocationRequest.timeoutMs` 缺失
- **THEN** provider execution 使用已选 profile 的 timeout 默认值
- **AND** profile 也未配置时使用 NextAgent 固定默认值 `30,000 ms`

#### Scenario: 请求覆盖 profile timeout
- **WHEN** request 和 profile 都声明合法 timeout
- **THEN** provider execution 使用 request timeout

#### Scenario: Execution budget 更短
- **WHEN** 当前剩余 execution budget 小于请求或 profile 解析出的 timeout
- **THEN** effective timeout 使用剩余 execution budget

#### Scenario: Effective timeout 到期
- **WHEN** provider execution 超过 effective timeout
- **THEN** 调用按照 safe timeout failure semantics 结束

#### Scenario: Retry 不重置 timeout
- **WHEN** initial provider request 失败后进入 retry
- **THEN** retry 只能使用 logical invocation effective timeout 的剩余时长
- **AND** initial request、backoff 和 retry 的总墙钟耗时 MUST NOT 超过 effective timeout

### Requirement: Failure exits are explicit and safe

模型调用不能产生成功终态时，MUST 通过 `ModelFinalResult.safeError` 返回显式安全失败。模型边界 MUST 在 `AFTER_MODEL_RESULT` hook 和调用方消费前把 `finishReason="content-filter"` 映射为 `category="POLICY_DENIED"`、`retryable=false` 的安全失败，并移除该终态携带的 content、reasoning 和 Tool calls；它 MUST 把没有 `safeError` 的 `finishReason="error"` 映射为没有 recoverability 证据的 non-retryable 安全失败。没有 Tool call 的 `finishReason="unknown"`，以及没有完整 Tool call 的 `finishReason="tool-calls"`，MUST 同样安全失败。已有 `safeError` 的 error 终态 MUST 保留其可信 recoverability classification。模型边界 MUST NOT 暴露 raw provider result、error、endpoint、credential、header、custom fetch 或内部 lifecycle coordinates，也 MUST NOT 在内部切换模型。usage 缺失、不支持或单个 usage 字段非法不属于模型调用失败。本 Requirement 不修改既有 `finishReason="length"` 恢复语义。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: Provider 调用失败
- **WHEN** provider execution 失败
- **THEN** 终态结果携带安全失败
- **AND** 模型边界不调用其他模型

#### Scenario: Provider content filter 阻断终态
- **WHEN** provider 返回 `finishReason="content-filter"`，无论该结果是否同时携带 content、reasoning 或 Tool calls
- **THEN** 模型边界 MUST 在 `AFTER_MODEL_RESULT` hook 和调用方消费前返回 non-retryable `POLICY_DENIED` 安全失败
- **AND** 失败终态 MUST NOT 交付 content、reasoning 或 Tool calls

#### Scenario: Error 终态没有 recoverability 证据
- **WHEN** provider 返回 `finishReason="error"` 且没有 `safeError`
- **THEN** 模型边界 MUST 返回 non-retryable 安全失败
- **AND** Agent Core MUST NOT 仅按 error category 推断可 fallback

#### Scenario: 结束原因与结果不完整
- **WHEN** provider 返回没有 Tool call 的 `finishReason="unknown"`，或没有完整 Tool call 的 `finishReason="tool-calls"`
- **THEN** 模型边界 MUST 返回 non-retryable 安全失败
- **AND** `AFTER_MODEL_RESULT` hook、Tool 执行和 terminal success MUST NOT 启动

#### Scenario: 只有 usage 不完整
- **WHEN** provider output 可安全归一化，但 usage 缺失或部分非法
- **THEN** 模型调用保持成功
- **AND** 终态只省略不可用 usage 字段

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统通过统一的 NextAgent-owned 模型调用能力执行已选择的唯一 `modelId`。Agent App system config 以两层 `modelProfiles` 同时承载 provider access 与其子模型，既有 App 顶层投影继续供可信 Host 使用但不成为运行期 authority。可调用模型、默认调用画像和可用性来自进程内不可变的全局模型目录；`providerId` exact lookup 得到的接入配置、集中式 correlation-header composer 和 app 可选装配的通用 Gateway fetch 在模型边界内被当前 adapter 消费，同一 `modelId` 被传给命中的 provider，流式和非流式调用都返回 provider-neutral 结果；outbound model HTTP request 的 framework-owned correlation headers 恰好为 Agent/Session/Request/Run 四个既有字段，模型调用安全时间线原子使用 canonical identity。
- **依据 Requirements**：`全局模型目录提供安全模型配置`、`Agent App system config 使用 canonical model/provider 配置`、`Invocation scope represents real lifecycle coordinates`、`模型调用时间线使用 canonical identity`、`模型接入配置只在模型边界内解析`、`模型 transport 通过可选 Gateway fetch 装配`、`可信 App Host 可读取配置快照但运行期模型功能不依赖它`、`Invocation semantics define one stable invocation capability`

### 前置条件

- **变更类型**：修改
- **目标内容**：模型选择以及适用的 budget、cancellation 和 execution-state 校验已完成；请求携带单一真实 invocation scope，所选 `modelId` 已由当前 Agent 激活且目录状态为 `AVAILABLE`。run-bound 调用原子携带 accepted session/request/run coordinates 和 owning-step `operationId`；background 调用携带 owning operation identity，并只在存在真实相关 run 时携带完整 causal correlation。
- **依据 Requirements**：`Invocation scope represents real lifecycle coordinates`、`Model invocation is triggered as a request-step execution stage`、`Invocation preconditions are validated before provider execution`

### 输入

- **变更类型**：修改
- **目标内容**：输入使用封闭的 `ModelInvocationRequest`：required 顶层字段为可信 `invocationScope`、已选 `modelId`、provider-neutral messages 和 tools；optional 顶层字段为 temperature、maxOutputTokens、topP、topK、presencePenalty、frequencyPenalty、thinking、受控 providerOptions、timeoutMs 和 maxRetries。单一 scope 必填仅用于关联/审计的 `operationId`，并允许 all-or-none 的真实 session/request/run 关联坐标；scope 与 request 均按上述 closed schema 交付。
- **依据 Requirements**：`Invocation scope represents real lifecycle coordinates`、`模型接入配置只在模型边界内解析`、`Model invocation is triggered as a request-step execution stage`、`Target-state request fields are stable invocation inputs`、`Provider options remain an open selected-provider extension`、`Profile timeout constrains provider execution`、`可恢复错误按受控次数重试`

### 输出

- **变更类型**：修改
- **目标内容**：流式输出只包含有序的 provider-neutral content、reasoning 和完整 tool call delta；流式与非流式共享唯一 closed `ModelFinalResult`，包含归一化 content、可选 reasoning、完整 tool calls、finish reason、可选安全 `providerResponseId` 和可获得时的 best-effort usage，模型身份由对应 request 持有；run-bound 调用的三个 lifecycle events 使用相同 `stepId` 和 canonical `modelId`，同一步骤的 cross-model fallback 以新 `modelId` 形成新的事件对。
- **依据 Requirements**：`模型调用时间线使用 canonical identity`、`成功调用尽量保留 provider usage`、`流式输出只暴露完整的 provider-neutral 事实`、`Invocation semantics define one stable invocation capability`、`Non-streaming and streaming invocation share one terminal result contract`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统在 ready 前冻结已配置模型成员关系、配置顺序和 provider binding，且 Agent assembly publication 不调用 Gateway model-information service；首次安全目录 `list/get` 查询解析目标范围内尚未解析的 Gateway 模型，逐模型冻结 `AVAILABLE | UNAVAILABLE` 结果并复用并发解析。系统在 provider access 前校验 invocation scope、所选模型、Agent 激活、可用性、messages、tools、可选调用参数、cancellation 和 budget；scope 用于内部授权与关联，模型边界为 outbound model HTTP request 集中生成固定的 Agent/Session/Request/Run correlation headers，不接受调用方、hook 或 provider options 提供额外 header；按调用值覆盖 profile 默认值，顶层浅合并 provider options，拒绝 canonical 顶层与 identity/access/transport reserved collision 并透传其他未知 JSON 扩展，以父层 `providerId` exact lookup provider access 与 transport，并把同一 `modelId` 传给 provider。compatible 流式与非流式调用统一使用 Chat Completions，同模型 retry 只处理明确 recoverable failure 且共享总 timeout，provider-native 结果、tool-call fragments、usage 和 canonical 安全时间线 identity 在边界内归一化。
- **依据 Requirements**：`Invocation scope represents real lifecycle coordinates`、`模型调用时间线使用 canonical identity`、`模型接入配置只在模型边界内解析`、`OpenAI-compatible 调用遵循统一 Chat Completions 语义`、`模型 transport 通过可选 Gateway fetch 装配`、`可恢复错误按受控次数重试`、`成功调用尽量保留 provider usage`、`流式输出只暴露完整的 provider-neutral 事实`、`Model invocation is triggered as a request-step execution stage`、`Invocation preconditions are validated before provider execution`、`Provider options remain an open selected-provider extension`

### 结果

- **变更类型**：修改
- **目标内容**：成功调用产生恰好一个 provider-neutral 终态；provider usage 缺失、不支持、部分缺失或单字段非法不改变其他方面成功的结果。cancellation、timeout、retry exhausted、provider、transport 或 normalization failure 产生显式安全终态，不暴露 raw provider 事实、provider options 或 lifecycle coordinates，也不在模型调用边界内切换其他模型。
- **依据 Requirements**：`模型 transport 通过可选 Gateway fetch 装配`、`可恢复错误按受控次数重试`、`成功调用尽量保留 provider usage`、`流式输出只暴露完整的 provider-neutral 事实`、`Non-streaming and streaming invocation share one terminal result contract`、`Provider options remain an open selected-provider extension`、`Failure exits are explicit and safe`

### 量化指标

#### 模型上下文窗口

- **指标名称**：模型上下文窗口
- **变更类型**：修改
- **原值或原口径**：`128,000 token`，状态为当前实现值，来源为 `default-system.yaml`，表示全局统一窗口。
- **目标值或目标口径**：每个 `AVAILABLE` 模型 profile 使用各自的正整数 `contextWindowTokens`，状态为已定义；该字段表示完整上下文窗口，不表示输出上限。`providerId=openai-compatible` 从该 profile 配置取值；`providerId=model-gateway` 从可信 model-information 查询取值。Gateway 查询不能得到唯一合法正整数时，该模型为 `UNAVAILABLE`，不得使用统一默认窗口兜底。
- **单位与测量边界**：单位为 token；适用于每个模型 profile。
- **依据 Requirements**：`全局模型目录提供安全模型配置`

#### 模型调用执行上限

- **指标名称**：模型调用执行上限
- **变更类型**：修改
- **原值或原口径**：`ModelProfile.timeoutMs` 为 required；当前 packaged default profile 配置为 `120,000 ms`，不存在 profile/request 同时缺失时的 fallback 值。
- **目标值或目标口径**：请求提供正整数 `timeoutMs` 时使用请求值；否则使用 profile 的正整数默认值；两者均缺失时使用 NextAgent 配置 schema 的固定默认值 `30,000 ms`。bundled default profile 继续显式配置 `120,000 ms`，其 effective profile default 不因 shape 迁移改变。最终 effective timeout 为上述值与剩余 execution budget 的较小者，并覆盖初始调用、retry 与 backoff 的总耗时。
- **单位与测量边界**：单位为 ms；适用于每次模型调用。
- **依据 Requirements**：`Profile timeout constrains provider execution`

#### 同模型最大重试次数

- **指标名称**：同模型最大重试次数
- **变更类型**：新增
- **原值或原口径**：当前 compatible adapter 显式使用 `maxRetries: 0`，不执行 SDK retry。
- **目标值或目标口径**：请求提供非负整数 `maxRetries` 时使用请求值；否则使用 profile 默认值；两者均缺失时固定为 `2`。该值只计初始 provider request 之后、产生 public stream delta 之前、且 failure 明确 recoverable 的同 `modelId` retry。
- **单位与测量边界**：单位为 retry 次数；适用于每次 `complete()` 或 `stream()` 模型调用，实际次数仍受 cancellation、effective timeout 和 execution budget 限制。
- **依据 Requirements**：`可恢复错误按受控次数重试`

### 接口

- **变更类型**：修改
- **目标内容**：Agent App 配置使用 closed `ModelProviderProfile` 父层和 canonical `ModelProfile` 子层形成唯一两层 `modelProfiles`，production `NextAgentApp` 的模型相关顶层投影只保留包含冻结模型配置与 validation evidence 的 immutable `systemConfig`，删除 `modelProfileRegistry` 与 `productModelProviderKind` 且不新增 catalog/query/binding API。目录使用 app-private `ModelCatalogQueryService.list(signal)` / `get(modelId, signal)` 和封闭 `ModelCatalogEntry`，首次查询按目标范围逐模型解析并冻结 Gateway 模型信息；Gateway provider-private 信息查询使用 `ModelGatewayModelInformationService.get(modelId, signal)`；模型调用统一使用 NextAgent-owned `ModelInvocationRequest`、`ModelInvocationService`、`ModelStreamDelta` 和 `ModelFinalResult`，`complete(...)` 直接返回终态，`stream(request, signal, onDelta)` 按序交付 delta 并通过返回的 Promise 单独交付唯一终态。调用 request 提供受控 provider options，但不暴露 provider-native DTO、event、option wire shape、error、client、metadata 或 transport。
- **依据 Requirements**：`Agent App system config 使用 canonical model/provider 配置`、`可信 App Host 可读取配置快照但运行期模型功能不依赖它`、`全局模型目录提供安全模型配置`、`OpenAI-compatible 调用遵循统一 Chat Completions 语义`、`模型 transport 通过可选 Gateway fetch 装配`、`Invocation semantics define one stable invocation capability`、`Target-state request fields are stable invocation inputs`、`Non-streaming and streaming invocation share one terminal result contract`

### 主规格

- **变更类型**：修改
- **目标内容**：`model-invocation-contract`
- **依据 Requirements**：`Invocation semantics define one stable invocation capability`

### 遗留规格

- **变更类型**：修改
- **目标内容**：`model-provider-adapter` 和 `model-stream-normalization` 继续承载未触及的模型接入与通用流式行为。
- **依据 Requirements**：`模型接入配置只在模型边界内解析`、`流式输出只暴露完整的 provider-neutral 事实`
