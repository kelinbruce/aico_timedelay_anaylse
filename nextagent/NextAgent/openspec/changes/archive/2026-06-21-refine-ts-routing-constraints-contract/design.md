## 背景和现状（Context）

`agent-contracts/runtime` 已拥有 request submission、accepted request context 和 runtime-to-Agent execution port。`SubmitRequestCommand` 目前携带 session、trusted identity、input、attachments、locale 和 idempotency facts；`RequestContext` 携带 accepted execution facts、Agent Scope、Owner Scope、locale、tool call recovery state 和 request-scoped `flowVariables`。

Routing constraints 是请求入口事实：它们来自 channel/request boundary，必须随 accepted request 进入 Agent Core，但不能由 runtime 解释成业务路径。该事实的 owning subpath 应与 request lifecycle contract 一致，放在 `agent-contracts/runtime`，而不是新增 `agent-contracts/routing` 或让 `agent-core` 定义 runtime command 字段。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 定义 runtime-owned `RoutingConstraints` DTO/schema。
- 将 `routingConstraints?` 添加到 `SubmitRequestCommand` 和 accepted `RequestContext`。
- 固定字段 allow-list 的 contract shape。
- 固定 routing config、policy input、policy result 的最小 contract shape owner。
- 明确 runtime carry-only 语义和安全边界。
- 为 constraint validation、targeted Skill routing 和 evidence/fallback 提供唯一 typed input。

**非目标：**
- 不定义 constraint governance、authorization、availability、budget 或 fallback 业务规则。
- 不定义新的 Web API endpoint 或 stream event。
- 不新增 `agent-contracts/routing` subpath。
- 不新增 generic `PolicyPort`。
- 不新增 public routing decision kind，例如 `DIRECTED_SKILL`。
- 不定义 routing evidence 字段或 timeline vocabulary。
- 不定义 policy 规则 DSL、优先级算法、用户自定义代码执行边界或 router 的具体业务选择规则。

## 设计决策（Decisions）

1. `RoutingConstraints` 归 `agent-contracts/runtime`，因为它是 request-carried execution fact。
2. `SubmitRequestCommand.routingConstraints?` 表示 channel/request boundary 提交给 runtime 的 typed constraints。
3. `RequestContext.routingConstraints?` 表示 runtime acceptance 后传递给 Agent execution 的同一 request fact。
4. `RoutingConstraints` 只允许 `targetSkill`、`forbiddenCapabilityIds`、`executionMode`、`locale`、`maxToolCalls`、`allowHumanInput`、`allowSubagents`。
5. DTO 不包含 owner、tenant、subject、agent override、provider override、model profile override、raw system prompt、raw policy、raw tool authority 或 capability provider override。
6. Runtime 接收该字段后只原样携带到 accepted context，不解析 Skill、Tool、Agent capability、provider、model profile 或业务路径。
7. schema-valid constraints 不代表 authorization；Agent Core 的 routing policy 和后续 validation change 才能做 governance。
8. routing 相关最小 contract shape 先由本 refinement 定义 owner：
   - `AgentRoutingConfig`
   - `AgentRoutingPolicyInput`
   - `AgentRoutingPolicyResult`
9. `AgentRoutingConfig` 的最小 shape 为：
   - `mode?: "default" | "policy"`
   - `policy?: { method: "policy:intent-recognition" }`
   缺省或 `mode=default` 表示默认路径；`mode=policy` 时必须提供 `policy`。用户自定义代码型 policy 留给后续 change。
10. `AgentRoutingPolicyInput` 的最小 shape 只允许：
   - `run: RequestRun`
   - `context: RequestContext`
   - `agentAssembly: AgentAssembly`
   - `signal: AbortSignal`
11. `AgentRoutingPolicyResult` 的最小 shape 只允许：
   - `decisionKind`: 已冻结 routing decision vocabulary
   - `safeReason: string`
   - `skillName?: string`
   其中 `skillName` 是受控 policy 结果字段，不代表直接授权。`workflowName` 留给后续 change。

## 触发机制（Trigger）

- 用户动作：channel/auth boundary 接收到包含 routing constraints 的 request，并构造 `SubmitRequestCommand`。
- 流程阶段：runtime request acceptance 输入构造阶段和 accepted `RequestContext` 构造阶段。
- 生命周期位置：发生在 Agent execution 前；后续 Agent Core routing 才消费该 typed value。
- 同步/异步：contract shape 和 in-memory carry 是同步；本 change 不触发后台 job 或 async governance。
- retry/edit：新 request command 重新携带自己的 `routingConstraints?`；resume/recovery 使用 accepted context 或 durable request facts，不重新读取 raw client payload。

