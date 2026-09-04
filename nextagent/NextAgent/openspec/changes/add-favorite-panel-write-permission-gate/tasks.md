## 1. 收藏列表页面 Write gating

- [x] 1.1 在 `FavoriteTurnsPanel.tsx` 中用 `AuthGate requiredOps={[AICOServiceOperation.Write]}` 包裹页头"批量取消收藏"入口按钮（`Button onClick={startBatchMode}`）；列表项取消收藏按钮的既有 `AuthGate` 包裹保持不变，不在 `batchRemoveFavorites` 回调内新增第二套权限判断。
  验证：`npm test -- tests/favorite-turns-panel.test.tsx` 23/23 通过，其中新增用例 `disables batch removal when the remote user lacks write permission` 断言无 Write 时批量按钮 `disabled === true` 且 `upsertAnnotation` 未被调用。
  来源：`FN-1.13 查看收藏列表` + Requirement "Write operation entries SHALL be disabled when user lacks AICOService.Write" + Scenario "收藏列表页面写操作在缺少 Write 时禁用"

- [x] 1.2 确认既有用例覆盖单个取消收藏 gating（`disables cancellation when the remote user lacks write permission`）与 local 模式完整取消收藏流程（`requires confirmation before removing a favorite and reports success`），不重复新增同形测试。
  验证：`npm test -- tests/favorite-turns-panel.test.tsx` 23/23 通过。
  来源：Requirement "Write operation entries SHALL be disabled when user lacks AICOService.Write" + Scenario "收藏列表页面写操作在缺少 Write 时禁用"、"收藏列表页面写操作在有 Write 时可用"

- [x] 1.3 确认既有用例覆盖收藏浏览、搜索、日期过滤、分页等只读操作在无权限时可用，不重复新增同形测试。
  验证：`npm test -- tests/favorite-turns-panel.test.tsx` 中 `shows empty and filtered-empty states without projecting session history`、`paginates complete results by session with fifteen collapsed groups per page` 等用例通过。
  来源：Requirement "Write operation entries SHALL be disabled when user lacks AICOService.Write" + Scenario "收藏列表页面只读操作不受权限影响"

## 2. 整体验证

- [x] 2.1 运行 `openspec validate --all --strict`，确认 spec delta 通过验证。
  验证：`openspec validate --all --strict` 退出码 0。
  来源：spec consistency

- [x] 2.2 在 `frontend/agent-web` 运行 `npm run build`，确认 TypeScript 编译通过。
  验证：`npm run build` 退出码 0。
  来源：build 验证

- [x] 2.3 在 `frontend/agent-web` 运行 `npm test -- tests/favorite-turns-panel.test.tsx`，确认新增 gating 测试通过且无回归。
  验证：1 file / 23 tests passed。
  来源：组件测试验证
