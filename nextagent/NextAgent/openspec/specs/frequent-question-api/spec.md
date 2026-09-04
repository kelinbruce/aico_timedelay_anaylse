## Purpose

This specification defines the frequent question query API and pin API for managing user frequently asked questions.
## Requirements
### Requirement: 高频问题查询 API 端点

系统 SHALL 通过 Web channel 暴露只读 `GET /api/v1/frequent-questions` 端点，返回当前 Agent Scope 和 Owner Scope 下合并排序后的高频问题列表。端点 MUST 接受可选的 `locale` 查询参数。端点 MUST NOT 接受 request body。端点 MUST NOT 修改任何持久化状态。

#### Scenario: 正常查询
- **WHEN** 客户端发送 `GET /api/v1/frequent-questions?locale=zh-CN`
- **THEN** 系统 MUST 返回 HTTP 204 和 `{ locale, questions }` JSON 响应
- **AND** `questions` 数组 MUST 按合并排序规则排序

#### Scenario: 无数据时返回空列表
- **WHEN** 当前 Agent Scope 下无任何高频问题数据
- **THEN** 系统 MUST 返回 HTTP 204 和 `{ locale: "zh", questions: [] }`

### Requirement: 高频问题合并排序规则

`FrequentQuestionService` SHALL 按以下优先级合并排序高频问题列表：
1. `fixed=true` 的静态问题（from `CategoryQuestionResourceDiscovery` 内存目录），按 locale 过滤
2. 用户 `is_pinned=true` 的问题（from DB，按 `pinned_at DESC` 排序），MUST NOT 按 locale 过滤
3. 用户 `ask_frequency > threshold` 的问题（from DB，按 `ask_frequency DESC` 排序），MUST NOT 按 locale 过滤，排除已出现在第 1 层和第 2 层的问题
4. 剩余静态问题（from 内存目录，排除已出现在第 1 层的问题），按 locale 过滤
5. 以上合并后列表为空时，返回空列表，由前端 fallback 到 i18n 硬编码默认问题

`threshold` SHALL 来自配置项 `nextAgent.highFrequencyQuestion.frequencyThreshold`，默认值为 8。

同一问题文本 MUST NOT 在列表中重复出现。去重以 `question_hash` 为准。每个问题条目 MUST 包含 `text`。

#### Scenario: 五层排序
- **WHEN** 查询时 DB 中有 pinned 问题和 frequency > threshold 的问题，内存目录有 fixed 和非 fixed 的静态问题
- **THEN** 列表 MUST 按 fixed → pinned → high-frequency → 剩余静态 的顺序排列
- **AND** 同一问题 MUST NOT 重复出现

#### Scenario: 仅 pinned 问题
- **WHEN** DB 中仅有 `is_pinned=true` 的问题，内存目录无数据
- **THEN** 列表 MUST 仅包含 pinned 问题

#### Scenario: 全部为空
- **WHEN** DB 中无数据，内存目录无数据
- **THEN** 列表 MUST 为空数组

### Requirement: 高频问题查询响应 DTO

响应 SHALL 包含 `locale`（字符串）和 `questions`（数组）。每个问题条目 SHALL 包含 `text`（非空字符串）。响应 MUST NOT 包含 `hash`、`frequency`、`is_pinned`、`pinned_at` 或任何 DB 内部字段。

#### Scenario: 响应 DTO shape
- **WHEN** 查询返回高频问题列表
- **THEN** 每个条目 MUST 包含 `text`
- **AND** MUST NOT 包含 `hash`、`frequency`、`is_pinned`、`pinned_at` 字段

### Requirement: FrequentQuestionPort

Web channel MUST 通过 `agent-contracts/runtime` 定义的 `FrequentQuestionPort` 查询高频问题，MUST NOT 直接依赖 `agent-platform-gateway-local` 或 `agent-capability` 内部实现。Port MUST 由 `agent-app` composition 实现并注入。Port 实现 MUST 接收 `AbortSignal`。

#### Scenario: Web channel 使用注入的 port
- **WHEN** Web channel 收到 `GET /api/v1/frequent-questions` 请求
- **THEN** Web channel MUST 调用注入的 `FrequentQuestionPort.listFrequentQuestions()`
- **AND** MUST NOT 直接访问 DB store 或 discovery

### Requirement: 高频问题配置项

系统 SHALL 通过 `default-system.yaml` 的 `nextAgent.highFrequencyQuestion` 配置以下参数：
- `pinLimit`：pin 数量上限，整数，默认 100
- `frequencyThreshold`：高频问题频率阈值，整数，默认 8

`FrequentQuestionService` 和 `UserQuestionActivityStoreGateway` MUST 读取这些配置值。当配置缺失时 MUST 使用默认值。

#### Scenario: 使用默认配置
- **WHEN** 配置文件中未指定 `nextAgent.highFrequencyQuestion`
- **THEN** `pinLimit` MUST 为 100
- **AND** `frequencyThreshold` MUST 为 8

#### Scenario: 自定义配置
- **WHEN** 配置文件指定 `nextAgent.highFrequencyQuestion.pinLimit = 50`
- **THEN** pin 数量上限 MUST 为 50
