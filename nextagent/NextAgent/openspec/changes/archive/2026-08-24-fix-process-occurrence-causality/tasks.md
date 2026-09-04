## 0. 跨 Function 前置门禁

- [x] 0.1 复核最新 `origin/main` 的 active changes 与稳定规格，确认 `fix-process-occurrence-causality` 唯一接管 #777 的输入恢复执行说明 occurrence 和 #742 的 structured/canonical capability-card 仲裁；不得与未协调 change 并行修改相同 Requirements。
  来源：design `存量 Requirement 迁移方案`；proposal `What Changes`
  验证：运行 `openspec list --json` 和 `rg -n "Process Panel Entry Generation|CAPABILITY_STARTED and COMPLETED Suppression for Structured Tool Calls|用户输入边界分隔复用 stepId|#742|#777" openspec/changes openspec/specs`；预期没有另一个未协调 active change 修改相同目标 Requirements，并把审查结论记录在 task 验证证据中。
  实际结果（2026-08-15）：执行 `git fetch origin main` 后将隔离分支 fast-forward 到 `origin/main@9b68ae1fb`；上述 `openspec list --json` 与 `rg` 检查未发现其他 in-progress change 修改本 change 的一个 ADDED、三个 MODIFIED 或两个 REMOVED Requirements。已完成 change `refine-capability-result-card-presentation` 仍明确把 #742 留给独立 change；已完成 `suppress-nonstructured-residue-when-structured-exists` 只修改 non-agentic ApiCall 的 terminal `LLM_CONTENT_DELTA` producer 抑制条件，不修改 Bash `CAPABILITY_COMPLETED` 的 command output 或本 change 的前端卡片聚合边界。`openspec validate --all --strict` 结果为 282 passed、0 failed。

## 1. `FN-1.1 查看会话消息流`

- [x] 1.1 先增加 issue characterization：相同 root/attempt/run 和 `stepId=turn-2` 的说明 A、`USER_INPUT_RECEIVED`、说明 B 进入 live store、stream compaction 和 process projection 后必须保留两条且各自使用自身首次时序；实施前运行并确认至少一个目标断言失败。
  来源：`FN-1.1` + `用户输入边界分隔复用 stepId 的模型发生实例` + `补充信息边界后复用 stepId`、`不同输入分段产生相同正文`
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/conversationStore.empty-snapshot.test.ts tests/streamCompaction.test.ts tests/processDetailsProjection.test.ts tests/processHistory.test.ts`；预期实施前新增用例因 A 被 B 替换或 B 继承 A 的位置而 FAIL，记录失败断言。
  实际结果（2026-08-15，RED）：运行前三个目标文件，3 个新增断言全部按预期失败：conversation store 只剩 `after-input`，stream compaction 与 process projection 均只剩 1 条说明；其他 110 个断言通过。

- [x] 1.2 在既有 stream utility 层实现按 root/attempt/run 划分的 `USER_INPUT_RECEIVED` 输入分段，并让 conversation live lane、stream compaction、process-content entry、answer pending/completed aggregation 和 thinking dedup 复用该分段；不修改 envelope、timeline、Message 或 Gateway contract。
  来源：`FN-1.1` + `用户输入边界分隔复用 stepId 的模型发生实例` + `补充信息边界后复用 stepId`、`同一输入分段内累计帧原地更新`；design `FN-1.1 查看会话消息流 / 修改方案`
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/conversationStore.empty-snapshot.test.ts tests/streamCompaction.test.ts tests/processDetailsProjection.test.ts tests/processHistory.test.ts`；预期全部 PASS，A/B 均保留，同一 segment 的累计帧仍只形成一条。
  实际结果（2026-08-15，GREEN）：新增 `buildInputSegmentByEnvelope`，五个 consumer 复用同一结果；没有修改 public envelope、timeline、Message 或 Gateway。目标组扩展到 answer/thinking 后 7 个文件、184 个测试全部通过。

