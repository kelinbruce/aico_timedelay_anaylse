# add-ts-workflow-recipe-classification-fields

## Context

本 change 起源于 ADNClaw 的 durable recipe registry 设计。经 NextAgent 评估确认：

1. recipe 是配置期静态资产，从 `agents/{agentId}/recipes/` 目录加载，不需要 durable store。
2. recipe 的 discovery 应与 agent-owned skill 一致：运行时全量目录扫描，无需启动期索引或显式 binding。
3. `RecipeDefinition` 缺少业务分类字段，分类信息散落 `metadata` 无法被 routing 显式消费。

本 change 的实际范围：
- 在 `RecipeDefinition` 新增 `domain`/`scene`/`lang` 业务分类字段
- recipe capability provider 改为 default-enabled search provider，`search` 每次全量扫描目录（与 agent-owned skill 一致），`require` 按需懒加载完整 DSL 并缓存
- recipe 文件格式收窄为 YAML 优先


## Implementation-vs-Spec Gap

当前代码行为与目标 spec 存在以下 gap，本 change 负责消除：

- **gap 1：启动期索引加载 + binding → 运行时目录扫描 + default-enabled。** 现有 `workflow-recipe-loader.ts` 在启动期扫描目录注册索引，`attachRecipeCapabilitiesToAssemblies` 在启动期为每个 recipe 生成 explicit `capabilityBindings`。目标 spec 改为 `search` 每次调用时全量扫描目录（与 agent-owned skill 一致），recipe provider 作为 default-enabled trusted search provider，无需显式 binding。需改 recipe definition source、capability provider search 逻辑，并移除 `attachRecipeCapabilitiesToAssemblies`。
- **gap 2：支持 .json → 仅 YAML。** 现有 `supportedRecipeExtensions` 包含 `.json`/`.yaml`/`.yml`。目标 spec 收窄为仅 `.yaml`/`.yml`。（已实现）
- **gap 3：RecipeDefinition 缺分类字段。** 现有 `RecipeDefinitionSchema` 无 `domain`/`scene`/`lang` 字段。目标 spec 新增三个可选字段。（已实现）
- **gap 4：require 索引定位 → 目录扫描定位。** 现有 recipe definition source `require` 在缓存 miss 时从启动期注册的索引中查找文件路径。目标 spec 改为缓存 miss 时扫描 `agents/{agentId}/recipes/` 目录定位匹配 `recipeName` 的文件，再懒加载完整 DSL。

## 第一性原理

**会什么：** 给 `RecipeDefinition` 增加三个可选业务分类字段；recipe discovery 改为运行时全量目录扫描（与 agent-owned skill 一致），`require` 按需懒加载完整 DSL 到内存并缓存。

**解决什么问题：**
- 分类信息从 `metadata` 散落状态提升为一等 contract 字段，供 routing/dispatch 显式消费
- recipe discovery 与 agent-owned skill 对齐：运行时新增 recipe 文件即可被发现，无需重启或显式 binding
- `require` 只加载被执行的 recipe 的完整 DSL，减少内存占用

**目标：** `RecipeDefinition` 新增分类字段；recipe capability provider 改为 default-enabled search provider（`search` 全量扫描目录），`require` 懒加载+缓存完整 DSL；文件格式 YAML 优先。

**边界：** 不做持久化、不做 gateway、不做级联删除、不改 `require` 同步签名、不做 routing policy、不支持 TS 注册、不支持 JSON。

**输入：** recipe YAML 文件（含可选 `domain`/`scene`/`lang` 顶层字段）。

**输出：** 运行时 `search` 将 Recipe 静态资源发布为 WORKFLOW capability descriptor 进入 catalog；执行期 `require` 返回完整 `RecipeDefinition`（懒加载+缓存）。

