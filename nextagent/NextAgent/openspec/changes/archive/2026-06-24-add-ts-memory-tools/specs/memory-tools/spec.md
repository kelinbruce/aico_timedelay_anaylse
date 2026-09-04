## ADDED Requirements

### Requirement: Memory tools delivery depends on memory core

`add-ts-memory-tools` SHALL be delivered only as a dependent capability on top of `add-ts-memory-core`. The system MUST NOT enable, release, or claim memory tools as independently deliverable when `add-ts-memory-core` is absent, disabled, invalid, or outside the target release scope. `add-ts-memory-tools` is delivered alongside `add-ts-memory-core` only after the target release scope includes a valid memory core public boundary and app composition has a frozen `MemoryConfig` from `add-ts-memory-configuration`.

Memory tool provider/factory MAY statically exist in `agent-memory`, but model-visible memory tool exposure MUST be dynamic and MUST reuse the existing `agent-capability` Tool SPI, catalog, discovery, executor, JSON Schema validation, and capability invocation path. Static provider existence MUST NOT by itself create a model-visible descriptor, effective capability catalog exposure, or executable invocation path. `agent-capability` MUST NOT import `agent-memory`, memory gateway ports, memory DTOs, or memory-specific provider code.

This change grants one narrow package-boundary refinement: the `agent-memory` memory tools submodule MAY use type-only imports from the public `agent-capability` package export for Tool SPI types needed to declare standard tool definitions. It MUST NOT import `agent-capability` catalog, discovery, executor, builtin tool definitions, private source paths, or memory-specific capability implementation. This refinement MUST be documented in the `agent-memory` and `agent-capability` module docs and covered by dependency boundary tests.

**Trigger mechanism**: This requirement is evaluated during release scope review, AgentAssembly/capability provider composition, startup capability registration, and any runtime tool selection check that would expose memory tools to the model. It is not triggered by a model tool call alone; model tool calls can only reach memory tools after the exposure gate has already passed.

**Inputs and preconditions**:
- The current release scope MUST include `add-ts-memory-core`.
- App composition MUST provide a frozen `MemoryConfig` whose status is `VALID`; `DISABLED` and `INVALID` snapshots MUST stop model-visible exposure. The default value of `nextAgent.memory.enabled` is owned by `add-ts-memory-configuration`, not by this change.
- The current AgentAssembly MUST explicitly enable memory tool capability binding for the active Agent as an opt-in signal; this raw AgentAssembly binding alone MUST NOT expose memory tools unless the exposure gate also passes.
- The current app composition MUST provide a valid, enabled memory core public boundary with owner scope, retrieval, write, delete, SafeError, state, and L1/L2 disclosure semantics.
- The app-composed memory tool registration MUST reference only the memory core public contract or app-composed memory tool adapter backed by selected gateway ports; it MUST NOT add memory-specific names to the public `ToolDependencies` / `requiredDependencies` SPI.
- `agent-app` MUST register memory tool definitions under the stable capability provider identity `memory-tools`. AgentAssembly opt-in MUST bind `search_memory`, `get_memory_detail`, and `add_memory` with `capabilityType=TOOL`, `providerId=memory-tools`, and `enabled=true`. This provider identity identifies only the model-facing tool catalog; it MUST NOT select the local/remote memory backend or carry gateway adapter configuration.
- `agent-app` MUST be the composition point that calls the `agent-memory` provider/factory after exposure gates pass and passes the returned standard tool definitions to the existing capability subsystem through a generic app-composed Tool catalog/executor input. This input MUST be provider-scoped, MUST NOT be the default enabled builtin tools list, and MUST NOT require `agent-capability` to import memory packages or DTOs.
- `agent-memory` memory tools provider/factory MUST limit any `agent-capability` source dependency to type-only imports of public Tool SPI types from the public package export. It MUST NOT import private `agent-capability` source paths or value-level catalog/discovery/executor helpers.
- If `add-ts-memory-configuration` provides trusted `ToolCatalogConfig.safeDescriptionOverride` values projected from `agent.yaml` / Agent definition `capabilityBindings[].description`, memory tools MAY consume those values only after the exposure gate passes.

**Outputs and side effects**:
- If the exposure gate passes, memory tools MAY be exposed as model-callable tool capabilities according to the remaining requirements in this spec and MUST be associated with provider identity `memory-tools` in the effective capability catalog.
- If the exposure gate fails before model-visible registration, memory tools MUST NOT be exposed in tool discovery, effective capability catalog results, or executable invocation paths, even if static tool definitions exist in code or a raw AgentAssembly opt-in binding exists.
- If a stale or precomputed binding attempts to invoke memory tools after selected gateway ports or memory tool adapter loss, the call MUST return an explicit unavailable `SafeError`; it MUST NOT silently fall back to local tool-layer storage or partial behavior.

