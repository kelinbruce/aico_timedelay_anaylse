## ADDED Requirements

### Requirement: Dreaming extraction input boundary

Dreaming 提取 SHALL 只读取当前 scope 下已持久化的 `TaskTrajectory` 安全投影。提取输入不得直接来自 message history、客户端自报 owner 字段、模型临时输出、未提交运行状态、隐藏 retry/edit 替换内容、审计专用内容、raw prompt、stream delta、raw provider response、未授权附件内容或不可读取的大内容原文。

**核心判断逻辑**：
1. 从可信 identity 注入 `tenantId`、`subjectId` 和 `agentId`。
2. 使用 `TaskTrajectoryQueryGateway` 查询 time window 内的 scoped trajectories。
3. 只消费 trajectory 的任务目标、约束、观察、动作序列、结果摘要、`taskOutcomeStatus`、`outcomeEvidenceLevel`、`outcomeEvidenceRefs` 和 source refs。
4. 如果缺少 task trajectory capability、query gateway 不可用或 minimum safe extraction input 无法建立，任务返回 `SKIPPED` 或 `FAILED` 诊断，不得伪装成功。
5. 系统 MUST NOT 回退到私查 session/message DB 或 gateway-local private table。

**状态 / 产物契约**：
- Extraction input set 是基于 `TaskTrajectoryRecord` 的临时处理视图，不是新的权威历史事实。
- 它必须可追溯到 taskTrajectoryId、sessionId、primary root message（core `sourceTrace.requestId`）、runId、message refs 和可选 content refs。
- 它不得被写入用户可见聊天历史或 system prompt。

#### Scenario: Task trajectories are eligible
- **WHEN** dreaming job 建立输入集
- **THEN** 只能选择当前 scope 下已持久化且 query gateway 可返回的 task trajectories
- **AND** 每个候选输入项 MUST 保留 taskTrajectoryId、来源 message ref 或安全 content ref

#### Scenario: Missing task trajectory capability blocks local extraction
- **WHEN** local memory extraction scheduler 启动但 app composition 未提供 `TaskTrajectoryQueryGateway`
- **THEN** extraction MUST NOT read session history or message store directly
- **AND** scheduler MUST return `SKIPPED` or `FAILED` with safe prerequisite diagnostic

#### Scenario: Attachment content unavailable
- **WHEN** 某个 trajectory source ref 指向的附件派生内容不可授权、不可读取或只有 ref 没有安全 projection
- **THEN** extraction job MUST 跳过该附件内容并记录 degraded diagnostic
- **AND** 不得读取 raw local path 或未授权 blob 内容

### Requirement: Extraction strategy and configuration

系统 SHALL 支持配置化长期记忆提取策略。默认配置 MUST 禁用自动提取；启用后默认策略 MUST 为 `RULE_FIRST`。本 change 拥有 `nextAgent.memory.extraction.*` 字段语义；解析、校验、冻结和注入 MUST 通过 memory configuration snapshot 完成，extraction 不得直接读取 raw app config。LLM 提取 MUST 通过 shared prompt template registry / assembler 以 `purpose=MEMORY_EXTRACTION` 解析提取提示词；Agent 覆盖使用既有 Agent package prompt root（如 `agents/<agentId>/prompts/MEMORY_EXTRACTION/template.yaml`），未匹配 Agent 模板时使用内置 `MEMORY_EXTRACTION` 模板。Extraction MUST NOT consume `promptTemplateIds` or `memory-extraction-{lang}` naming conventions. 如果模型边界不可用，LLM 提取返回 explicit degraded/failed 诊断。

Scheduler startup MUST require a frozen `MemoryConfig.status === VALID`, `nextAgent.memory.extraction.enabled=true`, a local memory backend, and a configured `crossSessionSchedule`. `MemoryConfig.status=DISABLED` or `INVALID` MUST prevent local scheduler startup and MUST NOT query task trajectories; `INVALID` MUST produce a safe configuration diagnostic.

**Built-in `MEMORY_EXTRACTION` prompt contract**：内置 fallback prompt MUST 是完整的模型可见提取边界说明，而不是只给出笼统的"valuable knowledge"判断。它 MUST 明确：
- 输入只来自提供给模型的 `TaskTrajectory` 安全投影，不得从 raw message history、隐藏/替换内容、raw prompt、stream delta、provider payload、附件原文、本地路径、credential、secret、raw tool payload 或临时模型输出中提取。
- 允许的 category 仅为 `FACTUAL`、`CONCEPTUAL`、`PROCEDURAL`、`USER_CHARACTERISTICS`，并且每类都要概括对应输入范围、拒绝范围和质量门。
- `PROCEDURAL` 必须要求可复用范围以及 `SUCCEEDED` + `VERIFICATION` / `USER_CONFIRMATION` 证据，或明确可复用的反例诊断；不得从一次性命令、失败流程或未验证流程生成高置信流程记忆。
- `USER_CHARACTERISTICS` 只能提取低敏、与系统行为直接相关、由用户明确表达或多次稳定证据支持且 `purpose` 非空的偏好/习惯/技能/角色线索；必须拒绝敏感个人特征、隐私身份、健康、政治、财务、关系、凭据和附件派生个人信息。
- prompt MUST 要求每个 candidate 保留 durable source refs，并禁止输出 raw prompt、raw model output、provider error、stream delta、local path、credential、token、attachment content、raw trait value 或复制的 message text。

