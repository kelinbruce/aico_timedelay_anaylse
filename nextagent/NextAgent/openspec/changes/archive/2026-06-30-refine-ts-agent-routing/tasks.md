## 1. Contract And Input

- [x] 1.1 扩展 `AgentRoutingPolicyConfig`，支持 `rules: [{ reg, target: { kind, name } }]` 的 trusted config shape，并在 agent definition parser 中校验多规则数组、target shape 与非法 regex。
  验证：`npm test -- --run tests/agent-kernel/config-assembly.test.ts tests/contract/core-contracts.test.ts`

- [x] 1.2 在 runtime accepted `RequestContext` 中补充 runtime-owned `acceptedInputText`，确保 routing policy 可以消费 accepted user question，且 routing-constraints carry 仍保持受控。
  验证：`npm test -- --run packages/agent-runtime/tests/routing-constraints-carry.test.ts`

## 2. Routing Policy

- [x] 2.1 实现 regex rule 命中 `SKILL` 目标时产出 `DETERMINISTIC_FLOW + skillName`，并复用既有 governed Skill loading path。
  验证：`npm test -- --run packages/agent-core/tests/agent-routing-core.test.ts`

- [x] 2.2 实现 regex rule 命中 `WORKFLOW` 目标时产出 `DETERMINISTIC_FLOW + recipeName`，并复用既有 workflow execution path。
  验证：`npm test -- --run packages/agent-core/tests/agent-routing-core.test.ts`

- [x] 2.3 支持多个 regex rules，按配置顺序首个命中生效。
  验证：`npm test -- --run packages/agent-core/tests/agent-routing-core.test.ts`

- [x] 2.4 regex rules 未命中时回退 model-driven loop，不改变既有 default path。
  验证：`npm test -- --run packages/agent-core/tests/agent-routing-core.test.ts`

## 3. Failure Gate

- [x] 3.1 trusted routing regex 配置非法时 fail closed，不进入 model / workflow / capability path。
  验证：`npm test -- --run packages/agent-core/tests/agent-routing-core.test.ts tests/agent-kernel/config-assembly.test.ts`

- [x] 3.2 OpenSpec change 严格校验通过。
  验证：`openspec validate refine-ts-agent-routing --strict`
