## 1. `FN-2.3 重试请求`

- [x] 1.1 为同一 root 的多 attempt 建立失败复现：旧 attempt 已有 canonical answer、Think 和 capability result 时，新 attempt 的答案与过程仍必须成为唯一当前投影；先运行并确认目标断言在修改前失败。
  来源：`FN-2.3 重试请求` + `Retry 新 run 自动展开实时过程` + `当前 attempt 的答案不被旧答案抑制`、`当前 attempt 不混入旧执行过程`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/buildTurnBlocks.test.ts`；修改前新增用例至少一项失败，失败原因必须为旧 attempt 抑制或混入当前 attempt，而非夹具错误。

- [x] 1.2 为 Retry pending、acceptance 和恢复建立 store characterization：确认 pending 不展示旧过程、acceptance failure 恢复原轮次，accepted `runId` 同时切换当前显示 run 与 process-history target，且不删除旧 run 缓存。
  来源：`FN-2.3 重试请求` + `Retry 新 run 自动展开实时过程` + `retry pending 不展示旧 attempt 过程`、`authoritative reload 保持当前 attempt`；design `FN-2.3 重试请求 / 修改方案`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/state/requestStore.retryLimit.test.ts tests/conversationStore.test.ts tests/conversationStore.process-history.test.ts`；新增 characterization 先保持既有通过项，目标缺口用例在实现前失败。

- [x] 1.3 实现 Retry 当前 attempt 原子投影：以已确认 `runId` 过滤当前 root 的展示层、更新 display run 和 history target，并把轮次 answer/process 合并与去重限定在同一 run；用户只看到新 attempt，旧缓存和后端事实保持不变。
  来源：`FN-2.3 重试请求` + `Retry 新 run 自动展开实时过程` 的全部 Scenarios；design `FN-2.3 重试请求 / 修改方案`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/buildTurnBlocks.test.ts tests/buildSessionProjection.test.ts tests/conversationStore.test.ts tests/conversationStore.process-history.test.ts src/state/requestStore.retryLimit.test.ts`；所有目标和既有用例通过。

- [x] 1.4 验证 Retry 在 inherited fork、会话切换和 authoritative history 下保持 child/session/run 作用域，不修改 parent 或旧分享默认内容。
  来源：`FN-2.3 重试请求` + `Retry 新 run 自动展开实时过程` + `retry 新 run 的实时过程自动展开`、`authoritative reload 保持当前 attempt`；proposal `影响范围`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/view-model/buildSessionProjection.forkInherited.test.ts src/features/chat/components/TurnBlock.forkInherited.test.tsx tests/buildSessionProjection.test.ts`；全部通过，且新增 child/parent negative case 断言 parent 投影不变。

## 2. `FN-2.1 提交请求`

- [x] 2.1 建立未变化 Edit 的失败复现：相同规范化文本、无新 Skill 且无附件时不调用 edit service、不乐观替换，并保持 edit mode、文本和提示；先运行并确认目标断言在修改前失败。
  来源：`FN-2.1 提交请求` + `Agent Web SHALL expose edit only for the current latest turn` + `未变化 Edit 不创建 replacement`、`未变化 Edit 不转换为 Retry`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/MessageInput.edit.test.tsx tests/requestStore.test.ts`；修改前新增用例至少一项失败，失败原因必须为发生 Edit 副作用或 controller 错误收尾。

- [x] 2.2 实现 Edit no-op 判定和 controller 收尾分支：只在附件为空、无新 Skill 且规范化文本未变化时返回 no-op 并提示“内容未修改”；文本或 Skill 变化继续正常 Edit，附件非空继续既有拒绝。
  来源：`FN-2.1 提交请求` + `Agent Web SHALL expose edit only for the current latest turn` + `未变化 Edit 不创建 replacement`、`文本变化继续执行 Edit replacement`、`新 Skill 定向构成有效变化`、`附件队列继续使用既有拒绝行为`；design `FN-2.1 提交请求 / 修改方案`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/MessageInput.edit.test.tsx tests/requestStore.test.ts`；no-op、文本变化、Skill 变化和附件拒绝用例全部通过。

- [x] 2.3 验证正常 Edit 与 Fork child Edit 的 existing replacement、latest eligibility 和 Composer draft 行为不回归。
  来源：`FN-2.1 提交请求` + `Agent Web SHALL expose edit only for the current latest turn` 的全部 Scenarios；proposal `目标与非目标`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/MessageInput.edit.test.tsx src/features/chat/view-model/buildSessionProjection.forkInherited.test.ts src/features/chat/components/TurnBlock.forkInherited.test.tsx`；全部通过。

## 3. 跨 Function 集成

- [x] 3.1 验证 Retry attempt replacement、Edit request replacement 和 Edit no-op 三条控制路径互不转换，且与 pending identity、single-flight 和 terminal settlement 组合后没有状态污染。
  来源：`FN-2.3 重试请求`、`FN-2.1 提交请求`；design `跨 Function 协作与端到端流程`
  验证：在 `frontend/agent-web` 运行全部 requestStore、conversation projection 和 chat control 相关测试；预期所有用例通过，未变化 Edit 的 service 调用数为 0，Retry 与 changed Edit 各只发起对应命令。

## 4. Change 整体验证

- [x] 4.1 完成 change 相关前端与 OpenSpec 门禁，确认无公共 contract、Gateway、Runtime、分享持久化或 fork contract 变化。
  来源：proposal `非目标`、`影响范围`；design `验证策略`
  验证：`openspec validate fix-agent-web-retry-attempt-projection --strict` 通过；change 相关前端 11 个文件 303 项测试、分享前端 19 项测试、分享冻结与 fork 状态机回归通过；相关 `process-history-modes` Playwright 浏览器旅程 12 项通过；`npm run build:vite:modes` 与 `npm run lint:architecture`（45 个文件、279 项）通过；通过 `nextagent-code-review` 语义检视。

- [x] 4.2 运行全量门禁并与同一 `origin/main` 基线比较，确认剩余失败不是本 change 引入。
  来源：proposal `非目标`、`影响范围`；design `验证策略`
  验证：前端全量测试为 155 个文件通过、6 个文件失败，1874 项通过、16 项失败；同一失败文件在纯 `origin/main@85c9f227e` 上有相同 16 项失败，另有 1 项旧 Retry 断言由本 change 按新规范修正。变基到最新 `origin/main@8b606bf7b` 后重新运行 change 定向测试和浏览器旅程，分别为 303 项与 12 项通过；前端 TypeScript build 仍仅在未修改的 `processDetails.ts:1293` 失败，且 `85c9f227e..8b606bf7b` 未修改 Agent Web 源码或 TypeScript 配置。最新 `openspec validate --all --strict` 为 269 项通过、仅既有 `add-bash-structured-argv` 失败。全量 Playwright 冒烟为 37 项通过、3 项失败，失败位于未修改的 complaint feedback、cron dashboard 和 session activity awareness 场景；上述基线问题不扩入本 change。

## 归档前更新基线检查（非实施任务）

归档流程按 design 的“长期基线刷新计划”同步两项 stable specs、两个 Function 文档及实际受影响的 architecture/module/navigation；不得把实施期冲突说明或临时状态写入长期基线。