## 输入与前置条件（Inputs / Preconditions）

输入：
- `SubmitRequestCommand`。
- optional `RoutingConstraints` typed value。
- optional `AgentRoutingConfig` typed value for downstream router consumption.
- trusted `identityContext`、`sessionId`、`inputText`、`locale`、`attachmentIds`、`idempotencyKey`。
- request acceptance 产生的 `RequestRun` 和 `RequestContext`。
- downstream routing policy consumption 需要的 `AgentAssembly` 和 `AbortSignal` shape owner。

前置条件：
- `RoutingConstraints` 值必须来自 channel/request boundary 的 typed construction，不得来自模型输出、capability 参数或客户端自报 owner scope。
- trusted Agent Scope 和 Owner Scope 仍由 app composition、hosted-agent selection、persisted session/run 和 channel/auth identity 决定。
- downstream routing changes 必须在 Agent Core 内治理 constraints 后才能影响 execution path。

## 输出与副作用（Outputs / Side Effects）

输出：
- `agent-contracts/runtime` public export 中的 `RoutingConstraints` DTO/schema。
- `SubmitRequestCommand.routingConstraints?`。
- `RequestContext.routingConstraints?`。
- router consumption 使用的最小 contract shape：`AgentRoutingConfig`、`AgentRoutingPolicyInput`、`AgentRoutingPolicyResult`。
- contract tests 证明字段可携带、禁止字段不存在、runtime 不拥有业务语义。

副作用：
- 不写 session message、timeline、audit、checkpoint、artifact、memory record 或 learning event。
- 不改变 Agent Scope、Owner Scope、AgentAssembly、capability catalog、provider config、model profile 或 prompt construction。
- 不产生用户可见提示；用户可见行为由后续 validation/routing/fallback change 决定。

## 核心判断逻辑（Core Decision Logic）

1. 若 submit command 不包含 `routingConstraints`，runtime request lifecycle 与现有行为一致。
2. 若 submit command 包含 `routingConstraints`，contract schema 只允许固定字段集合。
3. 若出现 owner/provider/prompt/policy/model/capability-authority override 字段，contract schema 或 boundary construction 必须拒绝该 shape；这些字段不得进入 typed DTO。
4. Runtime acceptance 将 typed `routingConstraints` 放入 accepted `RequestContext`。
5. Runtime 不读取 `targetSkill` 来 resolve Skill，不读取 `forbiddenCapabilityIds` 来过滤 capability，不读取 `executionMode` 来选择 model/capability path。
6. Agent Core 之后可按后续 routing validation change 消费该 typed value。
7. `AgentRoutingConfig` / `AgentRoutingPolicyInput` / `AgentRoutingPolicyResult` 只定义最小 contract shape owner，不在本 change 中引入 runtime 业务治理。

## 状态 / 产物契约（State / Artifact Contract）

`RoutingConstraints` 是 request-scoped typed input fact：
- 语义：表达请求方对当前 request handling 的偏好或限制。
- 生命周期：只对当前 request/run 有效；retry/edit 产生新 command 和新 accepted context；resume/recovery 不重新解释 raw client payload。
- 消费方：Agent Core routing policy、routing constraint validation、targeted Skill routing、routing evidence/fallback。
- 与原始事实关系：它是经过 boundary construction 后的 typed value，不是 raw client payload；字段名和值必须可追溯到 request command 和 accepted context。
- 安全限制：不得包含 raw prompt、raw model output、raw tool/capability args、secret、本地路径、provider-private ref、owner/provider override 原文或 policy internals。

本 change 不产生 summary、artifact、checkpoint、pending input、configuration state、diagnostic state、memory record 或 learning event。

## 流程接入（Flow Integration）

主流程：

`Channel/auth typed request construction -> Runtime submit command -> Runtime acceptance -> Accepted RequestContext -> Agent Core routing policy`

- 上游：channel/auth 提供 trusted identity 和 typed submit command。
- 接入点：`SubmitRequestCommand.routingConstraints?` 和 accepted `RequestContext.routingConstraints?`。
- 下游：`add-ts-routing-constraint-validation` 负责 schema/governance 行为；`add-ts-targeted-skill-routing` 消费 `targetSkill`；`add-ts-routing-evidence-and-fallback` 消费治理结果。
- 下游：`add-ts-agent-routing-core` 消费 `AgentRoutingConfig`、`AgentRoutingPolicyInput`、`AgentRoutingPolicyResult` 的最小 contract shape，但不拥有这些 shape 的 contract owner。
- 后续流程如何消费：downstream 只能消费 typed constraints，并必须在 Agent Core 内做 governance 后才影响 path selection。

