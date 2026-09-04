# session-fork-from-message Specification

## Purpose

Define the stable user-visible session fork behavior from durable assistant messages, including request-scoped live-completion fork resolution, child prefix materialization, child active context initialization, fork notice projection, idempotency and isolation from source runtime state.

## Function

- **所属 Function**：`FN-1.11 从消息派生子会话`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Fork From Durable Visible Assistant Message

系统 SHALL 支持用户从源 session 中一条已持久化、visible、可渲染的 assistant message 派生一个新的 child session。派生入口 MUST 由用户操作触发，MUST 通过可信 owner scope 和 Agent Scope 校验源 session 与锚点 message，MUST NOT 由模型输出、capability 参数或客户端请求体覆盖 owner scope、Agent Scope 或源消息归属。

一个 message 可作为 fork anchor 的条件是：它属于当前 owner+agent scoped source session，`role=ASSISTANT`，`visible=true`，content 非空，并且已经作为 conversation history 的持久化 message 出现。仍在 stream delta 中、尚未进入 conversation history 的 assistant 输出 MUST NOT 成为 fork anchor。

Fork eligibility MUST NOT 由 `RequestRun.status=COMPLETED` 决定。assistant message 已持久化进入 conversation history 是 eligibility boundary；当系统能够观察到关联 source run 仍未 terminal 时，系统 MUST 把该状态作为 persistence invariant violation 拒绝。

对于仍以 live stream envelopes 而不是 refreshed conversation snapshot 表示的界面状态，系统 MUST 提供以 source request/root message id 为键的 request-scoped fork 入口。仅当该 request id 唯一解析为 owner+agent scoped、visible、非空、已持久化且 metadata 记录 `REQUEST_COMPLETED` / `COMPLETED` 的 assistant message 时，系统才 MUST 继续 message-anchor fork；使用 refreshed conversation snapshot 时，调用方 MUST 使用 message anchor。系统 MUST NOT 直接 fork live stream content。request 仍在 streaming、以 failed/canceled/superseded 终止、没有 durable completed assistant message 或解析出多个 completed assistant candidates 时，request-scoped fork MUST 安全失败且 MUST NOT 创建 child session。

系统 MUST 在 fork 时把源 session 当前标题 trim 后得到源标题快照；标题缺失或 trim 后为空时，源标题快照 MUST 使用 `Untitled session`。系统 MUST 把 `Fork · ` 直接添加到该源标题快照之前，作为新 child session 标题。系统 MUST NOT 识别、折叠或删除源标题中已有的 `Fork · ` 文本；每次成功创建新的 child session 都 MUST 应用一次相同前缀规则。该规范化和拼接 MUST NOT 依赖 Web `displayTitle` alias 或 Web channel helper。

新 child session 标题 MUST 继续满足既有 100 字符上限。拼接结果超过该上限时，系统 MUST 按既有标题长度计数规则从源标题快照末尾移除字符，直到结果不超过 100 字符；系统 MUST 保留本次新增的完整 `Fork · ` 前缀。系统 MUST 允许不同 child sessions 使用完全相同的标题；标题相同 MUST NOT 影响 child session 创建、身份、访问或后续运行。

**需求类别**：功能性需求

#### Scenario: Completed live request fork resolves to a durable assistant anchor

- **WHEN** 客户端在 live assistant response 标记 completed 后按 source request/root message id 发起 fork
- **THEN** 系统 MUST 把该 request id 唯一解析为带 completed terminal metadata 的 durable visible assistant message
- **AND** 系统 MUST 使用解析出的 assistant message id 执行正常 message-anchor fork
- **AND** request 仍在 streaming、failed、canceled、superseded、没有 durable completed assistant message 或存在多个 completed assistant candidates 时，系统 MUST 拒绝 request-scoped fork
- **AND** 系统 MUST NOT 把 raw live stream envelopes 复制到 child session

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
- **THEN** fork request MUST 拒绝该 anchor
- **AND** 系统 MUST NOT 创建 child session、message、active context item 或 fork metadata
- **AND** 对外错误 MUST 使用安全错误，不泄漏 stream delta 或 raw model output

#### Scenario: 不可渲染或非 assistant message 不可派生

- **WHEN** fork anchor 指向 user、system、capability result、hidden message、空内容 assistant message 或不存在的 message
- **THEN** fork request MUST 以安全错误拒绝
- **AND** 系统 MUST NOT 创建 child session 或任何派生持久化事实

#### Scenario: 跨 owner 或跨 agent anchor 被拒绝

- **WHEN** fork request 的可信 owner scope 或 Agent Scope 与 source session 或 anchor message 不匹配
- **THEN** 系统 MUST 以 safe not-found outcome 拒绝
- **AND** 系统 MUST NOT 泄漏源 session 或 anchor message 是否存在于其他 owner 或 agent scope

### Requirement: Child Session Inherits Prefix And Model-Visible Context

系统 SHALL 在 fork 时复制 source session 从开头到 anchor message 的完整 canonical durable conversation prefix，并用复制后的 child message ids 初始化 child active context。child conversation read MUST 展示与 source conversation 在 fork 时截至 anchor 的可见消息序列等价的内容。Copied message MUST 使用 child-owned `messageId`、`sessionId`、`requestId` 和 `runId`；同一 source run MUST 映射到同一新 child run anchor，不同 source run MUST 映射到不同 anchor，且映射 MUST NOT 作为 source lineage 持久化。

Child active context MUST 只引用 child message ids，version MUST 初始化为 `0`，ordinals MUST 从 `0` 连续递增。系统 MUST NOT 复制 parent active context、历史 context snapshot、thinking event 或 process snapshot 到模型上下文。对于相同的 copied message corpus，初始化结果 MUST 与 normal context assembly 的 prior-history selection 结果在完整轮次、summary replacement、tool-use/capability-result pairing、hidden replacement exclusion 和 orphan fragment exclusion 上语义等价；系统 MUST NOT 调用模型、创建 summary、运行 compaction 或以空 active context 代替选择结果。

active-context selection 输入 MUST 是从 child session 开始到 `childAnchorMessageId` 为止的 canonical copied child messages。系统 MUST 拒绝 missing anchor、duplicate message ids、mixed child session ids、anchor 之后的 records，以及 safe projection 后仍留在 emitted refs 或 metadata refs 中的 parent/source message refs。selection 输出 MUST 只包含 copied prefix 中存在的 child message ids并保持 canonical order；copied summary 的 retained refs MUST 只引用该 prefix 中的 child message ids。LOCAL 与 REMOTE MUST 对相同 corpus 产生上述语义等价结果，MUST NOT 因部署模式采用另一套轮次、summary、Tool 配对、hidden replacement 或 orphan fragment 解释。

当 copied prefix 包含 model-visible prior history 时，空 active context MUST 被视为 fork failure。该 version `0` 初始化路径 MUST 只服务 session fork，MUST NOT 替换或改变非 fork 场景的 normal active-context append、terminal append 或 compaction contracts。

Safe child message projection MUST 同时检查 copied message 的 content、metadata、replacement evidence、summary metadata、`ContentRef` 和 backing refs。仍需展示或进入模型上下文的 source message refs MUST 映射到存在于 copied prefix 的 child message ids。规范化`tool-results/<refId>` MUST 在prepare清单对应content已成功stage时重写为同一attempt的child-accessible promoted content id。source run/checkpoint/timeline refs、raw provider fields、parent invocation lineage、source execution paths、host paths 和其他execution-bound refs MUST 被安全移除或使 fork 在 child 可见前失败；系统 MUST NOT 把这些 source-bound values 原样复制到 child。

已知 typed metadata MUST 按字段语义显式处理。unknown metadata 在不包含 source message/request/run ids、checkpoint refs、timeline refs、raw provider fields、parent invocation lineage、source execution paths、host paths 或 execution-bound refs 时 MUST 原样保留；命中任一上述 source-bound 或 runtime-only value 时系统 MUST 使 fork 安全失败，MUST NOT 原样复制或静默删除该未知字段后继续。已经 owner+agent scoped 且对 child 可访问的 durable attachment、artifact、blob-backed ref 或 ordinary workspace file ref MUST 原样保留；Working Memory provider已持有且可在其durable content boundary内安全重映射的ref MUST重映射为child-accessible durable ref；prepare清单中已经成功stage的规范化tool-result ref MUST 重映射为promoted content id；其他 ref MUST 使整个 fork 失败。

对携带 `runId` 的 source message，fork MUST 为其 copied message 铸造 child-scoped run anchor。run anchor MUST NOT 等于任何 source `runId`，且 source message 无 `runId` 时其 copied message MUST NOT 携带 `runId`。run anchor 只是 durable message 的分组/读取锚点；fork MUST NOT 为 run anchor 创建 RequestRun、runtime-origin timeline event 或 checkpoint 事实。除 messages 与 active context 外，fork MUST 为 copied prefix 中每个 display run 物化 child-owned durable process snapshots；这些 snapshots 只用于 event history，不是 RequestRun、checkpoint 或模型上下文事实。

**需求类别**：功能性需求

#### Scenario: Child conversation displays the copied prefix

- **WHEN** fork 成功后读取 child conversation
- **THEN** response MUST 包含截至 anchor 的可见 message 序列
- **AND** 每条 message MUST 使用 child session identity 且保持对应 content、role、content type 和 visibility

#### Scenario: Child active context only references child messages

- **WHEN** fork 成功后读取 child active context
- **THEN** items MUST 只引用 copied child messages 且不包含 anchor 之后内容
- **AND** version MUST 为 `0`

#### Scenario: Selector rejects non-prefix or parent-tainted inputs

- **WHEN** fork active context selection 收到 missing anchor、duplicate message id、mixed child session ids、anchor 后 record 或残留 parent/source message ref 的 copied input
- **THEN** selection MUST fail
- **AND** `forkSession` MUST NOT 提交 child session 或 child active context

#### Scenario: Fork selection matches normal prior-history semantics

- **WHEN** copied prefix 包含 prior-history candidates、summaries、tool-use/capability-result pairs、hidden replacements 或 orphan fragments
- **THEN** fork selection 结果 MUST 与 normal context assembly 对同一 corpus 的 prior-history selection 结果语义等价
- **AND** retained refs MUST 保持 canonical order 并只使用 copied child message ids

#### Scenario: Fork active context initialization is not a model operation

- **WHEN** fork 初始化 child active context version `0`
- **THEN** 系统 MUST NOT 调用 model provider、summary generation、compaction 或 normal current-request assembly
- **AND** selected summary MUST 已经存在于 copied child prefix

