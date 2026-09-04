# Memory Architecture

本设计承载长期记忆稳定基线的跨模块事实。行为性验收要求由 `openspec/specs/memory-core/spec.md`、`openspec/specs/memory-configuration/spec.md`、`openspec/specs/memory-tools/spec.md`、`openspec/specs/task-trajectory/spec.md`、`openspec/specs/memory-extraction/spec.md`、`openspec/specs/memory-aging/spec.md` 和 `openspec/specs/long-memory-import-export/spec.md` 承载。

## Scope

当前稳定基线包含长期记忆核心 Record/gateway contract、本地 SQLite gateway 实现、冻结配置快照、模型可调用 memory tools、task trajectory 学习输入层、后台 extraction/dreaming、后台 aging lifecycle，以及浏览器长期记忆管理界面的 JSON 批量导入、每批 1 至 100 条的管理批量新增 REST 契约和筛选 CSV 导出。它仍不包含 memory sharing/publish/fork 的批量迁移、远端长期记忆服务协议、上下文自动注入长期记忆、多实例 durable scheduler 或跨租户知识共享。

长期记忆的第一性原则是：长期记忆是 owner/agent scoped 的持久知识事实，不是当前请求上下文、不是模型自由维护的隐藏状态，也不是 gateway-local 的私有数据结构。所有读写都必须通过稳定 gateway contract、可信 Owner Scope 和可信 Agent Scope 执行；所有后台学习和生命周期维护都必须在 request terminal commit 关键路径之外运行。

## Contract Ownership

`agent-common` owns durable scalar vocabulary shared by memory contracts: `LongTermMemoryId`、`TaskTrajectoryId`、`MemoryCategory`、`LongTermMemoryState`、`TaskTrajectoryKind`、`TaskTrajectoryBuildStatus`、`TaskOutcomeStatus` 和 `OutcomeEvidenceLevel`。它不定义 Record、Request、port 或业务服务。

`agent-contracts/gateway` owns persistence DTOs, query DTOs and async gateway ports:

- `LongTermMemoryRecord`、`SaveLongTermMemoryRequest`、`ListLongTermMemoryQuery`、`SearchLongTermMemoryQuery`、`TransitionLongTermMemoryStateRequest`、`AdjustLongTermMemoryConfidenceRequest`、`MarkLongTermMemoryAccessedRequest`、`LongTermMemoryStoreGateway` 和 `LongTermMemoryRetrieverGateway`。
- `TaskTrajectoryRecord`、`SaveTaskTrajectoryRequest`、`ListTaskTrajectoriesQuery`、`TaskTrajectoryBuildCandidate`、`TaskTrajectoryStoreGateway` 和 `TaskTrajectoryQueryGateway`。

所有 memory 和 task trajectory Record/Request 必须 `extends OwnerScoped` 并显式携带 `agentId`。`tenantId`/`subjectId` 来自可信 identity boundary；`agentId` 来自可信 app composition、hosted-agent selection 或已持久化 session/run facts。客户端请求体、模型输出、capability 参数和 metadata 不得覆盖这些 scope。

Simple memory writes use request/record plus write options. `idempotencyKey` belongs to `IdempotentWriteOptions`; it must not appear on memory Request DTOs or Records. Retained record concurrency uses `LongTermMemoryRecord.version` and optional `expectedVersion` on state/confidence/access mutations.

## Core Memory Record

`LongTermMemoryRecord` is the canonical retained memory fact while a memory entry exists. `state` has exactly two retained values: `ACTIVE` and `ARCHIVED`. Explicit forget or retention expiry physically deletes the scoped row and retrieval index entry; there is no `DELETED` retained state and no separate archive table.

The four content categories are fixed:

- `FACTUAL`: safe environment facts, configuration facts, constraints, versions, SLA or topology claims.
- `CONCEPTUAL`: business or telecom domain concepts, definitions, aliases and relationships.
- `PROCEDURAL`: reusable procedure knowledge anchored by `procedureName` and retained as non-empty `procedureText`; optional preconditions, verification and pitfalls remain category-specific structured detail rather than a required `steps[]` array.
- `USER_CHARACTERISTICS`: low-sensitivity workflow, language, terminology or adaptation traits with explicit purpose.

L1 projections (`LongTermMemoryListItem` and `LongTermMemorySearchEntry`) carry only id/category/confidence/tags/briefIndex/createdAt and optional score. L2 detail access returns the full retained record. `searchLongTermMemory` increments `recallCount`; `getLongTermMemoryDetail` increments `accessCount` and updates `lastAccessedAt`. Background fusion increments `extractionCount` only when new extraction refs are merged through core save semantics.

`sourceTrace` stores durable refs only. It may include session/run/message/extraction refs, but must not contain raw prompt, raw model output, stream delta, provider error, local path, credential, token, attachment content, copied message text or raw trait value.

