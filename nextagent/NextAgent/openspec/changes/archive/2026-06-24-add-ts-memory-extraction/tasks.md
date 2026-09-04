## 0. 当前基线重对齐

- [x] 0.1 重新核验 `add-ts-memory-core` 是否已经在当前代码基线落地，而不是只以 OpenSpec 文档状态为准。
  验证：`rg -n "LongTermMemoryId|MemoryCategory|LongTermMemoryRecord|LongTermMemoryStoreGateway|saveLongTermMemory|longTermMemoryStore" packages tests -S` 必须能找到 public contract、gateway port、local gateway store 和测试入口；否则本 change 保持 blocked，不进入 extraction 实施。
  来源：design 依赖契约审视；基线核验必须使用当前 workspace 的源码和测试结果，不得复用旧审查结论。

- [x] 0.2 明确本 change 的真实前置关系：`add-ts-memory-extraction` 依赖实施时当前代码中可消费的 memory core、memory configuration snapshot、local store/retriever 和 `TaskTrajectoryQueryGateway`，不得在 extraction change 内补写 memory core contract、configuration owner、task trajectory contract 或 storage schema。
  验证：tasks、proposal、design 均不宣称 memory core、configuration 或 task trajectory 当前已经完成；若 core/configuration/task trajectory surface 不存在，先回到对应 owning change 或新的 contract refinement change。
  来源：AGENTS 架构边界、design “不可改动 core”约束。

- [x] 0.3 清理旧实施证据状态：所有旧完成勾选状态、旧测试通过记录和旧代码审查结论均视为不适用于当前代码基线。
  验证：本文件所有实施任务保持 `[ ]`，直到对应代码和验证命令在当前 workspace 实际通过。
  来源：当前代码搜索未发现 extraction/core 关键实现 surface。

## 1. 契约和配置

- [x] 1.1 在当前可消费的 memory core 和 memory configuration snapshot 存在后，定义 `nextAgent.memory.extraction.*` 字段语义，覆盖 `enabled`、`strategy`、`crossSessionSchedule`、`maxCycleTrajectories`、`maxCandidates`、`timeoutMs`、`lookbackDays` 的默认值、允许值和上限；解析、校验、冻结和注入必须走 `add-ts-memory-configuration` 的配置 owner。
  验证：`npx.cmd vitest run tests/agent-kernel/config-assembly.test.ts` 覆盖默认关闭、`RULE_FIRST` 默认、显式 schedule、非法 strategy 和数值范围拒绝。
  来源：spec `Extraction strategy and configuration`。

- [x] 1.2 确认 extraction 只消费冻结后的 `MemoryConfig` snapshot，不绕过 configuration owner 直接读取 raw app config，也不破坏已有 `nextAgent.system.capability-providers`。
  验证：现有 capability provider 配置测试继续通过；新增 memory extraction 配置进入 frozen snapshot 后才可被 extraction 消费，未知字段不会静默进入；`MemoryConfig.status=DISABLED` 或 `INVALID` 时 scheduler 不启动后台读取，`VALID + enabled=true + schedule` 才允许启动。
  来源：`add-ts-memory-configuration` 的 frozen config 约束。

- [x] 1.3 实现 LLM 提取提示词选择规则：通过 shared prompt template registry / assembler 以 `purpose=MEMORY_EXTRACTION`、当前 `agentId/agentVersion`、locale、flow variables 和 selected model 解析模板；cron 场景下 locale 来自 active Agent assembly 的 `runtimeSettings.defaultLanguage`，缺失时传 `undefined`，flow variables 固定为空对象，selected model 来自 active Agent assembly 的默认 model profile 或首个 model profile 并经过现有 model profile registry 校验；Agent 覆盖走既有 Agent package prompt root（`agents/<agentId>/prompts/MEMORY_EXTRACTION/template.yaml`），未匹配 Agent 模板时使用内置 `MEMORY_EXTRACTION` 模板；不得从 configuration snapshot、`promptTemplateIds` 或 `memory-extraction-{lang}` 命名约定选择提示词。
  验证：integration test 覆盖 Agent `MEMORY_EXTRACTION` 模板命中、Agent 模板缺失时 builtin fallback、`defaultLanguage=zh-CN` 命中 `match.locale=zh-CN`、缺失 defaultLanguage 时只匹配 locale-neutral fallback、flow variables 为空对象、selected model 来自现有 model profile selection、同层同 specificity 模板冲突时安全诊断，且诊断不包含完整 prompt/template 内容；source/architecture test 断言 extraction 不读取 `promptTemplateIds`、私有 prompt 文件路径、trajectory locale 或 memory 专属 model 配置；template contract test 或 source assertion 覆盖内置 `MEMORY_EXTRACTION/template.yaml` 明确包含四类 category、TaskTrajectory 安全投影输入边界、`PROCEDURAL` 验证证据要求、`USER_CHARACTERISTICS` 低敏/purpose 边界、source refs 要求和 raw/sensitive content 拒绝规则。
  来源：spec `Extraction strategy and configuration`。

