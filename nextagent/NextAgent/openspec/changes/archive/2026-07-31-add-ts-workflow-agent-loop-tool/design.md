## 背景和现状（Context）

NextAgent 的 capability 体系已有 12 个 builtin tools（Read、Write、Bash、Python、Skill、Agent 等），通过 `BuiltinToolCatalog` → `CapabilityCatalog` → `ContextEngine.resolveCapabilities()` 暴露给模型。模型在 tool loop 中生成的 toolCalls 经 `executeToolCallsInOrder` → `GovernedCapabilityInvocationPort` → `BuiltinToolsExecutor` → `catalog.resolveExecutable()` 路由到具体 tool 实例执行。

Workflow 执行体系已有完整的 engine、node catalog、recipe capability 和 composition wiring，但只能在 routing-level 通过 `targetRecipe` 分发进入。model loop 内部无法调用 workflow。

最接近的参照物是 `Agent` tool：它也是一个 TOOL-kind capability，接收一个 port 依赖（`subagentExecution`），委托外部执行器，返回 `CapabilityInvocationResult`。Workflow tool 复用同一模式。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 在 model-driven loop 中新增 `Workflow` builtin tool，模型可通过 tool-call 执行预置 workflow recipe
- 复用已有 `WorkflowExecutionService`（local 和 remote），不新建执行引擎
- 结果安全映射为 `CapabilityInvocationResult`，回灌 agent loop 继续推理
- workflow 执行中的 visible delta 投影到当前 run timeline

**非目标：**
- 不修改 routing-level workflow 路径
- 不新增 recipe 存储、durable table、snapshot/recovery
- 不修改 `WorkflowExecutionService` public contract
- 不实现 workflow SKILL node handler
- 不支持 model-planned workflow
- 首版不支持 workflow resume（WAITING 后不恢复同一执行）

## 设计决策（Decisions）

### D1: Workflow tool 作为标准 builtin TOOL 注册

Workflow tool 定义在 `agent-capability/src/builtins/workflow/` 下，注册到 `builtinToolDefinitions`。它和 Agent tool 一样声明 `returnsCapabilityResult: true`，`replayPolicy: "NON_IDEMPOTENT"`，`requiredDependencies: ["workflowExecution"]`。

理由：复用已有 tool catalog → capability catalog → context engine → model request → tool loop 全链路，不需要在 `agent-core` 或 `tool-loop.ts` 中加任何特殊分支。模型通过标准 `tools` 数组看到该 tool，通过标准 `toolCalls` 路径调用。

### D2: 新增 WorkflowExecutionToolPort 而非直接注入 WorkflowExecutionService

Tool 执行上下文是 `ToolExecutionContext`，workflow 执行请求是 `WorkflowExecutionRequest`，两者 shape 不同。直接把 `WorkflowExecutionService` 注入 tool 会导致 tool 内部做 context → request 适配，这属于 composition 职责。

`WorkflowExecutionToolPort` 只暴露 tool 需要的最小契约：

```typescript
interface WorkflowExecutionToolPort {
  execute(input: {
    recipeName: string;
    inputText?: string;
    inputVariables: JsonObject;
    context: ToolExecutionContext;
    signal: AbortSignal;
  }): Promise<CapabilityInvocationResult>;
}
```

Port 实现在 `agent-app` composition 中，负责：
1. 把 `ToolExecutionContext` 适配为 `WorkflowExecutionRequest`
2. 调用 `WorkflowExecutionService.execute()`
3. 把 `WorkflowExecutionResult` 映射为 `CapabilityInvocationResult`
4. 通过 observer callback 把 workflow event 投影到 run timeline

### D3: recipe 校验由 port 适配器隐式完成

Tool 不自行读取 recipe 文件。`ToolExecutionContext` 不暴露 recipe definition source；Recipe 是静态资源，加载后以 `WORKFLOW` capability 表示运行时可执行语义，当前 Agent Scope 可用性由该 descriptor 决定。Port 适配器调用 app-provided recipe definition source 解析 `recipeVersion`；如果 recipe 不存在，适配器 catch 后映射为 `FAILED` + `VALIDATION`。

