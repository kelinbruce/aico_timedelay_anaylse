## ADDED Requirements

### Requirement: 会话删除级联清理对话标注

当 session 删除成功时，系统 SHALL 清理该 session 下所有 conversation annotation 事实。清理 MUST 保持 owner scope 和 Agent scope 隔离，并 MUST 作为会话删除 composite transaction 的一部分完成。删除成功后，收藏会话列表和会话内标注查询 MUST 不再返回该 session 的标注或收藏投影。

如果标注清理失败，会话删除 MUST 失败并回滚；系统 MUST NOT 留下 session 已删除但 annotation/favorite 仍可见的状态。

#### Scenario: 删除会话清理标注和收藏投影
- **GIVEN** session `S1` 下存在点赞、点踩或收藏标注
- **WHEN** `S1` 删除成功
- **THEN** `GET /api/v1/sessions/S1/annotations` MUST 返回 safe not-found outcome 或空的不可达结果
- **AND** 收藏会话列表 MUST NOT 返回 `S1`

#### Scenario: 标注清理失败导致会话删除回滚
- **GIVEN** session `S1` 下存在 annotation 事实
- **WHEN** 会话删除事务中的 annotation 清理失败
- **THEN** 会话删除 MUST 返回显式 safe error
- **AND** `S1` 及其 annotation facts MUST 保持删除前状态

#### Scenario: 标注清理不能跨 scope
- **GIVEN** 两个不同 owner 或 Agent scope 下存在相同 `sessionId` 字符串的标注事实
- **WHEN** 当前 scope 删除 session `S1`
- **THEN** 系统 MUST 只清理当前 `(tenantId, subjectId, agentId, sessionId)` 下的标注
- **AND** 其他 scope 的标注 MUST 保持不可见且不被删除
