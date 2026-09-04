## 背景和现状（Context）

当前 Cron 产品路径已经具备四层能力：

- `agent-capability` 暴露单一 `Cron` Tool，支持 `action=create|list|delete`。
- `agent-contracts/gateway` 定义 `CronTaskGatewayPort`，`agent-platform-gateway-local` 用 SQLite `cron_tasks` / `cron_triggers` 表持久化 task 和 trigger。
- `agent-platform-gateway-local` 的 local scheduler 扫描 due task 并 claim trigger；remote 部署通过 callback delivery。
- `agent-app` 组合 Cron capability、scheduler/callback 和 runtime submit，使到期 trigger 进入标准 request lifecycle。

当前缺口是 Web channel 没有 Cron task 管理 REST route。UCD 中的 `/api/v1/cron-tasks` 和管理面板只是期望态，不是实现事实。本 change 只补后端 REST 管理接口，不做前端管理面板。

相关方：

- `agent-channel-web`：拥有 public REST schema、safe error 和 DTO projection。
- `agent-contracts/channel`：承载 channel-facing 管理 port，避免 Web channel 直接依赖 gateway record。
- `agent-app`：组合 Cron management service，绑定 trusted owner/active agent、gateway 和 validation；Cron trigger delivery 在执行时创建或复用服务端 execution session。
- `agent-contracts/gateway`：补齐 Cron task agent-scope 查询和 update 写入能力。
- `agent-platform-gateway-local` / remote gateway：实现新的 Cron gateway 方法。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 提供 `GET/POST/PUT/DELETE /api/v1/cron-tasks` 管理 API。
- API 只使用 trusted owner scope 和 trusted active agent scope，不接受客户端覆盖。
- create/update/delete 复用既有 durable Cron gateway；create/update 返回前必须已提交。
- query 能看到当前 owner + active Agent 下所有非删除 Cron task，包括 Tool 创建和 REST 创建的 task。
- task 查询不暴露 gateway record、session/run/trigger、version 或 SQLite detail。
- execution 查询可查看指定 task 的 trigger 执行记录、绑定 run 状态和 terminal result content。
- 所有接口都有 TypeBox request/response schema、safe error 和 API 文档。

**非目标：**

- 不实现 Cron 管理面板、前端 `cron` safeResult 渲染或 UI badge。
- 不新增 pause/resume、手动立即执行、批量删除或 execution 分页游标。
- 不把 `sessionId` 暴露为管理 API 入参。
- 不改变 `Cron` Tool 的模型可见输入输出。
- 不把 Web channel 变成 gateway owner 或 runtime lifecycle owner。

## 设计决策（Decisions）

### 1. Web channel 消费 channel-facing `CronTaskManagementPort`

新增 `agent-contracts/channel` port：

- `listCronTasks(scope, signal?)`
- `listCronTaskExecutions(query, signal?)`
- `createCronTask(command, signal?)`
- `updateCronTask(command, signal?)`
- `deleteCronTask(command, signal?)`

scope 包含 `identityContext` 和 `agentId`，由 Web route 注入；command 只包含经过 schema 校验的 cron/prompt/recurring/taskId。task port 返回 `CronTaskManagementPage`，包含 `tasks`、`total`；其中 task item 为 public-safe task view：`taskId`、`cron`、`humanSchedule`、`prompt`、`recurring`、`status`、`createdAt`、`updatedAt`、`nextRunAt`。execution port 返回 `CronTaskExecutionPage`，包含 `executions`、`total`；其中 execution item 为 public-safe execution read model：`triggerId`、`taskId`、`scheduledAt`、`triggerStatus`、`sessionId`、`requestRunId`、`runStatus`、`terminalCommitState`、`resultEventType`、`resultContent`、`resultAt`。`GET /api/v1/cron-tasks` 与 `GET /runs` 均支持 `offset` 与 `limit` 分页，`limit` 默认 50 且最大 50，但 response 不回显分页参数。

选择这个方案的原因：

- Web channel 已有 `BackgroundTaskViewPort` 和 `LongTermMemoryManagementPort` 模式，channel-facing port 是当前代码风格。
- Web channel 不需要也不应该 import gateway `CronTaskRecord`。
- 端口让 local/remote Cron gateway 差异停留在 app/gateway 层。

放弃方案：

- Web route 直接调用 `CronTaskGatewayPort`：会把 gateway record 和 session-scope 细节泄漏到 channel。
- 复用 `Cron` Tool 执行 REST 管理：会绕模型/capability lifecycle，且 update 不是现有 Tool action。

### 2. Gateway contract 补齐 agent-scope 管理查询和 record update

当前 gateway 原先按 owner + agent + session list/load/delete。UI/REST 直接创建 Cron task 没有自然 session，因此本 change 将 Cron task 管理归属收敛到 owner + agent，并在 `CronTaskGatewayPort` 增加/调整：