**黑盒效果：**
- `search(agentId)`：扫描 `agents/{agentId}/recipes/*.yaml`，解析 `recipeName`/`domain`/`scene`/`lang`/`description`，产出 WORKFLOW descriptors
- 执行期 `require(agentId, recipeName)`：缓存命中 → 直接返回；缓存 miss → 扫描目录定位文件 → 加载完整 DSL（含 `flowGraph`）→ 缓存 → 返回
- 重复 `require` 同一 recipe：命中缓存，零拷贝返回
- recipe YAML 不含分类字段 → descriptor 中对应字段为 `undefined`，recipe 仍合法
- 目录无 YAML 文件 → `search` 返回空列表（非错误），routing 自然回退 model loop
- 运行时新增 recipe 文件 → 下次 `search` 调用即可发现，无需重启
- 无 durable store、无 gateway、无新表

## Goals / Non-Goals

**Goals:**
- `RecipeDefinitionSchema` 新增 `domain`/`scene`/`lang` 可选字段
- recipe capability provider 改为 default-enabled search provider，`search` 每次全量扫描目录产出 `kind="WORKFLOW"` descriptor（与 agent-owned skill 一致）
- `require` 懒加载完整 DSL 并缓存；缓存 miss 时扫描目录定位文件
- recipe 文件格式仅支持 `.yaml`/`.yml`
- 显式声明 recipe 加载策略为运行时目录扫描，排除 durable store

**Non-Goals:**
- 不引入 `RecipeStoreGateway`/`RecipeRecord`
- 不实现持久化、版本历史
- 不实现文件监听（file watcher）或自动热加载通知；运行时按需扫描目录是 discovery 行为，不是热加载
- 保持 recipe definition source 执行期 `require(agentId, recipeName)` 同步签名不变
- 不支持 TS 代码注册（deferred）
- 不支持 JSON 格式（首版 YAML 优先）
- 不 owner agent 级联删除
- 不实现 routing policy

## Decisions

1. **加载策略为运行时目录扫描 + 懒加载，非持久化。** recipe 是配置期静态资产，从 `agents/{agentId}/recipes/` 目录加载。`search` 每次被 catalog 调用时全量扫描目录，解析索引字段并产出 WORKFLOW capability descriptor（与 agent-owned skill 的 `scanRoot` 一致）。`require` 在缓存 miss 时扫描目录定位文件、加载完整 DSL、缓存到内存。不引入 `RecipeStoreGateway` 或 `RecipeRecord`。不保留启动期索引缓存。

2. **search 全量扫描目录，无启动期索引。** `search(criteria)` 每次调用时从 `agents/{agentId}/recipes/` 递归收集 `.yaml`/`.yml` 文件，解析每个文件的索引字段（`recipeName`/`domain`/`scene`/`lang`/`description`），将静态 Recipe 资源发布为 `CapabilityDescriptor(kind="WORKFLOW")`。不全量解析 `flowGraph`。无持久状态，每次调用独立扫描。这与 agent-owned skill discovery 的 `scanRoot` 行为完全一致。运行时新增 recipe 文件在下次 `search` 调用时即可被发现。

3. **`require` 缓存 miss 时扫描目录定位文件。** `require(agentId, recipeName)` 签名不变（同步）。内部行为：缓存命中 → 返回；缓存 miss → 扫描 `agents/{agentId}/recipes/` 目录定位匹配 `recipeName` 的文件 → `parseBuiltInConfig` 解析 → `normalizeRecipeDefinition` 归一 → `RecipeDefinitionSchema` 校验 → 缓存 → 返回。目录中无匹配 → `AgentError`（`RECIPE_NOT_FOUND`）。

4. **`require` 保持同步签名。** 执行期懒加载用 `readFileSync`/`readdirSync` 同步读文件。recipe 文件是本地配置资产（非远程、非 Gateway），读取耗时极短且确定，不属于架构约束 `[TS] 异步执行边界` 所定义的慢边界。`resolveRecipeDefinition` 回调保持同步签名不变，engine 和下游消费方零改动。`search` 为 async（由 catalog 调用），但内部文件操作使用同步 fs API（与启动期 `readFileSync` 同类）。

