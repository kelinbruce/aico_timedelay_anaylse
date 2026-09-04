## 1. `FN-1.1 查看会话消息流`

- [x] 1.1 为 shared channel projector 添加 read-after-write characterization：按顺序输入非空 live `LLM_CONTENT_DELTA`、同 occurrence completed 引用和返回空集合的 resolver，并为 `CAPABILITY_RESULT_DELTA` / `CAPABILITY_COMPLETED` 建立同形用例；变更前两个用例必须复现正文变空或 resolver 被调用的失败。
  来源：`FN-1.1` + Requirement `Web stream 在服务端解析过程消息引用` + Scenarios `活跃执行说明使用已交付快照完成收敛`、`活跃 Tool 结果使用已交付快照完成收敛`、`暂时不可读的消息不清空已展示正文`；design `FN-1.1 查看会话消息流 / 修改方案 / 1、2`
  验证：在仓库根目录运行 `npm test -- packages/agent-channel-common/tests/process-message-projection.test.ts packages/agent-channel-common/tests/web-stream-delivery.test.ts`；实施前预期新增用例 FAIL，失败证据分别包含空 completed 内容或非零 resolver 调用次数。
  验证记录（2026-08-11）：使用仓库声明的 Node 22.22.2 运行 focused tests，新增 LLM/Tool 用例均按预期 RED，失败均为 `resolveProcessMessages` 实际调用 1 次；环境 Node 25 首次运行因隔离 worktree 缺少 Vite dependency 未进入测试，不计为 RED 证据。

- [x] 1.2 在 `projectTimelineEventsToStreamEnvelopes(...)` 实现最多 1,000 项的订阅级安全 snapshot cache 和穷尽 completion 决策：matching LLM/Tool result completion 复用最新安全投影且不调用 resolver，miss 与 `CAPABILITY_STARTED` 保持 Message association，iterator 关闭释放全部状态。
  来源：`FN-1.1` + Requirement `Web stream 在服务端解析过程消息引用` + Scenarios `活跃执行说明使用已交付快照完成收敛`、`活跃 Tool 结果使用已交付快照完成收敛`、`未观察到 live 快照时从消息恢复`；design `FN-1.1 查看会话消息流 / 修改方案 / 1、2`
  验证：在仓库根目录运行 `npm test -- packages/agent-channel-common/tests/process-message-projection.test.ts packages/agent-channel-common/tests/web-stream-delivery.test.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`；预期全部 PASS，命中用例 resolver 调用数为 0，miss 用例调用数为 1，结果展示级别不变。
  验证记录（2026-08-11）：使用 Node 22.22.2 运行指定三个文件，`3 passed`、`185 passed`；LLM/Tool matching completion 均保持正文且 resolver 为 0 次，既有 miss 与 presentation-policy 用例通过。

- [x] 1.3 增加 snapshot 隔离和容量 negative tests：分别触发不同 `sessionId`、`requestId`、`runId`、`rootMessageId`、`stepId`、`capabilityId`、`toolCallId`、空正文、未列出事件类型和超过 1,000 项的输入，断言不得跨 occurrence 复用且淘汰后回退 Message association。
  来源：`FN-1.1` + Requirement `Web stream 在服务端解析过程消息引用` + Scenarios `不同 occurrence 不得复用正文`、`无快照且关联失败时显式降级`；stable 系统质量属性 Requirement `过程消息引用保持作用域隔离`；design `FN-1.1 查看会话消息流 / 修改方案 / 1、2 / 质量属性影响`
  验证：在仓库根目录运行 `npm test -- packages/agent-channel-common/tests/process-message-projection.test.ts packages/agent-channel-common/tests/web-stream-delivery.test.ts`；预期全部 PASS，全部 mismatch case 进入 resolver 或 `contentUnavailable`，缓存项始终不超过 1,000。
  验证记录（2026-08-11）：Node 22.22.2 focused tests `2 passed`、`66 passed`；覆盖 session、canonical request/root、run、step、capability、tool-call、空正文、thinking、`CAPABILITY_STARTED` 与 1,001 个 live occurrence，全部 mismatch/淘汰用例回退 resolver 并安全降级。

