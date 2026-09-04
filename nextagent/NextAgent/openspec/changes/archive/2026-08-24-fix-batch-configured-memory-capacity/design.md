## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
| --- | --- | --- | --- |
| `FN-8.15 管理长期记忆` | 批量新增在 management service 层补齐 `CONFIGURED` 50 条容量预检，与 manualSave 同形，REMOTE deployment 不再依赖远端自愿行为 | `memory-core` | `FN-8.15 管理长期记忆` |

## `FN-8.15 管理长期记忆`

### 目标与规范依据

`memory-core`「长期记忆批量新增保持逐项准入和结果可核对」已 mandate 通过请求级 schema 校验后每条独立执行 50 条 `CONFIGURED` 容量约束，且容量失败只计入 `failCount`、不阻止后续条目。当前该约束只由 LOCAL SQLite gateway 实现；REMOTE deployment 的 TS service 层没有执法点，端到端契约失守。本 change 把容量执法收敛为「service 层预检 + gateway 权威裁决」双层，与 `manualSaveLongTermMemory` 既有模式同形同策。

本 Function 的目标 Requirements：

- canonical spec：`memory-core`
  - `MODIFIED`：`长期记忆批量新增保持逐项准入和结果可核对`

### 当前实现

| 层 | 当前事实 |
| --- | --- |
| `manualSaveLongTermMemory` | `memoryId === undefined && knowledgeSourceType === 'CONFIGURED'` 时先查 `ACTIVE`/`ARCHIVED` `CONFIGURED` 总数，`activeTotal + archivedTotal + 1 > 50` 返回 `LTM_WRITE_INVALID`；count 失败透传 SafeError 且不写入 |
| `batchCreateLongTermMemory` | mapping（`idempotencyKey` → `writeOptions`）后直接透传 write coordinator，无任何容量检查 |
| write coordinator | 逐条 guardrail 内容准入，被拒条目计入 `failCount`，获准条目调用 store；结果合并 `failCount` |
| LOCAL SQLite gateway | 每条独立事务：先幂等重放（命中不占额度）→ `consumesConfiguredSlot = CONFIGURED && (existing 不存在或非 CONFIGURED)` → 满额计入 `failCount` 继续；count SQL 排除 `sharing_state = 'SHARED'` |
| REMOTE gateway | TS 侧透传远端 AgentMemoryService，无容量执法；远端行为不受本仓控制 |

### GAP 分析

| 规范目标 | 当前事实 | GAP |
| --- | --- | --- |
| 每条独立执行 50 条 `CONFIGURED` 容量约束（REMOTE 也必须满足） | service 层 batch 无预检；LOCAL gateway 有事务内裁决 | service 层补预检；获准条目仍由 gateway 权威裁决 |
| 容量失败只计入 `failCount`、不阻止后续条目 | LOCAL gateway 满足；service 层无实现 | 预检按输入顺序分配剩余额度，被拒条目计入 `failCount` 且不进入持久化调用 |
| 请求级存储不可用使整批安全失败 | 仅 write 阶段满足 | 预检查询返回 SafeError 时整批中止透传，不调用写入 |
| 与 manualSave 同形同策 | manualSave 有预检，batch 没有 | batch 预检复用同一 count query 形状与同一上限常量 |

### 修改方案

**逐条按序分配额度**

`batchCreateLongTermMemory` 在 mapping 后、write coordinator 调用前：

1. 若没有任何「未携带 `memoryId` 的 `CONFIGURED`」条目，跳过预检直接透传（`LEARNED` 等类型与带 `memoryId` 的更新不占额度）。
2. 否则以与 `manualSaveLongTermMemory` 相同形状构造 count query（`identityContext`、`agentId`、`memoryInstance ?? 'defaultInstance'`、`knowledgeSourceType: 'CONFIGURED'`、`minConfidence: 0`、`limit: 1`、`offset: 0`），分别查询 `ACTIVE` 与 `ARCHIVED` 总数；任一返回 SafeError 时整批中止透传，不调用写入。
3. `remaining = 50 - activeTotal - archivedTotal`；按输入顺序遍历条目，「`CONFIGURED` 且无 `memoryId`」的条目占用额度，超出 `remaining` 的计入 `capacityFailCount` 并从持久化调用中剔除；其余条目始终放行。
4. `admittedItems` 为空时直接返回 `{ successCount: 0, failCount: capacityFailCount, memoryIds: [] }`；否则调用 write coordinator，最终 `failCount = result.failCount + capacityFailCount`（与 write coordinator 既有 guardrail `failCount` 合并模式同形）。

**与 LOCAL gateway 权威语义的已知偏差**

预检是先查后写的防御纵深，不是并发安全边界，与 gateway 事务内裁决存在三个已知口径差异（均继承 `manualSaveLongTermMemory` 既有偏差，本次不扩大修复）：

| 差异 | 说明 |
| --- | --- |
| SHARED 计数口径 | gateway count SQL 排除 `sharing_state = 'SHARED'`；service 层 `ListLongTermMemoryQuery` 契约无 `sharingState` 过滤字段，预检总数可能偏高（更严格方向，不会放行超限写入） |
| 幂等重放占额 | gateway 事务内幂等重放优先于容量检查、不占额度；service 预检无法区分重放条目，可能把重放条目计为占额（更严格方向；被预检拒绝的条目不产生副作用，客户端按幂等键重试时若额度已释放可收敛） |
| TOCTOU | count 与 write 非原子，并发批量可能突破 50；LOCAL deployment 由 gateway 事务内裁决兜底，REMOTE deployment 最终依赖远端权威性 |

**错误模型**

容量预检拒绝不返回 SafeError（batch 是部分成功模型），只计入 `failCount`；count 查询失败返回 SafeError 使整批中止。这与 `manualSaveLongTermMemory`（全有或全无，返回 `LTM_WRITE_INVALID`）的差异来自既有 batch 契约的部分成功语义，不新增错误 code。

### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 局部机制 | 验证关注点 |
| --- | --- | --- | --- |
| 容量 | `长期记忆批量新增保持逐项准入和结果可核对` | service 层逐条按序分配剩余额度；被拒条目不进入持久化调用 | 47+20、48+3、50+5、满额+`memoryId` 更新边界测试 |
| 可靠性/恢复 | 同上 | count 失败整批安全失败，不产生部分写入 | count SafeError 透传且不调用写入测试 |
| 安全 | `Management 调用使用可信 Scope 和取消上下文` | 预检 count query 复用 command 可信 scope；取消走既有 `invoke` 守卫 | 既有取消测试不回归 |

## 需群内确认

- 无新增 gateway contract、port method 或错误 code；预检口径偏差（SHARED、幂等重放、TOCTOU）继承 `manualSaveLongTermMemory` 既有限制，不构成本次破坏性决策。
- REMOTE deployment 的最终容量权威仍是远端 AgentMemoryService；本预检只保证 TS 层不再无条件放行，远端自身裁决行为由黄区侧维护。

## 长期基线刷新计划

- `openspec/specs/memory-core/spec.md`：合并修改后的「长期记忆批量新增保持逐项准入和结果可核对」。
- `openspec/designs/functions/D8-数据与记忆/D8.2-记忆/FN-8.15-管理长期记忆.md`：处理过程第 9 步补充 service 层预检事实。
- `openspec/designs/architecture/memory.md`：记录 service 层容量预检与 gateway 权威裁决的双层执法。
