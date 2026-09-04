## ADDED Requirements

### Requirement: Channel 在 submit 失败时清理 session

当 channel 创建了一个新 session 且随后的 `RuntimeCommandPort.submit` 调用在 run 被接受之前失败时，channel MUST 执行尽力而为的 session 删除，以避免泄漏孤儿 session。该要求适用于所有由 channel 发起的先创建后提交路径，包括 Task Channel stream-task create、Task Channel async-tasks create 以及 Web Channel 便捷 submit（不带 `sessionId` 的 `POST /api/v1/requests`）。

清理 SHALL 只删除由当前请求创建的 session。客户端提供的 session（带调用方提供 `sessionId` 的既有 session）MUST NOT 被失败清理路径删除。

Session 删除 MUST 是尽力而为的：如果删除本身失败，channel MUST NOT 掩盖、吞掉或替换原始的 submit 失败错误。返回给调用方的 MUST 是原始错误。清理失败 MAY 作为诊断 warning 被记录。

该清理是安全的，因为在 run acceptance 之前的 submit 失败意味着该 session 尚未持久化任何 `RequestRun`、user message、timeline 事件或 active context item。Session 行是唯一已持久化产物，通过既有 `RuntimeSessionPort.deleteSession` composite cascade 删除它是一个本地持久化操作。

#### Scenario: Task Channel stream-task create submit 失败时清理 session
- **WHEN** 调用方提交合法的 stream-task create body 且 channel 创建了一个新 session
- **AND** `RuntimeCommandPort.submit` 在 run acceptance 之前抛出异常（例如 `CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY`）
- **THEN** channel MUST 为新建的 session 调用 `RuntimeSessionPort.deleteSession`
- **AND** 原始错误 MUST 被返回给调用方
- **AND** 该 session MUST NOT 留在 session list 中

#### Scenario: Task Channel async-tasks create submit 失败时清理 session
- **WHEN** 调用方提交一个 async-tasks create 批次且某个条目的 `RuntimeCommandPort.submit` 在 run acceptance 之前抛出异常
- **THEN** channel MUST 为该条目新建的 session 调用 `RuntimeSessionPort.deleteSession`
- **AND** 失败条目的结果 MUST 包含原始 `error` 对象
- **AND** 批次中的其他条目 MUST NOT 受影响

#### Scenario: Web Channel 便捷 submit 失败时清理 session
- **WHEN** 调用方提交不带 `sessionId` 的 `POST /api/v1/requests` 且 channel 创建了一个新 session
- **AND** `RuntimeCommandPort.submit` 在 run acceptance 之前抛出异常
- **THEN** channel MUST 为新建的 session 调用 `RuntimeSessionPort.deleteSession`
- **AND** 原始错误 MUST 被返回给调用方

#### Scenario: Submit 失败时不删除既有 session
- **WHEN** 调用方提交带调用方提供 `sessionId` 的 request 且 submit 失败
- **THEN** channel MUST NOT 删除该 session
- **AND** 原始错误 MUST 被返回给调用方

#### Scenario: 清理失败不掩盖原始错误
- **WHEN** `RuntimeSessionPort.deleteSession` 自身在清理过程中抛出异常
- **THEN** channel MUST 向调用方返回原始的 submit 失败错误
- **AND** 清理失败 MAY 作为诊断 warning 被记录
- **AND** 清理失败 MUST NOT 被重新抛出或包装为调用方可见的错误

#### Scenario: 成功的 submit 不触发清理
- **WHEN** `RuntimeCommandPort.submit` 成功并返回 `RequestAccepted`
- **THEN** channel MUST NOT 删除该 session
- **AND** 该 session MUST 连同被接受的 run 一起保持在 session list 中可见
