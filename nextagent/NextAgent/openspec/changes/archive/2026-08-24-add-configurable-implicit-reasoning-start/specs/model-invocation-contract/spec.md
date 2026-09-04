# model-invocation-contract Specification Delta

## Function

- **所属 Function**：`FN-4.1 调用模型`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 模型 profile 可声明隐式 reasoning 起点

`ModelProfile.reasoningTextMode` MUST 是 optional closed enum，允许值 MUST 恰好为 `EXPLICIT_THINK_TAG | IMPLICIT_OPEN_THINK_TAG`；字段缺失 MUST 等同于 `EXPLICIT_THINK_TAG`，显式 `null` 和未知值 MUST 在模型目录发布前被拒绝。该字段 MUST 只允许用于 `providerId=openai-compatible` 的子 profile；其他 provider profile 携带该字段时，系统 MUST 在模型目录发布前安全失败。

当 selected model 的 effective `reasoningTextMode` 为 `IMPLICIT_OPEN_THINK_TAG` 时，OpenAI-compatible 模型调用 MUST 把 text-level 响应解释为从首个文本字符起即处于 reasoning 状态，并把首个 `</think>` 视为 reasoning 与公开 content 的分界；分界之前的文本 MUST 归一化为 provider-neutral reasoning，分界之后的文本 MUST 归一化为 provider-neutral content。流式标签跨任意增量边界时 MUST 保持相同结果。非流式与流式调用 MUST 使用相同分界语义。

当字段缺失或值为 `EXPLICIT_THINK_TAG` 时，系统 MUST 保持原生 reasoning 字段与显式 `<think>...</think>` 文本归一化行为，并 MUST NOT 把无显式 reasoning 证据的普通 content 解释为 reasoning。`reasoningTextMode` MUST 只来自可信启动模型配置，MUST NOT 进入 `ModelInvocationRequest`、`providerOptions`、模型输入、Web 请求、runtime command、Capability 参数或 hook mutation。

**需求类别**：功能性需求

#### Scenario: 隐式起点流式响应完成归一化
- **WHEN** 一个 OpenAI-compatible 子 profile 配置 `reasoningTextMode=IMPLICIT_OPEN_THINK_TAG`
- **AND** provider stream 依次返回 `分析过程`、`</thi`、`nk>最终答案`
- **THEN** public stream 和成功终态 MUST 把 `分析过程` 归一化为 reasoning
- **AND** MUST 把 `最终答案` 归一化为 content
- **AND** MUST NOT 在公开 content 中保留任一 think 标签

#### Scenario: 隐式起点非流式响应完成归一化
- **WHEN** 一个 OpenAI-compatible 子 profile 配置 `reasoningTextMode=IMPLICIT_OPEN_THINK_TAG`
- **AND** native non-stream response text 为 `分析过程</think>最终答案`
- **THEN** `ModelFinalResult.reasoning` MUST 为 `分析过程`
- **AND** `ModelFinalResult.content` MUST 为 `最终答案`

#### Scenario: 未配置时保持显式模式
- **WHEN** OpenAI-compatible 子 profile 缺失 `reasoningTextMode`
- **AND** provider 返回普通 content 或显式 `<think>分析过程</think>最终答案`
- **THEN** 普通 content MUST 保持 content
- **AND** 显式标签内文本 MUST 归一化为 reasoning
- **AND** 标签之后文本 MUST 归一化为 content

#### Scenario: 不支持的 provider 配置隐式模式
- **WHEN** `providerId=model-gateway` 的子 profile 携带任一 `reasoningTextMode`
- **THEN** 应用 MUST 在模型目录发布前安全失败
- **AND** MUST NOT 启动该 profile 的 provider execution

#### Scenario: 配置值非法
- **WHEN** 子 profile 的 `reasoningTextMode` 为显式 `null`、未知字符串或非字符串值
- **THEN** 应用 MUST 在模型目录发布前安全失败

## MODIFIED Requirements

### Requirement: Agent App system config 使用 canonical model/provider 配置

