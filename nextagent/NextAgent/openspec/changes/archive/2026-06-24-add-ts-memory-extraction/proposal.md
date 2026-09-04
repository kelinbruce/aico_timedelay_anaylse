## 背景与问题（Why）

长期记忆计划有两条知识新增路径。`add_memory` 是对话中的低时延 fast path，只处理用户明确要求立即记住的知识并写入 ACTIVE 记忆；它不做相似检测、冲突消歧、candidate/evidence 写入或 confidence corroboration。本 change 补全 dreaming——跨 trajectory 定时调度，提取+融合+写入，从已持久化任务轨迹发现重复模式、高频问题、持久偏好和可能冲突的证据，并在后台完成相似聚合、冲突消歧、sourceTrace 融合和受控置信度提升，失败不影响已提交请求终态。

本 change 的已实施状态已全部回退。后续实施必须先以当前 workspace 的源码、测试和验证命令确认 `add-ts-memory-core`、`add-ts-memory-configuration`、local memory store/retriever 和 `add-ts-task-trajectory` 已提供可消费 surface，而不是只依赖 OpenSpec 文档状态；若前置 surface 不存在，本 change 保持 blocked。

## 变更范围（What Changes）

- 新增 `memory-extraction` capability，定义 dreaming cron 定时提取的触发时机、输入边界、策略执行、候选校验、跨会话融合、写入路径、失败降级和可观测要求。
- 规定提取统一在 dreaming cron 中执行，不在请求执行期触发。
- 规定提取任务只能读取可信 scope 下已持久化的 `TaskTrajectory`，从任务目标、约束、关键观察、动作序列、结果摘要、`taskOutcomeStatus`、`outcomeEvidenceLevel`、`outcomeEvidenceRefs` 和 source refs 中生成候选；不得直接从 message history 生成长期记忆。
- 规定默认 `nextAgent.memory.extraction.enabled=false`；启用后策略为 `RULE_FIRST`（规则优先；eligible trajectory/cycle 的规则 accepted candidate 为 0 时才 LLM 回退）。LLM 提取只能通过模型边界调用。
- 规定 LLM 提取提示词选择由本 change 拥有：通过 shared prompt template registry / assembler 以 `purpose=MEMORY_EXTRACTION`、当前 `agentId/agentVersion`、extraction locale、flow variables 和 selected model 解析模板；cron 场景下 extraction locale 来自 active Agent assembly 的 `runtimeSettings.defaultLanguage`（缺失则为 `undefined` 以匹配兜底模板），flow variables 固定为空对象，selected model 由 active Agent assembly 的默认/首个 model profile 经既有 model profile registry 校验得到；Agent 覆盖使用既有 Agent package prompt root（如 `agents/<agentId>/prompts/MEMORY_EXTRACTION/template.yaml`），未匹配 Agent 模板时使用内置 `MEMORY_EXTRACTION` 模板；不得通过 configuration snapshot、`promptTemplateIds` 或 `memory-extraction-{lang}` 命名约定绑定提示词。
- 规定相似检测、冲突消歧和跨会话融合只在 dreaming 中执行：在已有相似条目上通过 `saveLongTermMemory(existing longTermMemoryId, sourceTrace refs...)` 触发 core sourceTrace merge 和 `extractionCount` 递增，并通过 `adjustLongTermMemoryConfidence` 受控提升 confidence（+0.1，上限 +0.2），不执行 promotion/aging/curator。
- 规定提取候选必须映射到 Bloom 4 分类，包含 `briefIndex`、`confidence`、`sourceTrace` 和结构化 content。
- 规定写入通过 `store.saveLongTermMemory`；首次写入的 `longTermMemoryId` 由 memory core/gateway 生成，extraction 为同一 scope + candidate 语义生成稳定 `idempotencyKey` 作为 write options，保证重复触发不会重复创建。
- 规定 UserCharacteristics 只提取低敏偏好，拒绝敏感个人信息。
- 不定义的：promotion/decay/aging/curator/sharing/REST maintenance/context 自动注入。
- 不包含 BREAKING 变更；实施时依赖当前代码中已可消费的 `add-ts-memory-core`、memory configuration snapshot、local memory store/retriever 和 `TaskTrajectoryQueryGateway`，且与 `add-ts-memory-tools` 职责分离。local memory backend 下 dreaming scheduler 由本 change 实现；remote complete-service backend 下，extraction 由远端长期记忆服务拥有，本地不得启动该 scheduler 或重复执行 candidate/fusion/write 编排。

