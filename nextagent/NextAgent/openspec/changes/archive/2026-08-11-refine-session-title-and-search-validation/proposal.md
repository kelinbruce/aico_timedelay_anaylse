# Proposal: Refine session title and history search validation

## Background

Three user-visible defects exist around session title rename, session history
search keyword validation, and composer stop-button state across session
switches:

1. Session rename rejects titles shorter than 4 characters and accepts
   whitespace-only titles (spaces/tabs), because validation checks the raw
   string without trimming.
2. Session history search rejects 1-character keywords and all-ASCII
   2-character keywords, and the warning tooltip uses technical wording
   ("ASCII 至少 3 个字符…") that non-technical users cannot understand.
3. While a request runs in session A, switching to session B keeps the
   composer button in "停止运行" state, and switching back to A keeps it even
   after A's request has ended. The composer button must reflect the actual
   state of the session currently being viewed.

## What Changes

1. Session title validation trims the submitted title before validation and
   persistence, requires 1-100 characters after trimming, and rejects
   whitespace-only titles. The previous "empty string clears the title"
   behavior is removed: an empty-after-trim title is rejected.
2. Session history search keyword validation only requires a trim-non-empty
   keyword of at most 50 Unicode code points. The ASCII/non-ASCII minimum
   length rules are removed from both the Web API validation and the frontend
   guard. The over-length warning tooltip uses plain, non-technical wording.
3. The frontend request store tracks which session the in-flight request
   belongs to. The composer executing/stop state is shown only when the
   tracked session is the session currently being viewed. On session entry,
   after the fresh conversation snapshot resolves, a stale tracked "accepted"
   state for that session is settled when the backend reports no `activeRun`.

## Why

1. A 1-3 character title (e.g. "告警") is a legitimate session name; rejecting
   it blocks normal use. Persisting whitespace-only titles produces invisible
   titles.
2. Single-character search (e.g. "网", "5G") is a legitimate search; the
   minimum-length rule and the ASCII jargon in the tooltip are product
   defects for non-technical users.
3. Showing "停止运行" for a session whose request is not running is
   misleading, and blocking the send button on an unrelated session breaks
   the conversation flow.

## Impact

- `agent-session`: `updateTitle` validation trims, enforces 1-100 after trim,
  rejects whitespace-only, persists the trimmed title; the empty-string clear
  behavior is removed.
- `agent-channel-web`: session list `q` validation drops the ASCII/non-ASCII
  minimum length rules; only trim-non-empty and at most 50 Unicode code
  points is enforced.
- `frontend/agent-web`: rename error copy, search keyword guard and tooltip
  copy, request store session tracking, ChatPage composer gating, and
  session-entry stale-state reconciliation.
- `frontend/agent-web-mock-server`: mirror the updated `q` validation rule.
- Specs: `session-title-update`, `session-history-search`,
  `ts-minimal-agent-kernel` requirement deltas.
