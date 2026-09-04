# add-ts-memory-extraction

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：扩展候选 / Long-term memory

状态：candidate
类型：扩展候选 change
主要 owner：Owner 12 Memory / Learning
依赖：add-ts-memory-core、add-ts-memory-configuration

目标：
- 与 add_memory（对话中用户触发，提取碎片知识）互补：dreaming 拥有跨会话全局视图，可发现重复模式、高频问题、持久偏好

规格输入：

- 提取策略（`adnclaw.memory.extraction.strategy`）：
  - `RULE_ONLY`（默认）：基于模式匹配确定性提取 factual triple、procedure steps、concept 定义
  - `LLM_ONLY`：通过模型边界驱动提取，LLM 提取提示词通过 `promptTemplateIds` 中 `memory-extraction-{lang}` 约定命名获取
  - `RULE_FIRST`：先规则后 LLM 回退
  - `LLM_FIRST`、`PARALLEL`：组合策略
  - 各策略只通过模型边界调用，不得直接调用外部 HTTP 或 provider SDK
- 提取触发时机：cron dreaming 定时调度，不参与 terminal commit，提取失败不影响已提交请求终态
- 提取范围：
  - 只读取当前 scope（`tenantId`/`subjectId`/`agentId`）下已提交、可见的会话事实
  - 排除 hidden/replaced/audit-only/not-owned 内容
  - 大内容只使用安全 projection 或 content ref
- 提取结果包含 category 分类、结构化 content、初始 confidence（默认 0.5）、sourceTrace（sessionId、requestId、runId）
- UserCharacteristics 提取默认关闭，启用后只允许低敏、证据充分的偏好/工作方式
- 跨会话提取在同一 scope 内做同实体证据聚合：
  - dreaming cron 后台周期回看 `lookbackRuns` 个历史请求
  - 周期后台模式（cron `crossSessionSchedule`，默认关闭）扫描 `lookbackDays` 天内会话
  - 发现已有相似条目时做证据融合——追加 sourceTrace refs、受控提升 confidence（+0.1，上限 +0.2）
  - 相似度不足、corroboration 达上限等边界情况有显式诊断

契约输入：
- extraction candidate（category、structured content、briefIndex、confidence、tags、sourceTrace、strategyProvenance）
- extraction job 诊断（`SKIPPED`/`COMPLETED`/`PARTIAL`/`FAILED`）
- 提取配置仅 3 个暴露字段：`adnclaw.memory.extraction.enabled`（默认 false）、`strategy`（默认 RULE_FIRST）、`crossSessionSchedule`（cron 表达式）。其余字段第一版用默认值。

实现约束：
- 提取位于 `agent-memory` 包，是 dreaming cron 后台生命周期
- 写入只通过 `MemoryService.saveLongTermMemory`，不通过 `add_memory` 等模型工具
- LLM 提取通过 `agent-model` 端口，不直接调用 provider SDK
- 提取失败隔离记录，不传播到主请求链路
- 配置不得包含 scope 字段

非目标：
- NOT 定义模型驱动的记忆工具（search/detail/add/update/forget/get_user_context）
- NOT 定义三态生命周期或归档策略（aging）
- NOT 定义 confidence 的 promotion/decay 策略
- NOT 定义后台 dreaming 调度器

验收要点：
- Contract test：Rule-based extractor 对已知模式的提取正确性
- Integration：终端提交后提取任务正确触发并写入
- Resilience：提取失败不影响主请求终端提交
- Integration：跨会话提取对同一实体的证据聚合
- Security：排除 hidden/replaced/not-owned 内容，拒绝敏感用户特征

并行边界：
- 不得修改 agent-core/agent-runtime 的 request lifecycle
- 不得修改 agent-context-engine 的 context assembly
- 不得定义 model tool 行为（由 add-ts-memory-tools 负责）