## 当前实现基线（Current Baseline）

当前 Cron task 后端路径由四段组成：

- `agent-contracts/gateway.CronTaskRecord` 只包含 owner scope、`agentId`、`taskId`、`cron`、`prompt`、`recurring`、`status`、`nextRunAt`、`version`、`createdAt` 和 `updatedAt`。
- `agent-platform-gateway-local` 用 SQLite `cron_tasks` 和 `cron_triggers` 持久化 task/trigger，并已有旧 schema migration，把历史 `session_id` task 迁移到 owner + agent scoped task。
- `agent-app` 的 Cron management service 负责 create/update/list/delete/run-now。create/update 只接受 `cron`、`prompt`、`recurring`，并投影为 channel-facing public task view。
- `agent-app` 的 Cron trigger delivery 在 trigger 被 claim 后创建或复用 Cron execution session，并调用 runtime submit：`inputText` 使用 `task.prompt`，`attachmentIds` 为空，`priority` 为 `LOW`，当前不传 `routingConstraints`。

当前 agent-web 已有 `/cron-tasks` route、sidebar 入口、`cronTaskService` 和 `CronTaskDashboardPage`。前端 task DTO 也只有 `cron`、`prompt`、`recurring`、`status`、时间字段和创建人字段。卡片直接显示 `prompt`；表单直接编辑 `prompt`。

当前 Workflow/Skill 定向能力在 runtime/core 中已经存在：runtime submit command 支持 `routingConstraints.targetSkill` 和 `routingConstraints.targetRecipe`；agent-core routing 会在 accepted Agent scope 下治理并解析这些目标。普通 agent-web chat submit 的目标类字段禁入规则来自 directive routing change；该规则不允许普通对话请求直接携带 `targetSkill` 或 `targetRecipe`。

当前 gap 是 Cron task 管理面没有 durable target fact。产品上只能用 prompt 指令表达 target，导致 API/agent-web 不能结构化展示、校验、编辑和持久化 Skill/Workflow 绑定。

## 目标设计（Proposed Design）

唯一实现路径是：Cron management API 接收可选 `CronTaskTarget`，app service 校验并写入 Cron task durable fact，gateway-local 持久化该 fact，查询时投影回 public DTO；trigger delivery 在服务端把 durable target 映射到 runtime submit 的既有 routing constraints。agent-web 只消费/提交 Cron management API 的 `target` 字段，不拼接 prompt 指令，不调用 runtime，也不拥有 routing 语义。

### 1. `CronTaskTarget` 作为 Cron management 专属结构

新增 app/channel/gateway 共享语义：

```ts
type CronTaskTarget =
  | { kind: "SKILL"; name: string }
  | { kind: "WORKFLOW"; name: string };
```

该结构只表示 Cron task 的执行目标，不表示 owner scope、Agent scope、capability 参数或 runtime command。`name` 使用 runtime routing constraint safe id 的同等字符约束。`target` 在 create 中缺失表示 prompt-only；在 update 中缺失表示不修改既有 target；在 update 中显式为 `null` 表示清除 target。

### 2. Contract 和 schema 边界

`agent-contracts/channel` 增加 channel-facing `CronTaskTargetView`，并在 `CronTaskManagementView`、`CreateCronTaskManagementCommand`、`UpdateCronTaskManagementCommand` 中使用可选 target。为了表达 update 的三态语义，`UpdateCronTaskManagementCommand.target` 允许 `CronTaskTargetView | null | undefined`：

- `undefined`：本次 update 不修改 target。
- `null`：清除 target。
- object：设置 target。

`agent-channel-web` 的 TypeBox schema 对 create/update body 做边界校验。create body 允许 `target` 缺失或 object；update body 允许 `target` 为 object 或 null，并继续要求至少一个可修改字段存在。route 的 body allow-list 增加 `target`，但继续拒绝 `routingConstraints`、`targetSkill`、`targetRecipe`、scope 和 persistence 字段。

普通 chat submit/request/edit schema 不在本 change 中修改，仍按既有规则处理 target 类 routing constraints。

### 3. Gateway record 和 SQLite mapping

`agent-contracts/gateway.CronTaskRecord` 增加可选 `targetKind?: "SKILL" | "WORKFLOW"` 和 `targetName?: string`。gateway record 使用两个标量字段而不是嵌套 DTO，便于 SQLite row 映射并保持 Record 只作为 gateway port 入参/返回值。

SQLite `cron_tasks` 增加 nullable `target_kind` 和 `target_name`：

| Record 字段 | SQLite column | 约束 |
|---|---|---|
| `targetKind` | `target_kind` | null 或 `SKILL`/`WORKFLOW` |
| `targetName` | `target_name` | target_kind 为 null 时必须为 null；target_kind 非 null 时必须非空 |

gateway-local schema migration 对既有库执行 additive migration：新增两个 nullable column，历史 row 自动成为 prompt-only task。旧 session-scoped schema migration 在重建 table 时也创建新列，并把旧 row 的 target 保持为 null。

### 4. App service validation 和 projection

Cron management service 是 target 的业务 validation owner：

- normalize create/update input target。
- 校验 kind/name。
- 当目标状态下 task 同时具有结构化 target 和 prompt 中的有效 `$skill:` / `$workflow:` directive 时拒绝写入，避免 runtime accepted text directive 与 routing constraints 形成双目标。
- 将 channel target 投影为 gateway `targetKind`/`targetName`。
- 将 gateway record 投影回 public `target` DTO。

create 时如果 target 缺失，record 不带 target fields。update 时在 existing record 基础上应用三态 target 语义：`undefined` 保持、`null` 清除、object 替换。cron 变化仍按既有逻辑重算 `nextRunAt`；target 变化不改变 `nextRunAt`，不修改已 accepted trigger/run。