**Core decision logic**:
1. Check whether the release scope includes `add-ts-memory-core`.
2. Check whether app composition has frozen a `MemoryConfig` with status `VALID`; `DISABLED` or `INVALID` means stop here.
3. Check whether the active AgentAssembly explicitly enables memory tools.
4. Check whether memory core is enabled and valid in app composition.
5. Check whether the memory core public boundary provides the required owner-scoped retrieval/write/delete semantics.
6. Register the three memory tool definitions under provider identity `memory-tools`; the selected memory backend remains app-composed and injected through `LongTermMemoryToolPort`.
7. Only after all checks pass, expose the three memory tools through the capability channel.
8. If any check fails, keep memory tools unavailable to the model and record a diagnostic without creating a competing memory implementation.

**State / artifact contract**:
- This change MUST NOT create a standalone memory store, standalone memory DTO, standalone owner scope model, or standalone memory lifecycle state.
- This change MAY produce capability availability diagnostics such as `MEMORY_TOOLS_DEPENDENCY_UNAVAILABLE`; those diagnostics are operational state, not memory records.
- Diagnostics MUST be traceable to the failed dependency check and MUST NOT include prompt content, raw memory content, credentials, local paths, or raw provider errors.

**Flow integration**:
```
release scope / MemoryConfig VALID / AgentAssembly opt-in / app composition
  -> memory tools exposure gate
  -> app-composed provider-scoped Tool catalog registration
  -> model tool discovery and invocation
```

**Failure and degradation**:
- If `add-ts-memory-core` is outside the release scope, memory tools MUST be treated as outside the same release scope.
- If `MemoryConfig` is `DISABLED` or `INVALID`, AgentAssembly has not opted in, or memory core is not available at startup, memory tools MUST NOT be exposed to the model.
- If memory core becomes unavailable at invocation time, the relevant tool MUST return `SafeError { code: "LTM_STORAGE_UNAVAILABLE", category: UNAVAILABLE, retryable: true }` or the more specific error defined by memory core.
- No memory tool has a special disabled empty-success behavior; disabled before exposure means no model-visible tools, and stale/precomputed bindings return explicit disabled SafeError.

#### Scenario: Target release includes memory tools after core
- **GIVEN** the target release scope includes `add-ts-memory-core`
- **WHEN** release scope is evaluated for `add-ts-memory-tools`
- **THEN** `add-ts-memory-tools` MUST be delivered alongside `add-ts-memory-core` in the same release scope
- **AND** memory tools MUST NOT be exposed as independently deliverable without memory core

#### Scenario: Memory core dependency is available
- **GIVEN** the release scope includes `add-ts-memory-core`
- **AND** app composition has frozen a `VALID` `MemoryConfig`
- **AND** the active AgentAssembly enables memory tools
- **AND** app composition provides a valid enabled memory core public boundary
- **WHEN** capability providers are registered
- **THEN** the system MAY expose `search_memory`, `get_memory_detail`, and `add_memory`
- **AND** the effective capability catalog MUST associate them with provider identity `memory-tools`
- **AND** each tool MUST consume the memory core public contract
- **AND** the tools MUST be registered through a generic app-composed Tool catalog/executor path, not by appending them to the default enabled builtin tool list

#### Scenario: Memory configuration is disabled
- **GIVEN** app composition has frozen `MemoryConfig.status = DISABLED`
- **WHEN** capability providers are registered
- **THEN** memory tools MUST NOT be exposed to model tool discovery
- **AND** memory tools MUST NOT appear in effective capability catalog results or executable invocation paths
- **AND** static memory tool provider/factory MAY remain in `agent-memory` only as a non-visible implementation artifact

#### Scenario: Memory configuration is invalid
- **GIVEN** app composition has frozen `MemoryConfig.status = INVALID` or cannot provide a valid memory configuration projection
- **WHEN** capability providers are registered
- **THEN** memory tools MUST NOT be exposed to model tool discovery
- **AND** the system MUST record a safe configuration diagnostic
- **AND** the system MUST NOT treat invalid configuration as enabled memory

#### Scenario: Description override does not bypass disabled gate
- **GIVEN** app composition has a trusted `ToolCatalogConfig.safeDescriptionOverride` projected from `agent.yaml` / Agent definition `capabilityBindings[].description`
- **AND** app composition has frozen `MemoryConfig.status = DISABLED`
- **WHEN** capability providers are registered
- **THEN** memory tools MUST NOT be exposed to model tool discovery
- **AND** the description override MUST NOT create effective capability catalog exposure or an executable invocation path

#### Scenario: Memory core dependency is missing
- **GIVEN** app composition does not provide a valid memory core public boundary
- **WHEN** memory tools capability registration runs
- **THEN** memory tools MUST NOT be exposed to model tool discovery
- **AND** the system MUST record a dependency diagnostic
- **AND** the system MUST NOT create tool-local memory storage or a competing memory contract

