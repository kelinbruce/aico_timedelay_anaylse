## ADDED Requirements

### Requirement: 浏览器历史按可见 turn run 加载 process event

TS frontend SHALL 由可见消息页与每个可见 turn 的展示 run 的已持久化 event 页组合出已完成的会话。对每个 root turn，frontend MUST 优先使用最新可见 assistant 消息的 `runId`；当不存在可见 assistant 消息时，MUST 使用该 root 下最新可见的非 summary 消息 `runId`。对于每个被选中的不同 run，每个活动 load version 内 MUST 至多查询一次。当 message 派生 envelope 缺少 canonical `requestContextId` 但携带所选的显式 `runId` 时，该 `runId` MUST 与 event-history envelope 标识同一 attempt 以供组合；requestId 回退 MUST NOT 丢弃所选 run 的 event。带有其他 `runId` 的 event MUST NOT 进入该 turn。

#### Scenario: 冷历史重建已完成的 thinking 过程
- **WHEN** 会话消息页包含带 `runId` 的可见 assistant 消息
- **AND** 该 run event history 包含已完成的 thinking delta 和已持久化的 capability 生命周期 event
- **THEN** frontend MUST 把这些 event envelope 与同一 root turn 的 message 派生 envelope 组合
- **AND** process panel MUST 包含与已完成的实时视图相同的已完成 thinking 文本和已持久化的 process 顺序
- **AND** 最终回答 MUST 仍然只来自 assistant 消息

#### Scenario: 消息历史缺少 canonical request context
- **WHEN** 可见的 user 和 assistant 消息携带所选 `runId` 但未暴露 `requestContextId`
- **AND** 所选 run 的 event 页携带其 canonical `requestContextId` 和同一显式 `runId`
- **THEN** frontend MUST 把 message 派生的回答和 event 派生的 process 保持在同一可见 attempt 中
- **AND** MUST NOT 因 message adapter 回退到 `requestId` 而丢弃已完成的 thinking

#### Scenario: 重试历史选择可见 attempt
- **WHEN** 一个 root turn 既有旧 attempt 的 event，又有来自较新重试 run 的可见 assistant 消息
- **THEN** 自动历史 hydration MUST 查询较新的可见 `runId`
- **AND** MUST NOT 把旧 attempt 的 event 加入该 turn

#### Scenario: 无 assistant 的失败 turn 使用其可见 run
- **WHEN** 一个可见的失败 turn 没有 assistant 消息，但其可见非 summary 消息包含 `runId`
- **THEN** frontend MUST 使用该 run 加载已持久化的失败 process
- **AND** MUST NOT 虚构 assistant 回答

#### Scenario: Capability 生命周期连接持久结果内容
- **WHEN** 所选 run 的 event 页包含 capability 生命周期 envelope，且可见消息页包含匹配的 `CAPABILITY_RESULT` 消息
- **THEN** process entry MUST 保留来自 event history 的 event 顺序和终态
- **AND** MUST 只将消息内容用于匹配 run 和 tool 关联
- **AND** MUST NOT 创建重复的 tool 卡片

#### Scenario: Capability 结果消息缺失
- **WHEN** 一个 capability 终态 event 没有匹配的可见 `CAPABILITY_RESULT` 消息
- **THEN** process entry MUST 显示安全的结果不可用状态
- **AND** MUST NOT 把终态状态文本呈现为 capability 结果正文

### Requirement: Event history 分页完整且有界

对一个所选 run，TS frontend SHALL 请求 `GET /api/v1/sessions/:sessionId/runs/:runId/events`（带 `afterSequence=0` 和 `limit=1000`），然后跟随每个严格递增的 `nextAfterSequence` 直到游标缺失。MUST 把重复或不递增的游标判定为 process 加载失败。在同一个 session 内，frontend MUST 同时保持不超过四个在途的 run event 请求。

#### Scenario: Run process 跨越多个页
- **WHEN** 一个 AVAILABLE 的 event 响应包含 `nextAfterSequence`
- **THEN** frontend MUST 使用该精确游标请求下一页
- **AND** MUST 按 canonical 顺序合并所有页且没有重复 `eventId`
- **AND** MUST 只在 `nextAfterSequence` 缺失时停止

