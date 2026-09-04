# prompt-template-assembly Specification

## Purpose

Defines purpose-aware prompt template assembly for system prompts, summary generation, memory extraction, and custom model-facing prompt consumers.

## Function

- **所属 Function**：`FN-10.4 自定义工具和提示词`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Prompt templates are assembled by purpose

系统 SHALL 将 prompt template 作为跨 purpose 的装配对象处理。每次需要构造模型可见 prompt 的内部调用 MUST 指定一个 `PromptPurpose`。`PromptPurpose` SHALL be a validated string scalar, not a closed enum. Framework well-known purpose constants SHALL include `SYSTEM_PROMPT`、`SUMMARY_GENERATION`、`MEMORY_EXTRACTION` 和 `AGENT_ROUTING_SELECTION`, and developers MAY define additional safe-id purpose strings for their own consumers. `SYSTEM_PROMPT` SHALL 是 prompt template 的一个受限高风险 purpose，而不是 prompt template 体系的唯一形态。

通用 prompt template resolution SHALL own purpose-neutral behavior including template source registration, deterministic selection, governed rendering, fallback, model options override handoff, failure safe errors and safe observations. Purpose-specific constraints SHALL be layered by the consuming purpose. Only `SYSTEM_PROMPT` has built-in special prompt assembly constraints: it MUST reuse the generic resolver boundary and then apply stricter role, section, cache-boundary and protocol constraints。Summary、memory、Agent routing 和 developer-defined custom purposes SHALL use the generic ordered-section rendering model.

**需求类别**：功能性需求

#### Scenario: System prompt 使用 purpose
- **WHEN** context engine 为一次主模型调用构造 system prompt
- **THEN** prompt template resolver MUST 使用 `PromptPurpose=SYSTEM_PROMPT`
- **AND** system prompt 专属的 section、cache boundary 和模型输入角色规则 MUST 作为该 purpose 的约束处理
- **AND** those constraints MUST be additive specialization over generic prompt template resolution, not a separate template system

#### Scenario: Summary generation 使用 purpose
- **WHEN** traceable summary generation 需要构造摘要模型调用 prompt
- **THEN** prompt template resolver MUST 使用 `PromptPurpose=SUMMARY_GENERATION`
- **AND** 摘要 prompt 的输出格式和工具禁用要求 MUST 由 summary generation 消费方继续校验
- **AND** summary generation MUST use generic prompt section rendering

#### Scenario: Memory extraction 使用 purpose
- **WHEN** memory extraction 需要构造提取提示词
- **THEN** prompt template resolver MUST 使用 `PromptPurpose=MEMORY_EXTRACTION`
- **AND** memory extraction MUST obtain rendered prompt content from prompt template resolution
- **AND** memory extraction MUST use generic prompt section rendering

#### Scenario: Agent routing selection 使用 purpose
- **WHEN** agent-router-plugin 的 effective final candidate set 非空并需要模型终选
- **THEN** prompt template resolver MUST 使用 `PromptPurpose=AGENT_ROUTING_SELECTION`
- **AND** Agent package matching template MUST 按既有 specificity 规则解析为 `RESOLVED`
- **AND** 无匹配 Agent template 时 resolver MUST 返回 `NOT_FOUND`，MUST NOT 从 Context Engine builtin root 提供该插件的默认 task
- **AND** routing output schema、candidate membership 与模型调用控制 MUST 继续由 routing consumer 校验

### Requirement: Prompt assembly has one decision boundary

系统 SHALL 为 template selection、fallback、rendering 和 model options override handoff 只暴露一个 prompt template resolver decision boundary。Summary generation、memory extraction、Agent routing 和其他 model-facing prompt consumer MUST 消费唯一实现无关的 `PromptTemplateResolverPort.resolve(request, signal)` public contract，MUST NOT 形成第二套 template selection/rendering authority。

该边界 SHALL 接收可信投影的 prompt input，其中包含 `purpose`、`agentId`、`agentVersion`、`locale`、值 MUST 只为 string 的 `flowVariables`、required safe `selectedModel` 和 optional safe `memoryEnabled`。`selectedModel` MUST 是只含实际调用所选 `ResolvedModelConfiguration.modelId` 的封闭对象。该 `modelId` 用于 canonical exact matching，且与传给 provider 的模型标识相同。`memoryEnabled` SHALL 只用于 `memory` system section 的受治理条件渲染，MUST NOT 影响 template/model selection、model options handoff 或写入 prompt text。

该边界 SHALL 额外接收 optional safe skill disclosure 投影，包含 skill disclosure section 渲染门控事实（当前 model step 是否有可见 `Skill` tool entry、是否存在满足披露门控的 Skill）和受控披露模式值 `skillDisclosureMode`（值为 `list` 或 `tool-search`，来自 trusted app config）。skill disclosure 投影 SHALL 只用于 `skill_disclosure` system section 的受治理条件渲染和安全投影变量解析；它 MUST NOT 影响 template selection、model selection 或 model options handoff。`PromptAssemblyRequest` MUST NOT 携带 `enabledCapabilities` 投影（随 `enabledSkills` 变量删除一并下线）。该边界 SHALL 返回 selected safe template identity、rendered prompt sections/content 和 optional model options override。

最终 model selection 前，系统 SHALL 基于 accepted Agent 的 frozen template set 和其 activated `modelIds` 对应的 safe catalog entries 评估 prompt compatibility。该评估 SHALL 只向 `ModelSelectionService` 返回 compatible canonical model ids；MUST NOT 选择或渲染最终模板、合并 model options、暴露 provider access fact 或形成第二个 model-selection authority。`ModelSelectionService` 选出一个 `ResolvedModelConfiguration` 后，resolver SHALL 只使用该配置的 safe `modelId` 完成最终 template matching 和 rendering。

每个消费 purpose MUST 在最终 prompt resolution 前通过 `ModelSelectionService` 选择实际模型。主 `SYSTEM_PROMPT`、summary generation、memory extraction、Agent routing 和自定义 model-facing consumer MUST 从返回的 selected configuration 投影 `selectedModel`；prompt template 只消费该选择结果，不拥有模型选择或 identity 解析。

从 runtime `RequestContext.flowVariables` 投影 prompt input 的 caller MUST 只保留受信 string values，并 MUST 排除 `input_question`。主 `SYSTEM_PROMPT` 和由同一次 context assembly 触发的 summary generation MUST 使用相同的 trusted string entries；其它 consumer MUST 遵循同一投影规则，MUST NOT 把原始用户问题用作 template compatibility、model selection 或最终 prompt resolution 的选择权威。resolver result MUST 为 closed `RESOLVED | NOT_FOUND` union；`RESOLVED` MUST 携带 selected safe template identity、rendered sections/content 和 optional model options override，`NOT_FOUND` MUST 仅携带 status。

**需求类别**：功能性需求

#### Scenario: Resolver返回一个rendered prompt result
- **WHEN** consumer 使用可信 Agent scope、locale、flowVariables 和 selected model 请求某个 purpose 的 prompt
- **THEN** resolver MUST 从 frozen template set 选择一个完整模板
- **AND** MUST 返回 `status=RESOLVED`、selected safe template identity、rendered sections/content 和 optional `modelOptions` handoff
- **AND** consuming purpose MUST 把该 selected result 用于模型调用

#### Scenario: Resolver显式返回无匹配模板