### Requirement: Memory tools exposure through capability channel

系统 SHALL 提供 3 个模型可调用的长期记忆工具：`search_memory`、`get_memory_detail`、`add_memory`。这些工具 MUST 通过统一 capability tool 通道暴露、选择、调用、取消、超时、记录结果和进入审计边界，不得通过 context assembly、runtime command、REST API、后台 job 或私有 memory adapter 入口绕过 capability invocation。`update_memory`、`forget_memory` 和 `get_user_context` 不属于首版 model-facing tools。

这些工具只允许作为模型工具调用的执行目标。除 `agent-app` composition 为模型工具暴露而调用 `agent-memory` provider/factory、以及模型驱动 loop 经 capability invocation 触发外，其他模块、后台任务、维护流程、context assembly、channel、runtime command、agent-memory extraction/aging/maintenance 编排和 gateway adapter MUST NOT 调用这些工具、tool descriptor、capability executor 或 `LongTermMemoryToolPort` 来访问长期记忆。任何非模型模块需要长期记忆能力时，MUST 通过 `add-ts-memory-core` 定义的 gateway public ports（或自身 owning change 明确定义的 application service 边界）访问。

**触发机制**：工具调用只能由请求执行期的模型工具调用触发；触发阶段是 `BEFORE_CAPABILITY_INVOKE` 到 `AFTER_CAPABILITY_RESULT` 之间的 capability invocation 流程。调用是同步等待结果的 async operation，必须消费 runtime-owned cancellation signal 和 capability timeout。后台 job、调度机制、request acceptance、context assembly 和 terminal commit 不得自动触发这些工具。

**输入与前置条件**：
- 当前 RequestRun 已被 runtime 接受并进入模型驱动执行流程。
- `RequestContext.identityContext` 已包含可信 `tenantId` 和 `subjectId`。
- `RequestContext.agentId` 已包含当前执行 Agent 的可信 agent scope（与 runtime `hostedAgentId` 对齐）。
- 当前 AgentAssembly 已包含 enabled memory tool capability binding 作为 opt-in 信号；`MemoryConfig` 为 `DISABLED` / `INVALID` 或 Agent 未 opt-in 时不得产生有效 catalog 暴露或可执行调用路径，且 memory config 不负责改写原始 AgentAssembly。
- `add-ts-memory-core` 已提供可用的长期记忆检索、写入、删除和 owner-scope 语义；`agent-memory` provider/factory MUST receive `LongTermMemoryToolPort` from `agent-app` composition，该 tool port 背后由 selected memory gateway store/retriever 适配而来；memory tool implementation 不得直接导入 adapter-private implementation，不得绕过 app-composed adapter 读取 SQLite/FTS5 或 gateway-local private path。
- capability invocation 仍有工具调用预算、结果大小预算和 timeout 预算。

**输出与副作用**：
- 每次工具调用 MUST 产生 capability invocation result，结果为成功 payload 或 `SafeError`。
- 每次工具调用 MUST 产生可观察的 capability invocation 事实；用户可见 stream 只消费 channel-safe projection。
- Domain-specific memory write/search audit or metric facts MAY be produced only through the existing gateway/observability owning path or a future owning change. The memory tool adapter MUST NOT take a direct `auditWriter`, `diagnosticSink`, or independent observability dependency.
- 工具不得直接提交 terminal message，不得直接推进 RequestRun terminal state。

**核心判断逻辑**：
1. 验证该工具已经通过 effective capability catalog 暴露且工具名属于 3 个受支持名称。
2. 验证工具输入 schema；如果出现 `tenantId`、`subjectId`、`agentId`、`ownerSubjectId`、`owner`、`userId` 或等价 scope 字段，拒绝调用。
3. 从 `RequestContext.identityContext` 注入 `tenantId` 和 `subjectId`，从 `RequestContext.agentId` 注入 agent scope。
4. 检查 capability timeout、cancellation 和调用预算。
5. 调用 app-composed `LongTermMemoryToolPort`，该 tool port 背后的 selected gateway backend 按 `add-ts-memory-core` 的 public contract 执行。
6. 将 memory core 成功结果或 SafeError 映射为 capability result。
7. 记录 capability invocation / timeline 可观察事实；任何 domain-specific memory write/search 审计或指标必须通过既有 gateway/observability owning path 或后续 owning change 投影，且不得影响工具业务结果。

**流程接入**：
```
Model tool call
  -> Agent/Core model-driven loop
  -> capability invocation boundary
  -> memory tool
  -> app-composed LongTermMemoryToolPort
  -> capability result
  -> next model turn consumes result
```