Agent-layer `MEMORY_EXTRACTION` prompt MAY override builtin prompt only through the shared prompt registry. 覆盖后的模型可见 prompt MUST preserve the same extraction category, input-boundary, rejection-boundary, and sourceTrace semantics; it MAY add Agent-specific telecom terminology or examples, but MUST NOT add new memory categories, bypass candidate validation, weaken sensitive-trait rejection, or introduce a memory-private prompt loading path.

Product customization MUST be expressed as an Agent-scoped prompt template (for example `agents/<agentId>/prompts/MEMORY_EXTRACTION/template.yaml`) registered through the existing Agent package prompt discovery path. Product or deployment customization MUST NOT directly edit, overwrite, patch, or replace the builtin fallback template under `packages/agent-context-engine/prompt-templates/builtin/MEMORY_EXTRACTION/template.yaml`. Removing or disabling the Agent-scoped template MUST restore fallback to the builtin prompt without requiring code rollback.

**配置契约**：
- `nextAgent.memory.extraction.enabled`：默认 `false`。
- `nextAgent.memory.extraction.strategy`：默认 `RULE_FIRST`（规则优先；eligible trajectory/cycle 的规则 accepted candidate 为 0 时才 LLM 回退）。仅 dreaming 使用。
- `nextAgent.memory.extraction.crossSessionSchedule`：cron 表达式，默认未设置（关闭）；示例 `0 0 2 * * ?` 每日凌晨 2 点执行。
- `nextAgent.memory.extraction.maxCandidates`：默认 `50`，范围 `[10, 200]`。
- `nextAgent.memory.extraction.timeoutMs`：默认 `60000`，范围 `[10000, 300000]`。
- `nextAgent.memory.extraction.lookbackDays`：默认 `7`，范围 `[1, 30]`。
- `nextAgent.memory.extraction.maxCycleTrajectories`：默认 `20`，范围 `[5, 50]`。

**核心判断逻辑**：
1. 先校验配置 schema 和取值范围。
2. 如果 extraction disabled，返回 `SKIPPED` 诊断。
3. `RULE_FIRST` 先运行规则策略，仅在 eligible trajectory/cycle 的规则 accepted candidate 为 0 时调用 LLM。
4. LLM prompt selection calls the shared prompt template assembler with `purpose=MEMORY_EXTRACTION`, current `agentId`, `agentVersion`, extraction locale, normalized flow variables, and selected model. Because dreaming is cron-triggered and not bound to a single request, extraction locale MUST come from the active Agent assembly `runtimeSettings.defaultLanguage`; if absent, extraction MUST pass `undefined` and only locale-neutral templates may match. Normalized flow variables MUST be `{}` in the first implementation and MUST NOT be inferred from historical requests, task trajectory summaries, model output, or configuration snapshot fields. The selected model MUST come from the active Agent assembly default model profile, or the first configured model profile when no default is set, after existing model profile registry validation. Agent-layer templates MAY override builtin templates only through the existing prompt registry mechanism; configuration snapshot fields MUST NOT select prompt templates. Prompt resolution diagnostics MUST NOT contain complete prompt/template content.

#### Scenario: Default configuration disables extraction
- **WHEN** 系统使用默认 memory extraction 配置
- **THEN** dreaming cron trigger MUST 产生 `SKIPPED` 诊断
- **AND** 不得查询 task trajectories 或写入 memory record

#### Scenario: Invalid memory configuration prevents scheduler startup
- **WHEN** app composition has frozen `MemoryConfig.status=INVALID`
- **THEN** local memory extraction scheduler MUST NOT start
- **AND** extraction MUST NOT query task trajectories or write memory records
- **AND** the system MUST record a safe configuration diagnostic

#### Scenario: RULE_FIRST extraction runs rule then LLM if needed
- **WHEN** `nextAgent.memory.extraction.enabled=true`
- **AND** `nextAgent.memory.extraction.strategy=RULE_FIRST`
- **THEN** extraction job MUST 先运行确定性规则提取
- **AND** 规则 accepted candidate 为 0 时调用 LLM
- **AND** 规则已经产生 accepted candidate 时 MUST NOT 调用 LLM fallback

#### Scenario: Agent extraction prompt overrides builtin through prompt registry
- **WHEN** the active Agent package provides `prompts/MEMORY_EXTRACTION/template.yaml`
- **AND** the template matches the extraction locale, flow variables, and selected model
- **THEN** LLM extraction MUST use the Agent-layer `MEMORY_EXTRACTION` template
- **AND** extraction MUST NOT read `promptTemplateIds` from configuration or Agent assembly
- **AND** it MUST NOT perform additional file loading outside the existing prompt template registry boundary

#### Scenario: Cron extraction uses deterministic prompt assembly inputs
- **WHEN** dreaming cron triggers LLM extraction
- **THEN** extraction locale MUST be the active Agent assembly `runtimeSettings.defaultLanguage`
- **AND** when `runtimeSettings.defaultLanguage` is absent, extraction MUST pass `undefined` instead of deriving locale from trajectories
- **AND** flow variables MUST be an empty object
- **AND** selected model MUST be resolved from the active Agent assembly default model profile, or the first configured model profile when no default exists, through the existing model profile registry
- **AND** extraction MUST NOT add a memory-specific locale, flow-variable, or model-profile configuration path

