# add-ts-workflow-package-composition

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：P3 — Workflow 执行范式

状态：candidate
类型：实施 change
主要 owner：`agent-workflow`、`agent-app`
依赖：`establish-ts-backend-architecture`、`add-ts-workflow-engine-contracts`

目标：
- 创建 `agent-workflow` package。
- 在 `agent-app` 中完成 workflow service wiring。
- 在启动期加载本地 recipe 文件并注入内存 `RecipeRegistry`。

规格输入：

- `packages/agent-workflow/` 是 workflow 实现载体。
- `agent-app` 负责 startup wiring。
- 本地 recipe 只来自 `agents/{agentId}/recipes/` 或其受控配置覆盖。
- recipe 文件在 startup 期解析、校验并注册到内存 `RecipeRegistry`。

实现约束：

- 本 change 只做 package skeleton、factory wiring、startup local recipe load。
- 本 change 不得定义 routing strategy。
- 本 change 不得定义 recipe durable store；若需要 durable registry，后置到 `add-ts-workflow-recipe-registry-persistence`。
- 本 change 不得定义 workflow snapshot/recovery；后置到 `add-ts-workflow-persistence-recovery`。
- 本 change 不得定义 event durable history；后置到 `add-ts-workflow-event-history`。
- 路径配置只允许 workspace 内相对路径。

非目标：

- recipe marketplace / remote registry
- recipe hot reload
- workflow engine 调度逻辑
- recipe 数据库存储

验收要点：

- architecture test：package 依赖方向正确
- integration test：workflow service 被正确创建并注入
- integration test：合法 recipe 被注册；非法 recipe 被跳过
- security test：绝对路径 / workspace 外路径被拒绝

并行边界：

- local file recipe load 属于本 change。
- runtime dispatch 不属于本 change，归 `add-ts-workflow-routing`。
- execution engine 不属于本 change，归 `add-ts-workflow-execution-engine`。