#### Scenario: Normal tool invocation enters capability flow
- **WHEN** 模型在一个已接受的 RequestRun 中发出 `search_memory` tool call
- **THEN** runtime/core MUST 通过 capability invocation 执行该工具
- **AND** 工具 MUST 使用当前 `RequestContext.identityContext.tenantId`、`subjectId` 和 `RequestContext.agentId`
- **AND** 工具结果 MUST 作为 capability result 被后续模型轮次消费

#### Scenario: Tool result is paired for the next model turn
- **WHEN** a memory tool succeeds and the agent starts the follow-up model turn in the same request
- **THEN** context rendering MUST preserve the hidden assistant tool-call message and the matching capability result message as a provider-neutral tool-call/tool-result pair
- **AND** provider adapters MUST map the tool result to the same tool name as the paired assistant tool call using `toolCallId`
- **AND** this model-visible pairing MUST NOT make the hidden assistant tool-call message visible in normal conversation history

#### Scenario: Tool invocation outside request execution is rejected
- **WHEN** request acceptance、context assembly、terminal commit 或后台 job 尝试直接触发 memory tool
- **THEN** 系统 MUST 拒绝该调用
- **AND** 返回 `SafeError { code: "MEMORY_TOOL_INVALID_TRIGGER", category: VALIDATION, retryable: false }`
- **AND** 不得访问长期记忆边界

#### Scenario: Owner fields in tool input are rejected
- **WHEN** 任一 memory tool input 包含 `tenantId`、`subjectId`、`agentId`、`ownerSubjectId`、`owner` 或 `userId`
- **THEN** 现有 capability executor JSON Schema validation MUST reject the call with `SafeError { code: "CAPABILITY_INPUT_INVALID", category: VALIDATION, retryable: false }`
- **AND** 系统 MUST 记录安全诊断
- **AND** 不得使用这些字段覆盖可信身份

#### Scenario: Binding description override does not affect exposure
- **GIVEN** `add-ts-memory-configuration` projects a trusted `ToolCatalogConfig.safeDescriptionOverride` from a bound memory capability's `capabilityBindings[].description`
- **WHEN** memory tools are exposed
- **THEN** the override MAY change only `CapabilityDescriptor.description`
- **AND** it MUST NOT change memory tool exposure, capability enablement, provider identity, input/output schema, owner scope, agent scope, permissions, or invocation arguments
- **AND** memory tool implementation, executor, runtime, context, and channel MUST NOT read `agent.yaml` directly to obtain this description

### Requirement: Memory tool schemas reject owner scope input

Memory tools SHALL use the existing `agent-capability` JSON Schema validation path. Each memory tool input schema MUST use `additionalProperties: false`, MUST only declare model-provided business parameters, and MUST NOT declare `tenantId`, `subjectId`, `agentId`, `ownerSubjectId`, `owner`, `userId`, or equivalent owner/agent scope fields. `agent-capability` MUST NOT add memory-specific validation metadata or executor branches for memory tools.

**Core decision logic**:
1. Executor validates input against the tool's existing `metadata.inputSchema`.
2. Because memory tool schemas use `additionalProperties: false`, owner/agent scope fields are rejected as unknown properties.
3. Validation failure uses the existing `CAPABILITY_INPUT_INVALID` behavior.
4. Tool execution injects trusted `tenantId` / `subjectId` from `RequestContext.identityContext` and trusted `agentId` from `RequestContext.agentId`.

#### Scenario: Memory tool schema rejects owner fields
- **GIVEN** a memory tool input schema uses `additionalProperties: false`
- **WHEN** input contains `tenantId`, `subjectId`, `agentId`, `ownerSubjectId`, `owner`, `userId`, or an equivalent scope field
- **THEN** executor MUST reject the input with `CAPABILITY_INPUT_INVALID`
- **AND** the tool implementation MUST NOT execute
- **AND** trusted scope MUST NOT be overridden

#### Scenario: Public Tool SPI remains unchanged
- **WHEN** implementing memory tools
- **THEN** `ToolMetadata` MUST NOT add `forbiddenInputFields`, `forbiddenFieldErrorCode`, `forbiddenFieldErrorMessage`, or `inputValidationErrorCode`
- **AND** `BuiltinToolsExecutor` MUST NOT contain memory tool names, `USER_CHARACTERISTICS`, owner field constants, `MEMORY_TOOL_*` error-code branches, or a memory-specific validation path

### Requirement: search_memory L1 retrieval

`search_memory` SHALL 提供模型驱动的 L1 长期记忆搜索。它 MUST 返回当前 owner scope 下的 `ACTIVE` 记忆条目列表，并按 memory core 的 `hybridScore` 降序排列。该工具不得返回完整结构化 content。它同时承载原 `get_user_context` 的用户特征检索能力：当 `categoryFilter="USER_CHARACTERISTICS"` 时，工具 MAY 按 `purpose` 过滤用户特征并返回 L1 trait projection。

