## MODIFIED Requirements

### Requirement: Extraction strategy and configuration

系统 SHALL 支持配置化长期记忆提取策略。默认配置 MUST 启用 extraction 能力；启用后默认策略 MUST 为 `RULE_FIRST`。默认配置 MUST 将 `crossSessionSchedule` 填充为 `0 0 0 * * ?`，表示每天 00:00 触发本地 extraction scheduler。本 change 拥有 `nextAgent.memory.extraction.*` 字段语义；解析、校验、冻结和注入 MUST 通过 memory configuration snapshot 完成，extraction 不得直接读取 raw app config。LLM 提取 MUST 通过 shared prompt template registry / assembler 以 `purpose=MEMORY_EXTRACTION` 解析提取提示词；Agent 覆盖使用既有 Agent package prompt root（如 `agents/<agentId>/prompts/MEMORY_EXTRACTION/template.yaml`），未匹配 Agent 模板时使用内置 `MEMORY_EXTRACTION` 模板。Extraction MUST NOT consume `promptTemplateIds` or `memory-extraction-{lang}` naming conventions. 如果模型边界不可用，LLM 提取返回 explicit degraded/failed 诊断。

Scheduler startup MUST require a frozen `MemoryConfig.status === VALID`, effective `nextAgent.memory.enabled=true`, effective `nextAgent.memory.extraction.enabled=true`, a local memory backend, and a configured `crossSessionSchedule`. `MemoryConfig.status=DISABLED` or `INVALID` MUST prevent local scheduler startup and MUST NOT query task trajectories; `INVALID` MUST produce a safe configuration diagnostic.

**Built-in `MEMORY_EXTRACTION` prompt contract**：内置 fallback prompt MUST 是完整的模型可见提取边界说明，而不是只给出笼统的"valuable knowledge"判断。它 MUST 明确：
- 输入只来自提供给模型的 `TaskTrajectory` 安全投影，不得从 raw message history、隐藏/替换内容、raw prompt、stream delta、provider payload、附件原文、本地路径、credential、secret、raw tool payload 或临时模型输出中提取。
- 允许的 category 仅为 `FACTUAL`、`CONCEPTUAL`、`PROCEDURAL`、`USER_CHARACTERISTICS`，并且每类都要概括对应输入范围、拒绝范围和质量门。
- `PROCEDURAL` 必须要求可复用范围以及 `SUCCEEDED` + `VERIFICATION` / `USER_CONFIRMATION` 证据，或明确可复用的反例诊断；不得从一次性命令、失败流程或未验证流程生成高置信流程记忆。
- `USER_CHARACTERISTICS` 只能提取低敏、与系统行为直接相关、由用户明确表达或多次稳定证据支持且 `purpose` 非空的偏好/习惯/技能/角色线索；必须拒绝敏感个人特征、隐私身份、健康、政治、财务、关系、凭据和附件派生个人信息。
- prompt MUST 要求人类可读字段跟随 source summaries 的主语言；中文来源摘要必须输出中文 `briefIndex` 和中文 content claim/definition，同时保持电信编码、协议名、KPI ID、告警 ID 和标准缩写原样。
- prompt MUST 将模型输出的 `confidence` 视为候选 hint，而不是最终可信度；单周期 LLM 证据不得输出 0.9 及以上高置信度，除非输入投影本身包含重复佐证来源摘要。
- prompt MUST 要求每个 candidate 保留 durable source refs，并禁止输出 raw prompt、raw model output、provider error、stream delta、local path、credential、token、attachment content、raw trait value 或复制的 message text。

Agent-layer `MEMORY_EXTRACTION` prompt MAY override builtin prompt only through the shared prompt registry. 覆盖后的模型可见 prompt MUST preserve the same extraction category, input-boundary, rejection-boundary, and sourceTrace semantics; it MAY add Agent-specific telecom terminology or examples, but MUST NOT add new memory categories, bypass candidate validation, weaken sensitive-trait rejection, or introduce a memory-private prompt loading path.

Product customization MUST be expressed as an Agent-scoped prompt template (for example `agents/<agentId>/prompts/MEMORY_EXTRACTION/template.yaml`) registered through the existing Agent package prompt discovery path. Product or deployment customization MUST NOT directly edit, overwrite, patch, or replace the builtin fallback template under `packages/agent-context-engine/prompt-templates/builtin/MEMORY_EXTRACTION/template.yaml`. Removing or disabling the Agent-scoped template MUST restore fallback to the builtin prompt without requiring code rollback.

**配置契约**：
- `nextAgent.memory.extraction.enabled`：默认 `true`。
- `nextAgent.memory.extraction.strategy`：默认 `RULE_FIRST`（规则优先；eligible trajectory/cycle 的规则 accepted candidate 为 0 时才 LLM 回退）。仅 dreaming 使用。
- `nextAgent.memory.extraction.crossSessionSchedule`：cron 表达式，默认 `0 0 0 * * ?`，每日 00:00 执行。
- `nextAgent.memory.extraction.maxCandidates`：默认 `50`，范围 `[10, 200]`。
- `nextAgent.memory.extraction.timeoutMs`：默认 `60000`，范围 `[10000, 300000]`。
- `nextAgent.memory.extraction.lookbackDays`：默认 `7`，范围 `[1, 30]`。
- `nextAgent.memory.extraction.maxCycleTrajectories`：默认 `20`，范围 `[5, 50]`。

