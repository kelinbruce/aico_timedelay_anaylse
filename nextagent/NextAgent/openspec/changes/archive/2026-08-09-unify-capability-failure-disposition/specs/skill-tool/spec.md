# Skill Tool Delta Specification

所属 Function：`FN-5.9 调用技能`

Function 变更类型：修改

spec 角色：主规格

## MODIFIED Requirements
### Requirement: Skill tool is the model-facing Skill execution entry

系统 SHALL 暴露 `Skill` tool，作为模型按名称执行受治理 Skill 的 model-facing Tool 入口。Model-facing input schema MUST 为 `{ name: string, args?: object }`；`name` MUST 通过 `CapabilityInvocationRuntimeContext.capabilityResolver` 标识一个 Skill。首版 Skill name MUST 是由 manifest `name` 生成的 Skill `CapabilityDescriptor.capabilityId`，model-visible disclosure MUST 包含 descriptor 满足 `modelInvocable=true` 的子集。Optional `args` MUST 只包含目标 Skill task data。一次 model `Skill` tool_use MUST 恰好产生一个相关联的 model-facing tool_result。Agent Core MUST 把 `Skill` 作为普通 Capability invocation：解析模型调用的 `Skill` tool，并通过 `CapabilityInvocationPort` 进入该 Tool 的实现。`Skill` Tool MUST 通过 `RuntimeCapabilityResolver.resolveCapability(...)` 把 `name` 解析为内部 Skill id/descriptor，并在同一次 invocation 中完成目标 Skill 执行；最终 provider tool_result MUST 由一个 authoritative `CapabilityInvocationResult` 驱动。

**需求类别**：功能性需求

#### Scenario: Skill tool 按受治理名称解析目标
- **WHEN** 模型使用合法 `name` 调用 `Skill`
- **THEN** 系统 MUST 只把 `name` 作为目标 Skill name
- **AND** 该名称 MUST 等于 Skill `CapabilityDescriptor.capabilityId`/manifest `name`
- **AND** 目标解析 MUST 使用带 `kind="SKILL"` 的 `RuntimeCapabilityResolver.resolveCapability(...)`，并把名称映射为内部 Skill id/descriptor
- **AND** 目标 Skill 执行 MUST 由 governed availability 授权，而不是由 `modelInvocable` 授权
- **AND** resolved Skill metadata `context` MUST 只由 `Skill` Tool 用于内部 dispatch

#### Scenario: Skill tool descriptor 引导模型调用
- **WHEN** Context Engine 投影 model-callable `Skill` tool descriptor
- **THEN** descriptor description MUST 告知模型：`Skill` 在主对话内执行受治理 Skill
- **AND** 当列表中的 available Skill 明确匹配用户请求时，MUST 指示模型先调用 `Skill` 再回答任务
- **AND** 只有 `/` 后的文本与 available Skill 精确匹配时，MUST 才把 `/commit` 等 slash command 视为可能的 Skill name
- **AND** MUST 指示模型让 `/help`、`/clear` 等 built-in CLI commands 使用 canonical CLI command path
- **AND** MUST 要求使用精确的 available Skill name 和 task-specific JSON object `args`
- **AND** MUST 把模型输入定义为精确的 available Skill name 加 task-specific JSON object `args`
- **AND** MUST 指示模型只有在 `Skill` tool 实际成功调用后才声称使用了 Skill

#### Scenario: Execution mode 由 metadata 驱动
- **WHEN** 模型使用 `name` 调用 `Skill`
- **THEN** model-facing contract 对 `inline` 和 `fork` MUST 保持 mode-agnostic
- **AND** dispatch authority MUST 是受治理的 resolved Skill metadata
- **AND** `Skill` Tool MUST 只从受治理的 resolved Skill metadata 推导行为
- **AND** visible tool_result content MUST 使用本 Requirement 定义的安全 acknowledgement/error surface