- `listTasksForAgent({ tenantId, subjectId, agentId, includeDeleted?, offset?, limit? })`
- `countTasksForAgent({ tenantId, subjectId, agentId, includeDeleted? })`
- `loadTaskForAgent({ tenantId, subjectId, agentId, taskId })`
- `listTriggersForTask({ tenantId, subjectId, agentId, taskId, offset?, limit? })`
- `countTriggersForTask({ tenantId, subjectId, agentId, taskId })`
- `updateTask(record, options?, signal?)`

`updateTask` 使用 `CronTaskRecord + write options`，符合现有 gateway 写入原则；`expectedVersion` 仍在 options 中，不进入 record。更新只允许服务层在 load 后构造完整目标 record，保留 owner、agent、createdAt 和 taskId，修改 cron/prompt/recurring/nextRunAt/updatedAt/version。

同一 owner + agent 下的 `taskId` 是唯一持久化坐标；管理 API 不按 session 分桶，也不需要跨 session 歧义处理。

`listTriggersForTask` 只按 trusted owner + agent + taskId 返回 trigger fact。Web channel 不直接消费该 gateway 方法；`agent-app` management service 先用 `loadTaskForAgent` 确认 task 在当前 scope 下存在，再组合 trigger、`RequestRunStoreGateway.loadRun` 和 `RunTimelineEventStoreGateway.listEvents` 形成 execution read model。

### 3. Cron task 不绑定创建 session

REST/UI create 没有自然会话路径，因此 Cron task record 不携带 `sessionId`，也不把任意 UI session 作为 task 归属。Cron task 的 durable owner 是 `tenantId + subjectId + agentId + taskId`。

到期 trigger 进入 runtime lifecycle 时，delivery 层通过 `RuntimeCommandPort.createSession` 使用服务端 idempotency key `cron-execution:<taskId>` 创建或复用 execution session，再调用标准 runtime `submit`。trigger fact 可记录 accepted run 的 execution `sessionId`，但该 session 不参与 task 管理查询、更新、删除或唯一性。

选择这个方案的原因：

- UI/REST 可以直接创建 Cron task，无需先创建 chat session。
- Cron task 管理边界与用户/Agent 绑定，不被某个临时会话生命周期牵连。
- 到期 trigger 仍通过现有 runtime submit 进入标准 request lifecycle，session 只作为执行承载。

放弃方案：

- API body 接收 `sessionId`：违反本 change 的 scope 约束。
- 复用创建请求所在 UI session：会让全局可管理的定时任务被某次对话生命周期污染，且 UI 直接创建时可能没有 session。

### 4. Update 只修改 active task 的可调度字段

`PUT /api/v1/cron-tasks/:taskId` 只接受 `cron`、`prompt`、`recurring` 中至少一个字段。服务层先按 owner + agent + taskId load 非删除 task；若 task status 不是 `ACTIVE`，返回 409 `CRON_TASK_NOT_ACTIVE`。cron 变化时用既有 `nextCronRunMs` 重新计算 `nextRunAt`；无未来匹配返回 400 `CRON_NO_FUTURE_MATCH`。成功更新保留 task id 和 scope，不影响已 accepted trigger/run。

### 5. Route shape 和错误码

新增 schema 文件 `agent-channel-web/src/schemas/cron-task-management.ts`，并在 `api-contract.ts` 导出公共响应 schema和 endpoint inventory。route 挂在 `registerWebChannel` 中：

- `GET /api/v1/cron-tasks` -> `{ tasks: CronTaskManagementDto[], total: number }`
- `POST /api/v1/cron-tasks` -> `200 CronTaskManagementDto`
- `PUT /api/v1/cron-tasks/:taskId` -> `200 CronTaskManagementDto`
- `GET /api/v1/cron-tasks/:taskId/runs` -> `{ executions: CronTaskExecutionDto[], total: number }`
- `DELETE /api/v1/cron-tasks/:taskId` -> `204`

