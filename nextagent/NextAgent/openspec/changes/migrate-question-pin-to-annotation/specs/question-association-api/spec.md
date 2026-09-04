## MODIFIED Requirements

### Requirement: 联想结果来源标签

每条联想结果 MUST 包含 `text`（非空字符串）和 `source`（来源分类标签）字段。`source` MUST 为以下四个值之一：
- `"pinned"`：来自用户问题收藏（`conversation_annotations.isQuestionFavorited=true`，通过 `listQuestionFavoriteTurns` 查询）
- `"high-frequency"`：来自本地高频问题（`QuestionRecommendationGateway.listFrequentHistoryQuestions`，仅 LOCAL 模式）
- `"recommended"`：来自 provider 语义相似问题（`QuestionRecommendationGateway.recommendSimilarPresetQuestions`，仅 REMOTE 模式）
- `"static"`：来自静态注册问题（内存目录）

`source` 仅用于前端纯视觉展示，不承载交互语义。`"high-frequency"` 和 `"recommended"` 不会在同一 deployment mode 下同时出现：LOCAL 模式联想包含 `high-frequency` 层（无 `recommended`），REMOTE 模式联想包含 `recommended` 层（无 `high-frequency`）。

#### Scenario: 响应 DTO shape
- **WHEN** 查询返回联想结果列表
- **THEN** 每个条目 MUST 包含 `text` 和 `source`
- **AND** `source` MUST 为 `"pinned"`、`"high-frequency"`、`"recommended"` 或 `"static"` 之一
- **AND** MUST NOT 包含 `hash`、`frequency`、`is_pinned`、`pinned_at` 或任何 DB 内部字段

#### Scenario: LOCAL 模式 high-frequency 与 recommended 互斥
- **WHEN** LOCAL 模式下查询联想结果
- **THEN** `source` MAY 包含 `"pinned"`、`"high-frequency"`、`"static"`
- **AND** `source` MUST NOT 为 `"recommended"`

#### Scenario: REMOTE 模式 recommended 与 high-frequency 互斥
- **WHEN** REMOTE 模式下查询联想结果
- **THEN** `source` MAY 包含 `"pinned"`、`"recommended"`、`"static"`
- **AND** `source` MUST NOT 为 `"high-frequency"`

### Requirement: 三层来源加载与排序

`FrequentQuestionService.listQuestionAssociations()` SHALL 按以下优先级加载和排序三层来源。第二层（高频/推荐）由 deployment mode 决定数据来源：

1. pinned 层：调用 `listQuestionFavoriteTurns()`，按 `updated_at DESC` 排序，MUST NOT 按 locale 过滤，关键词模糊匹配
2. 动态层（二选一，由 deployment mode 决定）：
   - LOCAL 模式 high-frequency 层：调用 `QuestionRecommendationGateway.listFrequentHistoryQuestions()`（local adapter 读本地 `user_question_activity` 表），关键词模糊匹配，source=`"high-frequency"`，MUST NOT 按 locale 过滤
   - REMOTE 模式 recommended 层：调用 `QuestionRecommendationGateway.recommendSimilarPresetQuestions()`（remote adapter 调 provider 返回语义相似问题），source=`"recommended"`，MUST NOT 按 locale 过滤
3. static 层：调用 `loadCatalog()`，按目录原始顺序排序（fixed 和非 fixed 合并），MUST 按 locale 过滤，关键词模糊匹配

pinned 层、LOCAL 模式 high-frequency 层和 static 层的关键词匹配为 case-insensitive 子串匹配（`text.toLowerCase().includes(keyword.toLowerCase())`），在 service 层 in-memory 完成。REMOTE 模式 recommended 层由 provider 执行语义匹配，service 层不再对 recommended 层做关键词过滤。

static 层 SHALL 将 `fixed` 和非 `fixed` 静态问题合并为一层，不保持 fixed 优先。static 层内按目录原始顺序排列。

当动态层的 gateway binding 为 `undefined` 或返回 `SafeError` 时，该层 MUST 返回空，列表降级为 pinned + static。

#### Scenario: 三层来源加载
- **WHEN** 查询联想结果
- **THEN** service MUST 依次加载 pinned、动态层、static 三层数据
- **AND** pinned 和 static MUST NOT 按 locale 过滤（动态层由 provider/adapter 决定）
- **AND** static MUST 按 locale 过滤

