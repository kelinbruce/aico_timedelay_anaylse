## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-2.6 指定技能处理` | 定向 Skill 实际进入受治理调用时，发布与普通 Skill Tool 调用同形的 Capability lifecycle facts。 | `targeted-skill-routing` | `FN-2.6 指定技能处理` |
| `FN-2.4 查看请求状态` | ProcessDetail 从 canonical timeline 展示定向 Skill lifecycle，并保持 live/history 一致。 | `ts-run-status-visibility` | `FN-2.4 查看请求状态` |

## `FN-2.6 指定技能处理`

### 目标与规范依据

用户手动指定 Skill 后，系统必须把实际发生的受治理 Skill 加载变成可追溯的 runtime timeline facts，而不是只留下 message facts 和 routing evidence。设计需要保证 lifecycle event 的身份、消息引用、状态和失败语义与普通 Skill Tool 调用一致，且不把调用前失败伪装成执行事实。

#### 本 Function 的目标 Requirements

canonical spec：`targeted-skill-routing`

- `ADDED`：`定向 Skill 加载必须发布 Capability lifecycle facts`

设计约束：不新增 event type、payload 字段、数据库表或 Gateway contract；复用现有 `CAPABILITY_STARTED` / `CAPABILITY_COMPLETED` 公共身份和 timeline 持久化规则。

### 当前实现

- Agent Web 将手动选择的 Skill 转换为 `$skill:<capabilityId>` 指令，runtime 通过 `normalizeCapabilityDirectiveInput` 剥离指令并生成 `routingConstraints.targetSkill`。
- `TargetedSkillRouter.invokeIfConfigured()` 在 `BEFORE_MODEL_INVOKE` 阶段解析目标 Skill 和 `Skill` wrapper，然后直接调用 `CapabilityInvocationPort.invoke()`。
- 当前 `TargetedSkillRouter.consumeResult()` 在 invocation 完成后追加 hidden `ASSISTANT_TOOL_USE`、`CAPABILITY_RESULT` 和 page-hidden Skill body messages，并记录 `POLICY_APPLIED` routing evidence。
- 当前实现不 emit `CAPABILITY_STARTED` 或 `CAPABILITY_COMPLETED`。
- 普通 model tool loop 在 invocation 前持久化 assistant Tool-use message 并 emit `CAPABILITY_STARTED`，在 invocation 后持久化 Capability result message 并 emit `CAPABILITY_COMPLETED`。
- `RuntimeOwnedAgentRunStatePort` 的 timeline persistence policy 已把合法的 `CAPABILITY_STARTED` / `CAPABILITY_COMPLETED` 标记为 persisted。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 实际开始定向 Skill 调用时发布 started | `TargetedSkillRouter` 直接调用 capability，不 emit started | 需要在 invocation 前建立可引用的 Tool-use message 并发布 started |
| 最终结果后发布 completed | `TargetedSkillRouter` 只追加 result message，不 emit completed | 需要在 result message 持久化后发布引用该 message 的 completed |
| started/completed 身份一致 | 无 directed Skill lifecycle 身份可复用 | 需要在同一调用中固化并复用 `TOOL + Skill + targetCapabilityId + toolCallId` |
| 调用前失败不得生成执行事实 | governance rejection 在 invocation 前抛出，当前无 lifecycle event | 需保持该边界，不把 pre-start failure 补成 Capability step |

### 修改方案

在 `TargetedSkillRouter` 中为 directed Skill 调用建立与普通 tool loop 相同的最小 lifecycle 写入顺序：

1. 目标 Skill 和 `Skill` wrapper 均已通过现有治理解析。
2. 在调用 `CapabilityInvocationPort.invoke()` 前，持久化现有 directed Skill 的 hidden `ASSISTANT_TOOL_USE` message，取得 `assistantToolUseMessageId`。
3. Emit `CAPABILITY_STARTED`：
   - `messageId` 使用 `assistantToolUseMessageId`；
   - `capabilityKind=TOOL`；
   - `capabilityId=Skill`；
   - `targetCapabilityId=resolvedTargetSkill.capabilityId`；
   - `toolCallId=directed-skill:<resolvedTargetSkill.capabilityId>`；
   - `stepId=turn-1`。
