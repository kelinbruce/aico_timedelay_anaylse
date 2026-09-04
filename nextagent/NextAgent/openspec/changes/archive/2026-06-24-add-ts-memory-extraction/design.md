## 背景和现状（Context）

`add-ts-memory-extraction` 的设计前提是实施时当前代码基线必须提供可消费的 long-term memory core、memory configuration snapshot、local memory store/retriever 和 `TaskTrajectoryQueryGateway`。历史实施状态已全部回退；后续实施必须以当前 workspace 的源码、测试和验证命令重新证明前置 surface 存在。若前置 surface 不存在，本 change 保持 blocked，不在 extraction 中补写 core、configuration 或 task trajectory contract。

在 core 和 task trajectory 前提满足后，本 change 才在该基础上补充自动提取能力：dreaming 从已持久化任务轨迹中沉淀可复用的电信网络知识。它不改变请求生命周期，不改变 context assembly，不定义模型工具，不定义老化/策展/共享。

需要继承的约束有三类：

- 架构约束：runtime 拥有 request lifecycle、terminal commit 和 canonical timeline；memory lifecycle 归长期记忆边界；context engine 不拥有提取；channel 只做投影。
- 核心契约约束：scope 使用可信 `IdentityContext.tenantId`、`subjectId` 和 `RequestContext.agentId`；跨边界错误使用 `SafeError`；时间、审计、日志和配置都必须运行时校验和脱敏。
- Roadmap 约束：本 change 只有在当前 release scope 明确纳入 Long-term memory 能力组、且 memory core 已在当前代码基线落地后才能进入实施。目标是自动提取可复用知识，支持规则策略、显式 LLM 策略和跨会话证据聚合，但不得混入 memory tools、三态生命周期、promotion/decay。dreaming 调度器由本 change 实现。

一致性审视结论：

- 与 `establish-ts-backend-architecture` 一致：本设计把提取放在 memory lifecycle boundary，通过 cron dreaming 定时执行；runtime 不拥有提取语义。
- 与 `establish-ts-core-contracts` 一致：所有 owner scope 来自 trusted identity；不引入 `OwnerScope` DTO；失败和诊断不泄漏 raw content。
- 与 roadmap/release scope 一致的前提：本 change 可纳入 Long-term memory 能力组，但必须先证明 `add-ts-memory-core`、`add-ts-memory-configuration` 和 `add-ts-task-trajectory` 已在当前代码基线实施并验证，或在同一 release 中作为更早实施步骤完成并通过当前源码/测试核验；在前置条件未落地前，本 change 不可独立交付。
- 需要显式收敛的点：roadmap 提到“跨会话融合证据增量更新置信度”，但 `add-ts-memory-core` 已将 promotion/aging 留给后续 change。本设计只允许跨会话证据聚合生成 candidate 或交给 memory core write 结果表达，不在 extraction 中定义长期 confidence lifecycle。

依赖契约审视结论：

- 合理依赖：extraction 需要复用 `add-ts-memory-core` 的 `LongTermMemoryRecord`、`MemoryCategory`、`SaveLongTermMemoryRequest`、`LongTermMemoryStoreGateway`、owner scope/agent scope、`SafeError`、state 和 disabled/storage failure 语义；这些正是 core 对所有 memory 后续 change 提供的稳定基础。
- 必须补强：core `saveLongTermMemory` 要求写入对象具备有效 category、结构化 content 和 `[0, 1]` confidence；首次写入的 `longTermMemoryId` 由 core/gateway 生成。因此 extraction candidate 不能只停留在临时候选结构；写入前必须投影为 core-compatible write request，并为同一 scope + candidate 语义生成稳定 `idempotencyKey`，作为 `saveLongTermMemory(request, IdempotentWriteOptions)` 的写入 metadata。不得由 extraction 派生或覆盖首写 `longTermMemoryId`。
- 不应依赖：extraction 不依赖 core 的 model-facing `search` ranking、`recallCount` / `accessCount` side effect、L1/L2 disclosure semantics 或 aging 消费逻辑；后台融合候选查找只允许使用无副作用的 `listLongTermMemory` / `getLongTermMemory` public gateway paths。
- 不可改动：如果 core 现有 write boundary 无法表达 extraction 所需字段，本 change 只能在自身设计中约束投影和诊断；不得修改 `add-ts-memory-core`，需要另起 contract refinement 才能变更 core。