#### Scenario: Built-in extraction prompt used when Agent prompt is absent
- **WHEN** no Agent-layer `MEMORY_EXTRACTION` template exists or matches
- **AND** LLM extraction is allowed by strategy
- **THEN** extraction MUST use the builtin `MEMORY_EXTRACTION` template
- **AND** it MUST NOT fail or block extraction startup merely because no Agent prompt override exists
- **AND** the builtin template MUST explicitly constrain extraction to the four allowed memory categories, TaskTrajectory safe projection input, category quality gates, source refs, and raw/sensitive content rejection boundaries

#### Scenario: Agent prompt override preserves extraction boundaries
- **WHEN** an Agent-layer `MEMORY_EXTRACTION` template overrides the builtin template
- **THEN** prompt assembly MAY select the Agent-layer template through the shared prompt registry
- **AND** the template MUST preserve the same four allowed categories, input boundary, rejection boundary, sourceTrace requirement, and sensitive user-characteristics limits
- **AND** it MUST NOT add a memory-private prompt loader, `promptTemplateIds`, or `memory-extraction-{lang}` selection path
- **AND** the override MUST live in the Agent package prompt root, not by modifying the builtin fallback template

#### Scenario: Removing Agent prompt override restores builtin fallback
- **WHEN** an Agent previously had `prompts/MEMORY_EXTRACTION/template.yaml`
- **AND** that Agent-scoped template is removed, disabled, or no longer matches the prompt assembly request
- **THEN** LLM extraction MUST fall back to the builtin `MEMORY_EXTRACTION` template
- **AND** product rollback MUST NOT require editing framework-owned builtin prompt files

#### Scenario: Extraction prompt resolution failure is safe
- **WHEN** prompt registry / assembler cannot resolve a unique `MEMORY_EXTRACTION` template
- **OR** multiple matching `MEMORY_EXTRACTION` templates in the same source layer have equal highest specificity
- **THEN** extraction MUST fail or skip the LLM portion with a safe prompt resolution diagnostic
- **AND** diagnostics MUST NOT include complete prompt/template content
- **AND** extraction MUST NOT fall back to `promptTemplateIds`, raw file reads, or `memory-extraction-{lang}` naming

### Requirement: Extraction candidate quality contract

系统 SHALL 将提取结果表达为 memory extraction candidate。每个 candidate 必须通过结构、质量、去重和安全校验后，才可以写入长期记忆。未通过校验的 candidate 必须产生 rejection diagnostic，不得静默丢弃。

**候选契约**：
- `category` 必须为 `FACTUAL`、`CONCEPTUAL`、`PROCEDURAL` 或 `USER_CHARACTERISTICS`。
- `content` 必须符合 `add-ts-memory-core` 定义的 category-specific structured content contract：`FACTUAL(subject, claim, evidence?, qualifiers?)`、`CONCEPTUAL(concept, definition, aliases?, relatedConcepts?)`、`PROCEDURAL(procedureName, non-empty steps, preconditions?, verification?, pitfalls?)` 或 `USER_CHARACTERISTICS(non-empty traits, non-empty purpose[])`。
- `briefIndex` 必须是安全短摘要，最大 100 字符。
- `confidence` 必须在 `[0, 1]`，默认初始值为 `0.5`。
- `tags` 必须只包含安全、低基数字段。
- `sourceTrace` 必须至少包含 `sessionId`、primary root message（映射为 core `sourceTrace.requestId`）、`runId` 和 contributing message refs；重复来源引用中的 root message 使用 `sourceTrace.refs[].rootMessageId`。
- `strategyProvenance` 必须记录候选来自规则、LLM 或合并策略。
- 写入前的 candidate projection 必须生成与 core 兼容的 write request：包含 core-defined category、category-specific structured content、`confidence`、`tags`、`briefIndex` 和 `sourceTrace`。首次写入的 `longTermMemoryId` 由 memory core/gateway 生成；同一 scope、同一 extraction job、同一候选语义在重复触发时 MUST 生成同一稳定 `idempotencyKey`，并通过 `saveLongTermMemory(request, IdempotentWriteOptions)` 作为写入 metadata 传递，不得放入 request 或 record。

**核心判断逻辑**：
1. 校验 category 和结构化 content。
2. 校验 sourceTrace 完整性。
3. 校验 briefIndex 和 tags 安全性。
4. 校验 confidence 范围。
5. 对同一 extraction job 内候选执行批内去重。
6. 将合格 candidate 投影为 core-compatible write request 并生成稳定 write identity；如果无法生成稳定 `idempotencyKey` 或 core-compatible content，则拒绝该 candidate 并记录 `CORE_WRITE_PROJECTION_INVALID`。
7. 调用 `LongTermMemoryStoreGateway.saveLongTermMemory`（以下简称 `store.saveLongTermMemory`）执行 scope 匹配的写入；最终 record 语义以 memory core 为准。

#### Scenario: Valid procedural candidate is written
- **WHEN** extraction job 从可见会话事实中提取一个有效 `PROCEDURAL` candidate
- **AND** candidate 包含步骤、适用条件、验证方式和 sourceTrace
- **THEN** 系统 MUST 通过 store.saveLongTermMemory 写入该 candidate
- **AND** 写入结果 MUST 可追溯到原始 session/run/message refs
- **AND** 重复处理同一候选 MUST 使用同一稳定 write identity（`IdempotentWriteOptions.idempotencyKey`）

