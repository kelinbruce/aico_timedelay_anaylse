# prompt-template-assembly Delta Specification

所属 Function：`FN-10.4 自定义工具和提示词`

Function 变更类型：修改

spec 角色：主规格

## MODIFIED Requirements

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

## Function 变更汇总

### 描述

- 变更类型：修改
- 目标内容：Prompt Template 可以通过 canonical `ModelInferenceOptions` handoff 声明 `ToolChoice`。
- 依据 Requirements：`Prompt template selection is deterministic`

### 输入

- 变更类型：修改
- 目标内容：template `modelOptions` closed schema 增加 optional `toolChoice: AUTO | NONE | REQUIRED`。
- 依据 Requirements：`Prompt template selection is deterministic`

### 输出

- 变更类型：修改
- 目标内容：selected template 的合法 `toolChoice` 作为 optional override 原样交给 Context Engine。
- 依据 Requirements：`Prompt template selection is deterministic`

### 结果

- 变更类型：修改
- 目标内容：Prompt authoring 可以控制模型是否可选择 Tool，但不能提供 named-tool choice 或 provider-native 平行字段。
- 依据 Requirements：`Prompt template selection is deterministic`
