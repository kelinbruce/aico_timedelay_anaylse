## 1. exception 失败变量契约实现

- [x] 1.1 修改 `mapSafeErrorToVariables`（`packages/agent-workflow/src/engine/index.ts`），将 `error` 字段从 `{code, category, reasonCode}` 改为 `{code, message, category?}`：`code` 取 `safeError.code`，`message` 取 `safeError.message`，`category` 仅在 `safeError.category === "TIMEOUT"` 时注入 `"TIMEOUT"`，移除 `reasonCode`、`code`、`category` 字段。
  验证：`npm test -- workflow-execution-engine` 中新增 shape 断言测试通过
  来源：spec Exception Failure Variable Contract、design 决策 1

- [x] 1.2 确认 `toSafeError`（`packages/agent-workflow/src/engine/index.ts`）的 `AgentError` 透传分支保持 `error.code` 和 `error.category` 不变，不修改 `toSafeError` 逻辑。category 收敛只发生在 `mapSafeErrorToVariables` projection 层。
  验证：code review 检查 `toSafeError` 无修改，现有 `toSafeError` 相关测试无回退
  来源：design 决策 2

- [x] 1.3 确认节点层（`capability-nodes.ts`、`llm-nodes.ts`、`interaction-nodes.ts`、`knowledge-nodes.ts`）在 capability 返回 `safeError` 时抛出的 `AgentError.code` 等于上游 `safeError.code`，不使用 `WORKFLOW_CAPABILITY_FAILED` 覆盖非空上游 code。此为确认性 task：`capabilityResultPayload` 已用 `safeError?.code ?? "WORKFLOW_CAPABILITY_FAILED"` 正确透传，`??` 只在 safeError 为 undefined 时兜底。检查 `executeRestfulNode`、`executeToolChoiceNode`、`executeAgentNode`、`executeLlmNode`、guardrail/sub-recipe/knowledge 错误包装路径。
  验证：code review 检查各节点 `safeError` 透传点 `code` 取自上游；`npm test -- workflow-capability-nodes workflow-llm-nodes workflow-interaction-nodes workflow-knowledge-nodes` 通过
  来源：spec Exception Failure Variable Contract Business failure code passthrough、design 决策 3

## 2. exception 条件路由测试

- [x] 2.1 更新 `workflow-execution-engine.test.ts` 中 exception 路由测试，把 `${error.reasonCode == '...'}` 条件改写为 `${error.code == '...'}`，断言 `error` 含 `code`/`message` 且不含 `reasonCode`/`code`/`category`。
  验证：`npm test -- workflow-execution-engine.test` 通过
  来源：spec Exception Failure Variable Contract Condition routes by business code

- [x] 2.2 新增测试：exception condition 按 `error.code` 路由业务失败（模拟 capability 返回业务 code `5001`，断言选中对应 exception 分支）。
  验证：`npm test -- workflow-execution-engine.test` 中新增 case 通过
  来源：spec Exception Failure Variable Contract Business failure code passthrough

- [x] 2.3 新增测试：timeout 失败时 `error.category` 等于 `"TIMEOUT"` 且 `code` 等于 `WORKFLOW_NODE_TIMEOUT`；非超时失败时 `error` 不含 `category` 字段。
  验证：`npm test -- workflow-execution-engine.test` 中新增 timeout/非timeout case 通过
  来源：spec Exception Failure Variable Contract Timeout category overlay、Engine structural failure without category

- [x] 2.4 新增测试：exception 变量空间中 `error` 被冻结（`Object.isFrozen`），且原有 workflow 变量保持可见可被 condition 引用。
  验证：`npm test -- workflow-execution-engine.test` 中新增 freeze/visibility case 通过
  来源：spec Exception Failure Variable Contract Existing workflow variables remain visible

## 3. 负面验证

- [x] 3.1 新增测试：断言 `error` 不含 `reasonCode`、`code`、`category` 旧字段（negative：旧字段已移除）。
  验证：`npm test -- workflow-execution-engine.test` 中 negative case 断言旧字段不存在
  来源：spec Exception Failure Variable Contract reasonCode field removed

- [x] 3.2 新增测试：断言非超时失败（如 `AgentError` category=`VALIDATION`/`INTERNAL`/`UNAVAILABLE`）的 `error` 不含 `category` 字段（negative：category 非超时值不暴露）。
  验证：`npm test -- workflow-execution-engine.test` 中 negative case 断言 `category` 不存在
  来源：spec Exception Failure Variable Contract Engine structural failure without category

- [x] 3.3 新增测试：断言业务失败的 `error.code` 不等于 `WORKFLOW_CAPABILITY_FAILED`（negative：框架码不覆盖业务 code）。
  验证：`npm test -- workflow-capability-nodes` 中 negative case 通过
  来源：spec Exception Failure Variable Contract Business failure code passthrough

## 4. 验证和收尾

- [x] 4.1 运行 agent-workflow 包全量测试，确认无回退。
  验证：`npm test -- agent-workflow` 全绿
  来源：design 验证映射全量覆盖

- [x] 4.2 运行 `openspec validate --all --strict` 确认 change 文档合法。
  验证：`openspec validate --all --strict` 无错误
  来源：AGENTS.md 验证门禁

- [x] 4.3 运行 `npm run lint:architecture` 确认架构边界无违反。
  验证：`npm run lint:architecture` 通过
  来源：AGENTS.md 验证门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 同步 `openspec/specs/workflow-execution-engine/spec.md`：新增 Exception Failure Variable Contract requirement，更新 Timeout and Retry requirement。
- 按需更新 `openspec/designs/architecture/workflow-execution-and-routing.md`：补充 exception 失败变量的框架/业务透传边界和 category 收敛理由。
- 按需更新 `openspec/designs/modules/agent-workflow.md`：补充 `mapSafeErrorToVariables` 的字段语义和 `code`/`message` 透传规则。
- 按需新增 `openspec/designs/adr/workflow-exception-category-collapse.md`：记录 category 枚举收敛为 TIMEOUT 单值的取舍理由。
- 按需更新 `openspec/designs/spec-to-design-map.md`：新增 workflow-execution-engine exception 契约到 architecture/module/adr 的导航。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
