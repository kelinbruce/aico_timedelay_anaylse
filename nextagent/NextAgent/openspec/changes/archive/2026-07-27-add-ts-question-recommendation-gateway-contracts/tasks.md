## 1. Frozen contract confirmation

- [x] 1.1 在群内确认 `agent-contracts/gateway` 变更集合：新增 `QuestionRecommendationGateway`、两组 request/result/item、四个 runtime schema、`WorkingMemoryGatewayBindings.questionRecommendations?` 和 `ConversationAnnotationRecord.isQuestionFavorited?`；确认不得新增顶层 binding、adapter kind 或独立问题收藏 store。完成后在本 task 下记录确认日期与可核验来源；若消息链接未提供，必须明确记录确认渠道。未确认前不得执行 2.2、3.2 或 4.2。
  来源：design「确认结论（Confirmed Decisions）」、design「Canonical QuestionRecommendationGateway」、design「Conversation annotation 字段与 SQLite 映射」
  验证：无法自动化；code review 检查群内确认内容逐项覆盖上述 public contract，且结论没有未决字段命名、owner、binding 位置或持久化语义。
  确认记录：2026-07-25，用户在当前 Codex 任务中确认群内已完成确认；群消息链接未提供。

## 2. Question recommendation public contract

- [x] 2.1 新增 `tests/contract/question-recommendation-gateway-contract.test.ts`，先表达四个 runtime schema 的合法值、边界值、未知字段、非法类型、超限值和非法 success result，并增加 public type/binding 的编译期断言；实施前运行测试并确认因 contract/schema 尚不存在而失败。
  来源：Requirement「Question recommendation Working Memory binding」Scenario「Working Memory 提供问题推荐 gateway」「问题推荐 adapter 尚未配置」；Requirement「历史高频问题查询契约」Scenario「历史高频问题数量越界」「历史高频问题结果不合法」；Requirement「预置相似问题查询契约」Scenario「相似问题请求越界」「相似问题结果不合法」；Requirement「问题推荐 runtime schema」全部 Scenario；Requirement「问题推荐安全失败语义」全部 Scenario
  验证：运行 `npm run test:contract -- tests/contract/question-recommendation-gateway-contract.test.ts`；实施前预期因缺少导出而失败，记录失败证据。
  实际结果（2026-07-25）：命令退出码 1；5 个测试中 4 个在 Ajv 编译四个尚未导出的 schema 时失败，public binding/type 测试已建立并通过。

- [x] 2.2 在 `packages/agent-contracts/src/gateway/index.ts` 实现 `QuestionRecommendationGateway`、两组 canonical request/result/item、四个 `JsonObject` runtime schema 和 `WorkingMemoryGatewayBindings.questionRecommendations?`，使 public contract test 全部通过。
  来源：Requirement「Question recommendation Working Memory binding」全部 Scenario；Requirement「历史高频问题查询契约」全部 Scenario；Requirement「预置相似问题查询契约」全部 Scenario；Requirement「问题推荐 runtime schema」全部 Scenario；Requirement「问题推荐安全失败语义」全部 Scenario；design「Runtime schema 与失败边界」
  验证：运行 `npm run test:contract -- tests/contract/question-recommendation-gateway-contract.test.ts`，预期全部通过；运行 `npm run build --workspace @nextagent/agent-contracts`，预期 TypeScript build 成功。
  实际结果（2026-07-25）：定向 contract test 5/5 通过；`@nextagent/agent-contracts` build 退出码 0。

- [x] 2.3 增加 architecture negative assertions，实际断言 `GatewayBindings` 没有顶层问题推荐字段、`GatewayAdapterKind` 没有问题推荐 kind、`SqliteGatewayStoreBindings` 没有 recommendation binding，且 public contract 不包含 provider DTO 字段 `userId`、`portraitType`、`topn`、`errorCode`、`errorMsg` 或 `agentName`。
  来源：Requirement「Question recommendation Working Memory binding」全部 Scenario；design「Provider wire mapping」、design「明确保持不变的边界」
  验证：运行 `npx vitest run --config vitest.config.architecture.ts tests/architecture/question-recommendation-gateway-boundary.test.ts`，预期全部禁止项被断言不存在；运行 `npm run lint:architecture`，预期通过。
  实际结果（2026-07-25）：定向 architecture test 3/3 通过；`npm run lint:architecture` 无 dependency violation，37 个 architecture 文件共 228 个测试通过。

## 3. Conversation annotation behavior

- [x] 3.1 扩展 `packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts`，先通过 public store 写出 `isQuestionFavorited` round-trip、partial upsert 保留、answer/question favorite 共存、仅取消 answer favorite 时保留、取消最后一个问题收藏时删除、三重 scope 隔离以及纯问题收藏不进入 `listFavoriteTurns()` 的测试；实施前运行并确认至少一个目标断言失败。
  来源：Requirement「Conversation annotation persistence and scope isolation」Scenario「Cross-session annotation persistence」「Triple scope isolation」；Requirement「Sentiment and favorite independent upsert」全部 Scenario；Requirement「Annotation list and query behavior」全部 Scenario
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts -t "conversation_annotations gateway"`；实施前预期因字段未 round-trip 或空行判定错误而失败，记录失败证据。
  实际结果（2026-07-25）：命令退出码 1；新增的 scope、round-trip、partial upsert/共存断言因问题收藏尚未写入而失败，已记录红灯。

- [x] 3.2 扩展 `ConversationAnnotationRecord`、SQLite row mapper、`saveAnnotation()`、insert/update SQL 和 method return，使 `isQuestionFavorited` 按独立布尔 partial upsert 语义 round-trip，并只在三个主标注字段全部为空时删除记录。
  来源：Requirement「Conversation annotation persistence and scope isolation」全部 Scenario；Requirement「Sentiment and favorite independent upsert」全部 Scenario；design「Conversation annotation 字段与 SQLite 映射」
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts -t "conversation_annotations gateway"`，预期新增与既有 annotation tests 全部通过；运行 `npm run build --workspace @nextagent/agent-platform-gateway-local`，预期 build 成功。
  实际结果（2026-07-25）：annotation describe 20/20 通过（15 个非目标测试跳过）；`@nextagent/agent-platform-gateway-local` build 退出码 0。