## Local And Remote Backends

The local backend is implemented directly by `agent-platform-gateway-local`, following the gateway provider binding pattern. The selected Long-term Memory provider exposes `LongTermMemoryGatewayBindings` with both `LongTermMemoryStoreGateway` and `LongTermMemoryRetrieverGateway`; store and retriever must come from the same provider. In LOCAL deployment, `SqliteLongTermMemoryCore` owns `long-term-memory.sqlite`, SQLite rows, indexes, FTS5/literal-match fallback, transactions and row mapping for retained memory only. Task trajectory remains in the retained SQLite provider, not in the Long-term Memory provider. `agent-memory` must not wrap, re-export or replace the core gateway port contract.

Remote complete-service memory backend is a replacement boundary. When app composition selects remote complete-service memory, local extraction scheduler, local aging scheduler, local task trajectory worker and local revival helper must not run. Remote service owns memory lifecycle decisions; local code may only adapt stable contracts, inject trusted scope, normalize safe errors and emit safe diagnostics when a later remote adapter change defines that path.

## Configuration

`agent-app` owns memory configuration loading, validation and freeze through the app-private `DefaultSystemConfig`. The product configuration namespace is `nextAgent.memory.*`; memory consumers receive only the frozen `MemoryConfig` snapshot or narrow projections. Missing memory config or `enabled=false` yields a disabled snapshot. Invalid values or unknown memory fields fail closed or produce explicit unavailable diagnostics; consumers must not silently default invalid values.

Configuration does not own memory behavior. It does not define ranking weights, storage schema, owner/agent scope, extraction prompt ids, hot reload, per-tenant config or backend implementation details. Extraction and aging fields live under `nextAgent.memory.extraction.*` and `nextAgent.memory.aging.*` only after their owning specs define them.

## Model-Facing Tools

The model-facing memory surface is limited to `search_memory`, `get_memory_detail` and `add_memory`. These tools are standard capability Tool definitions provided by the `agent-memory` memory tools submodule and registered only by `agent-app` when all gates pass:

- memory core and memory configuration are available;
- `MemoryConfig.status === VALID`;
- the current Agent assembly explicitly opts in to the `memory-tools` provider/capability ids;
- app composition can inject a selected `LongTermMemoryToolPort` backed by the selected memory backend.

Tools run only during capability invocation. Tool input schemas must not accept `tenantId`、`subjectId`、`agentId`、owner/user id、path、credential or equivalent scope fields. Trusted scope comes from `RequestContext.identityContext` and `RequestContext.agentId`.

`search_memory` is model-driven retrieval, not an automatic category fan-out planner. When the category is uncertain, the model-facing guidance must prefer one broad search without `categoryFilter`; `purpose` is meaningful only for `USER_CHARACTERISTICS` filtering and is ignored before gateway query construction for other categories.

`add_memory` is a user-directed fast write path. Its model-facing schema may accept narrow convenience shapes that help providers produce valid calls, such as category-less structured content, `FACTUAL` string content, `FACTUAL` claim aliases (`fact`、`text`、`value`), or `PROCEDURAL` plain text / JSON-string input. Before calling the core gateway, `agent-memory` must normalize those inputs to the category-specific `LongTermMemoryRecord.content` contract, preserve procedural body text as `procedureText`, and drop alias or extra model-provided fields. Core gateway contracts and persisted rows remain strict structured memory facts.

Context assembly must not automatically retrieve or inject long-term memory. The model may request memory through the exposed tools; background extraction/aging and maintenance flows use gateway ports or owning service boundaries directly, not model-facing tools.

## Browser Import And Filtered Export

`frontend/agent-web` 拥有长期记忆文件选择、严格解析、transient preview、当前筛选投影和浏览器下载；这些状态刷新或取消即丢失，不进入 localStorage、sessionStorage、runtime lifecycle 或 gateway persistence。local、immersive、collaborative 三种宿主复用同一个 `MemoryManagePage`、`memoryService` 和文件转换 helper，不得形成宿主专属导入或导出语义。

导入只接受不超过 5 MiB、包含 1 至 50 条记录的 UTF-8 JSON。浏览器在任何写请求前执行 fatal UTF-8、顶层 shape、字段 allowlist、枚举、长度、数量和数值边界校验，并把合法内容投影为可删除、可取消、可重新选择的预览。预览期间通过既有个人记忆列表 route 查询 ACTIVE 与 ARCHIVED 的 `CONFIGURED` 总数之和作为已有个人设定记忆数，排除 `LEARNED` 等非个人设定记忆，并显示上限 50、已有数和 `max(0, 50 - existing)` 的可导入数；该容量读取只用于反馈，不替代或阻断服务端最终 50 条容量和安全准入。每次文件成功解析生成新的随机导入批次标识，确认只通过既有 batch route 提交一次当前预览，幂等键由 JSON 契约版本、当前批次标识和原文件元素序号稳定派生；删除前序元素不改变其余元素在当前批次中的键，重新选择字节完全相同或同名的文件建立新批次并使用不同幂等键，网络、5xx 或畸形成功响应保留原集合和当前批次供用户显式精确重试。

