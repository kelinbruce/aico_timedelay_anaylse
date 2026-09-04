## Function

- **所属 Function**：`FN-10.4 自定义工具和提示词`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Prompt assembly has one decision boundary

系统 SHALL 为 template selection、fallback、rendering 和 model options override handoff 只暴露一个 prompt template assembly decision boundary。Summary generation、memory extraction 和其他 model-facing prompt consumer MUST 消费该边界。

该边界 SHALL 接收可信投影的 prompt input，其中包含 `purpose`、`agentId`、`agentVersion`、`locale`、值 MUST 只为 string 的 `flowVariables`、required safe `selectedModel` 和 optional safe `memoryEnabled`。`selectedModel` MUST 是只含实际调用所选 `ResolvedModelConfiguration.modelId` 的封闭对象。该 `modelId` 用于 canonical exact matching，且与传给 provider 的模型标识相同。`memoryEnabled` SHALL 从 accepted Agent 的 model-visible Capability set 计算，且 SHALL 只用于 `memory` system section 的受治理条件渲染。它 MUST NOT 影响 template selection、model selection 或 model options handoff，也 MUST NOT 写入 prompt text。该边界 SHALL 返回 selected safe template identity、rendered prompt sections/content 和 optional model options override。

最终 model selection 前，系统 SHALL 基于 accepted Agent 的 frozen template set 和其 activated `modelIds` 对应的 safe catalog entries 评估 prompt compatibility。该评估 SHALL 只向 `ModelSelectionService` 返回 compatible canonical model ids；MUST NOT 选择或渲染最终模板、合并 model options、暴露 provider access fact 或形成第二个 model-selection authority。`ModelSelectionService` 选出一个 `ResolvedModelConfiguration` 后，prompt assembly boundary SHALL 只使用该配置的 safe `modelId` 完成最终 template matching 和 rendering。

每个消费 purpose MUST 在最终 prompt assembly 前通过 `ModelSelectionService` 选择实际模型。主 `SYSTEM_PROMPT`、summary generation、memory extraction 和自定义 model-facing consumer MUST 从返回的 selected configuration 投影 `selectedModel`；prompt template 只消费该选择结果，不拥有模型选择或 identity 解析。

从 runtime `RequestContext.flowVariables` 投影 prompt input 的 caller MUST 只保留受信 string values，并 MUST 排除保存原始用户问题的 `input_question`；该字段即使是 string 也属于 accepted user input，不得成为 template compatibility、model selection 或最终 prompt assembly 的选择权威。主 `SYSTEM_PROMPT` 和由同一次 context assembly 触发的 summary generation MUST 使用相同的 trusted string key/value entries 执行 model compatibility、model selection 和最终 prompt assembly；summary compression boundary MUST 通过 `TraceableSummaryGenerationRequest.flowVariables` 显式携带这些 entries，MUST NOT 丢弃、重新解释或将非空输入替换为空映射。

**需求类别**：功能性需求

#### Scenario: Prompt assembler 返回一个 rendered prompt result
- **WHEN** consumer 使用可信 `agentId`、`agentVersion`、locale、flowVariables 和 selected model descriptors 请求某个 purpose 的 prompt assembly
- **THEN** prompt assembly boundary MUST 从 frozen template set 选择一个完整模板
- **AND** MUST 返回 selected safe template identity、rendered sections/content 和 optional `modelOptions` handoff
- **AND** consuming purpose MUST 把该 selected result 用于模型调用

#### Scenario: 原始用户问题不参与 flow-variable 匹配
- **WHEN** runtime `RequestContext.flowVariables` 包含 string `input_question` 和其他 trusted string entries
- **THEN** 投影到 Context Engine 的 `flowVariables` MUST 排除 `input_question`
- **AND** 其他 trusted string entries MUST 继续用于 model compatibility、model selection 和 prompt assembly
- **AND** 原始用户问题 MUST NOT 通过 flow-variable matching 改变所选模型或模板

