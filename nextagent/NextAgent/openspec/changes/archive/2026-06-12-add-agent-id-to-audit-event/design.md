## 背景和现状（Context）

当前 `AuditEvent` 已包含 Owner Scope 字段 `tenantId`、`subjectId`，但缺少 Agent Scope 字段。已有 runtime lifecycle 和 capability audit 都在 run-bound 上下文中构造 event，因此可以直接使用已固化的 `RequestRun.agentId`。

归档的最小内核明确将真实 durable audit store 后置。本 change 只修复 audit envelope，不把后置能力提前混入。

## 第一性原理（First Principle）

审计事件只应携带当前可信执行路径已经固化的 scope，不应在审计边界重新选择 Agent，也不应从不可信输入推断 Agent。

## 黑盒目标（Blackbox Goal）

已有 run-bound audit event 在离开 runtime 或 capability 边界时携带可信 `agentId`，使未来 audit sink 能在不改变事件语义的前提下执行 Agent Scope 隔离。

## 边界（Boundary）

- 负责：`AuditEvent.agentId` contract、已有 run-bound call site 透传、audit envelope 测试
- 不负责：durable audit persistence、gateway port、Record、table、query、retention、audit projection 或新的 audit event 类型

## 关键设计判断（Core Design Decisions）

1. `AuditEvent.agentId` 为 optional，因为核心契约允许未来存在非 run 上下文 audit event。
2. 已有 run-bound runtime lifecycle 和 capability audit event 必须携带 `run.agentId`，不得省略。
3. `agentId` 只能来自已固化的 `RequestRun.agentId`；不得使用默认 Agent、全局配置或不可信输入补值。
4. 本 change 不新增 audit sink。真实持久化需要独立 OpenSpec change 定义 gateway port、Record、table、scope key、写入策略和验证路径。

## 关键流程（Key Flow）

1. Runtime acceptance、terminal 或 capability boundary 已持有 `RequestRun`
2. Audit call site 从 `RequestRun.agentId` 读取可信 Agent Scope
3. Audit call site 构造包含 `agentId` 的 `AuditEvent`
4. 已注入的 `AuditEventWriter` 消费 event；本 change 不改变 writer 的产品行为

## 场景（Scenarios）

| 场景 | 预期行为 |
|---|---|
| 正常：runtime lifecycle audit | event 携带 `run.agentId` |
| 正常：capability audit | event 携带 `run.agentId` |
| 降级：未来非 run audit | 可省略 `agentId`，不得伪造默认值 |
| 失败：不可信输入尝试覆盖 Agent Scope | 不读取、不接受、不传播该值 |

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | `agentId` 只能来自已固化的 `RequestRun.agentId`，不得从客户端请求体、未经认证 metadata、模型输出或 capability 参数中读取；audit event 不得伪造默认 Agent | audit envelope contract tests：agentId 来源断言 |
| 性能/容量 | `agentId` 为 optional 字段，对已有 audit event 结构无额外开销；run-bound call site 直接读取已固化的 `RequestRun.agentId`，无额外查询 | audit envelope contract tests：字段存在性断言 |
| 可靠性/恢复 | 已有 run-bound runtime lifecycle 和 capability audit event 必须携带 `run.agentId`，不得省略；非 run 上下文 audit event 可省略但不得伪造默认值 | audit envelope contract tests：run-bound 必选断言 |
| 可维护性 | 只修改 `AuditEvent` envelope，不新增 audit sink、gateway port、Record、table 或 query API；durable audit persistence 由后续独立 change 定义 | architecture lint：本 change 不引入新的持久化依赖 |
| 可测试性 | run-bound 和非 run-bound 两种 audit event 可通过 unit test 独立验证 `agentId` 的传递和省略行为 | audit envelope contract tests：agentId 传递覆盖 |
| 审计/可追溯性 | 已有 run-bound audit event 在离开 runtime 或 capability 边界时携带可信 `agentId`，使未来 audit sink 能执行 Agent Scope 隔离 | audit envelope contract tests：agentId 追溯性断言 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| run-bound audit event 必须携带 `run.agentId` | audit envelope contract tests | runtime lifecycle audit 和 capability audit 的 agentId 断言 |
| `agentId` 只能来自已固化的 `RequestRun.agentId` | audit envelope contract tests | agentId 来源断言 |
| 非 run 上下文 audit event 可省略 `agentId` 但不得伪造默认值 | audit envelope contract tests | 非 run audit event 的 agentId 省略断言 |
| 不新增 audit sink、gateway port、Record 或 table | architecture lint | 本 change 不引入新的持久化依赖 |

## 文档承载决策（Documentation Ownership）

归档时需更新以下长期基线文档：

- `openspec/specs/ts-core-contracts/spec.md`：更新 audit event contract 的 `agentId` 字段
- `openspec/designs/contracts/audit-event-spi.md`：补充 `AuditEvent.agentId` 的语义和来源约束
- `openspec/designs/modules/agent-runtime.md`：补充 runtime lifecycle audit 的 agentId 传递入口
- `openspec/designs/modules/agent-capability.md`：补充 capability audit 的 agentId 传递入口
- `openspec/designs/spec-to-design-map.md`：更新 audit event contract 映射

## 风险与取舍（Risks / Trade-offs）

- [风险] 非 run 上下文 audit event 伪造默认 `agentId` -> 契约约束：`agentId` 为 optional，省略时不得补默认值；通过 contract test 守护
- [风险] 已有 call site 遗漏 `agentId` 传递 -> 已有 run-bound runtime lifecycle 和 capability audit call site 必须显式传递；通过 contract test 覆盖所有已知 call site
- [风险] durable audit sink 提前混入本 change -> 明确边界：本 change 不新增 sink、gateway port、Record、table 或 query API；通过 architecture lint 守护
- [取舍] `agentId` 设为 optional 而非 required -> 兼容未来非 run 上下文的 audit event，但要求 run-bound event 必须携带

## 归档前更新基线（Baseline Promotion Plan）

行为契约：

- `openspec/specs/ts-core-contracts/spec.md`：更新 audit event contract

设计视图：

- `openspec/designs/contracts/audit-event-spi.md`
- `openspec/designs/modules/agent-runtime.md`
- `openspec/designs/modules/agent-capability.md`
- `openspec/designs/spec-to-design-map.md`

验证入口：

- audit envelope contract tests
- runtime lifecycle audit agentId 断言
- capability audit agentId 断言

## 待确认问题（Open Questions）

无。durable audit sink 由后续独立 change 处理。
