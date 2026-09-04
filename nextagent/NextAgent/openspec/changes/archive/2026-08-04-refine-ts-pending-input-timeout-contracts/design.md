# Design: refine-ts-pending-input-timeout-contracts

## 设计范围

| Function | 目标变化 | delta specs | Function 设计章节 |
|---|---|---|---|
| FN-6.5 请求用户确认或授权 | 把 unresolved timeout fact discovery 收敛为可信 Agent Scope 内的有界、确定性、可恢复查询，并移除全局 due query | `ts-core-contracts`（REMOVED legacy Requirement）、`human-pending-input-core`（ADDED canonical Requirements） | 见下 |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 迁移结果 |
|---|---|---|
| `ts-core-contracts` / `Pending input gateway fact queries` | FN-6.5 / `human-pending-input-core` | 来源 Requirement 整体 REMOVED；timeout discovery 的可观察集合、scope、顺序、容量、失败和不可暴露边界迁入三个 ADDED Requirements；request/method、Record、index、join 与 adapter 细节留在本 design。 |
| 同一 legacy Requirement 的 active-pending session-lane 场景 | FN-6.5 / 既有 `human-pending-input-core` | 用户可见的“active pending 阻止同会话 submit”已由 stable `Active pending blocks same-session submit` 承载，行为未变化，不制造重复 delta；唯一 active fact 的 gateway/constraint 细节留在本 design。 |

迁移后不退役 `ts-core-contracts` spec；该 spec 的其他 Requirements 完全未触及并继续原位保留。

## FN-6.5 请求用户确认或授权

### 目标与规范依据

系统必须在可信 Agent Scope 内有界、稳定地发现全部已接受 deadline 的 unresolved timeout facts，并保留各事实的 Owner coordinates；发现事实不决定是否到期，不对 Web/channel、Agent Core、model、capability 或客户端形成新查询面。

本 Function 的目标 Requirements：

- canonical spec：`human-pending-input-core`
- ADDED：`系统在可信 Agent Scope 内发现未完成 timeout facts`、`Timeout fact discovery 保持可信 scope 隔离`、`Timeout fact discovery 使用有界稳定遍历`
- legacy source：`ts-core-contracts` / `Pending input gateway fact queries`（REMOVED）

### 当前实现

`packages/agent-contracts/src/gateway/index.ts` 定义 `ListDuePendingInputsRecordRequest { now, limit }` 和 `PendingInputStoreGateway.listDuePendingInputs(...)`。请求没有 `agentId`，因此 gateway 无法把后台扫描限定到 app composition 的可信 Agent Scope。

`packages/agent-platform-gateway-local/src/db/sqlite-gateway-core.ts` 的实现只查询 `pending_inputs.status='PENDING' AND timeout_at<=now`，按 `timeout_at, pending_input_id` 排序，并把 `limit` 静默截断到 1000。`idx_pending_inputs_due(status, timeout_at, pending_input_id)` 支持状态与时间过滤，但不能以 Agent Scope 作为前导条件。查询不关联 `request_runs.terminal_commit_state`。

`packages/agent-runtime/src/lifecycle/submit.ts` 已把 refined candidate query 用于 submit、startup recovery 和新增的一秒 polling。`resolvePendingInput` 已支持确定性 idempotency key 重放；canonical pending input event 与 terminal commit 也已有确定性幂等边界。因此恢复半完成 timeout 不需要新状态、新表或新幂等记录。新的 deadline-driven runtime 调度还需要从同一查询读到未来 deadline，而当前 `now` 过滤只能回答“现在谁已到期”。

现有 SQLite `pending_inputs` 与 `request_runs` 已持久化筛选所需的 `agent_id`、`timeout_at`、pending status、run coordinates 和 terminal commit state。当前测试覆盖 due `PENDING` 查询、稳定排序与 limit 校验，但没有跨 Agent Scope 负例和 `TIMED_OUT + terminal not committed` 恢复候选。

### GAP 分析

1. 旧 due query 不携带可信 `agentId`，持续处理会跨 Agent Scope 扫描。
2. 旧查询只返回已到期 `PENDING`，无法统一计算 future deadline，也无法恢复 terminal 未提交的 `TIMED_OUT`。
3. `now` 过滤把 due decision 放入 gateway，且 offset/无 cursor 方案不能稳定遍历同 deadline 大集合。
4. 必须原子迁移 contract、adapter、runtime consumer 与测试替身，不得保留旧 alias 或双读。

### 修改方案

#### 唯一公共契约

`agent-contracts/gateway` 以以下最小 shape 替换旧请求和方法：