#### Scenario: memoryEnabled projection 只驱动条件渲染
- **WHEN** `SYSTEM_PROMPT` assembly request 携带 `memoryEnabled = true`
- **THEN** assembler MUST 把该 projection 提供给 system render policy，用于条件 section filtering
- **AND** 该 projection MUST NOT 改变 template selection、model selection 或 `modelOptions` handoff
- **AND** 该 projection MUST NOT 内联到 rendered prompt text

#### Scenario: 最终 prompt assembly 使用所选 catalog configuration
- **WHEN** `ModelSelectionService` 返回 selected `ResolvedModelConfiguration`
- **THEN** 最终 prompt assembly MUST 从该 configuration 投影唯一 `modelId`
- **AND** `selectedModel` MUST 通过只含该 `modelId` 的 closed schema validation

### Requirement: Prompt assembly boundary guardrails

系统 SHALL 在 prompt assembly boundary 执行 boundary exclusion。最终 assembly request MUST NOT 包含 `modelProfileId`、`modelName`、raw model profile fields、credential、provider route、deployment endpoint、invocation options、runtime-owned `RequestContext`、调用方提供的 `templateId`、prompt body、free variables map、file path、client metadata authority、runtime lifecycle state、model candidate list 或 model output。它 MUST 只携带由同一次 `ModelSelectionResult.status="SELECTED"` 投影的 closed `selectedModel`。

预选择 prompt compatibility evaluation MUST NOT 消费下列字段之外的输入：accepted Agent 的有序 activated `modelIds`、对应 safe catalog `modelId` facts、purpose、trusted locale、值 MUST 只为 string 的 flowVariables，以及 accepted Agent 的 frozen template facts。Candidate facts MUST 只作为 model selection input，MUST NOT 进入最终 prompt assembly request，也 MUST NOT 返回给调用方。`ModelSelectionService` MUST 保持为唯一最终选择 contract。

`agent-contracts/context` public surface MUST NOT 暴露以下不受支持的 prompt shaping contracts：`LayeredProfileResolver`、`PromptTemplateProfile`、`PromptTemplateProfileQuery`、通过 `PromptTemplateRegistry.find(query)` 进行的 public profile lookup、request-path `PromptTemplateLoader`、`TemplateContent.stableSections/dynamicSections`、`PromptTemplateSectionContent`，以及 `appliedProfiles`、`selectedProfile`、`resolvedOptions`、`resolvedProviderOptions` 等 `PromptAssemblyResult` 字段。该 public surface MUST NOT 新增 prompt template、prompt compatibility 或 prompt assembly implementation types。

Summary 和 memory consumer MUST NOT 伪造 `providerContribution`、`promptMode`、`telecomContext`、runtime `RequestContext` 或 `SystemPromptContext` 等 system-only fields。最终 model options 或 provider options merge MUST 在 prompt rendering 之外完成。

**需求类别**：功能性需求

#### Scenario: Prompt assembler 是唯一边界
- **WHEN** 系统执行 purpose-aware prompt assembly
- **THEN** MUST 使用 prompt assembly boundary 作为唯一 template selection/rendering boundary
- **AND** MUST NOT 增加可为同一 purpose 独立选择 prompt template 的第二个 public resolver

#### Scenario: Model compatibility 在 model selection 内生成
- **WHEN** 系统为 accepted Agent 准备 prompt/model selection
- **THEN** MUST 从 `AgentAssembly.modelIds` 和 safe model catalog entries 推导 prompt model candidates
- **AND** MUST 在最终 `ModelSelectionService` 选择前计算 prompt-compatible canonical model ids
- **AND** 空 prompt-compatible model ids MUST 表示 prompt templates 不约束 model selection
- **AND** 最终 prompt assembly MUST NOT 接受 model candidate list 或拥有最终 model selection
- **AND** prompt compatibility 和 assembly MUST NOT 暴露 raw model profiles、credentials、provider routes 或 customer deployment details

#### Scenario: 不暴露非目标 prompt contracts
- **WHEN** 目标 prompt assembly contract 生效
- **THEN** public contract MUST NOT 暴露 `LayeredProfileResolver`、`PromptTemplateProfile`、`PromptTemplateProfileQuery`、`PromptTemplateLoader`、`TemplateContent`、`PromptTemplateSectionContent` 或不受支持的 `PromptAssemblyResult` profile/options fields
- **AND** `agent-contracts/context` MUST NOT 导出 prompt template assembler、compatibility resolver、template、section、assembly request 或 assembly result implementation contracts
- **AND** request path consumer MUST 只通过 prompt assembly boundary 获得 prompt output
- **AND** 最终 `ModelOptions` 或 provider options merge MUST 在 prompt rendering 之外完成

