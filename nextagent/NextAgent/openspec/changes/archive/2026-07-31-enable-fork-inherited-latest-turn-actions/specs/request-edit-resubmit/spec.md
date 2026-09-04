## Function

- **所属 Function**：`FN-2.1 提交请求`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

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

## ADDED Requirements

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

## Function 变更汇总

### 前置条件

- **变更类型**：修改
- **目标内容**：edit-resubmit 的 latest target 可为尚未独立演进的 fork child 最新继承 request。
- **依据 Requirements**：`Edit-resubmit command SHALL preflight the observed latest request`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统校验 child latest 资格，以 copied 用户输入创建新的 child request，并在接受后执行既有 source replacement；全程不读取 parent runtime。
- **依据 Requirements**：`Edit-resubmit command SHALL preflight the observed latest request`、`Inherited edit 创建独立 child replacement`

### 结果

- **变更类型**：修改
- **目标内容**：成功结果是普通、可继续运行和控制的 child replacement request，用户界面在实时生成、会话切换和重新加载时仅显示完整 replacement 轮次；接受前失败或幂等重放不会破坏 copied source。
- **依据 Requirements**：`Inherited edit 创建独立 child replacement`
