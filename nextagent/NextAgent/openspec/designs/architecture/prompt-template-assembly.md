# Prompt Template Assembly

本设计承载 context-engine owned prompt template assembly 的长期事实。行为性要求由 `openspec/specs/prompt-template-assembly/spec.md`、`openspec/specs/context-engine/spec.md`、`openspec/specs/agent-package-assembly/spec.md` 和相关 module design 承载。

## Ownership

Prompt template assembly 由 `agent-context-engine` 拥有。`PromptTemplateAssembler`、template compiler、registry、purpose policy、variable resolver 和 template selection 都留在 context-engine implementation boundary，不进入 `agent-contracts` public surface。

Agent package 的 `prompts/` 是 assembly 输入，不是 runtime-facing fact。`agent-app` 在启动期解析 trusted Agent package root，只把 `agentId`、`agentVersion` 和已 containment 校验的 prompt root path 交给 context-engine registry compile/register 入口；`AgentAssembly` 不携带 prompt text、prompt root path、template id allowlist、template refs、rendered prompt 或 default prompt template setting。accepted request path 不重新读取 raw prompt files。

## Sources and Compile Boundary

Prompt template source 只有两类长期语义：

- `builtin`：`agent-context-engine` package-owned built-in fallback templates。它们在 context-engine registry 初始化时编译，作为 process-scoped fallback bucket。
- `agent`：Agent package `prompts/` 下的 Agent-scoped templates。它们在同步 Agent assembly 阶段通过 `register({ agentId, agentVersion, path })` 编译和发布。

`agent-app` 只负责把可信 package root 解析为受 containment 保护的 prompt root path；它不解释 prompt manifest、不决定 template selection、不读取 prompt body，也不把 prompt facts 写入 `AgentAssembly`。context-engine compiler 是唯一读取 prompt files 的边界。request path 只能消费已经编译并绑定到 `agentId/agentVersion` 的 frozen template facts。

编译失败必须 fail closed 到 assembly/readiness 边界，不能把非法 template 延迟到 request path 再发现。safe error、日志、trace 或 observation 只能包含 purpose、safe template id、source layer、reason code 和 bounded count，不包含 prompt text、raw path、file content、credential、model output、tool result 或附件内容。

## Purpose Model

每次构造模型可见 prompt 的内部调用必须指定 `PromptPurpose`。`PromptPurpose` 是受控 safe string，不是封闭 enum；框架 well-known purpose 包括 `SYSTEM_PROMPT`、`SUMMARY_GENERATION` 和 `MEMORY_EXTRACTION`。

`SYSTEM_PROMPT` 是通用 prompt template assembly 的高风险 specialization：它在通用 template selection/rendering 之后应用 system section taxonomy、排序、cache boundary 和 protocol 约束。`SUMMARY_GENERATION`、`MEMORY_EXTRACTION` 和自定义 purpose 使用通用 ordered-section rendering，不继承 system-only section taxonomy。

## Template Shape and Identity

Prompt template manifest 只表达 purpose、match 条件、content sections 和可治理的 `modelOptions` handoff。Template identity 由 context-engine compiler 从 source layer、logical template id、schema version、content identity 和 Agent scope 派生；用户 manifest 不提供 `templateRef` 或等价 execution authority。

`match` 只允许受信选择维度：locale、selected model 的 canonical `modelId` 和 string-only `flowVariables`。`agentId/agentVersion` 是 registry scope，不是 manifest match 条件。source layer 也不是 manifest 字段；它来自编译入口。

Content 可以是普通 ordered sections，也可以在 `SYSTEM_PROMPT` purpose 下映射为受控 system sections。`SYSTEM_PROMPT` 的 section id、输出顺序和 cache boundary 由 context-engine system purpose policy 拥有；manifest 顺序不能绕过 system section taxonomy。非 system purpose 按 materialized section order 渲染。

## Selection and Rendering

Template selection 只使用 trusted frozen template facts 和 context-engine 投影的安全输入：`purpose`、accepted `agentId/agentVersion`、locale、string-only `flowVariables`、以及实际模型调用已经选定的 canonical `modelId`。客户端请求体、模型输出、capability 参数和不可信 metadata 不得覆盖 template selection authority。

Selection source layer 只有 `agent` 和 `builtin` 两个语义值。`agent` templates 来自 Agent package `prompts/`，优先于 context-engine package-owned `builtin` fallback templates。系统必须选择一个完整 template 作为主 template；不得把多个用户定义 template 的正文片段按 layer 做任意 partial merge。

在选中 `agent` template 时，可以从唯一最佳匹配的 `builtin` template 补齐缺失 sections；该补齐只发生在 section 边界，不能混合任意文本片段。相同 source layer 内若 trusted specificity 无法确定唯一最高候选，必须 fail closed。

选择算法分两步理解：

1. 先按 Agent scope 和 purpose 限定候选集，再用 locale、flowVariables 和 selected model safe fields 过滤不兼容候选。
2. 再按 source layer 和 specificity 选出一个完整主 template。`agent` layer 优先于 `builtin` layer；同一 layer 内 locale、modelId 和每个 matched flowVariable 都贡献 specificity。最高 specificity 不唯一时必须 fail closed。