## Capability 影响（Capabilities）

### 新增 Capability

- `memory-extraction`: dreaming cron 跨会话知识提取、融合和写入。

### 修改的 Capability

无。

## 交付状态与前置门禁

本 change 当前为待实施设计状态。旧的实施勾选和验证记录已回退，不能作为当前代码基线的完成证据。

实施前必须满足以下门禁：
- `add-ts-memory-core` 已在当前代码基线完成实施和验证，且能通过源码搜索和测试证明存在 `LongTermMemoryRecord`、memory gateway port、local store/retriever 和对应验证。归档顺序按 OpenSpec release 流程处理，不作为跳过当前源码/测试核验的依据。
- `add-ts-memory-configuration` 已在当前代码基线提供冻结后的 `MemoryConfig` snapshot；只有 `MemoryConfig.status === VALID` 且 `nextAgent.memory.extraction.enabled=true` 时，本地 extraction scheduler 才能启动。本 change 只拥有 `nextAgent.memory.extraction.*` 字段语义，不绕过 configuration 直接读取 raw app config。
- `add-ts-task-trajectory` 必须在本 change 的 extraction implementation 前完成实施和验证，且当前代码基线必须提供可消费的 owner/agent scoped `TaskTrajectoryQueryGateway`，能够按 time window 获取已持久化 task trajectories；若不存在，本 change 必须保持 blocked，不得退回到私查 session/message DB。归档顺序按 OpenSpec release 流程处理，不作为跳过当前源码/测试核验的依据。
- 当前 release scope 明确纳入 Long-term memory 能力组。
- 当前 app composition 选择 local memory backend；若选择 remote complete-service backend，本 change 的本地 extraction scheduler MUST remain disabled，相关能力由 remote service / remote adapter owning change 定义。
- 如果 core 契约无法满足 extraction 写入投影需求，不得修改 core，必须先提出 contract refinement change。

## 影响范围（Impact）

- Runtime：不拥有提取语义；cron 由 extraction 内部调度。
- Memory 边界：local backend 可在 `agent-memory` 中新增 dreaming 提取、策略执行、候选校验、融合和写入编排；只消费 app composition 注入的 `LongTermMemoryStoreGateway` / `LongTermMemoryRetrieverGateway` 和 `TaskTrajectoryQueryGateway`，不包装、重导出或替代 core gateway ports。remote complete-service backend 不执行本地编排。
- Gateway：通过 `add-ts-task-trajectory` 定义的 `TaskTrajectoryQueryGateway` 获取已持久化 task trajectories；不直接读取 session/message private implementation，不私查 task trajectory table。
- Context：不修改 context assembly。
- Capability：不通过 `add_memory` 等 memory tools 执行后台提取；不消费 `LongTermMemoryToolPort`、Tool SPI metadata、memory tool descriptors 或 capability executor。与 tools 边界一致，model-facing `add_memory` 不写 candidate/evidence；candidate/evidence 只存在于 extraction/dreaming 编排内部，最终通过 memory core gateway ports 融合或创建 ACTIVE memory record。
- Configuration：本 change 定义 `nextAgent.memory.extraction.*` 字段语义和默认值；解析、校验、冻结和注入归 memory configuration snapshot。
- Observability/Audit：新增 dreaming job 诊断、candidate 接受/拒绝/融合诊断。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/memory-extraction/spec.md`：稳定行为契约，包含 TaskTrajectory 输入边界和四类记忆生成矩阵。
- `openspec/designs/architecture/memory.md`、`openspec/designs/modules/agent-memory.md`、`openspec/designs/adr/memory-extraction-boundary.md`、`openspec/designs/spec-to-design-map.md` 等按需更新。

