# Tasks: Preserve assistant content in tool-call rounds

## 1. Agent Core persistence

- [x] 1.1 Pass the current model round's public assistant content into normal and terminal-hook tool-call execution, while recovery execution leaves unknown content absent.
  - 来源：`Tool-call rounds preserve public assistant content for subsequent model invocation`；design「Agent Core 写入完整公开 assistant 工具消息」。
  - 验证：focused Agent Core/integration test observes a persisted hidden message and the next model request.
- [x] 1.2 Persist non-empty public content with ordered `toolCalls` in the existing hidden `ASSISTANT_TOOL_USE` message, preserving the current role、visibility、metadata、idempotency key and composite-write path.
  - 来源：同一 requirement 的 normal、empty-content 与 persistence-failure scenarios。
  - 验证：`tests/agent-kernel/tool-loop.test.ts` covers non-empty and empty content; existing message-write failure behavior remains explicit.
- [x] 1.3 Use the accepted current model invocation content for each normal and terminal-hook tool round instead of request-level cumulative `finalContent`.
  - 来源：`Tool-call rounds preserve public assistant content for subsequent model invocation` 的 consecutive-round scenario；design 的单轮 content 边界。
  - 验证：双 tool-round integration test observes two distinct persisted assistant messages.

## 2. Context rendering and recovery compatibility

- [x] 2.1 Render optional public content as the first assistant text part followed by ordered tool-call parts; retain legacy `{ toolCalls }` rendering without an empty text part.
  - 来源：`Render maps message roles and pairs tool calls with results`；design「Context Engine 还原 text + tool-call」。
  - 验证：focused Context Engine tests assert mixed、empty and legacy message shapes plus tool-result pairing.
- [x] 2.2 Characterize recovery with an assistant tool-use message that also carries public content and confirm replay decisions still use tool state/results rather than the content field.
  - 来源：design「Recovery 与兼容」。
  - 验证：`tests/agent-kernel/runtime-recovery-guard.test.ts` executes the new persisted shape and preserves existing READY/REUSE behavior.
- [x] 2.3 Add a negative assertion that reasoning is absent from the persisted assistant tool-use message and subsequent model request.
  - 来源：`Reasoning is not retained as assistant content` scenario；design 安全边界。
  - 验证：focused integration test supplies reasoning with content/tool calls and asserts persisted/model-visible shapes exclude it.
- [x] 2.4 Characterize two consecutive content-bearing tool rounds and assert the following model request receives each assistant text exactly once.
  - 来源：`Consecutive tool rounds remain distinct` scenario。
  - 验证：`tests/agent-kernel/tool-loop.test.ts` asserts both SQLite-backed messages and provider-neutral model messages.

## 3. Validation and review

- [x] 3.1 Run focused tests for tool loop、Context Engine renderer and recovery compatibility.
  - 来源：proposal impact；design 可测试性。
  - 验证：record exact Vitest commands and results before checking this task.
- [x] 3.2a Run `npm run build`、`npm test` and `npm run test:contract`.
  - 来源：AGENTS.md validation gate；design「验证与回滚」。
  - 验证：build exit 0；116 files / 1085 tests passed；39 files / 331 contract tests passed.
- [x] 3.2b Run `npm run lint:architecture`.
  - 来源：AGENTS.md validation gate；design「验证与回滚」。
  - 验证：dependency-cruiser、package manifest policy and 40 files / 242 architecture tests passed.
- [x] 3.3 Run `openspec validate --all --strict`; if the OpenSpec CLI is unavailable, record the exact environment blocker and do not represent strict validation as passed.
  - 来源：AGENTS.md OpenSpec gate；design「验证与回滚」。
  - 验证：target change strict validation exits 0；full validation reports only the unchanged `origin/main` baseline failure in `fix-agent-web-live-run-identity-recovery`.
- [x] 3.4 Complete `$nextagent-skill-review` for this change and `$nextagent-code-review` for the branch diff; resolve all blocking findings before push.
  - 来源：AGENTS.md push gate and OpenSpec authoring gate。
  - 验证：both current branch review conclusions are `PASS`; no P0-P3 findings in the branch diff.

## 4. Issue 496 correction validation

- [x] 4.1 Run the focused two-round Agent Core integration test and relevant existing tool-loop tests.
- [x] 4.1a Run the focused terminal-hook tool-round integration test.
- [x] 4.2 Run `npm run build`, `npm test`, `npm run test:contract` and `npm run lint:architecture`.
- [x] 4.3 Run `openspec validate --all --strict`, `$nextagent-skill-review` and `$nextagent-code-review`; resolve blocking findings before push.