#### Scenario: Summary 不伪造 system context
- **WHEN** summary generation 请求 `PromptPurpose=SUMMARY_GENERATION`
- **THEN** prompt assembly MUST 只接受可信投影的字段
- **AND** summary generation MUST NOT 仅为满足 variable resolution 而构造虚假的 system prompt fields

#### Scenario: Summary 从 selection result 投影 selected model
- **WHEN** summary generation 请求 `PromptPurpose=SUMMARY_GENERATION`
- **THEN** MUST 从本次 model call 实际选择的 `ResolvedModelConfiguration` 设置 required `selectedModel.modelId`
- **AND** MUST NOT 向 prompt assembly 暴露 `modelProfileId`、`modelName`、`baseUrl`、credential reference、common options、timeout、raw invocation options 或 provider route data
- **AND** MUST NOT 独立选择模型或反查模型

#### Scenario: Summary 使用共享 template selection
- **WHEN** summary generation 构造 summary model invocation
- **THEN** MUST 通过 `PromptPurpose=SUMMARY_GENERATION` 获得 summary prompt
- **AND** model compatibility、model selection 和最终 prompt assembly MUST 使用 `TraceableSummaryGenerationRequest.flowVariables` 携带的相同 trusted string key/value entries
- **AND** MUST NOT 在 request path 直接加载 prompt-config files 或选择 fallback templates

#### Scenario: Consumer 不能覆盖 assembly result
- **WHEN** prompt template assembly 返回 selected template 和 rendered content
- **THEN** consuming system prompt、summary 或 memory component MUST 使用该 selected result 发起调用
- **AND** MUST NOT 使用 local files、package paths、client metadata 或 model output 执行第二次 template selection

### Requirement: Prompt template selection is deterministic

系统 SHALL 通过受信选择维度为一次 prompt assembly 选择一个完整 prompt template。候选集 MUST 先限定为当前 accepted Agent scope 的 frozen template set。筛选维度 SHALL 来自 purpose、request locale、selected `ResolvedModelConfiguration.modelId`，以及 internal prompt assembly `flowVariables` 中的受信 string values；客户端请求体、模型输出、Capability 参数或不可信 metadata MUST NOT 覆盖 template selection authority。

Source layer SHALL 恰好有 `builtin` 和 `agent` 两个 public semantic values。`builtin` SHALL 表示 system-provided built-in fallback templates；`agent` SHALL 表示 Agent package `prompts/` templates。Source layer SHALL 从可信 compile facts 推导，MUST NOT 接受调用方或 manifest 提供的 filtering condition。Template selection SHALL 先按 purpose、locale、flowVariables 和 source scope 预选 candidates；声明 `match.model` 时，再按最终 safe selected model 过滤 candidates；最后按确定性优先级选择一个完整模板。`match.model` MUST 直接是一个满足 canonical `modelId` scalar constraint 的 string，MUST NOT 使用只包装单个 `modelId` 的 nested object。Source priority SHALL 为 `agent` 高于 `builtin`；`agent` default candidate MUST 高于任一匹配的 `builtin` candidate。同一 source layer 内，locale、selected model `modelId` 和 flowVariables string key/value matches SHALL 作为 specificity dimensions。每个已声明且匹配的 locale、selected model field 和 flowVariables entry SHALL 计一分；省略 `match` 的 candidate specificity SHALL 为 `0`。Prompt text MUST 来自一个 selected complete template，MUST NOT 合并多个 templates 的 user-defined text。Template `modelOptions` MAY 作为 override handoff 返回；不返回时 MUST 表示没有 template option override，最终 option merge MUST 保持在 prompt rendering 之外。

