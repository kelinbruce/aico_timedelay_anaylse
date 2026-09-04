## 1. `FN-4.1 调用模型`

- [x] 1.1 收紧模型终态归一化：只有 `incompleteOutputReason="truncated-tool-call"` 的空 Tool-call 终态进入恢复；缺失或为 `output-limit` 时返回 `MODEL_TOOL_CALLS_MISSING`。
  来源：`Failure exits are explicit and safe`；design `FN-4.1 调用模型 / 修改方案`
  验证：`npx vitest run packages/agent-model/tests/lifecycle-hook-wrapper.test.ts`

- [x] 1.2 保持首次 `length` 先提升预算，并让提升后的 reasoning-only `length` 终态只注入一次 correction，之后复用既有最多三次续写、取消和失败边界。
  来源：`输出超限不得静默截断`；design `FN-4.1 调用模型 / 修改方案`
  验证：`npx vitest run packages/agent-core/tests/budget-degradation-notice.test.ts`

- [x] 1.3 修正新增模型测试的 strict TypeScript 收窄，确保测试代码参与 root typecheck。
  来源：AGENTS.md 验证门禁
  验证：`npm run typecheck`

## 2. Change 整体验证

- [x] 2.1 完成受影响模型套件、root build/test/contract/architecture/OpenSpec strict 和语义审查；如整仓基线存在非本 change 失败，必须单独复现并如实记录，不得宣称全绿。
  来源：AGENTS.md 验证门禁；design `验证策略`
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`
  实际结果：root build PASS；聚焦套件纳入联合验证 174 passed / 4 skipped；contract 387/387、architecture 308/308、OpenSpec 300/300 PASS。最新 root `npm test` 为 2167/2169，保留 2 个本 change 前已复现的既有 Skill trust/payload 基线失败；未把整仓结果表述为全绿。`$nextagent-skill-review` 与 `$nextagent-code-review` 均未发现本 change P0/P1。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，按 design 的“长期基线刷新计划”归并 `model-invocation-contract`、`FN-4.1 调用模型`、相关 module 和 `spec-to-design-map`。
