## 1. Contract and Composition

- [x] 1.1 Add public `ModelGatewayProvider` contract beside `ModelInvocationService`.
  验证：`npm run build`
- [x] 1.2 Add trusted product app composition support for `modelGatewayProviders` when `modelProviderKind="MODEL_GATEWAY"`.
  验证：`npm run build`
- [x] 1.3 Fail fast unless `MODEL_GATEWAY` is backed by a remote gateway selection and exactly one matching provider.
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/main-path.test.ts -t MODEL_GATEWAY --maxWorkers=1`
- [x] 1.4 Replace single-provider default model service selection with a provider-kind dispatcher that supports `OPENAI` primary plus `MODEL_GATEWAY` fallback profiles.
  验证：`vitest run packages/agent-model/tests/provider-kind-dispatcher.test.ts && npx vitest run --config vitest.config.release.ts tests/agent-kernel/main-path.test.ts -t "MODEL_GATEWAY|provider-kind dispatcher" --maxWorkers=1`

## 2. Verification

- [x] 2.1 Cover the remote `MODEL_GATEWAY` black-box path from product app startup through model invocation.
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/main-path.test.ts -t MODEL_GATEWAY --maxWorkers=1`
- [x] 2.2 Confirm TypeScript workspace build passes after the public contract addition.
  验证：`npm run build`
- [x] 2.3 Cover dispatcher preparation when an `OPENAI` primary profile coexists with an enabled `MODEL_GATEWAY` fallback profile.
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/main-path.test.ts -t "MODEL_GATEWAY|provider-kind dispatcher" --maxWorkers=1`
- [x] 2.4 Cover dispatcher behavior directly: `OPENAI` requests route to OpenRouter branch, `MODEL_GATEWAY` requests route to model gateway branch, unsupported branches return safe unavailable result.
  验证：`vitest run packages/agent-model/tests/provider-kind-dispatcher.test.ts`
- [x] 2.5 Add remote gateway reference/test-support code for `MODEL_GATEWAY` and verify the explicit remote deployment injection path routes through it.
  验证：`npx tsc -b && npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-remote/tests/remote-gateway-provider.test.ts tests/agent-kernel/main-path.test.ts -t "MODEL_GATEWAY|remote deployment model gateway" --maxWorkers=1`

## 归档前更新基线检查（非实施任务）

- 归档前同步到 `openspec/specs/model-provider-adapter/spec.md` 和 `openspec/specs/model-provider-configuration/spec.md`。
- 归档前如需长期设计落点，同步到 `openspec/designs/modules/agent-model.md` 与 `openspec/designs/modules/agent-app.md`。
