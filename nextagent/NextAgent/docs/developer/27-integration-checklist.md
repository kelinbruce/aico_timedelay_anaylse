# 外部系统集成指南（Integration Checklist）

这一篇面向要把 NextAgent 作为服务接入自己系统的外部集成方：网管系统、告警平台、编排系统、门户前端或自动化流水线。目标是给出"对接前问什么、拿到什么、先调什么、错误怎么读"的一页式清单。

接口字段级权威定义见 [agent-web API 清单](../apis/agent-web-api-list.md)（Web channel 与 IR surface）和 [Task Channel API](../apis/task-channel-api.md)（机机通道）。

## 第一步：向交付方索取

| 项 | 说明 |
|----|------|
| 服务地址与端口 | 默认 `http://<host>:3000`；确认是否有反向代理前缀（`channel.routePrefix` 会使路径变为 `/svcA/api/v1/...`） |
| 对接通道 | 人机（浏览器/前端）走 Web channel；机机走 Task channel 或 IR surface——确认你的场景是哪一种 |
| 身份凭证 | ER（Web）：`auth.localAuth` 的 credential 值（`credentialRef` 指向的环境变量内容）；IR / Task：上游网关注入的 `x-tenant-id`、`x-subject-id` 约定值 |
| 认证是否启用 | `auth.localAuth.enabled=false` 时 ER 免登录；`true` 时必须先 login 换 Cookie |
| NextAgent 版本 | 影响事件类型集合与 API 面；见运行包 `package.json` 的 `version` |

## 第二步：连通性验证（按顺序）

```bash
# 1. 存活 + 组件健康
curl -s http://127.0.0.1:3000/api/v1/health
curl -s http://127.0.0.1:3000/api/v1/health/deep

# 2. 传输形态（SSE 或 WebSocket）与前端能力
curl -s http://127.0.0.1:3000/api/v1/runtime/bootstrap

# 3.（启用 localAuth 时）登录拿 Cookie
curl -s -X POST http://127.0.0.1:3000/api/v1/auth/local/login \
  -H "Content-Type: application/json" \
  -d '{"credential":"<交付方提供的值>"}' -c cookies.txt
```

健康检查返回 `{status, components[], timestamp}`；`status` 非 `UP` 时先解决环境问题再对接。

## 第三步：三种对接通道选型

| 通道 | 路径前缀 | 身份 | 适合 | 关键文档 |
|------|---------|------|------|---------|
| Web channel（ER） | `/api/v1` | `nextagent_local_auth` HttpOnly Cookie（或免认证） | 浏览器/前端集成 | [API 参考](./10-api-reference.md) |
| IR surface（ER 机机） | `/api/v1/ir` | `x-tenant-id` / `x-subject-id` / `x-display-name` 请求头（上游网关已认证，NextAgent 只读） | 服务端程序化调用（创建会话/提交/取消/重试/回答/读流） | [API 参考](./10-api-reference.md) IR 章节 |
| Task channel | `/api/v1/stream-task`、`/api/v1/async-tasks`、`/api/v1/tasks` | 同 IR 的 header 注入 | 后台批处理、callback 回推 | [Task Channel API](../apis/task-channel-api.md) |

IR 与 ER 认证隔离：IR 只认 header，ER 只认 Cookie，互不交叉。IR surface 只暴露 6 个核心端点（sessions / requests / stream / cancel / retry / pending-inputs answer），不带 UI 专属能力。

## 第四步：最小对接流程（以 IR 为例）

```bash
# 1. 创建会话
curl -s -X POST http://127.0.0.1:3000/api/v1/ir/sessions \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: tenant-1" -H "x-subject-id: subject-1" \
  -d '{"locale":"zh-CN"}'
# → {"sessionId":"sess_..."}

# 2. 提交请求（idempotencyKey 必填，业务侧生成唯一值）
curl -s -X POST http://127.0.0.1:3000/api/v1/ir/sessions/sess_xxx/requests \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: tenant-1" -H "x-subject-id: subject-1" \
  -d '{"inputText":"分析小区掉话率升高原因","idempotencyKey":"erp-20260827-0001"}'
# → {"sessionId":"...","requestId":"req_...","runId":"run_...","attempt":1}

# 3. 消费 SSE 流（注意：原生 EventSource 不能带自定义 header，
#    IR 场景请用可设 header 的 HTTP 客户端，如 fetch/curl/okhttp）
curl -N "http://127.0.0.1:3000/api/v1/ir/sessions/sess_xxx/stream?requestId=req_xxx" \
  -H "x-tenant-id: tenant-1" -H "x-subject-id: subject-1"

# 4. 断线后补历史：会话消息
curl -s "http://127.0.0.1:3000/api/v1/sessions/sess_xxx/conversation" -b cookies.txt
#    或单个 run 的持久化事件
curl -s "http://127.0.0.1:3000/api/v1/sessions/sess_xxx/runs/run_xxx/events" -b cookies.txt
```