#### Scenario: Empty active context is not an accepted fork result

- **WHEN** copied prefix 包含 model-visible prior history但 selector 返回空 refs
- **THEN** `forkSession` MUST 失败
- **AND** 系统 MUST NOT 返回仅复制 conversation history、active context 为空的 child session

#### Scenario: Existing active context append contract remains compatible

- **WHEN** normal message append、terminal commit 或 compaction 在 fork materialization 之外运行
- **THEN** existing active-context append/compaction contracts MUST 保持不变
- **AND** fork version `0` initialization MUST NOT 取代非 fork 写入语义

#### Scenario: Historical anchor ignores parent current context

- **WHEN** source 在 anchor 后继续产生消息或发生 compression 后从历史 anchor fork
- **THEN** child active context MUST 只由完整 copied prefix 计算
- **AND** 系统 MUST NOT 读取 parent current context 或 parent timeline 决定初始化结果

#### Scenario: Summary refs are remapped without duplicate covered originals

- **WHEN** copied prefix 包含 SUMMARY 及 covered originals
- **THEN** summary metadata MUST 只引用存在的 child message ids
- **AND** selected active context MUST NOT 同时包含 summary 和其 covered originals

#### Scenario: Safe projection 覆盖 content 与 metadata

- **WHEN** source message content 或 metadata 包含需要映射的 message refs 或 source-bound values
- **THEN** copied child message MUST 只保留已映射的 child refs 和可安全保留的 values
- **AND** 无法安全映射、移除、保留或在Working Memory provider内重映射的value MUST使fork在child可见前失败

#### Scenario: Unknown metadata 携带 source-bound value 时失败

- **WHEN** copied source message 的 unknown metadata 字段携带 source message/request/run id、checkpoint/timeline ref、raw provider field、source execution path、host path 或 execution-bound ref
- **THEN** 系统 MUST 在 child 可见前拒绝整个 fork
- **AND** 系统 MUST NOT 原样复制该 value 或只删除该未知字段后继续派生

#### Scenario: Durable ref 必须对 child 可访问

- **WHEN** copied source message 引用 durable attachment、artifact、blob-backed content 或 ordinary workspace file
- **THEN** 系统 MUST 验证该 ref 与当前 owner 和 Agent Scope 一致且对 child 可访问
- **AND** 无法满足 child 可访问性的 ref MUST 被安全重映射或使整个 fork 失败

#### Scenario: 规范化工具结果通过 prepare 和 stage 进入 child

- **WHEN** copied message包含规范化的`tool-results/<refId>`且prepare清单返回该ref
- **AND** NextAgent通过既有可信resolver取得内容并按同一attempt成功stage
- **THEN** `forkSession` MUST 把该source ref重写为child-accessible promoted content id
- **AND** promoted content MUST 与child facts原子提交，copied message MUST NOT包含原source ref、`BlobRef`或source path

#### Scenario: 未准备或不支持的 execution-bound ref 安全失败

- **WHEN** copied message包含未在prepare清单中完成stage的规范化tool-result ref、source workspace/host path或未知execution-bound ref
- **THEN** `forkSession` MUST 按权威错误映射安全拒绝整个fork
- **AND** 系统 MUST NOT原样复制该ref、读取任意host path或创建可见child facts

#### Scenario: Child 首次 submit 使用继承后的 active context

- **WHEN** 用户在刚派生的 child session 中提交第一条新消息
- **THEN** context assembly MUST 从 child active context 读取 prior history
- **AND** 模型输入 MUST 能使用 fork anchor 之前的 child-side context
- **AND** context assembly MUST NOT 为该 submit 读取 parent session history、parent active context、parent timeline、parent process snapshots 或 parent checkpoint

#### Scenario: Copied turns retain child run anchors

- **WHEN** fork 成功且 source prefix 中的 messages 携带 `runId`
- **THEN** 每条携带 `runId` 的 copied message MUST 携带 child-scoped run anchor
- **AND** 同一 source run 的 copied messages MUST 共享同一个 run anchor
- **AND** 不同 source run 的 copied messages MUST 使用不同 run anchor
- **AND** run anchor MUST NOT 等于任何 source `runId`
- **AND** child session MUST NOT 出现与 run anchor 对应的 RequestRun、runtime-origin timeline event 或 checkpoint 事实

#### Scenario: 继承问答对携带 child-scoped run anchor

- **WHEN** fork 成功且 source prefix 中的 messages 携带 `runId`
- **THEN** 每条携带 `runId` 的 copied message MUST 携带 child-scoped run anchor
- **AND** 同一 source run 的 copied messages MUST 共享同一个 run anchor
- **AND** 不同 source run 的 copied messages MUST 使用不同 run anchor
- **AND** run anchor MUST NOT 等于任何 source `runId`
- **AND** child session MUST NOT 出现与 run anchor 对应的 RequestRun、runtime-origin timeline event 或 checkpoint 事实
- **AND** child session MAY 包含只供 event-history 读取的 child-owned `FORK_SNAPSHOT`

#### Scenario: 无 runId 的 source message 不获得 run anchor

- **WHEN** source prefix 中的 message 未携带 `runId`
- **THEN** 其 copied message MUST NOT 携带 `runId`

#### Scenario: 继承问答对可经 conversation share 分享

- **WHEN** 用户在 child session 中勾选继承的问答对创建分享
- **THEN** 分享创建的 `runIds` 快照 MUST 能引用 copied messages 的 run anchor
- **AND** 分享读取 MUST 返回 run anchor 对应的 copied messages
- **AND** 分享读取 MUST NOT 返回 source session 的任何 message、run 或 timeline 事实

### Requirement: Forked Session Is Isolated From Source Session

Fork后child SHALL独立演进。Fork不得修改source messages、active context、timeline或RequestRun；不得调用Agent core或model provider。Child后续RequestRun、timeline、checkpoint、pending input、workspace和artifacts必须写入child scope。

Copied run anchor仍不是可操作runtime lifecycle fact。Fork新增的FORK_SNAPSHOT records只是child-owned只读过程历史，MUST不创建RequestRun、RequestContext、checkpoint、pending input或lane state；cancel、retry、edit、recovery、activeRun和stream control MUST忽略它们并保持run-not-found。

copied message 携带的 child-scoped run anchor 是 durable message 的分组/读取锚点，不是 runtime 事实。run anchor MUST NOT 等于任何 source `runId`，与 source run 的对应关系 MUST NOT 持久化，MUST NOT 被 cancel/retry/edit/recovery/stream/activeRun 等 lifecycle 路径当作可操作的 run。

Copied run anchor仍不是可操作runtime lifecycle fact。Fork新增的FORK_SNAPSHOT records只是child-owned只读过程历史，MUST不创建RequestRun、RequestContext、checkpoint、pending input或lane state；cancel、retry、edit、recovery、activeRun和stream control MUST忽略它们并保持run-not-found。

#### Scenario: Child continuation never writes back
- **WHEN**child提交新请求
- **THEN**新messages、RequestRun、runtime events和context MUST只写入child

#### Scenario: Runtime state is not inherited
- **WHEN**source存在checkpoint、pending input、live delta、provider error、tool state或未完成run
- **THEN**child MUST不继承这些事实
- **AND**只继承durable message prefix及允许的read-only process snapshots

#### Scenario: Unsafe source-bound refs fail atomically
- **WHEN**copied message或event payload含无法安全remap、promotion或证明child-accessible的source runtime/path ref
- **THEN**fork MUST安全失败
- **AND**MUST不创建可见child或部分facts

#### Scenario: Unsafe source-bound refs fail atomically
- **WHEN**copied message或event payload含无法安全remap、promotion或证明child-accessible的source runtime/path ref
- **THEN**fork MUST安全失败
- **AND**MUST不创建可见child或部分facts

#### Scenario: Snapshot run anchor is not actionable
- **WHEN**child run anchor只有FORK_SNAPSHOT records而没有RequestRun
- **THEN**lifecycle和recovery路径 MUST不把它当作runtime run
- **AND**event-history读取 MAY返回其只读过程snapshots

#### Scenario: Run anchor 不是 runtime lifecycle 事实
- **WHEN** child session 中存在携带 run anchor 的 copied messages，并可能存在该 anchor 的 `FORK_SNAPSHOT` records，但没有 RequestRun
- **THEN** runtime MUST NOT 为 run anchor 创建 RequestRun、runtime-origin timeline、checkpoint、pending input 或 lane queue 事实
- **AND** cancel/retry/edit/recovery/stream/activeRun 等 lifecycle 路径 MUST NOT 把 run anchor 当作可操作的 run
- **AND** run anchor MUST NOT 可解析回 source run
- **AND** event-history 读取 MAY 返回其只读过程 snapshots

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

### Requirement: Fork Idempotency

fork 操作 SHALL 是 retry-safe 的。Web route MUST 从 required、opaque、bounded token 产生 normalized `idempotencyKey`：trim 客户端字符串，拒绝 trim 后为空的值，并拒绝 trim 后超过 128 个字符的值。相同 owner scope、Agent Scope、source session、最终 source anchor message 和相同 normalized `idempotencyKey` 的重复 `forkSession` MUST 返回首次成功创建的 child session。`ForkSessionResult.replayed=false` MUST 表示当前调用创建并提交了 fork facts；`replayed=true` MUST 表示相同 scoped success anchor 已提交且系统返回首次 child session。使用不同 `idempotencyKey` 对同一 source anchor 发起 fork MUST 创建新的 child session。`prepareFork`产生的fork attempt只隔离不可见promotion staging，MUST NOT替代或占用成功幂等锚点。

当输入为 request anchor 时，系统 MUST 在prepare与fork阶段唯一解析同一最终source anchor message，再使用该message anchor建立或查询成功幂等锚点。使用message anchor和能够解析到同一message的request anchor、且其余scoped坐标与`idempotencyKey`相同时，MUST命中同一个成功幂等锚点。失败attempt MUST NOT写入成功幂等锚点。已存在成功锚点时，`prepareFork` MUST返回空required refs，随后`forkSession` MUST返回首次child且`replayed=true`，MUST NOT要求重新stage content。日志、metric、audit和safe diagnostics MUST NOT记录原始`idempotencyKey`或完整fork attempt。

**需求类别**：功能性需求

#### Scenario: 相同 idempotencyKey 重试返回同一 child session

