## 1. 回归测试

- [x] 1.1 补充 Skill Modal 首次查询、搜索和空结果切换时列表视口尺寸不变的组件测试。
  验证：`cd frontend/agent-web && npm test -- tests/SkillSelector.test.tsx`
  来源：`Skill Modal 打开期间 SHALL 保持外框几何稳定`
- [x] 1.2 补充短会话、离开底部、物理到底和历史锚定入口的 viewport/route-state 测试。
  验证：`cd frontend/agent-web && npm test -- tests/useChatViewportController.test.tsx tests/chat-page.route-state.test.tsx`
  来源：`Conversation viewport SHALL separate latest following from physical bottom position`
- [x] 1.3 补充非 wheel 上滚后、scroll-state rAF 前触发 ResizeObserver 时不得置底的事件顺序测试。
  验证：`cd frontend/agent-web && npm test -- tests/useChatViewportController.test.tsx`
  来源：`User upward scrolling SHALL preserve the reading position during asynchronous layout growth`
- [x] 1.4 补充从很早的 Preview 锚点通过滚轮、滚动条、触摸和键盘分多页持续向下滚动，最后一页已加载但尚未到底、真正到底后退出 anchored、程序性滚动不得退出、Preview 命中不可滚动短会话时不伪造置底入口，以及 anchored 不暴露通用 reload-latest 入口的 route-state 测试。
  验证：`cd frontend/agent-web && npm test -- tests/chat-page.route-state.test.tsx`
  来源：design 决策 4、`Anchored state has explicit or continuous latest-oriented escape behavior`
- [x] 1.5 补充 recent 非跟随回看、anchored 有/无 `newerCursor` 回看，以及提交等待期间上滚时，新提交与编辑后提交均不置底；同时验证 anchored 无需额外滚动即可关闭自动跟随、不清除锚点、不显示独立新消息提示，并覆盖执行期间继续回看。
  验证：`cd frontend/agent-web && npm test -- tests/chat-page.route-state.test.tsx`
  来源：design 决策 5、`User upward scrolling SHALL preserve the reading position during asynchronous layout growth`
- [x] 1.6 补充 latest load、另一 Preview 锚点和会话切换使未完成 older/newer 分页失效的 store/route-state 测试。
  验证：`cd frontend/agent-web && npm test -- tests/conversationStore.test.ts tests/chat-page.route-state.test.tsx`
  来源：design 决策 6、`Anchored pagination results SHALL belong to the active window`
- [x] 1.7 补充顶部向上滚动加载 older、底部向下滚动加载 newer、边界 wheel 重试和程序性分页位移不连续加载的 viewport/route-state 测试。
  验证：`cd frontend/agent-web && npm test -- tests/useChatViewportController.test.tsx tests/chat-page.route-state.test.tsx`
  来源：design 决策 7、`Anchored segment supports older and newer loading`
- [x] 1.8 补充 active live envelope 只重置 imperative activity timer、不触发 hook owner 重渲染的 session stream 测试。
  验证：`cd frontend/agent-web && npm test -- tests/useChatSessionStream.test.tsx`
  来源：design 决策 8、`Live conversation projection SHALL preserve long-session input responsiveness`
- [x] 1.9 补充 layered live 更新复用 historical projection、未变化 block 保持引用、latest-only following signal、TurnBlock memo 和 stream debug 显式开启的回归测试。
  验证：`cd frontend/agent-web && npm test -- tests/buildSessionProjection.test.ts tests/buildTurnBlocks.test.ts tests/MessageList.test.tsx tests/streamDebugBuffer.test.ts`
  来源：design 决策 8、`Live conversation projection SHALL preserve long-session input responsiveness`