4. 调用统一 Capability 边界，保持现有 governance、resolver、disclosed Skill、timeout、cancellation 和重试语义不变。
5. Invocation 产生最终结果后，先持久化现有 `CAPABILITY_RESULT` message，取得 `capabilityResultMessageId`，再 emit `CAPABILITY_COMPLETED`：
   - `messageId` 使用 `capabilityResultMessageId`；
   - 身份字段与 started 逐值相同；
   - `status` 使用最终 `CapabilityInvocationResult.status`；
   - 保留现有 safe error、duration 和安全观察投影规则；
   - 成功、降级、失败和超时都先形成 result message 与 completed，再进入现有结果消费、degradation notice 或终止错误路径。
6. Skill body 仍作为 page-hidden USER message 持久化在 Capability result message 之后，现有模型上下文行为不变。
7. 目标 Skill 被禁止、不可用、Agent Scope 不匹配、deadline 已到或在 invocation 前取消时，不追加 Tool-use message，不 emit started/completed，继续走现有 routing evidence 和安全失败路径。

Payload 构造必须复用或提炼普通 tool loop 现有的 capability lifecycle payload 形状与校验逻辑，不得在 `TargetedSkillRouter` 中建立第二套身份解析或字段规则。现有 `POLICY_APPLIED` 事件保持原语义，不作为 Capability lifecycle 的替代或补充。

#### 质量属性影响

本 Function 新增 Requirement 为功能性需求；无新增黑盒质量目标。可追溯性由既有 canonical timeline 持久化机制承载。

## `FN-2.4 查看请求状态`

### 目标与规范依据

ProcessDetail 必须把 directed Skill lifecycle 当作普通 Capability 过程步骤展示，且 live 与 history 使用同一 canonical facts。前端不得从用户选择状态或 routing evidence 自行构造步骤。

#### 本 Function 的目标 Requirements

canonical spec：`ts-run-status-visibility`

- `ADDED`：`ProcessDetail 必须显示定向 Skill lifecycle`

### 当前实现

- Web stream 和 run event history 从 runtime timeline 投影 `CAPABILITY_STARTED` / `CAPABILITY_COMPLETED`。
- `processDetails.ts` 已按 `capabilityKind`、`capabilityId` 和 `targetCapabilityId` 调用 `resolveCapabilityProcessTitle()`，其中 `capabilityId=Skill` + `targetCapabilityId` 已生成“加载技能：<目标 Skill>”。
- 同一前端 presenter 已服务 live stream 和 cold history，普通模型 function call 选择的 Skill 能显示。
- 由于 directed Skill 当前缺少 lifecycle events，ProcessDetail 无输入事实可渲染。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 显示手动指定且实际加载的 Skill | 前端已支持 `Skill + targetCapabilityId` 标题，但后端不产生 directed Skill lifecycle | 后端补齐 facts 后，前端行为应自然闭合 |
| live/history 一致 | presenter 已复用 timeline events，但 directed Skill 无事件 | 需要测试覆盖 live 与 history 的同一事实渲染 |
| 不从选择状态推导步骤 | 前端未消费 `routingConstraints.targetSkill` 作为过程事实 | 保持该边界并用 negative test 锁定 |

### 修改方案

前端不新增生产代码路径。现有 stream projection、run event history 和 ProcessDetail title resolver 已具备消费 `TOOL + Skill + targetCapabilityId` 的能力；本 Function 的实施重点是补充契约和组件测试，证明：

- directed Skill started/completed 生成一条“加载技能：<目标 Skill>”过程步骤；
- 嵌套 model function call Skill 生成第二条独立步骤；
- cold history 基于同一持久化 events 渲染相同标题、顺序和状态；
- 只有用户消息 metadata 或 `POLICY_APPLIED` 而没有 Capability lifecycle facts 的旧 history 不生成步骤。