这与 routing-level 路径中 `DefaultAgent.executeRecipeRoute` 的 definition source 解析方式一致，保证两条路径的 recipe definition 解析逻辑统一。

### D4: WAITING status 映射为 DEGRADED + pendingInput 摘要

Workflow 执行可能遇到 `USER_CHECK`/`INTERRUPT` 节点，返回 `status: "WAITING"` + `pendingInput`。在 routing-level 路径中，`DefaultAgent.executeRecipeRoute` 直接返回 `{ status: "PENDING_INPUT" }` 挂起请求。但 tool-call 上下文中 `executeToolCallsInOrder` 只接受 `CapabilityInvocationResult`。

决策：WAITING 映射为 `DEGRADED`，`structuredPayload` 携带 pendingInput 摘要（kind、questions 的 prompt 和 options label），`safeError.code` 为 `WORKFLOW_PENDING_INPUT`，`safeError.category` 为 `UNAVAILABLE`。模型读取 structuredPayload 后用 `AskUserQuestion` tool 中继提问。

注意：`SafeError` 没有 `reasonCode` 字段，使用 `code` 字段携带 `WORKFLOW_PENDING_INPUT` 标识。

首版不支持 resume：模型获得用户答案后无法恢复同一 workflow 执行，需重新调用 Workflow tool。后续可扩展 `inputVariables._resumeState` 透传到 `WorkflowExecutionRequest.resumeState`。

不选择直接返回 `PENDING_INPUT` 的原因：tool-loop 的 `executeToolCallsInOrder` 返回类型是 `PendingInputRequest | undefined`，但 workflow pending input 的 shape 与 `PendingInputRequest` 不同（workflow 有 `resumeState`），强适配会破坏 tool-loop 的通用性。

### D5: 不创建子 session

与 Agent tool 不同（Agent tool 通过 `subagentExecution` 创建子 session 隔离执行），Workflow tool 在当前 session/run 内执行。`WorkflowExecutionRequest` 中的 `sessionId`、`runId` 直接来自 `ToolExecutionContext`。

理由：workflow 是确定性流程执行，不是独立对话。它的 timeline event 应该出现在当前 run 的 timeline 中，结果直接回灌 agent loop 上下文。

### D6: visible delta 通过 observer 投影

Port 实现在调用 `WorkflowExecutionService.execute()` 时传入 observer callback。callback 收到 `WorkflowExecutionEvent` 后，通过 `ToolExecutionContext.emitResultDelta` 或直接通过 `runState.emitEvent` 投影到当前 run timeline。

`WorkflowVisibleDelta` 的 content 直接作为 `LLM_CONTENT_DELTA` event 的 inlinePayload 投影。node 级别 diagnostic 投影为安全的 observability event，不包含 raw payload。

### D7: local/remote 模式由 app composition 决定

Tool 不感知执行模式。Port 实现在 composition 中根据 `workflowExecutionMode` 配置选择使用 `createWorkflowExecutionService`（local）或 `createRemoteWorkflowExecutionService`（remote）产出的 service 实例。这复用了 `create-app.ts` 已有的 `workflowExecutionService` 构建逻辑。

### D8: tool-loop 失败终止行为沿用通用逻辑

`tool-loop.ts:1939` 的 `shouldTerminateCapabilityFailure` 对 `Agent` tool 做了豁免（`return false`），允许模型在 Agent 失败后继续尝试其他方案。Workflow tool 不加入此豁免，沿用通用逻辑：`CANCELED` 和 `INTERNAL` category 终止 loop，其他 category 允许模型继续。

理由：Workflow tool 的 `CANCELED` 通常意味着用户主动 abort，终止 loop 是正确行为。`INTERNAL` 意味着系统级错误，继续重试无意义。`VALIDATION`（recipe 不存在等）不终止 loop，模型可尝试其他方案。这与 `agent-core` 无改动的约束一致。

### D9: subsystem.ts 依赖透传

