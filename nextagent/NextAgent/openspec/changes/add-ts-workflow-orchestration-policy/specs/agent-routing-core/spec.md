## ADDED Requirements

### Requirement: Agent 路由选择 workflow 或模型循环模式

Agent 路由策略 SHALL 为支持 workflow 的 Agent 选择受治理 workflow 路径或模型驱动循环路径之一。受治理 workflow 路径 MAY 包含预配置 workflow 和已发布的 learned workflow。路由决策 SHALL 保持在 Agent Core 内部，位于 runtime 受理之后、context assembly、model invocation 或 workflow 执行之前。

#### Scenario: 路由选择已注册的 workflow
- **WHEN** 路由策略为已受理请求选择 workflow 目标
- **THEN** Agent Core MUST 针对当前 `agentId` 通过受治理的 recipe/workflow registry 解析该目标
- **AND** Agent Core MUST 仅在该目标成功解析后才调用 workflow 执行路径
- **AND** runtime 和 channel MUST NOT 绕过 Agent Core 直接执行 workflow

#### Scenario: 路由选择模型循环
- **WHEN** 路由策略为已受理请求选择模型循环
- **THEN** Agent Core MUST 继续走既有模型驱动循环路径
- **AND** 除非后续产生了模型规划的 workflow 候选并通过受治理规划受理，否则它 MUST NOT 为该请求执行 workflow 查找或 workflow 执行

#### Scenario: Workflow 目标未命中时仅通过受治理行为降级
- **WHEN** 路由策略选择了一个对当前 `agentId` 不可用的 workflow 目标
- **THEN** Agent Core MUST 以安全路由错误 fail closed，或按可信的策略 fallback 配置降级到模型循环
- **AND** 它 MUST NOT 执行来自其他 Agent Scope 的 workflow 或按名称全局匹配到的 workflow

#### Scenario: 路由选择已发布的 learned workflow
- **WHEN** 路由策略选择了一个已为当前 `agentId` 发布的 learned workflow
- **THEN** Agent Core MUST 通过预配置 workflow 所使用的同一受治理 workflow registry 解析它
- **AND** 它 MUST NOT 执行未发布的 learned workflow 候选

### Requirement: 完整路由策略实现受控

Agent routing core SHALL 允许可信 Agent package composition 为支持 workflow 的 Agent 提供完整路由策略实现。该实现 SHALL 通过受控 SPI 运行，并 SHALL 只返回已通过校验的路由决策。

#### Scenario: 可信策略实现在分发前运行
- **WHEN** 某个 Agent assembly 声明了完整路由策略实现
- **THEN** Agent Core MUST 在 workflow 或模型循环分发之前调用该策略实现
- **AND** 策略结果 MUST 按受控路由决策词表校验

#### Scenario: 策略实现尝试不受支持的决策
- **WHEN** 完整路由策略实现返回不受支持的决策 kind、未注册的 workflow 目标、畸形的 fallback 行为或非法的 diagnostic payload
- **THEN** Agent Core MUST 以安全策略错误 fail closed
- **AND** 它 MUST NOT 把该结果重新解释为模型循环、Skill 路由或 workflow 执行

#### Scenario: 策略实现被取消
- **WHEN** 完整路由策略实现正在评估时请求取消信号被触发
- **THEN** Agent Core MUST 通过 cancellation context 停止策略评估
- **AND** 它 MUST NOT 从迟到的策略结果分发 workflow 或模型循环
