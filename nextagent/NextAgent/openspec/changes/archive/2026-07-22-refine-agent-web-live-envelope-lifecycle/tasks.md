## 1. 锁定现状并建立 active/settled 生命周期

- [x] 1.1 为超过 500 个 session live envelope 后旧 live-only Turn 消失、history message 不受该上限直接约束，以及新 batch 当前会扫描单会话 live 数组补充 characterization tests；标记 `stabilize-agent-web-popup-and-scroll` 中只锁定旧 store shape、combined 快路径或 500 hard cap 的断言，后续仅替换这些断言并保留其 viewport、提交时序和 render-stability 回归。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/conversationStore.test.ts tests/buildSessionProjection.test.ts tests/MessageList.render-stability.test.tsx tests/useChatViewportController.test.tsx`，确认测试先能表达旧失败，且被保留的前序交互/渲染回归在后续实现后继续通过。
  来源：`Live envelope lifecycle SHALL preserve completed Turns without destructive session eviction`；design 决策 1、8。

- [x] 1.2 在 `conversationStore` 增加按 session/root/attempt 分桶的 active 与 settled live 状态，并用一次 store transition 实现 terminal envelope 纳入、最终压缩、active 删除和 settled 写入。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/conversationStore.test.ts tests/useChatSessionStream.test.tsx`，断言订阅者只看到 terminal 前 active 或 terminal 后 settled，不存在两者都缺失的 snapshot；覆盖 terminal 先于 accepted identity、optimistic root 原子重键、重复 terminal no-op、settled attempt 迟到 detail 合并和旧 attempt 迟到事件不覆盖较新 attempt；普通 terminal 不调用 conversation load。
  来源：`Accepted live process details SHALL remain stable across terminal and history merge`；design 决策 1、2。

- [x] 1.3 将 500 改为 active bucket 的无损 compaction watermark，使用单遍精确 lane 合并并删除任何 `slice(-500)` destructive fallback；压缩后超过 500 的结构事件必须保留，并新增 `tests/streamCompaction.test.ts` 锁定压缩器行为。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/streamCompaction.test.ts tests/conversationStore.test.ts`，覆盖 520 个文本 delta 完整合并、1001 个不可合并结构事件全部保留、达到 watermark 后新增 499 个事件不重复全量压缩、下一 watermark 到达后再压缩；覆盖两个 capability invocation 的 delta 交错到达不互相合并、同一 invocation 的 sequence gap 不跨段合并、不同 attempt 的相同 tool identity 不合并，以及 accumulated snapshot 只替换同一精确 lane。
  来源：`Live envelope lifecycle SHALL preserve completed Turns without destructive session eviction`；design 决策 5。

- [x] 1.4 分离 stream 接受与 anchored 窗口显示，移除 anchored `appendEnvelopes()` 提前丢弃路径，同时继续设置窗口外更新状态。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/conversationStore.test.ts`，断言 `mode=anchored + newerCursor` 时 active/settled bucket 收到事件，但当前 history window、anchor identity 和 cursor 不改变。
  来源：`Anchored view isolates display without discarding accepted stream data`；design 决策 4。

## 2. 收敛 history、visibility、edit/retry 和清理规则

- [x] 2.1 实现 semantic-lane source precedence：history 拥有用户内容、最终 assistant answer、最终 capability result、anchor 和 visibility；settled 只在 history 缺 root 时提供完整临时 Turn，history 命中后只补充过程详情。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/buildSessionProjection.test.ts tests/buildTurnBlocks.test.ts tests/TurnBlock.test.tsx`，断言同 root 只有一个 Turn、一个最终 answer，并且 history merge 后 full-process detail 仍存在。
  来源：`Accepted live process details SHALL remain stable across terminal and history merge`；design 决策 3。

- [x] 2.2 让 optimistic edit、retry、supersede、rollback 和 assistant clear action 同时维护 active/settled bucket，并保留当前 latest-attempt 选择规则。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/conversationStore.test.ts tests/buildTurnBlocks.test.ts`，覆盖 edit 成功隐藏旧 root、retry 新 attempt 覆盖旧 settled 展示、rollback 恢复原状态和 targeted clear 不影响其他 root。
  来源：`Canonical invisibility suppresses retained live projection`；design 决策 2、3、7。

- [x] 2.3 将 conversation clear 和现有 10-session LRU eviction 扩展到 history、active、settled、runtime、preview、window 和分页状态的同 session 同步清理。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/conversationStore.test.ts`，断言 clear 和第 11 个 session 进入缓存后均不存在 orphan active/settled bucket 或 ordinal counter。
  来源：`Session lifecycle cleanup does not create partial retained state`；design 决策 7。

- [x] 2.4 增加 canonical `visible=false` 的 negative test，实际构造仍含完整 settled answer/process 的旧 root，并断言 history/edit visibility 阻止该 root 重新进入投影。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/buildSessionProjection.test.ts tests/buildTurnBlocks.test.ts`，确认 retained live 无法绕过 visibility。
  来源：`Canonical invisibility suppresses retained live projection`；design 风险“edit 后 retained live 可能复现旧消息”。

