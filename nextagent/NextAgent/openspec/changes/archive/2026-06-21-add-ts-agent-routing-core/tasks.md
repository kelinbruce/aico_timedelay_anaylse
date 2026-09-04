## 1. Routing Core Boundary

- [x] 1.1 在 `agent-core` 建立 Agent routing policy 决策点，并将现有默认模型循环接到 `MODEL_DRIVEN_LOOP` decision；不得同时实现 deterministic/clarify/handoff 业务选择规则。
  验证：`npm test -- --run packages/agent-core/tests/agent-routing-core.test.ts`
  来源：Requirement "Agent internal routing policy selects handling paths"；design "流程接入"
- [x] 1.2 增加 architecture negative test，断言 `agent-runtime` 和 `agent-channel-web` 不直接选择业务 Skill、Tool、Agent capability 或 deterministic flow。
  验证：`npm run lint:architecture`
  来源：Requirement "Agent internal routing policy selects handling paths"；AGENTS 架构边界
- [x] 1.3 复用已冻结 routing decision vocabulary，并对未知 decision fail closed；不得新增 `RoutingDecisionKind`。
  验证：`npm test -- --run packages/agent-core/tests/agent-routing-core.test.ts`
  来源：Requirement "Routing decision vocabulary is controlled"

## 2. Trusted Inputs And Safe Outputs

- [x] 2.1 routing policy 使用 frozen `agentId`、`agentVersion` 读取 `AgentAssemblyRegistry.require(...)`，不得重新选择 active Agent version。
  验证：`npm test -- --run packages/agent-core/tests/agent-routing-core.test.ts`
  来源：Requirement "Routing policy consumes frozen request and assembly facts"
- [x] 2.2 增加 negative test，覆盖请求体、模型输出、capability args 或 metadata 中的 owner/tenant/agent/provider override 不影响 routing authority。
  验证：`npm test -- --run packages/agent-core/tests/agent-routing-core-security.test.ts`
  来源：Requirement "Routing policy consumes frozen request and assembly facts"
- [x] 2.3 将 `MODEL_DRIVEN_LOOP` decision 翻译成现有 Context Engine + Model Service + tool loop，将 safe reject/fail closed 翻译成安全错误路径；pending input、handoff 和 deterministic capability invocation 留给后续 change。
  验证：`npm test -- --run packages/agent-core/tests/agent-routing-core.test.ts`
  来源：Requirement "Routing core emits safe downstream commands"
- [x] 2.4 在 change design/spec 中明确 routing 规则配置从可信 Agent 配置读取，且未配置或 `mode=default` 时进入默认路径，其他模式当前仅支持 `mode=policy`。
  验证：`openspec validate add-ts-agent-routing-core --strict`
  来源：Requirement "Routing policy consumes frozen request and assembly facts"
- [x] 2.5 在 change design/spec 中明确 `mode=policy` 的输入和输出 contract，当前输出至少包含受控的 `skillName` 目标字段和对应 decision/safe reason，`workflowName` 延后到后续 change。
  验证：`openspec validate add-ts-agent-routing-core --strict`
  来源：Requirement "Policy routing uses controlled input and output contracts"
- [x] 2.6 在 change design/spec 中明确当前 `mode=policy` 只支持系统内置 `policy:intent-recognition`，用户自定义代码型 policy 延后到后续 change。
  验证：`openspec validate add-ts-agent-routing-core --strict`
  来源：Requirement "Policy routing uses controlled input and output contracts"
- [x] 2.7 在 change design/spec 中明确当前 `skillName` 的执行顺序：先走 governed Skill loading path 合并 request-local state，再进入 Context Engine 和 Model 主流程。
  验证：`openspec validate add-ts-agent-routing-core --strict`
  来源：Requirement "Routing core emits safe downstream commands"

## 3. Failure And Degradation

- [x] 3.1 覆盖 frozen assembly 读取失败时 safe error 结束，且不 fallback active Agent version。
  验证：`npm test -- --run packages/agent-core/tests/agent-routing-core-failure.test.ts`
  来源：Requirement "Routing core fails closed on unavailable policy dependencies"
- [x] 3.2 覆盖 capability governance view 不可用时 fail closed。
  验证：`npm test -- --run packages/agent-core/tests/agent-routing-core-failure.test.ts`
  来源：Requirement "Routing core fails closed on unavailable policy dependencies"
- [x] 3.3 输出 safe routing outcome 给 observability/evidence 边界，用户 stream/history 不投影 routing internals。
  验证：`npm test -- --run packages/agent-core/tests/agent-routing-core-observability.test.ts`
  来源：Requirement "Routing core is observable without exposing internals"

## 4. 验证和收尾

- [x] 4.1 运行常规相关验证。
  验证：`npm test -- --run packages/agent-core/tests/agent-routing-core.test.ts packages/agent-core/tests/agent-routing-core-security.test.ts packages/agent-core/tests/agent-routing-core-failure.test.ts`
  来源：AGENTS.md 验证门禁
- [x] 4.2 运行架构验证。
  验证：`npm run lint:architecture`
  来源：AGENTS.md 架构边界
- [x] 4.3 运行 OpenSpec 验证。
  验证：`openspec validate add-ts-agent-routing-core --strict`
  来源：AGENTS.md OpenSpec 验证门禁

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/agent-routing-core/spec.md`。
- 按需更新 `openspec/designs/architecture/ts-backend-architecture.md`。
- 按需更新 `openspec/designs/modules/agent-core.md`、`agent-runtime.md`、`agent-channel-web.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