当前代码基线重对齐结论：

- OpenSpec validation 只能证明 change 文档语法有效，不能证明当前代码已实现。
- tasks 中旧完成勾选状态全部回退；后续每个 task 必须以当前 workspace 的源码、测试和验证命令重新完成。
- 实施前的基线核验必须动态检查 `LongTermMemoryId`、`MemoryCategory`、`LongTermMemoryRecord`、`LongTermMemoryStoreGateway`、`saveLongTermMemory`、memory configuration snapshot、`TaskTrajectoryQueryGateway`、`createMemoryExtractionScheduler` 和 `extractTrajectoryCandidates`，不得把某一次代码审视结果写成长期事实。

依赖边界：

- 本 change 依赖 `add-ts-memory-core` 提供 `LongTermMemoryRecord`、write boundary、owner scope/agent scope、state 和 safe error 的稳定语义。
- 本 change 依赖 `add-ts-memory-configuration` 提供冻结后的 memory configuration snapshot；extraction 只定义自身字段语义，不直接读取 raw app config。
- 本 change 的 local backend 业务编排可以位于 `agent-memory` 的 extraction submodule，但该 submodule 只拥有 scheduler、strategy、candidate validator 和 fusion orchestration；它不得作为 core local store/retriever wrapper，不得重导出 gateway port，也不得访问 gateway-local、SQLite、FTS5、`LongTermMemoryToolPort`、memory tool descriptors、memory tool implementation 或 capability executor。`agent-memory` package 内由 `add-ts-memory-tools` 拥有的 memory tools provider/factory 是独立边界，不属于 extraction 编排。
- 本 change 的独立目标是定义 dreaming cron 提取的可验证行为；它不把 memory core 的数据模型、端口或存储 schema 重新定义进本 change。
- 若 extraction 目标无法通过现有 core 契约表达，必须先提出 contract refinement，再扩展 core boundary。

## 第一性原则与 KISS 审视

第一性原则：长期记忆提取不是“更聪明的对话总结”，而是“三条互补的知识新增路径，并通过既有 memory core 安全写入”。它服务电信网络任务中的重复排障步骤、网络术语、客户环境约束和稳定工作偏好，但不能成为请求生命周期、上下文拼装、模型工具或用户画像系统的第二套实现。

业务边界：

- 只处理已完成请求后的学习，不参与当前请求回答质量。
- 只沉淀可跨会话复用的电信网络知识、流程、概念和低敏工作偏好。
- 只在 trusted `tenantId`/`subjectId`/`agentId` 内读写，不做共享、发布、维护 API、上下文自动注入或生命周期治理。
- 只输出候选、写入结果和安全诊断，不输出用户可见 stream 内容。

黑盒效果：

- 默认配置下没有自动写入，dreaming cron 触发只产生 skipped 诊断。
- 启用后 dreaming cron 定时查询已持久化 task trajectories，通过 RULE_FIRST 策略提取可追溯长期记忆并写入；与用户请求完全异步，不阻塞终端。
- 启用 LLM 策略后，LLM 只是受控提取器，仍必须通过模型边界、预算、安全门和 core 写入边界。
- 失败、超时、不可用、候选不安全或超预算都表现为显式诊断；既不静默吞错，也不影响原请求终态。

核心业务实现逻辑：

