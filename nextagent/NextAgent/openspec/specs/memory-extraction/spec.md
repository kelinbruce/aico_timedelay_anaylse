# memory-extraction Specification

## Purpose
定义从请求轨迹提取长期记忆的输入边界、生成结果和失败降级行为，使异步记忆提取不会改变主请求的 terminal commit。

## Function

- **所属 Function**：`FN-8.3 记忆提取和老化`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## Requirements
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

系统 SHALL 支持配置化长期记忆提取策略。默认配置 MUST 启用 extraction 能力；启用后默认策略 MUST 为 `RULE_FIRST`。默认配置 MUST 将 `crossSessionSchedule` 填充为 `0 0 0 * * ?`，表示每天 00:00 产生 scheduled extraction trigger。系统 MUST 按本 Requirement 定义 `nextAgent.memory.extraction.*` 字段语义；extraction MUST 只消费已校验并冻结的 memory configuration snapshot。LLM 提取 MUST 通过 shared prompt template registry/assembler 以 `purpose=MEMORY_EXTRACTION` 解析提取提示词；Agent 覆盖使用既有 Agent package prompt root（如 `agents/<agentId>/prompts/MEMORY_EXTRACTION/template.yaml`），未匹配 Agent 模板时使用内置 `MEMORY_EXTRACTION` 模板。Extraction MUST NOT 消费 `promptTemplateIds` 或 `memory-extraction-{lang}` 命名约定。模型边界不可用时，LLM 提取 MUST 返回明确的 degraded/failed 诊断。

Scheduled extraction activation MUST 要求 frozen `MemoryConfig.status === VALID`、effective `nextAgent.memory.enabled=true`、effective `nextAgent.memory.extraction.enabled=true`、已选择 local memory backend 和已配置 `crossSessionSchedule`。`MemoryConfig.status=DISABLED` 或 `INVALID` MUST 阻止 scheduled trigger，且 MUST NOT 查询 task trajectories；`INVALID` MUST 产生安全 configuration diagnostic。

**Built-in `MEMORY_EXTRACTION` prompt contract**：内置 fallback prompt MUST 是完整的模型可见提取边界说明，而不是只给出笼统的"valuable knowledge"判断。它 MUST 明确：
- 输入 MUST 只来自提供给模型的 `TaskTrajectory` 安全投影，MUST NOT 从 raw message history、隐藏/替换内容、raw prompt、stream delta、provider payload、附件原文、本地路径、credential、secret、raw tool payload 或临时模型输出中提取。
- category MUST 只包含 `FACTUAL`、`CONCEPTUAL`、`PROCEDURAL`、`USER_CHARACTERISTICS`，并且每类 MUST 概括对应输入范围、拒绝范围和质量门。
- `PROCEDURAL` MUST 要求可复用范围以及 `SUCCEEDED` + `VERIFICATION` / `USER_CONFIRMATION` 证据，或明确可复用的反例诊断；MUST NOT 从一次性命令、失败流程或未验证流程生成高置信流程记忆。
- `USER_CHARACTERISTICS` MUST 只提取低敏、与系统行为直接相关、由用户明确表达或多次稳定证据支持且 `purpose` 非空的偏好/习惯/技能/角色线索；MUST 拒绝敏感个人特征、隐私身份、健康、政治、财务、关系、凭据和附件派生个人信息。
- prompt MUST 要求人类可读字段跟随 source summaries 的主语言；中文来源摘要 MUST 输出中文 `briefIndex` 和中文 content claim/definition，同时保持电信编码、协议名、KPI ID、告警 ID 和标准缩写原样。
- prompt MUST 将模型输出的 `confidence` 视为候选 hint，而不是最终可信度；单周期 LLM 证据 MUST NOT 输出 0.9 及以上高置信度，除非输入投影本身包含重复佐证来源摘要。
- prompt MUST 要求每个 candidate 保留 durable source refs，并 MUST NOT 输出 raw prompt、raw model output、provider error、stream delta、local path、credential、token、attachment content、raw trait value 或复制的 message text。

