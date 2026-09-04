## ADDED Requirements

### Requirement: Turn Run Graph SHALL 只对可追溯的 process turn 提供

Agent Web SHALL 只有在一个 turn 拥有包含 thinking 或 Capability 活动的 process timeline 内容时，才把它视为面向用户的完整 process 入口的合格对象。历史加载的 event 只有携带非空的后端 `timelineEventRef` 才合格；仅会话投影的历史 Capability 摘要 SHALL NOT 制造 graph 入口。合格入口是否被显示配置启用，由本能力之外拥有。

#### Scenario: 活动 process turn 提供 graph
- **GIVEN** 一个 turn 包含带 thinking 或 Capability 活动的 process timeline 条目
- **WHEN** 该 turn 被渲染且当前显示配置启用了 graph 入口
- **THEN** Agent Web SHALL 提供其完整 process graph 入口

#### Scenario: 无引用的历史摘要不提供 graph
- **GIVEN** 历史 Capability 内容仅以会话投影形式存在，没有 `timelineEventRef`
- **WHEN** 该 turn 被渲染
- **THEN** Agent Web SHALL NOT 为该内容提供 Turn Run Graph

### Requirement: Run Graph 投影 SHALL 保留 canonical 事件顺序与关联

Agent Web MUST 按后端 sequence、然后 timestamp、然后 event id 对 graph 输入排序。它 SHALL 投影 request、model、Capability、user-input、degradation、LLM 文本回答和 terminal 节点。若存在 stream 活动但没有显式 `REQUEST_ACCEPTED`，Agent Web MAY 添加一个推断的 stream 起始节点，但 SHALL NOT 为其编造后端事件引用。Capability 事件 SHALL 按可用的 tool-call、invocation、metadata invocation 或 Capability 标识关联。对于 `LLM_CONTENT_DELTA` 回答事件，graph 回答内容 SHALL 遵循与 turn 文本投影相同的累积与压缩事件合并语义。本能力并不主张 Run Graph 回答节点覆盖 `TOOL_STRUCTURED_DELTA` 回答内容；该投影仍由 Stable 的 `tool-structured-delta` 和 `agent-web-structured-message-rendering` 能力拥有。

#### Scenario: 并列事件位置使用确定性顺序
- **GIVEN** graph 事件的 sequence 位置缺失或相等
- **WHEN** Agent Web 构建 graph
- **THEN** 它 SHALL 回退到 timestamp、再到 event id 以获得确定性顺序

#### Scenario: 缺少 accepted 事件时只产生推断起始节点
- **GIVEN** stream 事件存在但没有显式 `REQUEST_ACCEPTED`
- **WHEN** Agent Web 构建 graph
- **THEN** 它 MAY 添加一个推断的 stream 起始节点
- **AND** 该节点 SHALL NOT 声称拥有后端事件引用

#### Scenario: Capability 生命周期事件汇聚到一个逻辑节点
- **GIVEN** Capability start、result 和 completion 事件共享一个可用的关联标识
- **WHEN** Agent Web 构建 graph
- **THEN** 它 SHALL 把它们关联到同一逻辑 Capability 执行

### Requirement: Run Graph 边 SHALL 表示展示顺序而非因果关系

Graph 边 SHALL 连接投影展示顺序中相邻的节点。Agent Web MUST NOT 把这些边描述为权威的因果调用、阶段、迭代或循环结构。在 request 终态上，仍在运行或等待的节点 SHALL 收敛到对应的 completed、failed、canceled 或 superseded 呈现。

#### Scenario: 相邻边不被呈现为因果证明
- **WHEN** 两个投影节点在展示顺序中相邻
- **THEN** Agent Web MAY 在它们之间绘制一条边
- **AND** UI 和文档 SHALL 把它视为有序呈现而非后端因果

#### Scenario: 终态关闭活动的视觉状态
- **WHEN** request 到达终态
- **THEN** 仍显示为运行或等待的 graph 节点 SHALL 收敛到适用的终态呈现

