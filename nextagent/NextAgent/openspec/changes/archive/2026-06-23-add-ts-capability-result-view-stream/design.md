## 背景和现状（Context）

当前 change 已把执行详情从安全投影渲染、历史失败结果、完整过程入口和滚动容器稳定性纳入前端可见行为。继续验证时发现三个局部 UI 状态问题：

- 对话主滚动区已经用主题化 scrollbar 和稳定 gutter 处理，但侧边栏会话列表仍使用浏览器默认 scrollbar，深色主题下视觉不一致。
- 会话列表展开/收缩只存在于 React state。刷新后会回到默认收缩态；如果直接恢复为展开态但仍按最近会话数量请求，会出现“UI 展开但数据窗口仍只有最近 5 条”的错配。
- composer 未发送输入只存在于当前 mounted input。切换会话后同一会话的草稿不会按 session 恢复；已有 `requestStore` 仅在提交失败/冲突恢复路径用 `sessionStorage` 保存 `draft-${sessionId}`。

这些问题只涉及 `agent-web` 本地 UI 表现和局部浏览器存储，不改变 Web API、runtime lifecycle、stream envelope、gateway persistence 或 agent/channel 边界。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 会话列表滚动条与对话主滚动区使用同一主题化 scrollbar 规则，深色模式不出现浅色 gutter/track。
- 会话列表展开/收缩偏好写入 `sessionStorage`，同一浏览器 tab 刷新后恢复；恢复为展开时，mount、请求控制和 stream 恢复触发的会话列表刷新都保持展开态数据窗口。
- 普通 composer 草稿按 session 缓存在浏览器 tab 生命周期内，切换会话后返回可恢复对应草稿。
- 对 `sessionStorage` 不可用的环境降级为内存状态，不阻断页面加载、会话请求或提交。

**非目标：**

- 不把会话列表展开态同步到服务端或跨设备。
- 不把 composer 草稿长期持久化到 localStorage，也不跨浏览器重启恢复未发送输入。
- 不缓存附件文件、pending-input response、edit-mode 替换文本或命令面板内部状态。
- 不改变 session list Web API schema、conversation history API 或 runtime stream 语义。

## 设计决策（Decisions）

1. 选定共享 CSS class 承载 scrollbar 视觉。
   - 新增或复用一个主题化 scrollbar class，由对话主滚动区和侧边栏会话列表共同使用。
   - class 统一设置 `scrollbar-color`、WebKit scrollbar track/thumb 和深色 `color-scheme`，颜色只引用现有主题变量：`--color-bg-primary`、`--color-scrollbar`、`--color-scrollbar-hover`。
   - 放弃在每个滚动容器里复制 inline scrollbar 样式；原因是后续主题调整会分裂，且难以保证会话列表和对话区一致。

2. 会话列表展开态使用 sessionStorage，当前数据窗口由 session store 统一承载。
   - 存储 key：`nextagent.sidebar.sessionListExpanded`，生命周期限于当前浏览器 tab。
   - 值：`"true"` 表示展开；其他值、缺失值、读取异常都视为收缩。
   - 首次加载 session list 时，若恢复为展开，先把 `sessionStore.historyWindowLimit` 设为 `SESSION_HISTORY_PAGE_LIMIT`，再调用 `loadSessions({ limit: SESSION_HISTORY_PAGE_LIMIT })`；否则使用 `RECENT_SESSION_LIMIT`。
   - Sidebar mount 和 ChatPage mount 都可能刷新 session list；两者必须使用同一个 preference-derived limit helper，避免展开态先请求 20 条后又被默认 5 条覆盖。
   - 用户点击展开、加载更多导致进入展开态、键盘导航越过最近 5 条导致自动展开时，都写入 `"true"` 并把当前窗口提升到展开态页面大小；用户点击收缩写入 `"false"` 并把当前窗口回到最近会话页面大小。
   - `requestStore` 和 `useChatSessionStream` 仍调用无 UI 参数的 `loadSessions()`；`sessionStore` 用当前 `historyWindowLimit` 作为非 append 刷新的默认 limit，使发送、取消、retry、edit、terminal settle 和 recovery refresh 不把展开态压回最近 5 条。
   - 放弃把展开布尔态交给 `sessionStore` 持久化；原因是这是纯视图偏好，不属于 session history 数据模型。`sessionStore.historyWindowLimit` 只表示当前已选择的数据窗口，不持久化，也不暴露到 Web API。

3. composer 草稿使用 sessionStorage 的 session-scoped 缓存。
   - 普通会话草稿 key 沿用已有恢复路径：`draft-${sessionId}`。
   - 新会话页在尚未创建 session 前使用受控临时 key，例如 `draft-__new__`；创建出 session 后再按实际 session key 保存。
   - 普通模式下 `onDraftChange` 写入当前 route session 的 draft；空字符串删除 key。
   - 路由从 session A 切到 session B 时，先保存 A 的普通草稿，再读取 B 的 draft 并 hydrate composer。
   - 输入组件只在文本实际变化或被 hydrate 后发布 draft，不因为 `onDraftChange` 回调 owner 变化而重新发布当前可见文本；否则 React effect 顺序会把 session A 的旧 textarea 内容写到 session B 的 draft key。
   - 成功提交后清理对应 draft；提交失败和冲突恢复继续保留已有 `requestStore` 行为。
   - edit-mode 使用 `draftBeforeEdit` 恢复，不把正在编辑的旧请求内容写成普通 session draft；pending-input response 使用独立输入组件，不进入这个缓存。
   - 放弃 localStorage：未发送输入可能包含客户网络信息、命令片段或敏感上下文，不应长期留在磁盘。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | composer draft 和 session-list 展开态只用 `sessionStorage`，不跨浏览器重启；空 draft 删除；edit-mode/pending-input 不进入普通 draft 缓存。session-list 展开态只存布尔 UI preference。 | composer controller/storage 单元测试；code review 检查不写 localStorage draft |