匹配的 Agent-layer `MEMORY_EXTRACTION` prompt MUST 只通过 shared prompt registry 覆盖 builtin prompt。未配置或未匹配 Agent-layer prompt 时 MUST 使用 builtin prompt。覆盖后的模型可见 prompt MUST 保持相同的 extraction category、input boundary、rejection boundary 和 sourceTrace 语义；它 MAY 增加 Agent-specific telecom terminology 或 examples，不增加时 MUST 保持 builtin terminology，但 MUST NOT 增加新的 memory category、绕过 candidate validation、削弱 sensitive-trait rejection 或引入 memory-private prompt loading path。

产品 customization MUST 表达为通过既有 Agent package prompt discovery contract 注册的 Agent-scoped prompt template。builtin fallback template MUST 保持为 system-provided immutable fallback。移除或禁用 Agent-scoped template 后，系统 MUST 恢复 builtin prompt fallback，且 MUST NOT 要求代码回滚。

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
2. 如果 `MemoryConfig.status=DISABLED`、effective memory disabled 或 extraction disabled，受控触发和 scheduled trigger MUST 返回 `SKIPPED` 诊断。
3. 如果 `MemoryConfig.status=VALID`、effective extraction enabled 且 local memory backend 被选中，部署 MAY 启用按 `crossSessionSchedule` 触发的 scheduled extraction cycle；未启用 scheduled trigger 时，系统 MUST NOT 产生 schedule-driven cycle，但受控管理触发或测试触发仍 MAY 执行 extraction cycle。省略 raw `crossSessionSchedule` 时 MUST 使用默认 `0 0 0 * * ?`。
4. `RULE_FIRST` 先运行规则策略，仅在 eligible trajectory/cycle 的规则 accepted candidate 为 0 时调用 LLM。
5. 每个 accepted extraction cycle MUST 在进入 extraction strategy 前冻结一个可信 `cycleId`：cron-triggered cycle MUST 使用该次 accepted trigger 的 cycle identity，受控管理或测试触发 MAY 注入满足同一 contract 的 cycle identity。LLM strategy MUST 把该 `cycleId` 的同一值作为 scope `operationId`，并把它作为该次模型调用的唯一 operation identity。LLM extraction MUST 使用 active accepted Agent scope、trusted background Owner Scope、`purpose=MEMORY_EXTRACTION`、extraction locale、normalized flow variables、`mode=INITIAL` 且不含调用方提供的 candidate list 调用 `ModelSelectionService.select(request, signal)`。Dreaming 由 cron 触发且不绑定 request run，因此 extraction locale MUST 来自 active Agent assembly 的 `runtimeSettings.defaultLanguage`；该字段缺失时，extraction MUST 传入 `undefined`。Normalized flow variables MUST 为 `{}`，MUST NOT 从历史 request、task trajectory summary、model output 或 configuration snapshot fields 推导。Selection 成功后，prompt assembly MUST 接收同一 selected configuration 的 safe `modelId`；invocation MUST 使用该 `modelId`、closed invocation scope 和已渲染 messages，scope MUST 包含上述 `operationId` 并省略不存在的 `sessionId/requestId/runId`，request locale 在上游 prompt rendering 后停止传播。LLM extraction MUST 通过统一 `ModelInvocationService` 执行当前 Agent 已激活的 model hook；合法 mutation MUST 生效，background `PEND` MUST 在 provider execution 前安全失败，且不得创建 pending input、synthetic run coordinates 或 request-run hook/model timeline。adapter 发起 outbound model HTTP request 时，framework-owned correlation header 集合 MUST 恰好为 `X-NextAgent-Agent-Id`。一次 extraction logical invocation MUST 只调用模型边界一次，MUST NOT 包裹同模型 retry 或重置 timeout。Extraction MUST NOT 读取 default/first model profile、global model registry 或 provider binding，configuration snapshot fields MUST NOT 选择模型或 prompt template。Prompt resolution diagnostics MUST NOT 包含完整 prompt/template content。

**需求类别**：功能性需求

#### Scenario: 默认配置在午夜调度 extraction
- **WHEN** 系统使用默认 memory extraction 配置
- **THEN** effective extraction enabled MUST 为 `true`
- **AND** `crossSessionSchedule` MUST 为 `0 0 0 * * ?`
- **AND** 启用 scheduled trigger 的部署 MAY 在匹配的午夜窗口触发 scheduled extraction cycle；未启用时 MUST NOT 产生 schedule-driven cycle
- **AND** 受控管理触发或测试触发 MAY 执行 extraction cycle