`agent-capability/src/subsystem.ts:104-119` 使用 spread 模式 `...(options.toolDependencies ?? {})` 组装 `ToolDependencies`，`workflowExecution` 依赖会自动透传到 `BuiltinToolCatalog`。无需修改 `subsystem.ts`，只需 `create-app.ts` 在 `toolDependencies` 中注入 port 实例。

### D10: WorkflowExecutionStatus 枚举映射

`WorkflowExecutionStatus`（`agent-contracts/core/index.ts:202`）实际值为 `"COMPLETED" | "FAILED" | "INTERRUPTED" | "WAITING"`。映射规则：

- `COMPLETED` → `SUCCEEDED`，`structuredPayload` 包含 `recipeName`、`status: "succeeded"`、`outputVariables`
- `FAILED` → `FAILED`，`safeError` 从 `nodeResults` 中提取最后一个失败节点的 `safeError`
- `INTERRUPTED` → `FAILED`，`safeError` category `CANCELED`，`retryable: false`
- `WAITING` → `DEGRADED`，`structuredPayload` 携带 pendingInput 摘要，`safeError.code` 为 `WORKFLOW_PENDING_INPUT`

不存在 `SUCCEEDED` 和 `TIMED_OUT` 作为 `WorkflowExecutionStatus` 的值。timeout 在 workflow engine 层面表现为 `INTERRUPTED`。

### D11: recipeVersion 解析

`WorkflowExecutionRequest.recipeVersion` 是必填字段。Port 适配器通过 app-provided recipe definition source 获取 `RecipeDefinition`，从中提取 `recipeVersion`。recipe 是否可进入当前 Agent Scope 的可用性判断由 capability catalog 的 `RECIPE` descriptor 承担，definition source 只负责执行期 DSL 解析。

## 跨 Change 边界矩阵（Cross-Change Boundary Matrix）

- `add-ts-workflow-package-composition`：负责 package、startup wiring、recipe load、`WORKFLOW` capability publication 和 definition source。本 change 复用其产出的 `WorkflowExecutionService` 实例和 definition source，不新增 recipe 装载或 registry。
- `add-ts-workflow-routing`：负责 `targetRecipe` dispatch 和 routing-level workflow 路径。本 change 不修改该路径，两条路径并存：routing-level 在请求入口决定走 workflow；tool-level 在 model loop 中按需调用 workflow。
- `add-ts-workflow-execution-engine`：负责 ready 队列、retry、timeout、cancel、observer。本 change 的 port 实现调用同一 engine 实例，不新建 scheduler。
- `add-ts-workflow-capability-nodes`：负责 workflow 内部的 tool/restful/python/agent node handler。本 change 不涉及 node 级别改动。
- `add-ts-skill-tool`（已归档）：负责 inline skill 执行。本 change 中 skill 的角色是"指引模型调用 Workflow tool"，skill body 中包含 recipeName 指引，但 skill 执行本身不变。
- `add-ts-workflow-orchestration-policy`：负责双模式（workflow vs model loop）的 routing policy 和 model-planned workflow。本 change 是 orchestration-policy 愿景的一个子集实现（tool-level workflow 入口），但不引入 policy SPI 或 model-planned 能力。

## 触发机制（Trigger）

- 模型在 tool loop 中生成 `toolCalls` 包含 `toolName: "Workflow"` 时触发
- 由 `executeToolCallsInOrder` → `prepareToolCall` → `capabilityCatalog.resolve` 找到 descriptor
- 经 `GovernedCapabilityInvocationPort` → `BuiltinToolsExecutor` → `catalog.resolveExecutable("Workflow")` 拿到 tool 实例
- 调用 `tool.execute({ recipeName, inputText, inputVariables }, options)`

## 输入与前置条件（Inputs / Preconditions）

- `recipeName`：非空字符串，命中当前 Agent Scope 的 `WORKFLOW` capability
- `inputText`：可选，用户原始问题
- `inputVariables`：可选 JSON object
- `WorkflowExecutionToolPort` 依赖已注入
- 当前 Agent Scope / Owner Scope 可信
- `AbortSignal` 可用

## 输出与副作用（Outputs / Side Effects）

