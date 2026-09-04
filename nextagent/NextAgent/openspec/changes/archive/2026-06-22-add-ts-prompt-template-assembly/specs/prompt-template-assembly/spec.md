## ADDED Requirements

### Requirement: Prompt templates are assembled by purpose
系统 SHALL 将 prompt template 作为跨 purpose 的装配对象处理。每次需要构造模型可见 prompt 的内部调用 MUST 指定一个 `PromptPurpose`。`PromptPurpose` SHALL be a validated string scalar, not a closed enum. Framework well-known purpose constants SHALL include `SYSTEM_PROMPT`、`SUMMARY_GENERATION` 和 `MEMORY_EXTRACTION`, and developers MAY define additional safe-id purpose strings for their own consumers. `SYSTEM_PROMPT` SHALL 是 prompt template 的一个受限高风险 purpose，而不是 prompt template 体系的唯一形态。

通用 prompt template assembly SHALL own purpose-neutral behavior including template source registration, deterministic selection, governed rendering, fallback, model options override handoff, failure safe errors and safe observations. Purpose-specific constraints SHALL be layered by the consuming purpose. Only `SYSTEM_PROMPT` has built-in special prompt assembly constraints in this change: it MUST reuse the generic assembly boundary and then apply stricter role, section, cache-boundary and protocol constraints. Summary, memory and developer-defined custom purposes SHALL use the generic ordered-section rendering model.

#### Scenario: System prompt uses a purpose
- **WHEN** context engine 为一次主模型调用构造 system prompt
- **THEN** prompt template assembly MUST 使用 `PromptPurpose=SYSTEM_PROMPT`
- **AND** system prompt 专属的 section、cache boundary 和模型输入角色规则 MUST 作为该 purpose 的约束处理
- **AND** those constraints MUST be additive specialization over generic prompt template assembly, not a separate template system

#### Scenario: Summary generation uses a purpose
- **WHEN** traceable summary generation 需要构造摘要模型调用 prompt
- **THEN** prompt template assembly MUST 使用 `PromptPurpose=SUMMARY_GENERATION`
- **AND** 摘要 prompt 的输出格式和工具禁用要求 MUST 由 summary generation 消费方继续校验
- **AND** summary generation MUST use generic prompt section rendering

#### Scenario: Memory extraction uses a purpose
- **WHEN** memory extraction 需要构造提取提示词
- **THEN** prompt template assembly MUST 使用 `PromptPurpose=MEMORY_EXTRACTION`
- **AND** memory extraction MUST obtain rendered prompt content from prompt template assembly
- **AND** memory extraction MUST use generic prompt section rendering

### Requirement: Prompt assembly has one decision boundary
系统 SHALL expose exactly one context-engine prompt template assembly decision boundary for template selection, fallback, rendering and model options override handoff. This boundary SHALL be implemented as `PromptTemplateAssembler` inside `agent-context-engine`. Summary generation and memory extraction MUST consume this boundary through context-engine dependencies.

The boundary SHALL accept context-owned projected prompt inputs containing `purpose`, `agentId`, `agentVersion`, `locale`, string-only `flowVariables`, and required safe `selectedModel` projection chosen before rendering. The required `selectedModel` projection SHALL contain exactly the model identity fields needed by template matching: `providerKind` and `modelName`. It SHALL return selected safe template identity, rendered prompt sections/content and optional model options override.

The implementation SHALL replace the system-only resolver contract with context-engine internal prompt template assembly. Runtime/core/app callers SHALL project trusted runtime facts into context-engine internal prompt assembly input.

`PromptTemplateAssembler` SHALL be the boundary that selects and renders a prompt template. `DefaultContextEngine.resolveModelSelection(...)` SHALL compute prompt-compatible model profile ids internally before final model selection, using the same trusted frozen template facts. Template compatibility, final template selection and variable value lookup SHALL be performed from trusted registry facts, context-owned projected prompt inputs, trusted safe model candidate values and safe projections.

