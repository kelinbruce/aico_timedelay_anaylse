## Function
- **所属 Function**：`FN-8.2 检索和写入记忆`
- **Function 变更类型**：MODIFIED
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: search_memory L1 retrieval

`search_memory` SHALL 提供模型驱动的 L1 长期记忆搜索。它 MUST 返回当前 owner scope 下的 `ACTIVE` 记忆条目列表，并按 memory core 的 `hybridScore` 降序排列。该工具不得返回完整结构化 content。它同时承载原 `get_user_context` 的用户特征检索能力：当 `categoryFilter="USER_CHARACTERISTICS"` 时，工具 MAY 按 `purpose` 过滤用户特征并返回 L1 trait projection。

**Default tool description**：除非 Agent definition 通过 `capabilityBindings[].description` 提供可信覆盖，内置 `CapabilityDescriptor.description` MUST 使用以下默认文案：

> Search the current user's ACTIVE long-term memory. See the memory strategy section for when to recall. Returns L1 summaries only; call get_memory_detail for full content.
>
> Parameter guidance:
> - If the memory category is uncertain, make exactly one broad search without categoryFilter. Do not fan out by calling this once per category.
> - Use categoryFilter only when the user request clearly names a fact, concept, procedure, or user trait, or after one broad search is too noisy.
> - Do NOT use categoryFilter when the query spans multiple categories or the user's intent is exploratory.
> - categoryFilter=USER_CHARACTERISTICS requires a purpose field to filter effectively; omitting purpose returns all user traits.

**Tool description semantic guidance**：默认英文文案是完整的内置模型可见描述；以下条目是描述必须覆盖的语义约束，不要求逐字拼接到默认 description 中。若 Agent definition 通过 `capabilityBindings[].description` 覆盖描述，覆盖后的模型可见描述 MUST 仍覆盖这些语义——
- "检索前先参考 memory 策略段确定何时召回。"
- "If the memory category is uncertain, make exactly one broad search without categoryFilter; do not fan out by calling this once per category."
- "Returns L1 summaries only; call get_memory_detail for full content before acting on promising entries."
- "Use categoryFilter only when the user request clearly names a fact, concept, procedure, or user trait, or after one broad search is too noisy."
- "Do NOT use categoryFilter when the query spans multiple categories or the user's intent is exploratory."
- "categoryFilter=USER_CHARACTERISTICS requires a purpose field to filter effectively; omitting purpose returns all user traits."

**触发机制**：模型在请求执行期需要跨会话知识候选时显式调用；同步等待搜索结果；不由 context assembly 自动调用。

**输入与前置条件**：
- 输入字段：`queryText?`、`categoryFilter?`、`purpose?`、`minConfidence?`、`limit?`、`offset?`。
- `minConfidence` 省略时 MUST 使用 0.3。
- `limit` 省略时 MUST 使用 20；最大值 MUST 为 100。
- `offset` 省略时 MUST 使用 0。
- `categoryFilter` 如果提供，MUST 是 `FACTUAL`、`CONCEPTUAL`、`PROCEDURAL`、`USER_CHARACTERISTICS` 之一。
- `purpose` 如果提供，MUST 是 `PERSONALIZATION`、`TROUBLESHOOTING`、`WORKFLOW_ADAPTATION`、`GENERAL` 之一。只有 `categoryFilter="USER_CHARACTERISTICS"` 时，`purpose` 才参与用户特征过滤；其他 category 传入 `purpose` MUST 被工具忽略，且 MUST NOT 转发给 memory retriever。

**输出与副作用**：
- 成功结果 MUST 包含 `entries[]`、`totalCount`、`limit`、`offset`。
- 每个 entry MUST 只包含 L1 字段：`longTermMemoryId`、`category`、`confidence`、`tags`、`briefIndex`、`createdAt`、`hybridScore`。
- 当 `categoryFilter="USER_CHARACTERISTICS"` 且提供 `purpose` 时，每个 entry MUST 是 purpose-scoped L1 trait projection，至少包含 `longTermMemoryId`、`traitName`、`confidence`、`briefIndex`、`lastUpdatedAt`；不得包含未按 purpose 允许披露的敏感 trait value。
- 搜索成功返回的条目访问计数副作用由 memory core 负责；工具不得自行写入访问计数。
- 用户特征检索 MUST be covered by a safe capability/gateway/observability fact；若存在日志、metric、audit 或 diagnostic 投影，只能记录 purpose 和 retrievedTraitNames/ref，不记录 trait value。

**核心判断逻辑**：
1. 校验分页、分类、purpose 和 confidence 参数；当 `categoryFilter!="USER_CHARACTERISTICS"` 时丢弃 `purpose`。
2. 使用可信 `tenantId` / `subjectId` / `agentId` 构造 `SearchLongTermMemoryQuery`。
3. 通过 app-composed `LongTermMemoryToolPort` 执行 search 语义。
4. 将结果投影为 L1 disclosure；`USER_CHARACTERISTICS` + `purpose` 路径按 purpose 过滤 trait。
5. 如果结果 payload 超过 capability result 大小预算，返回 `MEMORY_TOOL_RESULT_TOO_LARGE`，不得静默截断。