- **WHEN** 客户端因网络重试使用相同 `idempotencyKey` 对同一 scoped source anchor 调用 `forkSession`
- **THEN** 系统 MUST 返回首次创建的 child session 且 `replayed=true`
- **AND** 系统 MUST NOT 创建第二个 child session、第二批 copied messages、第二组 active context items 或第二组 process snapshots

#### Scenario: 首次成功返回非重放结果

- **WHEN** 当前 `forkSession` 调用首次创建并提交 scoped fork facts
- **THEN** 系统 MUST 返回该 child session 且 `replayed=false`

#### Scenario: 消息与请求入口共享最终锚点

- **WHEN** 一个 request anchor 唯一解析为 message `M`
- **AND** 调用方分别使用该 request anchor 和 message `M`、相同 trusted scope 与相同 `idempotencyKey` 调用 `forkSession`
- **THEN** 两次调用 MUST 返回同一个首次 child session
- **AND** 仅首次创建成功的调用 MUST 返回 `replayed=false`

#### Scenario: 不同 idempotencyKey 可再次派生

- **WHEN** 用户对同一 source anchor 使用新的 `idempotencyKey` 再次发起 fork
- **THEN** 系统 MUST 创建另一个新的 child session
- **AND** 两个 child sessions MUST 彼此隔离

#### Scenario: 相同 idempotencyKey 不得跨 scope 命中

- **WHEN** 不同 owner、agent、source session 或最终 source anchor 使用相同 `idempotencyKey`
- **THEN** 系统 MUST NOT 返回其他 scope 或其他 anchor 的 child session
- **AND** 幂等 anchor lookup MUST 受 trusted owner scope、Agent Scope、source session 和最终 source anchor 约束

#### Scenario: 失败 attempt 不占用成功幂等锚点

- **WHEN** prepare、resolver、stage或fork materialization在child session commit前失败
- **THEN** 系统 MUST NOT 写入表示成功 child session 的 idempotency anchor
- **AND** 使用相同 `idempotencyKey` 重试时 MUST 重新尝试 fork，而不是返回不存在的 child session

#### Scenario: 已提交成功的重试不重复准备内容

- **WHEN** 相同scoped idempotency key已经成功提交child后再次调用`prepareFork`
- **THEN** `prepareFork` MUST返回空`requiredContentRefs`
- **AND** 随后的`forkSession` MUST返回首次child且`replayed=true`
- **AND** 系统 MUST NOT要求调用方重新解析或stage已提交content

#### Scenario: 并发成功重放不提交当前 attempt residue

- **WHEN** 当前attempt完成staging后，另一个相同scoped idempotency key的attempt先提交成功
- **THEN** 当前`forkSession` MUST返回首次child且`replayed=true`
- **AND** 当前attempt的staged content MUST NOT标记为COMMITTED或进入首次child
- **AND** 系统 MUST best-effort abort当前attempt；abort失败时residue MUST保持不可见并由cleanup重试

#### Scenario: commit 后响应失败按成功重试处理

- **WHEN** `forkSession` 已成功提交 child session、copied messages、active context、fork source、process snapshots 和 idempotency anchor
- **AND** response delivery 随后失败或被取消
- **THEN** 使用相同 scoped `idempotencyKey` 重试 MUST 返回首次创建的 child session 且 `replayed=true`
- **AND** 系统 MUST NOT 创建第二个 child

### Requirement: Fork Failure Is Atomic And Safe

fork 持久化 SHALL 是原子操作。创建 child session、复制 child messages、初始化 child active context、保存 fork source metadata、保存 process snapshots、提交matching promotions和建立幂等 anchor 任一步失败时，系统 MUST reject 权威映射对应的 `AgentError`，并且 MUST NOT 留下可见的部分 child session。prepare、resolver或stage失败必须发生在child可见前；已stage bytes在`forkSession`成功提交前 MUST保持不可见。错误响应、日志、metric、audit 或 safe diagnostics MUST NOT 包含 raw prompt、raw provider error、stream delta、tool result、附件内容、credential、token 或未脱敏路径。

历史已经随 child 成功提交且与可信 owner+agent scope 一致的 promoted content MUST 继续由 normal content resolver 读取。既有不可见 promotion residue MUST NOT 通过 conversation read、artifact/content resolver、model context、Web projection、safe error、audit 或日志被观察；cleanup 只收敛这种历史 residue，MUST NOT 修改已经 committed 的 content。

`prepareFork`、resolver、stage或`forkSession`在最终原子提交开始前观察到cancellation时，系统 MUST终止后续派生工作并以`SESSION_FORK_CANCELED / CANCELED / false` reject `AgentError`，且 MUST NOT留下可见的部分child session。Runtime MUST best-effort调用`abortForkPromotions`收敛同attempt的staged residue；abort failure不得覆盖原始安全错误，剩余residue保持不可见并由cleanup重试。`forkSession`因另一个并发attempt已成功而返回`replayed=true`时，系统同样 MUST best-effort abort当前未提交attempt且 MUST NOT影响成功结果。最终原子提交边界一旦开始，系统 MUST以一致性为先，最终结果只能全部可见或全部不可见，MUST NOT承诺在该边界中途取消。若提交已成功而response未送达，系统 MUST保留child，并 MUST在使用相同scoped `idempotencyKey`重试时返回该child；后续abort MUST NOT修改COMMITTED content。

`cleanupExpiredForkPromotions` 的 request MUST 只包含 cleanup clock `now` 和 `retentionMs`，并只通过 optional 非 wire `AbortSignal` 接收 cancellation；它 MUST NOT 接收 caller-provided owner/session/message filters、status overrides、per-record `expiresAt`、`CLEANED` status 或 `cleanupCompletedAt`。cleanup eligibility MUST 只由不可见 residue 的 persisted creation time 与该次 `retentionMs` cutoff 决定；系统 MUST 使用 persisted trusted owner+agent scope 收敛 residue，且 MUST NOT 修改已经随 child 成功提交的 content。

**需求类别**：系统质量属性

**质量属性**：安全、可靠性/恢复
**适用范围**：该 Function

#### Scenario: 持久化中途失败不留下可见 child session

- **WHEN** fork 在创建 child session、复制 messages、初始化 active context、保存 process snapshots 或 fork metadata 的任一步失败
- **THEN** `forkSession` MUST reject 权威映射对应的 canonical `AgentError`
- **AND** child session MUST 不可通过 session list 或 conversation read 观察到
- **AND** source session MUST 保持不变

#### Scenario: Active context 初始化失败导致 fork 失败

- **WHEN** child messages 已准备好但 child active context 初始化失败
- **THEN** fork MUST 整体失败
- **AND** 系统 MUST NOT 返回 child session
- **AND** 系统 MUST NOT 退化为仅复制 history、active context 为空或 current-request-only 的 child session

#### Scenario: Resource preflight failure is atomic

- **WHEN** 完整source prefix、safe child message projection、promotion ref count/bytes、process snapshots或提交成本超过服务端operation budget
- **THEN** `forkSession` MUST 按超限维度 reject 对应 canonical capacity `AgentError`
- **AND** 系统 MUST NOT 留下可见 child session、partial copied messages 或 partial active context

#### Scenario: Staged promotion is invisible before fork commit

- **WHEN** NextAgent按prepare清单把规范化tool-result bytes stage到selected Working Memory provider
- **AND** fork commit 尚未完成
- **THEN** conversation read、session list、artifact/content resolver 和 model context assembly MUST NOT 观察该 uncommitted content
- **AND** Web projection、safe errors、audit logs 和 metrics MUST NOT 暴露 storage ref 或 content bytes

#### Scenario: Committed promotion is resolved through metadata

- **WHEN** 读取已经随 child fork 提交的 promoted content id
- **THEN** normal content resolver paths MUST 只在 trusted owner+agent scope 与 target child session/message 坐标都匹配时解析内容
- **AND** promoted content id MUST NOT 作为 generic storage ref 被读取

#### Scenario: Fork failure aborts staged promotion safely

- **WHEN** selected Working Memory provider已为prepare清单中的source ref stage content
- **AND** fork 在 child session 提交前失败
- **THEN** 该 promoted content MUST 保持对 normal read 和 resolver paths 不可见
- **AND** 系统 MUST 尝试立即收敛该不可见 residue；未能立即收敛的 residue MUST 可由后续 cleanup 重试
- **AND** cleanup failure MUST NOT 使 content 变得可见或 child-accessible

#### Scenario: Promotion stage metadata failure is cleaned before failure

- **WHEN** stage已产生内部bytes copy，但无法建立fork attempt与source ref的可验证durable binding
- **THEN** `forkSession` MUST 在 child 可见前 reject canonical `AgentError`
- **AND** 系统 MUST 尝试立即收敛刚产生的不可见 residue
- **AND** 无binding的bytes MUST NOT变得可解析、child-accessible或被视为成功幂等锚点

#### Scenario: 未完整准备的 attempt 不得提交 child

- **WHEN** `forkSession`发现required ref缺少matching staged content、存在清单外staged ref或source ref绑定不一致
- **THEN** `forkSession` MUST在最终提交前reject canonical `AgentError`
- **AND** 系统 MUST NOT创建可见child facts或把任何staged content标记为COMMITTED
- **AND** matching不可见residue MUST可由abort或cleanup收敛

#### Scenario: 最终原子提交开始前 cancellation 不留下 child

- **WHEN** prepare、resolver、stage或`forkSession`在最终原子提交开始前观察到cancellation
- **THEN** 系统 MUST reject `SESSION_FORK_CANCELED / CANCELED / false` 并停止后续派生工作
- **AND** session list、conversation read 和 content resolver MUST NOT 观察到部分 child facts
- **AND** 已stage residue MUST保持不可见并由best-effort abort或cleanup收敛

#### Scenario: 原子提交开始后不做事务中途取消

- **WHEN** provider 已开始最终原子提交后才观察到 cancellation
- **THEN** 系统最终 MUST 使全部 child facts 可见或全部不可见
- **AND** 系统 MUST NOT 因 cancellation 暴露部分 child facts
- **AND** 完整提交但 response 未送达时 MUST 使用成功幂等锚点恢复

#### Scenario: 提交后 response 中断可幂等恢复

- **WHEN** child session 已原子提交但 response 因 cancellation 或传输中断未送达
- **THEN** 使用相同 scoped `idempotencyKey` 重试 `forkSession` MUST 返回首次创建的 child session 且 `replayed=true`
- **AND** 系统 MUST NOT 创建第二个 child

#### Scenario: Fork promotion cleanup retries only invisible residue