- **WHEN** frozen template set 中没有满足 request purpose、Agent scope、locale、flow variables 与 selected model 的候选
- **THEN** resolver MUST 返回仅含 `status=NOT_FOUND` 的 result
- **AND** MUST NOT 伪造 template identity、rendered content 或 model options
- **AND** consumer MUST 按自身 purpose 契约决定使用自有默认内容或安全失败

#### Scenario: 原始用户问题不参与 flow-variable 匹配
- **WHEN** runtime `RequestContext.flowVariables` 包含 string `input_question` 和其他 trusted string entries
- **THEN** 投影给 resolver 的 `flowVariables` MUST 排除 `input_question`
- **AND** 其他 trusted string entries MUST 继续用于 model compatibility、model selection 和 prompt resolution
- **AND** 原始用户问题 MUST NOT 通过 flow-variable matching 改变所选模型或模板

#### Scenario: memoryEnabled projection 只驱动条件渲染
- **WHEN** `SYSTEM_PROMPT` resolve request 携带 `memoryEnabled = true`
- **THEN** resolver MUST 把该 projection 提供给 system render policy，用于条件 section filtering
- **AND** 该 projection MUST NOT 改变 template selection、model selection 或 `modelOptions` handoff
- **AND** 该 projection MUST NOT 内联到 rendered prompt text

#### Scenario: skill disclosure 投影只驱动条件渲染与变量解析
- **WHEN** `SYSTEM_PROMPT` resolve request 携带 skill disclosure 门控事实和 `skillDisclosureMode`
- **THEN** resolver MUST 把该投影提供给 system render policy 用于 `skill_disclosure` section 条件过滤，并提供给安全投影变量解析
- **AND** 该投影 MUST NOT 改变 template selection、model selection 或 `modelOptions` handoff
- **AND** `skillDisclosureMode` 值 MUST NOT 在未被模板变量引用时内联到 rendered prompt text

#### Scenario: 最终 prompt resolution 使用所选 catalog configuration
- **WHEN** `ModelSelectionService` 返回 selected `ResolvedModelConfiguration`
- **THEN** resolver request MUST 从该 configuration 投影唯一 `modelId`
- **AND** `selectedModel` MUST 通过只含该 `modelId` 的 closed schema validation

#### Scenario: Resolver 支持其它 model-facing consumer
- **WHEN** 任一 model-facing consumer 需要按 purpose 解析受治理提示词
- **THEN** consumer MUST 只使用 `PromptTemplateResolverPort`
- **AND** 系统 MUST 提供由同一 frozen Agent-scoped template set 支撑的 resolver
- **AND** consumer MUST NOT 独立选择、加载或渲染另一个 template

### Requirement: Prompt assembly boundary guardrails

系统 SHALL 在 prompt resolver boundary 执行 boundary exclusion。resolve request MUST NOT 包含 `modelProfileId`、`modelName`、raw model profile fields、credential、provider route、deployment endpoint、invocation options、runtime-owned `RequestContext`、调用方提供的 `templateId`、prompt body、free variables map、file path、client metadata authority、runtime lifecycle state、model candidate list 或 model output。它 MUST 只携带由同一次 `ModelSelectionResult.status="SELECTED"` 投影的 closed `selectedModel`。

预选择 prompt compatibility evaluation MUST NOT 消费下列字段之外的输入：accepted Agent 的有序 activated `modelIds`、对应 safe catalog `modelId` facts、purpose、trusted locale、string-only flowVariables 和 frozen template facts。Candidate facts MUST 只作为 model selection input，MUST NOT 进入 resolve request，也 MUST NOT 返回给调用方。`ModelSelectionService` MUST 保持为唯一最终选择 contract。

public surface MAY expose only the implementation-neutral `PromptTemplateResolveRequest`、closed `RESOLVED | NOT_FOUND` `PromptTemplateResolveResult`、rendered section DTO、closed schemas 和 `PromptTemplateResolverPort`。它 MUST NOT 暴露 `LayeredProfileResolver`、`PromptTemplateProfile`、`PromptTemplateProfileQuery`、`PromptTemplateRegistry`、public profile lookup、request-path `PromptTemplateLoader`、compiler、template source、`TemplateContent`、`PromptTemplateSectionContent`、internal `PromptTemplateAssembler`，或 `appliedProfiles`、`selectedProfile`、`resolvedOptions`、`resolvedProviderOptions` 等不受支持字段。

Summary 和 memory consumer MUST NOT 伪造 system-only fields。最终 model options 或 provider options merge MUST 在 prompt rendering 之外完成。Resolver MUST 接收 `AbortSignal` 并在已取消时终止，MUST NOT 用 cancellation 触发 fallback 或第二次选择。

**需求类别**：功能性需求

#### Scenario: Resolver是唯一边界
- **WHEN** 系统执行 purpose-aware prompt resolution
- **THEN** MUST 使用 `PromptTemplateResolverPort` 作为唯一 public template selection/rendering boundary
- **AND** MUST NOT 增加可为同一 purpose 独立选择 prompt template 的第二个 public resolver

#### Scenario: Model compatibility 在 model selection 内生成
- **WHEN** 系统为 accepted Agent 准备 prompt/model selection
- **THEN** MUST 从 `AgentAssembly.modelIds` 和 safe model catalog entries 推导 prompt model candidates
- **AND** MUST 在最终 `ModelSelectionService` 选择前计算 prompt-compatible canonical model ids
- **AND** 空 compatible model ids MUST 表示 prompt templates 不约束 model selection
- **AND** resolver MUST NOT 接受 model candidate list 或拥有最终 model selection

#### Scenario: 不暴露非目标 prompt contracts
- **WHEN** 目标 prompt resolver contract 生效
- **THEN** public contract MUST NOT 暴露 registry、loader、compiler、template source、internal assembler 或 profile implementation contracts
- **AND** `NOT_FOUND` result MUST NOT 携带 prompt body 或 caller-supplied fallback
- **AND** request path consumer MUST 只通过 resolver 获得 prompt output
- **AND** final model/provider option merge MUST 在 prompt rendering 之外完成

#### Scenario: Summary不伪造system context
- **WHEN** summary generation 请求 `PromptPurpose=SUMMARY_GENERATION`
- **THEN** resolver MUST 只接受可信投影字段
- **AND** summary generation MUST NOT 构造虚假的 system-only fields

#### Scenario: Summary从selection result投影selected model
- **WHEN** summary generation 请求 `PromptPurpose=SUMMARY_GENERATION`
- **THEN** MUST 从本次 model call 实际选择的 configuration 设置 `selectedModel.modelId`
- **AND** MUST NOT 暴露 model profile、provider route、credential、timeout 或 raw invocation options
- **AND** MUST NOT 独立选择模型或反查模型

#### Scenario: Summary使用共享template selection
- **WHEN** summary generation 构造 model invocation
- **THEN** MUST 通过 `PromptPurpose=SUMMARY_GENERATION` 获得 prompt
- **AND** compatibility、model selection 和 final resolution MUST 使用相同 trusted string flow variables
- **AND** MUST NOT 在 request path 直接加载文件或选择 fallback template

#### Scenario: Consumer不能覆盖resolution result
- **WHEN** resolver 返回 selected template identity 和 rendered content
- **THEN** consumer MUST 使用该 result 发起调用
- **AND** MUST NOT 使用 local files、package paths、client metadata 或 model output 执行第二次选择

#### Scenario: 已取消resolve安全终止
- **WHEN** resolver 收到已取消 signal 或解析期间 signal 被取消
- **THEN** resolver MUST 终止并传播 cancellation
- **AND** MUST NOT 改选其它模板或读取 request-time template file

