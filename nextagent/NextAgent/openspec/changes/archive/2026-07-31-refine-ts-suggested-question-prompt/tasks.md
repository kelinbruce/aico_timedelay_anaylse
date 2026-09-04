## 1. Prompt 契约

- [x] 1.1 增加模型请求测试，覆盖非空 user message、真实上下文字段和 system/user 职责分离。
  验证：focused Vitest 在实现前失败、实现后通过。
  来源：Requirement: Prompt Variable Resolution。
- [x] 1.2 增加 Prompt 负例测试，断言不再声明未提供的完整会话、高频追问、用户特征或知识出处，并在上下文不足时要求生成澄清问题。
  验证：focused Vitest。
  来源：Requirement: Prompt Variable Resolution。

## 2. 最小实现

- [x] 2.1 重写推荐 system prompt，并将 query、final answer 和可选 Skill 上下文组装到非空 user message。
  验证：focused Vitest；既有解析和 service tests 继续通过。
  来源：Requirement: Prompt Variable Resolution；design 决策 1-5。
- [x] 2.2 修复 suggested-questions route 在同一 request 存在多个 run 时选择旧 runId 的问题。
  验证：route test 构造 superseded run 与 completed run，断言 service 收到最新 runId。
  来源：Requirement: REST API Endpoint；design 决策 7。

## 3. 一致性验证

- [x] 3.1 运行 suggested-question focused tests。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/suggested-question-service.test.ts packages/agent-channel-web/tests/suggested-questions-routes.test.ts`。
- [x] 3.2 运行 OpenSpec strict validation并完成 `nextagent-skill-review` 语义审查。
  验证：`openspec validate --all --strict`；审查结论 PASS。
  结果：OpenSpec 1.6.0 strict validation 220/220 通过；`nextagent-skill-review` 语义审查 PASS，需群内确认：None。
