# Design

## 背景与目标

`decideAgentRoutingPolicy()` 在插件返回 resolution 时将全部决策权委托给插件，跳过 `DefaultAgentRoutingPolicy.decide()` 的全部逻辑。这意味着用户显式指定（指令、约束）和 Agent 配置的 policy 规则在插件路径上完全依赖插件自律。

本 change 的目标是把显式路由解析提取为独立阶段，在任何路由策略实现之前执行。显式指定命中或 miss 时框架直接决策，路由策略实现不被调用。policy 规则未匹配或无显式指定时委托给路由策略实现。

## 当前实现

### `decideAgentRoutingPolicy()` 委托逻辑

```
policyResolver === undefined?
  -> DefaultAgentRoutingPolicy.decide()           (built-in 全链路)
  -> policyResolver.resolve()
    -> undefined? DefaultAgentRoutingPolicy.decide()  (built-in 全链路)
    -> resolution? executeResolvedAgentRoutingPolicy() (plugin 全链路)
```

`DefaultAgentRoutingPolicy.decide()` 内部按顺序处理：abort 守卫 -> assembly 守卫 -> capability 守卫 -> 指令解析 -> targetRecipe 约束 -> mode=policy 规则（含 targetSkill 短路）-> 默认模型循环。

`executeResolvedAgentRoutingPolicy()` 只做结果词汇表校验和异常 fail-closed，不执行任何指令解析或约束治理。

### directive normalization

`normalizeCapabilityDirectiveInput` 在 runtime composition 层作为 `acceptedInputProjector` 执行，在请求进入 Agent 边界之前剥离指令 token 并生成 `routingConstraints.targetSkill` / `targetRecipe`。到 `decide()` 被调用时，`acceptedInputText` 已不含指令 token，`routingConstraints` 已携带 directive-derived target。指令冲突和非法指令在 normalization 阶段以原始文本到达 routing。

## 修改方案

### 方案选择

提取 `DefaultAgentRoutingPolicy` 的显式路由解析为独立方法 `resolveExplicitRouting()`，在 `decideAgentRoutingPolicy()` 中始终先调用。当该方法返回非 `undefined` 时，直接采用其决策。当返回 `undefined` 时，委托给路由策略实现。

### 1. 提取 `resolveExplicitRouting()`

从 `DefaultAgentRoutingPolicy.decide()` 提取以下逻辑为独立方法，按顺序短路求值：

1. abort 守卫（`signal.aborted` -> 抛 `ROUTING_ABORTED`）
2. assembly 守卫（`assemblyRegistry.require()` -> 抛 `ROUTING_ASSEMBLY_UNAVAILABLE`）
3. capability 守卫（`assertCapabilityGovernanceViewAvailable()` -> 抛 `ROUTING_CAPABILITY_VIEW_UNAVAILABLE`）
4. 指令解析（`parseCapabilityDirective(context.acceptedInputText)`）
   - skill -> `DETERMINISTIC_FLOW` + `skillName` + `CAPABILITY_DIRECTIVE_SKILL_MATCHED`
   - workflow + recipe 可用 -> `DETERMINISTIC_FLOW` + `recipeName` + `CAPABILITY_DIRECTIVE_WORKFLOW_MATCHED`
   - workflow + recipe miss -> `MODEL_DRIVEN_LOOP` + `CAPABILITY_DIRECTIVE_WORKFLOW_MISS_FALLBACK`
   - invalid -> `REJECT` + `CAPABILITY_DIRECTIVE_INVALID`
   - ambiguous -> `REJECT` + `CAPABILITY_DIRECTIVE_AMBIGUOUS`
   - none -> 继续
5. targetRecipe 约束（`context.routingConstraints?.targetRecipe`）
   - 可用 -> `DETERMINISTIC_FLOW` + `recipeName` + `TARGET_RECIPE_MATCHED`
   - miss -> `MODEL_DRIVEN_LOOP` + `TARGET_RECIPE_MISS_FALLBACK`
   - 无 -> 继续
6. targetSkill 约束（`context.routingConstraints?.targetSkill`）
   - 存在 -> `MODEL_DRIVEN_LOOP` + `POLICY_RULE_TARGET_SKILL_PRIORITY`
   - 无 -> 继续
