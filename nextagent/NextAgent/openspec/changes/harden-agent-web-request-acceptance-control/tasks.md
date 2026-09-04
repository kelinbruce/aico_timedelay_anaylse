## 1. 锁定失败行为

- [ ] 1.1 在 `requestStore.test.ts` 使用 deferred HTTP 和 fake timer 覆盖 90 秒边界、stream candidate/detail/terminal 已到达、timeout 不重发不伪造 terminal、每 action 最多一次 snapshot recovery。
  验证：`cd frontend/agent-web && npm test -- tests/requestStore.test.ts`

- [ ] 1.2 增加 session A/B tracker characterization，覆盖并行 action、切换往返、乱序 HTTP、各自 terminal 和 Stop/Cancel target。
  验证：`cd frontend/agent-web && npm test -- tests/requestStore.test.ts tests/chat-page.route-state.test.tsx`

## 2. 实现 session-scoped request control

- [ ] 2.1 为 submit、带附件 submit、retry 和 edit 增加 action-local `REQUEST_ACCEPTANCE_TIMEOUT_MS = 90_000` 和 `AbortSignal`；timeout 后最多执行一次现有 snapshot recovery，并按 active/terminal/unknown 进入 accepted、idle 或 `confirmation-timeout`。
  验证：`cd frontend/agent-web && npm test -- tests/requestStore.test.ts tests/useChatSessionStream.test.tsx`

- [ ] 2.2 将 requestStore 收敛为 `sessionId -> SessionRequestState`；所有 action、HTTP continuation、stream acceptance、terminal、activeRun hydration、notice 和 Stop/Cancel 显式更新 owning session，并清理无事实的 idle entry。
  验证：`cd frontend/agent-web && npm test -- tests/requestStore.test.ts tests/useChatSessionStream.test.tsx tests/chat-page.route-state.test.tsx`

- [ ] 2.3 在 `MessageInput`、`useChatComposerController` 和 store owner action 增加同 session single-flight gate，覆盖 send button、Enter、slash command、建议问题和 direct action，同时保留草稿编辑。
  验证：`cd frontend/agent-web && npm test -- tests/MessageInput.cancel.test.tsx tests/composer-panel.component.test.tsx tests/chat-composer-controller.single-flight.test.tsx tests/requestStore.test.ts`

## 3. 旅程与门禁

- [ ] 3.1 扩展 live-run identity browser journey，覆盖 HTTP 永不返回、same-session repeat、session A/B 并行和切换返回；使用可控 clock，不等待真实 90 秒。
  验证：`cd frontend/agent-web && npm run test:e2e -- tests/e2e/session-live-run-identity-recovery.spec.cjs`

- [ ] 3.2 运行 frontend 定向/全量 test、TypeScript build、multi-host build、strict OpenSpec validation 和语义审查；确认无 API、backend、`agent-contracts`、轮询、自动重发或 client terminal。
  验证：`cd frontend/agent-web && npm test && npm run build && npm run build:vite:modes`；根目录运行 `openspec validate --all --strict`、`git diff --check`、`$nextagent-skill-review` 和 `$nextagent-code-review`

## 归档前更新基线检查（非实施任务）

按 proposal 的 Baseline Promotion Plan 归并 stable spec、Agent Web module design 和 spec-to-design-map。