#### Scenario: 显式禁用 extraction 时跳过全部触发
- **WHEN** `nextAgent.memory.extraction.enabled=false`
- **AND** schedule 或受控触发尝试启动 extraction cycle
- **THEN** 系统 MUST NOT 查询 task trajectories 或写入 memory record
- **AND** 系统 MUST 产生 status=`SKIPPED`、reason=`MEMORY_EXTRACTION_DISABLED` 的安全诊断

#### Scenario: 非法 memory 配置阻止 scheduled extraction
- **WHEN** app composition 已冻结 `MemoryConfig.status=INVALID`
- **THEN** scheduled extraction trigger MUST NOT 生效
- **AND** extraction MUST NOT 查询 task trajectories 或写入 memory records
- **AND** 系统 MUST 记录安全 configuration diagnostic

#### Scenario: 已配置 schedule 允许本地 scheduled extraction
- **WHEN** `MemoryConfig.status=VALID`
- **AND** effective memory enabled 为 `true`
- **AND** effective extraction enabled 为 `true`
- **AND** local memory backend 被选中
- **AND** `nextAgent.memory.extraction.crossSessionSchedule` 配置为受支持的 cron 表达式
- **THEN** 部署 MAY 启用按该 schedule 触发的 extraction cycles；未启用时 MUST NOT 产生 schedule-driven cycle

#### Scenario: RULE_FIRST 先执行规则并在需要时调用 LLM
- **WHEN** `nextAgent.memory.extraction.enabled=true`
- **AND** `nextAgent.memory.extraction.strategy=RULE_FIRST`
- **THEN** extraction job MUST 先运行确定性规则提取
- **AND** 规则 accepted candidate 为 0 时调用 LLM
- **AND** 规则已经产生 accepted candidate 时 MUST NOT 调用普通 LLM fallback
- **AND** 模型 extraction strategy 可用且没有 accepted useful rule candidate 时，bounded `llm-note:` semantic projections MUST 继续为这些仅能由 LLM 处理的 trajectories 调用 LLM extraction，因为它们不是 rule-ready candidates

#### Scenario: RULE_FIRST 忽略非知识 runtime metadata
- **WHEN** RULE_FIRST extraction 只观察到 message counts、timeline event counts、terminal status、request lifecycle summaries、Capability/tool status 或仅含 diagnostic code 的 observations 等运行期 TaskTrajectory summaries
- **THEN** 这些 summaries MUST NOT 被接受为 useful memory candidates
- **AND** 模型 extraction strategy 可用时，这些 summaries MUST NOT 阻止 LLM fallback
- **AND** 安全投影且带 source refs 的明确电信定义，例如告警码含义，MAY 被接受为 `CONCEPTUAL` candidate

#### Scenario: LLM extraction 消费安全业务 notes 而非 runtime noise
- **WHEN** TaskTrajectory 包含以 `llm-note:` 开头的有界 `REQUEST_FACT` summaries
- **THEN** 确定性 RULE_FIRST extraction MUST NOT 直接把这些 summaries 转为 rule candidates
- **AND** 没有 accepted useful rule candidate 时，模型 extraction strategy 可用则 MUST 允许 LLM fallback
- **AND** LLM prompt input projection MUST 包含 `llm-note:` business summaries 和 durable refs
- **AND** LLM prompt input projection MUST 排除只描述 runtime behavior 的 message counts、timeline event counts、terminal status、Capability/tool status、仅含 diagnostic code 的 summaries，以及 Rag/Glob/Grep 等 tool names

#### Scenario: Agent extraction prompt 通过 prompt registry 覆盖 builtin
- **WHEN** active Agent package 提供 `prompts/MEMORY_EXTRACTION/template.yaml`
- **AND** 该 template 匹配 extraction locale、flow variables 和 selected model
- **THEN** LLM extraction MUST 使用 Agent-layer `MEMORY_EXTRACTION` template
- **AND** extraction MUST NOT 从 configuration 或 Agent assembly 读取 `promptTemplateIds`
- **AND** MUST NOT 在既有 prompt template registry boundary 之外执行额外 file loading

