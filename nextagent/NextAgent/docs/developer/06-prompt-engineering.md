# 提示工程

这一篇讲怎么写和管理 NextAgent 的提示模板。模板系统归 `agent-context-engine`，是 **purpose-aware** 的：`SYSTEM_PROMPT`、`SUMMARY_GENERATION`、`MEMORY_EXTRACTION` 以及自定义 purpose 共用同一套选择、渲染、fallback 和 modelOptions 边界。

## 模板体系概述

NextAgent 的提示模板基于 **YAML manifest + Markdown 段落文件** 的分离结构。manifest（`template.yaml`）声明 purpose、match 条件、`content` 段落顺序与变量；段落正文来自独立 `.md` 文件或 `inline` 模板变量。模板在装配期被编译为 frozen template facts，请求路径不再解析 YAML 或读 `.md`。

### Purpose-aware 装配

每次需要构造模型可见 prompt 的内部调用 MUST 指定一个 `PromptPurpose`。`PromptPurpose` 是受校验的 string scalar，不是封闭枚举。Framework well-known purpose 常量包括：

| Purpose | 风险等级 | 用途 |
|---------|----------|------|
| `SYSTEM_PROMPT` | 受限高风险 | 主模型调用的 system prompt |
| `SUMMARY_GENERATION` | 普通 | traceable 摘要生成 |
| `MEMORY_EXTRACTION` | 普通 | 长期记忆候选提取 |
| 自定义 safe-id | 普通 | 开发者自定义 purpose |

`SYSTEM_PROMPT` 有额外的特殊装配约束（builder-owned section 顺序、cache boundary、模型输入角色），但这些约束是通用装配边界的**加层特化**，不是独立的模板系统。Summary / memory / 自定义 purpose 使用通用的有序段落渲染模型。

### 单一装配边界

系统暴露**唯一一个** context-engine prompt template assembly 决策边界（`PromptTemplateAssembler`，实现于 `agent-context-engine` 内部），负责 template selection、fallback、rendering、model options override handoff。该边界：

- 接受 context-owned 投影的 prompt 输入：`purpose`、`agentId`、`agentVersion`、`locale`、string-only `flowVariables`、必需的安全 `selectedModel` 投影（仅含 canonical `modelId`）、可选安全 `memoryEnabled` 布尔投影。
- 返回 selected safe template identity、rendered prompt sections/content、可选 `modelOptions` override。
- 不接受 raw model configuration、credential、provider route、deployment endpoint、caller-supplied `templateId`、prompt body、free variables map、file path、client metadata authority、runtime lifecycle state、model candidate list 或 model output。
- 不产出完整 `RenderedModelInput.messages`、不决定历史选择、不平铺 tool-call 协议消息、不 inline 附件内容、不合并最终 model/provider options。这些由消费方的 model input assembly 边界负责。

## 模板文件结构

### 内置模板（builtin source）

内置模板位于 `packages/agent-context-engine/prompt-templates/builtin/`，由 context-engine 在 registry 初始化时编译一次到 process-scoped builtin registry bucket（source layer = `builtin`）。builtin template facts 不绑定 `agentId`/`agentVersion`，`templateRef` 也不含它们。builtin 编译失败会让 app startup 或 context-engine composition 在接受请求前失败。

```
packages/agent-context-engine/prompt-templates/builtin/
├── SYSTEM_PROMPT/
│   ├── template.yaml          # manifest
│   ├── identity.md            # 身份定义
│   ├── system-behavior.md     # 系统行为
│   ├── task-approach.md       # 任务方法
│   ├── communication-style.md # 沟通风格（含双语电信规则）
│   ├── agent-delegation.md    # Agent 委托
│   ├── tooling.md             # 工具使用
│   ├── memory.md              # 长期记忆指导（仅 memoryEnabled=true 渲染）
│   ├── action-safety.md       # 动作安全
│   ├── context-management.md  # 上下文管理
│   └── workspace.md           # 工作区
├── SUMMARY_GENERATION/
│   ├── template.yaml
│   ├── role.md
│   ├── instructions.md
│   ├── checklist.md
│   ├── output-format.md
│   └── rules.md
└── MEMORY_EXTRACTION/
    └── template.yaml          # content 直接 inline 为一段字符串
```

