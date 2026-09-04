## 1. 验证当前 UI 行为

- [x] 1.1 验证 active pending input 与普通 Composer 互斥显示
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/chat-page.route-state.test.tsx -t "replaces the composer with an approval response|accepts NextAgent pending input payloads"`，断言响应面板出现时普通 message textarea 不存在
  来源：spec `Active pending input replaces the normal Composer`；design D1、D3

- [x] 1.2 验证四种 canonical kind 都选择对应响应控件，不把兼容 kind 或 `CONFIRMATION` fallback 固化为本 capability
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/RespondInput.test.tsx -t "renders NextAgent QUESTION inputs as clarification prompts|renders NextAgent AUTHORIZATION inputs as approval prompts|renders HUMAN_HANDOFF as mode plus content answers"`，并运行 `npm test -- tests/chat-page.route-state.test.tsx -t "renders canonical CONFIRMATION controls and restores the composer after submit"`。后者使用 canonical `pendingInputId`、`kind`、`questions` 和 `{ label, value }` options，断言 confirmation response surface 及原始 option value；code review 确认 spec 未定义 fallback answer values。不得把使用 `continue/stop` vocabulary 的既有 CONFIRMATION 组件测试当作 Stable contract 证据
  来源：spec `Active pending input replaces the normal Composer`；design D2、D4

- [x] 1.3 验证 answer 请求成功后立即恢复普通 Composer
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/chat-page.route-state.test.tsx -t "renders canonical CONFIRMATION controls and restores the composer after submit"`，断言提交 `pending-confirm-1` 的 ordered answer 成功后响应面板消失且普通 message textarea 恢复
  来源：spec `Resolved pending input restores the normal Composer`；design D3

- [x] 1.4 验证 received、timeout 和 canceled outcome 都进入同一 UI resolve 路径
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/useStreamConnection.test.tsx -t "routes user-input stream events to blocking-response callbacks"`，并运行 `npm test -- tests/chat-page.route-state.test.tsx -t "cancels a restored pending input|keeps an expired pending input active until canonical timeout resolves it"`
  来源：spec `Resolved pending input restores the normal Composer`；design D2、D3

## 2. 验证 owner 和规格边界

- [x] 2.1 验证本 change 没有重定义 channel/runtime contract，也没有修改其他未归档 change
  验证：对全部 `openspec/changes/` 重新执行 owner scan；`git status --short -- openspec/changes` 只能新增 `establish-agent-web-pending-input-ui/`；对该 change 的 spec 执行 endpoint path、public DTO field、`fallbackDecision`、`idempotencyKey` 和 HTTP error mapping forbidden-pattern scan，命中即失败
  来源：proposal 排除范围；design D1、D2、D4

- [x] 2.2 验证 active change 结构和 Requirement/Scenario 格式
  验证：在仓库根目录运行 `openspec validate establish-agent-web-pending-input-ui --strict`
  来源：proposal 验证入口；design Verification Map

## 3. 最终 Review

- [x] 3.1 汇总定向测试结果并如实登记无关失败
  验证：核对 1.1-1.4 的命令全部通过；单独记录完整 `chat-page.route-state.test.tsx` 当前存在的无关失败，不得把整文件声称为通过，也不得在本 change 中修复
  来源：design 风险与取舍；proposal 测试边界
  执行证据（2026-07-14）：定向组合命令覆盖 `RespondInput.test.tsx`、`useStreamConnection.test.tsx` 和 `chat-page.route-state.test.tsx`，结果为 3 个 test files 通过、9 tests 通过、120 skipped。随后执行完整 `chat-page.route-state.test.tsx`，本次结果为 64 passed、13 failed；本 change 对应的 Pending Input 场景均通过。13 个失败位于 preview/scroll、edit、terminal refresh 和 optimistic order 等无关场景，本 change 不修改这些代码或测试，也不把该完整文件声明为通过
  补充门禁（2026-07-14）：在 `frontend/agent-web` 运行 `npm run build`，现有 `tests/useChatSessionStream.test.tsx:79` 因 mock 返回 `void`、当前 callback contract 要求 `boolean` 而失败；该文件不在本 change 的修改范围，本 change 不修复或掩盖此失败

