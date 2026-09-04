## 0. 跨 Function 前置门禁

- [x] 0.1 固化 completed process content 的唯一实施边界：`refine-process-content-message-event-projection` 独占执行说明、Tool 调用和 Tool 结果的 Message 正文 + Event 时序/状态/强引用恢复路径；`persist-ts-refresh-stable-completed-turns` 保持未实施暂停状态，并在未来恢复实施前移除或改写重叠的 process-detail carrier、projector 和 history recovery 工作。
  来源：proposal `目标与非目标（Goals / Non-Goals）`、design `依赖、准入与并行边界`
  验证：2026-07-29 运行 `openspec list --json`，确认 `persist-ts-refresh-stable-completed-turns` 为 `0/22`、没有实施任务完成；精确 review 确认其现有文档存在 process-detail 重叠，因此将其状态固化为暂停且不得与本 Change 并行。该 change 恢复实施的准入条件是重新运行 `rg -n "process detail|process-detail|过程详情|过程历史|timeline|projector|CAPABILITY_RESULT" openspec/changes/persist-ts-refresh-stable-completed-turns/{proposal.md,design.md,tasks.md,specs}`，并确认只保留最终 Assistant Message / conversation completed-turn 投影。

- [x] 0.2 先建立非目标 characterization：锁定 thinking、最终 Assistant Message、terminal commit、ActiveContext、Provider input、PUI/structured live delta 以及 Change 1 disclosure 行为在本 Change 前后的可观察结果一致。
  来源：design `验证策略（Verification Strategy）`、proposal `目标与非目标（Goals / Non-Goals）`
  验证：在改生产代码前运行 `npx vitest run --config vitest.config.release.ts packages/agent-runtime/tests/run-state-thinking-persistence.test.ts packages/agent-runtime/tests/timeline-event-persistence-policy.test.ts packages/agent-channel-web/tests/terminal-projection.test.ts packages/agent-channel-web/tests/tool-structured-delta-projection.test.ts`，并在 `frontend/agent-web` 运行 `npm test -- tests/TurnBlock.process-history.test.tsx tests/piu-runtime-contract.test.tsx`；预期基线全部通过，实施后使用相同命令仍全部通过。
  实际结果（2026-07-29）：后端 4 个文件、22 个测试通过；前端 2 个文件、45 个测试通过。前端首次运行因隔离工作树缺少 `jsdom` 未进入测试，复用仓库已有前端依赖后通过；PIU 测试保留 React mock 属性 warning，属于本 Change 前即存在的基线噪声。

## 1. `FN-1.1 查看会话消息流`

- [x] 1.1 为 Message-first producer 和引用事件 shape 编写失败测试：覆盖 Tool 轮次公开说明、Tool start、普通/失败/降级/超时/AskUserQuestion resume/workflow/structured Tool result、消息写入失败、live-only delta、final answer 和 persisted 引用事件非法正文副本。
  来源：`FN-1.1` + Requirement `可恢复过程事件引用唯一消息正文` + Scenarios `Tool 轮次公开说明先写消息再发布引用事件`、`Tool 终态事件引用结果消息`、`进行中 delta 不成为持久化正文`、`消息写入失败阻止引用事件`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests/agent-routing-core.test.ts packages/agent-core/tests/parallel-tool-loop.test.ts packages/agent-core/tests/workflow-runtime-event-projector.test.ts packages/agent-runtime/tests/timeline-event-persistence-policy.test.ts`；预期新增目标行为用例在生产实现前按断言失败，且既有 characterization 继续通过。
  实际结果（2026-07-29）：新增 producer/policy 首轮出现 10 个预期失败；随后 AskUserQuestion resume 和 recovery start 分别稳定复现缺少 `CAPABILITY_COMPLETED.messageId`、`CAPABILITY_STARTED.messageId`，Workflow 用例稳定复现结果 Event 缺少引用且复制 `output`。补充 structured Tool 结果与两类消息写入失败断言。

- [x] 1.2 实现 agent-core Message-first producer：让 assistant tool-use 与 capability result 写入 helper 返回既有 `MessageId`，消息成功后才发布对应 completed 引用事件，并统一所有同类终态分支；完成后 persisted event 不含可从消息恢复的正文、Tool 参数或结果副本。
  来源：`FN-1.1` + Requirement `可恢复过程事件引用唯一消息正文` + Scenarios `Tool 轮次公开说明先写消息再发布引用事件`、`Tool 终态事件引用结果消息`、`消息写入失败阻止引用事件`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests/agent-routing-core.test.ts packages/agent-core/tests/parallel-tool-loop.test.ts packages/agent-core/tests/workflow-runtime-event-projector.test.ts`；预期新增测试全部通过，且每个消息写入失败用例均不产生孤儿引用事件。
  实际结果（2026-07-29）：普通、失败/降级/超时、AskUserQuestion 预检拒绝/resume、recovery、Workflow 与 structured Tool 路径均改为 Message-first；`ASSISTANT_TOOL_USE` 和 `CAPABILITY_RESULT` helper 返回 MessageId，预检批次中的每条拒绝结果也在消息写入后发布引用终态，结果消息形成前的异常仅发 status-only 失败事件。相关 Tool loop 与治理定向 2 个文件 / 59 项通过。

- [x] 1.3 实现 runtime 引用事件分类和 schema validation：completed Tool-round `LLM_CONTENT_DELTA` 与 `CAPABILITY_STARTED` 按 design 表持久化消息引用，结果消息已形成的 `CAPABILITY_COMPLETED` 持久化结果消息引用，全部 `CAPABILITY_RESULT_DELTA` / `TOOL_STRUCTURED_DELTA` 和 `final=true` delta 保持 live-only；非法 `messageId` / `completed` / 正文组合在 append 前安全失败。
  来源：`FN-1.1` + Requirement `可恢复过程事件引用唯一消息正文` + Scenarios `Tool 终态事件引用结果消息`、`进行中 delta 不成为持久化正文`；design `FN-1.1 查看会话消息流 / 修改方案 / 3`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-runtime/tests/timeline-event-persistence-policy.test.ts` 和 `npm run test:contract -- tests/contract/session-fork-event-contracts.test.ts`；预期合法 shape 被分入指定 persistence class，所有禁止组合均实际触发 validation failure，thinking 与 final answer 分类不变。
  实际结果（2026-07-29）：persistence policy 33 个测试通过，覆盖空/缺失 MessageId、缺失 Tool 坐标、正文副本和显式 persistence 覆盖；session-fork event contract 3 个测试通过；根 workspace typecheck 通过。

- [x] 1.4 先为 `RuntimeSessionPort.resolveProcessMessages(query)` 编写 contract 与 scope negative tests：覆盖引用模式 1–1000 去重 `messageIds`、旧事件 bounded candidate 模式、可选取消、仅返回请求集合或完整候选集合、Owner/Agent/session/request/run 隔离、缺失/越权项不返回、领域对象边界以及不存在公开 Web route。
  来源：`FN-1.1` + Requirement `Web stream 在服务端解析过程消息引用` + Scenario `服务端批量关联入口不成为公开消息读取 API`；Requirement `过程消息引用保持作用域隔离` + Scenarios `跨会话引用不泄露正文`、`跨 Agent 引用不泄露正文`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-runtime/tests/process-message-resolution.test.ts packages/agent-channel-web/tests/schema-validation-boundary.test.ts packages/agent-channel-web/tests/web-api-schema-coverage.test.ts`；预期新增 resolver 用例在实现前失败，越界与公开 route 探测均被拒绝。
  实际结果（2026-07-29）：resolver 用例先以 `resolveProcessMessages is not a function` 失败；实现后覆盖 contract/scope/pagination/cancellation 及旧事件完整候选集和超过 1000 条安全失败。Web route inventory 明确不存在 process-message endpoint，event-history query schema 不含 `messageIds` 且禁止额外字段；相关 Web 边界套件通过。