### Agent package 模板（agent source）

Agent package 的 `prompts/` 目录在同步 Agent assembly 期注册为 Agent-scoped frozen template facts（source layer = `agent`）。Agent-scoped template facts 绑定 trusted `agentId` + `agentVersion`，`templateRef` 含它们。Agent-app 不调用单独的 prompt compile/publish API；对应 `AgentAssembly` 在其 Agent-scoped prompt template facts 成功注册（或 fail-closed 安全错误）后才被视为 request-acceptable。

```
packages/agent-core/src/builtin-agents/network-explorer/prompts/SYSTEM_PROMPT/
├── template.yaml
├── identity.md
├── task-approach.md
├── tooling.md
├── action-safety.md
├── communication-style.md
└── context-management.md
```

> 请求路径**不**lazy compile 模板。runtime/context 路径使用该 Agent 已编译的 frozen template set，不读 `prompts/`、不解析 YAML manifest、不调用 compiler。

## template.yaml 格式

manifest 的有效 schema version 是 `nextagent.prompt-template/v1`。省略 `schemaVersion` 时编译器按 `v1` 解释；显式声明时必须等于 `v1`。JSON manifest 只能作为实现内部的测试/迁移兼容输入，**不**是 Agent 开发者的编写格式。

### SYSTEM_PROMPT 的 template.yaml

`SYSTEM_PROMPT` **必须**用 array `content`（每个 section id 会被校验为 builder-owned system section id），但 manifest array 顺序**不**决定最终 system prompt 顺序——最终顺序由 builder-owned predefined system order 决定：

```yaml
# builtin/SYSTEM_PROMPT/template.yaml
content:
  - id: identity
    file: identity.md
  - id: system_behavior
    file: system-behavior.md
  - id: task_approach
    file: task-approach.md
  - id: communication_style
    file: communication-style.md
  - id: agent_delegation
    file: agent-delegation.md
  - id: tooling
    file: tooling.md
  - id: memory
    file: memory.md
  - id: action_safety
    file: action-safety.md
  - id: context_management
    file: context-management.md
  - id: workspace
    file: workspace.md
  - id: runtime
    inline: |
      {{ runtime? }}
  - id: environment
    inline: |
      {{ environment? }}
```

### SUMMARY_GENERATION 的 template.yaml

非 system purpose 可用 array content（section id 按声明顺序渲染），也可用 section string content（被当作单个 id=`main` 的 inline section）。`SUMMARY_GENERATION` 用 array + file 简写（字符串 file 名会派生 section id 为去扩展名的 basename）：

```yaml
# builtin/SUMMARY_GENERATION/template.yaml
content:
  - role.md
  - instructions.md
  - checklist.md
  - output-format.md
  - rules.md
```

### MEMORY_EXTRACTION 的 template.yaml

也可直接用 `content:` 字符串（section string content，等价于单个 id=`main` 的 inline section）：

```yaml
# builtin/MEMORY_EXTRACTION/template.yaml
content: |
  Extract durable telecom-network memory candidates from the provided
  TaskTrajectory safety projection only.
  Do not use raw message history, hidden or replaced content, raw prompts,
  stream deltas, provider payloads, attachment bodies, local paths, credentials,
  secrets, raw tool payloads, or transient model output.
  ...
```

### 字段语义

| 字段 | 说明 |
|------|------|
| `schemaVersion` | 可选；省略按 `v1`，显式必须为 `nextagent.prompt-template/v1` |
| `purpose` | 非空 safe-id string；当 path-derived template id 恰好等于 framework well-known purpose 常量时可省略并推断；自定义 template id / 自定义 purpose 必须声明 `purpose` |
| `match` | 可选；只能含 `locale`、scalar canonical `modelId`、`flowVariables`（string key/value map）。`agentId`/`agentVersion` 不得作为 match 字段 |
| `modelOptions` | 可选；作为 model options override handoff，最终 merge 由 model selection / invocation owner 负责，**不**在 `PromptTemplateAssembler` 内合并 |
| `content` | section string（仅非 system purpose，单 inline section id=`main`）或 ordered section 数组 |
| content section（对象） | 必须声明恰好一个 content source：`file` 或 `inline`。`file` 对象可省略 `id`（从 basename 派生）；`inline` 对象必须声明 `id` |
| content section（字符串简写） | 等价于 file section，id 从 basename 派生 |