- [x] 1.10 补充 live append 复用历史数组引用、旧 Turn 实际渲染次数、Composer/footer 监听隔离，以及置底动画完成前不报告物理到底的回归测试。
  验证：`cd frontend/agent-web && npm test -- tests/conversationStore.test.ts tests/MessageList.render-stability.test.tsx tests/right-pane-layout.scroll-shell.test.tsx tests/useChatViewportController.test.tsx`
  来源：design 决策 9、`Live conversation projection SHALL preserve long-session input responsiveness`

## 2. 前端实现

- [x] 2.1 冻结 Skill Modal 每次打开期间的列表视口高度，保持现有查询、搜索和分页路径。
  验证：`cd frontend/agent-web && npm test -- tests/SkillSelector.test.tsx`
  来源：design 决策 1、proposal Skill Modal scope
- [x] 2.2 按历史窗口、跟随策略和物理底部组合控制浮动入口，并只在真实物理底部恢复跟随。
  验证：`cd frontend/agent-web && npm test -- tests/useChatViewportController.test.tsx tests/chat-page.route-state.test.tsx`
  来源：design 决策 2、design 决策 4
- [x] 2.3 在通用 scroll 路径中同步退出跟随并取消待执行置底，保留下一帧阅读锚点计算。
  验证：`cd frontend/agent-web && npm test -- tests/useChatViewportController.test.tsx`
  来源：design 决策 3
- [x] 2.4 使 viewport controller 进入 anchored 时即退出跟随，anchored 期间关闭内容增长触发的自动 pin、只报告物理底部而不自行恢复跟随，并使 `stopFollowingBottom()` 重新测量而非伪造 `isAtBottom=false`；由 ChatPage 汇总滚轮、滚动条、触摸和键盘向下意图，只在更新页耗尽且用户真实到达连续消息段底部时调用 store 的 `completeAnchoredConversation(sessionId, expectedAnchorMessageId)` 窄转换，成功后恢复跟随；anchored 期间不暴露通用 reload-latest 入口。
  验证：`cd frontend/agent-web && npm test -- tests/chat-page.route-state.test.tsx`
  来源：design 决策 4
- [x] 2.5 使发送包装器复用 `requestScrollToBottomIfFollowing()`，只在当前仍跟随时置底；recent 非跟随和 anchored 提交均保持窗口、跟随策略和滚动位置，anchored 同时保留锚点并继续复用现有非连续 live envelope 隔离。
  验证：`cd frontend/agent-web && npm test -- tests/chat-page.route-state.test.tsx tests/conversationStore.test.ts`
  来源：design 决策 5
- [x] 2.6 复用现有窗口加载版本，为 older/newer 分页增加 session、窗口模式、锚点和 cursor 一致性校验，阻止过期响应写入。
  验证：`cd frontend/agent-web && npm test -- tests/conversationStore.test.ts tests/chat-page.route-state.test.tsx`
  来源：design 决策 6
- [x] 2.7 复用现有 scroll/wheel/keyboard 入口和分页 action，使顶部 older 与 anchored 底部 newer 按相同的方向意图、128px 边界和单请求约束触发；移除空闲点击分页入口，保持 older 阅读位置补偿和 anchored 最终到底退出规则。
  验证：`cd frontend/agent-web && npm test -- tests/useChatViewportController.test.tsx tests/chat-page.route-state.test.tsx`
  来源：design 决策 7
- [x] 2.8 将 session stream activity timeout 改为 ref/timer 直接续期，删除逐 envelope React state 更新，同时保持 anchored 隔离和 terminal lifecycle 行为。
  验证：`cd frontend/agent-web && npm test -- tests/useChatSessionStream.test.tsx tests/useStreamConnection.test.tsx`
  来源：design 决策 8
- [x] 2.9 分离 historical projection 与 live overlay 的 memo 输入，使未变化 block 保持引用；memo TurnBlock，移除未消费的 at-bottom prop，并使旧 turn 通过稳定 getter 读取 following ref。
  验证：`cd frontend/agent-web && npm test -- tests/buildSessionProjection.test.ts tests/buildTurnBlocks.test.ts tests/MessageList.test.tsx tests/TurnBlock.test.tsx tests/useChatViewportController.test.tsx`
  来源：design 决策 8