### Requirement: Prompt rendering is separate from model input assembly
系统 SHALL keep prompt rendering separate from final model input assembly. Prompt template assembly MAY produce rendered prompt content, selected template identity and optional model options override for a purpose. It MUST NOT produce the complete `RenderedModelInput.messages`, decide conversation history selection, flatten tool-call protocol messages, inline attachment content, reorder final model messages, merge final model/provider options, or return diagnostics in `PromptAssemblyResult`.

The consuming model input assembly boundary SHALL place rendered prompt content into the appropriate role/protocol slot and combine it with governed history, current user input, tool-call/result messages, attachment context and large content references. Prompt templates MAY only access those objects through explicitly registered safe projection variables.

#### Scenario: Prompt rendering returns prompt sections, not full model input
- **WHEN** prompt template assembly renders `PromptPurpose=SYSTEM_PROMPT`
- **THEN** the result MUST contain rendered prompt content and safe metadata for that purpose
- **AND** it MUST NOT contain the complete `RenderedModelInput.messages`
- **AND** Context Engine render MUST place the prompt content into the final model input

#### Scenario: Prompt template cannot bypass input assembly
- **WHEN** a template references conversation history, current request, tool result, attachment context or large content
- **THEN** the reference MUST resolve through a registered safe projection variable
- **AND** prompt template assembly MUST NOT read raw message stores, attachment blobs, tool payloads or files directly during rendering

### Requirement: Prompt template selection is deterministic

系统 SHALL 通过受信选择维度为一次 prompt assembly 选择一个完整 prompt template。候选集 MUST 先限定为当前 accepted Agent scope 的 frozen template set。筛选维度 SHALL 来自 purpose、request locale、selected `ResolvedModelConfiguration.modelId`，以及 internal prompt assembly `flowVariables` 中的受信 string values；客户端请求体、模型输出、Capability 参数或不可信 metadata MUST NOT 覆盖 template selection authority。

Source layer SHALL 恰好有 `builtin` 和 `agent` 两个 public semantic values。`builtin` SHALL 表示 system-provided built-in fallback templates；`agent` SHALL 表示 Agent package `prompts/` templates。Source layer SHALL 从可信 compile facts 推导，MUST NOT 接受调用方或 manifest 提供的 filtering condition。Template selection SHALL 先按 purpose、locale、flowVariables 和 source scope 预选 candidates；声明 `match.model` 时，再按最终 safe selected model 过滤 candidates；最后按确定性优先级选择一个完整模板。`match.model` MUST 直接是一个满足 canonical `modelId` scalar constraint 的 string，MUST NOT 使用只包装单个 `modelId` 的 nested object。Source priority SHALL 为 `agent` 高于 `builtin`；`agent` default candidate MUST 高于任一匹配的 `builtin` candidate。同一 source layer 内，locale、selected model `modelId` 和 flowVariables string key/value matches SHALL 作为 specificity dimensions。每个已声明且匹配的 locale、selected model field 和 flowVariables entry SHALL 计一分；省略 `match` 的 candidate specificity SHALL 为 `0`。Prompt text MUST 来自一个 selected complete template，MUST NOT 合并多个 templates 的 user-defined text。Template `modelOptions` MAY 作为 override handoff 返回；不返回时 MUST 表示没有 template option override，最终 option merge MUST 保持在 prompt rendering 之外。

Template `modelOptions` MUST 使用 canonical `ModelInferenceOptions` 的同名字段约束，并 MUST 是封闭子集；其 optional fields MUST 恰好为 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`toolChoice` 和 `providerOptions`，`modelParams` 和其他字段 MUST NOT 属于 Template authoring field set。除 `providerOptions` 外的字段 MUST 逐字段复用 `ModelInvocationRequest` 的同名范围、类型和显式 `null` 拒绝规则；`providerOptions` MUST 为非 null `JsonObject`，MUST 作为 inner provider options 原样 handoff，并 MUST NOT 包含 provider namespace。省略 `modelOptions` 或其中任一字段 MUST 仅表示 template 不覆盖该字段，MUST NOT 由 template compiler 合成 `temperature=0.55`、`maxOutputTokens=32,000`、`topP=1`、空 `providerOptions` 或其他默认值；除 `providerOptions` 外字段的最终调用值 MUST 在 profile、template、governed Capability patch、trusted request 和 governed hook 的固定 precedence 合并后由模型调用契约解析，`providerOptions` 的 Capability layer MUST 只接受 governed Skill patch。provider identity/access、timeout、retry、显式 `null` 和 outer unknown fields MUST 在 Agent package compilation 时被拒绝；结构合法的 `providerOptions` MUST 在最终模型选择后通过 selected-provider reserved-field validation，不冲突的 inner unknown JSON fields MUST 保持开放。

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
- **WHEN** Agent template 的 `modelOptions` 声明任一合法 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`toolChoice` 或 `providerOptions`
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

#### Scenario: Template 声明 ToolChoice

- **WHEN** selected Agent Prompt Template 的 `modelOptions.toolChoice` 为 `AUTO`、`NONE` 或 `REQUIRED`
- **THEN** prompt assembly MUST 按 canonical `ToolChoice` 原样返回该 override
- **AND** MUST NOT 在 prompt compiler 内执行最终 precedence merge
- **AND** named-tool object、provider-native `tool_choice`、显式 `null` 或其他值 MUST 在 Agent package publication 前被拒绝

### Requirement: Complete prompt content and model options handoff are assembled together
系统 SHALL 在一次 prompt assembly 中同时产出 selected template identity、rendered prompt content 和可选 model options override。prompt content 的选择 SHALL 使用 selected complete template；final `ModelInferenceOptions` / `providerOptions` merge SHALL NOT be performed inside `PromptTemplateAssembler`.

#### Scenario: Model options are handed off while prompt content does not merge
- **WHEN** builtin and agent templates plus model-compatible variants are considered for one prompt assembly
- **THEN** prompt assembly MAY return the selected template's `modelOptions` override
- **AND** rendered prompt content MUST come from one selected complete template
- **AND** final model/provider option merge MUST be performed by the model selection or invocation owner
- **AND** internal safe observation MAY make the selected template and model options handoff diagnosable without exposing prompt text

#### Scenario: Template identity remains traceable
- **WHEN** prompt assembly succeeds
- **THEN** result MUST expose an internally derived `templateRef` or template version for downstream traceability
- **AND** downstream summary draft or model invocation metadata MAY reference that safe template identity
- **AND** raw prompt content MUST NOT be used as traceability metadata

### Requirement: Prompt rendering supports governed template variables and optional substitutions

系统 SHALL render non-system prompt template sections in declared order. For `PromptPurpose=SYSTEM_PROMPT`, system prompt specialization SHALL ignore manifest section order and SHALL render sections according to the builder-owned predefined system section order. Template content MAY contain governed template variable syntax. The public template syntax SHALL be limited to NextAgent controlled variable syntax: `{{ variableName }}` required substitution and `{{ variableName? }}` optional substitution. Variable names MUST reference a single registered variable name. Variable resolution MUST use a registry owned by prompt template assembly or the consuming purpose boundary. Variables MUST be registered before failure behavior is determined. Callers MUST NOT provide an arbitrary variables map through the internal prompt assembly request.