### Requirement: 被选中的 Run Graph SHALL 在 live 更新期间保持 turn 锚定

打开一个 Run Graph SHALL 把它锚定到所选 turn 的 root message id。同一 turn 的新事件 SHALL 更新 graph 及其 LLM 文本回答投影而不改变所选 turn。切换 session 或移除被锚定的 turn SHALL 关闭 graph。与 Expand Panel 和结构化回答投影的协调仍由 Stable 的 `agent-web-expand-panel` 和 `agent-web-structured-message-rendering` 能力拥有，本文不作定义。

#### Scenario: Live 事件更新被锚定的 turn
- **GIVEN** graph 已为某个 turn 打开
- **WHEN** 同一 root message id 的更多事件到达
- **THEN** Agent Web SHALL 更新该 graph 而不把选择移到另一个 turn

#### Scenario: Session 切换关闭 graph
- **WHEN** 用户切换到另一个 session
- **THEN** Agent Web SHALL 关闭先前 session 的 Run Graph

### Requirement: Run Graph SHALL 提供响应式、可键盘访问、文本等价的交互

在足够宽度下 Agent Web SHALL 在一个可调整尺寸的侧边区域渲染 graph；空间不足时 SHALL 使用右侧 drawer。Resizer SHALL 支持指针和键盘箭头、Home 和 End 交互。打开 graph SHALL 聚焦其关闭控件，关闭 graph SHALL 在该控件仍存在时把焦点恢复到发起控件。Graph SHALL 支持 fit、reset、有界 pan 和 zoom 以及节点选择。Canvas SHALL 从可访问性树隐藏，同时由一个可聚焦的文本摘要暴露相同的投影事实。动效 SHALL 尊重 `prefers-reduced-motion`。

#### Scenario: 窄布局使用 drawer
- **GIVEN** 可用宽度不足以容纳侧边区域
- **WHEN** graph 被打开
- **THEN** Agent Web SHALL 在右侧 drawer 中渲染相同的 graph 详情

#### Scenario: 关闭时恢复发起者焦点
- **GIVEN** graph 是从一个仍挂载的 turn 控件打开的
- **WHEN** 用户关闭 graph
- **THEN** Agent Web SHALL 把焦点恢复到该控件

#### Scenario: Canvas 不是唯一信息载体
- **WHEN** graph 被渲染
- **THEN** 其 canvas SHALL 被排除在可访问性树之外
- **AND** 一个可操作的文本摘要 SHALL 暴露投影的节点事实

### Requirement: Run Graph 详情 SHALL 避免原始 chain-of-thought 和原始事件 JSON

面向用户的 graph SHALL 把 thinking 表示为进度元数据而非原始 chain-of-thought。它 SHALL 从 Capability 详情中抑制完整的对象形或数组形 JSON，并在可用时优先使用解析出的安全终态错误码。它 SHALL NOT 把 graph canvas 直接绑定到保留的原始事件对象。本需求并不把任意纯文本事件详情归类为已完全脱敏或生产安全。

#### Scenario: Thinking 在不暴露原始内容的情况下被表示
- **WHEN** thinking delta 事件贡献到一个 model 节点
- **THEN** graph SHALL 暴露诸如更新计数之类的进度
- **AND** SHALL NOT 暴露原始 chain-of-thought 文本

#### Scenario: 对象形的 Capability 详情被抑制
- **WHEN** 一个 Capability 结果是完整的 JSON 对象或数组字符串
- **THEN** Agent Web SHALL NOT 把该原始 JSON 渲染为 graph 详情

### Requirement: Graph 渲染器失败时 SHALL 保留文本 process 摘要

若 graph 库加载或初始化失败，Agent Web SHALL 在 canvas 区域显示通用错误并 SHALL 保留文本 process 摘要。失败 UI SHALL NOT 替换整个 process 详情界面。

#### Scenario: Canvas 初始化失败
- **WHEN** graph 渲染器无法加载或初始化
- **THEN** Agent Web SHALL 显示通用的 canvas 区域失败
- **AND** 文本摘要 SHALL 保持可用
