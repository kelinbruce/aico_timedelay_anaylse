## 背景和现状（Context）

当前 workflow 节点失败进入 exception 路由时，`mapSafeErrorToVariables`（`packages/agent-workflow/src/engine/index.ts`）注入 `error.{code, category, reasonCode}`。代码核查发现两个问题：

1. RESTful/capability 业务失败的 `code` 被框架码覆盖。节点层（`capability-nodes.ts` 的 `capabilityResultPayload`、`safeErrorSummary`、`createBatchFailedItem`）在 capability 返回 `safeError` 时，部分路径用 `WORKFLOW_CAPABILITY_FAILED` 兜底覆盖上游业务 code，recipe 无法用 `${error.code == '5001'}` 直接匹配业务失败。

2. `category` 透传全量 `AgentErrorCategory` 九值枚举，但框架实际只合成 `TIMEOUT`（`toSafeError` 中 `didTimeout` 分支）和 `CANCELED`（不进 exception 路径）。其余 category 全靠节点层抛 `AgentError` 透传，且 `VALIDATION`/`UNAVAILABLE`/`NOT_FOUND` 在运行时基本是死路径或部署配置问题（loader 阶段已校验结构、deferred binding 未注入是部署竞态），`POLICY_DENIED` 无任何抛出点。维护这套感知不全的枚举误导 recipe 作者按不可靠的 category 分流。

相关方：recipe 作者（消费 exception condition 变量）、workflow engine（`agent-workflow` package）、capability/RESTful 节点（产出业务失败）、`agent-common`（`SafeError` 类型归属）。

`refine-ts-workflow-execution-engine-v2` 已完成（4/4 artifacts，tasks 全勾选），其范围是消费 v2 runtime contract（timeout/retry/controlPolicy/dependsOn）并将 onError 废弃、异常转移统一走 exception。它定义了"走 exception 转移"的行为，但未定义 exception 变量空间本身的内容契约。本 change 承接该缺口。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 重定义 exception 失败变量契约为 `error.{code, message, category?}`，`code` + `message` 作为业务失败第一公民透传，`category` 仅保留 `TIMEOUT` 单值。
- 修正 RESTful/capability 业务错误透传路径，使上游业务 `code`/`message` 直接进入 exception 变量空间，不被框架码覆盖。
- 收敛框架对 category 枚举的感知范围，避免误导 recipe 作者按不可靠的 category 分流。

**非目标：**
- 不改变 `SafeError` 类型本身（`agent-common` 的 `SafeError` 保持 `{code, message, category, retryable, safeDetails?}`），它仍是内部错误表示。本次只改变 `mapSafeErrorToVariables` 向 exception 变量空间投影的字段名。
- 不改变 `evaluateBranchCondition` 的条件表达式语法。
- 不改变 `WorkflowNodeResult.safeError` 或 `WorkflowExecutionEvent` 中的 safeError shape（它们是 observability 面向的内部表示，不是 recipe condition 变量）。
- 不引入新的 category 枚举值，不删除 `AgentErrorCategory` 类型本身。
- 不改变 guardrail REJECT 的处理方式（仍走正常节点输出，不走 exception）。
- 不改变 CANCELED 不进 exception 路由的现状。
- 不修正节点层 category 语义错位（如 `WORKFLOW_KNOWLEDGE_SEARCH_EMPTY` 标 `NOT_FOUND`、`WORKFLOW_QUESTION_REWRITING_ASK_QUESTION` 标 `VALIDATION`），留作独立后续 change。
- 不涉及 restful batch 配置（由 `refine-ts-workflow-recipe-v2-contracts` task 6 承载并已实现）。
- 不涉及 user-check 节点增强（由 `refine-ts-workflow-recipe-v2-contracts` task 5 承载并已实现）。
- 不涉及 recipe 外部控制策略 controlPolicy（由 `refine-ts-workflow-recipe-v2-contracts` 契约层 + `refine-ts-workflow-execution-engine-v2` + `add-ts-workflow-persistence-recovery` 执行层承载并已实现）。
- 不涉及 prompt template / outputParser（由 `refine-ts-workflow-recipe-v2-contracts` task 2.3 + `add-ts-workflow-llm-nodes` 承载并已实现）。
- 不涉及 knowledge-search 输出 binding 收敛（由 `fix-ts-workflow-knowledge-search-outputs` 承载）。

## 设计决策（Decisions）

### 决策 1：exception 变量空间字段从 `{code, category, reasonCode}` 改为 `{code, message, category?}`

`mapSafeErrorToVariables` 是 exception 变量空间的唯一组装点，从 `SafeError` 投影出 recipe 可见字段。改为：注入位置从嵌套的 `__workflow.safeError` 拍平为顶层 `error`，`code` 取 `safeError.code`，`message` 取 `safeError.message`，`category` 仅在 `safeError.category === "TIMEOUT"` 时注入 `"TIMEOUT"`，移除 `reasonCode` 字段。不再注入 `__workflow` 键。

