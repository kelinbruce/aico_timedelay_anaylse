## 1. Schema Boundary

- [x] 1.0 确认 `refine-ts-routing-constraints-contract` 已提供并验证 request-carried `RoutingConstraints` contract；本 change 不修改 `agent-contracts`。
  验证：`openspec validate refine-ts-routing-constraints-contract --strict`；contract tests 覆盖 `RoutingConstraints`
  来源：design "前置条件"
- [x] 1.1 定义 routing constraints allow-list schema：`targetSkill`、`forbiddenCapabilityIds`、`executionMode`、`locale`、`maxToolCalls`、`allowHumanInput`、`allowSubagents`。
  验证：`npm test -- --run packages/agent-channel-web/tests/routing-constraints-schema.test.ts`
  来源：Requirement "Routing constraints use an allow-list schema"
- [x] 1.2 增加 forbidden override negative tests，覆盖 owner、tenant、subject、agent override、provider override、capability provider override、raw system prompt、raw policy、raw tool authority、raw model profile override。
  验证：`npm test -- --run packages/agent-channel-web/tests/routing-constraints-schema.test.ts`
  来源：Requirement "Routing constraints use an allow-list schema"
- [x] 1.3 runtime acceptance 只携带 typed constraints，不解释业务语义或执行路径选择。
  验证：`npm run lint:architecture`
  来源：Requirement "Constraint validation has two stages"

## 2. Agent Governance Stage

- [x] 2.1 在 Agent routing policy 中实现 governance stage，schema-valid constraints 必须再校验 Agent Scope、Owner Scope、capability governance、locale、availability、budget 和 policy。
  验证：`npm test -- --run packages/agent-core/tests/routing-constraint-validation.test.ts`
  来源：Requirement "Constraint validation has two stages"
- [x] 2.2 实现 constraints 只收窄或引导 authority：`forbiddenCapabilityIds` 排除候选、`allowSubagents=false` 排除 subagent、`locale` 不覆盖 security identity。
  验证：`npm test -- --run packages/agent-core/tests/routing-constraint-validation.test.ts`
  来源：Requirement "Constraints can only narrow or guide authority"
- [x] 2.3 在调用 model/capability/human input/subagent 慢边界前检查 `maxToolCalls`、`executionMode`、`allowHumanInput`、`allowSubagents`。
  验证：`npm test -- --run packages/agent-core/tests/routing-constraint-budget.test.ts`
  来源：Requirement "Budget and execution constraints are enforced before slow boundaries"

## 3. Failure, Degradation, And Evidence

- [x] 3.1 覆盖 validation dependency unavailable 时 fail closed 或 policy-declared safe degradation，不静默丢弃 constraint。
  验证：`npm test -- --run packages/agent-core/tests/routing-constraint-validation-failure.test.ts`
  来源：Requirement "Constraint validation outcomes are observable and safe"
- [x] 3.2 输出 accepted/rejected/ignored/degraded safe reason codes 给 routing evidence/audit/log/trace，不输出 raw payload。
  验证：`npm test -- --run packages/agent-core/tests/routing-constraint-observability.test.ts`
  来源：Requirement "Constraint validation outcomes are observable and safe"
- [x] 3.3 用户 stream/history 只展示最终结果、pending input、handoff 或 safe error，不展示 raw constraints 或 policy internals。
  验证：`npm test -- --run packages/agent-channel-web/tests/routing-constraints-projection.test.ts`
  来源：Requirement "Constraint validation outcomes are observable and safe"

## 4. 验证和收尾

- [x] 4.1 运行相关单元和 contract 测试。
  验证：`npm test -- --run packages/agent-core/tests/routing-constraint-validation.test.ts packages/agent-core/tests/routing-constraint-budget.test.ts packages/agent-channel-web/tests/routing-constraints-schema.test.ts`
  来源：AGENTS.md 验证门禁
- [x] 4.2 运行架构验证。
  验证：`npm run lint:architecture`
  来源：AGENTS.md 架构边界
- [x] 4.3 运行 OpenSpec 验证。
  验证：`openspec validate add-ts-routing-constraint-validation --strict`
  来源：AGENTS.md OpenSpec 验证门禁

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/routing-constraint-validation/spec.md`。
- 按需更新 `openspec/designs/architecture/ts-backend-architecture.md`。
- 按需更新 `openspec/designs/modules/agent-channel-web.md`、`agent-runtime.md`、`agent-core.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