5. **`agentId` 等同于 `agentName`。** recipe 的 agent 归属由加载目录 `agents/{agentId}/recipes/` 决定，不在 `RecipeDefinition` 中引入独立 `agentName` 字段。

6. **新增 `domain`/`scene`/`lang` 三个可选字段。** 电信网络场景的业务分类维度，`domain`/`scene` 使用自由文本 schema（maxLength 512，无 pattern，允许中文，与 1.0 DSL 规范一致），`lang` 使用 `zh`/`en` 枚举 schema，归 `workflow-contracts` 的 `RecipeDefinition` requirement。

7. **`expandFields` 不重新引入。** v1 的 `expandFields` 已被 `refine-ts-workflow-recipe-v2-contracts` 归一映射到 `metadata`。

8. **文件格式 YAML 优先，暂不支持 JSON。** 首版只扫描 `.yaml`/`.yml`，不扫描 `.json`。TS 代码注册 deferred 到未来 change。

9. **recipe provider 是 default-enabled trusted search provider。** recipe capability provider 的 `providerId` 加入 `isDefaultEnabledSearchDiscovery` 判断列表（与 `local-skills-agent-owned`/`local-skills-runtime-generated`/`local-subagents` 同类）。catalog 在 `searchDefaultEnabledProviders` 中调用 recipe provider 的 `search()`，无需 Agent assembly 显式 binding。这消除了 `attachRecipeCapabilitiesToAssemblies` 的 binding 创建需求，使运行时新增 recipe 可被路由发现。

10. **`AgentAssembly.recipeIds` 降级为 informational metadata。** 移除 `attachRecipeCapabilitiesToAssemblies` 后，`recipeIds` 不再被填充，永远为 `undefined`。该字段由 `add-ts-workflow-engine-contracts` 定义，本 change 不修改其 contract。`create-app.ts` 热更逻辑 `activeAssembly.recipeIds === undefined ? nextAssembly : ...` 总走 `nextAssembly` 分支（无害）。`agent-routing-core.test.ts` 的 "routes by recipe capability even when assembly recipeIds metadata is stale" 测试在 `undefined` 状态下仍通过（catalog resolve 不依赖 `recipeIds`，走 `searchDefaultEnabledProviders`）。`recipeIds` 的 contract 清理留给未来 change。

11. **`require` 用构造器注入的 `agentsRoot` 做同步目录扫描。** `require` 保持同步签名，不能使用 async `agentPackageSourceLocator.locate()`。`WorkflowRecipeDefinitionSource` 构造器接收 `agentsRoot`（直接来自 `DefaultSystemConfig.paths.agentsRoot` 配置值，即 `agents/` 目录本身），`require` 用 `join(agentsRoot, agentId, "recipes")` + `readdirSync` 同步扫描目录。`search` 也用同样的路径构造（async 签名，同步 fs 实现），两者目录解析逻辑一致。`createRecipeDefinitionSourceForAssemblies` 从 `assembly-composition.ts` 接收 `systemConfig.paths.agentsRoot`，与 Agent package discovery 使用的 `agentsRoot` 保持一致，确保 `paths.agentRoot` 配置同时生效于 agent 定义加载和 recipe 加载。
12. **DSL 缓存 per-agent FIFO 淘汰，硬编码上限 100，不可配置。** `definitionsByAgentId` 是 per-agent 的 `Map<RecipeName, RecipeDefinition>` 缓存。缓存有界：当某 agent 的缓存条目数达到 100 时，`require` 在插入新条目前移除最早插入的条目（FIFO，利用 JS `Map` 的插入顺序语义，`keys().next().value` 取最早 key）。上限 100 覆盖典型 < 100 recipe 的全量场景，避免 working set thrashing。不暴露配置项——recipe 是配置期静态资产，缓存有界性由部署配置决定，不是运行时调优参数。如未来需调优，从 100 这个经验值出发用数据驱动。淘汰后的 recipe 在下次 `require` 时重新从目录加载。


