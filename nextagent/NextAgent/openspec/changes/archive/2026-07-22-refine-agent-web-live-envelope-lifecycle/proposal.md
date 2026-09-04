## Why

Agent Web 当前把单会话的 history envelope 与 live envelope 共同限制在 500 个对象内。该上限计算的是 stream 投影事件，不是消息、Run 或 DOM 数量；单个复杂 Run 就可能产生超过 500 个 envelope。现有压缩只合并部分文本 delta，剩余对象仍超限时会保留末尾 500 个事件，因此未刷新页面且持续提交消息时，较早的 live-only Turn、思考过程、能力执行详情或终态可能被截断。若对应消息尚未进入当前 `historyMessages` 窗口，整个 Turn 还可能从界面消失。

普通 terminal 已经不会触发 conversation refresh 覆盖 live details，但当前 store 没有区分执行中的 live 数据和已完成但仍需在本页面保留的高保真过程数据。所有 live envelope 仍在一个会话数组中参与追加、去重、压缩、history budget 计算和投影；长期提交会放大主线程处理，并使已完成 Turn 的展示生命周期与全局 500 上限错误耦合。

本变更需要在不新增 terminal conversation 对账、不改变后端 canonical history 的前提下，明确 active live、settled live process detail 与 committed history 的生命周期和投影优先级。目标是让当前页面已接受的完整过程详情稳定保留，同时使新 stream 更新只处理实际变化的 request/Turn。本变更不新增 DOM Turn 回收、虚拟列表、历史窗口裁剪或 DOM 数量上限；当前页面生命周期内被保留的 Turn 继续通过现有组件路径渲染。

## What Changes

- Agent Web conversation store 将执行中的 live envelope 与已完成的 settled live process envelope 按 session、root 和 attempt 分开管理，不再使用 `pendingHistory` 或等待 history 替换 live 的中间状态。
- terminal envelope 到达时，在同一次 store 状态提交中把匹配 attempt 从 active live 原子迁移为 settled live process data；普通 terminal 不请求 conversation refresh，也不产生 Turn 暂时卸载。
- committed `SessionMessage` 继续拥有用户消息、最终 assistant 内容、最终 capability result 和 `visible` 事实。history 尚无对应 root 时，settled live 可提供当前页面的临时完整 Turn；history 已有对应 root 时，settled live 只补充已接受的 thinking、能力执行、过程时间线和 live-only structured detail，不覆盖 canonical 最终内容或可见性。
- anchored 窗口仍不显示非连续的新 Turn，但 stream 接受与当前窗口显示分离：回看期间收到的 active/settled live 数据按 session 保存，返回连续 recent 窗口后才参与投影，不因 anchored 隔离而丢失过程详情。
- 500 从单会话 destructive envelope 上限收敛为 active bucket 的无损压缩触发阈值。累计快照可替换、同一精确 lane 的增量文本可合并；不可证明等价的结构事件不得截断，压缩后仍超过阈值时允许继续保留。
- edit、retry、supersede、rollback、conversation clear 和 session LRU 淘汰同时维护 active/settled 生命周期；canonical `visible=false` 始终抑制同 root 的 settled 投影，禁止旧消息重新出现。
- 已完成 Turn 的 settled bucket 和投影引用保持稳定；新增 live batch 只更新匹配的 active bucket 和实际变化的 Turn，不扫描、复制或重建全部已完成 Turn。
- 不新增新消息提示，不改变置底按钮、anchored/recent 收敛、conversation cursor、stream event vocabulary、request lifecycle、API、后端持久化或三种宿主的共享 ChatWorkspace 语义。
- 不在本变更中引入虚拟列表、DOM Turn 回收、历史消息总量限制或后端完整过程持久化。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `ts-stream-history-consistency`：补充 committed history 与 active/settled live process detail 的字段级优先级、terminal 原子迁移、refresh/recovery 合并和可见性抑制规则。
- `e2e-ui-interaction`：补充单会话超过 500 envelope、单 Run 超过 1000 个有效事件、anchored 回看期间 stream 隔离保存，以及持续 live 更新只重建实际变化 Turn 的可验证行为。
- `agent-web-background-task-control`：把后台任务监控从 conversation envelope 全量派生收敛为一次 session seed 加 `BACKGROUND_TASK_*` 事件按 `taskId` 增量投影；普通消息事件不得触发任务状态发布，retry/edit 也不得删除仍在运行的任务。

## 影响范围（Impact）

- 代码：`frontend/agent-web/src/state/conversationStore.ts`、`backgroundTaskStore.ts`、session projection、Turn 构建/overlay、stream compaction、ChatPage 的 active event consumers、后台任务 header monitor，以及 edit/retry/clear/LRU 接入点。
- API、stream schema、backend runtime、session persistence、`agent-contracts`、身份和权限边界：无变化。
- 前端宿主：local、immersive、collaborative 继续复用相同 store、projection 和 ChatWorkspace 行为。
- 测试：conversation store、stream compaction、session projection、Turn overlay、terminal、edit/retry、anchored window、render stability、长会话浏览器交互和前端 build。
- 容量：不再以丢弃可见事件的方式把单会话 envelope 强制限制为 500；同一页面的 settled 数据随已显示 Turn 数量增长。DOM 虚拟化和超长单 Turn 的结构事件压缩明确后置。
- 依赖与并行边界：本变更是 `stabilize-agent-web-popup-and-scroll` 已完成实现之后的串行 refinement。它只替换前序 change 中“conversation store shape、combined layer、单会话 500 hard cap、optimistic 快路径依赖 combined/history/live 三层一致、stream batch 回到全会话 layered rebuild”这些内部约束；前序 change 已建立的逐帧 batching、historical Turn memo、提交让出浏览器 task、anchored/recent、回看提交保护、置底按钮、220ms 动画和用户上滚取消路径继续保持。与任何同时修改 `conversationStore`、session projection、Turn overlay 或 stream consumer 的前端 change 串行实施；纯后端且不改变 stream/history contract 的工作可以并行。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-stream-history-consistency/spec.md`：归并 committed history 与 active/settled live process detail 的生命周期、投影优先级、refresh/recovery 和可见性规则。
- `openspec/specs/e2e-ui-interaction/spec.md`：归并长会话 envelope 生命周期、无损压缩、anchored 隔离保存和稳定 Turn 投影要求。
- `openspec/specs/agent-web-background-task-control/spec.md`：归并一次 session seed、`BACKGROUND_TASK_*` 按 `taskId` 增量投影、非后台事件 no-op 和 retry/edit 独立保留规则。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/agent-web-host-modes.md`：归并 ChatWorkspace 中 history、active live、settled live process detail 和 anchored 窗口的协作边界。
- `openspec/designs/modules/agent-web.md`：归并 conversation store 分层、terminal 原子迁移、投影 source precedence、清理和 LRU 行为。
- `openspec/designs/adr/<id>.md`：无；该设计是现有 Agent Web 投影 owner 内的增量状态细分，不新增跨模块技术决策。
- `openspec/designs/spec-to-design-map.md`：补充上述三个 capability 到 Agent Web 模块设计和前端验证入口的导航。

验证入口：
- `frontend/agent-web/tests/conversationStore.test.ts`
- `frontend/agent-web/tests/streamCompaction.test.ts`
- `frontend/agent-web/tests/buildSessionProjection.test.ts`
- `frontend/agent-web/tests/buildTurnBlocks.test.ts`
- `frontend/agent-web/tests/useChatSessionStream.test.tsx`
- 长会话、anchored 回看和 terminal 展示连续性的 Playwright 用户旅程
- `frontend/agent-web` build
- `openspec validate --all --strict`