#### Scenario: Candidate cannot be projected to core write request
- **WHEN** candidate 已通过提取策略输出但无法生成稳定 write identity 或无法映射为 core-defined structured content
- **THEN** candidate MUST 被拒绝
- **AND** extraction diagnostic MUST 记录 rejection reason `CORE_WRITE_PROJECTION_INVALID`
- **AND** 不得调用 store.saveLongTermMemory

#### Scenario: Candidate without source trace is rejected
- **WHEN** extractor 产生 candidate 但缺少 `sessionId`、`runId` 或 contributing message refs
- **THEN** candidate MUST 被拒绝
- **AND** extraction diagnostic MUST 记录 rejection reason `SOURCE_TRACE_MISSING`
- **AND** 不得写入 memory record

#### Scenario: Candidate batch exceeds max candidates
- **WHEN** extractor 产生的候选数量超过 `nextAgent.memory.extraction.maxCandidates`
- **THEN** 系统 MUST 按确定性排序保留不超过配置上限的候选
- **AND** 记录 `CANDIDATE_LIMIT_REACHED` 诊断和被丢弃数量
- **AND** 不得静默丢弃

### Requirement: Category-specific extraction matrix

系统 SHALL 按长期记忆 category 的不同语义执行不同的生成流程。Category MUST 作为 extraction 规则入口，而不只是写入标签。每类候选必须满足对应输入范围、拒绝范围、质量门、融合规则和使用方式；不符合矩阵的候选 MUST 被拒绝并产生安全诊断。

**矩阵契约**：
- `FACTUAL`：输入来自 task trajectory 中的环境事实、配置值、约束、版本、SLA、拓扑事实；拒绝临时值、未确认推断、敏感凭据和日志原文；质量门要求至少一个明确 source ref、`subject` + `claim` 完整且可安全摘要；同 subject + claim 等价则融合，冲突则诊断不写 ACTIVE；使用方式是后续事实回忆。
- `CONCEPTUAL`：输入来自多个 trajectory 或多个事实归纳出的术语、架构概念、领域定义；拒绝单次模糊解释、公共常识和无业务上下文定义；质量门要求多个事实支撑或用户明确定义且 `definition` 清晰；concept/alias 相同且 definition 等价则融合，相似不等价则诊断；使用方式是解释和上下文理解。
- `PROCEDURAL`：输入来自 trajectory 中的动作序列、排障步骤、检查清单和验证方式；拒绝一次性命令、失败流程、`taskOutcomeStatus=UNKNOWN` 且缺少强验证的步骤；质量门要求 `steps` 非空、有适用范围或触发条件，并且 `taskOutcomeStatus=SUCCEEDED` 且 `outcomeEvidenceLevel=VERIFICATION` 或 `USER_CONFIRMATION`，或包含明确可复用反例诊断；procedureName/目标相同且步骤兼容则融合，步骤冲突则诊断；使用方式是后续操作建议和流程复用。
- `USER_CHARACTERISTICS`：输入来自用户明确偏好、多次稳定表达的低敏工作习惯、术语偏好、技能水平；拒绝敏感属性、身份隐私、健康/政治/财务和单次弱推断；质量门要求低敏、与系统行为直接相关、明确表达或多次稳定出现且 `purpose` 非空；traitName + purpose 相同则融合，冲突偏好不自动覆盖；使用方式只允许 purpose-scoped `search_memory`。

#### Scenario: Procedural candidate without verification is rejected
- **WHEN** extraction 从 task trajectory 中发现一组一次性命令
- **AND** trajectory 没有 `SUCCEEDED` outcome、`VERIFICATION` / `USER_CONFIRMATION` evidence 或可复用适用条件
- **THEN** extraction MUST NOT create a `PROCEDURAL` candidate
- **AND** diagnostic MUST record `CATEGORY_QUALITY_GATE_REJECTED`

#### Scenario: Unknown outcome limits extraction strength
- **WHEN** task trajectory 的 `taskOutcomeStatus=UNKNOWN`
- **AND** `outcomeEvidenceLevel` is `NONE` or `MODEL_CLAIM`
- **THEN** extraction MAY create low-risk `FACTUAL` or explicit `USER_CHARACTERISTICS` candidates when other quality gates pass
- **AND** extraction MUST NOT create high-confidence `PROCEDURAL` candidate from that trajectory

#### Scenario: Factual conflict is diagnosed but not activated
- **WHEN** `FACTUAL` candidate 与已有同 subject 的 ACTIVE memory claim 冲突
- **THEN** extraction MUST NOT create a new ACTIVE record
- **AND** extraction MUST record a safe conflict diagnostic with source refs only

### Requirement: UserCharacteristics extraction safety

系统 SHALL 对 `USER_CHARACTERISTICS` 自动提取施加更严格的安全边界。只能提取低敏、证据充分、与系统行为直接相关的用户偏好、技能水平、工作流习惯或语言/术语偏好；不得自动沉淀敏感个人特征、凭据、隐私身份属性、健康、政治、财务、私人关系或附件原文中的个人信息。提取开关统一由 `nextAgent.memory.extraction.enabled` 控制。

