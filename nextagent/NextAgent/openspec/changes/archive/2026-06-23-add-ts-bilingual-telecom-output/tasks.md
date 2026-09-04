## 1. 规则文本追加

- [x] 1.1 在 `agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/communication-style.md` 末尾追加以下两条英文规则指令：
  - Language following directive: respond in the same natural language as the user's current input message. Do not rely on the `Locale/language hint` as authority for output language; the user's actual input language takes precedence.
  - Telecom term preservation directive: keep all telecom terms (NE names, interface names, counters, alarms, KPI names, protocol names, IP addresses, port numbers, CLI command names, alarm identifiers, and common English abbreviations) in their original form without translation, regardless of output language.
  验证：`tail -10 packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/communication-style.md` 包含两条英文指令文本
  来源：spec Requirement: Context Engine SHALL add bilingual telecom output rules to the SYSTEM_PROMPT；design 决策 1

## 2. 集成测试与端到端验证

- [x] 2.1 新增 rendering integration test：调用 `ContextEngine.render()` 后，检查 `RenderedModelInput.messages[0].content[0].text` 包含两条规则指令文本。
  验证：`npx vitest run packages/agent-context-engine/src/__tests__/telecom-bilingual-output.test.ts` 通过；测试断言 system message text 包含两条指令的文本内容
  来源：spec Requirement: Bilingual telecom rules appear in system prompt；design 验证映射

- [x] 2.2 验证 `ModelInputRenderer.renderSystemMessageText()` 输出的 `Locale/language hint:` 行不受影响，仍出现在 system message 中。
  验证：在上述 test 中同时断言 system message text 包含 `Locale/language hint:` 子串
  来源：spec Requirement: Locale hint is preserved for diagnostics；design 决策 2

- [x] 2.3 新增 characterization test：构建完整的 request lifecycle（从 context assembly 到 rendered model input），验证 system prompt 中包含规则文本且用户 message 仍为原始输入。
  验证：`npx vitest run packages/agent-context-engine/src/__tests__/telecom-bilingual-output.test.ts` 全部通过（含 characterization test case）
  来源：spec Requirement: Language following directive overrides locale hint in system message；design 验证映射

## 3. 清理与验证

- [x] 3.1 确认 `npm run build` 编译通过，无新增 TypeScript 编译错误或 lint 警告。
  验证：`npm run build` 无报错
  来源：design - 整体验证

- [x] 3.2 确认 `npm test` 在 `agent-context-engine` package 下全部通过。
  验证：`cd packages/agent-context-engine && npx vitest run` 全部通过
  来源：design - 整体验证

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 同步 `openspec/specs/telecom-bilingual-output/spec.md`（将 change 下的 ADDED Requirements 搬移到长期 baseline）。
- 按需更新 `openspec/designs/modules/agent-context-engine.md`，补充规则归属说明。
