# Live envelope lifecycle performance evidence

## Fixture and collection method

- Browser: Playwright Chromium `136.0.7103.25`, desktop viewport `1440 x 900`, reduced-motion mode.
- Before source: commit `d4149925` (change documents present, implementation not applied).
- After source: the implementation working tree for this change.
- Fixture: one recent conversation containing 200 completed Turns, followed by one live-only Run containing one accepted event, 40 animation-frame batches of five assistant deltas, and one completed event (202 live envelopes total).
- Both samples used the same dependency installation, browser binary, viewport, fixture generator, and collection script.
- Command shape: start Vite for the selected source tree, then run `node scripts/collect-live-envelope-performance.cjs <base-url> <label>`.
- The collector starts a Chrome DevTools CPU trace after all 200 historical Turns are visible, appends the latest Run on animation frames, waits for its final content, then records sampled call frames and complete-event durations.

## Trace comparison

Before (`d4149925`):

- Fixture elapsed time: `17,407 ms`.
- CPU samples: `34,523`.
- `FunctionCall`: 319 events, `17,016.88 ms` total, `667.56 ms` maximum.
- `FireAnimationFrame`: 93 events, `16,660.09 ms` total, `668.05 ms` maximum.
- Sampled relevant stacks included `deduplicateEnvelopes` in `conversationStore`, `compareEnvelopesChronologically` / root grouping in `buildTurnBlocks`, `ChatPage`, and `TurnBlock`.

After:

- Fixture elapsed time: `17,873 ms`.
- CPU samples: `34,942`.
- `FunctionCall`: 313 events, `17,459.25 ms` total, `831.22 ms` maximum.
- `FireAnimationFrame`: 92 events, `16,681.59 ms` total, `832.02 ms` maximum.
- Sampled relevant stacks no longer contain the old session-array `deduplicateEnvelopes` / combined rebuild path. The remaining frontend samples are in the explicit bucket/cache owner and current active-Turn projection/render work (`withSessionCacheUpdate`, `appendLiveEnvelopes`, `buildLiveOnlyTurnBlocks`, `TurnBlockContent`).

The after trace is not a blanket latency improvement: this 200-Turn development build still has long animation-frame work, and the sampled remainder is in current-Turn rendering/typewriter/layout plus React development overhead. That work is outside this change's scope and is not presented as fixed. The acceptance result here is narrower: the removed combined session-array rebuild is absent from the after stack, and historical projection/render stability is locked separately below.

## Turn render counter and projection stability

`tests/MessageList.render-stability.test.tsx` renders 200 settled Turn blocks plus one active block, replaces only the active block, and records component render counts through the mocked memoized `TurnBlockComponent` boundary:

- Each of the 200 historical roots renders exactly once.
- The active root renders twice (initial value and appended live value).
- `tests/chat-page.route-state.test.tsx` also records history and settled projection calls and asserts that neither the first accepted envelope nor following active batches rebuild the history base or settled overlay.

Verification commands:

```text
npm test -- tests/MessageList.render-stability.test.tsx
npm test -- tests/chat-page.route-state.test.tsx
```

This separates the proven lifecycle objective from the remaining current-Turn rendering cost: continuing active append does not fan out historical Turn renders or rerun the history-base/settled projection, while Markdown/process/layout optimization remains a follow-up concern outside this change.

## Post-merge background-task and capacity revalidation

Remote `main` added a stream-derived background-task header monitor. Its first merged form subscribed to the conversation store and flattened and sorted all active and settled envelopes whenever either map changed. The post-merge fix keeps the same public task behavior but routes only `BACKGROUND_TASK_STARTED`, `BACKGROUND_TASK_COMPLETED`, and `BACKGROUND_TASK_FAILED` through `backgroundTaskStore` by `sessionId` and `taskId`. The monitor now reads that task projection plus one list seed; an ordinary conversation envelope returns before a Zustand state publication.

The final 202-envelope trace used the same 200 historical Turns and 40-by-5 live batches as the comparison above:

- Fixture elapsed time: `18,418 ms`; final visible Turn count: `201`.
- `FireAnimationFrame`: 93 events, `16,843.62 ms` total, `658.90 ms` maximum.
- Sampled frontend frames remained in the current Turn and its projection (`TurnBlock`, `useTypewriterContent`, `buildLiveOnlyTurnBlocks`, `appendLiveEnvelopes`).
- No sampled frame referenced `BackgroundTaskHeaderMonitor`, task derivation, or background-task conversation-envelope flattening.

A second capacity trace ran 101-by-5 live batches, for 507 accepted live envelopes:

- Fixture elapsed time: `41,463 ms`; the collector observed the final `token-506`, then terminal settlement still left `201` visible Turns.
- `FireAnimationFrame`: 226 events, `39,625.48 ms` total, `579.59 ms` maximum.
- The sampled remainder was current-Turn `ChatPage`, `TurnBlock`, `buildTurnBlocks`, store append work, React development overhead, and GC. No background-task monitor or task derivation frame returned.

This does not claim that rAF long tasks are eliminated. It proves that the newly merged hidden monitor is no longer a per-delta cross-Turn amplifier. The remaining long task is dominated by the currently growing Turn and browser/React rendering work, which is the explicit follow-up boundary in design decision 8.

## Browser journeys and request behavior

- A real backend session with a prompt requesting 700 numbered lines rendered 148 assistant line markers. The canonical conversation response also contained 148 markers and ended before `LINE-0700`; reloading preserved the same completed answer. The missing requested lines were therefore not removed by frontend live-to-settled migration.
- A second real backend request was reloaded while `执行详情 · 执行中` was visible. After reload, the active process detail and newly arriving answer remained visible and continued until the backend committed terminal history. Before reload, after terminal, expanding the settled detail still contained both the beginning and end of the accepted thinking text. A later full page reload rebuilt only committed final content, as required by the change's explicit in-memory cache boundary; persisted process replay is not implemented by this change.
- The second request's canonical history ended in `SECTION-04` and the UI showed the same endpoint. This was a backend/provider output-limit result, not a frontend projection truncation.
- Browser console inspection after the long-response and reload journeys contained no error and no captured `[Violation]` entry. This is supporting evidence only; the CPU traces above remain the performance authority.
- The anchored browser test now asserts exactly two conversation requests: the initial anchored window and the user's explicit return to recent. Terminal settlement adds no conversation refresh. It also asserts exactly one background-task list seed for the session. Edit/retry tests keep a session stream open across the operation and verify each newer attempt replaces only the prior visible attempt.
- Fixed absolute envelope timestamps in the edit/retry and anchored fixtures had aged outside the product's five-second pending-envelope association window. Replacing only those fixture timestamps with runtime timestamps prevents false server-originated-run classification and the artificial extra conversation refresh without weakening the product replay boundary.