#### Scenario: Timeout 受 ToolExecutor policy 治理
- **WHEN** 模型调用 `Skill`
- **THEN** model-facing input schema MUST 只接受受治理 Skill selection 和目标 Skill task data
- **AND** effective timeout MUST 从当前 request/run deadline 和 AbortSignal、Capability invocation policy、governed Skill metadata hints 以及 ToolExecutor defaults 推导
- **AND** MUST 应用所有适用 timeout 中最严格的值

#### Scenario: Args 使用有界 JSON target-data envelope
- **WHEN** 模型使用 `args` 调用 `Skill`
- **THEN** `args` root MUST 是 JSON object
- **AND** `args` MUST 只包含可 JSON 序列化的目标 task data
- **AND** `args` 序列化为 UTF-8 JSON 后 MUST NOT 超过 `skillToolArgsMaxBytes`
- **AND** `args` MUST NOT 超过 `skillToolArgsMaxDepth`
- **AND** 除非产品配置提供更小值，首版 defaults MUST 为 `skillToolArgsMaxBytes=8192` 和 `skillToolArgsMaxDepth=8`
- **AND** per-Skill semantic argument validation MUST NOT 由本 contract 执行

#### Scenario: Model invocability 控制 disclosure eligibility
- **WHEN** Skill descriptor 满足 `modelInvocable=false`
- **THEN** Context Engine MUST 只披露 descriptor 满足 `modelInvocable=true` 的 Skills
- **AND** model-originated `Skill` tool_use MUST NOT 执行 `name` 未通过 `CapabilityInvocationRuntimeContext.capabilityResolver` 解析的 Skill；解析失败时 MUST 返回安全失败
- **AND** 任一可信 user/channel explicit Skill invocation MUST 由具有独立治理的 channel/core entry path 处理
- **AND** 该 explicit path MUST 通过 Agent Scope、Owner Scope、catalog visibility 和 Skill tool result contract 进入 Agent execution

#### Scenario: 受治理名称解析安全处理非 Skill 输入
- **WHEN** `name` 形似 path 或 provider-private ref
- **THEN** target lookup MUST 使用 governed resolver lookup
- **AND** 未解析或不可用目标 MUST 返回安全 failed result

#### Scenario: Skill tool 为原始 tool_use 返回一个结果
- **WHEN** Skill execution 成功、降级、失败、超时或被 canceled/aborted
- **THEN** Agent Core MUST 为原始 `Skill` tool_use 接收一个 `CapabilityInvocationResult`
- **AND** Agent Core MUST 投影恰好一个与原始 tool_use id 相关联的 provider tool_result
- **AND** generated messages、context patches、audit refs 和 safe result projections MUST 保持为同一 execution result 的组成部分

#### Scenario: 被中断的 Skill tool 调用获得终态
- **WHEN** `Skill` tool_use 处于 pending 或 running，且 run 被 aborted、interrupted、recovered，或因非法 result shape 被拒绝
- **THEN** Agent Core MUST 为原始 tool_use id 产生恰好一个安全 terminal tool_result
- **AND** 执行中的 cancel/abort MUST 以 terminal `FAILED` result 和稳定安全失败原因 `ABORTED` 结算
- **AND** 只有每个 `Skill` tool_use 都达到 terminal settlement 后，provider turns MUST 才继续

#### Scenario: 可见 Skill 列表排除 body 和 location
- **WHEN** model context 披露 available Skills
- **THEN** MUST 呈现当前 Agent Scope 和 Owner Scope 可见的 governed Skill names 与 safe descriptions
- **AND** governed Skill name MUST 是由 manifest `name` 生成的 Skill `CapabilityDescriptor.capabilityId`
- **AND** disclosure surface MUST 限于 governed Skill names 和 safe descriptions

#### Scenario: 可见 Skill 列表由 context capability disclosure 装配
- **WHEN** 系统准备一个 model step
- **THEN** context assembly 和 Capability disclosure path MUST 在通过 Agent Scope、Owner Scope、binding、availability 和 policy gates 后，请求满足 `modelInvocable=true` 的当前 request-scope catalog view 并构建 model-visible Skill list
- **AND** Capability Catalog MUST 应用 `modelInvocable` condition，并把它传给 search/discovery providers，使 provider 能在支持时避免返回 default-hidden Capabilities
- **AND** `Skill` Tool MUST 使用 `CapabilityInvocationRuntimeContext.capabilityResolver` 解析目标
- **AND** model-visible Skill list refresh MUST 保持在 canonical context assembly 和 Capability disclosure path

