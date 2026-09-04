## add-ts-workflow-interaction-nodes

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：P3 — Workflow 执行范式

状态：candidate
类型：实施 change
主要 owner：`agent-workflow`
依赖：`add-ts-workflow-execution-engine`、`add-ts-human-pending-input-core`

目标：
- 实现用户交互和高级流控节点：`user-check`、`display-content`、`guardrail_check`、`delay-gateway`、`interrupt-gateway`、`sub-recipe`。
- 本 change 定义交互节点私有配置和私有输出语义，但不反向扩大 workflow 最小 contract。

规格输入：

节点私有约束：

- workflow 最小 contract 只冻结节点共用字段；本 change 承接 interaction 节点私有配置、输出解释和运行时校验。
- 本 change 可以在节点私有 schema 中使用 `nodeConfig`、`structuredPayload` 等命名，但这些命名不得被提升为 workflow 最小 contract 的公共字段。
- 若需要新增跨节点共享的稳定交互 workflow 字段，必须先提出 contract refinement change。

**user-check**

- 暂停 workflow 执行，向用户展示选项列表并等待选择。
- `nodeConfig`：`question`（展示文本）、`options`（选项列表，每项含 `label` + `value`）、`timeoutMs?`。
- 等待用户回答后输出 `selectedOption`，继续下游。
- 超时走 `onError`（默认 `FAIL`）。
- 用户回答通过 runtime pending input boundary 传递，复用 `PendingInputStoreGateway` 三对象契约。

**display-content**

- 向用户渲染文本内容，不等待交互，直接通过。
- `nodeConfig`：`content`（safe text/markdown）。
- 内容通过 stream projection 输出至客户端。

**guardrail_check**

- 输入 `content`，按安全护栏规则检查合规性。
- `nodeConfig`：`policyId`（引用 policy hook 配置）。
- 输出：`result`（`pass` | `block`）+ `reason`（safe summary）。
- `block` 时走 `onError`（默认 `FAIL`）。

**delay-gateway**

- 等待指定时长后通过。
- `nodeConfig`：`durationSeconds`（可引用上游变量）。
- 等待期间可被 `AbortSignal` 中断。

**interrupt-gateway**

- 暂停 workflow，等待外部 resume 信号。
- 与 `user-check` 的区别：不主动向用户展示选项，由外部 API/resume command 触发继续。
- 复用 runtime pending input boundary，pending 类型为 `WORKFLOW_INTERRUPT`。

**sub-recipe**

- 加载并执行子 recipe，形成嵌套 workflow。
- `nodeConfig`：`recipeId`（可引用上游 `recipe-choice` 的输出 `selectedRecipeId`）。
- input/output 通过 `nodeConfig.inputMapping` 和 `nodeConfig.outputMapping` 显式传递。
- 子 recipe 内部递归调用 `WorkflowExecutionService.execute`。
- 最大嵌套深度硬限制 3 层，超出返回 `SAFE_ERROR`。
- 子 recipe 优先级继承父 recipe。

实现约束：
- `user-check` 和 `interrupt-gateway` 复用 `PendingInputStoreGateway` 和 runtime pending input boundary，不新建 pending 管理路径。
- `display-content` 的内容只允许 safe text/markdown，不得包含可执行脚本或 raw HTML。
- `guardrail_check` 通过 `nodeConfig.policyId` 引用 policy hook，由 runtime lifecycle hook 机制执行。
- `sub-recipe` 的嵌套执行上下文持有独立的 `cancellation context`（从父 signal derive）。
- `sub-recipe` 的 agent scope 和 owner scope 继承父 recipe。
- 本 change 不得把 interaction 节点私有配置或输出字段回写成 workflow 最小 contract 的公共字段。
- 本 change 只拥有 `interrupt-gateway` 和 `sub-recipe` 的节点行为与私有配置边界，不拥有恢复/继续执行协议、loop 语义或 distributed execution 语义。
- `interrupt-gateway` 只定义节点行为，不拥有恢复协议；恢复协议后置到 `add-ts-workflow-persistence-recovery`。
- `sub-recipe` 只定义嵌套 recipe 调用，不拥有 loop、distributed execution 或高级恢复语义。

非目标：
- `display-content` 不支持交互式 UI 组件或 streaming 增量更新。
- `interrupt-gateway` 不支持带超时的自动恢复（超时视为外部未响应，recipe 挂起）。
- `sub-recipe` 不支持跨 recipe 隐式变量共享（仅通过显式 `inputMapping/outputMapping`）。
- `guardrail_check` 不实现自定义规则 DSL。

验收要点：
- integration test：`user-check` 暂停 → 用户回答 → 继续执行，`selectedOption` 正确。
- integration test：`user-check` 超时走 `onError`。
- integration test：`display-content` 内容通过 stream 输出至客户端。
- integration test：`guardrail_check` 检测到违规内容返回 `block` + reason。
- integration test：`delay-gateway` 等待指定时长后继续下游节点。
- integration test：`interrupt-gateway` pause → external resume → 继续。
- integration test：`sub-recipe` 嵌套 3 层正常执行完成；第 4 层返回 `SAFE_ERROR`。

并行边界：
- 只注册新的节点类型 handler。
- 通过 port 复用 runtime pending input boundary，不修改 `agent-runtime` 实现。
- 节点私有 schema owner 在本 change，不在 `add-ts-workflow-engine-contracts`。
