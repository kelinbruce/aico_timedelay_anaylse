## 背景与问题（Why）

当前 Cron task 管理路径已经具备 durable task、scheduler/callback delivery、runtime submit 和 agent-web 看板。Cron task 的执行内容仍只有 `prompt` 字符串；如果用户希望定时触发指定 Skill 或 Workflow，唯一可行方式是在 `prompt` 中手写 `$skill:<name>` 或 `$workflow:<name>` 指令。

这种做法能复用现有路由，但产品层存在三个问题：

- 管理 API 和 agent-web 无法结构化展示“该定时任务绑定了哪个能力”，只能把目标混在任务文本里。
- 创建和编辑时无法用 schema 校验 target kind/name，也无法在 UI 中按普通任务、Skill、Workflow 三种执行目标稳定回填。
- Cron delivery 无法把定时任务的目标作为 trusted management fact 传给 runtime，只能依赖 prompt parser。

本 change 处理 Cron task 管理面的显式目标绑定。`CronTaskTarget` 指 Cron task 可选的结构化执行目标，取值为恰好一个 `{ kind: "SKILL" | "WORKFLOW"; name: string }`。未配置 `CronTaskTarget` 的 task 继续按当前行为提交 `prompt`；配置后，Cron delivery 把目标转换为 runtime 已有 `routingConstraints.targetSkill` 或 `routingConstraints.targetRecipe`，并仍通过标准 request lifecycle 执行。

本 change 不改变普通 chat submit 的公共 Web 请求边界；agent-web 普通对话请求仍不得直接携带 `targetSkill` 或 `targetRecipe`。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- Cron task management API 支持可选 `target` 字段，能创建、更新、查询 Skill 或 Workflow 显式绑定。
- Cron task durable fact 持久化 `target_kind` 和 `target_name`；旧 task 和未配置 target 的新 task 表现与当前一致。
- Cron trigger delivery 在 task 配置 target 时，向 runtime submit 传递对应 routing constraint；执行仍进入 runtime/core/capability 的既有治理路径。
- agent-web Cron task dashboard 能展示、创建和编辑普通任务、Skill 任务、Workflow 任务三种目标形态。
- target 输入必须按 safe identifier 校验，且不得携带 owner、agent、session、run、prompt override 或 capability 参数。

**非目标：**

- 不为普通 chat submit、edit 或 retry Web API 新增 `targetSkill` 或 `targetRecipe` 公共字段。
- 不新增 Workflow catalog API；agent-web 首版可用文本输入配置 Workflow name。
- 不改变 Skill/Workflow 的实际治理、可见性、授权、budget、deadline、cancellation 或失败语义。
- 不新增 Cron pause/resume、批量管理、能力参数模板、inputVariables 绑定或执行结果跳转策略。
- 不改变 `Cron` Tool 的模型可见 schema；Tool 创建的 task 默认不配置 `CronTaskTarget`，除非后续 change 明确扩展 Tool contract。

## 变更范围（What Changes）

- 修改 Cron task management API：`GET/POST/PUT /api/v1/cron-tasks` 的 public task DTO 和 create/update body 支持可选 `target`。
- 修改 channel-facing Cron task management port：create/update command 和 task view 支持可选 `CronTaskTarget`。
- 修改 gateway Cron task record 和 SQLite mapping：增加 nullable `targetKind` / `targetName` 领域字段，并在 SQLite 中映射为 `target_kind` / `target_name`。
- 修改 Cron trigger delivery：当 task target 为 `SKILL` 时传 `routingConstraints.targetSkill`；当 task target 为 `WORKFLOW` 时传 `routingConstraints.targetRecipe`；target 缺失时不传目标 routing constraints。
- 修改 agent-web Cron task dashboard：任务卡片展示目标 badge，创建/编辑表单支持选择普通、Skill、Workflow，并按现有 REST API 保存结构化 target。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `cron-task-management-api`: Cron task 管理 API surface、input validation、trusted scope 和 durable scheduling semantics 增加可选结构化 target。
- `agent-web-cron-task-dashboard`: Cron task dashboard 的列表、创建和编辑行为展示并管理可选结构化 target。

## 影响范围（Impact）

- `agent-contracts/channel`：Cron task management view/command 类型增加可选 target。
- `agent-contracts/gateway`：Cron task record 类型增加可选 target 字段。
- `agent-platform-gateway-local`：SQLite schema/migration、row mapping、create/update/list/load tests 受影响。
- `agent-app`：Cron task management service validation/projection 和 Cron trigger delivery submit command 受影响。
- `agent-channel-web`：Cron task management TypeBox schema、route body allow-list 和 response projection 受影响。
- `frontend/agent-web`：Cron task service 类型、dashboard 表单、卡片展示、i18n、component/service tests 受影响。
- 验证需要覆盖后端 contract/gateway/app/channel、前端 component/service 和 OpenSpec strict validation。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/cron-task-management-api/spec.md`：归档 Cron task target 的 API、validation、scope 和 delivery 语义。
- `openspec/specs/agent-web-cron-task-dashboard/spec.md`：归档 dashboard target 展示和编辑行为。
- `openspec/overview.md`：补充 Cron task 可作为普通 prompt、Skill 或 Workflow 定时执行入口。
- `openspec/designs/architecture/cron-task-execution.md`：补充 target fact 从 management API 到 runtime routing constraints 的跨模块流程。
- `openspec/designs/modules/agent-channel-web.md`：补充 Cron task management target DTO 和普通 chat submit target 禁入边界。
- `openspec/designs/modules/agent-app.md`：补充 Cron management service target validation/projection 与 delivery routing constraint mapping。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充 Cron task SQLite target mapping。
- `openspec/designs/modules/agent-web.md`：补充 dashboard target selector/badge 行为。
- `openspec/designs/adr/`：无。
- `openspec/designs/features/`：无。
- `openspec/designs/functions/`：无。
- `openspec/designs/spec-to-design-map.md`：增加上述 specs 到 architecture/modules/验证入口的导航。
