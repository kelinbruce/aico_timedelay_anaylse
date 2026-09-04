## 设计范围

| 受影响 Function | 目标变化 | delta specs | 设计章节 |
|---|---|---|---|
| `FN-2.5 请求自动路由` | 配置规则的 `SKILL` 目标纳入治理可用性判定并统一降级；显式可信定向 Skill 约束优先于配置规则；可信路由目标的 Skill 加载在会话作用域内解析且不再要求模型侧发现 | `agent-routing-core`（主规格） | [FN-2.5 请求自动路由](#fn-25-请求自动路由) |

本次没有跨 Function 共享质量机制，不创建 change 级"跨 Function 质量属性设计"；没有存量 Requirement 跨 spec 迁移，不创建"存量 Requirement 迁移方案"。

## FN-2.5 请求自动路由

### 目标与规范依据

黑盒目标见 proposal 的"目标"：配置驱动的 `SKILL` 规则要么走通受治理 Skill 加载路径，要么安全降级；显式选择优先于配置；受信目标不被模型侧门禁挡住。

本 Function 的目标 Requirements（唯一 canonical spec：`agent-routing-core`）：

- `MODIFIED` `Policy routing uses controlled input and output contracts`
- `MODIFIED` `Routing core emits safe downstream commands`

### 当前实现

- `packages/agent-core/src/routing/agent-routing-policy.ts` 的 `DefaultAgentRoutingPolicy.decide()` 按顺序处理：capability 指令 → `targetRecipe` 约束 → `mode=policy` 规则 → 默认模型驱动循环。`matchPolicyRule()` 命中后，只有 `recipeName` 会经 `isRecipeCapabilityAvailable()` 判定，`skillName` 直接进入确定性路由结果。
- `packages/agent-core/src/agent/default-agent.ts` 把 `recipeName` 交给 workflow 路径，把 `skillName` 交给 `TargetedSkillRouter`；`routingConstraints.targetSkill` 由同一个 router 在 `BEFORE_MODEL_INVOKE` 阶段服务。
- `packages/agent-core/src/routing/targeted-skill-router.ts` 解析目标 Skill 与 `Skill` 加载器，解析失败抛 `ROUTING_PREFERRED_SKILL_UNAVAILABLE`；调用时只注入 `capabilityResolver`，解析请求不带 `sessionId`。
- `packages/agent-capability/src/builtins/skill-tool.ts` 的 `checkSkillDisclosure()` 对 `DEFERRED` 或非 `model-invocable` 的 Skill 要求调用上下文中已列出该 Skill（`discoveredSkills`），否则返回 `SKILL_NOT_DISCOVERED`；`discoveredSkills` 现由 ToolSearch 与 SkillHub 获取写入。

### GAP 分析

| 目标 | 当前事实 | GAP |
|---|---|---|
| 配置 `SKILL` 目标不可用时降级 | 不判定可用性，进入加载路径后安全失败，整个请求失败 | 缺少与 recipe 对称的治理可用性判定与降级分支 |
| 不用其他 capability 替换目标 | 加载路径按 kind 拒绝，但结果是失败而非降级 | 判定位置错误：应在路由决策处判定 kind |
| 显式约束优先于配置 | `targetRecipe` 短路在 policy 分支之前，`targetSkill` 无对应分支 | policy 分支缺少显式约束短路，且可能重复加载 |
| 可信目标不依赖模型侧发现 | 定向调用未声明已披露 Skill，被 `SKILL_NOT_DISCOVERED` 拦截 | 缺少"已治理即已披露"的调用上下文声明 |
| 目标解析覆盖会话作用域 | recipe 解析带 `sessionId`，Skill 解析不带 | 解析请求字段缺失 |

### 修改方案

1. `agent-routing-policy.ts` 抽出私有 `isGovernedCapabilityAvailable(context, assembly, capabilityId, kind)`，`isRecipeCapabilityAvailable` 与新增的 `isSkillCapabilityAvailable` 共用，消除两条分支再次漂移的可能。
2. `decide()` 的 `mode=policy` 分支：命中结果携带 `skillName` 时先判定可用性，未通过返回 `MODEL_DRIVEN_LOOP` + `POLICY_RULE_SKILL_MISS_FALLBACK`；判定顺序保持 recipe 在前，与既有 `POLICY_RULE_WORKFLOW_MISS_FALLBACK` 对称。
3. 同一分支内，`context.routingConstraints?.targetSkill` 存在时不调用 `matchPolicyRule()`，返回 `MODEL_DRIVEN_LOOP` + `POLICY_RULE_TARGET_SKILL_PRIORITY`。短路只作用于 policy 分支，`mode=default` 仍返回 `DEFAULT_MODEL_DRIVEN_LOOP`。由于该请求的决策不再携带 `skillName`，`DefaultAgent` 只会通过约束路径加载一次 Skill。
4. `targeted-skill-router.ts` 在定向调用的 runtime context 中加入 `discoveredSkills: [已解析目标 Skill 的 capabilityId]`。该字段既有语义是"本请求内已被披露、允许加载的 Skill 集合"，由 ToolSearch 与 SkillHub 获取产出；路由在此之前已完成治理视图解析、`forbiddenCapabilityIds` 与能力预算校验，并通过只应答该 id 的 resolver 下发，因此声明范围严格限于本次调用。
   - 备选方案（已否决）：在 `CapabilityInvocationRuntimeContext` 新增 `trustedDirectedSkill` 字段——与 `discoveredSkills` 语义重复，且为不增加治理能力的前提下扩大 frozen capability contract。
   - 备选方案（已否决）：放宽 Skill 加载器的 `modelInvocable !== true` 判定——会让模型发起的调用也能加载非模型可调用 Skill。
5. `targeted-skill-router.ts` 的 `resolveCapability()` 携带 `context.sessionId`，与 recipe 解析一致。
6. 质量属性影响：
   - 安全：规范依据 `Routing core emits safe downstream commands` 的"可信路由目标的 Skill 加载不依赖模型侧发现"。本 Function 的局部机制是"披露范围限定为单次定向调用 + 只应答目标 id 的 resolver"，验证关注点是模型发起的 `Skill` 调用仍被 `SKILL_NOT_DISCOVERED` 拒绝。
   - 可靠性/恢复：规范依据 `Policy routing uses controlled input and output contracts` 的"命中的 SKILL 规则目标不可用"。局部机制是降级到模型驱动循环，验证关注点是请求不失败且不替换目标。

## 长期基线刷新计划

归档前需同步：

- `openspec/specs/agent-routing-core/spec.md`：合入本次两条 `MODIFIED` Requirement 的目标态正文与 Scenarios。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.5-请求自动路由.md`：按"Function 变更汇总"的处理过程、结果与规格字段刷新。
- `docs/workflow-usage-guide.md`：已在本次 change 内同步 target 可用性判定规则与安全原因码排障表，归档时确认与最终 spec 一致。
