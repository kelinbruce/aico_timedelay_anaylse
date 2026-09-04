## 背景和现状（Context）

workflow routing 是 agent-core routing 的一个新分支，但它不应该拥有 recipe durable store、timeline event persistence 或 terminal commit 规则。这些都属于别的 owner。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 通过 capability catalog 解析 `WORKFLOW` capability
- 提供 trusted request-carried `targetRecipe`
- 决定请求是否进入 workflow path
- 未命中时稳定降级 conversation loop

**非目标：**
- 不做 recipe 数据库存储
- 不做 workflow event 持久化
- 不重定义 stream / timeline / terminal commit

## 设计决策（Decisions）

1. recipe 与 skill 同属 capability 类别，`agent-core` MUST NOT 拥有独立 `RecipeRegistry`
2. 显式 `routingConstraints.targetRecipe` 优先
3. 未命中一律回退 conversation loop
4. intent match 即使保留，也只作为 routing 输入，不产生 durable side effect

## Routing Path

1. 请求带显式 `routingConstraints.targetRecipe`
2. `CapabilityCatalog.resolve(..., capabilityId = targetRecipe)` 命中 `kind === "WORKFLOW"`
3. 命中 -> 调用 `WorkflowExecutionService.execute()`
4. 未命中 -> 回退 conversation loop

若启用 intent match：
1. capability catalog 形成当前 Agent Scope 可见的 `WORKFLOW` 候选集
2. 轻量分类得到 `recipeName | undefined`
3. 命中则进入 workflow；否则 conversation loop

## Result Boundary

本 change 只负责“把请求交给 workflow service”。
workflow 执行结果如何映射到 timeline、terminal commit、message durable facts，不在本 change 冻结。

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `targetRecipe` trusted carry | T0 | contract / channel / runtime tests |
| 显式 dispatch | T1 | integration |
| fallback to conversation loop | T2 | integration |
| recipe capability 行为 | T3 | integration |
| 依赖边界 | T4 | architecture |

## Boot Recipe 不自动进入

baseline spec 中的 "Boot Recipe Routing" requirement 描述了请求未携带显式 `targetRecipe` 时自动检查 boot-recipe 并进入 workflow 的行为。实际实现中 `DefaultAgentRoutingPolicy.decide()` 不检查 `RecipeDefinition.type` 字段，不存在 boot-recipe 自动进入逻辑。

当前 workflow 进入路径仅有三种显式方式：
1. Capability directive `$workflow:<name>` → 解析为 targetRecipe → 校验 WORKFLOW capability → `DETERMINISTIC_FLOW`
2. Trusted `routingConstraints.targetRecipe` → 校验 WORKFLOW capability → `DETERMINISTIC_FLOW`
3. Routing policy rule（assembly `routing.mode === "policy"`）→ regex 命中 recipe target → 校验 WORKFLOW capability → `DETERMINISTIC_FLOW`

以上均不命中时回退 `MODEL_DRIVEN_LOOP`（conversation loop）。`RecipeDefinition.type` 字段在 schema 中保留但不被 routing 消费。

本 change 通过 MODIFIED requirement 修正 baseline spec，明确 boot-recipe 自动进入未实现。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.2-加载和匹配配方` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/workflow-routing/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。

## 归档阻塞记录（2026-07-31）

- **状态：**保持 active，禁止使用 `--skip-specs`。
- **原因：**`workflow-routing` 的 capability routing、dispatch、workflow routing 与 boot recipe Requirements 均与 stable 正文不同。
- **解除条件：**逐 Requirement 建立 delta、stable target、Function 与长期设计的双端映射；确认正文、元数据、Scenario 和任何 REMOVED→ADDED/MODIFIED 迁移均完整同步后，再重新执行 archive。