## 3. 切换投影和组件消费路径

- [x] 3.1 将 session projection 改为 history base、settled process overlay、active overlay 的固定顺序，并对当前窗口内每个匹配 root 应用 settled detail，而非只处理 latest historical root。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/buildSessionProjection.test.ts tests/buildTurnBlocks.test.ts`，覆盖多个 settled historical root、history 尚缺 root、history 后到、active latest attempt，以及三个 live-only root 在 optimistic reconcile 和 terminal 前后的稳定顺序；history 命中后按 canonical sequence 定位且不产生重复 Turn。
  来源：两个 delta spec requirements；design 决策 3。

- [x] 3.2 为 anchored projection 增加窗口 selector：只补充 anchored history 已有 root，不插入窗口外新 root；返回连续 recent 后加入缓存 Turn 与过程详情。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/buildSessionProjection.test.ts tests/chat-page.route-state.test.tsx`，断言 anchored DOM、阅读 anchor 和分页 identity 稳定，recent projection 能看到缓存 root。
  来源：`Anchored view isolates display without discarding accepted stream data`；design 决策 4。

- [x] 3.3 保持未变化 historical/settled Turn 的 projection 与 React component 引用稳定，新 active batch 只改变匹配 root。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/buildSessionProjection.test.ts tests/MessageList.render-stability.test.tsx tests/TurnBlock.test.tsx`，在现有 render-stability 测试中断言旧 Turn render count 和引用均不因后续 active batch 改变，并用计数器断言 active append 不重新调用 settled grouping/base projection。
  来源：`Settled Turns remain stable while a later Turn streams`；design 决策 3、8。

## 4. 接入 stream lifecycle 并移除扁平热路径

- [x] 4.1 将 `useStreamConnection`、`useChatSessionStream`、retained-conversation-projection、identity resolution、latest viewport cursor、full-process/Expand Panel 等 consumer 接到 design 决策 6 指定的 history/active/settled owner；activity 只读 active，terminal 首次处理保持即时 callback，accepted identity 后到时按 session/root/attempt 从 matching active 或 settled bucket 补结算，且不扫描其他 settled root；保持 frame batching、stream cursor 和 recovery 顺序不变。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/useStreamConnection.test.tsx tests/useChatSessionStream.test.tsx tests/terminal-timeout-live-failure.integration.test.tsx tests/TurnBlock.test.tsx`，覆盖 terminal 先到/accepted identity 后到、optimistic root 重键后补结算、重复 terminal no-op、旧 attempt terminal 不结算新 pending、只有缓存 history/只有 active/只有 terminal-settled 三种情况下 retained-conversation-projection 均为真，以及 terminal 补结算不遍历无关 settled root。
  来源：design 决策 2、6、8；proposal 非目标中的 request lifecycle/stream contract 不变。

- [x] 4.2 从产品读写路径删除 `envelopesBySession`、`liveEnvelopesBySession`、combined fallback 和每帧扁平 mirror 维护，更新 ChatPage selector 与 conversation load/reconcile 检查使用显式 history/active/settled 状态；同步替换前序 change 中依赖 combined 三层一致或 500 hard cap 的 store 测试，不改动其 viewport、提交时序和 render-stability 验收语义。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/conversationStore.test.ts tests/chat-page.route-state.test.tsx tests/buildSessionProjection.test.ts`；code review 检查 `frontend/agent-web/src` 不再存在产品路径对旧字段的读写，且没有新增每帧 flatten selector。
  来源：design 决策 1、6、8；`Settled Turns remain stable while a later Turn streams`。

- [x] 4.3 增加 negative test，实际发送 ordinary terminal 并断言没有 terminal-triggered conversation request，同时 opening reconcile、manual refresh 和 gap recovery 仍能更新 canonical history。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/useChatSessionStream.test.tsx tests/conversationStore.test.ts tests/useStreamConnection.test.tsx`。
  来源：`Terminal settles live presentation without conversation refresh`；稳定 stream/history recovery contract。

- [x] 4.4 将后台任务 header monitor 从 history/active/settled conversation envelope 全量派生切换到现有 `backgroundTaskStore` 的 session/taskId 增量投影；由 `useChatSessionStream` 在 conversation attempt 过滤前路由三类 `BACKGROUND_TASK_*` envelope，一次 list seed 与 live/local kill 按明确优先级合并，普通 stream envelope 为 no-op。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/backgroundTaskStore.test.ts tests/BackgroundTaskMonitorPanel.test.tsx tests/useChatSessionStream.test.tsx`，覆盖 seed/live 到达顺序、非后台事件不发布、session 隔离、KILLED 不回退，以及旧 attempt 在 retry/edit 后收到终态。
  来源：`Background Task Header Monitor Shows Live Task List`；design 决策 6、8。

## 5. 容量、交互和性能验收

- [x] 5.1 增加同页超过 500 个 envelope、至少 600 个完成 Turn 和单 Run 1001 个不可合并结构事件的 store/projection 回归，断言无 Turn、answer、terminal 或 distinct process entry 丢失。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/conversationStore.test.ts tests/streamCompaction.test.ts tests/buildSessionProjection.test.ts tests/buildTurnBlocks.test.ts`。
  来源：`Live envelope lifecycle SHALL preserve completed Turns without destructive session eviction`；design 性能/容量结论。