- [x] 1.4 调整 Message association cache 的失败语义并增加回归测试：成功 Message 可复用，空结果或非取消读取失败不得写入订阅级永久 miss；后续独立引用同一 `messageId` 时必须再次调用 resolver，取消仍立即终止当前读取。
  来源：`FN-1.1` + Requirement `Web stream 在服务端解析过程消息引用` + Scenarios `未观察到 live 快照时从消息恢复`、`无快照且关联失败时显式降级`；design `FN-1.1 查看会话消息流 / 修改方案 / 3`
  验证：在仓库根目录运行 `npm test -- packages/agent-channel-common/tests/process-message-projection.test.ts packages/agent-channel-common/tests/web-stream-delivery.test.ts`；预期全部 PASS，先 miss 后成功用例 resolver 调用数为 2，第二个 envelope 有正文且不含 `contentUnavailable`。
  验证记录（2026-08-11）：同次 focused run `2 passed`、`66 passed`；空结果和非取消异常后第二个相同引用均重新读取并成功，resolver 为 2 次；取消用例只读取 1 次并立即收敛为既有 safe stream failure。

- [x] 1.5 先收紧 Tool completion persistence tests：成功 Tool loop 的 `CAPABILITY_COMPLETED` 必须只含 Message reference 与 lifecycle fields，runtime persistence policy 必须实际拒绝携带 `result`、`safeResult`、`structuredPayload` 或 `output` 的 ordinary completed Event；变更前新增断言必须 FAIL。
  来源：stable `FN-1.1` Requirement `可恢复过程事件引用唯一消息正文` + Scenario `Tool 终态事件引用结果消息`；design `FN-1.1 查看会话消息流 / 修改方案 / 4`
  验证：在仓库根目录运行 `npm test -- packages/agent-core/tests/parallel-tool-loop.test.ts packages/agent-runtime/tests/timeline-event-persistence-policy.test.ts`；实施前预期新增 ref-only 断言或禁止 `result` 的 policy case FAIL。
  验证记录（2026-08-11）：Node 22.22.2 RED run `2 failed`、`100 passed`；Agent Core completion 实际仍含 `{ result: { value: 'final' } }`，runtime policy 对 ordinary completed `result` 未抛错；channel legacy inline-result 禁止用例随后也按预期 RED。

- [x] 1.6 从 Agent Core 成功 Tool completion 删除 `result.structuredPayload`，恢复 runtime persistence policy 对全部 ordinary recoverable result body 的拒绝，并删除 channel 的 inline-result-first 投影；live delta、Message 写入顺序、closed classifier 和 Workflow Event-owned product 规则保持不变。
  来源：stable `FN-1.1` Requirement `可恢复过程事件引用唯一消息正文` + Scenarios `Tool 终态事件引用结果消息`、`进行中 delta 不成为持久化正文`；design `FN-1.1 查看会话消息流 / 修改方案 / 4、6`
  验证：在仓库根目录运行 `npm test -- packages/agent-core/tests/parallel-tool-loop.test.ts packages/agent-core/tests/tool-structured-delta-emission.test.ts packages/agent-runtime/tests/timeline-event-persistence-policy.test.ts packages/agent-channel-common/tests/process-message-projection.test.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`；预期全部 PASS，新 completion 不含 `result`，违规 persisted Event 被拒绝，Message association 仍生成既有安全 Tool result。
  验证记录（2026-08-11）：使用 Node 22.22.2 运行指定五个文件并追加 capability public identity 回归，`6 passed`、`313 passed`；completion ref-only、四类 recoverable body 拒绝、legacy inline result 忽略、Message association 和 Workflow/CLIP classifier 均通过。