- [x] 1.3 增加输入边界缺失、不同 run/root/attempt、同 segment 相同正文和 history 分页组装负例，断言系统不通过正文、关键词或邻接关系伪造 occurrence，并保持现有 thinking 行为。
  来源：`FN-1.1` + `用户输入边界分隔复用 stepId 的模型发生实例` + `历史缺少可验证输入边界`、`同一输入分段内累计帧原地更新`；design `FN-1.1 查看会话消息流 / 修改方案`
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/conversationStore.empty-snapshot.test.ts tests/streamCompaction.test.ts tests/processDetailsProjection.test.ts tests/processHistory.test.ts src/features/chat/utils/buildTurnBlocks.thinking-dedup.test.ts`；预期全部 PASS，负例不跨 scope 或无边界拆分。
  实际结果（2026-08-15）：增加不同 run scope、重复边界、相同正文、history persisted/live 跨输入边界和 answer handoff 负例；同 segment 既有 live/completed 用例继续断言单条更新，thinking 全部改用共享 utility。运行 7 个相关文件共 184 个测试，全部通过。

## 2. `FN-10.6 前端定制`

- [x] 2.1 先用 issue Bash 序列增加 projection characterization：started、`SUB_TITLE=任务进展`、两个 `SUB_CONCLUSION`、canonical result 和 completed 当前会形成错序或互相抑制；新增目标用例要求恰好一张 started-anchor 卡片、进展在内、普通结果在后，实施前运行并确认失败。
  来源：`FN-10.6` + `TOOL_STRUCTURED_DELTA 过程面板处理` + `Bash 任务进展归入执行命令卡片`、`任务进展与普通命令结果混合呈现`
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/processDetailsProjection.test.ts`；预期实施前新增用例因出现独立“任务进展”、lifecycle 被抑制或 completion 覆盖 structured content 而 FAIL，记录失败断言。
  实际结果（2026-08-15，RED）：新增 issue 序列后目标断言失败；旧实现只留下 sequence=28 的独立“任务进展”，started-anchor 卡片被 suppression，普通命令结果不在该 section 内；同文件其余 99 个断言通过。

- [x] 2.2 在 process projection view model 中为现有 tool entry 增加私有 ordered structured sections，删除相同 `toolCallId` 下 structured/lifecycle 的双向 suppression，使 started、sections、独立普通 safe result 和 completion 原地聚合；无 lifecycle 的独立 structured workflow 保持现有稳定关联与 renderer 行为。
  来源：`FN-10.6` + `TOOL_STRUCTURED_DELTA 过程面板处理` + `Bash 任务进展归入执行命令卡片`、`独立结构化过程保持既有条目语义`、`关联 detail 没有匹配标题`、`相同 sequence 的标题先于详情`；design `FN-10.6 前端定制 / 修改方案`
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/processDetailsProjection.test.ts tests/TurnBlock.process-history.test.tsx`；预期全部 PASS，同一 T1 只有一张卡片且 first sequence 来自 started，不同 toolCallId 不串 section。
  实际结果（2026-08-15，GREEN）：仅将具有同 `toolCallId` lifecycle 的非 Workflow runtime Capability `SUB_TITLE` occurrence 聚合为私有 ordered section；无 lifecycle 的独立 `SUB_TITLE`、既有 `TITLE/DETAIL` canonical replacement 和 Workflow 独立条目保持不变。两个文件共 118 个测试全部通过。

- [x] 2.3 增加命令结果 precedence 负例：有独立普通 safe result 时显示在进展之后；completion stdout 含 structured residue 且无独立结果时省略 stdout preview，但保留 exit code、stderr/安全错误、truncation 和终态；浏览器不得解析 raw stdout。
  来源：`FN-10.6` + `TOOL_STRUCTURED_DELTA 过程面板处理` + `任务进展与普通命令结果混合呈现`、`混合 stdout 无法安全拆分`、`失败保留已经发生的进展`
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/processDetailsProjection.test.ts`；预期全部 PASS，结构化协议文本不重复，独立普通结果不丢失，失败信息位于已发生进展之后。
  实际结果（2026-08-15）：新增 completion-only residue、未认证 raw interim result 和独立 safe result delta 负例；projection 只按 event kind/可信 safe projection 仲裁，不解析 stdout。`processDetailsProjection` 共 103 个测试全部通过。