**需求类别**：功能性需求

#### Scenario: Normal L1 search
- **WHEN** 模型调用 `search_memory(queryText="BGP", categoryFilter="PROCEDURAL", limit=5)`
- **THEN** 工具 MUST 返回最多 5 条当前 owner scope 下的 `PROCEDURAL` 记忆 L1 条目
- **AND** 条目 MUST 按 `hybridScore` 降序排列
- **AND** 条目 MUST NOT 包含完整结构化 content

#### Scenario: Empty query lists active candidates
- **WHEN** 模型调用 `search_memory(categoryFilter="USER_CHARACTERISTICS", queryText omitted)`
- **THEN** 工具 MUST 返回当前 owner scope 下匹配分类和 confidence 阈值的 ACTIVE L1 条目
- **AND** 不得因为 `queryText` 为空而失败

#### Scenario: Purpose-scoped user characteristics search
- **WHEN** 模型调用 `search_memory(categoryFilter="USER_CHARACTERISTICS", purpose="WORKFLOW_ADAPTATION")`
- **THEN** 工具 MUST 返回当前用户与工作流适配相关的 `USER_CHARACTERISTICS` L1 traits
- **AND** 日志、metric、audit 或 diagnostic 若记录该检索，只能包含 purpose 和 trait names/ref，不包含 trait values
- **AND** 结果 MUST NOT 被写入 system prompt

#### Scenario: Invalid search parameters
- **WHEN** 模型调用 `search_memory(minConfidence=1.2)` 或 `search_memory(limit=101)`
- **THEN** 现有 capability executor JSON Schema validation MUST return `SafeError { code: "CAPABILITY_INPUT_INVALID", category: VALIDATION, retryable: false }`
- **AND** 不得调用 memory retriever

#### Scenario: Purpose is ignored for non-user-characteristics search
- **WHEN** 模型调用 `search_memory(categoryFilter="PROCEDURAL", purpose="PERSONALIZATION")`
- **THEN** 工具 MUST call memory retriever with `categoryFilter="PROCEDURAL"` and without `purpose`
- **AND** 工具 MUST NOT fail solely because `purpose` was provided for a non-user-characteristics category

#### Scenario: Search result too large
- **WHEN** 搜索结果投影超过 capability result 大小预算
- **THEN** 工具 MUST 返回 `SafeError { code: "MEMORY_TOOL_RESULT_TOO_LARGE", category: VALIDATION, retryable: false }`
- **AND** SafeError MUST 提示降低 `limit` 或收窄查询
- **AND** 不得静默截断结果

### Requirement: get_memory_detail L2 retrieval

`get_memory_detail` SHALL 按 `longTermMemoryIds[]` 批量获取当前 owner scope 下的 L2 长期记忆详情，单次最多 20 条。不存在、不属于当前 owner 或不可披露时 MUST 在对应 result 中返回同一个 not-found SafeError，防止对象存在性泄露；单条失败不得中断其他条目。

**Default tool description**：除非 Agent definition 通过 `capabilityBindings[].description` 提供可信覆盖，内置 `CapabilityDescriptor.description` MUST 使用以下默认文案：

> Fetch full L2 details for long-term memory entries returned by search_memory. Pass up to 20 longTermMemoryIds. Returns per-entry results with full structured fields such as procedural text or conceptual definitions.

**Tool description semantic guidance**：默认英文文案是完整的内置模型可见描述；以下条目是描述必须覆盖的语义约束，不要求逐字拼接到默认 description 中。若 Agent definition 通过 `capabilityBindings[].description` 覆盖描述，覆盖后的模型可见描述 MUST 仍覆盖这些语义——
- "Call this after search_memory when entries' briefIndex suggests they have relevant details you need."
- "Pass up to 20 longTermMemoryIds when multiple search results need full content."
- "L2 content includes full structured fields (procedural text or conceptual definitions for PROCEDURAL/CONCEPTUAL; full subject/claim for FACTUAL; trait details for USER_CHARACTERISTICS)."

**触发机制**：模型基于 `search_memory` 返回的 L1 候选，判断需要完整结构化内容时显式调用；同步等待结果。

**输入与前置条件**：
- 输入字段：`longTermMemoryIds[]`。
- `longTermMemoryIds` MUST 非空，且数量 MUST 不超过 20。
- 每个 `longTermMemoryId` MUST 通过 owner-scoped lookup 验证可见性，并把 not found、not owned 和不可披露统一映射为 per-entry `LTM_ENTRY_NOT_FOUND`。
- 当前 capability invocation 仍有 L2 详情结果预算。