- [x] 1.7 为 Agent Web 添加 active lane 非破坏性完成测试：同 lane 非空 accumulated snapshot 后到达空 `contentUnavailable` completion 时保留正文并推进完成 identity；跨 lane、history/settled cache 和 output guard terminal 不得复用 active 正文；变更前同 lane用例必须复现正文被清空。
  来源：`FN-1.1` + Requirement `Web stream 在服务端解析过程消息引用` + Scenarios `暂时不可读的消息不清空已展示正文`、`不同 occurrence 不得复用正文`；design `FN-1.1 查看会话消息流 / 修改方案 / 5`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/conversationStore.empty-snapshot.test.ts tests/conversationStore.test.ts tests/streamCompaction.test.ts`；实施前预期新增同 lane用例 FAIL，实施后预期全部 PASS。
  验证记录（2026-08-11）：同 lane characterization 在实现前按预期 RED，收到空 completion 后正文由 `streamed explanation` 变为空；实现后连同 process-history negative cases 运行 `4 passed`、`116 passed`，跨 step、history、settled 与 output guard 均未复用 active 正文。

- [x] 1.8 在 `conversationStore.appendLiveEnvelopes(...)` 实现仅限 active live bucket、同完整 lane 的非破坏性 completion merge；不得改变 history hydration、settled cache、terminal answer、thinking 或 output guard 清理。
  来源：`FN-1.1` + Requirement `Web stream 在服务端解析过程消息引用` + Scenarios `暂时不可读的消息不清空已展示正文`、`不同 occurrence 不得复用正文`；design `FN-1.1 查看会话消息流 / 修改方案 / 5、6`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/conversationStore.empty-snapshot.test.ts tests/conversationStore.test.ts tests/streamCompaction.test.ts tests/conversationStore.process-history.test.ts` 和 `npm run build`；预期全部 PASS 且 TypeScript build 退出码为 0。
  验证记录（2026-08-11）：在 `origin/main@ad15176ef` 加 Process History WebSocket 基线修复 `949438d4e` 上，Node 22.22.2 运行四个 focused files 为 `4 passed`、`116 passed`；`frontend/agent-web npm run build` 退出码为 0。此前的 Cron test 类型错误已由 main 的 MR `!1121` 修复，因此本 task 完成。

- [x] 1.9 增加 cold-path 回归：当前订阅没有 matching live snapshot 时，SSE、WebSocket、刷新、重连、晚加入和 run event history 必须从 Message 生成正文；旧 Event 的 inline result 不得优先于 Message，也不得在 Message 缺失时成为 fallback。
  来源：`FN-1.1` + Requirement `Web stream 在服务端解析过程消息引用` + Scenarios `未观察到 live 快照时从消息恢复`、`无快照且关联失败时显式降级`、`服务端批量关联入口不成为公开消息读取 API`、`旧事件候选查询保持完整且有界`；stable `FN-1.2` Requirement `过程历史从消息正文与事件时序联合恢复` + Scenario `历史 Tool 过程与实时投影一致`；design `FN-1.1 查看会话消息流 / 修改方案 / 3、4`
  验证：在仓库根目录运行 `npm test -- packages/agent-channel-common/tests/web-stream-delivery.test.ts packages/agent-channel-web/tests/session-event-history-route.test.ts packages/agent-runtime/tests/process-message-resolution.test.ts`；预期全部 PASS，Message 正文胜出，缺失 Message 时仅返回 status + `contentUnavailable`。
  验证记录（2026-08-11）：channel/history focused run 为 `2 passed`、`36 passed`，补充的 cold Tool completion 从 Message 恢复正文并忽略 legacy Event result；runtime resolver 因组合命令未收集该文件而单独运行，`1 passed`、`7 passed`。既有 history 用例同时覆盖 Message 优先、缺失 Message 显式降级与有界 legacy candidate 查询。

## 2. Change 整体验证