- [x] 1.5 实现 `RuntimeSessionPort.resolveProcessMessages(query)`：通过 `RequestLifecycleCoordinator` 的可信 session 校验和既有 `UserSessionPort.listCurrentRequestMessages(includeHidden=true)` 有界分页返回匹配 `SessionMessage`，不新增 Gateway port、Record、表、远端协议或客户端授权入口。
  来源：`FN-1.1` + Requirement `Web stream 在服务端解析过程消息引用` + Scenario `服务端批量关联入口不成为公开消息读取 API`；Requirement `过程消息引用保持作用域隔离` + Scenarios `跨会话引用不泄露正文`、`跨 Agent 引用不泄露正文`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-runtime/tests/process-message-resolution.test.ts packages/agent-runtime/tests/run-message-port-externalize.test.ts` 与 `npm run lint:architecture`；预期 resolver contract、scope negative cases 和取消用例通过，architecture gate 证明无 gateway Record 泄露或 private import。
  实际结果（2026-07-29）：resolver 引用查询和旧事件 bounded candidate 查询复用同一可信 session/request/run 读取；超过 1000 条的旧候选集安全失败，避免截断集合误关联。resolver 与 history route 定向 2 个文件、20 项通过；根 workspace typecheck 及完整 architecture gate 通过。临时依赖链接已移除。

- [x] 1.6 先为共享安全 projector 和 live transport 关联编写失败测试：覆盖 assistant public text、指定 `toolCallId` 的 Tool 调用、普通与 AskUserQuestion Tool 结果、SSE/WS 等价、错误消息类型/Tool/scope 降级、`contentUnavailable=true`，以及响应不含 raw hidden message、`visible`、metadata 全量或遗留 event 正文。
  来源：`FN-1.1` + Requirement `Web stream 在服务端解析过程消息引用` + Scenarios `实时投影读取同一条消息正文`、`无效引用降级为仅状态过程项`；Requirement `过程消息引用保持作用域隔离` + Scenarios `跨会话引用不泄露正文`、`跨 Agent 引用不泄露正文`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-common/tests/process-message-projection.test.ts packages/agent-channel-common/tests/web-stream-delivery.test.ts packages/agent-channel-common/tests/ask-user-question-answer.test.ts packages/agent-channel-web/tests/session-event-history-route.test.ts`；预期新增投影用例在实现前失败，所有泄漏断言保持为零。
  实际结果（2026-07-29）：新增共享 projector 用例首轮 8 项中 7 项按预期失败，分别暴露正文仍取自 event、引用消息未校验和 Tool 结果未走安全投影；live delivery 随后新增同一隐藏消息双事件关联、subscription cache 和 resolver 缺失降级用例。最终定向 4 个文件、28 个测试通过，泄漏断言均为零。

- [x] 1.7 实现共享 `ProcessMessageAssociation` projector 与 subscription-scoped 有界 live cache：SSE、WebSocket 和 history route 复用同一 parser/safe projection；未知引用通过 runtime 批量解析，subscription 关闭即释放，失败只输出可排序的 status-only envelope。
  来源：`FN-1.1` + Requirement `Web stream 在服务端解析过程消息引用` + Scenarios `实时投影读取同一条消息正文`、`无效引用降级为仅状态过程项`；design `FN-1.1 查看会话消息流 / 修改方案 / 5–6`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-common/tests/process-message-projection.test.ts packages/agent-channel-common/tests/web-stream-delivery.test.ts packages/agent-channel-web/tests/session-event-history-route.test.ts`；预期 SSE/WS 对同一 pair 输出等价 envelope，重复引用命中 cache，无效引用不泄露正文。
  实际结果（2026-07-29）：共享 projector 按 event/message 的 session、request、run、message type 与 Tool 坐标联合校验，普通与 AskUserQuestion 结果复用既有 safe projector；`deliverWebStream` 建立最多 1000 项的 subscription-local cache，并通过 server-only runtime resolver 读取未知引用。SSE route 与 WebSocket transport 均复用同一 `deliverWebStream`，history route 继续复用同一单事件 projector，批量历史关联留在 2.3。定向 4 个文件、28 个测试与根 workspace typecheck 通过。

- [x] 1.8 为 agent-web live 快照收敛编写失败测试：completed Tool-round 说明按 `stepId` 结算同一 live 说明快照，`CAPABILITY_COMPLETED` 按 `toolCallId` 结算同一 Tool 的 live-only 普通或 structured result 快照，引用失败不得从 cache 或 Tool 本地状态补正文。
  来源：`FN-1.1` + Requirement `Web stream 在服务端解析过程消息引用` + Scenarios `实时投影读取同一条消息正文`、`无效引用降级为仅状态过程项`；design `FN-1.1 查看会话消息流 / 修改方案 / 7`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/processDetailsProjection.test.ts tests/streamCompaction.test.ts`；预期新增用例在生产实现前因重复或错误 fallback 失败，既有 final answer 与 thinking characterization 继续通过。
  实际结果（2026-07-29）：新增阶段说明 lane、引用失败和结构化 Tool 收敛用例分别稳定复现合并成最终答案、从 live buffer 回填正文、保留 structured 副本的问题；首轮 3 项失败，其余既有用例保持通过。