#### Scenario: Cron extraction 使用确定性 prompt assembly inputs
- **WHEN** dreaming cron 触发 LLM extraction
- **THEN** 系统 MUST 在进入 extraction strategy 前建立并冻结该次 accepted trigger 的 `cycleId`
- **AND** invocation scope `operationId` MUST 等于该 `cycleId`
- **AND** 该值 MUST 是本次模型调用的唯一 operation identity
- **AND** extraction locale MUST 是 active Agent assembly 的 `runtimeSettings.defaultLanguage`
- **AND** `runtimeSettings.defaultLanguage` 缺失时，extraction MUST 传入 `undefined`，MUST NOT 从 trajectories 推导 locale
- **AND** flow variables MUST 是空对象
- **AND** selected model MUST 来自 `ModelSelectionService` 对 active accepted Agent 和 trusted background Owner Scope 的选择
- **AND** prompt assembly MUST 使用同一 selected configuration 的 `modelId`
- **AND** invocation MUST 使用其 canonical `modelId` 和省略 session/request/run coordinates 的 schema-valid scope；locale 在 prompt rendering 后停止传播
- **AND** adapter 发起 outbound model HTTP request 时，framework-owned correlation header 集合 MUST 恰好为既有 Agent header
- **AND** extraction MUST NOT 增加 memory-specific locale、flow-variable、model-profile、catalog 或 provider-binding configuration path

#### Scenario: Agent prompt 缺失时使用 built-in extraction prompt
- **WHEN** 不存在匹配的 Agent-layer `MEMORY_EXTRACTION` template
- **AND** strategy 允许 LLM extraction
- **THEN** extraction MUST 使用 builtin `MEMORY_EXTRACTION` template
- **AND** MUST NOT 仅因不存在 Agent prompt override 而失败或阻塞 extraction startup
- **AND** builtin template MUST 明确把 extraction 限制为四类允许的 memory category、TaskTrajectory safe projection input、category quality gates、source refs 和 raw/sensitive content rejection boundaries

#### Scenario: Agent prompt override 保持 extraction boundaries
- **WHEN** Agent-layer `MEMORY_EXTRACTION` template 覆盖 builtin template
- **THEN** prompt assembly MUST 通过 shared prompt registry 选择该 Agent-layer template
- **AND** 该 template MUST 保持相同的四类允许 category、input boundary、rejection boundary、sourceTrace requirement 和 sensitive user-characteristics limits
- **AND** MUST NOT 增加 memory-private prompt loader、`promptTemplateIds` 或 `memory-extraction-{lang}` selection path
- **AND** override MUST 位于 Agent package prompt root，MUST NOT 通过修改 builtin fallback template 实现

#### Scenario: 移除 Agent prompt override 后恢复 builtin fallback
- **WHEN** Agent 原先包含 `prompts/MEMORY_EXTRACTION/template.yaml`
- **AND** 该 Agent-scoped template 被移除、禁用或不再匹配 prompt assembly request
- **THEN** LLM extraction MUST fallback 到 builtin `MEMORY_EXTRACTION` template
- **AND** 恢复 builtin fallback MUST NOT 要求编辑 system-provided builtin prompt files

#### Scenario: Extraction prompt 解析安全失败
- **WHEN** prompt registry/assembler 无法解析出唯一 `MEMORY_EXTRACTION` template
- **OR** 同一 source layer 的多个匹配 `MEMORY_EXTRACTION` templates 具有相同最高 specificity
- **THEN** extraction MUST 使用安全 prompt resolution diagnostic 失败，或跳过 LLM 部分
- **AND** diagnostics MUST NOT 包含完整 prompt/template content
- **AND** extraction MUST NOT fallback 到 `promptTemplateIds`、raw file reads 或 `memory-extraction-{lang}` naming

#### Scenario: Memory 模型选择安全失败
- **WHEN** `ModelSelectionService` 被取消或返回 `FAILED`
- **THEN** extraction MUST NOT 启动 provider execution
- **AND** MUST 返回受治理的 degraded/failed diagnostic，且 MUST NOT 选择 global default、其他 Agent 或未激活模型

### Requirement: Extraction candidate quality contract

