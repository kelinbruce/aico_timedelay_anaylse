<!-- 本文件是 active change 的行为规格 delta，路径为 specs/prompt-template-assembly/spec.md。 -->

## MODIFIED Requirements

### Requirement: Prompt assembly has one decision boundary

系统 SHALL 在 context-engine 内暴露唯一一个 prompt template assembly 决策边界，用于模板选择、fallback、渲染和 model options override 交接。该边界 SHALL 实现为 `agent-context-engine` 内的 `PromptTemplateAssembler`。摘要生成和记忆提取 MUST 通过 context-engine 依赖消费该边界。

该边界 SHALL 接受 context-owned 的投影 prompt 输入，包含 `purpose`、`agentId`、`agentVersion`、`locale`、string-only `flowVariables`、渲染前选定的必需安全 `selectedModel` 投影，以及可选的安全 `memoryEnabled` 布尔投影。必需的 `selectedModel` 投影 SHALL 恰好包含模板匹配所需的模型身份字段：`providerKind` 和 `modelName`。可选的 `memoryEnabled` 投影 SHALL 是一个布尔值，由 context engine 从 accepted Agent 的模型可见 capability 集合推导：当且仅当 app 注入的记忆门控 capability id 出现在该集合中时为 true。App 组合层 SHALL 把记忆门控 capability id 作为可信配置值注入 context engine；context engine SHALL NOT 引用记忆工具名、`MemoryConfig`、memory gateway ports，也不得 import memory 包（架构边界）。`memoryEnabled` SHALL 仅用于 `memory` system section 的受控条件渲染，MUST NOT 影响模板选择、模型选择、model options 交接，MUST NOT 被写入 prompt 文本。它 SHALL 返回选定的安全 template identity、渲染后的 prompt sections/content 和可选的 model options override。

实现 SHALL 用 context-engine 内部 prompt template assembly 替换 system-only resolver contract。Runtime/core/app 调用方 SHALL 把可信 runtime facts 投影进 context-engine 内部 prompt assembly 输入。

`PromptTemplateAssembler` SHALL 是选择并渲染 prompt template 的边界。`DefaultContextEngine.resolveModelSelection(...)` SHALL 在最终模型选择前，使用相同的可信 frozen template facts 内部计算 prompt-compatible model profile ids。模板兼容性、最终模板选择和变量值查找 SHALL 基于可信 registry facts、context-owned 投影 prompt 输入、可信安全 model 候选值和安全投影进行。

每个消费 purpose MUST 在调用 prompt assembly 前选定它将实际调用的模型，然后只把安全的 `selectedModel` 字段投影进内部 assembly 请求。主 `SYSTEM_PROMPT` 路径上，该投影 SHALL 来自 `DefaultContextEngine.resolveModelSelection(...)`。摘要生成路径上，投影 SHALL 来自已拥有实际摘要模型的摘要模型调用配置；当前基线为 `DefaultTraceableSummaryGeneratorOptions.providerKind` 和 `DefaultTraceableSummaryGeneratorOptions.modelName`。记忆提取 SHALL 从其自身实际调用模型配置或复用的主 selected model 投影所需的 `selectedModel`。

#### Scenario: Prompt assembler 返回单个渲染 prompt 结果
- **WHEN** 一个消费方为某 purpose 请求 prompt assembly，携带可信 `agentId`、`agentVersion`、locale、flowVariables 和 selected model
- **THEN** context-engine `PromptTemplateAssembler` MUST 从 frozen template 集合中选定一个完整 template
- **AND** MUST 返回选定的安全 template identity、渲染后的 sections/content 和可选的 `modelOptions` 交接
- **AND** 消费 purpose MUST 把该选定结果用于模型调用

#### Scenario: memoryEnabled 投影仅驱动条件渲染
- **WHEN** 一次 `SYSTEM_PROMPT` assembly 请求携带 `memoryEnabled = true`
- **THEN** assembler MUST 把该投影提供给 system render policy 用于条件 section 过滤
- **AND** 该投影 MUST NOT 改变模板选择、模型选择或 `modelOptions` 交接
- **AND** 该投影 MUST NOT 被内联进渲染后的 prompt 文本

## ADDED Requirements

### Requirement: System prompt memory guidance section

系统 SHALL 在 builtin `SYSTEM_PROMPT` 模板中提供一个 `memory` section 作为 builder-owned system section，渲染顺序位于 `tooling` 之后、`action_safety` 之前。`memory` section 的内容 SHALL 来自独立的内容文件 `memory.md`，与其他 system section 形态一致，不通过 inline 变量承载正文。

`memory` section SHALL 仅当装配上下文的 `memoryEnabled` 投影为 true 时被渲染。`memoryEnabled` 为 true 即等价于 app 注入的记忆门控 capability id 出现在该 Agent 的模型可见 capability 集合中——也就是说，模型实际能调用该记忆工具；当该 capability id 不在集合中时，模型无法调用记忆工具，`memory` 指导段无意义，MUST NOT 渲染。当 `memoryEnabled` 为 false 或未提供时，system render policy MUST 在公共变量替换之前过滤掉 `memory` section，使其不出现在最终 system prompt 中。

`memory.md` 指导正文 SHALL 仅承载策略层：何时记、记什么、不记什么、何时检索、核验与边界。工具调用机制（参数、category 内容字段、L1/L2 渐进披露、`purpose` 语义、`nextAction` 回执等）SHALL 由工具描述承载，`memory.md` MUST NOT 重复这些机制细节。`memory.md` MUST NOT 让 context assembly 自动检索或注入长期记忆结果，MUST NOT 预加载任何记忆条目到 system prompt，MUST NOT 提及文件路径、frontmatter、`MEMORY.md`、`update_memory` 或 `forget_memory`（首版不暴露这些工具）。该 section 不改变 `memory-tools` / `memory-core` / `memory-extraction` / `memory-aging` 的任何行为契约。

#### Scenario: 记忆启用时渲染指导段
- **WHEN** 一次 `SYSTEM_PROMPT` 装配的 `memoryEnabled` 投影为 true
- **THEN** `memory` section MUST 出现在最终 system prompt 中，顺序位于 `tooling` section 之后、`action_safety` section 之前
- **AND** 该 section 内容 MUST 来自 `memory.md`

#### Scenario: 记忆未启用时省略指导段
- **WHEN** 一次 `SYSTEM_PROMPT` 装配的 `memoryEnabled` 投影为 false 或未提供
- **THEN** system render policy MUST 过滤掉 `memory` section
- **AND** `memory` section MUST 不出现在最终 system prompt 中

#### Scenario: 记忆指导不预加载记忆
- **WHEN** `memory` section 被渲染
- **THEN** 该 section 内容 MUST NOT 包含任何已检索的记忆条目、记忆内容或记忆 id
- **AND** 该 section MUST NOT 指示 context assembly 自动检索或注入长期记忆
- **AND** 该 section MUST 仅描述模型主动调用记忆工具的条件与边界