`DefaultSystemConfig` 的模型配置 MUST 只使用 recursively frozen app-owned `modelProfiles: readonly ModelProviderProfile[]` 与 `modelProfileValidationEvidence: readonly ModelProfileValidationEvidence[]`。每个 closed `ModelProviderProfile` 的 required fields MUST 恰好为唯一 `providerId` 和至少包含一个元素的 `models: readonly ModelProfile[]`；optional fields MUST 恰好为合法 `baseUrl` 和合法 `credentialRef`。产品配置允许的 exact `providerId` MUST 恰好为 `openai-compatible | model-gateway`，语义和装配前置条件由本规格的 `全局模型目录提供安全模型配置` 唯一定义。每个 closed 子 `ModelProfile` 的 required fields MUST 恰好为 `modelId` 和 `fallbackEligible`；optional fields MUST 恰好为 `displayName`、`contextWindowTokens`、`temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`providerOptions`、`reasoningTextMode`、`timeoutMs` 和 `maxRetries`。子 profile 出现在 `models[]` 中即表示配置并进入后续目录装配。`providerId` MUST NOT 在子 profile 重复出现；全部父项中的 `modelId` MUST 全局唯一。父项和子项 MUST 拒绝显式 `null`、未知字段、重复 identity 和空 `models`。

`ModelProfileValidationEvidence` 的 required fields MUST 恰好为 `modelId`、低基数 `code` 和安全 `message`。`modelProfiles` MUST 保持父项配置顺序与每个父项的子项顺序；模型配置对象、嵌套 inference/provider options、validation evidence 数组及每个 evidence item MUST 在配置校验完成后冻结。Host 若需扁平模型清单、fallback-eligible ids 或 exact model lookup，MUST 直接从该冻结配置快照派生，系统 MUST NOT 为这些无独立生命周期的视图维护第二个 public registry 或 index。

每个父项的 `providerId` MUST 解析到恰好一个受信 provider access。该 provider access MUST 对父层 `baseUrl/credentialRef` 执行封闭校验：需要 `baseUrl` 的 provider 在缺失时 MUST 失败，不支持该字段的 provider 在字段存在时 MUST 失败；支持 credential 的 provider 在 `credentialRef` 缺失时不发送 credential。unknown 或重复 provider access MUST 在目录发布前安全失败，且解析 MUST 只使用 exact `providerId`。

custom fetch、provider SDK client 和 transport MUST NOT 进入 system config；模型调用使用的 custom fetch MUST 只来自 trusted gateway configuration 的 optional `GatewayBindings.fetch`，其余 provider runtime facts MUST 只来自 `providerId` 对应的受信 provider access。raw config 环境引用解析 MUST 解析父项的 `baseUrl`、`credentialRef` 和子项的 `modelId`；父项和子项均 MUST 按本 Requirement 的 closed schema 校验。

provider access 校验 MUST 遵守 fail-fast/degraded-ready 边界。除下一句的受控例外外，任一 model/provider 配置失败 MUST 阻止 ready，MUST NOT 被静默丢弃。唯一受控例外是：某个父项的 `credentialRef` grammar 非法，且其全部 configured 子 profiles 都是 `fallbackEligible=true`，并且排除这些 profiles 后仍至少存在一个 viable configured non-fallback profile；此时系统 MAY 排除全部受影响 profiles 并进入 degraded-ready，采用该例外时 MUST 产生只含相关 `providerId`、`modelId` 和安全 code 的 validation evidence，未采用时 MUST fail closed。父项同时包含任一 configured non-fallback profile、排除后没有 viable profile，或失败属于 duplicate/unknown provider access、identity、access config、base URL、inference field、provider option、context window 或其他配置错误时，startup MUST fail closed。

**需求类别**：功能性需求

#### Scenario: Provider 父项包含多个模型
- **WHEN** raw system config 在一个 `modelProfiles[]` 父项声明 `providerId`、provider access config 和一个或多个子模型
- **THEN** validated system config MUST 在该父项只保存 raw config 提供且对应 provider access 接受的 optional `baseUrl/credentialRef`
- **AND** 每个 `models[]` 子项 MUST 只保存单一 `modelId`、模型画像、availability input、fallback policy、全部已配置的 provider-neutral 推理参数、`providerOptions`、`reasoningTextMode`、`timeoutMs` 和 `maxRetries`
- **AND** 所有子模型 MUST 通过父项的同一 `providerId` exact lookup 到同一个可信 provider access

#### Scenario: 配置存在即进入模型目录
- **WHEN** `models[]` 包含通过 schema、security 和 provider-owned access validation 的子 profile
- **THEN** 该 profile MUST 进入模型目录装配

#### Scenario: 模型 profile 配置全部推理参数
- **WHEN** 子 profile 同时提供合法 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`providerOptions` 和 `reasoningTextMode`
- **THEN** validated frozen profile MUST 保留全部显式值
- **AND** 模型调用边界 MUST 对 `providerOptions` 执行 selected-provider reserved-field validation，并按 request-over-profile 规则解析 effective values

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

### 处理过程

- **变更类型**：修改
- **目标内容**：系统按可信模型 profile 选择 reasoning 文本分帧模式，并把 OpenAI-compatible 模型输出归一化为一致的 reasoning 与公开 content；未配置模型保持既有行为。
- **依据 Requirements**：`模型 profile 可声明隐式 reasoning 起点`、`Agent App system config 使用 canonical model/provider 配置`

### 输出

- **变更类型**：修改
- **目标内容**：流式与非流式模型结果对隐式 reasoning 起点使用同一 reasoning/content 分界，公开 content 不包含 think 标签。
- **依据 Requirements**：`模型 profile 可声明隐式 reasoning 起点`

### 规格

- **规格项**：Reasoning 文本分帧
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：每个 OpenAI-compatible 模型支持缺省 `EXPLICIT_THINK_TAG` 与显式配置 `IMPLICIT_OPEN_THINK_TAG`；其他 provider 不接受该配置
- **依据 Requirements**：`模型 profile 可声明隐式 reasoning 起点`、`Agent App system config 使用 canonical model/provider 配置`
