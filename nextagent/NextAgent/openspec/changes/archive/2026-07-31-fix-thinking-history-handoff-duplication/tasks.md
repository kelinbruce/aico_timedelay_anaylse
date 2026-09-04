## 1. Thinking 交接回归测试

- [x] 1.1 `composeTurnProcessHistory()` 正常与幂等场景：先新增 persisted completed thinking 替代同 step live partial/completed、相同 `eventId` 替代及重复回填保持单份结果的测试，并在修改生产代码前确认新增断言失败
  来源：Requirement `Thinking live-history handoff keeps one canonical step`；Scenario `Persisted completed thinking replaces live copies`、`Repeated history hydration remains idempotent`
  验证：在 `frontend/agent-web` 运行 `npm test -- processHistory.test.ts`；预期新增测试因当前实现返回重复 thinking 或保留 live copy 而失败，既有测试仍可执行

- [x] 1.2 `composeTurnProcessHistory()` 保守降级与坐标隔离场景：新增相同文本但不同 `stepId`、缺少 `stepId`、相同 `stepId` 但 session/run/root 不同的 negative tests，并确认它们精确约束不合并和不跨 turn
  来源：Requirement `Thinking live-history handoff keeps one canonical step`；Scenario `Equal text from different steps remains distinct`、`Missing step identity uses conservative fallback`、`Thinking identity never crosses turn coordinates`
  验证：在 `frontend/agent-web` 运行 `npm test -- processHistory.test.ts`；预期 negative tests 能区分允许保留与必须隔离的 envelopes，且缺陷复现测试在生产修改前仍失败

- [x] 1.3 settled/live 未刷新页面交接：新增 settled completed thinking 与仍保留的同 step live completed envelope 同时进入 session projection 的回归测试，并在修改 turn overlay 前确认过程投影产生两个 thinking entries
  来源：Requirement `Thinking live-history handoff keeps one canonical step`；Scenario `Settled completed thinking replaces the retained live copy`
  验证：在 `frontend/agent-web` 运行目标 `buildSessionProjection.test.ts` 用例；预期修改前失败并显示两个相同 thinking，修改后只保留 settled event

- [x] 1.4 pure-live 累计 snapshot：新增同一 stable step 的较短与较长累计 live envelopes 同时进入 turn projection 的回归测试，并在生产修改前确认 projection/过程条目仍保留两个副本或形成两个分段
  来源：Requirement `Thinking live-history handoff keeps one canonical step`；Scenario `Pure-live cumulative snapshots replace the previous copy`
  验证：在 `frontend/agent-web` 运行目标 `buildSessionProjection.test.ts` 用例；预期 RED 精确显示同 step live snapshot 未被 canonical replacement，GREEN 后只保留 canonical order 最后一条且测试不比较文本包含关系

- [x] 1.5 active-run hydration eligibility：新增 active automatic target、active panel explicit target、active→terminal eligibility transition、completed historical turn 保留和 active-run replay characterization 测试，并在生产修改前确认 active run 仍会成为 history target
  来源：Requirement `Active run does not hydrate its own event history` 全部 Scenarios
  验证：在 `frontend/agent-web` 运行 `npm test -- useConversationTurnVisibility.test.tsx chat-page.route-state.test.tsx useStreamConnection.test.tsx`；预期新增 active target 断言在生产修改前失败，既有 exact-run replay 测试保持通过

## 2. 单 turn 组合修复

- [x] 2.1 `processHistory.ts`：在既有 session/run/root 校验之后识别 persisted completed thinking 的稳定 step 身份，以该 canonical set 替代 base layer 同 step copies；完成后正常、幂等、保守降级和坐标隔离测试全部通过
  来源：design `目标设计（Proposed Design）`、`组合优先级`
  验证：在 `frontend/agent-web` 运行 `npm test -- processHistory.test.ts`；预期该测试文件全部通过，结果只保留 matching persisted completed copy，其他 step 和无稳定身份 envelopes 不被推测合并

- [x] 2.2 `buildTurnBlocks.ts` 与共享 thinking identity helper：在 settled block 与 live envelopes 的既有合并点优先保留先进入的 completed stable step，移除随后叠加的同 step live copies；不同 step 和缺少稳定身份的 envelopes 保持既有行为
  来源：design `目标设计（Proposed Design）`、`组合优先级`
  验证：在 `frontend/agent-web` 运行 `npm test -- buildSessionProjection.test.ts processHistory.test.ts`；预期 settled/live 与 base/event-history 两条交接路径均保持单份 canonical thinking

