## 1. 调度与生命周期测试先行

- [x] 1.1 在 `frontend/agent-web/tests/conversationStore.process-history.test.ts` 增加 public-store RED：连续发布至少 20 个 explicit generations，先保持 4 个旧请求 active，断言同 session 只保留最新 16 个 queued/not-started explicit intents、同 run 去重、active 总数不超过 4；被 cap displacement 的 queued generation 释放 expansion demand/pin但不改变 disclosure，4 个 active request 在 session 存续时不被 abort
  来源：Requirement `Event history pagination is complete and bounded`，Scenario `Seventeen explicit intents keep the latest sixteen`
  验证：`cd frontend/agent-web && npm test -- tests/conversationStore.process-history.test.ts -t "bounds replacement targets to the latest sixteen explicit generations and four active loads"`；实现前必须是 assertion RED，实现后通过

- [x] 1.2 在 `frontend/agent-web/tests/processHistoryScheduler.test.ts` 固定 automatic 与 explicit 两套独立上限、`EXPLICIT > VIEWPORT > PRELOAD`、explicit generation latest-first、automatic latest-generation replacement、同 run 去重和 obsolete queued removal
  来源：design `Hydration target 与优先级`；Requirement `Event history pagination is complete and bounded`
  验证：`cd frontend/agent-web && npm test -- tests/processHistoryScheduler.test.ts -t "explicit|automatic|generation|priority"`；全部通过

- [x] 1.3 在 `frontend/agent-web/tests/conversationStore.process-history.test.ts` 和 `frontend/agent-web/tests/processHistoryScheduler.test.ts` 覆盖 `EXPLICIT`、`VIEWPORT`、`PRELOAD`、preview 四类 started request 不因 collapse/offscreen/automatic replacement/navigation supersession 被 abort，并对正常三 outcome 逐一断言 active slot/pin 释放
  来源：Requirement `Cold-history loading keeps a stable process affordance`；Requirement `Event history pagination is complete and bounded`，Scenario `Expansion demand releases on every outcome`
  验证：`cd frontend/agent-web && npm test -- tests/processHistoryScheduler.test.ts tests/conversationStore.process-history.test.ts -t "releases active and expansion demand after every terminal process-history outcome|collapse|offscreen"`；全部通过

- [x] 1.4 为 retry 建立独立验收：`FAILED` retry 创建同 run 的新 latest explicit generation，调度时不 touch recency，成功提交 `AVAILABLE` 时 touch；`LEGACY_UNAVAILABLE` 不呈现 retry、不创建 generation、不发 request
  来源：Requirement `Event history pagination is complete and bounded`；Requirement `Browser process-history cache remains coherent and bounded`
  验证：`cd frontend/agent-web && npm test -- tests/processHistoryScheduler.test.ts tests/conversationStore.process-history.test.ts -t "retry|LEGACY_UNAVAILABLE|recency"`；全部通过

- [x] 1.5 增加 lifecycle negative cases：queued expansion 被 explicit cap displacement 后 demand/pin 释放、disclosure 保持、重新 demand-eligible 时创建新 generation；session teardown 删除 queued、abort active、释放全部 demand/pin，late response 不产生三种 UI outcome
  来源：Requirement `Event history pagination is complete and bounded`，Scenario `Displaced expanded turn becomes eligible again`；Requirement `History hydration is isolated by session and load version`，Scenario `Session teardown cancels all hydration lifecycle state`
  验证：`cd frontend/agent-web && npm test -- tests/processHistoryScheduler.test.ts tests/conversationStore.process-history.test.ts -t "displaced expanded|session teardown|late response"`；全部通过

- [x] 1.6 增加唯一结果提交规则 tests：obsolete-generation completion 在 session 存续、validation 通过且 active identity 匹配时提交 run cache并释放自身slot/pin，但不恢复旧target/preview/navigation；identity mismatch late response 丢弃且不得释放或覆盖当前request
  来源：Requirement `History hydration is isolated by session and load version`，Scenarios `Obsolete generation commits cache without restoring intent`、`Mismatched late completion is discarded`
  验证：`cd frontend/agent-web && npm test -- tests/processHistoryScheduler.test.ts tests/conversationStore.process-history.test.ts tests/chat-page.route-state.test.tsx -t "obsolete generation|active identity|does not restore"`；全部通过

