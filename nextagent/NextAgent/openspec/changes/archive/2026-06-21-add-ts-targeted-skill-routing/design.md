## 背景和现状（Context）

已有 capability governance 和 Skill tool 规格定义了 Skill 作为 capability 的发现、可见性和模型调用路径。roadmap 还要求用户可以显式指定某个 Skill 处理请求。这个能力容易与模型 `Skill` tool use 混淆，也容易被误实现为 channel/runtime 直接调用 Skill。

本设计把 `targetSkill` 定义为 Agent routing constraint，由 Agent Core 在 routing policy 内处理。只有通过 request-scope capability governance 的 Skill 才能进入 directed Skill path。

该路径依赖 `refine-ts-routing-constraints-contract` 提供 `RoutingConstraints.targetSkill`，并依赖 `add-ts-routing-constraint-validation` 提供 schema/governance boundary。当前已冻结 `RoutingDecisionKind` 不包含 directed Skill 或 directed capability kind，因此本 change 不新增 public routing decision kind；通过校验的 target Skill 映射为 `DETERMINISTIC_FLOW` 内部执行分支。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 支持用户/上游显式指定 Skill。
- 确保显式指定仍经过当前 Agent binding、Owner Scope authorization/visibility、availability、forbidden constraint、deadline/cancel 和执行预算校验。
- 明确 directed Skill path 与模型 `Skill` tool use 的差异。
- 定义失败时的 safe error、clarification、handoff 或 policy-declared fallback。
- 复用现有 routing decision vocabulary，不新增 public directed Skill decision kind。

**非目标：**
- 不定义 Skill manifest、Skill body loading 或 SkillHub discovery。
- 不实现 fork Skill execution。
- 不定义通用 routing policy extension 或 recipe dispatch。
- 不改变 capability invocation result contract。
- 不定义 request-carried `RoutingConstraints` 的 contract 字段；该字段由 `refine-ts-routing-constraints-contract` 提供。
- 不在本 change 校验 locale/version/provider policy、executionMode、allowHumanInput 或 allowSubagents；这些通用约束由 `add-ts-routing-constraint-validation` 或后续 capability policy change 承载。

## 设计决策（Decisions）

1. `targetSkill` 是 typed routing constraint，不是 authorization。
2. channel/runtime 不 resolve、不 execute preferred Skill。
3. Agent routing policy 先处理 trusted preferred Skill constraint，再进入 model-driven loop。
4. Skill resolve 通过 request-scope capability governance，必须匹配 kind=`SKILL`。
5. 若 preferred Skill 不可用或不允许，policy 必须显式选择 reject、clarify、handoff 或 fallback-to-model；不得静默选择其他 Skill。
6. 模型 `Skill` tool use 与用户 directed Skill path 分离，二者都经 capability governance。
7. accepted preferred Skill 映射为 `DETERMINISTIC_FLOW` 的 Agent-owned internal branch；如后续需要独立 `DIRECTED_SKILL` decision kind，必须提出 contract refinement。
8. 本 change 的主要 owner 是 `agent-core`；`agent-capability` 只提供 request-scope Skill resolve、availability 和 authorization facts，不拥有业务路由决策。

## 触发机制（Trigger）

- 用户动作：用户或可信上游提交请求时提供 `targetSkill`。
- 流程阶段：runtime acceptance 后，Agent routing policy 初始路径选择阶段；必须早于首次 model invocation。
- 状态触发：retry/edit 新请求重新校验 preferred Skill；resume 只能恢复当前 request 已确定的 lifecycle stage。
- 预算检查：Skill resolve、availability probe 和 execution 受 request deadline、AbortSignal 和 capability invocation budget 约束。
- 调度机制：不由后台 job 主动触发；recovery 只恢复 request lifecycle。
- 同步/异步：routing decision 同步；Skill availability probe 可以是可取消 async 边界；audit/log/trace 异步消费。

## 输入与前置条件（Inputs / Preconditions）

输入：
- accepted `RequestRun`、`RequestContext`、frozen `AgentAssembly`。
- typed `targetSkill` constraint。
- optional `forbiddenCapabilityIds`。
- request-scope capability catalog/resolver with kind=`SKILL` support。
- Owner Scope、Agent Scope、availability and authorization facts。
- cancellation signal, deadline, and capability invocation budget facts。

