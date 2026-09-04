## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.18 输入联想` | 上下键回看已提交消息不产生输入联想，编辑回看文本后恢复联想 | `question-association-api`、`question-association-ui` | `FN-1.18 输入联想` |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 原子 delta | 其他行为与未触及 Requirements 处理 | 白盒落点 | stable spec 与导航影响 |
|---|---|---|---|---|---|
| `question-association-ui` / `联想面板触发规则` | `FN-1.18 输入联想` / `question-association-api` | 来源 `REMOVED` + 目标 `ADDED` | 完整触发行为迁入主规格并增加历史回看边界；保留单次粘贴不查询和输入框失焦后迟到结果不打开面板的既有行为；来源中的数据获取、视觉展示、键盘交互、鼠标交互和面板样式 Requirements 原位保留 | `FN-1.18 输入联想` 的“修改方案” | `question-association-ui` 仍有未触及 Requirements，不退役；spec-to-design-map 为两个 specs 补充 `agent-web` 长期模块导航 |

并行 active change `migrate-question-pin-to-annotation` 也修改目标 `question-association-api`，但仅触及来源标签、三层加载、cap、去重和响应类型 Requirements，与本 change 新增的“联想面板触发规则”operation 不重叠。两个 change 可按 Requirement 合并键独立实施；先归档的一方必须保留另一方仍 active 的 delta，后归档的一方须基于最新 stable spec 重新执行 strict validation。当前没有其他 active change 修改来源 `question-association-ui` 的同名 Requirement。

## `FN-1.18 输入联想`

### 目标与规范依据

本设计满足 proposal 中“历史回看不产生联想、进入历史时取消待处理查询、实际编辑后恢复联想”的黑盒目标，同时保留单次粘贴不查询、输入框失焦后迟到结果不打开面板、三种宿主共享输入框以及现有斜杠命令和联想面板键盘优先级。

#### 本 Function 的目标 Requirements

canonical spec：`question-association-api`

- `ADDED`：`联想面板触发规则`

实现必须以现有历史导航状态作为唯一的输入来源判定，不新增公共状态、配置或 contract。

### 当前实现

- `frontend/agent-web/src/features/composer/components/MessageInput.tsx` 同时拥有消息文本、`historyIndex`、历史快照和问题联想的 debounce、`AbortController` 与面板本地状态；这是 `agent-web` 浏览器交互 owner 范围内的 view state。
- `handleSubmittedHistoryNavigation()` 在普通模式下处理 `ArrowUp` / `ArrowDown`，通过 `applyHistoryMessage()` 将快照文本写入 `message`；用户实际修改 textarea 时，`handleTextChange()` 会调用 `resetHistoryNavigation()`。
- 问题联想 `useEffect` 仅依赖 `message` 和 locale。任意非空且非斜杠的 `message` 变化都会在 300ms 后调用 `queryQuestionAssociations()`，因此历史回填与主动编辑目前不可区分。
- debounce timer 和在途 `AbortController` 已由组件持有，但只有下一次 debounce 真正发起查询或组件卸载时才会中止在途请求；历史导航不会同步取消它们。
- 现有粘贴路径使用一次性 skip 状态阻止粘贴文本触发联想；查询结果写入面板前还会校验 textarea 焦点。这两个既有边界与历史导航状态独立，本 change 不修改。
- 键盘处理顺序已经固定为斜杠命令面板、问题联想面板、历史导航、提交。三种宿主均消费共享 Composer，不存在宿主专属输入联想实现。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 历史回填不发送联想查询 | 历史回填会更新 `message`，现有效果把它当作普通文本变化 | 联想调度缺少 `historyIndex` guard |
| 进入历史回看时取消待处理查询 | timer 和 controller 已存在，但历史导航不触发清理 | 缺少可由历史导航同步调用的取消入口 |
| 已取消查询的迟到结果不打开面板 | promise 只在对应 `AbortSignal` 已中止时忽略结果 | 历史导航必须在回填文本前中止当前 controller |
| 编辑回看文本后恢复联想 | `handleTextChange()` 已重置历史导航并写入新文本 | 需保留该路径，并验证 guard 不会形成一次性或粘滞抑制 |
| 保持面板优先级和多宿主一致性 | 键盘优先级与共享组件已存在 | 修改不得搬移键盘分派或增加宿主分支 |

### 修改方案

保留现有 effect-based 300ms debounce 和 `queryQuestionAssociations()` service 调用，在 `MessageInput` 内完成最小边界修复：

1. 增加一个组件内取消函数，统一清除 `assocDebounceRef` 并中止、清空 `assocAbortRef`；再由关闭联想面板的函数复用该取消动作并重置结果、高亮与键盘导航状态。该函数只操作 `agent-web` 本地 view state，不引入新 owner。
2. `applyHistoryMessage()` 在写入历史文本前同步关闭联想面板并取消待处理查询；`ArrowDown` 越过最新历史、恢复进入历史前草稿时执行同样清理。
3. 问题联想 effect 将 `historyIndex !== null` 作为显式 guard。处于历史回看时直接保持关闭并返回，不创建 timer；即使历史中相邻两条消息文本相同，也不会依赖一次性的 skip 标记。
4. 保留 `handleTextChange()` 先调用 `resetHistoryNavigation()` 的现有行为。用户实际编辑回看文本后，批量状态更新产生 `historyIndex === null` 和新 `message`，effect 重新进入既有普通输入查询路径。
5. 不移动 `handleKeyDown()` 中斜杠命令、联想面板和历史导航的优先级，不改变粘贴文本 skip、查询结果焦点校验、`questionAssociationService`、API schema、后端 route 或任何宿主入口。