**Default tool description**：除非 Agent definition 通过 `capabilityBindings[].description` 提供可信覆盖，内置 `CapabilityDescriptor.description` MUST 使用以下默认文案：

> Search current user's ACTIVE long-term memory before answering questions about facts, configurations, procedures, preferences, or saved knowledge from past sessions. If unsure whether relevant memory exists, call this first; empty results are cheap. Returns L1 summaries only. Call get_memory_detail for promising entries needing full content. For user traits, use categoryFilter=USER_CHARACTERISTICS with purpose.

**Tool description semantic guidance**：默认英文文案是完整的内置模型可见描述；以下条目是描述必须覆盖的语义约束，不要求逐字拼接到默认 description 中。若 Agent definition 通过 `capabilityBindings[].description` 覆盖描述，覆盖后的模型可见描述 MUST 仍覆盖这些语义——
- "ALWAYS call this before answering questions about facts, configurations, procedures, preferences, or any topic where you may have saved knowledge from past sessions."
- "If you are unsure whether relevant knowledge exists, call this first — an empty result is cheap."
- "After reviewing results, call get_memory_detail for promising entries that need full content before acting."
- "For user preferences, skill level, communication style, or workflow adaptation, call this with categoryFilter=USER_CHARACTERISTICS and the relevant purpose."

**触发机制**：模型在请求执行期需要跨会话知识候选时显式调用；同步等待搜索结果；不由 context assembly 自动调用。

**输入与前置条件**：
- 输入字段：`queryText?`、`categoryFilter?`、`purpose?`、`minConfidence?`、`limit?`、`offset?`。
- `minConfidence` 省略时 MUST 使用 0.3。
- `limit` 省略时 MUST 使用 20；最大值 MUST 为 100。
- `offset` 省略时 MUST 使用 0。
- `categoryFilter` 如果提供，MUST 是 `FACTUAL`、`CONCEPTUAL`、`PROCEDURAL`、`USER_CHARACTERISTICS` 之一。
- `purpose` 如果提供，MUST 是 `PERSONALIZATION`、`TROUBLESHOOTING`、`WORKFLOW_ADAPTATION`、`GENERAL` 之一，且只允许在 `categoryFilter="USER_CHARACTERISTICS"` 时出现；其他 category 传入 `purpose` MUST 被 schema validation 拒绝。

**输出与副作用**：
- 成功结果 MUST 包含 `entries[]`、`totalCount`、`limit`、`offset`。
- 每个 entry MUST 只包含 L1 字段：`longTermMemoryId`、`category`、`confidence`、`tags`、`briefIndex`、`createdAt`、`hybridScore`。
- 当 `categoryFilter="USER_CHARACTERISTICS"` 且提供 `purpose` 时，每个 entry MUST 是 purpose-scoped L1 trait projection，至少包含 `longTermMemoryId`、`traitName`、`confidence`、`briefIndex`、`lastUpdatedAt`；不得包含未按 purpose 允许披露的敏感 trait value。
- 搜索成功返回的条目访问计数副作用由 memory core 负责；工具不得自行写入访问计数。
- 用户特征检索 MUST be covered by a safe capability/gateway/observability fact；若存在日志、metric、audit 或 diagnostic 投影，只能记录 purpose 和 retrievedTraitNames/ref，不记录 trait value。

**核心判断逻辑**：
1. 校验分页、分类、purpose 和 confidence 参数。
2. 使用可信 `tenantId` / `subjectId` / `agentId` 构造 `SearchLongTermMemoryQuery`。
3. 通过 app-composed `LongTermMemoryToolPort` 执行 search 语义。
4. 将结果投影为 L1 disclosure；`USER_CHARACTERISTICS` + `purpose` 路径按 purpose 过滤 trait。
5. 如果结果 payload 超过 capability result 大小预算，返回 `MEMORY_TOOL_RESULT_TOO_LARGE`，不得静默截断。

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

#### Scenario: Purpose is rejected for non-user-characteristics search
- **WHEN** 模型调用 `search_memory(categoryFilter="PROCEDURAL", purpose="PERSONALIZATION")`
- **THEN** 现有 capability executor JSON Schema validation MUST return `SafeError { code: "CAPABILITY_INPUT_INVALID", category: VALIDATION, retryable: false }`
- **AND** 不得调用 memory retriever

#### Scenario: Search result too large
- **WHEN** 搜索结果投影超过 capability result 大小预算
- **THEN** 工具 MUST 返回 `SafeError { code: "MEMORY_TOOL_RESULT_TOO_LARGE", category: VALIDATION, retryable: false }`
- **AND** SafeError MUST 提示降低 `limit` 或收窄查询
- **AND** 不得静默截断结果

### Requirement: get_memory_detail L2 retrieval

