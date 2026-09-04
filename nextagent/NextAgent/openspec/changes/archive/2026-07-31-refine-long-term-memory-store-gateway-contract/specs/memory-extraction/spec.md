## MODIFIED Requirements

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
