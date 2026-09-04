# Design: Refine session title and history search validation

## Title validation: trim, then 1-100

`agent-session` `updateTitle` trims the submitted title once, validates the
trimmed value, and persists the trimmed value. Rules after trimming:

- length 0 (empty or whitespace-only, including consecutive spaces/tabs)
  is rejected with the existing `SESSION_TITLE_TOO_SHORT` SafeError code;
- length over 100 is rejected with the existing `SESSION_TITLE_TOO_LONG`
  code;
- prohibited content checks (`SESSION_TITLE_UNSAFE_CONTENT`) run on the
  trimmed value, unchanged.

Decision: the previous "empty string clears the title" behavior is removed.
The rename UI never submits an empty title (the modal disables OK on a
trim-empty draft), so the clear path was unreachable from the product and
contradicts the 1-100 rule. Keeping one uniform rule (trim, then 1-100)
avoids a special case. `titleSource = "manual"` semantics, owner-scope
checks, audit behavior, and CAS persistence are unchanged.

The Web schema (`updateTitleBody` maxLength 100) is unchanged: it operates on
the raw string and only rejects input that could never become valid after
trimming.

## Search keyword validation: trim-non-empty, at most 50 code points

Backend (`agent-channel-web` `parseQuestionSearchText`): `q.trim()` empty
means "no keyword"; any other value up to 50 Unicode code points is a legal
`questionSearchText`; over 50 code points fails Web API validation. The
ASCII >= 3 / non-ASCII >= 2 minimums are removed.

Frontend (`keywordState`): invalid only when the trimmed keyword exceeds 50
Unicode code points. The invalid state keeps the existing icon-only warning +
Tooltip presentation, but the copy is plain language ("keyword too long"),
not ASCII jargon. The mock server mirrors the same rule so local development
matches the Web contract.

The 50 code point maximum is preserved unchanged as the backend numeric
backstop.

## Composer stop-button state is session-scoped

Root cause: `requestStore.requestStatus` is a single global value. Switching
sessions does not change it, and the terminal event that would settle it only
arrives on the currently connected session stream, so a request finished
while viewing another session leaves a stale "accepted" state.

Fix:

- `requestStore` gains `activeRequestSessionId: string | null`, set wherever
  `requestStatus` becomes `submitting`/`accepted`/`canceling`/`retrying`/
  `editing` for a concrete session, and cleared when the request settles.
- ChatPage derives `isExecuting` / `isRequestControlPending` /
  `canStopRequest` only when `activeRequestSessionId` matches the routed
  session (or is unset, preserving legacy behavior).
- `hydrateFromActiveRun(sessionId, requestId)` re-hydrates when the tracked
  session differs from the viewed session, so the viewed session's
  backend-reported `activeRun` is authoritative.
- On session entry, after the entry conversation snapshot (or the opening
  live-tail reconcile) resolves, ChatPage settles a stale tracked `accepted`
  state for that session via `settleStaleSessionRequest(sessionId)` when the
  fresh snapshot reports no `activeRun`. Settling only happens after a fresh
  snapshot, never from cached state, so a just-submitted request whose
  `activeRun` has not been observed yet is not affected.

This is frontend local view state only; no Web API, stream event, runtime,
or gateway contract changes.

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-1.9-自动生成会话标题` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/session-history-search/spec.md`、`openspec/specs/session-title-update/spec.md`、`openspec/specs/ts-minimal-agent-kernel/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。

## 归档阻塞记录（2026-07-31）

- **状态：**保持 active，禁止使用 `--skip-specs`。
- **原因：**stable `session-title-update` 中找不到 `Title Content Validation` Requirement。
- **解除条件：**逐 Requirement 建立 delta、stable target、Function 与长期设计的双端映射；确认正文、元数据、Scenario 和任何 REMOVED→ADDED/MODIFIED 迁移均完整同步后，再重新执行 archive。
