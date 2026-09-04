## ADDED Requirements

### Requirement: 预算分配是具有固定不变量的可插拔 policy

Query Policy SHALL 把预算分配与降级暴露为可插拔的 `ContextBudgetPolicyPort`，由 app composition 为进程生命周期注入一次。该 policy SHALL NOT 可按请求体、模型输出或 capability 参数切换。

任何 policy 实现 MAY 定义自己的预算比例、降级优先级和阈值，但 SHALL NOT 违反下列决策门不变量。这些不变量属于 Query Policy / Context Engine 契约，而不属于任何单一 policy：

1. 最小安全的当前请求 context 是硬保护基线；任何 policy 都 MAY NOT 把它放进历史预算，也不得为腾出空间而省略它。
2. 当仅该基线就超出可用预算时，policy MUST 返回显式的 insufficient-context outcome，且 MUST NOT 伪造成功装配。
3. Policy MUST 发出安全、完整的 source 类别和 role 级 explainability 证据，不含 raw prompt/message/tool/attachment 内容、路径、credential 或高基数标识符。
4. Policy MUST 把结果收敛为稳定的 `ContextCompactionPlan` 决策，取值范围是 continue、compact/degrade、pre-send-check 和显式失败。

系统 SHALL 提供一个默认 policy，其参数由本 capability 定义。替换默认 policy SHALL NOT 要求改变决策门不变量或下游 consumer。

#### Scenario: 默认 policy 是被注入的实现

- **WHEN** app composition 未注入自定义预算 policy
- **THEN** Query Policy 使用默认 policy，其参数包含 `historyBudgetRatio = 0.60` 和 `preSendCheckRatio = 0.885`
- **AND** 决策门消费该 policy outcome，而不重新推导预算数学

#### Scenario: 替换 policy 必须保持不变量

- **WHEN** 注入一个替换预算 policy
- **THEN** 它 MAY 改变预算比例、降级优先级和阈值
- **AND** 它 MUST 仍保护最小安全的当前请求 context、在基线超出预算时返回显式 insufficient-context、发出安全 explainability 证据并产生稳定的 plan 决策

### Requirement: 预算决策是 policy port 的唯一职责

预算分配与降级决策 SHALL 只在预算决策门通过 `ContextBudgetPolicyPort` 做出。历史选择、summary 压缩、prompt-shaping 渲染和大内容处理都 SHALL NOT 各自实现自己的预算判断；它们消费 policy port 产生的 `ContextCompactionPlan`，并 SHALL NOT 重新推导预算数学、重新计算 `availableInputUnits`，或独立决定因预算原因丢弃什么。

#### Scenario: 下游阶段消费 plan 而不重新推导预算

- **WHEN** 历史选择、summary 压缩、prompt-shaping 渲染或大内容处理在预算决策门之后运行
- **THEN** 每个阶段消费来自 `ContextBudgetPolicyPort` 的 `ContextCompactionPlan`
- **AND** 没有任何阶段重新计算 `availableInputUnits` 或独立做出预算驱动的丢弃决策
- **AND** 任何预算驱动的省略或降级都可归因到唯一的决策门，而不是阶段本地启发式

### Requirement: Query Policy 在违反最新请求正确性之前先降级低优先级 context

当可用预算无法容纳全部合格 context 时，Query Policy SHALL 在丢弃最新请求关键 context 之前先降级或省略低优先级类别。

Query Policy SHALL 把最小安全的当前请求 context 视为硬保护基线。如果仅该基线就超出可用安全预算，Query Policy MUST 返回显式的 insufficient-context outcome，而不是继续正常 compaction。

#### Scenario: 最小安全当前请求超出预算
- **WHEN** 最小安全当前请求 context 所需 units 大于 `availableInputUnits`
- **THEN** Query Policy MUST 返回显式的 insufficient-context outcome
- **AND** `reasonCode`、`degradationMode` 和 explainability 原因 MUST 表明最小安全当前请求 context 超出预算

#### Scenario: 大的 capability 结果先于请求关键 context 被降级
- **WHEN** 一个大的 capability 或 tool 结果与当前请求关键 context 竞争
- **THEN** Query Policy SHALL 在丢弃当前请求关键 context 之前，优先对该大结果采用摘录、引用、摘要或省略
- **AND** 选定的降级模式和安全 reason code SHALL 可观察

### Requirement: 默认 policy SHALL 应用 60% 历史预算上限

