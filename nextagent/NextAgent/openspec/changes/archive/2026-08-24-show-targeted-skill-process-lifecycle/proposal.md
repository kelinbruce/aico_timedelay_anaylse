## Why

用户在 Agent Web 输入框上方的 Skill 列表中手动选择 Skill 后，系统会通过可信 routing constraint 加载该 Skill，再继续模型执行。当前模型在嵌套 Skill 内通过 function call 选择的 Skill 会作为 `CAPABILITY_STARTED` / `CAPABILITY_COMPLETED` 进入执行过程，并在 ProcessDetail 中显示“加载技能：<目标 Skill>”。但手动选择的外层 Skill 只持久化 message facts 和 routing evidence，不产生 Capability lifecycle timeline facts，导致 ProcessDetail 无法显示这次已实际发生的受治理 Skill 加载。

对用户而言，同一轮请求中可以看到内层 Skill 的执行步骤，却看不到自己显式选择并已被系统加载的外层 Skill，执行过程不完整；对运维和测试而言，也无法从用户可见 timeline 中核验 directed Skill 是否实际开始和结束。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 当请求通过可信 `routingConstraints.targetSkill` 或 `$skill:<name>` directive 指定 Skill，且该 Skill 实际进入受治理加载时，系统 MUST 产生与普通 Skill Tool 调用同形的 Capability lifecycle facts。
- 手动指定 Skill 的 lifecycle facts MUST 在 live stream 和刷新后的 history 中保持一致，并让 ProcessDetail 使用既有 Capability 标题规则显示“加载技能：<目标 Skill>”。
- lifecycle facts MUST 只持久化执行身份和状态，不持久化本地化标题、Skill body、调用参数正文或 provider 私有信息。
- 同一 directed Skill 调用的 started 与 completed MUST 复用相同 `capabilityKind`、`capabilityId`、`targetCapabilityId` 和 `toolCallId`。

**非目标：**

- 不新增 stream event type、Web API 字段、数据库表或前端专用标题类型。
- 不改变 `$skill:` 指令解析、routing governance、Agent Scope、Owner Scope、Skill body 持久化或模型上下文行为。
- 不把“用户选择了某个 Skill”伪造成执行事实；目标不可用、被禁止或在 capability 开始前失败时，MUST NOT 生成 Capability lifecycle facts。
- 不让前端从用户消息 metadata、`POLICY_APPLIED` 或本地 state 推导 Capability 执行标题。
- 不区分“手动选择”和“模型选择”的标题文案；两者都属于同一 Skill 加载语义。

## What Changes

- 修改 directed Skill 路由的执行事实：当受治理的目标 Skill 实际开始加载时，系统发布引用已持久化 Tool-use message 的 `CAPABILITY_STARTED`；加载产生最终结果后，系统发布引用已持久化 Capability result message 的 `CAPABILITY_COMPLETED`。
- 修改请求状态可见性：ProcessDetail 对 directed Skill lifecycle 使用既有 Capability identity 解析和标题模板，与普通模型 function call 选择的 Skill 保持一致。
- 保持既有兼容性：旧 history 中没有 directed Skill lifecycle facts 时继续按现状渲染，不补造步骤；新产生的 directed Skill lifecycle facts 使用既有 `CAPABILITY_STARTED` / `CAPABILITY_COMPLETED` 契约。

## Feature 影响（Features）

### 修改的 Feature

- `F-2.4 查看请求状态`：用户在 ProcessDetail 中可以看到手动指定并实际加载的外层 Skill 步骤，与嵌套执行的内层 Skill 使用同一执行过程语义。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-2.6 指定技能处理` → `specs/targeted-skill-routing/spec.md`
  - 功能边界：directed Skill 从“仅持久化 message facts 与 routing evidence”扩展为“实际加载时同步产生 runtime-owned Capability lifecycle facts”。
  - 系统质量属性：可靠性/恢复、审计/可追溯性、可测试性。
  - 映射说明：canonical spec 为 `targeted-skill-routing`。

- `FN-2.4 查看请求状态` → `specs/ts-run-status-visibility/spec.md`
  - 功能边界：ProcessDetail 的 Capability lifecycle 展示范围覆盖 directed Skill，并保持 live/history 与普通 Skill 调用一致。
  - 系统质量属性：可靠性/恢复、可维护性、可测试性。
  - 映射说明：canonical spec 为 `ts-run-status-visibility`。

## 影响范围（Impact）

- **用户**：手动选择 Skill 的请求会在执行过程中增加一个“加载技能：<目标 Skill>”步骤；未实际开始加载的请求不新增该步骤。
- **Agent Web**：live 与 cold history 的 ProcessDetail 展示受影响；不新增前端状态、API 或本地推导规则。
- **公共 API / stream contract**：复用既有 `CAPABILITY_STARTED` 与 `CAPABILITY_COMPLETED` event type 及 identity 字段，不新增字段。
- **运维与审计**：directed Skill 加载开始和结束进入 canonical timeline，便于与 routing evidence、message facts 一起核验。
- **受影响实现与测试**：集中在 directed Skill routing、runtime timeline projection、Agent Web ProcessDetail projection 和相关 contract/architecture tests。