- **WHEN** scheduled fork-promotion cleanup 运行
- **THEN** 它 MUST 只处理早于 retention cutoff 且未随 child 成功提交的不可见 promotion residue
- **AND** residue 已不存在或本次成功收敛时 MUST 计入 `cleanedCount`
- **AND** residue 本次未能收敛时 MUST 保持不可解析并计入 `retryableCount`，供后续 cleanup 重试
- **AND** 它 MUST NOT 修改已提交 promoted content、child messages、child active context、source messages 或 source execution workspace files

#### Scenario: Cleanup request 不允许覆盖作用域或生命周期

- **WHEN** maintenance 调用 `cleanupExpiredForkPromotions({ now, retentionMs }, signal?)`
- **THEN** cleanup MUST 只按 persisted creation time 和该次 retention cutoff 选择过期、不可见且未成功提交的 residue
- **AND** request MUST NOT 包含 owner/session/message filter、status override、`expiresAt`、`CLEANED` 或 `cleanupCompletedAt`
- **AND** 系统 MUST 使用每条 residue persisted trusted owner+agent scope 执行 cleanup

#### Scenario: Safe diagnostics 不泄漏敏感内容

- **WHEN** fork 失败并产生日志、metric、audit 或 diagnostic
- **THEN** diagnostics MUST 只包含安全错误码、hashed 或 bounded refs、operation outcome 和低基数字段
- **AND** diagnostics MUST NOT 包含 copied message content、raw model output、stream delta、tool result、prompt、credential 或附件内容

### Requirement: Fork atomically materializes child-owned process history

系统 SHALL 在 source→child message/request/run 映射仍可用时读取 copied display runs 的全部 durable timeline records，并校验同一 owner scope、Agent Scope、source session 和 run binding。每个 child-owned `FORK_SNAPSHOT` MUST 使用新 child event id 及 child session/request/run 坐标，省略 source request context、content ref、source 坐标和存储 metadata，并保持 validated event type、created time 和 source records 的相对顺序。Known payload message/request/run refs MUST 重映射；checkpoint/timeline refs、provider raw fields 和 paths MUST 被清除或使 fork 安全失败。schema 已识别且只用于展示关联的 opaque step/tool/capability/workflow ids MUST 原样保留，MUST NOT 成为控制 authority；无法识别或可能承载控制 authority 的字段 MUST 按 safe projection 规则使 fork 安全失败。

一次成功的 fork MUST 原子产生 child session、messages、active context、fork metadata、snapshot rows 和 per-run status，并在 child session sequence domain 连续分配 snapshot sequence。任一步失败 MUST 使全部 child facts 不可见；idempotent replay MUST NOT 重复 rows 或 sequence。

**需求类别**：功能性需求

#### Scenario: Direct fork copies durable process events

- **WHEN** source copied runs 包含 durable thinking、capability 和 terminal/lifecycle events
- **THEN** child MUST 拥有对应 `FORK_SNAPSHOT` rows
- **AND** rows MUST 使用 child identities 并保持 source 相对顺序
- **AND** source live-only deltas MUST NOT 出现

#### Scenario: Source deletion does not remove child history

- **WHEN** fork 成功后 source session 被删除
- **THEN** child conversation 和 `AVAILABLE` process snapshots MUST 继续可读
- **AND** query MUST NOT 回读或探测 source

#### Scenario: Ordinary stream excludes copied history

- **WHEN** child 建立 live 或 resume stream
- **THEN** `FORK_SNAPSHOT` events MUST NOT 进入该 stream
- **AND** 只有 run-scoped event-history query MAY 读取它们；未发起该 query 时系统 MUST 不投影这些 events

#### Scenario: Snapshot copy respects resource limits

- **WHEN** durable event count 或 serialized bytes 超过 fork 服务端预算
- **THEN** fork MUST 在可见 child write 前安全拒绝
- **AND** failure MUST NOT 包含 event payload 或 reasoning

#### Scenario: Snapshot payload validation failure keeps fork atomic

- **WHEN** 任一 source event 包含无法安全复制的 source runtime ref 或损坏 payload
- **THEN** fork MUST 失败
- **AND** 系统 MUST NOT 留下任何可见 child facts

### Requirement: Copied run process availability is explicit and lineage-free

每个copied run SHALL保存exact `AVAILABLE | LEGACY_UNAVAILABLE` status，不保存source session/request/run、cutoff、lineage或payload。AVAILABLE表示child拥有完整可查询snapshot集合，集合可以为空；LEGACY_UNAVAILABLE表示历史版本没有可靠过程快照且不得猜测。

#### Scenario: New direct fork marks copied runs available
- **WHEN**从真实source runs成功完成snapshot读取和composite write
- **THEN**每个copied run MUST有AVAILABLE status
- **AND**无durable event的合法run MUST仍是AVAILABLE empty

#### Scenario: Upgrade-era fork is unavailable without guessing
- **WHEN**既有child copied run缺少status且message membership证明其属于fork prefix
- **THEN**event query MUST返回LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE
- **AND**MUST不尝试恢复source mapping

#### Scenario: Arbitrary run is not treated as legacy
- **WHEN**runId既不是同session RequestRun也不是copied prefix member
- **THEN**runtime MUST返回safe not-found
- **AND**MUST不返回legacy unavailable以泄露fork membership

### Requirement: Recursive fork copies child-owned snapshots without source lineage

Fork-of-fork SHALL把source child视为当前唯一source。AVAILABLE copied run的FORK_SNAPSHOT rows按普通durable snapshot重新映射到grandchild；source child自己的真实run events也按同一规则复制。LEGACY_UNAVAILABLE status原样传播且不阻止message fork。

#### Scenario: Available snapshot survives recursive fork
- **WHEN**用户从包含AVAILABLE copied run的child再次fork
- **THEN**grandchild MUST拥有重新生成identity和sequence的snapshot rows
- **AND**MUST不保存或读取ultimate ancestor坐标

#### Scenario: Legacy unavailability propagates narrowly
- **WHEN**递归fork prefix包含LEGACY_UNAVAILABLE run和其他AVAILABLE runs
- **THEN**grandchild MUST只把对应run标为LEGACY_UNAVAILABLE
- **AND**其他runs MUST正常复制并保持AVAILABLE

### Requirement: Fork process snapshots never participate in model context

FORK_SNAPSHOT records和process status SHALL只服务event-history facade。Context Engine、ActiveContext initialization、summary、prompt shaping、provider request和prefix cache MUST不读取它们。

#### Scenario: Child model input ignores copied thinking
- **WHEN**child拥有包含reasoning的process snapshots并首次submit
- **THEN**provider input MUST只包含child active-context messages
- **AND**MUST不包含reasoning、event payload、snapshot origin或availability status

### Requirement: 最新继承轮次可作为子会话首次操作来源

当 fork child 尚未提交 fork 后用户请求、没有 active runtime work，且 copied prefix 的最后一个完整问答轮次仍是当前最新轮次时，系统 MUST 允许该继承轮次作为 child retry 或 edit-resubmit 的输入来源。系统 MUST 仅使用 child-owned copied messages、durable fork source 和可信 child session scope 判定资格，MUST NOT 读取或控制 parent runtime facts。

该资格不改变 copied run anchor 和 `FORK_SNAPSHOT` 的只读性质。系统 MUST NOT 为 copied run anchor 补建 `RequestRun`、checkpoint、runtime-origin timeline、lane state 或 pending input；直接把 copied run anchor 当作 runtime `runId` 的 lifecycle 请求仍 MUST 以 safe not-found outcome 失败。

当 child 已提交 fork 后用户请求、存在 active runtime work、目标不是最新继承轮次，或 copied messages 无法形成一个 canonical 用户问题时，系统 MUST 拒绝 inherited retry/edit，且 MUST NOT 隐藏或修改 copied history。

**需求类别**：功能性需求

#### Scenario: 刚派生子会话可操作最新继承轮次
- **WHEN** child 尚无 fork 后用户请求和 active runtime work
- **AND** copied prefix 最后一轮包含一个 canonical 用户问题和可渲染回答
- **THEN** 系统 MUST 允许该轮作为 child retry 或 edit-resubmit 的输入来源

#### Scenario: child 已独立演进后不再使用继承资格
- **WHEN** child 已提交至少一个 fork 后用户请求
- **THEN** 系统 MUST NOT 以继承轮次资格操作 copied history
- **AND** child 的普通真实 run MUST 继续遵守既有 retry/edit 规则

#### Scenario: 较早 copied 轮次不可操作
- **WHEN** 用户对 copied prefix 中非最新的轮次发起 retry 或 edit
- **THEN** 系统 MUST 以安全 stale-latest outcome 拒绝
- **AND** 系统 MUST NOT 创建子会话运行事实或改变复制的历史

#### Scenario: copied run anchor 仍不可作为 lifecycle run
- **WHEN** lifecycle command 直接把 copied run anchor 当作 runtime `runId`
- **THEN** 系统 MUST 返回 safe not-found outcome
- **AND** MUST NOT 补建或链接 parent `RequestRun`

#### Scenario: 资格判定不读取 parent runtime
- **WHEN** 系统判定最新继承轮次的 retry/edit 资格
- **THEN** 判定 MUST 仅基于 child-owned durable facts
- **AND** parent `RequestRun`、checkpoint、timeline、lane 和 active-run 状态均不得成为判定输入

### Requirement: Replacement lineage 在递归 fork 中保持 child-owned

当 fork prefix 包含 retry 或 edit-resubmit 产生的 canonical process events 时，系统 MUST 将事件 payload 中已识别的 message、request 和 run reference 通过现有 fork ID map 重映射为新 child-owned ID。`retryOfRunId` MUST 按 run reference 处理，`editedFromRequestId` MUST 按 request reference 处理；它们不得作为未知字符串保留，也不得被删除以隐藏映射失败。

若已识别 reference 无法映射，或未知 payload 字段携带 source-bound message/request/run identity，fork MUST fail closed 且不得持久化 child session、copied messages、process snapshots 或其他部分结果。成功结果的 copied messages 和 process snapshots MUST NOT 暴露 source message/request/run ID。

**需求类别**：系统质量属性

**质量属性**：安全、可靠性/恢复

**适用范围**：该 Function

#### Scenario: retry 后 fork 重映射 previous-attempt lineage
- **GIVEN** source prefix 包含 retry attempt 和 `REQUEST_ACCEPTED.retryOfRunId`
- **WHEN** 用户从 retry 后的可见回答 fork
- **THEN** copied event 的 `retryOfRunId` MUST 指向 child copied previous attempt anchor
- **AND** MUST NOT 保留 source run ID