Template `modelOptions` MUST 复用 canonical `ModelInferenceOptions` contract，并 MUST 是封闭对象，其 optional fields MUST 恰好为 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking` 和 `providerOptions`。前七个字段 MUST 逐字段复用 `ModelInvocationRequest` 的同名范围、类型和显式 `null` 拒绝规则；`providerOptions` MUST 为非 null `JsonObject`，MUST 作为 inner provider options 原样 handoff，并 MUST NOT 包含 provider namespace。省略 `modelOptions` 或其中任一字段 MUST 仅表示 template 不覆盖该字段，MUST NOT 由 template compiler 合成 `temperature=0.55`、`maxOutputTokens=32,000`、`topP=1`、空 `providerOptions` 或其他默认值；前七个字段的最终调用值 MUST 在 profile、template、governed Capability patch、trusted request 和 governed hook 的固定 precedence 合并后由模型调用契约解析，`providerOptions` 的 Capability layer MUST 只接受 governed Skill patch。provider identity/access、timeout、retry、显式 `null` 和 outer unknown fields MUST 在 Agent package compilation 时被拒绝；结构合法的 `providerOptions` MUST 在最终模型选择后通过 selected-provider reserved-field validation，不冲突的 inner unknown JSON fields MUST 保持开放。

`ModelSelectionService` SHALL 把 `AgentAssembly.modelIds` 作为 accepted Agent 的有序初始 allowed model-id list。最终选择前，系统 SHALL 从 safe catalog entries、purpose、trusted locale、值 MUST 只为 string 的 flowVariables，以及显式声明 `match.model` 的 frozen `agent` templates 计算 prompt-compatible canonical model ids。`builtin`、generic、fallback 和未声明 `match.model` 的 templates MUST NOT 贡献 ids。空 compatible ids SHALL 表示 prompt templates 不约束 model selection。非空 compatible ids SHALL 与 availability、trusted customer policy、fallback eligibility 和 governed Capability filters 一起构成 hard filter。Initial selection SHALL 先应用合法显式 `modelId`，再应用合法 `AgentAssembly.defaultModelId`，最后选择 `AgentAssembly.modelIds` 顺序中的第一个剩余 id。`modelId` 与 `defaultModelId` 均缺失时 SHALL 直接使用该顺序中的第一个 eligible id，MUST NOT 合成 global default。Fallback selection SHALL 排除 attempted ids，并选择 assembly 顺序中第一个 remaining fallback-eligible id。模型选择与 prompt matching MUST 只使用 canonical `modelId`；`displayName` 只用于展示。Compatibility evaluation MUST NOT 选择或渲染最终模板。

**需求类别**：功能性需求

#### Scenario: Agent default 覆盖匹配的 builtin template
- **WHEN** 一次 prompt assembly 同时匹配 `builtin` source template 和 `agent` source default template
- **THEN** selected complete template MUST 是 `agent` source template
- **AND** 最终 prompt text MUST NOT 混合 builtin 与 agent 的 user-defined content

#### Scenario: 同一 source layer 选择最高 specificity
- **WHEN** 同一 source layer 对一个 purpose 有多个 candidates
- **AND** trusted locale、selected model 和 flowVariables 匹配后恰好一个 candidate 具有最高 specificity
- **THEN** selected complete template MUST 是该最高 specificity candidate
- **AND** 相同输入下的选择 MUST 保持确定性

#### Scenario: 同一 source layer 冲突时安全失败
- **WHEN** 同一 source layer 有两个 enabled candidates，且 trusted dimensions 无法确定唯一最高 specificity result
- **THEN** prompt assembly MUST 使用 safe configuration error fail closed
- **AND** safe error 或 internal safe observation MUST 只包含 safe template identifiers
- **AND** MUST NOT 包含 prompt text、local paths、credentials、model output 或 raw template body

#### Scenario: Model selection 使用 prompt-compatible candidates
- **WHEN** accepted Agent 有多个 `modelIds`
- **AND** 显式声明 `match.model` 的匹配 `agent` templates 只与 safe activated model configurations 的一个子集兼容
- **THEN** `ModelSelectionService` 在应用全部 trusted filters 后 MUST 只从该子集中选择
- **AND** initial selection MUST 依次使用 governed explicit `modelId`、`defaultModelId` 和 `modelIds` order
- **AND** 最终 prompt assembly MUST 只把 selected configuration 用作 trusted template-selection input，MUST NOT 用它重新执行 model selection

#### Scenario: Generic templates 不约束 model selection
- **WHEN** 匹配 templates 仅为 `builtin`、fallback、generic 或未声明 `match.model`
- **THEN** prompt-compatible model ids MUST 为空
- **AND** model selection MUST NOT 按 prompt compatibility 过滤模型
- **AND** 最终 prompt assembly MUST 仍使用 selected configuration 的 safe descriptors 进行 template specificity 和 fallback 判定

#### Scenario: Prompt 模型选择使用 canonical identity
- **WHEN** prompt compatibility 或 final template matching 处理模型约束
- **THEN** 模型 identity 和 selection constraint MUST 来自 canonical `modelId`
- **AND** `displayName` MUST 只用于展示

#### Scenario: Prompt template 使用 canonical model id
- **WHEN** Agent template 以 string 声明 `match.model`
- **THEN** compatibility evaluation 和 final template matching MUST 与 selected configuration 的 canonical `modelId` 精确比较

#### Scenario: Prompt model match 遵守封闭 schema
- **WHEN** prompt template 的 `match.model` 是 object、array、`null`、空白 string 或非法 canonical `modelId`
- **THEN** Agent package compilation MUST 安全失败
- **AND** prompt compatibility MUST NOT 从 nested object 提取或猜测 `modelId`

#### Scenario: Prompt template 声明完整推理参数
- **WHEN** Agent template 的 `modelOptions` 声明任一合法 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking` 或 `providerOptions`
- **THEN** template compiler MUST 接受并按同名字段原样 handoff
- **AND** 后续 merge MUST 使用 template 值覆盖 profile 对应值
- **AND** `providerOptions` MUST 在 provider execution 前由 selected provider adapter 校验

