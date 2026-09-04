# Design: Refine TS empty terminal output guard

## Current State

The ordinary `DefaultAgent` model loop accumulates visible model text separately from reasoning. When a model returns no visible content and no tool calls, Agent Core synthesizes retryable `MODEL_EMPTY_OUTPUT` and immediately evaluates configured fallback routes. A reasoning-only `finishReason="stop"` therefore fails when no fallback route is configured, even though a same-model corrective instruction could still produce a visible answer or tool call.

If model-result recovery is exhausted, Agent Core surfaces `MODEL_EMPTY_OUTPUT`. Separately, `assertTerminalContentPresent()` protects the Agent Core terminal-readiness boundary, and runtime `commitTerminalOutcome()` defensively converts any bypassed empty or whitespace-only `COMPLETED` terminal outcome into safe `FAILED` with `MODEL_FINAL_CONTENT_EMPTY`.

The existing output-token recovery remains distinct: `finishReason="length"` first uses output-budget escalation or continuation. Reasoning-only recovery applies only after a model finishes with `finishReason="stop"`.

## Target Path

The target implementation extends the existing Agent Core output-recovery boundary and preserves the terminal commit backstop:

1. `agent-core/src/model/model-output-recovery.ts` owns one fixed provider-neutral correction that appends a trusted harness-generated model message. It does not include or expose the model's reasoning.
2. `DefaultAgent` detects `finishReason="stop"` with non-whitespace reasoning, no visible content produced anywhere in the current route, no tool calls, and no safe error. It invokes the same routed model exactly once with the corrective request. Lifecycle hooks, cancellation, timeout, and the run deadline continue to apply to that invocation.
3. If the corrective result contains visible content or tool calls, the existing agent loop continues normally. If it remains empty, Agent Core synthesizes `MODEL_EMPTY_OUTPUT` and evaluates the existing `ModelFallbackOrchestrator`.
4. Fallback is unchanged and is attempted only when its existing replay, cancellation, deadline, budget, route-availability, and route-exhaustion checks permit it. A fallback model does not receive another reasoning-only corrective invocation within the same planning round.
5. A completely empty response without reasoning does not receive the corrective invocation; it continues directly to the existing `MODEL_EMPTY_OUTPUT` fallback path.
6. `agent-core` keeps the primary terminal content check. `assertTerminalContentPresent()` rejects empty or whitespace-only terminal content with `MODEL_FINAL_CONTENT_EMPTY`.
7. `DefaultAgent` calls a single terminal readiness helper before terminal lifecycle hooks and again after hook mutation. The helper emits `DEGRADATION_NOTICE(MODEL_FINAL_CONTENT_EMPTY)` and throws the safe retryable error.
8. `agent-runtime` keeps a defensive terminal commit guard. If any agent attempts `COMPLETED` with empty or whitespace-only terminal content, `commitTerminalOutcome()` emits `DEGRADATION_NOTICE(MODEL_FINAL_CONTENT_EMPTY)`, converts the status to `FAILED`, and persists a non-empty safe failure message.

No RAG, memory, provider adapter, Web API, stream schema, gateway contract, or public DTO changes are required. Zero-result retrieval remains a successful tool result; only the final assistant terminal content is guarded.

## Failure Behavior

The correction is bounded to one trusted instruction per planning round. A second reasoning-only stop becomes retryable `MODEL_EMPTY_OUTPUT`; it is never silently completed and its reasoning is never converted into visible content. `MODEL_EMPTY_OUTPUT` reaches fallback only through the existing safe routing policy and otherwise fails explicitly.

`MODEL_FINAL_CONTENT_EMPTY` remains `UNAVAILABLE` and retryable at the Agent Core terminal boundary. Runtime backstop persists `Request failed safely: MODEL_FINAL_CONTENT_EMPTY` when custom or future agent paths bypass core and attempt an empty completed commit.

## Verification

- Model terminal empty output: submit request with deterministic empty model result; expect `DEGRADATION_NOTICE(MODEL_FINAL_CONTENT_EMPTY)`, `REQUEST_FAILED`, no `REQUEST_COMPLETED`, and non-empty safe history.
- Reasoning-only recovery success: first invocation returns reasoning-only with `finishReason="stop"`; expect one corrective request and then visible completion.
- Reasoning-only recovery exhaustion: two consecutive reasoning-only stops; expect exactly one corrective request, then existing fallback selection.
- Conditional fallback: with an eligible route and no visible output, expect fallback after corrective exhaustion; without a route or when an existing fallback guard denies replay, expect explicit `MODEL_EMPTY_OUTPUT`.
- Tool-call preservation: reasoning plus tool calls follows the existing tool loop without corrective retry.
- Visible continuation preservation: a reasoning-only continuation after confirmed visible output keeps the confirmed content and does not trigger semantic-empty correction or fallback replay.
- Runtime backstop: custom test agent emits whitespace final content; expect runtime converts completed terminal content to `REQUEST_FAILED` and persists failure metadata with code `MODEL_FINAL_CONTENT_EMPTY`.

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-4.1-调用模型` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/ts-minimal-agent-kernel/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