#### Scenario: edit 后 fork 重映射 replacement lineage
- **GIVEN** source prefix 包含 edit replacement 和 `REQUEST_ACCEPTED.editedFromRequestId`
- **WHEN** 用户从 edit 后的可见回答 fork
- **THEN** copied event 的 `editedFromRequestId` MUST 指向 child copied source request
- **AND** MUST NOT 保留 source request ID

#### Scenario: retry 和 edit 复合后仍可递归 fork
- **GIVEN** 同一 source prefix 依次发生 retry 和 edit replacement
- **WHEN** 用户从最新回答 fork，并从该 child 再次 fork
- **THEN** 每一代 copied event reference MUST 仅指向本代 child-owned IDs
- **AND** parent 和 ancestor runtime facts MUST 保持不变

#### Scenario: 未知 source-bound reference 继续 fail closed
- **WHEN** process event 的未知 payload 字段携带任一 source message/request/run ID
- **THEN** fork MUST 返回安全 payload-unsafe outcome
- **AND** MUST NOT 通过放宽字符串检查或保留 source ID 完成 fork

### Requirement: Copied message 携带继承 provenance 标记

fork SHALL 为每条 copied child message 的 `metadata` 写入 child-owned provenance 标记 `forkInherited: true`（JSON 布尔值），用于浏览器投影识别消息来自 copied prefix。标记 MUST 在 fork composite write 落库前写入 copied message 的 metadata，随既有 `messages.metadata` 持久化和 conversation response 的 `metadata` 通道透出；系统 MUST NOT 为该标记新增表、列、gateway contract 或 Web schema 字段。

标记是 child-owned provenance 事实，不是 source 坐标或操作资格事实：标记 MUST NOT 携带或编码 source session/message/request/run 的任何 id，与 source 的对应关系 MUST NOT 因此可解析。递归 fork 时 grandchild 的 copied messages MUST 按同一规则写入标记，与 source child 消息是否已携带标记无关。标记的含义 MUST 限于 copied message 来源，MUST NOT 表示 retry/edit 可用或不可用。标记 MUST NOT 进入模型上下文语义，也 MUST NOT 被后端 retry/edit/cancel 等 lifecycle 合法性判断读取；后端权威判断继续使用 child-owned durable facts。既有已派生会话的 copied messages MUST NOT 回填标记。

**需求类别**：功能性需求

#### Scenario: fork 成功写入继承标记

- **WHEN** fork 成功创建 child session
- **THEN** 每条 copied child message 的 `metadata.forkInherited` MUST 为 `true`
- **AND** 标记 MUST NOT 包含任何 source session、message、request 或 run 的 id

#### Scenario: 继承标记随 conversation 读取透出

- **WHEN** 客户端读取 child session conversation
- **THEN** copied messages 的响应项 MUST 通过既有 `metadata` 通道携带 `forkInherited: true`
- **AND** fork 后新提交的 child 自身消息 MUST NOT 携带该标记

#### Scenario: 递归 fork 重新写入标记

- **WHEN** 用户从 child session 再次 fork 生成 grandchild
- **THEN** grandchild 的全部 copied messages MUST 携带 `forkInherited: true`
- **AND** 标记 MUST NOT 编码任何祖先会话坐标

#### Scenario: 标记不表达操作资格

- **WHEN** 客户端读取携带 `metadata.forkInherited: true` 的 copied message
- **THEN** 该标记 MUST 仅表示消息来自 copied prefix
- **AND** 该标记 MUST NOT 表示 retry 或 edit 可用或不可用

### Requirement: 派生过程快照重映射消息引用

当派生会话复制的可恢复过程事件携带 `messageId` 时，系统 MUST 将该引用映射为同一派生会话中对应复制消息的新 `messageId`。派生快照 MUST NOT 保存源会话 `messageId`，也 MUST NOT 通过源会话读取消息正文。

被引用消息 MUST 位于派生锚点包含的消息前缀内，并且 MUST 与事件的请求、运行、消息类型和适用时 `toolCallId` 一致。映射后的事件与消息 MUST 使用派生会话拥有的 Owner Scope、Agent Scope、`sessionId`、`requestId` 和 `runId` 坐标。

**需求类别**：功能性需求

#### Scenario: 派生会话过程快照引用子消息

- **WHEN** 源会话锚点前缀包含一个消息引用事件及其目标消息
- **AND** 用户成功派生子会话
- **THEN** 子会话过程快照 MUST 引用对应复制消息的新 `messageId`
- **AND** 子会话事件与消息 MUST 使用一致的子会话请求和运行坐标
- **AND** 子会话快照 MUST NOT 包含源消息标识

#### Scenario: 删除源会话后过程正文仍可恢复

- **WHEN** 派生会话成功后源会话被删除
- **THEN** 子会话可用过程快照 MUST 继续从子会话消息恢复安全正文
- **AND** 系统 MUST NOT 回读或探测源会话消息

#### Scenario: 递归派生只使用当前子会话映射

- **WHEN** 用户从已有派生会话再次派生新会话
- **THEN** 新会话过程快照 MUST 从当前会话消息标识映射为新会话消息标识
- **AND** 新会话 MUST NOT 保存或恢复更早祖先会话的消息标识

### Requirement: 派生消息引用失败保持原子

当任一被复制过程事件的 `messageId` 无法映射、目标消息不在复制前缀、关联坐标不一致或 payload 包含无法安全处理的消息引用时，派生操作 MUST 在子会话可见前失败。失败后 MUST 不存在部分子会话消息、过程快照、过程可用状态或派生元数据。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复

**适用范围**：该 Function

#### Scenario: 引用目标不在复制前缀时派生失败

- **WHEN** 一个待复制过程事件引用派生锚点之后的消息
- **THEN** 派生操作 MUST 安全失败
- **AND** 系统 MUST NOT 创建可见子会话或部分过程快照

#### Scenario: 损坏引用不被静默删除

- **WHEN** 一个待复制事件包含无法识别或无法安全映射的消息引用
- **THEN** 系统 MUST 回滚该次派生的全部子会话事实
- **AND** 系统 MUST NOT 通过删除该引用后继续创建子会话

### Requirement: 派生消息引用失败诊断保持安全

当派生消息引用校验或映射失败时，系统产生的日志、metric、audit 和 SafeError MUST 只包含安全错误码、失败阶段和低基数结果，MUST NOT 包含源消息正文、原始 Tool 输入输出、reasoning、消息标识映射表或未授权归属信息。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：该 Function

#### Scenario: 失败诊断不泄露源内容

- **WHEN** 派生消息引用校验或映射失败
- **THEN** 日志、metric、audit 和 SafeError MUST 只包含安全错误码、失败阶段和低基数结果
- **AND** 日志、metric、audit 和 SafeError MUST NOT 包含源消息正文、原始 Tool 输入输出、reasoning、消息标识映射表或未授权归属信息

### Requirement: 会话派生 gateway 公开准备与原子创建入口

`SessionForkStoreGateway` MUST 公开 `prepareFork(request, signal?)` 和 `forkSession(request, signal?)`。`PrepareForkRequest` 与 `ForkSessionRequest` MUST 继承 required、non-null 的 `OwnerScoped` 字段，并包含 required、non-null 的 `agentId: AgentId`、`sourceSessionId: SessionId` 和 `idempotencyKey: IdempotencyKey`，以及 optional、non-null 的 `sourceMessageId: MessageId` 与 `sourceRequestId: MessageId`；每个请求 MUST 恰好提供两个 anchor 字段中的一个。`ForkSessionRequest` MUST 额外包含 required、non-null、opaque 的 `forkAttemptId: ForkAttemptId`。`signal` MUST 是不进入持久化或 wire payload 的 optional `AbortSignal` 第二参数。

`PrepareForkResult` MUST 包含 required、non-null 的 `forkAttemptId: ForkAttemptId`、`maxPromotedBytes: number` 和 `requiredContentRefs`。`ForkAttemptId` MUST 是长度为1至128字符的opaque branded scalar；尚未命中成功幂等锚点时，每次成功`prepareFork` MUST返回一个在相同owner scope与Agent Scope内未用于其他attempt的新值。`maxPromotedBytes` MUST 是以bytes计量的非负整数。`requiredContentRefs` 的数量 MUST 不超过服务端 promotion ref budget；每项 MUST 且只能包含 `sourceMessageId: MessageId`、`sourceRequestId: MessageId`、`sourceRunId: RequestRunId`、`agentVersion: AgentVersion`、`refType: 'CAPABILITY_RESULT'` 和 `refId: string`，其中规范化`refId`长度 MUST 为1至512字符。清单 MUST 按source message canonical顺序排列，同一message内去重后的refs MUST 按规范化`refId`升序排列。这些字段 MUST 来自同一可信 source prefix 与 terminal source run，MUST NOT 包含 content bytes、host path、workspace path、child ids、provider credential 或完整 WorkingMemory record。`prepareFork` MUST NOT 创建可见 child session或成功幂等锚点；已命中成功幂等锚点时它 MUST 返回空 `requiredContentRefs`，随后相同坐标的 `forkSession` MUST 返回首次 child。

`ForkSessionResult` MUST 只表示成功结果，并包含 required、non-null 的 `childSession: SessionRecord` 和 `replayed: boolean`。`forkSession` MUST 重新校验 source 坐标、最终 message anchor和完整prefix，重新推导全部required refs，并与同一`forkAttemptId`的staged refs精确匹配；未完整stage、额外stage或source ref绑定不一致 MUST 在child可见前失败。没有required refs时，matching staged ref集合 MUST为空。`forkSession` MUST NOT 接收 copied messages、active context refs、timeline drafts、promotion bytes、refMappings 或预构造 child records。