1. cron 触发 dreaming cycle；如果 `MemoryConfig.status !== VALID` 则不启动 scheduler 并记录 safe configuration diagnostic；如果 extraction disabled 记录 skipped。
2. 通过 `TaskTrajectoryQueryGateway` 查询 trusted scope 和 lookback window 内的 task trajectories；缺失 task trajectory capability 时保持 blocked，不回退到 message history 私查。
3. 按 category-specific extraction matrix 从 trajectory 的目标、约束、观察、动作序列、结果、`taskOutcomeStatus`、`outcomeEvidenceLevel` 和 source refs 生成 candidates。candidate 是 dreaming 内部证据对象，不是 model-facing tool result，也不是 `LongTermMemoryRecord` retained state。
4. 对 candidate 做 category、content、sourceTrace、briefIndex、confidence、tags、安全和批内去重校验。
5. 在 dreaming 中执行候选融合和冲突消歧：category 只描述知识类型；candidate 是否融合、丢弃或创建新 ACTIVE record 由 task trajectory evidence、category-specific structured equivalence/conflict rules 和安全诊断决定。
6. 将合格且可写入的 candidate 投影为 core-compatible write request：包含 core category、结构化 content、confidence、tags、briefIndex 和 sourceTrace；另生成稳定 `idempotencyKey` 作为 write options，不放入 request 或 record。
7. 新建条目调用 `store.saveLongTermMemory`；融合已有条目时调用 `store.saveLongTermMemory(existing longTermMemoryId, sourceTrace refs...)` 触发 core sourceTrace merge / `extractionCount` 递增，并用 `store.adjustLongTermMemoryConfidence` 做 corroboration 提升；按 write success/write failure 汇总 job diagnostic；不直接写存储，不调用 memory tools。

KISS 结论：当前 change 满足 KISS，但前提是保持默认关闭、RULE_FIRST 默认、LLM 只在明确策略或规则零产出时调用、UserCharacteristics 统一受 `nextAgent.memory.extraction.enabled` 控制、跨会话只做证据聚合/冲突消歧，以及 candidate 到 core write/adjustment API 的单一投影路径。任何把提取扩展为 promotion/aging、上下文自动注入、独立长期 candidate 存储 schema 或工具调用链的设计，都会超过本 change 的必要复杂度，应拆到后续 change。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 定义 dreaming cron 异步长期记忆提取流程。
- 定义 owner-scoped、已持久化 TaskTrajectory 的提取输入边界。
- 定义规则提取、显式 LLM 提取和跨会话证据聚合的目标策略。
- 定义 extraction candidate 的质量门、安全门、sourceTrace 和写入路径。
- 定义 `USER_CHARACTERISTICS` 自动提取跟随 `nextAgent.memory.extraction.enabled` 的统一开关，以及敏感信息拒绝边界。
- 定义失败、降级、审计、日志、指标和幂等行为。

**非目标：**

- 不定义模型可调用 memory tools。
- 不定义三态生命周期、aging、curator、promotion 或 confidence decay。
- 不定义 REST/Web 管理 API、共享、发布、fork 或用户维护界面。
- 不修改 request lifecycle、terminal commit、context assembly、system prompt 或 stream projection。
- 不定义具体存储 schema、检索 ranking、物理索引或具体数据库。
- 不把 LLM 提取设为默认启用能力。

## 设计决策（Decisions）

### 决策 1：提取统一在 dreaming cron 中执行

选定路径：cron 是知识提取的唯一路径。dreaming cron 定时调度由本 change 实现，通过 `createMemoryExtractionScheduler()` 提供 `setInterval` + `isCronDue()` 机制，与 aging scheduler 对称。

**App composition 接线（后置任务）：** 调度器实例在 `create-app.ts` 中创建，注入 frozen `MemoryConfig`、gateway store/retriever、`TaskTrajectoryQueryGateway` 和 model invocation service（LLM 提取策略需要）。与 aging scheduler 的区别在于 extraction 额外依赖 model invocation service 和 task trajectory 查询能力来读取跨会话已提交任务轨迹。只有 `MemoryConfig.status === VALID`、extraction enabled、当前 app composition 选择 local memory backend 且存在 schedule 时，scheduler 才能启动；`DISABLED` / `INVALID` snapshot 不启动本地后台读取。该接线必须排在 memory core/config、candidate validator、write projection、`extractTrajectoryCandidates` 和 scheduler API 之后。