Required substitution resolution failure MUST either use an explicit fallback template or fail prompt assembly explicitly. Optional substitution SHALL render the referenced variable when it resolves to non-empty content and SHALL render empty when the registered variable resolves empty or is absent from the safe render context. Unknown variables MUST NOT silently disappear, including unknown names marked with `?`. The renderer MUST NOT require or expose a general-purpose template engine. The renderer MUST NOT support condition blocks, expressions, comparisons, boolean operations, filters, tests, attribute/index access, `else`, `elif`, loops, includes, imports, extends, `set`, macros, calls, raw blocks, comments, helpers, partials, unescaped/raw injection, arbitrary functions, scripts, or file reads from template syntax.

The implementation SHALL enforce purpose-specific behavior through context-engine private compiler validators and render policies. It MUST NOT expose a public renderer policy port in this change. It MUST NOT scatter system-only section taxonomy, cache-boundary or protocol-slot conditionals through the generic variable renderer. The only allowed purpose dispatch is at the compiler validation boundary and render policy selection boundary. For `SYSTEM_PROMPT`, compile-time validation MUST fail closed for non-array content, non builder-owned section ids and sealed/non-configurable section overrides. During rendering, the system policy MUST filter/order sections by builder-owned system prompt rules before common variable substitution. Default non-system policy MUST keep materialized section order and MUST NOT inherit system section taxonomy.

系统 SHALL 维护 SYSTEM_PROMPT 的受治理变量注册表。注册表 SHALL 包含 `skillDisclosureList`、`skillDisclosureMode` 和 `skillDisclosureBody` 三个 skill disclosure 安全投影变量：`skillDisclosureList` SHALL 由 context engine 从当前 request 的 model-visible capability view 按 `kind="SKILL"`、availability、`modelInvocable=true` 和 disclosure policy 门控过滤后渲染为 governed Skill bullet 列表（`- <skill-name>: <safe description>`），其 surface MUST 限于 governed Skill names 和 safe descriptions；`skillDisclosureMode` SHALL 解析为当前 trusted 披露模式值（`list` 或 `tool-search`）；`skillDisclosureBody` SHALL 按当前披露模式解析为 builtin 默认 `### How to use skills` 指令正文，该正文 MUST 由 context engine 从 builtin `SYSTEM_PROMPT` 模板目录中与披露模式对应的 `skill-disclosure-{mode}.md` markdown 文件读取（默认文案通过编辑 markdown 定制，不进代码）；正文内容 MUST 与 renderer 硬编码时代的两套默认英文正文逐字一致，且 MUST 限于 usage instructions；body 文件缺失或不可读时投影 MUST 为空 body，使该 section 只渲染 governed Skill 列表。注册表 MUST NOT 再包含 `enabledSkills` 变量；引用 `enabledSkills` 的模板 MUST 在编译期 fail closed。

#### Scenario: Registered variable is rendered
- **WHEN** selected template content contains `{{ skillDisclosureList }}`
- **THEN** prompt assembly MUST resolve it through the registered variable resolver
- **AND** capability filtering、ordering、truncation 和 formatting MUST be deterministic for the same trusted inputs

#### Scenario: Optional substitution is omitted
- **WHEN** selected template content contains `{{ runtime? }}`
- **AND** the registered `runtime` variable resolves to empty content
- **THEN** prompt assembly MUST render the optional variable as empty
- **AND** remaining non-system prompt content MUST keep manifest order
- **AND** remaining system prompt content MUST keep builder-owned predefined system order
- **AND** internal safe observation MAY record a safe omission reason when observability is enabled

#### Scenario: System prompt uses purpose-specific policy
- **WHEN** prompt assembly compiles and renders a `SYSTEM_PROMPT` template
- **THEN** system-specific validation MUST run during template registration before request acceptance
- **AND** section filtering and ordering MUST be performed by the system render policy, not by ad hoc conditionals inside the common variable renderer
- **AND** common variable substitution MUST remain shared with non-system purposes
- **AND** summary, memory and custom purpose rendering MUST NOT consume system prompt section taxonomy or system render policy

#### Scenario: Required variable failure is explicit
- **WHEN** selected template content references a required variable that cannot be resolved
- **THEN** prompt assembly MUST use a configured fallback template or fail explicitly
- **AND** it MUST NOT silently remove that content and continue as if prompt assembly succeeded

#### Scenario: enabledSkills 变量引用被编译期拒绝
- **WHEN** 一个模板的 section 内容引用 `{{ enabledSkills }}` 或 `{{ enabledSkills? }}`
- **THEN** template compiler MUST 以未知变量安全失败（fail closed）
- **AND** safe error MUST NOT 暴露 prompt 内容或文件路径

#### Scenario: skillDisclosureList 只包含满足门控的 governed Skill
- **WHEN** `skillDisclosureList` 变量在渲染含 `kind="SKILL"`、`modelInvocable=false`、HIDDEN disclosure 或非 SKILL capability 的 model-visible view 时被解析
- **THEN** 解析结果 MUST 只包含满足 `kind="SKILL"`、availability、`modelInvocable=true` 和 disclosure policy 门控的 Skills
- **AND** 解析结果 MUST NOT 包含 `modelInvocable=false`、HIDDEN 的 Skills 或任何非 SKILL capability
- **AND** 每个 bullet MUST 为 `- <skill-name>: <safe description>` 格式

### Requirement: Prompt template sources are compiled before request path
系统 SHALL define built-in prompt templates as context-engine package-owned resources under `packages/agent-context-engine/prompt-templates/builtin/` in the target codebase. Built-in templates SHALL use the same `nextagent.prompt-template/v1` YAML manifest format as Agent templates, for example `SYSTEM_PROMPT/template.yaml`, `SUMMARY_GENERATION/template.yaml` and later well-known purpose templates when introduced. Existing `prompt-configs/builtin` and `prompt-configs/telecom` resources MAY be used only as migration inputs; target request paths MUST NOT read them. During context-engine registry initialization, the implementation SHALL compile the package-owned builtin prompt root once into a process-scoped builtin registry bucket. Builtin prompt facts MUST NOT bind `agentId` or `agentVersion`, and builtin `templateRef` values MUST NOT include `agentId` or `agentVersion`. Builtin compilation failure MUST fail app startup or context-engine composition before request acceptance. Builtin facts MUST NOT be copied into every Agent assembly or re-materialized per Agent.

系统 SHALL treat automatically discovered Agent package `prompts/` entries as trusted Agent prompt roots for synchronous Agent assembly. Agent-app/package assembly SHALL resolve Agent package prompt roots to trusted absolute paths after package-root containment. `agent-context-engine` SHALL expose one assembly-time `register` entry that accepts `agentId`, `agentVersion` and trusted absolute prompt root `path`, then scans, parses, validates, materializes and registers valid prompt manifests as Agent-scoped `PromptTemplate` facts with source layer `agent`. Agent-scoped prompt facts MUST bind the trusted `agentId` and `agentVersion` supplied to `register`, and Agent-scoped `templateRef` values MUST include `agentId` and `agentVersion`. Agent-app MUST NOT call separate prompt compile and publish APIs. The corresponding `AgentAssembly` MUST NOT be produced as request-acceptable until its Agent-scoped prompt template facts have been registered successfully or fail-closed safe errors have been produced. Valid Agent package prompt manifests under `prompts/` SHALL automatically become available to that Agent after successful assembly; Agent developers MUST NOT maintain a duplicate prompt template id allowlist in `agent.yaml`. Target `AgentAssembly` MUST delete `promptTemplateIds`, and target `AgentRuntimeSettings` MUST delete `defaultPromptTemplateId`; these fields MUST NOT be retained, deprecated, ignored or exposed as compatibility aliases. Request path consumers SHALL only use the logical union of process-scoped builtin prompt facts and the accepted Agent's Agent-scoped prompt facts, internally derived `templateRef` values, or context-engine internal assembler output from that frozen template set. Runtime, context, memory, summary generation, model and capability paths MUST NOT read raw Agent package prompt files or trigger request-time prompt template compilation during request execution.

