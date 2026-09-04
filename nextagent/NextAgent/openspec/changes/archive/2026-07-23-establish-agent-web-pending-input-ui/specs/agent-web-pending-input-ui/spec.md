## ADDED Requirements

### Requirement: 活动 pending input 替换普通 Composer

agent-web SHALL 把当前活动的 pending input 视为排他的 Composer 状态。当前会话存在活动 pending input 时，agent-web MUST 渲染一个 pending-input 回答界面，并 MUST NOT 渲染普通消息 Composer。对于 `QUESTION`、`CONFIRMATION`、`AUTHORIZATION` 和 `HUMAN_HANDOFF`，回答界面 MUST 为该 canonical 种类选择相应控件；被接受的回答值和回答形状仍由既有 Pending Input 能力治理，本能力不重新定义。

#### Scenario: Question pending input 激活问题控件
- **WHEN** 当前会话 frontend 状态激活一个 canonical `QUESTION` pending input
- **THEN** agent-web MUST 用问题回答控件替换普通消息 Composer
- **AND** 普通消息 textarea MUST NOT 同时保持可用

#### Scenario: Confirmation pending input 激活确认控件
- **WHEN** 当前会话 frontend 状态激活一个 canonical `CONFIRMATION` pending input
- **THEN** agent-web MUST 用确认回答控件替换普通消息 Composer
- **AND** 本能力 MUST NOT 定义回退的确认回答值

#### Scenario: Authorization pending input 激活授权控件
- **WHEN** 当前会话 frontend 状态激活一个 canonical `AUTHORIZATION` pending input
- **THEN** agent-web MUST 用授权回答控件替换普通消息 Composer

#### Scenario: Human handoff pending input 激活交接控件
- **WHEN** 当前会话 frontend 状态激活一个 canonical `HUMAN_HANDOFF` pending input
- **THEN** agent-web MUST 用既有 `human-handoff` 能力定义的交接模式和交接内容控件替换普通消息 Composer

### Requirement: 已解决的 pending input 恢复普通 Composer

agent-web SHALL 在该活动 input 的回答 request 成功后清除其本地活动 pending-input UI 并恢复普通消息 Composer。当前会话 stream 把该活动 pending input 报告为已接收、已超时或已取消时，agent-web 也 MUST 恢复普通消息 Composer。本能力只定义 frontend 状态迁移，MUST NOT 重新定义回答路由、stream payload 或 runtime 解决生命周期。

#### Scenario: 回答成功恢复 Composer
- **WHEN** agent-web 成功为当前活动 pending input 提交有序回答
- **THEN** agent-web MUST 移除 pending-input 回答界面
- **AND** 普通消息 Composer MUST 重新变为可用

#### Scenario: 已接收结果恢复 Composer
- **WHEN** 当前会话 stream 为该活动 pending input 报告 canonical `USER_INPUT_RECEIVED`
- **THEN** agent-web MUST 移除 pending-input 回答界面
- **AND** 普通消息 Composer MUST 重新变为可用

#### Scenario: 超时结果恢复 Composer
- **WHEN** 当前会话 stream 为该活动 pending input 报告 canonical `USER_INPUT_TIMEOUT`
- **THEN** agent-web MUST 移除 pending-input 回答界面
- **AND** 普通消息 Composer MUST 重新变为可用

#### Scenario: 已取消结果恢复 Composer
- **WHEN** 当前会话 stream 为该活动 pending input 报告 canonical `USER_INPUT_CANCELED`
- **THEN** agent-web MUST 移除 pending-input 回答界面
- **AND** 普通消息 Composer MUST 重新变为可用

### Requirement: 投影的 pending-input 到期仅用于显示

当前活动 pending input 带有投影的到期坐标时，agent-web SHALL 显示反映本地时间流逝的剩余时间或已过期状态。在本地到达投影的到期时间 MUST NOT 提交回答、授权操作、请求取消或清除活动 pending-input 回答界面。Frontend MUST 等待 canonical 的已解决结果后再恢复普通 Composer。没有投影到期坐标时，本能力不要求到期指示。本需求不定义超时策略、计时器节奏、精确格式或 stream payload 形状。

#### Scenario: 显示投影的到期时间
- **GIVEN** 当前活动 pending input 带有未来的投影到期坐标
- **WHEN** agent-web 渲染其回答界面
- **THEN** agent-web MUST 显示剩余时间状态
- **AND** 该状态 MUST 反映本地时间的流逝

#### Scenario: 本地倒计时到期不解决该 input
- **GIVEN** 当前活动 pending input 带有投影到期坐标
- **WHEN** 本地时间在 canonical 已解决结果到达之前到达或越过该坐标
- **THEN** agent-web MUST 保持 pending-input 回答界面为活动状态
- **AND** MUST NOT 仅因本地倒计时而提交回答、授权操作、请求取消或恢复普通 Composer

#### Scenario: 缺少到期坐标时没有倒计时义务
- **GIVEN** 当前活动 pending input 没有投影到期坐标
- **WHEN** agent-web 渲染其回答界面
- **THEN** 本能力 MUST NOT 要求到期指示

### Requirement: Pending-input 取消操作委托给所属 request

Canonical 的 `QUESTION` 和 `HUMAN_HANDOFF` 回答界面 SHALL 暴露取消操作。当用户激活该操作时，agent-web MUST 使用该活动 pending input 的所属 request 坐标委托取消。Frontend MUST NOT 仅因取消请求成功就合成 `USER_INPUT_CANCELED` 或清除回答界面；它 MUST 等待 canonical 已解决结果后再恢复普通 Composer。Runtime 取消权威、幂等和终态生命周期仍在本能力之外。本需求不定义其他 pending-input 种类是否暴露取消操作。

#### Scenario: Question 取消委托给所属 request
- **GIVEN** 一个 canonical `QUESTION` pending input 对某个 request 处于活动状态
- **WHEN** 用户激活其取消操作
- **THEN** agent-web MUST 为该所属 request 请求取消
- **AND** MUST 保持回答界面为活动状态直到 canonical 已解决结果到达

#### Scenario: Human handoff 暴露相同的所属 request 取消操作
- **GIVEN** 一个 canonical `HUMAN_HANDOFF` pending input 对某个 request 处于活动状态
- **WHEN** 用户激活其取消操作
- **THEN** agent-web MUST 为该所属 request 请求取消

#### Scenario: Canonical 已取消结果完成 frontend 恢复
- **GIVEN** agent-web 已为活动 pending input 的所属 request 请求取消
- **WHEN** 当前会话 stream 为该 input 报告 canonical `USER_INPUT_CANCELED`
- **THEN** agent-web MUST 移除回答界面
- **AND** MUST 恢复普通消息 Composer
