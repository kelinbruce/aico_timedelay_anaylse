## 背景和现状

当前 TS 侧 prompt 能力分散在多个消费方：

- system prompt shaping 负责模型主调用的 section、变量、capability disclosure 和 render 边界。
- traceable summary generation 需要摘要生成 prompt，并且已经具备 prompt resolver 复用诉求。
- memory extraction 需要提取 prompt 覆盖，但不应自建独立模板文件格式或选择规则。
- Agent package 已经有 `prompts/` 目录输入，但当前 `promptTemplateIds` 仍像手写 allowlist；目标态应让 `prompts/` 下所有合法 template 自动成为该 Agent 的可用模板集合，runtime-facing `AgentAssembly` 不应携带 prompt 正文。

目标状态中，prompt template 是跨 purpose 的 Agent 定制能力，`SYSTEM_PROMPT` 只是其中一个高风险 purpose。所有模型调用类 prompt 都应共享一套受治理的模板选择、渲染、fallback、模型参数覆盖、失败 safe error 和安全观测边界。

## 当前代码基线

当前仓库已经有一条不完整的 prompt shaping 链路，其中一部分可作为实现素材，但当前 contract 形状不能直接作为目标态：

- `agent-contracts/src/context/index.ts` 已定义 `SystemPrompt`、`SystemPromptSection`、`SystemPromptContext`、`SystemPromptBuilder`、`PromptTemplateProfile`、`PromptTemplateProfileQuery`、`PromptTemplateRegistry`、`TemplateContent`、`PromptTemplateLoader`、`PromptAssemblyResult` 和 `LayeredProfileResolver`。
- `agent-context-engine/src/prompt-shaping/profile-resolver.ts` 已实现 `DefaultLayeredProfileResolver`，按 `DEFAULT -> LANGUAGE -> MODEL -> AGENT -> PURPOSE` layer 排序，选择最高 layer 的 profile，并把 `ModelOptionsOverride` 合并到 model/provider options。
- `agent-context-engine/src/prompt-shaping/configurable-system-prompt-builder.ts` 已实现 section definition + default content + dynamic resolver + variable resolver 的 system prompt builder；它的输出是 `SystemPrompt`，不是完整模型输入。
- `agent-context-engine/src/prompt-shaping/template-loader.ts` 已有 `InMemoryTemplateLoader`、`FileTemplateLoader`、`ResourceTemplateLoader` 和 `templateContentToContribution()`，但当前 loader contract 仍以 system section override 为核心。
- `agent-context-engine/src/assembly/assemble-context.ts` 已在 `resolvePromptAssembly()` 调用 layered resolver；如果 composition 没注入 resolver，则使用空 `InMemoryPromptTemplateRegistry` 和空 `InMemoryTemplateLoader`。`getOrCreatePromptBuilder()` 仍会按 domain/purpose 从 `prompt-configs/<domain>/system` 加载 system prompt config。
- `agent-context-engine/src/prompt-shaping/model-input-renderer.ts` 已拥有最终 `RenderedModelInput` 组装：system message、selected history messages、capability generated messages 和 tools 都在这里组合。
- `agent-context-engine/src/summary/default-traceable-summary-generator.ts` 当前在 constructor 中通过 `loadSummaryPrompt()` 独立加载 summary system prompt，并固定 `compact-summary/v1` user prompt version；它没有消费 layered resolver。
- `agent-app/src/config/component-config.ts` 里的 `PromptTemplateResource` 目前只有 `templateId/displayName/systemPrompt/enabled`，`agent-app/src/composition/create-app.ts` 注册了 `defaultTelecomPrompt`，`agent-app/src/assembly/agent-assembly-compiler.ts` 只校验手写 `promptTemplateIds` 是否存在且 enabled；这些资源尚未从 Agent `prompts/` 自动发现并编译成 context-engine 可用的 prompt template registry。
- `agent-memory` 当前只是 memory boundary skeleton，没有稳定 memory extraction prompt 装配入口。

因此最小增量不是新建一个平行 prompt service，而是把现有 system-oriented resolver/loader/builder 链路重塑为 purpose-aware prompt template assembly，并让 system prompt、summary generation、memory extraction 都消费同一个 assembly 边界。

## 黑盒目标和非目标

目标：

- 新增 `prompt-template-assembly` capability，统一承载跨 purpose 的 prompt template 装配规则。
- `PromptPurpose` 是受校验 string，框架内置 well-known purpose 包括 `SYSTEM_PROMPT`、`SUMMARY_GENERATION`、`MEMORY_EXTRACTION`，并允许开发者定义自有 purpose。
- 支持不改代码、通过 context-engine 包内 builtin templates 和 Agent package `prompts/` 目录自动注册 prompt template 候选。
- 支持按可信运行时事实确定性选择一个完整 prompt template。
- 支持变量替换、required/optional 变量和可选 section 的确定性渲染。
- prompt template 可声明 `modelOptions` 覆盖，但 assembler 只返回覆盖结果，不负责最终模型参数合并；最终合并属于 model selection / model input invocation owner。
- request path 消费同步装配期已编译/注册的 frozen template facts。

非目标：

- 不引入 Web UI、在线编辑、热更新、租户级 prompt marketplace 或 prompt 持久化 store。
- 不引入任意可编程模板语言、循环、宏、递归 include 或运行时脚本。
- 不改变 provider SDK、model invocation stream 协议或 runtime request lifecycle。
- 不把 prompt 正文写入 `AgentAssembly`、PromptAssemblyResult、safe error、timeline、audit、log 或 stream event。
- 不从客户端请求体、模型输出或 capability 参数接收 template authority、prompt body、owner scope 或 Agent scope。
- 不在 request path 解析 raw prompt 文件、Agent package 或未注册模板。

## 设计决策

### Owner 和 contract surface

`agent-context-engine` 继续拥有 prompt shaping 和 prompt template resolver/renderer 实现，因为 context engine 已经负责 context assembly、window selection、compaction 和 prompt shaping。目标态中，prompt template 的 schema、manifest parser、semantic validation、materialization、`templateRef` 派生、registry、selection、render、fallback 和 safe error 都归 `agent-context-engine`。

`agent-app` 是 composition root。它解析 Agent package 中的受信绝对 prompt root path，在同步 Agent 装配中调用 context-engine owned `register` 单入口，并把 context-engine owned registry/assembler 注入消费者。builtin templates 由 context-engine 包内资源在 registry 初始化时编译。

`agent-package-assembly` 拥有 Agent package prompt root discovery 和路径信任边界：定位 `prompts/` 并做 package-root containment，然后把受信绝对 path 交给 app composition。

本 change 的 prompt template 对象、assembler、compatibility helper 和 render result 都是 `agent-context-engine` 内部 implementation types 或 package-local test surface。`agent-contracts/context` 的旧 prompt shaping public contract 由 context-engine 内部 prompt template assembly 边界替换。

目标态的唯一 prompt decision boundary 是 context-engine 内部 `PromptTemplateAssembler`。它承载完整模板选择、变量渲染、fallback、`modelOptions` handoff 和安全观测；现有 `DefaultLayeredProfileResolver` 仅作为迁移素材。

### 核心对象