系统 SHALL 将提取结果表达为 memory extraction candidate。每个 candidate 必须通过结构、质量、去重和安全校验后，才可以写入长期记忆。未通过校验的 candidate 必须产生 rejection diagnostic，不得静默丢弃。

**候选契约**：
- `category` 必须为 `FACTUAL`、`CONCEPTUAL`、`PROCEDURAL` 或 `USER_CHARACTERISTICS`。
- `content` 必须符合 `add-ts-memory-core` 定义的 category-specific structured content contract：`FACTUAL(subject, claim, evidence?, qualifiers?)`、`CONCEPTUAL(concept, definition, aliases?, relatedConcepts?)`、`PROCEDURAL(procedureName, non-empty procedureText)` 或 `USER_CHARACTERISTICS(non-empty traits, non-empty purpose[])`。
- `briefIndex` 必须是安全短摘要，最大 100 字符。
- `confidence` 必须在 `[0, 1]`，默认初始值为 `0.5`。
- LLM candidate 的 self-reported `confidence` 只是模型 hint；写入前 MUST 被 extraction 规范化为保守上限，单周期 LLM 候选不得因为模型自评分直接写入高置信度。
- `tags` 必须只包含安全、低基数字段。
- `sourceTrace` 必须至少包含 `sessionId`、primary root message（映射为 core `sourceTrace.requestId`）、`runId` 和 contributing message refs；重复来源引用中的 root message 使用 `sourceTrace.refs[].rootMessageId`。
- `strategyProvenance` 必须记录候选来自规则、LLM 或合并策略。
- 写入前的 candidate projection 必须生成与 core 兼容的 write request：包含 core-defined category、category-specific structured content、`confidence`、`tags`、`briefIndex` 和 `sourceTrace`。首次写入的 `longTermMemoryId` 由 memory core/gateway 生成；同一 scope、同一 extraction job、同一候选语义在重复触发时 MUST 生成同一稳定 `idempotencyKey`，并通过 `saveLongTermMemory(request, IdempotentWriteOptions)` 作为写入 metadata 传递，不得放入 request 或 record。

**核心判断逻辑**：
1. 校验 category 和结构化 content。
2. 校验 sourceTrace 完整性。
3. 校验 briefIndex 和 tags 安全性。
4. 校验 confidence 范围。
5. 对 LLM candidate 执行保守 confidence 上限裁剪。
6. 对同一 extraction job 内候选执行批内去重。
7. 将合格 candidate 投影为 core-compatible write request 并生成稳定 write identity；如果无法生成稳定 `idempotencyKey` 或 core-compatible content，则拒绝该 candidate 并记录 `CORE_WRITE_PROJECTION_INVALID`。
8. 调用 `LongTermMemoryStoreGateway.saveLongTermMemory`（以下简称 `store.saveLongTermMemory`）执行 scope 匹配的写入；最终 record 语义以 memory core 为准。

#### Scenario: Procedural candidate uses text body
- **WHEN** extraction builds a valid reusable `PROCEDURAL` candidate from a verified task trajectory
- **THEN** the candidate content MUST contain `procedureName` and `procedureText`
- **AND** gateway writes MUST not require or persist `steps[]` for that procedural memory.

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

系统 SHALL 通过 dreaming cron cycle 执行完整的长期记忆提取和跨 session 知识融合。Dreaming 是策略提取、候选校验、跨 session 融合和写入的唯一完整路径；它不得定义 promotion、decay、curator 或 aging lifecycle。Confidence 融合只表示独立来源证据的 corroboration，不得创建第二套 confidence lifecycle。

Evidence fusion MUST 以 source evidence 幂等。`lookbackDays` 只决定 trajectory 输入窗口；重复 cycle 扫描相同 source refs 时 MUST NOT 再次改变 retained memory。Candidate 与 existing ACTIVE memory等价时，extraction MUST 在写入前安全解析 retained memory 的字符串 `source` 并比较其中的 source refs；解析失败的 existing memory MUST 被安全拒绝，不得覆盖。

Evidence fusion MUST 只使用 core public Gateway：extraction 在算法边界解析并合并 existing/candidate source evidence，再通过 `store.saveLongTermMemory` 写入包含完整 YAML required fields 和序列化 `source` 的更新；provider 在 source 发生变化的成功更新中递增 `extractionCount`。confidence corroboration MUST 使用 flat `store.mutateLongTermMemory({ delta }, { expectedVersion })`。Extraction MUST NOT通过ordinary save、direct storage write或memory tool修改confidence。Candidate matching、冲突判定、source merge、拒绝和corroboration属于dreaming/extraction，不得下沉到model-facing `add_memory` 或 gateway-local。