`get_memory_detail` SHALL 按 `longTermMemoryIds[]` 批量获取当前 owner scope 下的 L2 长期记忆详情，单次最多 20 条。不存在、不属于当前 owner 或不可披露时 MUST 在对应 result 中返回同一个 not-found SafeError，防止对象存在性泄露；单条失败不得中断其他条目。

**触发机制**：模型基于 `search_memory` 返回的 L1 候选，判断需要完整结构化内容时显式调用；同步等待结果。

**Default tool description**：除非 Agent definition 通过 `capabilityBindings[].description` 提供可信覆盖，内置 `CapabilityDescriptor.description` MUST 使用以下默认文案：

> Fetch full L2 details for long-term memory entries returned by search_memory when their briefIndex suggests relevant details are needed. Pass up to 20 longTermMemoryIds. Returns per-entry results with full structured fields such as procedural steps, pitfalls, verification criteria, or conceptual definitions.

**Tool description semantic guidance**：默认英文文案是完整的内置模型可见描述；以下条目是描述必须覆盖的语义约束，不要求逐字拼接到默认 description 中。若 Agent definition 通过 `capabilityBindings[].description` 覆盖描述，覆盖后的模型可见描述 MUST 仍覆盖这些语义——
- "Call this after search_memory when entries' briefIndex suggests they have relevant details you need."
- "Pass up to 20 longTermMemoryIds when multiple search results need full content."
- "L2 content includes full structured fields (steps, pitfalls, verification criteria for PROCEDURAL; full definitions for CONCEPTUAL; etc.)."

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

**触发机制**：仅当当前用户明确要求系统"记住"、"以后按这个来"、"默认采用这个偏好/流程"或等价立即生效的记忆指令时，模型才可在执行期显式调用；同步等待写入结果；不是普通对话观察、自动提取周期或后台学习 job。

**Default tool description**：除非 Agent definition 通过 `capabilityBindings[].description` 提供可信覆盖，内置 `CapabilityDescriptor.description` MUST 使用以下默认文案：

> Add a new ACTIVE long-term memory only when the current user explicitly asks you to remember or use a FACTUAL, CONCEPTUAL, PROCEDURAL, or USER_CHARACTERISTICS memory in the future. Do not use for temporary session context, public/general knowledge, large raw code/log/table content, inferred observations, or possible duplicates/conflicts. Keep briefIndex concise; this tool does not perform similarity search or conflict detection.

**Tool description semantic guidance — Save When（主动存）**：默认英文文案是完整的内置模型可见描述；以下分类和示例是描述必须覆盖的语义边界与实现/评审约束，不要求逐字拼接到默认 description 中，也不得让实现把中英文 checklist 自动追加到工具描述。若 Agent definition 通过 `capabilityBindings[].description` 覆盖描述，覆盖后的模型可见描述 MUST 仍覆盖这些语义，且不得退化为依赖"valuable knowledge"等模糊判断：

- **FACTUAL**：用户明确要求记住的稳定事实。例："记住：这个集群的 BGP peer 地址是 10.0.0.1"、"以后记住 SLA 要求 99.99% 可用性"
- **CONCEPTUAL**：用户明确要求以后采用的领域概念、术语定义或架构原理。例："以后记住：我们的网络分核心层、汇聚层、接入层三级"
- **PROCEDURAL**：用户明确要求保存的可复用操作流程、排障步骤或检查清单。例："以后排查 BGP 都按这个流程：先看邻居状态，再看路由策略"
- **USER_CHARACTERISTICS**：用户明确要求系统长期采用的偏好、习惯、技能水平、沟通风格或角色。例："记住我习惯看表格而不是段落"、"以后默认把我当网络工程师，不需要解释基础概念"

**Tool description semantic guidance — Skip（不要存）**：
- 临时文件路径、一次性调试上下文、当前会话特有的临时信息
- 可以从公开文档或网络搜索获取的通用知识
- 大段代码原文、日志、数据表——这些应该用 `briefIndex` 做摘要
- 模型从对话中观察、推断或总结出的未被用户明确要求立即记住的内容；这些内容由 dreaming / extraction 后台路径处理
- 与已有记忆可能重复、相似但不等价或冲突的内容；`add_memory` 不做请求期冲突检测，疑似冲突应等待 dreaming 消歧或由维护/用户管理边界处理
- 长度超过 100 字符的 `briefIndex`（工具会自动截断，应自行精简）