`PromptPurpose` 是稳定用途标识，不是封闭枚举。目标 TypeScript contract 应为受校验 string scalar；schema 必须约束为非空 safe id string，禁止路径分隔符、空白控制字符和高风险字符。框架提供 well-known purpose constants：

- `SYSTEM_PROMPT`
- `SUMMARY_GENERATION`
- `MEMORY_EXTRACTION`

其中只有 `SYSTEM_PROMPT` 是 prompt template assembly 的内置特殊 purpose：它触发 system prompt 专属 section taxonomy、预定义顺序、cache boundary 和 system/developer protocol placement。`SUMMARY_GENERATION`、`MEMORY_EXTRACTION` 只是框架内置消费者使用的普通 purpose string；开发者自定义 purpose 使用同一套通用选择和渲染规则，除非后续 change 明确定义新的 purpose-specific constraints。

目标态只保留黑盒能力需要的最小对象。边界先收敛为 context-engine owned implementation types：

- `PromptPurpose` 是 context-engine owned safe string alias/constants。`SYSTEM_PROMPT`、`SUMMARY_GENERATION`、`MEMORY_EXTRACTION` 由 context-engine 暴露给本包消费者和 composition tests 使用；未来若出现跨 contract subpath 复用压力，再由后续 contract refinement 决定是否上移。
- `PromptModelCandidate` 是 context-engine 内部从 accepted `AgentAssembly.modelProfileIds` 和 model profile registry 投影出的安全模型候选，字段为 `profileId`、`providerKind`、`modelName` 和声明顺序所需低敏字段。`profileId` 用于模型选择前的 compatible model profile id 计算和 `AgentAssembly.modelProfileIds` 过滤。
- `PromptModelCompatibilityRequest` 是 `DefaultContextEngine.resolveModelSelection(...)` 内部 helper input，字段为 `purpose`、`agentId`、`agentVersion`、`locale`、string-only `flowVariables` 和 trusted `modelCandidates`。
- `PromptAssemblyRequest` 是 context-engine 内部 assembler input，字段为 `purpose`、`agentId`、`agentVersion`、`locale`、`flowVariables: Readonly<Record<string, string>>` 和调用方已经选定实际调用模型后的 `selectedModel`。`selectedModel` 必填，字段为 `providerKind` 和 `modelName`。
- `PromptTemplate` 是 context-engine registry 中 materialized 的完整模板实现类型，字段为 `templateId`、内部派生 `templateRef`、`purpose`、可选 `match`、`sections: readonly PromptSection[]` 和可选 `modelOptions`。`templateRef` 由 context-engine compiler 从 `builtin`/`agent` source layer、template id、schema version 和内容身份派生；`agent` source templateRef 包含 `agentId/agentVersion`，`builtin` source templateRef 是 process-scoped 引用。
- `PromptSection` 是 context-engine compiler 解析后的 section 实现类型，字段为 `id`、`content` 和 `variables`。`variables` 由 compiler 从 `content` 中的 `{{ variableName }}` / `{{ variableName? }}` 推导，元素形状为 `name` 和 `optional`。
- `PromptAssemblyResult` 是 context-engine 内部 result，字段为 `templateId`、`templateRef`、rendered `sections`、`renderedContent` 和可选 `modelOptions`。
- `compatibleModelProfileIds(...)` 是 `DefaultContextEngine.resolveModelSelection(...)` 内部调用的 context-engine helper，输入同一 frozen template facts，输出 prompt-compatible model profile ids。
- `PromptTemplateAssembler` 是 context-engine 内部 prompt/template decision boundary，在 model selection 给出最终 `selectedModel` 后选择并渲染一个完整 template。
- `TemplateVariableResolver.resolve(...)` 由 assembler 或 consuming purpose owner 调用，从 `PromptAssemblyRequest.selectedModel`、`PromptAssemblyRequest` 其它字段和显式注册的安全投影中取值。
- `DefaultPromptTemplateAssembler` 接收 `TemplateVariableResolver` constructor dependency，用于渲染 selected template 的 sections。system purpose 在 consuming path 中使用 `ConfigurableSystemPromptBuilder` 或同 owner helper 施加 builder-owned section taxonomy 和输出顺序。
- `renderTemplateWithVariables()` 继续是变量渲染 helper，并扩展支持 `{{ variableName? }}`。
- `PromptTemplateRegistry.register(...)` 是 context-engine owned 装配期 Agent prompt 写入口。它接收 `agentId`、`agentVersion` 和受信绝对 `path`，在同步 Agent 装配中扫描受信 Agent package prompt root、编译 `PromptTemplate` facts 并发布到 Agent-scoped registry。builtin prompt 在 context-engine registry 初始化时从 context-engine 包内 builtin prompt root 编译进入 registry。

source layer 使用两类稳定 vocabulary：`builtin` 和 `agent`。`builtin` 表示 context-engine 包内内置兜底模板，`agent` 表示 Agent package `prompts/` 下的 Agent 定制模板。source layer 由 context-engine 根据编译入口确定：包内 builtin root 编译结果为 `builtin`，Agent package `register({ agentId, agentVersion, path })` 编译结果为 `agent`。source layer 参与系统内置优先级排序：`agent` 高于 `builtin`。locale 和 flowVariables 可用于模型选择前的兼容性约束计算，也用于最终 template selection；model 用于判断 template 与模型候选是否兼容，并在最终模型确定后作为同一 source layer 内的 specificity。同层冲突 key 为 `purpose + sourceLayer + locale? + model.providerKind? + model.modelName? + flowVariables key/value set` 的最高匹配集合。

### 边界保护

以下负向约束集中描述 prompt assembly 边界的排除项，避免在核心对象和核心流程中形成第二套隐式职责：

- `agent-contracts/context` 不承载本 change 的 prompt template DTO/port；`PromptPurpose`、`PromptTemplate`、`PromptSection`、`PromptAssemblyRequest`、`PromptAssemblyResult`、`PromptTemplateAssembler` 和 compatibility helper 首版都留在 `agent-context-engine` 内部。
- `PromptAssemblyRequest` 不接收 caller-supplied `templateId`、自由变量 map、prompt 正文、文件路径、client metadata authority、runtime lifecycle state、raw model profile、profile id、credential、provider route、model candidate list 或 model output。
- `PromptAssemblyResult` 不返回 diagnostics、`resolvedOptions`、`resolvedProviderOptions`、`SystemPromptContribution`、完整 profile、raw template body 或完整 model input messages。
- `compatibleModelProfileIds(...)` 不选择模板、不渲染 prompt、不返回 template identity、不合并模型参数，也不作为 public resolver 暴露。
- summary/memory/custom purpose 不构造 `providerContribution`、`promptMode`、`telecomContext`、runtime `RequestContext` 或 `SystemPromptContext` 这类 system-only 输入。
- request path 不调用 compile/publish，不读取 raw prompt 文件，不从客户端请求体、模型输出或 capability 参数接收 template authority。

### Breaking contract and migration decision

本 change 已确认允许破坏现有 prompt shaping public contract，不提供兼容 shim、deprecated alias 或双栈 resolver。原因是当前项目仍处于早期阶段，保留旧 contract 会形成两个 prompt authority，直接违背本 change 的唯一装配边界目标。实现完成时，`agent-contracts/context` 的旧 prompt shaping public contract 必须删除；目标态 prompt template 类型和 selector/assembler 不进入 `agent-contracts`，只作为 `agent-context-engine` 内部实现和 package-local test surface 存在。所有产品路径和测试路径必须迁移。

