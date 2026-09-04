## Why

当前 `RecipeDefinition`（由 `refine-ts-workflow-recipe-v2-contracts` 扩展）已收敛 `runtime`/`inputs`/`metadata`/`presentation` 等 v2 结构化字段，但缺少业务分类维度。电信网络场景中 recipe 需要按 domain（业务域）、scene（场景）、lang（语言）分类检索和路由，当前 contract 无这些一等字段，分类信息只能散落在 `metadata` 中，无法被 routing/dispatch 显式消费。

同时，当前 recipe discovery 在启动期扫描目录注册索引，并通过 `attachRecipeCapabilitiesToAssemblies` 为每个 recipe 生成 explicit `capabilityBindings`。这导致运行时新增的 recipe 文件无法被路由发现（没有 binding → catalog 过滤掉 → 路由看不到 → 回退 agent loop → `require` 不被调用）。agent-owned skill 已采用运行时全量目录扫描 + default-enabled provider 模式，recipe 应与之一致。

本 change 收口三个事项：
- 在 `RecipeDefinition` 新增 `domain`/`scene`/`lang` 业务分类字段
- recipe discovery 改为运行时全量目录扫描（与 agent-owned skill 一致）：`search` 每次调用时扫描目录，`require` 按需懒加载完整 DSL 并缓存；recipe provider 作为 default-enabled trusted search provider，无需显式 binding
- 明确 recipe 输入格式为 YAML 优先（暂不支持 JSON），未来考虑 TS 代码注册（deferred）

## What Changes

- **扩展** `RecipeDefinition`（MODIFIED `workflow-contracts`）：新增可选 `domain`/`scene`/`lang` 业务分类字段，`domain`/`scene` 使用自由文本 schema（maxLength 512，无 pattern，允许中文，与 1.0 DSL 规范一致），`lang` 使用 `zh`/`en` 枚举 schema
- **扩展** `Local Recipe Loading`（MODIFIED `workflow-package`）：
  - recipe capability provider 改为 default-enabled search provider（与 agent-owned skill 一致），`search` 每次调用时全量扫描 `agents/{agentId}/recipes/` 目录并将静态资源发布为 `CapabilityDescriptor(kind="WORKFLOW")`
  - 移除启动期索引加载和 `attachRecipeCapabilitiesToAssemblies` binding 创建
  - `require` 在缓存 miss 时扫描目录定位文件，懒加载完整 DSL 并缓存
  - recipe 文件格式仅支持 `.yaml`/`.yml`，暂不支持 `.json`
- **明确** agent 归属：`agentId` 等同于 `agentName`，由加载目录决定，不在 `RecipeDefinition` 中引入独立 `agentName` 字段
- **明确** `expandFields` 状态：v1 字段，v2 已归入 `metadata`，本 change 不重新引入

## Non-Goals

- 不引入 `RecipeStoreGateway` port 或 `RecipeRecord` persistence DTO
- 不实现 recipe 持久化入库、版本历史
- 不实现文件监听（file watcher）或自动热加载通知；运行时按需扫描目录是 discovery 行为，不是热加载
- 保持 recipe definition source 对执行期的 `require(agentId, recipeName)` 同步语义，但 `require` 从"索引定位"变为"目录扫描定位 + 懒加载 + 缓存"
- 不支持 TS 代码注册 recipe（deferred，未来 change 承接）
- 不支持 JSON 格式 recipe 文件（首版 YAML 优先）
- 不 owner agent 删除级联（由独立 change 跟踪）
- 不改变 `RecipeDefinition` 的 `flowGraph`/`runtime`/`inputs`/`metadata`/`presentation` 字段定义（由 `refine-ts-workflow-recipe-v2-contracts` owner）
- 不实现基于 `domain`/`scene`/`lang` 的 routing policy（由 `add-ts-workflow-orchestration-policy` 承接）

## Capabilities

### 修改的 Capability

- `workflow-contracts`：`RecipeDefinition` 新增 `domain`/`scene`/`lang` 可选字段
- `workflow-package`：`Local Recipe Loading` 改为运行时目录扫描 + 懒加载；文件格式收窄为 YAML；recipe provider 改为 default-enabled
