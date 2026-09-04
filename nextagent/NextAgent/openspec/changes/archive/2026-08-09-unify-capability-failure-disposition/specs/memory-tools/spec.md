# memory-tools Delta Specification

所属 Function：`FN-8.2 检索和写入记忆`

Function 变更类型：修改

spec 角色：主规格

## MODIFIED Requirements

### Requirement: search_memory L1 retrieval

`search_memory` SHALL 提供模型驱动的 L1 长期记忆搜索。它 MUST 返回当前 owner scope 下的 `ACTIVE` 记忆条目列表，并按 memory core 的 `hybridScore` 降序排列。该工具不得返回完整结构化 content。它同时承载原 `get_user_context` 的用户特征检索能力：当 `categoryFilter="USER_CHARACTERISTICS"` 且提供 `purpose` 时，工具 MUST 按 `purpose` 过滤用户特征并返回 L1 trait projection；未提供 `purpose` 时 MUST 不执行 purpose filter。

**Default tool description**：除非 Agent definition 通过 `capabilityBindings[].description` 提供可信覆盖，内置 `CapabilityDescriptor.description` MUST 使用以下默认文案：

> Search current user's ACTIVE long-term memory before answering questions about facts, configurations, procedures, preferences, or saved knowledge from past sessions. If the memory category is uncertain, make exactly one broad search without categoryFilter. Do not fan out by calling this once per category. Use categoryFilter only when the user request clearly names a fact, concept, procedure, or user trait, or after one broad search is too noisy. Returns L1 summaries only. Call get_memory_detail for promising entries needing full content. purpose only applies when categoryFilter=USER_CHARACTERISTICS; it is ignored for other categories.

**Tool description semantic guidance**：默认英文文案是完整的内置模型可见描述；以下条目是描述必须覆盖的语义约束，不要求逐字拼接到默认 description 中。若 Agent definition 通过 `capabilityBindings[].description` 覆盖描述，覆盖后的模型可见描述 MUST 仍覆盖这些语义——

- "ALWAYS call this before answering questions about facts, configurations, procedures, preferences, or any topic where you may have saved knowledge from past sessions."
- "If the memory category is uncertain, make exactly one broad search without categoryFilter; do not fan out by calling this once per category."
- "After reviewing results, call get_memory_detail for promising entries that need full content before acting."
- "For user preferences, skill level, communication style, or workflow adaptation, call this with categoryFilter=USER_CHARACTERISTICS and the relevant purpose."

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
- 完整结果 MUST 使用统一 Capability 结果序列化、公共容量检查和大结果转储路径，MUST NOT 使用 memory Tool 专用 inline 上限或失败 payload。

**核心判断逻辑**：

1. 校验分页、分类、purpose 和 confidence 参数；当 `categoryFilter!="USER_CHARACTERISTICS"` 时丢弃 `purpose`。
2. 使用可信 `tenantId` / `subjectId` / `agentId` 构造 `SearchLongTermMemoryQuery`。
3. 通过 app-composed `LongTermMemoryToolPort` 执行 search 语义。
4. 将结果投影为 L1 disclosure；`USER_CHARACTERISTICS` + `purpose` 路径按 purpose 过滤 trait。
5. 把完整安全结果交给公共结果容量机制；超过 inline 阈值但未超过公共单结果容量时转储并允许完整回读，超过公共单结果容量时返回 `CAPABILITY_RESULT_LIMIT_EXCEEDED + VALIDATION + retryable=false`。

**需求类别**：功能性需求

#### Scenario: 正常 L1 搜索

- **WHEN** 模型调用 `search_memory(queryText="BGP", categoryFilter="PROCEDURAL", limit=5)`
- **THEN** 工具 MUST 返回最多 5 条当前 owner scope 下的 `PROCEDURAL` 记忆 L1 条目
- **AND** 条目 MUST 按 `hybridScore` 降序排列
- **AND** 条目 MUST NOT 包含完整结构化 content

#### Scenario: 空查询列出 ACTIVE 候选