## 失败与降级（Failure / Degradation）

- invalid contract shape：contract/schema validation failure，submit 不应被 accepted 为含有效 `routingConstraints` 的 request。
- forbidden override 字段：拒绝 typed construction 或作为 invalid shape 处理，不得静默保留。
- runtime carry failure：request acceptance 失败并返回 safe error；不得 accepted 后丢弃 constraints。
- dependency missing：若 downstream routing validation 尚未实现，本 contract 仍只保证 carry；不得让 runtime 临时代替 governance。
- timeout/cancel：本 contract 不引入慢边界；若 request acceptance 被取消，按现有 runtime cancellation 语义处理。
- observability unavailable：不影响 contract carry；本 change 不新增 evidence 输出。

## 验收样例（Acceptance Examples）

- 正常路径：submit command 带 `routingConstraints.targetSkill=alarm-diagnosis` 和 `maxToolCalls=2`；accepted `RequestContext` 携带同一 typed value，runtime 不执行 Skill。
- 边界路径：submit command 不带 `routingConstraints`；accepted `RequestContext.routingConstraints` 为空，现有 request lifecycle 不变。
- 失败路径：payload 试图携带 `tenantId`、`providerOverride` 或 raw system prompt；这些字段不属于 `RoutingConstraints` contract，不能进入 typed command/context。
- 降级路径：下游 constraint validation change 不存在或不可用；runtime 仍只携带 typed value，不自行选择 model/capability path。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | DTO 不承载 owner/provider/prompt/policy override；runtime 不把 schema-valid 当 authorization。 | contract/negative tests |
| 性能/容量 | request-scoped 小 DTO，无新慢边界。 | contract tests |
| 可靠性/恢复 | accepted context 携带 typed fact；retry/edit 新建 request fact。 | runtime contract tests |
| 可维护性 | 单一 owner 为 `agent-contracts/runtime`，避免 parallel DTO。 | architecture review |
| 可测试性 | 可用 contract tests 验证 export、field shape 和 carry-only。 | `test:contract` |
| 审计/可追溯性 | contract 可追溯到 request command/context，但不记录 raw payload。 | code review |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| DTO owner 是 `agent-contracts/runtime` | 1.1 | contract tests / code review |
| command/context 可携带 constraints | 1.2 | contract tests |
| 禁止字段不进入 DTO | 1.3 | negative contract tests |
| runtime carry-only | 2.1 | architecture tests |
| 不新增 routing subpath/decision kind/PolicyPort | 2.2 | architecture/code review |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-core-contracts/spec.md`
- 设计主承载：`openspec/designs/architecture/core-contracts.md`
- 模块边界：`openspec/designs/modules/agent-contracts.md`
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] 纯 contract refinement 增加依赖链。 -> [缓解] 只包含最小 DTO 和 carry 字段，让后续 routing changes 不争夺 contract owner。
- [风险] runtime 字段被误当 business routing owner。 -> [缓解] spec 明确 runtime carry-only，治理在 Agent Core 后续 change。
- [风险] DTO 未来字段增长。 -> [缓解] allow-list 固定；新增字段必须走 OpenSpec change。
- [风险] router change 自行定义 contract shape 导致 owner 分裂。 -> [缓解] 本 refinement 先声明最小 shape owner，router change 只消费。

## 迁移计划（Migration Plan）

无数据迁移。实现时只扩展 `agent-contracts/runtime` public DTO/schema 和 runtime acceptance carry path；不改变既有 request lifecycle 默认行为。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-core-contracts/spec.md`：同步 runtime-owned `RoutingConstraints` contract。
- `openspec/designs/architecture/core-contracts.md`：同步 export surface、DTO 和 command/context 字段。
- `openspec/designs/modules/agent-contracts.md`：同步 runtime subpath owner。
- `openspec/designs/spec-to-design-map.md`：按需增加导航。

## 待确认问题（Open Questions）

无。当前设计选择 `agent-contracts/runtime` owns request-carried `RoutingConstraints`，并在 `SubmitRequestCommand` 与 accepted `RequestContext` 上增加可选 `routingConstraints`。
