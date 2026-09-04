## ADDED Requirements

### Requirement: Edit-resubmit 命令 SHALL 对观察到的最新 request 做预检

运行时 edit-resubmit 命令 MUST 携带可信身份、`sessionId`、`expectedLatestRequestId`、`editedInputText`、`attachmentIds` 和非空的 `idempotencyKey`，并可带可选的 locale 和已接受的 request 元数据。Runtime SHALL 加载 owner 和 Agent 作用域内的 session 以及最新 lane 快照。若快照没有最新 request，它 SHALL 返回安全的 not found；若快照的最新 id 与 `expectedLatestRequestId` 不同（包括期望 id 未知的情形），它 SHALL 以 stale-latest 冲突拒绝，且 SHALL NOT 为该调用创建编辑后的 request。当前比较是一次时间点上的乐观预检，不是与后续 message/run acceptance 绑定的版本化或事务性 CAS；因此快照之后的并发 lane 变更可能与被接受的编辑发生竞态。本需求也不主张由 runtime 拥有纯空白输入守卫：当前 Agent Web 确认路径会修剪并拒绝空白文本，而 Web schema 只强制字符串长度，runtime 不会独立拒绝纯空白的编辑输入。

#### Scenario: 期望 request 与观察到的最新快照匹配
- **GIVEN** `expectedLatestRequestId` 在已加载快照中标识该作用域 session 的最新 request
- **WHEN** 一个合法的 edit-resubmit 命令通过预检
- **THEN** runtime MAY 继续当前的编辑接受路径

#### Scenario: 期望 request 已过期
- **GIVEN** 一个较新的 request 已成为最新
- **WHEN** 该较新 request 已存在于快照中而 edit-resubmit 使用较旧的期望 request id
- **THEN** runtime SHALL 以 stale-latest 冲突拒绝它
- **AND** SHALL NOT 创建编辑后的 request

#### Scenario: 并发的最新变更不在预检覆盖范围内
- **GIVEN** 期望 id 与已加载快照匹配
- **WHEN** 另一个 lane 变更在编辑接受写入完成之前成为最新
- **THEN** 本能力 SHALL NOT 主张较早的快照比较能拒绝该竞态

### Requirement: Edit-resubmit SHALL 追加新 request 并持久替换源 request 呈现

被接受的编辑 SHALL 创建新的 request id、run id、context id、attempt、可见 user 消息、checkpoint，以及携带 `editedFromRequestId` 的 `REQUEST_ACCEPTED` 事件。Runtime SHALL 通过 canonical 的 latest-wins 路径替换同一 session 内较旧的 lane 工作，被取代的活动工作 SHALL 以 `SUPERSEDED` 终态化。在新 request 事实持久化之后，runtime SHALL 使用一个 owner+Agent+session+source-request 作用域的 message-store 操作，把源 request 当前可见的每条持久消息设置为 `visible=false`，可见性原因为 `EDIT_REPLACED`。持久消息事实 SHALL 保持对显式隐藏消息查询可用，而默认会话投影 SHALL 只暴露编辑后的替换 request。被接受的编辑 request 随后 SHALL 使用正常的 scheduler、stream、history 和 terminal-commit 生命周期。

#### Scenario: 被接受的编辑记录血缘
- **WHEN** 一个合法的 edit-resubmit 被接受
- **THEN** 新的 `REQUEST_ACCEPTED` 事件 SHALL 引用 `editedFromRequestId`
- **AND** 源 request 消息 SHALL 以 `visible=false` 和原因 `EDIT_REPLACED` 保持持久
- **AND** 新 request SHALL 追加一条可见 user 消息

#### Scenario: 新编辑失败时保留源 request
- **WHEN** 一次新编辑在新 request 被接受之前失败
- **THEN** runtime SHALL NOT 隐藏任何源 request 消息

#### Scenario: 编辑替换活动的同 session 工作
- **GIVEN** 较旧的同 session 工作仍处于活动状态
- **WHEN** edit-resubmit 被接受
- **THEN** runtime SHALL 通过 canonical lane 替换路径替换它
- **AND** 较旧的工作 SHALL 收敛为 `SUPERSEDED`

