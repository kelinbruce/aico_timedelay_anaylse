# add-ts-workflow-distributed-execution

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：P3 — Workflow 执行范式 / Workflow 生产硬化

状态：candidate
类型：扩展候选 change
主要 owner：待定（预期 `agent-workflow` + runtime shared-state/gateway）
依赖：进入实施前重新审查

目标：
- 不纳入最小 workflow 主线。
- 后续承接 workflow 多实例执行、ready node / branch 分发、single-owner claim、跨实例 join barrier 和 distributed recovery coordination。

共享规格输入：

- 同一 `node attempt` 在任意时刻只能有一个执行 owner。
- 不同 ready node 或 branch 可以分散到不同实例推进。
- distributed execution 不得改变单机模式下的 graph 语义、`nodeResults` 语义和 `contextVariables` 语义。
- 进入实施前必须先对齐并等待 `add-ts-runtime-multi-instance-consistency`、`add-ts-runtime-failure-takeover` 归档。
- Workflow distributed execution 不依赖当前请求的跨实例 `LIVE_ONLY` stream 迁移。

实现约束：

- 不得回写到 `add-ts-workflow-execution-engine` 最小主线。
- 如需新增 attempt / branch / claim contract，必须先提出 contract refinement change。

后续维护：

- 本文件承载分布式 workflow 执行的详细输入；未创建正式 OpenSpec change 前，不得把这些能力写回当前 active workflow changes。
