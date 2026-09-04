## 背景与问题（Why）

当前代码已经具备 `Cron` 内置 Tool、SQLite/remote `cron-tasks` gateway、local scheduler 和 trigger delivery 路径。用户可以通过 Agent 调用 `Cron(action=create|list|delete)` 管理当前会话 scope 内的定时 prompt，但系统没有对外的 Cron task 管理 REST API。

这导致两个实际问题：

- 机机集成或管理端无法绕过对话直接创建、查询、修改和删除 Cron task。
- 后续 Cron 管理面板没有稳定后端接口可复用，容易把管理语义散落到前端或重新走模型 Tool。

现在需要先补齐后端 REST 管理能力，形成可验证、可审计、可复用的 public Web API；本次不提供 Cron 管理面板。

## 变更范围（What Changes）

- 在 Web channel 增加 Cron task 管理 REST API：
  - `GET /api/v1/cron-tasks`：查询当前 trusted owner 和 active Agent 下的 Cron tasks。
  - `POST /api/v1/cron-tasks`：创建 Cron task。
  - `PUT /api/v1/cron-tasks/:taskId`：修改 Cron task 的 `cron`、`prompt`、`recurring`。
  - `GET /api/v1/cron-tasks/:taskId/runs`：查询指定 Cron task 的触发执行记录、绑定 run 状态和 terminal result。
  - `DELETE /api/v1/cron-tasks/:taskId`：删除 Cron task。
- API 使用 public DTO，不暴露 gateway `CronTaskRecord`、SQLite row、idempotency key、version 或 raw runtime fact；execution 查询只暴露管理所需的 trigger/run/result read model。
- Owner Scope 来自 channel/auth identity；Agent Scope 来自 trusted app composition 的 active Agent。请求 body/query/path 不得提供 tenant、subject、agent、session、run 或持久化版本事实。
- 管理 API 创建的 task 不要求也不绑定客户端 `sessionId`；Cron task 持久化归属为 `tenantId + subjectId + agentId`。
- Cron task update 通过 gateway contract 的 CAS 写入完成，必须重新计算 `nextRunAt` 并保留 owner/agent scope。
- 不新增前端 Cron 管理面板，不改变已有 `Cron` Tool 的模型可见 contract。

## Capability 影响（Capabilities）

### 新增 Capability
- `cron-task-management-api`: 定义 Cron task 管理 REST API、public DTO、安全 scope、创建/查询/修改/删除语义。

### 修改的 Capability
- 无。`cron-tools` 和 `web-channel-api-contract` 当前尚未进入 stable `openspec/specs/` 基线；本 change 通过新增 `cron-task-management-api` capability 定义 REST 管理接口，并在 design/tasks 中要求复用既有 Cron gateway/scheduler 与 Web API schema 规则。

## 影响范围（Impact）

- 后端 API：`agent-channel-web` 增加 Cron task REST routes、TypeBox schema、safe error projection 和 DTO projection。
- 应用组合：`agent-app` 将 Cron task gateway 或窄服务注入 Web channel context。
- Gateway contract：`agent-contracts/gateway` 需要增加修改 task 的受控写入能力，或复用现有 record/write-options 模式补齐 update port，并提供 scoped trigger list 供 execution read model 使用。
- 本地 gateway：`agent-platform-gateway-local` 增加 SQLite Cron task update 实现和测试。
- 文档：更新 Web API 清单，记录 Cron task 管理接口字段、错误码和示例。
- 测试：新增 route contract/agent-kernel 测试，覆盖 create/list/update/delete/execution list、scope 拒绝、无 gateway fail closed、cron/prompt validation 和 docs/schema 对齐。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/cron-task-management-api/spec.md`：新增 Cron task 管理 REST API 契约。

长期背景：
- `openspec/overview.md`：记录 Cron task 同时支持 Agent Tool 管理和受控 REST 管理。

设计视图：
- `openspec/designs/architecture/cron-task-execution.md`：补充 REST 管理 API 到 gateway/scheduler/runtime delivery 的跨模块流程。
- `openspec/designs/modules/agent-channel-web.md`：补充 Cron task REST route、DTO projection、safe error 和 schema owner。
- `openspec/designs/modules/agent-app.md`：补充 Cron gateway/service 注入 Web channel context 的组合边界。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充 SQLite Cron task update 写入语义。
- `openspec/designs/adr/<id>.md`：无，当前设计复用既有 Cron gateway boundary，不需要新增长期 ADR。
- `openspec/designs/spec-to-design-map.md`：新增 `cron-task-management-api` 导航和验证入口。

验证入口：
- `packages/agent-channel-web` Cron task route tests。
- `packages/agent-platform-gateway-local` SQLite Cron task gateway update 和 trigger list tests。
- `tests/agent-kernel` 或 e2e Web API product path tests。
- `openspec validate add-ts-cron-task-management-api --strict`。
- `openspec validate --all --strict`。
