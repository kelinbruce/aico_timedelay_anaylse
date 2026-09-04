## 背景和现状（Context）

`AskUserQuestion` 的 runtime producer branch 已经具备确定性边界：只有 canonical built-in descriptor 会进入 pending input producer，schema、可见文本和 forbidden purpose 由 Agent/core 校验，answer/resume 由 runtime-owned pending input lifecycle 处理。当前缺口不是 runtime 能力，而是模型面对普通澄清问题时缺少足够明确的系统提示词触发规则。

内置 `default-agent` 是面向用户的默认电信网络运维 Agent，并绑定 `network-explorer` 作为 Agent capability。`network-explorer` 的定位是只读网络证据收集：读取拓扑、告警、KPI、日志、配置快照、资源和工单上下文，并返回 findings、confidence、limitations 和 missing-data gaps。它不是用户直接调用的 Agent。

现有 capability catalog 会默认启用 built-in Tool；因此如果 invoked Agent 没有显式禁用 `AskUserQuestion`，它可能在自身模型上下文中看到该工具。这样会让只读子 Agent 直接创建用户 pending input，模糊主 Agent 和子 Agent 的用户交互责任。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 让用户可见主 Agent 在任务被短普通用户输入阻塞时更稳定地调用 `AskUserQuestion`。
- 明确 `AskUserQuestion` 的使用条件和禁止用途，避免把授权、确认、人工接管、凭证或长表单误用为普通问题。
- 让 `network-explorer` 不直接创建用户 pending input，而是返回 missing-data gaps 给主 Agent。
- 保持 runtime producer routing 和 pending input lifecycle 不变。

**非目标：**
- 不新增自然语言分类器、自动 pending input router、policy engine 或 model moderation call。
- 不让 runtime 根据普通 assistant 文本推断是否创建 pending input。
- 不强制所有澄清问题都走 `AskUserQuestion`；方案讨论、普通对话和可安全假设的场景仍可用普通文本。
- 不新增 Web/API contract，不改变 answer/resume、timeout、cancel、checkpoint 或 terminal commit 语义。

## 设计决策（Decisions）

选定方案：在系统提示词中加入一段窄范围的 `AskUserQuestion` 触发规则，并在 `network-explorer` 的 Agent capability bindings 中显式禁用 `AskUserQuestion`。

提示词规则归 `agent-context-engine` 的 builtin system prompt template 承载。规则只影响模型选择工具的倾向，不改变运行时语义：
- 任务无法安全继续；
- 缺失信息由用户掌握；
- 不能从上下文推断；
- 不能通过工具获得；
- 问题短且可直接回答。

满足这些条件时，提示词要求模型调用 `AskUserQuestion`，而不是只用普通文本追问。若有效选项已知，提示词要求优先使用 options；开放文本只用于普通开放输入。提示词同时说明不得向用户暴露内部工具名。

负向边界仍保持两层：
- prompt guidance：模型不应把 credentials、secrets、authorization grants、protected-operation approval、high-risk confirmation、human handoff、surveys 或 long-form forms 交给 `AskUserQuestion`；
- Agent/core validation：现有 `AskUserQuestion` deterministic validation 继续拒绝 hard forbidden purpose。

`network-explorer` 使用配置级禁用，而不是 runtime special case。原因是这是 Agent 能力可见性问题，属于 Agent assembly/capability binding 边界；runtime 不应知道某个 Agent 名称的业务语义。

