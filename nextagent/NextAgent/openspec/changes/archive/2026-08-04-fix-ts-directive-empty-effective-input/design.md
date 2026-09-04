## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-2.8 指令定向请求处理` | directive 剥离后有效用户问题为空时拒绝请求，不持久化空 content | `directive-capability-routing` | `FN-2.8 指令定向请求处理` |
| `FN-2.6 指定技能处理` | Skill 路由失败原因与 skill 名透传到可观测事件与用户可见失败提示 | 无 Requirement delta | `FN-2.6 指定技能处理` |

## `FN-2.8 指令定向请求处理`

### 目标与规范依据

本 Function 已在 `2026-07-31-fix-ts-directive-effective-input` 中建立“有效用户问题”语义：移除全部已识别 directive token、裁剪首尾空白后的剩余文本。本 change 补齐一个未覆盖场景：当移除后剩余文本为空字符串时系统的行为。

#### 本 Function 的目标 Requirements

canonical spec：`directive-capability-routing`

- `MODIFIED`：`Directive 生成有效用户问题`（新增“纯 directive 无附加文本时有效问题为空被拒绝” Scenario）

### 当前实现

- `agent-core` 的 `normalizeCapabilityDirectiveInput()` 成功路径执行 `inputText.replace(directivePattern, '').trim()`，把结果作为有效用户问题返回，不校验结果是否为空。
- `agent-runtime` 在 submit（`projectAcceptedInput`）与 edit 路径调用该 projector，把投影结果写入 `acceptedCommand.inputText`、`RequestContext.acceptedInputText`、`flowVariables.input_question` 与 USER message content。
- 两道非空校验（Composer raw inputText 非空、Web request body `inputText` 非空）都在 directive 剥离之前；剥离之后无任何非空校验。
- `directive-capability-routing` spec 的“Directive 生成有效用户问题”全部 scenario 都假设 directive 伴随附加文本，未定义“纯指令无附加文本 → 有效问题为空”的行为。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 有效用户问题为空时不持久化空 content | projector 返回空字符串并被原样持久化 | 剥离后需要非空校验并拒绝 |
| 空有效问题行为在 spec 中可观测 | spec 无纯指令无附加文本 scenario | 补充 MODIFIED scenario |
| 校验时机在持久化之前 | 校验只在剥离前 | projector 内校验天然位于剥离后、持久化前 |

### 修改方案

唯一实施路径如下：

1. `agent-core` 的 `normalizeCapabilityDirectiveInput()` 在 `replace(directivePattern, '').trim()` 之后增加非空校验：结果为空字符串时抛 `AgentError`（`code: 'CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY'`、`category: 'VALIDATION'`、`retryable: false`、`safeDetails.reasonCode` 同名）。reasonCode 命名沿用既有 `CAPABILITY_DIRECTIVE_*` 前缀（`INVALID` / `AMBIGUOUS`），category 与 retryable 对齐 invalid directive 的 fail-closed 语义。
2. 校验位于 `projectAcceptedInput` 内，天然在 directive 剥离之后、`persistUserMessage`（`content: command.inputText`）之前。新建 submit（`submit.ts` submit 路径）与 edit（`editedInputText` 路径，不传 routingConstraints，符合既有“Edit MUST NOT 继承被替换请求的 directive-derived routing target”语义）两条路径都会命中，空 content 不会落地。
3. `none` / `invalid` / `ambiguous` 分支行为不变：`none` 原样返回原文本与原约束；`invalid` / `ambiguous` 仍由 core routing 既有 fail-closed 路径处理，projector 不产生部分 target，不抛空有效问题错误（这两种分支根本不进入剥离逻辑）。
4. `agent-runtime` 测试 harness 中与 `normalizeCapabilityDirectiveInput` 等价的内联 projector 同步加同一校验，避免测试绕过产品校验。

前端预检作为体验层补充（不发请求即拦截纯指令），但不替代后端校验：后端 projector 是权威，前端预检只覆盖“剥离后为空”与“手敲 skill 名明显不在已加载列表”两种即时可判场景；skill 存在但加载失败等运行时失败仍由后端兜底。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可测试性 | `Directive 生成有效用户问题` | projector 单测覆盖纯指令 / 纯 workflow / 重复纯指令 / 空白填充纯指令均抛同一错误；带附加文本仍正常投影 | 不以私有调用顺序替代可观察的拒绝结果 |

## `FN-2.6 指定技能处理`

### 目标与规范依据

指定 Skill 的现有治理与执行边界不变；本设计只补齐 Skill 路由失败时失败原因与 skill 名向可观测事件和用户可见提示的透传。

#### 本 Function 的目标 Requirements

canonical spec：`targeted-skill-routing`

本 change 不新增或修改该 spec Requirement。

### 当前实现