- [x] 2.10 将 stream frame debug 改为默认关闭、`ADNCLAW_STREAM_DEBUG=1` 显式开启，保留现有容量上限和导出能力。
  验证：`cd frontend/agent-web && npm test -- tests/streamDebugBuffer.test.ts tests/stream-transport.test.ts`
  来源：design 决策 8
- [x] 2.11 复用当前 session 的稳定历史引用和稳定回调，隔离 Composer ReactNode，保持 overlay footer observer，并使现有置底过渡只在开始/结束提交 React 状态且可被真实上滚取消。
  验证：`cd frontend/agent-web && npm test -- tests/conversationStore.test.ts tests/MessageList.render-stability.test.tsx tests/right-pane-layout.scroll-shell.test.tsx tests/useChatViewportController.test.tsx`
  来源：design 决策 9

## 3. 验证和收尾

- [x] 3.1 运行前端 build、定向测试和 OpenSpec strict validate。
  验证：`cd frontend/agent-web && npm run build`；Skill/viewport 全文件测试；`chat-page.route-state.test.tsx` 的 8 个受影响滚动场景；`openspec validate --all --strict`
  首轮结果（2026-07-20）：frontend build 通过；Skill 20 项、viewport 9 项、route-state 聚焦 8 项全部通过；OpenSpec strict 212/212。route-state 全文件串跑存在既有 preview 测试超时级联，首个受影响滚动用例独立运行通过，不作为本 change 的通过证据。该结果不覆盖本次新增的 1.4—1.6 和 2.4—2.6。
  来源：proposal 影响范围、design 验证映射
- [x] 3.2 检查最终 diff 未修改 API、预览分页、宿主模式或滚动动画常量，并完成 OpenSpec 语义复核。
  验证：`git diff --check`；`nextagent-skill-review` 检查点
  首轮结果（2026-07-20）：`git diff --check` 通过；未修改 API、预览分页、宿主入口或置底动画时长；首轮语义复核 P0=0、P1=0、P2=0，结论 PASS。第二阶段以 3.3 的重新检视结果为准。
  来源：proposal 非目标、design 文档承载决策
- [x] 3.3 运行第二阶段定向测试、前端 build、OpenSpec strict validate 和完整交互语义复核。
  验证：`cd frontend/agent-web && npm test -- tests/useChatViewportController.test.tsx tests/conversationStore.test.ts tests/chat-page.route-state.test.tsx`；`cd frontend/agent-web && npm run build`；`openspec validate --all --strict`；`nextagent-skill-review`
  第二阶段结果（2026-07-20）：Skill 20 项、viewport 11 项、conversation store 63 项、route-state 90 项、session stream 3 项、right-pane 3 项及 Playwright Chromium smoke 1 项全部通过；frontend build 通过；OpenSpec strict 212/212；OpenSpec 与代码语义复核均为 PASS。
  来源：design 第二阶段验证映射
- [x] 3.4 运行终态竞态、双向滚动分页定向测试、前端 build、OpenSpec strict validate，并复核未修改后端、API、cursor、分页大小或宿主入口。
  验证：`cd frontend/agent-web && npm test -- tests/requestStore.test.ts tests/useChatSessionStream.test.tsx tests/useChatViewportController.test.tsx tests/chat-page.route-state.test.tsx`；`cd frontend/agent-web && npm run build`；`openspec validate --all --strict`
  最终结果（2026-07-20）：定向测试 174/174 通过；frontend TypeScript build 通过；OpenSpec strict 212/212；`git diff --check` 通过。最终差异仅触达 agent-web view state/交互、对应测试与本 change 文档，未修改后端、Web API、cursor shape、分页大小或宿主入口；第 3 项消息处理性能优化未实施。
  来源：稳定 `ts-stream-history-consistency` 终态收敛要求、design 决策 7、proposal 非目标
