## 1. 后端：分享服务迁移到 listRuns 批量查询

- [x] 1.1 在 `packages/agent-session/src/services/conversation-share-service.ts` 的 `createShare` 中，在 `resolveShareUnit` 循环前调用一次 `this.deps.runStore.listRuns({ tenantId: scope.tenantId, subjectId: scope.subjectId, agentId: scope.agentId, runIds: [...runIds], offset: 0, limit: runIds.length })`，构建 `runById = new Map(page.items.map((r) => [r.runId, r]))`
  验证：`npm run build` 通过
  来源：spec「分享 run 解析使用批量查询」、design 修改方案 1

- [x] 1.2 在 `loadSharedConversation` 中对去重后的 `shareRecord.runIds` 做同样的单次 `listRuns` 批量查询并构建 `runById` Map
  验证：`npm run build` 通过
  来源：spec「分享 run 解析使用批量查询」、design 修改方案 1

- [x] 1.3 修改 `resolveShareUnit` 签名：新增参数 `runById: ReadonlyMap<RequestRunId, RequestRunRecord>`，移除方法内 `this.deps.runStore.loadRun(...)` 调用，改为 `const run = runById.get(selectedRunId)`；其余 fork 回退分支、scope/session 校验、attempt 精度逻辑保持不变
  验证：`npm run build` 通过；既有分享测试不退化
  来源：spec「分享 run 解析使用批量查询」、design 修改方案 2-3

## 2. 前端：分享勾选 100 上限

- [x] 2.1 在 `frontend/agent-web/src/constants/inputLimits.ts` 新增常量 `SHARE_RUN_IDS_MAX_ITEMS = 100`（与后端 `WEB_SHARE_RUN_IDS_MAX_ITEMS` 同值，与 `LONG_TEXT_THRESHOLD` 同文件，不跨包 import）
  验证：`npm run build`（in `frontend/agent-web`）通过
  来源：spec「Frontend share interaction behavior」勾选上限、design 修改方案 1

- [x] 2.2 在 `frontend/agent-web/src/features/chat/presentation/shareSelection.ts` 提取纯函数 `toggleShareSelection(prev, runId, maxItems)`，返回 `{ next, rejected }`：已勾选时取消；未勾选且 `prev.size >= maxItems` 时 `rejected=true` 且 `next=prev`，否则新增
  验证：纯函数单元测试通过（见 4.1）
  来源：spec「Selection rejects additions beyond max items」、design 修改方案 2

- [x] 2.3 在同文件提取纯函数 `selectAllShareable(selectable, maxItems)`，返回 `{ next, truncated }`：`selectable.size > maxItems` 时取前 `maxItems` 个并 `truncated=true`，否则全选 `truncated=false`
  验证：纯函数单元测试通过（见 4.2）
  来源：spec「Select all truncates to max items」「Select all within limit selects all」、design 修改方案 2

- [x] 2.4 修改 `ChatPage.handleToggleShareSelection` / `handleToggleSelectAll` 调用上述纯函数，根据 `rejected` / `truncated` 标志给出 `message.warning` 提示
  验证：`npm run build`（in `frontend/agent-web`）通过
  来源：design 修改方案 3

- [x] 2.5 在 `ShareModeBar` 选中计数展示中体现上限（如 `已选 N/100` 或达到上限时的视觉反馈），确保用户在勾选阶段即感知上限
  验证：`tests/share-selection-mode.test.tsx` 新增计数展示断言
  来源：spec「Frontend share interaction behavior」勾选上限、design 修改方案 4

## 3. 后端测试

- [x] 3.1 在 `packages/agent-session/tests/conversation-share.test.ts` 新增断言：`createShare` 对多个 `runIds` 只调用一次 `listRuns`，不逐条调用 `loadRun`（可通过 spy/wrapper 包装 `gateway.requestRuns` 断言 `loadRun` 调用次数为 0，`listRuns` 调用次数为 1）
  验证：`npm test -w @nextagent/agent-session -- conversation-share.test.ts` 新增断言通过
  来源：spec「创建分享单次批量解析」、AGENTS.md 负例验证要求

- [x] 3.2 同样新增 `loadSharedConversation` 批量解析断言：只调用一次 `listRuns`，不逐条调用 `loadRun`
  验证：`npm test -w @nextagent/agent-session -- conversation-share.test.ts` 新增断言通过
  来源：spec「查看分享单次批量解析」

- [x] 3.3 既有 fork copied run anchor 回退测试继续通过（验证 `listRuns` 不含 fork runId 时回退分支等价）
  验证：`npm test -w @nextagent/agent-session -- conversation-share.test.ts` 既有 fork 测试通过
  来源：spec「fork copied run anchor 回退保持不变」

- [x] 3.4 既有跨 scope / 跨 session 分享测试继续通过（验证 `listRuns` scope 过滤 + resolve session 校验等价）
  验证：`npm test -w @nextagent/agent-session -- conversation-share.test.ts` 既有 scope 测试通过
  来源：spec「跨 scope runId 不可见」「跨 session run 被拒绝」

## 4. 前端测试

- [x] 4.1 为 `toggleShareSelection` 纯函数新增单元测试：已选 100 时拒第 101 个（`rejected=true`、`next` 不变）；取消已选仍有效；未达上限时正常新增（`rejected=false`）
  验证：`npm test`（in `frontend/agent-web`）纯函数测试通过
  来源：spec「Selection rejects additions beyond max items」、AGENTS.md 可测试性（ChatPage 闭包不可直接测，故提取纯函数）

- [x] 4.2 为 `selectAllShareable` 纯函数新增单元测试：可选项 120 时截断为 100（`truncated=true`）；可选项 50 时全选 50（`truncated=false`）；可选项 100 时全选 100（`truncated=false`）
  验证：`npm test`（in `frontend/agent-web`）纯函数测试通过
  来源：spec「Select all truncates to max items」「Select all within limit selects all」

## 5. 验证和收尾

- [x] 5.1 后端常规验证：仓库根目录运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
  验证：四条命令全部通过
  来源：AGENTS.md 验证门禁

- [x] 5.2 前端验证：在 `frontend/agent-web` 运行 `npm run build` 和 `npm test`；涉及宿主模式或浏览器用户旅程时追加 `npm run build:vite:modes` 或相关 e2e
  验证：前端 build 和 test 通过
  来源：AGENTS.md 前端验证门禁

- [x] 5.3 OpenSpec 验证：运行 `openspec validate --all --strict`
  验证：命令通过
  来源：AGENTS.md 验证门禁

- [x] 5.4 清理检查：确认本 change 未引入未使用 import、变量或 helper；`ConversationShareServiceDependencies` 中 `runStore` 仍需保留（`listRuns` 通过同一 gateway）；无分页循环或 speculative 代码
  验证：diff code review 检查点
  来源：AGENTS.md 实现质量门禁