导出只读取当前个人记忆 Tab：我的记忆对应 ACTIVE，已归档对应 ARCHIVED，并携带当前搜索、记忆类型、记忆来源和更新方式筛选；从 offset 0、limit 100 开始读取到筛选 total，忽略当前页码。共享记忆库不提供该导出，也不调用共享列表 route。全部分页成功后，浏览器生成带 UTF-8 BOM 的 17 列 CSV；表头、记忆类型、来源和状态跟随当前 locale，中文 `USER_CHARACTERISTICS` 显示为“个性化配置”，API 枚举不变。

CSV 的每个单元格先在 NFKC 检测视图上跳过前导空白、C0/C1 控制字符、零宽/方向格式字符以及字面 `/u0000`、`\\u0000` 标记，再识别半角或全角 `= - + @`。命中值在保留原内容的前提下增加文本前缀，然后执行 CSV quoting，从而阻止兼容表格程序把用户内容解释为公式、命令或超链接。任一分页、转换或下载准备失败时不产生不完整文件。

`agent-channel-web` 继续只对既有个人记忆 list 与 batch routes 执行 runtime schema validation、trusted identity/Agent Scope 注入、AbortSignal 传递和 presentation-safe response；文件 bytes、模板、预览与 CSV 不进入 Web API。`agent-memory`、gateway contract 和 persistence owner 不因浏览器文件能力改变。

管理批量新增通过 `POST /api/v1/memory/long-term-mem/batch` 暴露，每批 1 至 100 条。`agent-channel-web` 先整体校验 `items` 数量和字段 allowlist，再以 trusted identity/Agent resolver 构造唯一 `LongTermMemoryManagementScope`，最后只调用 `LongTermMemoryManagementPort.batchCreateLongTermMemory`；request body 中的 `tenantId`、`subjectId`、`userId` 或 `agentId` 导致请求拒绝，且该可信 scope 应用于批次全部条目。`agent-memory` management service 把每条 `idempotencyKey` 映射到 Gateway write options，按输入顺序逐条复用既有知识安全准入和 50 条 `CONFIGURED` 容量校验，单项失败只计入 `failCount` 并继续后续条目；请求级 scope/取消/存储不可用使整批安全失败。local Gateway 对每项复用 `saveLongTermMemory` 的 scoped anchor、FTS 写入和独立 transaction，使单项失败不回滚其它成功项。`agent-app` 是唯一 composition owner，selected Gateway bindings 可用且 application service 构造成功时才向 Web Channel 注入 management port。

When the memory tool is visible to the model for the accepted Agent, the system prompt may render a policy-only `memory` guidance section (when to recall/save, what not to save, verify-before-acting) to steer tool usage. The section is omitted when the memory tool is not visible, and it never injects memory data — only the memory tools return memory content.

## Task Trajectory

`TaskTrajectoryRecord` is a safe, owner/agent scoped read model projected after terminal commit. It is not a long-term memory record, does not enter `search_memory`, and does not replace session/message/timeline as source of truth.

Runtime only publishes persisted terminal timeline facts through the existing listener mechanism. A local `agent-memory` worker builds trajectories asynchronously and a bounded catch-up query finds committed runs missing trajectories. Builder input is restricted to committed public gateway facts, visible message safe projections, canonical timeline events, tool safe summaries and content refs; it must not persist raw conversation text, raw tool output, attachment content, provider raw response, local path or credentials.

For LLM-assisted extraction, the builder may emit bounded, redacted `REQUEST_FACT` summaries prefixed with `llm-note:` when a visible committed user message contains concise telecom business knowledge that is not rule-ready. `llm-note:` is a safe projection for semantic extraction, not a deterministic memory candidate, and must keep message source refs without copying the full original message.

Task outcome is evidence-based. Terminal commit success does not imply business success. `taskOutcomeStatus=UNKNOWN` and low evidence are valid outcomes and must not be rewritten by later similar trajectories; cross-session corroboration happens later in `LongTermMemoryRecord.sourceTrace`, not by editing old trajectories.

## Extraction

Memory extraction is the local backend dreaming lifecycle. It is default disabled, runs asynchronously from scheduler or controlled trigger, reads only owner/agent scoped `TaskTrajectoryQueryGateway` results, and writes through `LongTermMemoryStoreGateway`. It must not fall back to private session/message DB reads when task trajectory is unavailable.