用户编写的 manifest **不得**声明 `templateId`、`templateRef` 或任何等价 identity/trace 字段——`templateId` 由 trusted prompt root path + manifest logical path 派生，`templateRef` 由 source layer / path-derived template id / schema version / content hash 派生。

按模型选择模板时，`match.model` 直接写 scalar canonical `modelId`：

```yaml
schemaVersion: nextagent.prompt-template/v1
purpose: SUMMARY_GENERATION
match:
  model: MiniMax-M2.7-highspeed
modelOptions:
  temperature: 0.1
  maxOutputTokens: 1024
content: |
  生成可追溯的运维摘要。
```

### Template 选择规则

选择是确定性的，维度全部来自受信来源：

1. 候选集先限定为当前 accepted Agent scope 的 frozen template set。
2. 按 `purpose`、`locale`、`flowVariables`、source scope 预筛。
3. 当声明 `match.model` 时按最终 safe `selectedModel.modelId` 精确过滤；省略 `match.model` 的模板兼容所有 model。
4. source 优先级：`agent` > `builtin`。`agent` default 候选 outrank 任何 `builtin` matched 候选。
5. 同 source layer 内按 specificity 选唯一：每个 declared-and-matched `locale`/`modelId`/`flowVariables` key=value 各 1 分；省略 `match` 的候选 specificity=0（default 候选）。
6. 同 source layer 同 specificity 无法唯一确定时 fail closed（安全配置错误，safe error 含 safe template identifier，不含 prompt text / path / credential）。

> 模型选择与 prompt 兼容性联动：`DefaultContextEngine.resolveModelSelection(...)` 内部用 `agent` source 且显式声明 `match.model` 的模板计算 prompt-compatible canonical model IDs 作为硬过滤；`builtin`/fallback/无 `match.model` 模板不贡献 id。空 compatible ids 表示 prompt 不约束模型选择。

## Markdown 段落编写

段落是单一职责的 `.md` 文件，被 manifest `file:` 引用。以下参考 builtin `SYSTEM_PROMPT` 段落。

### identity.md — 身份定义

```markdown
You are an interactive agent that helps users with telecommunications network problem tasks.

Use the instructions below and the tools available to you to assist the user.

IMPORTANT: You must NEVER generate or guess URLs or APIs for the user unless you are confident that the URLs are for helping the user with their task.

You may use URLs provided by the user in their messages or local files.
```

子 Agent（如 `network-explorer`）的 identity 段定义更窄的角色：

```markdown
# Role

You are `network-explorer`, a read-only evidence collection agent for telecom network operations questions.
```

### system-behavior.md — 系统行为

定义模型与系统交互的基础规则：输出渲染、工具权限模式、用户拒绝工具后的行为、prompt injection 标记处理、上下文自动压缩等。

### communication-style.md — 沟通风格（含双语电信规则）

承载双语电信输出规则。模型默认跟随用户实际输入语言（`Locale/language hint` 不是权威，用户实际输入语言优先），同时对电信术语保留原始英文：

```markdown
Respond in the same natural language as the user's current input message.
Do not rely on the `Locale/language hint` as authority for output language;
the user's actual input language takes precedence.

Keep all telecom terms in their original English form: NE names, interface names,
counters, alarms, KPI names, protocol names, IP addresses, port numbers, CLI command
names, alarm identifiers, and common English abbreviations. Do not translate these
terms regardless of output language.
```

该规则由 `telecom-bilingual-output` spec 定义，是内置 system prompt 的稳定基线。

### tooling.md — 工具使用

指导模型优先使用 dedicated tool 而非 shell 命令、并行调用独立工具、何时用 `AskUserQuestion`。该段可包含 governed 模板变量 `{{ enabledSkills? }}`，由系统变量注册表在渲染期解析为当前可用 Skill 披露。