Public Agent package prompt authoring SHALL use a YAML manifest named `template.yaml` under `prompts/{templateId}/` or a single `prompts/{templateId}.yaml` file. Markdown or text files MAY be referenced by the manifest as content sections, but a raw `.md` or `.txt` file MUST NOT be treated as a complete prompt template without a manifest. Template id SHALL be derived from the manifest path. The manifest `purpose` field MUST be a non-empty safe-id string when present. For non-well-known template ids, developer-defined custom purposes and template variants, the manifest MUST declare purpose and content. When the path-derived template id exactly equals a framework well-known purpose constant, purpose MAY be omitted and SHALL be inferred from that template id. Schema version, match conditions and `modelOptions` SHALL be optional.

The effective public manifest schema version SHALL be `nextagent.prompt-template/v1`. When `schemaVersion` is omitted, the context-engine compiler MUST interpret the manifest as `nextagent.prompt-template/v1`. When `schemaVersion` is present, it MUST equal `nextagent.prompt-template/v1`. JSON manifests MAY exist only as implementation-internal test or migration compatibility input; they MUST NOT be documented as the Agent developer authoring format for this change.

Manifest `match` fields MAY be omitted. When present, they MUST contain only `locale`, `model` and `flowVariables`. `model` MUST align with existing `ModelInfo`/`ModelProfile` vocabulary and MAY contain only string fields `providerKind` and `modelName`; `modelFamily` and `modelId` MUST NOT be introduced as parallel model identity names. `match.model` expresses template compatibility with safe model candidates, not a prompt-owned final model routing decision. During final template selection, a template with omitted `match.model` SHALL be compatible with every trusted selected model; a template with `match.model.providerKind` or `match.model.modelName` SHALL be compatible only when the selected model's corresponding safe fields are equal. During prompt-compatible model id calculation, only `agent` source matched templates with explicit `match.model` SHALL contribute ids. `flowVariables` MUST be a string key/value map for business-defined matching. A flowVariables match entry MUST match only when the internal compatibility or assembly request flowVariables contains the same key with the same string value. Missing keys and unequal string values MUST make that candidate not match. Callers that project from runtime `RequestContext.flowVariables` MUST drop non-string values before calling prompt compatibility or prompt assembly. Internal compatibility and assembly requests MUST NOT accept a caller-supplied second flowVariables match map. `agentId` and `agentVersion` MUST NOT be manifest `match` fields; they are registry/request scope facts. Source layer MUST be derived by context-engine as `builtin` or `agent` from the compile entry, not trusted from user-authored manifest content, and MUST NOT be treated as an external filtering condition.

User-authored manifests MUST NOT declare `templateId`, `templateRef` or any equivalent identity/trace field. Context-engine SHALL derive the template id from trusted prompt root path and manifest logical path, and SHALL derive the internal `templateRef` from trusted source layer, path-derived template id, effective schema version and a content hash or controlled version. For source layer `agent`, `templateRef` MUST include the trusted `agentId` and `agentVersion` supplied to `register`. For source layer `builtin`, `templateRef` MUST NOT include `agentId` or `agentVersion`. Safe errors, internal observations and downstream metadata MAY expose only the path-derived template id and derived `templateRef`, never a user-authored ref or filesystem path.

Manifest `content` MAY be a section string or an ordered array of sections. Section string content SHALL be treated as one implicit inline section with id `main`, and SHALL be valid only for non-system purposes. `PromptPurpose=SYSTEM_PROMPT` MUST use array content so each section id can be validated against builder-owned section ids, but manifest array order MUST NOT determine final system prompt order. For array content, a section MAY be a shorthand string or an object. A shorthand string SHALL mean a file section, and its id SHALL be derived from the file basename without extension. Object sections MUST declare exactly one content source: `file` or `inline`. File objects MAY omit `id`; omitted id SHALL be derived from the file basename without extension. Inline objects MUST declare `id`. For `PromptPurpose=SYSTEM_PROMPT`, derived or explicit section ids MUST reference builder-owned system section ids and MUST be rendered according to builder-owned predefined system order. For non-system purposes such as `SUMMARY_GENERATION` and `MEMORY_EXTRACTION`, section ids SHALL be rendered in manifest order and MUST NOT inherit system prompt section taxonomy.

The context-engine compiler SHALL materialize the public manifest `content` into internal `PromptTemplate.sections` as the canonical ordered section list. Each `PromptSection` SHALL contain the parsed section id, content and inferred variable uses from that content. `PromptSection.variables` SHALL be inferred by the compiler from `{{ variableName }}` required substitutions and `{{ variableName? }}` optional substitutions; each variable use SHALL contain only `name` and `optional`. User-authored manifests MUST NOT declare or override section variables. `PromptTemplate.sections` SHALL be required in the target implementation shape. `TemplateContent.stableSections` and `TemplateContent.dynamicSections` MUST NOT remain in any product path.

User-authored manifests MUST NOT declare per-variable requirements or section optional flags. Variables SHALL be inferred into `PromptSection.variables`, then governed by the system variable registry. Unknown variables MUST fail closed during compilation. Required substitution failures MUST fallback or fail explicitly during rendering. Optional substitutions MAY render empty when the referenced variable resolves empty or is absent from the safe render context. A section whose rendered content is empty MAY be omitted.

#### Scenario: Agent package prompt is registered before serving
- **WHEN** app composition enables an Agent package with `prompts/` candidates
- **THEN** package assembly/app composition MUST provide a trusted absolute prompt root path during synchronous Agent assembly
- **AND** context-engine `register` MUST validate and register usable prompt template candidates during that synchronous Agent assembly before request acceptance
- **AND** runtime-facing `AgentAssembly` MUST NOT require developer-authored prompt template id lists for selection
- **AND** runtime-facing `AgentAssembly` MUST NOT carry prompt text

#### Scenario: Builtin prompt templates are registered before serving
- **WHEN** context-engine prompt template registry is initialized
- **THEN** it MUST compile the package-owned builtin prompt root under `packages/agent-context-engine/prompt-templates/builtin/`
- **AND** it MUST register valid builtin templates into a process-scoped builtin registry bucket with source layer `builtin`
- **AND** builtin compilation failure MUST fail app startup or context-engine composition before request acceptance
- **AND** builtin prompt facts MUST NOT be copied into `AgentAssembly` or duplicated per Agent

#### Scenario: Prompt allowlist fields are removed from AgentAssembly
- **WHEN** target runtime-facing `AgentAssembly` and `AgentRuntimeSettings` contracts are emitted
- **THEN** `AgentAssembly.promptTemplateIds` MUST NOT exist
- **AND** `AgentRuntimeSettings.defaultPromptTemplateId` MUST NOT exist
- **AND** `agent.yaml` MUST NOT require or validate prompt template id allowlists for prompt availability
- **AND** prompt selection MUST use context-engine registered template facts rather than AgentAssembly prompt fields

