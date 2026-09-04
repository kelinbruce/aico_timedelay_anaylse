## 0. 共享架构与迁移门禁

- [x] 0.1 收窄 change：只修改 Workflow inner durable owner、live/history convergence 和三档策略边界；不新增 `agent-contracts`、`agent-common`、Gateway、public DTO、database migration、产品适配或群内确认项。
  - 来源：proposal `目标与非目标`、`契约与确认边界`；design `设计范围`。
  - 验证：delta specs 不包含 public schema/Gateway/migration；proposal 明确 `需群内确认：None`。

- [x] 0.2 完成两个 legacy Requirements 的原子迁移和并行 active change 归档顺序：`add-structured-delta-bash-apicall-identification` → `add-stream-dsl-message-type` → 本 change。
  - 来源：design `存量 Requirement 迁移方案`、`并行 active change 的归档顺序`。
  - 验证：`openspec validate persist-ts-refresh-stable-completed-turns --strict`、`openspec validate add-stream-dsl-message-type --strict`、`openspec list --json`、`git diff --check`。
  - 实际结果（2026-08-05）：两个 strict validation、active change 列表读取和 diff check 均以 exit code 0 完成；两个前置 change 状态均为 complete，本 change 保持 in-progress。

## 1. FN-9.8 持久化和恢复工作流

- [x] 1.1 先新增失败测试，锁定 Direct Workflow inner `TOOL`、`SKILL`、`SUBFLOW` 不创建 `ASSISTANT_TOOL_USE`/`CAPABILITY_RESULT` Message，也不产生 inner `CAPABILITY_RESULT_DELTA`；terminal Assistant Message 仍持有 `TURN_ANSWER`。
  - 来源：Requirement `Workflow 内部过程与模型会话事实分离`；Scenario `Direct Workflow 内部节点不创建模型协议 Message`。
  - 验证：`npm test -- packages/agent-core/tests/agent-routing-core.test.ts packages/agent-core/tests/workflow-runtime-event-projector.test.ts`；新增断言必须先在变更前行为上失败。
  - 实际结果（2026-08-05）：TDD red 已复现 inner protocol Message/ordinary result carrier；实现后与相关受影响套件合计 8 files / 318 tests 通过。

- [x] 1.2 以最小实现让 Direct 与 Workflow-as-Tool inner execution 复用 Workflow runtime projector：lifecycle body-free，fragment live-only，completed product durable；title/detail/answer 按可信 root/sub execution 映射，`EXPAND_PANEL` 等未触及 canonical level 保持 main 行为。
  - 来源：Requirements `Workflow 内部过程与模型会话事实分离`、`Workflow 完成态产品过程可从 Event 恢复`；Scenarios `完成态产品是唯一过程正文 carrier`、`内部 Capability Result 不形成第二个 carrier`、`产品层级不改变 canonical answer owner`、`未触及 canonical level 保持既有映射`；design `FN-9.8 / 修改方案`。
  - 验证：`npm test -- packages/agent-core/tests/agent-routing-core.test.ts packages/agent-core/tests/workflow-runtime-event-projector.test.ts packages/agent-core/tests/workflow-tool-delta-projection.test.ts`。
  - 实际结果（2026-08-05）：三个 projector/routing 套件与受影响后端套件合计 8 files / 318 tests 通过；`EXPAND_PANEL` 未修改。

- [x] 1.3 在既有 timeline persistence policy 中只允许 qualified Workflow lifecycle/completed product message-free；ordinary process 缺 Message 继续降级，fragment 继续 live-only，自报 Workflow identity/persistence hint 必须失败。
  - 来源：Requirement `Workflow 完成态产品过程可从 Event 恢复`；Scenario `自报 Workflow identity 不能取得 message-free 资格`；design `FN-9.8 / 修改方案` 第 5 项。
  - 验证：`npm test -- packages/agent-runtime/tests/timeline-event-persistence-policy.test.ts packages/agent-runtime/tests/run-state-thinking-persistence.test.ts`；negative fixture 必须实际触发伪造字段并断言不持久化正文。
  - 实际结果（2026-08-05）：negative fixtures 先后复现非法 node type、空 occurrence、null content 和额外正文被误接纳；修复后 timeline/Channel/tool-loop 3 files / 108 tests、补充 runtime/ordinary 2 files / 27 tests 通过。

