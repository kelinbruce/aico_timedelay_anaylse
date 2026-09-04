# Tasks

## 1. 显式路由优先级

### 1.1 目标行为测试

- [x] 1.1.1 补充"插件激活时 skill 指令命中由框架处理"的回归：断言 plugin `decide()` 未被调用、路由决策为 `DETERMINISTIC_FLOW` + `skillName`、原因码为 `CAPABILITY_DIRECTIVE_SKILL_MATCHED`。
  验证：`packages/agent-core/tests/agent-routing-core.test.ts` 新增用例

- [x] 1.1.2 补充"插件激活时 workflow 指令命中由框架处理"的回归：断言 plugin `decide()` 未被调用、路由决策为 `DETERMINISTIC_FLOW` + `recipeName`、原因码为 `CAPABILITY_DIRECTIVE_WORKFLOW_MATCHED`。
  验证：同文件新增用例

- [x] 1.1.3 补充"插件激活时指令 miss 降级到 model loop"的回归：断言 plugin `decide()` 未被调用、路由决策为 `MODEL_DRIVEN_LOOP`、原因码为 `CAPABILITY_DIRECTIVE_WORKFLOW_MISS_FALLBACK`。
  验证：同文件新增用例

- [x] 1.1.4 补充"插件激活时指令冲突由框架 fail-closed"的回归：断言 plugin `decide()` 未被调用、路由决策为 `REJECT`、原因码为 `CAPABILITY_DIRECTIVE_AMBIGUOUS`。
  验证：同文件新增用例

- [x] 1.1.5 补充"插件激活时 targetRecipe 约束命中由框架处理"的回归：断言 plugin `decide()` 未被调用、路由决策为 `DETERMINISTIC_FLOW` + `recipeName`、原因码为 `TARGET_RECIPE_MATCHED`。
  验证：同文件新增用例

- [x] 1.1.6 补充"插件激活时 targetSkill 约束由框架处理"的回归：断言 plugin `decide()` 未被调用、路由决策为 `MODEL_DRIVEN_LOOP`、原因码为 `POLICY_RULE_TARGET_SKILL_PRIORITY`。
  验证：同文件新增用例

- [x] 1.1.7 补充"插件激活时 policy 规则匹配由框架处理"的回归：断言 plugin `decide()` 未被调用、路由决策为 `DETERMINISTIC_FLOW`、原因码为 `POLICY_RULE_SKILL_MATCHED` 或 `POLICY_RULE_WORKFLOW_MATCHED`。
  验证：同文件新增用例

- [x] 1.1.8 补充"插件激活时 policy 规则命中但 target 不可用由框架降级"的回归：断言 plugin `decide()` 未被调用、路由决策为 `MODEL_DRIVEN_LOOP`、原因码为 `POLICY_RULE_SKILL_MISS_FALLBACK` 或 `POLICY_RULE_WORKFLOW_MISS_FALLBACK`。
  验证：同文件新增用例

- [x] 1.1.9 补充"插件激活时 policy 规则未匹配时委托给插件"的回归：断言 plugin `decide()` 被调用、plugin 接收原始 `acceptedInputText`。
  验证：同文件新增用例

- [x] 1.1.10 补充"无显式指定时委托给插件"的回归：断言 plugin `decide()` 被调用。
  验证：同文件新增用例

- [x] 1.1.11 补充"无插件且无显式指定时使用 built-in 默认路由"的回归：断言路由决策为 `MODEL_DRIVEN_LOOP`、原因码为 `DEFAULT_MODEL_DRIVEN_LOOP`。
  验证：同文件新增用例

- [x] 1.1.12 补充"显式路由不因路由策略实现不同而改变"的对比回归：断言 plugin Agent 和 non-plugin Agent 收到相同指令时，决策 kind 和原因码相同。
  验证：同文件新增用例

- [x] 1.1.13 补充"守卫失败时不调用路由策略实现"的回归：断言 AbortSignal 取消 / assembly 不可用 / capability view 不可用时抛出安全错误且 plugin `decide()` 未被调用。
  验证：同文件新增用例

### 1.2 实现

- [x] 1.2.1 从 `DefaultAgentRoutingPolicy.decide()` 提取 `resolveExplicitRouting(run, context, signal)` 私有方法，承载守卫、指令解析、targetRecipe 约束、targetSkill 约束和 mode=policy 规则匹配。命中或 miss 时返回 `AgentRoutingDecision`，未匹配或无显式指定时返回 `undefined`。守卫抛出 `AgentError` 时异常直接传播。
  验证：`npm run typecheck`

- [x] 1.2.2 修改 `decideAgentRoutingPolicy()`：始终先调用 `resolveExplicitRouting()`；返回非 `undefined` 时直接采用；返回 `undefined` 时委托给 plugin（如已激活）或返回默认 `MODEL_DRIVEN_LOOP`。
  验证：`npm run typecheck`

- [x] 1.2.3 确认 `decide()` 公共接口保持不变：内部实现改为先调 `resolveExplicitRouting()`，再返回默认 `MODEL_DRIVEN_LOOP`。既有直接调用 `decide()` 的测试不报错。
  验证：既有 `agent-routing-core.test.ts` 用例通过

### 1.3 Function 验证

- [x] 1.3.1 既有路由回归全量保持：`fix-ts-routing-policy-skill-target` 已实现的行为不退化。targetSkill 短路原因码 `POLICY_RULE_TARGET_SKILL_PRIORITY` 仍由显式路由解析发出；Skill 可用性校验 `isSkillCapabilityAvailable` 仍由 `matchPolicyRule()` 内部使用。
  验证：既有用例全部通过

- [x] 1.3.2 插件路由策略安全不变：plugin policy execution failure、timeout 或非法结果仍 fail closed。
  验证：既有 plugin 相关用例通过；如无既有 plugin 测试，新增"plugin 超时 fail-closed"和"plugin 非法结果 fail-closed"用例

## 2. 共享任务：整体验证与归档检查

- [x] 2.1 TypeScript 构建通过。
  验证：`npm run typecheck`

- [x] 2.2 受影响单测通过。
  验证：`npx vitest run packages/agent-core/tests/agent-routing-core.test.ts packages/agent-core/tests/agent-routing-core-security.test.ts packages/agent-core/tests/agent-routing-core-observability.test.ts packages/agent-core/tests/agent-routing-core-failure.test.ts`

- [x] 2.3 后端常规门禁通过。
  验证：`npm test`、`npm run test:contract`、`npm run lint:architecture`

- [x] 2.4 OpenSpec 严格校验通过。
  验证：`openspec validate --all --strict`

- [x] 2.5 归档前刷新长期基线。
  验证：design"长期基线刷新计划"列出的 stable spec、架构文档和 Function 文档
