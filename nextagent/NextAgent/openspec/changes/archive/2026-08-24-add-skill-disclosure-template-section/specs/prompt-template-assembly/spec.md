<!-- 本文件是 active change 的行为规格 delta，路径为 specs/prompt-template-assembly/spec.md。 -->

## MODIFIED Requirements

### Requirement: Prompt assembly has one decision boundary

系统 SHALL 为 template selection、fallback、rendering 和 model options override handoff 只暴露一个 prompt template assembly decision boundary。Summary generation、memory extraction 和其他 model-facing prompt consumer MUST 消费该边界。

该边界 SHALL 接收可信投影的 prompt input，其中包含 `purpose`、`agentId`、`agentVersion`、`locale`、值 MUST 只为 string 的 `flowVariables`、required safe `selectedModel` 和 optional safe `memoryEnabled`。`selectedModel` MUST 是只含实际调用所选 `ResolvedModelConfiguration.modelId` 的封闭对象。该 `modelId` 用于 canonical exact matching，且与传给 provider 的模型标识相同。`memoryEnabled` SHALL 从 accepted Agent 的 model-visible Capability set 计算，且 SHALL 只用于 `memory` system section 的受治理条件渲染。它 MUST NOT 影响 template selection、model selection 或 model options handoff，也 MUST NOT 写入 prompt text。

该边界 SHALL 额外接收 optional safe skill disclosure 投影，包含 skill disclosure section 渲染门控事实（当前 model step 是否有可见 `Skill` tool entry、是否存在满足披露门控的 Skill）和受控披露模式值 `skillDisclosureMode`（值为 `list` 或 `tool-search`，来自 trusted app config）。skill disclosure 投影 SHALL 只用于 `skill_disclosure` system section 的受治理条件渲染和安全投影变量解析；它 MUST NOT 影响 template selection、model selection 或 model options handoff。`PromptAssemblyRequest` MUST NOT 携带 `enabledCapabilities` 投影（随 `enabledSkills` 变量删除一并下线）。该边界 SHALL 返回 selected safe template identity、rendered prompt sections/content 和 optional model options override。

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

#### Scenario: skill disclosure 投影只驱动条件渲染与变量解析
- **WHEN** `SYSTEM_PROMPT` assembly request 携带 skill disclosure 门控事实和 `skillDisclosureMode`
- **THEN** assembler MUST 把该投影提供给 system render policy 用于 `skill_disclosure` section 条件过滤，并提供给安全投影变量解析
- **AND** 该投影 MUST NOT 改变 template selection、model selection 或 `modelOptions` handoff
- **AND** `skillDisclosureMode` 值 MUST NOT 在未被模板变量引用时内联到 rendered prompt text

#### Scenario: 最终 prompt assembly 使用所选 catalog configuration
- **WHEN** `ModelSelectionService` 返回 selected `ResolvedModelConfiguration`
- **THEN** 最终 prompt assembly MUST 从该 configuration 投影唯一 `modelId`
- **AND** `selectedModel` MUST 通过只含该 `modelId` 的 closed schema validation

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

## ADDED Requirements

### Requirement: System prompt skill disclosure section

系统 SHALL 在 builtin `SYSTEM_PROMPT` 模板中提供一个 `skill_disclosure` section 作为 builder-owned system section，渲染顺序位于 `memory` section 之后、`action_safety` section 之前，并 SHALL 归入 dynamic system sections（渲染在 CACHE_BOUNDARY 之后）。

`skill_disclosure` section SHALL 仅当渲染门控满足时渲染：当前 model step 有可见且 AVAILABLE 的 `Skill` tool entry，且 skill disclosure 列表投影非空（`tool-search` 模式下还要求 `ToolSearch` tool entry 可见）。门控不满足时 system render policy MUST 在公共变量替换之前过滤掉该 section；该过滤 MUST 同样约束 agent 层覆盖的 `skill_disclosure` section 内容，覆盖 MUST NOT 绕过省略规则。

builtin `skill_disclosure` section 的默认内容 SHALL 来自独立内容文件 `skill-disclosure.md`，按 `skillDisclosureMode` 提供两套默认英文正文（`list` 模式与 `tool-search` 模式），正文引用 `{{ skillDisclosureList }}` 投影 governed Skill 列表和 `{{ skillDisclosureBody }}` 投影模式匹配的默认正文；两套默认英文正文 SHALL 分别存放于同目录的 `skill-disclosure-list.md` 与 `skill-disclosure-tool-search.md` markdown 文件；默认渲染产物 SHALL 与 renderer 硬编码时代逐字一致。Agent MAY 通过 agent-over-builtin SYSTEM_PROMPT 覆盖机制定制该 section 内容；覆盖内容 MAY 引用 `{{ skillDisclosureList }}` 和 `{{ skillDisclosureMode }}`，MAY 不引用任何投影变量，覆盖后 builtin 默认正文不再参与渲染。

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
