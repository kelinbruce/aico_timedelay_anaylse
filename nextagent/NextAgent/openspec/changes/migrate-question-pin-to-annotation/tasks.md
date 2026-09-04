## 1. Runtime contract 接通 isQuestionFavorited

- [ ] 1.1 在 `packages/agent-contracts/src/runtime/index.ts` 的 `RuntimeUpsertAnnotationCommand` 新增 `isQuestionFavorited?: boolean` 字段；在 `ConversationAnnotationView` 新增 `isQuestionFavorited: boolean` 字段；在 `RuntimeConversationAnnotationPort` 新增 `listQuestionFavoriteTurns(query)` 方法签名。在 `packages/agent-contracts/src/gateway/index.ts` 的 `ConversationAnnotationStoreGateway` 新增 `listQuestionFavoriteTurns(query)` 方法签名和 `ListQuestionFavoriteTurnsQuery` 类型（复用 `ConversationFavoriteTurnSummary`）。运行 `npm run build --workspace @nextagent/agent-contracts`，预期 TypeScript build 成功。
  来源：design「1.1 runtime contract 接通」「1.3 pin 查询」
  验证：`npm run build --workspace @nextagent/agent-contracts` 退出码 0。

- [ ] 1.2 扩展 `tests/contract/` 下既有 annotation contract test，新增 `isQuestionFavorited` 字段的 round-trip、partial upsert 保留、`listQuestionFavoriteTurns` 查询返回 shape 的断言。实施前运行确认因字段未接通而失败。
  来源：design「1.1 runtime contract 接通」
  验证：实施前 `npm run test:contract` 预期红灯；实施后预期通过。

## 2. pin 迁移到 annotation（gateway + service + web）

- [ ] 2.1 在 `ConversationAnnotationService.upsertAnnotation()` 传递 `command.isQuestionFavorited` 到 record；在 `toAnnotationView()` 映射 `record.isQuestionFavorited ?? false`。实现 `listQuestionFavoriteTurns(query)` 方法，委托 gateway store，补充 `sessionTitle` 和 `sessionUpdatedAt`（与 `listFavoriteTurns` 同构）。
  来源：design「1.1 runtime contract 接通」「1.3 pin 查询」
  验证：`npm run build --workspace @nextagent/agent-session` 退出码 0；`npx vitest run packages/agent-session/tests/conversation-annotation.test.ts` 通过。