- [x] 2.4 先增加 fake-timer component tests，覆盖运行中展开、成功 settled 800 ms 后折叠、失败/超时/阻止保持展开、用户手动 override，以及 runtime Capability 内 TITLE/SUB_TITLE 不获得独立 structured workflow 展开例外；实施前运行并确认新失败状态用例失败。
  来源：`FN-10.6` + `Active process entries follow execution lifecycle` + `成功命令完成后折叠`、`失败命令保持展开`、`并发 Capability 独立收敛`；`Structured workflow process presentation remains visible` + `runtime Capability 内结构化内容不改变终态 disclosure`
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/useProcessEntryDisclosure.test.tsx tests/ProcessPanel.piu-lifecycle.test.tsx`；预期实施前至少一个失败/structured exception 目标断言 FAIL，记录失败断言。
  实际结果（2026-08-15，RED）：成功工具延迟、失败终态展开和 reduced-motion 延迟三个新增 hook 断言均按预期失败；卡片内 section 顺序 component 断言也先因只渲染普通结果而失败。

- [x] 2.5 让 `ProcessPanel` 按 sections、普通结果、失败原因顺序渲染同一卡片，并调整现有 disclosure 判定：成功启动 collapse timer，失败、超时和阻止不启动 timer，manual override 保持最高优先级；不得新增通用执行树或宿主特判。
  来源：`FN-10.6` + `Active process entries follow execution lifecycle` + `成功命令完成后折叠`、`失败命令保持展开`；`Structured workflow process presentation remains visible` + `runtime Capability 内结构化内容不改变终态 disclosure`；design `FN-10.6 前端定制 / 修改方案`
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/useProcessEntryDisclosure.test.tsx tests/ProcessPanel.piu-lifecycle.test.tsx tests/TurnBlock.process-history.test.tsx`；预期全部 PASS，无内容时不渲染空“命令结果”，手动开合不被终态反转。
  实际结果（2026-08-15，GREEN）：section、普通结果、失败原因按事实顺序渲染；仅成功 tool entry 延迟 800 ms，thinking 仍按既有策略立即收敛，失败终态保持展开，manual 状态优先；三个文件共 43 个测试全部通过。

- [x] 2.6 保持 legacy Requirement 原子迁移：来源 spec 的两个 `REMOVED` 与 canonical spec 的三个 `MODIFIED` 共同承载全部被触及行为，未触及 Requirements 原位保留，代码和测试引用改用 canonical Requirement 名称。
  来源：design `存量 Requirement 迁移方案`；`FN-10.6 前端定制 / 本 Function 的目标 Requirements`
  验证：运行 `openspec validate fix-process-occurrence-causality --strict` 和 `rg -n "Process Panel Entry Generation|CAPABILITY_STARTED and COMPLETED Suppression for Structured Tool Calls" openspec/changes/fix-process-occurrence-causality`；预期 strict PASS，两个来源只作为 REMOVED/迁移说明出现，目标行为只在 canonical delta 定义。
  实际结果（2026-08-15）：change strict validation PASS；两个 legacy 名称只出现在来源 REMOVED headings、迁移表和验证命令中，目标行为由 canonical delta 定义。

## 3. 跨 Function 集成与迁移