Each consuming purpose MUST choose the actual model it will invoke before calling prompt assembly, then project only the safe `selectedModel` fields into the internal assembly request. For the main `SYSTEM_PROMPT` path, that projection SHALL come from `DefaultContextEngine.resolveModelSelection(...)`. For summary generation, the projection SHALL come from the summary model invocation configuration that already owns the actual summary model; in the current baseline this is `DefaultTraceableSummaryGeneratorOptions.providerKind` and `DefaultTraceableSummaryGeneratorOptions.modelName`. Memory extraction SHALL project required `selectedModel` from its actual invocation model configuration or from a reused main selected model.

#### Scenario: Prompt assembler returns one rendered prompt result
- **WHEN** a consumer requests prompt assembly for a purpose with trusted `agentId`, `agentVersion`, locale, flowVariables and selected model
- **THEN** context-engine `PromptTemplateAssembler` MUST select one complete template from the frozen template set
- **AND** it MUST return selected safe template identity, rendered sections/content and optional `modelOptions` handoff
- **AND** the consuming purpose MUST use that selected result for the model invocation

### Requirement: Prompt assembly boundary guardrails
系统 SHALL enforce prompt assembly boundary exclusions at the context-engine prompt assembly boundary. The internal assembly request MUST NOT contain `profileId`, raw model profile fields, credential, provider route, deployment endpoint, invocation options, runtime-owned `RequestContext`, caller-supplied `templateId`, prompt body, free variables map, file path, client metadata authority, runtime lifecycle state, raw model profile, model candidate list or model output.

The implementation MUST delete the old public prompt shaping contracts from `agent-contracts/context`: `LayeredProfileResolver`, `PromptTemplateProfile`, `PromptTemplateProfileQuery`, public profile lookup through `PromptTemplateRegistry.find(query)`, request-path `PromptTemplateLoader`, `TemplateContent.stableSections/dynamicSections`, `PromptTemplateSectionContent`, and old `PromptAssemblyResult` fields such as `appliedProfiles`, `selectedProfile`, `resolvedOptions` and `resolvedProviderOptions`. It MUST NOT add `PromptPurpose`, `PromptModelCandidate`, `PromptModelCompatibilityRequest`, `PromptModelCompatibilityResolver`, `PromptAssemblyRequest`, `PromptTemplate`, `PromptSection`, `PromptAssemblyResult` or `PromptTemplateAssembler` to `agent-contracts`. These names MAY exist as `agent-context-engine` internal implementation types.

`DefaultContextEngine.resolveModelSelection(...)` internal compatibility helper MUST NOT be exposed through `agent-contracts`, select a final template, render prompt content, return template identity, or merge model options. Summary and memory consumers MUST NOT fabricate system-only fields such as `providerContribution`, `promptMode`, `telecomContext`, runtime `RequestContext` or `SystemPromptContext`.

#### Scenario: Prompt assembler is the single boundary
- **WHEN** the implementation introduces purpose-aware prompt assembly
- **THEN** it MUST use context-engine `PromptTemplateAssembler` as the single prompt assembly boundary
- **AND** it MUST NOT add a second public resolver that can independently choose prompt templates for the same purpose

#### Scenario: Model compatibility is generated inside model selection
- **WHEN** Context Engine prepares prompt/model selection for an accepted Agent
- **THEN** it MUST derive prompt model candidates from `AgentAssembly.modelProfileIds` and trusted model profile registry facts
- **AND** `DefaultContextEngine.resolveModelSelection(...)` MUST compute prompt-compatible model profile ids internally before final model selection
- **AND** empty prompt-compatible model profile ids MUST mean prompt templates do not constrain model selection
- **AND** `PromptTemplateAssembler.assemble` MUST NOT accept model candidate lists or own final model selection
- **AND** prompt assembly MUST NOT expose raw model profiles, credentials, provider routes or customer deployment details

#### Scenario: Old prompt contracts are removed
- **WHEN** the target prompt assembly contract is implemented
- **THEN** product code MUST NOT import or expose `LayeredProfileResolver`, `PromptTemplateProfile`, `PromptTemplateProfileQuery`, `PromptTemplateLoader`, `TemplateContent`, `PromptTemplateSectionContent` or old `PromptAssemblyResult` profile/options fields
- **AND** `agent-contracts/context` MUST NOT export new prompt template assembler, compatibility resolver, template, section, assembly request or assembly result contracts for this change
- **AND** request path consumers MUST obtain prompt output only through `PromptTemplateAssembler.assemble`
- **AND** final `ModelOptions` or provider options merge MUST occur outside `PromptTemplateAssembler`