- [ ] 2.2 在 `agent-platform-gateway-local` 的 `SqliteGatewayCore` 实现 `listQuestionFavoriteTurns`，SQL 与 `listFavoriteTurns` 同构，predicate 从 `is_favorited=1` 改为 `question_favorite=1`。扩展 `sqlite-gateway-stores.test.ts` 新增 `listQuestionFavoriteTurns` 的查询、scope 隔离、JOIN messages 和空结果测试。
  来源：design「1.3 pin 查询」
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts -t "conversation_annotations gateway"` 通过。

- [ ] 2.3 修改 `agent-channel-web` 的 `upsertAnnotationBody` schema 新增 `isQuestionFavorited: Type.Optional(Type.Boolean())`；annotation response DTO 新增 `isQuestionFavorited`；`projectAnnotation` 和 `projectAnnotationListItem` 映射该字段。修改 `POST /api/v1/user-questions/pin` route body 从 `{ question }` 改为 `{ sessionId, runId }`，调用 `dependencies.annotations.upsertAnnotation({ isQuestionFavorited: true })`。
  来源：design「1.2 pin 写入 API 变更」「5.4 Web API」
  验证：`npm run build --workspace @nextagent/agent-channel-web` 退出码 0；`npx vitest run packages/agent-channel-web/tests/annotation-routes.test.ts` 通过。

## 3. QuestionRecommendationGateway local adapter

- [ ] 3.1 在 `agent-platform-gateway-local` 新增 local `QuestionRecommendationGateway` adapter：`listFrequentHistoryQuestions` 委托 `UserQuestionActivityStoreGateway.listHighFrequency`，映射 `UserQuestionActivityRecord` 为 `FrequentHistoryQuestion`；`recommendSimilarPresetQuestions` 返回空列表。新增 adapter unit test 覆盖高频映射、空结果、SafeError 传播。
  来源：design「2.2 local adapter」、spec「QuestionRecommendationGateway local adapter」
  验证：`npm run build --workspace @nextagent/agent-platform-gateway-local` 退出码 0；adapter test 通过。

- [ ] 3.2 在 local gateway provider 的 `createSelected` 中注入 local adapter 到 `WorkingMemoryGatewayBindings.questionRecommendations`。新增 composition test 验证 LOCAL 模式下 binding 为 local adapter。
  来源：design「2.4 composition 注入」
  验证：`npm run build --workspace @nextagent/agent-platform-gateway-local` 退出码 0；composition test 通过。

## 4. QuestionRecommendationGateway remote adapter

- [x] 4.1 在 `agent-platform-gateway-remote` 新增 remote `QuestionRecommendationGateway` adapter：实现两个 provider HTTP 调用（`/rest/naie/memory/v1/user/portrait` 和 `/rest/naie/memory/v2/recommendation/similar-question`），复用 frozen wire mapping。实现 request/result validation（Ajv + frozen runtime schema）、limit 截断、空数据规范化、AbortSignal 传播和 SafeError 映射。新增 adapter unit test 覆盖正常响应、空响应、截断、provider 不可用、validation 失败、abort 传播和不泄漏敏感数据。
  来源：design「2.3 remote adapter」、spec「QuestionRecommendationGateway remote adapter」
  验证：`npm run build --workspace @nextagent/agent-platform-gateway-remote` 退出码 0；`npm test --workspace @nextagent/agent-platform-gateway-remote -- question-recommendation-gateway.test.ts` 通过（1 file / 9 tests）。

- [ ] 4.2 在 remote gateway provider 的 `bindings` factory 中注入 remote adapter 到 `WorkingMemoryGatewayBindings.questionRecommendations`。新增 composition test 验证 REMOTE 模式下 binding 为 remote adapter。
  来源：design「2.4 composition 注入」
  验证：`npm run build --workspace @nextagent/agent-platform-gateway-remote` 退出码 0；composition test 通过。

## 5. frequent-question-service 重构

- [ ] 5.1 修改 `FrequentQuestionServiceDependencies`：`activityStore` 替换为 `annotationStore`（用于 pin 查询）和 `questionRecommendations`（可选 `QuestionRecommendationGateway`）。`listFrequentQuestions` 的 pin 层改调 `listQuestionFavoriteTurns`，高频层改调 `questionRecommendations.listFrequentHistoryQuestions`（binding 为空或 SafeError 时降级为空）。新增 service unit test 覆盖三层合并、去重、binding 为空降级、SafeError 降级。
  来源：design「3.1 listFrequentQuestions」、spec「高频问题合并排序规则」
  验证：`npm run build --workspace @nextagent/agent-session` 退出码 0；service test 通过。

- [ ] 5.2 修改 `listQuestionAssociations` 的分层为 pinned（`listQuestionFavoriteTurns` + 关键词匹配）→ 动态层 → static（目录关键词匹配）。动态层由 deployment mode 决定：LOCAL 模式为 high-frequency 层（`questionRecommendations.listFrequentHistoryQuestions` + 关键词匹配，source=`"high-frequency"`），REMOTE 模式为 recommended 层（`questionRecommendations.recommendSimilarPresetQuestions`，不关键词过滤，source=`"recommended"`）。`QuestionAssociationSource` 改为 `"pinned" | "high-frequency" | "recommended" | "static"`。cap 级联回填策略不变。新增 service unit test 覆盖 LOCAL（high-frequency 层有数据）和 REMOTE（recommended 层有数据）两种场景。
  来源：design「3.2 listQuestionAssociations」「3.3 source 标签」、spec「三层来源加载与排序」「cap 级联填充策略」
  验证：`npm run build --workspace @nextagent/agent-session` 退出码 0；service test 通过。

- [ ] 5.3 修改 `agent-app` composition 的 `createSessionFrequentQuestionService` 调用，注入 `annotationStore` 和 `questionRecommendations`（来自 `input.gateway`）。修改 `question-activity-tracking-command-port` 注入为 LOCAL 模式条件注入。新增 composition test 验证两种模式下的 service 依赖注入和 tracking port 注入条件。
  来源：design「2.4 composition 注入」「4. question-activity-tracking-command-port 模式条件注入」
  验证：`npm run build --workspace @nextagent/agent-app` 退出码 0；composition test 通过。

## 6. 废弃清理

- [ ] 6.1 从 `UserQuestionActivityStoreGateway` interface 移除 `pinQuestion` 和 `listPinned` 方法。从 `SqliteUserQuestionActivityStore` 和 `SqliteGatewayCore` 移除对应实现。从 `frequent-question-service` 移除对 `listPinned` 的调用。运行 `npm run build` 确认无引用残留。
  来源：design「5.1 UserQuestionActivityStoreGateway」
  验证：`npm run build` 退出码 0；`npm run lint:architecture` 通过；architecture test 断言 `pinQuestion` 和 `listPinned` 不在 interface 上。

- [ ] 6.2 从 `agent-app` config 移除 `pinLimit` 配置项（`component-config.ts`、`validation.ts`、`default-system.yaml`）。保留 `frequencyThreshold`。新增 config validation test 确认 `pinLimit` 被忽略。
  来源：design「5.3 配置项」、spec「高频问题配置项」
  验证：`npm run build --workspace @nextagent/agent-app` 退出码 0；config test 通过。

- [ ] 6.3 移除前端 `userQuestionService.pinQuestion` 函数和 `user-question-pin.ts` schema。TurnBlock pin 按钮改为调用 `annotationService.upsertAnnotation({ sessionId, runId, isQuestionFavorited: true })`。pin 状态从 annotation view 的 `isQuestionFavorited` 读取。
  来源：design「6.1 TurnBlock pin 按钮」
  验证：`npm run build --workspace @nextagent/agent-web` 退出码 0；`TurnBlock.favoriteLimit.test.tsx` 等既有测试通过；新增 pin 按钮调用 annotation API 的测试。

## 7. 前端联想 source 标签适配

- [ ] 7.1 修改前端输入联想消费方，新增 `"recommended"` source 标签处理（REMOTE 模式）。LOCAL 模式 `"high-frequency"` 标签保持不变。确认联想组件按新标签渲染视觉差异。
  来源：design「6.3 输入联想」、spec「联想结果来源标签」
  验证：`npm run build --workspace @nextagent/agent-web` 退出码 0；联想相关前端测试通过。

## 8. Architecture negative assertions

- [ ] 8.1 新增 architecture test 断言：`QuestionRecommendationGateway` 只出现在 `WorkingMemoryGatewayBindings.questionRecommendations`，不新增顶层 binding 或 adapter kind；`pinQuestion` 和 `listPinned` 不在 `UserQuestionActivityStoreGateway` 上；`frequent-question-service` 不直接依赖 `agent-platform-gateway-local` 或 `agent-platform-gateway-remote`。
  来源：design「明确保持不变的边界」、AGENTS.md 架构边界
  验证：`npm run lint:architecture` 通过；定向 architecture test 通过。

## 9. Change completion gates

- [ ] 9.1 对照 proposal、design 和五份 spec 检查每个授权 delta 均有代码与测试，且没有越界实现（不修改 `SuggestedQuestionPort`、不修改回答收藏上限、不修改 annotation 锚点）。
  来源：proposal「目标与非目标」、design「明确保持不变的边界」
  验证：`git diff --check` 退出码 0；人工 code review 检查 changed files 范围。

- [ ] 9.2 执行受影响范围完整门禁并记录实际结果：OpenSpec strict validation、workspace build、全量 tests、contract tests 和 architecture lint。
  来源：design「验证策略」、AGENTS.md 验证门禁
  验证：依次运行 `openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`；预期全部退出码为 0。前端运行 `npm run build --workspace @nextagent/agent-web` 和相关 `npm test`。

- [ ] 9.3 push 前使用 `$nextagent-code-review` 对完整 diff 做模型语义检视；P0/P1 必须修复并重检，P2 只能在记录明确 follow-up 后保留，最终结论必须是 `PASS` 或 `PASS WITH FOLLOW-UP`。
  来源：AGENTS.md Push 门禁
  验证：review evidence 覆盖 Frozen core contract、Architecture boundary、Minimal kernel non-regression、Security、OpenSpec consistency、Clean Code 和验证证据，最终结论为 `PASS` 或 `PASS WITH FOLLOW-UP`。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 proposal 的"归档前更新基线"归并 `conversation-annotation`、`question-recommendation`、`user-question-activity`、`frequent-question-api` 和 `question-association-api` 的稳定行为到长期 spec；检查长期文档没有重复定义 canonical schema、binding owner 或 SQLite 映射。
