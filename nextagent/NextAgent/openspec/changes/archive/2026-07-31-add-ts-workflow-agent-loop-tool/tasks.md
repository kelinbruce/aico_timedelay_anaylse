## 1. Tool 定义与依赖契约

- [x] 1.1 在 `agent-contracts/src/capability/index.ts` 的 `ToolDependencyName` 联合类型中新增 `"workflowExecution"`，在 `ToolDependencies` 接口中新增 `readonly workflowExecution?: unknown`
  验证：`npm run build`
  来源：design D1；双份定义同步要求

- [x] 1.2 在 `agent-capability/src/tools/tool-spi.ts` 的 `ToolDependencyName` 联合类型中新增 `"workflowExecution"` 成员，在 `ToolDependencies` 接口中新增 `readonly workflowExecution?: WorkflowExecutionToolPort`
  验证：`npm run build`
  来源：design D1；双份定义同步要求

- [x] 1.3 在 `agent-capability/src/tools/tool-spi.ts` 新增 `WorkflowExecutionToolPort` interface
  - 输入：`recipeName`、`inputText?`、`inputVariables`、`context: ToolExecutionContext`、`signal: AbortSignal`
  - 返回：`Promise<CapabilityInvocationResult>`
  验证：`npm run build`
  来源：design D2

- [x] 1.4 在 `agent-capability/src/tools/tool-catalog.ts` 的 `allowedDependencyNames` Set 中新增 `"workflowExecution"`
  验证：`npm run build`；确认 catalog 构造不抛 `CapabilityConfigurationError`
  来源：design D1；catalog 校验要求

## 2. Workflow Tool 实现

- [x] 2.1 新建 `agent-capability/src/builtins/workflow/workflow-schemas.ts`，定义 input/output JSON schema
  - input：`recipeName`（必填 string）、`inputText`（可选 string）、`inputVariables`（可选 object）
  - output：`additionalProperties: true` object
  验证：`npm run build`
  来源：spec Requirement: Workflow Tool Availability

- [x] 2.2 新建 `agent-capability/src/builtins/workflow/workflow-tool.ts`，实现 `workflowToolDefinition`
  - `name: "Workflow"`，`returnsCapabilityResult: true`，`replayPolicy: "NON_IDEMPOTENT"`
  - `requiredDependencies: ["workflowExecution"]`
  - `disclosurePolicy: { mode: "EAGER" }`
  - execute 逻辑：校验 inputVariables 格式 → 调用 `options.deps.workflowExecution.execute()` → 返回 result
  - 不在 tool 内部校验 recipe 存在性（由 port 适配器隐式完成）
  验证：`npm run build`
  来源：design D1, D3

- [x] 2.3 在 `agent-capability/src/builtins/index.ts` 的 `builtinToolDefinitions` 数组中注册 `workflowToolDefinition`
  验证：`npm run build`
  来源：design D1

## 3. 结果映射

- [x] 3.1 在 `workflow-tool.ts` 或独立模块中实现 `WorkflowExecutionResult` → `CapabilityInvocationResult` 映射
  - `COMPLETED` → `SUCCEEDED` + outputVariables
  - `FAILED` → `FAILED` + safeError 从最后失败节点映射
  - `INTERRUPTED` → `FAILED` + safeError category `CANCELED`
  - `WAITING` → `DEGRADED` + pendingInput 摘要 + `safeError.code: "WORKFLOW_PENDING_INPUT"`
  - secret keyword pattern 过滤
  - 注意：`SafeError` 使用 `code` 字段，不是 `reasonCode`
  验证：unit test 覆盖所有 status 分支
  来源：design D4, D10；spec Requirement: Workflow Result To Capability Result Mapping

## 4. Composition Wiring

- [x] 4.1 在 `agent-app/src/composition/create-app.ts` 中实现 `WorkflowExecutionToolPort` 适配器
  - 从 `ToolExecutionContext` 读取 agentId、sessionId、runId、identityContext 等 scope 字段
  - 调用 app-provided recipe definition source 获取 `RecipeDefinition`（含 `recipeVersion`）
  - 组装 `WorkflowExecutionRequest`（含 `recipeName`、`recipeVersion`、scope 字段、`inputText`、`inputVariables`）
  - 调用已有的 `workflowExecutionService` 实例
  - 通过 observer callback 投影 timeline event
  - local/remote 模式复用已有 `workflowExecutionService` 构建逻辑
  - catch `RECIPE_NOT_FOUND` → 映射为 `FAILED` + `VALIDATION`
  验证：`npm run build`
  来源：design D2, D3, D6, D7, D11

- [x] 4.2 在 `create-app.ts` 的 tool dependencies 构建中注入 `workflowExecution` port
  - `subsystem.ts` 使用 spread 模式透传 toolDependencies，无需修改
  验证：`npm run build`；确认 Workflow tool availabilityStatus 为 AVAILABLE
  来源：design D7, D9；spec Requirement: Tool Dependency Declaration

## 5. 测试