**触发机制**：
1. `nextAgent.memory.extraction.crossSessionSchedule` 定时触发，查询 `lookbackDays` 天内同scope、已持久化且可读取的task trajectories。
2. 默认schedule为`0 0 2 * * ?`。Cycle在后台运行，不得阻塞当前request；达到timeout后取消未完成步骤。
3. 完整提取只在dreaming cycle执行，不得在对话主路径隐式触发。

**输入与前置条件**：
- 输入只允许当前 `tenantId`、`subjectId`、`agentId` scope内的 `TaskTrajectoryRecord`。
- `taskOutcomeStatus=UNKNOWN` MAY作为低风险事实证据，但不得单独支持高置信PROCEDURAL写入。
- Trajectory MUST通过`TaskTrajectoryQueryGateway`按sinceTime/untilTime查询；contract不能表达时实施 MUST block并由owning change补齐，不得私查DB或复用不匹配的session/message query。
- 只读取安全摘要和durable source refs；排除不可读取content ref。
- 单cycle最多处理`maxCycleTrajectories`，默认20。

**输出与副作用**：
- 每条trajectory独立运行提取策略并产生candidate。
- 同scope candidate按category-specific identity/equivalence key去重，合并多个source refs；candidate是dreaming内部证据，不是retained memory state。
- 融合检测 MUST 先调用`listLongTermMemory(memoryType=category,state=ACTIVE,limit=maxCandidates)`取得summary候选，再对选中`memoryId`调用`getLongTermMemory`读取字符串 `content/source` 并在算法边界解析。不得使用search/detail做后台融合候选查询，以免改变recall/access telemetry。
- Structured content等价时 MUST 复用原memory id，追加新source refs；独立来源corroboration每次confidence增加0.1，最多2次，累计最多+0.2。
- 没有同类候选，或规则明确证明candidate与已有候选无关且不冲突时，MAY通过ordinary save创建新memory。
- 同identity但不等价/冲突，或规则无法判定时，MUST NOT创建ACTIVE memory，并产生安全diagnostic。
- Cycle diagnostic至少包含trajectory count、candidate count、new count、fused count、rejected count和durationMs。

**核心判断规则**：
1. 按time window查询当前scope trajectories。
2. 排除跨scope、不可读取、缺少安全摘要或source refs不完整的trajectory。
3. 按`RULE_FIRST`默认策略逐条产生candidate。
4. 同scope、同category、相同identity/equivalence key的candidate合并并保留全部source refs。
5. 通过list+get读取existing ACTIVE候选，解析字符串 content/source，不产生search/detail telemetry。
6. Structured content等价时，算法合并source refs并用完整 save request写回；只有新的独立source group MAY通过flat `{ delta: 0.1 }` mutation提升confidence，最多2次。
7. 明确为新知识且无冲突时创建新memory。
8. 同identity但content冲突时不融合、不新建，记录`CROSS_SESSION_CONFLICTING_EVIDENCE`。
9. 无法证明等价、无关或冲突时不融合、不新建，记录`CROSS_SESSION_AMBIGUOUS`。
10. 同类候选达到`maxCandidates`且仍无法证明是新知识时不新建，记录`FUSION_SCAN_LIMIT_REACHED`。

**状态与产物契约**：
- Fusion保留原`memoryId`，在算法层追加而不覆盖source refs，并由 Gateway 更新`updateTime/version/extractionCount`。
- 空batch返回`SKIPPED`和`NO_CROSS_SESSION_CANDIDATES`，不视为错误。
- Fusion不得改变ACTIVE/ARCHIVED state，不得执行promotion、aging、physical delete或curator transition。
- 不得修改既有TaskTrajectory的taskOutcomeStatus、outcomeEvidenceLevel或summary；后续证据只通过新的trajectory refs进入长期记忆。
- Diagnostic和audit不得包含跨session message原文或用户输入内容。