- [x] 1.7 在 `frontend/agent-web/tests/processHistory.test.ts` 增加交接一致性 RED：同一 session/run/root/非空 `stepId` 的 persisted completed thinking 覆盖 live partial 与 live completed 副本；reconnect/replay 重复组合仍只保留一份；不同 `stepId` 的相同文本保持两份；任一候选缺少非空 `stepId` 时只按精确 `eventId` 去重
  来源：Requirement `Browser history hydrates process events by visible turn run`，Scenarios `Persisted completed thinking replaces the live copy`、`Equal thinking text from distinct steps remains distinct`、`Thinking without a stable step identity is not guessed`
  验证：`cd frontend/agent-web && npm test -- tests/processHistory.test.ts -t "uses persisted completed thinking as the canonical copy for one stable step"`；实现前必须是 assertion RED，实现后通过

## 2. 实现有界 scheduler 与 run cache

- [x] 2.1 新增 `frontend/agent-web/src/features/chat/history/processHistoryScheduler.ts`，实现每 session automatic targets≤16、explicit intents≤16、monotonic generation、latest-first explicit、四 active request、同 run 去重和 automatic set 原子替换
  来源：design `Hydration target 与优先级`、`ProcessHistoryScheduler`
  验证：`cd frontend/agent-web && npm test -- tests/processHistoryScheduler.test.ts`；排序、容量、去重、replacement 和并发用例通过

- [x] 2.2 实现 target replacement：automatic、explicit cap、preview 和 navigation supersession 只移除 queued/not-started work；所有来源的 started request membership 与 target set 分离，在 session 存续时由 active-request pin 保留至正常 outcome
  来源：Requirement `Event history pagination is complete and bounded`，Scenario `Seventeen explicit intents keep the latest sixteen`
  验证：`cd frontend/agent-web && npm test -- tests/processHistoryScheduler.test.ts tests/conversationStore.process-history.test.ts -t "latest sixteen|four active|AbortError"`；全部通过

- [x] 2.3 修改 `frontend/agent-web/src/state/conversationStore.ts`，让 authoritative/older/newer/anchor load 只更新 message facts 与 scheduler target，不再按整个 message window 创建独立 queue 或重置全部 `LOADING`
  来源：Requirement `Browser history hydrates process events by visible turn run`，Scenario `Message window contains offscreen runs`
  验证：`cd frontend/agent-web && npm test -- tests/conversationStore.process-history.test.ts -t "offscreen|authoritative|older|newer|anchor|session"`；全部通过

- [x] 2.4 实现 run-scoped cache，把 state 与 validated envelopes 作为同一 `sessionId + runId` fact；最后一个 pin 释放时同步对整个 session 执行 whole-run LRU，收敛到≤64 unpinned `AVAILABLE` runs 且≤2,000 unpinned envelopes，超大单 run 整体淘汰
  来源：Requirement `Browser process-history cache remains coherent and bounded`，Scenario `Final pin release enforces whole-run limits immediately`
  验证：`cd frontend/agent-web && npm test -- tests/processHistoryScheduler.test.ts tests/conversationStore.process-history.test.ts -t "64|2000|atomically|final pin|oversized"`；全部通过

- [x] 2.5 固定 pin source：outcome 前 expansion intent 与 active request可 pin；outcome 后仅 `VIEWPORT`、`PRELOAD`、current preview、active request/live run 可 pin；单纯 expanded view state 不 pin cache
  来源：design `Run-scoped 状态与缓存`；Requirement `Browser process-history cache remains coherent and bounded`
  验证：`cd frontend/agent-web && npm test -- tests/processHistoryScheduler.test.ts -t "pin|outcome|preview|viewport|preload"`；全部通过

- [x] 2.6 固定 recency：只在成功提交 `AVAILABLE`（含 retry success）或 cached `AVAILABLE` 从 demand absent→present 且实际复用时 touch；retry scheduling、重复 observer、render/snapshot read、pin/unpin 和 same-generation refresh 均不 touch
  来源：Requirement `Browser process-history cache remains coherent and bounded`，Scenario `Reads and retry scheduling do not change recency`
  验证：`cd frontend/agent-web && npm test -- tests/processHistoryScheduler.test.ts tests/conversationStore.process-history.test.ts -t "recency|touch|actual reuse"`；全部通过

