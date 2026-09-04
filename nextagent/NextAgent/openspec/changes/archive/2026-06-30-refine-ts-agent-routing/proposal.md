## 背景与问题（Why）

当前 Agent routing policy 在 `mode=policy` 下只识别受控的 `policy:intent-recognition` 方法名，但不会根据 accepted user question 进行规则匹配。现状只能：

- 通过显式 `routingConstraints.targetRecipe` 进入 workflow；
- 通过显式 `routingConstraints.targetSkill` 进入 governed Skill path；
- 否则回退 model-driven loop。

这导致受信任的 Agent 配置无法声明“当用户问题命中某类正则时，固定走某个 Skill 或 Workflow”的 deterministic routing rule。

## 变更范围（What Changes）

- **新增** routing policy ordered regex rule 配置，支持在 trusted Agent routing config 中声明多个规则。
- **新增** rule target shape，支持把命中结果路由到既有 governed Skill path 或既有 workflow path。
- **新增** runtime-owned accepted input text 向 Agent routing policy 的受控输入传递。
- **新增** first-match-wins policy evaluation：按配置顺序依次匹配，首个命中规则产生 deterministic routing decision，未命中则回退 model-driven loop。

## 不在范围内（Explicit Non-Goals）

- 不引入用户可写 routing DSL。
- 不新增 workflow durable store、timeline durable owner 或 workflow execution history owner。
- 不新增新的 public routing decision kind。
- 不让 raw prompt、model output、capability args 或 untrusted metadata 作为 routing authority。
- 不支持自定义 regex flags、脚本化 policy code 或外部 rule engine。

## Capability 影响（Capabilities）

### 修改的 Capability

- `agent-core` routing path 增加 trusted regex rule match。
- `agent-app` agent definition parser 增加 routing regex rules 配置解析。
- `agent-runtime` 在 accepted request context 中提供 routing policy 可消费的 accepted input text。

## 影响范围（Impact）

- `packages/agent-contracts`
- `packages/agent-app`
- `packages/agent-runtime`
- `packages/agent-core`

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/agent-routing-core/spec.md`

设计视图：
- `openspec/designs/modules/agent-core.md`
- `openspec/designs/architecture/ts-backend-architecture.md`