- [x] 1.9 实现 agent-web live process composition 的最小收敛：completed 说明按 `stepId` 替换同一 live 说明快照，`CAPABILITY_COMPLETED` 按 `toolCallId` 替换同一 live Tool 结果快照，无效引用只保留 status-only 完成项。
  来源：`FN-1.1` + Requirement `Web stream 在服务端解析过程消息引用` + Scenarios `实时投影读取同一条消息正文`、`无效引用降级为仅状态过程项`；design `FN-1.1 查看会话消息流 / 修改方案 / 7`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/processDetailsProjection.test.ts tests/streamCompaction.test.ts`；预期每个 live 说明和 Tool 结果只保留一条 canonical process entry，无效引用无正文，final answer 与 thinking 用例不变。
  实际结果（2026-07-29）：completed process content 以 `stepId` 独立于 answer lane 收敛，渲染为不二次折叠的“执行说明”；answer projector 排除该完成说明。普通 Tool live 结果由同一 `toolCallId` 的带正文完成引用接管，`contentUnavailable=true` 时清除 live buffer 并显示安全占位；完成引用没有可展示正文时保留既有 structured/PIU detail，避免空完成状态擦除结构化结果。定向 `processDetailsProjection` 50 项、`streamCompaction` 7 项与 agent-web TypeScript build 通过。

- [x] 1.10 完成 `FN-1.1` 定向验证：覆盖 producer、persistence policy、resolver、shared projector、SSE/WS、agent-web composition、scope 和非目标回归，确认最终 Assistant Message 与 thinking 未改变。
  来源：`FN-1.1` 全部 Requirements 与 Scenarios；design `FN-1.1 查看会话消息流 / 质量属性影响`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests/agent-routing-core.test.ts packages/agent-core/tests/parallel-tool-loop.test.ts packages/agent-core/tests/workflow-runtime-event-projector.test.ts packages/agent-runtime/tests/timeline-event-persistence-policy.test.ts packages/agent-runtime/tests/process-message-resolution.test.ts packages/agent-channel-common/tests/process-message-projection.test.ts packages/agent-channel-common/tests/web-stream-delivery.test.ts packages/agent-channel-web/tests/session-event-history-route.test.ts packages/agent-channel-web/tests/terminal-projection.test.ts packages/agent-channel-web/tests/tool-structured-delta-projection.test.ts`，并在 `frontend/agent-web` 运行 `npm test -- tests/processDetailsProjection.test.ts tests/streamCompaction.test.ts`；预期全部通过且无 skipped 目标用例。
  实际结果（2026-07-29）：后端/通道定向 10 个文件、160 个测试通过，根 workspace typecheck 通过；前端 2 个文件、56 个测试与 TypeScript build 通过，无 skipped 目标用例。仅保留 Node localstorage 启动 warning，为既有测试环境噪声。

- [x] 1.11 修正进行中公开输出的待定位置：先用组件与浏览器测试复现具有 `stepId` 的 live 内容进入答案区，再让它使用与完成说明相同的无图标桥接 lane；Tool 路径原地结算，最终答案路径由 `final=true` 接管并移除待定 lane，不清空或重放已呈现正文。
  来源：`FN-1.1` + Requirement `Tool 轮次执行说明与 Tool 调用连续呈现` + Scenarios `进行中公开输出保持待定桥接位置`、`没有后续 Tool 调用时保持最终答案语义`；design `FN-1.1 查看会话消息流 / 修改方案 / 7`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/processDetailsProjection.test.ts tests/answerContent.test.ts tests/streamCompaction.test.ts`，并运行 `npm run test:e2e:smoke -- tests/e2e/process-history-modes.spec.cjs`；预期 Tool 轮次说明从首个字符开始不进入答案区，同 `stepId` 完成说明保持一个稳定 process entry，无 Tool 调用时最终答案只显示一次。
  实际结果（2026-07-30）：组件红灯先稳定复现 live `stepId` 正文误入答案区、最终接管时长正文重新打字，以及说明开始后前置 thinking 未折叠；实现后相关 8 个前端文件、217 项测试全部通过。完整 Playwright smoke 28/28 通过，其中 `process-history-modes.spec.cjs` 覆盖三宿主、reduced-motion、200 轮历史以及待定说明从首字符进入无图标桥接 lane、同 `stepId` 原地完成、后续 Tool 紧邻显示；手工浏览器验证确认说明在 live 阶段不进入答案区，执行详情折叠后重新展开仍可见，最终答案接管不清空或重放正文。agent-web TypeScript build 与 multi-host Vite build 均通过。当前 Change 严格 OpenSpec 校验通过；全仓 276/278 项通过，两个失败分别来自无关的 `add-ts-toggle-question-favorite`、`extend-ts-workflow-batch-config-scope`。同步最新 `main` 后全量前端为 150/153 文件、1733/1744 项通过；隔离复跑将剩余失败定位到与本 Change 无 diff 的最新 `main` 附件能力开关、近期提交和重试占位夹具，未发现本任务定向回归。

## 2. `FN-1.2 断线后从上次位置继续`

- [x] 2.1 为历史联合恢复和显式降级编写失败测试：覆盖同一 HTTP request 内一页一次批量关联、说明与 Tool 过程 live/history 等价、同一正文最多一次、零附加浏览器消息请求、缺失/损坏/跨 scope/错类型引用、无消息引用事件唯一匹配与零/多候选降级、事件 payload 正文字段不被使用。
  来源：`FN-1.2` + Requirement `过程历史从消息正文与事件时序联合恢复` + Scenarios `重新打开会话恢复执行说明`、`历史 Tool 过程与实时投影一致`、`浏览器不读取隐藏消息完成关联`；Requirement `过程历史关联失败显式降级` + 全部 Scenarios
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-web/tests/session-event-history-route.test.ts packages/agent-channel-common/tests/process-message-projection.test.ts`；预期新增目标行为用例在实现前失败，既有事件顺序与页 cursor 用例继续通过。
  实际结果（2026-07-29）：history route 新增一页一次批量关联、安全公开投影、跨 request 错配、单项降级、唯一 legacy 匹配和零候选降级用例；首轮稳定复现 resolver 未调用、旧 event 正文被直接读取和 conversation fallback 回填。实现后 2 个文件、19 个测试通过，响应中无 hidden message、`visible`、Tool 参数或遗留正文。