`SessionForkStoreGateway` 的公共成员集合 MUST 恰好为 `prepareFork`、`stageForkPromotion`、`forkSession`、`abortForkPromotions`、`loadSessionForkSource`、`loadForkProcessSnapshotStatus`、`hasUserMessageAfterForkAnchor`、`loadCommittedForkPromotionContent` 和 `cleanupExpiredForkPromotions`。全部成员 MUST 接收 optional、非 wire 的 `AbortSignal` 最后参数。`StageForkPromotionRequest` MUST 继承required、non-null的`OwnerScoped`字段，并且 MUST 且只能包含`agentId: AgentId`、`forkAttemptId: ForkAttemptId`、`sourceSessionId: SessionId`、`sourceMessageId: MessageId`、`sourceRefId: string`、`refType: 'CAPABILITY_RESULT'`、`bytes: Uint8Array`、`mimeType: string`和`sizeBytes: number`；`sourceRefId` MUST与prepare清单中的规范化`refId`相同，`mimeType`长度 MUST为1至256字符，`sizeBytes` MUST是非负整数并等于实际bytes长度。`StageForkPromotionResult` MUST 且只能包含`forkAttemptId: ForkAttemptId`、`sourceMessageId: MessageId`、`sourceRefId: string`和provider生成的`promotedContentId: string`；`promotedContentId`长度 MUST为1至512字符。相同owner scope、Agent Scope、fork attempt、source message和source ref的重复stage在bytes、MIME type与size都相同时 MUST 返回首次`promotedContentId`，MUST NOT重复写入content；任一值不同时 MUST reject promotion conflict。stage request/result MUST NOT包含caller-supplied child session/message ids、status、timestamp或`BlobRef`。`ForkPromotionAbortRequest` MUST继承required、non-null的`OwnerScoped`字段，并且 MUST 且只能包含`agentId: AgentId`与`forkAttemptId: ForkAttemptId`；`abortForkPromotions` MUST 只收敛 matching attempt 的不可见 staged residue。系统 MUST NOT 公开要求调用方取得完整源前缀、预构造 child records 或批量过程快照的创建操作。

REMOTE contract adapter MUST 对 `PrepareForkRequest`、`PrepareForkResult`、promotion stage request/result、`ForkSessionRequest` 和 `ForkSessionResult` 执行 strict runtime schema validation，并 MUST 拒绝未知字段、同时携带两个 anchor 字段、两个字段都缺失、任一字段为 null、非法 attempt/ref 绑定以及不符合既有长度约束的 `idempotencyKey`。

当请求提供 `sourceRequestId` 时，系统 MUST 在 `prepareFork` 与 `forkSession` 中把该 request id 唯一解析为符合 fork 资格的同一持久化 assistant message，并以解析后的 message anchor 执行准备、派生和建立幂等坐标。解析失败、尚未完成或存在多个候选时，系统 MUST reject 对应 `AgentError` 且 MUST NOT 创建 child session。

**需求类别**：功能性需求

#### Scenario: 消息锚点先准备再原子派生

- **WHEN** 调用方使用可信 scope、源会话、`sourceMessageId` 和规范化幂等键调用 `prepareFork`
- **THEN** 系统 MUST 返回 opaque `forkAttemptId` 和有界 `requiredContentRefs`
- **AND** 调用方完成清单内必要 staging 后使用同一坐标和attempt调用`forkSession`
- **AND** `forkSession` MUST 返回包含已提交 `childSession` 和 `replayed` 的 `ForkSessionResult`

#### Scenario: 请求锚点在准备与创建操作内一致解析

- **WHEN** 调用方使用 `sourceRequestId` 依次调用 `prepareFork` 和 `forkSession`
- **AND** 该 request 恰好对应一个符合 fork 资格的持久化 assistant message
- **THEN** 系统 MUST 从该 assistant message 派生 child session
- **AND** 幂等重放 MUST 使用最终解析出的 message anchor

#### Scenario: 非法锚点字段组合被拒绝

- **WHEN** 任一prepare或fork wire请求同时携带`sourceMessageId`与`sourceRequestId`、两者都未携带、任一字段为null或包含未知字段
- **THEN** wire adapter MUST 在执行派生前拒绝请求
- **AND** 系统 MUST NOT 创建 child session 或任何派生持久化事实

#### Scenario: 创建后读取继续使用保留成员

- **WHEN** 会话读取、过程历史恢复、模型上下文内容解析或维护任务访问已经提交的 fork facts
- **THEN** 它们 MUST 分别通过保留的窄读取或维护成员获得既有结果
- **AND** 它们 MUST NOT 通过已移除的prefix/composite操作回读完整源前缀或预构造child records

#### Scenario: Prepare 清单驱动既有 promotion staging

- **WHEN** `prepareFork` 返回一个或多个规范化 tool-result refs
- **THEN** 调用方 MUST 只解析清单中的 refs，并按同一 `forkAttemptId` 与 source ref 坐标调用 `stageForkPromotion`
- **AND** stage request MUST NOT 携带 child ids、source path、完整 prefix 或 caller-supplied promoted content id
- **AND** 全部 required refs 完成 staging 后，调用方 MUST 通过 `forkSession` 完成唯一最终提交

#### Scenario: Stage 只接受可信 source ref 与一致 bytes

- **WHEN** `stageForkPromotion`收到跨scope source message、source message中不存在的`sourceRefId`、非规范化ref或与实际bytes长度不同的`sizeBytes`
- **THEN** stage MUST reject canonical `AgentError`
- **AND** 该调用 MUST NOT产生可解析content、可见child fact或可提交promotion binding

#### Scenario: Stage response 丢失可按 source ref 幂等恢复

- **WHEN** 首次stage已成功但response未送达，调用方以相同scope、attempt、source message/ref、bytes、MIME type与size重试
- **THEN** `stageForkPromotion` MUST返回首次生成的`promotedContentId`
- **AND** 系统 MUST NOT创建第二份staged content或第二个promotion binding
- **AND** 重试内容、MIME type或size任一不同时 MUST reject `SESSION_FORK_PROMOTION_CONFLICT / CONFLICT / false`

#### Scenario: 无需 promotion 的准备结果直接进入 fork

- **WHEN** eligible完整prefix不包含需要NextAgent解析的refs
- **THEN** `prepareFork` MUST返回空`requiredContentRefs`
- **AND** 调用方 MUST NOT调用`stageForkPromotion`
- **AND** 调用方 MUST使用返回的`forkAttemptId`直接调用`forkSession`

### Requirement: 会话派生 Runtime facade 保持可信窄入口

`RuntimeSessionPort` MUST 继续在 `agent-contracts/runtime` 公开 `forkFromMessage(command, signal?)` 和 `forkFromRequest(command, signal?)`。`RuntimeForkSessionFromMessageCommand` MUST 且只能包含 trusted `IdentityContext`、`sourceSessionId`、`sourceAnchorMessageId` 和 `idempotencyKey`；`RuntimeForkSessionFromRequestCommand` MUST 且只能包含 trusted `IdentityContext`、`sourceSessionId`、`sourceRequestId` 和 `idempotencyKey`；两种方法 MUST resolve 只包含 `childSession: UserSession` 的既有 `ForkSessionFromMessageResult`。optional `signal` MUST 是不进入 command、Web body、provider wire payload或持久化事实的第二参数。

Web channel MUST 通过上述 Runtime-owned 方法接受既有 message/request fork API，并从认证边界取得 `IdentityContext`。客户端 MUST NOT 提供或覆盖 owner scope、Agent Scope、child session/message/request/run ids、fork source metadata、source run id、copied messages、active-context refs、timeline/checkpoint refs、fork attempt 或 promotion bytes。Runtime MUST 先用 trusted identity require source session 并取得该 session 已绑定的 Agent Scope，再把 message/request anchor 与规范化幂等键委托给选定的 `prepareFork`；它 MUST 只解析返回清单中的规范化 refs并stage对应bytes，随后使用同一source坐标、幂等键和fork attempt调用`forkSession`。Runtime MUST NOT 按 LOCAL/REMOTE 部署模式改变 command、结果或调用路径。

对于 request fork，Runtime MUST 保留 `sourceRequestId` 作为独立 request anchor进行委托；最终 durable assistant message anchor 的唯一解析 MUST 在 `prepareFork` 与 `forkSession` 内一致完成。Runtime MUST NOT 预读完整 source prefix、WorkingMemory messages/events/requests/runs、预构造 child facts，或把 request anchor 转换成另一套 public message-fork 调用。Runtime只可通过既有`ForkPromotionContentResolverPort`解析`prepareFork`返回的required refs，MUST NOT解析清单外ref或任意host/workspace path。Web request abort MUST 通过相同 optional `signal` 传播到 Runtime、resolver、stage与`forkSession`，并遵守“Fork Failure Is Atomic And Safe”的取消与幂等恢复语义。

**需求类别**：功能性需求

#### Scenario: Web 消息派生调用 Runtime-owned 窄命令

- **WHEN** Web channel 接受既有 message fork request
- **THEN** 它 MUST 调用 `RuntimeSessionPort.forkFromMessage(command, signal?)`
- **AND** command MUST 只携带 trusted identity、source session id、source anchor message id 和 idempotency key
- **AND** 成功响应 MUST 继续只投影 result 中的 child session 公共元数据

#### Scenario: Web 请求派生保留 request anchor

- **WHEN** Web channel 接受既有 request fork request
- **THEN** 它 MUST 调用 `RuntimeSessionPort.forkFromRequest(command, signal?)`
- **AND** command MUST 只携带 trusted identity、source session id、source request id 和 idempotency key
- **AND** prepare/fork request MUST NOT 携带 source run id、client-generated child ids、copied messages、fork source metadata、timeline refs、checkpoint refs 或 promotion bytes
- **AND** 最终 message anchor MUST 由 `prepareFork` 与 `forkSession` 一致解析

#### Scenario: 客户端不能覆盖可信派生身份或 child ids

- **WHEN** Web request body 尝试提供 owner scope、Agent Scope、child ids 或内部 fork metadata
- **THEN** channel schema MUST 在调用 Runtime 前拒绝未知字段
- **AND** Runtime MUST 只使用认证 identity 与 persisted source session 的 Agent Scope
- **AND** 系统 MUST NOT 创建使用客户端所给内部坐标的 child facts

#### Scenario: 取消信号端到端传播但不进入 payload

- **WHEN** Web fork request 在派生完成前 abort
- **THEN** channel MUST 把对应 signal 作为独立参数传播给 Runtime-owned 方法、`prepareFork`、resolver、stage和`forkSession`
- **AND** command、provider request、持久化事实和 public response MUST NOT 包含该 signal
- **AND** 系统 MUST 按最终提交边界返回取消或通过相同幂等键恢复已提交结果

### Requirement: 会话派生失败使用唯一安全错误契约

