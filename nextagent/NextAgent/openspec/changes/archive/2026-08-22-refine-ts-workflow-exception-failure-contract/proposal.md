## 背景与问题（Why）

workflow 节点失败进入 exception 路由后，recipe 通过 `node.exception` 的 condition 表达式选择恢复分支。condition 求值依赖 `mapSafeErrorToVariables` 注入的 `error` 变量空间。当前实现存在两个问题，使 exception 分支条件无法可靠表达业务失败：

1. **业务失败 code 被框架码覆盖**。RESTful 节点调 capability 返回业务失败时，节点层把 top-level `code` 设成框架码（如 `WORKFLOW_CAPABILITY_FAILED`），上游接口真正的业务 code（如 `5001`、`ORDER_NOT_FOUND`）被埋进 `safeDetails` 或 payload。recipe 无法用 `${error.code == '5001'}` 直接匹配业务失败。这违背了"框架不感知业务语义、只透传"的原则。exception 条件由产品自定义，但条件能引用的变量空间本身由框架定义，当前这个空间没有把业务 code/msg 作为第一公民透传。

2. **category 枚举感知不全、分类不准**。当前透传 `AgentErrorCategory` 全量九值枚举，但逐条核查当前实现发现框架并不真正感知这些类别：`TIMEOUT` 是框架唯一真实合成的 category（`didTimeout` → `WORKFLOW_NODE_TIMEOUT`/TIMEOUT）；`VALIDATION`/`UNAVAILABLE`/`NOT_FOUND` 在运行时基本是死路径或部署配置问题；`POLICY_DENIED` 无任何抛出点；`CANCELED` 不进 exception 路由。维护这套感知不全的枚举误导 recipe 作者按不可靠的 category 分流。

核心场景是 RESTful 接口返回的业务 code/msg，框架本就不该解释语义。需要把 exception 失败变量空间重新定义为以业务 `code` + `message` 为第一公民、`category` 仅保留框架真正合成的 `TIMEOUT` 单值。

## 变更范围（What Changes）

### exception 失败变量契约重定义（BREAKING）

exception 分支的 condition 变量空间中，注入位置从 `__workflow.safeError` 变为 `error`，字段从 `{code, category, reasonCode}` 变为 `{code, message, category?}`：

- `code`：业务失败的第一标识。capability/RESTful 业务失败时，`code` 直接携带上游接口返回的业务 code（不再被框架码覆盖）。框架自身结构性失败时，`code` 携带框架码（如 `WORKFLOW_NODE_TIMEOUT`）。框架不解释业务 code 语义，只透传。
- `message`：业务失败的人类可读原因。优先取上游接口返回的 msg/message；框架合成失败时携带框架 message。`message` 取代原 `reasonCode` 字段。
- `category`：可选 overlay，仅保留 `TIMEOUT` 单值。框架合成的超时失败携带 `category: "TIMEOUT"`；其他所有失败不携带 `category` 字段（undefined），recipe 不应依赖 `category` 做非超时分流。

变量 key 命名遵循 `__workflow` 既有 camelCase 惯例（与 `loopElementVariable` 一致），不使用 recipe 节点输入参数的 snake_case 惯例。注入位置为 `error`（不带 `__` 前缀），当前仓内无 recipe 使用 `error` 作为 output key 或变量名，无撞名风险。

### RESTful/capability 业务错误透传修正

capability/RESTful 节点在 capability 返回 `safeError` 时，抛出的 `AgentError.code` 直接使用上游 `safeError.code`（业务 code），不再用框架码覆盖非空上游 code；`message` 取 `safeError.message`。框架只在 capability 未返回 safeError 的异常兜底场景使用框架码。

### condition 表达式无变化

`evaluateBranchCondition` 的语法（标识符路径、比较符、逻辑符、括号、`${}` 包装）保持不变。exception 条件由产品自定义，框架只提供求值器和变量空间。exception condition 的求值上下文 = 原有 workflow 变量 + 注入的 `error`，两者平级可见，recipe 可自由组合（如 `${error.code == '5001'}` 或 `${api_name != 'critical_api'}`）。主要变量可从 workflow 上下文取到。

## 不在范围内（Explicit Non-Goals）

