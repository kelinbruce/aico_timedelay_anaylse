## 1. Runtime logging contract

- [x] 1.1 Add `RuntimeLogSink`, `RuntimeLogger`, `RuntimeLoggerOptions`, `noopRuntimeLogger`, and concrete logger factory exports to `agent-common`.
  验证：`npm test -- packages/agent-common tests/agent-kernel/logging.test.ts`
- [x] 1.2 Re-export the shared logger factory from `agent-observability` without moving structured log projector ownership.
  验证：`npm run build`

## 2. Business package adoption

- [x] 2.1 Replace duplicated runtime/context diagnostic logger interfaces with aliases from `agent-common`.
  验证：`npm test -- packages/agent-common tests/agent-kernel/logging.test.ts`
- [x] 2.2 Update app composition to create the common runtime logger and pass it separately from structured log projector wiring.
  验证：`npm test -- tests/agent-kernel/logging.test.ts`

## 3. Regression

- [x] 3.1 Run architecture and OpenSpec validation.
  验证：`npm run lint:architecture`、`openspec validate --all --strict`
- [x] 3.2 Run build.
  验证：`npm run build`