- [x] 1.4 只做既有上下文与派生操作回归：Workflow Event 不进入 provider input/token budget/prefix cache，retry/edit/fork 不从 Event 创建 Message 或 child Active Context item。
  - 来源：stable `ts-stream-history-consistency / Process history never affects model context or prefix cache`、`Retry selects process history by visible run`；stable `session-fork-from-message / Fork process snapshots never participate in model context`；design `FN-9.8 / 修改方案` 第 7 项。
  - 验证：`node node_modules/vitest/vitest.mjs run --config vitest.config.release.ts tests/agent-kernel/workflow-event-context-boundary.test.ts tests/agent-kernel/session-fork-runtime.test.ts tests/agent-kernel/request-retry.test.ts tests/e2e/product-journey/09-10-retry-edit.test.ts`。
  - 实际结果（2026-08-05）：context/fork/history release 3 files / 81 tests 通过；request-retry 与 retry/edit product journey 2 files / 12 tests 通过。无 context/fork production diff。

## 2. FN-1.2 断线后从上次位置继续

- [x] 2.1 先新增 Channel 失败测试：qualified Workflow lifecycle 不查询 Message、不增加 `contentUnavailable`，completed product 直接从 Event 投影；ordinary 缺失/歧义 Message 仍安全降级。
  - 来源：Requirement `过程历史从消息正文与事件时序联合恢复`；Scenarios `Direct Workflow 从两类 durable fact 恢复`、`Workflow-as-Tool 保留 outer protocol 与 inner process`、`普通 Capability 缺少 Message 时保持 closed`、`过程失败不删除已提交回答`。
  - 验证：`node node_modules/vitest/vitest.mjs run --config vitest.config.release.ts packages/agent-channel-common/tests/process-message-projection.test.ts packages/agent-channel-web/tests/session-event-history-route.test.ts`；新增 Workflow case 必须先在变更前行为上失败。
  - 实际结果（2026-08-05）：TDD red 已复现 qualified lifecycle 被按缺失 Message 降级；修复后 process projection 进入 318-test 受影响套件，Web history route 18 tests 通过。

- [x] 2.2 最小修改 Channel 联合恢复路径；ordinary Message association 与安全 projector 保持原实现，只有 FN-9.8 qualified Workflow Event 走 message-free 分支。
  - 来源：Requirement `过程历史从消息正文与事件时序联合恢复`；design `FN-1.2 / 修改方案` 第 1、2 项。
  - 验证：运行 2.1 的完整命令，并证明浏览器响应不包含原始隐藏 Message 或新增关联请求。
  - 实际结果（2026-08-05）：Channel 只增加 qualified lifecycle bypass；product 沿用既有 structured projection，history route 18 tests 与 ordinary 缺失/歧义回归通过。

- [x] 2.3 先新增 Frontend 失败测试：matching completion 替换 Workflow fragment，任一 request terminal 清除残留 fragment；cold history 不恢复 fragment；terminal answer 与 product TEXT/structured content 按目标规则组合。
  - 来源：Requirement `Live in-progress state converges to completed cold history`；Scenarios `Workflow 完成态产品收敛 fragment`、`请求终态清理不可恢复的 Workflow fragment`、`Workflow 产品与最终回答收敛`。
  - 验证：在 `frontend/agent-web` 运行 `npm test -- tests/processHistory.test.ts tests/processDetailsProjection.test.ts tests/answerContent.test.ts tests/streamTextSemantics.test.ts`；新增断言必须先在变更前行为上失败。
  - 实际结果（2026-08-05）：TDD red 已复现 fragment 残留与 answer/product 重复；修复后六个 settled/cold/answer 相关套件 174 tests 通过。