前置条件：
- `add-ts-agent-routing-core` 的 Agent routing decision point 已存在。
- `refine-ts-routing-constraints-contract` 的 request-carried `RoutingConstraints.targetSkill` contract 已完成。
- `add-ts-routing-constraint-validation` 的 routing constraint schema/governance boundary 已完成。
- capability governance 已能提供 request-scope Skill visibility/resolve。
- `targetSkill` 已通过 constraint schema 初筛，但尚未代表可执行授权。
- Skill id 不能来自模型输出、capability 参数或客户端自报 owner scope。

## 输出与副作用（Outputs / Side Effects）

输出：
- accepted deterministic routing decision with internal preferred Skill execution intent。
- rejected preferred Skill outcome with safe reason code。
- downstream governed `CapabilityInvocationRequest` for Skill execution。
- pending input/handoff/safe error/model fallback command when policy selects it。
- safe routing outcome/evidence for observability。

副作用：
- 成功执行通过 existing capability invocation result 影响 request-local generated messages/context patches/refs/degradation。
- runtime timeline/audit/log/trace 只接收脱敏 outcome/evidence。
- 不直接写 session messages、terminal commit、checkpoint、audit sink 或 catalog state。

## 核心判断逻辑（Core Decision Logic）

1. Agent routing policy 读取 frozen AgentAssembly、Owner Scope、typed constraints、constraint validation outcome 和 budget。
2. 若无 `targetSkill`，返回 normal routing core 后续判断。
3. 校验 `targetSkill` 字符串形态和 safe id 规则。
4. 若 `targetSkill` 被 `forbiddenCapabilityIds` 排除，拒绝 directed Skill path。
5. 通过 capability governance 按 kind=`SKILL` 和 capabilityId 解析 request-scope candidate。
6. 校验 candidate 属于当前 Agent binding、enabled、available，并对当前 Owner Scope authorized/visible。
7. 校验 capability invocation budget、deadline 和 AbortSignal。
8. 若全部通过，选择 `DETERMINISTIC_FLOW`，并在 Agent Core 内部构造 governed Skill invocation。
9. 若失败，按 policy 顺序选择 safe error、clarification、handoff 或 fallback-to-model；不得执行未通过校验的 Skill 或静默替换其他 Skill。
10. `fallback-to-model` 只允许进入当前 accepted request 已存在的 `MODEL_DRIVEN_LOOP` 下游命令边界；不得重新触发一轮完整 routing decision，不得再次解释同一个 `targetSkill`，也不得回到 constraint schema/governance 入口形成 request-local reroute loop。

## 状态 / 产物契约（State / Artifact Contract）

Targeted Skill routing decision 是 request/run 范围内的路由事实：
- 语义：表示用户/上游 preferred Skill 是否被接受，以及后续走哪个安全路径。
- 生命周期：仅当前 request/run 有效；retry/edit 必须重新校验。
- 消费方：Agent Core、CapabilityInvocationPort、routing evidence、audit/log/trace、channel final projection。
- 与原始事实关系：关联 sessionId、runId、requestContextId、agentId、agentVersion、targetSkill、selected capability id 和 safe reason code。
- 安全限制：不包含 Skill body、source raw path、provider-private ref、raw manifest、secret、raw policy internals 或 raw errors。

本 change 不产生 summary、artifact、checkpoint、memory record 或 learning event。

## 流程接入（Flow Integration）

主流程：

`Channel typed request -> Runtime accepted request -> Agent Routing Policy -> Deterministic targeted Skill branch -> CapabilityInvocationPort -> Agent Core result consumption -> Runtime terminal`

- 上游：channel 可传递 typed `targetSkill`；runtime 保存 accepted facts；`add-ts-routing-constraint-validation` 先产出可被消费的 accepted/rejected/degraded constraint outcome。
- 接入点：Agent routing policy 的显式约束处理分支。
- 下游：capability resolver/catalog 提供 governed Skill；CapabilityInvocationPort 执行；Context/Model 后续消费 generated messages/context patches。
- 后续流程：routing evidence 记录 accepted/rejected/fallback outcome；channel 只显示最终 answer、pending input、handoff 或 safe error。
- 治理顺序：`targeted-skill-routing` 只消费仍然通过 `routing-constraint-validation` 的 `targetSkill` request fact 或其 validation outcome；不得重新定义一套独立 constraint governance，也不得把 schema-valid 但已被治理拒绝的 `targetSkill` 重新拿回来执行。