#### Scenario: Prompt facts stay outside runtime-facing AgentAssembly
- **WHEN** synchronous Agent assembly compiles and publishes prompt templates successfully
- **THEN** the compiled prompt template facts MUST be published to the context-engine-owned Agent-scoped registry
- **AND** the runtime-facing `AgentAssembly` MUST act only as the trusted Agent scope anchor for lookup
- **AND** it MUST NOT embed prompt root paths, raw manifests, prompt body, template file paths, complete `PromptTemplate` objects, complete template content, prompt template id lists, default prompt template id, derived `templateRef` lists or prompt binding/version summaries
- **AND** safe errors, logs, audit candidates, timeline and stream events MUST NOT expose the absolute prompt root path

#### Scenario: Request path does not lazy compile prompt templates
- **WHEN** a request targets an accepted Agent
- **THEN** runtime/context paths MUST use that Agent's already compiled frozen template set
- **AND** they MUST NOT read `prompts/`, parse YAML manifests or call the prompt template compiler to satisfy that request

#### Scenario: YAML manifest with Markdown sections is registered
- **WHEN** an Agent package contains `prompts/telecom-system-zh/template.yaml` referencing `identity.md`
- **THEN** context-engine compiler MUST validate the YAML manifest before serving requests
- **AND** it MUST materialize `identity.md` only as content for the declared template section
- **AND** request path consumers MUST use the registered template fact instead of reading `identity.md`

#### Scenario: Minimal manifest is valid
- **WHEN** an Agent package prompt manifest declares only `purpose` and ordered `content`
- **THEN** context-engine compiler MUST treat it as a valid default candidate when its content entries and ids are valid for the purpose
- **AND** omitted `schemaVersion`, `match` and `modelOptions` MUST NOT require author-provided defaults
- **AND** template id MUST be derived from the manifest path

#### Scenario: Well-known purpose path infers purpose
- **WHEN** an Agent package prompt manifest is located at `prompts/SUMMARY_GENERATION/template.yaml`
- **AND** the manifest omits `purpose`
- **THEN** context-engine compiler MUST infer `PromptPurpose=SUMMARY_GENERATION`
- **AND** template id MUST be derived as `SUMMARY_GENERATION`

#### Scenario: Custom template id or custom purpose still requires purpose
- **WHEN** an Agent package prompt manifest is located at `prompts/compact-summary-zh/template.yaml` or a developer-defined purpose template path
- **AND** the manifest omits `purpose`
- **THEN** context-engine compiler MUST reject the manifest as invalid
- **AND** safe error MUST include only the path-derived template id and safe reason code

#### Scenario: Non-system prompt may use section string content
- **WHEN** a `SUMMARY_GENERATION` or `MEMORY_EXTRACTION` manifest declares `content` as a section string
- **THEN** context-engine compiler MUST treat it as one inline section with id `main`
- **AND** prompt rendering MUST use that content without requiring a separate `.md` or `.txt` file

#### Scenario: System prompt cannot use section string content
- **WHEN** a `SYSTEM_PROMPT` manifest declares `content` as a section string
- **THEN** context-engine compiler MUST reject the manifest as invalid
- **AND** safe error MUST include only the path-derived template id and safe reason code

#### Scenario: File shorthand derives section id
- **WHEN** a manifest content section is the string `identity.md`
- **THEN** context-engine compiler MUST treat it as a file section for `identity.md`
- **AND** the content section id MUST be derived as `identity`

#### Scenario: Dynamic content uses variables
- **WHEN** a manifest content section declares `id: runtime` and `inline: "{{ runtime? }}"`
- **THEN** context-engine compiler MUST treat it as an inline section
- **AND** it MUST materialize the section with a variable use for `runtime` marked optional
- **AND** prompt rendering MUST resolve `runtime` through the system variable registry

#### Scenario: FlowVariables match uses request flow variables
- **WHEN** a template declares `match.flowVariables.networkDomain: mobile-core`
- **AND** the internal prompt assembly request `flowVariables.networkDomain` is the string `mobile-core`
- **THEN** that flowVariables match condition MUST be satisfied for template selection
- **AND** if `networkDomain` is absent, non-string, or a different string, that template candidate MUST NOT match
- **AND** prompt assembly MUST NOT treat `match.flowVariables.networkDomain` as a render variable or accept a caller-supplied flowVariables match map

#### Scenario: Template ref is derived
- **WHEN** context-engine compiler registers a valid prompt template manifest
- **THEN** it MUST derive `templateRef` from trusted prompt root classification, path-derived template id, schema version and template content identity
- **AND** if the source layer is `agent`, the `templateRef` MUST include trusted `agentId` and `agentVersion`
- **AND** if the source layer is `builtin`, the `templateRef` MUST NOT include `agentId` or `agentVersion`
- **AND** the user-authored manifest MUST NOT supply or override that ref

#### Scenario: Manifest identity fields are rejected
- **WHEN** an Agent package prompt manifest declares `templateId`, `templateRef` or an equivalent identity field
- **THEN** context-engine compiler MUST reject the manifest as invalid
- **AND** safe error MUST include only the path-derived template id and safe reason code

#### Scenario: Raw Markdown is not a template
- **WHEN** an Agent package contains `prompts/freeform.md` without a YAML manifest declaring template id and purpose
- **THEN** context-engine compiler MUST NOT register it as a prompt template
- **AND** no Agent configuration field MUST be able to bind that raw file as a template

#### Scenario: Content ids are interpreted by purpose
- **WHEN** a `SYSTEM_PROMPT` manifest declares a content section id that is not a builder-owned section id
- **THEN** context-engine compiler MUST reject the template as invalid
- **AND** safe error MUST identify the safe template id and reason without exposing prompt text or file paths

#### Scenario: System prompt ignores manifest section order
- **WHEN** a `SYSTEM_PROMPT` manifest declares valid system section ids in an order different from the builder-owned system section order
- **THEN** prompt rendering MUST use the builder-owned system section order
- **AND** it MUST NOT use manifest array order to change system/developer instruction, telecom domain instruction, locale metadata, capability disclosure, cache boundary or other system section placement

#### Scenario: Non-system content remains ordered sections
- **WHEN** a `SUMMARY_GENERATION` or `MEMORY_EXTRACTION` manifest declares ordered content sections
- **THEN** context-engine compiler MUST materialize those sections into `PromptTemplate.sections` in manifest order
- **AND** prompt rendering MUST render those sections in manifest order into `PromptAssemblyResult.renderedContent`
- **AND** it MUST NOT apply system-prompt section ordering, cache boundary or section taxonomy

#### Scenario: Request path does not reparse prompts
- **WHEN** context engine、summary generation 或 memory extraction needs a prompt
- **THEN** it MUST call prompt template assembly resolver or consume its precompiled result
- **AND** it MUST NOT read `agent.yaml`, `prompts/`, app config prompt files, or built-in resource files directly on the request path

### Requirement: Prompt assembly observations are safe and bounded
Prompt template assembly MAY provide presentation-safe internal observations for template selection, fallback, rejected candidate, missing variable, optional omission, model options handoff and rendering failure. Fatal prompt assembly failures SHALL be reported through safe errors. `PromptAssemblyResult` MUST NOT include diagnostics. Safe errors and internal observations MUST NOT include prompt text, model output, raw provider payload, raw template body, local paths, credentials, tokens, attachment content, tool arguments/results, or high-cardinality unbounded payload fields.

#### Scenario: Fallback observation is safe
- **WHEN** selected higher-priority template is unavailable and assembly falls back to a lower-priority template
- **THEN** internal safe observation MAY include purpose, safe candidate id, safe fallback reason and selected `templateRef`
- **AND** it MUST NOT include the unavailable template body or filesystem path

