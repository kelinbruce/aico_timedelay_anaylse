## 1. Model 调用 scope header

- [x] 1.1 为 `ModelInvocationRequest` 新增可选可信 `invocationScope`，携带 `agentId`、`sessionId`、`requestId` 和 `runId`。
  验证：`npx vitest run packages/agent-model/tests/openrouter-provider.test.ts tests/contract/core-contracts.test.ts --maxWorkers=4` 通过；`npm run test:contract` 通过。
- [x] 1.2 在 Agent Core 中从 `RequestRun` 填充 model 调用 scope。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/main-path.test.ts --maxWorkers=4` 通过。
- [x] 1.3 向 OpenRouter 出站 fetch header 注入 `X-NextAgent-Agent-Id`、`X-NextAgent-Session-Id`、`X-NextAgent-Request-Id` 和 `X-NextAgent-Run-Id`。
  验证：`npx vitest run packages/agent-model/tests/openrouter-provider.test.ts tests/contract/core-contracts.test.ts --maxWorkers=4` 通过。
- [x] 1.3.1 当可选 `invocationScope` 缺失时省略 `X-NextAgent-*` 关联 header，同时仍拒绝非法的入参 scope。
  验证：`npx vitest run packages/agent-model/tests/openrouter-provider.test.ts --maxWorkers=4` 通过。
- [x] 1.4 验证标识符不会被序列化进 provider 请求体。
  验证：`npx vitest run packages/agent-model/tests/openrouter-provider.test.ts tests/contract/core-contracts.test.ts --maxWorkers=4` 通过。
- [x] 1.5 验证产品路径 HTTP 请求把已 accepted 的坐标传播到 model 调用 scope，而不把它们加入模型可见消息。
  验证：`npx vitest run --config vitest.config.release.ts tests/e2e/model-invocation-scope.test.ts --maxWorkers=4` 通过。

## 2. 验证

- [x] 2.1 运行 `openspec validate --all --strict`。
- [x] 2.2 运行 model provider、model 请求构建器和核心 contract 的聚焦测试。
- [x] 2.3 运行 `npm run build`。
