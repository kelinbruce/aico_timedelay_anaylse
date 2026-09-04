## ADDED Requirements

### Requirement: 会话搜索结果复用删除动作并保持搜索窗口

会话搜索结果 SHALL 复用普通会话列表项的删除动作入口和确认交互。删除操作 MUST 通过 `session-delete` capability 定义的 `DELETE /api/v1/sessions/:sessionId` 完成；搜索 capability MUST NOT 定义第二套删除 API、前端本地隐藏语义或搜索专用删除 store。

搜索态删除成功后，前端 SHALL 保留当前 `q`、`createdFrom`、`createdTo`、offset/limit 窗口和 latest request guard，刷新当前搜索结果。删除失败时，前端 SHALL 保留原搜索结果项并展示 safe error。删除 MUST NOT 改变搜索的匹配范围、排序、分页、日期过滤、关键词校验或无匹配空态语义。

#### Scenario: 搜索结果删除后按同一条件刷新
- **GIVEN** search dialog 当前展示 `q=网络延迟`、`createdFrom=<from>`、`createdTo=<to>` 的结果
- **WHEN** 用户删除结果中的 session `S1` 且后端返回成功
- **THEN** 前端 MUST 使用同一 `q`、`createdFrom` 和 `createdTo` 刷新搜索结果
- **AND** 新结果 MUST 继续按搜索契约排序和分页

#### Scenario: 搜索结果删除失败不覆盖当前结果
- **GIVEN** 搜索结果中存在 session `S1`
- **WHEN** 用户删除 `S1` 但后端返回 safe conflict 或 safe error
- **THEN** 前端 MUST 保留 `S1` 搜索结果项
- **AND** MUST NOT 清空搜索条件或切回普通列表

#### Scenario: 删除不改变搜索匹配语义
- **WHEN** `session-delete` capability 被实现
- **THEN** `GET /api/v1/sessions` 的 `q`、`createdFrom`、`createdTo`、offset 和 limit 行为 MUST 保持既有搜索契约
- **AND** 系统 MUST NOT 为删除新增搜索专用 tombstone、deleted marker、命中片段或结果数量字段