```ts
export interface PendingInputTimeoutFactCursor {
  readonly timeoutAt: EpochMillis;
  readonly pendingInputId: PendingInputId;
}

export interface AgentListUnresolvedPendingInputTimeoutFactsRequest {
  readonly agentId: AgentId;
  readonly limit: number;
  readonly after?: PendingInputTimeoutFactCursor;
}

export interface PendingInputStoreGateway {
  listUnresolvedPendingInputTimeoutFacts(
    request: AgentListUnresolvedPendingInputTimeoutFactsRequest
  ): Promise<readonly PendingInputRecord[]>;
}
```

`agentId` 只能来自 runtime 已注入的可信 scope。请求不接收 `tenantId` 或 `subjectId`，因为它是一个 Agent app instance 内部维护该 Agent 下全部 Owner Scope 的 system operation，不是代表某个用户发起的 read。返回的每条 `PendingInputRecord` 继续携带原始 owner coordinates，后续 lifecycle write 仍逐条使用完整 Owner + Agent Scope。

`after` 只服务一次 processing pass 内的 keyset pagination。调用方在返回满页时取最后一条 record 的 `request.timeoutAt` 与 `pendingInputId` 构造下一次请求；返回不足一页时结束本 pass。下一 pass 不复用 cursor。该坐标不持久化，不进入 Web、stream、activity 或 Record。

`limit` 的公共合法范围固定为 `1..1000`。contract 和 adapter 都拒绝范围外值，不再静默 clamp，避免调用方以为扫描了请求的完整范围。

#### Fact 筛选与 SQLite 映射

SQLite 查询固定使用以下逻辑：

1. `pending_inputs.agent_id = request.agentId`；
2. `timeout_at IS NOT NULL`；
3. status 为 `PENDING`，或者 status 为 `TIMED_OUT` 且不存在 owner+agent+run 坐标匹配并已 `terminal_commit_state='COMMITTED'` 的 RequestRun；
4. 若存在 `after`，只保留 `(timeout_at, pending_input_id)` 严格大于 cursor 的行；
5. 按 `timeout_at ASC, pending_input_id ASC` 排序并应用 validated limit。

使用 `NOT EXISTS committed run` 而不是 inner join。这样 missing owning run 仍作为“不完整”候选返回，由 runtime 通过既有 safe recovery failure 路径报告；gateway 不把数据不一致静默解释成已完成。

删除旧 `idx_pending_inputs_due` 与当前未归档实现的 `idx_pending_inputs_timeout_candidates`，并创建 `idx_pending_inputs_timeout_facts(agent_id, timeout_at, pending_input_id, status) WHERE timeout_at IS NOT NULL`。`agent_id, timeout_at, pending_input_id` 对齐 scope filter 与稳定 keyset order，`status` 只用于同一索引上的 fact filter。`request_runs` 的 scoped run lookup 与 terminal fields 已存在，不新增列或表。使用新索引名让本次 artifact升级完成替换，后续启动只执行幂等的 `CREATE INDEX IF NOT EXISTS`。

#### 边界保持

- `PendingInputStoreGateway` 仍只返回 durable Record，不返回 due decision、next deadline DTO 或调度状态。
- gateway 不执行 CAS、不发布 event、不 terminalize run，也不决定 timeout policy。
- runtime 是唯一调用者；channel、frontend、Agent Core、Capability 与 model 不导出该查询。
- 删除 `ListDuePendingInputsRecordRequest` 和 `listDuePendingInputs` 后，全部 adapter、test double 与调用方一次性迁移，不建立 alias。

#### 备选方案

按 Owner Scope 扫描会要求 app 枚举当前 Agent 下的 owner，并产生 owner 目录依赖；它也会让新 owner 或离线 owner 的 timeout 依赖目录同步，未采用。

只给现有查询增加 `agentId` 无法重新发现已 CAS 为 `TIMED_OUT` 但 terminal commit 未完成的事实，不能修复部分失败，未采用。

不提供 keyset cursor、只重复 fixed-limit 首屏，会让持续失败的早序 candidate 阻塞后续 candidate；使用 offset 又会在 candidate 状态变化时跳行或重复，未采用。

保留 `now` 并另加 next-deadline query 会形成两个语义重叠的 timeout read contract。返回全部 unresolved durable facts 让 runtime 在一个 bounded keyset flow 中处理 due、恢复 incomplete 并计算最早 future deadline，不新增第二个方法。

建立 timeout observation 表会复制 pending input 和 RequestRun 已存在的持久化事实，并引入新的事务一致性问题，未采用。

#### 质量属性影响