Section-level builtin fallback 只在主 template 来自 `agent` layer 时触发。fallback 选择只在同 purpose 的 `builtin` candidates 内进行，使用相同 specificity 规则取唯一最佳匹配。Agent template 已定义的 section 永远优先；builtin 只补齐缺失 section。主 template 来自 `builtin` 时不再 fallback。

## Model Selection Boundary

Prompt Template 的封闭 `modelOptions` 可以声明 canonical `toolChoice`，但不能声明模型身份、Agent loop limits 或 provider-private Tool choice。模板值进入 context-engine 的 provider-neutral 逐字段 merge：profile 基线后依次应用 Prompt Template、受治理 Capability patch、trusted request model options 和 `BEFORE_MODEL_INVOKE` Hook；budget owner 随后仍可把 model-only/finalizing 的 effective 值强制为 `NONE`。合并只作用于同一 request/run，不修改 Agent assembly、Skill metadata 或 provider profile。

每个 consumer 必须先决定实际要调用的模型，再把 safe canonical `modelId` 投影传给 prompt assembly。Prompt template assembly 可以返回 `modelOptions` override handoff，但不执行最终 `ModelInferenceOptions` / providerOptions merge，也不重新选择模型。

主模型路径的 prompt-compatible model filtering 由 context-engine 在最终模型选择前完成：只有 `agent` source 且显式声明 `match.modelId` 的 templates 能约束模型候选；builtin/default/fallback templates 不收窄模型选择。空 compatible set 表示 prompt templates 不约束模型选择。

Prompt-compatible model filtering 不是 template selection。它只在最终模型选择前用 frozen template facts 计算一组兼容 `modelId`；不返回 template identity、不渲染 prompt、不合并 model options。最终模型确定后，`PromptTemplateAssembler` 才用该 canonical `modelId` 执行真正 template selection。

## Variables and Safety

Template language 只允许受控变量语法，例如 `{{ variableName }}` 和 `{{ variableName? }}`。变量名必须由 registry 中的 resolver 明确支持；rendering 不运行任意模板引擎，不直接读取 message store、attachment blob、tool payload、filesystem、credential 或 provider-private facts。

受治理的 `timezone` 与 `currentDate` 变量从同一次渲染的进程本地日历事实解析：`timezone` 表示进程本地 IANA 时区，`currentDate` 表示该时区中渲染时刻对应的 `YYYY-MM-DD` 日历日期，由同一个 `now` 的本地年、月、日组成。系统不使用 UTC 日期与非 UTC 的 `timezone` 组成同一次渲染结果；进程本地时区在进程生命周期内保持固定，未配置用户时区时从不从 locale、请求内容或浏览器环境推断时区。

Rendered prompt content、selected template identity、safe observations 和可选 `modelOptions` handoff 可以被 consumer 使用；完整 `RenderedModelInput.messages` 仍由 context-engine render path 组合 history、capability disclosure、tool result pairing 和 attachment placement 后产生。

## Consumers

Main model invocation uses `PromptPurpose=SYSTEM_PROMPT` and then lets `ModelInputRenderer` assemble the final provider-neutral message list. Conversation history、current user message、tool-use pairing、capability result messages、attachments 和 capability disclosure stay outside generic prompt template rendering unless a purpose-specific owner explicitly asks for a safe text projection.

Skill 使用披露是这条规则的第一个已落地例外：purpose-specific owner（context engine 的 system render policy）提供 `skillDisclosureList`、`skillDisclosureMode`、`skillDisclosureBody` 三个安全投影变量，Skill 使用指导经 builtin `skill_disclosure` system section 进入模板渲染。披露门控（`Skill` tool 可见性、过滤后列表非空）由 policy 层强制，Agent 覆盖内容不可绕过；投影只驱动条件渲染与变量解析，不影响模板/模型选择。CLIP、agent、attachment disclosure 仍由 renderer 组装路径拥有，留在通用模板渲染之外。

Traceable summary generation 使用 `PromptPurpose=SUMMARY_GENERATION`，并从实际 summary model invocation config 投影 `selectedModel`。Summary metadata、covered message refs、owner/session/run scope 和 persistence 仍由 summary/context/session boundaries 拥有。

Memory extraction 使用 `PromptPurpose=MEMORY_EXTRACTION`，并从实际将调用的 model configuration 或复用的 governed main model selection 投影 `selectedModel`。Memory 不得新增 private prompt file format、loader chain、prompt id allowlist 或 request-path parser。

Custom purpose 可以复用同一 registry、selection 和 rendering 规则；除非后续 OpenSpec change 定义 purpose-specific constraints，否则 custom purpose 不具备 system-prompt privileges。

## Capability 失败处置协作

Prompt Template 只能通过 closed `ModelInferenceOptions.toolChoice` 提供一个可被后层覆盖的 provider-neutral 值，省略表示不覆盖。它不能修改 Agent loop budget、绕过 assembly 授权或覆盖 finalizing/model-only 的硬 `NONE`。完整合并链和 request-local finalizing feedback 见 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md`。