- [x] 2.4 复用一个 product reconcile 和 answer composition 完成 Frontend 收敛：严格相同 TEXT 最多显示一次，PIU/DSL/STREAM_DSL/ACTION/OPERATOR/FILE 或不同 TEXT 与 terminal answer 同时保留；settled 优先级和普通 terminal 不刷新 conversation 的行为不变。
  - 来源：Requirement `Live in-progress state converges to completed cold history`；Scenario `Workflow 产品与最终回答收敛`；design `FN-1.2 / 修改方案` 第 3–5 项。
  - 验证：运行 2.3 的完整命令，并追加 `npm test -- tests/TurnBlock.process-history.test.tsx tests/buildSessionProjection.test.ts`；同一 fixture 的 settled/cold semantic result 必须相同。
  - 实际结果（2026-08-05）：六个指定套件 174 tests 通过；相同 TEXT 去重、structured/different TEXT 保留、terminal 清理均有参数化覆盖。

- [x] 2.5 对迁入 FN-1.2 的 ordinary/CLIP single-Message 行为只做回归，不新增第二个存储或实现分支；deferred string payload Scenario 不形成当前代码任务。
  - 来源：Requirement `结构化过程正文使用单一 Message 恢复`；Scenarios `历史从 stored Message 恢复 CLIP structured delta`、`非 structured CLIP payload 保持 ordinary result projection`、`Workflow product 使用独立 Event-owned 例外`；design `存量 Requirement 迁移方案`。
  - 验证：`npm test -- packages/agent-channel-common/tests/process-message-projection.test.ts packages/agent-core/tests/tool-structured-delta-emission.test.ts`；检查最终 diff 没有为 CLIP/ordinary body 增加 Event copy。
  - 实际结果（2026-08-05）：ordinary structured emission 与 thinking persistence 2 files / 27 tests 通过；最终 production diff 没有新增 CLIP/ordinary Event body copy。

- [x] 2.6 先用 Frontend 失败测试锁定 title-suppressed Workflow product：保留独立 occurrence 与正文，但 live/history 都不渲染空标题节点、独立状态图标、完成对勾或展开按钮；随后只修改展示层完成最小修复。
  - 来源：Requirement `Live in-progress state converges to completed cold history`；Scenario `Workflow 隐藏标题时只呈现产品正文`；design `FN-1.2 / 修改方案` 第 7 项。
  - 验证：在 `frontend/agent-web` 运行新增的 ProcessPanel 定向测试，并运行 `npm test -- tests/processDetailsProjection.test.ts tests/TurnBlock.process-history.test.tsx`。
  - 实际结果（2026-08-06）：新增 ProcessPanel 用例先复现正文不可见且出现空标题节点，最小展示修复后 ProcessPanel 29 tests 与 processDetails projection 74 tests 通过；TurnBlock process-history 14/15 tests 通过，剩余 1 项为 latest main 新增 executing GIF 后旧断言取错首个 `img` 的既有基线失败，本 change 未修改该源码或断言。

- [x] 2.7 同步 latest main 的 retry-attempt projection 后增加 Workflow 场景 characterization：Retry 完成态只呈现当前 attempt 的过程与一份 terminal answer，cold history 与 settled live 一致。若 latest main 已满足则不修改 Retry production code；只有失败测试可复现时才做最小修复。
  - 来源：proposal `ordinary Message-backed process、retry、edit、fork 保持既有行为`；Requirement `Live in-progress state converges to completed cold history`。
  - 验证：运行 main 既有 retry projection 测试与新增 Workflow retry 回归；最终 diff 中任何 Retry production 改动都必须由 latest-main red test 证明必要。
  - 实际结果（2026-08-06）：同步 `origin/main@a534a1a4` 后，新增 Workflow 多-attempt 用例证明 settled live 与 cold history 都只保留 `run-new` 的 product 与 terminal answer；main 的 buildTurnBlocks/conversationStore/requestStore Retry 相关 4 files / 148 tests 通过，因此未增加 Retry production diff。