- [x] 1.4 验证 Agent 覆盖的 `MEMORY_EXTRACTION` prompt 不会绕过内置提取边界。
  验证：prompt assembly / contract test 使用 Agent-layer override，断言选择机制仍通过 shared prompt registry；产品定制只能位于 Agent package prompt root（如 `agents/<agentId>/prompts/MEMORY_EXTRACTION/template.yaml`），不得通过修改 builtin fallback 文件实现；覆盖模板不得新增 memory-private loader、`promptTemplateIds` 或 `memory-extraction-{lang}` 路径；实现或审查检查确认覆盖模板仍保留四类 category、输入边界、拒绝边界、sourceTrace 和敏感用户特征限制。
  来源：spec `Extraction strategy and configuration`。

- [x] 1.5 验证移除或禁用 Agent-scoped `MEMORY_EXTRACTION` prompt 后自动回退 builtin prompt。
  验证：prompt assembly / integration test 先命中 Agent-layer override，再移除、禁用或让其 match 条件不匹配，断言同一 Agent 的 extraction prompt resolution 回退到 builtin `MEMORY_EXTRACTION`；回退过程不得要求修改 `packages/agent-context-engine/prompt-templates/builtin/MEMORY_EXTRACTION/template.yaml`。
  来源：spec `Extraction strategy and configuration`。

## 2. Extraction 领域模型和候选质量门

- [x] 2.1 定义 `MemoryExtractionCandidate`、source trace 输入视图、strategy provenance、cycle diagnostic、rejection reason 和 write result 映射，且不定义竞争性的 memory record/state/owner DTO。
  验证：`npx.cmd tsc -b packages/agent-memory` 通过；extraction candidate / strategy / validator / fusion 相关源码只依赖 `agent-common` 和 `agent-contracts/gateway` public subpath，不依赖 memory tools submodule 或 capability executor。
  来源：spec `Extraction candidate quality contract`、`Extraction architecture boundaries`。

- [x] 2.2 实现 candidate validator，按顺序校验 category-specific extraction matrix、core-defined 四类 structured content、sourceTrace、briefIndex、tags、confidence 和安全限制。
  验证：`npx.cmd vitest run packages/agent-memory/tests/memory-extraction.test.ts` 覆盖四类 category 的 accepted/rejected case、矩阵质量门和 rejection reason。
  来源：spec `Extraction candidate quality contract`。

- [x] 2.3 实现批内去重和 `maxCandidates` 上限处理。
  验证：测试覆盖重复 candidate、确定性保留和 `CANDIDATE_LIMIT_REACHED`。
  来源：spec `Extraction candidate quality contract`。

## 3. Core 写入投影和幂等

- [x] 3.1 将通过校验的 candidate 投影为 core-compatible write request，包含 core category、structured content、confidence、tags、briefIndex 和 sourceTrace；稳定 `idempotencyKey` 必须通过 write options 传递，不得放入 request 或 record。
  验证：测试覆盖稳定 write identity、重复候选同一写入身份、无法投影时 `CORE_WRITE_PROJECTION_INVALID`，并断言不生成首写 `longTermMemoryId`。
  来源：spec `Extraction candidate quality contract`。

- [x] 3.2 通过 `store.saveLongTermMemory` 写入新条目，并映射 success、partial failure、storage unavailable 和 memory disabled；首版不要求使用 `batchLongTermMemory`。
  验证：测试使用 memory core 测试替身覆盖写入成功、单项失败、`LTM_STORAGE_UNAVAILABLE` 和 `LTM_DISABLED`；code review 确认没有把 `batchLongTermMemory` 作为首版必经路径。
  来源：spec `Extraction failure and degradation semantics`。

## 4. 输入边界和提取策略

