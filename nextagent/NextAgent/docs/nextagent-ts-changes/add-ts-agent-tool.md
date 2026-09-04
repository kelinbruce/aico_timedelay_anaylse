# add-ts-agent-tool

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Tool

状态：active
类型：实施 change
主要 owner：`agent-runtime`
依赖：`add-ts-agent-package-assembly`、`add-ts-capability-core-governance`、`add-ts-invoked-agent-discovery`

目标：
- 新增 `Agent` tool entry 的 descriptor、input/output schema 和 safe result 语义。
- 新增 `SubagentExecutionPort` 契约和 `agent-runtime` 实现：通过 `submit()` 创建 child session/run、同步等待终态、提取安全终态文本。
- 修改 `submit()` 支持指定 agent、创建 child session、parent linkage、priority 和 no-nesting 自动注入。
- 修改 scheduler 支持全局执行门（`maxConcurrent`）和优先级 dispatch。
- 定义 agent scope、owner scope、no-nesting、safe error 和 audit 的黑盒约束。

非目标：
- 不定义 Agent package/assembly 格式，由 `add-ts-agent-package-assembly` 承载。
- 不定义远端 Agent 协议、Agent Registry discovery、远端 agent 调用或 multi-agent recovery。`SubagentExecutionPort` 契约设计为可扩展，首版只实现本地路径。
- 不定义继承上下文 subagent 场景（子 Agent 可见父 context、结果回流父 context）；由 `add-ts-invoked-agent-context-inheritance` 承载。
- 不支持异步/background agent 调用；本 change 只做同步 completed 返回。
- Agent tool 不直接拥有 child run lifecycle、terminal commit 或 canonical timeline——这些由 `submit()` 和 runtime 拥有。`SubagentExecutionPort` 同步等待终态并提取安全文本投影，但不创建 run 或写 timeline。
- 不实现 host agent 路由策略（intent recognition、fallback、multi-agent）；本 change 只定义 `submit({ agentId })` 契约能力。
- 不允许 Agent tool 绕过 capability governance、capability resolver、agent scope 或 owner scope。
