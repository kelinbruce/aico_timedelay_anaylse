## FN-10.1 注册和执行钩子

- [ ] 1.1 在 `agent-contracts/src/runtime/index.ts` 的 `ModelResultBoundary` interface 中，在 `toolCalls` 字段之后新增 `readonly providerResponseId?: string;` optional 字段。完成后 `ModelResultBoundary` 的类型定义与 `ModelFinalResult.providerResponseId` 对齐。来源：spec `lifecycle-hook-execution` / `Stage-specific boundaries and mutations are minimal runtime contracts`。验证：`npx tsc --noEmit -p packages/agent-contracts/tsconfig.json` 编译通过。

- [ ] 1.2 在 `agent-model/src/invocation/lifecycle-hook-wrapper.ts` 的 `invokeAfterModelHook` 函数中，`createReadonlyHookView<HookBoundaryByStage['AFTER_MODEL_RESULT']>` 调用的参数对象末尾（`toolCalls` 投影之后）新增 `...(result.providerResponseId === undefined ? {} : { providerResponseId: result.providerResponseId })`，复用现有 conditional spread pattern。完成后 `AFTER_MODEL_RESULT` boundary 在 `result.providerResponseId` 存在时投影该值，不存在时省略。来源：spec `lifecycle-hook-execution` / `Stage-specific boundaries and mutations are minimal runtime contracts` / Scenario  投影 provider 返回的 response ID 和 Provider 未返回 response ID。验证：`npx vitest run packages/agent-model/tests/lifecycle-hook-wrapper.test.ts --reporter verbose` 通过。

- [ ] 1.3 在 `agent-model/tests/lifecycle-hook-wrapper.test.ts` 中新增测试用例：构造携带 `providerResponseId` 的 `ModelFinalResult`，触发 `AFTER_MODEL_RESULT` hook，断言 boundary 上 `providerResponseId` 字段存在且值与 result 一致。来源：spec `lifecycle-hook-execution` / `Stage-specific boundaries and mutations are minimal runtime contracts` / Scenario 投影 provider 返回的 response ID。验证：`npx vitest run packages/agent-model/tests/lifecycle-hook-wrapper.test.ts --reporter verbose` 新增测试通过。

- [ ] 1.4 在 `agent-model/tests/lifecycle-hook-wrapper.test.ts` 中新增测试用例：构造未携带 `providerResponseId` 的 `ModelFinalResult`，触发 `AFTER_MODEL_RESULT` hook，断言 boundary 上 `providerResponseId` 字段不存在。来源：spec `lifecycle-hook-execution` / `Stage-specific boundaries and mutations are minimal runtime contracts` / Scenario Provider 未返回 response ID。验证：`npx vitest run packages/agent-model/tests/lifecycle-hook-wrapper.test.ts --reporter verbose` 新增测试通过。

- [ ] 1.5 确认 `ModelResultMutation` interface（`agent-contracts/src/runtime/index.ts`）和 `AFTER_MODEL_RESULT` mutation 封闭字段表（spec 中 Stage/mutation 表）不包含 `providerResponseId`。来源：spec `lifecycle-hook-execution` / `Stage-specific boundaries and mutations are minimal runtime contracts` / Scenario Model hook mutation 遵守封闭 schema。验证：`rg -n providerResponseId packages/agent-contracts/src/runtime/index.ts` 确认只出现在 `ModelResultBoundary` 而非 `ModelResultMutation`。

## 整体验证

- [ ] 2.1 运行 `npm run build` 确认全量 build 通过，无 TypeScript 编译错误。来源：design 修改方案。验证：`npm run build` 退出码 0。

- [ ] 2.2 运行 `agent-model` 和 `agent-contracts` 相关测试套件确认无回归。来源：design 验证策略。验证：`npx vitest run packages/agent-model/tests/ packages/agent-contracts/ --reporter verbose` 全部通过。

- [ ] 2.3 运行 `openspec validate --all --strict` 确认 change 文档合规。来源：proposal/spec/design。验证：`openspec validate --all --strict` 退出码 0。