#### Scenario: 跨trajectory发现新知识
- **WHEN** 最近7天同scope的5条trajectory中有2条包含相同概念解释且没有existing memory
- **THEN** 系统 MUST 创建一条带2个source refs的CONCEPTUAL memory
- **AND** diagnostic显示newCount=1、fusedCount=0

#### Scenario: 独立跨session证据提升confidence
- **WHEN** candidate与existing `E1` structured content等价，`E1.confidence=0.5`且corroboration少于2次
- **THEN** 不创建新memory
- **AND** 通过ordinary save追加source refs并由core增加extractionCount
- **AND** 通过flat `{ delta: 0.1 }` mutation把confidence更新为0.6
- **AND** diagnostic显示fusedCount=1、newCount=0

#### Scenario: 达到corroboration上限后不再提升
- **WHEN** `E1`已达到2次corroboration且再次发现等价独立证据
- **THEN** MAY追加新的source refs
- **AND** MUST NOT提升confidence
- **AND** diagnostic记录`CORROBORATION_LIMIT_REACHED`

#### Scenario: 后续验证证据不重写旧trajectory
- **WHEN** `T1`曾以UNKNOWN outcome生成低confidence FACTUAL memory `M1`
- **AND** 同scope `T2`提供等价知识和VERIFICATION证据
- **THEN** extraction MUST NOT修改`T1.taskOutcomeStatus`
- **AND** MAY通过算法层source merge和受限flat delta mutation corroborate `M1`

#### Scenario: 重复扫描相同source evidence保持幂等
- **GIVEN** ACTIVE memory已保留某trajectory的source group
- **WHEN** 后续cycle产生相同sessionId/rootMessageId/runId/messageRefs、仅extractionCycleId不同的等价candidate
- **THEN** extraction MUST跳过fusion
- **AND** MUST NOT调用ordinary save或flat delta mutation

#### Scenario: 同run新增message refs不提升confidence
- **GIVEN** ACTIVE memory已有某request run的source evidence
- **WHEN** 后续cycle从同session/root/run得到新的message refs
- **THEN** MAY通过ordinary save合并refs
- **AND** MUST NOT提升confidence

#### Scenario: 新的独立source group可以corroborate
- **GIVEN** ACTIVE memory已有一个request run的source evidence
- **WHEN** 等价candidate来自不同session、rootMessageId或runId
- **THEN** MAY合并新refs
- **AND** MAY通过flat delta mutation执行受限corroboration

#### Scenario: 后续验证trajectory可创建此前跳过的PROCEDURAL memory
- **WHEN** `T1`为UNKNOWN且未创建PROCEDURAL memory
- **AND** `T2`包含兼容procedure和VERIFICATION evidence
- **THEN** extraction MAY从`T2`创建PROCEDURAL memory
- **AND** 不得把`T1`未创建记录视为失败

#### Scenario: Ambiguous candidate不融合也不新建
- **WHEN** candidate检索到同类已有条目，但category规则无法证明等价、无关或冲突
- **THEN** 不融合、不创建
- **AND** diagnostic记录`CROSS_SESSION_AMBIGUOUS`和安全briefIndex

#### Scenario: 冲突证据不被激活
- **WHEN** candidate与existing ACTIVE memory属于同scope/category和identity，但关键structured content冲突
- **THEN** 不创建新ACTIVE memory，也不覆盖或删除existing memory
- **AND** diagnostic只使用安全refs记录`CROSS_SESSION_CONFLICTING_EVIDENCE`

#### Scenario: 禁止跨scope聚合
- **WHEN** 查询结果包含其他tenant、subject或agent的trajectory facts
- **THEN** 必须排除这些facts并记录安全diagnostic
- **AND** 不得产生跨scope candidate

#### Scenario: Extraction不执行lifecycle promotion
- **WHEN** evidence fusion提升confidence
- **THEN** 提升只能是每次+0.1、累计最多+0.2的corroboration
- **AND** extraction不得执行promotion、aging state transition或curator lifecycle

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

### Requirement: Extraction schedule is independent of process startup second

The memory extraction scheduler SHALL evaluate a configured six-field cron schedule by minute window. A process started at any second within a minute MUST still execute a schedule whose second field is `0` when the matching minute window arrives. One scheduler instance MUST execute at most one scheduled cycle for the same minute window.

