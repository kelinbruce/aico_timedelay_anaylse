## 1. Restricted local sandbox rejection classification

- [x] 1.1 在 `agent-platform-gateway-local` 将 restricted local sandbox 的 unsupported executable、unsafe path、unsafe request 与真正 unavailable 分离，并输出稳定 rejection reason。
  验证：`packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`

- [x] 1.2 将 restricted local sandbox observability 从单一 unavailable 事件细化为 rejected / unavailable 两类安全事件。
  验证：定向 vitest 运行与日志检查

## 2. Capability safe error mapping

- [x] 2.1 在 `agent-app` 将 `unsupported-executable` 映射回既有 `COMMAND_NOT_ALLOWED`。
  验证：`tests/agent-kernel/config-assembly.test.ts`

- [x] 2.2 在 `agent-app` 将 `unsafe-path` 映射回既有 `CAPABILITY_PATH_REJECTED`。
  验证：定向 sandbox tests

## 3. Validation

- [x] 3.1 运行 `npm run build`
- [x] 3.2 运行 `npm test`
- [x] 3.3 运行 `npm run test:contract`
- [x] 3.4 运行 `npm run lint:architecture`
- [x] 3.5 运行 `openspec validate refine-ts-sandbox-rejection-mapping --strict`
- [x] 3.6 运行 `openspec validate --all --strict`
