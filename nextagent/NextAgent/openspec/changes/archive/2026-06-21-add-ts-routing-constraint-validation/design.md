## 背景和现状（Context）

Agent Routing 能力组需要在用户和上游入口表达处理偏好，但 NextAgent 的 Agent Scope、Owner Scope 和 capability governance 不能被请求体、模型输出或 capability 参数覆盖。当前 roadmap 已列出首批 constraint 字段，本 change 把这些字段收敛成 allow-list，并定义双阶段校验。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 定义 routing constraints allow-list 和 forbidden override。
- 定义 schema validation 与 Agent policy governance 两阶段。
- 保证 constraints 只能收窄或引导，不扩大权限。
- 定义失败/降级和观测输出。

**非目标：**
- 不定义新的 Web API endpoint。
- 不定义 targeted Skill 的执行细节。
- 不定义完整 routing evidence 字段。
- 不实现 policy extension DSL 或 remote policy service。
- 不新增 `agent-contracts/routing` subpath、不新增 generic `PolicyPort`、不新增 public routing decision kind。
- 不在本 change 修改 `agent-contracts`；`RoutingConstraints` runtime contract 由 `refine-ts-routing-constraints-contract` 承载。

## 设计决策（Decisions）

1. 允许字段固定为 `targetSkill`、`forbiddenCapabilityIds`、`executionMode`、`locale`、`maxToolCalls`、`allowHumanInput`、`allowSubagents`。
2. 禁止字段包括 owner/tenant/subject/agent/provider/capability provider/raw system prompt/raw policy/raw model profile override。
3. 本 change 依赖 `refine-ts-routing-constraints-contract` 提供 request-carried `RoutingConstraints`。contract owner 为 `agent-contracts/runtime`，runtime 原样携带到 Agent execution。
4. channel/request boundary 负责 schema validation；runtime 只携带 typed constraints；Agent routing policy 负责 governance。
5. schema-valid 不代表 authorized；所有影响路径的 constraint 必须在 Agent policy 内校验。
6. invalid or unavailable validation 不得静默丢弃；必须 reject、ignore-with-evidence、clarify、handoff 或 fail closed。
7. 本 change 的主要 owner 是 `agent-core`；`agent-channel-web` 只拥有 untrusted boundary schema construction，`agent-capability` 只提供治理阶段所需的 capability facts，不拥有最终 routing authority。

## 触发机制（Trigger）

- 用户动作：提交包含 routing constraints 的 request。
- 流程阶段 1：channel/request boundary schema validation，在 runtime acceptance 之前或 acceptance 输入构造时同步触发。
- 流程阶段 2：Agent routing policy governance，在 accepted request 进入 Agent boundary 后、路径选择和慢边界调用前同步触发。
- 状态触发：retry/edit 新请求重新校验；resume 不重新解释已接受请求的 raw client payload。
- 预算检查：`maxToolCalls`、`allowHumanInput`、`allowSubagents`、`executionMode` 在调用对应慢边界前检查。
- 后台 job：不由后台 job 触发。
- 同步/异步：schema stage 同步；governance stage 同步决策，可调用可取消 async catalog/availability checks；observability 异步。

## 输入与前置条件（Inputs / Preconditions）

输入：
- untrusted request constraint payload。
- channel/auth trusted identity and locale policy。
- accepted RequestRun/RequestContext after runtime admission。
- frozen AgentAssembly。
- capability governance view, availability, authorization, model/capability budgets。
- policy identity/version and current execution state。
- AbortSignal/deadline。

前置条件：
- `refine-ts-routing-constraints-contract` 已明确 request-carried `RoutingConstraints` 的 owning subpath、字段、schema 和 request command / accepted execution context 承载位置。
- untrusted payload 必须经过 channel/request boundary runtime schema validation 才能成为 typed constraints。
- accepted request 已绑定 Agent Scope 和 Owner Scope。
- Agent routing policy 已存在并是业务路径选择 owner。
- constraints 不得来自模型输出或 capability 参数来扩大 authority。

## 输出与副作用（Outputs / Side Effects）

输出：
- typed `RoutingConstraints` value after schema stage, using `refine-ts-routing-constraints-contract` shape。
- governance outcome：accepted、rejected、ignored、degraded、clarification-required、handoff-required。
- safe reason code and safe summary for routing evidence/audit/log/trace。
- downstream narrowed candidate set or selected safe path.

副作用：
- 不修改 AgentAssembly、catalog/provider config、Owner Scope、session identity 或 future request policy。
- 不把 raw constraint payload 投影到用户 stream/history。
- validation failure 可导致 safe error、clarification、handoff 或 allowed fallback。

## 核心判断逻辑（Core Decision Logic）

1. 在 channel/request boundary 读取 constraint payload。
2. 只保留 allow-listed fields，并对字段类型、长度、数量、枚举和值域做 schema validation。
3. 遇到 forbidden override 字段时按 safe validation policy reject 或 ignore-with-evidence；不得进入 authority 输入。
4. runtime 接受请求时只携带 contract-defined typed constraints into accepted `RequestContext`，不解释业务语义。
5. Agent routing policy 读取 typed constraints、frozen AgentAssembly、Owner Scope 和 governed views。
6. 按固定顺序校验：scope safety、field conflicts、budget limits、human/subagent allowance、forbidden capability narrowing、preferred Skill/capability availability、locale/executionMode compatibility。
7. 对每个 rejected/ignored/degraded constraint 生成 safe reason code。
8. 将 accepted constraints 应用于当前 request candidate set；只收窄或引导，不扩大权限。
9. 若校验依赖不可用，fail closed 或选择 policy-declared degradation；不得静默当作无 constraint。