#### Scenario: Summary does not fake system context
- **WHEN** summary generation requests `PromptPurpose=SUMMARY_GENERATION`
- **THEN** prompt assembly MUST accept an internal prompt assembly request with context-owned projected fields
- **AND** summary generation MUST NOT construct fake system prompt fields merely to satisfy variable resolution

#### Scenario: Summary projects selected model from invocation config
- **WHEN** traceable summary generation requests `PromptPurpose=SUMMARY_GENERATION`
- **THEN** it MUST set required `selectedModel.providerKind` and `selectedModel.modelName` from the summary model invocation configuration it will use for the model call
- **AND** it MUST NOT expose summary `baseUrl`, `credentialRef`, `commonOptions`, `timeoutMs`, raw invocation options or provider route data to prompt assembly
- **AND** it MUST NOT include a model profile id in `selectedModel`

#### Scenario: Summary no longer owns template selection
- **WHEN** traceable summary generation constructs the summary model invocation
- **THEN** it MUST obtain the summary prompt through `PromptPurpose=SUMMARY_GENERATION`
- **AND** it MUST NOT load prompt-config files or choose fallback templates directly on the request path

#### Scenario: Consumer cannot override assembly result
- **WHEN** prompt template assembly returns a selected template and rendered content
- **THEN** the consuming system prompt, summary or memory component MUST use that selected result for the invocation
- **AND** it MUST NOT perform a second template selection using local files, package paths, client metadata or model output

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
系统 SHALL 通过受信选择维度为一次 prompt assembly 选择一个完整 prompt template。候选集 MUST 先限定为当前 accepted Agent scope 的 frozen template set。筛选维度 SHALL 来自 purpose、request locale、model selection 提供的 required safe `selectedModel` identity fields and internal prompt assembly `flowVariables` 中的受信 string values；客户端请求体、模型输出、capability 参数或不可信 metadata MUST NOT 覆盖 template selection authority。

Source layer SHALL have exactly two public semantic values in this change: `builtin` and `agent`. `builtin` SHALL represent context-engine package-owned built-in fallback templates. `agent` SHALL represent Agent package `prompts/` templates. `agent-app` SHALL NOT be a source layer, and this change MUST NOT introduce an app source layer or app-supplied prompt root category. Source layer SHALL be an internal priority classification derived from the context-engine compile entry: package-owned builtin prompt root compilation produces `builtin`; Agent package `register({ agentId, agentVersion, path })` compilation produces `agent`. It MUST NOT be accepted as a caller-provided or manifest-provided filtering condition. Template selection SHALL run inside `PromptTemplateAssembler.assemble`: preselect template candidates by purpose, locale, flowVariables and source scope; filter candidates by the final safe `selectedModel` when `match.model` is declared; then select one complete template by deterministic priority. The source priority SHALL be `agent` over `builtin`; an `agent` default candidate MUST outrank any `builtin` matched candidate. Within the same source layer, locale、selected model `providerKind`、selected model `modelName` and flowVariables string key/value matches SHALL be used only as final-template specificity dimensions. Specificity SHALL be calculated as one point for each declared-and-matched locale, one point for declared-and-matched selected model `providerKind`, one point for declared-and-matched selected model `modelName`, and one point for each declared-and-matched flowVariables key/value. A candidate with omitted `match` SHALL be the default candidate with specificity 0. Prompt text MUST come from one selected complete template; 系统 MUST NOT 将多个用户定义模板的 prompt 文本片段按 layer partial merge 为最终 prompt。template `modelOptions` MAY be returned as a model options override handoff, but final option merge MUST be owned by model selection or model invocation assembly, not by prompt rendering.

