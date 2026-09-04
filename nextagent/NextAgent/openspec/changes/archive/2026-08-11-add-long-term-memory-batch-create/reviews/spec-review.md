## 审查结果

- Change：`add-long-term-memory-batch-create`
- 日期：2026-08-03
- 结论：PASS

## Findings

审查发现并已修复两项问题：

1. 原规格把批量新增错误映射到 `FN-8.2`；最新主线中 `FN-8.2` 属于 F-8.1 provider，长期记忆核心操作的正确 Function 是 `FN-8.5`。proposal、design、spec、tasks 与基线刷新计划现已统一为 `FN-8.5`。
2. local Gateway 原实现会把不可预期的 SQLite 事务异常吞成单项 `failCount`，与存储不可用必须返回请求级安全错误的规格不一致；现已返回 `LTM_STORAGE_UNAVAILABLE`，字段、护栏、容量等可预期单项失败仍保持部分成功。

修复后无 BLOCKER、HIGH、MEDIUM 或 LOW finding。

## 需群内确认

已解决。`agent-contracts/channel` 与 `agent-contracts/gateway` 的 batch create 增量沿用该能力原开发分支已取得的群内确认；本次用户明确要求将接口同步和导入导出迁移到基于 `main` 的独立分支。

## 约束对齐

| 维度 | 结论 | 说明 |
|---|---|---|
| Function / Feature 追踪 | PASS | 修改 `FN-8.5` 与 `F-8.2`，canonical spec 为 `memory-core`；legacy management Requirements 以迁移方案处理。 |
| Architecture boundary | PASS | Channel 仅校验、注入可信 scope 并委托；`agent-memory` 负责安全准入；local Gateway 负责逐项 transaction、容量和幂等。 |
| Frozen contract | PASS | API、Channel 与 Gateway 增量由本 change 明确定义，未重定义既有 12 个 operation。 |
| Security | PASS | 条目不能携带 Owner/Agent Scope；每项仍经过 runtime schema、内容护栏、50 条容量和 scoped idempotency。 |
| Reliability | PASS | 逐项部分成功、稳定幂等重放、取消与存储不可用的请求级失败边界已闭合。 |
| KISS / scope | PASS | 只新增 batch create，不增加 batch delete、patch、文件上传或服务端导出。 |

## 验证

- `openspec validate add-long-term-memory-batch-create --strict`：PASS。
- `openspec validate --all --strict`：262/262 PASS。
- batch contract：3 文件、16 测试 PASS。
- Web route/schema：3 文件、49 测试 PASS。
- architecture：45 文件、279 测试 PASS。
- 受影响生产 package TypeScript build：PASS。
- 根 `npm test`：139 文件、1455 测试 PASS。
- `git diff --check origin/main`：PASS。

根 `npm run build` 的剩余 4 个错误位于未触及的 `tests/agent-kernel/logging.test.ts` 与主线插件类型之间；全量 `test:contract` 的 3 个失败位于未触及的 capability/workflow/timeline 用例。相关文件相对 `origin/main` 无本分支差异，不构成本 change finding。
