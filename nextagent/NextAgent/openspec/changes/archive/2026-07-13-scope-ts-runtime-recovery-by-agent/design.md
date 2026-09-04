## 背景和现状（Context）

当前 `SystemListRecoverableRunsRequest` 只包含 `now` 和 `limit`，SQLite adapter 对整个 `request_runs` 表扫描 recoverable records。`RequestLifecycleCoordinator.recoverLocalRuntime()` 将所有结果交给当前 runtime 处理，其中 `EXECUTING` 会先 `claimRun`，但 `ACCEPTED`、`QUEUED`、`PLANNING` 直接重建 scheduler work。Stable `local-run-timeline-store` 把该行为定义为系统级全局恢复，stable `local-runtime-recovery` 又以本地单实例为边界；两者都不符合“一个 NextAgent 应用绑定一个 Agent、可能存在多个不同 Agent 应用以及同 Agent 短暂多副本”的实际部署模型。

当前代码与目标规格存在四项 gap：gateway discovery 无 `agentId` 条件；`request.now` 未参与 SQLite lease 筛选；`request_runs` 私有 row 没有可供 SQL 筛选的 `locked_by`/`lock_expires_at` 列；queued-like states 未 claim 即重建。`claimRun` 已具备 Agent Scope、Owner Scope、version CAS 和 lease 字段，可复用而无需引入新 persistence owner 或新 claim store，但 gateway-local 必须补齐 Record lease 字段到 SQLite row 的显式映射。

相关方包括 `agent-app` composition、`agent-runtime` lifecycle/scheduler、`agent-contracts/gateway`、`agent-platform-gateway-local` 和部署多个 Agent-bound NextAgent 应用的运维系统。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 每个 runtime recovery pass 只发现 app composition 绑定 Agent 的 recoverable runs。
- 同一 Agent 下所有 tenant/subject 的候选可被统一发现，但所有后续操作继续使用 record 的完整 Agent Scope 和 Owner Scope。
- 所有可能重新进入 scheduler/execution path 的 run 在重建前通过同一个 scoped CAS claim 取得单实例所有权。
- 有效 lease 阻止接管，过期 lease 允许同 Agent 实例重新竞争。
- 保持 bounded scan、terminal commit idempotency、same-session lane 和 existing recovery report 行为。

**非目标：**

- 不按 tenant/user 切分 recovery discovery。
- 不引入 distributed consensus、leader election、worker registry 或新外部依赖。
- 不提供 Web/Channel recovery API，也不允许客户端指定 recovery Agent。
- 不改变 `RequestRunRecord` durable shape、terminal commit transaction 或 Agent assembly 固化规则。
- 不在本 change 中实现后台持续轮询；仍由既有 startup recovery 入口触发 bounded pass。

## 设计决策（Decisions）

### D1：Recovery ownership 由不可变 `recoveryAgentId` composition dependency 表达

`agent-app` 必须从可信 hosted-agent selection/composition 向 `RequestLifecycleCoordinator` 显式注入 `recoveryAgentId: AgentId`，`recoverLocalRuntime()` 内部直接使用它。为兼容不启用 recovery 的窄测试构造器，该 dependency 在通用构造类型上保持 optional；一旦调用 recovery 而未注入，入口必须 fail closed，不得回退到 `defaultRouteAgentId` 或执行全局扫描。`LocalRuntimeRecoveryOptions` 继续只承载 `limit`、`lockedBy`、`lockTtlMs` 等运行参数，不增加 `agentId`。

选择该方案是因为 recovery ownership 是应用实例的信任边界，不是单次命令参数。放弃“调用 `recoverLocalRuntime({ agentId })`”方案，原因是它允许同一个 coordinator 被调用时切换恢复 Agent，削弱不可变所有权。放弃复用 `defaultRouteAgentId`，原因是默认路由 fallback 与恢复所有权语义不同，未来 hosted-agent routing 变化时不应隐式改变 recovery scope。

### D2：Gateway discovery contract 改为 `AgentListRecoverableRunsRequest`

删除 `SystemListRecoverableRunsRequest`，新增：

```ts
interface AgentListRecoverableRunsRequest {
  readonly agentId: AgentId;
  readonly now: EpochMillis;
  readonly limit: number;
}
```

