## 背景和现状（Context）

NextAgent 已有三块相关能力：

- `targeted-skill-routing`：定义 trusted `targetSkill` 作为受治理的 skill routing constraint，不等于直接执行 Skill。
- `workflow-routing`：定义 `routingConstraints.targetRecipe` 作为显式 workflow 目标，命中当前 Agent Scope 的 `RECIPE` capability 后进入 workflow path。
- `agent-routing-core`：在 runtime 接受 request 后、context/model/capability 执行前做 Agent 内部 routing。

当前缺口是自然语言中显式指定执行目标的入口没有统一默认规则。UI 命令 `/skill`、`/workflow` 适合打开命令面板和补全；AGENTS.md、用户自然语言和自动化文本里更适合嵌入 `$skill:<name>`、`$workflow:<name>`。该 change 只把这类文本 directive 变成现有 routing constraints，不引入新的执行器或持久化 owner。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 在 router 默认路径支持 `$skill:<name>` 和 `$workflow:<name>`。
- 明确 `$skill:` 与 `$workflow:` 的类型隔离和冲突处理。
- 将 directive 解析结果映射到现有 governed routing constraints。
- 收窄 agent-web public submit 请求：web 请求体不得直接携带 `targetSkill` / `targetRecipe`，目标类 routing constraints 只能由 router 从用户问题文本解析生成。
- 继续通过 capability catalog、Agent Scope、Owner Scope、forbidden constraints、预算、deadline 和 cancellation 做执行前治理。
- 产生安全、低敏的 routing outcome evidence。

**非目标：**

- 不实现 UI slash command 解析；`/skill`、`/workflow` 属于 UI 命令边界。
- 不新增 workflow execution engine 行为。
- 不新增 skill execution path。
- 不新增 recipe store、workflow event store、terminal commit 或 stream event 规则。
- 不允许 directive 扩大 Agent Scope、Owner Scope、capability authority、model profile 或 prompt authority。

## 设计决策（Decisions）

1. 唯一实现路径：`agent-core` router 在 runtime accepted request text 上执行纯解析，得到 `CapabilityDirectiveParseResult`，再把结果归一化为现有 routing constraints。

   选择理由：directive 是 Agent 内部 routing 输入，不是 channel transport 行为，也不是 capability 执行行为。放在 `agent-core` 可以复用 frozen Agent facts、routing policy、capability governance 和 safe outcome evidence。

2. directive 语法只支持冒号形式：`$skill:<name>`、`$workflow:<name>`。

   选择理由：自然语言中需要可嵌入、可审计、可区分类型的显式引用。`$name` 会和 skill/workflow 名称冲突；`$skill name` 的边界不如冒号形式稳定；`/skill` 是 UI command，不应进入 accepted request text 语义。

3. directive parser 是无副作用组件。

   parser 只返回以下结果之一：
   - `none`
   - `skill(name)`
   - `workflow(name)`
   - `invalid(reasonCode)`
   - `ambiguous(reasonCode)`

   parser 不访问 capability catalog，不读 package，不执行 skill/workflow，不写 runtime state。

4. directive 名称使用现有 safe capability identifier 规则。

   名称不得包含空白、路径分隔符、shell 元字符、URL、credential、scope override、provider override、prompt 片段或 runtime 坐标。无效值只进入 safe reason code，不原样写入日志、trace、metric、audit 或用户可见错误。

5. 映射层只产出 typed routing target。

   - `$skill:<name>` -> target Skill routing input
   - `$workflow:<name>` -> `routingConstraints.targetRecipe`

   不新增混合字段，不让 `targetSkill` 承载 workflow，也不让 `targetRecipe` 承载 skill。

6. 冲突必须 fail closed 或进入 clarification。

   同一目标重复出现可以归一化；不同 skill、不同 workflow、skill + workflow 混用都视为 ambiguous。router 不按位置、模型推断、默认偏好静默选择。

7. agent-web channel 只传递文本和非目标类 typed constraints。

   `agent-channel-web` 不暴露 `routingConstraints.targetSkill` / `routingConstraints.targetRecipe` public request 字段。web 用户指定 skill/workflow 的唯一默认方式是把 `$skill:<name>` / `$workflow:<name>` 放入 `inputText`，由 `agent-core` router 在 accepted request text 上解析。agent-web 可继续传递 `forbiddenCapabilityIds`、`executionMode`、`locale`、`maxToolCalls`、`allowHumanInput`、`allowSubagents` 这类非目标约束。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | directive 不能携带 owner/agent/provider/prompt override；名称使用 safe identifier；agent-web public request 不接受 targetSkill/targetRecipe；执行前必须过 Agent Scope、Owner Scope、capability kind、visibility、authorization、forbidden constraints、budget、deadline、cancellation。无效 directive 不原样外泄。 | web schema negative tests、parser negative tests、routing governance tests、`npm run test:contract` |
