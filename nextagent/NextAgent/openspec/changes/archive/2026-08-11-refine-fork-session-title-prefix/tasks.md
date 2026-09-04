## 1. `FN-1.11 从消息派生子会话`

- [x] 1.1 在 `tests/agent-kernel/session-fork-runtime.test.ts` 先补充目标行为测试：断言普通派生生成 `Fork · <源标题>`，多级派生和用户原始前缀均机械累加，手动修改后的当前标题成为派生基础；实施前运行并确认这些新增断言在现有实现上失败。
  来源：`FN-1.11 从消息派生子会话` + `Fork From Durable Visible Assistant Message` + `用户从已持久化 assistant 回复派生新会话`、`多级派生机械累加前缀`、`用户标题以 Fork 文本开头时仍直接添加前缀`、`手动修改后的源标题成为派生基础`
  验证：运行 `npm test -- tests/agent-kernel/session-fork-runtime.test.ts`；实现前预期新增目标断言因 child 标题尚未添加前缀而失败，且失败信息精确指向标题差异。

- [x] 1.2 在同一 runtime 测试文件补充边界与重复行为测试：断言空标题生成 `Fork · Untitled session`、100 字符上限只截断源标题尾部并保留完整前缀、不同 idempotency keys 创建的兄弟 child 标题相同且 `sessionId` 不同、同一 idempotency key replay 返回首次 child 且不重复增加前缀；实施前运行并确认新增目标断言在现有实现上失败。
  来源：`FN-1.11 从消息派生子会话` + `Fork From Durable Visible Assistant Message` + `同一源会话的多个直接派生允许同名`、`超长源标题保留完整派生前缀`；`Fork Notice Projection` + `空源标题分别生成 child 标题与 notice 源标题`；以及 `design.md / FN-1.11 从消息派生子会话 / 修改方案`
  验证：运行 `npm test -- tests/agent-kernel/session-fork-runtime.test.ts`；实现前预期新增的前缀、长度或 replay 断言至少一项失败，且既有 fork 原子性与 scope 测试不得出现新增失败。

- [x] 1.3 在 runtime 测试中明确断言 child 派生标题与 `forkSource.sourceSessionTitleSnapshot` 分离：普通、空标题和超长标题均由 notice metadata 保留规范化后的完整源标题快照，不包含本次新增的 child 前缀。
  来源：`FN-1.11 从消息派生子会话` + `Fork Notice Projection` + `派生标题与 notice 源标题保持分离`、`空源标题分别生成 child 标题与 notice 源标题`
  验证：运行 `npm test -- tests/agent-kernel/session-fork-runtime.test.ts`；实现前预期普通和空标题的 snapshot 分离断言失败，实施后所有 snapshot 断言通过。

- [x] 1.4 修改 `packages/agent-runtime/src/lifecycle/submit.ts` 的现有 fork materialization：增加固定私有前缀常量，先生成独立源标题快照，再按现有 `string.length` 的 100 字符上限截断源标题尾部并生成 child 标题；分别写入 `childSession.title` 与 `forkSource.sourceSessionTitleSnapshot`，保持 Gateway composite write、scope、idempotency 和 request-anchor 委托路径不变。
  来源：`design.md / FN-1.11 从消息派生子会话 / 修改方案`
  验证：运行 `npm test -- tests/agent-kernel/session-fork-runtime.test.ts`；预期 1.1–1.3 新增测试和该文件全部既有测试通过。代码审查须确认没有标题查询、前缀解析/折叠、序号、配置、锁、Gateway/contract/schema 修改。

- [x] 1.5 验证 fork notice read model 与 Web projection 非回归：notice 继续使用 source snapshot，并保持仅在 default/latest child conversation、首条 child user message 之前可见；源会话后续改名不改变 notice 文案。
  来源：`FN-1.11 从消息派生子会话` + `Fork Notice Projection` + `刚派生的 child session 显示 fork notice`、`Child 提交新消息后不再显示 fork notice`、`分页或锚点读取不返回 fork notice`、`源会话标题后续变化不影响 notice 文案`、`forkNotice source link uses existing session access semantics`
  验证：运行 `npm test -- tests/agent-kernel/session-fork-session-service.test.ts tests/agent-kernel/session-fork-web.test.ts tests/contract/session-fork-contracts.test.ts`；预期全部通过，public `forkNotice` shape 和显示条件不变。

## 2. Change 整体验证

- [ ] 2.1 完成 OpenSpec、构建、全量测试、契约和架构门禁，并对实施范围执行 NextAgent 模型语义检视；不存在由本 change 引入的失败或 P0/P1 问题。
  来源：proposal 影响范围；`design.md / 验证策略（Verification Strategy）`
  验证：依次运行 `openspec validate refine-fork-session-title-prefix --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`；预期全部命令成功。随后按 `$nextagent-code-review` 检视，结论必须为 `PASS` 或没有阻断项的 `PASS WITH FOLLOW-UP`。
  执行记录（2026-08-07）：本 change strict validation、根构建、全量测试（1639 passed）、契约测试（357 passed）和架构门禁（281 passed）均通过，语义检视为 `PASS WITH FOLLOW-UP` 且无 P0/P1/P2；`openspec validate --all --strict` 仍被既有 `add-bash-streaming-structured-delta` 的 3 个 SHALL/MUST 错误阻塞，因此本任务保持未勾选。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 `design.md / 长期基线刷新计划（Baseline Promotion Plan）` 归并 stable spec、Function、Feature 与 `agent-runtime` module 的长期事实；确认没有重复定义标题、契约、owner 或接口语义，且不回填既有 child session 标题。