**核心判断逻辑**：
1. 判断 trait 是否属于允许类别。
3. 判断 trait 是否由用户明确表达或多个可见事实支持。
4. 判断 trait value 是否包含敏感内容或 raw personal data。
5. 高风险或敏感 trait 必须被拒绝；需要用户确认的 trait 不得由本 change 自动写入。

**状态 / 产物契约**：
- 自动提取的 user trait 仍是 memory record，不是 identity、权限或认证事实。
- trait 消费必须继续通过 purpose-scoped retrieval 或后续受控流程，不得默认进入 system prompt。
- audit、日志和 metric 只能记录 trait name/ref、purpose/reason code 和计数，不得记录 raw trait value。

#### Scenario: Low-sensitivity preference is accepted
- **WHEN** 用户在可见对话中明确表达“后续回答优先使用中文”
- **THEN** 系统可以生成低敏语言偏好 candidate
- **AND** candidate MUST 包含 sourceTrace 和 confidence

#### Scenario: Sensitive personal trait is rejected
- **WHEN** extractor 产生涉及凭据、健康、财务、政治、私人关系或其他敏感个人属性的 trait
- **THEN** 系统 MUST 拒绝该 candidate
- **AND** 不得在日志、audit 或 SafeError 中记录 raw trait value

### Requirement: Dreaming cross-session extraction and knowledge fusion

系统 SHALL 通过 cron 定时 dreaming 周期执行完整的长期记忆提取和跨会话知识融合。dreaming 是知识提取的唯一完整路径——在此执行策略提取、候选校验、跨会话融合和写入。dreaming 不得定义 promotion、decay、curator 或 aging 生命周期；confidence 融合仅限跨会话 corroboration，不改变 confidence lifecycle 状态机。

Evidence fusion MUST use the core gateway paths exactly: append new extraction source refs by calling `store.saveLongTermMemory` with the existing `longTermMemoryId` and the new `sourceTrace.refs`; the core gateway owns deterministic sourceTrace merge and `extractionCount` increment. Confidence corroboration MUST use `store.adjustLongTermMemoryConfidence`; extraction MUST NOT update confidence by partial-update through `saveLongTermMemory`, direct storage writes, or memory tools. Candidate matching, conflict disambiguation, candidate rejection, and confidence corroboration belong to dreaming / extraction and MUST NOT be performed by model-facing `add_memory`.

**触发机制**：
1. 通过 `nextAgent.memory.extraction.crossSessionSchedule`（cron 表达式）定时触发。周期任务查询 `lookbackDays` 天内同 scope、已持久化且可读取的 task trajectories。
2. 默认在系统低负载时段执行（建议 `0 0 2 * * ?`）。执行期间不得阻塞当前请求，后台超时后自动取消未完成步骤。
3. 提取统一在 dreaming cron 中执行，不在对话过程中触发。

**输入与前置条件**：
- 同 scope（`tenantId`、`subjectId`、`agentId`）下的已持久化 `TaskTrajectoryRecord`。`taskOutcomeStatus=UNKNOWN` 的 trajectory 仍可作为低风险事实证据输入，但不得单独支持高置信 `PROCEDURAL` 写入。
- 回看范围：通过 `TaskTrajectoryQueryGateway` 获取 `sinceTime` 到 `untilTime` 范围内可读取的 task trajectories。若当前 contract 无法表达该查询，extraction 实施 MUST block，并通过 `add-ts-task-trajectory` 或 owning contract refinement change 补齐，不得私查 DB 或复用不匹配的 public session/message query。
- 只读取 task trajectory 的安全摘要和 source refs；排除与单次提取相同的不可用 content ref。
- 单次 cycle 最多处理 `maxCycleTrajectories`（默认 20）个 trajectories。

**输出与副作用**：
- 对每条 trajectory 独立运行提取策略，产出 extraction candidate 列表。
- 跨会话聚合：相同 scope 下，按 category-specific identity / equivalence key 对 candidate 去重并生成包含多个 sourceTrace refs 的 candidate。candidate 是 dreaming 内部证据对象，不进入 `search_memory`，不作为 `LongTermMemoryRecord` 的 `ACTIVE` / `ARCHIVED` retained state。
- 写入前对已有 memory record 做融合检测：先用 core public `listLongTermMemory(categoryFilter=category, stateFilter=ACTIVE, limit=maxCandidates)` 获取同类 L1 候选，再用 `getLongTermMemory` 和 category-specific structured content 规则判断等价、冲突或无法判定。不得使用 `searchLongTermMemory` 或 `getLongTermMemoryDetail` 做后台融合候选查找，因为它们会产生 recall/access 统计副作用。只有结构化等价时才执行**证据融合**而非新建——在已有条目上追加 sourceTrace refs、更新 `updatedAt`；对置信度执行受控**corroboration 提升**（+0.1，最多 2 次 corroboration，cumulative max +0.2）。同 identity 但不等价、冲突或证据不足以构成独立条目时不得创建 ACTIVE record，必须记录安全诊断。
- 若没有同类候选，或结构化规则明确证明 candidate 与已检索候选无关且无冲突，直接通过 `store.saveLongTermMemory` 创建新 memory record。
- 产生 extraction cycle 诊断，包含 trajectory 数、候选数、新增数、融合数、拒绝数和 durationMs。