- [ ] 2.8 先用失败测试锁定两条 presentation 规则，再做最小实现：title-suppressed product 使用既有图标列布局占位并与同层 detail 对齐；Workflow-as-Tool 在调用 Workflow 前先发布 outer start，并只按可信 `parentToolCallId = outer toolCallId` 把 inner entries 放入 active/completed outer Workflow disclosure，Direct/unmatched/ordinary entry 保持顶层。
  - 来源：Requirement `Live in-progress state converges to completed cold history`、`过程历史从消息正文与事件时序联合恢复`；Scenarios `Workflow 隐藏标题时只呈现产品正文`、`Workflow-as-Tool inner process 归入 outer Workflow 折叠区`；design `FN-1.2 / 修改方案` 第 7、8 项。
  - 验证：运行 `packages/agent-core/tests/parallel-tool-loop.test.ts`，证明 outer start 先于 Workflow invoke/inner Event；在 `frontend/agent-web` 运行 `npm test -- src/features/chat/components/ProcessPanel.test.ts tests/processDetailsProjection.test.ts tests/TurnBlock.process-history.test.tsx`，验证 active outer 默认展开、outer collapsed/expanded、child order、Direct/unmatched non-grouping 以及 settled/cold 等价；随后运行 `npm run build`。
  - 当前结果（2026-08-06，`origin/main@a973bdf2`）：新增用例先后复现缺少对齐槽、inner 顶层泄漏、关联字段丢失和 Workflow invoke 前缺少 outer start；合并 latest main 后，受影响后端 14 files / 444 tests、Frontend 8 files / 223 tests 中 222 tests 通过、Workflow E2E 2 files / 4 tests、root/frontend build 与 `build:vite:modes` 均通过。active outer 默认展开并承载 matching inner content。任务保持未勾选：TurnBlock 定向套件仍有 latest main 既有 reduced-motion 图片选择断言失败，该失败不在本 task production diff 中。

## 3. FN-2.4 查看请求状态

- [x] 3.1 以参数化 characterization 锁定 `STATUS_ONLY`、`SUMMARY`、`DETAIL`：三档下 Workflow inner product 与 `TURN_ANSWER` deep-equal，ordinary/outer Capability Result 继续保持既有差异和安全上限。
  - 来源：Requirement `Workflow 产品过程不受 Capability Result 呈现策略裁剪`；Scenarios `三档配置不改变 Workflow inner product`、`普通 Capability Result 继续受策略治理`、`产品层级不绕过 canonical answer 边界`。
  - 验证：`npm test -- packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`，并运行 2.3 的 frontend 参数化用例。
  - 实际结果（2026-08-05）：三档 policy characterization 纳入 8 files / 318 tests，frontend 参数化用例纳入 174 tests，均通过；policy production logic 未扩展到 inner product。

- [x] 3.2 保留 Workflow-as-Tool 唯一 outer Tool protocol pair 与标准 outer lifecycle；outer Tool-use Message 写入后、调用 Workflow 前发布 ordinary outer start，canonical outer result Message 写入后继续发布 ordinary outer result delta/completion，inner product 不进入三档 policy。
  - 来源：Requirement `Workflow 产品过程不受 Capability Result 呈现策略裁剪`；Scenario `Workflow-as-Tool 只治理 outer result`；design `FN-2.4 / 修改方案`。
  - 验证：`npm test -- packages/agent-core/tests/parallel-tool-loop.test.ts packages/agent-core/tests/workflow-tool-delta-projection.test.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`；`node node_modules/vitest/vitest.mjs run --config vitest.config.release.ts tests/e2e/workflow-tool-agent-loop.test.ts`。
  - 实际结果（2026-08-06）：red test 先证明 Workflow invoke 前没有 outer start；移除 Workflow 对 ordinary start 的特殊跳过后，outer start 引用 Tool-use Message 且先于 invoke，outer `SUCCEEDED/DEGRADED/TIMED_OUT/FAILED` result 与三档 policy 保持原行为。agent-core/policy 3 files / 125 tests、Workflow E2E 2 files / 4 tests 通过。

## 4. 端到端与交付门禁

- [x] 4.1 运行 Direct Workflow live → terminal → 清除 client live/settled state → conversation + run history 对照，覆盖 lifecycle、TEXT、PIU/DSL、terminal answer、严格相同 TEXT 去重、失败前已完成 product 和无 inner Message。
  - 来源：三个 Functions 的全部目标 Requirements；design `跨 Function 协作与端到端流程`。
  - 验证：`node node_modules/vitest/vitest.mjs run --config vitest.config.release.ts tests/e2e/workflow-direct-history-consistency.test.ts tests/e2e/workflow-tool-agent-loop.test.ts`。
  - 实际结果（2026-08-06，`origin/main@a973bdf2`）：两个 E2E files / 4 tests 通过；覆盖 Direct 与 Workflow-as-Tool 的 live/cold history 一致性，并按 latest main 的 answer-node 输出契约完成本地/远端 fixture 对齐。