- `CapabilityInvocationResult`：包含 workflow 结果摘要
- timeline event：workflow visible delta 投影到当前 run
- workflow 可能有真实外部 side effect（API 调用、脚本执行），通过 executionId 可追溯
- 不创建子 session 或子 run

## 核心决策逻辑（Core Decision Logic）

1. 校验 `inputVariables` 是合法 JSON object（tool 内部完成）
2. 调用 `WorkflowExecutionToolPort.execute()`
3. Port 适配器内部：
   a. 从 `ToolExecutionContext` 读取 `agentId`、`sessionId`、`runId`、`identityContext` 等 scope 字段
   b. 调用 app-provided recipe definition source 获取 `RecipeDefinition`（含 `recipeVersion`）
   c. 组装 `WorkflowExecutionRequest`（`recipeName` + `recipeVersion` + scope 字段 + `inputText` + `inputVariables`）
   d. 创建 observer callback，将 `WorkflowExecutionEvent.visibleDelta` 投影到 timeline
   e. 调用 `WorkflowExecutionService.execute(request, signal, observer)`
   f. 将 `WorkflowExecutionResult` 映射为 `CapabilityInvocationResult`（按 D10 映射规则）
4. 返回 `CapabilityInvocationResult` 给 tool loop
5. tool loop 将结果作为 capability result message 追加到对话
6. 模型在下一轮推理中看到 workflow 结果，继续判断下一步

## 状态 / 产物契约（State / Artifact Contract）

- `structuredPayload`：
  - `recipeName`：string
  - `status`：`"succeeded"` | `"failed"` | `"waiting"`
  - `outputVariables`：JsonObject（安全过滤后）
  - `pendingInput`（仅 WAITING 时）：{ kind, questions: [{ prompt, options: [{ label }] }] }
- `metadata`：
  - `executionId`：string
  - `nodeResultCount`：number
  - `durationMs`：number
- `safeError`（失败或降级时）：
  - `code`：string（WAITING 时为 `WORKFLOW_PENDING_INPUT`）
  - `message`：string（安全消息）
  - `category`：`VALIDATION` | `UNAVAILABLE` | `TIMEOUT` | `CANCELED` | `INTERNAL`
  - `retryable`：boolean

## 流程接入（Flow Integration）

完整执行流程：

```
用户输入问题（未指定 recipe）
  → routing policy 决定走 MODEL_DRIVEN_LOOP
  → DefaultAgent.executeRun 进入 tool loop
  → 模型生成 toolCall: Skill({ name: "knowledge-qa" })
  → Skill tool 加载 inline skill body，body 中指示"对于知识问答任务，调用 Workflow tool，recipeName: knowledge-qa-recipe"
  → 模型在下一轮生成 toolCall: Workflow({ recipeName: "knowledge-qa-recipe", inputText: "用户问题", inputVariables: {...} })
  → Workflow tool 校验 inputVariables 格式
  → Workflow tool 调用 WorkflowExecutionToolPort.execute()
  → Port 适配器：
      a. 读取 ToolExecutionContext 的 scope 字段
      b. app-provided recipe definition source 获取 RecipeDefinition + recipeVersion
      c. 组装 WorkflowExecutionRequest
      d. 创建 observer callback
      e. 调用 WorkflowExecutionService.execute(request, signal, observer)
      f. 映射 WorkflowExecutionResult → CapabilityInvocationResult
  → Visible delta 通过 observer 投影到 timeline
  → 结果返回 CapabilityInvocationResult
  → Tool loop 将结果追加到对话
  → 模型在下一轮看到 workflow 结果，生成最终回答或继续调用其他 tool
```

## 失败与降级（Failure / Degradation）

- recipe 不存在 → port 适配器 catch `RECIPE_NOT_FOUND` → `FAILED`，`VALIDATION`，不调用 engine
- `inputVariables` 非法 → `FAILED`，`VALIDATION`（tool 内部校验）
- port 依赖未注入 → tool 标记为 `UNAVAILABLE`，模型不会选到
- workflow 执行被 abort → engine 返回 `INTERRUPTED` → `FAILED`，`CANCELED`
- workflow 节点执行失败 → engine 返回 `FAILED` → `FAILED`，safeError 从最后失败节点映射
- workflow 等待用户输入 → engine 返回 `WAITING` → `DEGRADED`，`WORKFLOW_PENDING_INPUT`，模型中继
- port 适配异常 → `FAILED`，`INTERNAL`