**Cron prompt 装配输入：** dreaming 不绑定单个 request，因此 LLM extraction 的 prompt assembly 输入必须由 app composition 和 active Agent assembly 确定，而不是从 trajectory 内容反推。`locale` 使用 active Agent assembly 的 `runtimeSettings.defaultLanguage`；缺失时传 `undefined`，只匹配无 `match.locale` 的兜底模板。`flowVariables` 首版固定为空对象 `{}`，不得从历史 request、trajectory 摘要、模型输出或配置 snapshot 拼装。`selectedModel` 使用 active Agent assembly 的 `runtimeSettings.defaultModelProfileId`，缺失时使用 `modelProfileIds[0]`，并经过现有 model profile registry、credential 和 provider validation；无可用 model 时 LLM 部分产生 `MODEL_UNAVAILABLE` 或等价 safe diagnostic，不直接调用 provider，也不新增 memory 专属 model 配置。

放弃路径：
- 不在模型执行中途提取并写入，避免未提交事实污染长期记忆。
- 不把提取放入 terminal commit 必经路径，避免记忆写入故障影响请求终态。
- 不由 channel、context assembly 或 capability tool 自动触发提取。

### 决策 2：输入只来自 owner-scoped TaskTrajectory

选定路径：extraction job 使用可信 `tenantId` / `subjectId` / `agentId` 通过 `TaskTrajectoryQueryGateway` 读取已持久化 task trajectories。trajectory 已经由 `add-ts-task-trajectory` 在 terminal commit 后异步构建，且只包含安全摘要和 source refs。extraction 不再直接从 message history、timeline row 或 raw tool output 生成长期记忆。

放弃路径：
- 不扫描全部会话历史。
- 不在缺少 task trajectory capability 时私查 session/message DB。
- 不信任客户端、模型输出或 capability args 中的 owner 字段。
- 不读取 raw attachment、raw provider response、stream delta 或本地路径。

### 决策 2A：四类记忆使用 category-specific extraction matrix

选定路径：category 不是简单标签，而是提取规则入口。每类记忆的输入范围、拒绝范围、质量门、融合规则和使用方式固定如下：

| Category | 输入范围 | 拒绝范围 | 质量门 | 融合规则 | 使用方式 |
|---|---|---|---|---|---|
| `FACTUAL` | task trajectory 中的环境事实、配置值、约束、版本、SLA、拓扑事实 | 临时值、未确认推断、敏感凭据、日志原文 | 至少一个明确 source ref；`subject` + `claim` 完整；可安全摘要；`UNKNOWN` outcome 只能低/中置信写入 | 同 subject + claim 等价则追加 sourceTrace；冲突则诊断不写 ACTIVE | `search_memory` / detail 用于后续事实回忆 |
| `CONCEPTUAL` | 多个 trajectory 或多个事实归纳出的术语、架构概念、领域定义 | 单次模糊解释、公共常识、无业务上下文定义 | 多个事实支撑或用户明确定义；`definition` 清晰；`UNKNOWN` outcome 不作为唯一强归纳来源 | concept/alias 相同且 definition 等价则融合；相似不等价则诊断 | 用于解释和上下文理解 |
| `PROCEDURAL` | trajectory 中的动作序列、排障步骤、检查清单、验证方式 | 一次性命令、失败流程、`taskOutcomeStatus=UNKNOWN` 且缺少强验证的步骤 | `steps` 非空；有适用范围或触发条件；`taskOutcomeStatus=SUCCEEDED` 且 `outcomeEvidenceLevel=VERIFICATION` 或 `USER_CONFIRMATION`，或包含明确可复用反例诊断 | procedureName/目标相同且步骤兼容则融合；步骤冲突则诊断 | 用于后续操作建议和流程复用 |
| `USER_CHARACTERISTICS` | 用户明确偏好、多次稳定表达的低敏工作习惯、术语偏好、技能水平 | 敏感属性、身份隐私、健康/政治/财务、单次弱推断 | 低敏；与系统行为直接相关；明确表达或多次稳定出现；`purpose` 非空；不依赖业务成功判断 | traitName + purpose 相同则融合；冲突偏好不自动覆盖 | 只通过 purpose-scoped `search_memory` 使用 |