#### Scenario: Prompt template 省略 model option
- **WHEN** Agent template 省略 `modelOptions` 或其中任一 optional field
- **THEN** template handoff MUST NOT 包含对应 override
- **AND** template compiler MUST NOT 合成固定默认值或 provider 缺省值

#### Scenario: Prompt template 拒绝非治理 model option
- **WHEN** Agent template 的 `modelOptions` 包含 provider identity/access、timeout、retry、显式 `null`、未知字段，或非 object `providerOptions`
- **THEN** Agent package compilation MUST 在 prompt assembly 或 provider access 前安全失败

#### Scenario: Prompt template provider options 覆盖受保护字段
- **WHEN** template handoff 的结构合法 `providerOptions` 包含与 canonical 顶层字段或 identity、access、transport authority 冲突的字段
- **THEN** provider execution MUST NOT 启动
- **AND** safe error、diagnostic、log、metric、trace、audit 或用户可见输出 MUST NOT 包含 raw option value
- **AND** 安全失败 MUST NOT 暴露 provider option 值

## Function 变更汇总

### 输入

- **变更类型**：修改
- **目标内容**：最终 prompt assembly 的模型输入只包含同一 selection result 的 canonical `modelId`；预选择兼容性只消费 accepted Agent 的 canonical `modelIds`、安全目录项，以及排除原始用户问题 `input_question` 后的 trusted string flow variables。
- **依据 Requirements**：`Prompt assembly has one decision boundary`、`Prompt assembly boundary guardrails`、`Prompt template selection is deterministic`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统先根据模板兼容性产出 canonical compatible model ids，再通过唯一模型选择契约完成最终选择；prompt assembly 随后使用同一选择结果的安全 descriptors 确定性选择并渲染一个完整模板。
- **依据 Requirements**：`Prompt assembly has one decision boundary`、`Prompt template selection is deterministic`

### 结果

- **变更类型**：修改
- **目标内容**：模板 authoring 使用 canonical `modelId` string 直接赋值给 `match.model`；`modelOptions` 使用与模型配置一致的八个 optional 推理字段，其中 `providerOptions` 由 selected provider 校验，省略字段只表示不覆盖；source priority、specificity、fallback 和 rendering 行为保持不变。
- **依据 Requirements**：`Prompt assembly boundary guardrails`、`Prompt template selection is deterministic`