`forkSession` MUST 仅在派生成功或成功幂等重放时 resolve `ForkSessionResult`。`prepareFork`、promotion staging、`forkSession` 或abort中的任何validation、not-found、conflict、capacity、cancellation、unavailable或internal failure MUST 使对应Promise reject一个`AgentError`；该错误的安全投影 MUST 是`SafeError`。系统 MUST NOT 通过`ForkSessionResult` error字段、success/error union、raw provider exception或deployment-specific result表达失败。REMOTE adapter收到远端失败envelope时 MUST 先按strict `SafeError` schema校验；合法字段集合必须且只能是required `code`、`message`、`category`、`retryable`与optional `safeDetails`，任何`stack`、`endpoint`、`cause`或其他未知字段 MUST 使整个envelope被视为非法响应。已知code携带的`category`和`retryable` MUST 与下表tuple精确匹配，否则整个envelope同样 MUST 被视为非法响应。对于schema与tuple都合法的envelope，adapter MUST 丢弃provider-supplied `message`和全部provider-supplied `safeDetails`，并重建具有相同canonical `code`、`category`和`retryable`的`AgentError`。

所有下表错误在该会话派生边界的 canonical public message MUST 精确为 `Session fork failed.`。该固定文案由 NextAgent contract adapter 生成，不由 LOCAL/REMOTE provider 选择；raw transport exception 的 message、stack、endpoint 和 cause MUST 被丢弃且不得进入该文案、`safeDetails` 或其他安全投影。

下表是 session fork 边界的权威失败映射；同一可观察条件 MUST 使用表中的唯一 tuple。合法 REMOTE envelope 携带未知 code 或 envelope/schema 非法时 MUST 使用表中的 `SESSION_FORK_PROVIDER_INVALID_RESPONSE`；表中未列出的 LOCAL/internal 异常 MUST 归一化为 `SESSION_FORK_INTERNAL / INTERNAL / true`，不得透传原始 code 或内容。

| 可观察条件 | `SafeError.code` | `category` | `retryable` |
|---|---|---|---|
| wire/request schema 非法、unknown field、锚点字段组合非法或幂等键超过既有长度上限 | `SESSION_FORK_REQUEST_INVALID` | `VALIDATION` | `false` |
| 幂等键缺失或 trim 后为空 | `SESSION_FORK_IDEMPOTENCY_REQUIRED` | `VALIDATION` | `false` |
| source session 不存在或 owner/agent scope 不匹配 | `SESSION_NOT_FOUND` | `NOT_FOUND` | `false` |
| MESSAGE anchor 不存在或不属于同一可信 scope/session | `SESSION_FORK_ANCHOR_NOT_FOUND` | `NOT_FOUND` | `false` |
| MESSAGE anchor hidden、非 assistant 或内容为空 | `SESSION_FORK_ANCHOR_NOT_ELIGIBLE` | `VALIDATION` | `false` |
| REQUEST anchor 没有 completed durable assistant candidate | `SESSION_FORK_REQUEST_ANCHOR_NOT_FOUND` | `NOT_FOUND` | `false` |
| REQUEST anchor 有多个 completed durable assistant candidates | `SESSION_FORK_REQUEST_ANCHOR_AMBIGUOUS` | `CONFLICT` | `false` |
| source anchor 绑定尚未 terminal 的 run | `SESSION_FORK_SOURCE_RUN_NOT_TERMINAL` | `CONFLICT` | `true` |
| copied message count 超限 | `SESSION_FORK_PREFIX_TOO_LARGE` | `VALIDATION` | `false` |
| copied content bytes 超限 | `SESSION_FORK_PREFIX_CONTENT_TOO_LARGE` | `VALIDATION` | `false` |
| promotion ref count 超限 | `SESSION_FORK_PROMOTION_LIMIT_EXCEEDED` | `VALIDATION` | `false` |
| promoted bytes 超限 | `SESSION_FORK_PROMOTED_CONTENT_TOO_LARGE` | `VALIDATION` | `false` |
| copied timeline event count 超限 | `SESSION_FORK_EVENT_LIMIT_EXCEEDED` | `VALIDATION` | `false` |
| copied timeline serialized bytes 超限 | `SESSION_FORK_EVENT_BYTES_EXCEEDED` | `VALIDATION` | `false` |
| source content/metadata 保留 source run ref | `SESSION_FORK_SOURCE_RUN_REF` | `VALIDATION` | `false` |
| metadata 含禁止的 runtime-only key/value | `SESSION_FORK_RUNTIME_METADATA` | `VALIDATION` | `false` |
| metadata projection 结果或 typed ref 无效 | `SESSION_FORK_METADATA_INVALID` | `VALIDATION` | `false` |
| source content 含source workspace/host path、未知或不受支持的execution-bound ref | `SESSION_FORK_EXECUTION_BOUND_CONTENT` | `VALIDATION` | `false` |
| source metadata 含source workspace/host path、未知或不受支持的execution-bound ref | `SESSION_FORK_EXECUTION_BOUND_METADATA` | `VALIDATION` | `false` |
| 规范化tool-result ref缺少可信resolver、required ref未完整stage、存在清单外stage或attempt/source ref绑定不一致 | `SESSION_FORK_PROMOTION_UNAVAILABLE` | `VALIDATION` | `false` |
| 可信resolver无法取得prepare清单中规范化tool-result ref的内容，或stage的source message/ref无法在同一可信source session中验证 | `SESSION_FORK_PROMOTION_SOURCE_UNAVAILABLE` | `VALIDATION` | `false` |
| 相同attempt与source ref已stage但重试的bytes、MIME type或size不一致 | `SESSION_FORK_PROMOTION_CONFLICT` | `CONFLICT` | `false` |
| source prefix 为空 | `SESSION_FORK_EMPTY_PREFIX` | `VALIDATION` | `false` |
| 已进入 materialization 的 source/child plan scope 不一致 | `SESSION_FORK_SCOPE_MISMATCH` | `VALIDATION` | `false` |
| source prefix message 与可信 owner/agent/session scope 不一致 | `SESSION_FORK_MESSAGE_SCOPE_MISMATCH` | `VALIDATION` | `false` |
| provider 生成重复 child message id | `SESSION_FORK_DUPLICATE_CHILD_MESSAGE` | `VALIDATION` | `false` |
| child anchor 不在 copied child prefix | `SESSION_FORK_CHILD_ANCHOR_NOT_COPIED` | `VALIDATION` | `false` |
| active-context ref 不在 copied child prefix | `SESSION_FORK_ACTIVE_CONTEXT_REF_NOT_COPIED` | `VALIDATION` | `false` |
| selector 输出非法 child refs | `SESSION_FORK_ACTIVE_CONTEXT_INVALID` | `INTERNAL` | `false` |
| provider 无法重映射已校验 anchor | `SESSION_FORK_ANCHOR_REMAP_FAILED` | `INTERNAL` | `false` |
| process source run/status 与可信 scope 不一致 | `SESSION_FORK_EVENT_SCOPE_MISMATCH` | `VALIDATION` | `false` |
| source process status shape/binding 无效 | `SESSION_FORK_PROCESS_STATUS_INVALID` | `VALIDATION` | `false` |
| provider 生成的 timeline snapshot invariant 无效 | `SESSION_FORK_TIMELINE_SNAPSHOT_INVALID` | `VALIDATION` | `false` |
| source event-history record/cursor 损坏 | `SESSION_EVENT_HISTORY_RECORD_INVALID` | `VALIDATION` | `false` |
| timeline payload 携带未知 source identity/control ref | `SESSION_FORK_EVENT_PAYLOAD_UNSAFE` | `VALIDATION` | `false` |
| process event 的 message/tool 关联损坏 | `SESSION_FORK_PROCESS_MESSAGE_REFERENCE_INVALID` | `VALIDATION` | `false` |
| process source run 不存在 | `SESSION_FORK_SOURCE_RUN_NOT_FOUND` | `VALIDATION` | `false` |
| child request/run/message identity 无法重映射 | `SESSION_FORK_EVENT_REMAP_FAILED` | `VALIDATION` | `false` |
| 成功幂等锚点指向损坏或缺失的 child facts | `SESSION_FORK_IDEMPOTENCY_CORRUPT` | `INTERNAL` | `true` |
| selected provider/binding/storage/network 在 ready、dispatch 或 operation 时不可用，或发生未取得 provider outcome 且明确不属于 caller cancellation、timeout、credential rejection 的可安全重试 persistence/transport failure | `SESSION_FORK_UNAVAILABLE` | `UNAVAILABLE` | `true` |
| 最终原子提交开始前观察到 cancellation | `SESSION_FORK_CANCELED` | `CANCELED` | `false` |
| 非 caller cancellation 的 provider/persistence/transport deadline expiry 或 timeout | `SESSION_FORK_TIMEOUT` | `TIMEOUT` | `true` |
| REMOTE service 拒绝 provider credential/authorization | `SESSION_FORK_PROVIDER_UNAUTHORIZED` | `AUTHORIZATION` | `false` |
| REMOTE success/failure envelope schema 非法、携带未知 fork code，或已知 code 的 category/retryable 与目录不匹配 | `SESSION_FORK_PROVIDER_INVALID_RESPONSE` | `UNAVAILABLE` | `false` |
| 其他未分类且已安全归一化的内部失败 | `SESSION_FORK_INTERNAL` | `INTERNAL` | `true` |

当一次调用同时满足多个失败条件时，系统 MUST 只返回下列确定性顺序中最先被命中的条件：① idempotencyKey missing/trim-empty；② 其他strict request/schema failure；③ dispatch前caller cancellation；④ source session/scope；⑤ anchor resolution/eligibility；⑥ 已提交成功幂等锚点；⑦ source run terminal状态；⑧完整prefix integrity、ref count与容量预算；⑨ safe projection与ref分类；⑩ prepare manifest、resolver与stage绑定；⑪ process history validation/remap；⑫ active-context selection；⑬ final atomic commit。相同阶段存在多个条件时 MUST 使用上表从上到下的第一个匹配项。有效请求dispatch后如果在取得provider outcome前发生network/timeout，则只可能观察`SESSION_FORK_UNAVAILABLE`或`SESSION_FORK_TIMEOUT`；明确deadline expiry MUST 使用timeout。收到outcome后再执行REMOTE envelope validation，非法envelope优先归一化为`SESSION_FORK_PROVIDER_INVALID_RESPONSE`。优先级固定为caller cancellation > timeout > generic unavailable，provider credential rejection > generic unavailable。

**需求类别**：功能性需求

#### Scenario: 成功结果不承载失败 union

- **WHEN** `forkSession` 成功创建或命中已提交幂等锚点
- **THEN** Promise MUST resolve `ForkSessionResult`
- **AND** result MUST NOT 包含 `error`、`safeError` 或 provider-native failure 字段

