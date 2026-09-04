## 1. `FN-1.1 查看会话消息流`

- [x] 1.1 为最终答案直接接管和回看期间提交保持位置建立失败回归：组件断言 handoff marker 保留但位置动画 class 不存在；route-state 断言 recent 已退出 following 后提交不改变 `scrollTop`，并保留既有提交等待期间上滚和 anchored 覆盖。
  来源：`FN-1.1 查看会话消息流` + Requirement `Tool 轮次执行说明与 Tool 调用连续呈现` + Scenario `最终答案直接完成待定内容接管`；稳定 `e2e-ui-interaction` Requirement `User upward scrolling SHALL preserve the reading position during asynchronous layout growth` + Scenario `回看期间提交不抢占阅读位置`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/TurnBlock.test.tsx tests/chat-page.route-state.test.tsx` 的目标用例；修改实现前，新增 handoff 和 recent 非 following 用例必须分别因位置动画 class 仍存在、提交后 `scrollTop` 被置底而失败，其余相关用例保持通过。
  实际结果：实现修改前，TurnBlock 目标用例以 `expected true to be false` 失败；recent 非 following 目标用例由 `scrollTop=480` 被推进到 `984.1009258009801` 而失败。

- [x] 1.2 修正活动过程 Markdown 的缓存生命周期：同一活动条目及其独立或合并 explanation 在非 terminal 阶段使用既有 `streaming` cache policy；同一内容转为 settled 时不因 policy 单独变化强制重渲染，后续实际挂载 settled 内容时使用 `stable` policy；不增加缓存、节流器、命令式缓存入口或投影层。
  来源：稳定 `e2e-ui-interaction` Requirement `Live conversation projection SHALL preserve long-session input responsiveness`；design `FN-1.1 查看会话消息流 / 修改方案 / 1`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/components/ProcessPanel.test.ts -t "defers stable caching until settled process explanation content is mounted again"`；活动 process explanation 渲染后稳定缓存项必须为 0，同一内容转为 settled 后仍必须为 0，重新挂载 settled 内容后必须为 1。
  实际结果：修改前目标用例以 `expected 1 to be +0` 失败，证明活动中间快照进入了 stable cache；修改后目标用例通过，活动期和同内容 settled 转换后缓存均为 0，重新挂载 settled 内容后缓存为 1。

- [x] 1.3 移除最终答案在 Web stream 更新之外的前端逐字重放：删除本地可见字符 interval 和 backlog 推进，直接使用当前累计答案执行既有渐进式 Markdown 分割；保留 CSS 流光、未完成 Markdown 尾部保护、terminal、history 和 envelope 投影语义。
  来源：稳定 `e2e-ui-interaction` Requirement `Live conversation projection SHALL preserve long-session input responsiveness`；design `FN-1.1 查看会话消息流 / 修改方案 / 2`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/TurnBlock.test.tsx -t "renders each backend-batched cumulative answer without timer-driven reveal updates"`；新的累计正文必须在本次 stream 投影中完整可见，经过原 32 ms tick 窗口后 `React.Profiler` render 次数不得增加。修改前用例必须因正文仍停留在旧前缀而失败。
  实际结果：修改前目标用例因长累计正文仍停留在 `stream start` 前缀而失败；删除 32 ms interval、可见字符状态和 backlog 推进后，累计正文在当前投影中立即完整可见，推进原 32 ms 窗口后 `React.Profiler` render 次数不再增加。相关 4 个 live/terminal 用例与 88 个 stream、viewport 和 answer-content 定向测试通过。

- [x] 1.4 移除最终答案接管的横向位置动画：保留 handoff 判断、`data-process-output-handoff` 和防重新打字路径，process explanation 复用 16px 公开正文排版，删除答案区域动画 class 绑定及对应 CSS keyframes/style；普通与 reduced-motion 环境均直接使用既有答案位置。
  来源：`FN-1.1 查看会话消息流` + Requirement `Tool 轮次执行说明与 Tool 调用连续呈现` + Scenario `最终答案直接完成待定内容接管`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/TurnBlock.test.tsx src/features/chat/components/ProcessPanel.test.ts`；预期 handoff marker、正文和防重新打字断言通过，答案区域不再包含位置动画 class。
  实际结果：两个目标组件用例通过；handoff marker 与防重新打字断言保留，process explanation 断言为 16px，动画 class 不存在。全文件运行另有 4 个与本 change 差异无关的既有断言失败，分别涉及时间格式、Skill 图标和活动标题颜色，未在本 change 扩大范围修复。

