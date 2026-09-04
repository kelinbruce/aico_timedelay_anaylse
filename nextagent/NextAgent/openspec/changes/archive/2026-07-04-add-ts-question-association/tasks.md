## 1. Contract 扩展

- [x] 1.1 在 `agent-contracts/runtime` 新增 `QuestionAssociationEntryDto`（text + source）、`QuestionAssociationQuery`（OwnerScoped + agentId + keyword + locale?）、`QuestionAssociationResult`（locale + questions）
  验证：`npm run build`
- [x] 1.2 在 `FrequentQuestionPort` 新增 `listQuestionAssociations(request, signal?)` 方法签名
  验证：`npm run build`
- [x] 1.3 新增 `source` 类型导出：`"pinned" | "high-frequency" | "static"`
  验证：`npm run build`

## 2. Service 实现

- [x] 2.1 在 `createFrequentQuestionService` 中实现 `listQuestionAssociations`：全量加载三层（listPinned / listHighFrequency / loadCatalog）
  验证：`npm run build`
- [x] 2.2 实现每层 case-insensitive 子串匹配（`text.toLowerCase().includes(keyword.toLowerCase())`）
  验证：unit test
- [x] 2.3 实现 cap 级联填充：pinned=10、high-frequency=5、static=5，剩余 slot 回填
  验证：unit test
- [x] 2.4 实现 hash 去重（pinned → high-frequency → static 遍历，首次出现取 source）
  验证：unit test
- [x] 2.5 实现 top 20 截断
  验证：unit test
- [x] 2.6 safe error 降级处理（listPinned / listHighFrequency 返回 SafeError 时降级为空数组）
  验证：unit test

## 3. Web Channel 路由

- [x] 3.1 新增 `question-association-query.ts` schema：keyword（必填，minLength=1）、locale（可选）、响应 DTO
  验证：`npm run build`
- [x] 3.2 在 `routes/requests.ts` 新增 `GET /api/v1/question-association` 路由，调用 `FrequentQuestionPort.listQuestionAssociations`
  验证：`npm run build`
- [x] 3.3 keyword trim 后为空时返回 400
  验证：route test
- [x] 3.4 owner scope 和 agent scope 从 trusted channel identity 和 activeAgentId 获取，不从请求体获取
  验证：route test

## 4. 前端 Service

- [x] 4.1 新增 `questionAssociationService.ts`，调用 `GET /api/v1/question-association`
  验证：`npm run build`
- [x] 4.2 实现类型定义：`QuestionAssociationEntry`（text + source）、`QuestionAssociationResult`
  验证：`npm run build`

## 5. 前端联想面板

- [x] 5.1 在 `MessageInput` 中新增联想面板浮层（position: absolute, bottom: 100%），与斜杠面板互斥
  验证：`npm run build`
- [x] 5.2 实现触发规则：普通文本触发，`/` 开头不触发，空输入不触发
  验证：component test
- [x] 5.3 实现 debounce 300ms 后调用联想 API
  验证：component test
- [x] 5.4 实现来源标签视觉展示（pinned / high-frequency / static 三种样式）
  验证：component test
- [x] 5.5 实现键盘交互：ArrowUp/Down 导航、Enter/Tab 选中填入、Escape 关闭
  验证：component test
- [x] 5.6 实现鼠标交互：点击选中填入、hover 高亮
  验证：component test
- [x] 5.7 API 失败或空结果时静默关闭面板
  验证：component test

## 6. 测试

- [x] 6.1 service 层单元测试：三层匹配、cap 级联、去重、top 20 截断、safe error 降级
  验证：`npm test`
- [x] 6.2 route 测试：正常查询、空 keyword 400、无匹配空列表、owner/agent scope 校验
  验证：`npm test`
- [x] 6.3 前端组件测试：触发规则、debounce、键盘交互、鼠标交互、来源标签展示
  验证：`npm test`

## 7. 验证门禁

- [x] 7.1 `npm run build` 通过
- [x] 7.2 `npm test` 通过
- [x] 7.3 `npm run test:contract` 通过
- [x] 7.4 `npm run lint:architecture` 通过
- [x] 7.5 `openspec validate --all --strict` 通过