## 集成方必须理解的行为语义

这些语义直接决定客户端设计，摘自 [会话与状态管理](./07-session-state-management.md) 与 [流式事件](./09-streaming-events.md)：

- **幂等键**：submit / cancel / retry / edit 必须带 `idempotencyKey`；重复提交同一 key 返回首次结果，不重复执行。
- **同会话串行**：同一 session 同时至多一个 EXECUTING run，新请求排队——不要假设并行请求立即执行。
- **终态语义**：`REQUEST_COMPLETED` / `FAILED` / `CANCELED` / `SUPERSEDED` 是 terminal；Web channel 不会因断连合成 `REQUEST_COMPLETED`，客户端必须等真正的 terminal 事件。
- **历史事实源**：会话历史以 `GET /sessions/{id}/conversation`（`SessionMessage`）为准，**禁止客户端自行重建历史**（retry/edit 会使旧消息 `visible=false`，conversation API 已过滤）。
- **重连恢复**：SSE 与 WS 的 resume 输入等价（`lastSeenSequence` / `requestId` / `runId`）；断线后先刷 conversation 再续流；跨页面/新设备通过会话 bootstrap 的 `activeRun` 恢复进行中的 run。
- **事件向前兼容**：`StreamEventType` 当前 23 个且会扩展，客户端必须容忍未知事件类型。
- **身份不可覆盖**：请求体、query、path 中的 `tenantId` / `subjectId` / `agentId` 一律不生效；身份只来自认证边界。

## 错误读取约定

错误响应统一为安全投影（不含内部细节）：

```json
{ "error": { "code": "LOCAL_AUTH_REQUIRED", "message": "Authentication required." } }
```

高频错误码与处置：

| HTTP | code | 含义 / 处置 |
|------|------|------------|
| 400 | `REQUEST_VALIDATION_FAILED` | 请求体不合法；对照 API 清单检查必填字段（常见：漏 `idempotencyKey`） |
| 401 | `LOCAL_AUTH_REQUIRED` | 未登录/未带 Cookie（ER）或缺少 `x-tenant-id`/`x-subject-id` header（IR/Task） |
| 403 | — | owner scope 或 agent scope 不匹配；确认 header 与会话归属 |
| 404 | — | 路径或资源不存在；确认 routePrefix 与 sessionId |
| 409 | — | 冲突（如 expectedLatestRequestId 不匹配）；先查最新状态 |
| 503 | — | 服务不可用；先看 `/api/v1/health/deep` |

## 可选：把事件流接到监控系统

- 指标：LOCAL 模式读 `logs/nextagent-metrics.ndjson`，REMOTE 模式 OTLP 导出（[指标清单](./22-observability-metrics.md)）。
- Trace：`observability.tracing` 配 OTLP endpoint 后在 APM 查看（[OTEL 指南](./25-otel-trace-reporting.md)）。
- 日志：采集 `logs/nextagent-operational.log.*.jsonl`（JSONL 结构化，已脱敏）。

## 对接验收 checklist

- [ ] 健康检查通过（`/api/v1/health` 与 `/deep`）
- [ ] 按通道完成一次身份获取（login Cookie 或 header 约定）
- [ ] 走通 submit → 收到 acceptance（`requestId`/`runId`）→ 消费到至少一个 terminal 事件
- [ ] 幂等键重放验证：同 key 二次提交返回首次结果
- [ ] 断线恢复验证：杀掉流连接后能通过 conversation/events 补历史并续流
- [ ] 401/403/404 错误路径按上表断言
- [ ] （生产）反代已配置 SSE 不缓冲 + WS 升级透传
- [ ] （生产）反代 idle timeout 已调大：服务端 SSE/WS **无心跳**，事件间隔超过代理 idle timeout 时连接会被静默掐断（见[常见问题排查](./14-troubleshooting-faq.md)流式事件章节）
