## ADDED Requirements

### Requirement: Context Engine 在大内容截断和预算评估之前执行 micro-compaction

在组装 model 可见 history 时，Context Engine SHALL 在 history 候选选择之后、大内容截断和预算评估之前运行一个 micro-compaction 阶段。该阶段 SHALL 只使用本地确定性规则，并且 SHALL NOT 调用 model 或外部摘要服务。

#### Scenario: Micro-compaction 在下游预算决策之前运行

- **WHEN** Context Engine 为一个带可见先前 history 的请求组装上下文
- **THEN** 它在 history 选择之后评估 micro-compaction
- **AND** 任何大内容截断和预算评估观察的是 micro-compaction 后的 model 可见 history 形态
- **AND** 该阶段不调用 model、prompt template 或外部摘要边界

### Requirement: History 候选选择保持与最终上下文选择分离

Context Engine SHALL 保持既有的所有权划分：history 选择发出完整有效的候选集合，下游 policy 决定最终的 model 可见选择。在预算评估之前，Context Engine MAY 对已进入所选 history 候选集合的先前轮次 capability 结果应用一个确定性的本地 micro-compact 步骤。该步骤 MUST 只作用于 model 可见表示，MUST NOT 变更用户 message、assistant message、当前请求必需上下文或会话边界，并且 MUST NOT 调用 model。

#### Scenario: Micro-compact 在预算评估前只重写符合条件的先前 capability 结果

- **WHEN** 先前轮次 history 包含超过配置阈值的可压缩 capability 结果
- **THEN** Context Engine 在预算评估之前只把最旧的、符合条件的先前 capability-result 内容重写为有界占位符
- **AND** 它保留当前请求记录、用户 message、assistant message 和 tool/result 顺序
- **AND** 它不调用 model 来决定压缩

#### Scenario: 不符合条件或当前请求的内容绝不被 micro-compact

- **WHEN** 一条 message 属于当前请求、不是 capability 结果，或来自非白名单的 capability kind
- **THEN** Context Engine MUST NOT micro-compact 该 message
- **AND** 任何后续的省略或降级仍可归因于既有的下游预算或压缩 policy

### Requirement: Micro-compaction 只替换安全白名单内的较旧 tool 结果

Micro-compaction SHALL 只针对显式可信白名单内可重放或低风险 tool 的先前轮次 capability-result history 进行。它 SHALL NOT 压缩当前请求、用户 message、assistant 文本回复、非白名单 tool、Agent orchestration tool、task tool 或自定义 MCP tool。当可压缩的历史 tool 结果数量超过触发阈值时，它 SHALL 保留最近的保留窗口，并且只用确定性占位符替换较旧的符合条件结果。

#### Scenario: 较旧的白名单 tool 结果被压缩而最近的保持不变

- **WHEN** 先前 history 包含超过触发阈值的可压缩白名单 tool 结果
- **THEN** Context Engine 保持符合条件的 tool 结果的最近保留窗口不变
- **AND** 只把较旧的符合条件的 tool 结果替换为确定性的压缩占位符
- **AND** 保持当前请求记录和非白名单 tool 结果不变

#### Scenario: 未达到阈值时 history 保持不变

- **WHEN** 可压缩的历史 tool 结果数量未超过触发阈值
- **THEN** Context Engine 不应用 micro-compaction 替换
- **AND** 下游 history 以其原始的 model 可见形态继续

### Requirement: Render 解析所选 message 引用而不静默省略

当 render 从权威 message 存储重新加载所选 message 引用时，Context Engine SHALL 为当前活跃 context 重新应用任何已持久化的 micro-compact 状态，使 render 输出与用于预算评估的候选集合表示保持一致。如果 micro-compact 状态缺失、畸形或无法安全应用，render MUST 安全降级：保持原始 message 内容不变，并只记录展示安全的诊断。

#### Scenario: Render 重新应用已持久化的 micro-compact 替换

- **WHEN** assembly 先前已在活跃 context 元数据中将所选的先前 capability-result message 标记为已 micro-compact
- **THEN** render 对重新加载的 model 可见 message 重新应用相同的占位符替换
- **AND** 它不会仅因 render 重新读取存储而重新内联原始的大型 tool 内容

#### Scenario: 非法 micro-compact 状态安全降级

- **WHEN** 活跃 context 元数据省略 micro-compact 状态或包含非法的 micro-compact payload
- **THEN** Context Engine 保持重新加载的 message 内容不变
- **AND** 它不会仅因 micro-compact 状态无法解释而使主路径失败
- **AND** 发出的任何诊断都是展示安全的，并且不暴露原始 tool 内容

### Requirement: Micro-compaction 状态是 owner 作用域、幂等且在摘要压缩后被清除

Context Engine SHALL 把 micro-compaction 状态作为 owner 作用域的活跃 context 元数据持久化，使同一历史 message 不会跨请求被重复压缩。如果该状态缺失或畸形，Context Engine SHALL 安全降级为空状态。在摘要压缩提交替换活跃 context 之后，被替换 history 的 micro-compaction 状态 SHALL 被清除。

#### Scenario: 缺失或畸形的状态安全降级

- **WHEN** 活跃 context 元数据不包含有效的 micro-compaction 状态
- **THEN** Context Engine 将该状态视为空
- **AND** 不会仅因状态元数据缺失或畸形而使请求失败，继续 assembly

#### Scenario: 摘要压缩清除过期的 micro-compaction 状态

- **WHEN** 摘要压缩提交一个替换先前 history 的新活跃 context 视图
- **THEN** 已提交的活跃 context 元数据不再携带被替换 history 的过期 micro-compaction 状态
- **AND** 下一次 assembly 从替换后的活跃 context 开始 micro-compaction 跟踪
