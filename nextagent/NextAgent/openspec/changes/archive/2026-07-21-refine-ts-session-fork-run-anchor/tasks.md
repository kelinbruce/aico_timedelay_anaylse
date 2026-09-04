## 1. Runtime fork run anchor 重映射

- [x] 1.1 在 fork id maps 构造中增加 source `runId` 到 child run anchor 的重映射：source prefix 中每个不同 source `runId` 经 runtime idFactory 铸造一个新 child run id；同一 source run 共享、不同 source run 相异；映射只存在于 fork 执行内存，不持久化、不写入日志。
  验证：`npm run build`
  来源：specs/session-fork-from-message "Child Session Inherits Prefix And Model-Visible Context"；design D2
- [x] 1.2 copied message 构造时写入 child run anchor：source message 携带 `runId` 时 copied message 的 `runId` 字段取对应 child run anchor，source message 无 `runId` 时 copied message 不携带 `runId`；不创建 RequestRun、timeline event 或 checkpoint 事实。
  验证：`npm run build`
  来源：specs/session-fork-from-message "Child Session Inherits Prefix And Model-Visible Context" / "Forked Session Is Isolated From Source Session"；design D2、D3

## 2. 测试适配与新增用例

- [x] 2.1 适配 `tests/agent-kernel/session-fork-runtime.test.ts` 中因 run anchor 铸造导致 idFactory 序列移位的既有用例（execution-bound promotion 相关用例），保持其原有断言语义不变。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/session-fork-runtime.test.ts`
  来源：design D2
- [x] 2.2 新增 run anchor 用例：同一 source run 的 copied messages 共享 anchor、不同 source run 相异、anchor 不等于任何 source `runId`、无 `runId` 的 source message 的 copied message 不携带 `runId`、child session 无对应 RequestRun 记录。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/session-fork-runtime.test.ts`
  来源：specs/session-fork-from-message "继承问答对携带 child-scoped run anchor" / "无 runId 的 source message 不获得 run anchor" / "Run anchor 不是 runtime lifecycle 事实"
- [x] 2.3 新增分享链路用例：fork 后以 copied messages 的 run anchor 创建分享并读取，返回继承问答对的 copied messages（复现修复前读取为空的 `SHARE_CONTENT_DELETED` 场景），且不返回 source session 内容。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/session-fork-runtime.test.ts`
  来源：specs/session-fork-from-message "继承问答对可经 conversation share 分享"

## 3. 门禁验证

- [x] 3.1 OpenSpec、contract、architecture 门禁通过。
  验证：`openspec validate --all --strict`；`npm run test:contract`；`npm run lint:architecture`
  来源：AGENTS.md 验证门禁
