# Tasks: 修复幂等键长度超限

## 1. `FN-11.2 幂等写入`

- [x] 1.1 `packages/agent-common/src/index.ts`：新增 `import { createHash } from 'node:crypto'`；新增 `IDEMPOTENCY_KEY_MAX_LENGTH = 256` 常量与 `deriveAssistantToolUseIdempotencyKey(runId, toolCallIds)` 生成器——literal 不超限时保留 `${runId}:assistant-tool-use:${joined}`，超限时回退 `${runId}:assistant-tool-use:h:${sha256(joined).slice(0,16)}`。
  来源：`FN-11.2` + Requirement `生成的幂等键必须符合下游长度上限` + Scenarios `大批量 tool call 的幂等键保持在长度上限内`、`小批量保留可读字面量键`、`塌缩后的键在重试与重放中保持确定`；design `FN-11.2 幂等写入 / 修改方案`
  验证：`npm run typecheck` 无本次改动引入的 TS 错误。

- [x] 1.2 `packages/agent-core/src/tools/tool-loop.ts`：import 新增 `deriveAssistantToolUseIdempotencyKey`；`appendAssistantToolUseMessage` 调用点（原 `brand(...)` 内联拼接）改为调用该生成器。保留 `brand` import。
  来源：同上；design `FN-11.2 幂等写入 / 修改方案`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/tool-loop.test.ts`；预期 `1 passed / 22 passed`，31-tool-call 批量用例覆盖该路径。

- [x] 1.3 `packages/agent-capability/tests/idempotency-contract.test.ts`：新增 `Assistant tool-use idempotency key length bound` describe 块，含 4 项——大批量真实 provider ID（19 个 `chatcmpl-tool-…`）key ≤ 256、同批次确定重现、小批次保留 literal、不同批次 hash 不撞。
  来源：`FN-11.2` + Requirement `生成的幂等键必须符合下游长度上限` + 全部三个 Scenarios
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/idempotency-contract.test.ts`；预期 `1 passed / 13 passed`（原有 9 + 新增 4），复现 literal 648 字符 > 256、生成 key ≤ 256。

## 2. 整体验证

- [x] 2.1 `npm run build:runtime`——dist 重建成功，新导出已产出。
- [x] 2.2 `npx depcruise --config dependency-cruiser.config.cjs packages --output-type err`——`no dependency violations found`（`node:crypto` import 未破坏架构边界）。
- [x] 2.3 `npm run lint:architecture`——架构门禁通过。
- [x] 2.4 `openspec validate fix-idempotency-key-length-limit --type change --strict`——本 change 通过 strict 校验。
  验证记录（2026-08-14）：typecheck 无本次错误（main 既有无关 `workflow-node-logging.test.ts:127` 不在范围）；idempotency 契约 `13 passed`；tool-loop `22 passed`；build:runtime 成功；depcruise 无违规；lint:architecture 通过；openspec strict `is valid`。`npm run test:contract` 唯一失败为 `workflow-package-composition.test.ts` 的 Windows 临时目录 `ENOTEMPTY` 竞态，与本改动无关。