**核心判断逻辑**：
1. 周期触发时，通过 `TaskTrajectoryQueryGateway` 查询符合回看范围的 trajectory 列表。
2. 排除不可读取、跨 scope、缺少安全摘要或 source refs 不完整的 trajectory。
3. 对每条 trajectory 独立运行提取策略（RULE_FIRST 默认），产出 per-trajectory candidates。
4. 跨会话去重：同一 scope 下相同类别且 category-specific identity / equivalence key 相同的 candidate 合并为一条，保留所有 sourceTrace refs。
5. 查询已有 memory record：通过 core public `listLongTermMemory(categoryFilter=category, stateFilter=ACTIVE, limit=maxCandidates)` 在当前 scope 和 category 下获取 L1 候选；对可能匹配的候选 id 使用 `getLongTermMemory` 读取结构化 content，再做等价/冲突判断。
6. 若已有条目与 candidate 在 category-specific structured content 上等价 → **证据融合**：通过 memory core 明确允许的 update path 追加 sourceTrace refs；若 corroboration 次数未达上限，则通过 memory core 明确的 confidence adjustment path 将 confidence += 0.1。
7. 若没有同类候选，或结构化规则明确证明 candidate 与已检索候选无关且无冲突 → 通过 `store.saveLongTermMemory` 创建新条目。
8. 若候选与已有条目同 identity 但结构化 content 不等价 / 冲突 → 不融合也不新建，记录 `CROSS_SESSION_CONFLICTING_EVIDENCE` 诊断供运维审查。
9. 若检索到了同类候选但 category-specific 规则无法证明等价、无关或冲突 → 不融合也不新建，记录 `CROSS_SESSION_AMBIGUOUS` 诊断供运维审查。
10. 若同类候选数量达到 `maxCandidates` 上限且仍无法证明 candidate 是新知识 → 不新建，记录 `FUSION_SCAN_LIMIT_REACHED` 诊断，等待后续 cycle 或独立查询 refinement。

**状态 / 产物契约**：
- 融合后的 memory record 保留原有 `longTermMemoryId`，追加 sourceTrace refs（不覆盖原 refs），`updatedAt` 更新为当前时间。
- 空融合 batch 或多会话循环空 batch 返回 `SKIPPED` + reason `NO_CROSS_SESSION_CANDIDATES`，不记录为错误。
- 跨 session 融合不改变 memory record 的 `state`（ACTIVE/ARCHIVED），不执行 promotion、aging、physical delete 或 curator 状态转换。
- 跨 trajectory 融合不得修改既有 `TaskTrajectoryRecord` 的 `taskOutcomeStatus`、`outcomeEvidenceLevel` 或摘要；后续验证证据只能通过新的 trajectory source refs 融合到长期记忆。
- diagnostic 和 audit 不包含跨 session 消息原文或用户输入内容。

#### Scenario: Cross-trajectory extraction discovers new knowledge
- **WHEN** 周期任务查询最近 7 天同 scope 的 5 条 task trajectories
- **AND** 其中 2 条 trajectory 包含同一网络术语解释但尚未有对应 memory record
- **THEN** 系统 MUST 生成一条包含 2 个 sourceTrace refs 的 `CONCEPTUAL` candidate 并写入新条目
- **AND** extraction diagnostic MUST 显示 `newCount=1`, `fusedCount=0`

#### Scenario: Cross-session evidence fusion boosts confidence
- **WHEN** 跨会话提取生成一条 candidate，且它与已有 memory record `E1`（confidence=0.5）在 category-specific structured content 上等价
- **AND** `E1` 尚未达到 corroboration 上限（< 2 次）
- **THEN** extraction MUST 不创建新条目
- **AND** sourceTrace refs MUST be appended through `store.saveLongTermMemory(existing longTermMemoryId, sourceTrace refs...)`
- **AND** core MUST increment `extractionCount` when new extraction refs are appended
- **AND** `E1.confidence` MUST 通过 memory core confidence adjustment path 更新为 0.6（+0.1）
- **AND** `updatedAt` MUST 更新
- **AND** extraction diagnostic MUST 显示 `fusedCount=1`, `newCount=0`

#### Scenario: Corroboration limit reached stops further boosting
- **WHEN** 已有 memory record `E1` 已达到 2 次 corroboration 上限
- **AND** 跨会话提取再次发现相似 evidence
- **THEN** extraction MAY 追加 sourceTrace refs 但不提升 confidence
- **AND** extraction diagnostic MUST 记录 `CORROBORATION_LIMIT_REACHED`

#### Scenario: Later verified trajectory corroborates memory without rewriting old trajectory
- **WHEN** trajectory `T1` 曾因 `taskOutcomeStatus=UNKNOWN` 只生成低置信 `FACTUAL` memory `M1`
- **AND** later trajectory `T2` in the same scope has equivalent knowledge with `taskOutcomeStatus=SUCCEEDED` and `outcomeEvidenceLevel=VERIFICATION`
- **THEN** extraction MUST NOT update `T1.taskOutcomeStatus`
- **AND** extraction MUST append `T2` source refs to `M1` through memory core merge path when content is equivalent
- **AND** extraction MAY perform bounded confidence corroboration through `store.adjustLongTermMemoryConfidence`

