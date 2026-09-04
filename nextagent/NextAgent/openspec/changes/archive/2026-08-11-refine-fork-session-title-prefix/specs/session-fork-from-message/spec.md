## Function

- **所属 Function**：`FN-1.11 从消息派生子会话`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Fork From Durable Visible Assistant Message

系统 SHALL 支持用户从源 session 中一条已持久化、visible、可渲染的 assistant message 派生一个新的 child session。派生入口 MUST 由用户操作触发，MUST 通过可信 owner scope 和 Agent Scope 校验源 session 与锚点 message，MUST NOT 由模型输出、capability 参数或客户端请求体覆盖 owner scope、Agent Scope 或源消息归属。

一个 message 可作为 fork anchor 的条件是：它属于当前 owner+agent scoped source session，`role=ASSISTANT`，`visible=true`，content 非空，并且已经作为 conversation history 的持久化 message 出现。仍在 stream delta 中、尚未进入 conversation history 的 assistant 输出 MUST NOT 成为 fork anchor。

Fork eligibility MUST NOT be determined by `RequestRun.status=COMPLETED`. The backend eligibility boundary is the assistant message being durably present in conversation history. If an implementation can observe that the associated source run is still non-terminal, it MUST reject the anchor as a persistence invariant violation.

For UI state that is still represented as live stream envelopes rather than a refreshed conversation snapshot, the system MAY expose a request-scoped fork entry keyed by the source request/root message id. That entry MUST NOT fork live stream content directly. It MUST resolve the request id to exactly one owner+agent scoped, visible, non-empty, durably persisted assistant message whose metadata records `REQUEST_COMPLETED` / `COMPLETED`, then delegate to the normal message-anchor fork path. If the request has no completed durable assistant message, has a failed/canceled/superseded terminal message, is still streaming, or resolves to more than one completed assistant candidate, the request-scoped fork MUST fail safely and MUST NOT create a child session.

系统 MUST 在 fork 时把源 session 当前标题 trim 后得到源标题快照；标题缺失或 trim 后为空时，源标题快照 MUST 使用 `Untitled session`。系统 MUST 把 `Fork · ` 直接添加到该源标题快照之前，作为新 child session 标题。系统 MUST NOT 识别、折叠或删除源标题中已有的 `Fork · ` 文本；每次成功创建新的 child session 都 MUST 应用一次相同前缀规则。该规范化和拼接 MUST NOT 依赖 Web `displayTitle` alias 或 Web channel helper。

新 child session 标题 MUST 继续满足既有 100 字符上限。拼接结果超过该上限时，系统 MUST 按既有标题长度计数规则从源标题快照末尾移除字符，直到结果不超过 100 字符；系统 MUST 保留本次新增的完整 `Fork · ` 前缀。系统 MUST 允许不同 child sessions 使用完全相同的标题；标题相同 MUST NOT 影响 child session 创建、身份、访问或后续运行。

**需求类别**：功能性需求

#### Scenario: Completed live request fork resolves to a durable assistant anchor
- **WHEN** the client asks to fork by source request/root message id after a live assistant response is marked completed
- **THEN** runtime MUST resolve that request id to exactly one durable visible assistant message with completed terminal metadata
- **AND** runtime MUST invoke the normal message-anchor fork path using that resolved assistant message id
- **AND** runtime MUST reject the request-scoped fork when the request is still streaming, failed, canceled, superseded, has no durable completed assistant message, or has multiple completed assistant candidates
- **AND** runtime MUST NOT copy raw live stream envelopes into the child session

#### Scenario: 用户从已持久化 assistant 回复派生新会话
- **WHEN** 用户对标题为 `什么是 AMF` 的当前 owner+agent scoped source session 中一条已持久化、可渲染的 assistant message 发起 fork
- **THEN** 系统 MUST 创建一个新的 child session
- **AND** child session MUST 使用新的 `sessionId`
- **AND** child session 的标题 MUST 为 `Fork · 什么是 AMF`
- **AND** fork response MUST 返回 child session 的安全 metadata，至少包含 child `sessionId`、display title 和 last activity time