明确删除/替换关系：

| 旧 public contract | 目标态迁移 |
|---|---|
| `LayeredProfileResolver.resolve(...)` | 从 `agent-contracts/context` 删除；调用方改为 context-engine 内部 `PromptTemplateAssembler.assemble(PromptAssemblyRequest)`，不新增同名 public contract。 |
| `PromptTemplateProfile` / `PromptTemplateProfileQuery` | 从 `agent-contracts/context` 删除，目标态 registry 内部保存 `PromptTemplate` candidate；最终 template selection 输入来自内部 `PromptAssemblyRequest` 和必填 `selectedModel` 安全投影，模型选择前的兼容性约束由 `DefaultContextEngine.resolveModelSelection(...)` 内部 helper 计算。 |
| `PromptTemplateRegistry.find(query)` 作为 public profile lookup | 删除 public query 语义；`agent-context-engine` package 暴露给 `agent-app` 的装配期唯一写入口是 `register({ agentId, agentVersion, path })`，request path 只通过 context-engine 内部 assembler 消费。 |
| `PromptTemplateLoader` / request-path file loader | 不再作为 public request-path contract；文件读取只发生在 context-engine `register` 内部编译阶段。 |
| `TemplateContent.stableSections/dynamicSections` | 删除，统一为 `PromptTemplate.sections: PromptSection[]`；动态性由变量和 purpose-specific section taxonomy 表达。 |
| `PromptTemplateSectionContent` | 删除，统一为 `PromptSection { id, content, variables }`。 |
| 旧 `PromptAssemblyResult.appliedProfiles/selectedProfile/resolvedOptions/resolvedProviderOptions` | 删除；新 result 只返回 `templateId/templateRef/sections/renderedContent/modelOptions?`。最终 model/provider options 合并迁移到 model selection 或 model invocation owner。 |
| system-only `SystemPromptContext` 作为 summary/memory prompt 输入 | 禁止继续复用；summary/memory/custom purpose 使用 context-engine 内部 `PromptAssemblyRequest`。 |

迁移必须是一次性替换，不允许旧 resolver 与新 assembler 并存处理同一个 purpose。architecture tests 必须断言产品路径不再 import 或调用旧 `LayeredProfileResolver`、旧 profile query/loader 和 `TemplateContent` 双轨类型。

### Agent 配置信息、AgentAssembly 和 prompt facts 的关系

本 change 不引入异步 Agent activation 生命周期。当前目标态保持同步 Agent 装配：Agent 配置目录、built-in defaults 和 Agent package source 是装配输入；`AgentAssembly` 是装配后的 runtime-facing 输出。

prompt root `path` 属于同步装配输入，只表达某个 Agent 的 prompt template 根目录在哪里。它必须是 agent-app/package assembly 完成 package-root containment 后组装出的受信绝对路径，例如 `D:\...\agents\{agentId}\prompts`，不得来自客户端请求体或 request path，也不得写入 safe error、audit、timeline 或 runtime-facing `AgentAssembly`。

`agent-context-engine` 在同步 Agent 装配阶段通过一个 `register({ agentId, agentVersion, path })` 调用扫描该绝对 `path`，把其中合法 manifest 编译成 Agent-scoped frozen prompt template facts，并发布到 context-engine owned registry。该 registry 按 `agentId` 和 `agentVersion` 绑定 prompt facts；runtime-facing `AgentAssembly` 继续作为 request path 的可信 Agent scope anchor，但 prompt facts 不作为 `AgentAssembly` 字段暴露。

runtime-facing `AgentAssembly` 的职责是作为 request path 的可信 Agent scope anchor。它不得承载 prompt root `path`、raw manifest、section 文件路径、prompt 正文、完整 `PromptTemplate`、完整 template content 或用户可反推目录结构的信息。如实现确实需要表达 prompt 装配版本，也只能是低敏、不可反推路径/正文的 summary/ref，并且不得成为 prompt 语义 owner。

目标态明确删除旧 `AgentAssembly.promptTemplateIds` 字段，且删除 `AgentRuntimeSettings.defaultPromptTemplateId`。这两个字段不是 deprecated、不是保留但忽略，也不允许作为兼容 alias。Agent definition / `agent.yaml` 目标态也不得要求开发者维护 `promptTemplateIds` allowlist 或 `defaultPromptTemplateId`。所有 prompt 可用性、默认候选、fallback 和选择都由 context-engine registry 中已注册的 prompt facts 决定；runtime-facing `AgentAssembly` 只提供 `agentId`、`agentVersion` 等 Agent scope anchor。本 change 不新增 prompt binding/version summary 字段；若未来确实需要展示 prompt 装配版本或摘要，必须由后续 change 重新定义 owner、字段和消费者。

request path 由 runtime/core/app owner 从已冻结的 runtime request context 投影出 `agentId`、`agentVersion`、`locale` 和 string-only `flowVariables`。`DefaultContextEngine.resolveModelSelection(...)` 必须接收 request-scoped input（例如 `(assembly, request)` 或等价私有 object），在内部用这些事实与 trusted `PromptModelCandidate[]` 计算 prompt-compatible model profile ids；模型选择后，这些事实与 safe `selectedModel` 组成内部 `PromptAssemblyRequest`。context-engine 只依赖这些 context-owned projections 查询 frozen template set。consumer 不读取 Agent 配置目录，也不从 `AgentAssembly` 直接取 prompt root、prompt source 或 prompt content。

每个 consuming purpose 调用 prompt assembly 前都必须先确定自己即将调用的模型，并只把该模型的安全投影传给 `selectedModel`。主模型 `SYSTEM_PROMPT` 路径由 `DefaultContextEngine.resolveModelSelection(...)` 选择模型，因此 `selectedModel` 来自被选中的 `PromptModelCandidate`。summary generation 当前已经由 `DefaultTraceableSummaryGeneratorOptions` 持有实际模型调用配置，包含 `providerKind`、`modelName`、`baseUrl`、`credentialRef`、`commonOptions` 和 `timeoutMs`；迁移后 summary 只能从其中投影 `{ providerKind, modelName }` 作为 `selectedModel`，不得把 `baseUrl`、`credentialRef`、`commonOptions`、`timeoutMs` 或完整 invocation options 暴露给 prompt assembly。memory extraction 若拥有独立模型调用配置，也按同一原则从实际 invocation config 投影 `{ providerKind, modelName }`；若复用主模型选择结果，则复用主模型的 safe selected model 投影。

### System prompt 和通用 prompt template 的关系

通用 prompt template assembly 负责 purpose-neutral 的能力：模板 source 编译、模板选择、变量治理、模板渲染、fallback、`modelOptions` 覆盖返回和安全观测。它不内建 system prompt 的 message role、system section taxonomy、cache boundary、developer instruction slot 或 capability disclosure 语义。

`SYSTEM_PROMPT` 是通用 prompt template 的一个受限 specialization。它复用通用能力的 source 编译、选择、渲染、safe error 和安全观测机制，但额外叠加 system prompt 专属约束：

