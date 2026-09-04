## 1. Contract Updates

- [x] 1.1 (landed 2026-06-10) 在 `agent-contracts/app.ModelProfile` 增加 `contextWindowTokens: number`，不改 `ModelInfo` / `ModelOptions`。
  来源：spec requirement "ModelProfile carries the model context window size"
  落地证据：`packages/agent-contracts/src/app/index.ts` 在 `providerOptions` 后、`enabled` 前新增 `readonly contextWindowTokens: number;` 字段，带 JSDoc 说明其语义（模型固有容量、由 `assemble()` 读取作为 budget computation 的 selected window、与 `ModelOptions.maxTokens` 输出上限的明确区分）。配套 runtime validation 在 `packages/agent-app/src/config/validation.ts` 加 `APP_CONFIG_MODEL_CONTEXT_WINDOW_INVALID` 检查（positive integer）。所有 8 处 ModelProfile literal 构造点（src + tests + yaml）已同步补字段，`npm run build` exit 0。

## 2. Contract Tests

- [x] 2.1 (landed 2026-06-10) 契约测试断言 `ModelProfile.contextWindowTokens` 为 positive integer，且 `ModelOptions.maxTokens` 仍只表达输出上限。
  来源：spec requirement scenario "Model profile declares its context window"
  落地证据：`tests/contract/model-profile-context-window.test.ts` 第 1 个 it 用 `expectTypeOf<ModelProfile>().toHaveProperty("contextWindowTokens").toEqualTypeOf<number>()` + 实际构造一个 `ModelProfile` literal 断言 `Number.isInteger` + `>0` + source-level regex 校验字段确实在 `agent-contracts/app/index.ts` 的 `ModelProfile` interface 内；第 2 个 it 切出 `ModelProfile` interface body 断言 `maxTokens` 不在里面（防止未来混入输出/输入 budget 字段）。
- [x] 2.2 (landed 2026-06-10) 契约测试断言预算计算的窗口取自 accepted model profile，不接受来自 `ContextAssemblyRequest` 的窗口值。
  来源：spec requirement scenario "Budget computation resolves the window"
  落地证据：同测试文件第 3 个 it 用 conditional type `AssertNotIn<K extends RequestKeys ? never : K>` 在编译期硬挡 `contextWindowTokens` / `window` / `contextWindow` / `availableInputUnits` / `maxTokens` / `modelProfile` 这 6 个候选键名进入 `ContextAssemblyRequest`；运行期再切 `ContextAssemblyRequest` interface body 用 regex 二次确认。

## 3. Validation

- [x] 3.1 (passed 2026-06-10) 运行 `openspec validate refine-ts-model-profile-context-window --strict`。
  结果：`Change 'refine-ts-model-profile-context-window' is valid`。
- [x] 3.2 (passed 2026-06-10) 运行 `openspec validate --all --strict`。
  结果：见本会话其他 commit 同步的 41 passed, 0 failed (41 items)。
