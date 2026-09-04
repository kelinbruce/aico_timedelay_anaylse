## 1. 来源契约回归测试

- [x] 1.1 `memory-tools-provider` 契约测试：补充公开 `add_memory` 调用的来源断言和模型覆盖来源的拒绝用例；完成后测试能够复现当前工具写入 `CONFIGURED` 的失败，并确认非法来源输入不会触发保存。
  来源：Requirement `add_memory 来源由可信入口确定`；Scenario `智能体工具写入归类为智能沉淀`、`模型不能指定记忆来源`
  验证：定向启用根 Vitest 中 `packages/agent-memory/tests/**` 后运行 `npx vitest run packages/agent-memory/tests/memory-tools-provider.test.ts`；实施前预期来源断言失败且来源输入拒绝用例通过。
  验证结果（2026-07-24）：执行后共 20 tests，非法来源输入拒绝用例通过，唯一失败为保存请求实际 `CONFIGURED`、预期 `LEARNED`，已复现缺陷。

## 2. 可信入口来源修复

- [x] 2.1 `packages/agent-memory/src/memory-tools.ts`：将 `add_memory` 构造的 `SaveLongTermMemoryRequest.knowledgeSourceType` 固定为 `LEARNED`；完成后智能体工具写入被归类为智能沉淀，既有 scope、内容、`ACTIVE`、幂等和失败行为保持不变。
  来源：Requirement `add_memory 来源由可信入口确定`；Scenario `智能体工具写入归类为智能沉淀`；design `目标设计（Proposed Design）`
  验证：定向启用根 Vitest 中 `packages/agent-memory/tests/**` 后运行 `npx vitest run packages/agent-memory/tests/memory-tools-provider.test.ts`；预期全部通过，且保存请求来源为 `LEARNED`。
  验证结果（2026-07-24）：1 file、20 tests 全部通过，保存请求来源断言为 `LEARNED`。

## 3. 规格与回归门禁

- [x] 3.1 `refine-memory-source-classification`：完成 strict OpenSpec validation 和冻结行为契约语义审查；完成后 proposal、design、spec 和 tasks 指向同一条 `agent-memory` 最小增量路径。
  来源：design `验证策略（Verification Strategy）`
  验证：运行 `openspec validate refine-memory-source-classification --strict` 和 `openspec validate --all --strict`，预期均通过；按 `nextagent-skill-review` 检查 change，预期结论为 `PASS`。
  验证结果（2026-07-24）：change strict validation 通过；全量 strict validation 221 items 全部通过；`nextagent-skill-review` 结论为 `PASS`，无待确认的 `agent-contracts` 变化。

- [x] 3.2 后端 workspace：验证来源字段调整没有改变 public contract、package owner 边界或最小内核行为；完成后提交范围满足后端构建、测试和架构门禁。
  来源：design `质量属性设计（Quality Attributes）`、`验证策略（Verification Strategy）`
  验证：运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 和 `git diff --check`，预期全部通过；按 `nextagent-code-review` 审查独立提交范围，预期结论为 `PASS`。
  验证结果（2026-07-24）：`npm run build` 通过；`npm test` 107 files、884 tests 通过；`npm run test:contract` 38 files、315 tests 通过；`npm run lint:architecture` 无依赖违规且 36 files、225 tests 通过；scoped `git diff --check` 通过；`nextagent-code-review` 结论为 `PASS`。

- [x] 3.3 `refine-memory-source-classification`：将来源分类契约收窄为中文 `ADDED Requirement`，并同步 proposal、design 和 tasks；完成后本变更只定义 `add_memory` 的可信来源分类，不再重述无关行为。
  来源：proposal `目标与非目标（Goals / Non-Goals）`；design `目标设计（Proposed Design）`
  验证：运行 `openspec validate refine-memory-source-classification --strict`、`openspec validate --all --strict` 和 `git diff --check -- openspec/changes/refine-memory-source-classification`，预期全部通过；按 `nextagent-skill-review` 复审，预期结论为 `PASS`。
  验证结果（2026-07-24）：change 严格校验通过；全量严格校验 221 items 全部通过；限定范围的 `git diff --check` 通过；`nextagent-skill-review` 复审结论为 `PASS`，没有待确认的 `agent-contracts` 变更。

## 归档前更新基线检查（非实施任务）

归档流程按照 proposal 的“归档前更新基线”将来源契约归并到 `openspec/specs/memory-tools/spec.md`，并把长期决策提炼到 `openspec/designs/modules/agent-memory.md` 和 `openspec/designs/adr/memory-tools-boundary.md`；不得在实施阶段直接修改这些长期基线。