- [x] 2.2 建立 10,000 `USER` 轮次容量 fixture 和失败测试：每轮至少两个 completed thinking、两个 Tool 调用和两个 Tool 结果，覆盖预览点击、滑块拖动、轨道点击、滚轮/触控板连续输入，测量每运行零附加关联 Web 请求、120 ms latest-target settle、最多 4 在途、旧目标不覆盖和已加载 Turn 可响应。
  来源：`FN-1.2` + 系统质量属性 `性能/容量` + Requirement `大会话过程历史关联保持有界` + 全部 Scenarios
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/mock-server-process-history-stress.test.ts tests/processHistoryScheduler.test.ts` 和 `npm run test:e2e:smoke`（新增 `tests/e2e/process-history-capacity.spec.cjs`）；预期容量目标用例在生产实现前至少一项按目标断言失败，既有历史浏览用例继续通过。
  实际结果（2026-07-29）：新增 10,000 轮 fixture，包含 40,000 条消息、每轮两个 completed thinking、两个 Tool start 和两个 Tool completion；scheduler 容量用例锁定 120 ms settle、最新 16 targets 和最多 4 在途。新增 Playwright 旅程按分页窗口加载 10,000 个预览标记，覆盖预览点击、拖动、轨道点击和滚轮定位；首次浏览器运行暴露定位歧义并修正为 Turn-scoped 断言，最终 1 项通过。

- [x] 2.3 实现 history route 的一页一次服务端关联、严格唯一 legacy matching、逐项 status-only 降级与同消息双入口收敛：合法事件与消息交给共享 projector；引用事件按 `stepId` 或 `messageId + toolCallId` 吸收 conversation adapter 的同一消息副本；单项失败不使整页合法事件丢失，且 event payload 正文字段、conversation base、前端 cache 和 Tool 本地状态均不作为失败恢复来源。
  来源：`FN-1.2` + Requirement `过程历史从消息正文与事件时序联合恢复` + 全部 Scenarios；Requirement `过程历史关联失败显式降级` + 全部 Scenarios
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-web/tests/session-event-history-route.test.ts packages/agent-channel-common/tests/process-message-projection.test.ts`，并在 `frontend/agent-web` 运行 `npm test -- tests/processHistory.test.ts tests/conversationStore.process-history.test.ts`；预期 live/history 内容、顺序和终态一致，每个 message/tool lane 只显示一次，零/多候选只返回安全状态，浏览器响应不含隐藏消息集合。
  实际结果（2026-07-29）：route 在同一 event-history 请求内收集最多一页的唯一引用并调用 runtime resolver 一次；按 event/message scope、类型和 Tool 坐标交给共享 projector，旧事件只在已解析集合中接受唯一候选。前端按 `stepId` 和 run 内 `toolCallId` 吸收 live/conversation 副本，引用失败时不使用 conversation 结果回填。后端 19 个测试、前端相关 4 个文件 94 个测试、根 typecheck 与 agent-web build 通过。

- [x] 2.4 为 automatic process-history target settle 编写失败测试：覆盖 120 ms 连续目标合并、quiet-window 后只发布最新最多 16 个 targets、explicit 展开/重试立即执行、session/generation/clear 取消未开始工作、最大 4 在途和旧响应不覆盖新目标。
  来源：`FN-1.2` + 系统质量属性 `性能/容量` + Requirement `大会话过程历史关联保持有界` + Scenarios `快速导航保持固定在途上限`、`主动展开和重试不等待自动目标窗口`、`过程关联不阻塞已加载历史浏览`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/processHistoryScheduler.test.ts tests/MessageList.process-history-visibility.test.tsx tests/TurnBlock.process-history.test.tsx`；预期新增 fake-timer 目标行为用例在实现前失败，explicit target 既有用例继续通过。
  实际结果（2026-07-29）：新增 fake-timer 用例覆盖 120 ms quiet-window、最新 16 targets、clear 取消和 10,000 次连续目标变化；scheduler 与既有 MessageList/TurnBlock 交互测试通过。目标 settle 测试与实现同步落地，未保留虚假的独立红灯记录；既有 immediate automatic 行为由新增 120 ms 断言替换。

- [x] 2.5 实现 automatic target 120 ms latest-target settle：只修改 process-history scheduler/target 发布路径，不修改 `useChatViewportController`、scroll anchor、smooth scroll、Change 1 disclosure 或用户手工展开状态。
  来源：`FN-1.2` + 系统质量属性 `性能/容量` + Requirement `大会话过程历史关联保持有界` + Scenarios `快速导航保持固定在途上限`、`主动展开和重试不等待自动目标窗口`、`过程关联不阻塞已加载历史浏览`；design `FN-1.2 断线后从上次位置继续 / 修改方案 / 5`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/processHistoryScheduler.test.ts tests/MessageList.process-history-visibility.test.tsx tests/TurnBlock.process-history.test.tsx tests/conversationStore.process-history.test.ts`；预期 automatic 请求只在最新 quiet-window 后启动，explicit 仍立即，最大在途为 4，旧 generation 不覆盖。
  实际结果（2026-07-29）：新增 session-scoped automatic target settler，仅在 120 ms quiet-window 后向既有 scheduler 发布最新最多 16 项；explicit target 继续直接发布，session reset/dispose 清理待发布工作。scheduler 28 个测试与 conversation store 17 个 process-history 测试通过，10,000 次快速更新在窗口内启动 0 个请求，窗口后仅启动最新批次且最大在途为 4；未触达 viewport controller、scroll owner 或手工展开状态。

- [x] 2.6 为本地 `timeline_events` run-scoped 查询索引编写 migration characterization：既有数据库和新数据库均幂等具有 `(tenant_id, subject_id, agent_id, session_id, run_id, sequence)` 辅助索引，既有 `listEvents` contract、表和 Record shape 不变。
  来源：design `FN-1.2 断线后从上次位置继续 / 修改方案 / 6`、proposal `影响范围（Impact） / Gateway`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/sqlite-run-timeline-index.test.ts tests/agent-kernel/session-fork-gateway.test.ts`；预期实现前新索引断言失败而既有 list/fork 用例通过，实施后 reopen/migration 与 query-plan 断言均通过。
  实际结果（2026-07-29）：新库与旧库两项索引用例在实现前均因索引不存在按预期失败，既有 fork gateway 10 个测试继续通过；实现后新库、reopen 幂等、旧库迁移、表列不变和 `EXPLAIN QUERY PLAN` 使用目标索引全部通过，合计 2 个文件、12 个测试通过。

- [x] 2.7 实现本地 `timeline_events` run-scoped 辅助索引和幂等迁移，不新增/修改 Gateway public port、Record、query field、table 或远端 Gateway protocol。
  来源：design `FN-1.2 断线后从上次位置继续 / 修改方案 / 6`、proposal `目标与非目标（Goals / Non-Goals）`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/sqlite-run-timeline-index.test.ts tests/agent-kernel/session-fork-gateway.test.ts`、`npm run test:contract` 和 `npm run lint:architecture`；预期索引 migration/reopen 通过，contract diff 不含 Gateway API/Record/table 变化。
  实际结果（2026-07-29）：仅在既有 `timeline_events` 上增加 `idx_timeline_events_run_sequence`，未改变 Gateway port、Record、query 或 table。索引与 fork 定向 12 项通过；最终全量 architecture gate 为 dependency-cruiser 1157 modules / 5301 dependencies 无违规、package policy 通过、42 个文件 / 251 项测试通过。全量 contract 首轮暴露 generic Workflow condition start/completion 被误判为 Tool/Capability 引用事件；按 event identity 先判别通用 Workflow 事件后修复，最终 40 个文件 / 334 项全部通过。

