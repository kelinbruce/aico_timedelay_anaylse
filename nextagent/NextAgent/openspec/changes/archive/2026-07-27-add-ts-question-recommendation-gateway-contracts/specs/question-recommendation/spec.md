## ADDED Requirements

### Requirement: Question recommendation Working Memory binding

`agent-contracts/gateway` MUST 定义唯一的 `QuestionRecommendationGateway`，并通过 `WorkingMemoryGatewayBindings.questionRecommendations` 暴露该 gateway。`GatewayBindings` MUST NOT 增加平行的顶层问题推荐 binding，`GatewayAdapterKind` MUST NOT 增加问题推荐专用 kind。

`questionRecommendations` MUST 是可选 binding。仅当当前 deployment 尚未提供正式问题推荐 adapter 时，composition MAY 不注入该 binding；未注入时，gateway consumer MUST 将正式问题推荐能力视为不可用，MUST NOT 改为调用既有 Pin、高频问题或问题联想 persistence contract。

#### Scenario: Working Memory 提供问题推荐 gateway
- **GIVEN** 当前 deployment 已配置正式问题推荐 adapter
- **WHEN** app composition 构造 `WorkingMemoryGatewayBindings`
- **THEN** `questionRecommendations` MUST 指向一个 `QuestionRecommendationGateway`
- **AND** 顶层 `GatewayBindings` MUST NOT 出现第二个问题推荐 binding

#### Scenario: 问题推荐 adapter 尚未配置
- **GIVEN** 当前 deployment 未配置正式问题推荐 adapter
- **WHEN** app composition 构造 `WorkingMemoryGatewayBindings`
- **THEN** `questionRecommendations` MAY 缺失
- **AND** consumer MUST 将该能力判定为不可用
- **AND** consumer MUST NOT 用现有问题活动 store 伪造正式问题推荐结果

### Requirement: 历史高频问题查询契约

`QuestionRecommendationGateway.listFrequentHistoryQuestions()` MUST 接收 `ListFrequentHistoryQuestionsRequest`，并返回 `Promise<ListFrequentHistoryQuestionsResult | SafeError>`。该方法 MUST 接收可选 `AbortSignal`；signal 在调用前已取消或调用中被取消时，gateway MUST 停止可取消的远程工作并返回取消类 `SafeError`。

请求 MUST 包含非空 `tenantId`、`subjectId`、`agentId` 和整数 `limit`；`limit` 的允许范围为 1 至 10（含边界）。请求 MAY 包含长度为 1 至 10 个字符的 `locale`；当调用方不提供 `locale` 时，gateway MUST 不附加语言筛选。调用方 MUST 从可信 identity 和 Agent Scope 提供 `tenantId`、`subjectId`、`agentId`，gateway MUST NOT 接受客户端 metadata、模型输出或 capability 参数覆盖这些值。

成功结果 MUST 包含 `questions` 数组；每项 MUST 包含非空 `content` 和 0 至 2147483647 范围内的整数 `frequency`。结果条目数量 MUST 小于或等于请求的 `limit`，并 MUST 保持服务返回的相对顺序；服务返回数量超过 `limit` 时，gateway MUST 只保留前 `limit` 项。无匹配数据时 MUST 返回 `{ questions: [] }`。gateway 不得修改任何持久化状态。

#### Scenario: 查询当前 scope 的历史高频问题
- **WHEN** 调用方以可信 scope `(T1, U1, A1)` 调用 `listFrequentHistoryQuestions({ tenantId: T1, subjectId: U1, agentId: A1, limit: 5 })`
- **THEN** gateway MUST 只查询该 scope 的历史高频问题
- **AND** 成功结果中的每项 MUST 只包含 canonical 问题文本和非负整数频次

#### Scenario: 历史高频问题为空
- **WHEN** 当前 Owner Scope 和 Agent Scope 没有历史高频问题
- **THEN** gateway MUST 返回 `{ questions: [] }`
- **AND** MUST NOT 返回 `undefined` 或伪造默认问题

#### Scenario: 历史高频问题数量越界
- **WHEN** `limit` 小于 1 或大于 10，或者 `limit` 不是整数
- **THEN** request schema validation MUST 失败
- **AND** gateway adapter MUST NOT 发起远程调用

#### Scenario: 历史高频问题结果不合法
- **WHEN** provider 成功响应包含空问题文本、负频次或非整数频次
- **THEN** result schema validation MUST 失败
- **AND** gateway MUST 返回安全的无效 provider result `SafeError`
- **AND** MUST NOT 向 consumer 返回部分未验证数据

### Requirement: 预置相似问题查询契约

`QuestionRecommendationGateway.recommendSimilarPresetQuestions()` MUST 接收 `RecommendSimilarPresetQuestionsRequest`，并返回 `Promise<RecommendSimilarPresetQuestionsResult | SafeError>`。该方法 MUST 接收可选 `AbortSignal`；signal 在调用前已取消或调用中被取消时，gateway MUST 停止可取消的远程工作并返回取消类 `SafeError`。