Extraction strategies are deterministic by default: `RULE_FIRST` runs category-specific rules and calls ordinary LLM fallback only when the eligible cycle has no accepted useful rule candidates. Bounded `llm-note:` semantic projections are LLM-only inputs and may still invoke LLM extraction for those trajectories even when other trajectories in the same cycle produced accepted rule candidates. Runtime metadata such as message counts, timeline event counts, terminal status, lifecycle summaries, capability/tool status and diagnostic-code-only observations are not useful candidates and must not block fallback. `LLM_ONLY` must be explicit. LLM extraction uses the shared prompt template registry with purpose `MEMORY_EXTRACTION`; Agent prompt overrides live under the existing Agent package prompt root and cannot be selected through memory configuration fields such as `promptTemplateIds`.

The LLM extraction prompt projection is narrower than the retained `TaskTrajectoryRecord`: it includes business-safe summaries such as `llm-note:`, explicit definitions, verification and user-confirmation summaries, but excludes runtime-only observations/actions such as Rag/Glob/Grep status, capability lifecycle status and diagnostic-code-only facts. The model-visible extraction prompt must ask human-readable candidate fields to follow the dominant source-summary language, while preserving telecom codes, protocol names, KPI IDs, alarm IDs and standard acronyms exactly.

Candidates are internal extraction facts, not retained memory states. Candidate validation enforces category-specific quality gates, safe `briefIndex`, source trace completeness, confidence range, safe tags and sensitive-trait rejection. LLM self-reported confidence is only a candidate hint; extraction owns the retained confidence and must cap single-cycle LLM candidates conservatively before writing. Accepted new knowledge is projected to `saveLongTermMemory(request, { idempotencyKey })`. Evidence fusion checks existing ACTIVE records using `listLongTermMemory` plus `getLongTermMemory` so it does not mutate recall/access telemetry. Equivalent candidates merge source refs through core save semantics and use `adjustLongTermMemoryConfidence` for bounded corroboration; conflicting or ambiguous evidence is diagnosed and not activated.

Evidence fusion is idempotent by source evidence, not by extraction cycle. `lookbackDays` only selects candidate trajectories; repeated dreaming over the same `sessionId + rootMessageId + runId + sorted messageRefs` source evidence must not create new retained facts or re-raise confidence. New source refs from the same run may extend `sourceTrace.refs`, but confidence corroboration remains reserved for genuinely independent source groups.

## Aging

Memory aging is the local backend lifecycle quality gate. It is default disabled and runs outside request terminal commit. It consumes frozen memory config and the core store gateway only.

Each scheduled cycle uses deterministic order: decay stale ACTIVE entries first, then delete expired ARCHIVED entries. Staleness uses `lastAccessedAt`, which is maintained by L2 detail access. `accessCount` is not an aging rule input in the current baseline. `isPinned=true` entries are exempt from automatic decay/archive/delete.

When confidence decay reaches zero, aging transitions the record to `ARCHIVED` through `transitionLongTermMemoryState(targetState="ARCHIVED", archiveReason="confidence_decayed")`. Retention expiry uses `deleteLongTermMemory` physical delete and does not write delete reason into the retained record.

Archived revival is explicit and narrow. A time-range L1 hit does not revive memory. Only owner-authorized L2 detail access, currently the `get_memory_detail` path when aging is enabled, may call the local revival helper: first read retained ARCHIVED detail through the core retriever, then transition to ACTIVE and apply bounded confidence boost through the store gateway. The helper is not a new gateway contract.

## Observability And Safety

Memory diagnostics, metrics and audit projections must be safe. They may include status, operation, reason code, bounded counts, duration and stable refs; they must not include prompt text, model output, memory content, structured content, raw trait value, tool payload, attachment content, local path, credential, token, raw provider error or raw storage error.

Memory lifecycle failures are explicit diagnostics and must not change request terminal state, stream projection, session history, active context or model-visible context. Observability/audit projection failure must not create a second business state machine; user-characteristics automatic extraction is the narrow exception where a required safe observation path being unavailable prevents treating that specific item as successfully written.

## Verification

Stable verification covers:

- contract tests for core memory gateway, configuration defaults/invalid fields, memory tool schemas, task trajectory records, extraction candidates and aging diagnostics;
- gateway-local tests for owner/agent scope filtering, L1/L2 projection, FTS5 fallback, state transitions, physical delete, task trajectory persistence and dedicated table ownership;
- integration tests for memory tool exposure gates, `add_memory`, `get_memory_detail` archived revival, task trajectory worker, extraction scheduler and aging scheduler;
- frontend tests for JSON boundary validation、transient preview、容量反馈、batch result recovery、current-filter pagination、locale projection and CSV injection defense;
- architecture tests that keep runtime/channel/context/model/capability out of memory lifecycle logic, keep extraction/aging away from memory tools and gateway-local private paths, and keep local schedulers disabled for remote complete-service backend;
- `openspec validate --all --strict` and `npm run lint:architecture`.
