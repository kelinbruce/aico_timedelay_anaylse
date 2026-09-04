## MODIFIED Requirements

### Requirement: 高频问题合并排序规则

`FrequentQuestionService` SHALL 按以下优先级合并排序高频问题列表：
1. `fixed=true` 的静态问题（from `CategoryQuestionResourceDiscovery` 内存目录），按 locale 过滤
2. 用户 `isQuestionFavorited=true` 的问题（from `conversation_annotations`，通过 `listQuestionFavoriteTurns` 查询，按 `updated_at DESC` 排序），MUST NOT 按 locale 过滤
3. 用户高频问题（from `QuestionRecommendationGateway.listFrequentHistoryQuestions`，LOCAL 模式读本地 `user_question_activity` 表，REMOTE 模式调 provider），MUST NOT 按 locale 过滤，排除已出现在第 1 层和第 2 层的问题
4. 剩余静态问题（from 内存目录，排除已出现在第 1 层的问题），按 locale 过滤
5. 以上合并后列表为空时，返回空列表，由前端 fallback 到 i18n 硬编码默认问题

LOCAL 模式下高频层的 `threshold` SHALL 来自配置项 `nextAgent.highFrequencyQuestion.frequencyThreshold`，默认值为 8。REMOTE 模式下 provider 直接返回 top N，无 threshold 概念。

同一问题文本 MUST NOT 在列表中重复出现。去重以 `question_hash` 为准。每个问题条目 MUST 包含 `text`。

当 `QuestionRecommendationGateway` binding 为 `undefined` 或返回 `SafeError` 时，高频层 MUST 返回空，列表降级为固定问题 + pin 收藏 + 剩余静态问题。

#### Scenario: 五层排序
- **WHEN** 查询时 DB/provider 有 pin 收藏问题和高频问题，内存目录有 fixed 和非 fixed 的静态问题
- **THEN** 列表 MUST 按 fixed → pinned → high-frequency → 剩余静态 的顺序排列
- **AND** 同一问题 MUST NOT 重复出现

#### Scenario: 仅 pinned 问题
- **WHEN** `conversation_annotations` 有 `isQuestionFavorited=true` 的问题，无高频问题，内存目录无数据
- **THEN** 列表 MUST 仅包含 pin 收藏问题

#### Scenario: 高频层 provider 不可用降级
- **WHEN** REMOTE 模式下 `QuestionRecommendationGateway.listFrequentHistoryQuestions` 返回 `SafeError`
- **THEN** 高频层 MUST 返回空
- **AND** 列表 MUST 降级为固定问题 + pin 收藏 + 剩余静态问题

#### Scenario: 高频层 binding 缺失降级
- **WHEN** `QuestionRecommendationGateway` binding 为 `undefined`
- **THEN** 高频层 MUST 返回空
- **AND** MUST NOT 抛出错误

#### Scenario: 全部为空
- **WHEN** 无 pin 收藏，无高频问题，内存目录无数据
- **THEN** 列表 MUST 为空数组

### Requirement: Pin API 端点

系统 SHALL 提供 `POST /api/v1/user-questions/pin` 端点，用于将问题添加到常问列表。系统 MUST NOT 提供 unpin API。

端点 MUST 通过 trusted Web channel identity resolver 解析 owner scope。`agentId` MUST 使用当前 trusted Agent Scope（`activeAgentId`），MUST NOT 从请求体获取。端点 MUST 要求写权限（通过 `AuthGate` 或等效机制）。

请求体 MUST 包含 `sessionId`（非空字符串）和 `runId`（非空字符串）字段。系统 MUST 通过 annotation upsert 路径设置 `isQuestionFavorited=true`，锚定 `requestRunId=runId`。pin 不设数量上限，MUST NOT 执行 FIFO 淘汰。

#### Scenario: pin 问题
- **WHEN** 已认证且有写权限的用户 POST `{ "sessionId": "S1", "runId": "R1" }`
- **THEN** 系统 MUST 调用 annotation upsert 设置 `isQuestionFavorited=true`
- **AND** MUST 返回 HTTP 204

#### Scenario: pin 保留既有标注字段
- **WHEN** run `R1` 已有 `sentiment="UP"`
- **AND** 用户 pin 该 run 的问题
- **THEN** `isQuestionFavorited` MUST 设为 `true`
- **AND** `sentiment` MUST 保持 `"UP"` 不变

#### Scenario: pin 无上限
- **WHEN** scope 下已有 100 个 `isQuestionFavorited=true` 的标注行
- **AND** 用户 pin 第 101 个 run 的问题
- **THEN** 系统 MUST 接受写入
- **AND** MUST NOT 淘汰任何已有问题收藏

#### Scenario: 缺少 sessionId 或 runId
- **WHEN** 用户 POST `{ "question": "some text" }`（旧 body shape）
- **THEN** 系统 MUST 返回 HTTP 400
- **AND** MUST NOT 调用 annotation upsert

#### Scenario: 未认证请求
- **WHEN** 未认证用户调用 pin
- **THEN** 系统 MUST 返回 401

#### Scenario: 无写权限
- **WHEN** 已认证但无写权限的用户调用 pin
- **THEN** 系统 MUST 返回 403

### Requirement: 高频问题配置项

系统 SHALL 通过 `default-system.yaml` 的 `nextAgent.highFrequencyQuestion` 配置以下参数：
- `frequencyThreshold`：高频问题频率阈值，整数，默认 8。仅 LOCAL 模式使用。

`pinLimit` 配置项已移除（pin 不设上限）。

`FrequentQuestionService` 和 local `QuestionRecommendationGateway` adapter MUST 读取 `frequencyThreshold` 配置值。当配置缺失时 MUST 使用默认值。

#### Scenario: 使用默认配置
- **WHEN** 配置文件中未指定 `nextAgent.highFrequencyQuestion`
- **THEN** `frequencyThreshold` MUST 为 8

#### Scenario: 自定义配置
- **WHEN** 配置文件指定 `nextAgent.highFrequencyQuestion.frequencyThreshold = 5`
- **THEN** LOCAL 模式高频问题阈值 MUST 为 5

#### Scenario: pinLimit 配置项移除
- **WHEN** 配置文件包含 `nextAgent.highFrequencyQuestion.pinLimit`
- **THEN** 配置 validation MUST 忽略该字段（或返回 warning）
- **AND** 系统 MUST NOT 使用该值执行 pin 上限

## REMOVED Requirements

### Requirement: （原）Pin API 端点

原 Pin API 端点的 `{ question }` body shape、SHA-256 hash 计算、`PIN_QUESTION_MAX_LENGTH` 截断、`pinLimit` FIFO 淘汰等行为已移除。新 Pin API 端点接收 `{ sessionId, runId }` body，通过 annotation upsert 实现。详见上述 MODIFIED "Pin API 端点" requirement。