- 只能输出允许进入 system/developer protocol slot 的 prompt content 或 sections。
- 必须保留 system/developer instruction、telecom domain instruction、locale metadata、capability disclosure 等既有 system section 边界和预定义顺序。
- 不得把 conversation history、current user input、tool result 或附件原文通过普通变量压平成 system prompt。
- 必须遵守更严格的 cache boundary、system section order、失败 safe error 和安全观测规则。

因此增强逻辑是“通用 prompt template 先提供可复用装配底座，`SYSTEM_PROMPT` 再在 purpose 边界施加更严格约束”。system prompt 不拥有一套独立模板体系，也不把它的 system section 模型强加给 summary 或 memory prompt。

具体实现必须集中在 context-engine 内部的 purpose-specific dispatch，不能在通用 renderer 中散落 system-only `if/else`。首版只需要一个私有的 purpose policy/validator 分发表，不新增 public renderer port 或可注入扩展点：

1. manifest parse 后进入通用 materialization。
2. compiler 根据 `PromptTemplate.purpose` 选择私有 validator；`SYSTEM_PROMPT` 使用 system validator，非 system purpose 使用 default validator。
3. system validator 在注册期 fail closed：`content` 必须是 section array；section id 必须属于 builder-owned system section taxonomy；sealed/non-configurable system section 不得被 manifest 覆盖；manifest order 不具备 authority。
4. selector 仍按通用逻辑选择一个完整 `PromptTemplate`，不关心 system section 细节。
5. renderer 根据 selected template purpose 选择私有 render policy；default policy 保留 `PromptTemplate.sections` 顺序并渲染全部 section，system policy 只按 builder-owned predefined order 输出允许配置的 section。
6. 变量替换仍复用通用 `renderTemplateWithVariables()`；render policy 只负责 section 过滤/排序，不读取 registry、不重新选择模板、不合并模型参数。

这个 dispatch 可以是简单的 `purpose === SYSTEM_PROMPT ? systemPolicy : defaultPolicy`，但条件判断只能出现在 compiler/render 的策略选择边界。system section taxonomy、开放 section、sealed section、顺序和 cache/protocol 边界由 `ConfigurableSystemPromptBuilder` 或同 owner 的 system policy helper 承载，不进入通用 `PromptTemplate` 类型，也不成为 summary/memory/custom purpose 的隐式规则。

### 模型输入组装和 prompt 渲染的关系

prompt 渲染不是模型输入组装。prompt template assembly 的输出是某个 purpose 的 rendered prompt content、selected template identity 和可选 `modelOptions` 覆盖。它不产出完整 `RenderedModelInput.messages`，也不决定 history selection、attachment projection、tool-call protocol message、current user input、final message ordering 或最终模型参数合并。

prompt 渲染也不是模板选择。变量替换和 section 渲染只能发生在 `PromptTemplateAssembler.assemble(...)` 已经选择出一个完整 `PromptTemplate` 之后；渲染 helper 不能重新计算选择优先级、读取 registry、应用 fallback 或合并模型参数。

### 模型选择和 template 选择的关系

当前代码基线是 model-first：`DefaultContextEngine.assemble()` 先调用 `resolveModelSelection(...)`，再把已选 `modelInfo/modelOptions/providerOptions` 传给旧 `resolvePromptAssembly(...)`；`ModelProfileRegistry.selectForAssembly()` 当前按 `AgentRuntimeSettings.defaultModelProfileId ?? AgentAssembly.modelProfileIds[0]` 选模型。目标态需要补齐模型选择前的 prompt 适配约束，但不能让 prompt template 成为最终模型路由器，也不改变 template selection 的 owner。

第一性原理拆分如下：

- `purpose`、locale 和 flowVariables 是当前请求的语义/流程事实。
- `PromptTemplate` 表达某个 purpose 下的 prompt 语义以及它适配的模型条件。
- `AgentAssembly.modelProfileIds` 是当前 Agent 允许使用的初始模型 profile 清单。
- 最终模型选择属于 model selection / invocation owner，负责处理 enabled、credential、provider route、客户现网可用性、capability patch、fallback 和 options governance。

目标态顺序为：

1. Context Engine 从 accepted `AgentAssembly.modelProfileIds` 和 model profile registry 投影 `PromptModelCandidate[]`，保持 `modelProfileIds` 声明顺序作为 tie-break 顺序。
2. `DefaultContextEngine.resolveModelSelection(...)` 在最终选择模型前，内部调用 context-engine helper 计算 `compatibleModelProfileIds`。该 helper 只读取当前 Agent frozen template facts，用 `purpose`、locale、flowVariables 初筛 template candidates；只有 `agent` source 且显式声明 `match.model` 的 matched templates 参与 compatible model profile id 计算。`builtin` templates、未声明 `match.model` 的 generic templates 和 fallback templates 不进入 `compatibleModelProfileIds`。
3. `compatibleModelProfileIds` 为空数组表示 prompt template 不对模型选择施加约束；非空时作为 hard filter。
4. `resolveModelSelection(...)` 在 `AgentAssembly.modelProfileIds` 的初始清单上应用 hard filters：enabled、credential/provider/runtime/customer availability、trusted `capabilityContextPatch.modelName`、以及非空 compatible model profile id 集合。
5. 若过滤后候选为空，必须 fail safely；不得偷偷选择不被 template 显式适配约束允许的模型。若 `compatibleModelProfileIds` 为空，则不因 prompt template 施加过滤。
6. 若候选只有一个，直接选中；若多个，按确定性规则选择：受信 `capabilityContextPatch.modelName` 命中者优先，其次 `AgentRuntimeSettings.defaultModelProfileId` 命中者，其次按 `AgentAssembly.modelProfileIds` 顺序第一个候选。
7. 模型最终确定后，Context Engine 调用 `PromptTemplateAssembler.assemble(...)`，把只包含 `providerKind/modelName` 的最终 `selectedModel` 安全投影作为必填 trusted input 传入。assembler 按既有 template selection 逻辑在 frozen template set 中选择一个完整 template，并用 selected model 只作为 `match.model` 和同层 specificity 的输入，随后渲染。

因此模型兼容清单生成是 `resolveModelSelection(...)` 内部实现细节，不是 public contract，也不是 template selection 逻辑的一部分。`PromptAssemblyRequest` 不接受模型候选列表，也不承载模型选择规则；它只接受 model selection 已经选定的必填安全模型投影。`match.model` 的语义是 template 对模型的兼容条件，不是独立的模型路由规则，也不是在 prompt 层直接指定最终模型。

模型输入组装由 Context Engine 的 assembly/render 边界负责。该边界消费 prompt template assembly result，并把 rendered prompt content 放入对应 role/protocol 位置：

- `SYSTEM_PROMPT` result 进入主模型调用的 system/developer message slot。
- `SUMMARY_GENERATION` result 进入摘要模型调用的 prompt slot，同时 summary owner 继续负责来源引用和输出校验。
- `MEMORY_EXTRACTION` result 进入记忆提取模型调用的 prompt slot，同时 memory owner 继续负责提取 schema、写入策略和记忆生命周期。

