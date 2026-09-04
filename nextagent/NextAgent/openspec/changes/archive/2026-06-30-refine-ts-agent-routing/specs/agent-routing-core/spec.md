## MODIFIED Requirements

### Requirement: 路由策略消费冻结的请求与 assembly 事实
路由策略 SHALL 消费 runtime 已接受的 `RequestRun`、`RequestContext`、冻结的 `AgentAssembly`、来自可信 Agent 配置源的路由规则配置、受治理的 capability 视图、可见的 model profile 事实、locale、security context、cancellation context，以及任何由已接受 contract refinement 提供的类型化路由约束。它 SHALL NOT 使用客户端请求体、模型输出、capability args 或不可信 metadata 覆盖 Agent Scope 或 Owner Scope。

#### Scenario: 已接受的输入文本对路由策略可用
- **WHEN** runtime 接受一个请求并进入 Agent 路由
- **THEN** `RequestContext` MUST 把已接受的用户输入文本作为 runtime 拥有的路由输入事实包含在内
- **AND** 该事实 MUST 表示当前 run 已接受的请求文本
- **AND** 它 MUST NOT 授予路由输入评估之外的任何权限

### Requirement: 策略路由使用受控的输入和输出契约
当路由规则配置声明 `mode=policy` 时，Agent 路由策略 SHALL 只消费受控的 policy 输入事实，并 SHALL 保持受控的 policy 路由结果边界。Policy 路由 MAY 仅通过固定的可信规则输出字段指向既有受治理的 Skill 和 Workflow 路径。

#### Scenario: Policy 模式声明有序 regex 规则
- **WHEN** 可信 Agent 配置声明 `mode=policy`
- **THEN** `policy` MAY 包含一个有序的 `rules` 数组
- **AND** 每条规则 MUST 包含非空的 `reg` regex 源
- **AND** 每条规则 MUST 包含取值为 `SKILL` 或 `WORKFLOW` 的 `target.kind`
- **AND** 每条规则 MUST 包含非空的 `target.name`

#### Scenario: Policy 模式匹配第一条 regex 规则
- **WHEN** `mode=policy` 评估在多条规则下执行
- **THEN** router MUST 按配置顺序评估这些规则
- **AND** 第一条匹配的 regex 规则 MUST 决定受控的路由目标
- **AND** 后续规则 MUST NOT 覆盖更早的匹配

#### Scenario: Policy regex 目标选择 Skill
- **WHEN** 第一条匹配的规则指向 `SKILL`
- **THEN** 路由策略 MUST 产生带 `skillName` 的受控确定性路由结果
- **AND** Agent Core MUST 继续走既有的受治理 Skill 加载路径

#### Scenario: Policy regex 目标选择 Workflow
- **WHEN** 第一条匹配的规则指向 `WORKFLOW`
- **THEN** 路由策略 MUST 产生带 `recipeName` 的受控确定性路由结果
- **AND** Agent Core MUST 继续走既有的受治理 workflow 路由路径

#### Scenario: Policy regex 规则不匹配
- **WHEN** 已配置 `mode=policy` 且没有 regex 规则匹配已接受的输入文本
- **THEN** 路由策略 MUST 回退到模型驱动的 loop 路径
- **AND** MUST NOT 凭空发明任意 Skill 或 Workflow 目标

#### Scenario: 可信 regex 配置无效
- **WHEN** 可信 policy 配置包含无效 regex 源或无效 target 形状
- **THEN** 路由策略 MUST 以安全的 policy 配置错误失败关闭
- **AND** MUST NOT 进入模型、workflow 或 capability 执行作为该无效配置的 fallback
