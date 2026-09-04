## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-8.1 持久化运行数据` | Working Memory gateway 提供 scoped RequestRun 批量分页查询 | `gateway-store-provider-ownership` | `FN-8.1 持久化运行数据` |

## `FN-8.1 持久化运行数据`

### 目标与规范依据

本设计为平台集成方提供 LOCAL/REMOTE 一致的 RequestRun 批量查询边界。现有业务调用方和单条 RequestRun lifecycle 查询保持不变。

#### 本 Function 的目标 Requirements

canonical spec：`gateway-store-provider-ownership`

- `ADDED`：`RequestRun 批量分页查询`
- `ADDED`：`RequestRun 批量查询有界且隔离 scope`

### 当前实现

- `RequestRunStoreGateway` 只有 `loadRun(RequestRunLookupRequest)` 单条读取，以及 lane snapshot、recoverable runs 等专用查询；没有按 ID 集合分页读取的公共契约。
- LOCAL Working Memory 由 `SqliteRequestRunStore` 委托 `SqliteGatewayCore`。`request_runs` 表以 `(tenant_id, subject_id, agent_id, run_id)` 为主键，并已有 `(tenant_id, subject_id, agent_id, session_id, created_at DESC, run_id DESC)` lane 索引。
- AgentMemory 的真实 REMOTE adapter 位于外部仓库；本仓库 remote reference provider 只接收部署方注入的完整 `WorkingMemoryGatewayBindings`，不拥有或模拟 AgentMemory client。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 按 `sessionIds`、`runIds` 或交集稳定分页查询 | 只有单条 `loadRun` | 缺少公共 query/page contract 和 provider 实现 |
| `limit` 最大 100、非法输入在读取前失败 | 当前无对应批量入口 | 缺少统一 validation 和确定错误 |
| Owner Scope 与 Agent Scope 完整隔离 | 单条读取已 scoped | 新批量 SQL 必须把相同 scope 条件应用到所有过滤组合 |
| REMOTE 一次批量操作 | reference provider 只转发注入 binding | 新 required 方法必须由部署方作为原生批量操作实现，不得在 adapter 内逐 ID fan-out |

### 修改方案

1. 在 gateway public contract 中增加 `RequestRunListQuery`、`RequestRunRecordPage`，并在 `RequestRunStoreGateway` 增加必需的 `listRuns`。公共字段和失败语义以 delta spec 为唯一来源；`loadRun` 保持原签名和语义。
2. `SqliteRequestRunStore.listRuns` 只负责委托 `SqliteGatewayCore.listRuns`，保持现有 facade 结构。
3. `SqliteGatewayCore.listRuns` 首先执行纯输入校验。通过后始终以 `tenant_id/subject_id/agent_id` 构造基础谓词，再根据存在的 `sessionIds` 和 `runIds` 追加参数化 `IN` 条件；两个集合同时存在时自然形成 `AND`。查询按 `created_at DESC, run_id DESC` 排序，使用 `LIMIT limit+1 OFFSET offset` 判定 `hasMore`，只解析前 `limit` 个 JSON record。现有主键和 lane 索引分别覆盖 run ID 与 session ID 主过滤路径，本 change 不改变 schema。
4. 校验失败统一抛出不携带输入值的 `AgentError(REQUEST_RUN_QUERY_INVALID, VALIDATION, retryable=false)`。校验在 SQL prepare/execute 前完成，避免非法无过滤查询访问数据。
5. REMOTE reference provider 保持不变，不新增测试替身或 provider-private client。由于 `RequestRunStoreGateway.listRuns` 是 required，外部仓库中的远端 binding 实现方必须提供真实批量实现，并在其仓库完成 AgentMemory wire contract 和一次远端请求的验证；本仓库只提供编译期公共 contract。
6. 所有现有 `loadRun` 消费方保持不变。本 change 只提供 gateway 能力，不迁移 conversation share 或其他业务路径；调用方迁移需要独立 change 定义其业务不变量和验证范围。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `RequestRun 批量查询有界且隔离 scope` | 每种过滤组合都先固定完整 Owner/Agent scope；非法空过滤在 SQL 前失败 | 跨 tenant、subject、agent 的同值 ID 不可见；空过滤失败 |
| 性能/容量 | `RequestRun 批量查询有界且隔离 scope` | 单页 `limit<=100`，SQLite 使用参数化集合谓词和 `limit+1` | 最大页、下一页；外部 REMOTE adapter 的单请求验证由其仓库负责 |
| 可靠性/恢复 | `RequestRun 批量分页查询` | 稳定排序和显式 `hasMore` | 相同时间戳分页稳定，缺失 ID 不影响其他匹配结果 |
| 可测试性 | `RequestRun 批量分页查询`、`RequestRun 批量查询有界且隔离 scope` | public query/page shape 与 provider-neutral contract 可由 LOCAL/REMOTE 共用测试替身验证 | contract 与 LOCAL integration 分层覆盖 |

