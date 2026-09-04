## ADDED Requirements

### Requirement: 活动 process entry 遵循执行生命周期

`ProcessPanel` SHALL 自动展开每个新变为活动的 thinking 或 capability entry。thinking entry 只有在其连续 entry 收到带 `metadata.completed=true` 的 envelope 时才变为已稳定；capability entry 只有从其终态投影状态才变为已稳定。在正常动效模式下，已稳定的活动 entry MUST 保持展开 800ms 然后自动折叠。并发的活动 capability entry MUST 被独立跟踪。

#### Scenario: Thinking 流式输出后稳定
- **WHEN** 进行中的累积 thinking envelope 更新当前连续 thinking entry
- **THEN** 该 entry MUST 保持展开并显示最新的完整累积文本
- **AND** 在已完成 thinking envelope 之前到达的回答 `LLM_CONTENT_DELTA` envelope MUST NOT 关闭或复制该 process entry
- **WHEN** `metadata.completed=true` 的 thinking envelope 使同一 entry 稳定
- **THEN** 该 entry MUST 保留最终的完整文本
- **AND** MUST 在 800ms 后自动折叠而不删除其详情

#### Scenario: 累积 thinking 更新保持单一布局生命周期
- **WHEN** 连续的累积 thinking envelope 更新同一运行中 entry 的详情，包括在前端容量压缩以 `eventId` 变化的压缩 envelope 替换原始 envelope 之后
- **THEN** `ProcessPanel` MUST 保留已挂载的 entry 及其展开/折叠状态
- **AND** MUST NOT 为每次文本更新重建 panel 高度观察
- **AND** 实际内容高度变化 MUST 通过单个活动 observer 上报，直到 panel 渲染生命周期变化

#### Scenario: Capability 完成时另一个 entry 开始
- **WHEN** 一个 capability entry 到达终态且新的 thinking 或 capability entry 变为活动
- **THEN** 新的活动 entry MUST 自动展开
- **AND** 已完成的 entry MUST 在其自身的 800ms 延迟后自动折叠

#### Scenario: 并行 capability 独立稳定
- **WHEN** 两个 capability entry 并发活动
- **AND** 只有一个到达终态
- **THEN** 只有已稳定的 entry MUST 启动其自动折叠生命周期
- **AND** 另一个运行中的 entry MUST 保持展开

### Requirement: 手动 entry 展开覆盖当前 run 的自动化

当用户手动展开或折叠一个 process entry 时，`ProcessPanel` SHALL 在当前 root-message/run 作用域内冻结该 entry 的自动展开和折叠。对一个 entry 的手动操作 MUST NOT 强制另一个 entry 展开或折叠。新的 root-message/run 作用域 MUST 在开始时不继承任何 entry 覆盖。

#### Scenario: 用户保持已完成的 entry 展开
- **WHEN** 用户在其自动折叠计时器之前或之后手动展开已完成的 entry
- **THEN** 该 entry 的任何待处理自动折叠 MUST 被取消
- **AND** 该 entry MUST 保持展开，直到用户更改它或组件离开当前 run 作用域

#### Scenario: 用户折叠活动 entry
- **WHEN** 用户手动折叠一个活动 entry
- **THEN** 同一 entry 后续的 delta 和终态 MUST NOT 将其自动展开
- **AND** 其他新的活动 entry 仍 MAY 自动展开

#### Scenario: 下一 turn 重置 entry 覆盖
- **WHEN** 会话开始新的 root-message/run 作用域
- **THEN** 来自先前 run 的 entry 覆盖 MUST NOT 生效
- **AND** 新 run MUST 使用自动 entry 生命周期默认值

### Requirement: 已完成的实时与冷历史 panel 具有相同的可检视详情

在一个 run 到达终态后，process panel SHALL 在既有的 150ms panel 延迟后自动折叠。冷历史 process panel SHALL 以折叠状态开始。当用户展开任一 panel 时，所有已持久化的 process entry 及其原始完成详情 MUST 保持可供检视；重新展开 MUST NOT 触发已稳定 entry 的自动折叠。

#### Scenario: 实时 run 完成
- **WHEN** 最终 process 和 request 终态已被投影
- **THEN** process panel MUST 在 150ms 后自动折叠，除非 panel 级用户覆盖生效
- **AND** 最终的 assistant 回答 MUST 在折叠的 panel 之外保持可见

#### Scenario: 用户重新打开已完成的实时 process
- **WHEN** 用户展开自动折叠的已完成 panel
- **THEN** 每个已完成的 thinking 和 capability entry MUST 连同其保留的详情一起可用
- **AND** 已稳定的 entry MUST 保持打开以供自由检视，直到用户更改它们或关闭 panel

#### Scenario: 打开冷历史
- **WHEN** 已完成的历史 turn 及其 event history 已加载
- **THEN** 其 panel MUST 初始处于折叠状态
- **WHEN** 用户展开它
- **THEN** 其已完成的 process 呈现 MUST 等价于已完成的实时呈现

### Requirement: 减弱动效时保持状态但不带过渡动效

当 `prefers-reduced-motion: reduce` 生效时，panel 和 entry 生命周期结果 SHALL 保持不变，但 entry 和 panel 过渡 MUST 不带 200ms 高度动画直接完成，已稳定的 entry MUST 不必等待 800ms 的呈现延迟。

#### Scenario: 减弱动效下 thinking 完成
- **WHEN** 在减弱动效偏好下，`metadata.completed=true` 的 thinking envelope 使一个活动 entry 稳定
- **THEN** 该 entry MUST 直接进入其折叠的自动状态
- **AND** MUST NOT 运行任何高度或扫动动画
- **AND** 手动展开 MUST 仍能显示完整详情