## 状态 / 产物契约（State / Artifact Contract）

Constraint validation outcome 是 request/run 范围内的诊断事实：
- 语义：说明某个 constraint 是否被 schema 接受、Agent policy 接受、拒绝、忽略或降级。
- 生命周期：只对当前 request/run 有效；retry/edit 重新校验。
- 消费方：Agent routing policy、routing evidence、audit/log/trace、tests。
- 与原始事实关系：关联 requestContextId、runId、agentId、agentVersion、constraint field name、安全 reason code；不保存 raw untrusted payload。
- 安全限制：不得包含 raw prompt、raw model output、raw tool/capability args、secret、本地路径、raw policy internals 或 owner/provider override 原文。

本 change 不产生 summary、artifact、checkpoint、memory record 或 learning event。

## 流程接入（Flow Integration）

主流程：

`Channel schema validation -> Runtime accepted typed constraints -> Agent Routing Policy governance -> Candidate narrowing/path selection -> Context/Model/Capability/Pending/Handoff/Terminal`

- 上游：channel/auth 提供 trusted identity and schema boundary。
- 接入点：runtime request acceptance carries typed constraints into `RequestContext`；Agent routing policy performs governance。
- 下游：targeted Skill routing consumes accepted `targetSkill`; routing evidence consumes validation outcomes; context/model/capability see only governed narrowed state。
- 后续消费：audit/log/trace 可记录 safe reason；channel 用户侧只看最终结果。

## 失败与降级（Failure / Degradation）

- invalid shape：safe validation error 或 ignore-with-evidence，按 policy 决定是否继续。
- forbidden override：reject 或 ignore-with-evidence，不影响 trusted scope。
- conflict between constraints：reject conflicting subset or request clarification。
- over budget：选择 reject、model-only、clarify 或 handoff。
- dependency unavailable：fail closed 或 policy-declared degradation；不得静默丢弃 constraint。
- timeout/cancel：safe timeout/canceled，不使用 partial validation outcome。
- observability unavailable：不改变 routing outcome，按 evidence change 记录 degradation。

## 验收样例（Acceptance Examples）

- 正常路径：请求带 `maxToolCalls=2` 和 `allowSubagents=false`；schema 接受，Agent policy 在当前 request 中限制工具调用和 subagent 候选。
- 边界路径：`maxToolCalls=0`；policy 不调用工具，选择 model-only、reject 或 clarification。
- 失败路径：请求体带 `tenantId`、`providerOverride` 或 raw system prompt；这些字段被拒绝或忽略，不能影响 scope/provider/prompt。
- 降级路径：catalog unavailable 导致无法校验 `targetSkill`；routing fail closed 或进入明确 safe degradation，并记录 dependency unavailable reason。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | allow-list + forbidden override + Agent governance 双阶段。 | schema/negative/security tests |
| 性能/容量 | schema 同步轻量；governance 慢检查可取消并受预算约束。 | timeout tests |
| 可靠性/恢复 | accepted typed constraints 随 request facts；retry/edit 重新校验。 | characterization tests |
| 可维护性 | constraint 字段集中定义，不混入 provider/private policy。 | code review |
| 可测试性 | schema stage 和 governance stage 可分别测试。 | unit/contract tests |
| 审计/可追溯性 | safe outcome 可被 evidence 消费，raw payload 不外泄。 | observability tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| allow-list schema | 1.1 | channel schema tests |
| forbidden override 不影响 authority | 1.2 | negative tests |
| schema + governance 双阶段 | 2.1 | agent-core tests |
| constraints 只能收窄 | 2.2 | routing governance tests |
| 依赖不可用不静默丢弃 | 3.1 | failure tests |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/routing-constraint-validation/spec.md`
- 架构和跨模块设计：`openspec/designs/architecture/ts-backend-architecture.md`
- 模块设计：`openspec/designs/modules/agent-channel-web.md`、`agent-runtime.md`、`agent-core.md`
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] 约束字段增长导致边界膨胀 -> [缓解] allow-list，新增字段必须走 OpenSpec change。
- [风险] schema-valid 被误当授权 -> [缓解] 明确双阶段和 governance requirement。
- [风险] invalid constraint 被静默忽略 -> [缓解] 必须产生 safe outcome/evidence。

## 迁移计划（Migration Plan）

无数据迁移。本 change 在 `refine-ts-routing-constraints-contract` 完成后新增 typed constraint schema，并在 Agent routing policy 引入 governance stage。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/routing-constraint-validation/spec.md`：同步行为契约。
- `openspec/designs/architecture/ts-backend-architecture.md`：同步 constraint flow。
- `openspec/designs/modules/agent-channel-web.md`、`agent-runtime.md`、`agent-core.md`：同步模块边界。
- `openspec/designs/spec-to-design-map.md`：增加导航。

## 待确认问题（Open Questions）

无。request-carried constraints contract 由 `refine-ts-routing-constraints-contract` 承载；本 change 只定义 validation/governance 行为。
