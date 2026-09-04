## ADDED Requirements

### Requirement: QuestionRecommendationGateway local adapter

系统 SHALL 在 LOCAL deployment mode 下提供 `QuestionRecommendationGateway` 的 local adapter 实现，通过 `WorkingMemoryGatewayBindings.questionRecommendations` 注入。local adapter MUST 复用 `UserQuestionActivityStoreGateway` 的本地 SQLite store 提供高频问题查询。

`listFrequentHistoryQuestions(request)` MUST 委托 `UserQuestionActivityStoreGateway.listHighFrequency()`，将 `UserQuestionActivityRecord` 映射为 `FrequentHistoryQuestion { content, frequency }`。`content` 来自 `questionText`，`frequency` 来自 `askFrequency`。`limit` 透传为查询的记录数上限。查询 threshold 来自配置项 `nextAgent.highFrequencyQuestion.frequencyThreshold`（默认 8）。当 store 返回 `SafeError` 时，adapter MUST 返回该 `SafeError`。

`recommendSimilarPresetQuestions(request)` 在 LOCAL 模式下 MUST 返回 `RecommendSimilarPresetQuestionsResult { questions: [] }`（空列表）。LOCAL 模式无 provider 相似问题能力，联想层的 `recommended` 来源为空。

local adapter MUST NOT 调用外部 HTTP provider。local adapter MUST NOT 写入任何持久化状态。

#### Scenario: Local adapter returns high frequency questions
- **WHEN** LOCAL 模式下调用 `listFrequentHistoryQuestions({ limit: 5 })`
- **AND** 本地 `user_question_activity` 表有 3 条 `ask_frequency > threshold` 的记录
- **THEN** adapter MUST 返回 3 条 `FrequentHistoryQuestion`
- **AND** 每条的 `content` MUST 为 `questionText`，`frequency` MUST 为 `askFrequency`

#### Scenario: Local adapter empty result
- **WHEN** LOCAL 模式下调用 `listFrequentHistoryQuestions({ limit: 5 })`
- **AND** 本地无高频问题记录
- **THEN** adapter MUST 返回 `{ questions: [] }`

#### Scenario: Local adapter similar questions always empty
- **WHEN** LOCAL 模式下调用 `recommendSimilarPresetQuestions({ query: "告警", limit: 5 })`
- **THEN** adapter MUST 返回 `{ questions: [] }`
- **AND** MUST NOT 发起 HTTP 请求

#### Scenario: Local adapter propagates store SafeError
- **WHEN** `UserQuestionActivityStoreGateway.listHighFrequency()` 返回 `SafeError`
- **THEN** local adapter MUST 返回该 `SafeError`
- **AND** MUST NOT 包装为其他错误

### Requirement: QuestionRecommendationGateway remote adapter

系统 SHALL 在 REMOTE deployment mode 下提供 `QuestionRecommendationGateway` 的 remote adapter 实现，通过 `WorkingMemoryGatewayBindings.questionRecommendations` 注入。remote adapter MUST 调用 provider HTTP 接口，MUST NOT 读写本地 SQLite store。

#### 高频问题查询

`listFrequentHistoryQuestions(request)` MUST 调用 `POST /rest/naie/memory/v1/user/portrait`。request body 映射：

| Canonical request | Provider wire |
|---|---|
| `tenantId` | body `tenantId` |
| `subjectId` | body `userId` |
| `agentId` | body `agentId` |
| `limit` | body `searchCriteria.questionTopN` |
| 固定行为 | body `portraitType=["QUESTION"]` |
| `locale` | header `system-language`；缺失时不发送 |

response 映射：`questions[].value` → `content`，`questions[].count` → `frequency`。未返回 `questions` 时规范化为 `{ questions: [] }`。

#### 相似问题查询

`recommendSimilarPresetQuestions(request)` MUST 调用 `POST /rest/naie/memory/v2/recommendation/similar-question`。request body 映射：

| Canonical request/result | Provider wire |
|---|---|
| `query` | body `query` |
| `limit` | body `topn` |
| `locale`, `product`, `domain`, `scene` | 同名 body 字段；缺失时不发送 |
| `agentId`、Owner Scope | 只用于可信 scope 和 adapter 调用上下文，不写入 body |

response 映射：`data[].questionId` → `questionId`，`data[].content` → `content`。未返回 `data` 时规范化为 `{ questions: [] }`。

#### 验证与失败语义

remote adapter MUST 在外部调用前验证 request（使用 frozen runtime schema），在构造 canonical result 后验证 result。返回条目数量不超过 request `limit`，超过时按原顺序截断到 `limit` 后再执行 result validation。空数据统一规范化为 `questions: []`。

失败统一使用 `SafeError`：

| 条件 | `SafeError.code` | category | retryable |
|---|---|---|---|
| canonical request validation 失败 | `QUESTION_RECOMMENDATION_INVALID_INPUT` | `VALIDATION` | `false` |
| AbortSignal 已取消或调用中取消 | `QUESTION_RECOMMENDATION_CANCELED` | `CANCELED` | `false` |
| provider 不可用、超时或调用失败 | `QUESTION_RECOMMENDATION_UNAVAILABLE` | `UNAVAILABLE` | `true` |
| provider 成功响应无法映射为合法 canonical result | `QUESTION_RECOMMENDATION_INVALID_PROVIDER_RESULT` | `UNAVAILABLE` | `true` |