conversation history、当前用户输入、tool-call/result、附件上下文和大内容引用仍由各自 owner 产生治理后的模型输入片段，再由模型输入组装层组合。prompt 模板只能引用显式注册的安全投影变量，不能绕过模型输入组装边界直接读取或拼接这些原始对象。

### 唯一可实施方案

本 change 只有一个允许的实施路径：

1. **先删旧 public prompt shaping contract**：在 `agent-contracts/context` 删除 `LayeredProfileResolver`、`PromptTemplateProfile`、`PromptTemplateProfileQuery`、`PromptTemplateRegistry.find(query)`、`PromptTemplateLoader`、`TemplateContent`、`PromptTemplateSectionContent` 和旧 `PromptAssemblyResult`。本 change 不在 `agent-contracts` 新增 prompt template DTO/port。
2. **再删旧 AgentAssembly prompt 字段**：在 `agent-contracts/agent-assembly` 删除 `AgentAssembly.promptTemplateIds` 和 `AgentRuntimeSettings.defaultPromptTemplateId`；随后同步删除 `agent-app` 的 agent definition parser、默认 Agent 配置、assembly compiler 校验、resource inventory/registry 中对这些字段和 app-owned prompt resource 的依赖。这个步骤必须先于改 `resolvePromptAssembly()`，避免 request path 继续读取已删除字段。
3. **再建立 context-engine prompt root 与 registry 边界**：builtin templates 定义在 context-engine 包内 builtin prompt root，并在 context-engine registry 初始化时用同一 compiler 编译为 process-scoped builtin facts；`agent-app`/`agent-package-assembly` 只确定 Agent package `prompts/` 的受信绝对 prompt root path；`agent-context-engine` 提供 package public composition API `register({ agentId, agentVersion, path })`，负责在同步 Agent 装配中扫描 Agent YAML、校验语义、materialize 内部 `PromptTemplate`、派生 `templateRef` 并注册 Agent-scoped registry facts。删除 `PromptTemplateResource.systemPrompt` 和 `defaultTelecomPrompt` 这类 app-owned prompt body/resource，不引入 app source layer。
4. **再收敛 selector/model selection 内部流程**：实现 context-engine 内部 `DefaultPromptTemplateAssembler`，只保留 `builtin`/`agent` 两层 source priority，并修正匹配/冲突规则；同时实现 `compatibleModelProfileIds(...)` 私有 helper，并在 `DefaultContextEngine.resolveModelSelection(assembly, request)` 内部调用。helper 只让 `agent` source 且显式 `match.model` 的 matched templates 产生 compatible ids；空数组表示不约束模型。最终模型确定后，assembler 按同一套 template selection 规则选择一个完整模板。`modelOptions` 只作为 selected template 的覆盖结果返回，不在 assembler 中合并最终 model/provider options。
5. **再收敛 render**：复用并扩展 `renderTemplateWithVariables()`，支持 `{{ variableName? }}`；`DefaultPromptTemplateAssembler` 使用 selected `PromptTemplate.sections` 渲染内部 `PromptAssemblyResult.renderedContent`，并通过 context-engine 私有 purpose render policy 处理 section order/filter。default policy 使用 manifest/materialized order；system policy 复用 builder-owned system section taxonomy、开放 section 列表和 predefined order 生成 `SystemPrompt`。通用 renderer 不得散落 system-only 条件。
6. **再接入 consumers**：`DefaultContextEngine.assemble()` 必须按“resolve model selection with prompt compatibility -> prompt assembly with required selectedModel -> final model input assembly”执行；`DefaultTraceableSummaryGenerator.loadSummaryPrompt()` 改为通过 context-engine 内部 prompt assembly dependency 获取 `SUMMARY_GENERATION` prompt，并从 summary invocation options 的 `providerKind/modelName` 投影 required `selectedModel`；memory extraction 首个实现必须通过同一 dependency 获取 `MEMORY_EXTRACTION` prompt，并从其实际模型调用配置或主模型选择结果投影 required `selectedModel`。
7. **最后删除平行决策**：移除或降级旧的直接 file/domain prompt 选择路径，使它们只作为同步 Agent 装配期 compile 使用；request path 不再直接调用 `loadPromptConfig()`、`loadSectionContents()`、`FileTemplateLoader` 或 raw package prompt read。

这个顺序不可倒置：如果先新增 summary/memory loader，再回头统一 selector，会形成两套 prompt authority；如果先改 model renderer，让它读取模板，会破坏 render boundary 和 SOLID 单一职责。

### 模板来源和 request path 边界

模板来源分两层：

- builtin：context-engine 包内内置模板，必须覆盖每个框架内置 well-known purpose 的安全 fallback；开发者自定义 purpose 若没有匹配模板，不要求框架提供语义 fallback。本 change 的目标物理位置是 `packages/agent-context-engine/prompt-templates/builtin/`，其下使用与 Agent 模板相同的 `nextagent.prompt-template/v1` YAML manifest，例如 `SYSTEM_PROMPT/template.yaml`、`SUMMARY_GENERATION/template.yaml` 和后续需要时的 `MEMORY_EXTRACTION/template.yaml`。现有 `prompt-configs/builtin`、`prompt-configs/telecom` 只能作为迁移输入，目标态 request path 不再读取它们。
- agent：Agent package `prompts/` 目录对应的受信 prompt root。

builtin templates 在 context-engine registry 初始化时由 context-engine 自己解析包内 builtin prompt root、校验 manifest、materialize `PromptTemplate`、派生 `templateRef` 并发布到 process-scoped builtin registry bucket；builtin facts 不绑定 `agentId` 或 `agentVersion`，builtin `templateRef` 也不得包含 `agentId` 或 `agentVersion`。builtin 编译失败必须阻止 app startup 或 context-engine composition 完成。builtin facts 不按 Agent 复制，避免随 Agent 数量线性增长内存。

Agent prompt root discovery 发生在同步 Agent 装配阶段，并只产出受信绝对 prompt root `path`。Agent prompt template compile 和 publish 必须通过 context-engine 的单一 `register({ agentId, agentVersion, path })` 入口完成：context-engine 扫描该 Agent 的 prompt root，把可用模板编译为 Agent-scoped registry facts，并按 `agentId/agentVersion` 绑定；Agent-scoped `templateRef` 必须包含 `agentId/agentVersion`，用于区分不同 Agent/version 的同名 template。装配失败必须 fail closed；request acceptance 只能发生在对应 Agent 的 prompt template facts 已注册成功之后。

一次 request 的 frozen template set 是 process-scoped builtin facts 与当前 accepted `agentId/agentVersion` 的 Agent-scoped facts 的逻辑并集；selector 在这个并集内先按 purpose 过滤，再执行 `agent > builtin` 和同层 specificity 规则。request path 不得把 builtin facts 复制进 `AgentAssembly`，也不得为每个 Agent 重复 materialize builtin templates。

request path 只能通过 registry/resolver 查询当前 accepted Agent 的 frozen template set，不得触发 request-time lazy compile，不得读取 raw `prompts/` 文件、重新解析 package、读取未验证配置、接受客户端模板正文或从其它 Agent-scoped bucket / 未注册模板中临时捞模板。