- [x] 3.5 运行 live 渲染稳定性定向测试、既有滚动/终态回归、frontend build、Chromium smoke 和 OpenSpec strict validate，并复核未修改后端、stream contract、conversation store shape、分页或宿主入口。
  验证：`cd frontend/agent-web && npm test -- tests/useChatSessionStream.test.tsx tests/useStreamConnection.test.tsx tests/buildSessionProjection.test.ts tests/buildTurnBlocks.test.ts tests/MessageList.test.tsx tests/TurnBlock.test.tsx tests/streamDebugBuffer.test.ts tests/stream-transport.test.ts tests/useChatViewportController.test.tsx tests/chat-page.route-state.test.tsx`；`cd frontend/agent-web && npm run build`；`cd frontend/agent-web && npm run test:e2e:smoke`；`openspec validate --all --strict`
  来源：design 决策 8、proposal 非目标
- [x] 3.6 运行渲染隔离定向测试、既有滚动/route-state 回归、frontend build、Chromium 长会话交互验证和 OpenSpec strict validate，并复核未修改后端、API、cursor、分页大小、动画时长或宿主入口。
  验证：`cd frontend/agent-web && npm test -- tests/conversationStore.test.ts tests/MessageList.render-stability.test.tsx tests/right-pane-layout.scroll-shell.test.tsx tests/useChatViewportController.test.tsx tests/chat-page.route-state.test.tsx`；`cd frontend/agent-web && npm run build`；`openspec validate --all --strict`
  最终结果（2026-07-20）：渲染/viewport 定向测试 85/85、route-state 91/91、Composer 回归 72/72 通过；frontend TypeScript build 通过；OpenSpec strict 213/213；`git diff --check` 通过。Chromium 在 60 个已渲染 Turn、约 15.5k px 内容高度的长会话中完成连续上滚、220ms 置底、recent 回看提交、Preview 锚定跳转/提交和返回最新验证；连续上滚调用为 30/25/23ms，recent 与 anchored 提交均保持原阅读位置，所有场景均未捕获 `Violation`。最终差异未修改后端、Web API、cursor、分页大小、220ms 动画时长或宿主入口。
  来源：design 决策 9、proposal 非目标

## 归档前更新基线检查（非实施任务）

- 归并 `skill-selector-ui` 与 `e2e-ui-interaction` 行为契约。
- 归并 `session-conversation-preview` 的 anchored 连续分页、提交保护、退出条件和过期响应约束。
- 更新 `agent-web` 模块设计和 `spec-to-design-map` 验证入口。
- 不新增 architecture 或 ADR 文档。

## 4. Review 纠偏

- [x] 4.1 使 ChatPage 的历史投影只依赖“是否存在 live envelope”布尔值，新增连续 live 更新不重建历史投影的页面级回归测试。
- [x] 4.2 允许用户在 request 提交或执行期间继续通过方向滚动加载 older/newer 分页，并保持实际 conversation window loading 的阻断与边界状态反馈。
- [x] 4.3 撤回 same-session canonical-run terminal fallback，恢复 pending request 仅按自身已接受身份收敛，并补充旧 run 终态不得结算新 pending 的负例。
- [x] 4.4 在 anchored 自然完成时中止同一 session 的未完成 older 请求并清理 `isLoadingOlder`，补充迟到响应不得污染 recent 窗口的竞态测试。
- [x] 4.5 运行纠偏定向测试、frontend build、浏览器回归、OpenSpec strict validate，并复核未修改后端、API、cursor、分页大小、动画时长或宿主入口。
  纠偏结果（2026-07-21）：修复前 4 类新增回归均失败；修复后纠偏用例 9/9、受影响 store/hook/projection/render 测试 167/167、route-state 93/93、Chromium smoke 1/1 通过；frontend TypeScript build、OpenSpec 全量 strict 213/213、目标 change strict validate 和 `git diff --check` 通过。最终差异只触达 `frontend/agent-web` 既有浏览器 owner、对应测试和本 tasks 追踪，未修改后端、Web API、cursor、分页大小、220ms 动画时长或宿主入口；`nextagent-skill-review` 结论 PASS，`agent-contracts` 群内确认项为 None。
