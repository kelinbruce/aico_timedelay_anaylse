[返回 Roadmap V2](../nextagent-ts-change-roadmap-v2.md)

## P2 — 正式版

堵塞修复、Bug 修复、平台对接支持。

### 策略与治理（从 P1 移入）

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-gateway-configuration`](../nextagent-ts-changes/add-ts-gateway-configuration.md) | complete | 支持 local/remote gateway adapter 选择和配置校验，配置覆盖 endpoint/baseUrl、credential reference、timeout/retry 和安全校验。 | [详情](../nextagent-ts-changes/add-ts-gateway-configuration.md) |
| [`complete-ts-lifecycle-hook-capabilities`](../nextagent-ts-changes/complete-ts-lifecycle-hook-capabilities.md) | complete | 在首版 lifecycle hook 基线上补齐完整 hook 能力：9 个 stage 一致支持、`OBSERVE` / `TRANSFORM` / `CONTROL` effects 集合、startup-only `configure(config)`、`maxHooksPerStage` stage 总数上限、SYSTEM 分组优先、system 显式 order、custom 默认声明顺序与绝对/相对 order、`PASS` / `SKIP` / `DENY` / `BLOCK` / `PEND` outcome、observe-only 并行有界执行、impact hook 串行归约、stage-specific mutation 和 `SYSTEM` hook fail-closed 校验；依赖 `refine-ts-pending-input-contracts` 的 frozen contract。 | [归档](../../openspec/changes/archive/2026-06-29-complete-ts-lifecycle-hook-capabilities) |
| [`add-ts-agent-scoped-plugin-composition`](../nextagent-ts-changes/add-ts-agent-scoped-plugin-composition.md) | blocked | 依赖 `complete-ts-lifecycle-hook-capabilities` 归档后解除阻塞。支持智能体开发者在启动前准备本地插件目录，目录内以 `plugin.json` 指向 ESM bundle，并可通过 host externals 白名单复用宿主工具库；由 `agent-app` 按 system config 显式清单启动期加载，并通过 Agent 配置激活 Tool、开放白名单 Policy，并向 startup hook registry 贡献 `LifecycleHook` object；插件贡献只在激活的 Agent 中生效，Tool 仍进入 capability discovery/catalog 主路径。 | [详情](../nextagent-ts-changes/add-ts-agent-scoped-plugin-composition.md) |

### Answer Feedback

> `add-ts-answer-feedback` 已归档，能力并入 [`2026-06-27-add-ts-conversation-annotation`](../../openspec/changes/archive/2026-06-27-add-ts-conversation-annotation/proposal.md)。原 1-5 星评分语义被点赞/点踩/收藏的轻量标注模型替代，持久化端口由 `FeedbackStoreGateway` 改为 `ConversationAnnotationStoreGateway`，领域对象 `Feedback` 替换为 `ConversationAnnotationRecord`。详见归档 proposal。

### 任务工具

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-task-tools`](../nextagent-ts-changes/add-ts-task-tools.md) | active | 新增 TaskCreate/TaskGet/TaskList/TaskUpdate/TaskComplete 工具族，统一任务管理 schema 与工具安全契约。 | [详情](../nextagent-ts-changes/add-ts-task-tools.md) |

### 周期性智能体任务

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-recurring-agent-tasks`](../nextagent-ts-changes/add-ts-recurring-agent-tasks.md) | candidate | 支持用户级智能体任务按周期自动运行：用户可通过自然语言指令创建周期性任务，可将历史对话中的成功任务固化为周期性任务模板，并可查看、暂停、恢复、修改、删除和手动触发周期性任务；到期触发必须进入普通 request/run 生命周期。 | [详情](../nextagent-ts-changes/add-ts-recurring-agent-tasks.md) |

### Workflow 引擎

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-workflow-package-composition`](../nextagent-ts-changes/add-ts-workflow-package-composition.md) | candidate | 创建 `agent-workflow` package、app composition wiring，并在启动期加载本地 recipe 文件到内存 `RecipeRegistry`。 | [详情](../nextagent-ts-changes/add-ts-workflow-package-composition.md) |
| [`add-ts-workflow-execution-engine`](../nextagent-ts-changes/add-ts-workflow-execution-engine.md) | candidate | 实现单实例、内存态、最小 workflow execution engine：顺序执行、条件分支、单进程 `parallel-gateway`、timeout/retry 和 `AbortSignal` 中断。 | [详情](../nextagent-ts-changes/add-ts-workflow-execution-engine.md) |
| [`add-ts-workflow-routing`](../nextagent-ts-changes/add-ts-workflow-routing.md) | candidate | agent-core 扩展 workflow routing：显式 `recipeName` / 可选轻量意图匹配命中则进入 workflow，否则降级 conversation loop。 | [详情](../nextagent-ts-changes/add-ts-workflow-routing.md) |
| [`add-ts-workflow-parallel-gateway`](../nextagent-ts-changes/add-ts-workflow-parallel-gateway.md) | active | 独立承接 `parallel-gateway` 的 fork / join 行为边界、safe diagnostic 和后续 waiting branch / budget / recovery 的 owner 边界；从 `add-ts-workflow-gateway-nodes` 拆分以保持基础 gateway 节点简洁；本地代码暂不实现。 | [详情](../nextagent-ts-changes/add-ts-workflow-parallel-gateway.md) |

### Workflow 节点实现

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-workflow-gateway-nodes`](../nextagent-ts-changes/add-ts-workflow-gateway-nodes.md) | candidate | 作为 gateway 节点私有 schema 与 handler owner，承接 `start-event`、`end-event`、`exclusive-gateway` 三类基础节点语义；`parallel-gateway` 由 `add-ts-workflow-parallel-gateway` 独立承载。 | [详情](../nextagent-ts-changes/add-ts-workflow-gateway-nodes.md) |
| [`add-ts-workflow-llm-nodes`](../nextagent-ts-changes/add-ts-workflow-llm-nodes.md) | candidate | 作为 LLM 节点私有 schema 与 handler owner，承接 `llm-router`、`intent-recognition`、`question-writing`、`translate`、`data-analysis`、`param-extract`。 | [详情](../nextagent-ts-changes/add-ts-workflow-llm-nodes.md) |
| [`add-ts-workflow-capability-nodes`](../nextagent-ts-changes/add-ts-workflow-capability-nodes.md) | candidate | 作为 capability 节点私有 schema 与 handler owner，承接 `tool`、`tool-choice`、`restful`、`python`、`agent`。 | [详情](../nextagent-ts-changes/add-ts-workflow-capability-nodes.md) |
| [`add-ts-workflow-knowledge-nodes`](../nextagent-ts-changes/add-ts-workflow-knowledge-nodes.md) | candidate | 作为 knowledge 节点私有 schema 与 handler owner，承接 `knowledge-search`、`knowledge-qa`、`api-choice`、`recipe-choice`。 | [详情](../nextagent-ts-changes/add-ts-workflow-knowledge-nodes.md) |
| [`add-ts-workflow-interaction-nodes`](../nextagent-ts-changes/add-ts-workflow-interaction-nodes.md) | candidate | 作为 interaction 节点私有 schema 与 handler owner，承接 `user-check`、`display-content`、`guardrail_check`、`delay-gateway`、`interrupt-gateway`、`sub-recipe`。 | [详情](../nextagent-ts-changes/add-ts-workflow-interaction-nodes.md) |
