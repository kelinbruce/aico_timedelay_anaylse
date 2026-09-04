# request-edit-resubmit Specification

## Purpose
定义当前最新问题的 edit-resubmit preflight、append-only replacement、internal attachment authority、幂等锚点、Agent Web text-only 入口、失败恢复和 authoritative reload 后的可见性。
## Requirements
### Requirement: Edit-resubmit command SHALL preflight the observed latest request

runtime edit-resubmit command MUST 携带可信 identity、`sessionId`、`expectedLatestRequestId`、`editedInputText`、`attachmentIds` 和非空白 `idempotencyKey`，并可携带既有 optional locale 与 accepted request metadata。Runtime SHALL 读取 owner-and-Agent-scoped session 和最新 child state。

对于普通 session，或已经提交 fork 后用户请求的 child，Runtime SHALL 将 `expectedLatestRequestId` 与 latest-lane snapshot 比较。snapshot 不存在 latest request 时，Runtime SHALL 返回 safe not-found；snapshot latest id 与 `expectedLatestRequestId` 不一致（包括 expected id 未知）时，Runtime SHALL 返回 stale-latest conflict，且 SHALL NOT 为该调用创建 edited request。

对于尚无 fork 后用户请求且无 active runtime work 的 fork child，当 child-owned durable facts 能证明目标为最新完整继承 request 时，Runtime SHALL 允许 `expectedLatestRequestId` 标识该 copied request。目标不是最新完整继承 request、无法解析出恰好一个 canonical 用户消息，或 child 已独立演进时，Runtime SHALL 返回 safe stale-latest 或 not-found outcome，且 SHALL NOT 创建 edited request。

该比较继续采用 point-in-time optimistic preflight，而不是与后续 message/run acceptance 绑定的 versioned 或 transactional CAS；因此 preflight 后、edit acceptance 写入完成前发生的并发 lane change不在原子拒绝保证内。该 Requirement 也不声明 runtime-owned whitespace-only input guard：当前 Agent Web confirm path 会 trim 并拒绝空白文本，Web schema 只约束 string length，runtime 不独立拒绝 whitespace-only edited input。

**需求类别**：功能性需求

#### Scenario: 普通 expected request 匹配已观察的 latest snapshot
- **GIVEN** `expectedLatestRequestId` 标识 loaded snapshot 中 scoped session 的 latest real request
- **WHEN** valid edit-resubmit command 通过 preflight
- **THEN** Runtime SHALL 继续执行既有后续校验和 edit acceptance path
- **AND** 任一后续校验失败时 SHALL 按对应既有 safe outcome 拒绝

#### Scenario: 最新继承 request 通过 preflight
- **GIVEN** fork child 尚无 fork 后用户请求和 active runtime work
- **AND** `expectedLatestRequestId` 标识 child copied prefix 的最新完整 request
- **WHEN** valid edit-resubmit command 通过 preflight
- **THEN** Runtime SHALL 继续既有 edit acceptance path，并以 copied canonical 用户消息作为编辑源

#### Scenario: Expected request 已过期
- **GIVEN** 更新的普通或继承 request 已成为 latest
- **WHEN** edit-resubmit 使用较早的 expected request id
- **THEN** Runtime SHALL 返回 stale-latest conflict
- **AND** Runtime SHALL NOT 创建编辑后的 request

#### Scenario: child 已独立演进后继承目标失效
- **GIVEN** child 已提交 fork 后用户请求
- **WHEN** edit-resubmit 仍以 copied inherited request 作为 `expectedLatestRequestId`
- **THEN** Runtime SHALL 以 stale-latest conflict 拒绝该命令
- **AND** SHALL NOT 隐藏复制的消息

#### Scenario: preflight 不覆盖并发 latest 变化
- **GIVEN** expected id 与 loaded child state 匹配
- **WHEN** edit acceptance 写入完成前另一个 lane change 成为 latest
- **THEN** 该 Function SHALL NOT 声明较早的 point-in-time comparison 能拒绝该竞态

