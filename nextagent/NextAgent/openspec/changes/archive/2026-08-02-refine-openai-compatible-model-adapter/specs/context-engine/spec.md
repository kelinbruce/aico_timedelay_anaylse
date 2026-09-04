## Function

- **所属 Function**：`FN-4.3 装配上下文`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Model selection uses Agent-activated model configurations

当主 Agent 执行、summary 生成、memory 提取、建议问题生成或 workflow model node 需要模型时，`ModelSelectionService` MUST 是唯一模型选择契约，并 MUST 恰好提供 `select(request: ModelSelectionRequest, signal: AbortSignal): Promise<ModelSelectionResult>`。

`ModelSelectionRequest` MUST 是封闭对象，required fields MUST 恰好为既有 canonical `identityContext`、`agentId`、`agentVersion`、`agentAssemblyRef`、`purpose`、`flowVariables` 和 `mode`，optional fields MUST 恰好为 `locale`、`modelId` 和 `attemptedModelIds`。`identityContext` MUST 复用 `agent-common` 既有 closed `IdentityContext` contract；selection 只使用其中的 trusted `tenantId/subjectId` 执行 Owner Scope 校验，`displayName` 不参与选择。`agentId`、`agentVersion` 和 `agentAssemblyRef` MUST 来自同一 accepted Agent assembly，去除首尾空白后 MUST 非空、长度为 `1..256` 个 Unicode code point 且不含控制字符。`purpose` MUST 匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`；`flowVariables` MUST 为 own-key string-to-string record，数组、`null` 或任一非 string value MUST 被拒绝；optional `locale` MUST 是去除首尾空白后长度为 `1..64` 个 Unicode code point 且不含控制字符的字符串；optional `modelId` 和每个 attempted id MUST 使用模型调用契约的 `modelId` scalar constraint。`mode` MUST 恰好为 `INITIAL | FALLBACK`，并且只表达本次选择是首次选择还是一次显式的跨模型 fallback 选择；它 MUST NOT 表达 provider 类型、调用流式模式、模型能力或 routing policy。`attemptedModelIds` 存在时 MUST 保持输入顺序且 MUST NOT 包含重复 id。显式 `null` 和未知字段 MUST 在选择前被拒绝。

`ModelSelectionResult` MUST 是封闭判别联合。`status="SELECTED"` MUST 额外要求 immutable `configuration: ResolvedModelConfiguration` 和 `reason`，MUST NOT 包含 `failureReason`；该 `configuration` MUST 原样复用命中 `ModelCatalogEntry.availability="AVAILABLE"` 的 frozen `configuration`，MUST NOT 再包装、复制或重命名模型身份。成功 `reason` MUST 恰好为 `EXPLICIT_MODEL_ID | AGENT_DEFAULT | FIRST_ELIGIBLE | FALLBACK_NEXT_ELIGIBLE`。`status="FAILED"` MUST 额外要求 `failureReason`，MUST NOT 包含 `configuration` 或 `reason`；`failureReason` MUST 恰好为 `AGENT_ASSEMBLY_MISMATCH | MODEL_ID_NOT_ELIGIBLE | NO_AVAILABLE_MODEL | FALLBACK_ATTEMPTED_MODEL_NOT_ACTIVATED | FALLBACK_EXHAUSTED`。两个分支 MUST 拒绝 `null`、未知字段和混合字段。required cancellation signal 被取消时，`select` MUST 按统一 cancellation 语义结束，MUST NOT 返回 partial selection 或把取消映射为某个 domain failure reason。

服务 MUST 按 accepted Agent assembly 的 `modelIds` 顺序查询安全全局模型目录，只保留 `AVAILABLE` 且满足可信 prompt、capability、constraint 和 fallback 条件的 activated models，并返回恰好一个 selected configuration 或上述显式安全失败。Agent assembly publication MUST 已按冻结的 `systemConfig.modelProfiles` 拒绝目录外 activated `modelId`；selection MUST 信任 accepted Assembly 的该不变量，MUST NOT 通过额外 membership port 重复校验。目录中已知但 `UNAVAILABLE` 的 activated model MUST 被排除，而 MUST NOT 阻塞其他可用模型。调用方 MUST NOT 把 `providerId`、endpoint、credential、context window、provider options、preselected route 或 candidate list 作为选择权威提交。

当 context assembly 触发 summary generation 时，`TraceableSummaryGenerationRequest.flowVariables` MUST 是 required own-key string-to-string map，并 MUST 携带当前 `ContextAssemblyRequest.flowVariables` 的全部 string entries；当前请求省略 `flowVariables` 时，该 required 字段 MUST 为空 map。Summary model selection 和 prompt assembly MUST 使用这些 entries，MUST NOT 把非空输入视为空 map。

**需求类别**：功能性需求

#### Scenario: Agent 默认模型可用且符合条件
- **WHEN** accepted Agent 的 `defaultModelId` 为 `AVAILABLE` 且通过全部可信过滤
- **THEN** initial selection 选择该模型
- **AND** reason code 为 `AGENT_DEFAULT`，除非受治理 `modelId` 是显式选择权威

#### Scenario: Agent 默认模型不可用
- **WHEN** default model 为 `UNAVAILABLE` 或被可信过滤排除
- **THEN** initial selection 按 Agent 声明顺序选择第一个剩余 `AVAILABLE` model
- **AND** reason code 为 `FIRST_ELIGIBLE`

#### Scenario: Activated model 已知但不可用
- **WHEN** activated model list 包含一个 `UNAVAILABLE` model 和至少一个符合条件的 `AVAILABLE` model
- **THEN** selection 排除不可用模型并继续选择可用模型

#### Scenario: 没有可用候选
- **WHEN** 全部 activated models 均为 `UNAVAILABLE` 或被可信过滤排除
- **THEN** selection 返回显式安全失败
- **AND** failure reason 为 `NO_AVAILABLE_MODEL`
- **AND** 模型调用不启动

#### Scenario: Agent assembly reference 不匹配
- **WHEN** selection request 的 `agentAssemblyRef` 与 resolved accepted assembly 不同
- **THEN** selection 安全失败
- **AND** failure reason 为 `AGENT_ASSEMBLY_MISMATCH`
- **AND** 不使用 active、latest 或 default assembly

#### Scenario: 显式 Model id 不可选
- **WHEN** 受治理 `modelId` 不属于 accepted Agent 的 eligible activated set
- **THEN** selection MUST 返回 `FAILED`
- **AND** failure reason MUST 为 `MODEL_ID_NOT_ELIGIBLE`

#### Scenario: Initial selection 省略可选字段
- **WHEN** `INITIAL` selection request 省略 `modelId`、`locale` 和 `attemptedModelIds`
- **THEN** selection MUST NOT 施加显式 model-id 或 locale filter
- **AND** accepted Agent 声明合法 `defaultModelId` 时 MUST 优先选择该模型
- **AND** `defaultModelId` 也缺失时 MUST 选择 `modelIds` 顺序中的第一个 eligible model

#### Scenario: 辅助模型消费者需要模型
- **WHEN** summary、memory、建议问题或 workflow model node 需要模型
- **THEN** 该消费者通过 `ModelSelectionService` 请求选择
- **AND** 该消费者不自行查询全局目录或选择 default/first model
- **AND** summary generation MUST 将当前 `ContextAssemblyRequest` 的 trusted string-only `flowVariables` 用于本次 model selection 和随后 prompt assembly；非空输入 MUST NOT 被视为空映射
- **AND** locale 只用于 selection 和 prompt assembly，不进入 `ModelInvocationRequest`
- **AND** 该消费者对一次 logical invocation 只调用模型边界一次，不包裹同模型 retry

#### Scenario: 不可信调用方尝试控制选择
- **WHEN** Web 请求、RuntimeCommand、Capability 参数、模型输出或 metadata 携带模型选择控制
- **THEN** 这些字段不被接受为可信选择输入

#### Scenario: 不可信调用方提供模型调用参数
- **WHEN** Web/client、RuntimeCommand、Capability 参数、非 Skill Tool Capability result、模型输出或不可信 metadata 携带内部调用参数或 provider options
- **THEN** Context Engine 不把这些字段加入 `RenderedModelInput`
- **AND** 既有 public `RequestModelOptions.thinking.depth="OFF"` 继续按其独立受治理契约处理

#### Scenario: Selection request 不满足封闭 schema
- **WHEN** request 包含未知字段、`null`、非 string flow variable、重复 attempted id 或非法 mode
- **THEN** selection MUST 在目录查询前拒绝该 request
- **AND** 不返回伪造的 `ModelSelectionResult`

#### Scenario: Selection 被取消
- **WHEN** required cancellation signal 在 selection 完成前被取消
- **THEN** selection MUST 按统一 cancellation 语义结束
- **AND** 不返回 partial candidate 或 `FAILED` domain result

### Requirement: 上下文预算使用所选模型的已解析窗口

Context assembly MUST 使用本次 selection attempt 返回的 `AVAILABLE` model configuration 中的正整数 `contextWindowTokens` 计算 input budget。`contextWindowTokens` MUST 表示完整模型上下文窗口，effective `maxOutputTokens` MUST 表示单次输出上限。profile、prompt template、Capability patch 和其他受治理调用覆盖均未提供 `maxOutputTokens` 时，Context assembly MUST 使用模型调用契约的固定默认值 `32,000` 预留输出预算；MUST NOT 按 `0`、provider 隐式值或当前 input size 猜测。effective `maxOutputTokens` 未给完整输入留出正数预算时，Context assembly MUST 在 provider access 前安全失败。上下文窗口值 MUST 来自模型目录。当 fallback 选择不同 `modelId` 时，下一次 assembly MUST 使用新模型的 resolved window 和重新解析的 effective `maxOutputTokens` 计算 budget。

**需求类别**：功能性需求

#### Scenario: Initial selection 计算预算
- **WHEN** context assembly 完成 initial model selection
- **THEN** input budget 使用该 selected configuration 的 resolved context window
- **AND** 没有受治理 `maxOutputTokens` 覆盖时 MUST 预留固定默认值 `32,000`

#### Scenario: Fallback 选择不同窗口的模型
- **WHEN** fallback selection 返回 context window 不同的模型
- **THEN** 新 assembly 使用 fallback 模型的窗口重新计算 capacity
- **AND** 不复用前一模型的 budget

#### Scenario: 上游尝试覆盖窗口
- **WHEN** 非目录输入携带 context-window value
- **THEN** Context Engine 不把该值作为预算权威

### Requirement: Fallback selection recomputes model-specific context

`ModelSelectionRequest.mode` MUST 为 required。`INITIAL` mode MUST 要求 `attemptedModelIds` 缺失；`FALLBACK` mode MUST 要求至少一个 attempted `modelId`，校验每个 attempted id 都属于 accepted Agent 的 activated set，排除全部 attempted ids，并只保留 `AVAILABLE` 且 `fallbackEligible=true` 的模型。Context Engine MUST 按 Agent 声明顺序选择第一个剩余 eligible model，并针对新模型重新执行 prompt compatibility、effective optional model parameters、context-window budget、compaction 和 render。

`ContextAssemblyOptions` MUST 是 optional closed object；options 缺失 MUST 表示 `INITIAL`。options 存在时 required field MUST 恰好为 `mode`，optional field MUST 恰好为 `attemptedModelIds`，并 MUST 复用 `ModelSelectionRequest` 的 mode、id、顺序、唯一性和 `INITIAL | FALLBACK` 组合约束。`ContextEnginePort.assemble` 的目标 signature MUST 恰好为 `assemble(request: ContextAssemblyRequest, options: ContextAssemblyOptions | undefined, signal: AbortSignal): Promise<ContextAssembly>`。显式 `null`、unknown field、`INITIAL` 携带 attempted ids 或 `FALLBACK` 缺少非空 attempted ids MUST 在 history、prompt、目录或 provider access 前失败；required signal 被取消时，assembly MUST 按统一 cancellation 语义结束，不返回 partial `ContextAssembly`。

**需求类别**：功能性需求

#### Scenario: Fallback 选择下一个可用模型
- **WHEN** fallback mode 包含有效 attempted ids，且存在未尝试的 available fallback-eligible activated model
- **THEN** selection 按 Agent 声明顺序选择第一个此类模型
- **AND** assembly 为该模型重新预算并渲染输入
- **AND** reason code 为 `FALLBACK_NEXT_ELIGIBLE`

#### Scenario: Attempted id 未激活
- **WHEN** fallback mode 包含不属于 accepted Agent activated set 的 id
- **THEN** selection 安全失败
- **AND** failure reason 为 `FALLBACK_ATTEMPTED_MODEL_NOT_ACTIVATED`

#### Scenario: Fallback 候选耗尽
- **WHEN** 没有未尝试的 available fallback-eligible model
- **THEN** selection 返回显式安全耗尽结果
- **AND** failure reason 为 `FALLBACK_EXHAUSTED`
- **AND** 不选择全局模型或未激活模型

#### Scenario: 客户端尝试发起 fallback 选择
- **WHEN** 客户端、runtime command、Capability result 或模型输出携带 fallback selection control
- **THEN** 这些 control 不被接受为选择权威

#### Scenario: Context assembly options 缺失
- **WHEN** trusted caller 以 `options=undefined` 请求 context assembly
- **THEN** Context Engine MUST 使用 `INITIAL` mode
- **AND** selection request MUST NOT 包含 attempted ids

#### Scenario: Context assembly options 组合非法
- **WHEN** `INITIAL` options 携带 attempted ids，或 `FALLBACK` options 缺少非空 attempted ids
- **THEN** assembly MUST 在读取 history、prompt 或模型目录前失败

## MODIFIED Requirements

### Requirement: Context Engine separates assembly from rendering

Context Engine SHALL 把可信 scope、accepted Agent assembly、模型选择、history、prompt、capability visibility 和 budget 决策组装为 `ContextAssembly`，再把该 assembly 渲染为 provider-neutral `RenderedModelInput`。`ContextAssembly` SHALL 携带 render 所需决策和既有执行坐标；`RenderedModelInput` SHALL 携带 model-consumable messages、tools、selected safe model information 和 effective optional model parameters。Context Engine MUST 对前七个 provider-neutral inference fields 按 selected safe profile configuration、已编译且选中的 Prompt Template、受治理 Capability patch、可信 render request 的顺序产生 pre-hook effective value，后层逐字段覆盖前层。`ModelInputRenderRequest.providerOptions` MUST 只携带 `Provider options remain an open selected-provider extension` 所定义的 trusted request 来源；Context Engine MUST 对 call-level `providerOptions` 按已编译且选中的 Prompt Template、受治理 Skill patch、可信 render request 的顺序顶层浅合并，同名嵌套对象整体替换，并将结果交给 `RenderedModelInput.providerOptions`。这三个 call-level 授权来源均缺失时 MUST 保持该字段缺失，MUST NOT 合成空对象。受治理 Skill Tool context patch `modelOptions.providerOptions` MUST 来自 accepted Skill metadata。Context Engine MUST NOT 读取或暴露 private profile `providerOptions`；模型调用边界 MUST 按模型调用契约把 private profile defaults 置于 call-level composite 之前，并把 governed hook 置于其后。Context Engine MUST NOT 从 history、Capability 参数、非 Skill Tool Capability result、模型输出或 metadata 派生 provider options。`ContextAssembly` 和 `RenderedModelInput` MUST NOT 包含 `providerId`、endpoint、credential reference、custom fetch、SDK type 或模型目录的私有 binding。

`ContextAssemblyRequest` MUST 继续携带 request/run 已接受的 required trusted `identityContext`，并 MUST 使用它执行 owner-scoped context queries；调用方、Capability result、模型输出或 metadata MUST NOT 覆盖该字段，系统 MUST NOT 为其维护平行的 request-local owner side map。受治理的 `contextPatch.modelId` 和 closed `modelOptions` MAY 只影响同一 request/run 的后续 assembly；其中 `modelOptions.providerOptions` MUST 只接受 Capability contract 定义的 governed Skill source。Capability patch MUST 通过 `capability-catalog` 定义的 closed schema 和 source governance；provider access、timeout 和 retry controls 保持由 owning boundaries 管理。

**需求类别**：功能性需求

#### Scenario: Context assembly 完成
- **WHEN** Context Engine 完成 assembly
- **THEN** 结果包含 governed system prompt、selected immutable message refs、accepted execution coordinates、visible capabilities、selected safe model information、effective optional model parameters 和 selection reason
- **AND** 结果不包含 provider access configuration 或最终 rendered messages

#### Scenario: Model input 被渲染
- **WHEN** Context Engine render 一个有效 `ContextAssembly`
- **THEN** selected refs 和 current request 被解析为 provider-neutral messages
- **AND** visible capabilities 被投影为 provider-neutral tools
- **AND** 输出包含 selected safe model information 和 effective optional model parameters
- **AND** 输出不包含完整 `ContextAssembly`、模型目录私有 binding 或 provider-native object

#### Scenario: 渲染输入合并已授权 provider options
- **WHEN** 已编译且选中的 Prompt Template、受治理 Skill patch 或 `ModelInputRenderRequest.providerOptions` 中一个或多个 call-level 授权来源携带 provider options
- **THEN** `RenderedModelInput.providerOptions` MUST 按 template、Skill、trusted request 的顺序顶层浅合并
- **AND** 后层同名顶层字段 MUST 覆盖前层，嵌套对象 MUST 整体替换
- **AND** Context Engine MUST NOT 增加 provider namespace、private profile defaults 或接入字段

#### Scenario: 渲染输入未携带已授权 provider options
- **WHEN** 全部 call-level 授权来源均缺失 provider options，或 provider options 只出现在 history、Capability 参数、非 Skill Tool Capability result、模型输出或不可信 metadata
- **THEN** `RenderedModelInput` MUST 省略 provider options

#### Scenario: Context assembly 使用 request-carried identity
- **WHEN** Context Engine 为 accepted request/run 执行 assembly
- **THEN** owner-scoped query MUST 使用 `ContextAssemblyRequest.identityContext`
- **AND** Capability result 或其他不可信输入 MUST NOT 覆盖 owner scope

#### Scenario: Capability 显式模型选择进入后续 assembly
- **WHEN** 同一 request/run 的 schema-valid `contextPatch.modelId` 已通过模型选择治理
- **THEN** 后续 assembly MAY 将它作为 `ModelSelectionRequest.modelId`
- **AND** model selection MUST 使用该 exact canonical `modelId`

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统为主 Agent 和辅助模型消费者选择当前 Agent 已激活的安全模型配置，按所选模型的窗口装配预算，并把装配结果渲染为 provider-neutral 模型输入。
- **依据 Requirements**：`Model selection uses Agent-activated model configurations`、`上下文预算使用所选模型的已解析窗口`、`Context Engine separates assembly from rendering`

### 前置条件

- **变更类型**：修改
- **目标内容**：请求具有可信 Owner/Agent scope 和 accepted Agent assembly；fallback selection 还必须包含至少一个属于该 Agent 激活集合的 attempted model id。
- **依据 Requirements**：`Model selection uses Agent-activated model configurations`、`Fallback selection recomputes model-specific context`

### 输入

- **变更类型**：修改
- **目标内容**：输入包含可信 scope、purpose、locale、排除原始用户问题 `input_question` 后的 trusted string flow variables、可选受治理 `modelId`、`INITIAL | FALLBACK` selection mode、attempted model ids，以及装配所需的 history、prompt 和 capability visibility。调用方不得提交 provider identity、endpoint、credential、context window、预选 route 或 candidate list；可选 provider options 只接受模型调用契约定义的授权来源。
- **依据 Requirements**：`Model selection uses Agent-activated model configurations`、`上下文预算使用所选模型的已解析窗口`、`Fallback selection recomputes model-specific context`、`Context Engine separates assembly from rendering`

### 输出

- **变更类型**：修改
- **目标内容**：先输出包含所选安全模型信息、selection reason、预算决策、消息引用、可见能力和执行坐标的 `ContextAssembly`，再输出包含 provider-neutral messages、tools、所选安全模型信息、有效可选模型参数，以及在 `ModelInputRenderRequest` 提供时原样携带的已授权 provider options 的 `RenderedModelInput`；两者均不包含 provider 接入或 transport 事实。
- **依据 Requirements**：`Model selection uses Agent-activated model configurations`、`Fallback selection recomputes model-specific context`、`Context Engine separates assembly from rendering`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统按 accepted Agent 声明顺序筛选已激活且 `AVAILABLE` 的模型，完成显式 `modelId`、prompt 和 capability compatibility 判断；随后使用所选模型窗口计算预算、执行必要压缩并渲染输入。fallback 时排除已尝试模型，只选择 `fallbackEligible=true` 的下一模型，并为新模型重新执行兼容性判断、预算、压缩和渲染。
- **依据 Requirements**：`Model selection uses Agent-activated model configurations`、`上下文预算使用所选模型的已解析窗口`、`Fallback selection recomputes model-specific context`、`Context Engine separates assembly from rendering`

### 结果

- **变更类型**：修改
- **目标内容**：成功时返回恰好一个不可变的模型选择和对应渲染输入；activated id 未知、assembly reference 不匹配、没有可用候选或 fallback 候选耗尽时显式安全失败，不选择其他 Agent、全局默认模型或未激活模型，也不启动模型调用。
- **依据 Requirements**：`Model selection uses Agent-activated model configurations`、`Fallback selection recomputes model-specific context`

### 量化指标

- **指标名称**：历史上下文预算占比
- **变更类型**：测量口径调整
- **原值或原口径**：目标为 `≤ 60% 模型窗口`，状态为已定义，来源为当前 `FN-4.3` Function 和 `context-engine`；原口径未限定模型窗口的具体来源。
- **目标值或目标口径**：目标仍为 `≤ 60%` 不变；分母调整为本次 selection attempt 返回的 `AVAILABLE` model configuration 的正整数 `contextWindowTokens`。该字段表示完整上下文窗口，不表示输出上限；fallback 选择不同模型后使用新模型窗口重新计算，不复用前一模型预算。
- **单位与测量边界**：单位为百分比；适用于每次 initial 或 fallback selection attempt 的历史上下文预算。
- **依据 Requirements**：`上下文预算使用所选模型的已解析窗口`、`Fallback selection recomputes model-specific context`

### 接口

- **变更类型**：修改
- **目标内容**：模型选择使用 `select(request: ModelSelectionRequest, signal: AbortSignal): Promise<ModelSelectionResult>`；上下文组装使用 `assemble(request: ContextAssemblyRequest, options: ContextAssemblyOptions | undefined, signal: AbortSignal): Promise<ContextAssembly>`，并与 provider-neutral `RenderedModelInput` 渲染契约分离。
- **依据 Requirements**：`Model selection uses Agent-activated model configurations`、`Fallback selection recomputes model-specific context`、`Context Engine separates assembly from rendering`

### 主规格

- **变更类型**：修改
- **目标内容**：`context-engine`
- **依据 Requirements**：`Context Engine separates assembly from rendering`