- 不改变 `SafeError` 类型本身（`agent-common` 的 `SafeError` 保持 `{code, message, category, retryable, safeDetails?}`），它仍是内部错误表示。本次只改变 `mapSafeErrorToVariables` 向 exception 变量空间投影的字段名。
- 不改变 `evaluateBranchCondition` 的条件表达式语法。
- 不改变 `WorkflowNodeResult.safeError` 或 `WorkflowExecutionEvent` 中的 safeError shape（它们是 observability 面向的内部表示，不是 recipe condition 变量）。
- 不引入新的 category 枚举值，不删除 `AgentErrorCategory` 类型本身。
- 不改变 guardrail REJECT 的处理方式（仍走正常节点输出，不走 exception）。
- 不改变 CANCELED 不进 exception 路由的现状。
- 不修正节点层 category 语义错位（如 `WORKFLOW_KNOWLEDGE_SEARCH_EMPTY` 标 `NOT_FOUND`），留作独立后续 change。
- 不涉及 restful batch 配置（由 `refine-ts-workflow-recipe-v2-contracts` task 6 承载并已实现）。
- 不涉及 user-check 节点增强（由 `refine-ts-workflow-recipe-v2-contracts` task 5 承载并已实现）。
- 不涉及 recipe 外部控制策略 controlPolicy（由 `refine-ts-workflow-recipe-v2-contracts` 契约层 + `refine-ts-workflow-execution-engine-v2` + `add-ts-workflow-persistence-recovery` 执行层承载并已实现）。
- 不涉及 prompt template / outputParser（由 `refine-ts-workflow-recipe-v2-contracts` task 2.3 + `add-ts-workflow-llm-nodes` 承载并已实现）。
- 不涉及 knowledge-search 输出 binding 收敛（由 `fix-ts-workflow-knowledge-search-outputs` 承载）。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `workflow-execution-engine`: 新增 Exception Failure Variable Contract requirement，定义 `error.{code, message, category?}` 的字段语义、填充规则和框架/业务透传边界；修改 Timeout and Retry requirement 以对齐新的失败变量语义。

## 影响范围（Impact）

- 代码：`packages/agent-workflow/src/engine/index.ts`（`mapSafeErrorToVariables`、`toSafeError`）、`packages/agent-workflow/src/nodes/capability-nodes.ts`（`capabilityResultPayload`、`safeErrorSummary`、`createBatchFailedItem`）、`packages/agent-workflow/src/nodes/llm-nodes.ts`、`packages/agent-workflow/src/nodes/interaction-nodes.ts`、`packages/agent-workflow/src/nodes/knowledge-nodes.ts`（各 AgentError 包装点的 code 透传对齐）。
- 契约：exception condition 变量空间 shape 变化（BREAKING），注入位置从 `__workflow.safeError` 改为 `error`，影响已有 recipe 中使用 `${__workflow.safeError.reasonCode}` 或 `${__workflow.safeError.category}` 的 exception condition。当前仓内无 recipe 使用这些字段（已搜索确认），影响面限于测试代码。
- 测试：`packages/agent-workflow/tests/workflow-execution-engine.test.ts`（exception 路由测试需更新断言）、capability/llm/interaction/knowledge node 测试中 safeError 断言需对齐新字段。
- 配置/运维：无新增配置项。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/workflow-execution-engine/spec.md`：修改，新增 Exception Failure Variable Contract requirement，更新 Timeout and Retry requirement 的失败变量语义。

长期背景：
- `openspec/overview.md`：无（exception 变量契约是模块内部行为，不影响系统级背景）。

设计视图：
- `openspec/designs/architecture/workflow-execution-and-routing.md`：修改，补充 exception 失败变量的框架/业务透传边界和 category 收敛理由。
- `openspec/designs/modules/agent-workflow.md`：修改，补充 `mapSafeErrorToVariables` 的字段语义和 `code`/`message` 透传规则。
- `openspec/designs/adr/workflow-exception-category-collapse.md`：新增 ADR，记录"category 枚举收敛为 TIMEOUT 单值、业务 code/message 透传优先"的取舍理由。
- `openspec/designs/spec-to-design-map.md`：修改，新增 workflow-execution-engine exception 契约到 architecture/module/adr 的导航。

验证入口：
- `packages/agent-workflow/tests/workflow-execution-engine.test.ts`：exception 条件路由按新字段断言。
- `packages/agent-workflow/tests/workflow-capability-nodes.test.ts`：RESTful 业务失败 code/message 透传断言。
- contract test：`error` shape 契约测试。
- contract test：`error` shape 契约测试。