#### Scenario: LOCAL 模式 high-frequency 层有数据
- **WHEN** LOCAL 模式下查询联想结果
- **AND** 本地 `user_question_activity` 表有 3 条 `ask_frequency > threshold` 的高频问题
- **AND** 其中 2 条匹配关键词
- **THEN** high-frequency 层 MUST 包含 2 条问题
- **AND** `source` MUST 为 `"high-frequency"`
- **AND** MUST NOT 调用 `recommendSimilarPresetQuestions`

#### Scenario: REMOTE 模式 recommended 层有数据
- **WHEN** REMOTE 模式下查询联想结果
- **AND** provider 返回 3 条相似问题
- **THEN** recommended 层 MUST 包含 3 条问题
- **AND** `source` MUST 为 `"recommended"`
- **AND** MUST NOT 调用 `listFrequentHistoryQuestions`

#### Scenario: 动态层 binding 缺失降级
- **WHEN** `QuestionRecommendationGateway` binding 为 `undefined`
- **THEN** 动态层 MUST 返回空
- **AND** 列表 MUST 降级为 pinned + static
- **AND** MUST NOT 抛出错误

### Requirement: cap 级联填充策略

三层来源各设 cap：pinned=10、动态层=5、static=5。系统 SHALL 按以下级联策略填充至 top 20：
1. pinned 层取 `min(10, pinned_filtered.length)` 条
2. 动态层取 `min(5, dynamic_filtered.length, remaining_after_pinned)` 条
3. static 层取 `min(5, static_filtered.length, remaining_after_dynamic)` 条
4. 若三层初次分配后仍有剩余 slot，按优先级从各层剩余匹配项回填：先动态层剩余，再 static 剩余
5. 总和不超过 20

#### Scenario: 各层匹配充足
- **WHEN** 三层匹配数均超过各自 cap（pinned > 10, 动态层 > 5, static > 5）
- **THEN** 结果 MUST 为 10 pinned + 5 动态层 + 5 static = 20 条

#### Scenario: pinned 匹配不足
- **WHEN** pinned 匹配 3 条，动态层匹配 10 条，static 匹配 30 条
- **THEN** 结果 MUST 为 3 pinned + 5 动态层 + 5 static + 7 回填（先动态层剩余 5，再 static 剩余 2）= 20 条

#### Scenario: 动态层为空
- **WHEN** 动态层为空（binding 缺失或无数据）
- **AND** pinned 匹配 3 条，static 匹配 30 条
- **THEN** 结果 MUST 为 3 pinned + 0 动态层 + 5 static + 12 回填（static 剩余）= 20 条

#### Scenario: 总匹配不足 20
- **WHEN** 三层总匹配数为 10
- **THEN** 结果 MUST 为全部 10 条，MUST NOT 凑数

### Requirement: 去重

三层来源合并时 MUST 按 `question_hash`（SHA-256 of trimmed text）去重。遍历顺序为 pinned → 动态层 → static，首次出现的 hash 记录其 source 标签，后续重复 hash 跳过。同一问题的 `source` 取最高优先级来源。

#### Scenario: 跨层去重（pinned 与动态层）
- **WHEN** 一条问题同时出现在 pinned 和动态层
- **THEN** 结果中该问题 MUST 只出现一次
- **AND** `source` MUST 为 `"pinned"`

#### Scenario: static 与动态层重复
- **WHEN** 一条问题同时出现在 static 和动态层
- **THEN** 结果中该问题 MUST 只出现一次
- **AND** `source` MUST 为动态层的标签（`"high-frequency"` 或 `"recommended"`）

#### Scenario: 跨层去重
- **WHEN** 一条问题同时出现在 pinned 和 high-frequency 层
- **THEN** 结果中该问题 MUST 只出现一次
- **AND** `source` MUST 为 `"pinned"`

#### Scenario: static 与 high-frequency 重复
- **WHEN** 一条问题同时出现在 static 和 high-frequency 层
- **THEN** 结果中该问题 MUST 只出现一次
- **AND** `source` MUST 为 `"high-frequency"`

### Requirement: 联想查询响应类型

`QuestionAssociationResult` SHALL 包含 `locale`（字符串）和 `questions`（数组）。`QuestionAssociationEntryDto` SHALL 包含 `text`（非空字符串）和 `source`（`"pinned" | "high-frequency" | "recommended" | "static"`）。

#### Scenario: 响应结构
- **WHEN** 查询返回联想结果
- **THEN** 响应 MUST 包含 `locale` 和 `questions`
- **AND** 每个 question 条目 MUST 包含 `text` 和 `source`
- **AND** `source` MUST 为 `"pinned"`、`"high-frequency"`、`"recommended"` 或 `"static"` 之一