#### Scenario: Later verified trajectory creates procedural memory skipped before
- **WHEN** trajectory `T1` had `taskOutcomeStatus=UNKNOWN` and did not create `PROCEDURAL` memory
- **AND** later trajectory `T2` contains compatible steps and `VERIFICATION` evidence
- **THEN** extraction MAY create a new `PROCEDURAL` memory from `T2`
- **AND** extraction MUST NOT treat the absence of a `PROCEDURAL` record from `T1` as a failure

#### Scenario: Ambiguous candidate neither fused nor created
- **WHEN** candidate 检索到同类已有条目
- **AND** category-specific rules cannot prove equivalence, unrelatedness, or conflict
- **THEN** 该 candidate MUST NOT 被融合也不创建新条目
- **AND** extraction diagnostic MUST 记录 `CROSS_SESSION_AMBIGUOUS` 及 candidate briefIndex

#### Scenario: Conflicting evidence is not activated by dreaming
- **WHEN** candidate 与已有 `ACTIVE` memory record 属于同一 scope 和 category
- **AND** 它们的 structured content 指向同一 subject/key 但关键值冲突或相似但不等价
- **THEN** extraction MUST NOT create a new `ACTIVE` memory record
- **AND** extraction MUST NOT overwrite or delete the existing memory record
- **AND** extraction diagnostic MUST record `CROSS_SESSION_CONFLICTING_EVIDENCE` with safe refs only
- **AND** any later resolution MUST be handled by maintenance, user-management, or another owning change

#### Scenario: Cross-scope aggregation is forbidden
- **WHEN** 跨会话提取查询到其他 `tenantId`、`subjectId` 或 `agentId` 的会话事实
- **THEN** 这些事实 MUST 被排除
- **AND** 系统 MUST 记录安全诊断
- **AND** 不得产生跨 scope candidate

#### Scenario: Extraction does not perform lifecycle promotion
- **WHEN** 跨会话证据融合提升了 entry 的 confidence
- **THEN** confidence 提升仅限于 corroboration（+0.1，上限 +0.2）
- **AND** extraction MUST NOT 执行 promotion 标记、aging 状态转换或 curator 生命周期操作

### Requirement: Extraction observability audit and safe diagnostics

系统 SHALL 为长期记忆提取提供可审计、可诊断且脱敏的观测结果。每个 extraction job 必须产生结构化诊断；成功写入、候选拒绝、安全拒绝、依赖不可用、超时和部分成功必须可追踪。任何日志、metric、audit、SafeError 或诊断不得包含 raw prompt、模型输出、stream delta、raw provider error、路径、credential、token、附件内容、raw trait value 或高基数字段。

User-characteristics writes and user-characteristics safety rejections use a stricter automatic-extraction observability policy than model-facing memory tools: if the existing audit/observability event path required for that user-characteristics item is unavailable, the item MUST NOT be treated as successfully written. The job MUST skip the affected write or mark the cycle `PARTIAL` with a safe diagnostic, and MUST NOT leak raw trait value.

**输出与副作用**：
- metric 至少按 job count、candidate accepted/rejected count、write success/failure count、durationMs、strategy、status 聚合。
- audit 只在产生长期记忆写入或用户特征相关安全事件时记录。
- 用户特征相关写入或安全拒绝的现有 audit/observability event path 不可用时，job MUST NOT treat the item as successfully written; it MUST skip the affected write or mark the cycle `PARTIAL` with safe diagnostic，且不得泄漏 raw trait value。
- diagnostic refs 可以被运维或测试消费，但不得成为 request terminal truth。

#### Scenario: Completed job emits safe diagnostics
- **WHEN** extraction job 完成并写入 3 条 memory records
- **THEN** 系统 MUST 记录 job status、durationMs、acceptedCount、rejectedCount、writtenCount 和 strategy
- **AND** 诊断不得包含原始对话文本、模型输出或附件内容

#### Scenario: Partial job is observable
- **WHEN** 规则提取成功但部分候选写入失败
- **THEN** extraction job MUST 返回 `PARTIAL` 诊断
- **AND** 诊断 MUST 包含安全 reason code 和失败计数
- **AND** 已成功写入的 memory records 不得被报告为失败

#### Scenario: Audit excludes raw trait value
- **WHEN** extraction 写入一个用户特征 memory record
- **THEN** audit event MUST 只包含 tenantId、subjectId、entry ref、trait name 或 safe category、source refs 和 occurredAt
- **AND** audit event MUST NOT 包含 raw trait value

### Requirement: Extraction failure and degradation semantics

长期记忆提取 SHALL 对失败和降级给出明确结果。超时、取消、memory disabled、memory store unavailable、task trajectory query failure、content ref unavailable、model unavailable、schema invalid、candidate unsafe 或超预算时，不得静默截断、静默丢弃或静默吞错。提取失败不得影响主请求 terminal state。

`MemoryConfig.status=INVALID` is a startup/configuration failure for local extraction: the scheduler MUST NOT start, MUST NOT query task trajectories, and MUST record a safe configuration diagnostic. `MemoryConfig.status=DISABLED` and `nextAgent.memory.extraction.enabled=false` are disabled/skipped states, not partial extraction success.