- [ ] 4.2 运行完整受影响门禁并记录命令、exit code 与失败归因；未通过 required gate 不得勾选。
  - 来源：design `验证策略 / 工程门禁`。
  - 验证：根目录 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`；`frontend/agent-web` 目录 `npm test`、`npm run build`；最后运行 `git diff --check`。
  - 实际结果（2026-08-06，`origin/main@a973bdf2`）：root `npm run build`、`npm test`（146 files passed / 1 skipped，1757 tests passed / 2 skipped）、`npm run test:contract`（44 files / 358 tests）、`npm run lint:architecture`（46 files / 290 tests）、`openspec validate --all --strict`（283 changes passed）和 `git diff --check` 通过；Frontend `npm run build`、`build:vite:modes` 与受影响 8 files / 223 tests 中 222 tests 通过。required gate 尚未全绿，故保持未勾选：Frontend 单 worker 全量为 159 files passed、7 failed / 1970 tests passed、15 failed、5 skipped，其中 Workflow 定向套件保留 1 个 latest main 既有 reduced-motion 断言失败，其他失败属于未触及的 attachment/route/permission/annotation 测试，另有 1 个 mock-server suite 因沙箱禁止监听 `127.0.0.1` 失败。本 change 的其余受影响后端、Frontend、E2E、fork/context 定向套件均通过。

- [x] 4.3 使用 `$nextagent-code-review` 做 push 前语义审查，确认 ordinary Message-first non-regression、closed Workflow exception、Runtime/Channel/Frontend owner、context/fork 边界和最小范围。
  - 来源：AGENTS.md push 门禁；design 全部章节。
  - 验证：结论必须为 PASS 或 PASS WITH FOLLOW-UP，且 P0/P1 为零；最终 diff 不含 Gateway/public schema/migration、share、`PRODUCT_PROCESS` 配置、terminal recovery 或通用 structured safety/capacity 扩项。
  - 实际结果（2026-08-06，`origin/main@a973bdf2`）：合并冲突后的 `$nextagent-code-review` 结论为 **PASS WITH FOLLOW-UP**，P0/P1 为 0；`$nextagent-skill-review` 结论为 **PASS**。审查发现并以失败测试修复 Workflow terminal answer 绕过 latest-main path redaction 的冲突问题；确认 ordinary Message-first、closed Workflow qualification、Runtime/Channel/Frontend owner、模型上下文与 fork 边界均有实现和回归证据；最终 diff 不含 `agent-contracts`、`agent-common`、Gateway、public schema、migration、share、`PRODUCT_PROCESS` 配置或通用扩项。follow-up 仅为 4.2 已记录的 latest-main 既有全量门禁失败。

归档时按 design 的“长期基线刷新计划”同步 stable specs、Functions、Features、architecture、modules、ADR 和 spec-to-design-map；该同步不是实施 task。
  - 补充结果（2026-08-07）：前端 `conversationAdapter.ts` 补齐 spec 要求的 CLIP structured delta 历史重建——从 `CAPABILITY_RESULT` Message payload 识别 canonical structured event shape（direct 或 wrapped envelope），重建 `TOOL_STRUCTURED_DELTA` envelope（带 `history-load` hint）。同步 `contracts.ts` 的 `TOOL_EVENT_TYPES`（加 `EXPAND_PANEL`）和 `TOOL_MESSAGE_TYPES`（加 `STREAM_DSL`）与后端一致。验证：`conversationAdapter.test.ts` 9 tests（含 6 新增 positive/negative case）、`processHistory`/`processDetailsProjection`/`answerContent`/`streamTextSemantics`/`buildSessionProjection`/`TurnBlock.process-history`/`conversationStore.process-history` 7 files 202 tests（201 通过，1 为 latest main 既有 reduced-motion 基线失败）、`ProcessPanel`/`ProcessPanel.piu-lifecycle`/`MessageList.process-history-visibility` 3 files 39 tests、`answerContentExpandPanel` 11 tests、`useExpandPanelStreamWatcher` 7 tests、`npm run build` 均通过。非 structured payload（Read 等）继续 return null，不产生 false positive。
