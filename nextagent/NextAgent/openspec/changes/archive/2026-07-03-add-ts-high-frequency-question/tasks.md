## 1. Contracts 与 Gateway

- [x] 1.1 在 `agent-contracts/src/runtime/` 中新增 `FrequentQuestionPort`、`FrequentQuestionRequest`、`FrequentQuestionResult`、`FrequentQuestionEntryDto` 类型
  验证：`npm run build` 通过；新类型导出
  来源：spec frequent-question-api "FrequentQuestionPort"、"高频问题查询响应 DTO"

- [x] 1.2 在 `agent-contracts/src/gateway/` 中新增 `UserQuestionActivityRecord`、`UserQuestionActivityStoreGateway` 及查询/写入 port 类型
  验证：`npm run build` 通过
  来源：spec user-question-activity "UserQuestionActivityStoreGateway"

## 2. 配置项

- [x] 2.1 在 `default-system.yaml` 中新增 `nextAgent.highFrequencyQuestion.pinLimit`（默认 100）和 `nextAgent.highFrequencyQuestion.frequencyThreshold`（默认 8）配置项，在 system config 类型中添加对应解析
  验证：单元测试覆盖默认值和自定义值
  来源：spec frequent-question-api "高频问题配置项"

## 3. DB Store 实现

- [x] 3.1 在 `agent-platform-gateway-local/src/db/sqlite-gateway-stores.ts` 中新增 `user_question_activity` 表 DDL（含 `pinned_at` 列）、索引和 store 实现（upsertActivity、pinQuestion 含上限淘汰、listPinned、listHighFrequency）
  验证：contract 测试覆盖 CRUD、scope 隔离、frequency 增长、pin/unpin、上限淘汰、先进先出
  来源：spec user-question-activity "user_question_activity 表结构"、"问题 Hash 标识"、"is_pinned 通过 Pin API 设置"、"Pin 数量上限与先进先出淘汰"

- [x] 3.2 Negative: 验证空文本不记录到 user_question_activity
  验证：contract 测试断言空字符串和纯空白文本不触发 upsert
  来源：spec user-question-activity "ask_frequency 增长时机" Scenario "空文本不记录"

- [x] 3.3 Negative: 验证 upsertActivity 不修改 is_pinned/pinned_at
  验证：contract 测试先 pin 问题，再 submit 相同问题，断言 is_pinned/pinned_at 不变
  来源：spec user-question-activity "UserQuestionActivityStoreGateway" Scenario "upsert 已有问题"

## 4. submit/edit 路径 frequency 增长

- [x] 4.1 在 `create-app.ts` 的 submit 处理链中，请求 accept 后异步触发 upsertActivity（fire-and-forget）
  验证：contract 测试断言 submit 后 frequency 增长、失败不阻断 submit
  来源：spec user-question-activity "ask_frequency 增长时机" Scenario "submit 时频率增长"

- [x] 4.2 在 edit 路径中，新问题 frequency +1，旧问题频率保留
  验证：contract 测试断言 edit 后新问题 +1、旧问题不变
  来源：spec user-question-activity "ask_frequency 增长时机" Scenario "edit 时新问题频率增长"

- [x] 4.3 Negative: 验证 cancel 和 retry 不增长 frequency
  验证：contract 测试断言 cancel/retry 后 frequency 不变
  来源：spec user-question-activity "ask_frequency 增长时机" Scenario "cancel 时频率保留"、"retry 时频率不增长"

## 5. Pin 逻辑实现

- [x] 5.1 实现 pinQuestion 逻辑：幂等 pin、上限淘汰、pin 携带分类信息
  验证：contract 测试覆盖首次 pin、重复 pin 幂等不更新 pinned_at、pin 携带分类、上限淘汰先进先出
  来源：spec user-question-activity "is_pinned 通过 Pin API 设置"、"Pin 数量上限与先进先出淘汰"

## 6. Port 实现

- [x] 6.1 在 `agent-app/src/composition/` 中实现 `FrequentQuestionService`，实现 `FrequentQuestionPort`。合并排序 5 层来源，按 question_hash 去重，pinned/high-frequency 不按 locale 过滤
  验证：单元测试覆盖 5 层排序、去重、空列表、locale 过滤规则
  来源：spec frequent-question-api "高频问题合并排序规则"

- [x] 6.2 在 `agent-app/src/composition/create-app.ts` 中组装 `FrequentQuestionService`，注入 `CategoryQuestionResourceDiscovery` 和 `UserQuestionActivityStoreGateway`
  验证：`npm run build` 通过；port 注入到 Web channel
  来源：design D5

## 7. Web API 路由

- [x] 7.1 在 `agent-channel-web/src/schemas/` 中新增 `frequent-question-query.ts` 和 `user-question-pin.ts` TypeBox schema
  验证：`npm run build` 通过
  来源：spec frequent-question-api "高频问题查询响应 DTO"、"Pin API 端点"

