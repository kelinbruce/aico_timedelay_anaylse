# add-ts-memory-sharing

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：扩展候选 / Long-term memory

状态：candidate
类型：扩展候选 change
主要 owner：Owner 12 Memory / Learning，协作 Owner 11 Governance / Observability / Release
依赖：add-ts-memory-core

目标：
- 支持知识跨用户共享的 publish-discover-copy 协作模型，包括发布、发现浏览、复制为独立副本和不可变审计日志。

规格输入：

- 发布机制：
  - 条目 owner 可调用 `publishEntry(entryId)` 将个人条目发布到租户级共享池
  - 发布后 `is_published=true`、`published_at` 记录时间戳
  - 仅 ownertor 可发布自己的条目
  - 已发布条目可重复发布（幂等）
  - owner 可调用 `unpublishEntry(entryId)` 撤销发布，已复制的副本不受影响
- 发现浏览：
  - 同租户用户可 `browsePublished(queryText?, categoryFilter?, page, pageSize)` 浏览共享池
  - 结果按 `published_at` 降序排列
  - 返回 L1 级别信息 + ownerSubjectId、publishTime、forkCount
  - 支持 FTS5 关键词过滤
  - 跨租户返回空结果
- 复制机制：
  - 接收者调用 `copyEntries(entryIds[])` 将指定共享条目复制为独立副本
  - 副本使用新的 entryId，ownerSubjectId = 接收者
  - content 在复制时做快照
  - 副本标记 `forkedFrom` 指向来源 entryId
  - 副本独立于原条目生命周期，原条目删除/变更不影响副本
- 审计日志：
  - 每次 PUBLISH、UNPUBLISH、FORK 记录 append-only 审计事件，tenant-scoped 查询。审计字段：eventType、entryId、operatorSubjectId、targetSubjectId?、timestamp、safeMetadata?
  - 审计日志不可变性，tenant-scope 查询
  - 审计字段：eventType、entryId、operatorSubjectId、targetSubjectId?、timestamp、safeMetadata?

契约输入：
- `PublishRequest`、`UnpublishRequest`、`BrowsePublishedQuery`、`CopyEntriesRequest`
- `SharedEntryListItem`（L1 + ownerSubjectId + publishTime + forkCount）
- `KnowledgeAuditLogEntry`
- `ShareAuditEvent`（PUBLISH / UNPUBLISH / FORK）

实现约束：
- shared pool 查询范围限定在当前 tenant，不可跨租户
- fork 副本是独立实体，不跟随原条目变更
- unpublish 不影响已 fork 副本
- 审计日志不可变，仅追加写入
- 复制条目初始 confidence 复制来源值（不做衰减）

非目标：
- NOT 定义模型驱动的记忆工具
- NOT 定义自动提取或老化策略
- NOT 定义 REST API 或 Web UI 实现
- NOT 定义跨租户共享

验收要点：
- Integration：发布后同租户用户可浏览到
- Integration：复制后副本独立于原条目
- Integration：撤销发布不影响已有副本
- Security：跨租户访问返回空结果
- Audit：PUBLISH/UNPUBLISH/FORK 事件正确记录

并行边界：
- 不得修改 agent-core/agent-runtime 的 request lifecycle
- 不得修改模型工具或 capability 通道
- 不得定义 session store schema
