---
sources:
  - AGENTS.md
  - openspec/overview.md
last-verified: 2026-09-01
---

# 快速参考卡

上下文预算紧张时的一页浓缩。详细规则见各专题页面。

## DO/DTO/PO/Record 四层分离

| 层 | 类型 | 谁暴露 | 谁消费 | 禁止 |
|---|---|---|---|---|
| 领域 | DO | 领域服务 | 内部 | 不作为 public return 暴露 Record |
| Web | DTO | agent-channel-web | 浏览器/外部 | 不进入领域服务 return |
| Gateway | Record | gateway port | runtime/application | 不进入 Web response；不继承 Request |
| 实现 | PO | gateway-local 私有 | gateway-local 内部 | 不离开 gateway-local |

→ 详见 [package-ownership.md](package-ownership.md)

## Agent Scope + Owner Scope

| 维度 | 来源 | 禁止来源 |
|---|---|---|
| Agent Scope | 可信 app composition / 已持久化 Session.agentId | 请求体、模型输出、Capability 参数 |
| Owner Scope | channel/auth boundary (tenantId + subjectId) | 请求体、客户端 metadata |

**主路径查询必须同时携带 agentId。** 唯一例外：SessionLookupRequest 先读再校验。

→ 详见 [package-ownership.md](package-ownership.md)、[anti-patterns.md](anti-patterns.md)

## Gateway 写入三规则

1. **简单写入**：Record + write options。idempotencyKey/expectedVersion 是 command metadata，不塞进 Record
2. **复合事务**：gateway 单一 composite write + 单一数据库事务。runtime 组装业务语义，gateway 只做事务
3. **幂等**：锚点事实表原则，按 owner + agent scope + 业务坐标建 scoped uniqueness。不得追加伪 operation key

→ 详见 [package-ownership.md](package-ownership.md)

## 十条绝对禁止

1. 从客户端请求体读取 agentId/identity → [anti-patterns #1](anti-patterns.md)
2. 领域服务 public return 暴露 Record → [anti-patterns #2](anti-patterns.md)
3. Gateway 反推业务语义 → [anti-patterns #3](anti-patterns.md)
4. Record 里塞 idempotencyKey/expectedVersion → [anti-patterns #4](anti-patterns.md)
5. 只按 tenantId/subjectId 查询（缺 agentId）→ [anti-patterns #5](anti-patterns.md)
6. agent-contracts/gateway 引用其他业务 subpath → [anti-patterns #6](anti-patterns.md)
7. 前端实现业务逻辑 → [anti-patterns #7](anti-patterns.md)
8. agent-memory 阻塞 terminal commit → [anti-patterns #8](anti-patterns.md)
9. 绕过 same-session lane → [anti-patterns #9](anti-patterns.md)
10. 日志记敏感信息（除 5 个诊断字段）→ [anti-patterns #10](anti-patterns.md)

## 关键数值限制

| 限制 | 值 |
|---|---|
| Capability safeError 容量 | 256000 UTF-16 code unit |
| TOOL_STRUCTURED_DELTA | ≤49000 UTF-8 bytes per (runId, toolCallId) |
| 模型直接可见文本 | 150000 UTF-16 code unit |
| Composer 输入截断 | 2000 字符 (LONG_TEXT_THRESHOLD) |
| inlinePayload (timeline event) | ≤49000 UTF-8 bytes |
| Pending Input 默认超时 | 30 分钟 |
| Pending Input 最大超时 | 24 小时 |

## 新增类型速查

- 跨包 branded ID / enum → `agent-common`
- 包间 DTO / schema / port → `agent-contracts` 对应 subpath
- Gateway Record → `agent-contracts/gateway`（只引用 agent-common + gateway vocabulary）
- Web DTO → `agent-channel-web` 内部
- DB Row → `agent-platform-gateway-local` 私有

→ 详见 [decision-trees.md](decision-trees.md)、[vocabulary-ids.md](vocabulary-ids.md)