- **WHEN** 模型调用 `search_memory(categoryFilter="USER_CHARACTERISTICS", queryText omitted)`
- **THEN** 工具 MUST 返回当前 owner scope 下匹配分类和 confidence 阈值的 ACTIVE L1 条目
- **AND** 不得因为 `queryText` 为空而失败

#### Scenario: 按 purpose 检索用户特征

- **WHEN** 模型调用 `search_memory(categoryFilter="USER_CHARACTERISTICS", purpose="WORKFLOW_ADAPTATION")`
- **THEN** 工具 MUST 返回当前用户与工作流适配相关的 `USER_CHARACTERISTICS` L1 traits
- **AND** 日志、metric、audit 或 diagnostic 若记录该检索，只能包含 purpose 和 trait names/ref，不包含 trait values
- **AND** 结果 MUST NOT 被写入 system prompt

#### Scenario: 非法搜索参数一次返回完整违规

- **WHEN** 模型同时提交非法 `minConfidence` 和非法 `limit`
- **THEN** capability input validation MUST 返回包含两项 violations 的 `CAPABILITY_INPUT_INVALID + VALIDATION + retryable=false`
- **AND** memory retriever invocation count MUST 为 `0`

#### Scenario: 非用户特征搜索忽略 purpose

- **WHEN** 模型调用 `search_memory(categoryFilter="PROCEDURAL", purpose="PERSONALIZATION")`
- **THEN** 工具 MUST call memory retriever with `categoryFilter="PROCEDURAL"` and without `purpose`
- **AND** 工具 MUST NOT fail solely because `purpose` was provided for a non-user-characteristics category

#### Scenario: 大型搜索结果使用公共转储

- **WHEN** 完整搜索结果超过公共 inline 阈值但未超过公共单结果容量
- **THEN** 系统 MUST 保持成功结果并通过受治理结果引用允许完整回读
- **AND** 系统 MUST NOT 返回 `MEMORY_TOOL_RESULT_TOO_LARGE` 或静默截断 entries

#### Scenario: 搜索结果超过公共单结果容量

- **WHEN** 完整搜索结果超过公共单结果容量
- **THEN** 系统 MUST 返回 `CAPABILITY_RESULT_LIMIT_EXCEEDED + VALIDATION + retryable=false`
- **AND** `safeError.message` MUST 提示降低 `limit` 或收窄查询
- **AND** `safeError.safeDetails.violations` MUST 缺失
- **AND** 系统 MUST NOT 静默截断结果

### Requirement: Memory tools failure and degradation

系统 SHALL 为 memory tools 定义统一失败和降级语义。Memory disabled、存储不可用、timeout、cancellation、公共容量不足、输入无效和依赖缺失 MUST 返回明确 outer `safeError`，不得通过顶层 `structuredPayload.error`、顶层 `structuredPayload.diagnostics`、静默丢弃、静默截断或吞掉错误建立平行失败面。`get_memory_detail` 的 per-entry `error` 是批量业务结果的一部分，不是 outer invocation failure。

失败规则固定为：

1. memory disabled before exposure：memory tools MUST NOT be exposed to model tool discovery, effective capability catalog results, or executable invocation paths。
2. stale/precomputed binding 在 memory disabled 后被调用：`search_memory`、`get_memory_detail`、`add_memory` MUST 返回 `LTM_DISABLED + UNAVAILABLE + retryable=false`；message MUST 允许模型不依赖长期记忆继续当前任务。
3. memory store/retriever 明确不可用：MUST 返回 `LTM_STORAGE_UNAVAILABLE + UNAVAILABLE + retryable=true`；message MUST 要求改用当前上下文、稍后尝试或结束，不得使用泛化 memory failure 文本。
4. capability timeout 且执行事实 owner 确认没有未知写副作用：MUST 返回 `MEMORY_TOOL_TIMEOUT + TIMEOUT + retryable=true`。只读 memory Tool 可以通过统一执行边界按 replay policy 自动 retry；`add_memory` 不得自动 retry。
5. runtime cancellation：MUST 返回 `FAILED + MEMORY_TOOL_CANCELED + CANCELED + retryable=false` 并停止下游 memory operation。
6. 结果超过公共单结果容量：MUST 返回 `CAPABILITY_RESULT_LIMIT_EXCEEDED`，不得截断；低于该容量的完整结果必须使用公共大结果转储。
7. observability/audit projection failure：已经成功产生的 memory side effect 不得被报告为未发生；投影失败 MUST 进入现有 observability failure channel，并通过结构化日志或指标暴露，不得扩展工具业务结果状态机。