**核心判断逻辑**：
1. 先校验配置 schema 和取值范围。
2. 如果 `MemoryConfig.status=DISABLED`、effective memory disabled 或 extraction disabled，受控触发和 scheduler trigger MUST 返回 `SKIPPED` 诊断。
3. 如果 `MemoryConfig.status=VALID`、effective extraction enabled 且 local memory backend 被选中，本地后台 scheduler MAY 按 `crossSessionSchedule` 创建 scheduled timer 并触发 scheduled extraction cycle；省略 raw `crossSessionSchedule` 时 MUST 使用默认 `0 0 0 * * ?`。
4. `RULE_FIRST` 先运行规则策略，仅在 eligible trajectory/cycle 的规则 accepted candidate 为 0 时调用 LLM。
5. LLM prompt selection calls the shared prompt template assembler with `purpose=MEMORY_EXTRACTION`, current `agentId`, `agentVersion`, extraction locale, normalized flow variables, and selected model. Because dreaming is cron-triggered and not bound to a single request, extraction locale MUST come from the active Agent assembly `runtimeSettings.defaultLanguage`; if absent, extraction MUST pass `undefined` and only locale-neutral templates may match. Normalized flow variables MUST be `{}` in the first implementation and MUST NOT be inferred from historical requests, task trajectory summaries, model output, or configuration snapshot fields. The selected model MUST come from the active Agent assembly default model profile, or the first configured model profile when no default is set, after existing model profile registry validation. Agent-layer templates MAY override builtin templates only through the existing prompt registry mechanism; configuration snapshot fields MUST NOT select prompt templates. Prompt resolution diagnostics MUST NOT contain complete prompt/template content.

#### Scenario: Default configuration schedules extraction at midnight
- **WHEN** 系统使用默认 memory extraction 配置
- **THEN** effective extraction enabled MUST 为 `true`
- **AND** `crossSessionSchedule` MUST 为 `0 0 0 * * ?`
- **AND** local extraction scheduler MAY create a scheduled timer and trigger scheduled extraction cycles at matching midnight windows
- **AND** 受控管理触发或测试触发 MAY 执行 extraction cycle

#### Scenario: Explicit disabled extraction skips all triggers
- **WHEN** `nextAgent.memory.extraction.enabled=false`
- **AND** schedule 或受控触发尝试启动 extraction cycle
- **THEN** 系统 MUST NOT 查询 task trajectories 或写入 memory record
- **AND** 系统 MUST 产生 status=`SKIPPED`、reason=`MEMORY_EXTRACTION_DISABLED` 的安全诊断

#### Scenario: Invalid memory configuration prevents scheduler startup
- **WHEN** app composition has frozen `MemoryConfig.status=INVALID`
- **THEN** local memory extraction scheduler MUST NOT start
- **AND** extraction MUST NOT query task trajectories or write memory records
- **AND** the system MUST record a safe configuration diagnostic

#### Scenario: Configured schedule starts local extraction scheduler
- **WHEN** `MemoryConfig.status=VALID`
- **AND** effective memory enabled 为 `true`
- **AND** effective extraction enabled 为 `true`
- **AND** local memory backend 被选中
- **AND** `nextAgent.memory.extraction.crossSessionSchedule` 配置为受支持的 cron 表达式
- **THEN** 本地 extraction scheduler MAY create a scheduled timer and trigger scheduled extraction cycles

#### Scenario: RULE_FIRST extraction runs rule then LLM if needed
- **WHEN** `nextAgent.memory.extraction.enabled=true`
- **AND** `nextAgent.memory.extraction.strategy=RULE_FIRST`
- **THEN** extraction job MUST 先运行确定性规则提取
- **AND** 规则 accepted candidate 为 0 时调用 LLM
- **AND** 规则已经产生 accepted candidate 时 MUST NOT 调用普通 LLM fallback
- **AND** bounded `llm-note:` semantic projections MAY still invoke LLM extraction for those LLM-only trajectories because they are not rule-ready candidates

#### Scenario: RULE_FIRST ignores non-knowledge runtime metadata
- **WHEN** RULE_FIRST extraction sees only operational TaskTrajectory summaries such as message counts, timeline event counts, terminal status, request lifecycle summaries, capability/tool status, or diagnostic-code-only observations
- **THEN** those summaries MUST NOT be accepted as useful memory candidates
- **AND** they MUST NOT prevent LLM fallback when a model extraction strategy is available
- **AND** safely projected explicit telecom definitions, such as an alarm code meaning with source refs, MAY be accepted as `CONCEPTUAL` candidates

#### Scenario: LLM extraction consumes safe business notes, not runtime noise
- **WHEN** a TaskTrajectory contains bounded `REQUEST_FACT` summaries prefixed with `llm-note:`
- **THEN** deterministic RULE_FIRST extraction MUST NOT turn those summaries directly into rule candidates
- **AND** the absence of accepted useful rule candidates MUST allow LLM fallback when a model extraction strategy is available
- **AND** the LLM prompt input projection MUST include the `llm-note:` business summaries and durable refs
- **AND** the LLM prompt input projection MUST exclude runtime-only observations or actions such as message counts, timeline event counts, terminal status, capability/tool status, diagnostic-code-only summaries, and tool names such as Rag/Glob/Grep when they only describe runtime behavior

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
