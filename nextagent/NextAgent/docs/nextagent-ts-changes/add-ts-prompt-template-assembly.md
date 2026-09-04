# add-ts-prompt-template-assembly

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Context Assembly

状态：active
类型：实施 change
主要 owner：`agent-context-engine`
依赖：`add-ts-context-prompt-shaping`、`add-ts-traceable-summary-generation`、`add-ts-memory-configuration`、`add-ts-agent-package-assembly`

目标：
- 将 prompt template 提升为跨 purpose 的装配能力。Agent 开发者通过 Agent package `prompts/` 目录提供模板；系统在同步 Agent 装配阶段注册模板；运行时消费者按 `SYSTEM_PROMPT`、`SUMMARY_GENERATION`、`MEMORY_EXTRACTION` 等 purpose 请求 assembly，得到确定选择、已渲染、带安全 template identity 和可选 `modelOptions` handoff 的 prompt result。

规格输入：
- `PromptPurpose` 首版是 `agent-context-engine` 内部受校验 string scalar；框架 well-known purpose constants 包括 `SYSTEM_PROMPT`、`SUMMARY_GENERATION`、`MEMORY_EXTRACTION`，并允许开发者自定义 purpose。只有 `SYSTEM_PROMPT` 是内置特殊 purpose。
- prompt template 来源包括 context-engine 包内 builtin templates 和 Agent package `prompts` prompt root；agent-app 在同步 Agent 装配阶段只调用 context-engine `register({ agentId, agentVersion, path })` 单入口注册 Agent templates，其中 `path` 是 agent-app/package assembly 组装好的受信绝对 prompt root 路径，由 context-engine 完成扫描、编译和 registry publish。
- Agent 开发者公开 authoring 格式为 `prompts/{templateId}/template.yaml` 或 `prompts/{templateId}.yaml`；`.md`/`.txt` 只能作为 manifest 引用的正文片段，不能单独作为 prompt template。
- `templateId` 从路径派生；custom template id、自定义 purpose 和 template variant 的 `template.yaml` 必填 `purpose` 和 `content`；仅 well-known purpose default 路径可省略 `purpose`；`schemaVersion`、`match` 和 `modelOptions` 可选；内部 `templateRef` 由 context-engine compiler 从可信来源和内容身份派生；builtin `templateRef` 为 process-scoped 引用，Agent-scoped `templateRef` 包含 `agentId/agentVersion`。
- `content` 支持非 system section string，也支持 section 数组；数组支持 `identity.md` 这类 file shorthand；file section 可省略 id 并从文件名派生；动态内容用 NextAgent 受控变量语法的 `{{ variableName }}`，optional 内容用 `{{ variableName? }}`；`SYSTEM_PROMPT` 必须使用数组且 section id 必须来自 builder-owned taxonomy，但 manifest section 顺序会被忽略并按 builder-owned 预定义顺序渲染；summary/memory 等非 system purpose 按 ordered sections 渲染。
- `SYSTEM_PROMPT` 的强约束通过 context-engine 私有 purpose validator/render policy dispatch 叠加：注册期 system validator 校验 section array、builder-owned section id 和 sealed section；渲染期 system policy 负责 section 过滤/排序，通用变量 renderer 只做变量替换。
- `PromptSection` 是 compiler 解析后的 section，包含 `id/content/variables`；`variables` 从 section content 推导，元素只含 `name/optional`，用户 manifest 不声明 variables。
- 同步 Agent 装配在 request acceptance 前完成 prompt template compile；Context Engine 从 accepted Agent 的 frozen template set 中选择。
- template selection 逻辑保持在 context-engine 内部 `PromptTemplateAssembler.assemble(...)` 内：按当前 accepted Agent scope 的 frozen template set、purpose、locale/language、string-only `flowVariables`、必填 selected model、`agent > builtin` 和 locale/model/flowVariables specificity 选择一个完整 template。模型选择前需要的 prompt-compatible model profile ids 由 `DefaultContextEngine.resolveModelSelection(...)` 内部 helper 生成；只有 `agent` source 且显式 `match.model` 的 matched templates 贡献 compatible ids，`builtin`/generic/fallback template 不贡献，空集合表示不约束模型。
- builtin templates 定义在 `packages/agent-context-engine/prompt-templates/builtin/`，使用同一 `nextagent.prompt-template/v1` YAML manifest，由 context-engine registry 初始化时编译进 process-scoped builtin bucket；builtin facts 不绑定 `agentId/agentVersion`。Agent templates 由 agent-app 传入受信绝对 `prompts/` path 后通过 `register({ agentId, agentVersion, path })` 编译进 Agent-scoped bucket。request 的 frozen template set 是 builtin bucket 与当前 Agent bucket 的逻辑并集，不把 builtin facts 复制进 `AgentAssembly` 或按 Agent 重复 materialize。
- prompt 文本选择一个完整模板，不跨多个用户模板做 partial merge。
- `modelOptions` 可由 template 声明并随 assembly result 返回；最终模型参数合并必须由 model selection / invocation owner 完成，不属于 prompt assembler。
- 渲染首批支持 NextAgent 受控变量语法：`{{ variableName }}` 必需变量和 `{{ variableName? }}` optional 变量。
- `PromptAssemblyResult` 包含 selected template identity、rendered sections/content 和可选 `modelOptions` handoff；失败 safe error、structured log、trace/audit candidate 只包含安全低基数字段。

