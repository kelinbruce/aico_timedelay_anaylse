## 设计范围

- `FN-8.5 长期记忆 search/list/detail/count/state transition`：在 `memory-core` 主规格增加有界批量新增及 management boundary 目标；`long-term-memory-management-contract` 仅承载三个被触及 Requirements 的迁出。本 Function 的实现设计见“`FN-8.5 长期记忆 search/list/detail/count/state transition`”。

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | delta operation | 处理方式 |
|---|---|---|---|
| `long-term-memory-management-contract` / `长期记忆管理提供唯一 Channel 端口` | `FN-8.5` / `memory-core` | 来源 `REMOVED`，目标 `ADDED` | 保留唯一 Channel port 边界，把 operation 集合更新为包含 batch create 的 13 项。 |
| `long-term-memory-management-contract` / `Management 调用使用可信 Scope 和取消上下文` | `FN-8.5` / `memory-core` | 来源 `REMOVED`，目标 `ADDED` | 保留可信 scope 与取消边界，把适用 method 数更新为 13 并明确批量中断行为。 |
| `long-term-memory-management-contract` / `Management Boundary 由 Composition 显式启用` | `FN-8.5` / `memory-core` | 来源 `REMOVED`，目标 `ADDED` | 保留 composition owner 边界，把委托 route 数更新为 13。 |

`long-term-memory-management-contract` 中 `Management DTO 与 Gateway Record 保持分层` 和 `Application Service 统一委托和安全错误` 未被本 change 触及，继续原位保留。三个迁移目标只属于 `FN-8.5`，白盒 owner 和调用链由本 design 承载。归档后 legacy spec 仍有未迁移 Requirements，因此不退役该 spec；Function、Feature 和 spec-to-design-map 只把 `memory-core` 标记为 canonical 主规格并保留 legacy 导航。实施前确认不存在未协调修改这三个来源 Requirements 的并行 active change。

## `FN-8.5 长期记忆 search/list/detail/count/state transition`

### 目标与规范依据

在不改变逐条记忆操作的前提下，为管理调用方增加每批 1 至 100 条的批量新增，并保持逐项安全准入、容量限制、幂等和可核对结果。

本 Function 的目标 Requirements，唯一 canonical spec 为 `memory-core`：

- `ADDED`：`长期记忆批量新增保持逐项准入和结果可核对`
- `ADDED`：`长期记忆管理提供唯一 Channel 端口`
- `ADDED`：`Management 调用使用可信 Scope 和取消上下文`
- `ADDED`：`Management Boundary 由 Composition 显式启用`

### 当前实现

- `agent-channel-web` 已通过 runtime schema 校验和 trusted resolvers 构造管理 scope，但当前只注册 12 个长期记忆 routes。
- `LongTermMemoryManagementPort` 和 `LongTermMemoryStoreGateway` 只暴露逐条新增；浏览器导入代码预期的 `POST /api/v1/memory/long-term-mem/batch` 在 `main` 不存在。
- `agent-memory` 的写入 coordinator 已统一拥有逐条 save/manual save 的知识安全准入；management service 已拥有逐条 `CONFIGURED` 记忆的 50 条容量校验。
- local Gateway 已有 `saveLongTermMemory` 的字段、scope、幂等、状态和 FTS 写入路径，但没有批量协调入口。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 1 至 100 条批量请求具有稳定 REST 和 management contract | 当前没有 batch route 或 method | 缺少公共 schema、Channel 投影和 management method。 |
| 每项独立经过内容安全、容量和幂等写入 | 相关规则只在逐条路径存在 | 缺少复用逐条准入与写入的有界批量协调。 |
| 返回可核对的部分成功结果 | 当前逐条接口只返回单条 record | 缺少批量结果类型和计数不变量。 |
| 所有管理操作继续使用唯一 port 与可信 scope | stable legacy Requirement 固定为 12 项 | contract、composition 测试和规范需要同步为 13 项并迁入 canonical spec。 |

### 修改方案

唯一实现路径如下：

