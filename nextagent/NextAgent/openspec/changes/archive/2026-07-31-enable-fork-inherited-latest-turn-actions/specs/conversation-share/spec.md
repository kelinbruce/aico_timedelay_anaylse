## Function

- **所属 Function**：`FN-1.15 查看分享的会话`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Copied retry answer 的冻结分享保持完整

当冻结分享选择的 `runId` 是 fork 生成的 copied run anchor、该 anchor 没有真实 `RequestRun`，且 selected answer 来自 source request 的 retry attempt 时，分享读取 MUST 使用 selected run messages 的唯一 child-owned `requestId` 关联同 session、同 frozen creator scope 下恰好一个 canonical USER message。canonical USER 与 selected answer MAY 携带同 request 的不同 child run anchor。

分享结果 MUST 只包含该 canonical USER 和冻结 selected run 对应的 messages，MUST NOT 因 request 关联而加入同 request 的其他 run assistant/capability messages。selected run 缺少 assistant answer、request identity 不唯一、canonical USER 缺失或不唯一时，读取 MUST 返回 `SHARE_CONTENT_DELETED`。系统 MUST NOT 回源读取 parent/ancestor session，也不得扩大到分享 session 的其他 request。

**需求类别**：系统质量属性

**质量属性**：安全、可靠性/恢复

**适用范围**：该 Function

#### Scenario: 递归 fork 分享 copied retry answer
- **GIVEN** source request 的 canonical USER 属于原 attempt run，visible answer 属于 retry run
- **AND** 递归 fork 将二者复制到同一 child request，但使用不同 child run anchor
- **WHEN** 用户冻结分享 copied retry answer 的 child run anchor
- **THEN** 分享读取 MUST 返回该 request 的唯一 canonical USER 和 selected answer run messages
- **AND** MUST NOT 返回同 request 的其他 run answer 或 capability messages
- **AND** MUST NOT 返回 parent 或 ancestor session facts

#### Scenario: copied retry answer 分享在 replacement 后保持可读
- **GIVEN** copied retry answer 的冻结分享已创建
- **WHEN** child 后续执行 retry 或 edit 并以 replacement reason 隐藏 copied messages
- **THEN** 原分享 MUST 继续返回创建时选中的 canonical USER 和 copied retry answer

#### Scenario: copied run 无法唯一补齐 canonical USER
- **WHEN** selected copied run 缺少 assistant answer，或其 request identity/canonical USER 无法唯一解析
- **THEN** 分享读取 MUST 返回 `SHARE_CONTENT_DELETED`
- **AND** MUST NOT 猜测其他 request、run、session 或 ancestor 中的用户问题

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：copied run 无真实 `RequestRun` 时按 selected answer 的唯一 request identity 补齐 canonical USER，同时保持 selected run 冻结边界。
- **依据 Requirements**：`Copied retry answer 的冻结分享保持完整`

### 结果

- **变更类型**：修改
- **目标内容**：递归 fork 的 retry answer 分享不再误报已删除，后续 replacement 不改变冻结内容，非法或不唯一关联继续 fail closed。
- **依据 Requirements**：`Copied retry answer 的冻结分享保持完整`
