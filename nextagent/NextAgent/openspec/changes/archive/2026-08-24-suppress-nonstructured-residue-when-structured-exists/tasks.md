## 1. 修改终端抑制条件

- [x] 1.1 修改 `default-agent.ts` 主路径（L877）：将 `streamDeltaTotal > 0 && streamDeltaTotal === streamDeltaStructured` 改为 `streamDeltaStructured > 0`，变量名从 `allStructuredStream` 改为 `hasStructuredStream`。
  来源：design `修改方案`
  验证：`npm run build` 通过；`npx vitest run packages/agent-core/tests/default-agent-streaming-terminal-suppression.test.ts` 通过。

- [x] 1.2 修改 `default-agent.ts` pre-round 路径（L475）：将 `_streamDeltaTotalPre > 0 && _streamDeltaTotalPre === _streamDeltaStructuredPre` 改为 `_streamDeltaStructuredPre > 0`，变量名从 `_allStructuredPre` 改为 `_hasStructuredPre`。
  来源：design `修改方案`
  验证：同上。

## 2. 更新测试

- [x] 2.1 更新 `default-agent-streaming-terminal-suppression.test.ts` 中的 "Mixed chunks" 测试用例：期望从 1 条 `LLM_CONTENT_DELTA` 改为 0 条，验证混合场景下有结构化数据时终端 `LLM_CONTENT_DELTA` 被抑制。
  来源：spec MODIFIED `Streaming Terminal LLM_CONTENT_DELTA Suppression` Scenario "Mixed chunks suppresses terminal LLM_CONTENT_DELTA when any structured data exists"
  验证：`npx vitest run packages/agent-core/tests/default-agent-streaming-terminal-suppression.test.ts --reporter=verbose` 全部通过。

## 3. 整体验证

- [x] 3.1 执行 `npx vitest run packages/agent-core/tests/` 确认无回归。
  来源：design `验证策略`
  验证：全部测试通过。

- [x] 3.2 执行 `npm run build` 确认构建通过。
  来源：design `验证策略`
  验证：构建成功。

- [x] 3.3 执行 `npx openspec validate suppress-nonstructured-residue-when-structured-exists --strict` 确认 OpenSpec change 校验通过。
  来源：OpenSpec 验证门禁
  验证：校验通过。