- [x] 4.1 实现 trajectory input builder，只通过 `TaskTrajectoryQueryGateway` 读取同 tenant/subject/agent scope 下已持久化、可读取的 task trajectories，排除跨 scope、不可用、source refs 不完整或缺少安全摘要的 trajectory。
  验证：安全测试覆盖缺少 `TaskTrajectoryQueryGateway`、跨 scope trajectory、不可用 content ref 和 raw attachment/path 不被读取；断言 extraction 不直接读取 session/message DB。
  来源：spec `Dreaming extraction input boundary`。

- [x] 4.2 实现 `extractTrajectoryCandidates` RULE-based 策略函数，从 task trajectory 的目标、约束、观察、动作序列、结果、`taskOutcomeStatus`、`outcomeEvidenceLevel`、`outcomeEvidenceRefs` 和 source refs 中按 category-specific matrix 生成 `FACTUAL`、`CONCEPTUAL`、`PROCEDURAL`、`USER_CHARACTERISTICS` 候选。
  验证：unit test 覆盖典型电信网络任务轨迹产生四类候选；`UNKNOWN/NONE` 或 `UNKNOWN/MODEL_CLAIM` 只能产生低风险事实/显式用户偏好，不能产生高置信 `PROCEDURAL`；并排除不满足矩阵质量门或安全要求的内容。
  来源：spec `Extraction strategy and configuration`。

- [x] 4.3 设计并实现显式 LLM 策略入口，但默认不启用；LLM 只能通过 model boundary 调用，模型不可用、model profile 不可解析、或 selected model 无法解析唯一 `MEMORY_EXTRACTION` 模板时产生显式 degraded/failed 诊断。
  验证：测试覆盖 `RULE_FIRST` 在 eligible trajectory/cycle 的规则 accepted candidate 为 0 时 fallback、规则已有 accepted candidate 时不 fallback、`LLM_ONLY` 模型不可用、model profile 不可用、selected model 无匹配模板或模板冲突、timeout/cancellation 和不泄漏 raw model output。
  来源：spec `Extraction strategy and configuration`、`Extraction failure and degradation semantics`。

## 5. 跨会话聚合和证据融合

- [x] 5.1 实现同 scope 下的 trajectory 候选收集：通过 `TaskTrajectoryQueryGateway` 查询 `lookbackDays` 天内最多 `maxCycleTrajectories` 条 task trajectories，对每条 trajectory 独立运行提取策略。
  验证：测试构造多个同 scope task trajectories，断言不可读、缺少 source refs 和跨 scope trajectory 不会进入 extractor；若缺少 task trajectory contract，本 task blocked 并回到 `add-ts-task-trajectory` 或 owning contract refinement。
  来源：spec `Dreaming cross-session extraction and knowledge fusion`。

- [x] 5.2 实现跨会话 candidate 去重合并，保留多个 sourceTrace refs。
  验证：测试断言 category-specific identity / equivalence key 相同的 candidate 合并后 sourceTrace 包含多个 refs，diagnostic 不包含消息原文。
  来源：spec `Dreaming cross-session extraction and knowledge fusion`。

- [x] 5.3 实现已有 memory record 的融合检测和 confidence corroboration：首版通过 core public `listLongTermMemory(categoryFilter=category, stateFilter=ACTIVE, limit=maxCandidates)` 找同类候选，再用 `getLongTermMemory` 和 category-specific structured content 规则做等价/冲突判断；结构化等价时融合，没有同类候选或明确无关时新建，无法判定时记录 `CROSS_SESSION_AMBIGUOUS`，同 identity 但不等价或冲突时记录 `CROSS_SESSION_CONFLICTING_EVIDENCE` 且不创建 ACTIVE record；同类候选达到 `maxCandidates` 上限且无法证明是新知识时记录 `FUSION_SCAN_LIMIT_REACHED` 并跳过新建；sourceTrace 追加必须通过 `store.saveLongTermMemory(existing longTermMemoryId, sourceTrace refs...)` 触发 core merge 和 `extractionCount` 递增，confidence +0.1 必须使用 `store.adjustLongTermMemoryConfidence`，corroboration 最多 +0.2；后续 verified trajectory 只融合到 memory record 或创建此前因 `UNKNOWN` 被跳过的 procedural memory，不回写旧 trajectory outcome。
  验证：测试覆盖 list/get public path、融合而非新建、sourceTrace refs append、`extractionCount` 由 core 测试替身递增、confidence +0.1、达到上限后 `CORROBORATION_LIMIT_REACHED`、ambiguous/conflicting/scan-limit candidate 不写 ACTIVE record、不执行 promotion/aging/curator、不修改既有 `TaskTrajectoryRecord`，并断言 extraction 不直接改 storage row、不绕过 core lifecycle API、不调用 `searchLongTermMemory` / `getLongTermMemoryDetail` / extraction-only core similarity API。
  来源：spec `Dreaming cross-session extraction and knowledge fusion`。