- [x] 2.8 通过 10,000 `USER` 轮次容量 gate：运行 2.2 建立的 fixture 和浏览器旅程，确认四种快速导航下关联请求、自动目标 settle、在途上限、最新目标归属和已加载 Turn 响应性达到量化目标。
  来源：`FN-1.2` + 系统质量属性 `性能/容量` + Requirement `大会话过程历史关联保持有界` + 全部 Scenarios
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/mock-server-process-history-stress.test.ts tests/processHistoryScheduler.test.ts` 和 `npm run test:e2e:smoke`（包含 `tests/e2e/process-history-capacity.spec.cjs`）；预期每个被加载运行的关联附加 Web 请求为 0、连续自动目标变化期间不启动新自动请求、quiet-window 后至多一个 16-target 批次、最大在途为 4、旧结果不覆盖，不以单机绝对耗时作为唯一结果。
  实际结果（2026-07-29）：容量与历史交互 6 个文件、88 项通过；单独 Playwright 容量旅程 1 项通过。浏览器关联附加请求为 0，连续目标窗口内不启动请求，quiet-window 后发布最新最多 16 项，事件请求峰值为 4，最后导航目标为 9000，已加载 Turn 保持可见可交互。

- [x] 2.9 完成 `FN-1.2` 定向验证：历史联合恢复、无引用事件降级、容量、浏览器响应性、index 和既有 history/preview/scroll owner 均满足规格。
  来源：`FN-1.2` 全部 Requirements、Scenarios 与量化指标；design `FN-1.2 断线后从上次位置继续 / 质量属性影响`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-web/tests/session-event-history-route.test.ts packages/agent-channel-common/tests/process-message-projection.test.ts packages/agent-platform-gateway-local/tests/sqlite-run-timeline-index.test.ts`；并在 `frontend/agent-web` 运行 `npm test -- tests/processHistoryScheduler.test.ts tests/processHistory.test.ts tests/conversationStore.process-history.test.ts tests/MessageList.process-history-visibility.test.tsx tests/TurnBlock.process-history.test.tsx tests/mock-server-process-history-stress.test.ts` 与对应 process-history Playwright journey；预期全部通过。
  实际结果（2026-07-29）：后端 history/projector/index 3 个文件、22 项通过；前端 scheduler/history/store/visibility/stress 6 个文件、88 项通过；10,000 轮 Playwright 旅程 1 项通过。viewport/scroll owner 未修改，Node localstorage warning 为既有测试环境噪声。

## 3. `FN-1.11 从消息派生子会话`

- [x] 3.1 为 typed fork ref preflight、原子失败和安全诊断编写失败测试：覆盖子消息重映射、源删除、fork-of-fork、跨 cutoff、缺失/歧义/损坏 ref、request/run/type/toolCallId 不一致、跨 owner/Agent 和诊断不泄漏；保留既有 generic remapper 与 composite rollback characterization。
  来源：`FN-1.11` + Requirement `派生过程快照重映射消息引用` + 全部 Scenarios；系统质量属性 `可靠性/恢复` + Requirement `派生消息引用失败保持原子` + 全部 Scenarios；系统质量属性 `安全` + Requirement `派生消息引用失败诊断保持安全` + Scenario `失败诊断不泄露源内容`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/agent-kernel/session-fork-runtime.test.ts tests/agent-kernel/session-fork-gateway.test.ts` 和 `npm run test:contract -- tests/contract/session-fork-event-contracts.test.ts`；预期新增 typed ref 用例在实现前失败，既有 fork transaction characterization 继续通过。
  实际结果（2026-07-29）：新增合法 stage-note/start/completion 引用、源删除后恢复、递归重映射以及错误消息类型和 toolCallId 组合；3 个非法 typed 组合在实现前均错误创建子会话，形成稳定红灯。既有跨 scope、前缀外/损坏引用、generic remapper、promotion abort 和 composite rollback 用例保留。

- [x] 3.2 实现 ref-bearing process event 的 typed fork preflight：复用 `remapForkEventPayload(...)` 和现有 source→child message map，验证复制前缀及业务坐标，成功后只保留 child `messageId`，任何失败在 composite write 前终止或走既有 promotion abort cleanup。
  来源：`FN-1.11` + Requirement `派生过程快照重映射消息引用` + 全部 Scenarios；系统质量属性 `可靠性/恢复` + Requirement `派生消息引用失败保持原子` + Scenarios `引用目标不在复制前缀时派生失败`、`损坏引用不被静默删除`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/agent-kernel/session-fork-runtime.test.ts tests/agent-kernel/session-fork-gateway.test.ts` 和 `npm run test:contract -- tests/contract/session-fork-event-contracts.test.ts`；预期子/孙会话只含本代消息标识，全部非法引用不产生任何可见部分子会话。
  实际结果（2026-07-29）：在既有 `remapForkEventPayload(...)` 前增加 typed preflight，复用 prefix source→child map，并验证 Owner/Agent/session/request/run、消息角色/metadata 和适用的 toolCallId；失败返回统一安全码并继续复用既有 abort/composite 原子边界。未新增第二套 remapper 或 Gateway shape。