如果测试暴露 Web stream projection 对事件 payload 的字段兼容缺口，只修正该投影边界，不得在 `frontend/agent-web` 建立 fallback 标题推导或读取消息 metadata 的旁路。

#### 质量属性影响

本 Function 新增 Requirement 为功能性需求；无新增黑盒质量目标。live/history 一致性由既有 canonical timeline 投影机制和测试覆盖。

## 跨 Function 协作与端到端流程

```text
Agent Web 手动选择 SkillA
  ↓
runtime 接受请求并生成 routingConstraints.targetSkill=SkillA
  ↓
TargetedSkillRouter
  ├─ 持久化 ASSISTANT_TOOL_USE
  ├─ emit CAPABILITY_STARTED(TOOL, Skill, SkillA)
  ├─ 调用受治理 Skill wrapper
  ├─ 持久化 CAPABILITY_RESULT
  └─ emit CAPABILITY_COMPLETED(TOOL, Skill, SkillA)
  ↓
Web stream / run event history
  ↓
Agent Web ProcessDetail
  └─ 显示“加载技能：SkillA”
  ↓
模型继续执行并 function call SkillB
  ↓
普通 tool loop
  └─ ProcessDetail 继续显示“加载技能：SkillB”
```

`FN-2.6` 负责产生 canonical facts；`FN-2.4` 只消费这些 facts，不创建竞争事实。调用前失败停在 governance/routing evidence，不进入该端到端展示链。

## 验证策略（Verification Strategy）

- **agent-core contract/unit**：断言 directed Skill 成功、降级、最终失败和调用前失败下的 message 写入顺序、event 顺序、身份一致性、状态和安全错误投影；调用前失败必须断言无 Capability lifecycle events。
- **runtime timeline contract**：断言新产生的 `CAPABILITY_STARTED` / `CAPABILITY_COMPLETED` 满足既有 persistence policy，并通过 canonical timeline 持久化；不新增 live-only 或数据库旁路。
- **frontend unit/contract**：用 directed Skill lifecycle events 验证 ProcessDetail 标题、状态、与嵌套 Skill 的顺序；用旧 history 输入验证不补造步骤。
- **integration**：覆盖 Agent Web 手动选择 Skill 到 live stream / cold history 的端到端投影，不要求新增浏览器 E2E，除非实现阶段发现三宿主投影差异。
- **architecture**：确认没有跨 package private import、没有前端读取 routing metadata 推导过程事实、没有新增平行 Capability 标题实现。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/targeted-skill-routing/spec.md`：新增 directed Skill lifecycle Requirement。
- `openspec/specs/ts-run-status-visibility/spec.md`：新增 ProcessDetail directed Skill 展示 Requirement。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.6-指定技能处理.md`：更新处理过程、输出和规格，说明 lifecycle facts。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.4-查看请求状态.md`：更新过程展示范围和规格。
- `openspec/designs/features/D2-请求运行时/D2.2-请求状态与处理/F-2.4-查看请求状态.md`：更新用户价值和黑盒边界，覆盖手动指定 Skill 的过程展示。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/`：无。
- `openspec/designs/modules/`：无。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：无新增 spec 或 Function 映射，保留现有导航。

## 风险与取舍（Risks / Trade-offs）

- **重复 Skill 步骤**：用户手动加载 SkillA 后，模型仍可能再调用同一 Skill。系统不合并两次实际调用，而是按不同 `toolCallId` 保留两条事实；ProcessDetail 继续使用既有重复步骤呈现规则。
- **消息写入顺序变化**：将 `ASSISTANT_TOOL_USE` 提前到 invocation 前是为了满足 started event 的持久化 message 引用。需要用现有模型上下文和消息顺序测试确认不改变模型可见语义。
- **失败路径扩展**：最终失败现在需形成 result message 与 completed 后再进入终止错误路径，可能扩大既有失败测试的断言范围。必须保持 safe error 内容和 terminal 语义不变。
- **旧数据兼容**：不为历史请求回填 lifecycle events；旧 history 继续不显示手动 Skill 步骤，这是避免伪造执行事实的明确取舍。

## 待确认问题（Open Questions）

无。
