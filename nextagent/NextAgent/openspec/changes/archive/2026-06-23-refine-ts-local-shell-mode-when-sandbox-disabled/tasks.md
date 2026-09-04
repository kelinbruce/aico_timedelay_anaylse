## 1. Spec

- [x] 1.1 更新 `app-config-schema`，明确 `sandbox.enabled=false` 的 local trusted shell mode 语义。
  验证：`openspec validate refine-ts-local-shell-mode-when-sandbox-disabled --strict`

- [x] 1.2 更新 `bash-tool`，明确 `enabled=false` 时允许 shell built-in / chaining，但仍通过 sandbox dependency。
  验证：`openspec validate refine-ts-local-shell-mode-when-sandbox-disabled --strict`

- [x] 1.3 更新 `sandbox-runtime`，明确 local restricted sandbox 在 `enabled=false` 时走受控 shell interpreter。
  验证：`openspec validate refine-ts-local-shell-mode-when-sandbox-disabled --strict`

## 2. Implementation

- [x] 2.1 在 `agent-platform-gateway-local` 为 `enabled=false` + `bash` 增加 trusted shell mode 执行路径。
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`

- [x] 2.2 在 `agent-capability` 增加 `enabled=false` 时保留 shell operator token 的回归测试。
  验证：`npx vitest run packages/agent-capability/tests/bash-capability.test.ts`

## 3. Validation

- [x] 3.1 `openspec validate refine-ts-local-shell-mode-when-sandbox-disabled --strict`
- [x] 3.2 `npx vitest run packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`
- [x] 3.3 `npx vitest run packages/agent-capability/tests/bash-capability.test.ts`