#### Scenario: 安全失败通过 Promise rejection 传递

- **WHEN** prepare、stage、fork或abort遇到本Requirement表中任一失败条件
- **THEN** Promise MUST reject `AgentError`
- **AND** 其 `code`、`category` 和 `retryable` MUST 精确匹配权威映射
- **AND** LOCAL 与 REMOTE MUST NOT 使用不同的失败 result shape

#### Scenario: REMOTE failure 被安全归一化

- **WHEN** REMOTE AgentMemory 返回合法的 fork failure envelope
- **THEN** adapter MUST 丢弃 provider-supplied message 和全部 provider-supplied `safeDetails`
- **AND** adapter MUST 使用固定 message `Session fork failed.` 及相同的 `code`、`category`、`retryable` reject `AgentError`
- **AND** 非法 success/failure envelope、未知 remote fork code，或已知 code 的非 canonical category/retryable MUST 归一化为 `SESSION_FORK_PROVIDER_INVALID_RESPONSE / UNAVAILABLE / false`

#### Scenario: REMOTE 已知 code 不能篡改错误 tuple

- **WHEN** REMOTE failure envelope 使用权威目录中的 code，但携带不同的 category 或 retryable
- **THEN** adapter MUST NOT 接受或修补该 provider tuple
- **AND** adapter MUST reject `SESSION_FORK_PROVIDER_INVALID_RESPONSE / UNAVAILABLE / false`
- **AND** 任意 provider-supplied `safeDetails` MUST NOT 进入重建后的 `AgentError`、日志、trace、metric 或 public response

#### Scenario: REMOTE diagnostic 字段使 failure envelope 非法

- **WHEN** REMOTE failure envelope 在 strict `SafeError` 字段之外携带 `stack`、`endpoint`、`cause` 或任意其他字段
- **THEN** adapter MUST 把整个 envelope 归一化为 `SESSION_FORK_PROVIDER_INVALID_RESPONSE / UNAVAILABLE / false`
- **AND** adapter MUST NOT 先删除未知字段再接受原 provider tuple
- **AND** raw diagnostic value MUST NOT 进入重建后的 `AgentError`、日志、trace、metric 或 public response

#### Scenario: Transport timeout 不降级为 generic unavailable

- **WHEN** 非 caller cancellation 的 provider、persistence 或 transport deadline 明确到期且尚未取得 provider outcome
- **THEN** adapter MUST reject `SESSION_FORK_TIMEOUT / TIMEOUT / true`
- **AND** adapter MUST NOT 将该条件映射为 `SESSION_FORK_UNAVAILABLE`

### Requirement: 会话派生跨 provider 边界使用有界协调材料

`PrepareForkRequest`、`ForkSessionRequest`和`ForkSessionResult`的编码大小 MUST 只受其固定标量字段既有长度上限约束，并 MUST NOT 随源会话message数量、message content bytes或过程事件数量增长。promotion ref budget MUST 对完整prefix的content与metadata中每个规范化tool-result ref出现次数计数，包括重复出现；`PrepareForkResult.requiredContentRefs` MUST 按`sourceMessageId + normalized refId`去重，且数量 MUST 不超过该budget。result MUST NOT包含source content bytes、完整messages、events或预构造child facts。`stageForkPromotion`传输的bytes总量 MUST 不超过同一prepare result声明且由provider重新校验的`maxPromotedBytes`。Working Memory provider MUST 在其持有源事实的边界内读取从源session开头到最终message anchor的完整canonical durable prefix，并 MUST 以该完整prefix作为派生输入。NextAgent MUST NOT 通过public gateway分页取得该prefix。

当完整prefix、safe child projection、process snapshot、promotion ref count或promoted bytes超过服务端派生预算时，系统 MUST 在child session可见前按超限维度reject权威错误映射中的对应capacity code，并且 MUST NOT创建child session。只有prepare清单中的规范化execution-bound refs MAY 作为受预算约束的promotion bytes传输；source path、完整prefix或清单外bytes MUST NOT传输。

**需求类别**：系统质量属性

**质量属性**：性能/容量
**适用范围**：该 Function

#### Scenario: 长会话不扩大非内容 gateway 请求

- **WHEN** 两个fork请求的可信坐标字段长度相同但源会话分别包含不同数量的历史messages和过程事件
- **THEN** 两个`PrepareForkRequest`与两个`ForkSessionRequest`的字段集合和编码大小上界 MUST 相同
- **AND** 任一请求 MUST NOT包含源messages、过程事件或其他WorkingMemory records

#### Scenario: Ref 协调材料受独立预算约束

- **WHEN** source prefix包含可promotion的规范化tool-result refs
- **THEN** `PrepareForkResult.requiredContentRefs`数量 MUST 不超过服务端ref budget
- **AND** stage bytes总量 MUST 不超过`maxPromotedBytes`
- **AND** 任一stage request MUST NOT包含完整prefix、source path或清单外内容

#### Scenario: 完整前缀在服务端超出预算

- **WHEN** 从源 session 开头到最终 message anchor 的完整前缀超过服务端派生预算
- **THEN** `forkSession` MUST 在 child session 可见前按超限维度 reject 对应 canonical capacity `AgentError`
- **AND** 系统 MUST NOT 创建 child session

### Requirement: LOCAL 与 REMOTE 会话派生保持契约一致

LOCAL 和 REMOTE 部署 MUST 实现同一个 `SessionForkStoreGateway` contract。对于具有相同可信 scope、源会话事实、anchor、幂等键、派生预算和resolver fixture的conformance fixture，两种部署的`prepareFork` MUST 返回语义相同且顺序相同的required refs与相同预算；opaque forkAttemptId只用于各自后续stage/fork，不跨provider比较。调用方按相同ref内容stage后，两种部署 MUST 得到相同的成功或失败结果类别和相同的`replayed`语义。成功结果 MUST 经过以下唯一规范化后比较：对provider生成的child `sessionId`、`messageId`、`requestId`、`runId`、`eventId`和`promotedContentId`分别建立一一对应的alpha-renaming，并把全部引用位置应用同一映射；只忽略child session和fork source中由provider clock生成的`createdAt`、`updatedAt`和`lastActivityAt`。除此之外，规范化后的child messages、active-context ordinals与refs、fork source title/anchors、process status、process snapshot type/payload/order/refs、child message中的promoted refs，以及通过`loadCommittedForkPromotionContent`读取的MIME type、size和bytes MUST 相同。系统 MUST NOT读取或比较provider-private storage metadata，不得忽略其他字段。

失败结果 MUST 在 provider error normalization 后使用“会话派生失败使用唯一安全错误契约”定义的相同 `SafeError.code`、`category` 和 `retryable`；provider-native message、stack、endpoint、cause 和 provider-supplied `safeDetails` MUST 不进入比较输入或对外结果。Runtime MUST NOT 按 deployment mode 改变 fork request schema、结果 schema、完整前缀语义或失败规则。

**需求类别**：系统质量属性

**质量属性**：可测试性
**适用范围**：该 Function

#### Scenario: LOCAL 与 REMOTE 对 prepare 与成功 fixture 结构等价

- **WHEN** LOCAL和REMOTE对同一组合法message/request anchor及规范化tool-result fixtures执行`prepareFork`、stage和`forkSession`
- **THEN** 两种部署 MUST 返回语义相同且顺序相同的required refs与相同promotion预算
- **AND** opaque forkAttemptId MUST 只在各自provider调用链内使用
- **AND** 两种部署 MUST 返回相同成功类别和 `replayed` 语义
- **AND** 按本 Requirement 定义的 alpha-renaming 和 provider-clock 字段忽略规则规范化后，child messages、active context、fork source、process status、process snapshots、promoted refs 和 committed content bytes MUST 相同
- **AND** 所有 child-owned refs MUST 在两种结果中保持相同引用关系和相对顺序

#### Scenario: LOCAL 与 REMOTE 对失败 fixture 一致

- **WHEN** LOCAL和REMOTE对跨scope anchor、模糊request anchor、超预算prefix、resolver缺失、staging不完整、unsupported execution-bound ref、损坏引用或取消fixture执行prepare/stage/fork流程
- **THEN** 两种部署 MUST reject 具有相同 canonical `SafeError.code`、`category` 和 `retryable` 的 `AgentError`
- **AND** 两种部署 MUST 都不留下可见的部分 child session

### Requirement: 会话派生来源元数据保持窄化

系统 MUST 为每个成功派生的 child session 保存且只保存一个 owner+agent scoped fork source fact。该 fact MUST 包含 child session id、source session id、最终解析出的 source anchor message id、copied prefix 中对应的 child anchor message id、source session title snapshot 和 created timestamp。source session title snapshot MUST 使用派生时 source session 当前 title 的 trim 结果；title 缺失或 trim 后为空时 MUST 使用 `Untitled session`。系统 MUST NOT 使用 Web `displayTitle` alias 生成该快照。

fork source fact MUST NOT 包含 raw prompt、raw provider error、stream delta、完整 copied content、parent active context snapshot、timeline event、checkpoint payload、pending input payload、tool state、source request-to-message candidates、provider endpoint 或 credential。系统 MUST NOT 把该内部 fact 直接作为 public DTO 返回；public fork notice MUST 继续只投影既有窄字段。

**需求类别**：功能性需求

#### Scenario: 成功派生保存最小来源事实

- **WHEN** `forkSession` 原子提交一个 child session
- **THEN** 系统 MUST 保存一个与该 child session 绑定的 fork source fact
- **AND** 该 fact MUST 包含 source session id、最终 source anchor message id、child anchor message id、source title snapshot、trusted owner scope、Agent Scope 和 created timestamp
- **AND** 该 fact MUST NOT 包含 copied message content、过程事件 payload 或 source execution path

#### Scenario: 请求锚点只保存最终消息锚点

- **WHEN** `sourceRequestId` 被唯一解析并成功派生
- **THEN** fork source fact MUST 保存最终解析出的 source assistant message id
- **AND** 它 MUST NOT 把 request candidate 集合或 source request id 作为第二套 lineage 坐标保存

#### Scenario: 来源事实不直接进入 Web DTO

- **WHEN** Web channel 投影 child session 或 conversation
- **THEN** 系统 MUST NOT 直接返回 fork source fact
- **AND** public fork notice MUST NOT 包含 source anchor message id、child anchor message id、created timestamp、idempotency key 或 gateway metadata