- [x] 4.6 在 terminal 先于 accepted identity 到达时，仅重放当前 live layer 中与后续 accepted identity 精确匹配的 terminal，并保持旧 run 终态不能结算新 pending。
- [x] 4.7 同步 anchored 自然完成的分页失效设计，并确保“提交中加载更新消息”用例建立真实 submitting 前提。
- [x] 4.8 运行定向回归、frontend build、OpenSpec strict validate，并完成最终语义检视。
  最终复核结果（2026-07-21）：新增 terminal 迟到身份回归在修复前稳定失败、修复后通过；受影响 frontend 单元/组件用例 368/368、route-state 93/93 通过，frontend TypeScript build、目标 change strict validate、OpenSpec 全量 strict 213/213 和 `git diff --check` 通过。真实浏览器长会话覆盖物理置底、向上滚动、置底动画、Preview 跳转、anchored 提交不接管视口、手动返回最新、滚动触发单页 older 加载和禁止自动连载，控制台未出现 `Violation` 或 error；测试提交消息为 `E2E-ANCHORED-RACE-FIX-20260721-001`。`nextagent-code-review` 与 `nextagent-skill-review` 结论均为 PASS，`agent-contracts` 群内确认项为 None。

## 5. 第一轮提交性能纠偏

- [x] 5.1 补充首次 live envelope 与 request 提交、accepted、terminal 生命周期变化时，未变化历史 block 保持对象引用且旧 Turn 不重渲染的回归测试；同时锁定 request 期间只有 latest turn action 进入禁用状态。
  验证：`cd frontend/agent-web && npm test -- tests/buildSessionProjection.test.ts tests/MessageList.render-stability.test.tsx`
  来源：design 决策 10、`Live conversation projection SHALL preserve long-session input responsiveness`
- [x] 5.2 补充 following 模式下同一帧多次内容增长置底请求只调度一次、只执行一次最终置底，并在内容增长后到达物理底部的 controller 测试。
  验证：`cd frontend/agent-web && npm test -- tests/useChatViewportController.test.tsx`
  来源：design 决策 10、`Conversation viewport SHALL separate latest following from physical bottom position`
- [x] 5.3 将历史结构投影从 active run、live 存在性和 request 生命周期中隔离，只对 latest turn 应用轻量状态修正，并使 request action 禁用状态只传给 latest turn。
  验证：`cd frontend/agent-web && npm test -- tests/buildSessionProjection.test.ts tests/MessageList.render-stability.test.tsx`
  来源：design 决策 10
- [x] 5.4 合并同一 animation frame 内的 following 内容增长置底请求，保持显式置底按钮的 220ms 动画、anchored/recent 语义和用户上滚取消路径不变。
  验证：`cd frontend/agent-web && npm test -- tests/useChatViewportController.test.tsx tests/chat-page.route-state.test.tsx`
  来源：design 决策 10
