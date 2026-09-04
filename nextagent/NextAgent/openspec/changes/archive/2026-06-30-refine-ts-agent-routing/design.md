## 背景和现状（Context）

现有 routing core 已有两条下游受控路径：

1. `skillName` -> governed Skill loading path
2. `recipeName` -> workflow execution path

但 `mode=policy` 仍然只保留一个“受控 policy 入口”，不会真正根据 accepted request text 做规则匹配。另一方面，routing policy 目前拿到的 `RequestContext` 也没有显式的 accepted input text。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 允许 trusted Agent routing config 声明多个 ordered regex rules。
- 每条 rule 都能把命中结果固定映射到 `SKILL` 或 `WORKFLOW` 目标。
- routing policy 只消费 runtime-owned accepted input text，不消费 raw prompt override、model output 或 untrusted metadata。
- 首条命中规则产生 deterministic flow；未命中稳定回退 model-driven loop。

**非目标：**

- 不支持用户提交 regex rule。
- 不支持 rule-level flags、priority expression、compound boolean DSL。
- 不新增新的 deterministic flow 执行 owner。
- 不改变 targeted Skill governance 或 workflow execution owner。

## 设计决策（Decisions）

1. **配置形状**

`AgentRoutingPolicyConfig` 扩展为：

- `method: "policy:intent-recognition"`
- `rules?: readonly AgentRoutingPolicyRule[]`

其中 `AgentRoutingPolicyRule` 形状为：

- `reg: string`
- `target.kind: "SKILL" | "WORKFLOW"`
- `target.name: string`

2. **规则语义**

- 规则按数组顺序执行，`first-match-wins`。
- `reg` 使用 ECMAScript `RegExp` source。
- trusted config 中的非法 regex 视为 routing policy configuration invalid，fail closed。
- 未声明 `rules` 或 `rules` 全部未命中时，回退既有 model-driven loop。

3. **受控输入边界**

- runtime 在 accepted `RequestContext` 中携带 runtime-owned `acceptedInputText`。
- routing policy 只读取该字段，不读取用户 body 中其他 routing override，也不读取模型输出。
- `acceptedInputText` 仅作为 routing input；不得自动暴露给 model prompt 或 observability payload。

4. **下游翻译**

- 命中 `target.kind="SKILL"` 时，routing policy 产出 `DETERMINISTIC_FLOW + skillName`，复用既有 governed Skill loading path。
- 命中 `target.kind="WORKFLOW"` 时，routing policy 产出 `DETERMINISTIC_FLOW + recipeName`，复用既有 workflow execution path。

## Routing Path

1. runtime 接受请求并冻结 `acceptedInputText` 到 `RequestContext.acceptedInputText`
2. Agent Core 先处理显式 trusted constraints（如现有 `targetRecipe`）
3. 若 assembly routing 为 `mode=policy` 且 method 为 `policy:intent-recognition`
4. routing policy 依序执行 `rules`
5. 首个命中：
   - `SKILL` -> `skillName`
   - `WORKFLOW` -> `recipeName`
6. 未命中 -> `MODEL_DRIVEN_LOOP`

## 失败与回退（Failure / Fallback）

- routing config 缺少 `policy`、rule target kind 非法、target name 非法、regex 无法编译：`ROUTING_POLICY_CONFIGURATION_INVALID`
- `acceptedInputText` 缺失、为空或所有 rules 未命中：回退 `MODEL_DRIVEN_LOOP`
- workflow/skill 的治理、可用性、预算与 owner scope 校验继续由既有下游 owner 负责

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| routing config 支持 ordered regex rules | 1.1 | parser / contract tests |
| accepted input text 进入 routing policy 输入 | 1.2 | runtime carry test |
| regex 命中 Skill | 2.1 | `agent-routing-core.test.ts` |
| regex 命中 Workflow | 2.2 | `agent-routing-core.test.ts` |
| 多规则按顺序匹配 | 2.3 | `agent-routing-core.test.ts` |
| regex 未命中回退 model loop | 2.4 | `agent-routing-core.test.ts` |
| 非法 regex fail closed | 3.1 | parser + routing tests |
