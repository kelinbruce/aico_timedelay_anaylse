## 背景与问题（Why）

NextAgent 已经有 system prompt shaping、traceable summary generation 和 memory extraction prompt 覆盖等局部能力，但 prompt template 的长期抽象仍分散在各消费方里：

- system prompt 组装把 prompt 结构、section、变量和模型输入 render 绑定在 `context-engine` 的 system prompt 路径上。
- summary generation 和 memory extraction 也需要 prompt template，但只能作为局部消费者复用或约定命名，缺少统一的 purpose、profile、fallback 和渲染契约。
- Agent 开发者需要通过配置和 Agent package 定制 prompt，而不是修改代码；同时需要按语言、模型、Agent、purpose 和受信运行时事实选择不同 prompt。
- prompt 文本选择、变量解析、可选片段、省略/失败语义、模型参数覆盖和诊断如果继续由不同 owner 各自定义，会造成同类 prompt 行为不一致，难以审计、测试和治理。

本 change 将 prompt template 抽象提升为跨 purpose 的装配能力。`SYSTEM_PROMPT` 是 prompt template 的一个高风险 purpose，而不是 prompt template 体系本身。该能力为 system prompt、summary generation、memory extraction 以及后续 routing/review 等模型调用场景提供统一的模板选择、渲染、失败 safe error 和安全观测边界。

## 黑盒目标（What）

本 change 新增 `prompt-template-assembly` capability，作为跨 purpose 的 prompt 模板装配能力。它的黑盒目标是：Agent 开发者把模板放入 Agent package 的 `prompts/` 目录，系统在 Agent 同步装配阶段注册这些模板；运行时消费者按 purpose 请求 prompt assembly，得到一个确定选择、已渲染、带安全 template identity 和可选 `modelOptions` handoff 的 prompt 结果。

首批覆盖的真实 consumer 是：

- `SYSTEM_PROMPT`：主模型调用的 system/developer prompt。
- `SUMMARY_GENERATION`：traceable summary generation 的摘要模型调用 prompt。
- `MEMORY_EXTRACTION`：memory extraction 的提取模型调用 prompt。

## 核心设计（How）

- `agent-context-engine` 拥有 prompt template 的 manifest schema、编译、registry、选择、变量渲染、fallback、safe error 和安全观测。
- `PromptPurpose` 是 `agent-context-engine` 内部受校验 string scalar。框架提供 `SYSTEM_PROMPT`、`SUMMARY_GENERATION`、`MEMORY_EXTRACTION` well-known constants，并允许开发者定义自有 purpose。
- `PromptAssemblyRequest` 是 context-engine 内部 assembler input，字段为 `purpose`、`agentId`、`agentVersion`、`locale`、string-only `flowVariables` 和必填 `selectedModel`。`selectedModel` 只包含 `providerKind/modelName`。
- 模型选择和模板选择分工清晰：`DefaultContextEngine.resolveModelSelection(...)` 在最终模型选择前计算 prompt-compatible model profile ids；`PromptTemplateAssembler.assemble(...)` 在最终模型确定后使用 `selectedModel` 选择并渲染一个完整模板。
- `modelOptions` 是 prompt assembly result 的 handoff 字段。最终模型参数合并由 model selection / invocation owner 完成。
- 模板渲染首批支持 NextAgent 受控变量语法：`{{ variableName }}` required 变量、`{{ variableName? }}` optional 变量，以及渲染为空 section 的确定性省略。
- builtin templates 位于 `packages/agent-context-engine/prompt-templates/builtin/`，由 context-engine registry 初始化时编译进 process-scoped builtin bucket。
- Agent package templates 由 agent-app/package assembly 提供受信绝对 `prompts/` root path，context-engine 通过 `register({ agentId, agentVersion, path })` 编译并注册为 Agent-scoped bucket。
- request 的 frozen template set 是 process-scoped builtin bucket 与当前 accepted Agent bucket 的逻辑并集。template selection 在该集合内按 purpose、locale、flowVariables、selected model、`agent > builtin` 和同层 specificity 选择一个完整模板。
- 当选中的模板来自 `agent` source layer 时，assembler 自动查找匹配的 `builtin` 模板作为 section fallback，按 section id 合并：agent sections 优先，builtin 中未覆盖的 sections 自动补全。Agent 开发者只需覆盖需要定制的 sections，无需重复定义完整模板。

## 边界和非目标

- prompt template implementation types、assembler 和 compatibility helper 首版留在 `agent-context-engine` 内部，不进入 `agent-contracts`。
- `SYSTEM_PROMPT` 是高风险 purpose 的 specialization；summary、memory 和开发者自定义 purpose 使用通用选择和渲染规则。
- request path 使用已注册 frozen template facts，不重新解析 package、raw prompt 文件或客户端提供的 prompt 正文。
- prompt 文本来自一个完整 selected template，不跨多个用户模板做 partial merge。agent 模板与 builtin fallback 之间的 section-level merge 按 section id 补全未覆盖 sections，属于确定性合并而非任意文本拼接。
- 首版模板语言不包含条件块、表达式、filter、test、loop、include/import/extends、macro、raw injection、脚本或函数调用。
- OpenSpec 不固化具体 prompt 正文，不引入 prompt UI、热更新、租户级 marketplace、prompt persistence store 或 provider SDK 变更。

## Capability 影响（Capabilities）

### 新增 Capability
- `prompt-template-assembly`: 定义跨 purpose 的 prompt template 选择、渲染、fallback、`modelOptions` 覆盖、Agent/app 配置接入、失败 safe error 和安全观测边界。

