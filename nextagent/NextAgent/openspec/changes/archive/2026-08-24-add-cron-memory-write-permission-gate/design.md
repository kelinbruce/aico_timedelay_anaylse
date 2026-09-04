## 问题

`agent-web-auth-control` spec 的 "Write operation entries SHALL be disabled when user lacks AICOService.Write" requirement 以穷举方式列举了当前被 gating 的写操作入口。定时任务页面（`CronTaskDashboardPage`）和记忆管理页面（`MemoryManagePage`）的写操作入口未包含在该列表中，远程只读用户可以在这些页面执行写操作。本 change 将这两个页面的写操作入口纳入现有 gating 机制。

## 设计决策

### 复用现有 AuthGate 机制

定时任务和记忆管理页面的写操作入口与已 gating 的入口（TurnBlock、Sidebar、MessageInput）语义完全一致：都是远程用户下基于 `AICOServiceOperation.Write` 的 UI 禁用。因此 MUST 复用现有 `AuthGate` 组件，不引入新的权限判断机制。

### Gating 范围

**定时任务页面（`CronTaskDashboardPage.tsx`）gating 5 个写操作入口：**

1. 页头"手动创建"按钮 — `Button onClick={startCreate}`，调用 `cronTaskService.createCronTask`
2. 页头"从会话创建"按钮 — `Button onClick={createFromSession}`，调用 `cronTaskService.createCronTask`
3. 任务卡片"更多"菜单中的"编辑"按钮 — `button onClick={editTask}`，调用 `cronTaskService.updateCronTask`
4. 任务卡片"更多"菜单中的"删除"Popconfirm — `Popconfirm onConfirm={props.onDelete}`，调用 `cronTaskService.deleteCronTask`
5. 任务卡片"执行"按钮 — `button onClick={props.onExecute}`，调用 `cronTaskService.executeCronTask`

**记忆管理页面（`MemoryManagePage.tsx`）gating 11 个写操作入口：**

1. 工具栏"导入"按钮 — 调用 `memoryService.batchCreateLongTermMemory`
2. 工具栏"新建记忆"按钮 — 调用 `memoryService.patchLongTermMemory`（create）
3. 详情面板"编辑"按钮 — 调用 `memoryService.patchLongTermMemory`
4. 详情面板"置顶/取消置顶"按钮 — 调用 `memoryService.patchLongTermMemory`
5. 详情面板"发布/取消发布"按钮 — 调用 `memoryService.publishLongTermMemory` / `unpublishLongTermMemory`
6. 详情面板"归档"按钮 — 调用 `memoryService.patchLongTermMemory`
7. 详情面板"取消归档"按钮 — 调用 `memoryService.patchLongTermMemory`
8. 详情面板"删除"按钮 — 调用 `memoryService.deleteLongTermMemory`
9. 共享详情面板"复制到我的"按钮 — 调用 `memoryService.copyPublishedMemory`
10. 共享详情面板"取消发布"按钮 — 调用 `memoryService.unpublishLongTermMemory`
11. 导入预览弹窗"确认导入"按钮 — 调用 `memoryService.batchCreateLongTermMemory`

### 不 gating 的操作

- 定时任务执行记录列表加载失败后的"重试"按钮 — 重新加载执行记录列表，是读操作。
- 记忆管理页面的"导出"和"下载模板"按钮 — 导出是读后本地文件操作，下载模板是本地生成文件，均不触发后端写 API。
- 两个页面的浏览、列表切换、详情查看等只读操作。

### AuthGate 与既有 disabled 的叠加

`AuthGate` 在有权限时直接渲染 children 不修改，不影响既有 `disabled={actionLoading}` 等业务禁用条件。在无权限时，对于 antd `Button` 子元素，`AuthGate` 通过 `cloneElement` 注入 `disabled={true}`；对于原生 `<button>` 元素，`AuthGate` 通过 `pointerEvents: "none"` + 降低透明度禁用。两种方式都不会覆盖子元素既有的 `disabled` 逻辑。

任务卡片的"更多"菜单中的"编辑"和"删除"入口位于下拉菜单中。"编辑"按钮和"删除"Popconfirm 的触发按钮各自用 `AuthGate` 包裹。删除入口的 `Popconfirm` 包裹在 `AuthGate` 内部时，`pointerEvents: "none"` 会阻止 Popconfirm 的触发，这是预期行为——无权限用户不应打开删除确认弹窗。

### 导入预览弹窗确认按钮的 gating

导入预览弹窗（Modal）中的"确认导入"按钮是写操作。当用户缺少 Write 权限时，导入按钮本身已被 gating，用户无法进入导入流程。但为了防御性设计，确认导入按钮也 MUST 用 `AuthGate` 包裹，确保即使弹窗被打开也无法确认导入。

## 验证策略

| 验证内容 | 验证层级 | 覆盖方式 |
|----------|---------|---------|
| 定时任务页面 Write gating | 组件测试 | 渲染 `CronTaskDashboardPage`，分别验证有 Write 和无 Write 时 5 个写操作入口的禁用/可用状态 |
| 记忆管理页面 Write gating | 组件测试 | 渲染 `MemoryManagePage`，分别验证有 Write 和无 Write 时 11 个写操作入口的禁用/可用状态 |
| 只读操作不受 gating 影响 | 组件测试 | 验证无 Write 时列表浏览、执行记录重试、导出和下载模板仍可用 |
| local 模式全放行 | 组件测试 | 验证 local 模式下所有入口可用 |
| spec 一致性 | OpenSpec 验证 | `openspec validate --all --strict` |

## 长期基线刷新计划

- `openspec/specs/agent-web-auth-control/spec.md`：MODIFIED requirement "Write operation entries SHALL be disabled when user lacks AICOService.Write" 的 gated 列表新增 7 项（第 10-16 项），新增 6 个 scenario。
- `openspec/designs/architecture/agent-web-host-modes.md`：无需更新（AuthGate 机制不变，仅扩大覆盖范围）。
- `openspec/designs/modules/agent-web.md`：无需更新（不新增模块边界）。
- `openspec/designs/spec-to-design-map.md`：无需更新（`agent-web-auth-control` 导航项已存在）。
- ADR：无。
- Function 文档：无（不改变 Function 边界，仅扩大 gating 覆盖范围）。
- overview.md：无。