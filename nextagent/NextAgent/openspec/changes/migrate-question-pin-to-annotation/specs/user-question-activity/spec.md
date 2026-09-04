## MODIFIED Requirements

### Requirement: user_question_activity 表结构

系统 SHALL 在 SQLite 中维护 `user_question_activity` 表，存储 owner-scoped + agent-scoped 的问题级用户行为数据。表 MUST 包含以下列：
- `tenant_id`（TEXT NOT NULL）、`subject_id`（TEXT NOT NULL）、`agent_id`（TEXT NOT NULL）
- `question_hash`（TEXT NOT NULL，SHA-256 of question text）
- `question_text`（TEXT NOT NULL）
- `locale`（TEXT NOT NULL）
- `ask_frequency`（INTEGER NOT NULL DEFAULT 0，提问次数）
- `last_asked_at`（INTEGER，可为 NULL，最后提问时间戳）
- `created_at`（INTEGER NOT NULL）、`updated_at`（INTEGER NOT NULL）
- PRIMARY KEY (`tenant_id`, `subject_id`, `agent_id`, `question_hash`)

表 MUST 建立以下索引：
- `idx_user_question_activity_frequency`：(`tenant_id`, `subject_id`, `agent_id`, `ask_frequency DESC`, `last_asked_at DESC`)

`is_pinned` 和 `pinned_at` 列在 SQLite schema 中保留（不 DROP，避免 ALTER TABLE 风险），但代码 MUST NOT 读写。`idx_user_question_activity_pinned` 索引保留但无查询使用。pin 收藏已迁移到 `conversation_annotations.isQuestionFavorited`。

#### Scenario: 表创建
- **WHEN** 系统初始化 SQLite gateway
- **THEN** `user_question_activity` 表 MUST 被创建
- **AND** PRIMARY KEY MUST 为 (`tenant_id`, `subject_id`, `agent_id`, `question_hash`)
- **AND** 频率索引 MUST 被创建

#### Scenario: owner scope 隔离
- **WHEN** 查询 user_question_activity
- **THEN** 查询 MUST 包含 `tenant_id`、`subject_id`、`agent_id` 条件
- **AND** MUST NOT 只按 `tenant_id` 或 `subject_id` 查询

#### Scenario: is_pinned column not read or written
- **WHEN** 系统读写 `user_question_activity` 表
- **THEN** 代码 MUST NOT 读取或写入 `is_pinned` 列
- **AND** MUST NOT 读取或写入 `pinned_at` 列
- **AND** pin 收藏 MUST 通过 `conversation_annotations.isQuestionFavorited` 实现

### Requirement: ask_frequency 增长时机

系统 SHALL 在以下路径触发 `ask_frequency` 增长（仅在 LOCAL deployment mode 下）：
- 用户通过 `POST /api/v1/sessions/:sessionId/requests` 提交新请求时（submit），`ask_frequency` 加 1。
- 用户通过 `POST /api/v1/sessions/:sessionId/requests/:requestId/edit` 编辑最新请求时（edit），新问题的 `ask_frequency` 加 1，旧问题频率保留不变。

系统 MUST NOT 在以下路径增长 `ask_frequency`：
- `POST /api/v1/sessions/:sessionId/requests/:requestId/cancel`（cancel）——频率保留不变。
- `POST /api/v1/sessions/:sessionId/requests/:requestId/retry`（retry）——频率不增长。

REMOTE deployment mode 下 `ask_frequency` MUST NOT 增长，`user_question_activity` 表 MUST NOT 被读写。provider 自己统计高频数据。

频率增长 MUST NOT 阻断请求提交流程——如果 DB 操作失败，请求 MUST 继续正常处理。submit 和 edit 路径的 frequency 增长均采用 fire-and-forget 模式。

#### Scenario: submit 时频率增长（LOCAL）
- **WHEN** LOCAL 模式下用户通过 submit API 提交请求
- **THEN** 系统 MUST 将 `inputText` 记录到 `user_question_activity`
- **AND** `ask_frequency` MUST 加 1
- **AND** 请求提交 MUST NOT 被频率增长失败阻断

#### Scenario: edit 时新问题频率增长（LOCAL）
- **WHEN** LOCAL 模式下用户编辑请求并提交新文本
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