`message` 取 `safeError.message`（对业务失败是上游 message，对框架合成是框架 message）。`message` 取代 `reasonCode`——原来 `reasonCode` 只是 `safeDetails.reasonCode ?? safeError.code` 的别名，和 `code` 高度重复，保留无信息增益。

注入位置为 `error`（不带 `__` 前缀），不再嵌套在 `__workflow` 下。当前仓内无 recipe 使用 `error` 作为 output key 或变量名（已搜索确认），无撞名风险。变量 key 命名遵循 camelCase 惯例（与 `loopElementVariable`、`loopResultVariable` 一致），不使用 recipe 节点输入参数的 snake_case 惯例。exception condition 的求值上下文 = 原有 workflow 变量 + 注入的 `error`，两者平级可见，recipe 可自由组合（如 `${error.code == '5001'}` 或 `${api_name != 'critical_api'}`）。

**备选方案 A**：保留 `reasonCode` 同时新增 `message`。放弃：`reasonCode` 和 `code` 在业务失败场景取值相同（都是业务 code），两个字段造成歧义。

**备选方案 B**：完全移除 `category`，只保留 `code` + `message`。放弃：超时是框架唯一真实合成且 recipe 有明确分流需求的失败类型（重试 vs 降级 vs 跳过），保留 `category: "TIMEOUT"` 让 recipe 能用 `${error.category == 'TIMEOUT'}` 做超时专项路由，比要求 recipe 记住 `code == 'WORKFLOW_NODE_TIMEOUT'` 更稳定（框架码可能演进，category 语义稳定）。

### 决策 2：`toSafeError` 保持 category 全量透传，category 收敛只发生在 projection 层

`toSafeError`（engine 兜底错误合成）保持现有逻辑：timeout 合成 `TIMEOUT`、abort 合成 `CANCELED`、兜底合成 `INTERNAL`。`AgentError` 透传时保持原 `category`。category 收敛（只暴露 `TIMEOUT`）只发生在 `mapSafeErrorToVariables` 的 projection 层。

理由：`SafeError` 是 `WorkflowNodeResult.safeError`、`WorkflowExecutionEvent` 等多个消费点的内部错误表示，这些消费点需要完整 `category` 做日志/诊断/observability。只有 exception condition 变量空间需要收敛（它是 recipe 作者面向的、有限的分流工具）。在 projection 层收敛避免影响其他消费点。

### 决策 3：RESTful/capability 业务错误透传修正

核心确认：`toSafeError` 的 `AgentError` 分支已保留 `error.code`（当前正确），`mapSafeErrorToVariables` 用 `safeError.code` 作为 exception 变量 `code`（当前正确）。需要修正的是节点层在 capability 返回 `safeError` 时，确保抛出的 `AgentError.code` 等于上游 `safeError.code`，不用 `WORKFLOW_CAPABILITY_FAILED` 覆盖非空上游 code。

`capabilityResultPayload`（`shared.ts`）在 capability 返回 `FAILED`/`TIMED_OUT` 时抛 `AgentError`，`code` 用 `safeError?.code ?? "WORKFLOW_CAPABILITY_FAILED"`——当 `safeError` 存在时已正确透传上游 code，`??` 只在 `safeError` 为 undefined 时兜底。本 task 1.3 是确认性 task，验证各节点透传点不存在非空 code 覆盖，而非修改性 task。

`createBatchFailedItem` 和 `safeErrorSummary` 的 `code` 字段是 batch/poll 的汇总诊断，写入 `poll_results`/batch output，recipe 可通过节点 output 引用，不直接进入 exception 变量空间——这些路径的兜底 `?? "WORKFLOW_CAPABILITY_FAILED"` 只在 `safeError` 为 undefined 时触发，可保留。`safeErrorSummary` 中有个 `reasonCode` 字段，但它在节点 output 而非 `error` condition 变量空间，不受本次 change 影响，不构成 BREAKING。

### 决策 4：节点层 category 清理不纳入本次范围