1. `agent-contracts/channel` 新增 batch management item、command、result 和 `batchCreateLongTermMemory`；command 继承现有 `LongTermMemoryManagementScope`，条目不出现 owner 或 Agent 字段。
2. `agent-channel-web` 为 `POST /api/v1/memory/long-term-mem/batch` 增加 strict TypeBox schema，先整体校验 `items` 数量和字段 allowlist，再以 trusted resolvers 构造一次 scope，最后只调用 management port。
3. `agent-memory` management service 把每条 `idempotencyKey` 映射到 Gateway write options；write coordinator 按输入顺序逐条执行现有知识安全准入，仅把通过条目交给 Store Gateway，并把准入失败数并入结果。
4. `agent-contracts/gateway` 和 local Gateway 新增有界 batch create。local Gateway 对每项复用 `saveLongTermMemory` 的同步校验、scoped anchor、FTS 和 transaction 路径；每项独立 transaction，使单项失败不回滚其它成功项。写入 `CONFIGURED` 新记忆前按 ACTIVE 与 ARCHIVED 合计检查 50 条容量，归档不释放额度。
5. 请求级 shape/scope 错误在处理前返回 `LTM_WRITE_INVALID`；底层存储不可用返回 `LTM_STORAGE_UNAVAILABLE`。单项 validation、guardrail、容量或写入错误仅增加 `failCount`。收到取消后停止处理未开始条目并返回取消安全错误，不向浏览器暴露内容或 raw error。

必须保留现有逐条 save/manual save、查询、共享、访问统计和 frozen identity/agent scope 路径；不得加入 batch delete、PATCH 扩展或查询字段变化。`agent-channel-web` 不得 import Gateway contract，`agent-memory` 不得 import local Gateway 私有实现。

REST 增量契约固定在 `references/long-term-memory-batch-create-api.yaml`；它只描述本 change 新增的 batch create operation，并与已归档的长期记忆 V2 OpenAPI 基线共同接受 parity test，不复制或改写未触及的 12 个存量 operation。

#### 质量属性影响

- 安全：无新增黑盒质量目标；实现复用现有内容安全准入、可信 scope 注入和安全错误映射，negative tests 覆盖 scope 字段注入与被拦截内容不写入。
- 性能/容量：无新增黑盒质量目标；固定每批最多 100 条并顺序处理，避免无界并行 guardrail 与数据库写入。
- 可靠性/恢复：无新增黑盒质量目标；每项独立幂等 anchor 和 transaction，允许调用方在结果未知后以相同幂等键重试。
- 可测试性：公共 contract、route、application service 与 local Gateway 分层测试正常、边界、部分失败和请求级失败。

## 验证策略（Verification Strategy）

- spec 行为：contract 和 route tests 断言 1/100 边界、0/101 拒绝、可信 scope、默认置信度、计数不变量、部分成功、幂等重试和取消结果。
- design 边界：architecture tests 断言 Channel 只消费 management contract、`agent-memory` 不依赖 local 私有实现、management route 只委托 port。
- negative case：实际触发 owner/agent 字段注入、未知字段、内容安全阻断、50 条容量超限、存储不可用和重复幂等键，断言安全错误或单项失败且无非法写入。
- 集成验证：运行受影响 package tests、contract tests、architecture lint、根 workspace build/test 和 OpenSpec strict validation。

## 长期基线刷新计划（Baseline Promotion Plan）

- stable spec：更新 `memory-core`，迁入三个 legacy Requirements 并新增批量新增 Requirement；从 `long-term-memory-management-contract` 删除三个来源 Requirements，保留其它 Requirements。
- Function：更新 `FN-8.5 长期记忆 search/list/detail/count/state transition` 的输入、输出、处理过程、量化指标、接口、主规格和 legacy spec 导航。
- Feature：更新 `F-8.2 长期记忆`，说明管理批量新增的用户价值和容量边界。
- overview：补充长期记忆支持有界批量管理写入。
- architecture：更新长期记忆架构中的 Channel/application/Gateway 批量写入和 scope、安全边界。
- modules：更新 `agent-contracts`、`agent-channel-web`、`agent-memory`、`agent-platform-gateway-local` 模块设计。
- ADR：无；批量新增复用既有分层、逐项幂等和 local transaction 原则，不形成新架构决策。
- spec-to-design-map：把 `memory-core` 批量新增行为导航到上述架构、模块和验证入口，并保留 legacy spec 导航。

## 风险与取舍（Risks / Trade-offs）

- 逐项 transaction 不提供全批原子性，但与产品需要的部分成功语义一致；全批 transaction 会使单项非法导致全部失败，已排除。
- 顺序 guardrail 和写入的时延随条目数线性增加，但使取消、容量竞争和结果顺序确定；并行方案会放大依赖压力和结果不确定性，已排除。
- 批量返回只包含聚合失败数，不能逐项展示错误原因；本 change 保持现有 API 目标，避免把内容或内部安全信息带回浏览器。

## 待确认问题（Open Questions）

无。
