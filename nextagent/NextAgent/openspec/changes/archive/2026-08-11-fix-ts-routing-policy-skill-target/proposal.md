## 背景

`agent.yaml` 的 `routing.mode=policy` 允许配置正则规则，把受理后的用户问题自动路由到 `SKILL` 或 `WORKFLOW` 目标。两类 target 当前处理不对称，`SKILL` 一侧在产品路径上无法走通：

1. 命中的 `WORKFLOW` 规则会先按治理后的 capability 视图确认 recipe 可用，不可用时降级到模型驱动循环；命中的 `SKILL` 规则不做任何可用性确认，直接产出确定性路由结果。目标名字写错或 kind 不符时，请求整体以安全失败结束，而不是按已发布的使用指导降级到对话循环。
2. 受信路由目标进入 Skill 加载路径后，仍被"模型必须先经 ToolSearch 发现"的披露门禁拦截。配置驱动的目标从不经过模型发现，因此声明 `model-invocable: false` 的 Skill（规则触发型 Skill 最自然的写法）永远无法被规则加载。
3. 受信路由目标的 Skill 解析没有携带会话作用域，看不到会话级 Skill 源，而同一决策里的 recipe 解析是带会话作用域的。
4. 请求显式携带的可信 `targetSkill`（含 `$skill:` 指令投影）不会短路配置规则，而 `targetRecipe` 会。配置规则因此可以覆盖用户的显式选择，并可能在同一请求内加载两个 Skill。

## 目标

- 命中的 `SKILL` 规则与 `WORKFLOW` 规则一样，先按治理后的 capability 视图确认目标可用且 kind 相符；不可用时降级到模型驱动循环并给出安全原因码。
- 配置目标不可用不再使已受理的请求失败，也不得替换成其他 capability。
- 受信路由目标的 Skill 加载在会话作用域内解析，并且不再需要模型侧发现步骤。
- 请求携带可信 `targetSkill` 约束时，配置规则不参与评估，显式选择优先且 Skill 只加载一次。

## 非目标

- 不改 `$skill:` / `$workflow:` 指令与 `targetRecipe` 的安全失败语义：显式选择的目标不可用时仍然安全失败。
- 不改 `forbiddenCapabilityIds` 与受约束能力预算的拦截语义和错误码。
- 不放宽 Skill 加载器自身的披露门禁：模型自行猜测名称加载未披露 Skill 仍被拒绝。
- 不改 recipe 的扫描根目录、workflow 执行路径和插件路由策略点。
- 不新增 Web API、stream event、runtime command 或持久化事实。

## 变更范围

1. **配置规则目标可用性校验**：`mode=policy` 命中 `SKILL` 规则后，按 `CapabilityCatalog` 治理视图解析 `target.name` 并要求 `kind=SKILL`；未命中时返回模型驱动循环，安全原因码 `POLICY_RULE_SKILL_MISS_FALLBACK`。recipe 与 Skill 的可用性判断收敛为同一个私有解析入口。
2. **显式约束优先级**：`mode=policy` 分支内，请求携带可信 `targetSkill` 时不评估配置规则，返回模型驱动循环，安全原因码 `POLICY_RULE_TARGET_SKILL_PRIORITY`；该约束仍由既有受治理 Skill 加载路径服务。
3. **受信目标披露**：受信路由目标在本次定向调用中被声明为已披露 Skill，使已治理的目标可以进入加载路径。
4. **会话作用域**：受信路由目标的 Skill 解析携带受理请求的 `sessionId`。
5. **测试与文档**：补充路由回归测试；使用指导补充 target 可用性判定规则与安全原因码排障表。

## Function 影响（OpenSpec Capabilities）

### 修改 Function

- `FN-2.5 请求自动路由`
  - canonical spec：`agent-routing-core`（本次唯一主规格 target；同 Function 的 `routing-evidence-and-fallback` 未触及）
  - 变化边界：配置规则的 `SKILL` 目标纳入治理可用性校验并统一降级；显式可信 `targetSkill` 约束优先于配置规则；受信路由目标的 Skill 加载在会话作用域内解析且不再要求模型侧发现
  - 涉及系统质量属性：安全（不替换目标 capability、不放宽模型侧披露门禁）、可靠性/恢复（配置目标缺失时降级而非失败）、可诊断（新增两个安全路由原因码）

### 新增 Function

无。

## 被动影响

- `packages/agent-core/src/routing/agent-routing-policy.ts`：新增 Skill 目标可用性校验与显式约束短路，recipe/Skill 可用性判断合并。
- `packages/agent-core/src/routing/targeted-skill-router.ts`：定向调用声明已披露 Skill，能力解析补齐会话作用域。
- `packages/agent-core/tests/agent-routing-core.test.ts`：新增 4 条路由回归。
- `docs/workflow-usage-guide.md`：补充可用性判定规则与安全原因码排障表。
- 既有 `POLICY_APPLIED` 时间线事件新增两个安全原因码取值，事件形状不变。