#### Scenario: 执行期 Capability 解析由 resolver 管理
- **WHEN** Skill Tool 或内部 Capability path 需要在执行期解析目标 Skill、MCP tool、CLIP Capability 或其他 default-hidden Capability
- **THEN** MUST 使用绑定当前 request 可信 Agent Scope 和 Owner Scope 的 `CapabilityInvocationRuntimeContext.capabilityResolver`
- **AND** execution-time lookup authority MUST 是 `CapabilityInvocationRuntimeContext.capabilityResolver`
- **AND** `visibleCapabilities` MUST 保持为 ContextAssembly/RenderedModelInput 的 model-visible result
- **AND** resolver MUST 应用 catalog binding、availability、provider policy 和精确 `kind + providerId? + capabilityId` matching
- **AND** request-local `allowedTools`/`deniedTools` policies MUST 由 context disclosure 或 invocation policy 应用

#### Scenario: Runtime resolver 使用 scheme-B contract shape
- **WHEN** Capability contract 定义 execution-time resolve support
- **THEN** `agent-contracts/capability` MUST 定义带 flat fields `kind`、`capabilityId` 和 optional `providerId` 的 `RuntimeCapabilityResolveRequest`
- **AND** MUST 定义带 `resolveCapability(request, signal)` 的 `RuntimeCapabilityResolver`
- **AND** MUST 定义带 optional `capabilityResolver` 的 `CapabilityInvocationRuntimeContext`
- **AND** MUST 使用 flat scheme-B runtime resolver request shape

#### Scenario: Context render 按 kind 划分可见 Capabilities
- **WHEN** Context Engine 从 governed visible Capability view 渲染 model step
- **THEN** MUST 按 `kind="TOOL"` 选择 model-callable tools，MUST NOT 只按是否存在 `inputSchema` 选择
- **AND** MUST 从 visible `TOOL` 子集中投影 provider tool descriptors；这些 descriptor MUST 满足 `modelInvocable=true`，或已由 request-local `CapabilityContextPatch.allowedTools` 激活，并且其 `inputSchema` MUST 满足 model tool descriptor contract
- **AND** MUST 按 `kind="SKILL"` 选择 Skill disclosure entries
- **AND** MUST 披露 descriptor 满足 `modelInvocable=true` 的 Skills
- **AND** request-local `CapabilityContextPatch.allowedTools` MUST 使其中通过治理校验的 available `TOOL` Capabilities 在下一 model step 可见，包括 `modelInvocable=false` 的 descriptors；未列入时 MUST 保持 baseline visibility
- **AND** Context Engine MUST 基于 governed available catalog view 校验 `allowedTools`，非法 entry MUST 在 Context Engine governance boundary 失败
- **AND** Context Engine MUST 在合并 baseline model-visible descriptors 和 `allowedTools` activation 后应用 request-local `CapabilityContextPatch.deniedTools`
- **AND** `deniedTools` MUST 按 `capabilityId` 或 `@providerId/capabilityId` 从当前 model-visible set 排除匹配的 `TOOL` descriptors；当前 visible set 中不存在的 denied refs MUST 被忽略
- **AND** 除非每个 Capability 显式声明 `modelInvocable=true`，非默认激活 providers（包括 MCP Server 和 CLIP providers）MUST 把 discovered Capabilities 默认为 `modelInvocable=false`