- [x] 7.2 在 `agent-channel-web/src/routes/requests.ts` 中新增 `GET /api/v1/frequent-questions` 和 `POST /api/v1/user-questions/pin` 路由。pin 路由 MUST 使用 AuthGate 校验写权限
  验证：contract 测试覆盖正常响应、scope 校验、未认证 401、无写权限 403
  来源：spec frequent-question-api "高频问题查询 API 端点"、"Pin API 端点"

- [x] 7.3 Negative: 验证 API 响应不暴露 hash/frequency/is_pinned/pinned_at
  验证：contract 测试断言响应 JSON 中无内部字段
  来源：spec frequent-question-api "高频问题查询响应 DTO"

- [x] 7.4 Negative: 验证不存在 unpin API（DELETE /api/v1/user-questions/pin 返回 404）
  验证：contract 测试发送 DELETE 请求，断言 404
  来源：spec frequent-question-api "Pin API 端点"

- [x] 7.5 在 `WebChannelDependencies` 中新增 `frequentQuestions?: FrequentQuestionPort` 和 `userQuestionActivity?: UserQuestionActivityStoreGateway`
  验证：`npm run build` 通过
  来源：design D5、D6

## 8. 前端 GuideArea 容器

- [x] 8.1 创建 `frontend/agent-web/src/features/guide/components/GuideArea.tsx`，参数化容器，默认渲染 HighFrequencyQuestions
  验证：前端组件测试验证默认渲染、参数切换
  来源：spec high-frequency-question-ui "GuideArea 参数化容器"

- [x] 8.2 更新 `WelcomeState.tsx`，将 `HighFrequencyQuestions` 替换为 `GuideArea`
  验证：前端组件测试验证 GuideArea 渲染
  来源：spec high-frequency-question-ui "GuideArea 参数化容器"

## 9. 前端 HighFrequencyQuestions 动态数据

- [x] 9.1 创建 `frontend/agent-web/src/services/frequentQuestionService.ts`，调用 `GET /api/v1/frequent-questions`
  验证：前端编译通过
  来源：spec high-frequency-question-ui "HighFrequencyQuestions 动态数据获取"

- [x] 9.2 更新 `HighFrequencyQuestions.tsx`，改为调用 API 获取动态问题列表，空列表或失败时 fallback 到 i18n 硬编码默认问题，最多展示 3 行截断
  验证：前端组件测试验证 API 返回非空、空列表 fallback、API 失败 fallback、3 行截断
  来源：spec high-frequency-question-ui "HighFrequencyQuestions 动态数据获取"

## 10. 前端「添加到常问」图标

- [x] 10.1 创建 `frontend/agent-web/src/services/userQuestionService.ts`，调用 pin API
  验证：前端编译通过
  来源：spec high-frequency-question-ui "用户消息「添加到常问」图标"

- [x] 10.2 在 `TurnBlock.tsx` 的 BubbleActions 中，用户消息复制和编辑图标之间新增「添加到常问」图标（FolderAddOutlined），被 AuthGate（Write）包裹，点击后调用 pin API 并 toast 提示"已添加至常用问题"
  验证：前端组件测试验证图标渲染、点击调用 API、toast 提示、AuthGate 权限控制
  来源：spec high-frequency-question-ui "用户消息「添加到常问」图标"

- [x] 10.3 Negative: 验证 assistant 消息不显示「添加到常问」图标
  验证：前端组件测试断言 assistant BubbleActions 无该图标
  来源：spec high-frequency-question-ui "用户消息「添加到常问」图标" Scenario "仅用户消息显示"

- [x] 10.4 验证图标始终为 FolderAddOutlined，点击后不切换图标状态
  验证：前端组件测试点击后断言图标仍为 FolderAddOutlined
  来源：spec high-frequency-question-ui "用户消息「添加到常问」图标"

- [x] 10.5 验证无写权限时不渲染图标
  验证：前端组件测试模拟无写权限，断言图标不渲染
  来源：spec high-frequency-question-ui "用户消息「添加到常问」图标" Scenario "无写权限时不显示"

## 11. 集成验证

- [x] 11.1 运行 `npm run build` 确认全量编译通过
  验证：`npm run build` exit code 0
  来源：proposal 影响范围

- [x] 11.2 运行 `npm test` 确认所有测试通过
  验证：`npm test` exit code 0
  来源：所有 spec requirements

- [x] 11.3 运行 `openspec validate --all --strict` 确认 OpenSpec 校验通过
  验证：`openspec validate --all --strict` exit code 0
  来源：AGENTS.md 验证门禁

- [x] 11.4 运行 `npm run lint:architecture` 确认架构规则通过
  验证：`npm run lint:architecture` exit code 0
  来源：AGENTS.md 验证门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 同步 `openspec/specs/user-question-activity/spec.md`、`openspec/specs/frequent-question-api/spec.md`、`openspec/specs/high-frequency-question-ui/spec.md`
- 修改 `openspec/specs/agent-web-high-frequency-questions/spec.md`
- 更新 `openspec/overview.md`、`openspec/designs/modules/agent-platform-gateway-local.md`、`openspec/designs/modules/agent-app.md`、`openspec/designs/modules/agent-channel-web.md`、`openspec/designs/spec-to-design-map.md`
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义