`RequestRunStoreGateway.listRecoverableRuns` 使用该 request。它不继承 `OwnerScoped`，因为 discovery 需要覆盖该 Agent 下所有 tenant/subject；每条返回的 `RequestRunRecord` 仍包含 owner coordinates。该变更属于 frozen core contract 敏感变更，由本 OpenSpec change 明确定义，所有 gateway implementation、test doubles 和 contract tests 必须同步迁移，不保留平行 overload。

### D3：SQLite 私有 row 显式映射 lease，并在 SQL 层执行 Agent 和 lease 筛选

`request_runs` SQLite 私有 row 在首版建表定义中增加 nullable `locked_by TEXT` 和 `lock_expires_at INTEGER`。`putRun`/row mapping owner 必须从 `RequestRunRecord.lockedBy`、`RequestRunRecord.lockExpiresAt` 同步写入这两列；JSON 中的既有 Record 字段继续保留，public `RequestRunRecord` shape 不变。当前为首个版本且没有存量数据库，本 change 不增加 `ensureColumn`、schema migration 或旧 row 兼容逻辑。

SQLite query 增加 `agent_id = ?`，并只返回未持有有效 lease 的候选：`lock_expires_at IS NULL OR lock_expires_at <= request.now`。排序固定为 `updated_at ASC, created_at ASC, run_id ASC`，limit 继续归一化到 `1..1000`。

新增 recovery index：

```sql
CREATE INDEX IF NOT EXISTS idx_request_runs_recovery
ON request_runs(agent_id, status, terminal_commit_state, lock_expires_at, updated_at, created_at, run_id);
```

Agent/lease filtering 必须在 SQL 中完成，不能通过 `json_extract` 或先读取全局 records 再由 runtime 过滤。独立 typed columns 保持 query/index 可预测，并避免 JSON 表达差异破坏 lease 比较。放弃按 owner 分页扫描，因为一个应用负责 Agent 下所有 owners，额外 owner fan-out 只增加复杂度。

### D4：所有重新执行状态统一 claim-before-rebuild

Recovery loop 对 `ACCEPTED`、`QUEUED`、`PLANNING`、`EXECUTING` 使用同一个私有 claim helper。Helper 从 candidate record 取 `tenantId`、`subjectId`、`agentId`、`runId`、`version`，结合当前 recovery holder 和 lease expiry 调用现有 `claimRun`。只有 `UPDATED` 且返回 record 完整时才能继续，并且后续重建必须使用 claim 返回的最新 record。

Queued-like states claim 成功后调用既有 `rebuildQueuedRun` 并进入 scheduler；`EXECUTING` claim 成功后调用既有 executing recovery。`VERSION_CONFLICT`、`NOT_FOUND` 或不完整 result 统一计入 skipped，不 enqueue、不执行、不 fail 一个可能已被其他实例合法接管的 run。

Terminal `PENDING`/`RETRYING` 不重新调用 Agent/Model/Capability，继续由现有 terminal idempotency/CAS reconciliation 处理；不为该路径新增第二套 lease protocol。

### D5：Lease holder 使用 composition 提供的实例标识