- [x] 3.3 完成 `FN-1.11` 定向安全与恢复验证：源会话删除后 child 仍可从 child message 恢复正文，递归 fork 不探测祖先，失败日志/metric/audit/SafeError 只含安全错误码、失败阶段和低基数结果。
  来源：`FN-1.11` 全部 Requirements 与 Scenarios；系统质量属性 `安全` + Requirement `派生消息引用失败诊断保持安全` + Scenario `失败诊断不泄露源内容`；design `FN-1.11 从消息派生子会话 / 质量属性影响`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/agent-kernel/session-fork-runtime.test.ts tests/agent-kernel/session-fork-gateway.test.ts` 和 `npm run test:contract -- tests/contract/session-fork-event-contracts.test.ts`；预期全部通过，并对 captured diagnostics 断言禁止字段不存在。
  实际结果（2026-07-29）：fork runtime/gateway 2 个文件、58 项通过，session-fork contract 3 项通过；源删除后通过 child resolver 恢复 Tool 说明/结果，孙会话仅含 grandchild messageId，未保留 source/child 引用。非法引用只暴露 `SESSION_FORK_PROCESS_MESSAGE_REFERENCE_INVALID` 和固定安全描述，断言不含源消息 ID、正文、Tool 输入输出或映射表。

## 4. 跨 Function 集成与迁移

- [x] 4.1 建立并通过同一运行的 live → cold history → fork → source delete → fork-of-fork 端到端测试：在 `tests/agent-kernel/process-message-event-projection.test.ts` 和 `frontend/agent-web/tests/e2e/process-message-event-projection.spec.cjs` 覆盖执行说明、Tool 调用和 Tool 结果始终来自各会话拥有的同一 Message 正文，Event 保持原顺序/状态，每项最多显示一次，最终答案位置和内容不变。
  来源：`FN-1.1` + Requirement `可恢复过程事件引用唯一消息正文`；`FN-1.2` + Requirement `过程历史从消息正文与事件时序联合恢复`；`FN-1.11` + Requirement `派生过程快照重映射消息引用`；design `跨 Function 协作与端到端流程`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/agent-kernel/process-message-event-projection.test.ts`，并在 `frontend/agent-web` 运行 `npm run test:e2e:smoke`；预期 live/history/child/grandchild 的 semantic snapshot 内容和顺序等价、无重复、无 source id，最终 Assistant Message snapshot 不变。
  实际结果（2026-07-29）：agent-kernel 语义快照 1 项通过；浏览器冷加载 child/grandchild 旅程 1 项通过。源会话不可用后，子孙会话仍各自恢复一次执行说明、一次 Tool 结果和一次最终答案，不含祖先 message id；执行说明在执行详情大面板内直接可见且没有二次 disclosure，Tool 项仍保持原展开交互。

- [x] 4.2 实施兼容部署顺序并在 `tests/agent-kernel/process-message-event-mixed-version.test.ts` 验证混合版本读取：先提供 resolver/projector/legacy matching/index，再启用 ref-only producer；无引用事件只在唯一匹配时恢复，新引用事件只从消息恢复，零/多候选与旧 reader 回滚均表现为文档化 status-only 风险而不恢复正文双写。
  来源：design `迁移与回滚（Migration / Rollback）`、`FN-1.2 断线后从上次位置继续 / 修改方案 / 2`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/agent-kernel/process-message-event-mixed-version.test.ts`；预期部署两阶段均无错配或跨 scope 内容，回滚不增加 event 正文副本。
  实际结果（2026-07-29）：混合版本 4 项通过，覆盖唯一 legacy 匹配、新引用只读 Message、零/多候选 status-only 降级和旧 reader 回滚风险；未为回滚重新引入 Event 正文双写。

- [x] 4.3 在 `tests/architecture/process-message-event-boundary.test.ts` 和 `tests/contract/process-message-event-contracts.test.ts` 增加 architecture negative gate：禁止 browser hidden-message API、禁止客户端提交 `messageIds`、禁止 channel/gateway private import、禁止 persisted ref event 携带可恢复正文、禁止新增 Gateway port/Record/table/远端协议、禁止 fork snapshot 保留 source message id。
  来源：design `验证策略（Verification Strategy） / architecture/negative`、proposal `目标与非目标（Goals / Non-Goals）`
  验证：运行 `npm run lint:architecture` 和 `npm run test:contract -- tests/contract/process-message-event-contracts.test.ts`；预期每个禁止模式均有实际负例被拒绝，合法 public package export 路径通过。
  实际结果（2026-07-29）：新增 architecture negative 4 项、contract negative 3 项均通过；完整 architecture gate 同步通过 42 个文件、251 项测试，dependency-cruiser 和 package policy 无违规。

## 5. Change 整体验证

- [x] 5.1 完成后端和 OpenSpec 全量门禁，并记录任何基线噪声与本 Change 失败的归属：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`。
  来源：proposal 全部影响范围、design `验证策略（Verification Strategy）`
  验证：上述命令全部退出码为 0；若存在环境或既有基线问题，必须提供可重复证据并保持本 Change 定向测试全部通过，未通过时不得勾选。
  实际结果（2026-07-29）：根 workspace build 通过；全量 backend test 在允许 loopback listener 的环境中 119 个文件通过、1 个跳过，1150 项通过、2 项跳过；全量 contract 复跑为 40 个文件 / 334 项通过，首次运行仅有一个无关 Workflow 用例因临时目录清理竞态报 `ENOTEMPTY`，单项复跑与完整复跑均通过；architecture gate 的 dependency-cruiser 1157 modules / 5301 dependencies 无违规，package policy 通过，42 个文件 / 251 项测试通过；`openspec validate --all --strict` 为 261 passed / 0 failed。受限 sandbox 内 Cron、Guardrail 等 loopback fixture 仅因 `listen EPERM` 失败，授权运行后全部通过，归类为环境约束而非产品失败。

- [x] 5.2 完成 agent-web 全量门禁与三宿主/浏览器旅程：`npm run build`、相关全量 `npm test`、`npm run build:vite:modes` 及 process-history Playwright gate，确认 local、immersive、collaborative 共用同一 projection/scheduler 且 Change 1 disclosure、PIU 和手工展开行为不回归。
  来源：proposal `目标与非目标（Goals / Non-Goals）`、design `验证策略（Verification Strategy） / e2e、capacity、characterization`
  验证：在 `frontend/agent-web` 运行 `npm run build`、`npm test`、`npm run build:vite:modes` 和 `npm run test:e2e:smoke`；预期 TypeScript/Vite/tests/e2e 全部退出码为 0，三宿主无平行业务语义。
  实际结果（2026-07-29）：agent-web TypeScript build 与 multi-host Vite build 通过；允许 loopback listener 的完整前端测试为 147 个文件 / 1695 项全部通过；完整 Playwright smoke 为 26 项全部通过，覆盖 local、immersive、collaborative、10,000 轮四种预览导航、200 轮多 thinking/多 Tool、fork 后源删除恢复和 reduced-motion。首次完整浏览器运行因 5174 被旧 Change1 服务占用而连接到旧代码，确认工作目录后停止该明确进程并由当前 Change 启动独立服务重跑；随后发现并修正 E2E 夹具仍伪造旧版无安全正文响应，以及把四个独立 quiet-window 错算为单批次的断言，最终门禁全绿。

- [x] 5.3 Push 前执行 `$nextagent-code-review` 模型语义检视，覆盖 frozen core contract、runtime/browser/Gateway owner、Owner/Agent Scope、安全投影、OpenSpec 一致性、Clean Code、容量和验证证据；P0/P1 清零，P2 仅在有明确 follow-up 时允许。
  来源：proposal 全部 scope、design 全文、项目 Push 门禁
  验证：生成明确 `PASS` 或 `PASS WITH FOLLOW-UP` 结论并记录 findings 与处置；`BLOCKED`、未处理 P0/P1 或缺少前端/后端证据时不得勾选或 push。
  实际结果（2026-07-29）：`nextagent-skill-review` 与 `nextagent-code-review` 结论均为 `PASS`，P0/P1/P2 为 0。检视覆盖 frozen core contract、runtime/channel/browser/Gateway owner、Owner/Agent Scope、Message 安全投影、三宿主一致性、容量和全量门禁；检视中发现普通 lifecycle event 携带 `messageId` 时会误触发 process message resolver，已先以失败测试稳定复现，再收敛为共享 process-event 判定并通过 29 项定向测试。Gateway contract 未新增，只有 gateway-local 既有 timeline 表的 scoped index。

