## ADDED Requirements

### Requirement: Thinking live-history handoff keeps one canonical step

当 frontend 为同一 turn 组合 live、settled 与持久化 run event envelopes 时，它 MUST 使用 `sessionId + runId + rootMessageId + stepId` 作为 thinking step 的稳定身份。pure-live layer 中同一稳定身份的累计 snapshots MUST 按 canonical chronological order 只投影最后一条；settled layer 已包含该稳定身份的 `completed=true` `LLM_THINKING_DELTA` 时，frontend MUST 保留该完成态并移除随后叠加的同 step live partial/completed copies；event history 包含该完成态时，frontend MUST 把持久化完成态作为 canonical copy，并移除 base layer 中同一稳定身份的全部 copies。相同 live overlay 或 event history 再次进入投影时，frontend MUST 保持相同的单份可见结果。

不同稳定身份的 thinking MUST 保持为不同过程步骤，即使它们的文本相同。当任一 thinking envelope 缺少非空 `stepId`、不属于同一 session、run 或 root 时，frontend MUST NOT 按文本、sequence、完成状态或出现顺序推测其身份；这种 envelope 只适用既有 `eventId` 去重和坐标隔离规则。

#### Scenario: Pure-live cumulative snapshots replace the previous copy
- **GIVEN** 同一 session、run、root 和 `stepId` 的 live layer 依次收到较短与较长累计 thinking snapshots
- **WHEN** frontend 投影当前 turn
- **THEN** 过程面板 MUST 只形成一个 thinking step
- **AND** 该 step MUST 使用 canonical chronological order 中最后一条 snapshot
- **AND** frontend MUST NOT 通过文本包含关系或长度选择 snapshot

#### Scenario: Persisted completed thinking replaces live copies
- **GIVEN** 同一 session、run、root 和 `stepId` 的 base layer 同时包含 live partial 与 live completed thinking
- **WHEN** 对应 event history 返回该 step 的持久化 `completed=true` thinking
- **THEN** 过程面板 MUST 只显示持久化完成态的完整 thinking
- **AND** MUST NOT 显示该 step 的 live partial 或第二份 live completed copy

#### Scenario: Settled completed thinking replaces the retained live copy
- **GIVEN** 未刷新页面的 settled layer 已包含某稳定 step 的 completed thinking
- **AND** live layer 仍保留相同稳定 step 的 partial 或 completed cumulative envelope
- **WHEN** frontend 叠加 settled 与 live turn envelopes
- **THEN** 过程面板 MUST 只显示 settled completed thinking
- **AND** 刷新后从 event history 恢复的可见结果 MUST 与未刷新页面一致

#### Scenario: Repeated history hydration remains idempotent
- **GIVEN** 持久化完成态已经替代同一稳定 step 的 live copies
- **WHEN** 相同 event history 因重连、缓存复用或重复组合再次进入 turn projection
- **THEN** 可见 thinking step 的数量和内容 MUST 与首次完成组合后相同

#### Scenario: Equal text from different steps remains distinct
- **WHEN** 两条 thinking envelopes 的文本相同但 `stepId` 不同
- **THEN** frontend MUST 保留两个不同过程步骤
- **AND** 任一持久化完成态 MUST NOT 移除另一个 `stepId` 的 live copy

#### Scenario: Missing step identity uses conservative fallback
- **WHEN** live thinking 与持久化完成态具有不同 `eventId` 且任一 envelope 缺少非空 `stepId`
- **THEN** frontend MUST NOT 因文本、sequence 或完成状态相同而合并两条 envelope
- **AND** 只有 `eventId` 精确相同的 envelope 才能由既有去重规则合并

#### Scenario: Thinking identity never crosses turn coordinates
- **WHEN** 两条 thinking envelopes 具有相同 `stepId` 但 session、run 或 root 中至少一个坐标不同
- **THEN** frontend MUST NOT 把它们视为同一 thinking step
- **AND** 其他 run 或 root 的 event MUST NOT 进入当前 turn

### Requirement: Active run does not hydrate its own event history

当 turn 对应的 run 仍是 `ACCEPTED`、`QUEUED`、`PLANNING` 或 `EXECUTING` 时，frontend MUST NOT 为该 run 生成 automatic process-history target，也 MUST NOT 因用户展开该 turn 的过程面板而生成 explicit process-history target。active run 的可恢复流内容 MUST 继续由既有 active-run scoped stream replay 提供，frontend MUST NOT 以 run event-history REST 查询建立平行恢复路径。

当同一 run 进入 `COMPLETED`、`FAILED`、`CANCELED` 或 `SUPERSEDED` 时，frontend MUST 重新计算 process-history eligibility；终态 turn 若仍处于可见、预加载、预览跳转或用户展开范围，MUST 按既有优先级、容量、并发、缓存、取消与重试规则成为 history target。该 eligibility 变化 MUST NOT 依赖 `runId` 发生变化。

#### Scenario: Visible active turn does not request event history
- **GIVEN** 一个带 `runId` 的 active turn 位于 viewport 或 preload 范围
- **WHEN** frontend 发布 automatic process-history targets
- **THEN** targets MUST NOT 包含该 active run

#### Scenario: Expanding an active process panel does not request event history
- **GIVEN** 一个 active turn 的过程面板由用户展开
- **WHEN** frontend 处理 explicit history target
- **THEN** frontend MUST NOT 为该 run 调用 event-history API
- **AND** live 过程内容 MUST 继续来自当前 stream projection

#### Scenario: Terminal transition enables history hydration
- **GIVEN** 一个可见 turn 的 root 与 `runId` 保持不变
- **WHEN** 该 run 从 active 状态进入 terminal 状态
- **THEN** frontend MUST 重新发布 eligibility
- **AND** 该 run MUST 可以按既有 automatic 或 explicit 规则加载 event history

#### Scenario: Active-run replay remains the recovery path
- **GIVEN** 页面刷新或 stream 重连时 conversation bootstrap 返回 active run
- **WHEN** frontend 恢复该 run
- **THEN** frontend MUST 使用既有 exact-run scoped replay 恢复可恢复事件
- **AND** MUST NOT 依赖当前 run 的 event-history hydration

#### Scenario: Completed historical turns remain eligible
- **GIVEN** 同一会话中存在已完成的可见、预加载或预览目标 turn
- **WHEN** 当前最新 run 仍在执行
- **THEN** 已完成 turn MUST 继续按既有受控调度规则加载 process history
- **AND** active run 排除 MUST NOT 禁用其他历史轮次