#### Scenario: 多级派生机械累加前缀
- **WHEN** 用户从标题为 `Fork · 什么是 AMF` 的 source session 再次发起 fork
- **THEN** 新 child session 的标题 MUST 为 `Fork · Fork · 什么是 AMF`
- **AND** 系统 MUST NOT 把重复前缀折叠为一层

#### Scenario: 用户标题以 Fork 文本开头时仍直接添加前缀
- **WHEN** source session 当前标题为用户设置的 `Fork · 网络诊断`
- **THEN** 新 child session 的标题 MUST 为 `Fork · Fork · 网络诊断`
- **AND** 系统 MUST NOT 推断源标题中的首个 `Fork · ` 是否由 fork 产生

#### Scenario: 手动修改后的源标题成为派生基础
- **WHEN** 用户在 fork 前把 source session 当前标题修改为 `AMF 注册故障定位`
- **THEN** 新 child session 的标题 MUST 为 `Fork · AMF 注册故障定位`
- **AND** 源标题在更早时刻的值 MUST NOT 参与本次 child 标题生成

#### Scenario: 同一源会话的多个直接派生允许同名
- **WHEN** 用户使用不同 idempotency keys 从同一个标题为 `什么是 AMF` 的 source session 成功创建两个 child sessions
- **THEN** 两个 child sessions 的标题都 MUST 为 `Fork · 什么是 AMF`
- **AND** 两个 child sessions MUST 使用不同的 `sessionId`

#### Scenario: 超长源标题保留完整派生前缀
- **WHEN** 源标题快照与 `Fork · ` 拼接后超过既有 100 字符上限
- **THEN** 新 child session 标题 MUST 以完整的 `Fork · ` 开头
- **AND** 新 child session 标题按既有标题长度计数规则 MUST 不超过 100 字符
- **AND** 系统 MUST 只从源标题快照末尾截断满足上限所需的字符

#### Scenario: 尚未持久化的 assistant 输出不可派生
- **WHEN** assistant 输出仍只存在于 live stream delta 或 active run projection 中，尚未作为 visible assistant message 进入 conversation history
- **THEN** fork command MUST 拒绝该 anchor
- **AND** 系统 MUST NOT 创建 child session、message、active context item 或 fork metadata
- **AND** 对外错误 MUST 使用安全错误，不泄漏 stream delta 或 raw model output

#### Scenario: 不可渲染或非 assistant message 不可派生
- **WHEN** fork anchor 指向 user、system、capability result、hidden message、空内容 assistant message 或不存在的 message
- **THEN** fork command MUST 以安全错误拒绝
- **AND** 系统 MUST NOT 创建 child session 或任何派生持久化事实

#### Scenario: 跨 owner 或跨 agent anchor 被拒绝
- **WHEN** fork command 的可信 owner scope 或 Agent Scope 与 source session 或 anchor message 不匹配
- **THEN** 系统 MUST 以 safe not-found outcome 拒绝
- **AND** 系统 MUST NOT 泄漏源 session 或 anchor message 是否存在于其他 owner 或 agent scope

### Requirement: Fork Notice Projection

系统 SHALL 为 forked child session 提供窄化的 public fork notice projection。child session 在 fork 后尚未提交新 user message 时，默认/latest conversation bootstrap response MUST 包含 `forkNotice`，用于客户端在消息区域底部居中显示“由某会话派生”。`forkNotice` MUST 只包含打开源 session 所需的 `sourceSessionId` 和用于显示的 `sourceSessionTitle` 快照。`forkNotice.sourceSessionTitle` MUST 使用 fork 时捕获的源标题快照，MUST NOT 使用添加 `Fork · ` 后的新 child session 标题。用户在 child session 中提交第一条 fork 后 user message 后，默认/latest conversation bootstrap response MUST 不再返回 `forkNotice`。

fork notice 的显示条件 MUST 基于 child session 中 child anchor 之后是否存在 user message，而不是基于 `forkedAt` 是否存在。`forkNotice` is not a message, MUST NOT enter active context, and MUST NOT be returned for cursor-based, newer-cursor-based or anchor-message conversation reads.