- [x] 2.7 实现 session teardown：清除该 session 的 queued work、abort in-flight、释放全部 demand/pin并删除 scheduler state；teardown cancellation 和 late response 均不得提交 `AVAILABLE`、`FAILED` 或 `LEGACY_UNAVAILABLE`
  来源：Requirement `History hydration is isolated by session and load version`，Scenario `Session teardown cancels all hydration lifecycle state`
  验证：`cd frontend/agent-web && npm test -- tests/processHistoryScheduler.test.ts tests/conversationStore.process-history.test.ts -t "session teardown|late response"`；全部通过

- [x] 2.8 实现唯一 completion guard：同 `sessionId + runId` coalesce 到一个 active identity；surviving session + identity match + validation pass 即提交run cache/outcome并释放自身slot/pin，不以target generation否决；identity mismatch丢弃且不触碰当前active；cache commit不恢复旧交互意图
  来源：Requirement `History hydration is isolated by session and load version`
  验证：`cd frontend/agent-web && npm test -- tests/processHistoryScheduler.test.ts tests/conversationStore.process-history.test.ts -t "active identity|obsolete generation|mismatched late"`；全部通过

- [x] 2.9 停止把 cold run events 扁平复制进 session envelope 层，由 `frontend/agent-web/src/features/chat/components/TurnBlock.tsx` 只组合当前 display run 的 message facts 与 validated cached events，保持 final answer 只来自 message
  来源：Requirement `Browser history hydrates process events by visible turn run`
  验证：`cd frontend/agent-web && npm test -- tests/conversationStore.process-history.test.ts tests/TurnBlock.process-history.test.tsx tests/processDetailsProjection.test.ts`；completed thinking、tool result、retry run 与 missing result 用例通过

- [x] 2.10 修改 `frontend/agent-web/src/features/chat/history/processHistory.ts` 的 Turn 局部组合：为 persisted completed thinking 建立 `sessionId + runId + rootMessageId + stepId` identity，在加入 unmatched base 前移除同一步骤的 live partial/completed 副本；不得改变 capability result enrichment、answer owner、缺失 `stepId` fallback 或 live stream lifecycle
  来源：design `Turn 局部组合`；Requirement `Browser history hydrates process events by visible turn run`
  验证：`cd frontend/agent-web && npm test -- tests/processHistory.test.ts tests/processDetailsProjection.test.ts tests/TurnBlock.process-history.test.tsx`；thinking 交接、distinct step、missing-`stepId`、工具结果和最终答案用例通过

## 3. 真实视口、preview 与 ProcessPanel

- [x] 3.1 新增 `frontend/agent-web/src/features/chat/history/useConversationTurnVisibility.ts`，以 shared scroll viewport 观察 TurnBlock；输出 `VIEWPORT` 与一屏 `PRELOAD`，wheel 每 animation frame 最多发布一次，pointer drag 结束后发布最终 viewport，120ms 稳定后发布 preload
  来源：design `真实视口注册`
  验证：`cd frontend/agent-web && npm test -- tests/MessageList.process-history-visibility.test.tsx`；observer root、resize、wheel、pointer 和 cleanup 用例通过

- [x] 3.2 修改 `frontend/agent-web/src/features/chat/components/MessageList.tsx` 接入真实视口 target；未渲染和 offscreen message 不触发 event request，visibility hook 不拥有 scroll/follow 状态
  来源：Requirement `Browser history hydrates process events by visible turn run`，Scenario `Message window contains offscreen runs`
  验证：`cd frontend/agent-web && npm test -- tests/MessageList.process-history-visibility.test.tsx -t "does not request process history for an offscreen MessageList turn"`；通过

- [x] 3.3 修改 `frontend/agent-web/src/pages/ChatPage.tsx`：loaded/placeholder hover 均不查询 event；preview click 在 message/anchor 导航后发布 current explicit target；rapid A/B/C 只有最新 navigation token 可滚动和发布 demand
  来源：Requirement `Preview interaction drives process hydration only after explicit navigation`
  验证：`cd frontend/agent-web && npm test -- tests/chat-page.route-state.test.tsx -t "preview|latest rapid"`；通过