**失败与降级规则**：
1. `nextAgent.memory.extraction.enabled=false`：任务 `SKIPPED`，reason `EXTRACTION_DISABLED`。
2. memory core disabled：任务 `SKIPPED` 或 `FAILED`，reason `LTM_DISABLED`，不得写入。
3. task trajectory query failure：任务 `FAILED`，reason `EXTRACTION_INPUT_UNAVAILABLE`。
4. content ref unavailable：跳过该 content ref，任务 `PARTIAL`，reason `CONTENT_REF_UNAVAILABLE`。
5. timeout：任务 `FAILED` 或 `PARTIAL`，reason `MEMORY_EXTRACTION_TIMEOUT`。
6. cancellation：停止未完成步骤，任务 `FAILED` 或 `PARTIAL`，reason `MEMORY_EXTRACTION_CANCELED`。
7. model unavailable：LLM 相关策略返回 `FAILED` 或回退规则策略并标记 `PARTIAL`。
8. unsafe candidate：拒绝 candidate，reason `CANDIDATE_UNSAFE`。
9. result over budget：拒绝超预算候选或任务，reason `EXTRACTION_BUDGET_EXCEEDED`。

#### Scenario: Task trajectory read failure does not change request terminal state
- **WHEN** extraction job 无法读取 task trajectories
- **THEN** job MUST 记录 `FAILED` 诊断
- **AND** 原 RequestRun terminal state MUST 不变
- **AND** 不得写入 memory record

#### Scenario: Timeout produces explicit diagnostic
- **WHEN** extraction job 超过 `nextAgent.memory.extraction.timeoutMs`
- **THEN** 系统 MUST 停止或取消剩余提取步骤
- **AND** 记录 reason `MEMORY_EXTRACTION_TIMEOUT`
- **AND** 不得继续在后台无界运行

#### Scenario: Store unavailable
- **WHEN** candidate 已通过校验但 store.saveLongTermMemory 不可用
- **THEN** job MUST 记录 `FAILED` 或 `PARTIAL` 诊断，reason `LTM_STORAGE_UNAVAILABLE`
- **AND** 不得把未写入 candidate 报告为已沉淀长期记忆

### Requirement: Extraction architecture boundaries

系统 SHALL 保持长期记忆提取与架构和核心契约一致。Runtime 只拥有 request lifecycle 和 terminal commit，不拥有提取语义；Context Engine 不自动执行长期记忆提取；Capability tools 不作为后台提取入口；Channel 不投影提取过程为用户可见请求流；提取不得重新定义 memory core DTO、state、owner scope、ranking、storage schema 或 tool behavior。本 requirement 只适用于 local memory backend；remote complete-service backend 下 extraction lifecycle 由远端长期记忆服务拥有，本地 scheduler、candidate validator、fusion writer 和本地 extraction 观测投影 MUST NOT 启动，除非后续 remote adapter owning change 显式定义本地薄适配职责。

Local extraction orchestration MAY live in the `agent-memory` extraction submodule, but only as scheduler / strategy / validator / fusion orchestration. It MUST NOT wrap, re-export, or replace `LongTermMemoryStoreGateway` / `LongTermMemoryRetrieverGateway`; it MUST NOT import gateway-local, SQLite, FTS5, `LongTermMemoryToolPort`, Tool SPI metadata, memory tool descriptors, memory tool implementation, capability executor, or `CapabilityInvocation`. The `agent-memory` memory tools provider/factory owned by `add-ts-memory-tools` is a separate submodule and MUST NOT be used by extraction.

#### Scenario: Runtime does not own extraction semantics
- **WHEN** dreaming cron 触发 extraction
- **THEN** extraction 判断、候选生成和写入编排 MUST 属于 memory lifecycle boundary
- **AND** runtime MUST NOT 拥有提取判断逻辑

#### Scenario: Remote complete-service backend disables local extraction
- **WHEN** app composition selects remote complete-service memory backend
- **THEN** local extraction scheduler and candidate/fusion/write orchestration MUST NOT start
- **AND** extraction lifecycle MUST be owned by the remote memory service or by a later remote adapter owning change

#### Scenario: Context assembly is unchanged
- **WHEN** 实现 memory extraction
- **THEN** Context Engine MUST NOT 因该 change 自动检索、注入或提升长期记忆
- **AND** extraction result MUST NOT 修改 system prompt、active context view 或 selected context refs

#### Scenario: Memory tools are not background extraction
- **WHEN** extraction job 需要写入 memory record
- **THEN** 它 MUST 使用 store.saveLongTermMemory
- **AND** 不得通过模型可调用 `add_memory` tool 或 capability invocation 伪装为后台提取

#### Scenario: Agent-memory is orchestration only
- **WHEN** local backend implements memory extraction
- **THEN** `agent-memory` MAY contain scheduler, strategy, validator, and fusion orchestration
- **AND** it MUST consume only public core gateway ports injected by app composition
- **AND** it MUST NOT wrap or re-export core gateway ports, import `LongTermMemoryToolPort`, or depend on capability executor / memory tool descriptors / memory tool implementation

#### Scenario: No competing memory contract
- **WHEN** extraction 需要表达 candidate、write result 或 diagnostic
- **THEN** 它 MUST 与 `add-ts-memory-core` 的 memory entry、owner scope、SafeError 和 write boundary 对齐
- **AND** 不得定义竞争性的 memory record state、owner DTO、ranking 或 storage schema