**需求类别**：功能性需求

#### Scenario: 刚派生的 child session 显示 fork notice
- **WHEN** 客户端读取刚 fork 成功且尚无 fork 后 user message 的 child session conversation
- **THEN** response MUST 包含 `forkNotice`
- **AND** `forkNotice.sourceSessionId` MUST 指向 source session
- **AND** `forkNotice.sourceSessionTitle` MUST 使用 fork 创建时记录的源标题快照
- **AND** response MUST NOT 暴露 source anchor message id、child anchor message id 或完整 fork source record

#### Scenario: 派生标题与 notice 源标题保持分离
- **WHEN** 标题为 `什么是 AMF` 的 source session 成功派生标题为 `Fork · 什么是 AMF` 的 child session
- **THEN** child session 的 `forkNotice.sourceSessionTitle` MUST 为 `什么是 AMF`
- **AND** `forkNotice.sourceSessionTitle` MUST NOT 为 `Fork · 什么是 AMF`

#### Scenario: Child 提交新消息后不再显示 fork notice
- **WHEN** child session 中已存在 child anchor 之后的 user message
- **THEN** conversation response MUST NOT 返回 `forkNotice`

#### Scenario: 分页或锚点读取不返回 fork notice
- **WHEN** client reads child conversation with `cursor`, `newerCursor` or `anchorMessageId`
- **THEN** response MUST NOT include `forkNotice`
- **AND** returned messages MUST remain ordinary conversation projection items, not synthetic fork notice messages

#### Scenario: 源会话标题后续变化不影响 notice 文案
- **WHEN** fork 创建后 source session 被重命名
- **THEN** child session 的 `forkNotice.sourceSessionTitle` MUST 继续使用 fork 创建时的标题快照
- **AND** fork notice link target MUST 仍为 source session

#### Scenario: 空源标题分别生成 child 标题与 notice 源标题
- **WHEN** source session title 缺失或 trim 后为空
- **THEN** fork 创建的 child session title MUST 使用 `Fork · Untitled session`
- **AND** `forkNotice.sourceSessionTitle` MUST 使用 `Untitled session`

#### Scenario: forkNotice source link uses existing session access semantics
- **WHEN** child session 可访问但 source session 已删除、不可用或当前 identity 无权打开 source session
- **THEN** child conversation response MUST 仍可返回基于标题快照的 `forkNotice`
- **AND** `forkNotice` MUST NOT include source availability, deletion or access state
- **AND** 打开 source session 的请求 MUST 按现有 owner+agent scope 规则返回 safe not-found outcome

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：从符合条件的助手消息派生子会话；新子会话标题在当前源标题前机械累加固定派生前缀，并继续复制到该消息为止的对话内容及可用只读过程快照。
- **依据 Requirements**：`Fork From Durable Visible Assistant Message`、`Fork Notice Projection`

### 输出

- **变更类型**：修改
- **目标内容**：返回具有独立会话标识和派生前缀标题的子会话；子会话内含复制到锚点的消息前缀和 child-owned、只读的可用过程快照，fork notice 保留独立的源标题快照。
- **依据 Requirements**：`Fork From Durable Visible Assistant Message`、`Fork Notice Projection`

### 处理过程

- **变更类型**：修改
- **目标内容**：校验源会话与锚点后，规范化源标题并在其前添加固定派生前缀；超过标题上限时从源标题末尾截断，同时保留供 fork notice 使用的源标题快照。
- **依据 Requirements**：`Fork From Durable Visible Assistant Message`、`Fork Notice Projection`

### 结果

- **变更类型**：修改
- **目标内容**：派生成功时，新子会话以 `Fork · ` 前缀标题呈现；多级派生逐级累加前缀，同一源会话的多个子会话允许同名。
- **依据 Requirements**：`Fork From Durable Visible Assistant Message`

### 规格

- **规格项**：派生标题
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：每次新建派生会话均在当前源会话规范化标题前添加固定 `Fork · `；重复前缀不折叠，同名子会话合法，结果不超过 100 字符。
- **依据 Requirements**：`Fork From Durable Visible Assistant Message`
