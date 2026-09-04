# user-question-activity Specification Delta

所属 Function：FN-8.1 持久化运行数据
Function 变更类型：修改
spec 角色：主规格

## MODIFIED Requirements

### Requirement: ask_frequency 增长时机

系统 SHALL 在以下路径触发 `ask_frequency` 增长：
- 用户通过 `POST /api/v1/sessions/:sessionId/requests` 提交新请求时（submit），`ask_frequency` 加 1。当 `SubmitRequestCommand.guardBlockRefusal` 存在时（安全护栏已拦截该输入），系统 MUST NOT 记录问题活动。
- 用户通过 `POST /api/v1/sessions/:sessionId/requests/latest/edit` 编辑最新请求时（edit），新问题的 `ask_frequency` 加 1，旧问题频率保留不变。当 `EditLatestRequestCommand.guardBlockRefusal` 存在时（安全护栏已拦截该编辑输入），系统 MUST NOT 记录问题活动。

系统 MUST NOT 在以下路径增长 `ask_frequency`：
- `POST /api/v1/sessions/:sessionId/requests/:requestId/cancel`（cancel）——频率保留不变。
- `POST /api/v1/sessions/:sessionId/requests/:requestId/retry`（retry）——频率不增长。
- 安全护栏拦截的 submit（`guardBlockRefusal` 存在）——频率不增长，问题文本不记录。
- 安全护栏拦截的 editLatest（`guardBlockRefusal` 存在）——频率不增长，问题文本不记录。

频率增长 MUST NOT 阻断请求提交流程——如果 DB 操作失败，请求 MUST 继续正常处理。submit 和 edit 路径的 frequency 增长均采用 fire-and-forget 模式。

需求类别：功能性需求

#### Scenario: submit 时频率增长

- **WHEN** 用户通过 submit API 提交请求
- **THEN** 系统 MUST 将 `inputText` 记录到 `user_question_activity`
- **AND** `ask_frequency` MUST 加 1
- **AND** 请求提交 MUST NOT 被频率增长失败阻断

#### Scenario: 安全护栏拦截的 submit 不记录问题活动

- **WHEN** 用户通过 submit API 提交请求且 `SubmitRequestCommand.guardBlockRefusal` 存在
- **THEN** 系统 MUST NOT 将 `inputText` 记录到 `user_question_activity`
- **AND** `ask_frequency` MUST NOT 增长

#### Scenario: edit 时新问题频率增长

- **WHEN** 用户编辑请求并提交新文本
- **THEN** 新问题文本的 `ask_frequency` MUST 加 1
- **AND** 旧问题文本的 `ask_frequency` MUST 保留不变

#### Scenario: 安全护栏拦截的 editLatest 不记录问题活动

- **WHEN** 用户通过 editLatest API 编辑请求且 `EditLatestRequestCommand.guardBlockRefusal` 存在
- **THEN** 系统 MUST NOT 将 `editedInputText` 记录到 `user_question_activity`
- **AND** `ask_frequency` MUST NOT 增长

#### Scenario: cancel 时频率保留

- **WHEN** 用户取消请求
- **THEN** `ask_frequency` MUST 保留不变

#### Scenario: retry 时频率不增长

- **WHEN** 用户重试请求
- **THEN** `ask_frequency` MUST NOT 增长

#### Scenario: 空文本不记录

- **WHEN** 用户提交的 `inputText` 为空或仅空白
- **THEN** 系统 MUST NOT 记录到 `user_question_activity`