### Requirement: Edit-resubmit SHALL append a new request and durably replace the source request presentation

An accepted edit SHALL create a new request id, run id, context id, attempt, visible user message, checkpoint, and `REQUEST_ACCEPTED` event carrying `editedFromRequestId`. Runtime SHALL replace older same-session lane work through the canonical latest-wins path, and superseded active work SHALL terminalize as `SUPERSEDED`. After the new request facts are durable, runtime SHALL use one owner+Agent+session+source-request scoped message-store operation to set every currently visible durable message of the source request to `visible=false` with visibility reason `EDIT_REPLACED`. The durable message facts SHALL remain available to explicit hidden-message queries, while the default conversation projection SHALL expose only the edited replacement request. The accepted edited request SHALL then use the normal scheduler, stream, history, and terminal-commit lifecycle.

#### Scenario: Accepted edit records lineage
- **WHEN** a valid edit-resubmit is accepted
- **THEN** the new `REQUEST_ACCEPTED` event SHALL reference `editedFromRequestId`
- **AND** the source request messages SHALL remain durable with `visible=false` and reason `EDIT_REPLACED`
- **AND** the new request SHALL append a visible user message

#### Scenario: Failed fresh edit preserves the source request
- **WHEN** a fresh edit fails before the new request is accepted
- **THEN** runtime SHALL NOT hide any source-request message

#### Scenario: Edit replaces active same-session work
- **GIVEN** older same-session work is still active
- **WHEN** edit-resubmit is accepted
- **THEN** runtime SHALL replace it through the canonical lane replacement path
- **AND** the older work SHALL converge to `SUPERSEDED`

### Requirement: Edit-resubmit SHALL preserve internal attachment authority while Web edit remains text-only

Runtime SHALL revalidate every attachment id carried by an internal edit command for the trusted owner, Agent, and session before accepting the edited request. The current Web edit route SHALL accept JSON only, with edited text, expected-latest id, idempotency key, optional locale, and only the empty `attachments` compatibility shape; it SHALL pass `attachmentIds=[]` to runtime. A non-empty JSON `attachments` array or any multipart edit request SHALL be rejected before runtime delegation. The current browser request service SHALL also reject a non-empty attachment queue before calling the Web edit route. This browser/Web limitation does not remove the internal runtime command's attachment-authority check, but file-bearing edit is not a current browser capability.

#### Scenario: Internal attachment references are revalidated
- **WHEN** an internal edit-resubmit command carries attachment ids
- **THEN** runtime SHALL validate their authority before request acceptance

#### Scenario: JSON edit does not accept attachment ids
- **WHEN** the client sends the current JSON edit body without files
- **THEN** Web SHALL delegate `attachmentIds=[]` to runtime
- **AND** SHALL NOT accept client-supplied attachment ids through that JSON body

#### Scenario: Non-empty JSON attachments are rejected
- **WHEN** the client sends non-empty `attachments` in a JSON edit body
- **THEN** Web SHALL reject the request before runtime delegation

#### Scenario: Multipart edit is rejected
- **WHEN** the client sends a multipart edit request
- **THEN** Web SHALL reject it before runtime delegation

### Requirement: Edit-resubmit idempotency SHALL anchor accepted semantics

Runtime MUST check the scoped idempotency anchor before performing fresh edit work. The current edit semantic fingerprint consists of action, trusted owner, Agent, session, `expectedLatestRequestId`, exact `editedInputText`, ordered `attachmentIds`, and the idempotency key. Repeating that fingerprint SHALL return the first accepted edited-request result without duplicate request side effects and SHALL idempotently complete source-request visibility replacement when an earlier accepted attempt stopped after acceptance but before that replacement completed. Reusing the key with a different value in that fingerprint SHALL fail with the existing idempotency-conflict contract. Current `locale`, `reservedRequest`, and `inputVariables` are not included in the edit semantic fingerprint, so this requirement SHALL NOT claim conflict detection for changes limited to those fields.