#### Scenario: Dreaming schedule fires after unaligned startup
- **GIVEN** extraction schedule is `0 0 2 * * ?`
- **AND** the process starts at `01:59:41` local time
- **WHEN** local time enters the `02:00` minute window
- **THEN** exactly one scheduled extraction cycle MUST start

### Requirement: Extraction timeout governs the complete cycle

`nextAgent.memory.extraction.timeoutMs` SHALL define one deadline for the complete extraction cycle, including trajectory query, rule/LLM extraction, fusion reads and memory writes. The cycle MUST propagate a deadline-derived `AbortSignal` to cancellable slow boundaries and MUST stop starting new work after the deadline. Completed memory writes MUST remain committed and be counted; timeout before any successful write MUST return `FAILED`, while timeout after one or more successful writes MUST return `PARTIAL`, with reason `MEMORY_EXTRACTION_TIMEOUT`.

#### Scenario: Hanging LLM is canceled by the cycle deadline
- **GIVEN** extraction is enabled with `timeoutMs=10000`
- **AND** the selected LLM operation has not completed by the deadline
- **WHEN** the cycle deadline expires
- **THEN** the LLM operation MUST receive cancellation
- **AND** the cycle MUST return `FAILED` with reason `MEMORY_EXTRACTION_TIMEOUT`
- **AND** no memory write may start afterward
#### Scenario: Timeout after a completed write is partial
- **GIVEN** one candidate write completed before the deadline
- **AND** the deadline expires before remaining candidates are written
- **WHEN** the cycle completes its diagnostic
- **THEN** it MUST return `PARTIAL` with reason `MEMORY_EXTRACTION_TIMEOUT`
- **AND** it MUST count the completed write without starting remaining writes

### Requirement: Extraction writes obey long-term memory knowledge admission

When a guardrail binding is present, automatic extraction MUST submit both new candidate writes and existing-record `saveLongTermMemory` updates through the same `agent-memory` package-internal knowledge security admission implementation as other long-term memory writes. Extraction MUST receive the selected guardrail binding through its existing `agent-memory` factory/options boundary and MUST NOT receive an app-composed coordinator object. Existing local candidate validation MUST run before the remote guard call and MUST NOT replace, bypass or weaken the knowledge check.

A blocked knowledge check MUST reject that candidate with reason `CANDIDATE_UNSAFE`, MUST increment the rejected/skipped outcome counts, and MUST continue with later candidates while the extraction deadline and cancellation state allow. A guardrail unavailable result MUST mark that candidate as failed with reason `LTM_CONTENT_GUARD_UNAVAILABLE`; the cycle MUST be `PARTIAL` when at least one other candidate was written and `FAILED` when none was written. Cancellation MUST retain the existing `MEMORY_EXTRACTION_CANCELED` cycle behavior. No guard outcome may change the source RequestRun terminal state.

Extraction diagnostics, audits, logs, metrics and traces MUST NOT contain the admission text, individual fragments, RobotRouter `detail`, provider response body, raw error or long-term memory content. They MAY contain only existing safe scope fields where already authorized, memory category, bounded counts and stable reason codes.

#### Scenario: Unsafe extraction candidate is rejected before persistence

- **WHEN** an extraction candidate passes local validation but any knowledge fragment is blocked
- **THEN** the candidate MUST be rejected with `CANDIDATE_UNSAFE`
- **AND** the long-term memory store MUST NOT persist that candidate
- **AND** extraction MUST continue with later candidates while its deadline and cancellation state allow

#### Scenario: Guardrail outage makes extraction partial

- **WHEN** one candidate has already been written and a later candidate receives `LTM_CONTENT_GUARD_UNAVAILABLE`
- **THEN** the cycle MUST complete with status `PARTIAL`
- **AND** its safe reason codes MUST include `LTM_CONTENT_GUARD_UNAVAILABLE`
- **AND** the source RequestRun terminal state MUST remain unchanged

#### Scenario: Guardrail outage prevents every extraction write

- **WHEN** every accepted candidate fails knowledge admission because the guardrail is unavailable
- **THEN** the cycle MUST complete with status `FAILED`
- **AND** its failure count MUST equal the number of attempted candidates
- **AND** no long-term memory record MUST be written