默认预算 policy SHALL 为先前历史 context 最多预留 `availableInputUnits` 的 60%（`historyBudgetRatio = 0.60`，一个默认 policy 参数）。该上限适用于先前的原始对话轮次及其 summary/memory 替换，加上非最新请求关键的历史 attachment 投影。它 MUST NOT 适用于最小安全当前请求 context、runtime context、project instruction context 或 capability 披露，这些类别单独核算。替换 policy MAY 选择不同比例，但上述核算类别的分离仍是决策门不变量。

#### Scenario: 先前历史被限制在可用输入预算的 60%
- **WHEN** 为一个模型支撑的步骤计算 `availableInputUnits`
- **THEN** 默认 policy 派生 `historyBudgetCapUnits = floor(availableInputUnits * 0.60)`
- **AND** 超出该上限的先前历史 MUST 在触及当前请求关键 context 之前被摘要、裁剪、省略或以其他方式降级

#### Scenario: 稳定的 prompt 槽位不被隐藏在历史估算中
- **WHEN** runtime context、project instructions、capability 披露、attachment context 或 memory 披露被选择或省略
- **THEN** Query Policy SHALL 为该决策发出安全的 source 类别证据
- **AND** 它 SHALL NOT 把这些开销隐藏在先前历史估算之内

### Requirement: Query Policy SHALL 发出可观察的 selection 原因

Query Policy SHALL 暴露机器可观察的事实，描述选择了什么、省略或降级了什么，以及为何选择最终窗口组合。

这些事实 SHALL 具备 source 类别感知。至少，Query Policy SHALL 区分当前请求、先前 active-context 历史、summary/session-memory 替换、attachment 投影、capability 披露、大的 capability/tool 结果、runtime context、project instruction context，以及启用时的后续 memory 检索披露。每个类别 SHALL 携带安全的类别标签、估算的 input units、selected/omitted/degraded 状态、reason code 和 owning boundary。

这些事实 SHALL 同时为 `system`、`user`、`assistant` 和 `tool` prompt 组暴露安全的 role 级装配决策，标识每个 role 组是被选择、保护、压缩、摘要、摘录、引用、省略还是被 policy 拒绝。

Selection 原因证据 SHALL NOT 包含 raw prompt 文本、raw 消息、tool 参数、tool 结果、attachment 内容、credential、本地路径或高基数标识符。

#### Scenario: 被省略的历史仍可诊断
- **WHEN** 先前历史或历史 attachment context 为适应预算被摘要、裁剪或丢弃
- **THEN** plan MUST 标识受影响的类别或条目组
- **AND** 它 MUST 记录对应的省略或降级 reason code

#### Scenario: Source 级预算证据安全且完整
- **WHEN** Query Policy 为一个模型支撑的步骤记录 source 类别证据
- **THEN** 每个证据条目只包含安全的类别、估算 units、状态、reason code 和 owning boundary
- **AND** 它 MUST NOT 包含 raw prompt、raw message、raw tool 结果、raw attachment 内容、本地路径或 credential

#### Scenario: Role 级 prompt 装配仍可诊断
- **WHEN** Query Policy 决定保留、压缩、摘要、摘录、引用、省略或拒绝 system、user、assistant 或 tool role 组
- **THEN** 它 SHALL 为该决策发出安全的 role 级证据
- **AND** 当 system role prompt section 和最小安全的当前用户输入不可压缩时，它 SHALL 把它们标记为受保护
- **AND** 只有在保留 tool-use/tool-result 配对和包围的有效轮次边界时，它 SHALL 才把历史成对 tool 结果标记为可压缩

### Requirement: Query Policy SHALL 产出预算阶段 explainability 和 pre-send 检查

`ContextCompactionPlan` SHALL 为分阶段 compaction 暴露稳定的机器可读 explainability，包括 `reasonCode`、`compressionMode`、`degradationMode`、`pipelineStageStoppedAt`、`estimatedFinalInputUnits` 和 `omittedContextTypes`。该 plan SHALL 作为决策契约表达该步骤是否可以正常继续、必须压缩或降级、必须运行 pre-send 检查，或必须显式失败。

#### Scenario: 高残余压力之后要求 pre-send 检查
- **WHEN** 发生 overflow 且 compaction 后的估算比例至少达到默认 policy 的 `preSendCheckRatio`（`0.885`）
- **THEN** `ContextCompactionPlan.degradationMode` MUST 包含 `PRE_SEND_CHECK_REQUIRED`
- **AND** compaction 原因 MUST 使该残余压力条件可观察

#### Scenario: Explainability 是决策契约而不是裸数字
- **WHEN** Query Policy 为一个模型支撑的步骤完成预算评估
- **THEN** plan 在 continue、compact/degrade、pre-send-check 和显式失败之间暴露一个稳定决策
- **AND** 下游 consumer MUST 能基于该决策行动，而不重新推导预算数学
