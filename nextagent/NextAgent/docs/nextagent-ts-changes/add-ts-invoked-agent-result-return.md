# add-ts-invoked-agent-result-return

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：InvokedAgent Execution

状态：not-planned
类型：合并记录
主要 owner：`agent-runtime`
依赖：`add-ts-agent-tool`

目标：
- 子 Agent 同步结果返回已合并入 `add-ts-agent-tool`：`SubagentExecutionPort` 等待 child run terminal state，并向 Agent tool 返回 safe terminal text projection。

处理结果：
- 不再以 `task` 工具结果返回单独起草实施 change。
- 首版返回 `{ agentId, status: "completed", result: { text } }`；失败映射为 safe failed result。
- 大结果、artifact refs、附件 refs 或继承上下文结果回流不在本记录中实施；如需扩展，必须另起明确 owner 和 contract 的后续 change。

并行边界：
- 本记录不得重新定义 `add-ts-agent-tool` 已冻结的 completed output shape 或 child run terminal wait 语义。