## 6. 已确认的执行说明连续呈现补充（`FN-1.1`、`FN-1.2`）

- [x] 6.1 先为执行说明桥接语义和 Mock 同轮顺序编写失败测试：`ProcessPanel` 中完成说明正文直接可见但没有独立标题、圆形状态节点、完成对勾或展开按钮；前置 thinking 和后续 Tool 仍保留原步骤交互；`process-handoff` Mock 严格按 `thinking → completed process content → CAPABILITY_STARTED → CAPABILITY_COMPLETED` 排列，且最终答案仍留在 answer lane。
  来源：`FN-1.1` + Requirement `Tool 轮次执行说明与 Tool 调用连续呈现` + 全部 Scenarios；`FN-1.2` + Requirement `过程历史从消息正文与事件时序联合恢复` + Scenario `重新打开会话恢复执行说明`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/components/ProcessPanel.test.ts tests/processDetailsProjection.test.ts tests/mock-server-process-history-stress.test.ts`，并在仓库根目录运行 `node --test frontend/agent-web-mock-server/tests/events.test.js`；预期新增 UI 用例在实现前因说明仍有独立节点/标题失败，Mock 用例因说明位于首个 Tool 完成之后失败，既有 final answer 与 Tool disclosure 用例继续通过。
  实际结果（2026-07-30）：红灯阶段 Mock 契约测试 8/9 通过，新增顺序断言以 `37 !== 29` 失败；前端定向测试 73/75 通过，新增投影断言显示 `kind` 仍为 `system`，新增组件断言显示说明仍有标题、图标和折叠按钮。实现后 Mock 9/9、前端定向 75/75 通过。

- [x] 6.2 实现执行说明的最小浏览器投影增量：过程聚合为完成说明赋予专用桥接 kind；ProcessPanel 使用原始安全正文和轻量连接关系渲染该 kind，不输出固定“接下来”或其他标题，不创建第二层 disclosure；修正 `process-handoff` Mock 的同轮事件顺序。不得修改 stream/event contract、Message/Event 持久化、Gateway、thinking/Tool/PIU 图标或用户手工展开规则。
  来源：design `FN-1.1 查看会话消息流 / 修改方案 / 7–8`；proposal `目标与非目标（Goals / Non-Goals）`
  验证：重复运行 6.1 的定向测试；预期说明只出现一次且没有独立步骤语义，thinking/Tool 原交互、最终答案位置和 live/history 收敛保持通过。
  实际结果（2026-07-30）：`ProcessEntry.kind` 新增浏览器内部 `process-explanation` 语义，ProcessPanel 对其仅渲染安全 Markdown 正文、连续轨道和主题自适应弱强调背景；不渲染独立标题、状态图标、完成对勾、固定“接下来”或二次 disclosure。Mock 第二轮调整为 `thinking completed → process content completed → analyzeRouteConvergence started/completed`，最终答案仍用 `final=true` 留在 answer lane。三项前端定向测试共 80/80、Mock 全量 9/9 通过。

- [x] 6.3 完成规格、构建和浏览器验收：验证浅色与深色主题下连接样式可读，live 与刷新后的 history 顺序一致，执行详情大面板折叠后说明随之隐藏、重新展开后直接可见，最终答案无 Tool 调用时不被误投影为说明。
  来源：`FN-1.1` + Requirement `Tool 轮次执行说明与 Tool 调用连续呈现`；`FN-1.2` + Scenario `重新打开会话恢复执行说明`；design `验证策略（Verification Strategy）`
  验证：在 `frontend/agent-web` 运行 `npm run build` 和相关 process-history Playwright journey；在仓库根目录运行 `openspec validate refine-process-content-message-event-projection --strict`；随后执行 `$nextagent-skill-review` 和 `$nextagent-code-review`，任何 P0/P1 或 OpenSpec 阻塞项清零前不得再次判定 Change 完成。
  实际结果（2026-07-30）：`npm run build`、`npm run build:vite:modes` 均退出 0；`process-message-event-projection.spec.cjs` 1/1 通过；内置浏览器实测浅色、深色、live、刷新 history、执行详情折叠/重开均符合规格，说明节点内标题/图标/折叠控件计数均为 0、连续轨道为 1。`openspec validate --all --strict` 为 261/261。agent-web 全量为 146/147 文件、1692/1696 用例通过，4 个失败均在既有 preview 导航定时用例；该文件隔离重跑 99/99 通过，判定为全量并发时序噪声而非本 Change 回归。`nextagent-skill-review` 与 `nextagent-code-review` 均为 `PASS`，P0/P1/P2 为 0。

## 7. 已确认的待定内容视觉连续性补充（`FN-1.1`）

- [x] 7.1 先为执行说明排版和最终答案接管编写失败测试：执行说明正文使用 16px 主文字 Markdown 排版、与展开 thinking 正文内容列对齐、没有独立底色/边框/水平内边距；最终答案接管被标记为同一待定内容的 handoff，禁止 typewriter replay，并保持既有 answer lane 左对齐。
  来源：`FN-1.1` + Requirement `Tool 轮次执行说明与 Tool 调用连续呈现` + Scenarios `执行说明连接思考与同轮 Tool 调用`、`没有后续 Tool 调用时保持最终答案语义`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/components/ProcessPanel.test.ts tests/TurnBlock.test.tsx`；预期新增断言在实现前分别因 13px 次级文字/独立底色边框和缺少 answer handoff presentation marker 失败。
  实际结果（2026-07-31）：红灯阶段 2 个文件共 117 项，新增两项分别以 `expected '13px' to be '16px'` 和 `expected null to be 'true'` 失败，其余 115 项通过；失败原因与批准的视觉差异一致。