- [x] 2.3 pure-live canonical snapshot：扩展 `buildTurnBlocks.ts` 的稳定 step 组合，使同一 stable step 的 live accumulated snapshots 只保留 canonical chronological order 最后一条；completed settled/history 的现有优先级保持不变
  来源：design `防线二：同一步只投影 canonical snapshot`、`组合优先级`
  验证：在 `frontend/agent-web` 运行 `npm test -- buildSessionProjection.test.ts buildTurnBlocks.test.ts processDetailsProjection.test.ts`；预期同 step 单份、不同 step 保留、缺少 identity 保守降级全部通过

- [x] 2.4 active-run target eligibility：在 `TurnBlock`/`MessageList` automatic 与 panel-expansion explicit target 入口复用 terminal eligibility，确保 active turn 不生成 target、active→terminal 即使 root/run 不变也重新观察，且不改变 scheduler 执行机制
  来源：design `防线一：active run 不进入 event-history hydration`
  验证：在 `frontend/agent-web` 运行 `npm test -- useConversationTurnVisibility.test.tsx chat-page.route-state.test.tsx useStreamConnection.test.tsx processHistoryScheduler.test.ts`；预期 active automatic/explicit 排除、terminal transition、historical target 与 exact-run replay 全部通过

## 3. 影响范围验证

- [x] 3.1 agent-web 定向回归与构建：验证 process-history、turn projection、visibility/explicit target、active-run replay 和 TypeScript/Vite 构建未被本次修改破坏
  来源：design `验证策略（Verification Strategy）`
  验证：在 `frontend/agent-web` 依次运行 `npm test -- processHistory.test.ts buildSessionProjection.test.ts buildTurnBlocks.test.ts processDetailsProjection.test.ts useConversationTurnVisibility.test.tsx chat-page.route-state.test.tsx useStreamConnection.test.tsx processHistoryScheduler.test.ts TurnBlock.test.tsx`、`npm run build`、`npm run build:vite:modes`；预期所有命令退出码为 0

- [x] 3.2 OpenSpec 与语义门禁：验证 proposal、spec、design、tasks 指向同一 agent-web 修复路径，且未新增 API、contract、后端 owner 或第二套 scheduler 状态
  来源：proposal `非目标`；design `目标设计（Proposed Design）`
  验证：在仓库根目录运行 `openspec validate fix-thinking-history-handoff-duplication --strict`，并执行 `$nextagent-skill-review`；预期 strict validation 通过，语义审查结论为 PASS 且 `需群内确认` 为 None

- [x] 3.3 大数据量历史加载压力回归：将浏览器场景扩展到 200 轮、每轮 3 个 completed thinking steps，覆盖滚动条拖动、滚轮和预览跳转，并验证目标轮次的 thinking 完整可见
  来源：用户要求评估本次修改对大数据量多轮对话下历史 think 加载性能的影响
  验证：在 `frontend/agent-web` 针对 `process-history-modes.spec.cjs` 的 `long history` 场景运行 Playwright；预期 event 查询峰值并发不超过 4、请求 run 数小于 200、预览目标轮次 3 个 thinking steps 均可见，且用例在 60 秒门禁内完成

## 4. B305 同步评估

- [x] 4.1 对比 `origin/nextagent-bugfix-B305` 的 visibility/explicit target、active-run replay 与 thinking projection，实现级确认是否存在同一缺陷，并列出从 main 修复中需要最小 backport 的生产文件与测试文件
  来源：用户要求确认 B305 是否受影响以及 main 修复后是否需要同步
  验证：使用 merge-base 与逐文件 diff 证明受影响路径是否同源；若 B305 已具备等价防线则记录无需同步，若缺失则给出不携带 main 其他功能的最小 cherry-pick/backport 范围和独立 MR 目标

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 proposal 的“归档前更新基线”归并 thinking live/history handoff 的长期行为与设计事实，并确认 stable spec、conversation UI architecture 和 agent-web module design 没有重复定义 step identity 或 canonical copy 规则。