## 6. UserCharacteristics 安全提取

- [x] 6.1 实现低敏用户特征允许规则，仅允许与系统行为直接相关且证据充分的语言偏好、术语偏好、工作流习惯和低敏技能/角色表达。
  验证：测试覆盖允许类别，并断言保留 sourceTrace、confidence 和安全 briefIndex。
  来源：spec `UserCharacteristics extraction safety`。

- [x] 6.2 实现敏感用户特征拒绝规则，覆盖 credential、health、financial、political、relationship、private identity 和附件原文个人信息。
  验证：negative security tests 断言全部拒绝为 `CANDIDATE_UNSAFE`，diagnostic/audit/log 不包含 raw trait value。
  来源：spec `UserCharacteristics extraction safety`。

## 7. Scheduler 和 app composition

- [x] 7.1 实现 `createMemoryExtractionScheduler(options)`，提供 `start()`、`stop()`、`triggerNow(reason)` API；内部使用 `setInterval` + `isCronDue(config.crossSessionSchedule)`，`MemoryConfig.status !== VALID`、默认配置、extraction disabled 或无 schedule 时不启动。
  验证：unit test 覆盖 start/stop/triggerNow、cron 触发、manual 触发、`.unref()`、`MemoryConfig.status=DISABLED/INVALID` 和 disabled 不读取会话内容。
  来源：spec `Dreaming cross-session extraction and knowledge fusion`。

- [x] 7.2 在 `create-app.ts` 中创建 scheduler 实例，注入 frozen `MemoryConfig`、app-composed long-term memory store/retriever、`TaskTrajectoryQueryGateway`、`extractTrajectoryCandidates`、model availability check 和现有安全日志/观测路径；app startup 调用 `start()`，shutdown 调用 `stop()`。
  验证：`npx.cmd vitest run tests/agent-kernel/memory-runtime-integration.test.ts` 覆盖 scheduler start/stop 生命周期；默认关闭、`MemoryConfig.status=DISABLED/INVALID`、remote complete-service backend 时不会启动后台读取。
  来源：design 决策 1。

- [x] 7.3 验证 remote complete-service memory backend 下本地 extraction lifecycle 不启动。
  验证：app composition / architecture test 覆盖 remote complete-service backend，断言 scheduler、candidate validator、fusion writer 和本地 extraction 观测投影均未注册或未启动。
  来源：spec `Extraction architecture boundaries`。

## 8. 失败、取消、超时和降级

- [x] 8.1 实现 extraction disabled、memory core disabled、task trajectory query failure、content ref unavailable、model unavailable、timeout、cancellation、budget exceeded 和 storage unavailable 的诊断映射。
  验证：tests 覆盖 `EXTRACTION_DISABLED`、`LTM_DISABLED`、`EXTRACTION_INPUT_UNAVAILABLE`、`CONTENT_REF_UNAVAILABLE`、`MODEL_UNAVAILABLE`、`MEMORY_EXTRACTION_TIMEOUT`、`MEMORY_EXTRACTION_CANCELED`、`EXTRACTION_BUDGET_EXCEEDED`、`LTM_STORAGE_UNAVAILABLE`，且 diagnostics 不含 raw failure text。
  来源：spec `Extraction failure and degradation semantics`。

- [x] 8.2 确保 timeout 和 cancellation 停止未完成步骤，不继续后台无界运行。
  验证：可控时钟和 `AbortController` 测试在输入聚合后、写入前触发 timeout/cancellation，断言 `store.saveLongTermMemory` 未被调用。
  来源：spec `Extraction failure and degradation semantics`。

- [x] 8.3 验证 extraction 失败不改变原 RequestRun terminal state。
  验证：integration/resilience tests 和 architecture tests 断言 extraction 不导入 runtime lifecycle/terminal commit 类型。
  来源：spec `Extraction failure and degradation semantics`、`Extraction architecture boundaries`。