契约输入：
- 本 change 将 prompt template assembly 类型保持在 `agent-context-engine` 内部实现边界。`PromptPurpose`、`PromptModelCandidate`、`PromptAssemblyRequest`、`PromptTemplate`、`PromptSection`、`PromptAssemblyResult` 和 `PromptTemplateAssembler` 首版作为 `agent-context-engine` 内部 implementation types 或 package-local test surface。
- 目标态只保留黑盒目标必需字段：内部 `PromptAssemblyRequest` 只含 `purpose/agentId/agentVersion/locale/flowVariables/selectedModel`，`selectedModel` 必填且只包含 `providerKind/modelName`；安全模型候选只含从 `AgentAssembly.modelProfileIds` 和 model profile registry 投影出的 `profileId/providerKind/modelName`；summary generation 从当前 summary invocation options 的 `providerKind/modelName` 投影 selected model；`PromptTemplate.sections` 是唯一正文结构，内部 `PromptAssemblyResult.renderedContent` 是渲染输出。
- 目标 contract：`agent-contracts/context` 不承载 prompt template implementation DTO/port，不提供 parallel resolver、deprecated alias 或第二套 resolver。prompt template assembly 的 model/provider options handoff 只表达安全的选择结果；最终 model/provider options merge 归 model selection 或 invocation owner。
- `AgentAssembly` 是同步装配结果和 request path 的 Agent scope anchor；compiled prompt facts 进入 context-engine owned registry；Agent 开发者通过 `prompts/` 目录提供模板，不在 `agent.yaml` 中维护 prompt template id allowlist。

实现约束：
- `agent-context-engine` 拥有 prompt template manifest schema、parser、semantic validation、materializer、`templateRef` derivation、Agent-scoped registry、selector、renderer、fallback、失败 safe error 和安全观测。
- `agent-app` 只负责同步 composition 编排：解析 Agent package `prompts/` 受信绝对 prompt root path，在同步 Agent 装配中调用 context-engine `register({ agentId, agentVersion, path })`，并注入 context-engine owned registry/assembler；builtin path 由 context-engine 包内 registry 初始化处理，不由 agent-app 传入。
- `agent-package-assembly` 负责定位 Agent package `prompts` 根目录和路径 containment，并把受信绝对 prompt root path 交给 app composition。
- system prompt、summary generation 和 memory extraction 消费统一 prompt template assembly resolver。

非目标：
- NOT 引入 prompt UI、热更新、租户级 marketplace、prompt persistence store 或 provider SDK 变更。
- NOT 在首版为 routing/review/tool-description 等未来 purpose 定义内置特殊语义；开发者仍可使用自定义 purpose 走通用选择和渲染规则。
- NOT 固化具体 prompt 正文到 OpenSpec。
- NOT 在 request path 读取 raw prompt 文件、重新解析 Agent package、接收客户端 prompt 正文或 template authority。
- NOT 把 prompt template implementation types 提升为 `agent-contracts` public DTO/port。
- NOT 把 prompt 正文、模型输出、provider payload、路径、credential、token、附件内容或高基数字段写入 safe error、structured log、trace/audit candidate。

验收要点：
- Contract/source：`agent-contracts/context` 不导出 prompt template implementation types；context-engine 内部 `PromptPurpose` safe string、well-known constants、自定义 purpose、request/result/template/section 和 assembler 通过 schema/source tests，并断言 result 不含 diagnostics。
- Selector：完整模板选择、fallback、冲突失败和 `modelOptions` handoff 可重复验证。
- Renderer：变量替换、required/optional 变量、可选 section 和非法模板失败可重复验证。
- Integration：system prompt、summary generation、memory extraction 都通过统一 resolver。
- Architecture：request path 无 raw prompt file read；`AgentAssembly` 不含 `promptTemplateIds`、prompt root path、prompt 正文、路径、完整 template facts 或 prompt binding/version summary；`AgentRuntimeSettings` 不含 `defaultPromptTemplateId`；跨 package 只用 public exports。
- Security：safe error、structured log、trace/audit candidates 不泄露 prompt 正文或敏感数据。

并行边界：
- prompt template 装配归 `agent-context-engine`；runtime/core/channel 不做 prompt 语义路由。
- Agent package 只贡献受信绝对 `prompts` root path；context-engine `register` 产出已验证 prompt candidate facts；memory 不拥有独立 prompt file format 或 fallback 规则。
