## 1. 定时任务页面 Write gating

- [x] 1.1 在 `CronTaskDashboardPage.tsx` 中引入 `AuthGate` 和 `AICOServiceOperation`，用 `AuthGate requiredOps={[AICOServiceOperation.Write]}` 包裹页头"手动创建"按钮（`Button onClick={startCreate}`）和"从会话创建"按钮（`Button onClick={createFromSession}`）。
  验证：组件测试渲染 `CronTaskDashboardPage`，断言无 Write 时两个创建按钮被禁用（`pointerEvents: none` 或 `disabled`）；有 Write 和 local 模式时按钮可用。
  来源：`FN-10.9 Cron 工具` + Requirement "Write operation entries SHALL be disabled when user lacks AICOService.Write" + Scenario "定时任务页面写操作在缺少 Write 时禁用"

- [x] 1.2 在 `CronTaskDashboardPage.tsx` 的 `CronTaskCard` 组件中，用 `AuthGate requiredOps={[AICOServiceOperation.Write]}` 包裹"更多"菜单中的"编辑"按钮（`button onClick={editTask}`）、"删除"Popconfirm 触发按钮和"执行"按钮（`button onClick={props.onExecute}`）。
  验证：组件测试渲染 `CronTaskCard`，断言无 Write 时编辑、删除和执行控件被禁用；有 Write 和 local 模式时控件可用。
  来源：`FN-10.9 Cron 工具` + Requirement "Write operation entries SHALL be disabled when user lacks AICOService.Write" + Scenario "定时任务页面写操作在缺少 Write 时禁用"

- [x] 1.3 编写测试验证定时任务页面只读操作不受 gating 影响：任务列表渲染、执行记录列表浏览、执行记录列表加载失败后的重试按钮在无 Write 时仍可用。
  验证：组件测试渲染 `CronTaskDashboardPage`，断言无 Write 时任务列表可见、执行记录重试按钮可点击。
  来源：`FN-10.9 Cron 工具` + Requirement "Write operation entries SHALL be disabled when user lacks AICOService.Write" + Scenario "定时任务页面只读操作不受权限影响"

## 2. 记忆管理页面 Write gating

- [x] 2.1 在 `MemoryManagePage.tsx` 中引入 `AuthGate` 和 `AICOServiceOperation`，用 `AuthGate requiredOps={[AICOServiceOperation.Write]}` 包裹工具栏"导入"按钮（`button onClick={() => importInputRef.current?.click()}`）和"新建记忆"按钮（`button onClick={() => { setMode('create'); ... }}`）。不包裹"导出"和"下载模板"按钮。
  验证：组件测试渲染 `MemoryManagePage`，断言无 Write 时导入和新建按钮被禁用；导出和下载模板按钮仍可用。
  来源：`FN-8.15 管理长期记忆` + Requirement "Write operation entries SHALL be disabled when user lacks AICOService.Write" + Scenario "记忆管理页面写操作在缺少 Write 时禁用"

- [x] 2.2 在 `MemoryManagePage.tsx` 的 `DetailPanel` 组件中，用 `AuthGate requiredOps={[AICOServiceOperation.Write]}` 包裹详情面板的"编辑"按钮（`button onClick={props.onEdit}`）、"置顶/取消置顶"按钮（`button onClick={() => props.onPin(record, ...)}`）、"发布/取消发布"按钮（`button onClick={() => props.onPublish(record)}`）、"归档"按钮（`button onClick={() => props.onArchive(record)}`）、"取消归档"按钮（`button onClick={() => props.onUnarchive(record)}`）和"删除"按钮（`button onClick={() => props.onDelete(record)}`）。
  验证：组件测试渲染 `DetailPanel`，断言无 Write 时 6 个控件被禁用；有 Write 和 local 模式时控件可用。
  来源：`FN-8.15 管理长期记忆` + Requirement "Write operation entries SHALL be disabled when user lacks AICOService.Write" + Scenario "记忆管理页面写操作在缺少 Write 时禁用"

- [x] 2.3 在 `MemoryManagePage.tsx` 的共享详情面板中，用 `AuthGate requiredOps={[AICOServiceOperation.Write]}` 包裹"复制到我的"按钮（`button onClick={() => onCopy(summary)}`）和"取消发布"按钮（`button onClick={() => onUnpublish(summary)}`）。
  验证：组件测试渲染共享详情面板，断言无 Write 时复制和取消发布按钮被禁用；有 Write 时可用。
  来源：`FN-8.15 管理长期记忆` + Requirement "Write operation entries SHALL be disabled when user lacks AICOService.Write" + Scenario "记忆管理页面写操作在缺少 Write 时禁用"

- [x] 2.4 在 `MemoryManagePage.tsx` 的导入预览弹窗中，用 `AuthGate requiredOps={[AICOServiceOperation.Write]}` 包裹"确认导入"按钮（`button onClick={() => void handleConfirmImport()}`）。
  验证：组件测试渲染导入预览弹窗，断言无 Write 时确认导入按钮被禁用；有 Write 时可用。
  来源：`FN-8.15 管理长期记忆` + Requirement "Write operation entries SHALL be disabled when user lacks AICOService.Write" + Scenario "记忆管理页面写操作在缺少 Write 时禁用"

- [x] 2.5 编写测试验证记忆管理页面只读操作不受 gating 影响：记忆列表浏览、详情查看、导出和下载模板在无 Write 时仍可用。
  验证：组件测试渲染 `MemoryManagePage`，断言无 Write 时列表可见、详情可查看、导出和下载模板按钮可点击。
  来源：`FN-8.15 管理长期记忆` + Requirement "Write operation entries SHALL be disabled when user lacks AICOService.Write" + Scenario "记忆管理页面只读操作不受权限影响"

## 3. 整体验证

- [x] 3.1 运行 `openspec validate --all --strict`，确认 spec delta 通过验证。
  验证：`openspec validate --all --strict` 退出码 0。
  来源：spec consistency

- [x] 3.2 在 `frontend/agent-web` 运行 `npm run build`，确认 TypeScript 编译通过。
  验证：`npm run build` 退出码 0。
  来源：build 验证

- [x] 3.3 在 `frontend/agent-web` 运行相关测试，确认新增 gating 测试通过且无回归。
  验证：`npm test -- --run` 退出码 0。
  来源：组件测试验证