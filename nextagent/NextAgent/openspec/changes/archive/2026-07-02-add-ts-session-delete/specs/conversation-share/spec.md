## MODIFIED Requirements

### Requirement: Session lifecycle obligation for shares

当 session 删除机制删除 session 时，系统 MUST 级联清理被删除 session 的分享记录。此清理 MUST 通过分享 gateway public port 或会话删除 composite gateway boundary 执行，MUST NOT 由 Web channel 直接访问 `conversation_shares` 表。

分享记录与 session 同生命周期。session 删除成功后，使用该 session 既有 `shareId` 查看分享 MUST 返回 `SHARE_NOT_FOUND` 或 `SHARE_CONTENT_DELETED` 的 safe not-found/deleted outcome，MUST NOT 返回删除前的 messages。清理 MUST 保持创建者 owner scope 和 Agent scope 隔离。若分享清理失败，会话删除 MUST 失败并回滚。

#### Scenario: Deleted session cascades share cleanup
- **WHEN** session 删除机制删除 session `S1`
- **THEN** 该 session 的分享记录 MUST 被级联清理
- **AND** 清理 MUST 通过 gateway public boundary 或会话删除 composite gateway boundary 执行

#### Scenario: Deleted session share no longer exposes content
- **GIVEN** 分享 `SH1` 指向 session `S1` 的 run `R1`
- **WHEN** `S1` 删除成功
- **THEN** 查看 `SH1` MUST 返回 `SHARE_NOT_FOUND` 或 `SHARE_CONTENT_DELETED`
- **AND** MUST NOT 返回 `R1` 的 user 或 assistant messages

#### Scenario: Share cleanup failure rolls back session delete
- **GIVEN** session `S1` 存在分享记录 `SH1`
- **WHEN** 会话删除事务中的 share 清理失败
- **THEN** 会话删除 MUST 返回显式 safe error
- **AND** `S1` 和 `SH1` MUST 保持删除前状态

#### Scenario: Share cleanup cannot cross creator scope
- **GIVEN** 两个不同创建者 owner 或 Agent scope 下存在相同 `sessionId` 字符串的分享记录
- **WHEN** 当前 scope 删除 session `S1`
- **THEN** 系统 MUST 只清理当前 `(tenantId, subjectId, agentId, sessionId)` 下的分享记录
- **AND** 其他 scope 的分享记录 MUST 不被删除