#### Scenario: 游标不递增
- **WHEN** 一个 run event 响应重复或减小 `nextAfterSequence`
- **THEN** frontend MUST 停止分页
- **AND** MUST 把该 run process history 标记为失败
- **AND** MUST 保留已提交的会话消息

#### Scenario: 消息窗口包含多个 run
- **WHEN** 超过四个不同展示 run 需要 hydration
- **THEN** frontend MUST 保持至多四个在途的 run event HTTP 请求
- **AND** MUST 在 session load version 保持最新期间最终处理剩余的 run

### Requirement: 浏览器在投影前校验 event history 响应

TS frontend SHALL 在把 event 页加入浏览器状态前，运行时校验 event 页的 availability 形状、游标和每个 `StreamEnvelope`。非法的页或 envelope MUST 使受影响的 run process 加载失败，且 MUST NOT 向用户暴露非法 payload 或原始解析错误。

#### Scenario: Event 页包含非法 envelope
- **WHEN** HTTP 响应的 availability 为 AVAILABLE，但某个 item 未通过既有 public `StreamEnvelope` 校验器
- **THEN** frontend MUST 拒绝整个 run process 加载
- **AND** MUST 保留已提交的会话消息
- **AND** MUST 只暴露安全的可重试 process 不可用状态

#### Scenario: Event 页包含其他 run 坐标
- **WHEN** 一个原本有效的 event envelope 的 `sessionId` 或 `runId` 与所请求的 run 坐标不同
- **THEN** frontend MUST 拒绝整个 run process 加载
- **AND** MUST NOT 把该 envelope 加入任何可见 turn

#### Scenario: Legacy 不可用响应携带禁止数据
- **WHEN** `LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE` 响应包含非空 events 或游标
- **THEN** frontend MUST 把该响应判定为非法
- **AND** MUST NOT 渲染或保留这些字段

### Requirement: Process history 不可用时消息历史仍可用

消息历史与 process event history SHALL 拥有相互独立的 frontend 加载结果。Event 请求失败或 `LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE` 响应 MUST NOT 移除、延迟或替换已提交的 user 和 assistant 消息。受影响的 turn MUST 区分加载中、可重试失败、legacy 不可用、available-empty 和 available-loaded 这些 process 状态。

#### Scenario: 消息加载后 event API 失败
- **WHEN** 消息页加载成功而某个所选 run 的 event 请求失败
- **THEN** 会话 MUST 立即保留并显示其已提交的消息
- **AND** 受影响的 turn MUST 暴露带重试操作的 process-history-unavailable 状态
- **AND** MUST NOT 把该失败呈现为 AVAILABLE 空 process

#### Scenario: Fork process history 报告不可用状态
- **WHEN** event history 返回 `LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE`
- **THEN** 受影响的 fork turn MUST 显示该 legacy fork 的历史 process 详情不可用
- **AND** 复制来的消息 MUST 保持可见
- **AND** frontend MUST NOT 自动重试或查询源 session

#### Scenario: 可用的 run 没有可见 event
- **WHEN** event history 返回 AVAILABLE 且为空完成页
- **THEN** frontend MUST 把 process hydration 视为成功完成
- **AND** MUST NOT 显示失败或 legacy-unavailable 提示

### Requirement: 历史 hydration 按 session 和 load version 隔离

TS frontend SHALL 按 `sessionId + runId` 为 process-history 缓存、在途工作、错误和重试状态划定作用域。开始更新的权威会话加载或清除 session 时，MUST 在可能时取消过期请求，并 MUST 忽略来自过期 load version 的每一个迟到结果。

#### Scenario: Hydration 期间用户切换 session
- **WHEN** session A 有在途 event 请求而用户激活 session B
- **THEN** session A 的迟到响应 MUST NOT 进入 session B 的 envelope 或 process 状态
- **AND** session B MUST 只 hydration 自身所选的 run

#### Scenario: 较新加载取代较旧 run 结果
- **WHEN** 较新的会话加载不再选择旧 load version 请求过的 run
- **THEN** 较旧的响应 MUST 被忽略，即使它稍后成功
- **AND** MUST NOT 重建已移除或已被取代的 turn

#### Scenario: 加载较旧或锚定的消息窗口
- **WHEN** 分页或锚点导航添加了包含此前未见展示 run 的消息窗口
- **THEN** frontend MUST 只 hydration 那些未缓存所选 run
- **AND** MUST 保留 session 内其他可见 run 已加载的有效 event history
