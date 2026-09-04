## ADDED Requirements

### Requirement: Live envelope 生命周期 SHALL 在无损会话逐出之外保留已完成的 Turn

Agent Web MUST 保留每个可见的已完成 Turn 和当前页面生命周期内已接受的每个非冗余 process 详情，其保留独立于收到的原始 stream envelope 对象数量。数值 500 MUST 仅作为无损 active-stream 压缩的触发条件，MUST NOT 作为最大消息数、Run 数、Turn 数、DOM 数或破坏性的保留事件上限。属于同一确切 stream lane 的累积快照和增量文本，只有当结果中的可见内容和 process 语义等价时才 MAY 被替换或合并。无法证明等价的事件在压缩后 MUST 保持可用，即使被压缩的 bucket 包含超过 500 个 envelope 对象。

#### Scenario: 超过 500 个会话 envelope 不会移除较早完成的 Turn
- **GIVEN** 连续的最近会话视图包含当前页面生命周期内产生的已完成 Turn
- **WHEN** 该会话已接受的 live envelope 超过 500 个对象且后续 request 继续完成
- **THEN** 每个较早的可见已完成 Turn MUST 保持渲染
- **AND** 其已接受的回答、终态和 process 详情入口 MUST 保持可用
- **AND** frontend MUST NOT 在每次终态后要求刷新会话才能保留这些 Turn

#### Scenario: 单个 Run 超过 1000 个有效事件
- **WHEN** 一个 Run 产生超过 1000 个已接受的 stream 事件，包括非冗余的结构性 process 事件
- **THEN** frontend MUST 保留完整的累积回答
- **AND** 每个贡献独立 process entry 的非冗余结构事件 MUST 在完整 process 呈现中保持可用
- **AND** frontend MUST NOT 只静默保留最后 500 个 envelope 对象

#### Scenario: 交错的 capability 结果 lane 保持独立
- **GIVEN** 一个 Run 为不同的 tool 或 capability 调用标识生成交错的 capability result delta
- **WHEN** active-stream 压缩被触发
- **THEN** 来自不同调用标识或 attempt 的 delta MUST NOT 被合并进一个结果 lane
- **AND** 被序列间隙分隔的 thinking 或 capability result delta MUST NOT 跨越该间隙合并
- **AND** 压缩 MUST 保留每个 lane 的可见结果文本、调用关联和 process entry 顺序

#### Scenario: 后续 Turn 流式输出时已稳定的 Turn 保持稳定
- **GIVEN** 当前最近视图包含已稳定的 live Turn
- **WHEN** 较后的活动 Turn 收到一个或多个 live 批次
- **THEN** 只有匹配的活动 Turn 投影 MUST 因这些批次而变化
- **AND** 未变化的已稳定和历史 Turn 组件引用 MUST 保持稳定
- **AND** frontend MUST NOT 在活动追加路径中重新扫描或重建每个已稳定的 Turn

#### Scenario: 提交顺序到达前仅 live 的 Turn 顺序保持稳定
- **GIVEN** 当前连续最近视图包含当前页面生命周期内已接受、尚未出现在已提交历史中的多个 root
- **WHEN** 这些 root 经过乐观身份调和或从活动转为已稳定
- **THEN** 它们的可见 Turn 顺序 MUST 与这些 root 首次进入会话投影的顺序保持一致
- **AND** 身份调和 MUST NOT 移动 Turn 或创建重复 Turn

#### Scenario: 已提交历史接管匹配的 Turn 顺序
- **GIVEN** 当前连续最近视图包含按首次投影接受排序的仅 live root
- **WHEN** 已提交历史随后包含匹配的 root
- **THEN** 已提交消息序列 MUST 拥有该 root 的 canonical 位置，且不创建重复 Turn

#### Scenario: 锚定视图隔离显示但不丢弃已接受的 stream 数据
- **GIVEN** 用户正在查看一个仍剩有 `newerCursor` 的锚定历史窗口
- **WHEN** 用户提交一个 request 且 frontend 收到其 live 和 terminal envelope
- **THEN** 锚定窗口和阅读位置 MUST 保持不变
- **AND** 新 Turn MUST NOT 被插入非连续的锚定消息段
- **AND** frontend MUST 保留该会话已接受的活动和已稳定 live 数据
- **WHEN** 用户显式返回连续的最近窗口
- **THEN** 被保留的 Turn 及其已接受的 process 详情 MUST 参与最近投影，而无需按终态逐次进行会话调和

#### Scenario: 会话生命周期清理不产生部分保留状态
- **WHEN** 用户显式清除一个会话，或该会话被从有界的 frontend 会话缓存中逐出
- **THEN** 该会话的历史、活动 live 和已稳定 live 数据 MUST 一并被移除
- **AND** MUST NOT 在该会话身份下遗留任何孤立的活动或已稳定 process 详情