7. mode=policy 规则匹配（`matchPolicyRule()`）
   - 命中 + target 可用 -> `DETERMINISTIC_FLOW` + 对应 `safeReason`
   - 命中 + target miss -> `MODEL_DRIVEN_LOOP` + `POLICY_RULE_SKILL_MISS_FALLBACK` / `POLICY_RULE_WORKFLOW_MISS_FALLBACK`
   - 未匹配 -> 返回 `undefined`（委托给路由策略实现）

当步骤 1-6 命中时，返回 `AgentRoutingDecision`。当步骤 7 规则未匹配、无规则或 `mode != policy` 时，返回 `undefined`，表示"无显式指定"，委托给路由策略实现。`mode != policy` 时无 policy 规则可匹配，与规则未匹配一样返回 `undefined`——这是行为变更：当前 `mode=default` 直接返回 `DEFAULT_MODEL_DRIVEN_LOOP`，改后委托给插件（如有）。

当 `resolveExplicitRouting()` 抛出 `AgentError`（守卫失败）时，异常直接传播，路由策略实现 MUST NOT 被调用。

### 2. 修改 `decideAgentRoutingPolicy()`

```
1. explicitDecision = defaultPolicy.resolveExplicitRouting(run, context, signal)
2. explicitDecision !== undefined? -> return explicitDecision
3. policyResolver === undefined? -> return default MODEL_DRIVEN_LOOP + DEFAULT_MODEL_DRIVEN_LOOP
4. policyResolver.resolve()
   -> undefined? -> return default MODEL_DRIVEN_LOOP + DEFAULT_MODEL_DRIVEN_LOOP
   -> resolution? -> executeResolvedAgentRoutingPolicy(resolution, run, context, signal)
```

### 3. 保留 `decide()` 公共接口

`DefaultAgentRoutingPolicy.decide()` 仍实现 `AgentRoutingPolicy` 接口。内部实现改为先调 `resolveExplicitRouting()`（后者已包含全部显式路由解析逻辑），再返回默认 `MODEL_DRIVEN_LOOP`。`decide()` 的外部行为不变——既有直接调用 `decide()` 的测试和代码路径仍获得相同的路由决策。

### 4. 不新增原因码

显式路由解析产生的决策使用既有原因码。路由策略实现产生的决策使用各自的 `safeReason`。路由证据记录的是最终决策的 `safeReason`，不增加中间委托事件。

### 5. 与既有代码的关系

当前代码的 `mode=policy` 分支不处理 `targetSkill` 约束（无 targetSkill 短路），且 `matchPolicyRule()` 命中后只对 `recipeName` 做可用性校验，不对 `skillName` 做可用性校验。本 change 在 `resolveExplicitRouting()` 步骤 6 新增 targetSkill 约束检测（返回 `MODEL_DRIVEN_LOOP` + `POLICY_RULE_TARGET_SKILL_PRIORITY`），并在步骤 7 对 policy 规则命中的 `skillName` 增加可用性校验（miss 时返回 `MODEL_DRIVEN_LOOP` + `POLICY_RULE_SKILL_MISS_FALLBACK`）。这两者是本 change 引入的新行为，与 `directive-capability-routing` spec 的 targetSkill 治理语义一致。

## 质量属性影响

### 安全

- 显式指定（指令、约束、policy 规则）不再依赖插件自律。即使插件完全忽略指令，框架仍会解析并产生决策。

### 可靠性/恢复

- miss 降级行为在框架级一致执行，不因插件实现不同而改变。
- plugin policy execution failure、timeout 或非法结果仍 fail closed。

### 可维护性

- 插件只需处理"无显式指定"的策略选择，无需重复实现指令解析和约束治理。
- `resolveExplicitRouting()` 职责单一，可独立测试。

## 长期基线刷新计划

归档前需同步：

- `openspec/specs/agent-routing-core/spec.md`：合入新增的 `显式路由指定优先于路由策略实现` Requirement。
- `openspec/specs/agent-scoped-plugin-composition/spec.md`：合入修改后的 `Policy plugins use an explicit open policy inventory` Requirement。
- `openspec/designs/architecture/agent-plugin-composition.md`：更新 routing adapter 委托行为描述，从"先调用 resolver，不先执行内置 policy"改为"先执行显式路由解析，再委托"。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.5-请求自动路由.md`：刷新处理过程字段。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.3-自定义路由策略.md`：刷新描述和处理过程字段。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.2-装配插件.md`：刷新处理过程字段。