- [x] 3.2 执行一致性、范围和未归档 owner 独立终审
  验证：review proposal、design、spec、tasks 与 production symbols、Stable Specs、全部未归档 change 的对应关系；发现 scope expansion、owner overlap 或未被测试证明的 Requirement 时结论必须为 `REVISE` 或 `BLOCKED`
  来源：proposal 全范围；design Documentation Ownership、Risks / Trade-offs
  执行证据（2026-07-14）：独立只读终审交叉核对 production symbols、Stable Pending Input specs、`add-ts-task-channel` owner、canonical `CONFIRMATION` characterization test 和前端文档状态；P0-P3 均为 0，结论为 `PASS`。确认未修改生产代码、Stable Specs、其他 active change 或 `docs/reports`，且本 change 保持未归档

- [x] 3.3 刷新当前长期 module owner 与归档计划
  验证：确认 `openspec/designs/modules/agent-web.md` 已由归档后的 Stable 前端能力建立，AICO、Expand Panel 和 structured delta 不再被表述为未归档 owner；本 change 的 promotion plan 只向该 module 最小补充 Pending Input UI projection，并保持 `add-ts-task-channel` 的 channel/transport active owner 不变；重新运行 change strict 与全量 strict
  结果（2026-07-17）：当前 module owner 与 promotion plan 已刷新；本 change strict 通过，全仓 strict 202/202；未修改 `agent-web.md`、其他 active change、生产代码或 Stable specs

## 4. 归档前更新基线检查

- [x] 4.1 按已授权的 Baseline Promotion Plan 更新长期 module 与导航。
  验证：只向 `openspec/designs/modules/agent-web.md` 合并 `useUserInputStore -> ChatPage -> RespondInput` 的 UI projection/Composer 互斥职责，只在 `openspec/designs/spec-to-design-map.md` 增加 capability/test 导航；不得复制 channel payload 或 runtime lifecycle；运行本 change strict、全量 strict、定向测试、Markdown 链接扫描和范围检查。
  结果（2026-07-17）：长期 module/map 已最小同步；3 files / 9 targeted tests、change strict、全仓 202/202 和 Markdown 链接扫描通过。frontend build 的 4 个现有 TypeScript error 不在本 change diff 中，但仍阻塞统一归档门禁，因此本 change 保持 Active，未运行 archive。

## 5. 补齐展示型过期状态和 owning-request 取消委托

- [x] 5.1 补齐 Pending Input UI 对投影过期坐标和当前取消入口的边界契约
  验证：delta spec 只规定有投影过期坐标时的展示型剩余/过期状态，以及 `QUESTION`、`HUMAN_HANDOFF` 当前取消入口对 owning request 的委托；不定义 timeout policy、timer cadence、精确格式、cancel command、event synthesis 或其他 kind 的控件策略
  结果（2026-07-17）：新增两条 UI requirement，只承载展示型过期状态和 `QUESTION`/`HUMAN_HANDOFF` owning-request 取消委托；runtime/channel 继续拥有 timeout/cancel lifecycle、payload、command、idempotency 和 canonical event。change strict 通过。

- [x] 5.2 用组件和 route-state 测试分别证明过期显示与页面生命周期边界
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/RespondInput.test.tsx -t "shows projected expiry without submitting or canceling"`，证明本地倒计时只更新展示且不触发 submit/cancel；运行 `npm test -- tests/chat-page.route-state.test.tsx -t "keeps an expired pending input active until canonical timeout resolves it"`，证明本地过期后 active input、response surface 与 Composer 互斥状态保持，直到 canonical `USER_INPUT_TIMEOUT` 才恢复普通 Composer
  结果（2026-07-17）：两文件定向命令 2/2 通过；`RespondInput.test.tsx` 整文件 11/11 通过；与 owning-request cancel 场景合并复跑时 route-state 2/2 通过。页面级场景在 fake clock 越过投影过期坐标后断言同一 active input 和 response surface 仍存在、普通 Composer 仍隐藏、answer/cancel 均未触发；收到 canonical `USER_INPUT_TIMEOUT` 后才清除 active input 并恢复 Composer。完整 route-state 文件仍为 77 passed / 3 failed，失败均为本 change 范围外的既有 preview/edit 场景。

- [x] 5.3 用 route-state test 证明取消委托使用 pending request id 且等待 canonical outcome 才恢复 Composer
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/chat-page.route-state.test.tsx -t "cancels a restored pending input"`，并在 cancel request 成功后、`USER_INPUT_CANCELED` 到达前断言响应面板仍存在
  结果（2026-07-17）：定向命令 1 file / 1 test 通过；断言 cancel 使用 `session-1`/`req-1`，cancel request 成功后 response surface 保持、普通 Composer 不出现，直到 canonical `USER_INPUT_CANCELED` 到达才恢复。

