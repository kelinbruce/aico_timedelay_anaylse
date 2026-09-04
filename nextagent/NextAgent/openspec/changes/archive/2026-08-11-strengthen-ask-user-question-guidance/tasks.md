## 1. `FN-5.6 向用户提问`

- [x] 1.1 为内置 System Prompt 和 `AskUserQuestion` descriptor/schema 建立目标行为测试，断言所有实际需要回答的普通问题必须使用 Tool、assistant 文本不得直接提问、禁止用途优先，并锁定简化后的字段描述；在修改实现前运行测试并确认目标断言失败。
  来源：`FN-5.6 向用户提问` + Requirement `User-facing agents trigger AskUserQuestion for blocking ordinary user input` + Scenarios「需要用户回答的普通问题使用 AskUserQuestion」「已知选项时使用结构化选项」「禁止用途不使用 AskUserQuestion」「AskUserQuestion 不可用时不退化为文本问句」
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests/prompt-shaping.test.ts packages/agent-capability/tests/builtin-tool-guidance.test.ts`；实现前新增断言必须失败，失败内容必须指向缺失的 mandatory guidance 或旧 descriptor/schema 文本。
  验证记录（2026-08-07）：运行上述命令，24 个测试中 22 个通过、2 个目标断言失败；失败分别指向 System Prompt 缺失 mandatory guidance，以及 Tool description 仍为旧的 blocked-only guidance。

- [x] 1.2 更新 `task-approach.md` 与 `tooling.md` 的模型可见指导：实际需要用户回答的追问、澄清、偏好、实现选择和普通确认必须调用 `AskUserQuestion`，不得在 assistant 文本中直接提问；优先使用上下文、工具或安全明确假设，Tool 不可用时只允许安全假设或无问句 blocked explanation。
  来源：`FN-5.6 向用户提问` + Requirement `User-facing agents trigger AskUserQuestion for blocking ordinary user input` + Scenarios「需要用户回答的普通问题使用 AskUserQuestion」「可从上下文或工具取得的信息不形成用户问题」「AskUserQuestion 不可用时不退化为文本问句」；design「FN-5.6 向用户提问 / 修改方案」第 1–3 项
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests/prompt-shaping.test.ts`；预期 mandatory guidance、上下文优先规则和不可用降级边界断言全部通过，且冲突的“仅阻塞安全推进时使用”旧语句不存在。
  验证记录（2026-08-07）：运行上述命令，`prompt-shaping.test.ts` 共 19 个测试全部通过。

- [x] 1.3 更新 `AskUserQuestion` Tool description 与输入 Schema description：明确 mandatory trigger、普通确认与 protected/high-risk confirmation 的边界，以及自由文本、预设选项、多选、option-attached text input 和 question-level custom 的字段语义；不得改变 Schema shape 或 runtime validation。
  来源：`FN-5.6 向用户提问` + Requirement `User-facing agents trigger AskUserQuestion for blocking ordinary user input` + Scenarios「需要用户回答的普通问题使用 AskUserQuestion」「已知选项时使用结构化选项」「禁止用途不使用 AskUserQuestion」；design「FN-5.6 向用户提问 / 修改方案」第 4–5 项
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/builtin-tool-guidance.test.ts`；预期 Tool trigger、禁止用途、全部受影响 Schema description 和原 Schema shape 断言通过。
  验证记录（2026-08-07）：运行上述命令，`builtin-tool-guidance.test.ts` 共 5 个测试全部通过；新增断言覆盖根对象、questions、question item、options 和 option item 的既有 shape。

- [x] 1.4 完成触发 Requirement 的原子迁移 delta：来源 `ask-user-question-trigger-policy` 使用 REMOVED，目标 `ask-user-question-tool` 使用同名 ADDED 并承载全部目标黑盒行为；未触及的 network explorer Requirement 原位保留，直接导航引用与并行 active change 兼容。
  来源：`FN-5.6 向用户提问` + Requirement `User-facing agents trigger AskUserQuestion for blocking ordinary user input` + 全部 Scenarios；design「存量 Requirement 迁移方案」
  验证：运行 `npx --yes @fission-ai/openspec@latest validate strengthen-ask-user-question-guidance --strict`，并用 `rg -n "User-facing agents trigger AskUserQuestion for blocking ordinary user input|Invoked read-only network explorer does not directly create user questions" openspec/specs openspec/changes/strengthen-ask-user-question-guidance` 检查迁移对；预期严格校验通过、同名迁移两端完整且 network explorer Requirement 未被本 change 删除。
  验证记录（2026-08-07）：strict validate 通过；来源 stable spec 中同名 Requirement 和 network explorer Requirement 均存在，本 change 的来源 REMOVED 与目标 ADDED 完整，且并行 change 只触及其他 Requirements。

## 2. Change 整体验证

- [ ] 2.1 运行后端与 OpenSpec 门禁，确认 prompt/descriptor 变更未引入 TypeScript、contract 或 architecture 回归，并对提交范围执行 NextAgent 模型语义检视。
  来源：proposal「影响范围」+ design「验证策略」「质量属性」
  验证：运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`npx --yes @fission-ai/openspec@latest validate --all --strict`，并按 `$nextagent-code-review` 检视本 change；预期所有命令退出码为 0，模型检视结论为 `PASS` 或无 P0/P1 的 `PASS WITH FOLLOW-UP`。
  验证记录（2026-08-07）：`lint:architecture` 通过（46 files、291 tests）；本 change strict validate 与定向测试通过。`build` 被两个未触达的 `agent-workflow` 类型错误阻断；`npm test` 为 1866/1867 通过，失败位于未触达的 `per-call-skill-trust.test.ts`；`test:contract` 为 357/359 通过，失败位于未触达的 gateway/workflow contract tests；全量 OpenSpec 中本 change 通过，另有 34 个其他 active/stable 项失败。按用户指示继续提交 PR，但由于全量门禁未全部退出 0，本任务保持未勾选。

## 归档前更新基线检查（非实施任务）

归档时按 design「基线归并计划」更新 stable specs、`FN-5.6`、`F-5.4`、overview、相关 architecture/modules 与 spec-to-design map；确认同一触发行为只由 `ask-user-question-tool` 规范定义，`ask-user-question-trigger-policy` 只保留 network explorer Requirement，并与 `unify-capability-failure-disposition` 对 `ask-user-question-tool` 中其他 Requirements 的并行修改完成无损合并。