**输出与副作用**：
- 成功结果 MUST 包含 `{results: [{longTermMemoryId, entry?, error?}]}` 结构。
- L2 result 可被后续模型轮次消费；不得被直接写入 system prompt。
- 访问计数和 `lastAccessedAt` 副作用由 memory core 负责。

**核心判断逻辑**：
1. 校验 `longTermMemoryIds` 非空且不超过 20。
2. 对每个 longTermMemoryId 使用可信 scope 通过 `retriever.getLongTermMemoryDetail` 执行 getDetail 语义。
3. 如果单条返回 not found/not owned，映射为该 result 的 `LTM_ENTRY_NOT_FOUND`。
4. 如果结果超过大小预算，返回 `MEMORY_TOOL_RESULT_TOO_LARGE`，不得静默截断。

**需求类别**：功能性需求

#### Scenario: Normal detail retrieval
- **WHEN** 模型调用 `get_memory_detail(longTermMemoryIds=[E1])`
- **AND** `E1` 属于当前 scope
- **THEN** 工具 MUST 返回包含 `entry` 的 result
- **AND** 返回内容 MUST 包含各 category 对应的完整结构化字段

#### Scenario: Detail not found or not owned
- **WHEN** 模型调用 `get_memory_detail(longTermMemoryIds=[E1,E9])`
- **AND** `E9` 不存在或不属于当前 owner scope
- **THEN** 工具 MUST 为 `E9` 返回 per-entry `SafeError { code: "LTM_ENTRY_NOT_FOUND" }`
- **AND** 响应 MUST NOT 区分不存在和无权限

### Requirement: add_memory structured write

`add_memory` SHALL 允许模型在请求执行期根据用户明确记忆指令新增当前用户的长期记忆。新增条目 MUST 使用 `add-ts-memory-core` 定义的结构化 content 和 category，初始 state MUST 为 `ACTIVE`。`add_memory` 是低时延 fast path；它 MUST NOT 执行相似检索、语义等价判断、冲突检测、candidate/evidence 写入、sourceTrace fusion 或 confidence corroboration。

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

**触发机制**：仅当当前用户明确要求系统"记住"、"以后按这个来"、"默认采用这个偏好/流程"或等价立即生效的记忆指令时，模型才可在执行期显式调用；同步等待写入结果；不是普通对话观察、自动提取周期或后台学习 job。完整存记忆触发条件由 `SYSTEM_PROMPT/memory.md` 策略段承载，工具描述仅引用该段。

**输入与前置条件**：
- 输入字段：`category`、`content`、`tags?`、`briefIndex?`、`confidence?`。
- `category` MUST 是 `FACTUAL`、`CONCEPTUAL`、`PROCEDURAL`、`USER_CHARACTERISTICS` 之一。
- `category` 只描述知识类型，不决定是否立即生效；立即写入 ACTIVE 的唯一首版条件是当前用户明确要求系统记住或以后采用该知识。完整存记忆触发条件清单由 `memory.md` 承载。
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
3. 验证当前工具调用来自用户明确记忆指令的模型判断；模型观察/推断型知识不得通过 `add_memory` 写入。完整触发条件清单由 `memory.md` 承载，工具层只做"是否来自用户明确记忆指令"的最终校验。
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

## Function 变更汇总

### 输出
- **变更类型**：修改
- **目标内容**：`search_memory` 默认描述改为结构化"何时检索 + 参数引导"两段式，保留 L1 摘要与 `get_memory_detail` 下钻、`categoryFilter` 选择规则和 `purpose` 仅对 `USER_CHARACTERISTICS` 生效的语义；`get_memory_detail` 默认描述明确单次最多 20 个 `longTermMemoryIds` 和完整结构化字段；`add_memory` 默认描述改为"引用 memory 策略段 + 按 category 列出内容字段格式"，完整存记忆触发条件由 `memory.md` 承载。
- **依据 Requirements**：`search_memory L1 retrieval`、`get_memory_detail L2 retrieval`、`add_memory structured write`

### 处理过程
- **变更类型**：修改
- **目标内容**：`add_memory` 触发机制明确"完整存记忆触发条件清单由 `memory.md` 承载，工具层只做是否来自用户明确记忆指令的最终校验"；其余三个工具的处理逻辑、scope 安全、失败语义和 convenience 输入规范化保持不变。
- **依据 Requirements**：`add_memory structured write`

## 规格

| 规格项 | 目标值 |
|---|---|
| 内置 memory 工具默认描述 | 由 `memory-tools` spec 固化三段默认文案；Agent definition 可通过 `capabilityBindings[].description` 覆盖，覆盖后仍 MUST 覆盖 semantic guidance 列出的语义 |
| `add_memory` 存记忆策略归属 | 五类触发条件与不存清单由 `SYSTEM_PROMPT/memory.md` 承载；工具描述仅引用该段并给出按 category 内容字段格式 |
