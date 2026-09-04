## Why

Agent 开发者配置了 `routing.mode=policy` 规则或用户使用 `$skill:` / `$workflow:` 指令时，这些显式指定应优先于插件路由策略。当前 `decideAgentRoutingPolicy()` 在插件返回 resolution 时将全部决策权委托给插件，跳过 `DefaultAgentRoutingPolicy.decide()` 的全部逻辑——包括指令解析、约束治理、capability scope 校验和 `mode=policy` 规则匹配。这意味着 Agent 配置的 policy 规则和用户显式指定的指令在插件路径上完全依赖插件自律。

## 目标与非目标

**目标：**

- 显式路由指定（用户指令 `$skill:` / `$workflow:`、约束 `targetRecipe` / `targetSkill`、Agent 配置的 `mode=policy` 规则）在任何路由策略实现（plugin 或 built-in）之前执行。
- 显式指定命中时，框架直接产生路由决策，路由策略实现不被调用。
- 显式指定 miss（指令目标不可用、约束目标不可用、policy 规则命中但 target 不可用）时，框架直接降级到 `MODEL_DRIVEN_LOOP`，路由策略实现不被调用。
- `mode=policy` 规则全部未匹配时，框架委托给路由策略实现：有插件走插件，无插件走默认 `MODEL_DRIVEN_LOOP`。
- 无任何显式指定时，框架委托给路由策略实现：有插件走插件，无插件走默认 `MODEL_DRIVEN_LOOP`。
- 插件路由策略的 `decide()` 契约不变：输入、输出、词汇表、fail-closed 行为不变。

**非目标：**

- 不改指令解析逻辑（`capability-directive-parser.ts` 的 regex、safe name pattern 和冲突判定规则不变）。
- 不改约束校验规则（`RoutingConstraintGovernor` 不变）。
- 不改插件契约词汇表（5 种 `RoutingDecisionKind` 不变）。
- 不新增路由决策 kind 或安全原因码。
- 不改 directive normalization 在 runtime composition 层的执行位置。
- 不改 `TargetedSkillRouter` 在 `BEFORE_MODEL_INVOKE` 生命周期阶段的职责。
- 不实现 boot-recipe 路由、`CLARIFY` / `HUMAN_HANDOFF` 下游翻译。

## What Changes

- **BREAKING**: 插件路由策略不再完全替代框架路由决策。`agent-scoped-plugin-composition` 的路由委托契约从"存在 enabled binding 时 MUST NOT 先调用 built-in routing policy"改为"框架 MUST 先执行显式路由解析，仅当无显式指定或 policy 规则未匹配时才委托给路由策略实现"。

- 新增 `agent-routing-core` spec requirement：显式路由优先级。显式指定（指令、约束、policy 规则）MUST 先于路由策略实现执行；命中或 miss 时路由策略实现 MUST NOT 被调用；policy 规则未匹配或无显式指定时委托给路由策略实现。

- 修改 `agent-scoped-plugin-composition` spec 的 `Policy plugins use an explicit open policy inventory` requirement：core routing adapter 先执行显式路由解析，再根据结果决定是否委托给路由策略实现。

## Feature 影响

无。用户可观察的路由结果不变，变化的是框架保证显式指定优先于插件的内部机制。

## Function 影响

### 新增 Function

无。

### 修改的 Function

- `FN-2.5 请求自动路由` → `specs/agent-routing-core/spec.md`
  - 功能边界：路由优先级从"路由策略实现拥有全部决策权"变为"显式指定优先于路由策略实现"。指令、约束和 policy 规则在任何路由策略实现之前执行。
  - 系统质量属性：安全、可维护性、可测试性
  - 映射说明：canonical spec `agent-routing-core`

- `FN-10.3 自定义路由策略` → `specs/agent-routing-core/spec.md`
  - 功能边界：插件路由策略的调用时机从"完全替代默认路由"收窄为"仅在无显式指定且 policy 规则未匹配时被调用"。插件契约不变。
  - 系统质量属性：安全、可维护性
  - 映射说明：canonical spec `agent-routing-core`；本次触及 legacy spec `agent-scoped-plugin-composition`

- `FN-10.2 装配插件` → `specs/agent-scoped-plugin-composition/spec.md`
  - 功能边界：`agentRoutingPolicy` adapter 的委托行为从"plugin 优先且替代 built-in"改为"显式路由优先，plugin 与 built-in 平等处理无显式指定的策略选择"。
  - 系统质量属性：安全、可测试性
  - 映射说明：canonical spec `agent-scoped-plugin-composition`

## 影响范围

- **Agent 开发者**：配置了 `mode=policy` 规则或插件的 Agent，其显式指定（规则、指令、约束）优先于插件被处理。插件只在无显式指定且规则未匹配时被调用。
- **插件开发者**：现有插件如果依赖自行解析指令或 policy 规则，这些代码在用户使用指令或 Agent 配置了规则时不再被触发。这是 BREAKING 变更。
- **公共 API**：无变化。`AgentRoutingPolicy.decide()` 的输入输出契约不变。
- **配置**：无变化。`AgentAssembly.policies` 和 `AgentAssembly.routing` 的配置 shape 不变。
- **受影响代码**：`packages/agent-core/src/routing/agent-routing-policy-executor.ts`（委托逻辑）、`packages/agent-core/src/routing/agent-routing-policy.ts`（提取显式路由解析）、`packages/agent-core/tests/agent-routing-core.test.ts`（回归测试）。

