## 背景与问题（Why）

Agent routing 后续 change 需要在请求提交和 accepted execution context 中携带用户或上游入口提供的 routing constraints，例如 `targetSkill`、`forbiddenCapabilityIds`、`executionMode`、`locale`、`maxToolCalls`、`allowHumanInput` 和 `allowSubagents`。

当前冻结的 `agent-contracts/runtime` 中还没有 request-carried `RoutingConstraints` DTO，也没有 `SubmitRequestCommand.routingConstraints?` 或 `RequestContext.routingConstraints?` 字段。若各 routing change 在实现阶段临时定义字段，会导致 channel、runtime 和 Agent Core 对同一请求事实产生不同 owner 和 shape。

本 change 只 refinement 核心 runtime contract：定义最小 `RoutingConstraints` DTO/schema，并让 runtime submission 与 accepted execution context 能携带 typed constraints。runtime 只携带，不解释业务语义，不做 Skill/Tool/Agent/provider/model path selection。

同时，本 change 也承载 routing 相关最小 contract shape 的 owner 定义：后续 `agent-routing-core` 消费的 routing config、policy input 和 policy result 的最小 shape 应先在 contract refinement 中明确，再由 router change 负责消费与翻译。

## 变更范围（What Changes）

- 在 `agent-contracts/runtime` 增加 request-carried `RoutingConstraints` DTO/schema。
- 扩展 `SubmitRequestCommand.routingConstraints?`。
- 扩展 accepted `RequestContext.routingConstraints?`。
- 明确允许字段和 forbidden override 不进入 contract。
- 明确后续 routing core 消费的最小 contract shape：`AgentRoutingConfig`、`AgentRoutingPolicyInput`、`AgentRoutingPolicyResult`。
- 明确 runtime carry-only 边界：不新增 routing package、generic `PolicyPort`、public routing decision kind 或业务治理逻辑。

## Capability 影响（Capabilities）

### 新增 Capability
- 无。本 change 是 `ts-core-contracts` refinement，不新增运行时业务能力。

### 修改的 Capability
- `ts-core-contracts`: runtime contract 支持 request-carried `RoutingConstraints`。
- `ts-core-contracts`: 承载 routing config / policy input / policy result 的最小 contract shape 定义。
- `routing-constraint-validation`: 依赖本 contract 做 schema validation 和 Agent governance。
- `targeted-skill-routing`: 依赖本 contract 中的 `targetSkill` 字段。

## 影响范围（Impact）

- `agent-contracts/runtime`: 新增 `RoutingConstraints` DTO/schema，并扩展 `SubmitRequestCommand` 与 `RequestContext`。
- `agent-channel-web`: 后续 change 可把已校验 payload 投影为 `SubmitRequestCommand.routingConstraints?`，但本 change 不定义新的 Web endpoint。
- `agent-runtime`: 后续实现只在 request acceptance 中携带 typed value 到 accepted context，不解释业务语义。
- `agent-core`: 后续 routing change 只消费 typed constraints，不定义 runtime DTO。
- 验证：contract tests、architecture tests、OpenSpec strict validation。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-core-contracts/spec.md`：同步 runtime-owned `RoutingConstraints` contract refinement。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/core-contracts.md`：同步 `agent-contracts/runtime` export surface、`RoutingConstraints`、`SubmitRequestCommand` 和 `RequestContext`。
- `openspec/designs/modules/agent-contracts.md`：同步 runtime subpath owner。
- `openspec/designs/spec-to-design-map.md`：如需，补充本 refinement 导航。

验证入口：
- `npm run test:contract -- --run packages/agent-contracts/tests/routing-constraints-contract.test.ts`
- `npm run lint:architecture`
- `openspec validate refine-ts-routing-constraints-contract --strict`
