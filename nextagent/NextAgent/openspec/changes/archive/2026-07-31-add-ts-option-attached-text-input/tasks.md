## 1. Tool 与公共契约

- [x] 1.1 扩展 `AskUserQuestion` description，明确自由文本、普通 option、question-level custom 和 option-attached text input 的使用条件、多个 attached options、唯一 value 及互斥规则。
  验证：运行 AskUserQuestion descriptor/description focused tests，断言 model-facing 文案包含 canonical fields 和禁止组合。
  来源：`AskUserQuestion 支持具体选项附带文本输入`；design D4。
- [x] 1.2 扩展 `AskUserQuestion` option input schema，加入有界 `requiresTextInput` 和 `inputPlaceholder`，并补充合法 shape 与非法组合 schema/producer tests。
  验证：运行 `packages/agent-capability` AskUserQuestion schema tests 和 `packages/agent-core` AskUserQuestion producer tests。
  来源：`AskUserQuestion 支持具体选项附带文本输入`；design D1、D2、D6。
- [x] 1.3 在 `agent-contracts/runtime`、`gateway` 和 Web state contract 中以相同命名、类型和语义增加两个 optional option fields，并补 contract schema tests；workflow pending option contract 保持不变。
  验证：运行 `npm run test:contract` 中相关 contract tests；code review 检查三个 contract subpath 不形成依赖和字段漂移。
  来源：`Pending option contract supports attached text input`；design D1；用户明确授权的 additive contract refinement。

## 2. Producer、runtime 与投影

- [x] 2.1 在 Agent/core AskUserQuestion normalization 中只映射已通过 descriptor validation 的 attached-input fields，并拒绝 attached input 与 `multiple=true`/`custom=true`、无 flag placeholder 等非法组合。
  验证：focused producer tests 实际调用非法 tool arguments，断言 `INVALID_INPUT` 且 pending boundary 未被调用。
  来源：`Producer preserves valid option-attached input constraints`、`Producer rejects ambiguous option-attached input combinations`；design D2、D4、D6。
- [x] 2.2 在 runtime pending intent acceptance 中校验 attached-input canonical shape，并禁止 confirmation、authorization、human handoff 携带 attached-input option。
  验证：runtime pending intent negative tests 分别触发互斥、placeholder、protected kind 非法 shape 并断言 `PENDING_INPUT_INTENT_INVALID`。
  来源：`Attached option input constraints are mutually exclusive with multi-select and generic custom`；design D2、D6。
- [x] 2.3 在 runtime answer boundary 按 accepted option 解释一元或二元 answer entry，接受 `[optionValue,inputText]` 并拒绝缺失、空值、超长、多余值、ordinary option 第二项和未知 option。
  验证：runtime answer focused tests 覆盖 normal/negative cases，并断言非法 answer 不 resolve pending。
  来源：`Single-select option can require one attached text value`；design D3、D6。
- [x] 2.4 在 pending Record/JSON mapping、stream envelope 与 Web projection 中透传已接受的 optional fields，不新增 store、event 或 lifecycle owner。
  验证：gateway round-trip 和 channel projection tests；`npm run lint:architecture`。
  来源：`Contract fields preserve one meaning across boundaries`、`Option-attached input projection remains safe and host-consistent`；design D5。

## 3. 前端交互

- [x] 3.1 扩展共享 `RespondInput`：选择 attached option 后在该行展开最多 500 字符的必填 textarea，提交 `[optionValue,inputText]`，普通 option 保持一元 answer。
  验证：`frontend/agent-web` 下运行 focused `RespondInput` tests，断言 DOM 展开、placeholder、长度、提交 payload 和 disabled 状态。
  来源：`Selected option expands one bounded text input`；design D5。
- [x] 3.2 实现切换 option 时清理旧 attached text，并补键盘交互和多个 attached options 的用户可观察测试。
  验证：focused `RespondInput` tests 实际在两个 attached options 与 ordinary option 间切换，断言旧文本不进入提交结果。
  来源：`Switching selection clears stale attached input`；design D5。
- [x] 3.3 验证 local、immersive、collaborative 三种 host 继续复用同一组件和 artifact 行为。
  验证：`frontend/agent-web` 下运行 `npm run build`、`npm run build:vite:modes`。
  来源：`Option-attached input projection remains safe and host-consistent`；AGENTS.md 多宿主边界。

## 4. 验证和收尾

- [x] 4.1 运行后端全量门禁，确认 minimal kernel、contract 和架构无回归。
  验证：根目录运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
  来源：design 质量属性和验证映射；AGENTS.md 验证门禁。
- [x] 4.2 完成严格 OpenSpec 校验、change 语义审查和 push 前代码语义检视，修复所有 P0/P1 与 OpenSpec findings。
  验证：`openspec validate --all --strict`、`$nextagent-skill-review` PASS、`$nextagent-code-review` PASS/PASS WITH FOLLOW-UP、`git diff --check`。
  来源：design 验证映射；AGENTS.md OpenSpec 与 push 门禁。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/ask-user-question-tool/spec.md`、`question-pending-input/spec.md`、`ts-core-contracts/spec.md`。
- 更新 `openspec/designs/architecture/runtime-boundaries.md` 和 `conversation-ui-state.md`。
- 更新 `openspec/designs/modules/agent-capability.md`、`agent-runtime.md`、`agent-channel-web.md`。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义 pending option schema、answer interpretation 或 lifecycle owner。