#### Scenario: Skill disclosure 使用固定英文 prompt 格式
- **WHEN** 当前 model step 有可见 `Skill` tool entry 和至少一个可见 model-invocable Skill
- **THEN** Context Engine MUST 追加英文 system-prompt section，heading 恰好为 `### Available skills` 和 `### How to use skills`
- **AND** `### Available skills` list MUST 按 `- <skill-name>: <safe description>` 格式为每个 visible Skill 包含一个 bullet
- **AND** `### How to use skills` section MUST 指示模型为列表中的 Skills 调用 `Skill` tool、使用精确列出的 `name`、让 `args` 保持为 task-specific JSON、使用 governed names，并在没有列表 Skill 明确匹配时安全继续使用普通 tools
- **AND** 为匹配已实现的 system-prompt language baseline，该 section MUST 保持英文
- **AND** section surface MUST 限于 headings、governed Skill names、safe descriptions 和 usage instructions

#### Scenario: Skill disclosure 遵循 Skill tool visibility
- **WHEN** request-local tool filtering 后，当前 model step 没有可见 `Skill` tool entry
- **THEN** Context Engine MUST 使用 base system prompt 和当前可见 provider tools 渲染 model input
- **AND** `allowedTools` activation MUST 使已解析的 governed `TOOL` descriptors model-visible
- **AND** `deniedTools` 包含 `Skill` wrapper tool 的 governed ref 时，final exclusion MUST 从当前 model-visible `TOOL` set 移除该 tool，并且该 step MUST 同时省略 Skill disclosure；不包含时 MUST NOT 因此移除

#### Scenario: SKILL.md discovery 与 invocation 使用同一格式语义
- **WHEN** 系统解析或加载 `SKILL.md`
- **THEN** discovery 与 invocation MUST 对 leading-frontmatter detection、metadata field interpretation、descriptor/SkillMetadata mapping、safe diagnostics、canonical body slicing 和 source consistency token 使用同一组格式语义
- **AND** discovery-time metadata view 与 invocation-time body view MUST 共享相同 parsing primitives 和 consistency rules
- **AND** catalog resolve、provider selection、source root lookup 和 loading authority MUST 遵守 canonical catalog/source contract
- **AND** 系统 MUST NOT 为 Skill tool、model context、runtime 或 source-specific adapter 使用语义不同的平行 parser 或 body slicing 规则

#### Scenario: Discovery 使用 metadata view 且 invocation 使用 canonical body view
- **WHEN** Skill sources 执行 discovery、indexing 或 model-visible Skill list preparation
- **THEN** MUST 只解析 descriptor registration、model visibility、availability 和 governance 所需的标准 manifest 与 metadata facts
- **AND** discovery/indexing MUST 只使用 metadata view
- **AND** source-owned loading facts MUST NOT 进入 metadata view、model-visible Skill list 或 public result

#### Scenario: Skill tool 通过 registered source 加载 canonical body
- **WHEN** 已授权 inline Skill execution 需要 Skill body content
- **THEN** Skill tool MUST 只通过 resolved descriptor 已注册且受治理的 Skill source 请求 body
- **AND** 返回的 canonical body view MUST 按 discovery 使用的同一格式语义排除 frontmatter
- **AND** 该 body view MUST 包含足以与 resolved descriptor 比较的安全 internal source identity、version、hash 或等价 consistency token
- **AND** descriptor metadata、model context、visible tool_result、stream payload、safe error、audit detail 和 logs MUST 只包含安全 governed identifiers 和 safe result fields

#### Scenario: Descriptor 与 body view 保持一致
- **WHEN** invocation-time body loading 返回 canonical body view
- **THEN** Skill tool MUST 校验 provider id、Skill identity/name、source identity、version、hash 或等价 consistency token 与 resolved descriptor 匹配
- **AND** source change、disappearance、re-parse identity change 或缺少 descriptor/body consistency proof 时，MUST 按 catalog policy 通过安全失败或 governed re-resolve 结算
- **AND** body 不匹配时 MUST 通过安全失败或 governed re-resolve 结算

#### Scenario: Inline mode 通过同一 result 添加 hidden context
- **WHEN** resolved Skill 声明 `context=inline`
- **THEN** inline execution path MUST 在成功 Skill tool execution result 内返回 request-local hidden generated messages
- **AND** 这些 generated messages MUST 只作为下一 model step 的 request-local hidden generated context 交付

