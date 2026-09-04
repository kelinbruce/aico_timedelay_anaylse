## Function

- **所属 Function**：`FN-8.2 检索和写入记忆`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: add_memory structured write

`add_memory` SHALL 允许模型在请求执行期根据用户明确记忆指令新增当前用户的长期记忆。新增条目 MUST 使用 `add-ts-memory-core` 定义的结构化 content 和 category，初始 state MUST 为 `ACTIVE`。`add_memory` 是低时延 fast path；它 MUST NOT 执行相似检索、语义等价判断、冲突检测、candidate/evidence 写入、sourceTrace fusion 或 confidence corroboration。

`add_memory` 的模型可见触发条件清单 SHALL 恰好包含以下两类，且由 `SYSTEM_PROMPT/memory.md` 策略段唯一承载：

1. **显式记忆指令**：当前用户明确要求系统记住某条信息，典型措辞包括"记住""请记住""帮我存储""记住以上内容""记住以下内容""以后""未来""默认""不要""以后不要""默认不要"以及任意语言的等价表述。该类别覆盖所有用户显式声明的偏好、约束、定义或工作惯例，无论其是否绑定单一请求。
2. **澄清后的确认信息**：模型因歧义主动向用户提出澄清问题后，用户就可复用的定义、阈值、缩写、范围规则或其他稳定信息给出明确答案，且该答案对未来会话有用。

除上述两类外，`add_memory` MUST NOT 被其他类别触发。具体而言，以下情形 MUST NOT 作为独立触发类别：用户纠正历史信息（除非纠正是通过显式记忆指令表达）、模型推断的用户偏好、Agent 任务执行错误、Tool call 失败及解决方法。任务失败中的可复用经验只能由用户显式要求记住时才写入，或由 future 显式授权的 dreaming/extraction 边界处理。

**skip list 横切适用**：`memory.md` 承载的"不记什么"清单 SHALL 适用于全部触发类别，模型 MUST NOT 因触发类别不同而绕过 skip list。skip list 至少 MUST 覆盖：临时会话上下文或一次性调试状态、可从公开文档或检索获得的知识、大体量原始代码/日志/表格内容、推断或未经验证的观察、可能与既有记忆重复或冲突的内容。

**Turn 内核验义务**：当模型在某一 turn 中向用户确认"已记住""记下了"或等价表述时，该 turn 内 MUST 存在至少一次实际 `add_memory` 工具调用。无 `add_memory` 调用的口头确认 SHALL NOT 持久化任何内容；信息 SHALL 在该 turn 结束时丢失。`memory.md` MUST 明确声明这一约束，使模型在 turn 结束前核验承诺记住的内容是否已产生 `add_memory` 调用，未产生则补发调用。

**Default tool description**：除非 Agent definition 通过 `capabilityBindings[].description` 提供可信覆盖，内置 `CapabilityDescriptor.description` MUST 使用以下默认文案：

> Add a new ACTIVE long-term memory. See the memory strategy section for when to save.
>
> Content format by category:
> - FACTUAL → subject (string) + claim (string) + optional evidence (string[]) + optional qualifiers (string[])
> - CONCEPTUAL → concept (string) + definition (string) + optional aliases (string[]) + optional relatedConcepts (string[])
> - PROCEDURAL → procedureName (string) + procedureText (string)
> - USER_CHARACTERISTICS → traits (string[]) + purpose (string[])

**Tool description semantic guidance**：默认英文文案是完整的内置模型可见描述；以下条目是描述必须覆盖的语义约束，不要求逐字拼接到默认 description 中。若 Agent definition 通过 `capabilityBindings[].description` 覆盖描述，覆盖后的模型可见描述 MUST 仍覆盖这些语义——
- "存记忆的时机与记什么由 memory 策略段承载；工具描述只引用该段并给出按 category 的内容字段格式。"
- "Content format by category: FACTUAL → subject + claim + optional evidence + optional qualifiers; CONCEPTUAL → concept + definition + optional aliases + optional relatedConcepts; PROCEDURAL → procedureName + procedureText; USER_CHARACTERISTICS → traits + purpose."
- "Do not use for temporary session context, public/general knowledge, large raw code/log/table content, inferred observations, or possible duplicates/conflicts — see the memory strategy section for the full skip list."

