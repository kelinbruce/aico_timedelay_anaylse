## Function

- **所属 Function**：`FN-8.3 记忆提取和老化`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

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

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：LLM extraction 通过统一 selection service 选择模型，以同一 selected configuration 装配 prompt 和构造 background invocation；其他配置、策略、prompt、安全输入和候选质量行为不变。
- **依据 Requirements**：`Extraction strategy and configuration`

### 结果

- **变更类型**：修改
- **目标内容**：模型选择失败继续产生受治理 degraded/failed 结果；memory 不读取 default/first profile、全局 catalog 或 provider binding。
- **依据 Requirements**：`Extraction strategy and configuration`