放弃路径：
- 不让 LLM 自由决定 category 语义。
- 不把 category-specific 规则写入 memory tools 或 core。
- 不把失败流程沉淀为 `PROCEDURAL`，除非 trajectory 包含修正后的成功流程或明确可复用的反例诊断。

### 决策 3：默认关闭, 启用后默认 RULE_FIRST

选定路径：`nextAgent.memory.extraction.enabled=false` 为默认；启用后默认 `RULE_FIRST`。规则策略承载首个确定性提取路径；当 eligible trajectory/cycle 的规则 accepted candidate 为 0 时，`RULE_FIRST` 才允许通过模型边界执行 LLM 回退。`LLM_ONLY` 必须显式配置。放弃路径：
- 不默认启用自动写入，避免上线即沉淀低质量或敏感记忆。
- 不默认调用 LLM，避免成本、隐私和不可解释写入风险。
- 不允许提取实现直接调用外部 provider。
- 不允许 prompt 解析失败时临时改走 `promptTemplateIds`、`memory-extraction-{lang}`、私有文件路径或按文件名猜测语言；同一 source layer 中多个 `MEMORY_EXTRACTION` 模板同等 specificity 命中时，LLM 部分必须 fail/skip with safe diagnostic。

### 决策 4：候选先校验，再通过 memory core 写入

选定路径：所有策略输出统一转成 extraction candidate。candidate 必须经过 category/content/sourceTrace/briefIndex/confidence/tags/security 校验；它是 dreaming cycle 内部证据对象，不由 `add_memory` 写入，不进入 `search_memory`，也不扩展 memory core retained state。新条目通过 `store.saveLongTermMemory` 创建为 ACTIVE record。已有条目融合时，source refs 追加必须通过 core 允许的 `saveLongTermMemory` update merge 语义触发，`extractionCount` 由 core 在新增 extraction refs 时递增；confidence corroboration 必须通过 `store.adjustLongTermMemoryConfidence`。状态和最终 memory record 语义以 memory core 为准。

放弃路径：
- 不在 extraction 中定义竞争性的 memory record 或状态机。
- 不在 extraction 中直接写存储。
- 不把 candidate rejection 静默吞掉；所有拒绝必须有安全 reason code。

### 决策 5：跨会话只做证据聚合，不做生命周期增强

选定路径：dreaming cron 周期查询 `lookbackDays` 天内同 scope 的 task trajectories；若当前 contract 无法表达该查询，本 change 阻塞并要求先完成 `add-ts-task-trajectory` 或 contract refinement。对每条 trajectory 独立运行提取策略。发现新知识时创建新条目；发现已有潜在相关知识时执行证据融合——首版通过 core public `listLongTermMemory(categoryFilter=category, stateFilter=ACTIVE, limit=maxCandidates)` 找同类 L1 候选，再用 `getLongTermMemory` 和 category-specific structured content 规则做等价/冲突判断，避免污染 `searchLongTermMemory` 的 `recallCount` 或 `getLongTermMemoryDetail` 的 `accessCount`。融合时通过 `store.saveLongTermMemory` update merge 追加 sourceTrace refs 并让 core 递增 `extractionCount`，再通过 `store.adjustLongTermMemoryConfidence` 有限提升 confidence（corroboration +0.1，上限 +0.2）。发现同 identity 但不等价、冲突或无法判定的 candidate 时，不写入 ACTIVE record，记录安全诊断供后续维护/用户管理边界处理；若同类候选达到 `maxCandidates` 上限且无法证明是新知识，记录 `FUSION_SCAN_LIMIT_REACHED` 并跳过新建。后续等价且已验证的 trajectory 不回写旧 `UNKNOWN` trajectory，而是在 memory record 层补充证据、提升置信度或创建此前因证据不足未创建的 `PROCEDURAL` 条目。dreaming cron 只拥有提取、证据融合、冲突诊断和写入调度，不执行 promotion、aging、curator、trajectory outcome rewrite 或 lifecycle transition。