- [x] 3.1 用同一 issue fixture 覆盖 live accumulation、容量压缩、重连 merge 和 cold-history projection：说明 A、B 分别保留；B 位于输入边界后；Bash T1 恰好一张 started-anchor 卡片；刷新前后卡片内容、顺序和默认 disclosure 一致。
  来源：`FN-1.1` + `用户输入边界分隔复用 stepId 的模型发生实例`；`FN-10.6` + `TOOL_STRUCTURED_DELTA 过程面板处理`；design `跨 Function 协作与端到端流程`
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/conversationStore.process-history.test.ts tests/processHistory.test.ts tests/processDetailsProjection.test.ts tests/TurnBlock.process-history.test.tsx`；预期全部 PASS，live 与 cold history 投影深度等价。
  实际结果（2026-08-15）：相关总组扩展为 live lane、compaction、history compose、projection、answer、thinking 和 component disclosure 11 个文件共 250 个测试，全部通过；history 分页组装与 live/history transport hint 负例均保留 A/B occurrence，Bash projection 固定 started anchor 和同卡 section。

- [x] 3.2 验证 local、immersive、collaborative 三宿主复用同一过程投影和卡片 disclosure，不新增 host-specific 分支，并执行相关浏览器 journey。
  来源：proposal `目标与非目标` 的三宿主一致性；design `验证策略`
  验证：在 `frontend/agent-web` 运行 `npm run build:vite:modes`、`node scripts/run-playwright-smoke.cjs tests/e2e/process-history-modes.spec.cjs --grep "expanded safe technical details"` 和 `node scripts/run-playwright-smoke.cjs tests/e2e/process-message-event-projection.spec.cjs`；预期三种 mode build 成功，受影响 journeys 全部 PASS。
  实际结果（2026-08-15）：三宿主 mode build 通过；失败工具默认展开 local/immersive/collaborative 3/3，process message/history projection 4/4。实现和测试没有 host-specific production branch。

- [x] 3.3 验证 persistence 和模型上下文边界保持不变：没有新增 event/DTO/Gateway/table，canonical Capability Result 仍是唯一模型 tool-result，UI sections 和 raw stdout 解析不进入浏览器或模型上下文。
  来源：proposal `非目标`；design `FN-1.1 查看会话消息流 / 修改方案`、`FN-10.6 前端定制 / 修改方案`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests/prompt-shaping.test.ts packages/agent-runtime/tests/structured-delta-persistence-accumulator.test.ts` 和 `git diff --name-only origin/main...`；预期 tests 全部 PASS，semantic review 确认 diff 不含 public contract、Gateway 或 migration 文件；整仓 architecture gate 在 4.2 单独分类。
  实际结果（2026-08-15）：2 files、39 tests 全部通过；diff 只含 `frontend/agent-web` 与本 OpenSpec change，没有 contract、Gateway、migration、context 或 persistence 文件。语义审查确认 UI sections 不进入模型输入。

## 4. Change 整体验证

- [x] 4.1 完成前端受影响单测、TypeScript build、三宿主构建和目标 e2e，记录测试文件数、测试数与结果；任何未运行项必须有与影响范围一致的明确理由。
  来源：proposal `影响范围`；design `验证策略`
  验证：在 `frontend/agent-web` 运行受影响 11 文件测试组、`npm run build`、`npm run build:vite:modes` 和 3.2 的目标 Playwright commands；预期全部退出 0。
  实际结果（2026-08-15）：11 files、250 tests PASS；TypeScript build PASS；三宿主 build PASS；目标 e2e 3/3 + 4/4 PASS。

- [x] 4.2 完成仓库 contract/architecture/OpenSpec 和语义审查门禁，确认无 P0/P1、无未使用 helper/fixture、无重复身份实现，并记录最终 PASS 或带明确 P2 follow-up 的 PASS WITH FOLLOW-UP。
  来源：AGENTS.md 验证门禁；design `验证策略`、`长期基线刷新计划`
  验证：在仓库根目录运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`，并执行 `$nextagent-code-review`；预期命令全部退出 0，语义审查为 PASS 或 PASS WITH FOLLOW-UP 且没有 P0/P1。
  实际结果（2026-08-15）：root build PASS；OpenSpec 282/282；contract full run 的唯一 Cron 并发失败单独重跑 1/1 PASS；语义审查 PASS WITH FOLLOW-UP，无 P0/P1/P2/P3 提交范围问题。root test 与 architecture 的未绿项均定位到未改动的 `agent-remote-deployment` / `agent-log` 基线并记录在 `review.md`；因此不把整仓描述为全绿，且不执行 push。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按 design 的“长期基线刷新计划”归并三个 stable specs、两个 Functions、一个 Feature、overview、两份 architecture、一份 module 和 spec-to-design-map；确认被迁移 legacy Requirements 不再在来源 spec 或导航中重复定义，长期基线不包含实施步骤或临时风险。