`lockedBy` 默认值由 `agent-app` composition 提供的当前 runtime instance identifier 构成，并在同一进程生命周期内稳定、不同并发实例间不同。显式 test options 仍可覆盖以构造 deterministic fixtures。该标识只用于 claim ownership/诊断，不作为 authorization，也不得包含 host path、credential、tenant/user 或其他敏感内容。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | Recovery Agent Scope 只来自 app composition；discovery 不接受 owner/client scope；后续读写继续按 record 的 Agent+Owner Scope。 | 跨 Agent negative contract test、composition architecture test、模型语义 review |
| 性能/容量 | lease 映射到 typed SQLite columns；SQL 在读取前按 `agent_id`、state、lease 过滤并使用 recovery index；单次 limit 保持 `1..1000`。 | SQLite contract test、query plan/code review 检查点、既有 bounded recovery tests |
| 可靠性/恢复 | 所有重新执行状态统一 CAS claim；有效 lease 不可见，过期 lease 可接管；terminal path 继续使用既有幂等边界。 | 双实例竞争 characterization test、lease expiry test、terminal recovery regression tests |
| 可维护性 | 复用一个 `claimRun` contract 和一个 runtime helper，不新增 owner query、claim store 或并行 recovery abstraction。 | build、Clean Code review、architecture lint |
| 可测试性 | clock、lockedBy、lock TTL 和 gateway ports 保持可注入；双 runtime 可共享同一 test gateway 构造确定性竞争。 | focused Vitest、gateway contract suite |
| 审计/可追溯性 | 既有 recovery scan/claim diagnostics 保留 Agent 和 run coordinates；holder 仅使用安全实例标识，不记录 prompt、delta 或 owner payload。 | observability assertions、security review |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| Discovery request 必须携带可信 Agent Scope | 1.1、1.2 | TypeScript build、composition tests |
| SQLite 私有 row 正确映射 lease 且不返回其他 Agent records | 2.1、2.2、2.5 | row mapping test、gateway contract cross-agent negative test |
| 同 Agent 不同 owners 均可发现 | 2.2、2.4 | gateway contract owner aggregation test |
| `now` 排除有效 lease并允许过期 lease | 2.2、2.4 | deterministic clock/lease contract tests |
| Queued-like states 必须 claim-before-rebuild | 3.1、3.2 | runtime characterization tests |
| 同 Agent 双实例只有一个实例 enqueue/execute | 3.2、3.4 | shared-gateway concurrency test |
| 后续事实读取保留 Agent+Owner Scope | 3.1、3.5 | existing recovery tests + scope negative assertions |
| Frozen contract、架构和 minimal kernel 不回归 | 4.1、4.2、4.3 | build、test、contract、architecture、OpenSpec strict validation |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/local-run-timeline-store/spec.md` 主承载 discovery/claim 可验证行为；`openspec/specs/local-runtime-recovery/spec.md` 主承载 runtime recovery 行为。
- 架构和跨模块设计：`openspec/designs/architecture/core-contracts.md` 主承载 gateway contract shape；现有 runtime lifecycle/recovery architecture 文档主承载 composition-to-runtime-to-gateway 恢复流程。
- 模块设计：`openspec/designs/modules/agent-runtime.md`、`agent-platform-gateway-local.md`、`agent-app.md` 分别承载各模块职责和 contract 消费关系。
- ADR：无。本决策直接应用既有 Agent Scope 和 CAS/lease 原则。
- 导航：`openspec/designs/spec-to-design-map.md` 连接两个 specs 与上述 architecture/modules 及验证入口。

## 风险与取舍（Risks / Trade-offs）

- [Frozen gateway contract 破坏性修改] -> 在单一 change 内同步所有 implementations、test doubles、tests 和设计文档，不保留旧 request alias。
- [同 Agent 长时间运行实例的 lease 到期但执行尚未完成] -> 本 change 保持既有 300 秒默认 TTL，不新增 heartbeat；运行时间超过 TTL 的动态续租属于后续独立 change。在 startup-only recovery 模型下，新实例只在启动 pass 竞争，风险受限但需在任务验证中记录。
- [新增 typed lease columns 和索引增加 request run 写放大] -> columns 仅复制既有 Record lease metadata，索引只服务 bounded recovery；通过 mapping 和 query review 验证一致性。
- [JSON 与 typed lease columns 不一致] -> `putRun` 是唯一 row mapping owner，必须在同一 SQLite write 中同时更新 JSON 和 typed columns；contract test 通过 claim 后 discovery 行为验证映射一致性。
- [不同 Agent 误共享相同 `recoveryAgentId`] -> composition tests 强制绑定显式可信 Agent；部署配置正确性由启动配置校验负责。
- [Terminal takeover 未使用统一 claim] -> terminal path 不产生新的 Agent/Model/Capability invocation，并已有 terminal idempotency/CAS；保持单一 terminal ownership mechanism，避免双重锁状态机。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/local-run-timeline-store/spec.md`：归并 Agent-scoped discovery、lease filtering 和 scoped CAS claim 行为。
- `openspec/specs/local-runtime-recovery/spec.md`：归并 Agent-bound startup recovery 与 claim-before-rebuild 行为。
- `openspec/designs/architecture/core-contracts.md`：更新 `AgentListRecoverableRunsRequest` 和 `RequestRunStoreGateway`。
- 现有 runtime lifecycle/recovery architecture 文档：归并可信 Agent ownership、discovery、claim、scheduler 和 terminal takeover 流程。
- `openspec/designs/modules/agent-runtime.md`：归并 recovery owner 和 claim helper 责任。
- `openspec/designs/modules/agent-platform-gateway-local.md`：归并 lease 私有 row 映射、SQL filter/index/query 责任。
- `openspec/designs/modules/agent-app.md`：归并 `recoveryAgentId` 和 runtime instance identifier 的可信 composition 责任。
- `openspec/designs/spec-to-design-map.md`：更新 specs、design 和验证入口导航。

## 待确认问题（Open Questions）

无。