- [x] 5.2 新增 `tests/e2e/session-history-streaming.spec.cjs` 长会话 Playwright 旅程：anchored 回看期间提交并接收 terminal 不改变窗口，显式返回 recent 后显示同一 Turn 和完整过程入口，且不出现新增 banner/badge。
  验证：在 `frontend/agent-web` 运行 `npm run test:e2e`，确认该 spec 与既有 smoke spec 均通过。
  来源：`Anchored view isolates display without discarding accepted stream data`；proposal 非目标中的“无新消息提示”。

- [x] 5.3 新增 `tests/e2e/session-edit-retry.spec.cjs` 浏览器旅程，实际触发 successful edit、retry 和 rollback/failure，验证旧 root 不复现、latest attempt 正确且阅读位置不被抢占。
  验证：在 `frontend/agent-web` 运行 `npm run test:e2e`，并运行 `npm test -- tests/chat-page.route-state.test.tsx tests/conversationStore.test.ts tests/buildTurnBlocks.test.ts` 锁定 route/store 边界。
  来源：`Canonical invisibility suppresses retained live projection`；既有回看位置稳定契约。

- [x] 5.4 在相同浏览器、相同 200 条已完成 Turn 与相同最新 Run stream fixture 下采集变更前后 Performance trace，确认 stream append animation-frame callback 不再执行 session-wide settled/history scan、combined rebuild 或旧 Turn render fan-out；若剩余 long task 位于当前 Turn Markdown/process/layout，记录为本 change 非目标而不混入修复。
  验证：把 fixture、浏览器版本、采样步骤、变更前后 trace 关键调用栈与 Turn render counter 写入同 change 的 `evidence/performance.md`；不得只以控制台没有 `[Violation]` 作为证据。
  来源：design 决策 8、性能/容量质量属性和 requestAnimationFrame 风险边界。

- [x] 5.5 在合并后的真实页面重复超长模型回复、超过 500 个 stream envelope、推送期间刷新、retry/edit 与后台任务跨 attempt 场景；检查 conversation、stream 和 background-task 请求次数，并采集修复后的 Performance trace，确认隐藏 monitor 不再进入普通 delta 的 animation-frame 同步调用链。
  验证：更新 `evidence/performance.md`，记录真实请求、控制台与 Performance 调用栈；若仍有 rAF long task，仅按调用栈归因当前 Turn Markdown/process/layout，不以 callback 名称推断。
  来源：`Settled Turns remain stable while a later Turn streams`、`Background Task Header Monitor Shows Live Task List`；design 决策 8。

## 6. 验证和收尾

- [x] 6.1 运行前端定向测试、完整前端 build、多宿主 mode build 和 OpenSpec strict validation，清理本 change 引入的未使用 helper、旧 store 字段和临时 debug instrumentation。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/conversationStore.test.ts tests/streamCompaction.test.ts tests/buildSessionProjection.test.ts tests/buildTurnBlocks.test.ts tests/useStreamConnection.test.tsx tests/useChatSessionStream.test.tsx tests/TurnBlock.test.tsx tests/chat-page.route-state.test.tsx`、`npm run build`、`npm run build:vite:modes`；在仓库根目录运行 `openspec validate --all --strict`；检查 `git diff --check`。
  来源：proposal 影响范围；design 验证映射和多宿主/API 不变约束。

- [x] 6.2 对实现范围执行 `$nextagent-code-review`，明确检查 frontend/browser ownership、history canonical source、无 `agent-contracts` 变化、无 terminal refresh、无 destructive 500 fallback、无 pendingHistory/TurnBlock cache、三宿主一致性和本 change 非目标未混入。
  验证：模型语义检视结论为 PASS 或 PASS WITH FOLLOW-UP，且不存在 P0/P1；若准备 push，按仓库门禁在 push 前重新检视。
  来源：AGENTS.md push/review 门禁；design owner、KISS 和非目标约束。

- [x] 6.3 对远程 main 合并后的实现重新运行前端定向/完整测试、build、多宿主 build、OpenSpec strict validation 和模型语义检视，确认 stuck-request 解锁、active/settled 生命周期、后台任务 stream projection 与三宿主共享 ChatWorkspace 同时成立。
  验证：在 `frontend/agent-web` 运行相关定向测试、`npm test`、`npm run build`、`npm run build:vite:modes`；仓库根运行 `openspec validate --all --strict`、`git diff --check`，并执行 `$nextagent-code-review`。
  来源：proposal 影响范围；合并后完整性门禁。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/ts-stream-history-consistency/spec.md`。
- 同步 `openspec/specs/e2e-ui-interaction/spec.md`。
- 同步 `openspec/specs/agent-web-background-task-control/spec.md`。
- 更新 `openspec/designs/architecture/agent-web-host-modes.md`。
- 更新 `openspec/designs/modules/agent-web.md`。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 不新增 ADR；检查长期文档没有重复定义 conversation projection 生命周期、source precedence 或 store owner。