缺少 management port 返回 503 `CRON_TASKS_UNAVAILABLE`。not found 返回 404 `CRON_TASK_NOT_FOUND`。非法输入使用 400 `REQUEST_VALIDATION_FAILED` 或具体 Cron validation code。inactive update 返回 409 `CRON_TASK_NOT_ACTIVE`。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | Owner scope 来自 identity resolver，agent scope 来自 `defaultAgentId`；schema 禁止 tenant/subject/agent/session/run/status/version/trigger 字段；Web DTO 不暴露 gateway/session/run/trigger/version | route negative tests、schema tests、code review |
| 性能/容量 | list 首版固定默认 limit 100，并在 gateway query 使用 owner+agent index；不做分页 UI，避免一次返回无限集合 | SQLite gateway list tests、route response tests |
| 可靠性/恢复 | create/update/delete 返回前 durable commit；task 按 owner+agent 持久化；trigger delivery 使用服务端 execution session idempotency anchor；update CAS 防止覆盖并发更新；delete 后 due scan 不再选择 task | gateway update tests、route integration tests |
| 可维护性 | Web channel 只消费 channel-facing port；gateway 继续拥有 Record/SQLite mapping；app service 负责跨 port 编排 | `npm run lint:architecture`、focused code review |
| 可测试性 | management port 可用 fake 实现做 route tests；SQLite gateway 用临时库验证持久化和 update；app service 可注入 clock/idempotency | unit/contract/kernel tests |
| 审计/可追溯性 | 本 change 不新增 audit event；Cron Tool 已有 create/delete observation。REST 管理 mutation 首版依赖 API access log 和 durable task facts；不得记录 prompt 到 audit/trace | redaction/code review；后续如需 REST audit 另开 change |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 四个 REST endpoint 有 request/response/error schema | 3.1, 3.2 | agent-channel-web route tests、API inventory test |
| 客户端不能覆盖 owner/agent/session/run/status/version | 3.3 | route negative tests |
| query 返回 owner + active Agent 下 task 且隐藏 session/version | 2.1, 3.1 | gateway list-for-agent tests、route tests |
| execution 查询返回 scoped trigger/run/result read model | 1.4, 2.4, 3.4, 4.1 | gateway trigger list tests、service tests、route tests、e2e product path |
| create 不要求 sessionId 并 durable commit | 2.2, 4.1 | app service test、route product path test |
| update 只允许 active task 修改 cron/prompt/recurring 并重算 nextRunAt | 1.1, 2.3 | SQLite gateway update tests、service tests |
| delete 后 task 不再出现在管理 API 且不参与 due scan | 1.1, 3.1 | gateway delete/listDue tests、route tests |
| 缺少 Cron gateway/port fail closed | 3.4 | route unavailable test |
| Web API 文档列出四个 endpoint | 5.1 | docs alignment test 或 code review checkpoint |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/cron-task-management-api/spec.md` 主承载 REST 管理 API 行为。
- 架构和跨模块设计：`openspec/designs/architecture/cron-task-execution.md` 主承载 REST management -> channel port -> app service -> gateway -> scheduler/runtime delivery 流程。
- 模块设计：`openspec/designs/modules/agent-channel-web.md` 主承载 route/schema/DTO/safe error owner。
- 模块设计：`openspec/designs/modules/agent-app.md` 主承载 Cron management service composition 和 trigger execution session anchor。
- 模块设计：`openspec/designs/modules/agent-platform-gateway-local.md` 主承载 SQLite Cron task agent-scope query/update mapping。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 `cron-task-management-api` 到上述文档和测试入口的映射。

## 风险与取舍（Risks / Trade-offs）

- [execution result 内容可能较大] -> 首版只返回 terminal event inline `content`，不解析 contentRef，不做分页游标；若需要大型结果下载或分页，应另开 Web/session projection change。
- [trigger execution session 可能出现在普通 session list] -> task 创建不再产生 session；只有实际触发执行时 runtime 才创建 execution session。前端若要隐藏系统执行 session，应另开 Web/session projection change。
- [agent-scope taskId 冲突] -> owner + agent + taskId 是持久化唯一键；重复 idempotency key 返回首次创建的 task，重复 taskId 创建由 gateway 唯一约束保护。
- [REST create 暴露 prompt 字段] -> 这是管理 API 的明确功能需求；prompt 只在 explicit management API response 中返回，不进入 stream safe projection、audit 或 trace。
- [update 与 scheduler 并发] -> update 使用 expectedVersion；若 scheduler 已 claim 并推进 task version，update 返回 conflict 或基于最新 record 重试由调用方重新发起。

## 迁移计划（Migration Plan）

SQLite Cron gateway 在启动时检测旧的 session-scoped `cron_tasks` / `cron_triggers` schema。若发现 `cron_tasks.session_id` 或旧 trigger 主键仍绑定 session，则以本地事务重建为 owner + agent scoped task schema：task fact 丢弃创建 session 维度，trigger fact 保留已绑定执行 `session_id` 和 `request_run_id`。迁移后 REST/UI 可在没有 client session 的情况下创建 task，既有已 accepted trigger 仍保留执行 session/run 事实。

部署回滚时移除 REST route 和服务注入；已迁移 Cron task 继续由 scheduler/Tool 路径按 owner + agent scope 管理。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/cron-task-management-api/spec.md`：提炼 REST 管理 API 的 endpoint、scope、安全、输入校验和 durable mutation 行为。
- `openspec/overview.md`：记录 Cron task 可通过 Agent Tool 和 REST 管理两条入口管理。
- `openspec/designs/architecture/cron-task-execution.md`：补充 REST management API 的跨模块流程和与 scheduler/runtime delivery 的关系。
- `openspec/designs/modules/agent-channel-web.md`：补充 Cron task route/schema/DTO/safe error。
- `openspec/designs/modules/agent-app.md`：补充 Cron management service 和 trigger execution session anchor。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充 SQLite list-for-agent、load-for-agent、updateTask。
- `openspec/designs/spec-to-design-map.md`：补充导航和验证入口。

## 待确认问题（Open Questions）

无。首版明确不做前端管理面板，不做 execution 分页游标或大型 contentRef 读取。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-10.9-Cron工具` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/cron-task-management-api/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