放弃路径：
- 不在 extraction 中执行 promotion、aging、curator 或 confidence decay。
- 不跨 scope 聚合。
- scheduler 实现复用 aging 已有的 `setInterval` + `isCronDue()` 模式，不创建独立状态机。
- 不在 core 中新增 `findSimilarMemories` 或 extraction-only similarity API；只有实现证明 search/detail public path 不足时，才通过独立 core contract refinement 追加查询能力。

### 决策 6：UserCharacteristics 统一受 extraction enabled 控制

选定路径：UserCharacteristics 不定义独立开关，统一由 `nextAgent.memory.extraction.enabled` 控制。启用后只允许低敏、证据充分、与系统行为直接相关的偏好和工作方式。敏感 personal trait、高影响 trait、凭据、隐私身份属性和附件原文个人信息必须拒绝。

放弃路径：
- 不从单次模糊表达推断用户画像。
- 不把用户画像结果默认注入 system prompt。
- 不在 audit/log/metric 中记录 raw trait value。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | owner scope 只来自 trusted identity；输入排除 hidden/replaced/audit-only/not-owned/unavailable 内容；UserCharacteristics 跟随 extraction 总开关且拒绝敏感 trait；所有诊断脱敏。 | Security tests、redaction assertions、owner isolation negative tests |
| 性能/容量 | 默认关闭；dreaming 限制 lookbackDays、maxCycleTrajectories、maxCandidates；大内容只用安全 projection/ref；LLM 仅在规则不足时调用。 | Config contract tests、capacity boundary tests、timeout tests |
| 可靠性/恢复 | dreaming cron 异步执行；幂等触发；失败不改变 RequestRun 终态；部分成功以 `PARTIAL` 诊断表达。 | Resilience tests、integration tests、idempotency tests |
| 可维护性 | 提取语义集中在 local memory lifecycle orchestration boundary；runtime/context/capability 不拥有提取；memory core 继续拥有最终 record/write/merge/adjustment 语义。 | Architecture boundary tests、dependency checks |
| 可测试性 | 规则策略、LLM 策略、candidate validator、write boundary 和 diagnostics 都有稳定输入输出；可以用测试替身模拟 task trajectory query、model 和 memory core。 | Unit tests、contract tests、integration tests |
| 审计/可追溯性 | candidate 和写入结果保留 sourceTrace；job 诊断记录安全 reason code、计数、strategy 和 duration；audit 不含 raw content/trait value。 | Audit tests、structured log/metric assertions |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| terminal commit 成功后异步触发，失败/取消不触发 | T2、T7 | Integration/resilience tests |
| 输入只包含 owner-scoped 已提交可见事实 | T3、T8 | Security/integration tests |
| 默认关闭，RULE_FIRST 默认策略，LLM 显式启用 | T1、T4 | Contract/config tests |
| candidate 必须有 category/content/briefIndex/confidence/sourceTrace | T5、T8 | Contract/unit tests |
| UserCharacteristics 跟随 extraction enabled 且拒绝敏感 trait | T6、T8 | Security/contract tests |
| 跨会话只做同 owner 证据聚合，不做 promotion/aging | T5、T9 | Integration/architecture tests |
| 失败和降级必须显式诊断，不影响请求终态 | T7、T8 | Resilience tests |
| runtime/context/capability 不拥有 extraction 语义 | T9 | Architecture boundary tests |
| OpenSpec strict validation | T10 | `openspec validate add-ts-memory-extraction --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/memory-extraction/spec.md` 主承载 dreaming cron trigger、input eligibility、strategy、candidate quality、user characteristics safety、cross-session aggregation、failure semantics 和 architecture boundary。
- 跨模块架构：`openspec/designs/architecture/memory.md` 主承载 memory extraction flow、runtime/context/capability 边界、owner scope、安全和可观测设计。
- 领域模型/状态机：`openspec/designs/domain/memory.md` 主承载 extraction candidate、sourceTrace、job diagnostic status 和 user trait safety semantics；memory record state 仍由 memory core/aging 相关基线承载。
- API/SPI/event/schema：`openspec/designs/contracts/gateway.md` 或后续 memory contract 文档主承载 task trajectory query 与 memory write 的调用语义；本 change 不定义 Web API。
- 模块职责：`openspec/designs/modules/agent-memory.md` 记录 local backend 的 memory extraction lifecycle boundary；remote complete-service backend 下由远端长期记忆服务承载提取生命周期，本地只记录禁用/薄适配边界；`openspec/designs/modules/agent-runtime.md` 只记录 runtime dreaming cron 触发事实边界。
- ADR：`openspec/designs/adr/memory-extraction-boundary.md` 主承载默认关闭、dreaming cron、RULE_FIRST 默认、LLM 显式启用和 UserCharacteristics 统一受 extraction enabled 控制的决策。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 `memory-extraction` 导航。