`DefaultContextEngine.resolveModelSelection(...)` SHALL treat `AgentAssembly.modelProfileIds` as the initial allowed model profile id list for the accepted Agent. Before final model selection, it SHALL internally compute prompt-compatible model profile ids with purpose, trusted locale, string-only flowVariables and trusted safe model candidates. The helper SHALL derive compatible profile ids only from `agent` source matched templates that explicitly declare `match.model`; `builtin` templates, generic templates, fallback templates and templates without `match.model` SHALL NOT contribute ids. Empty compatible profile ids SHALL mean prompt templates do not constrain model selection. Non-empty compatible profile ids SHALL be applied as a hard filter together with enabled/credential/provider/runtime/customer availability and trusted capability model patch constraints. When more than one model remains, model selection SHALL choose deterministically by trusted `capabilityContextPatch.modelName` when present and valid, then `AgentRuntimeSettings.defaultModelProfileId` when present in the filtered set, then the first candidate in `AgentAssembly.modelProfileIds` order. If no model remains after a non-empty prompt-compatible filter, the system MUST fail safely; it MUST NOT choose a model outside the compatible set. The compatibility helper MUST NOT select or render the final template.

#### Scenario: Agent default overrides builtin matched template
- **WHEN** 同一 prompt assembly 同时匹配一个 `builtin` source template with locale/model/flowVariables match 和一个 `agent` source default template
- **THEN** selected complete template MUST 是 `agent` source template
- **AND** 最终 prompt 文本 MUST NOT 混合 builtin 与 agent source 的用户定义 prompt 内容，但 section-level merge with builtin fallback 除外（见下方场景）

#### Scenario: Agent template merges uncovered sections from builtin fallback
- **WHEN** selected complete template 来自 `agent` source layer
- **AND** 同一 frozen template set 中存在匹配的 `builtin` source template
- **THEN** assembler MUST 按 section id 合并：agent template 的所有 sections 完整保留，builtin template 中 section id 不在 agent sections 中的 sections 追加到合并结果
- **AND** builtin fallback template 选择 MUST 使用与主选择一致的 specificity 排序
- **AND** 无匹配 builtin 时 MUST NOT 报错，直接使用 agent 模板自身 sections
- **AND** `builtin` source layer 的选中模板 MUST NOT 触发 fallback

#### Scenario: Same source layer chooses highest specificity
- **WHEN** 同一 source layer 下存在多个 candidate for the same purpose
- **AND** exactly one candidate has the highest specificity after trusted locale, model and flowVariables matching
- **THEN** selected complete template MUST be that highest-specificity candidate
- **AND** 该选择 MUST 对相同 selection inputs 保持确定性

#### Scenario: Same source layer conflict fails safely
- **WHEN** 同一 source layer 下存在两个 enabled prompt template candidate 且受信选择维度无法确定唯一最高 specificity 结果
- **THEN** prompt assembly MUST fail closed with a safe configuration error
- **AND** safe error or internal safe observation MUST include safe template identifiers
- **AND** MUST NOT include prompt text, local paths, credentials, model output, or raw template body

#### Scenario: Model selection uses prompt-compatible candidates
- **WHEN** an accepted Agent has multiple `modelProfileIds`
- **AND** matched `agent` templates with explicit `match.model` adapt only a subset of those model profiles
- **THEN** model selection MUST obtain that compatible subset through the internal prompt compatibility helper inside `DefaultContextEngine.resolveModelSelection(...)`
- **AND** model selection MUST choose only from that compatible subset after applying model availability and trusted patch filters
- **AND** when multiple compatible models remain, it MUST use trusted patch, then `defaultModelProfileId`, then `modelProfileIds` order
- **AND** `PromptTemplateAssembler.assemble` MUST use the selected model only as trusted template-selection input, not as authority to rerun model selection

#### Scenario: Generic templates do not constrain model selection
- **WHEN** matching templates are only `builtin`, fallback, generic, or templates without `match.model`
- **THEN** internal prompt-compatible model profile ids MUST be empty
- **AND** model selection MUST NOT filter models by prompt compatibility
- **AND** final prompt assembly MUST still use the required selected model for template specificity and fallback

### Requirement: Complete prompt content and model options handoff are assembled together
系统 SHALL 在一次 prompt assembly 中同时产出 selected template identity、rendered prompt content 和可选 model options override。prompt content 的选择 SHALL 使用 selected complete template；final `ModelOptions` 或 provider options merge SHALL NOT be performed inside `PromptTemplateAssembler`.

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

#### Scenario: Registered variable is rendered
- **WHEN** selected template content contains `{{ enabledSkills }}`
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