#### Scenario: Inline mode 返回固定 acknowledgement 和 hidden context
- **WHEN** inline Skill execution 成功
- **THEN** 原始 `Skill` tool_use 的 visible tool_result MUST 是从 governed Skill name 和 load status 等 trusted facts 推导的固定安全 acknowledgement `{ name, status: "loaded" }`
- **AND** acknowledgement MUST 通过 `CapabilityInvocationResult.structuredPayload` 返回
- **AND** 同一 result 中的 hidden generated message MUST 为下一 model step 携带已授权 canonical Skill body
- **AND** visible acknowledgement surface MUST 限于该固定 acknowledgement shape

#### Scenario: Inline generated message 使用稳定 envelope
- **WHEN** inline Skill execution 把 Skill body 加入 hidden generated context
- **THEN** generated message MUST 使用稳定 `<skill_content name="{safe skill name}">...</skill_content>` envelope
- **AND** envelope 的 `skill_content` 内 MUST 直接包含排除 frontmatter 的已授权 canonical markdown body
- **AND** `name` attribute MUST 使用为 attribute context 确定性 escaping 后的已授权 model-visible Skill name
- **AND** loaded body MUST 通过 wrapper-boundary checks；这些检查 MUST 在最终 message rendering/parsing rules 下阻止 breakout 或 wrapper forgery，包括可终止或创建 `<skill_content>` boundary 的 raw 或 escaped forms
- **AND** envelope surface MUST 限于 inline instruction loading 所需的 safe skill name 和 canonical body content

#### Scenario: Inline body 通过确定性 load-and-injection checks
- **WHEN** inline execution 从 bundled、system-local 或 agent-owned-local source 加载 Skill body
- **THEN** 系统 MUST 在把 body 加入 `generatedMessages` 前应用确定性 boundary checks
- **AND** 检查 MUST 覆盖 authorization-before-load、排除 frontmatter 的 canonical body、descriptor/body consistency、expected text encoding、non-empty body、禁止的 binary/control content、inline body size budget、wrapper-boundary breakout，以及 source-private refs、raw paths、package layout 或 credentials 泄漏
- **AND** 这些检查 MUST 是确定性 runtime checks

#### Scenario: Inline body size 由 runtime context policy 管理
- **WHEN** loaded inline Skill body 超过 configured inline Skill body byte budget
- **THEN** `Skill` Tool MUST 在返回 generated messages 前安全失败
- **AND** limit MUST 来自 NextAgent runtime/context policy
- **AND** 除非产品配置提供更小值，首版 default `inlineSkillBodyMaxBytes` MUST 为 `65536` bytes

#### Scenario: Inline generated messages 遵守当前模型 context budget
- **WHEN** 成功 inline Skill execution 已为下一 turn 产生 hidden generated messages
- **THEN** canonical tool loop sequence MUST 为：先保存已结算 Skill tool result 和 request-local generated messages，再在下一 turn 调用 Context Engine
- **AND** Context Engine MUST 在 assembly/render 时校验下一 turn 的 model context budget，MUST NOT 重写已结算 `Skill` tool_result
- **AND** 紧接上一 tool round 激活的最新 Skill generated message MUST 在下一 model step 的 compression 中受保护
- **AND** compression MUST 先处理更旧的 selected/history context，MUST NOT 静默截断受保护 Skill message
- **AND** 压缩旧 context 后仍发生 Context Engine budget exhaustion 时，run MUST 在下一 model invocation 前安全失败
- **AND** 已结算 `Skill` tool_result MUST 在结算后保持稳定