### Requirement: Edit-resubmit SHALL 保留内部附件权威而 Web 编辑保持纯文本

Runtime SHALL 在接受编辑后的 request 之前，为可信的 owner、Agent 和 session 重新校验内部编辑命令携带的每个 attachment id。当前 Web edit 路由 SHALL 只接受 JSON，包含编辑文本、expected-latest id、idempotency key、可选 locale，以及仅为空的 `attachments` 兼容形状；它 SHALL 向 runtime 传递 `attachmentIds=[]`。非空的 JSON `attachments` 数组或任何 multipart 编辑请求 SHALL 在 runtime 委托之前被拒绝。当前浏览器 request service 也 SHALL 在调用 Web edit 路由之前拒绝非空附件队列。该浏览器/Web 限制不移除内部 runtime 命令的附件权威校验，但携带文件的编辑不是当前的浏览器能力。

#### Scenario: 内部附件引用被重新校验
- **WHEN** 一个内部 edit-resubmit 命令携带 attachment id
- **THEN** runtime SHALL 在 request 接受之前校验其权威性

#### Scenario: JSON 编辑不接受 attachment id
- **WHEN** 客户端发送当前不带文件的 JSON 编辑请求体
- **THEN** Web SHALL 向 runtime 委托 `attachmentIds=[]`
- **AND** SHALL NOT 通过该 JSON 请求体接受客户端提供的 attachment id

#### Scenario: 非空的 JSON attachments 被拒绝
- **WHEN** 客户端在 JSON 编辑请求体中发送非空 `attachments`
- **THEN** Web SHALL 在 runtime 委托之前拒绝该请求

#### Scenario: Multipart 编辑被拒绝
- **WHEN** 客户端发送 multipart 编辑请求
- **THEN** Web SHALL 在 runtime 委托之前拒绝它

### Requirement: Edit-resubmit 幂等 SHALL 锚定已接受的语义

Runtime MUST 在执行新的编辑工作之前检查作用域内的幂等锚点。当前编辑语义指纹由 action、可信 owner、Agent、session、`expectedLatestRequestId`、精确的 `editedInputText`、有序的 `attachmentIds` 和 idempotency key 组成。重复该指纹 SHALL 返回第一次被接受的编辑 request 结果，不产生重复 request 副作用，并 SHALL 在早前一次已接受的尝试停留在接受之后、替换完成之前时，幂等地完成源 request 可见性替换。用同一 key 携带不同指纹值复用 SHALL 以既有的幂等冲突契约失败。当前的 `locale`、`reservedRequest` 和 `inputVariables` 不包含在编辑语义指纹中，因此本需求 SHALL NOT 主张对仅限这些字段变更的冲突检测。

#### Scenario: 等价重复返回第一个编辑 request
- **WHEN** 一个等价的 edit-resubmit 命令重复同一 idempotency key
- **THEN** runtime SHALL 返回最初被接受的编辑 request 身份
- **AND** SHALL NOT 追加另一条 user 消息、run、checkpoint 或 accepted 事件
- **AND** SHALL 确保源 request 消息以 `EDIT_REPLACED` 隐藏

#### Scenario: 冲突的重复被拒绝
- **WHEN** 同一 idempotency key 被携带不同的期望目标、编辑文本、附件集合或可信作用域复用
- **THEN** runtime SHALL 以幂等冲突契约拒绝该命令

### Requirement: Agent Web SHALL 只对当前最新 turn 暴露编辑

user 消息编辑入口和 `/edit` 命令 SHALL 只在存在最新目标、该目标是当前最新 turn、会话不在迁移中且用户拥有 Write 权限时可用。进入编辑模式 SHALL 加载最新的原始 user 文本、聚焦 Composer 并暴露取消和确认操作。从最新 user 消息操作进入 SHALL 保留当前普通草稿；执行精确的 `/edit` 命令 SHALL 消费该命令文本并使用编辑后为空的普通草稿。确认 SHALL 要求非空的编辑文本。

