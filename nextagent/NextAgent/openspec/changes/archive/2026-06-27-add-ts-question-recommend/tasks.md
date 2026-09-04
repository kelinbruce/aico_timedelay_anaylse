## 1. Contract 定义

- [x] 1.1 在 `agent-contracts/src/runtime/index.ts` 新增 `SuggestedQuestionRequest`、`SuggestedQuestionResult`、`SuggestedQuestionPort` 接口定义，并从 `index.ts` 导出
  验证：`npm run build` 通过；contract test 断言 `SuggestedQuestionPort` 接口签名包含 `generate(request: SuggestedQuestionRequest, signal?: AbortSignal): Promise<SuggestedQuestionResult>`
  来源：spec SuggestedQuestionPort Contract；design D2

## 2. Port 实现与 Prompt 组装

- [x] 2.1 在 `agent-app/src/composition/` 新增 `SuggestedQuestionService`（实现 `SuggestedQuestionPort`），包含 prompt 模板常量、变量组装、skill 三路取值、model 调用和输出解析逻辑
  验证：unit test 覆盖变量组装（`{query}` 来自 USER message、`{final_answer}` 来自 terminal ASSISTANT message、`{user_features}` 为空字符串）
  来源：spec Prompt Variable Resolution；design D3/D4/D5/D6/D7

- [x] 2.2 实现 skill 两路取值逻辑：第一路从 timeline `POLICY_APPLIED` 事件中查找 `policyDomain === "TARGETED_SKILL"` 且 `outcome === "constraint-accepted"`，取 `selectedCapabilityId` → `CapabilityCatalog.resolve()`；第二路从 timeline `CAPABILITY_STARTED` 事件去重 `capabilityId` 后逐个 `CapabilityCatalog.resolve()`，过滤 `kind === "SKILL"`。recipe/workflow 路径因 `RoutingPolicyEvidence` 不含 recipeName 字段而不可实现，为 deferred 扩展点
  验证：unit test 覆盖两路场景各一个（routing 指定 skill、model-driven loop 中调用 skill）；negative test：timeline 只有 TOOL capability 时 `{skill}` 为空字符串
 来源：spec Skill Context Resolution；design D5

- [x] 2.3 实现 terminal status guard：加载 `RequestRun`，校验 `terminalStatus === "COMPLETED"`，否则返回 `{ questions: [] }` 且不发起 model invocation
  验证：unit test 覆盖 COMPLETED（继续生成）、FAILED/CANCELED/SUPERSEDED（返回空列表不调用 model）、DEGRADATION_NOTICE + COMPLETED（视为成功继续生成）
  来源：spec Terminal Status Guard

- [x] 2.4 实现 model 调用：通过 `ModelInvocationService.complete()` 调用主模型，`tools` 为空数组，`modelName`/`providerKind` 来自 agent assembly 主 model profile，`temperature: 0.7`，`maxOutputTokens: 1024`，`timeoutMs: 30_000`
  验证：unit test 断言 model request 的 `tools` 为空数组、`modelName` 匹配 assembly profile；architecture test 断言不调用 `ModelInvocationService.stream()`
  来源：spec Model Invocation for Recommendations；design D6

- [x] 2.5 实现输出解析：按空行分割、trim、过滤空段、去除序号前缀（正则 `/^\d+[\.\、\)\s]+/`）、不足 3 返回已有、超过 3 取前 3
  验证：unit test 覆盖正常 3 条、不足 3 条、超过 3 条截断、包含序号前缀去除
  来源：spec Recommendation Output Parsing；design D7

- [x] 2.6 实现 AbortSignal 处理：`signal.aborted === true` 时立即返回 `{ questions: [] }` 且不发起 model invocation
  验证：unit test：传入已 abort 的 signal，断言返回空列表且 model 未被调用
  来源：spec SuggestedQuestionPort Contract

- [x] 2.7 实现变量值转义：在字符串替换前对变量值中的 `{` 和 `}` 进行转义，防止模板注入
  验证：unit test：变量值包含 `{query}` 字面量时，替换后不产生二次替换
  来源：design D4 安全约束

- [x] 2.8 实现 model invocation 失败处理：`complete()` 返回 `safeError` 或抛异常时返回 `{ questions: [] }`
  验证：unit test：mock model 返回 safeError，断言返回空列表不抛异常
  来源：spec Terminal Status Guard 可靠性隐含约束；design 质量属性可靠性

## 3. Composition 装配

- [x] 3.1 在 `agent-app/src/composition/create-app.ts` 装配 `SuggestedQuestionService`，注入 `ModelInvocationService`、`CapabilityCatalog`、`AgentAssemblyRegistry`、`RequestRunStoreGateway`、`SessionMessageStoreGateway`、`RunTimelineEventStoreGateway`，并将 `SuggestedQuestionPort` 注入 web channel dependencies
  验证：`npm run build` 通过；architecture test 断言 `agent-channel-web` 不直接依赖 `agent-capability`、`agent-core` 或 `agent-memory`
  来源：design D1/D9；proposal 变更范围

## 4. Web API 端点

- [x] 4.1 在 `agent-channel-web` 新增 `POST /api/v1/sessions/:sessionId/requests/:requestId/suggested-questions` 路由，schema validation（路径参数 + 无请求体），通过 identity resolver 解析 owner scope，通过 `RuntimeSessionPort.requireSession()` 获取 session-bound `agentId`
  验证：route test 覆盖正常请求返回 200 + `{ questions: [...] }`
  来源：spec REST API Endpoint

