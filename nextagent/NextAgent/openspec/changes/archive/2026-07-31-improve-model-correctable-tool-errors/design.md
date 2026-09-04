# Design: Improve model-correctable Tool errors

## Decision 1: One provider-neutral schema diagnostic owner

### Current state

`BuiltinToolsExecutor` calls the existing `tool-catalog.ts` Ajv helper for input
and output validation, but input failures discard Ajv errors and return one
generic message. `ClipToolExecutor` has an existing cached Ajv validator because
it owns a separate governed CLIP execution path. Builtin semantic validators run
after schema validation and some of them also collapse distinct failures into a
generic message. `agent-core` already projects `SafeError.message` to the next
model turn as `safeError.errorMessage`.

### Target path

`agent-capability` owns one pure provider-neutral Ajv-error formatter. The
existing Tool catalog Ajv helper compiles and validates the schema, then passes
only Ajv error metadata and the input shape to that formatter. A new detailed
validation result is used by `BuiltinToolsExecutor` only for input validation;
the existing boolean helper remains unchanged for config and output validation.
The pre-existing CLIP cached validator calls the same formatter at its input
boundary, without moving CLIP registry or execution ownership.

This is the only schema-diagnostic path: executors do not branch by Tool name,
and semantic validators are used only for constraints that survive JSON Schema
validation. No public contract, composition binding, or persistence path changes.

The formatter supports the model-correctable keywords used by Tool schemas:
`required`, `type`, `additionalProperties`, `minLength`, `maxLength`, `minimum`,
`maximum`, `enum`, `minItems`, `maxItems`, and a generic safe fallback for
format/pattern/composition failures. It emits at most three deduplicated issues
and caps the final message length. It never includes Ajv `data`, rejected values,
schema regex sources, or arbitrary serialized input.

Field paths are derived only from bounded JSON Pointer segments. Property names
must match a conservative identifier allowlist; oversized, malformed, or
credential-like segments are replaced by a generic field label. An object type
mismatch includes a general correction hint to pass a native JSON object rather
than a JSON-encoded string; this is not Skill-specific.

## Decision 2: Preserve failure contracts and natural model correction

Input schema failures keep their existing code (`INVALID_INPUT` for Agent and
`CAPABILITY_INPUT_INVALID` otherwise), category `VALIDATION`, and
`retryable=false`. The framework does not repeat the same invocation. The
existing Agent loop stores the failed Tool result and invokes the model again;
the model may issue a corrected Tool call after reading `errorMessage`.

No public `ToolMetadata`, `ToolDefinition`, capability contract, or Memory Tool
contract is extended. Dynamic and app-composed Tools receive the same generic
schema diagnostic behavior when they use the common executor.

## Decision 3: Semantic validators own safe corrective wording

Validation that cannot be expressed fully in JSON Schema remains at its current
implementation owner. Touched validators return a stable message that names the
safe field or constraint but not the rejected value. Initial coverage includes:

- Skill JSON serializability, depth, byte budget, and forbidden governance keys;
- Read/Write/Edit value relationships and runtime policy budgets;
- Glob syntax/expansion limits and Grep regex-safety limits;
- Python code/timeout constraints;
- Agent, ToolSearch, and Workflow unsupported-field or runtime-budget checks.

Existing already-actionable messages are retained. The change does not refactor
unrelated execution, availability, or persistence failures.

## Decision 4: Security allowlist for detail

Detailed model-visible diagnostics are allowed only for `VALIDATION` failures
that can be corrected by changing Tool arguments. The following remain coarse:

- authorization and policy decisions;
- physical/logical paths and allowed-root discovery;
- credentials, tokens, prompts, model output, attachments, and file contents;
- raw provider, sandbox, source, database, or internal exception data;
- output/result validation where detail could expose an untrusted provider
  response.

Tests use canary values to prove that rejected raw values are absent from
`SafeError.message`, `safeDetails`, and the model-visible capability payload.

## Decision 5: Scope boundary

This change does not inject, persist, render, or otherwise consume Skill
`args`. It only improves diagnostics for invalid Skill input and other
model-correctable Tool arguments.

## Failure, compatibility, and rollback

Schema compilation behavior is unchanged. Invalid inputs still fail
synchronously before Tool execution with the same code, category, and
`retryable=false`; only the safe message becomes more specific. If a keyword
cannot be rendered safely, the formatter emits a bounded generic schema message.
Authorization, output-validation, provider, and internal errors keep their
existing coarse messages.

Rollback consists of restoring the executors to the existing boolean validation
helper and the prior semantic messages. Because no contract, schema, state, or
persisted fact changes, rollback requires no data migration or compatibility
adapter.

## Verification path

Black-box capability invocation tests cover schema keyword diagnostics,
semantic constraints, non-leakage, lack of automatic retry, and a corrected
later invocation. An `agent-core` projection test verifies that the existing
result path exposes the safe text as `errorMessage`. Root build, unit, contract,
architecture, and strict OpenSpec validation provide repository gates.

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-4.1-调用模型` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/builtin-tool-framework/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