## 安全边界（Security Boundary）

- `recipeName` 只接受已注册 recipe，拒绝任意值
- `inputVariables` 经 JSON serializable 校验和 secret keyword pattern 过滤
- `outputVariables` 经安全过滤后放入 structuredPayload
- timeline event 不包含 raw model output、raw capability payload 或 secret
- workflow 在同一 Agent Scope / Owner Scope 内执行，不逃逸到其他 tenant/subject/agent
- `agentId` 只来自 `ToolExecutionContext`，不接受模型输出覆盖
## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | `recipeName` 只接受已注册值，拒绝任意字符串；`inputVariables`/`outputVariables` 经 JSON serializable 校验和 secret keyword pattern 过滤；timeline event 不含 raw model output 或 raw capability payload；scope 不逃逸到其他 tenant/subject/agent；`agentId` 只来自 `ToolExecutionContext` | contract test 5.7；architecture test 5.6 |
| 性能/容量 | workflow 在当前 run 内同步执行，受 `AbortSignal`/`timeoutMs` 约束；不新建 session/executor/resource pool；无额外调度开销，复用已有 `WorkflowExecutionService` 实例 | integration test 5.4 |
| 可靠性/恢复 | WAITING → DEGRADED 降级，模型中继；FAILED → 通用 `shouldTerminateCapabilityFailure`，不重试不 resume；INTERRUPTED → CANCELED 终止；不修改 terminal commit 语义 | unit test 5.2 覆盖所有 status 分支 |
| 可维护性 | 复用已有 tool catalog → capability catalog → context engine 全链路，无 `agent-core` 改动；双份 `ToolDependencyName` 定义通过 architecture test 确保同步 | architecture test 5.6；`npm run build` |
| 可测试性 | `WorkflowExecutionToolPort` 是最小契约，测试中可 mock port 而不依赖 `WorkflowExecutionService` 具体实现；tool execute 逻辑纯函数化（校验 → 委托 → 映射） | unit test 5.1–5.3 mock port |
| 审计/可追溯性 | `executionId` 放入 `metadata`；timeline event 投影 visible delta；`safeError` 不含 secret/path/raw error；workflow 可能有真实外部 side effect，通过 `executionId` 可追溯 | contract test 5.7 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| Workflow tool MUST 注册为 builtin TOOL-kind capability | 2.2, 2.3 | `npm run build`；integration test 5.4 |
| `WorkflowExecutionToolPort` MUST 作为最小适配契约，不暴露 `WorkflowExecutionService` 完整接口 | 1.3, 4.1 | `npm run build`；integration test 5.4 |
| `WorkflowExecutionResult` MUST 安全映射为 `CapabilityInvocationResult`（4 种 status 分支） | 3.1 | unit test 5.2 |
| recipe 不存在 MUST 返回 FAILED + VALIDATION | 3.1, 4.1 | unit test 5.1；integration test 5.4 |
| Workflow tool MUST 继承 Agent Scope / Owner Scope，不创建子 session | 4.1, 5.5 | integration test 5.5 |
| visible delta MUST 通过 observer 投影到 timeline | 4.1 | integration test 5.4 |
| Workflow tool MUST 响应 AbortSignal | 2.2, 5.3 | unit test 5.3 |
| `ToolDependencyName`/`ToolDependencies` 双份定义 MUST 同步新增 `workflowExecution` | 1.1, 1.2 | `npm run build`；architecture test 5.6 |
| `allowedDependencyNames` MUST 新增 `"workflowExecution"` | 1.4 | `npm run build`；architecture test 5.6 |
| 依赖未注入时 tool MUST 标记 UNAVAILABLE | 5.6 | architecture test 5.6 |
| `structuredPayload` MUST NOT 包含 secret/credential/raw error | 3.1, 5.7 | contract test 5.7 |
| WAITING MUST 映射为 DEGRADED + `WORKFLOW_PENDING_INPUT` | 3.1 | unit test 5.2 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/workflow-agent-loop-tool/spec.md` — Workflow tool 的可验证行为契约（availability、port、mapping、scope、timeline、abort、dependency）
- 架构和跨模块设计：`openspec/designs/architecture/workflow-contracts.md` — tool-level workflow 入口与 routing-level workflow 路径的并存关系、跨模块流程边界
- 模块设计：
  - `openspec/designs/modules/agent-capability.md` — Workflow builtin tool 的模块归属、tool 定义 owner、`WorkflowExecutionToolPort` 契约声明
  - `openspec/designs/modules/agent-app.md` — composition root 中 `WorkflowExecutionToolPort` 适配 wiring、local/remote 模式选择
- ADR：无 — 本 change 的设计决策（D1–D11）在归档时提炼到 architecture 和 modules 文档，不需要独立 ADR
- 导航：`openspec/designs/spec-to-design-map.md` — `workflow-agent-loop-tool` spec 到 architecture/modules 的导航映射

## 风险与取舍（Risks / Trade-offs）

- [首版不支持 workflow resume，WAITING 后用户答案不回灌同一 workflow 执行] → 模型需重新调用 Workflow tool，后续可扩展 `inputVariables._resumeState` 透传到 `WorkflowExecutionRequest.resumeState`
- [双份 `ToolDependencyName` 定义需手动同步] → 通过 architecture test 断言两处定义一致，防止漂移
- [outputVariables 安全过滤可能误杀业务字段] → 使用 secret keyword pattern 过滤而非全量 mask，通过 contract test 覆盖正例和反例
- [WAITING → DEGRADED 而非 PENDING_INPUT，模型可能不理解 pendingInput 语义] → `safeError.code` 为 `WORKFLOW_PENDING_INPUT`，`structuredPayload` 携带 pendingInput 摘要，skill body 可指引模型用 AskUserQuestion 中继
- [workflow 执行在当前 run 内同步进行，长耗时 workflow 可能阻塞 tool loop] → 受 `timeoutMs` 和 `AbortSignal` 约束，超时映射为 INTERRUPTED → CANCELED

## 迁移计划（Migration Plan）

无。本 change 是纯新增能力，不修改已有 routing-level workflow 路径、`WorkflowExecutionService` public contract 或 `WorkflowExecutionRequest` shape。不涉及数据迁移、配置迁移或回滚风险。已有的 `targetRecipe` routing 路径和 model-driven loop 路径不受影响。

## 归档前更新基线（Baseline Promotion Plan）

归档前需更新的长期文档：

- `openspec/specs/workflow-agent-loop-tool/spec.md`：新增 — 承载 Workflow tool 的全部行为契约
- `openspec/overview.md`：补充 — tool-level workflow 入口作为 model loop 中调用 workflow 的能力补充
- `openspec/designs/architecture/workflow-contracts.md`：补充 — tool-level workflow 入口与 routing-level workflow 路径的并存架构、跨模块流程边界
- `openspec/designs/modules/agent-capability.md`：补充 — Workflow builtin tool 的模块归属、`WorkflowExecutionToolPort` 契约
- `openspec/designs/modules/agent-app.md`：补充 — composition wiring 中 `WorkflowExecutionToolPort` 适配和依赖注入
- `openspec/designs/spec-to-design-map.md`：补充 — `workflow-agent-loop-tool` spec 到 architecture/modules 的导航

归档时提炼的稳定设计事实：D1（标准 TOOL 注册）、D2（最小 Port 适配）、D3（recipe 隐式校验）、D10（status 映射规则）为长期有效决策；D4（WAITING → DEGRADED，首版不支持 resume）为当前版本约束，归档时需标注后续演进方向。

## 待确认问题（Open Questions）

无。所有设计决策已在 D1–D11 中收敛，关键约束均有对应 task 和验证入口。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.1-执行工作流` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/workflow-agent-loop-tool/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
