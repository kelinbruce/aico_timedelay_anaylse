## 背景与问题（Why）

Agent Web 当前存在三类同属浏览器投影稳定性的可见问题：Skill“全部”弹框在首次内容解析后改变外框高度而发生一次位移；消息内容不足或已经位于底部时，置底按钮可能因跟随状态残留而继续显示；用户通过滚动条、触摸或键盘向上阅读时，内容异步增高可能在滚动状态提交前重新触发置底，造成视口抖动。这些问题破坏对话阅读位置的可预测性，且在流式输出和动态执行详情场景下更明显。长会话还存在 live envelope 到达时的主线程放大：活动超时通过 React state 逐条刷新，随后 live projection 又重建并重渲染未变化的历史 turn，使向上滚动输入延迟，期间底部跟随仍可能继续生效。

完整回看路径还必须覆盖两类窗口：Preview 目标已加载时，用户仍处于 `recent` 但已退出自动跟随；目标未加载时，前端进入带 `newerCursor` 的 `anchored`。当前提交完成会无条件置底，anchored 也没有在用户逐页滚动到真实最新位置后收敛为 recent 的完整转换；并发的历史分页还可能在窗口被替换后迟到写入。因此回看保护不能只依赖 `conversationView.mode`，必须同时遵守跟随意图、分页连续性和当前窗口身份。

## 变更范围（What Changes）

- Skill“全部”弹框在一次打开期间冻结列表视口高度；loading、搜索结果、空结果和分页追加只能在该列表视口内切换，不得改变弹框外框位置或高度。
- 最新会话窗口将“物理是否到底”与“是否自动跟随”分别判断；置底按钮只在用户已退出跟随且物理位置不在底部时显示。
- 历史锚定窗口继续只显示现有置底按钮作为“回到最新消息”入口；存在更新分页时，历史窗口的物理底部不得被误认为会话最新位置。用户持续主动向下滚动、加载完全部更新分页并真正到达连续消息段底部后，窗口才自然切回最新消息跟随状态。
- 用户在历史锚定窗口，或在最新窗口向上回看并退出自动跟随时，提交新消息均保留当前窗口和阅读位置；提交不得自动置底或退出锚定。非连续的新消息与流式内容仍按现有连续性约束隔离，且不新增独立的新消息提示。
- 最新窗口加载、另一历史锚点加载或会话切换发生后，先前历史窗口的未完成分页结果不得再写入当前可见窗口。
- 用户真实向上滚动时同步退出底部跟随，使后续内容尺寸变化只能保留阅读锚点，不得抢占滚动位置。
- 更早与更新分页统一由有方向的用户滚动在对应边界附近触发；程序性滚动和分页布局变化不得连续触发下一页，空闲状态不再要求点击分页入口。
- 长会话的高频 live envelope 只按现有逐帧投影节奏更新可见内容；活动超时不得逐条触发页面级渲染，同一 stream batch 只构建一次当前 session 的 live 工作数组，未变化的历史 turn 必须复用投影和组件实例，旧 turn、Composer 和 footer 高度监听不因 viewport following/at-bottom 变化重复工作。普通 existing-session 提交在 optimistic 投影前让出一个浏览器 task；容量未满的单条本地 optimistic USER envelope 复用稳定历史 state，不执行通用 batch 归一化；following 内容增长复用 `ResizeObserver` 已测得的底部目标。显式置底保留现有过渡时长，但动画帧不得逐帧提交页面级物理底部状态。原始 stream frame 调试缓存改为显式开启。
- 当前 request 进入 `USER_INPUT_REQUIRED` 后，stream activity timeout 必须暂停；等待用户输入不得被识别为 stuck run。普通无活动恢复只有在 conversation 刷新成功且权威 `activeRun` 已不存在时才能本地解锁输入。
- 不修改 Skill API、conversation API、预览分页协议、滚动动画时长或宿主模式 contract。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `skill-selector-ui`：补充 Modal 在异步内容切换期间保持外框稳定的行为要求。
- `e2e-ui-interaction`：补充最新窗口底部跟随、历史锚定、置底按钮和阅读锚点稳定性要求。
- `session-conversation-preview`：将历史锚定的退出、提交保护、连续更新分页和过期分页写入约束收敛为一致行为。

## 影响范围（Impact）

- 代码：`frontend/agent-web` 的 Skill selector、`ChatPage`、Composer controller、conversation viewport controller 和 conversation store 分页/live 写入路径。
- API 与依赖：无变化。
- 测试：Skill selector component tests、viewport controller tests、conversation store tests、session projection/stream activity/render stability tests 和 route-state/browser interaction tests，补充双向滚动分页触发、防连续加载与长会话 live 更新隔离验证。
- 多宿主：local、immersive、collaborative 继续复用同一 Agent Web 对话视口行为。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/skill-selector-ui/spec.md`：归并弹框外框稳定要求。
- `openspec/specs/e2e-ui-interaction/spec.md`：归并底部跟随、历史锚定和阅读位置稳定要求。
- `openspec/specs/session-conversation-preview/spec.md`：归并历史锚定的连续分页、提交保护和退出条件。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/web-channel-api-surface.md`：无 API 变化。
- `openspec/designs/modules/agent-web.md`：补充 conversation viewport 的跟随状态、物理位置与历史锚定边界。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：补充前端定向测试入口。

验证入口：
- `frontend/agent-web/tests/SkillSelector.test.tsx`
- `frontend/agent-web/tests/useChatViewportController.test.tsx`
- `frontend/agent-web/tests/conversationStore.test.ts`
- `frontend/agent-web/tests/chat-page.route-state.test.tsx`
- `frontend/agent-web` build
- `openspec validate --all --strict`
