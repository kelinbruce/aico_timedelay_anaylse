## FN-5.16 识别和投射结构化工具增量

### unwrapStructuredEnvelope 扩展

- [x] 1.1 在 `structured-delta-identification.ts` 中提取 `parseJsonObjectString` 辅助函数，重构 `unwrapStructuredEnvelope` 为两形状分支：status 信封（`status==="ok"`，`data.raw`）和 code 信封（`code===200`，`data` 为 string）。
  - 来源：`FN-5.16 + Structured Event Shape Validation + code 信封形状识别成功`
  - 验证：TypeScript 编译通过；纯函数无副作用
  - 预期结果：编译无错误

- [x] 1.2 单元测试 `structured-delta-identification.test.ts` 覆盖：code 信封 positive case、code 非 200 negative case、malformed data negative case、`tryEmitStructuredDelta` code 信封 emission。
  - 来源：`FN-5.16 + Structured Event Shape Validation + code 信封形状识别成功`、`FN-5.16 + Structured Event Shape Validation + code 信封 code 非 200 时回退`、`FN-5.16 + Structured Event Shape Validation + code 信封 data 格式错误时回退`
  - 验证：`npx vitest run packages/agent-core/tests/structured-delta-identification.test.ts`
  - 预期结果：全部通过

### Bash emission 测试

- [x] 2.1 在 `tool-structured-delta-emission.test.ts` 新增 Bash code 信封 emission 测试：stdout 为 `{"code":200,"msg":"success","data":"<json>"}` 时正确 emit `TOOL_STRUCTURED_DELTA`。
  - 来源：`FN-5.16 + Structured Event Shape Validation + code 信封形状识别成功`
  - 验证：`npx vitest run packages/agent-core/tests/tool-structured-delta-emission.test.ts`
  - 预期结果：全部通过

- [x] 2.2 在 `tool-structured-delta-emission.test.ts` 新增 Bash code 信封 negative case：`code:500` 时不 emit。
  - 来源：`FN-5.16 + Structured Event Shape Validation + code 信封 code 非 200 时回退`
  - 验证：测试断言无 event
  - 预期结果：全部通过

### 整体验证

- [x] 3.1 运行 `npx vitest run packages/agent-core/tests/structured-delta-identification.test.ts packages/agent-core/tests/tool-structured-delta-emission.test.ts`。
  - 来源：`FN-5.16 + Structured Event Shape Validation`（全部场景）
  - 验证：39 passed
  - 预期结果：全部通过

- [x] 3.2 运行 `openspec validate add-structured-delta-code-msg-data-envelope --strict`。
  - 来源：AGENTS.md OpenSpec 验证
  - 验证：openspec strict 验证通过
  - 预期结果：无错误