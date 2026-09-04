## ADDED Requirements

### Requirement: Optimistic Turn Binds To The Matching Canonical Run Before Projection

当用户执行 submit、retry 或 edit 并产生新的 accepted run 时，TS frontend SHALL 将本地 optimistic Turn 与 backend canonical `requestId`、`runId`、`requestContextId` 分别关联，MUST NOT 假设三者相等，也 MUST NOT 让同一个 frontend identity 字段依据 HTTP 与 stream 的到达顺序分别表示 `runId` 或 `requestContextId`。

在匹配当前 pending action 的第一条 canonical live envelope 进入 conversation projection 前，frontend SHALL 将 optimistic root 与 live attempt 作为一次不可分割的 identity binding 完成。只要该 envelope 的 session 和已确认的 canonical request/run identity 匹配，即使客户端没有观察到 `REQUEST_ACCEPTED`，该 envelope 也 MUST 被接纳到同一个 Turn；frontend MUST NOT 因 provisional attempt 与 canonical `requestContextId` 不同而静默丢弃该 envelope。

Identity binding MUST 仅作用于当前 session 的 matching pending action。旧 attempt、其他 run、其他 session、history-load envelope、invalid envelope 或无法证明关联的 terminal MUST NOT 接管或重键当前 optimistic Turn。

#### Scenario: HTTP acceptance precedes the first visible stream event

- **GIVEN** 用户提交问题后，HTTP 已返回 canonical `requestId` 和 `runId`
- **AND** 当前页面没有观察到该 run 的 `REQUEST_ACCEPTED`
- **WHEN** 同一 request/run 的第一条 stream envelope 是 thinking、正文或 capability detail，并携带独立的 `requestContextId`
- **THEN** frontend MUST 在投影该 envelope 前完成 optimistic root 和 attempt identity binding
- **AND** 界面 MUST 保持一个连续 Turn，同时显示原 optimistic 用户消息和收到的执行内容
- **AND** 后续同一 run 的 live envelope MUST 继续更新该 Turn

#### Scenario: Stream acceptance precedes the HTTP response

- **GIVEN** 用户提交问题后，stream `REQUEST_ACCEPTED` 先于 HTTP response 到达
- **WHEN** HTTP response 随后返回同一 canonical `requestId` 和 `runId`
- **THEN** frontend MUST 合并两侧已经确认的 identity
- **AND** HTTP `runId` MUST NOT 覆盖 stream `requestContextId` 的 attempt 语义
- **AND** 界面 MUST NOT 出现重复 Turn、正文丢失或 process detail 分裂

#### Scenario: Ordinary live events and terminal precede the HTTP response

- **GIVEN** 用户提交或编辑问题后，session live-tail 已收到同一 canonical root/run 的 thinking、正文、capability detail 或 terminal
- **AND** 当前 HTTP response 尚未返回，frontend 因此不能仅凭时间接近让这些普通事件接管 pending Turn
- **WHEN** HTTP response 随后确认该 canonical `requestId` 和 `runId`
- **THEN** frontend MUST 在一次 conversation projection transition 中采用既有 exact root/run bucket 的 `requestContextId`
- **AND** local optimistic USER、已接纳的 detail/正文以及 matching terminal MUST 合并到同一个 active 或 settled Turn
- **AND** 已接纳的 terminal MUST 在 HTTP identity 确认后结束“执行中”状态
- **AND** frontend MUST NOT 因该 run 此前被记录为 covered 而跳过合并或丢弃 terminal

#### Scenario: A different live acceptance cannot permanently claim the pending action

- **GIVEN** 当前用户 action 的 HTTP response 尚未返回
- **AND** 同一 session 的另一个 live `REQUEST_ACCEPTED` 在此期间到达并形成 stream candidate
- **WHEN** 当前 action 的 HTTP response 返回不同的 canonical `requestId` 或 `runId`
- **THEN** frontend MUST 以 HTTP identity 重新关联 local optimistic USER anchor
- **AND** candidate run 的 canonical envelope MUST 与 HTTP-confirmed run 保持隔离
- **AND** candidate run 的 terminal MUST NOT 结算 HTTP-confirmed pending action
- **AND** HTTP identity 确认前 frontend MUST NOT 把 candidate root 暴露为当前 action 的 Stop/Cancel target

#### Scenario: Matching terminal is the first recovered event

- **GIVEN** HTTP 已确认当前 pending action 的 canonical `requestId` 和 `runId`
- **AND** 当前页面此前没有接纳该 run 的 live detail
- **WHEN** 第一条恢复到达的 matching envelope 是 terminal，并携带 canonical `requestContextId`
- **THEN** frontend MUST 先完成 identity binding，再把同一 Turn 迁移到 settled presentation
- **AND** optimistic “执行中”状态 MUST 结束
- **AND** frontend MUST NOT 制造 timeout terminal 或依赖页面刷新完成结算

#### Scenario: Partial detail is followed by the matching terminal

- **GIVEN** frontend 已在当前 Turn 中接纳同一 request/run 的部分 thinking、正文或 capability detail
- **WHEN** matching terminal envelope 到达
- **THEN** terminal MUST 进入同一 attempt 并结束执行中状态
- **AND** 已接纳的正文和 process detail MUST 保留
- **AND** 界面 MUST NOT 停留在部分内容加“执行中”的状态

#### Scenario: Late event from an older attempt remains isolated

- **GIVEN** 同一 root 已因 retry 或 edit 产生较新的 accepted run
- **WHEN** 较旧 run 或较旧 `requestContextId` 的非匹配 live envelope 迟到
- **THEN** frontend MUST NOT 用旧 identity 重键当前 optimistic、active 或 settled Turn
- **AND** 旧 envelope MUST NOT 覆盖较新 attempt 的正文、process detail 或 terminal 状态

#### Scenario: Retrying a history-loaded Turn preserves canonical history identity

- **GIVEN** 页面刷新后，同一 Turn 的 USER 和旧 ASSISTANT 内容来自 history load，且不存在 local optimistic envelope
- **WHEN** 用户 retry 该 Turn，并由 HTTP acceptance 或 matching live envelope 确认新的 run
- **THEN** frontend MUST 保留 canonical USER history identity，并从当前 presentation 移除旧 ASSISTANT 内容
- **AND** frontend MUST NOT 把 history-load envelope 的 `runId` 或 `requestContextId` 重键为新 run
- **AND** 新 run 的 live envelope MUST 使用自身 identity 建立新的 active/settled attempt