请求 MUST 包含非空 `tenantId`、`subjectId`、`agentId`、`query` 和整数 `limit`。`query` 长度 MUST 为 1 至 512 个字符（含边界），`limit` MUST 为 1 至 20（含边界）。请求 MAY 包含 `locale`、`product`、`domain` 和 `scene`；缺失的可选字段 MUST 保持缺失，不得由 gateway 推断。`locale` 长度 MUST 为 1 至 10 个字符（含边界）；`product` MUST 匹配 `^[a-zA-Z0-9-]{1,64}$`；`domain` 和 `scene` 长度 MUST 为 1 至 128 个字符（含边界）。

成功结果 MUST 包含 `questions` 数组；每项 MUST 包含非空 `questionId` 和非空 `content`。结果条目数量 MUST 小于或等于请求的 `limit`，并 MUST 保持服务返回的相对顺序；服务返回数量超过 `limit` 时，gateway MUST 只保留前 `limit` 项。无匹配数据时 MUST 返回 `{ questions: [] }`。gateway 不得修改任何持久化状态。

#### Scenario: 查询预置相似问题
- **WHEN** 调用方以可信 scope、非空查询文本和合法 `limit` 调用 `recommendSimilarPresetQuestions()`
- **THEN** gateway MUST 返回按 provider 顺序排列的 canonical `questions`
- **AND** 每项 MUST 包含非空 `questionId` 和 `content`

#### Scenario: 不提供可选检索维度
- **WHEN** 请求未提供 `locale`、`product`、`domain` 和 `scene`
- **THEN** gateway MUST 保持这些字段缺失
- **AND** MUST NOT 根据客户端 metadata、模型输出或 capability 参数补齐这些字段

#### Scenario: 相似问题请求越界
- **WHEN** `query` 为空或超过 512 个字符，或者 `limit` 不在 1 至 20 的整数范围内
- **THEN** request schema validation MUST 失败
- **AND** gateway adapter MUST NOT 发起远程调用

#### Scenario: 相似问题结果不合法
- **WHEN** provider 成功响应中的任一项缺少非空 `questionId` 或非空 `content`
- **THEN** result schema validation MUST 失败
- **AND** gateway MUST 返回安全的无效 provider result `SafeError`
- **AND** MUST NOT 向 consumer 返回部分未验证数据

### Requirement: 问题推荐 runtime schema

`agent-contracts/gateway` MUST 为两类 request 和两类成功 result 分别导出 runtime JSON schema。全部 schema MUST 拒绝未知字段；字符串范围、整数范围、必填字段和可选字段 MUST 与 TypeScript contract 一致。gateway adapter MUST 在访问外部服务前验证 canonical request，并在返回 consumer 前验证 canonical success result。

#### Scenario: request 包含未知字段
- **WHEN** 任一问题推荐 request 包含 contract 未定义的字段
- **THEN** 对应 request schema MUST 拒绝该对象
- **AND** gateway adapter MUST NOT 发起远程调用

#### Scenario: result 包含未知字段
- **WHEN** canonical success result 包含 contract 未定义的字段
- **THEN** 对应 result schema MUST 拒绝该对象
- **AND** gateway MUST 返回安全的无效 provider result `SafeError`

### Requirement: 问题推荐安全失败语义

`QuestionRecommendationGateway` MUST 使用以下穷尽的 `SafeError.code` 表达失败，MUST NOT 把服务错误体、URL、credential、查询文本、推荐内容或原始异常放入 `message` 或 `safeDetails`：

- canonical request validation 失败：`QUESTION_RECOMMENDATION_INVALID_INPUT`，category 为 `VALIDATION`，`retryable=false`；
- `AbortSignal` 已取消或调用中取消：`QUESTION_RECOMMENDATION_CANCELED`，category 为 `CANCELED`，`retryable=false`；
- 服务不可用、超时或调用失败：`QUESTION_RECOMMENDATION_UNAVAILABLE`，category 为 `UNAVAILABLE`，`retryable=true`；
- 服务成功响应不能形成合法 canonical result：`QUESTION_RECOMMENDATION_INVALID_PROVIDER_RESULT`，category 为 `UNAVAILABLE`，`retryable=true`。

#### Scenario: 服务调用失败
- **WHEN** 问题推荐服务不可用、超时或调用失败
- **THEN** gateway MUST 返回 `SafeError { code: "QUESTION_RECOMMENDATION_UNAVAILABLE", category: "UNAVAILABLE", retryable: true }`
- **AND** SafeError MUST NOT 包含服务错误体、URL、credential、查询文本、推荐内容或原始异常

#### Scenario: 调用被取消
- **WHEN** 调用方提供的 `AbortSignal` 在调用前已取消或调用中被取消
- **THEN** gateway MUST 返回 `SafeError { code: "QUESTION_RECOMMENDATION_CANCELED", category: "CANCELED", retryable: false }`
- **AND** gateway MUST 停止仍可取消的远程工作
