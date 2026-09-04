---
sources:
  - AGENTS.md
  - openspec/overview.md
last-verified: 2026-09-01
---

# LLM 常犯错误与项目特殊约束

LLM 在本项目中容易犯的错误，以及容易被忽视的特殊约束。写代码或 review 前必读。

## 高频错误 Top 10

### 1. 从客户端请求体读取 agentId / identity

**错误**：从 `req.body.agentId` 或 `req.body.tenantId` 获取身份信息。

**正确**：Agent Scope 来自可信 app composition / 已持久化 Session.agentId；Owner Scope 来自 channel/auth boundary；IR 来自 `x-tenant-id`/`x-subject-id` header。

**为什么**：请求体是不可信输入，用户或模型可以伪造。

→ 规则定义见 [package-ownership.md](package-ownership.md) "Agent Scope + Owner Scope"

### 2. 在领域服务 public return 中暴露 Record

**错误**：`agent-session` 的方法返回 `SessionRecord`。

**正确**：领域服务返回 DO / read model，Web 返回 DTO，Gateway 返回 Record，三者严格分离。

→ 规则定义见 [package-ownership.md](package-ownership.md) "DO/DTO/PO/Record 边界"

### 3. 让 gateway 反推业务语义

**错误**：在 gateway-local 中判断"这个 Record 代表什么业务事件"。

**正确**：gateway-local 只做 row mapping / sequence / CAS / 唯一约束 / 幂等 / 事务。

→ 规则定义见 [package-ownership.md](package-ownership.md) "Gateway 不反推业务语义"

### 4. 在 gateway Record 中加入 idempotencyKey / expectedVersion

**错误**：`SessionRecord { ..., idempotencyKey: string }`。

**正确**：idempotencyKey/expectedVersion 属于 command metadata，通过 write options 传递。不得新增一次性 `*WriteRequest`/`*AppendRequest`。

→ 规则定义见 [package-ownership.md](package-ownership.md) "Gateway 写入模式"

### 5. 只按 tenantId/subjectId 查询持久化数据

**错误**：`SELECT * FROM sessions WHERE tenant_id = ? AND subject_id = ?`。

**正确**：主路径查询必须同时校验 Agent Scope + Owner Scope，显式携带 `agentId`。唯一例外：SessionLookupRequest 先读再校验。

→ 规则定义见 [package-ownership.md](package-ownership.md) "Agent Scope + Owner Scope"

### 6. 在 agent-contracts/gateway 中引用其他业务 subpath

**错误**：`import { RunStatus } from '@nextagent/agent-contracts/runtime'` 在 gateway Record 中。

**正确**：gateway Record 只引用 agent-common + gateway 自身 vocabulary。共享 vocabulary 归 agent-common。

→ 规则定义见 [package-ownership.md](package-ownership.md) "agent-contracts 依赖规则"

### 7. 在前端实现业务逻辑

**错误**：在 Zustand store 中决定路由策略、在 component 中做能力授权判断。

**正确**：`frontend/agent-web` 只拥有浏览器投影、组件交互和本地 view state。不拥有 request lifecycle、trusted identity、Agent/Owner Scope、capability authority 或 persistence。

### 8. 让 agent-memory 阻塞 terminal commit

**错误**：在 terminal commit 路径中 await 记忆写入。

**正确**：长期记忆不阻塞 request terminal commit。记忆写入是异步的，失败不影响请求终态。

### 9. 忽略 same-session lane 串行控制

**错误**：绕过 lane 直接创建新 RequestRun。

**正确**：同一 session 内的请求必须经过 same-session lane scheduling。agent-runtime 拥有 lane 控制。

### 10. 在日志/metric/trace 中记录敏感信息

**错误**：在 operational log 中记录完整 prompt、模型输出、stream delta、provider raw error。

**正确**：
- 日志/metric/trace/audit 不包含 prompt、模型输出、stream delta、raw provider error、路径、credential、token、附件内容
- **唯一例外**：local operational runtime diagnostic 的 `toolInput`/`toolOutput`/`modelInput`/`modelOutput`/`rawExceptionData` 在 normal 和 debug 下均启用
- 这 5 个 special fields 只对 credential 与认证类 token 做窄匹配脱敏，prompt/路径/命令/stdout/stderr/普通业务内容**不按敏感信息脱敏**
- 但这些诊断字段**不得**进入 Web API、SSE、WebSocket、timeline、SafeError、audit、metric、trace 或 ObservabilityObservationEvent

## 容易忽略的特殊约束

| 约束 | 规则 | 详参 |
|---|---|---|
| Session 必须绑定 agentId | 不存在"无 Agent 的会话" | → package-ownership.md |
| RequestRun Acceptance 固化三要素 | Acceptance 时固化 `agentId` + `agentVersion` + `agentAssemblyRef`；accepted 后不得重新按默认 Agent 选择路径 | → data-flow-atlas.md |
| Terminal Commit 唯一 | 只有一条路径可以终结 RequestRun | → data-flow-atlas.md |
| Capability safeError 容量 | `256000` UTF-16 code unit，超出需外置回读 | → quick-ref.md |
| TOOL_STRUCTURED_DELTA 容量 | gateway 前 ≤`49000` UTF-8 bytes per `(runId, toolCallId)` | → quick-ref.md |
| 模型可见文本硬上限 | `150000` UTF-16 code unit，超限截断+标记 | → quick-ref.md |
| Pending Input 超时 | 默认 30 分钟，上限 24 小时，deadline-driven single-flight processing | → quick-ref.md |
| Composer 输入截断 | 超 `LONG_TEXT_THRESHOLD=2000` 字符截断 + inline notice 引导 .md 附件 | → frontend-rules.md |
| 附件 markdown 强制接受 | `.md`/`.markdown` 跳过扩展名白名单，仍受 magic bytes/zip 防护/配额约束 | → frontend-rules.md |
| 通用持久化禁止 | 禁止 generic `records(store,key,json)` 承载业务事实，必须用专用 store/table | → package-ownership.md |
| Workflow 不拥有生命周期 | 不拥有 lifecycle/cancel/checkpoint/terminal commit/pending input store，经 `AgentRunStatePort` 协作 | → architecture-map.md |
| 对话分享 ops 权限 | SHA-256 白名单语义，不做子集判断；相同 ops 集合 → 相同 hash | — |
| IR 与 ER 认证隔离 | IR 用 header-based auth，不暴露 UI-only 端点；`registerWebChannel` 接受 `routePrefix` | → data-flow-atlas.md |
| Context Assembly 不自动注入记忆 | 模型需记忆时通过 governed memory tools 显式调用 | → data-flow-atlas.md |
| guardrail 输入 BLOCKED | 不创建 run；`recordInputGuardBlock` 持久化两条 `visible=true` 消息 + `modelVisibility.excluded=true` | → data-flow-atlas.md |
| 文件轮转 | 30MiB/daily/gzip/10 archive；operational/metrics/audit 7天，plugin-diagnostic 3天 | → config-and-entry-points.md |
| 双语输出规则 | 模型跟随用户语言，NE/interface/KPI/protocol/alarm/CLI 等电信术语保留英文 | → domain-glossary.md |
