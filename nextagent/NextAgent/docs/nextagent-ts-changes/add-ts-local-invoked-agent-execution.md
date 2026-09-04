# add-ts-local-invoked-agent-execution

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：InvokedAgent Execution

状态：not-planned
类型：合并记录
主要 owner：`agent-runtime`
依赖：`add-ts-agent-tool`

目标：
- 本地子 Agent 执行能力已合并入 `add-ts-agent-tool`：`Agent` tool 通过 runtime-owned `SubagentExecutionPort` 调用 `submit()` 创建 child session/run，并同步等待终态。

处理结果：
- 不再以 `task` 工具专属入口单独起草本 change。
- 不再单独定义本地 execution executor、取消映射或终态映射；这些由 `add-ts-agent-tool` 的 `SubagentExecutionPort`、`submit()`、timeout/abort 和 safe result mapping 承载。
- 后续如需扩展远端 Agent 执行，必须另起 remote invocation change，不能复用本记录作为实施 change。

并行边界：
- `add-ts-agent-tool` 是当前本地 Agent tool 子调用执行路径的唯一 active change。