- `TargetedSkillRouter.invokeIfConfigured()` 在 run 执行阶段（`default-agent.ts` 调用）解析 `targetSkill`，经 `assertPreferredSkillAllowed` 与 `resolveCapability` 后，失败时抛 `AgentError`（`ROUTING_PREFERRED_SKILL_UNAVAILABLE` / `_FORBIDDEN` / `_BUDGET_EXCEEDED` / `_DEADLINE_EXCEEDED`，或 `consumeResult` 透传 `result.safeError`）。
- `executeQueuedWork` catch 住该 AgentError 后调用 `commitExecutionTerminal`，但只传 error message 作为 terminal content，未传 `code` / `category` 作为 `failureReason`。
- `withTerminalFailureReason` 只从 `latestTerminalFailureReasons` map 取（该 map 只在 `DEGRADATION_NOTICE` 时填充），skill 路由 AgentError 不产生 DEGRADATION_NOTICE，因此 `failureReason` 为 undefined。
- `safeFailureReasonFields` 在 `failureReason` undefined 时返回 `{}`，`REQUEST_FAILED` event inlinePayload 只有 `content` / `terminalMessageId` / `trace`，丢失 `code` / `category`。
- 前端 `readFailureErrorCodeFromPayload` 读到 null → `FAILURE_REASON_BY_CODE` 映射不到 → `failureAction` 落 `UNKNOWN` stage + generic remediation。`FAILURE_REASON_BY_CODE` 表无 `ROUTING_PREFERRED_SKILL_*` 与 `CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY`。
- 前端 `FailedNotice` 主对话流渲染 error code 行；降级通知（`processDetails` 的 `buildTerminalFailureDegradationEntry` / `describeDegradationResult` / `describeDegradationDetail`）也渲染 error code。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| Skill 路由失败原因进入可观测事件 | `commitExecutionTerminal` 未传 failureReason，event payload 丢 code | catch 路径需从 AgentError 构造 failureReason 透传 |
| 用户可见失败提示携带 skill 名 | AgentError.safeDetails 不带 targetSkill；前端拿不到 skill 名 | 后端补 safeDetails.targetSkill；前端从 payload 或 user message 回填 |
| 已知 skill 路由失败 code 映射为可理解原因 | 前端映射表无 ROUTING_PREFERRED_SKILL_* / EFFECTIVE_QUESTION_EMPTY | 补充映射 + stage + remediation |
| 主对话流不暴露技术 error code | FailedNotice 渲染 error code 行 | 主 FailedNotice 移除 error code 渲染，保留失败原因 / 阶段 / 修正建议 |

### 修改方案

1. `agent-runtime` 的 `commitExecutionTerminal` 增加 `options: TerminalCommitOptions` 参数并透传给 `commitTerminal`；`executeQueuedWork` catch 路径在 `terminalStatus === 'FAILED'` 且 `terminalError instanceof AgentError` 时构造 `{ failureReason: { code: terminalError.code, category: terminalError.category } }` 传入。`TerminalFailureReason` 既有 shape（`{ code?, category? }`）不变，`safeFailureReasonFields` 既有逻辑把 code/category 写入 inlinePayload。
2. `agent-core` 的 `targeted-skill-router.ts` 在 UNAVAILABLE / FORBIDDEN / BUDGET / DEADLINE 与 `consumeResult` FAILED 抛错点的 `AgentError.safeDetails` 补 `targetSkill` 字段（值为用户手敲的 skill 名，非机密——skill 名本就是用户输入）。不改 `code` / `category` / `retryable`。`consumeResult` 透传 `result.safeError` 时合并 `targetSkill` 到 safeDetails，不覆盖原 safeError 的既有安全字段。
3. 前端 `failureDetails.ts` 的 `FAILURE_REASON_BY_CODE` 补充 `ROUTING_PREFERRED_SKILL_UNAVAILABLE` / `_FAILED` / `_TOOL_UNAVAILABLE` / `ROUTING_CONSTRAINT_DEPENDENCY_UNAVAILABLE` → `skillUnavailable`；`ROUTING_PREFERRED_SKILL_FORBIDDEN` → `skillForbidden`；`CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY` → `directiveEmpty`。`failureAction` 增加对应分支（stage `CAPABILITY_EXECUTION` 或 `CAPABILITY_INPUT`、retry false、remediation `skillRouting`）。`FailureReasonPresentation` 增加 `skillName?`。
4. 前端 skill 名回填：`readFailureReasonPresentation` 尝试从 event payload 的 `safeError.safeDetails.targetSkill` / `metadata.targetSkill` 读取（未来后端透传时自动生效）；`TurnBlock` 的 `failureReason` useMemo 在 presentation 无 skillName 时用 `readDirectiveTargetSkill(userMessage)` 回填（从 `SyntheticUserMessage.targetSkill` 或 `SessionConversationMessage.metadata.routingConstraints.targetSkill` / `metadata.targetSkill`）。`FailedNotice` 渲染 `t(translationKey, { skill: skillName ?? '' })`。
5. 前端 `FailedNotice`（主对话流）移除 error code 行；`presentation.errorCode` 字段保留在数据结构供降级通知 / 运行图 / 测试 / 未来展开抽屉使用。降级通知（`processDetails` 三个函数）保留既有 error code 展示行为不变。
6. 前端占位气泡与乐观 envelope：`requestStore` 乐观 envelope 用前端 `stripDirectives` 剥离 directive 后写入 content，并注入 `metadata.targetSkill`（UI 选择器 `selectedSkill.capabilityId` 或 raw 输入解析）；`SyntheticUserMessage` 增加 `targetSkill`；`buildSyntheticUserMessage` 从 `payload.metadata.targetSkill` / `routingConstraints.targetSkill` 读取；`overlayLiveTurnBlocks` 重建时通过 `mergeTargetSkill` 从前一个 userMessage 继承 targetSkill（后端 envelope 不带 targetSkill，避免覆盖后丢失）；`TurnBlock` 在 `hasUserContent=false` 且有 directive 派生 targetSkill 时渲染占位气泡。请求失败时不回滚乐观 envelope，保留占位痕迹。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可观测性 | `Directive Outcomes are Safe and Observable`（既有） | skill 路由失败 code/category 进入 REQUEST_FAILED payload；safeDetails.targetSkill 携带 skill 名 | event payload 含 code；前端按 code 分类提示 |
| 可测试性 | 无新增黑盒质量目标 | failureDetails 单测覆盖 skill 路由失败 code 映射与 skillName 透传 | 不以私有调用顺序替代可观察的失败提示 |