**输入与前置条件**：
- 输入字段：`category`、`content`、`tags?`、`briefIndex?`、`confidence?`。
- `category` MUST 是 `FACTUAL`、`CONCEPTUAL`、`PROCEDURAL`、`USER_CHARACTERISTICS` 之一。
- `category` 只描述知识类型，不决定是否立即生效；立即写入 ACTIVE 的唯一首版条件是当前用户明确要求系统记住或以后采用该知识。
- `content` MUST 符合 `add-ts-memory-core` 定义的 category-specific structured content contract: `FACTUAL(subject, claim, evidence?, qualifiers?)`, `CONCEPTUAL(concept, definition, aliases?, relatedConcepts?)`, `PROCEDURAL(procedureName, non-empty steps, preconditions?, verification?, pitfalls?)`, or `USER_CHARACTERISTICS(non-empty traits, non-empty purpose[])`. 受控例外是 `category="USER_CHARACTERISTICS"` 时，`content` MAY be a non-empty string as a tool-level convenience input.
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
1. 校验 category、content、confidence、tags、briefIndex。
2. 生成或截断 briefIndex。
3. 验证当前工具调用来自用户明确记忆指令的模型判断；模型观察/推断型知识不得通过 `add_memory` 写入。
4. 绑定可信 `tenantId` / `subjectId` / `agentId`，生成当前请求可追溯的 source refs。
5. 通过 `store.saveLongTermMemory` 写入，构造 `SaveLongTermMemoryRequest` 和 request/invocation-level idempotency write options。
6. 返回 capability result，并确保任何日志、metric、audit 或 diagnostic 不含 raw content。

#### Scenario: User characteristic string content is accepted by add_memory schema
- **WHEN** the model invokes `add_memory` with `category="USER_CHARACTERISTICS"` and non-empty string `content`
- **THEN** the `add_memory` input schema MUST accept the string through an explicit `content: string | structuredContent` union
- **AND** `add_memory.execute()` MUST convert it to `{ category: "USER_CHARACTERISTICS", traits: [content], purpose: ["GENERAL"] }` before constructing `SaveLongTermMemoryRequest`
- **AND** this exception MUST NOT apply to `FACTUAL`, `CONCEPTUAL`, or `PROCEDURAL`
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

### Requirement: Update and delete remain non-model-facing memory interfaces

The system SHALL retain the underlying long-term memory update and delete interfaces defined by `add-ts-memory-core`, but `add-ts-memory-tools` MUST NOT expose `update_memory` or `forget_memory` as model-facing tools in the first version. Scoped partial update and physical delete remain available to memory core, maintenance, user-management, aging, or future explicitly approved changes through their own boundaries.

**Core decision logic**:
1. Model-visible tool discovery MUST include only `search_memory`, `get_memory_detail`, and `add_memory`.
2. `LongTermMemoryToolPort` MUST be the minimal dependency surface for the 3 model-facing memory tools and MUST expose only `searchLongTermMemory`, `getLongTermMemoryDetail`, and `saveLongTermMemory`.
3. `LongTermMemoryToolPort` MUST NOT expose `deleteLongTermMemory`, `listLongTermMemory`, `getLongTermMemory`, lifecycle mutation methods, or any maintenance/user-management operation.
3. Memory tools MUST NOT provide a model-callable update/delete descriptor, input schema, or invocation path.
5. Future model-facing update/forget behavior MUST be introduced by a separate refinement that defines user intent, audit, authorization, and recovery semantics.

#### Scenario: Update and forget tools are not exposed
- **WHEN** memory tools are registered after the exposure gate passes
- **THEN** model tool discovery MUST include `search_memory`, `get_memory_detail`, and `add_memory`
- **AND** model tool discovery MUST NOT include `update_memory` or `forget_memory`
- **AND** no model-visible descriptor, effective capability catalog exposure, or executable invocation path MUST be created for `update_memory` or `forget_memory`

#### Scenario: Core update and delete ports remain available below tools
- **WHEN** maintenance or a future approved user-management boundary needs to update or delete long-term memory
- **THEN** it MAY use the memory core public update/delete contract through its own boundary
- **AND** it MUST NOT call model-facing memory tools to perform that operation

#### Scenario: Non-model consumers use gateway ports
- **WHEN** extraction, aging, maintenance, context assembly, runtime, channel, or another non-model module needs long-term memory access
- **THEN** it MUST use memory core gateway public ports or an owning-change application service boundary
- **AND** it MUST NOT call `search_memory`, `get_memory_detail`, `add_memory`, `LongTermMemoryToolPort`, memory tool descriptors, or capability executor paths

### Requirement: Memory tools failure and degradation

系统 SHALL 为 memory tools 定义统一失败和降级语义。Memory disabled、存储不可用、timeout、cancellation、预算不足、输入无效和依赖缺失 MUST 返回明确 `SafeError`，不得静默丢弃、静默截断或吞掉错误。

