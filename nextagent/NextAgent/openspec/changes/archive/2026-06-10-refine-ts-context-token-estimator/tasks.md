## 1. Contract Updates

- [x] 1.1 (landed 2026-06-10) 在 `agent-contracts/src/context/index.ts` 新增 `TokenEstimator` interface（4 个方法：`estimateTokens(text: string): number`、`estimateMessageTokens(role, content): number`、`estimateToolMessageTokens(toolCallId, toolName, content): number`、`estimateTokensBatch(texts: readonly string[]): number`）；不新增 subpath、不动 `ContextAssembly` / `SystemPrompt` 等既有形态。
  来源：spec requirement "Context Engine carries a pluggable TokenEstimator contract"
  落地证据：`agent-contracts/src/context/index.ts` 末尾新增 `export interface TokenEstimator` 块（4 个方法、role 联合 `"system" | "user" | "assistant" | "tool"`、JSDoc 列出所有契约不变量）；接口与 `ContextAssemblyRequest` / `ContextAssembly` / `SystemPrompt` / `TraceableSummary*` / `ContextCompressionEvidence` 在同一 file，不新增 subpath。

## 2. Default Implementation

- [x] 2.1 (landed 2026-06-10) 在 `packages/agent-context-engine/src/budget/default-token-estimator.ts` 实现 `DefaultTokenEstimator`：按 Unicode code point 迭代（`codePointAt` + `cp > 0xFFFF ? i+=2 : i++`），权重 ASCII ×0.25 / CJK 基本面 ×1.5 / 增补面 ×2.0 / 其它 BMP ×1.0；空文本返回 0，非空文本 `Math.max(1, Math.ceil(weightedSum))`。
  来源：spec requirement "DefaultTokenEstimator uses code-point-aware weighting"
  落地证据：见同名文件 + index.ts re-export。`weightFor()` 函数明确 4 段优先级 (supplementary > CJK basic > ASCII > other BMP)，`estimateTokensImpl()` 用 `text.codePointAt(i) + i += cp > 0xFFFF ? 2 : 1` 安全迭代 supplementary plane。
- [x] 2.2 (landed 2026-06-10) 实现 `estimateMessageTokens(role, content)` = `MESSAGE_OVERHEAD_TOKENS + estimateTokens(content)`（`MESSAGE_OVERHEAD_TOKENS = 4`）。
  来源：spec requirement "DefaultTokenEstimator adds protocol overhead for messages"
- [x] 2.3 (landed 2026-06-10) 实现 `estimateToolMessageTokens(toolCallId, toolName, content)` = `TOOL_MESSAGE_OVERHEAD_TOKENS + estimateTokens(toolCallId) + estimateTokens(toolName) + estimateTokens(content)`（`TOOL_MESSAGE_OVERHEAD_TOKENS = 10`）。
  来源：spec requirement "DefaultTokenEstimator adds protocol overhead for messages"
- [x] 2.4 (landed 2026-06-10) 实现 `estimateTokensBatch(texts)` 为逐个 `estimateTokens` 求和；该方法存在意义在于让消费方代码更紧凑，不要求性能上区别于循环调用。
  来源：spec requirement "Context Engine carries a pluggable TokenEstimator contract"
- [x] 2.5 (landed 2026-06-10) 在 `packages/agent-context-engine/src/index.ts` 导出 `DefaultTokenEstimator` 与构造工厂 `createDefaultTokenEstimator()`，让 app composition 能注入。
  来源：spec requirement "Replacement implementation is supported"
  落地证据：`packages/agent-context-engine/src/index.ts` 新增 `export * from "./budget/default-token-estimator.js"`，使 `DefaultTokenEstimator` 类、`createDefaultTokenEstimator()` 工厂可被外部消费。

## 3. Unit Tests

- [x] 3.1 (landed 2026-06-10) 在 `packages/agent-context-engine/tests/default-token-estimator.test.ts` 写单测覆盖 spec 的所有 6 个 estimateTokens scenario（空文本 / ASCII / CJK / 增补面 / 混合 / floor-1）和 2 个 overhead scenario（per-message / tool > message）；额外覆盖 batch 等价循环 sum、TypeScript readonly array 入参。
  来源：spec scenarios "Empty text returns zero" / "ASCII text uses 0.25 per code point with floor of one" / "CJK basic-plane text uses 1.5 per code point" / "Supplementary plane code point counts as one weighted unit" / "Mixed content sums weights" / "Per-message overhead is applied" / "Tool message overhead is at least as large as message overhead"
  落地证据：11 个 it()，全部 pass；额外覆盖 (a) `text.length` 测试反证 `"🎉".length === 2` 但 estimate 仍 = 2 token，证明 code-point-awareness；(b) `Hangul "가"` 走 "other BMP" 1.0 路径（U+AC00 不在 CJK basic 范围）；(c) 类型工厂返回 `TokenEstimator` 接口类型；(d) `Number.isInteger` + `>= 0` 不变量。
- [x] 3.2 (landed 2026-06-10) 在 `tests/contract/token-estimator.test.ts` 写 contract 测试断言 `TokenEstimator` 来自 `@nextagent/agent-contracts/context`、source-level 校验接口形态、断言 `agent-common` 不重复定义该类型。
  来源：spec scenarios "Interface lives in agent-contracts/context" / "All four methods are required"
  落地证据：3 个 it()，全部 pass。`expectTypeOf<TokenEstimator>().toHaveProperty(...)` × 4 方法 + source regex 校验 + `agent-common/src/index.ts` 不含 `interface TokenEstimator` 反证。

## 4. Sibling Sync

- [x] 4.1 (landed 2026-06-10) 同步 `openspec/changes/add-ts-context-prompt-shaping/tasks.md` 的 §1.9 / §2.14 / §6.8：在每条末尾加 "(superseded 2026-06-10 by refine-ts-context-token-estimator; 本 change 仅消费 `TokenEstimator` 与 `DefaultTokenEstimator`, 不再拥有其定义)" 标注；不动 prompt-shaping 自身的 tick 状态（仍 0 ticked）。
  来源：proposal §Impact 与 design §Why Not Per-Provider Tokenizer
  落地证据：prompt-shaping tasks.md §1.9 / §2.14 / §6.8 各加 superseded note。§6.8 顺手注明"你好 → 2 tokens" 是早期 spec 草稿笔误，正确为 3 (2 × 1.5 = ceil 3)，落地实现按数学正确值。`openspec validate add-ts-context-prompt-shaping --strict` 仍 pass。

## 5. Validation

- [x] 5.1 (passed 2026-06-10) 运行 `npm run build`（tsc + asset copy）→ exit 0。
- [x] 5.2 (passed 2026-06-10) 运行 `npm test` → 全部通过；新增的 default-token-estimator + token-estimator 测试 + 既有 470 个测试同时绿。
  结果：483 passed, 1 skipped, 0 failed（57 test files；+14 新测试: 11 unit + 3 contract）。
- [x] 5.3 (passed 2026-06-10) 运行 `npm run lint:architecture` → 0 dependency violations。
- [x] 5.4 (passed 2026-06-10) 运行 `openspec validate refine-ts-context-token-estimator --strict`。
  结果：`Change 'refine-ts-context-token-estimator' is valid`。
- [x] 5.5 (passed 2026-06-10) 运行 `openspec validate --all --strict`。
  结果：43 passed, 0 failed (43 items)（含本 change 一项）。