**触发机制**：仅当当前用户明确要求系统记住（显式记忆指令）或模型澄清后用户提供可复用确认信息时，模型才可在执行期显式调用 `add_memory`；同步等待写入结果；不是普通对话观察、自动提取周期或后台学习 job。完整存记忆触发条件清单由 `SYSTEM_PROMPT/memory.md` 策略段承载，工具描述仅引用该段。

**输入与前置条件**：
- 输入字段：`category`、`content`、`tags?`、`briefIndex?`、`confidence?`。
- `category` MUST 是 `FACTUAL`、`CONCEPTUAL`、`PROCEDURAL`、`USER_CHARACTERISTICS` 之一。
- `category` 只描述知识类型，不决定是否立即生效；立即写入 ACTIVE 的条件是当前满足上述两类触发之一。完整触发条件清单由 `memory.md` 承载。
- `content` MUST 在写入 gateway 前被规范化为 `add-ts-memory-core` 定义的 category-specific structured content contract: `FACTUAL(subject, claim, evidence?, qualifiers?)`, `CONCEPTUAL(concept, definition, aliases?, relatedConcepts?)`, `PROCEDURAL(procedureName, procedureText)`, or `USER_CHARACTERISTICS(non-empty traits, non-empty purpose[])`。工具层输入 MAY 省略嵌套 `content.category`，由顶层 `category` 注入；如果同时提供嵌套 category，MUST 与顶层 category 一致。受控兼容例外是：`category="USER_CHARACTERISTICS"` 时，`content` MAY be a non-empty string and MUST normalize to `{ category: "USER_CHARACTERISTICS", traits: [content], purpose: ["GENERAL"] }`；`category="FACTUAL"` 时，`content` MAY be a non-empty string or a structured object using `fact`、`text` or `value` as claim aliases；`category="PROCEDURAL"` 时，`content` MAY be a structured object, a JSON-string object, or a non-empty procedural text string。所有 convenience 输入在 gateway write 前都 MUST 变成规范化 core content，且不得持久化 alias 或额外模型字段。
- `briefIndex` 如果提供，长度 MUST 不超过 100 字符；超出时工具 MUST 机械截断并在结果诊断中标记 `briefIndexTruncated=true`。
- `briefIndex` 如果省略，工具 MUST 从结构化 content 的安全摘要机械生成，不得调用模型生成。
- `confidence` 省略时 MUST 使用 0.5，且取值 MUST 在 [0, 1]。

**输出与副作用**：
- 成功结果 MUST 包含 `longTermMemoryId`、`state`、`briefIndexTruncated`、`createdAt`、`outcome`、`nextAction`。
- `outcome` MUST be `"CREATED_ACTIVE"` when a new ACTIVE memory record is created. The first version of `add_memory` MUST NOT return `DUPLICATE_EXISTING` or `STAGED_FOR_RECONCILIATION`; duplicate/candidate/conflict handling belongs to dreaming / extraction or future owning changes.
- `nextAction` MUST be `"ACKNOWLEDGE_USER_DO_NOT_CALL_ADD_MEMORY_AGAIN"`, instructing the next model turn to stop calling `add_memory` for the same user request and provide a short acknowledgement to the user.
- 写入前 MUST NOT 在请求期执行相似搜索或冲突检测；重复创建防护仅可使用 memory core `saveLongTermMemory(request, IdempotentWriteOptions)` 的 request/invocation-level idempotency metadata，不得通过扫描当前 owner memory corpus 实现。
- 写入成功 MUST 产生 memory record，并通过 capability invocation / gateway / observability owning path 保留安全可观察事实；如后续或既有观测路径投影 domain-specific memory write audit/metric，其属性不得包含 raw content，且 memory tool adapter 不得直接依赖独立 audit/diagnostic sink。