现有节点层 category 标注的语义错位问题本次不修正。原因：这些 category 经 `mapSafeErrorToVariables` projection 后不再暴露给 exception 变量（只有 `TIMEOUT` 暴露），recipe condition 不受影响；observability 面的语义清理作为独立 change。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | exception 变量空间的 `code`/`message` 来自 `SafeError`，已脱敏（不含 prompt/raw output/credential/path）。`category` 收窄为 `TIMEOUT` 减少信息暴露面。无新增 secret/prompt 泄露风险。 | exception 变量空间不含 secret 的 contract test |
| 性能/容量 | `mapSafeErrorToVariables` 是 O(1) 字段投影，无额外开销。exception condition 求值频率不变。 | 现有 engine 性能测试无回退 |
| 可靠性/恢复 | 失败变量契约变化不影响 retry/terminal commit/cancel 语义。exception 路由仍是重试耗尽后的分支选择，fallback 语义不变。 | exception 路由测试（匹配/不匹配/fallback） |
| 可维护性 | category 枚举收敛减少 recipe 作者认知负担和误用风险。`code`/`message` 透传原则与"框架不感知业务语义"一致。 | code review + spec 对齐检查 |
| 可测试性 | exception 变量空间是纯函数输出，可直接断言 `error` shape。condition 路由可用现有 `evaluateBranchCondition` 测试框架验证。 | workflow-execution-engine.test.ts + contract test |
| 审计/可追溯性 | `WorkflowNodeResult.safeError` 保持完整 `SafeError`（含 `category`/`safeDetails`），observability 面不受影响。exception 变量空间是 recipe 求值上下文，不是审计事实。 | 现有 node result safeError 断言无回退 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| exception 变量空间仅含 `code`/`message`/可选`category` | 1.1 | `workflow-execution-engine.test.ts` shape 断言 |
| 业务失败 `code` 直接透传，不被 `WORKFLOW_CAPABILITY_FAILED` 覆盖 | 1.3 | `workflow-capability-nodes.test.ts` code 透传断言 |
| `category` 仅 `TIMEOUT` 暴露，其他 category 不暴露 | 2.3 | exception 变量 shape 断言 + 非 timeout 节点失败断言 |
| timeout 失败注入 `category: "TIMEOUT"` | 2.3 | timeout 场景 exception 变量断言 |
| `message` 取 `safeError.message` | 2.1 | message 字段断言 |
| 原有 workflow 变量保留可见 | 2.4 | condition 引用既有变量测试 |
| condition 按 `code` 路由业务失败 | 2.2 | exception condition `${error.code == '5001'}` 测试 |
| `reasonCode`/`code`/`category` 旧字段移除 | 3.1 | 旧字段不存在断言 |
| `toSafeError` category 透传不变 | 1.2 | 现有 toSafeError 测试无回退 |
| `WorkflowNodeResult.safeError` shape 不变 | 4.1 | 现有 node result 断言无回退 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/workflow-execution-engine/spec.md`（Exception Failure Variable Contract requirement + 修改后的 Timeout and Retry requirement）
- 架构和跨模块设计：`openspec/designs/architecture/workflow-execution-and-routing.md`（exception 失败变量的框架/业务透传边界）
- 模块设计：`openspec/designs/modules/agent-workflow.md`（`mapSafeErrorToVariables` 字段语义和 `code`/`message` 透传规则）
- ADR：`openspec/designs/adr/workflow-exception-category-collapse.md`（category 收敛为 TIMEOUT 单值的取舍理由）
- 导航：`openspec/designs/spec-to-design-map.md`（workflow-execution-engine exception 契约导航）

## 风险与取舍（Risks / Trade-offs）

[BREAKING：`reasonCode`/`code`/`category` 字段移除] -> 现有 recipe 中使用 `${error.reasonCode}` 或 `${error.category}` 的 exception condition 需改写为 `${error.code}` 或 `${error.message}`。当前仓内无使用这些字段的 recipe（已搜索确认），影响面限于测试代码。

[BREAKING：`category` 非超时值不再暴露] -> 现有 recipe 中使用 `${error.category == 'VALIDATION'}` 等的 exception condition 将永远不匹配。当前仓内无此类 recipe（已搜索确认）。

[节点层 category 语义错位未修正] -> `WORKFLOW_KNOWLEDGE_SEARCH_EMPTY` 标 `NOT_FOUND` 等问题保留。缓解：这些 category 不再进入 exception 变量空间，recipe 不受影响；observability 面的语义清理作为独立 change。

## 迁移计划（Migration Plan）

无需数据迁移。exception 变量空间是运行时内存态，不持久化。代码部署后即生效。已搜索确认仓内无 recipe 使用 `reasonCode` 或非 `TIMEOUT` 的 `category` 作为 exception condition，无需 recipe 迁移。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/workflow-execution-engine/spec.md`：新增 Exception Failure Variable Contract requirement，更新 Timeout and Retry requirement。
- `openspec/designs/architecture/workflow-execution-and-routing.md`：补充 exception 失败变量的框架/业务透传边界和 category 收敛理由。
- `openspec/designs/modules/agent-workflow.md`：补充 `mapSafeErrorToVariables` 的字段语义和 `code`/`message` 透传规则。
- `openspec/designs/adr/workflow-exception-category-collapse.md`：新增 ADR，记录 category 枚举收敛为 TIMEOUT 单值的取舍。
- `openspec/designs/spec-to-design-map.md`：新增 workflow-execution-engine exception 契约到 architecture/module/adr 的导航。

## 待确认问题（Open Questions）

无。