### memory.md — 长期记忆指导

**仅当**装配上下文的 `memoryEnabled` 投影为 true 时渲染（顺序位于 `tooling` 之后、`action_safety` 之前）。`memoryEnabled=true` 等价于 app 注入的记忆门控 capability id 出现在该 Agent 的模型可见 capability 集合中（即模型实际能调用记忆工具）。当 `memoryEnabled` 为 false 或未提供时，system render policy 在公共变量替换**之前**过滤掉 `memory` section。

`memory.md` 只承载策略层：何时记、记什么、不记什么、何时检索、核验与边界。工具调用机制由工具描述承载，`memory.md` 不重复。它不预加载记忆条目、不提及文件路径/frontmatter/`update_memory`/`forget_memory`（首版不暴露）。

### action-safety.md / task-approach.md / context-management.md / workspace.md

- `action-safety.md`：执行动作的可逆性、爆炸半径、高风险操作需用户确认。
- `task-approach.md`：任务方法，探索性问题用 2-3 句话给建议 + tradeoff。
- `context-management.md`：长对话自动摘要行为说明。
- `workspace.md`：工作区根约束，含 `{{ workspaceDir }}` 变量。

## 动态段落与模板变量

模板内容可包含受治理的模板变量语法。公共语法限定为 NextAgent 受控变量语法：

- `{{ variableName }}` — **必需**替换。解析失败必须使用显式 fallback 模板或显式失败，不得静默消失。
- `{{ variableName? }}` — **可选**替换。变量解析为非空内容时渲染，解析为空或缺失时渲染为空。

变量名必须引用单一已注册变量名。变量解析使用 prompt template assembly 或消费 purpose boundary 拥有的注册表；变量必须在失败行为确定前注册。callers **不得**通过内部 prompt assembly request 提供任意 variables map。

运行时/环境信息用 inline 模板变量表达，而不是把动态内容写死在 `.md` 里：

```yaml
content:
  - id: runtime
    inline: |
      {{ runtime? }}
  - id: environment
    inline: |
      {{ environment? }}
```

编译器从 `{{ variableName }}` / `{{ variableName? }}` 推断每个 section 的 `variables`（仅含 `name` + `optional`）。用户编写的 manifest **不得**声明或覆盖 section variables。未知变量在编译期 fail closed。`enabledSkills`、`runtime`、`environment`、`workspaceDir` 都是系统注册的受治理变量。

> 渲染器**不**是通用模板引擎：不支持 condition block、表达式、比较、布尔运算、filter、test、属性/索引访问、`else`/`elif`、loop、include、import、extends、`set`、macro、call、raw block、comment、helper、partial、未转义/raw 注入、任意函数、脚本或从模板语法读文件。

## 缓存策略与 frozen template facts

模板在装配期被编译为 **frozen template facts** 注册到 context-engine registry。这个设计保护 prompt cache：

- builtin 模板编译一次到 process-scoped bucket，**不**随每个 Agent assembly 复制或重新 materialize。
- Agent-scoped 模板在同步装配期注册，请求路径只消费已编译的 frozen facts，不解析 YAML、不读 `.md`、不调用 compiler。
- `AgentAssembly` **不**携带 prompt text、prompt root path、template refs、prompt id allowlist。它只作为 trusted Agent scope anchor 供 lookup。
- 安全错误/日志/audit/timeline/stream 事件**不**暴露 prompt root 绝对路径或 prompt text。

stable 段落（identity/system-behavior/tooling 等）内容不随请求变化，便于 LLM provider KV-cache 复用；dynamic 段落（runtime/environment）用可选 inline 变量在每次渲染时填充，解析为空时渲染为空，不破坏其余段落的稳定顺序。

## 双语电信输出

内置 system prompt 的 `communication_style.md` 段承载双语电信输出规则（`telecom-bilingual-output` spec）：

- 模型默认跟随用户**实际输入**语言（不依赖 `Locale/language hint` 作为权威）。
- 电信术语保留原始英文：NE name、interface name、counter、alarm、KPI name、protocol name、IP 地址、端口号、CLI 命令名、alarm identifier、常见英文缩写。
- 无论输出语言如何，这些术语不被翻译。