- [x] 5.1 Unit test：Workflow tool input validation
  - recipeName 为空 → FAILED
  - recipeName 超长 → FAILED
  - inputVariables 非 object → FAILED
  - 正常输入 → 调用 port
  验证：`npm test`
  来源：spec Scenario: Recipe Not Found

- [x] 5.2 Unit test：结果映射覆盖所有 status
  - COMPLETED → SUCCEEDED + structuredPayload 包含 outputVariables
  - FAILED → safeError 映射
  - INTERRUPTED → FAILED + CANCELED
  - WAITING → DEGRADED + pendingInput 摘要 + safeError.code 为 WORKFLOW_PENDING_INPUT
  - secret keyword pattern 过滤
  验证：`npm test`
  来源：spec Requirement: Workflow Result To Capability Result Mapping

- [x] 5.3 Unit test：abort
  - signal abort → port 返回 INTERRUPTED → FAILED + CANCELED
  验证：`npm test`
  来源：spec Requirement: Abort And Timeout

- [x] 5.4 Integration test：端到端流程
  - mock 当前 Agent Scope 的 `WORKFLOW` capability / definition source
  - mock WorkflowExecutionService 返回 COMPLETED
  - 模型调用 Workflow tool → 返回结果
  - 验证 structuredPayload 包含 recipeName 和 outputVariables
  验证：`npx vitest run --config vitest.config.release.ts tests/e2e/workflow-tool-agent-loop.test.ts`（local + remote 双模式覆盖端到端流程）
  来源：spec Scenario: Model Selects Workflow Tool After Skill Guidance

- [x] 5.5 Integration test：scope 继承
  - 验证 WorkflowExecutionRequest.agentId 等于 ToolExecutionContext.agentId
  - 验证 identityContext 一致
  - 验证不创建子 session
  验证：E2E 测试断言 executed[0] 的 recipeName/recipeVersion/agentId/inputText 与 ToolExecutionContext 一致，且在同一 session 内完成（无子 session）
  来源：spec Requirement: Scope Inheritance

- [x] 5.6 Architecture test：tool 依赖未注入时 UNAVAILABLE + source-level 断言
  - 不注入 workflowExecution 依赖
  - 验证 Workflow tool 不出现在 listAvailable 结果中
  - 新增 source-level 断言：`expect(builtins).toContain("workflowToolDefinition")`
  - 新增 source-level 断言：`expect(workflowTool).toContain('requiredDependencies: ["workflowExecution"]')`
  - 确认 `tests/agent-kernel/capability-governance.test.ts` 是否需要适配工具数量变化
  验证：`npm run lint:architecture` 或 `npm test`
  来源：spec Scenario: Dependency Missing Marks Tool Unavailable；design D1

- [x] 5.7 Contract test：structuredPayload 安全性
  - 验证不包含 secret 明文
  - 验证不包含 raw provider error
  - 验证 metadata 只包含安全可追溯键
  验证：`npm run test:contract`
  来源：spec Requirement: Workflow Result To Capability Result Mapping

## 6. 验证门禁

- [x] 6.7 Workflow tool 仅解析当前 Agent Scope 的 `WORKFLOW` descriptor，并由共享 projector 同时识别 workflow descriptor 与 builtin `Workflow` tool adapter
  验证：`npm test`

- [x] 6.1 `npm run build` 通过
  验证：build 成功

- [x] 6.2 `npm test` 通过
  验证：所有 workflow tool 相关测试通过

- [x] 6.3 `npm run test:contract` 通过
  验证：contract test 通过

- [x] 6.4 `npm run lint:architecture` 通过
  验证：无 architecture boundary 违规

- [x] 6.5 `openspec validate --all --strict` 通过
  验证：OpenSpec 校验通过

- [x] 6.6 Push 前加载并使用 `$nextagent-code-review` 进行模型语义检视
  验证：检视结论 PASS 或 PASS WITH FOLLOW-UP
## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 同步 `openspec/specs/workflow-agent-loop-tool/spec.md`：新增 Workflow tool 全部行为契约
- 按需更新 `openspec/overview.md`：补充 tool-level workflow 入口作为 model loop 中调用 workflow 的能力
- 按需更新 `openspec/designs/architecture/workflow-contracts.md`：补充 tool-level workflow 入口与 routing-level workflow 路径的并存架构
- 按需更新 `openspec/designs/modules/agent-capability.md`：补充 Workflow builtin tool 模块归属和 `WorkflowExecutionToolPort` 契约
- 按需更新 `openspec/designs/modules/agent-app.md`：补充 composition wiring 中 port 适配和依赖注入
- 按需更新 `openspec/designs/spec-to-design-map.md`：补充 `workflow-agent-loop-tool` spec 到 design 的导航映射
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义
- 归档时提炼 D1（标准 TOOL 注册）、D2（最小 Port 适配）、D3（recipe 隐式校验）、D10（status 映射规则）为长期有效决策；D4（WAITING → DEGRADED，首版不支持 resume）标注为当前版本约束