## 失败与降级（Failure / Degradation）

- Skill id 无效：safe validation error 或 clarification。
- Skill 不存在/不属于 Agent：safe not available/policy error，不搜索全局 Agent。
- 未授权、不可见或 Owner Scope 不匹配：safe authorization error。
- availability probe 失败：safe unavailable 或 policy-declared fallback。
- forbidden constraint 冲突：reject directed Skill path。
- budget/timeout/cancel：safe budget/timeout/canceled，不使用 stale resolve。
- capability invocation 失败：按 `CapabilityInvocationResult` 和 routing evidence 记录 degradation；不得伪装成成功 Skill 结果。
- audit/log/trace 失败：不改变 Skill routing decision。

## 验收样例（Acceptance Examples）

- 正常路径：`targetSkill=alarm-diagnosis`，Skill 绑定到当前 Agent、可用且授权；Agent routing 选择 deterministic targeted Skill branch 并通过 capability invocation 执行。
- 边界路径：`targetSkill` 与 `forbiddenCapabilityIds` 冲突；routing 拒绝 Skill，返回 safe error 或澄清。
- 失败路径：Skill 属于另一个 Agent、不可见或未授权；routing 不调用它，也不全局搜索替代 Skill。
- 降级路径：Skill availability probe 超时；routing 返回 safe timeout 或在 policy 允许时直接进入既有 `MODEL_DRIVEN_LOOP` downstream path，并记录 safe outcome；不得重新开始一轮 routing。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | preferred Skill 不代表授权；所有执行经过 Agent/Owner/capability governance。 | negative tests |
| 性能/容量 | resolve/probe 受 deadline 和 AbortSignal 控制。 | timeout tests |
| 可靠性/恢复 | retry/edit 重新校验；resume 不使用 stale partial resolve。 | characterization tests |
| 可维护性 | 与 model Skill tool path 分离，避免入口混淆。 | code review；architecture tests |
| 可测试性 | accepted/rejected/fallback 分支可用 resolver fake 覆盖。 | unit tests |
| 审计/可追溯性 | 输出 safe outcome，不泄漏 Skill body/provider-private refs。 | evidence/redaction tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| targetSkill 是 constraint | 1.1 | channel/runtime non-bypass tests |
| Skill 最小执行前治理 | 1.2 | targeted routing tests |
| forbidden 冲突拒绝 | 2.1 | negative tests |
| Agent binding / Owner authorization 校验 | 2.2 | security tests |
| 与 model Skill tool use 分离 | 2.3 | unit tests |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/targeted-skill-routing/spec.md`
- 架构和跨模块设计：`openspec/designs/architecture/ts-backend-architecture.md`
- 模块设计：`openspec/designs/modules/agent-core.md`、`openspec/designs/modules/agent-capability.md`
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] 用户指定 Skill 被误当成授权 -> [缓解] spec 明确 constraint-only 和治理前置。
- [风险] 与模型 Skill tool use 混淆 -> [缓解] 独立 requirement 锁定两条路径。
- [风险] 失败时静默换 Skill 降低可解释性 -> [缓解] 必须显式 reject/clarify/handoff/fallback-to-model。

## 迁移计划（Migration Plan）

无数据迁移。实现时在 routing-core 决策点增加 deterministic targeted Skill internal branch，并复用既有 capability result consumption。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/targeted-skill-routing/spec.md`：同步行为契约。
- `openspec/designs/architecture/ts-backend-architecture.md`：同步 directed Skill flow。
- `openspec/designs/modules/agent-core.md`：同步 routing owner。
- `openspec/designs/modules/agent-capability.md`：同步 Skill governance 消费关系。
- `openspec/designs/spec-to-design-map.md`：增加导航。

## 待确认问题（Open Questions）

无。`targetSkill` 的 request-carried contract 字段由 `refine-ts-routing-constraints-contract` 提供，本 change 不直接修改该 contract。