- [x] 2.1 执行 live/process history 浏览器旅程，验证执行说明和 Tool result 在完成边界不消失，刷新后仍从 Message 恢复，并对 SSE 与 WebSocket 使用同一断言。
  来源：proposal `目标与非目标`、`影响范围`；design `验证策略`、`迁移与回滚`
  验证：在 `frontend/agent-web` 运行 `npm run test:e2e -- tests/e2e/process-message-event-projection.spec.cjs tests/e2e/session-history-streaming.spec.cjs tests/e2e/process-history-modes.spec.cjs`；预期全部旅程 PASS，无正文闪失、重复或跨 occurrence 串联。
  验证记录（2026-08-11）：在 `origin/main@ad15176ef` 加 Process History WebSocket 基线修复 `949438d4e` 上，Node 22.22.2 对指定三个文件运行同一旅程断言：SSE `20 passed`，WebSocket `20 passed`。执行说明、Tool result、刷新与历史恢复均无正文闪失、重复或跨 occurrence 串联；未被场景依赖的背景接口仍产生 Vite proxy 噪声，但没有测试失败或重试。

- [x] 2.2 执行受影响前后端完整门禁与 OpenSpec 门禁，并完成 `$nextagent-code-review` 语义检视；P0/P1 为零且结论至少为 PASS WITH FOLLOW-UP 才允许 push。
  来源：proposal `影响范围`；design `验证策略`、`长期基线刷新计划`
  验证记录（2026-08-12）：最终组合分支在 Node 22.22.2 下 `npm run build` 通过；串行 `npm test` 为 `156 passed / 1 skipped` files、`1983 passed / 2 skipped` tests；contract `46 files / 366 tests` 全通过；architecture `49 files / 300 tests` 全通过；OpenSpec strict `246 passed / 0 failed`。前端 TypeScript build、三宿主 `build:vite:modes` 通过，四个 focused files 为 `4 passed / 116 tests passed`；指定浏览器旅程 SSE `20 passed`、WebSocket `20 passed`。并行首轮因受限环境 socket/browser 资源竞争出现 `listen EPERM`，在允许真实监听的环境中串行复验全部通过。`nextagent-skill-review` 与 `$nextagent-code-review` 结论均为 PASS，无 P0/P1/P2，无需群内确认。
  验证：仓库根目录运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`；`frontend/agent-web` 运行 `npm run build`。预期全部命令退出码为 0；语义检视覆盖 Message/Event owner、frontend ownership、SSE/WS 等价、security、minimal kernel non-regression 和 scope-appropriate test evidence。
  验证记录（2026-08-11）：focused backend 为 `6 passed`、`309 passed`，focused frontend 为 `4 passed`、`116 passed`，OpenSpec strict 为 `246 passed`，三宿主 Vite build 通过。完整 `npm test` 为 `154 passed / 1 skipped / 2 failed` test files、`1981 passed / 2 skipped / 2 failed` tests，失败位于未触达的 IPv6 callback 与 model activation 基线；允许本地监听后的 contract 为 `45 passed / 1 failed` files、`364 passed / 2 failed` tests，失败均因测试引用不存在的 archived OpenSpec 文件。root build、architecture 与 frontend TypeScript build 分别被未触达的 Workflow test 类型错误、Sandbox architecture 旧断言和 Cron test 非法 `withRouter` option 阻塞。`nextagent-skill-review` 为 PASS 且“需群内确认”为 None；`nextagent-code-review` 未发现本 change 的 P0/P1，但 validation hard gate 未全绿，因此总评为 BLOCKED，本 task 暂不勾选且不得 push。

## 归档前更新基线检查（非实施任务）

实现与全部验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 stable spec、`FN-1.1`、`F-1.1`、conversation process history、相关 modules 与 spec-to-design-map；确认 stable 文档只保留目标态，不把旧双写 workaround、实施顺序或临时风险写入长期基线。