`AgentAssembly` 不携带 prompt 正文、完整 template content、raw package layout、文件路径、`promptTemplateIds`、`defaultPromptTemplateId`、derived `templateRef` 列表或 prompt binding/version summary；开发者不需要在 `agent.yaml` 中维护 prompt template id allowlist。

### 用户侧模板承载格式

公开给 Agent 开发者的模板承载格式只有一种：**YAML manifest + 可选 Markdown/text 内容片段**。

标准目录形态：

```text
agents/{agentId}/prompts/{templateId}/template.yaml
agents/{agentId}/prompts/{templateId}/*.md
agents/{agentId}/prompts/{templateId}/*.txt
```

支持的单文件形态：

```text
agents/{agentId}/prompts/{templateId}.yaml
```

`template.yaml` 是唯一权威入口，常规必填字段只包括 `purpose` 和 `content`。`templateId` 从 `prompts/{templateId}/template.yaml` 或 `prompts/{templateId}.yaml` 路径派生，用户 manifest 不重复声明。当 path-derived `templateId` 本身就是框架 well-known purpose constant 时，`purpose` 可省略并由 `templateId` 推导；开发者自定义 purpose 和其它自定义 template id 必须显式声明 `purpose`。`schemaVersion`、`match` 与 `modelOptions` 是可选增强；省略 `schemaVersion` 时按 `nextagent.prompt-template/v1` 解释。变量和 optional 内容通过 NextAgent 受控变量语法表达，不在 manifest 中额外声明。`.md`/`.txt` 文件只承载 prompt 正文片段，不能单独作为 prompt template 被发现、选择或执行。公开 authoring 不支持 JSON manifest。

Manifest 首版形态：

```yaml
purpose: SYSTEM_PROMPT
content:
  - identity.md
  - id: runtime
    inline: "{{ runtime? }}"
```

well-known default template 可以进一步省略 `purpose`：

```text
agents/{agentId}/prompts/SUMMARY_GENERATION/template.yaml
```

```yaml
content: |
  Produce a continuation-critical summary of the covered conversation.
  Preserve user intent, constraints, unresolved errors, and next steps.
```

需要 locale/model/flowVariables 变体或模型参数覆盖时再加可选字段：

```yaml
purpose: SUMMARY_GENERATION
match:
  locale: zh-CN
  model:
    providerKind: OPENAI
    modelName: MiniMax-M2.7
  flowVariables:
    networkDomain: mobile-core
content:
  - role.md
  - output-format.md
  - id: rules
    inline: |
      Keep the summary continuation-critical and self-contained.
modelOptions:
  temperature: 0.2
```

字段约束：

- `templateId` 由 context-engine 从受信 prompt root path 下的 manifest logical path 派生。Agent package source 不要求在 `agent.yaml` 中重复声明 template id；`prompts/` 目录下通过校验的 manifest 自动进入该 Agent 的可用模板集合。
- 用户 manifest 不声明 `templateId`、`templateRef` 或等价 identity 字段。context-engine MUST 从 `builtin`/`agent` source layer、path-derived template id、effective schema version 和内容 hash 或受控版本派生内部 `templateRef`，用于 safe error、internal observation、summary metadata 和 model invocation metadata；派生值不得包含路径。`agent` source templateRef MUST include `agentId/agentVersion`；`builtin` source templateRef MUST NOT include `agentId/agentVersion`。
- `schemaVersion` 可省略；省略时按 `nextagent.prompt-template/v1` 解释。若声明，必须等于 `nextagent.prompt-template/v1`。
- `purpose` 必须是非空 safe id string。仅当 path-derived `templateId` 等于框架 well-known purpose constant 时可省略，并由该 `templateId` 推导。`templateId=purpose` 只适合 well-known default template；开发者自定义 purpose、locale/model/flowVariables 变体和其它自定义 template id 都必须显式声明 `purpose`。
- `match` 可省略；省略时表示该 template id 与 purpose 的默认候选。出现时只能包含 `locale`、`model` 和 `flowVariables`。`model` 对齐现有 `ModelInfo`/`ModelProfile` vocabulary，只允许可选 string 字段 `providerKind` 与 `modelName`；不得引入 `modelFamily`/`modelId` 平行命名。`match.model` 表示 template 与安全模型候选或最终 selected model 的兼容条件，不是 prompt-owned final model routing：最终 template selection 中，省略 `match.model` 适配任意 selected model，声明 `providerKind` 或 `modelName` 时只适配对应安全字段相等的 selected model；模型选择前的 compatible id 计算中，只有 `agent` source 且显式声明 `match.model` 的 matched templates 贡献 ids。`flowVariables` 是业务自定义匹配键值表，key 和 value 都必须是 string，并且只与 context-engine 内部 compatibility/assembly request 的 `flowVariables` 中同名 string value 做等值匹配。`agentId`、`agentVersion` 不属于 manifest `match`，只作为 registry scope 和 request scope 使用。source layer 由 context-engine 从受信 prompt root 派生并校验，不能由用户 manifest 自称，也不是外部 match 条件。
- flowVariables match 的运行时实际值由智能体或受信运行时逻辑写入 runtime request context，再由调用方投影为 compatibility/assembly request 的 string-only `flowVariables`。客户端请求体、模型输出或 capability 参数不能直接覆盖 flowVariables match values。template compatibility 和 template selection 时，manifest `match.flowVariables.<key>` 只有在 `request.flowVariables[key]` 存在且为相同 string 时才激活；缺失或值不等都表示该 candidate 不匹配，而不是把 key 当作模板渲染变量解析。
- `content` 可以是单个 section string 或有序 section 数组。section string 等价于一个 implicit inline section，id 为 `main`。
- section string 只允许非 system purpose。`SYSTEM_PROMPT` 必须使用 section 数组，以便 section id 可被校验为 builder-owned system section id，避免绕过 system prompt section/cache boundary 约束；但 manifest 中的数组顺序对 system prompt 不具备 authority，最终 system prompt 必须按 builder-owned 预定义顺序渲染。
- content array section 可以是 shorthand string 或对象。
- shorthand string 表示 `file` section，例如 `identity.md` 等价于 `{ file: "identity.md" }`。`id` 从文件名去扩展名后派生。
- 对象 section 必须且只能使用 `file` 或 `inline` 之一。`file` section 可省略 `id`，默认从文件名派生；`inline` section 必须显式声明 `id`。
- `SYSTEM_PROMPT` 中派生或显式 section `id` 必须是 builder-owned system section id；`SUMMARY_GENERATION`、`MEMORY_EXTRACTION` 等非 system purpose 中 section `id` 只是普通 section id，不继承 system section taxonomy。
- 非 system purpose 按 manifest section 顺序渲染；`SYSTEM_PROMPT` 忽略 manifest section 顺序，只使用 manifest 提供的 section id 到 content 的映射，再按 system prompt builder 的预定义顺序输出允许配置的 section。
- `file` 必须是模板目录内相对路径，不得越界。
- manifest 不提供 `optional` 或任意条件表达式。
- 动态内容统一通过变量表达。公开语法只支持 NextAgent 受控变量语法：`{{ variableName }}` 必需变量替换和 `{{ variableName? }}` optional 变量替换。变量名必须是单个已注册变量名，不支持表达式、比较、布尔运算、filter、test、attribute/index access 或函数调用。compiler 必须从 section `content` 推导 `PromptSection.variables`，并在同步装配期 fail closed unknown variable；`{{ variableName }}` 缺失时 fallback 或 fail；`{{ variableName? }}` 在变量缺失或为空时渲染为空。section 渲染为空时可以省略。
- `modelOptions` 可省略；出现时首批只允许已有 `ModelOptionsOverride` 中可治理合并的字段。assembler 只返回该覆盖结果，最终合并由 model selection / invocation owner 完成。