## 风险与取舍（Risks / Trade-offs）

- [自动提取写入低质量记忆] -> 默认关闭、`MemoryConfig.status === VALID` 才启动、RULE_FIRST 默认、候选质量门、批内去重、相似/冲突诊断和 memory core idempotency 防重。
- [LLM 提取泄漏敏感内容或成本失控] -> LLM 显式启用、受 timeout/candidate/message 预算控制、只通过模型边界调用。
- [用户画像过度收集] -> UserCharacteristics 跟随 extraction 总开关，敏感 trait 拒绝，audit 不记录 raw value。
- [跨 trajectory 聚合膨胀] -> lookbackDays、maxCycleTrajectories、maxCandidates 上限，且只在同 scope 内处理。
- [与 aging/promotion 边界混淆] -> 本 change 只生成 candidate 和 write result，不定义 lifecycle transition。
- [与 tools/capability 边界混淆] -> 后台 extraction submodule 只消费 core gateway ports，不消费 `LongTermMemoryToolPort`、Tool SPI metadata、memory tool descriptors 或 capability invocation。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/memory-extraction/spec.md`：提炼可验证行为契约。
- `openspec/overview.md`：补充自动长期记忆提取的价值和默认关闭边界。
- `openspec/designs/architecture/memory.md`：提炼 dreaming cron flow、owner scope、runtime/context/capability 边界、失败降级和可观测性。
- `openspec/designs/domain/memory.md`：提炼 extraction candidate、sourceTrace、diagnostic status 和用户特征安全语义。
- `openspec/designs/contracts/gateway.md`：提炼 task trajectory query 与 memory write 相关调用语义；若后续 memory contract 文档更合适，则在归档时以该文档为主承载。
- `openspec/designs/modules/agent-memory.md`：提炼 local backend 的 memory lifecycle extraction 职责和非职责，并记录 remote complete-service backend 下本地不启动提取编排。
- `openspec/designs/modules/agent-runtime.md`：提炼 dreaming cron 触发事实边界，不重复定义提取流程。
- `openspec/designs/adr/memory-extraction-boundary.md`：记录关键取舍。
- `openspec/designs/spec-to-design-map.md`：补充导航。

## 待确认问题（Open Questions）

无。

