## Why

`directive-capability-routing` 已定义“有效用户问题”：从已接受输入移除全部已识别 directive token、裁剪首尾空白后的剩余文本。但当用户只输入纯 `$skill:<name>` 或 `$workflow:<name>` 指令而无任何附加文本时（例如 `$skill:bom-test-skill`），directive 剥离后有效用户问题为空字符串，该空串被直接持久化为 USER message content 并写入 `flowVariables.input_question`，导致前端用户消息气泡完全不渲染、用户无法确认输入是否被接受。两道既有非空校验（Composer raw 非空、Web request body `inputText` 非空）都发生在 directive 剥离之前，剥离之后没有任何非空校验。

同时，受治理 Skill 路由失败（skill 不存在、被禁用、加载失败等）在后端 run 执行阶段抛出 `AgentError`，但该 error 的 `code` 未作为 terminal failure reason 透传到 `REQUEST_FAILED` event payload，前端 `FailedNotice` 读不到 failure code 而落为 `UNKNOWN` 阶段与 generic 提示，且不携带用户手敲的 skill 名，用户无法理解失败原因。

本 change 补齐“纯指令无附加文本”场景的 spec 缺口，并建立 directive / skill 路由失败的友好、可观测透传语义。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- directive 剥离后有效用户问题为空字符串时，系统 MUST 在持久化之前拒绝请求并返回安全校验错误，MUST NOT 持久化空 USER message content。
- 受治理 Skill 路由失败时，terminal `REQUEST_FAILED` 事件 MUST 携带 failure `code` 与 `category`，前端 MUST 把已知 skill 路由失败 code 映射为用户可理解的失败原因与修正建议。
- 前端在请求被拒绝或 skill 加载失败时 MUST 在对话流保留 directive 派生的占位痕迹（占位气泡），使用户输入不会“消失”。
- 前端 Composer 在提交前对纯指令（剥离后为空）和明显不存在的 skill 名做预检，避免无意义请求发出。

**非目标：**

- 不改变 directive 解析 grammar、`$skill:` / `$workflow:` token 识别规则或 invalid / ambiguous fail-closed 语义。
- 不改变 agent-web 禁止直接提交 `routingConstraints.targetSkill` / `targetRecipe` 的边界。
- 不放宽 Agent Scope、Owner Scope、Capability governance、预算、取消或 forbidden constraint。
- 不改变 slash command 或模型生成的 Skill tool call 语义。
- 不在主对话流 `FailedNotice` 展示 failure error code（保留在降级通知 / 运行图 / 工具调用详情等既有可展开排障面）。
- 不自动改写本 change 生效前已持久化的空 content 历史消息。

## What Changes

- **BREAKING**：纯 `$skill:<name>` / `$workflow:<name>` 指令（剥离后有效问题为空）不再被接受并持久化空 content；系统返回安全校验错误 `CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY`（category `VALIDATION`、fail-closed、不可重试）。
- `normalizeCapabilityDirectiveInput` 在 directive 剥离后增加非空校验；新建 submit 与 edit 两条 `projectAcceptedInput` 路径均在持久化之前命中。
- 受治理 Skill 路由失败抛出的 `AgentError` 的 `code` / `category` 通过 `commitExecutionTerminal` 的 `failureReason` 透传到 `REQUEST_FAILED` event payload；`safeFailureReasonFields` 已有的 code/category 字段进入 inlinePayload。
- `targeted-skill-router` 在 skill 路由失败 `AgentError.safeDetails` 补 `targetSkill` 字段（用户手敲的 skill 名，非机密）。
- 前端 `failureDetails` 增加 skill 路由失败 code 映射（`ROUTING_PREFERRED_SKILL_*` / `CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY`）→ `skillUnavailable` / `skillForbidden` / `directiveEmpty`，`FailureReasonPresentation` 增加 `skillName`，从 event payload 或 user message 的 directive-derived targetSkill 回填。
- 前端乐观 envelope 剥离 directive 后写入 content 并注入 `metadata.targetSkill`；`SyntheticUserMessage` 增加 `targetSkill`；`TurnBlock` 在空 content 且有 directive 派生 targetSkill 时渲染占位气泡，live overlay 重建时继承 targetSkill。
- 前端 Composer 提交前预检：剥离后为空 → inline 提示并阻止提交；手敲 `$skill:<name>` 不在已加载 skill 列表 → inline 提示并阻止提交。
- 前端 `FailedNotice`（主对话流）不再渲染 error code 行；降级通知保留既有 error code 展示行为。

## Feature 影响（Features）

### 新增 Feature

无。

### 修改的 Feature

- `F-2.6 指定技能处理`：Skill 路由失败时向用户返回可理解的失败原因与 skill 名，并在 UI 保留 directive 占位痕迹。
- `F-9.1 执行工作流`：纯 workflow directive 无附加文本时按同一空有效问题规则拒绝（对称 skill 行为）。

### 移除的 Feature

无。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-2.8 指令定向请求处理` → `specs/directive-capability-routing/spec.md`
  - 功能边界：directive 剥离后有效用户问题为空时 MUST 拒绝请求，MUST NOT 持久化空 content。
  - 系统质量属性：可测试性。
- `FN-2.6 指定技能处理` → `specs/targeted-skill-routing/spec.md`
  - 功能边界：Skill 路由失败原因与 skill 名 MUST 透传到可观测事件与用户可见失败提示。
  - 系统质量属性：可观测性、可测试性。
  - 映射说明：本 change 不修改 `targeted-skill-routing` spec Requirement，只补充失败透传实现事实。

## 影响范围（Impact）

- 用户提交纯 directive 指令（无附加文本）将被前端预检拦截或后端安全拒绝，不再产生空 USER message 与不可见对话气泡。
- 用户手敲不存在的 skill 名时，前端预检即时提示；若 skill 存在但加载失败，后端返回带 skill 名的友好失败提示，对话流保留占位气泡。
- 前端 `FailedNotice`、`failureDetails`、`buildTurnBlocks`、`TurnBlock`、`requestStore`、`MessageInput`、i18n 资源与相关测试受到影响。
- `lint:openspec` 在本 change 合入后转绿。
