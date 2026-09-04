# add-ts-memory-aging

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：扩展候选 / Long-term memory

状态：candidate
类型：扩展候选 change
主要 owner：Owner 12 Memory / Learning
依赖：add-ts-memory-core

目标：
- 管理知识条目的生命周期老化过程，包括三态状态转换（ACTIVE→ARCHIVED→DELETED）、置信度动态调整、后台 curator 和 dreaming 调度。

规格输入：

- 三态生命周期：
  - ACTIVE：参与正常 FTS5 检索和混合排序
  - ARCHIVED：移入归档表，排除正常检索，可通过 time-range 查询检索；记录 archivedAt 和 archiveReason
  - DELETED：永久删除，不可恢复
- 自动 ACTIVE→ARCHIVED 转换：
  - Curator 运行时检查 `lastAccessedAt > active-days`（默认 60 天）的 ACTIVE 条目
  - 转换：INSERT 进入 `knowledge_archive`，DELETE 从 `long_term_memory`
  - archiveReason 设为 "inactive"
  - pinned 条目豁免自动转换
- 自动 ARCHIVED→DELETED 转换：
  - Curator 运行时检查 `archivedAt > archive-days`（默认 30 天）的已归档条目
  - 永久删除，不可恢复
- 归档复活：
  - time-range 检索命中已归档条目时复活（重新 INSERT 到 `long_term_memory`，DELETE 从 `knowledge_archive`）
  - 复活时 confidence +0.1 提升
- 置信度动态调整：
  - Promotion：confidence >= threshold（默认 0.7）且 accessCount >= threshold（默认 5）时自动提升；promoted 条目获得更高检索优先级
  - Decay：长期未访问的条目 confidence 逐步衰减
  - Corroboration：多会话重复出现的同一事实增加 confidence
- Curator 算法：
  - 在 dreaming 周期中运行
  - 识别 promotion 候选 → 执行 promotion
  - 识别归档候选 → 执行 ACTIVE→ARCHIVED
  - 识别删除候选 → 执行 ARCHIVED→DELETED
  - 产生 CuratorCycleResult（promotedCount、archivedCount、deletedCount）
- DreamingScheduler：
  - 后台定时调度，Quarkus @Scheduled 等价
  - 默认周期：每日凌晨触发
  - 依次执行：promotion cycle → curator cycle
  - 每次 cycle 必须产生结构化结果并暴露 metrics
- graceful degradation：dreaming/curator 不可用时系统继续运行，记忆操作不受影响

契约输入：
- `MemoryCurator` port：runPromotion()、runArchive()、runDeletion()
- `CuratorCycleResult`（promotedCount、archivedCount、deletedCount、timestamp）
- `DreamingScheduler` port
- `PromotionAlgorithm`、`CuratorAlgorithm`
- `KnowledgeArchiveEntry`（同 LongTermMemoryEntry 结构 + archiveDate）
- `ConfidenceAdjustment` 策略接口

实现约束：
- 所有老化操作是后台生命周期，不参与 request terminal commit
- dreaming/curator 必须可独立启用/禁用
- promotion 和 decay 阈值必须可通过配置调整
- dreaming 运行频率必须可配置
- 归档表与活跃表物理分离（不同表或不同分区）
- pinned 条目任何阶段都豁免自动转换

非目标：
- NOT 定义模型驱动的记忆工具（search/detail/add/update/forget/get_user_context）
- NOT 定义自动提取算法
- NOT 定义 REST API 管理入口或知识共享
- NOT 定义配置 namespace（由 add-ts-memory-configuration 负责）

验收要点：
- Integration：ACTIVE 条目超过 active-days 后自动转 ARCHIVED
- Integration：pinned 条目豁免归档
- Integration：time-range 检索命中归档条目后自动复活
- Integration：promotion 算法在满足条件时正确提升条目
- Resilience：dreaming 调度失败不影响主请求执行
- Metrics：CuratorCycleResult 正确暴露 promoted/archived/deleted 计数

并行边界：
- 不得修改 agent-core/agent-runtime 的 request lifecycle
- 不得修改 agent-context-engine 的 context assembly
- 不得直接调用模型工具（由 add-ts-memory-tools 负责）