**核心判断逻辑**：
1. 校验 category、content、confidence、tags、briefIndex，并将 tool-level convenience content 规范化为 core memory content。
2. 生成或截断 briefIndex。
3. 验证当前工具调用来自上述两类触发之一的模型判断；模型观察/推断型知识、任务异常经验或未经用户显式指令的纠正不得通过 `add_memory` 写入。完整触发条件清单由 `memory.md` 承载，工具层只做"是否来自合规触发类别"的最终校验。
4. 绑定可信 `tenantId` / `subjectId` / `agentId`，生成当前请求可追溯的 source refs。
5. 通过 `store.saveLongTermMemory` 写入，构造 `SaveLongTermMemoryRequest` 和 request/invocation-level idempotency write options。
6. 返回 capability result，并确保任何日志、metric、audit 或 diagnostic 不含 raw content。

**需求类别**：功能性需求

#### Scenario: Tool-level convenience content is normalized before gateway write
- **WHEN** the model invokes `add_memory` with `category="USER_CHARACTERISTICS"` and non-empty string `content`
- **THEN** the `add_memory` input schema MUST accept the string through an explicit `content: string | structuredContent` union
- **AND** `add_memory.execute()` MUST convert it to `{ category: "USER_CHARACTERISTICS", traits: [content], purpose: ["GENERAL"] }` before constructing `SaveLongTermMemoryRequest`
- **WHEN** the model invokes `add_memory` with `category="FACTUAL"` and a non-empty string `content`
- **THEN** `add_memory.execute()` MUST convert it to `{ category: "FACTUAL", subject: content, claim: content }` before constructing `SaveLongTermMemoryRequest`
- **WHEN** the model invokes `add_memory(category="PROCEDURAL", briefIndex="切换失败排查流程", content="先确认链路质量，再核对邻区配置，最后复测切换成功率。")`
- **THEN** `add_memory.execute()` MUST convert it to `{ category: "PROCEDURAL", procedureName: "切换失败排查流程", procedureText: "先确认链路质量，再核对邻区配置，最后复测切换成功率。" }` before constructing `SaveLongTermMemoryRequest`
- **WHEN** the model invokes `add_memory(category="PROCEDURAL", content="{\"procedureName\":\"切换失败排查流程\",\"procedureText\":\"先确认链路质量。\"}")`
- **THEN** `add_memory.execute()` MUST safely parse the JSON object and normalize it to procedural text content before constructing `SaveLongTermMemoryRequest`
- **AND** this exception MUST NOT apply to `CONCEPTUAL` string content
- **AND** `BuiltinToolsExecutor` MUST NOT implement this conversion
- **AND** diagnostics, logs and audit events MUST NOT include the raw string content

#### Scenario: Normal add memory
- **WHEN** 当前用户明确要求系统记住一个事实
- **AND** 模型调用 `add_memory(category="FACTUAL", content=<valid factual content>, tags=["network"], confidence=0.6)`
- **THEN** 工具 MUST 创建 state 为 `ACTIVE` 的当前 owner memory record
- **AND** 返回新 `longTermMemoryId`
- **AND** result `outcome` MUST be `"CREATED_ACTIVE"`
- **AND** capability invocation / gateway / observability facts MUST be safe and MUST NOT include raw memory content

#### Scenario: Add memory does not run duplicate or conflict detection
- **WHEN** 模型调用 `add_memory` 且输入结构有效
- **THEN** 工具 MUST NOT call `searchLongTermMemory`, `listLongTermMemory`, `getLongTermMemory`, similarity scoring, semantic equivalence classification, or conflict detection before writing
- **AND** 工具 MUST NOT write candidate/evidence records or return `STAGED_FOR_RECONCILIATION`
- **AND** 工具 MUST NOT adjust confidence on any existing memory record
- **AND** any later duplicate/conflict/fusion handling MUST be performed by dreaming / extraction or another owning non-model boundary

