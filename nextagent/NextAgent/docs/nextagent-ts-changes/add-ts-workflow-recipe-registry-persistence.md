# add-ts-workflow-recipe-registry-persistence

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：P3 — Workflow 执行范式 / Workflow 生产硬化

状态：candidate
类型：实施 change
主要 owner：`agent-core` + `agent-platform-gateway-local`
依赖：`add-ts-workflow-routing`、`add-ts-workflow-package-composition`、`add-ts-workflow-engine-contracts`

目标：
- 将内存 `RecipeRegistry` 升级为 durable，进程重启后从 durable store 加载，保持现有内存读路径不变。

规格输入：

- 新增 `RecipeStoreGateway` port：作为 recipe 持久化的唯一 gateway boundary，承载 `RecipeRecord` 的 CRUD。
- 新增 `RecipeRecord`：gateway persistence-only DTO，显式携带 `agentId`、`tenantId`、`subjectId` owner scope 字段和 `recipeName`、`version`、`domain`、`flowGraph` 等 recipe 事实。
- 权威路径决策：durable store 为权威源，本地文件加载降级为可选 bootstrap；启动期从 `RecipeStoreGateway` 加载 recipe 到内存 `RecipeRegistry`，保持现有内存读路径（`require`/`list`）不变。
- recipe 写入路径：支持注册/更新/删除 recipe 到 durable store，经 gateway 完成持久化后刷新内存 registry。
- owner scope：recipe 按业务唯一键 `(domain, scene, lang, agentName, expandFields, recipeName)` 联合唯一，持久化加 `agentId` 前缀形成 7 字段唯一约束；查询 MUST 显式携带 `agentId`，不得只按 `tenantId`/`subjectId` 查询。
- agent 删除级联：trusted agent scope 删除时，该 `agentId` 下所有 recipe 行级联删除（单事务批量），不留孤儿。

契约输入：

- `RecipeStoreGateway`、`RecipeRecord` 归 `agent-contracts/gateway`。
- `RecipeDefinition` 契约不变（由 `engine-contracts` owner）；`RecipeRecord` 是 gateway persistence DTO，不作为领域 service 返回值或 Web response。

实现约束：

- 不改变 `RecipeDefinition` 的字段定义（由 `engine-contracts` owner）。
- 不实现 recipe 版本历史/回滚（首版只保留当前版本）。
- 不实现 recipe 热加载/watch/文件监听。
- 不 owner workflow execution 恢复（由 `persistence-recovery` 承接）。
- 不 owner workflow event history（由 `event-history` 承接）。
- 不改变 `RecipeRegistry` 内存读接口（`require`/`list` 签名不变）。

非目标：

- recipe 版本历史/回滚
- recipe 热加载/watch/文件监听
- workflow execution 恢复
- workflow event history
- recipe 多租户隔离的 RBAC 策略（owner scope 隔离已足够）

验收要点：

- integration test：durable 加载、写入、owner scope 隔离
- integration test：agent 删除级联清理 recipe，不留孤儿
- contract test：`RecipeRecord` 不作为领域 service 返回值或 Web response
- architecture test：查询显式携带 `agentId`，不新增第二套 recipe 加载主路径

并行边界：

- `workflow-routing`：继续 owner `RecipeRegistry` 内存读接口；本 change 只注入 durable 加载和写入路径。
- `workflow-package-composition`：继续 owner 启动期 wiring；本地文件加载降级为可选 bootstrap，durable store 为权威源。
- `workflow-engine-contracts`：继续 owner `RecipeDefinition`/`FlowGraph` 契约；本 change 引用但不重定义。