#### Scenario: Equivalent duplicate returns the first edited request
- **WHEN** an equivalent edit-resubmit command repeats the same idempotency key
- **THEN** runtime SHALL return the original accepted edited-request identity
- **AND** SHALL NOT append another user message, run, checkpoint, or accepted event
- **AND** SHALL ensure the source request messages are hidden with `EDIT_REPLACED`

#### Scenario: Conflicting duplicate is rejected
- **WHEN** the same idempotency key is reused with a different expected target, edited text, attachment set, or trusted scope
- **THEN** runtime SHALL reject the command with the idempotency-conflict contract

### Requirement: Agent Web SHALL expose edit only for the current latest turn

仅当 latest target 存在、目标属于当前最新轮次、conversation 不处于界面转换状态且用户拥有 Write permission 时，Agent Web SHALL 提供用户消息 edit 入口和 `/edit` 命令。`metadata.forkInherited: true` SHALL NOT 单独禁用或隐藏任一 edit 入口；Agent Web 提交 edit 请求后，后端 SHALL 判定继承最新轮次的最终资格。进入 edit 模式时，Agent Web SHALL 加载最新原始用户文本、聚焦 Composer，并提供取消和确认操作。从最新用户消息操作进入时，Agent Web SHALL 保留当前普通草稿；执行精确的 `/edit` 命令时，Agent Web SHALL 消费命令文本，并使用空白的 edit 后普通草稿。确认操作 SHALL 要求编辑文本非空白。

在当前 Web text-only Edit 中，当 trim 后的编辑文本与进入 edit 模式时加载的原始用户文本相同、未选择新的 Skill 定向且附件队列为空时，Agent Web SHALL 将确认操作处理为未变化 Edit：MUST NOT 发送 edit request，MUST NOT 隐藏或替换原轮次，MUST 保持 edit 模式和当前文本，并 MUST 显示“内容未修改”的非错误提示。用户需要重新生成相同问题答案时，界面 MUST 继续提供独立的 Retry 操作，MUST NOT 把未变化 Edit 静默转换为 Retry。

当 trim 后文本发生变化或选择了新的 Skill 定向时，Agent Web SHALL 沿用既有 Edit 提交与完整原轮次 replacement 行为。附件队列非空时，Agent Web SHALL 沿用既有 Web Edit 拒绝行为，MUST NOT 将其归类为未变化 Edit。

**需求类别**：功能性需求

#### Scenario: 较早轮次没有 edit 操作

- **GIVEN** 一条用户消息不属于当前最新轮次
- **WHEN** Agent Web 渲染该消息的操作入口
- **THEN** Agent Web SHALL NOT 提供 edit-resubmit

#### Scenario: 最新继承轮次可进入 edit

- **GIVEN** 最新轮次携带 `metadata.forkInherited: true`
- **AND** 该轮次满足其他既有 edit 入口条件
- **WHEN** 用户从该用户消息或 `/edit` 命令进入编辑
- **THEN** Agent Web SHALL 进入 edit 模式
- **AND** SHALL NOT 因 `forkInherited` 禁用或隐藏 edit 入口

#### Scenario: 进入 edit 时保留普通草稿

- **GIVEN** Composer 中存在普通草稿
- **WHEN** 用户从最新用户消息操作进入 edit 模式
- **THEN** Agent Web SHALL 单独保留普通草稿
- **AND** SHALL 加载并聚焦最新原始用户文本

#### Scenario: Slash edit 消费命令文本

- **WHEN** 用户执行精确的 `/edit` 命令
- **THEN** Agent Web SHALL 进入最新轮次的 edit 模式
- **AND** 取消或成功后 SHALL 恢复空白普通草稿，而不是 `/edit`

#### Scenario: 未变化 Edit 不创建 replacement

- **GIVEN** 用户进入最新轮次的 edit 模式
- **AND** trim 后文本与进入 edit 模式时加载的原始用户文本相同
- **AND** 未选择新的 Skill 定向
- **AND** 附件队列为空
- **WHEN** 用户确认 Edit
- **THEN** Agent Web MUST NOT 发送 edit request
- **AND** MUST NOT 隐藏或替换原轮次
- **AND** MUST 保持 edit 模式和当前文本
- **AND** MUST 显示“内容未修改”的提示