| 性能/容量 | parser 是单次线性扫描 accepted request text，不访问 I/O 或 catalog；capability 校验复用现有 routing path。 | router unit tests，code review 确认无慢边界 |
| 可靠性/恢复 | parser 无副作用；ambiguous/invalid/unavailable 都产出确定性 safe outcome，不创建半执行状态。request terminal correctness 仍归 runtime/core 既有路径。 | invalid/ambiguous/unavailable integration tests |
| 可维护性 | 只新增一个 directive parser 和一个 normalization 点；skill 与 workflow 映射复用既有 specs，不创建平行 executor。 | `npm run lint:architecture`，code review |
| 可测试性 | parser 可独立单测；routing mapping 可通过 deterministic fake capability catalog 做集成测试；negative case 覆盖冲突、类型错配、scope 隔离。 | `npm test`、`npm run test:contract` |
| 审计/可追溯性 | routing outcome evidence 只记录 directive source、target type、安全 target name、safe reason code；不记录原始危险 payload、policy internals 或私有 catalog facts。 | observability/routing evidence tests 或 code review 检查点 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `$skill:` / `$workflow:` 解析只接受安全名称 | 1.1, 3.1 | parser unit tests |
| `/skill` / `/workflow` 不作为自然语言 directive | 1.1 | parser unit tests |
| `$skill:` 只映射 target Skill，不设置 `targetRecipe` | 1.2, 2.1 | router mapping tests |
| `$workflow:` 只映射 `routingConstraints.targetRecipe`，不设置 target Skill | 1.2, 2.2 | router mapping tests |
| 冲突 directive fail closed 或 clarification | 1.3, 3.2 | router negative tests |
| scope、kind、forbidden、availability、budget、cancellation 仍由 governance 执行 | 2.1, 2.2, 3.3 | routing integration tests |
| channel 不拥有 directive 语义 | 2.3, 4.1 | architecture lint / code review |
| agent-web request 不携带 targetSkill/targetRecipe | 2.4, 3.1 | agent-channel-web schema tests |
| safe evidence 不泄漏危险 directive payload | 3.4 | observability/routing evidence tests |
| OpenSpec delta 可归档 | 5.1 | `openspec validate add-ts-directive-capability-routing --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：
  - `openspec/specs/directive-capability-routing/spec.md` 主承载 directive 语法、解析、冲突、scope 隔离和 safe outcome。
  - `openspec/specs/targeted-skill-routing/spec.md` 主承载 directive-derived target Skill 如何进入既有 skill routing。
  - `openspec/specs/workflow-routing/spec.md` 主承载 directive-derived `targetRecipe` 如何进入既有 workflow routing。
  - `openspec/specs/routing-constraint-validation/spec.md` 主承载 allow-list vocabulary 和 typed constraints validation。
- 架构和跨模块设计：
  - `openspec/designs/architecture/agent-routing.md` 主承载 accepted request text -> directive parse -> routing constraints -> capability governance 的跨模块流程。
- 模块设计：
  - `openspec/designs/modules/agent-core.md` 主承载 parser ownership、normalization ownership 和 routing policy 消费关系。
  - `openspec/designs/modules/agent-channel-web.md` 主承载 web submit DTO 的 public boundary：不接受 targetSkill/targetRecipe，只传递 inputText 和非目标类 constraints；不重复定义 parser 语义。
- ADR：无。当前取舍是局部 routing 设计，不需要独立长期 ADR。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 `directive-capability-routing` 导航。

## 风险与取舍（Risks / Trade-offs）

- [风险] 用户文本中普通 `$skill:` 字样被当作 directive。-> 只接受严格 safe identifier，并把显式 directive 定义为用户可审计语法；需要纯文本展示该字样时由上层 UI/文档转义规则处理，不在 router 中引入复杂自然语言例外。
- [风险] 同时指定 skill 和 workflow 的用户可能期待组合执行。-> 当前 change 选择 fail closed/clarification，因为组合执行属于 workflow 编排能力，不应由 router 临时拼接。
- [风险] `targetRecipe` 已在 workflow routing 中使用，但 routing constraint allow-list 基线尚未包含。-> 本 change 显式修改 `routing-constraint-validation`，把 `targetRecipe` 纳入 allow-list。
- [取舍] 不支持 `$name` shorthand。-> 避免 skill/workflow 命名冲突，保留旧 shorthand 只能作为外部兼容层，router 默认能力以类型前缀为准。

## 迁移计划（Migration Plan）

无数据库或持久化迁移。实施顺序：

1. 收窄 agent-web submit schema 和 route forwarding，拒绝 web request body 中的 targetSkill/targetRecipe。
2. 新增 parser 和 parser tests。
3. 在 `agent-core` router normalization 点接入 directive-derived targets。
4. 补充 contract/router/integration/architecture tests。
5. 发布时默认启用该 router 能力；无需配置开关。

回滚策略：移除 parser 接入点后，现有 request-carried `targetSkill` / `targetRecipe` 路径继续工作。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/directive-capability-routing/spec.md`：归档新增 capability 的全部仍成立行为。
- `openspec/specs/targeted-skill-routing/spec.md`：归档 `$skill:` 到 target Skill routing 的关系。
- `openspec/specs/workflow-routing/spec.md`：归档 `$workflow:` 到 `targetRecipe` 的关系。
- `openspec/specs/routing-constraint-validation/spec.md`：归档 `targetRecipe` allow-list 与 directive normalization 规则。
- `openspec/designs/architecture/agent-routing.md`：归档跨模块流程、scope/governance、safe evidence 和 channel 非职责。
- `openspec/designs/modules/agent-core.md`：归档 parser ownership 和 router normalization 设计。
- `openspec/designs/modules/agent-channel-web.md`：如文档存在，归档 UI slash command 与自然语言 directive 的边界，以及 web submit DTO 不接受 targetSkill/targetRecipe 的 public boundary。
- `openspec/designs/spec-to-design-map.md`：新增 spec 到 architecture/modules/verification 的导航。

## 待确认问题（Open Questions）

无。