| 性能/容量 | session-list 展开态刷新最多按当前窗口请求；默认展开窗口为 `SESSION_HISTORY_PAGE_LIMIT`，与现有加载更多页面大小一致；draft 每 session 存一个短文本值，不新增服务端负载。 | sidebar/session tests 验证展开态 limit；代码审查检查无轮询/批量存储 |
| 可靠性/恢复 | storage 读写异常降级为默认收缩和空 draft；不会阻断会话加载、导航或请求提交。 | storage helper 单元测试或 component tests 覆盖无/有存储值 |
| 可维护性 | scrollbar 视觉集中在共享 class；session-list preference helper 留在前端 state/local UI 边界；draft helper 留在 composer controller 边界。 | focused frontend tests；代码 review |
| 可测试性 | UI 状态可通过 sessionStorage 和 component render 测试；请求参数可通过 mocked `sessionService.listSessions` 断言。 | `sidebar.component.test.tsx`、composer controller tests |
| 审计/可追溯性 | 这些是本地 UI 状态，不产生审计事件；不改变 runtime trace 或 server logs。 | 不适用；OpenSpec 和测试记录行为 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 会话列表和对话区 scrollbar 使用同一主题化视觉，深色 track 不发白 | 2.9 | `right-pane-layout.scroll-shell.test.tsx`、`sidebar.component.test.tsx`、浏览器深色截图 |
| 展开态刷新后保持展开，并在 mount/request/stream refresh 中保持展开态数据窗口 | 2.10, 2.12 | `sidebar.component.test.tsx` 断言 sessionStorage 和 `listSessions({ limit: SESSION_HISTORY_PAGE_LIMIT })`；`chat-page.route-state.test.tsx` 断言 ChatPage mount refresh 也使用同一 limit；`sessionStore.test.ts` 断言裸 `loadSessions()` 使用当前窗口 |
| 普通 composer draft 按 session 隔离恢复，成功提交清理，不缓存 edit/pending-input，切换期间不把旧会话输入写入新会话 draft | 2.11, 2.15 | composer controller/component tests；ChatPage route-state tests；request store submit/recovery tests |
| 执行详情 summary 行与展开面板之间保持 12px 间距，动画占位与静态视觉一致 | 2.16 | `TurnBlock.test.tsx` 断言 summary wrapper margin 和 panel wrapper padding |
| storage 不可用时降级，不阻断 UI | 2.10, 2.11 | helper/component tests 或 code review 检查 try/catch |

## 文档承载决策（Documentation Ownership）

- 行为契约：归档到 `openspec/specs/local-web-ui/spec.md`，作为前端本地 UI 状态恢复和主题一致性行为。
- 模块设计：归档到 `openspec/designs/modules/frontend-agent-web.md`，说明 Sidebar、RightPaneLayout、Composer controller 对本地 UI 状态的 owner 边界。
- 架构和跨模块设计：不新增。该变更不改变 Web API、stream、runtime 或 gateway 边界。
- ADR：不新增。sessionStorage 的取舍属于模块内设计，不需要长期 ADR。
- 导航：如归档时 local-web-ui 到 frontend-agent-web 的映射变化，更新 `openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [风险] 展开态刷新后首次请求 20 条比默认 5 条更重 -> 仅在用户已明确选择展开时生效，且复用现有加载更多页面大小。
- [风险] sessionStorage draft 仍可能短期保存敏感输入 -> 不使用 localStorage；成功提交和空输入清理；仅浏览器 tab 生命周期内保存。
- [风险] edit-mode 与普通 draft 混淆 -> edit-mode 使用 `draftBeforeEdit`，不把编辑目标内容写入普通 draft key。
- [风险] 各浏览器 scrollbar 伪元素支持不一致 -> 同时使用标准 `scrollbar-color` 和 WebKit 伪元素；不依赖固定 scrollbar 宽度。

## 迁移计划（Migration Plan）

无服务端迁移。前端发布后：

1. 没有 `nextagent.sidebar.sessionListExpanded` 的用户保持默认收缩。
2. 已有 `draft-${sessionId}` 失败恢复草稿继续可用。
3. 回滚前端代码后，已写入的 sessionStorage key 会被忽略，不影响服务端数据。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/local-web-ui/spec.md`：提炼主题化 scrollbar、一致 gutter、session-list 展开态恢复、composer per-session draft 恢复的用户可见行为。
- `openspec/designs/modules/frontend-agent-web.md`：记录 `RightPaneLayout`/Sidebar/Composer controller 对本地 UI 状态的职责边界和 storage 生命周期。
- `openspec/designs/spec-to-design-map.md`：如 local-web-ui 与 frontend-agent-web 模块设计映射新增这些验证入口，则补导航。

## 待确认问题（Open Questions）

无。