#### Scenario: Add memory invalid structured content
- **WHEN** 模型调用 `add_memory` 且 `content` 不符合 category 结构
- **THEN** 工具 MUST 返回 `SafeError { code: "MEMORY_TOOL_WRITE_INVALID", category: VALIDATION, retryable: false }`
- **AND** 不得写入 memory record

#### Scenario: Explicit memory instruction triggers write
- **WHEN** 用户使用"记住""请记住""以后""默认""不要"或任意语言的等价显式记忆措辞
- **AND** 模型调用 `add_memory` 并提供合规 category 与 content
- **THEN** 工具 MUST 执行写入并返回 `CREATED_ACTIVE`
- **AND** `memory.md` 策略段 MUST 把该类别作为触发条件清单的第一类承载

#### Scenario: Clarification confirmation triggers write
- **WHEN** 模型主动就歧义提出澄清问题
- **AND** 用户就可复用的定义、阈值、缩写、范围规则或其他稳定信息给出明确答案
- **AND** 模型调用 `add_memory`
- **THEN** 工具 MUST 执行写入并返回 `CREATED_ACTIVE`
- **AND** `memory.md` 策略段 MUST 把该类别作为触发条件清单的第二类承载

#### Scenario: Task failure does not independently trigger write
- **WHEN** Agent 任务执行错误或 Tool call 失败
- **AND** 用户未发出显式记忆指令
- **THEN** 模型 MUST NOT 调用 `add_memory` 记录该失败经验
- **AND** `memory.md` 策略段 MUST NOT 把任务异常作为独立触发类别

#### Scenario: Verbal acknowledgment without tool call persists nothing
- **WHEN** 模型在某一 turn 中向用户确认"已记住""记下了"或等价表述
- **AND** 该 turn 内不存在任何 `add_memory` 工具调用
- **THEN** 该确认 SHALL NOT 持久化任何内容
- **AND** 信息 SHALL 在该 turn 结束时丢失
- **AND** `memory.md` 策略段 MUST 明确声明该约束

#### Scenario: Skip list applies across all trigger categories
- **WHEN** 模型判断某一信息满足显式记忆指令或澄清后确认任一触发类别
- **AND** 该信息属于临时会话上下文、公开可检索知识、大体量原始代码/日志/表格、推断或未经验证观察、或可能与既有记忆重复或冲突的内容
- **THEN** 模型 MUST NOT 调用 `add_memory`
- **AND** `memory.md` 策略段 MUST 明确 skip list 适用于全部触发类别

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：`add_memory` 的模型可见触发条件从 5 类收敛为 2 类（显式记忆指令、澄清后的确认信息），skip list 成为横切适用约束，新增 turn 内核验义务和"口头确认不持久化"约束。工具 schema、写入语义、scope 安全和失败行为不变。
- **依据 Requirements**：`add_memory structured write`

### 规格

- **规格项**：`add_memory` 触发条件类别
- **变更类型**：修改
- **原规格值**：5 类（显式指令、纠正历史信息、澄清后确认、稳定偏好/约束、任务异常触发）
- **目标规格值**：恰好 2 类：显式记忆指令、澄清后的确认信息
- **依据 Requirements**：`add_memory structured write`

- **规格项**：skip list 适用范围
- **变更类型**：修改
- **原规格值**：与触发条件并列，适用范围未明确
- **目标规格值**：横切适用于全部触发类别
- **依据 Requirements**：`add_memory structured write`

- **规格项**：turn 内核验义务
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：口头确认"已记住"的 turn 内必须存在 `add_memory` 调用，否则不持久化
- **依据 Requirements**：`add_memory structured write`