**需求类别**：功能性需求

#### Scenario: Disabled memory 不暴露

- **WHEN** `MemoryConfig.status = DISABLED` before capability exposure
- **THEN** `search_memory` MUST NOT appear in model tool discovery
- **AND** `search_memory` MUST NOT appear in effective capability catalog results or executable invocation paths

#### Scenario: Disabled 后的 stale binding 返回可理解错误

- **GIVEN** stale or precomputed binding 仍尝试调用 `search_memory`
- **WHEN** memory 在 exposure 后被 disabled
- **THEN** Tool MUST 返回 `LTM_DISABLED + UNAVAILABLE + retryable=false`
- **AND** `safeError.message` MUST 允许模型不依赖长期记忆继续当前任务
- **AND** Tool MUST NOT 返回空列表伪装成功

#### Scenario: Storage unavailable 保留安全错误

- **WHEN** memory store 明确不可用
- **THEN** Tool MUST 返回 `LTM_STORAGE_UNAVAILABLE + UNAVAILABLE + retryable=true`
- **AND** `safeError.message` MUST 给出改用当前上下文、稍后尝试或结束中的至少一个动作

#### Scenario: 只读 Tool timeout 可以在统一边界重试

- **WHEN** `search_memory` 或 `get_memory_detail` 超过 capability timeout
- **AND** `safeError` 是 `MEMORY_TOOL_TIMEOUT + TIMEOUT + retryable=true`
- **THEN** 统一执行边界 MUST 按 `IDEMPOTENT` 门禁和当前 invocation 的 effective `maxRetries` 重试；字段缺失时默认最多重试一次
- **AND** 下游 memory operation MUST 接收 cancellation signal

#### Scenario: add_memory timeout 不自动重放

- **WHEN** `add_memory` 返回 `MEMORY_TOOL_TIMEOUT + TIMEOUT + retryable=true`
- **AND** owner 已确认没有未知写副作用
- **THEN** 统一执行边界 MUST NOT 自动重试该 `NON_IDEMPOTENT` 调用

#### Scenario: Observability projection failure after memory side effect

- **WHEN** `add_memory` 已经成功创建当前 owner 的 ACTIVE memory record
- **AND** capability/gateway/observability owning path 的后置日志、metric 或 audit 投影失败
- **THEN** capability result MUST 仍表达该 memory outcome
- **AND** structured log 或 metric MUST 记录 observability projection failure
- **AND** capability result MUST NOT 输出 audit id、audit linkage 或 audit 子状态字段

## Function 变更汇总

### 输出

- 变更类型：修改
- 目标内容：memory Tool 使用 outer `safeError` 和公共大结果转储；成功、合法空结果、失败、timeout 和取消具有确定结构。
- 依据 Requirements：`search_memory L1 retrieval`、`Memory tools failure and degradation`

### 处理过程

- 变更类型：修改
- 目标内容：只读 memory Tool 可以在统一边界安全重试一次；`add_memory` 保持 `NON_IDEMPOTENT` 且不自动重放。
- 依据 Requirements：`Memory tools failure and degradation`

### 结果

- 变更类型：修改
- 目标内容：模型获得完整、可操作的 memory 错误或受治理的大结果引用，不再看到泛化 outer message、平行 diagnostics 或 memory 专用结果上限。
- 依据 Requirements：`search_memory L1 retrieval`、`Memory tools failure and degradation`