### 选择算法

template selection 逻辑不因模型选择而改成新的多阶段流程。它仍然只在 `PromptTemplateAssembler.assemble(...)` 内完成：

1. 先把候选限定为当前 accepted Agent scope 的 frozen template set；该集合来自 context-engine 在同步 Agent 装配阶段从 agent/builtin prompt roots 编译并发布的 registry facts。
2. 根据 purpose、locale、flowVariables 和最终 `selectedModel` 的安全字段过滤 compatible templates。
3. 按确定性优先级选择一个完整 prompt template。

模型选择前需要的“已适配模型清单”由 `DefaultContextEngine.resolveModelSelection(...)` 内部 helper 生成。它复用同一 frozen template facts，只根据 purpose、locale、flowVariables 初筛 template candidates，并且只让 `agent` source 且显式声明 `match.model` 的 matched templates 与 `PromptModelCandidate[]` 计算 compatible model profile id 集合；`builtin`、generic、fallback 或未声明 `match.model` 的 templates 不参与该集合。返回空数组表示不对模型选择施加 prompt 约束。helper 不返回 template candidate、不选择最终 template、不渲染 prompt。

首批选择优先级分两层，从低到高为：

1. `builtin`
2. `agent`

source layer 先决定优先级，`agent` 的 default candidate 高于任何 `builtin` matched candidate。locale、`model.providerKind`、`model.modelName` 和 `flowVariables` 只在同一个 source layer 内计算 final template specificity。specificity 计分为：声明且匹配 locale 加 1，声明且匹配最终 selected model 的 `model.providerKind` 加 1，声明且匹配最终 selected model 的 `model.modelName` 加 1，每个声明且匹配的 `flowVariables` key/value 加 1；省略 `match` 的 default candidate specificity 为 0。

同一 source layer 内出现多个等价最高 specificity 匹配时必须 fail safely，并输出不含 prompt 正文的 safe error。prompt 文本不做跨模板 partial merge；被选中的模板必须是完整模板。

`modelOptions` 不参与 prompt text partial merge。最终模型参数合并必须在 model selection / invocation owner 中按已有治理规则完成；没有明确治理规则的字段不得进入 manifest contract。

### Section-Level Merge with Builtin Fallback

当选中的模板来自 `agent` source layer 时，assembler 自动在同一 frozen template set 中查找匹配的 `builtin` 模板作为 section fallback，并执行 section 级别合并：

1. agent 模板的所有 sections 完整保留，agent sections 拥有绝对优先级。
2. builtin 模板中 section id 不在 agent sections 中的 sections 被追加到合并结果中。
3. 合并后的 sections 进入 purpose-specific render policy（default policy 按 materialized order，system policy 按 builder-owned predefined order）。

builtin fallback 模板选择使用与主选择一致的 specificity 排序：在同 purpose 的 builtin candidates 中按 locale、selected model 的 providerKind/modelName 和 flowVariables 计算 specificity，取唯一最高匹配。无匹配 builtin 时不报错，直接使用 agent 模板自身 sections。

典型场景：agent 模板只定义 `role` 和 `rules` 两个 section，builtin 模板定义 `role`、`rules` 和 `tools`，合并结果为 agent `role` + agent `rules` + builtin `tools`。Agent 开发者只需覆盖需要定制的 sections，未覆盖的 sections 自动从 builtin 继承，避免重复定义完整模板。

该合并只在 `agent` source layer 触发；当选中模板本身来自 `builtin` 时，不使用任何 fallback，直接使用 builtin 模板自身 sections。

### 渲染模型

模板渲染首批只支持三类能力：

- 变量替换：变量必须在 registry 中声明 owner、类型、用途和是否 required。
- 必需变量替换：`{{ variableName }}` 缺失时该模板不可用并触发 fallback 或 safe error。
- optional 变量替换：`{{ variableName? }}` 在变量非空时渲染变量值；变量缺失或为空时渲染为空。`?` 只表达值可缺省，不表达条件块。
- 可选 section：section 只能因为渲染为空而省略，不支持额外条件字段或任意表达式。

renderer 使用 NextAgent 极小变量语法，不依赖通用模板引擎，不支持条件块、表达式、比较、布尔运算、filter、test、attribute/index access、`else`、`elif`、`for`/loop、`include`、`import`、`extends`、`set`、`macro`、`call`、`raw`、comment、任意函数调用、helper、partial、unescaped/raw injection、文件读取或脚本执行。所有变量值必须来自 context-engine、Agent assembly、capability catalog、locale/model selection 等可信 producer 的已治理投影。

### 消费方接入

system prompt shaping 以 `PromptPurpose=SYSTEM_PROMPT` 请求 assembly，并把结果放入 `RenderedModelInput.messages` 的 system/developer protocol slot。history、current user input、tool messages 和 attachment context 仍由 context assembly/render 路径管理，不允许模板变量直接注入完整未治理历史。

summary generation 以 `PromptPurpose=SUMMARY_GENERATION` 请求 assembly。摘要来源引用、owner scope、session/run 坐标和 summary metadata 仍由 traceable summary generation 与 session persistence 边界管理。summary owner 必须先确定摘要模型调用使用的实际 `providerKind/modelName`，再从该 invocation config 投影 required `selectedModel`；当前基线中的 `DefaultTraceableSummaryGeneratorOptions.providerKind/modelName` 就是该投影来源，`baseUrl/credentialRef/commonOptions/timeoutMs` 只属于模型调用 owner，不进入 prompt assembly。

memory extraction 以 `PromptPurpose=MEMORY_EXTRACTION` 请求 assembly。memory 配置只能选择或约束模板 id，不解析 prompt 文件，也不定义平行 fallback 规则。memory owner 必须从其实际模型调用配置或已复用的主模型选择结果中投影 required `selectedModel`，不得为了 prompt assembly 新增独立模型路由语义。

## 简化设计检查（KISS）

- 不新增独立 package；首版实现留在 `agent-context-engine`，由 `agent-app` composition 注入 registry。
- 不新增 prompt persistence 表；模板来自 context-engine 包内 builtin root 和 Agent package composition 发现的 `prompts/` source，并在同步装配/初始化阶段 compile 生成内存 registry facts。
- 不做用户模板 partial merge，避免无法审计的拼接结果。section-level merge with builtin fallback 只允许 agent 模板按 section id 补全未覆盖的 builtin sections，不做任意跨模板文本拼接。
- 不引入完整模板语言，只实现变量和可选 section。
- 不为 routing/review/tool-description 等未来 purpose 定义内置特殊语义；开发者自定义 purpose 仍可走通用选择和渲染规则。
- 不新增第二个 resolver/loader 决策栈；所有现有 prompt 入口必须迁移到同一 purpose-aware resolver。

## 第一性原理和 SOLID 检查