- [x] 5.4 同步长期前端 module/navigation 并完成严格校验和独立语义复核
  验证：运行本 change strict、全量 strict、Markdown 链接扫描、`git diff --check` 和范围检查；复核必须确认 lifecycle、payload/schema、answer authority、生产代码、Stable specs、其他 active change 与 `docs/reports` 均未被修改，且 P0/P1 为 0
  结果（2026-07-17）：已同步 frontend README/workflow/architecture、`agent-web.md` 和 spec-to-design map；change strict 通过，全仓 strict 203/203，13 份触达 Markdown 的 77 个本地链接、`git diff --check`、active-change 范围和目标态措辞扫描通过。`RespondInput.test.tsx` 整文件 11/11 通过；`chat-page.route-state.test.tsx` 为 77 passed / 3 failed，失败与本 capability 无关。frontend build 和 architecture lint 仍被既有范围外问题阻塞。本轮将本地过期的生命周期证据从孤立组件断言收窄为“组件只证明显示与无回调副作用、route-state 证明 store/response surface/Composer 直到 canonical timeout 才收敛”；修正后独立语义复核 P0=0、P1=0、P2=0、P3=0，结论 PASS；未修改 lifecycle、payload/schema、answer authority、`agent-contracts`、生产代码、Stable specs、其他 active change 或三个既有 `docs/reports/*.html`。

## 6. 当前归档证据刷新

- [x] 6.1 统一 Pending Input canonical kind 的长期架构措辞，并刷新当前前端验证证据。
  验证：`runtime-boundaries.md`、Stable human-handoff spec、`agent-contracts/core`、本 change spec 和前端实现统一使用 `HUMAN_HANDOFF`；运行 `RespondInput.test.tsx`、`useStreamConnection.test.tsx`、Pending Input 定向 route-state tests、frontend build、本 change strict 和全量 strict。
  当前结果（2026-07-18）：长期 runtime boundary 已纠正为已有 canonical `HUMAN_HANDOFF`，未新增别名或修改 `agent-contracts`。`RespondInput.test.tsx` 11/11、`useStreamConnection.test.tsx` 42/42、Pending Input 定向 route-state 5/5 通过，frontend build、本 change strict 和全量 strict 通过；继续收口共享测试装配后，全量 frontend Vitest 为 278/278 files、1101/1101 tests 通过，且无生产实现 diff（`src` 下唯一 diff 是 co-located test）。全仓 architecture lint 的现有 Web channel/gateway 依赖违规与本 UI capability 无重叠；本 change 保持 Active，未运行 archive。

- [x] 6.2 合并最新 main 后刷新已解除的仓库级门禁。
  验证：运行 frontend build、全量 frontend Vitest、全量 OpenSpec strict 和 architecture lint；保留 6.1 作为合并前历史快照。
  当前结果（2026-07-18）：frontend build、278/278 files / 1101/1101 tests、OpenSpec strict 207/207 均通过；architecture lint 为 dependency 0 违规、package manifest policy 通过、34 files / 207 tests 通过。原 Web channel/gateway 阻塞已由对应 committer 随 main 修复，本 change 未修改该实现。当前所有验证门禁绿色；本 change 保持 Active，仅因本轮未获授权执行 archive。

- [x] 6.3 基于当前代码再次确认 reverse-spec UI 边界和归档证据。
  验证：核对 `useUserInputStore -> ChatPage -> RespondInput` 当前调用链、answer success 本地恢复、received/timeout/canceled canonical 收敛、展示型过期和 owning-request cancel；运行 `RespondInput.test.tsx`、`useStreamConnection.test.tsx`、完整 route-state、frontend build、本 change strict、全量 strict、architecture lint 和 `git diff --check`。后续多问题翻页与 AskUserQuestion answer result 只扩展同一 response surface，不改变本 capability 对 Composer 互斥和 lifecycle 非 ownership 的边界。
  当前结果（2026-07-23）：当前 UI/store/stream 调用链与四条 Requirement 一致；`RespondInput` 15 项、`useStreamConnection` 42 项、完整 route-state 96 项共 3 files / 153 tests 通过，frontend build 通过，本 change strict 和全量 strict 222/222 通过，architecture 为 36 files / 225 tests 且 dependency 零违规，`git diff --check` 通过。1/4/20 题 pager 与 answer-result projection 继续由后续 Stable capability 拥有，本轮未修改 lifecycle、payload/schema、answer authority、生产代码、Stable specs 或其他 active change。