### 5. Delivery 到 runtime routing constraints 的映射

Cron trigger delivery 在调用 runtime submit 前从 `CronTaskRecord` 读取 target fields，并构造 routing constraints：

| Cron task target | runtime submit routingConstraints |
|---|---|
| no target | omitted |
| `SKILL:name` | `{ targetSkill: name }` |
| `WORKFLOW:name` | `{ targetRecipe: name }` |

delivery 不解析 prompt 指令，也不把 target 拼到 prompt。target 只影响 routing constraint，prompt 仍作为 `inputText` 进入 accepted request text。runtime/core 继续负责 target availability、capability kind、forbidden constraints、budget、deadline、cancellation 和失败/降级行为。

如果持久化数据出现不完整 target fields，gateway-local 必须在 row-to-record 或 service validation 边界失败关闭，不把半结构 target 当成 prompt-only 静默执行。

### 6. agent-web 表达

`frontend/agent-web` 的 `CronTaskView`、create/update request 类型增加 `target`。Dashboard draft 增加 `targetMode: "NONE" | "SKILL" | "WORKFLOW"` 和 `targetName`。

表单行为：

- 新建默认 `NONE`。
- 编辑时从 API response `target` 初始化 mode/name。
- `NONE` 保存 create 时不发 target，保存 update 且原 task 有 target 时发 `target: null`。
- `SKILL`/`WORKFLOW` 保存时发结构化 target；不改写 prompt。

Skill 选择首版可复用现有 skill catalog 查询能力作为下拉/搜索输入；Workflow 因本 change 不新增 catalog API，首版使用安全文本输入 recipe name。卡片 header 或 content 上方展示 target badge；badge 数据只来自 API response `target`，不从 prompt 反向推断。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证方向 |
|---|---|---|
| 安全 | target 不携带 scope、credential、provider、参数或 prompt override；Web schema 和 route allow-list 拒绝 targetSkill/targetRecipe/routingConstraints；delivery 只在服务端 trusted boundary 映射 routing constraints。 | channel route negative tests、app service tests、code review |
| 性能/容量 | target 是两个小标量列和一个小 DTO，不改变 due scan 批量策略，不新增 catalog 强依赖；agent-web Skill catalog 只在表单选择时加载。 | gateway list/update tests、frontend component tests |
| 可靠性/恢复 | target 是 durable task fact，create/update 返回前已提交；历史 row target 为 null 保持兼容；update target 不影响已 accepted trigger/run。 | SQLite migration/restart tests、delivery integration tests |
| 可维护性 | channel DTO、gateway Record、SQLite row、frontend DTO 分层映射；不新增平行 routing contract，不让 frontend 拥有 runtime routing。 | architecture lint、semantic review |
| 可测试性 | target validation、projection、migration、delivery mapping 和 UI save body 都可用 deterministic unit/contract/component tests 覆盖。 | focused backend/frontend tests |
| 审计/可追溯性 | 本 change 不新增审计事件；durable task fact 和 trigger/run binding 能追溯 target 配置与执行。日志/trace 不记录 prompt 或模型输出。 | code review、existing observability redaction checks |

## 验证策略（Verification Strategy）

后端行为验证分四层：

- contract/unit：验证 channel/gateway 类型、safe-id validation、create/update target 三态语义和 public DTO projection。
- SQLite gateway：验证新列 schema、历史 row target null、target 持久化、restart 后 query、update/clear target 和 list/load mapping。
- app integration：验证 Cron management service create/update/list/run-now 与 delivery 映射；重点断言 runtime submit 收到正确 routing constraints，不断言 private implementation shape。
- channel route：验证 create/update/list response schema、invalid target、unknown fields、scope smuggling、routingConstraints/targetSkill/targetRecipe 禁入。

前端验证分三层：

- service tests：验证 create/update body 按 target mode 发送结构化 target 或 null，run-now 不发送 body。
- component tests：验证卡片 badge、form 初始化、Skill/Workflow/None 保存、空 target name 阻止提交。
- build/typecheck：验证 TypeScript strict 下 DTO 和 UI 状态收敛。

OpenSpec 验证使用 per-change strict validation，并在落地后纳入 repo-wide strict validation。

## 风险与取舍（Risks / Trade-offs）

- Workflow 没有 catalog API：首版使用文本输入 recipe name，执行时仍由 core 按 accepted Agent scope 治理；后续如需下拉选择，应单独新增 recipe catalog contract。
- prompt 中仍可能含普通 `$` 字符：本 change 只拒绝与结构化 target 同时存在的有效 `$skill:` / `$workflow:` directive，不禁止普通文本中的 `$`。未配置 target 的历史 directive prompt 继续按当前 prompt-only 行为进入 runtime。
- SQLite 半迁移风险：新增 nullable column 是低风险 additive migration；row-to-record 仍需 fail closed 处理不完整 target pair，避免误执行。

## 迁移与回滚（Migration / Rollback）

迁移前提是本地 SQLite Cron schema 可由 gateway-local startup migration 管理。升级时 gateway-local 对 `cron_tasks` 增加 nullable `target_kind` 和 `target_name`。历史 task target 为 null，保持 prompt-only 行为。

回滚到旧代码后，旧代码可能无法识别新增列但会继续读取旧字段；如果回滚代码使用 `SELECT *` 后按已知列投影，新增列不会影响读取。回滚后的系统不会使用已配置 target，绑定 task 会退回 prompt-only 行为；发布说明需要提示回滚会暂时丢失显式 target 执行效果但不删除 target 数据。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-10.9-Cron工具` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/agent-web-cron-task-dashboard/spec.md`、`openspec/specs/cron-task-management-api/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
