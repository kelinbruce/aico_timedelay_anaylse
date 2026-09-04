## ADDED Requirements

### Requirement: 面向用户的 Agent 针对阻塞的普通用户输入触发 AskUserQuestion

当当前任务在没有用户控制的简短普通答案时无法安全继续，NextAgent SHALL 引导面向用户的 Agent 调用 `AskUserQuestion`。该触发策略 MUST 以面向 model 的 prompt 指导来表达，MUST NOT 添加自然语言推断、自动 pending-input 路由、强制 tool 选择或 runtime 语义路由。

#### Scenario: 阻塞的普通澄清使用 AskUserQuestion
- **WHEN** 一个面向用户的 Agent 正在执行任务，且没有用户的简短普通答案就无法安全继续
- **AND** 缺失的答案无法从会话上下文推断
- **AND** 缺失的答案无法从可用 tool 获得
- **AND** 该答案由用户直接控制
- **THEN** 面向 model 的 prompt MUST 指示 Agent 调用 `AskUserQuestion`，而不是只在普通 assistant 文本中提问
- **AND** 该 prompt MUST 指示 Agent 直接向用户提出面向用户的问题，而不提及内部 `AskUserQuestion` 工具名。

#### Scenario: 可推断或可由 tool 获得的信息不询问用户
- **WHEN** 缺失的信息可以从会话上下文推断、可以通过可用 tool 获得，或可以通过安全的显式假设处理
- **THEN** 面向 model 的 prompt MUST 指示 Agent 不为该信息调用 `AskUserQuestion`。

#### Scenario: 已知选择优先使用选项问题
- **WHEN** 面向用户的 Agent 知道某个阻塞的普通澄清的有效选项
- **THEN** 面向 model 的 prompt MUST 指示 Agent 优先使用 `AskUserQuestion` 选项
- **AND** 开放式文本问题 MUST 保留给不知道有效选项的普通输入。

#### Scenario: 禁止用途保持在 AskUserQuestion 之外
- **WHEN** 所需交互用于凭证、secret、授权授予、受保护操作批准、高风险确认、human handoff、调查问卷或长表单
- **THEN** 面向 model 的 prompt MUST 指示 Agent 不使用 `AskUserQuestion`
- **AND** 系统 MUST 继续依赖既有按用途定义的 pending input kind、guard 或其所属 change 定义的安全拒绝行为。

### Requirement: 被调用的只读网络 explorer 不直接创建用户问题

NextAgent SHALL 让 `network-explorer` 保持为一个被调用的、只读的电信证据收集 Agent，不直接创建用户 pending 问题。`network-explorer` 发现的缺失信息 MUST 以有来源支撑的发现、限制或缺失数据缺口的形式返回，交由面向用户的 Agent 处理。

#### Scenario: network-explorer 不能看到 AskUserQuestion 作为可调用 tool
- **WHEN** 为 `network-explorer` 组装 model 上下文
- **THEN** `AskUserQuestion` MUST NOT 作为该 Agent 的可调用 tool 被暴露
- **AND** 这 MUST 通过 Agent capability 配置来实施，而不是为 `network-explorer` 添加 runtime 特例。

#### Scenario: default-agent 保持用户提问能力
- **WHEN** 为面向用户的 `default-agent` 组装 model 上下文
- **THEN** 当 canonical 内置 descriptor 可用时，`AskUserQuestion` MUST 保持为可调用 tool
- **AND** `default-agent` MAY 决定 `network-explorer` 返回的缺失数据缺口是否应成为一个面向用户的 `AskUserQuestion` pending input。