放弃方案：
- 自动把普通文本问题改写为 pending input：会让 runtime 做自然语言语义路由，边界不清晰。
- 强制 `tool_choice=AskUserQuestion`：会影响非阻塞讨论、普通解释和可推断场景，误触发率高。
- 给 `network-explorer` 写 runtime 特判：把 Agent 角色知识泄漏进 runtime，违反配置/编排边界。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | `AskUserQuestion` 不接收凭证、密钥、授权授予、受保护操作审批、高风险确认或人工接管；子 Agent 不直接问用户，避免用户交互权扩大。 | `openspec validate --all --strict`；prompt/配置测试；现有 forbidden-purpose tests |
| 性能/容量 | 只增加一小段系统提示词和一个 disabled binding，不新增运行时调用、存储、扫描或模型外分类。 | context/prompt contract tests；build |
| 可靠性/恢复 | pending input 生命周期、checkpoint-before-visible、answer/resume、timeout/cancel 不变，降低触发层面对 runtime 的影响。 | 现有 pending input contract/runtime tests；本 change 不新增 lifecycle 分支 |
| 可维护性 | 触发策略放在 prompt；Agent 可见性放在 Agent config；runtime 继续只做 descriptor validation 和 producer execution。 | architecture/config tests；code review 检查无 runtime special case |
| 可测试性 | 用确定性测试验证 prompt 文本存在、default-agent 可见 `AskUserQuestion`、network-explorer 不可见 `AskUserQuestion`。 | Vitest targeted tests；`npm run test:contract` |
| 审计/可追溯性 | 不新增事件或日志；已有 pending input 事件和 capability result 恢复路径保持原样。 | 无新增审计断言；现有 pending input tests 覆盖 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| user-facing Agent 被普通用户输入阻塞时提示调用 `AskUserQuestion` | 1.1 | prompt/context assembly test；`npm run test:contract` |
| prompt 不要求用户知道内部工具名，且包含负向边界 | 1.1 | prompt/context assembly test |
| `network-explorer` 不暴露 `AskUserQuestion` | 2.1 | invoked Agent discovery/config test |
| `default-agent` 保持 `AskUserQuestion` 可见 | 2.2 | config assembly test |
| 不修改 runtime producer routing、不新增 special case | 3.1 | architecture/code review check；existing tool-loop tests |
| OpenSpec 行为和实现一致 | 4.1 | `openspec validate --all --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ask-user-question-trigger-policy/spec.md` 主承载触发条件和 invoked Agent 可见性边界。
- 架构和跨模块设计：`openspec/designs/architecture/agent-capability-boundary.md` 主承载用户交互能力只由面向用户 Agent 直接暴露的边界。
- 模块设计：`openspec/designs/modules/agent-context-engine.md` 主承载提示词触发指导；`openspec/designs/modules/agent-core.md` 主承载 built-in Agent 配置和 capability binding 可见性。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md` 增加本 capability 到相关设计入口的导航。

## 风险与取舍（Risks / Trade-offs）

- [风险] prompt guidance 不能百分百保证模型一定调用工具。-> 本 change 只做最小触发策略优化；需要强一致行为时应由后续 change 讨论更重的策略层，而不是在 runtime 偷偷推断自然语言。
- [风险] `network-explorer` 不能直接问用户后，可能多一次主 Agent 往返。-> 这是清晰边界的取舍；子 Agent 返回 missing-data gaps，主 Agent 统一决定是否问用户。
- [风险] 提示词变长可能轻微增加 token。-> 文本很短，只影响系统提示词，不引入动态上下文膨胀。

## 迁移计划（Migration Plan）

无数据迁移、协议迁移或持久化迁移。发布后新会话会使用更新后的系统提示词和 Agent capability binding；已有持久化 run 和 pending input 不受影响。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ask-user-question-trigger-policy/spec.md`：提炼触发条件、禁止用途和 `network-explorer` 不直接创建用户问题的行为契约。
- `openspec/designs/architecture/agent-capability-boundary.md`：提炼 user-facing Agent 与 invoked read-only Agent 的用户交互能力边界。
- `openspec/designs/modules/agent-context-engine.md`：提炼 prompt 承载触发指导、runtime 不做语义路由的设计。
- `openspec/designs/modules/agent-core.md`：提炼 built-in Agent config 使用 disabled binding 收敛能力可见性的设计。
- `openspec/designs/spec-to-design-map.md`：增加本 capability 的导航。

## 待确认问题（Open Questions）

无。
