## 1. Contract Updates

- [x] 1.1 (landed 2026-06-10) 在 `agent-contracts/src/model/index.ts` 的 `ModelInfo` interface 加 required `contextWindowTokens: number` 字段（在 `modelName` 与 `baseUrl?` 之间，按 spec design 的字段顺序）。
  来源：spec requirement "ModelInfo carries the model context window size"
  落地证据：`agent-contracts/src/model/index.ts` ModelInfo interface 在 modelName 后、baseUrl? 前新增 `readonly contextWindowTokens: number;`，带 JSDoc 说明运行时投影自 ModelProfile + 由 modelInfoFromProfile 传播 + 被 budget gate 直接消费。

## 2. Production Propagation

- [x] 2.1 (landed 2026-06-10) 在 `packages/agent-app/src/composition/create-app.ts:modelInfoFromProfile` 把 `profile.contextWindowTokens` 写入返回的 `ModelInfo`。
  来源：spec requirement "ModelInfo carries the model context window size" + design "Propagation Path"
  落地证据：modelInfoFromProfile 在 modelName 后、baseUrl 前新增 `contextWindowTokens: profile.contextWindowTokens`。同步修了 `packages/agent-app/src/config/model-profiles.ts:modelInfoForAssembly`（另一处 ModelInfo 构造点）。

## 3. Engine Cleanup

- [x] 3.1 (landed 2026-06-10) 在 `packages/agent-context-engine/src/assembly/assemble-context.ts` 删除 `contextWindowTokensFallback?: number` dependency、`DEFAULT_CONTEXT_WINDOW_TOKENS_FALLBACK = 128_000` 常量、以及 `runBudgetGate` 内的 `as { contextWindowTokens? }` 类型断言 + 三层 fallback 链。直接读 `modelSelection.modelInfo.contextWindowTokens`。
  来源：spec requirement "Budget decision gate reads the real model window from ModelInfo"
  落地证据：DefaultContextEngineDependencies 删除 contextWindowTokensFallback 字段；DEFAULT_CONTEXT_WINDOW_TOKENS_FALLBACK 常量已删；runBudgetGate 现在是 `const window = modelSelection.modelInfo.contextWindowTokens;`（无 as 断言、无 ?? 链）。

## 4. Test Fixture Updates

- [x] 4.1 (landed 2026-06-10) 所有 ~9 处 `ModelInfo` literal 构造点加 `contextWindowTokens` 字段。
  落地证据：实际修了 9 处（比预估 6 多 3 处由 tsc 全量错误暴露发现）：
  - `packages/agent-context-engine/tests/budget-gate-integration.test.ts`（1 处 makeEngine + 7 处 test body 的 contextWindowTokensFallback → contextWindowTokens 重命名）
  - `packages/agent-context-engine/tests/history-candidate-selection.test.ts`（3 处）
  - `packages/agent-context-engine/tests/skill-disclosure-render.test.ts`（1 处）
  - `tests/agent-kernel/capability-governance.test.ts`（1 处，在 modelSelectionResolver 返回值内）
  - `tests/agent-kernel/main-path.test.ts`（2 处：line 117 + line 263）
  - `tests/agent-kernel/output-guard.test.ts`（1 处）
  - `tests/agent-kernel/owner-scope.test.ts`（1 处）
  - `tests/agent-kernel/request-retry.test.ts`（1 处）

## 5. Contract Tests

- [x] 5.1 (landed 2026-06-10) 在 `tests/contract/model-info-context-window.test.ts` 加合约测试断言 ModelInfo 含 contextWindowTokens、属于 positive integer 类型、source-level 校验字段在 `agent-contracts/src/model/index.ts` 内。
  来源：spec scenarios "ModelInfo declares its context window as a required field" + "Budget gate reads contextWindowTokens directly from modelInfo"
  落地证据：3 个测试全 pass：(a) 字段存在 + 类型 + source-level required 校验（含反向断言"contextWindowTokens?:" 不存在）；(b) assemble-context.ts source-level 校验 fallback / DEFAULT_CONTEXT_WINDOW_TOKENS_FALLBACK / as 断言都已删，且 modelSelection.modelInfo.contextWindowTokens 的直接读已加；(c) modelInfoFromProfile 包含 `contextWindowTokens: profile.contextWindowTokens` 正向校验。
- [x] 5.2 (landed 2026-06-10) 在 `tests/contract/model-info-context-window.test.ts` 加 source-level 校验：`assemble-context.ts` 不再含 `contextWindowTokensFallback` / `DEFAULT_CONTEXT_WINDOW_TOKENS_FALLBACK` / `as { contextWindowTokens? }`。
  落地证据：合并到 5.1 的第二个 it()。

## 6. Validation

- [x] 6.1 (passed 2026-06-10) 运行 `npm run build` → exit 0。
- [x] 6.2 (passed 2026-06-10) 运行 `npm test` → 全部通过。结果：514 passed, 1 skipped, 0 failed（60 files；Chunk β 既有 9 个 integration 测试 + 其他 502 个测试 + 本 change 新加的 3 个 contract 测试同时绿）。
- [x] 6.3 (passed 2026-06-10) 运行 `npm run lint:architecture` → 0 dependency violations。
- [x] 6.4 (passed 2026-06-10) 运行 `openspec validate refine-ts-model-info-context-window --strict`。结果：`Change 'refine-ts-model-info-context-window' is valid`。
- [x] 6.5 (passed 2026-06-10) 运行 `openspec validate --all --strict`。结果：44 passed, 0 failed (44 items)。