第一性原理：

- 模型可见 prompt 是高风险输入，必须有唯一 authority、确定性选择、可审计 identity、失败 safe error 和安全观测。
- 模型输入是多来源协议结构，prompt 模板只是其中一种输入片段来源，不能拥有 history/tool/attachment 的原始数据访问权。
- Agent 开发者定制应该改变可治理模板候选和策略，不应改变 owner scope、agent scope、request lifecycle 或 provider invocation contract。

KISS：

- 保留现有 package 边界，不新建 package、DB、Web API 或运行时命令；但会替换不匹配目标态的 contract 名称和字段。
- 首批只覆盖三个真实 consumer，不实现未来 routing/review/tool-description。
- 模板语言只保留变量和可选 section，不引入脚本或复杂表达式。

SOLID：

- Single Responsibility：`agent-context-engine` 决定 prompt template assembly；`DefaultModelInputRenderer` 决定最终 `RenderedModelInput`；summary/memory 只校验各自输出和业务语义。
- Open/Closed：新增 purpose 通过 registry/contract 扩展，不改 runtime/core/channel。
- Liskov/Interface Segregation：summary/memory 不被迫依赖 system-only section 语义或内部 `SystemPromptSection`；system specialization 才把 sections 映射为 `SystemPromptContribution`。
- Dependency Inversion：consumers 依赖 prompt assembly boundary，不依赖 file loader、package path 或 concrete prompt-config directory。

## 质量属性设计

安全：

- template authority 只能来自 context-engine 包内 builtin root 和已验证 Agent package。
- prompt 正文不得进入 `PromptAssemblyResult`、safe error、audit、log、metric、stream event 或 public DTO。
- prompt assembly 的 safe error、structured log、trace/audit candidate 只包含 purpose、template id、derived `templateRef`、safe reason code、source layer、匹配计数和 fallback 层级。

可靠性：

- 每个框架内置 well-known purpose 必须有 built-in fallback；开发者自定义 purpose 的 fallback 由对应消费者或自定义模板配置负责。
- 选择冲突、required 变量缺失和非法模板 manifest 必须可重复触发 safe failure 或 fallback。
- request path 不依赖文件系统读取，避免运行中 package 状态漂移。

可诊断：

- assembler 内部产生 bounded safe observation，便于定位选择层级、fallback reason 和缺失变量；调用方不读取这些 observation 做业务分支。
- safe observation 字段采用低基数 reason code，不使用路径、prompt text 或 raw provider payload。

可测试：

- selector、renderer、source registry、`modelOptions` handoff 和 consumer integration 都有可单独验证的 contract/unit/integration tests。
- architecture test 断言 request path 不读取 raw prompt source，memory/context 不绕过 resolver。

## 验证映射

- 模板用途和内部 implementation shape：任务 1，验证 `agent-contracts/context` 删除旧 prompt shaping contract 且不新增本 change prompt template DTO/port；验证 context-engine 内部 `PromptPurpose`、request/result、template/section schema，并验证 result 不含 diagnostics。
- source registry 和 package 边界：任务 2，验证 prompt root discovery、同步 Agent 装配期 `register`、Agent package 校验、`AgentAssembly` 不含 prompt root path/正文/路径/完整 template facts。
- 选择和模型参数覆盖：任务 3，验证完整模板选择、冲突失败、`modelOptions` 只作为 handoff 返回。
- 渲染：任务 4，验证 required/optional 变量、可选 section、省略和缺失变量 fallback。
- 消费方接入：任务 5，验证 system prompt、summary generation、memory extraction 都通过 context-engine 内部统一 assembler。
- 安全和架构：任务 6，验证 safe error/observability redaction、request path 无 raw file read、无 private import。
- OpenSpec 和 roadmap：任务 7，验证 OpenSpec strict 与 roadmap 链接一致。

## 文档承载决策

本 change 的长期行为归档到：

- `openspec/specs/prompt-template-assembly/spec.md`
- `openspec/specs/context-engine/spec.md`
- `openspec/specs/agent-package-assembly/spec.md`
- `openspec/specs/memory-configuration/spec.md`

长期设计视图归档到：

- `openspec/designs/architecture/prompt-template-assembly.md`
- `openspec/designs/modules/agent-context-engine.md`
- `openspec/designs/modules/agent-app.md`
- `openspec/designs/modules/agent-memory.md`
- `openspec/designs/adr/prompt-template-complete-selection.md`
- `openspec/designs/spec-to-design-map.md`

roadmap 只承载 change 目标、状态、依赖和详情链接，不承载完整 contract。

## 风险与取舍

- 不把 prompt template DTO/port 放入 `agent-contracts` 会让首版类型主要停留在 context-engine 包内，跨 package 复用能力较弱；首版接受该取舍，因为当前真实消费者都在 context-engine 或 app composition 内，过早 public 化会冻结尚未被外部消费者验证的 selector/renderer 形状。
- 不做 prompt partial merge 会减少灵活性，但能保证被执行的 prompt 是一个可审计完整模板。section-level merge with builtin fallback 在保持完整性的前提下，允许 agent 模板只覆盖部分 sections，未覆盖的 sections 从 builtin 自动补全。
- 不引入完整模板语言会限制复杂动态 prompt，但避免脚本执行、安全审计和测试复杂度失控。
- request path 禁止 raw file read 会要求 composition 阶段更严格，但能避免运行时漂移和 owner/agent scope 逃逸。

## 迁移计划

1. 先从 `agent-contracts/context` 删除旧 resolver/profile/content/result shape，且不新增 prompt template DTO/port。
2. 再从 `agent-contracts/agent-assembly` 和 `agent-app` parser/default/compiler 路径删除 `promptTemplateIds` 与 `defaultPromptTemplateId`，确保旧字段不会继续被 request path 读取。
3. 把现有默认 prompt 转成 built-in template registry facts，并让 context-engine `register({ agentId, agentVersion, path })` 成为唯一装配期写入口。
4. 让 `DefaultContextEngine.resolveModelSelection(assembly, request)` 内部计算 prompt-compatible model ids，并在模型确定后用必填 `selectedModel` 调用 prompt assembly。
5. 让 system prompt 使用 `PromptPurpose=SYSTEM_PROMPT` 的 assembly result。
6. 让 summary generation 和 memory extraction 改为 purpose-scoped assembly consumer。
7. 把旧 result 中的 options merge 迁移到 model selection / model invocation owner。
8. 删除旧的局部 prompt override、direct file/domain selection、request-path file loader、system-only profile assumption 和所有旧 contract imports。

## 归档前更新基线

归档前必须把本 change delta 同步到 baseline specs，并补充 architecture/module/ADR 设计视图。`openspec/overview.md` 需要补充：prompt template 是跨 purpose Agent 定制能力，system prompt 是高风险 purpose。

## 待确认问题

- `PromptPurpose` 首版留在 `agent-context-engine` 内部；若实现后出现跨 contract subpath 的真实重复定义压力，再由后续 contract refinement 决定是否上移到 `agent-common` 或 `agent-contracts`。
- `modelOptions` 首批具体字段只允许纳入已有 `ModelOptions` 中可明确治理合并的字段；新增字段必须在 implementation 前逐项确认 owner 和合并规则。
