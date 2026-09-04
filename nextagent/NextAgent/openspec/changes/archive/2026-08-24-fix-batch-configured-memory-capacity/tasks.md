## 0. 跨 Function 前置门禁

- [x] 0.1 创建本 change 的 proposal、design、delta spec 和 tasks，并确认 Function 汇总与唯一实现路径完整
  来源：proposal/design/specs
  验证：`npx --yes @fission-ai/openspec@1.8.0 validate fix-batch-configured-memory-capacity --strict`

## 1. `FN-8.15 管理长期记忆`

### 目标行为测试

- [x] 1.1 characterization 测试：已有 30 条 `CONFIGURED`，批量新增 10 条全部获准进入持久化调用，`failCount = 0`；count query 形状与 `manualSaveLongTermMemory` 一致（含 `memoryInstance` 缺省 `defaultInstance`、`minConfidence: 0`）
  来源：spec `长期记忆批量新增保持逐项准入和结果可核对`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-memory/tests/long-term-memory-management.test.ts`

- [x] 1.2 characterization 测试：已有 47 条，批量 20 条按输入顺序前 3 条获准、17 条计入 `failCount`，提交 write coordinator 的 items 只含获准条目
  来源：spec `容量不足条目按序占用剩余额度`
  验证：同 1.1

- [x] 1.3 characterization 测试：已有 48 条，批量 3 `CONFIGURED` + 2 `LEARNED`，`CONFIGURED` 前 2 条获准、第 3 条计入 `failCount`，`LEARNED` 全部放行
  来源：spec `容量不足条目按序占用剩余额度`（`CONFIGURED` 之外条目不受预检约束）
  验证：同 1.1

- [x] 1.4 characterization 测试：已有 50 条，批量 5 条全部被拒且不调用持久化写入，返回 `{ successCount: 0, failCount: 5, memoryIds: [] }`
  来源：spec `容量不足条目按序占用剩余额度`
  验证：同 1.1

- [x] 1.5 characterization 测试：满额下携带 `memoryId` 的 `CONFIGURED` 条目放行且批次不做容量预检查询
  来源：spec（携带 `memoryId` 的条目不受预检约束、无新增 `CONFIGURED` 条目时不执行预检查询）
  验证：同 1.1

- [x] 1.6 characterization 测试：count 查询返回 SafeError 时整批透传该错误且不调用持久化写入
  来源：spec `容量预检查询失败使整批安全失败`
  验证：同 1.1

- [x] 1.7 characterization 测试：全 `LEARNED` 批次不做容量预检查询，直接透传 write coordinator
  来源：spec（批次内不存在未携带 `memoryId` 的 `CONFIGURED` 条目时不执行预检查询）
  验证：同 1.1

### 实现

- [x] 1.8 `batchCreateLongTermMemory` 在 mapping 后、write coordinator 前实现逐条容量预检；count query 构造与 `manualSaveLongTermMemory` 同形，复用 `MAX_CONFIGURED_PERSONAL_MEMORIES` 与既有 `invoke`/`isSafeError` helper
  来源：design 修改方案
  验证：同 1.1 + `npm run build`

### Function 验证

- [x] 1.9 确认 `manualSaveLongTermMemory`、write coordinator guardrail 准入、LOCAL SQLite gateway 既有行为无回归
  来源：最小内核非回归
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-memory`、`npx vitest run --config vitest.config.contract.ts tests/contract/memory-core-contracts.test.ts`

## 2. 契约确认与整体验证

- [x] 2.1 根目录运行 `npm run build`
  验证：构建通过

- [x] 2.2 根目录运行 `npm test`
  验证：全量测试通过（既有 `packages/agent-remote-deployment` 两个 suite 因 `APP_CONFIG_BLOCKED` 在 import 阶段失败，与本 change 无关）

- [x] 2.3 运行 `npx --yes @fission-ai/openspec@1.8.0 validate fix-batch-configured-memory-capacity --strict`
  验证：本 change 通过 strict 校验（`--all` 存在 26 项其它 change/spec 的仓库既有失败）

- [x] 2.4 清理检查：无未使用 import/helper/export、无 debug logging、无重复 50 常量或平行 count 逻辑
  来源：AGENTS.md 实现质量门禁
  验证：`git diff --check`、code review