- [x] 7.2 实现最小视觉连续性增量：保留执行说明既有 20px rail + 8px gap 并移除 detail 的独立表面和水平 padding，复用最终答案默认 Markdown typography；最终答案接管时只为既有 answer region 增加 180 ms transform-only 横向对齐，继续复用现有 panel height/scroll anchor compensation，reduced-motion 下禁用位置动画。不得修改 Event/Message、Gateway、thinking/Tool/PIU 样式或最终答案既有对齐。
  来源：design `FN-1.1 查看会话消息流 / 修改方案 / 7`；proposal `目标与非目标（Goals / Non-Goals）`
  验证：重复 7.1 定向测试并运行 `npm test -- tests/TurnBlock.activity-affordances.test.tsx tests/processDetailsProjection.test.ts tests/answerContent.test.ts`；预期待定→说明和待定→最终答案均不改变字体/行高/透明度或重新打字，既有活动状态、过程投影和答案语义继续通过。
  实际结果（2026-07-31）：最小实现只修改 `ProcessPanel` 的说明正文样式、共享 CSS handoff 动画和 `TurnBlock` 既有 answer region 标记；7.1 的 117/117 项转绿，活动状态/过程投影/答案语义三个回归文件 71/71 项通过。未修改 transport、Message/Event、Gateway 或持久化路径。

- [x] 7.3 完成浏览器、构建和规格验收：普通动效下最终答案以 transform-only 过渡到既有左对齐，长 Markdown 不发生字体切换，纵向阅读焦点由既有 anchor compensation 保持；reduced-motion 下直接对齐。浅色/深色下执行说明沿用外围背景，live/history 顺序和折叠行为不变。
  来源：`FN-1.1` + Requirement `Tool 轮次执行说明与 Tool 调用连续呈现` + 全部新增视觉连续性 Scenarios
  验证：在 `frontend/agent-web` 运行 `npm run build`、定向 `npm test` 和 `npm run test:e2e:smoke -- tests/e2e/process-history-modes.spec.cjs`；在仓库根目录运行 `openspec validate refine-process-content-message-event-projection --strict`。所有命令退出 0 后记录实际测试数量和环境噪声。
  实际结果（2026-07-31）：agent-web TypeScript build 与 multi-host Vite build 均退出 0；完整 Playwright smoke 29/29 通过，新增浏览器验收覆盖长 Markdown 的 16px/1.5/主文字色一致、透明外围背景、opacity 恒为 1、180 ms transform-only、最终答案与既有 answer lane 左对齐，以及 reduced-motion 无 handoff 动画。三宿主、10,000 轮容量和 200 轮多 thinking/多 Tool 旅程同步通过。目标 Change strict validate 通过；`openspec validate --all --strict` 为 276/278，两个失败仍是已记录且与本 Change 无关的 `add-ts-toggle-question-favorite`、`extend-ts-workflow-batch-config-scope`。Vite 对未被 fixture 接管的后台请求输出既有 `ECONNREFUSED` 代理日志，但没有测试失败。

- [x] 7.4 修复 live 最终答案在执行详情中的临时副本：共享 Web 投影保留 runtime 已产生的 `LLM_CONTENT_DELTA.final=true`，使浏览器在终局内容到达时立即移除待定过程项，不等待 `REQUEST_COMPLETED` 或刷新 history。不得通过前端终态猜测替代 canonical 标识，也不得改变 Message/Event 持久化。
  来源：Requirement `Tool 轮次执行说明与 Tool 调用连续呈现` + Scenario `Web 投影保留最终答案标识`
  验证：先运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-common/tests/process-message-projection.test.ts` 观察新增用例因 payload 缺少 `final` 失败；实现后追加 `packages/agent-channel-common/tests/web-stream-delivery.test.ts` 并在 5174/3001 Mock 环境运行 `process-handoff` 浏览器用例，预期展开执行详情只保留一条真实 Tool 前说明，最终答案过程副本为零，答案区只显示一份最终答案。
  实际结果（2026-07-31）：红灯阶段新增投影用例准确失败为 `expected final: true`、实际 payload 无该字段，其余 8 项通过；共享投影最小增加安全 `final` 字段后，两项后端文件 17/17 通过。内置浏览器实测执行说明阶段为 process explanation 1、answer 0；最终答案阶段为 process explanation 0、answer 1；完成后主动展开执行详情，仅保留真实 Tool 前说明 1 条，答案区保持最终答案 1 份。

- [x] 7.5 修复 AskUserQuestion resume 的重复过程项：真实事件序列同时包含 live-only `CAPABILITY_RESULT_DELTA` 和引用结果消息的 persisted `CAPABILITY_COMPLETED` 时，浏览器必须按 `pendingInputId` 将二者结算为同一个“补充信息”交互，且不得生成独立的 `AskUserQuestion · 已完成` Tool 项；仅从历史恢复 `CAPABILITY_COMPLETED` 时必须得到相同结果。同步更新 runtime 事件断言和浏览器 fixture，使其覆盖新增完成引用事件。
  来源：Requirement `可恢复过程事件引用唯一消息正文` + Scenario `Tool 终态事件引用结果消息`；Requirement `过程历史从消息正文与事件时序联合恢复` + Scenario `历史 Tool 过程与实时投影一致`；design `FN-1.1 查看会话消息流 / 修改方案 / 7`
  验证：先在 `frontend/agent-web` 运行 `npm test -- tests/processDetailsProjection.test.ts`，观察完整 AskUserQuestion 序列因产生第二条 Tool 项失败；实现后运行该文件、`frontend/agent-web/tests/e2e/session-history-streaming.spec.cjs` 对应浏览器旅程，以及根目录 `tests/agent-kernel/session-lane-scheduling.test.ts`，确认 live、回答结算、刷新 history 均只有一条“补充信息”，AskUserQuestion 完成事件仍为引用其 `CAPABILITY_RESULT` Message 的持久化事实。
  实际结果（2026-07-31）：RED 阶段完整 live 序列与仅 persisted completion 的 history 序列均稳定失败为“应为 1 个过程项、实际为 2 个”；最小实现让两类事件复用同一 `pendingInputAnswer` 识别和 `pendingInputId` 聚合路径。前端投影 53/53、runtime 与共享投影 46/46、完整 Playwright smoke 29/29 通过，其中 AskUserQuestion 旅程覆盖 live 回答、结算、第二次提交和刷新 history，均不显示独立 `AskUserQuestion` Tool 项。agent-web TypeScript build、目标 Change strict validate 和 `git diff --check` 均退出 0。Playwright 仅输出 fixture 未接管后台请求的既有 `ECONNREFUSED` 代理日志，没有测试失败。

## 归档前更新基线检查（非实施任务）

实现与验证完成后，归档流程按照 design `长期基线刷新计划（Baseline Promotion Plan）` 将三个 delta specs 归并到 stable specs，并同步 Functions、Features、architecture、modules、ADR 与 `spec-to-design-map`。归档前必须先处理 `fix-thinking-history-handoff-duplication`、`harden-agent-web-request-acceptance-control`、`harden-channel-input-security-boundaries` 在相同 stable spec 上的先后归并，并确认 `persist-ts-refresh-stable-completed-turns` 已按本 Change 的唯一过程历史边界完成改写或停止。