## 跨 Function 协作与端到端流程

`FN-2.8` 的 projector 校验在 request acceptance 阶段拒绝空有效问题，请求不进入 `FN-2.6` Skill 路由。当 directive 带附加文本、有效问题非空但 skill 在 `FN-2.6` 路由失败时，`commitExecutionTerminal` 把失败原因透传到 `REQUEST_FAILED`，前端 `FailedNotice` 按 code 映射为友好提示并保留占位气泡。两条路径互补：空有效问题在 acceptance 拒绝，skill 运行时失败在执行阶段透传。

## 验证策略（Verification Strategy）

- unit：`normalizeCapabilityDirectiveInput` 对纯 `$skill:` / `$workflow:` / 重复纯指令 / 空白填充纯指令均抛 `CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY`；带附加文本仍正常投影。
- unit：`failureDetails` 对 `ROUTING_PREFERRED_SKILL_*` / `CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY` 映射到正确 translationKey / stage / remediation / skillName。
- contract / characterization：submit / edit 纯指令输入被拒绝、不持久化空 content；`commitExecutionTerminal` 在 AgentError 失败时透传 failureReason。
- e2e：手敲不存在的 skill 名时前端预检拦截或后端返回友好失败提示，对话流保留占位气泡；FailedNotice 显示 skill 名与可理解原因，主对话流不显示 error code。
- architecture：directive parser 仍只位于 `agent-core`；前端 `stripDirectives` 是后端剥离语义的镜像，不替代后端校验。
- negative case：纯指令被拒绝后不进入 Skill / Workflow / 模型执行路径；invalid / ambiguous directive 仍 fail closed。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/directive-capability-routing/spec.md`：合并“纯 directive 无附加文本时有效问题为空被拒绝” Scenario 到既有“Directive 生成有效用户问题” Requirement。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.8-指令定向请求处理.md`：补充空有效问题拒绝语义。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.6-指定技能处理.md`：补充 Skill 路由失败原因透传语义。
- `openspec/designs/modules/agent-core.md`、`openspec/designs/modules/agent-runtime.md`：同步 projector 校验与 `commitExecutionTerminal` failureReason 透传。
- `openspec/designs/spec-to-design-map.md`：无导航变化。
- `openspec/overview.md`：无。
- ADR：无。

## 风险与取舍（Risks / Trade-offs）

- 纯指令输入从此被拒绝，可能影响既有的“仅触发 skill 而不提问”使用习惯。本 change 把空有效问题视为无效请求，符合“有效用户问题”语义；用户需附加问题文本或改用 UI 技能选择器。
- 后端 `safeFailureReasonFields` 当前只把 `code` / `category` 放入 event payload，不透传 `safeDetails` 全量；前端 skill 名主要从乐观 envelope / user message metadata 回填，不依赖后端 safeDetails 透传。未来若后端扩展透传 safeDetails，前端 `readTargetSkillFromPayload` 自动生效。
- 前端 skill 预校验依赖已加载 skill 列表（`slashSkills`）；列表为空（未加载）时跳过预校验、放行给后端兜底，避免误报。disabled / forbidden / SkillHub 动态 skill 可能不在前端列表，预校验只挡“明显不存在”，其余由后端 governance 兜底。
- 主对话流移除 error code 展示不影响降级通知 / 运行图 / 工具调用详情等既有排障面的 error code 展示。

## 待确认问题（Open Questions）

无。