- [x] 3.3 保持 `listFavoriteTurns()` 只按 `is_favorited=1` 投影 answer favorite，并让 `listSessionAnnotations()` 显式返回 `isQuestionFavorited`，完成 answer favorite 非回归验证。
  来源：Requirement「Annotation list and query behavior」Scenario「Question favorite is excluded from favorite turns」「Answer favorite remains in favorite turns」「List session annotations includes question favorite」
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts -t "conversation_annotations gateway"`，预期纯问题收藏查询为空、answer favorite 仍返回、session annotation 返回问题收藏字段。
  实际结果（2026-07-25）：annotation describe 20/20 通过；纯问题收藏未进入 `listFavoriteTurns()`，answer favorite 与 session annotation 投影断言通过。

## 4. SQLite schema compatibility

- [x] 4.1 增加既有数据库升级测试：fixture 的 `conversation_annotations` 表不包含 `question_favorite` 且至少有一条既有记录；启动 SQLite gateway 后断言补列成功、既有记录读取为 `isQuestionFavorited=false`、新值可 round-trip。实施前运行并确认因列不存在或字段缺失而失败。
  来源：design「Conversation annotation 字段与 SQLite 映射」、design「迁移与回滚（Migration / Rollback）」
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts -t "conversation_annotations gateway"`；实施前预期升级场景失败，记录失败证据。
  实际结果（2026-07-25）：命令退出码 1；旧表记录返回结果缺少 `isQuestionFavorited=false`，确认补列/row mapping 尚未实现。

- [x] 4.2 在新建表 DDL 和 `ensureColumn()` 路径加入 `question_favorite INTEGER NOT NULL DEFAULT 0 CHECK (question_favorite IN (0, 1))`，使新数据库和既有数据库使用同一字段约束且升级幂等。
  来源：design「Conversation annotation 字段与 SQLite 映射」、design「迁移与回滚（Migration / Rollback）」
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts -t "conversation_annotations gateway"`，预期新建、升级、二次启动场景全部通过；测试通过 SQLite public/diagnostic fixture 实际写入 2 并断言 CHECK 约束拒绝非法值。
  实际结果（2026-07-25）：新建、旧库补列与二次启动断言通过；直接写入 `question_favorite=2` 被 SQLite CHECK 约束拒绝。

## 5. Change completion gates

- [x] 5.1 对照 proposal、design 和两份 spec 检查每个授权 delta 均有代码与测试，且 remote HTTP adapter、app composition、Web API、frontend 和 Pin replacement 没有进入 diff。
  来源：proposal「变更范围（What Changes）」、proposal「目标与非目标（Goals / Non-Goals）」、design「明确保持不变的边界」
  验证：运行 `git diff --check`；运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/suggested-question-service.test.ts packages/agent-channel-web/tests/suggested-questions-routes.test.ts`，预期既有 Suggested Questions 行为通过；人工 code review 检查 changed files 只包含 active change、`agent-contracts`、SQLite adapter 和对应 contract/architecture/store tests，预期无越界实现。
  实际结果（2026-07-25）：使用 release 配置执行两份既有 Suggested Questions 测试，2 个文件共 43/43 通过；`git diff --check` 退出码 0；changed files 未进入 remote、app composition、Web、frontend 或 Pin 实现。

- [x] 5.2 执行受影响范围完整门禁并记录实际结果：OpenSpec strict validation、workspace build、全量 tests、contract tests 和 architecture lint。
  来源：design「验证策略（Verification Strategy）」、design「质量属性设计（Quality Attributes）」
  验证：依次运行 `openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`；预期全部退出码为 0。
  实际结果（2026-07-25）：移植到 `nextagent-bugfix-B305@32f3bd57` 后，OpenSpec 232/232、workspace build、常规测试 105 个文件 909/909、contract 35 个文件 301/301、architecture 35 个文件 218/218 均通过；SQLite annotation 20/20、推荐问题既有路径 43/43、旧库 schema 6/6、B305 对应隔离架构测试 7/7 均通过；全部命令退出码为 0。

- [x] 5.3 push 前使用 `$nextagent-code-review` 对完整 diff 做模型语义检视；P0/P1 必须修复并重检，P2 只能在记录明确 follow-up 后保留，最终结论必须是 `PASS` 或 `PASS WITH FOLLOW-UP`。
  来源：design「验证策略（Verification Strategy）」、仓库 Push 门禁
  验证：无法由固定扫描替代；review evidence 必须覆盖 Frozen core contract、Architecture boundary、Minimal kernel non-regression、Security、OpenSpec consistency、Clean Code 和验证证据，并记录最终结论。
  实际结果（2026-07-25）：B305 最终 diff 的 `nextagent-skill-review` 为 `PASS`；`nextagent-code-review` 覆盖 Frozen core contract、Architecture boundary、Minimal kernel non-regression、Security、OpenSpec consistency、Clean Code 和全部验证证据，未发现 P0-P3，最终结论为 `PASS`。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 proposal 的“归档前更新基线”归并 `question-recommendation`、`conversation-annotation` 和长期 design 导航；检查长期文档没有重复定义 canonical schema、binding owner、问题收藏字段或 SQLite 映射，并保留既有 `SuggestedQuestionPort` 规范。
