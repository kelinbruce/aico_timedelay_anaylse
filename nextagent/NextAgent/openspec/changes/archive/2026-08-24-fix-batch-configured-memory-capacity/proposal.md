## 背景与问题（Why）

生产问题单：前端导入记忆时界面提示「个人导入记忆限制 50 条，已有 X 条，可导入 0 条」，但点击确认导入后记忆仍全部导入成功。

根因在 `agent-memory` management service 层，两条 `CONFIGURED` 写路径没有同形处理：

- `manualSaveLongTermMemory` 在调用 write coordinator 前查询 `ACTIVE`+`ARCHIVED` 的 `CONFIGURED` 总数，超过 50 条拒绝写入。
- `batchCreateLongTermMemory` 直接透传 write coordinator，没有任何容量预检。

LOCAL SQLite gateway 的 `batchCreateLongTermMemory` 已实现逐条独立裁决（每条事务内先解析幂等重放、再按 `consumesConfiguredSlot` 判容量），但该实现只在 LOCAL deployment 生效；REMOTE deployment（`agent-platform-gateway-remote` 经远端服务调用 AgentMemoryService）下 TS 侧没有任何容量执法点，远端行为不受本仓控制。`memory-core` spec「长期记忆批量新增保持逐项准入和结果可核对」已 mandate 每条独立执行 50 条 `CONFIGURED` 容量约束，REMOTE deployment 当前不满足该端到端契约。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- `batchCreateLongTermMemory` 在调用 write coordinator 前对未携带 `memoryId` 的 `CONFIGURED` 条目按输入顺序执行容量预检；预检语义与 `manualSaveLongTermMemory` 同形（同一 count query 形状、同一 50 上限、同一 SafeError 中止行为）。
- 超出剩余额度的条目计入 `failCount` 且不进入持久化调用；获准条目语义不变，`successCount + failCount` 保持等于输入条目数。
- LOCAL 与 REMOTE deployment 的 TS service 层行为一致；LOCAL gateway 既有逐条权威裁决保持不变并继续作为最终权威。

**非目标：**

- 不修改 gateway contract（`LongTermMemoryStoreGateway`、`BatchCreateLongTermMemoryRequest`/`Result` 不变）。
- 不修改前端、Web route 或导入交互。
- 不解决 count 与 write 之间的 TOCTOU 原子性（与 `manualSaveLongTermMemory` 既有限制一致）。
- 不改变 `manualSaveLongTermMemory` 行为。
- 不新增错误 code；容量拒绝在 batch 部分成功模型下只计入 `failCount`。

## 变更范围（What Changes）

- `agent-memory` management service 的 `batchCreateLongTermMemory` 增加逐条容量裁决：count 查询（`ACTIVE`/`ARCHIVED` `CONFIGURED` 总数）→ 按输入顺序分配剩余额度 → 被拒条目计入 `failCount` → 获准条目进入 write coordinator。
- count 查询返回 SafeError 时整批中止并透传该错误，不调用持久化写入。
- characterization 测试覆盖全额、部分额度、无额度、混合类型、带 `memoryId`、count 失败与跳过预检场景。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-8.15 管理长期记忆`
  - canonical spec：`memory-core`
  - `MODIFIED`「长期记忆批量新增保持逐项准入和结果可核对」：显式化 management service 层容量预检义务（容量约束 MUST NOT 依赖单一持久化 gateway 实现的自愿行为），并补充容量额度分配与预检失败的 scenario。

## 影响范围（Impact）

- **行为：** REMOTE deployment 下超过剩余 `CONFIGURED` 额度的批量导入条目开始被拒绝并计入 `failCount`；LOCAL deployment 端到端结果不变（gateway 事务内权威裁决与 service 预检结论一致）。
- **Gateway contract：** 无变化。
- **公共 API：** 无变化（batch 结果 shape 不变）。
- **测试：** `packages/agent-memory/tests/long-term-memory-management.test.ts` 新增 batch 容量裁决 characterization 测试。
