## 背景与问题（Why）

Agent Routing 能力组需要支持 `targetSkill`、`forbiddenCapabilityIds`、`executionMode`、`locale`、`maxToolCalls`、`allowHumanInput`、`allowSubagents` 等处理约束。约束可以帮助用户或上游系统表达期望，但它们来自不可信边界时不能直接改变 Agent Scope、Owner Scope、capability authority、provider selection 或 raw prompt。

本 change 定义 routing constraints 的输入校验、治理顺序和失败语义，确保约束只能收窄或引导 Agent routing，不能绕过 Agent 和 capability governance。

本 change 依赖 `refine-ts-routing-constraints-contract` 提供 runtime-owned request-carried `RoutingConstraints` DTO，并在 request submission 与 accepted execution context 上携带可选 `routingConstraints` 字段。没有该 contract refinement 时，本 change 不应进入实现。

## 变更范围（What Changes）

- 定义 routing constraints 允许字段、禁止字段和 request boundary schema validation 边界。
- 定义约束校验在请求生命周期中的触发阶段和同步/异步行为。
- 定义约束如何被 Agent routing policy 二次治理。
- 定义无效、越权、冲突、超预算、依赖缺失时的 safe failure/degradation。
- 定义 constraint validation outcome 的状态契约、审计/日志/trace 语义和用户可见边界。

## Capability 影响（Capabilities）

### 新增 Capability
- `routing-constraint-validation`: 校验用户或上游入口提供的处理约束，防止绕过 Agent 和 capability governance。

### 修改的 Capability
- `ts-core-contracts`: 依赖 `refine-ts-routing-constraints-contract` 提供 runtime-owned request-carried `RoutingConstraints`。
- `agent-routing-core`: routing policy 必须只消费已 schema-validated 且待治理的 typed constraints。
- `targeted-skill-routing`: `targetSkill` 的执行前治理复用本 change 的 constraint validation outcome。
- `routing-evidence-and-fallback`: 记录 constraint accepted/rejected/degraded evidence。

## 影响范围（Impact）

- `agent-channel-web`: schema validation 和 public DTO 只允许安全 constraint 字段。
- `agent-runtime`: request acceptance 可携带 typed constraints，但不解释业务语义。
- `agent-core`: Agent routing policy 对 constraints 做 Agent/Owner/capability/policy governance。
- `agent-contracts`: 不在本 change 中修改；`RoutingConstraints` DTO/schema、`SubmitRequestCommand.routingConstraints?` 和 `RequestContext.routingConstraints?` 由 `refine-ts-routing-constraints-contract` 承载。
- 验证：schema tests、Agent policy tests、negative forbidden field tests、architecture tests。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/routing-constraint-validation/spec.md`：新增 routing constraint validation 行为契约。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/ts-backend-architecture.md`：同步 constraint flow。
- `openspec/designs/modules/agent-channel-web.md`：同步 channel schema/projection 边界。
- `openspec/designs/modules/agent-runtime.md`：同步 runtime pass-through 边界。
- `openspec/designs/modules/agent-core.md`：同步 Agent policy governance。
- `openspec/designs/spec-to-design-map.md`：增加导航。

验证入口：
- `npm test -- --run packages/agent-core/tests/routing-constraint-validation.test.ts`
- `npm test -- --run packages/agent-channel-web/tests/*routing-constraints*`
- `npm run lint:architecture`
- `openspec validate add-ts-routing-constraint-validation --strict`
