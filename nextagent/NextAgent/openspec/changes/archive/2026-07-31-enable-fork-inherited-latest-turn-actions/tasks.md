## 0. 前置门禁与 characterization

- [x] 0.1 确认 `harden-conversation-share-replacement-consistency` 已实现并通过其 change 验证，再开放本 change 的 replacement/share 集成任务
  来源：proposal“影响范围”；design“迁移与回滚”
  验证：2026-07-29 `openspec status --change harden-conversation-share-replacement-consistency && openspec validate harden-conversation-share-replacement-consistency --strict` 显示 4/4 artifacts complete 且 strict validation 通过；实现提交 `aaf7b620e` 已通过 build、backend、contract、architecture、OpenSpec 和 focused tests，并由 MR [#805](https://gitcode.com/gdd_hw/NextAgent/pull/805) 提交 `main`

- [x] 0.2 确认 `add-request-retry-attempt-limit` 已完成并协调归档顺序，锁定 inherited attempt `1` 不消耗 retry 配额、attempt `2` 至 `6` 计为 5 次 retry
  来源：proposal“非目标”“影响范围”；`FN-2.3` + `Retry 创建同一 request 的新 attempt` + “inherited 首次执行不消耗 retry 配额”
  验证：2026-07-29 `openspec status --change add-request-retry-attempt-limit --json` 显示 artifacts complete、apply 15/15；`openspec validate add-request-retry-attempt-limit --strict` 通过；当前 stacked branch 含实现提交 `6e6b15d8e`，归档/合入顺序锁定为该依赖先于本 change；attempt-limit characterization 纳入 0.3 并通过

- [x] 0.3 建立普通 retry/edit、fork synthetic run anchor 只读、edit point-in-time preflight 的 characterization baseline，修改前全部通过
  来源：proposal“非目标”；design“验证策略”
  验证：2026-07-29 `npm test -- --run packages/agent-runtime/tests/retry-attempt-limit.test.ts packages/agent-runtime/tests/request-model-options-retry-recovery.test.ts packages/agent-runtime/tests/retry-input-text-recovery.test.ts` 为 3 files / 15 tests 全通过；`npx vitest run --config vitest.config.release.ts tests/agent-kernel/session-fork-runtime.test.ts` 为 1 file / 44 tests 全通过，锁定普通 retry/edit、point-in-time preflight 和 fork synthetic history baseline

## 1. `FN-1.11 从消息派生子会话`

- [x] 1.1 补充 fresh/old/recursive fork 的 inherited source 资格测试，先复现当前 retry/edit 返回 not-found，并覆盖 child 已演进、较早 copied 轮次和 direct synthetic run lifecycle 拒绝
  来源：`FN-1.11` + `最新继承轮次可作为子会话首次操作来源` + 全部 Scenarios
  验证：2026-07-29 `npx vitest run --config vitest.config.release.ts tests/agent-kernel/session-fork-runtime.test.ts` 在实现前以 `REQUEST_RETRY_NOT_FOUND`、`EDIT_LATEST_NOT_FOUND` 精确复现 2 个目标失败（44 个既有用例通过）；实现后 fresh retry/edit、较早 copied stale、recursive fork及既有 synthetic anchor isolation 合计 48/48 通过

- [x] 1.2 在 `agent-runtime` 实现共享 `resolveInheritedLatestSource`，只使用 child fork source、anchor、messages 和 lane snapshot返回合格来源，不新增 public/gateway contract
  来源：design“FN-1.11 从消息派生子会话 / 修改方案”
  验证：2026-07-29 `npm -w @nextagent/agent-runtime run build` 通过；`npm test -- --run packages/agent-runtime/tests/retry-input-text-recovery.test.ts` 为 9/9 通过；release fork runtime suite 48/48 通过；未修改 `agent-contracts`、gateway port、Record 或 persistence schema

- [x] 1.3 增加 parent runtime non-read/non-write、跨 scope、非法 copied metadata 和 synthetic run 补建的 negative assertions
  来源：`FN-1.11` + `最新继承轮次可作为子会话首次操作来源` + “copied run anchor 仍不可作为 lifecycle run”“资格判定不读取 parent runtime”
  验证：2026-07-30 release fork runtime suite 55/55 通过，实际断言 copied anchor cancel not-found、无 synthetic `RequestRun`、parent run/checkpoint/timeline/lane不被读取或改写、跨 subject scope 返回 session not-found、损坏 metadata 返回 retry not-found，且 inherited source 读取失败保持 safe unavailable 语义而不伪装成 not-found；`npm test -- --run packages/agent-runtime` 为 14 files / 55 tests 通过；`npm run lint:architecture` 为 41 files / 247 tests 通过且无 dependency violation

## 2. `FN-2.3 重试请求`

- [x] 2.1 为 inherited retry 编写目标行为测试：attempt `1`、无 synthetic/parent lineage、child assembly、copied output replacement、附件失败、restart replay及 subsequent attempt `2`
  来源：`FN-2.3` + `Retryable request 状态分类` + “最新继承 request 可首次执行”“child 独立演进后继承 request 不可 retry”；`Retry 创建同一 request 的新 attempt` + “inherited retry 创建首个 child run”“inherited 首次执行后使用普通 lineage”；系统质量属性“安全” + `Inherited retry 保持 child 隔离` 全部 Scenarios；系统质量属性“可靠性/恢复” + `Inherited retry 可幂等恢复` 全部 Scenarios
  验证：2026-07-30 release fork runtime suite 55/55 通过，覆盖 attempt 1、无 `retryOfRunId`、child active assembly v2、copied assistant replacement、附件 authority fail closed、重建 coordinator 后 replay 同一 accepted run，以及后续 attempt 2 指向 child attempt 1；附件/parent/cross-scope/读取不可用失败均无新 run

- [x] 2.2 为 `retryLatest` 增加 inherited fallback，复用既有 acceptance/scheduler/checkpoint/event/terminal lifecycle，并为 attempt `1` idempotency replay 和 child-only visibility handoff提供明确分支
  来源：design“FN-2.3 重试请求 / 修改方案”
  验证：2026-07-30 `npm -w @nextagent/agent-runtime run build` 通过；release fork runtime suite 55/55 与 `npm test -- --run packages/agent-runtime` 14 files / 55 tests 通过；普通 retry attempt limit、input/model option recovery和supersede characterization保持通过

- [x] 2.3 验证 inherited attempt `1` 完成后的 cancel/retry/recovery/process-history 与普通 child run一致，且既有/新分享均完整
  来源：`FN-2.3` + `Retry 创建同一 request 的新 attempt` + “inherited 首次执行后使用普通 lineage”；design“跨 Function 协作与端到端流程”
  验证：2026-07-30 release fork runtime suite 55/55 与 fork/recovery 联合回归 2 files / 76 tests 通过，断言 inherited terminal run 的 cancel 使用普通 terminal outcome、runtime event history 可按新 run 查询、accepted attempt 可在不复制 USER message 的前提下恢复、重建 coordinator 可恢复幂等结果、后续 retry 创建 attempt 2/child lineage；在 inherited retry/edit 前创建的冻结分享保持原内容，新分享包含新 child attempt/replacement，递归 fork 后 edit/share 仍只改变末级 child，父会话分享与 runtime facts不变

- [x] 2.4 修复同一 root 上 retry 新 run 的 live/settled 过程仍沿用旧 run disclosure scope，确保新 run 自动展开且不触发额外历史加载
  来源：`FN-2.3` + `Retry 新 run 自动展开实时过程` + “retry 新 run 的实时过程自动展开”；design“FN-2.3 重试请求 / 修改方案”
  验证：2026-07-30 `buildSessionProjection`、`TurnBlock` 和 `ProcessPanel` 回归确认：持久化 `displayRunId` 保持历史加载 authority，过程面板使用当前 attempt 的显式 `runId` 作为 disclosure scope；live/settled overlay 不新增 process-history 请求。投影、ProcessPanel 与 TurnBlock 聚焦回归及 Playwright 通过，其中 fork child 的旧过程先断言折叠，再只发送 retry thinking 并断言新过程已展开，之后继续覆盖 answer、edit、recursive fork、reload 和 share。

- [x] 2.5 补充 retry pending 交接回归并修复旧 attempt 过程短暂保留：点击后立即隐藏旧过程，acceptance 绑定真实新 run，失败恢复原轮次
  来源：`FN-2.3` + `Retry 新 run 自动展开实时过程` + “retry pending 不展示旧 attempt 过程”
  验证：2026-07-30 `buildSessionProjection` 新回归在实现前精确失败为 pending 时仍保留旧 think/answer；实现后先从 history/settled 层移除旧 attempt，再叠加新 run active stream，并以 `pendingRequest.httpIdentityConfirmed=false` 覆盖 stream 先于 HTTP 的交接窗口。最终 focused Vitest 3 files / 194 tests 与 frontend build 通过；Playwright 2/2 覆盖点击后旧答案立即退出、stream `REQUEST_ACCEPTED` 先到仍不恢复旧过程、新 think/answer可见，以及 retry HTTP 失败恢复原答案。

## 3. `FN-2.1 提交请求`

- [x] 3.1 为 inherited edit 编写目标行为测试：preflight成功、新 child request/run、`editedFromRequestId`、copied source replacement、acceptance前失败、stale child和idempotent replay
  来源：`FN-2.1` + `Edit-resubmit command SHALL preflight the observed latest request` + “最新继承 request 通过 preflight”“child 已独立演进后继承目标失效”“Concurrent latest change is not covered by the preflight”；`Inherited edit 创建独立 child replacement` 全部 Scenarios
  验证：2026-07-30 release fork runtime suite 55/55 通过，覆盖新 child request/run、`REQUEST_ACCEPTED.editedFromRequestId`、copied request replacement、重建 coordinator 后 idempotent replay、child 演进 stale、递归 fork 后 edit/share 及 attachment acceptance 前失败保留 copied source

- [x] 3.2 为 `editLatest` 增加 inherited preflight fallback，复用现有 fresh edit acceptance、idempotency、latest-wins、checkpoint、event和request-scoped visibility replacement
  来源：design“FN-2.1 提交请求 / 修改方案”
  验证：2026-07-30 `npm -w @nextagent/agent-runtime run build`、release fork runtime suite 55/55、`npm test -- --run packages/agent-runtime` 14 files / 55 tests 全部通过；普通 edit visibility/replay/point-in-time preflight characterization保持通过

- [x] 3.3 验证 Agent Web 在最新 copied turn 上可提交 retry/edit，成功后正确衔接 live/history，失败时保留 draft 和原轮次；不得引入仅新 fork 可用的 marker
  来源：`FN-2.1` + `Edit-resubmit command SHALL preflight the observed latest request` + “最新继承 request 通过 preflight”；design“FN-1.11 从消息派生子会话 / 修改方案”
  验证：2026-07-30 `frontend/agent-web` retry/edit targeted tests 为 3 files / 38 tests 通过，`npm run build` 通过；现有 `latestTurnBlock.rootMessageId` retry/edit提交路径直接复用，源码不存在 `forkInherited` 或仅新 fork marker/禁用分支，因此无需前端生产代码修改

- [x] 3.4 修复 inherited edit 在 reload 前只移除 copied 用户问题、残留旧答案及操作入口的投影缺陷，使 retained message/history/live 三层按 source root 对称替换和回滚
  来源：`FN-2.1` + `Inherited edit 创建独立 child replacement` + “inherited edit 的实时界面原子替换完整原轮次”；design“FN-2.1 提交请求 / 修改方案”
  验证：2026-07-30 `conversationStore` 回归在实现前精确失败为 retained USER/ASSISTANT visibility `[true, true]` 而不是 `[false, false]`；实现统一 `rootMessageId ?? requestId ?? messageId` 轮次身份，并在 `optimisticallyEditRoot`/rollback 同时更新 message、history envelope 和 live/settled envelope。`npm test -- --run tests/conversationStore.test.ts tests/buildSessionProjection.test.ts tests/requestStore.test.ts` 为 3 files / 191 tests 通过，包含失败 rollback 恢复原轮次

## 4. 跨 Function 集成

- [x] 4.1 覆盖 fork → inherited retry/edit → live/history reload → subsequent normal control → share 的端到端用户旅程，并断言全过程仅产生 child facts
  来源：`FN-1.11`、`FN-2.3`、`FN-2.1`；design“跨 Function 协作与端到端流程”“跨 Function 质量属性设计”
  验证：2026-07-30 release fork runtime suite 55/55 覆盖 fork → inherited retry/edit → coordinator restart/history → subsequent retry → share，以及 recursive fork → inherited edit → share，并断言 parent run/messages/runtime stores不变；临时启动 5174 前端后，`npx playwright test --config=playwright.config.cjs tests/e2e/session-edit-retry.spec.cjs` 为 Chromium 1/1 通过，验证页面 live replacement、retry、edit失败 draft/原轮次回滚

- [x] 4.2 验证无需持久化 migration：基于 change 前创建的 fork fixture 和 recursive fork fixture执行 inherited action，且 rollback 后已有 child real run仍按普通历史读取
  来源：design“迁移与回滚”
  验证：2026-07-29 direct gateway fork fixture（不经过新增 resolver）与 recursive `FORK_SNAPSHOT` fixture均可执行 inherited action；新 child run按既有 runtime history/share路径读取；`npm test -- --run packages/agent-runtime packages/agent-platform-gateway-local` 为 14 files / 55 tests 通过；diff 未修改 gateway contract、Record、table、migration或持久化 schema

- [x] 4.3 修复 replacement 后再次 fork 的 canonical event lineage 重映射，并保留未知 source-bound payload fail-closed
  来源：`FN-1.11` + `Replacement lineage 在递归 fork 中保持 child-owned` + 全部 Scenarios；design“Replacement 后再次 fork 的事件引用”
  验证：2026-07-30 目标回归在实现前以 `retry → edit → fork` 精确复现 `SESSION_FORK_EVENT_PAYLOAD_UNSAFE`；实现仅将 `editedFromRequestId`、`retryOfRunId` 分别加入既有 request/run typed-reference key set。`npx vitest run --config vitest.config.release.ts tests/agent-kernel/session-fork-runtime.test.ts -t "unknown payload field|remaps retry and edit lineage"` 为 1 file / 2 tests 通过，断言两个 lineage 字段均指向 child IDs、事件 JSON 不含 source IDs、未知 source-bound identity 仍安全拒绝且无 child session

- [x] 4.4 建立 fork/retry/edit/share/reload/restart 的确定性状态机遍历，覆盖约定的全部有界语义状态和合法/非法转移
  来源：design“确定性状态机遍历”
  验证：2026-07-30 新增 `tests/agent-kernel/session-fork-actions-state-machine.test.ts`，先以 `visitedStates=0` 得到预期 RED，再实现确定性 BFS。`npx vitest run --config vitest.config.release.ts tests/agent-kernel/session-fork-actions-state-machine.test.ts` 为 1 file / 1 test 通过；报告锁定 130 个语义状态、910 个 attempted、799 个 accepted、111 个 safe rejected transitions，每个状态均尝试 7 种 action。fork 深度 `0/1/2`、retry `0/1/5`、edit `0/1/2`、copied/real/edited latest、active/terminal-pending 及 9 类 guard outcome 均非零，四条固定复合 replay seeds 全部完成且无 invariant failure sequence

- [x] 4.5 在真实 SQLite、Web contract 和 browser E2E 三层验收代表性复合路径与分享冻结
  来源：design“确定性状态机遍历”“四层验收”
  验证：2026-07-30 `npx vitest run --config vitest.config.release.ts tests/agent-kernel/session-fork-runtime.test.ts -t "keeps frozen shares and child-owned lineage"` 为 1 file / 1 test 通过，使用真实 Fastify Web 注入和 local SQLite gateway 覆盖 source submit → fork → replacement 前冻结分享 → inherited retry → edit → recursive fork → copied event history → grandchild inherited retry，并断言旧 child request 被替换、递归事件不含 source retry IDs、分享仍保留原答案；`PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 npx playwright test --config=playwright.config.cjs tests/e2e/session-edit-retry.spec.cjs` 为 Chromium 2/2 通过，覆盖 UI `fork → retry → edit → reload → fork → retry → reload → share` 及既有 edit/retry rollback。联合 fork runtime/state-machine/web suite 为 62/64 通过，剩余 2 个 Web invalid-input 状态码失败已在同一 `origin/main@63fc3ca1b` 干净快照复现，确认为非本 change 引入的既有基线问题；本 change 新增和受影响路径均通过

- [x] 4.6 补充 browser E2E 在 inherited edit 后、reload 前断言 copied 问题和答案均消失，旧答案不能 share/fork；并覆盖会话切换返回、reload 后与新答案继续 fork
  来源：`FN-2.1` + “inherited edit 的实时界面原子替换完整原轮次”；design“验证策略”
  验证：2026-07-30 `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 npx playwright test --config=playwright.config.cjs tests/e2e/session-edit-retry.spec.cjs` 为 Chromium 2/2 通过；复合路径使用缺省 `rootMessageId` 的 copied assistant fixture，在 edit live 阶段、切到 source 再返回 child、reload 后均只显示 replacement turn，旧答案无可操作 DOM，新答案继续 recursive fork/retry/share

- [x] 4.7 补充真实 SQLite 分享回归并修复 recursive fork copied retry answer 的 request-scoped USER 关联
  来源：`FN-1.15` + `Copied retry answer 的冻结分享保持完整` 全部 Scenarios
  验证：2026-07-30 `conversation-share` 新 SQLite 回归在实现前精确返回 `SHARE_CONTENT_DELETED`；实现仅在无真实 `RequestRun` 的 copied run fallback 中，按同 frozen creator scope/session 的唯一 `requestId` 补齐恰好一个 USER，selected assistant/capability 仍限冻结 run。agent-session 与 fork runtime 联合回归 2 files / 81 tests 通过；真实 Fastify + SQLite 复合路径新增 `retry answer → fork → share → read`，断言不同 child run anchor 的 USER/answer均返回，其他 attempt不泄漏，后续 edit/retry 与原冻结分享互不影响。

## 5. Change 整体验证

- [x] 5.1 在 4.3 至 4.5 完成后重新执行 OpenSpec、后端、前端、contract 和 architecture 全量门禁并记录实际结果；change-caused failure 未解决前不得标记完成
  来源：proposal“影响范围”；design“验证策略”
  验证：2026-07-30 fresh 门禁：状态机与 fork runtime 聚焦回归 2 files / 58 tests 通过；`openspec validate --all --strict` 262/262 通过；root `npm run build` 通过；扩展权限下 root `npm test` 117 files / 1105 tests 通过、1 file / 2 tests skipped；扩展权限下 `npm run test:contract` 39 files / 331 tests 通过；`npm run lint:architecture` 无 dependency violation 且 41 files / 247 tests 通过；`frontend/agent-web` 的 `npm run build` 通过，retry/edit targeted Vitest 3 files / 13 tests 通过，Playwright 2/2 通过。沙箱内 root/contract 首跑仅因本机端口 `listen EPERM` 失败，扩展权限复跑全绿；无 change-caused gate failure

- [x] 5.2 对最终 diff 执行 NextAgent 模型语义检视，确认 OpenSpec、fork isolation、event reference remap、分享冻结和最小 kernel non-regression
  来源：仓库 Push 门禁；design“跨 Function 质量属性设计”“确定性状态机遍历”
  验证：2026-07-30 按 `nextagent-skill-review` 与 `nextagent-code-review` 对 `origin/main@63fc3ca1b...working tree` 执行模型语义检视，结论 PASS。OpenSpec 的三个 modified Functions 与 canonical specs、Requirements、design 和 tasks 单一路径一致，无 `agent-contracts`、Web API、Gateway Record/port 或 persistence schema 变化；production delta 仅在 `agent-runtime` 复用 child-owned durable fork/message facts，并按既有 typed reference key set扩展 `editedFromRequestId`/`retryOfRunId`；前端仅新增用户旅程测试。fork isolation、owner/Agent Scope、unknown reference fail-closed、分享冻结、普通 retry/edit 和 minimal kernel 均有 fresh executable evidence；P0/P1/P2 findings 为 0

- [x] 5.3 对 3.4/4.6 的前端修复重新执行 focused tests、frontend build、OpenSpec strict validation，并刷新最终模型语义检视结论
  来源：仓库验证与 Push 门禁；design“验证策略”
  验证：2026-07-30 focused Vitest 3 files / 191 tests、`frontend/agent-web npm run build`、Playwright 2/2、`openspec validate --all --strict` 262/262 和 `git diff --check` 均通过。按 `nextagent-skill-review` 复核新增黑盒行为、design 白盒落点与 task/test 追踪为 PASS；按 `nextagent-code-review` 复核 frontend projection ownership、无 public contract/Gateway/persistence 变化、普通 edit rollback 和 multi-host 共享 store路径，结论 PASS，P0/P1/P2 findings 为 0

- [x] 5.4 对 2.4 执行投影与 ProcessPanel 聚焦回归、fork retry browser E2E、frontend build、OpenSpec strict validation和最终模型语义检视
  来源：仓库验证与 Push 门禁；design“验证策略”
  验证：2026-07-30 最终代码状态下，投影/ProcessPanel/TurnBlock 聚焦 Vitest 为 4 files / 159 tests 通过，Playwright 为 Chromium 2/2 通过，`frontend/agent-web npm run build` 通过，`openspec validate --all --strict` 为 262/262 通过，`git diff --check` 通过。`nextagent-skill-review` 复核独立功能 Requirement、design 唯一投影路径和 task/E2E 追踪，结论 PASS；`nextagent-code-review` 复核 browser projection ownership、多宿主共享路径、无 API/Gateway/persistence/安全边界变化及最小实现，结论 PASS，P0/P1/P2 findings 为 0。

- [x] 5.5 对 2.5/4.7 执行 focused frontend、agent-session、真实 SQLite/fork runtime、browser E2E、frontend/root build、OpenSpec strict validation，并刷新最终模型语义检视
  来源：仓库验证与 Push 门禁；design“验证策略”
  验证：2026-07-30 最终代码状态下，frontend focused Vitest 3 files / 194 tests、frontend build、Playwright 2/2、agent-session + fork runtime 2 files / 81 tests、root build、扩展权限 root tests 117 files / 1105 tests（1 file / 2 tests skipped）、contract 39 files / 331 tests、architecture 41 files / 247 tests、`openspec validate --all --strict` 262/262 和 `git diff --check` 全部通过。沙箱内 root/contract 首跑仅因本机 `listen EPERM` 失败，扩展权限复跑全绿。`nextagent-skill-review` 复核四个 modified Functions、最终目标措辞、FN-1.15 当前实现/GAP/唯一最小路径及长期基线计划，结论 PASS；`nextagent-code-review` 复核 frontend/browser projection、agent-session frozen-scope读取、runtime isolation、无 public/Gateway/persistence contract变化、安全与 minimal-kernel non-regression，结论 PASS，P0/P1/P2 findings 为 0。

- [x] 5.6 rebase 到最新 `origin/main` 后执行集成回归，修复主干类型收敛和 live/history identity 竞争，并区分 change 结果与主干基线
  来源：仓库验证与 Push 门禁；design“FN-2.3 重试请求 / 修改方案”“验证策略”
  验证：2026-07-30 最终代码 rebase 到 `origin/main@19ea17176` 后，root build、fork/session/share 聚焦回归 83/83（包含 inherited retry 保留最新主干 `routingConstraints` 与 `requestModelOptions`）、frontend focused Vitest 114/114、Playwright 25/25、root tests 1235 passed / 2 skipped、contract 339/339、architecture 254/254、frontend TypeScript、target change strict validation 和 `git diff --check` 全部通过。`openspec validate --all --strict` 仍仅有 `add-ts-toggle-question-favorite` 与 `extend-ts-workflow-batch-config-scope` 两个无关 active change 错误，已确认为主干基线而非本 change 引入。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design“长期基线刷新计划”同步三个 stable specs、Functions、Features、runtime architecture/module 和 spec-to-design-map；长期基线只记录最终成立的 child action 与隔离事实。