- [x] 1.5 修复回看提交后的 viewport 策略：`handleSendWithPreviewTail` 只通过执行时 following guard 请求置底，移除 recent 非 following 的无条件置底分支；preview tail 刷新与 anchored 状态保持不变。
  来源：稳定 `e2e-ui-interaction` Requirement `User upward scrolling SHALL preserve the reading position during asynchronous layout growth` + Scenarios `回看期间提交不抢占阅读位置`、`提交等待期间上滚阻止迟到置底`；design `FN-1.1 查看会话消息流 / 修改方案 / 3`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/chat-page.route-state.test.tsx tests/useChatViewportController.test.tsx`；预期 recent following、recent 非 following、等待期间上滚以及 anchored 有无 `newerCursor` 的位置和 following 断言全部通过。
  实际结果：4 个定向 route-state 用例通过，覆盖 anchored 有无 `newerCursor`、recent 非 following 和等待期间上滚；`useChatViewportController.test.tsx` 全文件 21 个测试通过。真实 5173 长会话中提交前、提交后和模型完成后的 `scrollTop` 均为 `16697.599609375`，置底按钮保持可见，显式点击后才到物理底部 `17984`。

- [x] 1.6 更新并运行 process handoff 浏览器旅程：普通和 reduced-motion 环境都断言 `animation-name: none`，终态答案首帧与稳定帧的左右边界一致，正文排版、单份最终答案和 process/history 语义保持不变。
  来源：`FN-1.1 查看会话消息流` + Requirement `Tool 轮次执行说明与 Tool 调用连续呈现` + Scenarios `最终答案直接完成待定内容接管`、`Web 投影保留最终答案标识`
  验证：在 `frontend/agent-web` 运行包含 `tests/e2e/process-history-modes.spec.cjs` 的既有 Playwright gate；预期目标 journey 通过且无 handoff 位移动画。
  实际结果：`npm run test:e2e:smoke -- tests/e2e/process-history-modes.spec.cjs --project=chromium -g "hands pending output"` 通过；普通与 reduced-motion 均无动画，首帧和 220ms 稳定帧的左右边界与宽度一致。

- [x] 1.7 收窄长历史普通 live update 的派生工作：报告/分享选择模式关闭时不计算候选集合，未选择详情目标时不扫描 Turn，最新 root 未变化时不重复同步 runtime state；不改变选择模式开启后的候选、详情或 active root 结果。
  来源：稳定 `e2e-ui-interaction` Requirement `Live conversation projection SHALL preserve long-session input responsiveness`；design `FN-1.1 查看会话消息流 / 修改方案 / 5`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/chat-page.route-state.test.tsx -t "does not rescan settled selection eligibility|does not resynchronize an unchanged active root"`；100 个历史 Turn 后的普通 live update 不得重新全量调用报告/分享候选解析，latest root 不变时不得调用 `setRuntimeState`。
  实际结果：两个定向用例通过；关闭选择模式时报告/分享候选解析调用均少于 10 次，latest root 未变化的后续累计正文更新未调用 `setRuntimeState`。

- [x] 1.8 稳定编辑与重试回调：回调在动作触发时从最新 Turn 快照解析目标，不再把整个 `turnBlocks` 数组作为回调依赖；不缓存目标 Turn、不增加平行状态，也不改变编辑或重试请求参数。
  来源：稳定 `e2e-ui-interaction` Requirement `Live conversation projection SHALL preserve long-session input responsiveness`；design `FN-1.1 查看会话消息流 / 修改方案 / 6`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/chat-composer-controller.retry-guard-block.test.tsx -t "keeps edit and retry callbacks stable"`；Turn 快照替换后两个回调引用必须保持不变，旧引用触发时必须读取更新后的 Turn 正文并向既有重试 owner 传递当前目标。
  实际结果：定向用例通过；Turn 快照替换后两个回调引用保持不变，初始编辑回调读取到更新后的正文，初始重试回调继续向既有 owner 传递当前 request target。

## 2. Change 整体验证

- [x] 2.1 完成 Agent Web 构建、相关多宿主产物、严格 OpenSpec 与语义审查门禁，确认本 change 未修改 backend/channel contract、持久化、宿主差异，也未把仓库内 Agent Skill 纳入实现范围。
  来源：proposal `目标与非目标`、`影响范围` + design `验证策略`、`长期基线刷新计划`
  验证：在 `frontend/agent-web` 运行 `npm run build`、`npm run build:vite:modes` 和全部定向测试；在仓库根目录运行 `openspec validate stabilize-agent-web-live-message-presentation --strict`、`openspec validate --all --strict`、`git diff --check`，并执行 `$nextagent-skill-review`；预期全部通过且无 BLOCKER/HIGH、无 unrelated tracked diff。
  实际结果：Markdown cache lifecycle 定向回归通过；live answer 的 4 个目标组件测试以及 answer-content、stream、viewport 的 88 个定向测试通过；`ProcessPanel.test.ts` 全文件 33 项中 31 项通过，2 项为本 change 修改前已存在的 Skill 活动图标和活动标题颜色断言漂移；`TurnBlock.test.tsx` 全文件 93 项中 91 项通过，2 项为本 change 修改前已存在的时间格式断言漂移。`npm run build`、`npm run build:vite:modes`、change strict validation、247 项 `openspec validate --all --strict` 和 `git diff --check` 通过；OpenSpec 语义审查为 PASS。真实 5173 会话长流最终完整呈现 20 个二级标题、1 个表头和 10 个数据行，终态正常，浏览器连接器捕获的 warning/error 只有两条既有 React Router v7 迁移警告；定向 Profiler 回归作为不再产生 32 ms 二次 Turn render 的确定性证据。未修改 backend/channel contract、持久化或宿主差异；`agents/default-agent/skills/report-ppt` 作为独立 Skill 提交，不属于本 change 的实现或验证范围。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并长期事实，并检查稳定 spec、Function、Feature、architecture、module 和导航没有重复定义同一 handoff 或 viewport 行为。