#### Scenario: Prompt text is excluded from logs
- **WHEN** prompt assembly succeeds or fails
- **THEN** structured logs, safe errors, metrics and audit-related observations MUST NOT include rendered prompt text or raw template text

### Requirement: System prompt memory guidance section

系统 SHALL 在 builtin `SYSTEM_PROMPT` 模板中提供一个 `memory` section 作为 builder-owned system section，渲染顺序位于 `tooling` 之后、`action_safety` 之前。`memory` section 的内容 SHALL 来自独立的内容文件 `memory.md`，与其他 system section 形态一致，不通过 inline 变量承载正文。

`memory` section SHALL 仅当装配上下文的 `memoryEnabled` 投影为 true 时被渲染。`memoryEnabled` 为 true 即等价于 app 注入的记忆门控 capability id 出现在该 Agent 的模型可见 capability 集合中——也就是说，模型实际能调用该记忆工具；当该 capability id 不在集合中时，模型无法调用记忆工具，`memory` 指导段无意义，MUST NOT 渲染。当 `memoryEnabled` 为 false 或未提供时，system render policy MUST 在公共变量替换之前过滤掉 `memory` section，使其不出现在最终 system prompt 中。

`memory.md` 指导正文 SHALL 以策略层为主：何时记、记什么、不记什么、何时检索、核验与边界。`memory.md` MAY 承载与存取策略紧密相关的最小调用提示，例如单次 ID 上限（`get_memory_detail` 最多 20 个 `longTermMemoryIds`）或按 `category` 的内容字段格式清单（`FACTUAL` / `CONCEPTUAL` / `PROCEDURAL` / `USER_CHARACTERISTICS` 的最小字段组合）。`memory.md` MUST NOT 重复完整工具 schema、L1/L2 渐进披露流程、`purpose` 语义、`nextAction` 回执或其他纯工具机制细节；这些 SHALL 由工具描述承载。`memory.md` MUST NOT 让 context assembly 自动检索或注入长期记忆结果，MUST NOT 预加载任何记忆条目到 system prompt，MUST NOT 提及文件路径、frontmatter、`MEMORY.md`、`update_memory` 或 `forget_memory`（首版不暴露这些工具）。该 section 不改变 `memory-tools` / `memory-core` / `memory-extraction` / `memory-aging` 的任何行为契约。

**需求类别**：功能性需求

#### Scenario: Memory enabled renders guidance section
- **WHEN** 一次 `SYSTEM_PROMPT` 装配的 `memoryEnabled` 投影为 true
- **THEN** `memory` section MUST 出现在最终 system prompt 中，顺序位于 `tooling` section 之后、`action_safety` section 之前
- **AND** 该 section 内容 MUST 来自 `memory.md`

#### Scenario: Memory not enabled omits guidance section
- **WHEN** 一次 `SYSTEM_PROMPT` 装配的 `memoryEnabled` 投影为 false 或未提供
- **THEN** system render policy MUST 过滤掉 `memory` section
- **AND** `memory` section MUST 不出现在最终 system prompt 中

#### Scenario: Memory guidance does not preload memory
- **WHEN** `memory` section 被渲染
- **THEN** 该 section 内容 MUST NOT 包含任何已检索的记忆条目、记忆内容或记忆 id
- **AND** 该 section MUST NOT 指示 context assembly 自动检索或注入长期记忆

#### Scenario: Memory guidance carries minimal call hints without duplicating tool schema
- **WHEN** `memory` section 被渲染
- **THEN** 该 section MAY 包含与存取策略紧密相关的最小调用提示（单次 ID 上限、按 category 内容字段格式清单）
- **AND** 该 section MUST NOT 重复完整工具 schema、L1/L2 渐进披露流程、`purpose` 语义或 `nextAction` 回执
- **AND** 该 section MUST NOT 提及文件路径、frontmatter、`MEMORY.md`、`update_memory` 或 `forget_memory`

### Requirement: Prompt 日历变量使用同一进程本地语义

当 Prompt Template 渲染受治理变量 `timezone` 或 `currentDate` 时，系统 MUST 从同一次渲染的进程本地日历事实解析两个变量。`timezone` MUST 表示该进程的 IANA 时区，`currentDate` MUST 表示该时区中渲染时刻对应的 `YYYY-MM-DD` 日历日期。系统 MUST NOT 使用 UTC 日期与非 UTC 的 `timezone` 组成同一次渲染结果。

**需求类别**：功能性需求

#### Scenario: 正时区跨 UTC 日期边界

- **WHEN** 进程时区为 `Asia/Shanghai`，渲染时刻为 `2026-08-09T18:00:00.000Z`
- **THEN** `timezone` MUST 为 `Asia/Shanghai`
- **AND** `currentDate` MUST 为 `2026-08-10`

#### Scenario: 负时区跨 UTC 日期边界

- **WHEN** 进程时区为 `America/New_York`，渲染时刻为 `2026-08-10T01:00:00.000Z`
- **THEN** `timezone` MUST 为 `America/New_York`
- **AND** `currentDate` MUST 为 `2026-08-09`

#### Scenario: UTC 日期与本地日期相同

- **WHEN** 进程时区为 `UTC`，渲染时刻为 `2026-08-10T01:00:00.000Z`
- **THEN** `timezone` MUST 为 `UTC`
- **AND** `currentDate` MUST 为 `2026-08-10`

### Requirement: System prompt skill disclosure section

系统 SHALL 在 builtin `SYSTEM_PROMPT` 模板中提供一个 `skill_disclosure` section 作为 builder-owned system section，渲染顺序位于 `memory` section 之后、`action_safety` section 之前，并 SHALL 归入 dynamic system sections（渲染在 CACHE_BOUNDARY 之后）。

`skill_disclosure` section SHALL 仅当渲染门控满足时渲染：当前 model step 有可见且 AVAILABLE 的 `Skill` tool entry，且 skill disclosure 列表投影非空（`tool-search` 模式下还要求 `ToolSearch` tool entry 可见）。门控不满足时 system render policy MUST 在公共变量替换之前过滤掉该 section；该过滤 MUST 同样约束 agent 层覆盖的 `skill_disclosure` section 内容，覆盖 MUST NOT 绕过省略规则。

builtin `skill_disclosure` section 的默认内容 SHALL 来自独立内容文件 `skill-disclosure.md`（section 骨架，引用 `{{ skillDisclosureList }}` 投影 governed Skill 列表和 `{{ skillDisclosureBody }}` 投影模式匹配的默认正文）；两套默认英文正文 SHALL 分别存放于同目录的 `skill-disclosure-list.md` 与 `skill-disclosure-tool-search.md` markdown 文件；默认渲染产物 SHALL 与 renderer 硬编码时代逐字一致。Agent MAY 通过 agent-over-builtin SYSTEM_PROMPT 覆盖机制定制该 section 内容；覆盖内容 MAY 引用 `{{ skillDisclosureList }}` 和 `{{ skillDisclosureMode }}`，MAY 不引用任何投影变量，覆盖后 builtin 默认正文不再参与渲染。

`skill_disclosure` section 的 surface MUST 限于 headings、governed Skill names、safe descriptions、披露模式事实和 usage instructions；MUST NOT 包含 skill body、文件路径、frontmatter、provider 内部 id 或 source identity。skill 列表在最终 system prompt 中 MUST 只出现一次：`tooling` section MUST NOT 渲染 skill 列表。

**需求类别**：功能性需求