#### Scenario: 未变化 Edit 不转换为 Retry

- **GIVEN** 用户确认未变化 Edit
- **WHEN** Agent Web 阻止该操作
- **THEN** Agent Web MUST NOT 发送 retry request
- **AND** 原 request 的 attempt、Retry 次数和当前可见结果 MUST 保持不变

#### Scenario: 文本变化继续执行 Edit replacement

- **GIVEN** 用户进入最新轮次的 edit 模式
- **AND** trim 后文本与原始用户文本不同
- **WHEN** 用户确认 Edit
- **THEN** Agent Web SHALL 发送既有 edit request
- **AND** 接受成功后 SHALL 以新 request 替换完整原轮次

#### Scenario: 新 Skill 定向构成有效变化

- **GIVEN** trim 后文本与原始用户文本相同
- **AND** 用户选择了新的 Skill 定向
- **WHEN** 用户确认 Edit
- **THEN** Agent Web SHALL 发送包含该定向的既有 edit request
- **AND** SHALL NOT 将该操作归类为未变化 Edit

#### Scenario: 附件队列继续使用既有拒绝行为

- **GIVEN** 用户处于 edit 模式且附件队列非空
- **WHEN** 用户确认 Edit
- **THEN** Agent Web SHALL 按既有 Web Edit 附件限制拒绝提交
- **AND** MUST 保留编辑文本和附件队列
- **AND** MUST NOT 显示“内容未修改”提示

#### Scenario: 后端拒绝继承轮次 edit

- **WHEN** Agent Web 已提交最新继承轮次 edit
- **AND** 后端因目标已过期、存在 active runtime work、附件不可用、scope 不匹配或 durable fork source 不可用而拒绝
- **THEN** Agent Web SHALL 按既有失败协调规则保留用户输入并展示安全结果
- **AND** Agent Web SHALL NOT 将 `forkInherited` 当作后端资格判断的替代项

### Requirement: Agent Web SHALL reconcile edit success and failure without losing user work

Edit confirmation SHALL submit edited text through the JSON edit route only when the local attachment queue is empty. Before acceptance, Agent Web SHALL optimistically hide the target root in its local conversation layers and insert a temporary edited root; acceptance SHALL reconcile the temporary request identity. On accepted success, Agent Web SHALL leave edit mode, restore the prior normal draft, and display the edit-success notice. A non-empty attachment queue SHALL fail in the request service before the Web route is called. On any failure before acceptance, Agent Web SHALL roll back that local optimistic presentation, remain in edit mode, preserve edited text and attachments, and display a safe notice. `Escape` or explicit cancel SHALL leave edit mode and restore the prior normal draft without clearing the current attachment queue. A stale-latest conflict SHALL refresh the authoritative session snapshot before presenting its warning. Injection of a selected Skill directive into edit submission is owned by the Stable `directive-capability-routing` capability and is not defined here.

#### Scenario: Successful edit restores normal draft
- **WHEN** edit-resubmit is accepted
- **THEN** Agent Web SHALL leave edit mode, clear queued attachments, restore the prior normal draft, and show success feedback

#### Scenario: Failed edit preserves work
- **WHEN** edit-resubmit fails before acceptance
- **THEN** Agent Web SHALL remain in edit mode
- **AND** SHALL preserve edited text and queued attachments
- **AND** SHALL restore the locally hidden original turn

#### Scenario: Queued attachment blocks browser edit before transport
- **GIVEN** the local attachment queue is non-empty
- **WHEN** the user confirms edit-resubmit
- **THEN** Agent Web SHALL NOT call the Web edit route
- **AND** SHALL roll back the local optimistic replacement
- **AND** SHALL remain in edit mode with the edited text and queue preserved

