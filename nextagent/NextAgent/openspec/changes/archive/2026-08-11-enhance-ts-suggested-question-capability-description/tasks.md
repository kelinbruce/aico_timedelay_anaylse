## 1. `FN-1.20 查看推荐问题`

- [x] 1.1 在 `agent-session` 新增 `CapabilityDescriptionProvider` 接口、`CapabilityDescriptionSourceLocator` 接口、`createLocalCapabilityDescriptionProvider` 和 `createRemoteCapabilityDescriptionProvider` 工厂函数；LOCAL 模式 load-once 缓存，REMOTE 模式 statSync fingerprint 热重载；文件路径 `agents/{agentId}/resource/capabilityDescription.md`；返回 `string | undefined`；接收可选 `AbortSignal`；加载失败返回 `undefined` 不抛异常。
  来源：`Capability Description Provider` + design `Provider 设计`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-session/tests/capability-description-provider.test.ts`，11 tests 全部通过，覆盖文件存在返回原文、不存在返回 undefined、LOCAL 不检测变化、REMOTE 热替换后重新加载、AbortSignal 已取消返回 undefined、source locator 失败返回 undefined。

- [x] 1.2 修改 `SuggestedQuestionServiceDependencies` 增加可选 `capabilityDescriptionProvider` 字段；在 `generate()` 中调用 `provider?.get(signal)` 解析 `capability_description`；修改 `renderRecommendationContext` 增加产品能力范围段（仅非空时包含），段顺序为 query → final_answer → capability_description → skill；system prompt 增加产品能力范围选择规则；`escapeTemplateVariable` 转义与现有变量一致。
  来源：`Prompt Variable Resolution` + `Capability Description Resolution` + design `Prompt 变更`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/suggested-question-service.test.ts`，48 tests 全部通过（44 既有 + 4 新增），覆盖 capability_description 非空时包含段并验证段顺序、空时省略段、未注入 Provider 时行为不变、`{` `}` 转义。

- [x] 1.3 在 `agent-app/src/composition/session-services-composition.ts` 中根据 `systemConfig.deployment.mode` 创建 LOCAL 或 REMOTE `CapabilityDescriptionProvider` 并注入 `createSuggestedQuestionService`；source locator 复用现有 `AgentPackageRootLocator`。
  来源：design `注入链路`
  验证：`npm run build` 全仓 TypeScript build 通过（仅有 agent-model 的 pre-existing `@ai-sdk/openai-compatible` 错误）；`npm run lint:architecture` 通过（1253 modules, 5844 dependencies, 279 architecture tests）。

## 2. Change 整体验证

- [x] 2.1 运行 `npx openspec validate enhance-ts-suggested-question-capability-description --strict` 确认 delta 一致。
  来源：proposal `影响范围` + design `验证策略`
  验证：strict validation 通过。`openspec validate --all --strict` 也通过（唯一失败为无关的 `fix-agent-web-live-run-identity-recovery` no-tasks change）。

- [x] 2.2 运行受影响 package 的 TypeScript build 和 vitest。
  来源：design `验证策略`
  验证：`npm run build` 通过；`npx vitest run --config vitest.config.release.ts packages/agent-session/tests/capability-description-provider.test.ts packages/agent-app/tests/suggested-question-service.test.ts` 59 tests 全部通过。

- [x] 2.3 运行 `npm run lint:architecture` 确认无架构边界违规。
  来源：design `验证策略`
  验证：`npm run lint:architecture` 通过（no dependency violations, 279 architecture tests passed）。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的"长期基线刷新计划"同步 stable spec、Function 和 `agent-session` module 文档；其他长期基线类别保持不变。