- [x] 3.4 修改 `frontend/agent-web/src/features/chat/components/ProcessPanel.tsx` 与 `TurnBlock.tsx`：已有“执行详情”标题不被 loading 文案替换；loading-only row 延迟 300ms；展开 body 立即显示安全 loading；普通 collapse/offscreen 不取消 active request；正常三种 outcome 原位更新并释放 expansion demand；capacity displacement 保留 disclosure；teardown cancellation 不生成 outcome；仅 `FAILED` 渲染 retry，`LEGACY_UNAVAILABLE` 不渲染 retry
  来源：Requirement `Cold-history loading keeps a stable process affordance`
  验证：`cd frontend/agent-web && npm test -- tests/TurnBlock.process-history.test.tsx -t "delays a loading-only row for 300ms without replacing the existing process title|loading|legacy"`；通过

- [x] 3.5 保持 disclosure/cache 分离：offscreen expanded run 可被 LRU 淘汰但 expanded state 不变；重新进入 `PRELOAD`/`VIEWPORT` 时保持展开、显示 loading、恰好发一个 reload
  来源：Requirement `Cold-history loading keeps a stable process affordance`，Scenario `Expanded disclosure survives cache eviction`；Requirement `History hydration is isolated by session and load version`，Scenario `Offscreen disclosure state is independent from cache state`
  验证：`cd frontend/agent-web && npm test -- tests/TurnBlock.process-history.test.tsx tests/conversationStore.process-history.test.ts -t "expanded|eviction|revisit|reload"`；通过

## 4. 宿主、长会话与门禁

- [x] 4.1 扩展 `frontend/agent-web/tests/e2e/process-history-modes.spec.cjs` 的 200 轮 fixture，每轮包含多次 thinking 与工具 lifecycle；覆盖 preview click/hover、右侧滚动条 drag、wheel、page refresh、session switch、outcome、eviction/revisit、实时到 persisted thinking 交接/reconnect/replay 不重复和 request probe
  来源：design `验证策略（Verification Strategy）`
  验证：`cd frontend/agent-web && npm run test:e2e:smoke`；local、immersive、collaborative 三 host 使用同一 shared scheduler，active event request≤4、explicit intent≤16，最终 think/tool 内容完整

- [x] 4.2 增加 host ownership negative assertions，拒绝 host shell/PIU adapter 自建 scheduler、cache、visibility observer 或 run-event query
  来源：Requirement `Process history behavior is identical across all host modes`
  验证：`cd frontend/agent-web && npm test -- tests/process-history-host-ownership.test.ts`；非法 fixtures 被拒绝，正常源码通过

- [x] 4.3 运行 Layer 4 定向门禁：`cd frontend/agent-web && npm test -- tests/processHistory.test.ts tests/processHistoryScheduler.test.ts tests/conversationStore.process-history.test.ts tests/MessageList.process-history-visibility.test.tsx tests/chat-page.route-state.test.tsx tests/TurnBlock.process-history.test.tsx tests/process-history-host-ownership.test.ts`；全部新增与受影响用例通过

- [x] 4.4 运行 frontend 全量与构建门禁：`cd frontend/agent-web && npm test -- --minWorkers=1 --maxWorkers=4`、`npm run build`、`npm run build:vite:modes`；只允许 release 计划已登记且指纹未扩张的 baseline exception

- [x] 4.5 运行仓库门禁：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`；只允许 release 计划已登记且指纹未扩张的 baseline exception

- [x] 4.6 运行 `openspec validate --all --strict`、`$nextagent-skill-review` 和 push 前 `$nextagent-code-review`；确认 proposal/design/spec/tasks 只有最终设计目标、本优化 change 不新增 `agent-contracts` 或后端 API、没有 host-private owner 变更，语义审查无 P0/P1

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 proposal 的“归档前更新基线”更新四个 stable specs、`conversation-ui-state`、`agent-web` module design 和 `spec-to-design-map`。归档时确认 process history 的行为、state/cache owner 和 API 边界各有唯一主文档。
