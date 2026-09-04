# Tasks

## FN-1.19 收藏问题

- [x] 1.1 新增 `TurnBlock` 问题收藏组件测试：未收藏渲染 `FolderOutlined` + 收藏 tooltip、已收藏渲染高亮 `FolderFilled` + "取消收藏" tooltip、点击收藏发送 `isQuestionFavorited=true` 并提示"已添加至常用问题"、点击取消发送 `isQuestionFavorited=false` 并提示"已取消收藏"、API 失败回滚图标状态、assistant 气泡不渲染、无写权限不渲染；先运行确认新测试失败（来源：FN-1.19 + 用户消息「添加到常问」图标 + 全部 Scenarios；验证：`cd frontend/agent-web && npm test -- TurnBlock`，新增用例失败）
- [x] 1.2 实现收藏态可视化与双向切换：`BubbleActions` 新增 `questionPinned` 入参并切换 `FolderOutlined`/`FolderFilled` 与 tooltip，`TurnBlock` 传入 `currentAnnotation.isQuestionFavorited` 并将 `handlePinQuestion` 改为按当前状态取反写入（来源：design「FN-1.19 收藏问题 → 修改方案」第 1、2 条；验证：`cd frontend/agent-web && npm test -- TurnBlock`，1.1 全部用例通过）
- [x] 1.3 新增 i18n 文案 `turn.unpinQuestion` 与 `turn.unpinQuestionSuccess`（`zh-CN`/`en-US`），移除不再使用的图标 import（来源：design「FN-1.19 收藏问题 → 修改方案」第 3 条；验证：`cd frontend/agent-web && npm run build` 通过，无未使用 import 告警）
- [x] 1.4 修改 `frequent-question-routes.test.ts`：移除 pin 的 204/400 用例，改为断言 `POST /api/v1/user-questions/pin` 返回 404（端点已移除），先运行确认新断言失败（来源：FN-1.19 + Pin API 端点 REMOVED + Migration；验证：`npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/frequent-question-routes.test.ts`，新断言失败）
- [x] 1.5 移除 pin 端点实现：删除 `routes/requests.ts` 的 `user-questions/pin` 路由块与 `userQuestionPinBody` import，删除 `schemas/user-question-pin.ts`，从 `schemas/api-contract.ts` 移除 `POST /api/v1/user-questions/pin` 条目（来源：design「FN-1.19 收藏问题 → 修改方案」第 4 条；验证：`npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/frequent-question-routes.test.ts` 通过，`npm run build --workspace @nextagent/agent-channel-web` 退出码 0）

## 整体验证

- [x] 2.1 运行 `openspec validate --all --strict` 通过（来源：proposal scope；验证：本 change `openspec validate add-ts-toggle-question-favorite --strict` 退出码 0；`--all` 唯一失败项为既有 active change `fix-agent-web-live-run-identity-recovery` 缺 specs delta，与本 change 无关，不由本 change 修复）
- [x] 2.2 运行前端完整验证：`cd frontend/agent-web && npm run build && npm test` 通过（来源：AGENTS.md 验证门禁；验证：build（tsc --noEmit）退出码 0，test 153 文件 / 1722 用例全部通过）
- [x] 2.3 运行后端常规验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 通过（来源：AGENTS.md 验证门禁；验证：全部退出码 0；另运行 `vitest run --config vitest.config.channel-web.ts` 30 文件 / 191 用例全部通过）