#### Scenario: REMOTE 模式不记录频率
- **WHEN** REMOTE 模式下用户通过 submit API 提交请求
- **THEN** `ask_frequency` MUST NOT 增长
- **AND** `user_question_activity` 表 MUST NOT 被写入

#### Scenario: submit 时频率增长

- **WHEN** LOCAL 模式下用户通过 submit API 提交请求且 `SubmitRequestCommand.guardBlockRefusal` 不存在
- **THEN** 系统 MUST 将 `inputText` 记录到 `user_question_activity`
- **AND** `ask_frequency` MUST 加 1
- **AND** 请求提交 MUST NOT 被频率增长失败阻断

#### Scenario: 安全护栏拦截的 submit 不记录问题活动

- **WHEN** 用户通过 submit API 提交请求且 `SubmitRequestCommand.guardBlockRefusal` 存在
- **THEN** 系统 MUST NOT 将 `inputText` 记录到 `user_question_activity`
- **AND** `ask_frequency` MUST NOT 增长

#### Scenario: edit 时新问题频率增长

- **WHEN** LOCAL 模式下用户编辑请求并提交新文本且 `EditLatestRequestCommand.guardBlockRefusal` 不存在
- **THEN** 新问题文本的 `ask_frequency` MUST 加 1
- **AND** 旧问题文本的 `ask_frequency` MUST 保留不变

#### Scenario: 安全护栏拦截的 editLatest 不记录问题活动

- **WHEN** 用户通过 editLatest API 编辑请求且 `EditLatestRequestCommand.guardBlockRefusal` 存在
- **THEN** 系统 MUST NOT 将 `editedInputText` 记录到 `user_question_activity`
- **AND** `ask_frequency` MUST NOT 增长

### Requirement: UserQuestionActivityStoreGateway

系统 SHALL 通过 `UserQuestionActivityStoreGateway` port 提供用户问题活动的持久化访问。Gateway MUST 提供以下方法：
- `upsertActivity(record, options)`：插入或更新问题活动记录（用于 frequency 增长），MUST NOT 修改 `is_pinned`、`pinned_at`
- `listHighFrequency(query, threshold)`：查询 `ask_frequency > threshold` 的问题列表（按 `ask_frequency DESC` 排序），MUST NOT 按 locale 过滤

`pinQuestion` 和 `listPinned` 方法已废弃并移除。pin 收藏通过 `ConversationAnnotationStoreGateway` 的 annotation upsert 实现。

所有方法 MUST 接收 owner scope（`tenant_id`、`subject_id`、`agent_id`）参数。Gateway 实现 MUST 通过 `agent-platform-gateway-local` SQLite store 提供。REMOTE 模式下此 Gateway MUST NOT 被调用。

#### Scenario: upsert 新问题
- **WHEN** 调用 `upsertActivity` 且问题不存在
- **THEN** 系统 MUST 插入新记录

#### Scenario: upsert 已有问题
- **WHEN** 调用 `upsertActivity` 且问题已存在
- **THEN** 系统 MUST 更新 `ask_frequency` 加 1 和 `last_asked_at`
- **AND** MUST NOT 修改 `is_pinned`、`pinned_at`

#### Scenario: pinQuestion method removed
- **WHEN** 代码尝试调用 `pinQuestion`
- **THEN** TypeScript 编译 MUST 失败（方法不在 interface 上）

#### Scenario: listPinned method removed
- **WHEN** 代码尝试调用 `listPinned`
- **THEN** TypeScript 编译 MUST 失败（方法不在 interface 上）

#### Scenario: pin 处理上限淘汰
- **WHEN** 迁移后的代码尝试通过已移除的 `pinQuestion` 处理 pin 上限
- **THEN** TypeScript 编译 MUST 失败，且系统 MUST NOT 执行旧的上限淘汰路径

## REMOVED Requirements

### Requirement: is_pinned 通过 Pin API 设置

此 requirement 已移除。pin 收藏迁移到 `conversation_annotations.isQuestionFavorited`，通过 annotation upsert 路径写入。`pinLimit` 配置项和 FIFO 淘汰逻辑已移除。详见 `conversation-annotation` spec 的 "Question favorite via annotation upsert" requirement。