`MEMORY_EXTRACTION` 模板也要求：中文 source summary 的 briefIndex/content 用中文书写，同时保留 telecom code、protocol name、KPI id、alarm id、标准缩写原样。

## 中英文模板管理

模板选择支持 `match.locale`。同一 purpose 可维护多语言变体：

```
prompts/
├── SYSTEM_PROMPT/            # path-derived id 等于 well-known purpose，purpose 可推断
│   ├── template.yaml         # match: { locale: zh-CN }
│   ├── identity.md
│   └── ...
└── SYSTEM_PROMPT-en/         # 自定义 template id，必须声明 purpose
    ├── template.yaml         # purpose: SYSTEM_PROMPT  match: { locale: en-US }
    └── ...
```

> 注意：path-derived template id 恰好等于 framework well-known purpose 常量时（如 `SYSTEM_PROMPT`），`purpose` 可省略并推断；自定义 template id（如 `SYSTEM_PROMPT-en`）**必须**显式声明 `purpose`，否则编译器 reject。

`flowVariables`（string key/value map）可用于业务维度匹配，如 `match.flowVariables.networkDomain: mobile-core`。`flowVariables` match 仅当内部 assembly request 的 `flowVariables` 含相同 key + 相同 string value 时成立；缺失 key 或不等值均不匹配。`flowVariables` 不是渲染变量，也不接受 caller-supplied 第二个 match map。

## 提示模板配置（agent package prompts/ 约定）

Agent package 在 `prompts/` 下放置模板：

- 每个 template 是 `prompts/{templateId}/template.yaml`（+ 段落 `.md`）或单个 `prompts/{templateId}.yaml` 文件。
- `.md` / `.txt` 文件**不能**作为完整 prompt template 被直接绑定——必须有 manifest。
- template id 由 manifest 路径派生。
- `prompts/` 下有效 manifest 在 assembly 成功后自动对该 Agent 可用——**开发者不需要在 `agent.yaml` 维护 prompt template id allowlist**。

`AgentAssembly` 已删除 `promptTemplateIds`，`AgentRuntimeSettings` 已删除 `defaultPromptTemplateId`。这些字段不存在、不保留、不作为兼容别名暴露。prompt 选择使用 context-engine 注册的 template facts，而非 AgentAssembly prompt 字段。

## 模板编写最佳实践

1. **段落单一职责**。每个 `.md` 专注一个主题，便于跨 Agent 组合与缓存。
2. **stable 内容写 `.md`，dynamic 内容用 `inline` 变量**。避免把日期/环境/会话信息硬编码进 `.md`。
3. **不引入未注册变量**。未知变量编译期 fail closed；必需变量解析失败必须 fallback 或显式失败。
4. **不声明 identity 字段**。`templateId`/`templateRef` 由系统派生，用户声明会被 reject。
5. **SYSTEM_PROMPT 用 array content**。section id 必须是 builder-owned system section id；最终顺序由 system render policy 决定，不按 manifest 顺序。
6. **不把工具机制写进 memory.md**。工具参数/字段/调用机制由工具描述承载，memory 段只承载策略层。
7. **不暴露敏感信息**。模板不含 host 路径、credential、provider 私有 source 事实、raw execution-governance 指令。prompt text 不进日志/audit/metric/safe error。
8. **多语言用 `match.locale`**。同一 purpose 维护多语言变体，按 locale 选择。

## 相关资源

- 规格：`openspec/specs/prompt-template-assembly/spec.md`
- 设计：`openspec/designs/architecture/prompt-template-assembly.md`
- 双语输出规格：`openspec/specs/telecom-bilingual-output/spec.md`
- 内置模板：`packages/agent-context-engine/prompt-templates/builtin/`
- 自定义 Agent prompt 示例：`packages/agent-core/src/builtin-agents/network-explorer/prompts/SYSTEM_PROMPT/`
- [Skill 与 Tool 开发](./04-skill-tool-development.md)
- [能力扩展](./05-capability-extension.md)
