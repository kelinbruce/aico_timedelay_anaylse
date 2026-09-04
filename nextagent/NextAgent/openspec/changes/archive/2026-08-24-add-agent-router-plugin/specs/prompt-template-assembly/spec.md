# prompt-template-assembly Delta Specification

## Function

- **所属 Function**：`FN-10.4 自定义工具和提示词`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

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

该边界 SHALL 接收可信投影的 prompt input，其中包含 `purpose`、`agentId`、`agentVersion`、`locale`、值 MUST 只为 string 的 `flowVariables`、required safe `selectedModel` 和 optional safe `memoryEnabled`。`selectedModel` MUST 是只含实际调用所选 `ResolvedModelConfiguration.modelId` 的封闭对象。该 `modelId` 用于 canonical exact matching，且与传给 provider 的模型标识相同。`memoryEnabled` SHALL 只用于 `memory` system section 的受治理条件渲染，MUST NOT 影响 template/model selection、model options handoff 或写入 prompt text。该边界 SHALL 返回 selected safe template identity、rendered prompt sections/content 和 optional model options override。

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

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：提示词模板通过唯一 public resolver contract 支撑 router 与其它 model-facing consumer，同时保持注册模板的选择、fallback 与渲染归 Context Engine；consumer-owned default content 不进入 Context Engine。
- **依据 Requirements**：`Prompt templates are assembled by purpose`、`Prompt assembly has one decision boundary`、`Prompt assembly boundary guardrails`

### 接口

- **变更类型**：修改
- **目标内容**：新增 `PromptTemplateResolverPort.resolve(request, signal)` 及最小 closed request/`RESOLVED | NOT_FOUND` result schemas；不公开 registry、loader、compiler、template source 或 internal assembler。
- **依据 Requirements**：`Prompt assembly has one decision boundary`、`Prompt assembly boundary guardrails`

### 规格

- **规格项**：内置 Prompt purpose
- **变更类型**：修改
- **原规格值**：`SYSTEM_PROMPT`、`SUMMARY_GENERATION`、`MEMORY_EXTRACTION`
- **目标规格值**：增加 `AGENT_ROUTING_SELECTION`；开发者仍可使用合法自定义 purpose
- **依据 Requirements**：`Prompt templates are assembled by purpose`

- **规格项**：跨场景 template resolution
- **变更类型**：新增
- **原规格值**：无 public resolver contract
- **目标规格值**：其它 model-facing consumer 只通过唯一 `PromptTemplateResolverPort` 使用 frozen Agent-scoped template selection/rendering
- **依据 Requirements**：`Prompt assembly has one decision boundary`、`Prompt assembly boundary guardrails`