- [x] 4.2 实现 scope 校验：`requireSession()` 按 owner scope（`tenantId` + `subjectId`）查询，不匹配时抛 `SESSION_NOT_FOUND`（404）；request 不存在或不属于当前 session 返回 404；`agentId` 与 session-bound `agentId` 不一致返回 404
  验证：route test 覆盖 404（session 不属于当前 owner scope）、404（request 不属于 session 或 agentId 不一致）
  来源：spec REST API Endpoint

- [x] 4.3 实现 terminal status 透传：`terminalStatus !== "COMPLETED"` 时返回 200 + `{ questions: [] }`（非错误状态）
  验证：route test 覆盖 FAILED/CANCELED/SUPERSEDED 返回 200 + 空列表
  来源：spec REST API Endpoint

- [x] 4.4 实现日志/audit 安全：端点处理过程中不将 `questions` 内容、prompt 原文、模型原始输出写入日志、metric、trace 或 audit
  验证：route test 断言日志输出中不包含 questions 内容；architecture test 断言响应 DTO 不包含 prompt 原文或 provider metadata 字段
  来源：spec REST API Endpoint 安全约束；design D9

## 5. 前端推荐组件

- [x] 5.1 在 `agent-web/src/features/suggested-questions/` 新增 `SuggestedQuestions.tsx` 和 `SuggestedQuestions.css`，实现推荐问题矩形渲染（height: 32px, flex row, gap: 4px, padding: 5px 12px, border-radius: 8px，行间距 12px，左侧对齐），位于 action buttons 下方 16px
  验证：前端 component test 断言渲染 3 个矩形、样式参数、位置在 action buttons 下方 16px
  来源：spec Frontend Recommendation Component

- [x] 5.2 实现 loading 状态：接口请求期间展示 loading，不展示空矩形
  验证：前端 component test 断言 loading 状态下渲染 loading 指示器且不渲染推荐矩形
  来源：spec Frontend Recommendation Component

- [x] 5.3 实现点击发送：点击推荐问题矩形后自动将该问题文本作为下一个请求提交（等价于输入框输入并发送）
  验证：前端 component test 断言点击后触发 submit 调用，参数为点击的问题文本
  来源：spec Frontend Recommendation Component

- [x] 5.4 实现接口失败静默：接口返回错误或 `{ questions: [] }` 时不渲染推荐组件、不报错
  验证：前端 component test 覆盖接口失败（mock reject）和空列表（mock `{ questions: [] }`）两种场景，断言不渲染推荐区域且无错误提示
  来源：spec Frontend Recommendation Component

## 6. 前端触发逻辑

- [x] 6.1 在 `ChatPage.tsx` 或消息渲染逻辑中，收到 `REQUEST_COMPLETED` stream event 后自动调用推荐接口
  验证：前端 test 断言 `REQUEST_COMPLETED` 事件后触发 `POST /api/v1/sessions/:sid/requests/:rid/suggested-questions` 调用
  来源：spec Frontend Recommendation Trigger

- [x] 6.2 实现 negative verification：收到 `REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED` 事件后不调用推荐接口
  验证：前端 test 断言这三种 terminal 事件后不触发推荐接口调用
  来源：spec Frontend Recommendation Trigger

## 7. 无缓存与不侵入 runtime 验证

- [x] 7.1 验证不缓存：对同一 `requestId` 连续调用两次 `SuggestedQuestionPort.generate()`，断言两次各独立发起 model invocation
  验证：unit test：spy model invocation，调用两次 generate，断言 model.complete 被调用两次
  来源：spec No Caching

- [x] 7.2 验证不写入 timeline、不修改 run state：architecture test 断言 `SuggestedQuestionPort` 实现不调用 `RuntimeCommandPort`、不调用 `RunTimelineEventStoreGateway` 的写方法、不调用 `RequestRunStoreGateway` 的写方法
  验证：architecture test（dependency-cruiser 或 source-level assertion）断言 `SuggestedQuestionService` 不导入 runtime command port 或 timeline write 路径
  来源：spec SuggestedQuestionPort Contract 不修改 runtime 状态约束；design D9

## 8. 集成验证与收尾

- [x] 8.1 运行全量构建和测试
  验证：`npm run build` && `npm test` && `npm run test:contract` && `npm run lint:architecture` 全部通过
  来源：AGENTS.md 验证门禁

- [x] 8.2 运行 OpenSpec 验证
  验证：`openspec validate --all --strict` 通过
  来源：AGENTS.md OpenSpec 验证命令

- [x] 8.3 push 前运行 `$nextagent-code-review` 模型语义检视
  验证：检视结论为 PASS 或 PASS WITH FOLLOW-UP，无 P0/P1 问题
  来源：AGENTS.md Push 门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 同步 `openspec/specs/question-recommendation/spec.md`：新增，承载全部行为契约。
- 更新 `openspec/overview.md`：补充基于 prompt 的下一步问题推荐能力的产品背景。
- 更新 `openspec/designs/modules/agent-channel-web.md`：补充 `suggested-questions` 路由组。
- 更新 `openspec/designs/modules/agent-app.md`：补充 `SuggestedQuestionPort` composition。
- 更新 `openspec/designs/spec-to-design-map.md`：新增 `question-recommendation` 导航条目。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
