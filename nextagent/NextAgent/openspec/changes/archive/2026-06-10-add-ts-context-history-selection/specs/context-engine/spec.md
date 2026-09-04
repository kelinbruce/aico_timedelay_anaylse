## ADDED Requirements

### Requirement: Context Engine 拥有 model 可见历史选择

Context Engine SHALL 在 context assembly 期间从权威的 owner-scoped 和 agent-scoped 事实中选择 model 可见的会话历史。调用方 SHALL 提供请求位置和意图，并 SHALL NOT 预选历史 entry 或绕过可见性策略。

Current-request context 是最新请求的正确性 baseline，而不只是最近的历史消息。它由 `requestId` 标识的根用户请求消息、同一 `requestId`/`runId` 下协议必需的消息（例如 assistant tool-use 和 capability-result 消息），以及最新请求必需的附件和 tool 状态组成。当前请求和其他请求关键 context SHALL 在可选的先前历史之前建立。如果必需的 current-request context 无法建立，assembly SHALL 显式失败，而不是静默丢弃必需的 context。

历史选择只产生有效历史候选的完整集合。它 SHALL NOT 执行最终的 context-window 截断、压缩或替换；`ContextAssembly.selectedMessageRefs` 的最终选择仍然由现有下游策略拥有（见 Requirement: 历史候选选择与最终 context 选择分离）。

#### Scenario: 调用方不能注入已选历史
- **WHEN** 某调用方请求 context assembly
- **THEN** Context Engine 从权威的 context 状态推导 model 可见历史
- **AND** 调用方提供的历史或消息选择不被接受为权威

#### Scenario: 当前请求不能被静默丢弃
- **WHEN** 必需的 current-request context 不可用
- **THEN** assembly 返回显式的安全失败
- **AND** 它不会在移除必需 context 之后报告 assembly 成功

#### Scenario: 当前请求在可选先前历史之前保持必需
- **WHEN** 必需的 current-request context 和有效的先前会话候选都可用
- **THEN** Context Engine 在先前轮次候选之前，把 current-request 记录建立为必需的当前 context
- **AND** 任何包含先前历史的最终 `ContextAssembly.selectedMessageRefs` 也包含必需的 current-request 记录
- **AND** 下游 context-window 策略可以在省略必需的 current-request context 之前先省略可选的先前历史

#### Scenario: 无先前会话的首轮
- **WHEN** session 没有先前的可见会话单元，只有当前请求可用
- **THEN** Context Engine 返回 current-request 记录作为仅有的历史候选
- **AND** 先前轮次候选是空集合
- **AND** `ContextAssembly.selectedMessageRefs` 仍 MUST 包含所有必需的 current-request 记录

### Requirement: ActiveContextView 是 model 可见历史的权威

Context Engine SHALL 从当前 `ActiveContextView` 和不可变的 session 消息记录推导 model 可见历史。它 SHALL NOT 扫描完整的 session transcript，或重新引入隐藏、inactive 或被省略的消息来扩大 model 可见窗口。

#### Scenario: 历史保持在 active context 范围内
- **WHEN** Context Engine 选择先前会话历史
- **THEN** 被选择的原始历史从可见的 active-context 项推导
- **AND** active context 之外的消息不会通过完整 session 扫描被恢复

### Requirement: 先前会话保留有效的会话边界

先前会话 SHALL 只以有效的可见会话单元为单位被选择。隐藏的替换历史以及不完整或孤立的协议片段 SHALL 被排除在正常 model 输入之外。

#### Scenario: 不完整的先前轮次被排除
- **WHEN** 某个先前会话单元缺少必需的可见请求或 terminal 响应边界
- **THEN** Context Engine 把该单元从正常 model 可见历史中排除

#### Scenario: 隐藏的替换历史保持被排除
- **WHEN** retry 或 edit 隐藏了被替换的消息
- **THEN** 这些消息不会被选择用于正常 prompt assembly

