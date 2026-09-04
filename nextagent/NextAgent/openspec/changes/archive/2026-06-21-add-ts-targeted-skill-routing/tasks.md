## 1. Directed Skill Routing Path

- [x] 1.0 确认 `refine-ts-routing-constraints-contract` 已提供并验证 `RoutingConstraints.targetSkill` contract，且 `add-ts-routing-constraint-validation` 已提供 schema/governance boundary。
  验证：`openspec validate refine-ts-routing-constraints-contract --strict`；`openspec validate add-ts-routing-constraint-validation --strict`；contract tests 覆盖 `targetSkill`
  来源：design "前置条件"
- [x] 1.1 在 Agent routing policy 中接入 `targetSkill` typed constraint，并确保 channel/runtime 只转发不执行。
  验证：`npm test -- --run packages/agent-core/tests/targeted-skill-routing.test.ts`；`npm run lint:architecture`
  来源：Requirement "Preferred Skill is a routing constraint"
- [x] 1.2 通过 request-scope capability governance 按 kind=`SKILL` 解析 target Skill，并校验当前 Agent binding、Owner Scope visibility/authorization、availability、forbidden constraint、capability invocation budget、deadline 和 AbortSignal。
  验证：`npm test -- --run packages/agent-core/tests/targeted-skill-routing.test.ts`
  来源：Requirement "Preferred Skill routing is governed before execution"
- [x] 1.3 将 accepted target Skill 映射为 `DETERMINISTIC_FLOW` 内部 governed capability invocation，并通过既有 result contract 消费结果；不得新增 public routing decision kind。
  验证：`npm test -- --run packages/agent-core/tests/targeted-skill-routing.test.ts`
  来源：Requirement "Targeted Skill execution preserves request lifecycle boundaries"

## 2. Negative And Boundary Cases

- [x] 2.1 覆盖 `targetSkill` 与 `forbiddenCapabilityIds` 冲突时拒绝执行。
  验证：`npm test -- --run packages/agent-core/tests/targeted-skill-routing-security.test.ts`
  来源：Requirement "Preferred Skill routing is governed before execution"
- [x] 2.2 覆盖 Skill 不属于当前 Agent、不可见、未授权、不可用、over budget、timeout/canceled 时不执行且不全局搜索替代 Skill。
  验证：`npm test -- --run packages/agent-core/tests/targeted-skill-routing-security.test.ts`
  来源：Requirement "Preferred Skill failures degrade explicitly"
- [x] 2.3 覆盖模型 `Skill` tool call 不会被当成用户 trusted `targetSkill`。
  验证：`npm test -- --run packages/agent-core/tests/targeted-skill-routing.test.ts`
  来源：Requirement "Targeted Skill routing is distinct from model Skill tool use"
- [x] 2.4 覆盖 Skill resolve/probe timeout 或 AbortSignal canceled 时 safe timeout/canceled，不使用 partial facts。
  验证：`npm test -- --run packages/agent-core/tests/targeted-skill-routing-failure.test.ts`
  来源：Requirement "Preferred Skill failures degrade explicitly"

## 3. Observability And User Projection

- [x] 3.1 directed Skill accepted/rejected/fallback outcome 输出给 routing evidence/audit/log/trace 边界。
  验证：`npm test -- --run packages/agent-core/tests/targeted-skill-routing-observability.test.ts`
  来源：Requirement "Preferred Skill routing is governed before execution"
## 4. 验证和收尾

- [x] 4.1 运行相关单元和集成测试。
  验证：`npm test -- --run packages/agent-core/tests/targeted-skill-routing.test.ts packages/agent-core/tests/targeted-skill-routing-security.test.ts packages/agent-core/tests/targeted-skill-routing-failure.test.ts`
  来源：AGENTS.md 验证门禁
- [x] 4.2 运行架构验证。
  验证：`npm run lint:architecture`
  来源：AGENTS.md 架构边界
- [x] 4.3 运行 OpenSpec 验证。
  验证：`openspec validate add-ts-targeted-skill-routing --strict`
  来源：AGENTS.md OpenSpec 验证门禁

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/targeted-skill-routing/spec.md`。
- 按需更新 `openspec/designs/architecture/ts-backend-architecture.md`。
- 按需更新 `openspec/designs/modules/agent-core.md`、`agent-capability.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