- 安全：查询必须先按可信 `agentId` 过滤；Owner Scope 不作为扫描输入，但每条写回继续使用 record 自带 owner coordinates。contract 与 architecture negative test 防止 Web/channel 暴露和全局扫描回归。
- 性能/容量：查询有 `1..1000` limit、Agent-leading partial index 与 keyset pagination；`NOT EXISTS` 使用现有 scoped run lookup，不进行 JSON/full-table scan。runtime 只在启动、deadline、新建更早 deadline 或故障退避时调用，不再固定每秒查询。
- 可靠性/恢复：candidate 集合同时覆盖未转换和已转换未 terminal committed 两类 durable gap；稳定 cursor 让单条失败不阻塞后续记录。
- 可维护性：只保留一个 request、一个 gateway method 和一个 SQLite query；旧名称完全移除。
- 可测试性：clock、Agent Scope、cursor、status、terminal state 与 limit 都是确定性输入，适合 contract 和 adapter integration test。
- 审计/可追溯性：不新增 audit vocabulary；runtime 继续用 pending id、run id 与既有安全日志定位处理结果，查询不返回 raw content。

## 验证策略（Verification Strategy）

TypeScript contract tests验证新 request/method 可用且旧名称不可用。Gateway integration tests覆盖未来与已到期 `PENDING`、未完成 `TIMED_OUT`、排除已解决/已提交事实、跨 Agent Scope 隔离、跨 Owner Scope 保留、稳定排序、keyset 前进和非法 limit。Architecture tests证明该 method 只由 runtime 消费且未进入 Web/channel public surface。OpenSpec strict validation与模型语义审查确认 frozen core contract replacement 和后续 lifecycle change 的依赖关系。

## 长期基线刷新计划

- stable specs：从 `ts-core-contracts` 移除 legacy `Pending input gateway fact queries`，在 `human-pending-input-core` 合并三个 timeout fact discovery Requirements；该主规格既有 active-pending 黑盒行为不变。
- Function：刷新 `FN-6.5 请求用户确认或授权` 的描述、输入、处理过程、结果、接口、量化指标、主规格和遗留规格导航。
- architecture：刷新 `core-contracts.md` 的 gateway request/port 边界及 timeout fact discovery 语义。
- modules：刷新 `agent-platform-gateway-local.md` 的 Agent-scoped indexed query；`agent-runtime.md` 的调度由后续 lifecycle change 刷新。
- overview、Feature、ADR：无。
- spec-to-design-map：移除 legacy Requirement 导航并增加 canonical timeout Requirement 的设计和验证入口。

## 风险与取舍（Risks / Trade-offs）

`TIMED_OUT` fact 需要对 `request_runs` 做 existence check；启动或大量 deadline 同时到达时会读取当前 Agent Scope 下全部 unresolved timeout facts。Agent-leading pending index、scoped run key、bounded keyset page 和 Owner+Agent session 容量限制该成本；健康空闲期不产生重复查询。

schema initialization drop/recreate index 会在首次升级打开数据库时产生短暂 DDL 成本，但不改数据、不需要 backfill。该 index 是 adapter-private，可以随代码原子升级。

## 迁移与回滚（Migration / Rollback）

这是 monorepo 内破坏性 TypeScript contract replacement，contract、runtime、local adapter 与全部 test double 必须在同一提交范围内迁移，不支持新旧 package 混用。

升级时先加载包含新 contract 与 adapter 的完整 artifact；SQLite initialization 删除旧索引并创建新索引，然后 runtime 才可启动 lifecycle worker。若验证失败，回滚整个 artifact；旧代码可继续使用表数据并按旧定义重建旧索引，新索引作为 adapter-private DDL 可由回滚迁移删除。没有数据迁移或数据丢失。

## 需群内确认

已确认（2026-07-31，当前会话用户在获知 PR 803 的 OpenSpec 阻塞项包含该 breaking gateway contract replacement 后，回复“OK，先修正OpenSpec文档，先不动代码，修正完做review”）：

- 以 `AgentListUnresolvedPendingInputTimeoutFactsRequest` 和 `listUnresolvedPendingInputTimeoutFacts(...)` 完整替换 `ListDuePendingInputsRecordRequest` 与 `listDuePendingInputs(...)`，不保留 alias 或双读兼容期。
- 新查询以可信 `agentId` 为 scope，返回 future/due `PENDING` 与 terminal 未提交的 `TIMED_OUT`，不接收 `now`，不拥有 due decision。
- contract、local adapter、runtime consumer 与 test doubles 必须原子迁移；本确认不授权新增代码修改，只补齐已存在 PR 803 变更的独立治理记录。

## 待确认问题（Open Questions）

无。
