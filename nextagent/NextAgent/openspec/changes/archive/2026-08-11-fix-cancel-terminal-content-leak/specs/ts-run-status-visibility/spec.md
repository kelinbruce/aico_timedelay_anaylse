# ts-run-status-visibility Specification Delta

## MODIFIED Requirements

### Requirement: Cancel 终端事件 content 不得进入前端答案正文区域

前端答案正文区域 MUST 只展示 `LLM_CONTENT_DELTA` 事件积累的内容，MUST NOT 展示 `REQUEST_CANCELED` 事件或 cancel-category `REQUEST_FAILED` 事件的终端 content。当 cancel 终端事件到达时，前端 MUST 通过 `CanceledNotice` 组件使用 i18n 文本渲染取消提示，终端 content 本身 MUST NOT 出现在答案正文区域。

#### Scenario: REQUEST_CANCELED content 不进入答案正文区域

- **GIVEN** stream 或 history 中存在 `REQUEST_CANCELED` 事件
- **AND** 该事件 payload 包含终端 content
- **WHEN** 前端构建答案正文内容
- **THEN** `REQUEST_CANCELED` 事件 MUST NOT 出现在 `TERMINAL_ANSWER_FALLBACK_EVENTS` 中
- **AND** `readTerminalAnswerFact` MUST NOT 返回 `REQUEST_CANCELED` 事件的 content
- **AND** 答案正文区域 MUST 只展示 `LLM_CONTENT_DELTA` 积累的内容或为空

#### Scenario: cancel-category REQUEST_FAILED 归一化为 CANCELED

- **GIVEN** stream 或 history 中存在 `REQUEST_FAILED` 事件
- **AND** 该事件 payload 的 `category` 字段为 `'CANCELED'`
- **WHEN** 前端解析 run status
- **THEN** `resolveStatus` MUST 返回 `'CANCELED'` 而非 `'FAILED'`
- **AND** 前端 MUST 渲染 `CanceledNotice` 而非 `FailedNotice`
- **AND** 该事件的 content MUST NOT 进入答案正文区域

#### Scenario: cancel-category REQUEST_FAILED content 不作为答案 fallback

- **GIVEN** `TERMINAL_ANSWER_FALLBACK_EVENTS` 包含 `REQUEST_FAILED`
- **AND** 存在 cancel-category `REQUEST_FAILED` 事件
- **WHEN** `readTerminalAnswerFact` 遍历终端事件
- **THEN** 如果 `REQUEST_FAILED` 事件 payload 的 `category === 'CANCELED'`，MUST 跳过该事件
- **AND** 该事件的 content MUST NOT 作为答案 fallback 返回

#### Scenario: 固定占位文本不泄漏进答案正文区域

- **GIVEN** 终端消息 content 为 `'Request canceled by user.'`
- **AND** 该消息通过 history 加载映射为 stream envelope
- **WHEN** 前端构建答案正文内容
- **THEN** `FAILED_TERMINAL_PLACEHOLDER` 正则 MUST 匹配 `'Request canceled by user.'`
- **AND** 匹配的 content MUST NOT 进入答案正文区域
- **AND** 答案正文区域 MUST 只展示 `LLM_CONTENT_DELTA` 积累的内容或为空

#### Scenario: history 加载时终端消息不 fallback 到 LLM_CONTENT_DELTA

- **GIVEN** 一条 ASSISTANT 角色的终端消息通过 history 加载
- **AND** 该消息 `messageId` 以 `assistant-terminal-` 开头
- **AND** `resolveTerminalHistoryEventType` 无法从 `metadata` 或 content 匹配中识别终端类型（返回 `null`）
- **WHEN** `toHistoryEnvelope` 确定 event type
- **THEN** 该消息 MUST NOT fallback 到 `LLM_CONTENT_DELTA`
- **AND** 该消息 MUST NOT 生成 stream envelope
- **AND** 该消息的 content MUST NOT 进入答案正文区域

### Requirement: 无流式正文时答案正文区域展示 i18n 友好提示

当 cancel 终态到达且无流式正文内容（`hasAnswerContent === false`）时，前端 MUST 在答案正文区域内渲染居中的 i18n 提示文本，MUST NOT 让答案正文区域完全空白。该提示 MUST 使用已有 i18n key `turn.canceledWithoutAnswer` 随界面语言渲染。`CanceledNotice`（分割线上方灰色提示）MUST 继续保留，两者互补。

#### Scenario: cancel 无内容时答案正文区域展示友好提示

