# Tasks

## 1. `FN-1.6 查询会话列表`

- [x] 1.1 为后端会话搜索建立 200/201 边界行为测试：`q` 为 200 个 Unicode code point 时调用 runtime session facade，`q` 为 201 个 code point 时返回 HTTP 400 + `REQUEST_VALIDATION_FAILED` 且不调用 runtime。
  来源：`FN-1.6 查询会话列表` + `搜索查询保持 scope 隔离和安全校验` + `非法查询参数失败关闭`
  验证：实施前 `npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/session-list-search-route.test.ts` 新增 case 失败（200 个 `q` 得到 400）；实施后同一命令通过，8/8 tests passed。

- [x] 1.2 为前端会话搜索建立 200/201 边界行为和提示文案测试：`keywordState()` 对 200 判定合法、对 201 判定非法；zh-CN/en-US 提示均说明最多 200 个字符。
  来源：`FN-1.6 查询会话列表` + `前端会话列表复用原展示并提供搜索和日期交互` + `超长关键词只提示不查询`
  验证：实施前 `cd frontend/agent-web && npm test -- src/features/sidebar/components/sessionHistorySearch.test.ts tests/i18n.test.ts` 中 200 合法关键词和 zh-CN 文案两个 case 失败；实施后同一命令通过，22/22 tests passed。

- [x] 1.3 为 mock server 会话搜索建立 200/201 边界行为测试：200 个字符返回 200，201 个字符返回 HTTP 400 + `q length is invalid.`
  来源：`FN-1.6 查询会话列表` + `搜索查询保持 scope 隔离和安全校验` + `非法查询参数失败关闭`
  验证：实施前 `cd frontend/agent-web-mock-server && npm test` 新增 case 失败（200 个 `q` 得到 400）；实施后同一命令通过，15/15 tests passed。

- [x] 1.4 实现会话搜索专用 200 上限：后端 schema/parser、前端校验、zh-CN/en-US 提示和 mock server 均使用 200；不修改 favorites `keyword`、时间范围、分页和 scope 行为。
  来源：`FN-1.6 查询会话列表` + `搜索查询保持 scope 隔离和安全校验`；design `FN-1.6 查询会话列表 > 修改方案`
  验证：`git diff -- packages/agent-channel-web/src/schemas/validation-limits.ts packages/agent-channel-web/src/schemas/session-dto.ts packages/agent-channel-web/src/routes/requests.ts frontend/agent-web/src/features/sidebar/components/sessionHistorySearch.ts frontend/agent-web/src/i18n/resources/zh-CN.ts frontend/agent-web/src/i18n/resources/en-US.ts frontend/agent-web-mock-server/routes/sessions.js` 仅包含会话搜索相关最小 delta；`WEB_QUERY_SEARCH_MAX_LENGTH` 仍为 50，favorites schema 未改动。

## 2. Change 整体验证

- [x] 2.1 运行针对性后端、前端、mock 验证和 TypeScript build，确认契约、行为和类型全部通过。
  来源：proposal 影响范围 + design 验证策略
  验证：`npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/session-list-search-route.test.ts` 通过（8/8）；`cd frontend/agent-web && npm test -- src/features/sidebar/components/sessionHistorySearch.test.ts tests/i18n.test.ts && npm run build` 通过（22/22，typecheck 无错误）；`cd frontend/agent-web-mock-server && npm test` 通过（15/15）；根目录 `npm run build` 通过；`npm test` 通过（173 files / 2253 tests）；`npm run test:contract` 通过（50 files / 388 tests）；`npm run lint:architecture` 通过（54 files / 323 tests）。

- [x] 2.2 运行 OpenSpec 严格校验并检查新增/修改文件使用 CRLF。
  来源：proposal scope + design 验证策略
  验证：`openspec validate --all --strict` 通过（258 items）；`git diff --check` 无输出；逐个检查本 change 触达的 16 个文本文件，全部 `isolatedLF=0`，即没有孤立 LF。