#### Scenario: 门控满足时渲染 skill disclosure section
- **WHEN** 一次 `SYSTEM_PROMPT` 装配的渲染门控满足（`Skill` tool 可见且列表投影非空）
- **THEN** `skill_disclosure` section MUST 出现在最终 system prompt 中，顺序位于 `memory` section 之后、`action_safety` section 之前，且渲染在 CACHE_BOUNDARY 之后
- **AND** 该 section 的 builtin 默认内容 MUST 来自 `skill-disclosure.md` 并引用 `{{ skillDisclosureList }}` 投影

#### Scenario: 门控不满足时省略 skill disclosure section
- **WHEN** 一次 `SYSTEM_PROMPT` 装配的 `Skill` tool entry 不可见，或 skill disclosure 列表投影为空
- **THEN** system render policy MUST 过滤掉 `skill_disclosure` section
- **AND** `skill_disclosure` section MUST 不出现在最终 system prompt 中

#### Scenario: Agent 覆盖 skill_disclosure section 生效
- **WHEN** Agent template 提供同 id 的 `skill_disclosure` section 覆盖 builtin，且渲染门控满足
- **THEN** 最终 system prompt 的该 section 内容 MUST 完全来自 Agent 覆盖内容，builtin 默认正文 MUST NOT 参与渲染
- **AND** 覆盖内容引用的 `{{ skillDisclosureList }}` MUST 解析为与 builtin 路径相同的 governed 投影
- **AND** 覆盖内容引用的 `{{ skillDisclosureMode }}` MUST 解析为当前 trusted 披露模式值

#### Scenario: skill 列表在 system prompt 中只出现一次
- **WHEN** 一次 `SYSTEM_PROMPT` 装配完成渲染
- **THEN** governed Skill bullet 列表 MUST 只出现在 `skill_disclosure` section 中
- **AND** `tooling` section MUST NOT 包含 skill 列表或任何 Skill bullet

#### Scenario: tool-search 模式渲染差异化默认正文
- **WHEN** `skillDisclosureMode` 为 `tool-search` 且 `Skill` 与 `ToolSearch` tool entry 均可见
- **THEN** builtin 默认 `skill_disclosure` 内容 MUST 渲染 tool-search 模式正文，包含通过 `ToolSearch` 发现 deferred Skills 和按 `defer_loading=true` 语义加载的指令
- **AND** enabled Skill 列表 MUST 只包含非 HIDDEN 的 model-invocable Skills（DEFERRED Skills 不进列表）

### Requirement: 内置系统提示提供有界产物执行指导

系统 MUST 在 builtin `SYSTEM_PROMPT` 的 `task_approach` section 中提供复杂 workspace task 的有界产物推进指导。该指导 MUST 要求模型先执行确定产物结构所需的最小检查，再识别用户明确要求的全部工作区产物和可由可用 Tool 本地检查的验收条件；结构确定后 MUST 尽早创建每个必需产物的最小有效版本，再使用多个有界 Tool call 增量补全大体量内容，并在结束前验证必需产物存在且满足明确的本地格式要求。该指导 MUST NOT 包含特定 benchmark 的 task id、固定答案、oracle 规则、rubric 内容或 grader 反馈。Agent package 对 `task_approach` section 的既有覆盖优先级 MUST 保持不变。

**需求类别**：系统质量属性
**质量属性**：性能/容量
**适用范围**：该 Function

#### Scenario: 最小检查后尽早创建全部必需产物

- **WHEN** 系统装配 builtin `SYSTEM_PROMPT`
- **THEN** `task_approach` section MUST 要求模型只执行确定产物结构所需的最小检查
- **AND** 该 section MUST 要求模型识别全部必需工作区产物和可本地检查的验收条件
- **AND** 结构确定后，该 section MUST 要求尽早创建每个必需产物的最小有效版本
- **AND** 该 section MUST 要求使用多个有界 Tool call 增量补全大体量内容

#### Scenario: 任务完成前接收产物验证指导

- **WHEN** 系统装配 builtin `SYSTEM_PROMPT`
- **THEN** `task_approach` section MUST 要求模型在结束前检查全部必需产物是否存在
- **AND** 对 JSON、CSV 或其他可由可用 Tool 本地检查的明确格式，section MUST 要求模型运行匹配的本地验证

#### Scenario: Builtin 指导保持通用且可覆盖

- **WHEN** 系统装配 builtin `SYSTEM_PROMPT` 或 Agent package 覆盖 `task_approach` section
- **THEN** builtin 指导 MUST NOT 包含特定 benchmark 的 task id、固定答案、oracle 规则、rubric 内容或 grader 反馈
- **AND** Agent package 的 `task_approach` section MUST 继续按既有 source priority 覆盖 builtin section

### Requirement: 内置系统提示提供语义验收闭环指导

系统 MUST 在 builtin `SYSTEM_PROMPT` 的 `task_approach` section 中，为正确性依赖用户显式规则和本地来源证据的 workspace task 提供语义验收闭环指导。该指导 MUST 要求模型在宣称完成前逐项关联与所请求结果相关的全部显式规则、支持该规则判断的来源证据和对应产出结果，并复核规则覆盖、证据支持以及结果间一致性。对分类、聚合、交叉引用和审计结果，该指导 MUST 要求模型从来源证据重新核对关键分类、数量和引用关系；发现不一致时 MUST 先修正结果，来源证据不足或显式规则冲突时 MUST 明确保留可核查的限制说明。该指导 MUST 明确文件存在、语法可解析或格式验证通过均不能单独证明语义验收完成，且 MUST NOT 引导模型编造缺失事实。

该指导 MUST 保持通用，不得包含特定 benchmark 的 task id、固定答案、oracle 规则、rubric 内容或 grader 反馈。Agent package 对 `task_approach` section 的既有覆盖优先级 MUST 保持不变。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: 规则驱动任务接收语义验收指导

- **WHEN** 系统装配 builtin `SYSTEM_PROMPT`
- **THEN** `task_approach` section MUST 要求模型在宣称规则驱动的 workspace task 完成前逐项关联与所请求结果相关的全部显式规则、来源证据和对应产出结果
- **AND** 该 section MUST 要求模型复核这些显式规则的覆盖情况、每项结果的证据支持以及结果间一致性
- **AND** 该 section MUST 明确文件存在、语法可解析或格式验证通过均不能单独证明语义验收完成

#### Scenario: 分类和聚合结果从来源证据重新核对

- **WHEN** 系统装配 builtin `SYSTEM_PROMPT`
- **THEN** `task_approach` section MUST 要求模型在规则驱动的 workspace task 包含分类、聚合、交叉引用或审计结果时，从来源证据重新核对适用的关键分类、数量和引用关系
- **AND** 发现产出结果与来源证据不一致时，该 section MUST 要求模型先修正结果再宣称完成

#### Scenario: 证据不足或规则冲突时不编造结果

- **WHEN** 系统装配 builtin `SYSTEM_PROMPT`
- **THEN** `task_approach` section MUST 要求模型在本地来源证据不足以支持结果，或两个显式规则对同一结果产生冲突时，保留可核查的限制说明
- **AND** 该 section MUST NOT 引导模型补写没有来源证据支持的事实

#### Scenario: Builtin 指导保持通用且可覆盖

- **WHEN** 系统装配 builtin `SYSTEM_PROMPT` 或 Agent package 覆盖 `task_approach` section
- **THEN** builtin 指导 MUST NOT 包含特定 benchmark 的 task id、固定答案、oracle 规则、rubric 内容或 grader 反馈
- **AND** Agent package 的 `task_approach` section MUST 继续按既有 source priority 覆盖 builtin section
