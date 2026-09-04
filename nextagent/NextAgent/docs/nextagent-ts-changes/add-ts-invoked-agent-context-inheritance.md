# add-ts-invoked-agent-context-inheritance

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：InvokedAgent Execution

状态：ready
类型：实施 change
主要 owner：`agent-context-engine`、`agent-core`
依赖：`add-ts-agent-tool`

目标：
- 在 `add-ts-agent-tool` 的 fresh-context 本地子调用路径之后，定义可选的继承上下文子 Agent 场景。
- 受控传递父 run 的 selected safe history、允许的 attachment refs、locale、任务指令、预算和 routing constraints，让子 Agent 可见明确授权的父上下文。
- 保持 child session/run lifecycle、terminal wait、no-nesting 和 safe result mapping 继续由 `add-ts-agent-tool` 定义的 runtime path 承载。

非目标：
- 不重新定义 `Agent` tool 入口、`SubagentExecutionPort`、`submit()` child session/run 创建、priority scheduling、no-nesting 或 completed output shape。
- 不让子 Agent 默认继承父 conversation history、timeline、active context、raw prompt、raw model output、raw tool args/result、secret/credential、checkpoint 或 flowVariables。
- 不允许子 Agent 扩大父 run 已授权的 owner scope、agent scope、attachment scope 或 capability scope。
- 不实现远端 Agent 协议或 Agent Registry invocation。

规格输入：
- 继承上下文必须是显式 opt-in 的运行时模式，不能改变 `add-ts-agent-tool` 首版 fresh context 默认行为。
- 继承内容必须使用 safe handoff fields 表达；不得直接复用父 run 原始 active context view。
- 可继承内容至少区分 selected safe history summary、selected message refs、attachment refs、locale、task instruction、budget 和 routing constraints。
- 子 Agent 仍使用自己的 Agent assembly、capability governance、model profile 和 prompt profile。
- 子 Agent 固定 `allowSubagents=false`，且不能通过 caller-provided constraints 覆盖。

并行边界：
- 本 change 只定义继承上下文 handoff 语义和 context/core 集成。
- Runtime child lifecycle、session/run persistence、terminal wait 和 result projection 仍以 `add-ts-agent-tool` 为准。