| 消息变化来源 | `historyIndex` 目标值 | 联想调度结果 |
|---|---:|---|
| `ArrowUp` / `ArrowDown` 回填已提交消息 | 历史数组索引 | 同步取消待处理查询；不创建新查询 |
| `ArrowDown` 越过最新历史并恢复草稿 | `null` | 关闭并取消；随后由草稿内容适用既有空文本或普通输入规则 |
| 用户实际编辑回看文本 | `null` | 按既有 300ms debounce 查询 |
| 用户单次粘贴文本且未继续编辑 | `null` | 沿用既有粘贴 skip；不创建联想查询 |
| 查询结果返回前输入框失焦 | `null` | 沿用既有焦点校验；结果不打开联想面板 |
| 联想面板或斜杠命令面板已取得键盘优先级 | 不变 | 保持既有面板行为，不进入历史导航 |

#### 备选方案（Alternatives Considered）

- 仅设置一次性 `assocSkipQueryRef`：改动较小，但当相邻历史文本相同、React 未产生预期 effect，或一个标记需要跨多次历史导航消费时，可能遗留粘滞抑制并误伤后续真实编辑，因此不采用。
- 把全部联想调度从 effect 搬到 textarea `onChange`：能天然区分部分程序化写入，但会重写粘贴、联想选中、初始输入 hydration 等既有路径，扩大回归面，因此不采用。
- 新增独立的输入来源枚举：可以表达更多来源，但当前 `historyIndex` 已完整表示历史回看生命周期；新增平行状态会制造同步风险，因此不采用。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 性能/容量 | `联想面板触发规则` 为功能性 Requirement，无新增黑盒质量目标 | 历史回看不创建 debounce 请求，进入历史时取消待处理工作 | 断言回看期间请求计数为零，实际编辑后只恢复一次 debounce 查询 |
| 可靠性/恢复 | `联想面板触发规则` 为功能性 Requirement，无新增黑盒质量目标 | 中止在途请求，并依赖既有 `AbortSignal` guard 丢弃迟到结果 | 断言进入历史后 signal 被中止且迟到结果不显示面板 |

## 验证策略（Verification Strategy）

- component tests 直接从用户可见输入行为验证：`ArrowUp` / `ArrowDown` 回填历史后经过 debounce 窗口仍无 API 调用；进入历史时等待 debounce 的查询不发送；编辑回填文本后恢复查询；进入历史时在途请求被取消且迟到结果不显示；单次粘贴不查询，输入框失焦后的迟到结果不显示。
- 既有 Composer 组件测试继续验证历史顺序、草稿恢复、编辑模式禁用历史导航，以及斜杠命令和联想面板的键盘优先级，防止本次 guard 改变相邻行为。
- browser e2e 在真实共享 Chat workspace 中拦截问题联想路由，验证历史回看期间无网络请求、编辑后恢复请求，覆盖 React 事件批处理和实际 textarea 键盘路径。
- 前端 TypeScript build、相关 Vitest suite 与多宿主 Vite build 证明共享组件在 local、immersive、collaborative artifact 中保持可构建。
- OpenSpec strict validation 和语义审查验证 legacy Requirement 原子迁移、Function/spec 唯一归属及无 `agent-contracts` 或后端契约漂移。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/question-association-api/spec.md`：增加 Function 元数据并合入迁移后的“联想面板触发规则”。
- `openspec/specs/question-association-ui/spec.md`：移除已迁移的“联想面板触发规则”，保留其他 Requirements 和该 spec。
- `openspec/designs/functions/D1-会话与流式交互/D1.4-智能输入辅助/FN-1.18-输入联想.md`：明确主规格与遗留规格，更新描述、前置条件、处理过程、结果和“触发来源”规格项。
- `openspec/designs/features/D1-会话与流式交互/D1.4-智能输入辅助/F-1.9-智能问题推荐.md`：更新输入联想的历史回看边界。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/`：无，owner 和跨模块边界不变。
- `openspec/designs/modules/agent-web.md`：补充共享 Composer 内历史导航状态与联想调度的协作机制、取消时序和三宿主复用边界。
- `openspec/designs/adr/`：无，不形成新的长期架构决策。
- `openspec/designs/spec-to-design-map.md`：为 `question-association-api` 和 `question-association-ui` 补充 `agent-web` 长期模块设计导航；两个 stable specs 均继续存在。

## 风险与取舍（Risks / Trade-offs）

- `historyIndex` 是 React state，历史导航事件内的状态提交晚于同步代码；通过在写入历史文本前先取消查询，同时让 effect 在提交后的 `historyIndex` 上再次 guard，降低批处理时序风险。
- 来源 legacy spec 仍保留其他 UI Requirements，`FN-1.18` 的 legacy 收敛不会在本 change 全部完成；本 change 只迁移实际触及的 Requirement，避免无关规格重写。
- 并行 `migrate-question-pin-to-annotation` change 修改同一 canonical spec 的其他 Requirements；通过精确且不重叠的 Requirement operation 隔离，并在归档前基于当时 stable spec 重新验证，避免后归档覆盖先归档内容。
- 浏览器环境中已发出的请求是否能在网络栈层面立即停止由 `AbortController` 实现决定；合规结果以 signal 中止、迟到结果不产生 UI 副作用为准。

## 待确认问题（Open Questions）

无。