#### Scenario: Stale edit refreshes authoritative state
- **WHEN** edit-resubmit fails because the expected request is no longer latest
- **THEN** Agent Web SHALL refresh the session snapshot before showing the stale-edit warning

### Requirement: Accepted edit replacement SHALL remain stable after authoritative reload

Agent Web MAY optimistically replace the edited root before acceptance, but accepted success SHALL be backed by runtime-owned durable message visibility. A later authoritative conversation reload SHALL exclude the source request messages from the default conversation projection and SHALL retain the visible replacement request. Explicit hidden-message queries MAY still retrieve the source facts and their `EDIT_REPLACED` reason for audit and diagnosis.

#### Scenario: Authoritative reload preserves the replacement
- **GIVEN** an edit was accepted and source-request visibility replacement completed
- **WHEN** Agent Web reloads the conversation from durable history
- **THEN** the default projection SHALL exclude every source-request message
- **AND** SHALL include the visible replacement request

### Requirement: Inherited edit 创建独立 child replacement

当 inherited edit 通过 preflight 时，Runtime MUST 使用 child copied canonical 用户文本和允许的 child metadata 作为编辑源，通过既有 edit-resubmit acceptance 创建新的 child `requestId`、`runId`、context、checkpoint、visible user message 和 `REQUEST_ACCEPTED` event。Runtime MUST 重新校验 child scope 内的 attachment authority，MUST NOT 读取或链接 parent runtime facts。

新请求 durable accepted 后，Runtime MUST 以既有 `EDIT_REPLACED` 语义隐藏 child copied source request 的默认展示。失败发生在新请求 accepted 之前时，Runtime MUST 保留 copied source request 可见。相同 command semantic 与 `idempotencyKey` 的重放 MUST 返回首次 accepted replacement，并幂等完成 child source visibility replacement。

用户界面 MUST 在 edit 被接受后以同一 source request identity 替换完整原轮次，不得只替换用户问题而保留原 assistant answer、think、工具过程或其 share/fork 操作入口。该可见结果 MUST 在新回答生成期间、会话来回切换后和 authoritative reload 后保持一致。

**需求类别**：功能性需求

#### Scenario: inherited edit 接受并替换 copied source
- **WHEN** valid inherited edit 被 accepted
- **THEN** Runtime MUST 创建新的 child request/run 和 visible edited user message
- **AND** `REQUEST_ACCEPTED` MUST 记录 `editedFromRequestId` 为 copied request id
- **AND** copied source request messages MUST 以 `EDIT_REPLACED` 隐藏

#### Scenario: inherited edit 的实时界面原子替换完整原轮次
- **GIVEN** 用户界面已加载 fork child 的 copied 用户问题、assistant answer 和过程内容
- **WHEN** 用户提交 inherited edit 且新 child request 被 accepted
- **THEN** 用户界面 MUST 在 authoritative reload 前隐藏 copied source request 的完整原轮次
- **AND** 原 assistant answer MUST NOT 继续暴露 share 或 fork 操作入口
- **AND** 会话切换返回与页面 reload 后 MUST 保持相同的可见轮次

#### Scenario: inherited edit 接受前失败
- **WHEN** attachment 校验、admission 或 acceptance 在新 request durable accepted 前失败
- **THEN** Runtime MUST NOT 隐藏 copied source request messages
- **AND** MUST NOT 创建部分 child runtime facts

#### Scenario: inherited edit 不使用 parent runtime
- **WHEN** Runtime 处理 inherited edit
- **THEN** 输入与资格 MUST 来自 child-owned durable facts
- **AND** parent run、context、checkpoint、timeline、lane 和 active-run 状态 MUST NOT 被读取、链接或修改

#### Scenario: inherited edit 幂等重放
- **WHEN** 相同 inherited edit command semantic 和 `idempotencyKey` 被重复提交
- **THEN** Runtime MUST 返回首次 accepted replacement
- **AND** MUST NOT 创建第二个 child request
- **AND** MUST 幂等完成 copied source 的 `EDIT_REPLACED` visibility