#### Scenario: 较旧的 turn 没有编辑操作
- **GIVEN** 一条 user 消息不是当前最新 turn
- **WHEN** 其操作被渲染
- **THEN** Agent Web SHALL NOT 为该 turn 提供 edit-resubmit

#### Scenario: 进入编辑保留普通草稿
- **GIVEN** 存在一个普通 Composer 草稿
- **WHEN** 用户从最新 user 消息操作进入编辑模式
- **THEN** Agent Web SHALL 单独保留该普通草稿
- **AND** SHALL 加载并聚焦最新的原始 user 文本以供编辑

#### Scenario: Slash edit 消费其命令文本
- **WHEN** 用户执行精确的 `/edit` 命令
- **THEN** Agent Web SHALL 为最新 turn 进入编辑模式
- **AND** 取消或成功 SHALL 恢复为空的普通草稿而不是 `/edit`

### Requirement: Agent Web SHALL 在不丢失用户工作的情况下调和编辑成功与失败

编辑确认 SHALL 只在本地附件队列为空时通过 JSON edit 路由提交编辑文本。在接受之前，Agent Web SHALL 在其本地会话层乐观地隐藏目标 root 并插入一个临时的编辑 root；接受后 SHALL 调和该临时 request 身份。在接受成功时，Agent Web SHALL 退出编辑模式、恢复先前的普通草稿并显示编辑成功提示。非空附件队列 SHALL 在 Web 路由被调用之前于 request service 中失败。在接受之前的任何失败时，Agent Web SHALL 回滚该本地乐观呈现、保持编辑模式、保留编辑文本和附件并显示安全提示。`Escape` 或显式取消 SHALL 退出编辑模式并恢复先前的普通草稿，而不清空当前附件队列。stale-latest 冲突 SHALL 在呈现警告之前刷新权威 session 快照。将选定的 Skill 指令注入编辑提交由 Stable 的 `directive-capability-routing` 能力拥有，本文不作定义。

#### Scenario: 成功的编辑恢复普通草稿
- **WHEN** edit-resubmit 被接受
- **THEN** Agent Web SHALL 退出编辑模式、清空已排队附件、恢复先前的普通草稿并显示成功反馈

#### Scenario: 失败的编辑保留工作
- **WHEN** edit-resubmit 在接受之前失败
- **THEN** Agent Web SHALL 保持编辑模式
- **AND** SHALL 保留编辑文本和已排队附件
- **AND** SHALL 恢复本地被隐藏的原始 turn

#### Scenario: 已排队附件在传输前阻止浏览器编辑
- **GIVEN** 本地附件队列非空
- **WHEN** 用户确认 edit-resubmit
- **THEN** Agent Web SHALL NOT 调用 Web edit 路由
- **AND** SHALL 回滚本地乐观替换
- **AND** SHALL 保持编辑模式并保留编辑文本和队列

#### Scenario: 过期编辑刷新权威状态
- **WHEN** edit-resubmit 因期望 request 不再是最新而失败
- **THEN** Agent Web SHALL 在显示过期编辑警告之前刷新 session 快照

### Requirement: 被接受的编辑替换 SHALL 在权威重载后保持稳定

Agent Web MAY 在接受之前乐观地替换被编辑的 root，但接受成功 SHALL 由 runtime 拥有的持久消息可见性支撑。稍后的权威会话重载 SHALL 把源 request 消息排除在默认会话投影之外，并 SHALL 保留可见的替换 request。显式隐藏消息查询 MAY 仍为审计和诊断检索源事实及其 `EDIT_REPLACED` 原因。

#### Scenario: 权威重载保留替换
- **GIVEN** 一次编辑已被接受且源 request 可见性替换已完成
- **WHEN** Agent Web 从持久历史重新加载会话
- **THEN** 默认投影 SHALL 排除每条源 request 消息
- **AND** SHALL 包含可见的替换 request
