## ADDED Requirements

### Requirement: user_question_activity 表结构

系统 SHALL 在 SQLite 中维护 `user_question_activity` 表，存储 owner-scoped + agent-scoped 的问题级用户行为数据。表 MUST 包含以下列：
- `tenant_id`（TEXT NOT NULL）、`subject_id`（TEXT NOT NULL）、`agent_id`（TEXT NOT NULL）
- `question_hash`（TEXT NOT NULL，SHA-256 of question text）
- `question_text`（TEXT NOT NULL）
- `locale`（TEXT NOT NULL）
- `is_pinned`（INTEGER NOT NULL DEFAULT 0，用户主动添加到常问）
- `pinned_at`（INTEGER，可为 NULL，pin 操作时间戳，用于先进先出淘汰）
- `ask_frequency`（INTEGER NOT NULL DEFAULT 0，提问次数）
- `last_asked_at`（INTEGER，可为 NULL，最后提问时间戳）
- `created_at`（INTEGER NOT NULL）、`updated_at`（INTEGER NOT NULL）
- PRIMARY KEY (`tenant_id`, `subject_id`, `agent_id`, `question_hash`)

表 MUST 建立以下索引：
- `idx_user_question_activity_pinned`：(`tenant_id`, `subject_id`, `agent_id`, `is_pinned`, `pinned_at ASC`)
- `idx_user_question_activity_frequency`：(`tenant_id`, `subject_id`, `agent_id`, `ask_frequency DESC`, `last_asked_at DESC`)

#### Scenario: 表创建
- **WHEN** 系统初始化 SQLite gateway
- **THEN** `user_question_activity` 表 MUST 被创建
- **AND** PRIMARY KEY MUST 为 (`tenant_id`, `subject_id`, `agent_id`, `question_hash`)
- **AND** 两个索引 MUST 被创建

#### Scenario: owner scope 隔离
- **WHEN** 查询 user_question_activity
- **THEN** 查询 MUST 包含 `tenant_id`、`subject_id`、`agent_id` 条件
- **AND** MUST NOT 只按 `tenant_id` 或 `subject_id` 查询

### Requirement: 问题 Hash 标识

系统 SHALL 使用 `SHA-256(question_text)` 作为问题的唯一标识。hash 的输入为用户提交的问题文本原文（去除首尾空白后）。`question_hash` MUST 与分类问题内存 Catalog 中预埋的 hash 算法一致。当同一问题文本被多次提交时 MUST 更新已有记录的 `ask_frequency` 和 `last_asked_at`，MUST NOT 创建重复行。

#### Scenario: 首次提交问题
- **WHEN** 用户提交一个从未记录过的问题
- **THEN** 系统 MUST 插入一条新记录，`question_hash` 为 `SHA-256(trimmed_question_text)`
- **AND** `ask_frequency` MUST 为 1
- **AND** `last_asked_at` MUST 为当前时间戳

#### Scenario: 重复提交同一问题
- **WHEN** 用户再次提交相同文本的问题
- **THEN** 系统 MUST 更新已有记录的 `ask_frequency` 加 1
- **AND** MUST 更新 `last_asked_at` 为当前时间戳
- **AND** MUST NOT 创建新行

### Requirement: ask_frequency 增长时机

系统 SHALL 在以下路径触发 `ask_frequency` 增长：
- 用户通过 `POST /api/v1/sessions/:sessionId/requests` 提交新请求时（submit），`ask_frequency` 加 1。
- 用户通过 `POST /api/v1/sessions/:sessionId/requests/:requestId/edit` 编辑最新请求时（edit），新问题的 `ask_frequency` 加 1，旧问题频率保留不变。

系统 MUST NOT 在以下路径增长 `ask_frequency`：
- `POST /api/v1/sessions/:sessionId/requests/:requestId/cancel`（cancel）——频率保留不变。
- `POST /api/v1/sessions/:sessionId/requests/:requestId/retry`（retry）——频率不增长。

频率增长 MUST NOT 阻断请求提交流程——如果 DB 操作失败，请求 MUST 继续正常处理。submit 和 edit 路径的 frequency 增长均采用 fire-and-forget 模式。

#### Scenario: submit 时频率增长
- **WHEN** 用户通过 submit API 提交请求
- **THEN** 系统 MUST 将 `inputText` 记录到 `user_question_activity`
- **AND** `ask_frequency` MUST 加 1
- **AND** 请求提交 MUST NOT 被频率增长失败阻断

#### Scenario: edit 时新问题频率增长
- **WHEN** 用户编辑请求并提交新文本
- **THEN** 新问题文本的 `ask_frequency` MUST 加 1
- **AND** 旧问题文本的 `ask_frequency` MUST 保留不变