remote adapter MUST 接收 `AbortSignal` 并在 HTTP 调用中传播取消。remote adapter MUST NOT 在日志、metric、trace 或 audit 中记录 query 文本、推荐内容、Owner Scope 标识或 provider raw error。

#### Scenario: Remote adapter frequent history questions
- **WHEN** REMOTE 模式下调用 `listFrequentHistoryQuestions({ limit: 5, locale: "zh-CN" })`
- **AND** provider 返回 3 条 `questions`
- **THEN** adapter MUST 返回 3 条 `FrequentHistoryQuestion`
- **AND** `content` 来自 `questions[].value`，`frequency` 来自 `questions[].count`

#### Scenario: Remote adapter similar questions
- **WHEN** REMOTE 模式下调用 `recommendSimilarPresetQuestions({ query: "告警", limit: 5 })`
- **AND** provider 返回 2 条 `data`
- **THEN** adapter MUST 返回 2 条 `PresetQuestionRecommendation`
- **AND** `questionId` 来自 `data[].questionId`，`content` 来自 `data[].content`

#### Scenario: Remote adapter empty result
- **WHEN** provider 成功响应但未返回 `questions` 或 `data`
- **THEN** adapter MUST 返回 `{ questions: [] }`

#### Scenario: Remote adapter truncates to limit
- **WHEN** request `limit=5` 且 provider 返回 8 条结果
- **THEN** adapter MUST 截断到 5 条
- **AND** 截断在 result validation 之前执行

#### Scenario: Remote adapter provider unavailable
- **WHEN** provider HTTP 调用失败或超时
- **THEN** adapter MUST 返回 `SafeError { code: "QUESTION_RECOMMENDATION_UNAVAILABLE", category: "UNAVAILABLE", retryable: true }`
- **AND** MUST NOT 暴露 provider raw error body、URL 或 credential

#### Scenario: Remote adapter request validation failure
- **WHEN** request 包含未知字段或类型错误
- **THEN** adapter MUST 返回 `SafeError { code: "QUESTION_RECOMMENDATION_INVALID_INPUT", category: "VALIDATION", retryable: false }`

#### Scenario: Remote adapter abort propagation
- **WHEN** 调用时 `AbortSignal` 已 abort
- **THEN** adapter MUST 返回 `SafeError { code: "QUESTION_RECOMMENDATION_CANCELED", category: "CANCELED", retryable: false }`
- **AND** MUST NOT 发起 HTTP 请求

#### Scenario: Remote adapter does not leak sensitive data
- **WHEN** remote adapter 处理请求和响应
- **THEN** 日志、metric、trace 和 audit MUST NOT 包含 query 文本、推荐内容、Owner Scope 标识或 provider raw error

### Requirement: QuestionRecommendationGateway binding injection by deployment mode

`QuestionRecommendationGateway` SHALL 通过 `WorkingMemoryGatewayBindings.questionRecommendations?` 可选 binding 注入。注入策略由 deployment mode 决定：

- LOCAL 模式：local gateway provider 注入 local adapter。
- REMOTE 模式：remote gateway provider 注入 remote adapter。
- 若 binding 为 `undefined`（未注入），`frequent-question-service` 的高频层和 `recommended` 层 MUST 返回空。

`frequent-question-service` MUST 只依赖 `QuestionRecommendationGateway` interface，MUST NOT 直接依赖 `agent-platform-gateway-local` 或 `agent-platform-gateway-remote` 的具体实现。

#### Scenario: Local mode injects local adapter
- **WHEN** `systemConfig.gateway.deploymentMode === "LOCAL"`
- **THEN** `WorkingMemoryGatewayBindings.questionRecommendations` MUST 为 local adapter
- **AND** local adapter MUST 读本地 `user_question_activity` 表

#### Scenario: Remote mode injects remote adapter
- **WHEN** `systemConfig.gateway.deploymentMode === "REMOTE"`
- **THEN** `WorkingMemoryGatewayBindings.questionRecommendations` MUST 为 remote adapter
- **AND** remote adapter MUST 调用 provider HTTP

#### Scenario: Binding undefined returns empty
- **WHEN** `questionRecommendations` binding 为 `undefined`
- **AND** `frequent-question-service` 查询高频或相似问题
- **THEN** service MUST 返回空列表
- **AND** MUST NOT 抛出错误

### Requirement: question-activity-tracking-command-port mode conditional

`question-activity-tracking-command-port` SHALL 只在 LOCAL deployment mode 下注入。REMOTE 模式下 provider 自己统计高频数据，NextAgent MUST NOT 上报用户问题。

composition MUST 判断：若 `systemConfig.gateway.deploymentMode === "LOCAL"`，则包装 `trackedRuntimeCommands`（在 submit/edit 时 fire-and-forget 累加 `ask_frequency`）；否则直接使用 `runtimeCommands` 不包装。

REMOTE 模式下 `user_question_activity` 表 MUST NOT 被读写（无 `upsertActivity` 调用，无 `listHighFrequency` 调用）。

#### Scenario: Local mode tracking active
- **WHEN** `systemConfig.gateway.deploymentMode === "LOCAL"`
- **AND** 用户通过 submit 提交请求
- **THEN** `ask_frequency` MUST 加 1（fire-and-forget）

#### Scenario: Remote mode tracking inactive
- **WHEN** `systemConfig.gateway.deploymentMode === "REMOTE"`
- **AND** 用户通过 submit 提交请求
- **THEN** `ask_frequency` MUST NOT 增长
- **AND** `user_question_activity` 表 MUST NOT 被写入
