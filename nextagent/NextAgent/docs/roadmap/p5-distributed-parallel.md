[返回 Roadmap V2](../nextagent-ts-change-roadmap-v2.md)

## P5 — 分布式与并行执行

在 P4 整体能力出口之后，补齐多实例一致性、故障接管和 Agent 层并行执行能力。P5 先收敛 Agent Gateway/StateStore 和 REMOTE provider ownership，再完成 runtime 多实例正确性、会话亲和重连和故障接管；不改变 `agent-runtime` 对请求生命周期、调度、控制和恢复的 ownership，也不让 StateStore 承担控制决策。需要调整已冻结公共契约时，必须先完成独立 contract refinement 和群内确认。

### Agent Gateway / StateStore 前置收敛

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`refine-session-fork-provider-materialization`](../nextagent-ts-changes/refine-session-fork-provider-materialization.md) | ready | 基于当前Working Memory binding把会话派生改为prepare、受预算promotion stage和provider-owned原子fork；本仓实现LOCAL，外部REMOTE按同一contract独立实现。2026-08-21需求方已批准相关`agent-contracts` breaking变化并确认本change先实施。 | [详情](../nextagent-ts-changes/refine-session-fork-provider-materialization.md) |
| [`refine-ts-agent-gateway-state-store-boundary`](../nextagent-ts-changes/refine-ts-agent-gateway-state-store-boundary.md) | blocked | 内聚完整 StateStore 并按能力组重组持久化契约；改为在会话派生change归档后rebase，无损迁移其最终fork contract、LOCAL实现和conformance资产。 | [详情](../nextagent-ts-changes/refine-ts-agent-gateway-state-store-boundary.md) |

### 多实例运行

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-runtime-multi-instance-consistency`](../nextagent-ts-changes/add-ts-runtime-multi-instance-consistency.md) | blocked | 在健康多实例下保持执行唯一、同 Session 单活，以及 submit、cancel、retry 和既有抢占语义一致。 | [详情](../nextagent-ts-changes/add-ts-runtime-multi-instance-consistency.md) |
| [`add-ts-session-affinity-reconnect-replay`](../nextagent-ts-changes/add-ts-session-affinity-reconnect-replay.md) | blocked | 在外部会话亲和约束下定义活动实例与非活动实例的重连、持久化事件回放和降级边界。 | [详情](../nextagent-ts-changes/add-ts-session-affinity-reconnect-replay.md) |
| [`add-ts-runtime-failure-takeover`](../nextagent-ts-changes/add-ts-runtime-failure-takeover.md) | blocked | 在实例故障或计划关停后，从持久化安全边界接管可恢复任务，隔离陈旧执行者并禁止不安全副作用重放。 | [详情](../nextagent-ts-changes/add-ts-runtime-failure-takeover.md) |

### 外部部署约束

- 负载均衡由部署平台提供，不属于 NextAgent 当前仓库的实现、配置、控制面或 runtime ownership。
- 外部部署平台必须支持基于健康状态的 Session affinity，并在活动实例不可用时把后续请求路由到健康实例。
- Session affinity 只是降低跨实例协调成本的路由优化，不得成为 identity、Agent Scope、Owner Scope、任务归属或执行正确性的权威来源。
- 客户端重连到非当前活动实例时，本轮只保证读取已持久化事件，不迁移 `LIVE_ONLY` delta 或进程内 subscriber；下一轮对话必须恢复提交、取消、重试和实时事件能力。
- 仓内测试通过显式把请求路由到两个 runtime 实例模拟亲和命中、亲和未命中和故障转移，不引入真实负载均衡产品。

### 并行执行

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-parallel-execution-budget`](../nextagent-ts-changes/add-ts-parallel-execution-budget.md) | candidate | Agent 层并行 DAG、并行预算、并行取消/恢复一致性。 | [详情](../nextagent-ts-changes/add-ts-parallel-execution-budget.md) |
| [`add-ts-parallel-dependency-graph`](../nextagent-ts-changes/add-ts-parallel-dependency-graph.md) | candidate | 并行执行依赖图与调度。 | [详情](../nextagent-ts-changes/add-ts-parallel-dependency-graph.md) |
| [`add-ts-parallel-result-aggregation`](../nextagent-ts-changes/add-ts-parallel-result-aggregation.md) | candidate | 并行执行结果聚合。 | [详情](../nextagent-ts-changes/add-ts-parallel-result-aggregation.md) |
| [`add-ts-parallel-execution-observability`](../nextagent-ts-changes/add-ts-parallel-execution-observability.md) | candidate | 并行执行可观测聚合。 | [详情](../nextagent-ts-changes/add-ts-parallel-execution-observability.md) |