#### Scenario: cancel 时频率保留
- **WHEN** 用户取消请求
- **THEN** `ask_frequency` MUST 保留不变

#### Scenario: retry 时频率不增长
- **WHEN** 用户重试请求
- **THEN** `ask_frequency` MUST NOT 增长

#### Scenario: 空文本不记录
- **WHEN** 用户提交的 `inputText` 为空或仅空白
- **THEN** 系统 MUST NOT 记录到 `user_question_activity`

### Requirement: is_pinned 通过 Pin API 设置

`is_pinned` 字段 SHALL 仅通过 `POST /api/v1/user-questions/pin` 设置。系统 MUST NOT 提供 unpin API。`ask_frequency` 自动增长时 MUST NOT 修改 `is_pinned`。

当 pin 一个尚未存在于表中的问题时，系统 MUST 先插入一条新记录（`ask_frequency` 为 0，`is_pinned` 为 1，`pinned_at` 为当前时间戳）。当 pin 一个已存在且 `is_pinned` 已为 1 的问题时，系统 MUST 幂等返回成功，MUST NOT 更新 `pinned_at`。


#### Scenario: pin 已存在的问题
- **WHEN** 用户 pin 一个 `ask_frequency > 0` 的问题
- **THEN** 系统 MUST 将该记录的 `is_pinned` 设为 1
- **AND** MUST 设置 `pinned_at` 为当前时间戳
- **AND** MUST NOT 修改 `ask_frequency`

#### Scenario: pin 尚未存在的问题
- **WHEN** 用户 pin 一个表中不存在的问题
- **THEN** 系统 MUST 插入一条新记录，`is_pinned` 为 1，`ask_frequency` 为 0
- **AND** `pinned_at` MUST 为当前时间戳
- **AND** `question_hash` MUST 为 `SHA-256(question_text)`

#### Scenario: 重复 pin 幂等
- **WHEN** 用户 pin 一个 `is_pinned` 已为 1 的问题
- **THEN** 系统 MUST 返回成功
- **AND** MUST NOT 更新 `pinned_at`
- **AND** MUST NOT 创建新记录


系统 SHALL 通过配置项 `nextAgent.highFrequencyQuestion.pinLimit` 控制 pin 数量上限，默认值为 100。当用户 pin 一个新问题且当前 pinned 数量已达到上限时，系统 MUST 自动淘汰 `pinned_at` 最早的问题（设置其 `is_pinned` 为 0、`pinned_at` 为 NULL），然后插入新的 pin 记录。淘汰操作和新增 pin 操作 MUST 在同一数据库事务中完成。

#### Scenario: 未达上限时 pin
- **WHEN** 当前 pinned 数量 < `pinLimit`
- **THEN** 系统 MUST 直接 pin 新问题
- **AND** MUST NOT 淘汰任何已有记录

#### Scenario: 达到上限时 pin
- **WHEN** 当前 pinned 数量 >= `pinLimit`
- **THEN** 系统 MUST 淘汰 `pinned_at` 最早的记录
- **AND** MUST 在同一事务中 pin 新问题

### Requirement: UserQuestionActivityStoreGateway

系统 SHALL 通过 `UserQuestionActivityStoreGateway` port 提供用户问题活动的持久化访问。Gateway MUST 提供以下方法：
- `upsertActivity(record, options)`：插入或更新问题活动记录（用于 frequency 增长），MUST NOT 修改 `is_pinned`、`pinned_at`
- `pinQuestion(record, options)`：设置 `is_pinned = 1` 和 `pinned_at`，处理上限淘汰，MUST 在单事务中完成淘汰和 pin
- `listPinned(query)`：查询 `is_pinned = 1` 的问题列表（按 `pinned_at DESC` 排序），MUST NOT 按 locale 过滤
- `listHighFrequency(query, threshold)`：查询 `ask_frequency > threshold` 的问题列表（按 `ask_frequency DESC` 排序），MUST NOT 按 locale 过滤

所有方法 MUST 接收 owner scope（`tenant_id`、`subject_id`、`agent_id`）参数。Gateway 实现 MUST 通过 `agent-platform-gateway-local` SQLite store 提供。

#### Scenario: upsert 新问题
- **WHEN** 调用 `upsertActivity` 且问题不存在
- **THEN** 系统 MUST 插入新记录

#### Scenario: upsert 已有问题
- **WHEN** 调用 `upsertActivity` 且问题已存在
- **THEN** 系统 MUST 更新 `ask_frequency` 加 1 和 `last_asked_at`
- **AND** MUST NOT 修改 `is_pinned`、`pinned_at`

#### Scenario: pin 处理上限淘汰
- **WHEN** 调用 `pinQuestion` 且 pinned 数量已达上限
- **THEN** 系统 MUST 在同一事务中淘汰最早记录并 pin 新记录