## 9. 可观测、审计和脱敏

- [x] 9.1 记录 extraction job started/completed/partial/failed 的结构化日志和指标。
  验证：测试覆盖 `MEMORY_EXTRACTION_CYCLE` 事件，断言 status/strategy/counts/reasonCodes/durationMs 字段安全，且不含 raw content。
  来源：spec `Extraction observability audit and safe diagnostics`。

- [x] 9.2 为成功写入和用户特征相关安全事件记录 audit event。
  验证：测试覆盖 memory write / user-characteristics safety 的安全 observability 或 audit projection，断言只含安全 refs/category/counts/occurredAt，不含 raw content 或 trait value。
  来源：spec `Extraction observability audit and safe diagnostics`。

## 10. 架构边界验证

- [x] 10.1 验证 runtime 只拥有 request lifecycle/terminal commit，不拥有 extraction 判断、候选生成或写入编排。
  验证：`npx.cmd vitest run tests/architecture/memory-extraction-boundary.test.ts` 断言 `agent-runtime/src` 不导入 `@nextagent/agent-memory` 或 extraction 私有路径。
  来源：spec `Extraction architecture boundaries`。

- [x] 10.2 验证 context assembly 不自动检索、注入或提升长期记忆。
  验证：architecture test 断言 `agent-context-engine/src` 不导入 `@nextagent/agent-memory`、extraction 函数名或 memory tool 名。
  来源：spec `Extraction architecture boundaries`。

- [x] 10.3 验证后台 extraction 不通过模型可调用 memory tools 执行写入。
  验证：architecture test 断言 extraction 不依赖 `@nextagent/agent-capability`、`CapabilityInvocation`、`ToolMetadata`、`LongTermMemoryToolPort`、model-facing memory tool descriptors 或 capability executor；code review 确认写入只通过 core gateway ports（`store.saveLongTermMemory` / `store.adjustLongTermMemoryConfidence`）。
  来源：spec `Extraction architecture boundaries`。

- [x] 10.4 验证 `agent-memory` 只承载 local backend extraction orchestration，不包装或重导出 core gateway ports。
  验证：architecture test 断言 `agent-memory` extraction/aging/maintenance submodules 不导入 `agent-platform-gateway-local`、SQLite/FTS5 私有实现、`LongTermMemoryToolPort`、memory tool descriptors、memory tool implementation 或 capability executor；不从 `agent-memory` public export 重新导出 `LongTermMemoryStoreGateway` / `LongTermMemoryRetrieverGateway`。
  来源：`add-ts-memory-core` local gateway ownership 和本 change 的 local lifecycle boundary。

## 11. 最终验证

- [x] 11.1 运行 OpenSpec strict validation。
  验证：`openspec validate add-ts-memory-extraction --strict` 返回 valid。

- [x] 11.2 运行目标 build、unit、contract、integration、security、resilience、observability 和 architecture tests。
  验证：至少包含 `npx.cmd tsc -b packages/agent-contracts packages/agent-platform-gateway-local packages/agent-memory packages/agent-app`、`npx.cmd vitest run packages/agent-memory/tests/memory-extraction.test.ts`、`npx.cmd vitest run tests/architecture/memory-extraction-boundary.test.ts`、相关 config/app integration tests、`npm run test:contract`、`npm run lint:architecture`。

- [x] 11.3 检查 proposal、design、specs、tasks 范围一致性，确认未混入 memory tools、aging、curator、REST/Web UI、sharing、context 自动注入或 request lifecycle ownership 修改。
  验证：code review 记录本 change 只实现 extraction lifecycle boundary，不重定义 memory core contract/storage。

## 12. 归档前更新基线检查（非实施任务）

- [x] 12.1 实现完成并验证通过后，根据 proposal/design 的“归档前更新基线”处理 baseline 文档。
  验证：同步或新增 `openspec/specs/memory-extraction/spec.md`、`openspec/overview.md`、`openspec/designs/architecture/memory.md`、`openspec/designs/domain/memory.md`、`openspec/designs/contracts/gateway.md` 或更合适的 memory contract 文档、`openspec/designs/modules/agent-memory.md`、`openspec/designs/modules/agent-runtime.md`、`openspec/designs/adr/memory-extraction-boundary.md`、`openspec/designs/spec-to-design-map.md`，且没有重复定义同一状态机、API schema、数据 owner 或接口语义。