- [x] 5.5 运行定向回归、frontend build、浏览器长会话物理置底提交验证、OpenSpec strict validate 和语义检视，并复核未修改 stream 批处理、conversation store、Composer 自适应、后端、API、分页、动画时长或宿主入口。
  验证：`cd frontend/agent-web && npm test -- tests/buildSessionProjection.test.ts tests/MessageList.render-stability.test.tsx tests/useChatViewportController.test.tsx tests/chat-page.route-state.test.tsx`；`cd frontend/agent-web && npm run build`；`openspec validate --all --strict`；`nextagent-skill-review`
  第一轮结果（2026-07-21）：新增 3 类回归在修改前分别失败；修改后定向测试 129/129、frontend TypeScript build、OpenSpec strict 213/213 和 `git diff --check` 通过。Chromium 在 60 个已渲染 Turn、约 15.7k px 内容高度的长会话中完成两次物理置底提交，新增 Turn 后底部距离分别为 0.60px 和 -0.20px，均处于现有物理底部容差内，新增控制台日志为 0、未捕获 `Violation`；浏览器操作往返为 631ms/1022ms，但没有对应页面长任务日志，故不作为 keydown handler 时长证据。最终差异未修改 stream 批处理、conversation store、Composer 自适应、后端、Web API、cursor、分页大小、220ms 动画时长或宿主入口；语义检视结论 PASS，`agent-contracts` 群内确认项为 None。
  来源：proposal 非目标、design 决策 10

## 6. 第二轮 handler 热路径优化

- [x] 6.1 锁定显式置底动画的中间帧及其程序性 scroll event 不重复读取底部几何，并在动画目标变化和最终帧保留真实物理置底。
  验证：`cd frontend/agent-web && npm test -- tests/useChatViewportController.test.tsx`
  来源：design 决策 11、`Conversation viewport SHALL separate latest following from physical bottom position`
- [x] 6.2 空 Composer 恢复默认高度时不调度布局测量帧，非空输入继续沿用现有自适应高度行为。
  验证：`cd frontend/agent-web && npm test -- tests/composer-panel.component.test.tsx`
  来源：design 决策 11、`Live conversation projection SHALL preserve long-session input responsiveness`
- [x] 6.3 accepted request 身份对账仅复制命中 envelope 的 payload，保持未命中 envelope 引用、消息顺序、request identity 和 store shape 不变。
  验证：`cd frontend/agent-web && npm test -- tests/conversationStore.test.ts tests/requestStore.test.ts`
  来源：design 决策 11、`Live conversation projection SHALL preserve long-session input responsiveness`
- [x] 6.4 运行定向回归、frontend build、Chromium 长会话滚动/置底/清空/提交验证、OpenSpec strict validate 和语义检视，并复核未修改 stream 批处理、后端、Web API、cursor、分页大小、220ms 动画时长或宿主入口。
  验证：`cd frontend/agent-web && npm test -- tests/composer-panel.component.test.tsx tests/conversationStore.test.ts tests/useChatViewportController.test.tsx tests/requestStore.test.ts tests/chat-page.route-state.test.tsx tests/buildSessionProjection.test.ts tests/MessageList.render-stability.test.tsx`；`cd frontend/agent-web && npm run build`；`cd frontend/agent-web && npm run test:e2e`；`openspec validate --all --strict`；`nextagent-code-review`；`nextagent-skill-review`
  第二轮结果（2026-07-21）：保留的两类新增回归与受影响单元/组件回归共 291/291 通过，frontend TypeScript build、Chromium smoke 1/1 和 OpenSpec strict 213/213 通过。真实 Chromium 长会话保持 60+ 个已渲染 Turn，置底操作往返为 312-394ms（包含既有 220ms 动画与自动化开销），最终底部距离为 -0.20px；清空输入恢复默认高度，滚动、置底、清空和提交均未新增控制台日志或捕获 `Violation`。曾尝试把 existing-session optimistic 提交移入原生 `keydown` 调用栈，实测提交操作往返反而扩大到 915-1314ms，故撤回并保留既有异步边界。最终差异未修改 stream 批处理、后端、Web API、cursor、分页大小、动画时长或宿主入口；代码与 OpenSpec 语义检视结论均为 PASS，`agent-contracts` 群内确认项为 None。浏览器自动化往返不等于 handler 自身耗时，若用户 Chrome 仍报告 `Violation`，后续需以同一设备的 Performance trace 精确归因。
  来源：proposal 长会话响应性、design 决策 11

## 7. 第三轮浏览器任务与逐帧批处理优化