## 质量属性审视

- **安全：** `agentId` 来自可信 app composition（非请求体），recipe 按 `agentId` 隔离；路径逃逸防护（`Recipe Path Ownership` 约束 + `assertTrustedFilePath`/`assertTrustedRecipeDirectory` realpath 校验）；symlink 跳过；`domain`/`scene` 长度上限 512 防膨胀，`lang` 枚举约束防注入。验证入口：architecture test + negative test。
- **性能/容量：** `search` 每次调用全量扫描目录并解析索引字段（与 agent-owned skill `scanRoot` 一致）；recipe 数量通常 < 100，单次扫描耗时极短；`require` 懒加载只加载被执行的 recipe 的完整 DSL，per-agent FIFO 缓存（硬编码上限 100）避免重复 IO 且防止极端场景缓存膨胀。不适用理由：recipe 数量通常 < 100，缓存上限 100 覆盖全量场景，无容量瓶颈。
- **可靠性/恢复：** recipe 是配置期静态资产，无 durable 状态需恢复；`search` 无持久状态，每次调用独立扫描；`require` 校验失败抛 `AgentError`（`RECIPE_INVALID`），不缓存，请求失败不污染后续。验证入口：`npm test` + Lazy Load Validation Failure 测试。
- **可维护性：** `require` 签名不变，下游消费方零改动；recipe discovery 与 agent-owned skill 模式对齐，降低认知负担。验证入口：code review 检查点。
- **可测试性：** schema 校验、search 目录扫描、require 懒加载缓存、passthrough、JSON 排除、空目录、校验失败、recipe not found 均有独立测试。验证入口：`npm test` + `npm run test:contract`。
- **审计/可追溯性：** 非法 recipe 产出 diagnostic log（`workflow.recipe.skip`）；recipe 加载无 durable 事实、无 audit、无 metric（配置加载非运行时事实）。

## Recipe 加载链路

### 运行时（目录扫描 search）

1. catalog `resolve`/`listAvailable` 调用 recipe provider 的 `search(criteria)`
2. `search` 从 `agents/{agentId}/recipes/` 递归收集 `.yaml`/`.yml` 文件（不收集 `.json`）
3. symlink 跳过、路径逃逸防护
4. `parseBuiltInConfig` 解析 → 提取索引字段（`recipeName`/`domain`/`scene`/`lang`/`description`）
5. 产出 `CapabilityDescriptor(kind="WORKFLOW")` 列表，不全量解析 `flowGraph`
6. 非法 recipe diagnostic + skip，继续其他

### 执行期（懒加载完整 DSL require）

1. `resolveRecipeDefinition(request)` → `recipeDefinitionSource.require(agentId, recipeName)`
2. 命中缓存 → 直接返回完整 `RecipeDefinition`
3. 未命中 → 扫描 `agents/{agentId}/recipes/` 目录定位匹配 `recipeName` 的文件 → `parseBuiltInConfig` 解析 → `normalizeRecipeDefinition` v1→v2 归一（含 `domain`/`scene`/`lang` 透传）→ `RecipeDefinitionSchema` 校验 → 缓存 → 返回
4. 目录中无匹配 → `AgentError`（`RECIPE_NOT_FOUND`）
5. 校验失败 → `AgentError`（`RECIPE_INVALID`），不缓存

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/workflow-contracts/spec.md`：`RecipeDefinition` 补充 `domain`/`scene`/`lang` 字段
- `openspec/specs/workflow-package/spec.md`：`Local Recipe Loading` 改为运行时目录扫描 + 懒加载 + YAML 优先
- `openspec/designs/architecture/workflow-contracts.md`：补充 recipe 业务分类维度和运行时扫描策略
- `openspec/designs/modules/agent-workflow.md`：明确 recipe 运行时目录扫描策略
- `openspec/designs/spec-to-design-map.md`：补充导航

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.2-加载和匹配配方` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/workflow-contracts/spec.md`、`openspec/specs/workflow-package/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