#### Scenario: 完整的先前 tool 轮次被保留
- **WHEN** 某个先前会话单元包含有序且完整的 tool-use 和 capability-result 序列，后跟 terminal assistant 响应
- **THEN** 完整的可见单元被保留为历史候选
- **AND** 历史选择不会静默把它投影为只有根请求和 terminal 响应

#### Scenario: 完整的纯文本先前轮次被保留
- **WHEN** 某个先前会话单元包含一条根用户消息和一条 terminal 的非 tool assistant 响应，且没有 tool-use 或 capability-result 序列
- **THEN** 完整的可见单元被保留为历史候选
- **AND** 该单元不会仅仅因为不包含 tool call 而被拆分、投影或丢弃

#### Scenario: 挂起的先前 tool 片段被排除
- **WHEN** 某个先前会话单元以 tool-use 请求结束，或以其他方式缺少完整的协议序列和 terminal assistant 响应
- **THEN** Context Engine 把整个单元从正常 model 可见历史中排除

### Requirement: 历史候选选择与最终 context 选择分离

Context Engine SHALL 在应用现有下游 context-window 策略之前形成所有有效的历史候选。内部候选集合 SHALL NOT 重新定义 `ContextAssembly.selectedMessageRefs`，后者继续表达为 model 输入选择的最终不可变 active-context 消息。

#### Scenario: 候选选择不截断历史
- **WHEN** 多个有效的先前会话单元可用
- **THEN** 历史候选选择把所有有效单元返回给下游策略
- **AND** 任何后续省略都不归属于历史候选选择

### Requirement: 已选 message ref 来自单一快照且永不静默跳过

`ContextAssembly.selectedMessageRefs` SHALL 从本次 assembly 调用期间读取的单一 `ActiveContextView` 快照产生。选择侧 SHALL NOT 混合来自不同 `ActiveContextView` 快照的 ref，也 SHALL NOT 扫描该快照之外的消息。当 render 阶段解析某个被引用消息，而该底层消息在 render 时缺失或不再对 model 可见时，render SHALL 以带展示安全 diagnostic 的显式失败或显式降级呈现，并 SHALL NOT 静默跳过该消息。

本需求早先的范围还要求 `ContextAssembly.selectedMessageRefs` 携带来源 `activeContextVersion` 作为逐 ref 解析锚点，并要求 render 依据该锚点重新校验每个 ref。该子需求已因对当前架构过度设计而被移除：`SessionMessage` 是 append-only 的，same-session lane 调度把每个 session 的执行串行化，并且不存在在同一请求的 assemble 与 render 之间并发修改 active-context 状态的架构路径。锚点本要提供的保护由上述单一快照保证和 render 侧不静默跳过规则实现。

#### Scenario: 选择从单一快照提取每个 ref

- **WHEN** Context Engine 发出 `ContextAssembly.selectedMessageRefs`
- **THEN** 每个 ref 都从本次 assembly 调用期间读取的单一 `ActiveContextView` 快照推导
- **AND** ref 不会从不同的 `ActiveContextView` 快照组合，也不会从完整 session 扫描中提取

#### Scenario: render 不静默跳过缺失或不可见的已选 ref

- **WHEN** render 阶段解析 `selectedMessageRefs` 的某个 entry，而底层消息无法加载，或者加载了但对 model 不可见
- **THEN** render 以带展示安全 diagnostic 的显式失败或显式降级呈现
- **AND** render 不会静默丢弃该消息并继续产出仿佛其不存在的 model 输入

### Requirement: 无法解析的 active context 引用显式失败

当某个 `ActiveContextView` 消息引用无法被安全解析时，Context Engine SHALL 显式失败。它 SHALL NOT 静默把未解析的引用归类为先前历史并继续使用仅 current-request 的 context。

#### Scenario: Active context 消息引用无法被解析
- **WHEN** 任何 active-context 消息引用无法针对 active session 被加载或校验
- **THEN** assembly 返回显式的安全失败
- **AND** 它不会静默丢弃其他未知的 current-request 状态