**失败与降级规则**：
1. memory disabled before exposure：memory tools MUST NOT be exposed to model tool discovery, effective capability catalog results, or executable invocation paths.
2. memory disabled after stale/precomputed binding exists：`search_memory`、`get_memory_detail`、`add_memory` MUST 返回 `SafeError { code: "LTM_DISABLED", category: UNAVAILABLE, retryable: false }`。
3. memory store/retriever unavailable：返回 `SafeError { code: "LTM_STORAGE_UNAVAILABLE", category: UNAVAILABLE, retryable: true }`。
4. capability timeout：返回 `SafeError { code: "MEMORY_TOOL_TIMEOUT", category: TIMEOUT, retryable: true }`。
5. runtime cancellation：返回或记录 `SafeError { code: "MEMORY_TOOL_CANCELED", category: CANCELED, retryable: false }`，并停止下游 memory operation。
6. 结果超预算：返回 `MEMORY_TOOL_RESULT_TOO_LARGE`，不得截断。
7. observability/audit projection failure：已经成功产生的 memory side effect 不得被报告为未发生；投影失败 MUST 进入现有 observability failure channel，并通过结构化日志或指标暴露，不得扩展工具业务结果状态机。

#### Scenario: Disabled memory is not exposed
- **WHEN** `MemoryConfig.status = DISABLED` before capability exposure
- **THEN** `search_memory` MUST NOT appear in model tool discovery
- **AND** `search_memory` MUST NOT appear in effective capability catalog results or executable invocation paths

#### Scenario: Stale binding after memory is disabled
- **GIVEN** a stale or precomputed binding still attempts to invoke `search_memory`
- **WHEN** memory has been disabled after exposure
- **THEN** the tool MUST return `SafeError { code: "LTM_DISABLED", category: UNAVAILABLE, retryable: false }`
- **AND** 不得返回空列表伪装为成功搜索

#### Scenario: Storage unavailable
- **WHEN** memory store 不可用
- **AND** 模型调用 `add_memory`
- **THEN** 工具 MUST 返回 `SafeError { code: "LTM_STORAGE_UNAVAILABLE", category: UNAVAILABLE, retryable: true }`
- **AND** 不得产生 memory record

#### Scenario: Tool timeout
- **WHEN** memory tool 超过 capability timeout
- **THEN** 工具 MUST 返回 `SafeError { code: "MEMORY_TOOL_TIMEOUT", category: TIMEOUT, retryable: true }`
- **AND** 下游 memory operation MUST 接收 cancellation signal

#### Scenario: Observability projection failure after memory side effect
- **WHEN** `add_memory` 已经成功创建当前 owner 的 ACTIVE memory record
- **AND** capability/gateway/observability owning path 的后置日志、metric 或 audit 投影失败
- **THEN** capability result MUST 仍表达该 memory outcome
- **AND** structured log 或 metric MUST 记录 observability projection failure
- **AND** capability result MUST NOT 输出 audit id、audit linkage 或 audit 子状态字段

### Requirement: Memory tools architecture boundaries

系统 SHALL 保持 memory tools 与架构、核心契约和并行开发边界一致。Memory tools 不得重新定义已由 `add-ts-memory-core` 冻结的核心 memory DTO、port、ranking、state enum 或 owner scope 语义，不得修改 context assembly、runtime lifecycle、session store schema、platform endpoint 或后台 scheduler。

#### Scenario: No context assembly mutation
- **WHEN** 实现 `add-ts-memory-tools`
- **THEN** context assembly MUST NOT 自动检索长期记忆
- **AND** system prompt MUST NOT 预加载 `search_memory` 用户特征检索结果
- **AND** `agent-context-engine` 不得为了该 change 直接导入 memory store/retriever implementation

#### Scenario: No competing memory contract
- **WHEN** memory tools 需要读写长期记忆
- **THEN** 它们 MUST 使用 `add-ts-memory-core` 的 public memory contract
- **AND** 不得在 capability implementation 中定义竞争性的 memory record、state、ranking 或 owner scope 契约

#### Scenario: No platform endpoint
- **WHEN** 完成该 change
- **THEN** 系统 MUST NOT 新增长期记忆 REST API、Web UI 管理入口或 platform endpoint
- **AND** 用户管理、维护和共享能力 MUST 由后续独立 change 定义

#### Scenario: Tools are not internal service APIs
- **WHEN** a non-model module needs to read, write, update, delete, rank, age, extract, or maintain long-term memory
- **THEN** it MUST depend on `LongTermMemoryStoreGateway`, `LongTermMemoryRetrieverGateway`, or an owning-change application service boundary
- **AND** it MUST NOT depend on model-facing memory tools, `LongTermMemoryToolPort`, tool descriptors, tool input/output schemas, or capability invocation as an internal service API

#### Scenario: Narrow Tool SPI dependency authorization
- **WHEN** implementing the `agent-memory` memory tools provider/factory
- **THEN** the provider/factory MAY import only public `agent-capability` Tool SPI types using type-only imports
- **AND** it MUST NOT import `agent-capability` catalog, discovery, executor, builtin tool definitions, private source paths, or value-level helpers
- **AND** `agent-capability` MUST NOT import `agent-memory`, memory gateway ports, memory DTOs, or memory-specific provider code
