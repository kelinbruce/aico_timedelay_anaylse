---
sources:
  - AGENTS.md
  - openspec/overview.md
  - openspec/designs/architecture/core-contracts.md
last-verified: 2026-09-01
---

# 包所有权与边界不变量

每个 package 有明确的"拥有什么"和"禁止什么"。违反这些边界是最常见的架构错误。

→ 架构总览详见 [architecture-map.md](architecture-map.md)
→ LLM 常犯的边界错误详见 [anti-patterns.md](anti-patterns.md)
→ 快速参考卡详见 [quick-ref.md](quick-ref.md)

## 核心：Agent Scope + Owner Scope 双层隔离

**这是最重要的不变量，几乎所有包都受其约束。**

| 维度 | 来源 | 用于 | 不能来自 |
|---|---|---|---|
| Agent Scope | 可信 app composition / hosted-agent selection / 已持久化 Session.agentId | 选择 Agent 配置、assembly、model、prompt、capability、context policy | 客户端请求体、模型输出、Capability 参数 |
| Owner Scope | channel/auth boundary (tenantId + subjectId) | 隔离租户/用户运行时数据 | 请求体、模型输出、客户端 metadata |

**主路径持久化规则**：session list/history/conversation、message、active context、timeline、terminal commit、attachment/artifact/memory 的 Record、SQLite row 和 query contract **必须**显式携带 `agentId`。不得只按 `tenantId`/`subjectId` 查询。

**唯一受控例外**：已有 session submit 的 `SessionLookupRequest`，可先按 `tenantId/subjectId/sessionId` 读取 `Session.agentId`，随后必须校验当前 trusted Agent Scope 与 session-bound `agentId` 一致。

## DO/DTO/PO/Record 边界

| 类型 | 所在层 | 用途 | 举例 |
|---|---|---|---|
| DO (Domain Object) | 领域服务 | 内部 read model、业务逻辑 | agent-runtime 内部的 RunState |
| DTO (Data Transfer Object) | Web/channel 层 | 公开 API 响应 | StreamEnvelope、SessionMessageDTO |
| Record (持久化 DTO) | Gateway port | port 入参或返回值 | SessionRecord、MessageRecord |
| PO (Persistence Object) | gateway-local 私有 | SQLite row/entity | SessionRow、MessageRow |

**关键禁止**：
- `*Record` 不得作为 agent-session、agent-runtime、agent-context-engine 等领域/application service 的 public return
- `*Record` 不得进入 Web response
- `*Record` 不得继承 `*Request`
- PO 只允许停留在 gateway-local 私有实现

## Gateway 写入模式

| 场景 | 模式 | 约束 |
|---|---|---|
| 简单写入 | `Record + write options` | idempotencyKey、expectedVersion 属于 command metadata，不得塞进 Record |
| 查询/过滤/多事实复合事务 | 专门 request type | 如 SessionLookupRequest |
| 复合持久化 | gateway 单一 composite write + 单一数据库事务 | runtime/application 组装业务语义 Record；gateway-local 只做 row mapping、sequence、CAS、唯一约束、幂等、事务 |

## 幂等写入：锚点事实表原则

- 每个 idempotent write 定义一个业务锚点表
- 按 trusted owner scope + agent scope + 相关 session/request/run 坐标建立 scoped uniqueness
- 重复 key 返回首次锚点事实结果，不重复 side effect
- 状态推进按 CAS 建模，不得追加无法锚定的伪 operation key
- 独立 idempotency store/table 只作为无清晰锚点事实时的受控例外，且必须先写入 OpenSpec design

## Gateway 不反推业务语义

`agent-platform-gateway-local` 只负责：
- row mapping
- sequence/ordinal
- CAS
- 唯一约束
- 幂等
- 事务

**不得**：反推业务事件语义、决定业务流程分支、解释 Record 字段的业务含义。

## agent-contracts 依赖规则

`agent-contracts` 的 14 个 subpath 只能依赖 `agent-common` 和 schema/validation 库。

**特别禁止**：不得为避免重复 enum 让 `agent-contracts/gateway` 依赖 `agent-contracts/session`、`agent-contracts/runtime`、`agent-contracts/attachment` 等。gateway Record 只能引用 common vocabulary 和自身 persistence-only vocabulary。

## 各包禁止清单

| Package | 禁止 |
|---|---|
| agent-channel-web | 拥有 request lifecycle、trusted identity、Agent/Owner Scope、capability authority、persistence |
| agent-channel-task | 拥有 request lifecycle、直接操作 session/message store |
| agent-runtime | 做业务语义路由（归 agent-core） |
| agent-core | 拥有请求生命周期状态（归 agent-runtime） |
| agent-context-engine | 调用模型（归 agent-model） |
| agent-model | 选择上下文（归 agent-context-engine） |
| agent-workflow | 拥有 request lifecycle、cancel、checkpoint、terminal commit、pending input store |
| agent-memory | 阻塞 request terminal commit |
| agent-platform-gateway-local | 反推业务事件语义 |
| agent-observability | 包含 prompt、模型输出、stream delta、raw provider error、路径、credential、token、附件内容 |
| agent-common | 放 DO、DTO、Record、port 或业务服务 |
| agent-contracts | 依赖实现包、Fastify、SQLite/Kysely、OTel SDK、model SDK、provider SDK |
| frontend/agent-web | 拥有 request lifecycle、canonical stream/history truth、trusted identity、Agent/Owner Scope、capability authority、persistence |