`SkillMetadata.model` MUST 是 optional canonical `modelId` scalar。`SkillMetadata.modelOptions` MUST 使用 canonical `ModelInferenceOptions` 封闭对象，其 optional fields MUST 恰好为 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`toolChoice`、`providerOptions` 和 `modelParams`，并逐字段复用 `CapabilityInvocationResult.contextPatch.modelOptions` 的约束。Skill manifest parser、`SkillMetadataSchema`、typed metadata、Skill Tool mapper 和 Capability result validation MUST 使用同一 outer shape。`toolChoice` MUST 复用 canonical `ToolChoice = AUTO | NONE | REQUIRED`，MUST NOT 接受 named-tool object 或 provider-native alias。`providerOptions` MUST 为非 null `JsonObject`，MUST 只来自通过 source admission、manifest validation 和当前 Skill resolution governance 的 accepted `SkillMetadata`，并 MUST 在最终模型选择后通过 selected-provider reserved-field validation；不冲突的 inner unknown JSON fields MUST 保持开放。省略 `model`、`modelOptions` 或任一 option MUST 只表示不请求对应覆盖，Skill 层 MUST NOT 合成模型、推理默认值或空 `providerOptions`。

#### Scenario: Skill metadata 只产生 requested context patch
- **WHEN** typed Skill metadata 包含 `allowedTools`、`deniedTools`、`model` 或 `modelOptions`
- **THEN** Skill tool MUST 返回只包含 metadata 已声明字段所对应的 requested `contextPatch`；没有 metadata 字段时 MUST NOT 生成对应 patch 字段
- **AND** 目标 Skill 声明 `allowedTools` 时，`CapabilityContextPatch.allowedTools` MUST 等于 `SkillMetadata.allowedTools`
- **AND** 目标 Skill 声明 `deniedTools` 时，`CapabilityContextPatch.deniedTools` MUST 等于 `SkillMetadata.deniedTools`
- **AND** `SkillMetadata.model` 存在时，Skill tool MUST 把该值原样复制到 `CapabilityContextPatch.modelId`；result 被接受前，该值 MUST 满足 canonical `modelId` scalar
- **AND** Skill tool 产生的模型 patch MUST 通过 `CapabilityContextPatch` closed schema validation，provider access 保持由模型边界拥有
- **AND** `modelOptions` MUST 使用封闭 Capability result schema；其中 `providerOptions` MUST 只从当前 resolved Skill 的 accepted metadata 原样映射，MUST NOT 包含 provider identity/access、timeout 或 retry
- **AND** Skill tool MUST 把这些字段作为 downstream governance 的 requested changes 返回
- **AND** Agent Core MUST 只保存当前 run 的 request-local patch state
- **AND** `RuntimeCapabilityResolver` MUST 保持只用于后续 execution-time resolution 的 governed descriptor lookup
- **AND** Agent Core MUST 把完整 request-local `CapabilityContextPatch` 传给 Context Engine
- **AND** Context Engine MUST 使用已保存的 request-local `allowedTools` 从 governed available catalog view 激活后续 model-visible tool disclosure；不存在该字段时 MUST 保持 baseline disclosure
- **AND** Context Engine MUST 把已保存的 request-local `deniedTools` 作为后续 model-visible `TOOL` set 的最终排除条件
- **AND** 后续 model step 前，Context Engine/`ModelSelectionService` MUST 基于当前 request scope、accepted Agent activation、model governance 和 context policy 校验并应用或拒绝 model patches

#### Scenario: Skill metadata model 必须是 canonical id
- **WHEN** `SkillMetadata.model` 不是 canonical activated `modelId`
- **THEN** returned patch MUST 在 schema 或 model-selection governance 失败
- **AND** model selection MUST 只按 exact canonical `modelId` 处理该字段

#### Scenario: Skill metadata 使用完整推理参数
- **WHEN** typed Skill metadata 声明任一合法 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`toolChoice` 或 `providerOptions`
- **THEN** Skill Tool MUST 把同名字段原样投影到 `CapabilityContextPatch.modelOptions`
- **AND** 下游 merge MUST 使用该显式 patch 覆盖 profile 和 prompt template 的对应值
- **AND** `providerOptions` MUST 在 provider execution 前由 selected provider adapter 校验

#### Scenario: Skill metadata 提供 ToolChoice patch