### 修改的 Capability
- `context-engine`: system prompt shaping、summary generation 和 memory extraction 通过 `prompt-template-assembly` 获取 rendered prompt。
- `agent-package-assembly`: Agent package 的 `prompts/` 目录解析为受信绝对 prompt root path；同步 Agent 装配调用 context-engine `register({ agentId, agentVersion, path })` 注册 Agent-scoped prompt template facts。
- `memory-configuration`: memory extraction prompt 覆盖作为 `MEMORY_EXTRACTION` purpose 的 prompt template 绑定消费。

## 影响范围（Impact）

- Breaking contract decision：本 change 已确认采用一次性 contract replacement。`agent-contracts/context` 的旧 prompt shaping public contract 由 context-engine 内部 prompt template assembly implementation types 取代；目标 prompt template 对象、assembler 和 compatibility helper 作为 `agent-context-engine` 内部实现和 package-local test surface。
- `agent-context-engine`：补充或收敛 prompt template implementation types，包括 `PromptPurpose` safe string/constants、内部安全模型候选投影、内部 assembly request/result、内部 `PromptTemplate`、`PromptSection`、assembler、rendered prompt content 和 `modelOptions` override vocabulary。`PromptSection` 是 compiler 解析后的 section，包含 `id/content/variables`，variables 从 content 推导。
- `agent-context-engine`：拥有 prompt template manifest schema、parser、semantic validation、materializer、`templateRef` derivation、Agent-scoped registry、selector、renderer、fallback 和安全观测逻辑；system prompt 和 summary generation 通过该 resolver 消费。
- `agent-app`：composition 阶段解析 Agent package `prompts/` 受信绝对 prompt root path；在同步 Agent 装配中调用 context-engine owned `register({ agentId, agentVersion, path })` 单入口注册 Agent templates，并注入 context-engine owned registry/assembler。
- `agent-package-assembly` 实现：同步装配期定位已选 Agent package 的 `prompts` 根目录并执行路径 containment，把受信绝对 prompt root path 交给 context-engine `register`。
- `agent-memory` / memory consumers：memory extraction 使用 purpose-scoped prompt template assembly result。
- 测试：需要 contract tests、config/package assembly tests、context integration tests、memory extraction prompt integration tests、safe error/observability redaction tests 和 architecture boundary tests。
- 运维与安全：prompt assembly 的 structured log、trace/audit candidate 和 safe error 只允许输出 template id、derived `templateRef`、purpose、safe reason code、内部 layer、受信低基数字段和计数，不输出 prompt 正文、模型输出、路径、secret 或高基数字段。

## Contract Replacement

目标态从 `agent-contracts/context` 移除旧 prompt shaping public contract：`LayeredProfileResolver`、`PromptTemplateProfile`、`PromptTemplateProfileQuery`、public `PromptTemplateRegistry.find(query)` profile lookup、request-path `PromptTemplateLoader`、`TemplateContent.stableSections/dynamicSections`、`PromptTemplateSectionContent` 和旧 `PromptAssemblyResult.appliedProfiles/selectedProfile/resolvedOptions/resolvedProviderOptions`。本 change 不提供兼容 shim、deprecated alias 或双栈 resolver。

目标态从 runtime-facing Agent assembly 删除 `AgentAssembly.promptTemplateIds` 和 `AgentRuntimeSettings.defaultPromptTemplateId`。prompt availability 由 context-engine registry 中的 builtin bucket 与 Agent-scoped bucket 决定。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/prompt-template-assembly/spec.md`：新增，承载跨 purpose prompt template source 编译、选择、渲染、fallback、`modelOptions` 覆盖、safe error 和安全观测行为。
- `openspec/specs/context-engine/spec.md`：修改，将 system prompt shaping 与 summary prompt 解析标记为 `prompt-template-assembly` 消费方。
- `openspec/specs/agent-package-assembly/spec.md`：修改，补充 prompt root discovery、路径信任边界与 runtime-facing assembly 排除 prompt 正文的长期行为。
- `openspec/specs/memory-configuration/spec.md`：修改，补充 memory extraction prompt 通过 `MEMORY_EXTRACTION` purpose 消费通用 prompt template assembly。

长期背景：
- `openspec/overview.md`：补充 prompt template 是跨 purpose Agent 定制能力，system prompt 是高风险 purpose 的说明。

设计视图：
- `openspec/designs/architecture/prompt-template-assembly.md`：新增，承载跨模块流程、模板选择维度、`modelOptions` 覆盖、fallback、失败 safe error、安全观测和 package/app composition 边界。
- `openspec/designs/modules/agent-context-engine.md`：修改，补充 prompt template resolver/renderer 作为 context-engine 内部组件职责。
- `openspec/designs/modules/agent-app.md`：修改，补充 prompt root discovery、context-engine `register` 调用和 registry/assembler 注入职责。
- `openspec/designs/modules/agent-memory.md`：修改，补充 memory extraction prompt 的消费边界。
- `openspec/designs/adr/prompt-template-complete-selection.md`：新增，记录“prompt 文本选择完整模板，模型参数最终合并不属于 prompt renderer，不做用户模板 partial merge”的长期取舍。
- `openspec/designs/spec-to-design-map.md`：新增 `prompt-template-assembly` capability 到 architecture/modules/ADR/验证入口的导航。

验证入口：
- `openspec validate add-ts-prompt-template-assembly --strict`
- `npm run test:contract`
- prompt template resolver unit tests
- context-engine system prompt / summary prompt integration tests
- agent package prompt registration tests
- memory extraction prompt integration tests
- architecture tests: request path 不读取 raw `prompts/`、memory/context 不绕过 resolver、safe error/observability 不泄露 prompt 正文