#### 备选方案（Alternatives Considered）

- 让业务调用方使用 `Promise.all(loadRun)`：仍产生 N 次 REMOTE 请求，只改变并发方式，因此不作为 gateway 批量能力的替代方案。
- 返回 `total`：需要额外 count 查询，而当前批量解析只需要判断下一页；仓库已有 `limit+1/hasMore` 分页模式，选择后者以减少查询成本。

## 验证策略（Verification Strategy）

- contract/type 验证覆盖 query/page 字段和 required `listRuns`；外部 REMOTE binding 的实现完整性不在本仓库伪造验证。
- LOCAL integration 验证单 filter、双 filter 交集、去重、稳定排序、offset/limit/hasMore、最大页和 scope 隔离。
- negative case 验证缺少过滤集合、空数组、非法 offset、`limit=0` 与 `limit=101` 都产生确定 validation error，且不退化为全量查询。
- build、contract suite、architecture lint 和 OpenSpec strict validation 覆盖公共契约升级及跨 package 边界。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/gateway-store-provider-ownership/spec.md`：合并 RequestRun 批量分页查询和有界 scope 隔离 Requirements，并补齐 `FN-8.1` 主规格元数据。
- `openspec/designs/functions/D8-数据与记忆/D8.1-持久化/FN-8.1-持久化运行数据.md`：刷新描述、输入、输出和结果；现有规格字段不在本 change 触达范围。
- Feature：无；用户价值和 Function 组成不变。
- `openspec/overview.md`：补充 Working Memory RequestRun 批量读取和 REMOTE N+1 消除的长期背景。
- `openspec/designs/architecture/core-contracts.md`：补充 RequestRun batch query/page 公共 contract 与 scope、分页边界。
- `openspec/designs/modules/agent-contracts.md`：补充新增 gateway 类型和 required port 方法。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充 LOCAL 参数化批量查询、排序和校验实现。
- `openspec/designs/modules/agent-platform-gateway-remote.md`：说明本仓库只声明/转发 binding，真实 REMOTE adapter 位于外部仓库。
- ADR：无；该选择是既有 provider-neutral gateway 和分页模式的直接延伸。
- `openspec/designs/spec-to-design-map.md`：更新 `gateway-store-provider-ownership` 的设计导航和验证入口。

## 风险与取舍（Risks / Trade-offs）

- 新 required 方法会使未升级的 REMOTE Working Memory adapter 不兼容。通过编译期 contract 和 provider contract test 使不兼容显式暴露；部署时必须先升级 adapter，再升级 NextAgent runtime。
- 动态 `IN` 谓词长度受调用方 ID 数量影响。结果页有 100 条上限，调用方仍需遵守业务侧容量约束；若未来需要超大集合，应新增独立 change 定义 filter cardinality 和分片语义。
- offset 分页在并发写入时可能看到页漂移，这是现有 offset 分页的一般取舍；本 change 通过确定排序避免同一快照内的不稳定，不承诺跨查询快照隔离。

## 迁移与回滚（Migration / Rollback）

- 发布前先升级所有 REMOTE Working Memory adapter，使其实现 `listRuns`，再发布使用该 required contract 的 NextAgent runtime。
- LOCAL 数据无需迁移，也不新增索引或表。
- 若 REMOTE adapter 尚未完成，必须阻止 runtime 升级，不能在产品路径用逐条 `loadRun` fallback 掩盖缺失能力。
- 回滚 runtime 后旧 adapter contract 恢复；新增方法保留在 adapter 中不会改变旧 runtime 行为。

## 待确认问题（Open Questions）

无。
