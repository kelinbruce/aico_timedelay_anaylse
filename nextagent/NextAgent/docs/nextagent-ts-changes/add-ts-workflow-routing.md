# add-ts-workflow-routing

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：P3 — Workflow 执行范式

状态：candidate
类型：实施 change
主要 owner：`agent-core`
依赖：`add-ts-workflow-engine-contracts`、`add-ts-workflow-package-composition`

目标：
- 在 agent-core 中新增 workflow routing 分支。
- 通过 `RecipeRegistry` 决定请求进入 workflow 还是回退 conversation loop。
- workflow routing 作为 agent-core routing policy 的受控特例分支接入，而不是形成第二套路由主入口。

规格输入：

- `RecipeRegistry` 是 agent-core 内部内存组件。
- 显式 `recipeName` 优先于意图匹配。
- 未命中 recipe 时必须稳定回退现有 conversation loop。
- 如保留 intent match，它只用于产出 routing decision。
- workflow routing 必须挂接在 `add-ts-agent-routing-core` 定义的 agent-core routing policy 主入口之下。
- workflow routing 不得绕过通用 routing evidence、constraint governance 或 owner scope 校验。

实现约束：

- 本 change 不得定义 recipe durable store；若需要落库，后置到 `add-ts-workflow-recipe-registry-persistence`。
- 本 change 不得定义 workflow event table 或 durable history；后置到 `add-ts-workflow-event-history`。
- 本 change 不得重新定义 timeline、stream projection 或 terminal commit 规则。
- YAML 扫描和 schema 校验不属于本 change，归 `add-ts-workflow-package-composition`。
- 如启用 workflow intent match，它只是 agent-core routing policy 的 workflow-specific decision step，不是独立 routing owner。
- 本 change 不得引入独立于 `add-ts-agent-routing-core` 的第二套路由配置入口或第二套 routing evidence 机制。

非目标：

- recipe 数据库存储
- workflow event durable store
- workflow execution history query
- recipe marketplace / hot reload

验收要点：

- integration test：显式 `recipeName` 命中时分发到 workflow
- integration test：未命中时回退 conversation loop
- integration test：`RecipeRegistry` register / require / list 行为稳定
- architecture test：只依赖 workflow port，不依赖实现包

并行边界：

- routing owner 只在 `agent-core`
- execution owner 在 `agent-workflow`
- persistence owner 不在本 change
- 通用 routing policy owner 在 `add-ts-agent-routing-core`；本 change 只补 workflow 分支。