- **GIVEN** run status 为 `CANCELED`
- **AND** `hasAnswerContent === false`
- **AND** 非 guard-blocked 场景
- **WHEN** 前端渲染 TurnBlock
- **THEN** 答案正文区域 MUST 渲染居中的 i18n 提示文本
- **AND** 该文本 MUST 使用 `turn.canceledWithoutAnswer` key
- **AND** 该文本 MUST 随界面语言变化
- **AND** `CanceledNotice` MUST 继续在分割线上方渲染

#### Scenario: cancel 有内容时答案正文区域保留流式内容

- **GIVEN** run status 为 `CANCELED`
- **AND** `hasAnswerContent === true`
- **WHEN** 前端渲染 TurnBlock
- **THEN** 答案正文区域 MUST 展示 `LLM_CONTENT_DELTA` 积累的内容
- **AND** 答案正文区域 MUST NOT 展示 `canceledWithoutAnswer` 提示
- **AND** `CanceledNotice` MUST 使用 `canceledWithPartialContent` key

## ADDED Requirements

### Requirement: 非执行中 run cancel 时前端状态正确收束

当 cancel 作用于非执行中 run（pending input 或 queued）时，前端 MUST 正确接收 `REQUEST_CANCELED` 终端事件并收束 run 状态。前端 `resolveStatus` MUST 返回 `CANCELED` 而非 `EXECUTING`，stop 按钮 MUST 消失，输入框 MUST 恢复为发送状态。conversation store MUST NOT 因 `requestContextId` 不一致而拒绝 `REQUEST_CANCELED` 终端事件。

#### Scenario: pending input run cancel 后状态收束为 CANCELED

- **GIVEN** 一个 run 处于 pending input 状态（等待用户输入）
- **AND** 前端 turn 状态为 `EXECUTING`，stop 按钮显示
- **WHEN** API cancel 请求到达后端，`REQUEST_CANCELED` 终端事件通过 stream 到达前端
- **THEN** `resolveStatus` MUST 返回 `CANCELED`
- **AND** turn 状态 MUST 显示已取消（i18n）
- **AND** stop 按钮 MUST 消失，输入框 MUST 恢复为发送状态
- **AND** `handleTerminalEvent` MUST 被调用，`requestStatus` MUST 收束为 `canceled` 或 `idle`

#### Scenario: queued run cancel 后状态收束为 CANCELED

- **GIVEN** 一个 run 处于 queued 状态（排队中，未开始执行）
- **AND** 前端 turn 状态为 `EXECUTING`，stop 按钮显示
- **WHEN** API cancel 请求到达后端，`REQUEST_CANCELED` 终端事件通过 stream 到达前端
- **THEN** `resolveStatus` MUST 返回 `CANCELED`
- **AND** turn 状态 MUST 显示已取消（i18n）
- **AND** stop 按钮 MUST 消失，输入框 MUST 恢复为发送状态
- **AND** `handleTerminalEvent` MUST 被调用，`requestStatus` MUST 收束为 `canceled` 或 `idle`

#### Scenario: terminal 事件 attemptId 不匹配时仍被接受

- **GIVEN** conversation store 中存在 `rootMessageId` 匹配的 active bucket
- **AND** 到达的 terminal 事件 `attemptId` 与 active bucket 的 `attemptId` 不同
- **WHEN** `appendEnvelopes` 处理该 terminal 事件
- **THEN** 该 terminal 事件 MUST 被接受（出现在 `acceptedEnvelopes` 中）
- **AND** active bucket MUST 被移入 settled
- **AND** 该 terminal 事件 MUST 出现在 turn 的 events 中，供 `resolveStatus` 检查

#### Scenario: cancel 后同页面新 submit 不受旧 root 残留影响

- **GIVEN** 上一轮请求已被 cancel，`requestStatus` 为 `canceled`，`activeRequestRootMessageId` 保留上一轮 root
- **WHEN** 用户在同一页面发起新一轮 submit
- **THEN** 新请求在飞期间 `activeRequestRootMessageId` MUST 为 `null`（不继承上一轮 root）
- **AND** 新请求的 `pendingRequest` MUST NOT 被上一轮 settled bucket 中的 `REQUEST_CANCELED` 清空
- **AND** 新请求的流式过程事件 MUST 正常展示（思考、能力调用、等待补充信息）
- **AND** 新请求被 cancel 后，其 turn 状态 MUST 收束为 `CANCELED` 并展示已取消提示，不得停留在 `EXECUTING`
