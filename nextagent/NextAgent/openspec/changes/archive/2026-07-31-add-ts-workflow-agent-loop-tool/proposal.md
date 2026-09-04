## 背景与问题（Why）

NextAgent 已有两条独立的执行路径：model-driven loop（DefaultAgent 的 tool loop）和 workflow 执行（routing-level `targetRecipe` 分发到 WorkflowExecutionService）。两者在请求入口由 routing policy 互斥选择，model loop 内部无法主动调用 workflow。

电信网络场景中大量存量 skill 封装了确定性的多步骤流程（告警定位、指标查询、配置核查、标准化恢复），这些流程已经或正在被封装为 workflow recipe。当前用户走 model loop 时，如果问题需要走一个预置 workflow，唯一的方式是在提交请求时携带 `routingConstraints.targetRecipe`，由 routing policy 直接进入 workflow 路径。但实际产品形态是：用户不指定 recipe，由 agent loop 中的 skill 识别意图后决定调用哪个 recipe。skill 本身是 inline 指令注入，它能告诉模型"应该调用哪个 workflow"，但模型在 tool loop 中没有可用的工具去执行 workflow。

本 change 解决一个问题：在 model-driven loop 中新增一个 `Workflow` builtin tool，让模型在 skill 指引下能够以 tool-call 方式执行预置 workflow recipe，结果回灌 agent loop 上下文继续推理。

## 变更范围（What Changes）

- **新增** `Workflow` builtin tool 定义，注册到 `builtinToolDefinitions`
  - 输入：`recipeName`（必填）、`inputText`（可选，用户原始问题）、`inputVariables`（可选，结构化上下文参数）
  - 输出：`CapabilityInvocationResult`，包含 workflow 执行结果摘要
- **新增** `ToolDependencyName` 联合类型中增加 `"workflowExecution"`（`agent-capability/tool-spi.ts` 和 `agent-contracts/capability` 双份定义同步）
- **新增** `WorkflowExecutionToolPort` interface，作为 tool 层对 workflow 执行能力的适配契约
  - 接收 `recipeName`、`inputText`、`inputVariables`、`ToolExecutionContext`、`AbortSignal`
  - 返回 `CapabilityInvocationResult`
  - 不直接暴露 `WorkflowExecutionService`，由 composition root 负责适配
- **新增** `agent-app` composition wiring：将已有 `WorkflowExecutionService` 包装为 `WorkflowExecutionToolPort` 并注入 tool dependencies
  - local mode 直接调用 `createWorkflowExecutionService` 产出的 service 实例
  - remote mode 调用 `createRemoteWorkflowExecutionService` 产出的 service 实例
  - 模式选择复用已有 `workflowExecutionMode` / `workflowExecutionServiceFactory` 配置
- **新增** workflow 结果到 `CapabilityInvocationResult` 的安全映射
  - `COMPLETED` → `SUCCEEDED`，outputVariables 放入 structuredPayload
  - `FAILED` → `FAILED`，safeError 映射
  - `INTERRUPTED` → `FAILED`，safeError category `CANCELED`
  - `WAITING`（pending input）→ `DEGRADED` + structuredPayload 携带 pendingInput 摘要，模型用 `AskUserQuestion` 中继
- **新增** workflow 执行中的 timeline event 通过 observer 投影到当前 run timeline
- **明确** recipe 可用性校验：`recipeName` 必须命中当前 Agent Scope 的 `WORKFLOW` capability，port 适配器通过 app-provided recipe definition source 解析 `recipeVersion`

## 不在范围内（Explicit Non-Goals）

- 不修改 routing-level workflow 路径（`targetRecipe` 分发），两条路径并存
- 不新增 recipe 持久化存储、workflow event durable table 或 snapshot/recovery
- 不修改 `WorkflowExecutionService` 或 `WorkflowExecutionRequest` 的 public contract
- 不实现 workflow 节点级别的 SKILL handler（WorkflowNodeType 中的 `SKILL` 预留位）
- 不支持模型生成动态 workflow plan（model-planned workflow 属于 `add-ts-workflow-orchestration-policy` 范围）
- 不新增 Web API 或 runtime command
- 不改变 `WorkflowNodeType` 枚举
- 首版不支持 workflow resume（WAITING → DEGRADED 后模型用 AskUserQuestion 中继，用户答案不回灌同一 workflow 执行）

## Capability 影响（Capabilities）

### 新增 Capability

- `workflow-agent-loop-tool`：model-driven loop 中通过 tool-call 调用 workflow recipe 的行为契约

### 修改的 Capability

- `agent-capability`：`builtinToolDefinitions` 新增 `Workflow` tool 定义；`tool-spi.ts` 的 `ToolDependencyName` 和 `ToolDependencies` 新增 `workflowExecution`；`tool-catalog.ts` 的 `allowedDependencyNames` 校验集新增 `"workflowExecution"`
- `agent-contracts/capability`：`ToolDependencyName` 联合类型和 `ToolDependencies` 接口同步新增 `workflowExecution`（与 `agent-capability/tool-spi.ts` 双份定义保持一致）
- `agent-app`：composition 新增 `WorkflowExecutionToolPort` 适配 wiring

## 影响范围（Impact）

- `agent-capability`：新增 `builtins/workflow/` 目录，新增 tool 定义和 schemas；修改 `builtins/index.ts` 注册；修改 `tools/tool-spi.ts` 新增 `ToolDependencyName` 成员、`WorkflowExecutionToolPort` interface 和 `ToolDependencies.workflowExecution`；修改 `tools/tool-catalog.ts` 的 `allowedDependencyNames` 新增 `"workflowExecution"`
- `agent-contracts/capability`：修改 `capability/index.ts` 的 `ToolDependencyName` 和 `ToolDependencies` 同步新增 `workflowExecution`（双份定义保持一致，contracts 层用 `unknown` 类型，tool-spi 层用具体 port 类型）
- `agent-app`：修改 `composition/create-app.ts` 新增 workflow tool port 适配和依赖注入
- `agent-core`：无改动（tool loop 已有通用执行路径，不需要特殊分支；Workflow tool 失败沿用通用 `shouldTerminateCapabilityFailure` 逻辑，不加入 Agent tool 的豁免分支）

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/workflow-agent-loop-tool/spec.md`：新增

长期背景：
- `openspec/overview.md`：补充 — tool-level workflow 入口作为 model loop 中调用 workflow 的能力补充

设计视图：
- `openspec/designs/modules/agent-capability.md`：补充 Workflow builtin tool owner
- `openspec/designs/modules/agent-app.md`：补充 workflow tool port wiring
- `openspec/designs/architecture/workflow-contracts.md`：补充 tool-level workflow 入口
- `openspec/designs/spec-to-design-map.md`：补充映射

验证入口：
- `npm run build`
- `npm test`（workflow tool unit + integration）
- `npm run test:contract`
- `npm run lint:architecture`
- `openspec validate --all --strict`