- [x] 7.1 补充普通 existing-session 提交在 optimistic store 写入前让出一个真实浏览器 task，以及让出期间会话切换不得误投的回归测试。
  验证：`cd frontend/agent-web && npm test -- tests/chat-composer-controller.attachments.test.tsx`
  来源：design 决策 12、`Live conversation projection SHALL preserve long-session input responsiveness`
- [x] 7.2 普通 existing-session 新提交使用零延迟 timer task 延后 optimistic 写入，并在恢复时校验 active session；保持新会话创建、edit/retry 和请求 contract 不变。
  验证：`cd frontend/agent-web && npm test -- tests/chat-composer-controller.attachments.test.tsx`
  来源：design 决策 12
- [x] 7.3 将同一 stream batch 的 live append 收敛为一次 identity/lane 建表和一个 session 工作数组，保持输入顺序、精确去重、accumulated snapshot replacement、容量上限和单次 store notification。
  验证：`cd frontend/agent-web && npm test -- tests/conversationStore.test.ts tests/useStreamConnection.test.tsx`
  来源：design 决策 12
- [x] 7.4 使 following 内容增长 frame 复用 `ResizeObserver` 已测得的最后一个底部目标；无目标的既有调用仍读取真实高度，取消时清理目标，显式置底 220ms 动画不变。
  验证：`cd frontend/agent-web && npm test -- tests/useChatViewportController.test.tsx tests/chat-page.route-state.test.tsx`
  来源：design 决策 12
- [x] 7.5 运行定向回归、frontend build、Chromium 长会话提交/stream/following 验证、OpenSpec strict validate 和代码/规格语义检视，并复核未修改后端、Web API、stream contract、cursor、分页大小、220ms 动画时长或宿主入口。
  验证：`cd frontend/agent-web && npm test -- tests/chat-composer-controller.attachments.test.tsx tests/conversationStore.test.ts tests/useStreamConnection.test.tsx tests/useChatViewportController.test.tsx tests/requestStore.test.ts tests/chat-page.route-state.test.tsx tests/buildSessionProjection.test.ts tests/MessageList.render-stability.test.tsx`；`cd frontend/agent-web && npm run build`；`openspec validate --all --strict`；`nextagent-code-review`；`nextagent-skill-review`
  第三轮结果（2026-07-21）：existing-session task yield 与 following 几何复用回归在修改前分别失败，batch 等价性回归锁定同批 accumulated snapshot replacement、普通 delta 顺序和重复 identity 去重；最终 7 个直接相关测试文件 216/216、`chat-page.route-state.test.tsx` 独立全文件 93/93、Chromium smoke 1/1 通过，frontend TypeScript build、OpenSpec strict 213/213 和 `git diff --check` 通过。并行合跑 route-state 时曾出现首个 10s 超时及后续 DOM cleanup 级联，首个失败与关键场景 4/4、随后 route-state 独立全文件均通过，确认不是逻辑回归。真实 Chromium 在 60 个历史 Turn、约 2975 个 DOM 元素的长会话中完成 existing-session Enter 提交、stream 完成、向上滚动和现有置底过渡：新增 Turn 后底部误差约 0.2px，向上滚动一次离底约 800px 且置底按钮正常出现，点击后按钮隐藏并恢复物理底部；自动化往返为 Enter 398ms、置底点击 306ms（后者包含既有 220ms 动画），均不作为 handler 精确耗时。浏览器日志未新增 error 或可捕获的 `[Violation]`，但该日志面不能替代用户 Chrome Performance trace。最终差异未修改后端、Web API、stream contract、cursor、分页大小、220ms 动画时长或宿主入口；`nextagent-code-review` 与 `nextagent-skill-review` 结论均为 PASS，`agent-contracts` 群内确认项为 None。
  来源：proposal 长会话响应性、design 决策 12

## 8. 第四轮 optimistic store 写入优化

