# Design: Refine TS tool loop empty tool-name recovery

## Context

`brand()` in `agent-common` throws `INVALID_BRAND_VALUE` on empty strings. `prepareToolCall` calls `brand<string, "CapabilityId">(toolCall.toolName)` unconditionally, so an empty `toolName` from the model causes an opaque `INVALID_BRAND_VALUE` to surface as `REQUEST_FAILED` with no model-visible correction. The model never learns it omitted the tool name and cannot self-correct.

## Decision

Mirror the existing `TOOL_CALL_LIMIT_EXCEEDED` recovery shape (archived change `2026-07-09-refine-tool-loop-readonly-fanout`):

- **Detection**: `hasEmptyToolName(toolCalls)` checks `toolCall.toolName.trim().length === 0` for any tool call in the batch.
- **Recovery** (in `DefaultAgent`, after over-limit pre-check, before `executeToolCallsInOrder`): while `consecutiveEmptyToolNameRetries < toolCallLimitRecoveryLimit` (3), emit warn log + `DEGRADATION_NOTICE(TOOL_NAME_EMPTY)` + correction message, `continue` to next round. The empty-name batch is NOT persisted (no `appendAssistantToolUseMessage`), preserving the tool_use/tool_result pairing invariant.
- **Backstop guard** (in `executeToolCallsInOrder`, after limit guard, before `appendAssistantToolUseMessage`): `hasEmptyToolName` throws `TOOL_NAME_EMPTY` with warn log. This catches the exhaustion fall-through and any caller that bypasses the `DefaultAgent` pre-check.
- **Counter reset**: `consecutiveEmptyToolNameRetries = 0` in the `else` branch when no empty names are detected, identical to `consecutiveToolCallLimitRetries`.

## Safe logging

`buildToolCallBatchLogEntries` reuses `toolArgumentLogFields` with `failure_snapshot` mode. Because `brand("")` throws, a `toBrandedCapabilityId` helper falls back to `brand("unknown")` for empty names so the diagnostic log path never throws on the very condition it is logging. `toolInputPreview` and `toolSafeSummary` remain sanitized regardless.

## Ordering with over-limit

The over-limit check runs first. If a batch is both over-limit and has empty names, the over-limit recovery handles it and the empty-name counter does not increment. Only when over-limit recovery is exhausted does the empty-name check run. This is acceptable: quantity is corrected before quality.

## What is NOT changing

- No new Web API, gateway contract, persistence owner, or capability contract.
- No change to `brand()` semantics (it still throws on empty; the fix avoids branding empty names in log fields).
- The `TOOL_CALL_LIMIT_EXCEEDED` recovery path is unchanged.
- No speculative handling of malformed tool arguments or other model-output defects beyond empty tool names.

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-5.2-调用能力` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/ts-minimal-agent-kernel/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