- **WHEN** accepted Skill metadata 声明 `modelOptions.toolChoice=NONE`
- **THEN** Skill Tool MUST 把 `NONE` 原样投影到 `CapabilityContextPatch.modelOptions.toolChoice`
- **AND** Context Engine MUST 在下一 model step 按 canonical precedence 合并该 patch
- **AND** Skill Tool MUST NOT 清空 Tool descriptors 或直接访问 provider

#### Scenario: Skill metadata 拒绝开放 model options
- **WHEN** Skill manifest `modelOptions` 包含 provider identity/access、timeout、retry、显式 `null`、未知字段，或非 object `providerOptions`
- **THEN** Skill manifest parsing 或 typed metadata validation MUST 安全失败
- **AND** Skill Tool MUST NOT 产生对应 context patch

#### Scenario: 非 Skill metadata 不能注入 provider options
- **WHEN** Skill Tool input、Skill body、模型输出、Capability 参数或其他非 accepted `SkillMetadata` 来源提供 `providerOptions`
- **THEN** Skill Tool MUST NOT 把该值投影到 `CapabilityContextPatch`
- **AND** provider execution MUST NOT 消费该值

#### Scenario: Skill provider options 覆盖受保护字段
- **WHEN** Skill patch 的结构合法 `providerOptions` 包含与 canonical 顶层字段或 identity、access、transport authority 冲突的字段
- **THEN** provider execution MUST NOT 启动
- **AND** safe error、diagnostic、log、metric、trace、audit 或用户可见输出 MUST NOT 包含 raw option value
- **AND** 安全失败 MUST NOT 暴露 provider option 值

#### Scenario: Fork metadata 产生受治理 unsupported result
- **WHEN** resolved Skill 声明 `context=fork`
- **THEN** `Skill` Tool MUST 为原始 `Skill` tool_use 返回安全 `SKILL_CONTEXT_UNSUPPORTED` failure
- **AND** MUST 通过该单一安全 result 结算原始 `Skill` tool_use
- **AND** MUST NOT 启动 fork execution

#### Scenario: 首版返回 terminal Skill tool outcomes
- **WHEN** inline content loading 仍在运行
- **THEN** 首版 `Skill` Tool execution MUST 返回 terminal `SUCCEEDED`、`DEGRADED`、`FAILED` 或 `TIMED_OUT` outcome
- **AND** cancel/abort MUST 表示为带稳定安全失败原因 `ABORTED` 的 terminal `FAILED` outcome

## Function 变更汇总

### 描述

- 变更类型：修改
- 目标内容：Skill metadata 的 canonical model options 支持 `toolChoice`，并通过 canonical Capability context patch 影响后续模型调用。
- 依据 Requirements：`Skill tool is the model-facing Skill execution entry`

### 输入

- 变更类型：修改
- 目标内容：`SkillMetadata.modelOptions` closed schema 增加 optional canonical `toolChoice`。
- 依据 Requirements：`Skill tool is the model-facing Skill execution entry`

### 输出

- 变更类型：修改
- 目标内容：Skill Tool 仅在 metadata 显式声明时返回同值 `CapabilityContextPatch.modelOptions.toolChoice`。
- 依据 Requirements：`Skill tool is the model-facing Skill execution entry`

### 处理过程

- 变更类型：修改
- 目标内容：系统校验 Skill 声明的 canonical `toolChoice`，并只把已接受值作为当前 request/run 的后续模型选项；非法值安全失败，省略时不覆盖。
- 依据 Requirements：`Skill tool is the model-facing Skill execution entry`

### 结果

- 变更类型：修改
- 目标内容：受治理 Skill patch 可以按现有 precedence 修改下一 model step 的 Tool 选择策略，省略字段时不覆盖。
- 依据 Requirements：`Skill tool is the model-facing Skill execution entry`

### 规格

- 规格项：Skill 后续模型 Tool 选择策略
- 变更类型：新增
- 原规格值：不适用（新增）
- 目标规格值：未声明时不覆盖；声明时只接受 canonical `AUTO | NONE | REQUIRED`，不接受 named-tool object 或 provider-native alias
- 依据 Requirements：`Skill tool is the model-facing Skill execution entry`