- [x] 8.1 补充单条本地 optimistic USER envelope 保持历史 envelope map、历史消息 map 和当前历史数组引用，重复 identity 仍为 no-op，容量边界仍保持 500 上限的回归测试。
  验证：`cd frontend/agent-web && npm test -- tests/conversationStore.test.ts`
  来源：design 决策 13、`Live conversation projection SHALL preserve long-session input responsiveness`
- [x] 8.2 仅对已分层、容量未满且 request identity 全新的单条本地 optimistic USER envelope 复用稳定历史 state；其他输入继续走既有 batch 归一化、dedup、compaction 和容量路径。
  验证：`cd frontend/agent-web && npm test -- tests/conversationStore.test.ts`
  来源：design 决策 13
- [x] 8.3 运行受影响 store/request/Composer/stream 回归、frontend build、OpenSpec strict validate 和差异复核，并确认未修改公开 action、store shape、后端、Web API、stream contract、cursor、分页大小、220ms 动画时长或宿主入口。
  验证：`cd frontend/agent-web && npm test -- tests/conversationStore.test.ts tests/requestStore.test.ts tests/chat-composer-controller.attachments.test.tsx tests/useStreamConnection.test.tsx`；`cd frontend/agent-web && npm run build`；`openspec validate --all --strict`；`git diff --check`
  第四轮结果（2026-07-21）：新增 optimistic 快路径引用稳定性回归在实现前失败、实现后通过；store/request/Composer/stream 定向测试 181/181，session projection/render stability 19/19 通过；frontend TypeScript build、OpenSpec strict 213/213 和 `git diff --check` 通过。容量回归确认达到边界后仍保留 500 条并回退既有裁剪；最终差异未修改公开 action、store shape、后端、Web API、stream contract、cursor、分页大小、220ms 动画时长或宿主入口。未在用户 Chrome 上采集本轮 Performance trace，因此不把单元测试耗时作为浏览器 handler 耗时证据。
  来源：proposal 非目标、design 决策 13

## 9. Pending-input activity timeout 纠偏

- [x] 9.1 补充当前 request 进入 `USER_INPUT_REQUIRED` 后等待超过 activity timeout 仍保持 executing，且 timeout refresh 返回 matching `activeRun` 时不得本地 settle 的回归测试。
  验证：`cd frontend/agent-web && npm test -- tests/useChatSessionStream.test.tsx tests/chat-page.route-state.test.tsx`
  来源：design 决策 8、`等待用户输入不触发 stuck-run 解锁`、`普通无活动恢复服从权威 activeRun`
- [x] 9.2 在当前 request 的 pending-input 等待期间暂停 activity timer，并使普通 timeout 只有在 conversation 刷新成功且权威 `activeRun` 已不存在时才解锁。
  验证：`cd frontend/agent-web && npm test -- tests/useChatSessionStream.test.tsx tests/chat-page.route-state.test.tsx`
  来源：design 决策 8
- [x] 9.3 运行定向测试、frontend build、目标 change strict validate 和 `git diff --check`，确认未修改 timer 时长、后端 pending timeout、Web API、stream contract、cursor、store shape 或宿主入口。
  验证：`cd frontend/agent-web && npm test -- tests/useChatSessionStream.test.tsx tests/chat-page.route-state.test.tsx`；`cd frontend/agent-web && npm run build`；`openspec validate stabilize-agent-web-popup-and-scroll --strict`；`git diff --check`
  结果（2026-07-23）：pending-input 等待与 matching activeRun 两个回归在实现前失败；加强后的等待回归又确认仅清除当次 timer 仍会被后续投影活动重新计时，增加 request-scoped pending ref 后通过。另补充 resolved 后恢复 timer，以及权威 activeRun 消失后才执行原有 stale-request settle 的正向回归；定向测试 108/108 通过。frontend TypeScript build、目标 change strict validate 和 `git diff --check` 通过。最终差异未修改 15 秒 activity timer、后端 pending timeout、Web API、stream contract、cursor、store shape 或宿主入口。
