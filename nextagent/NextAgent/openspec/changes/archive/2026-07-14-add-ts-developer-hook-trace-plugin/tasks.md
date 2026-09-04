## 1. SDK-only developer hook 插件

- [x] 1.1 在 `agent-plugin-sdk` 新增 developer hook trace 插件构造函数和公开导出。
  验证：`npx vitest run packages/agent-plugin-sdk/tests/plugin-sdk.test.ts --maxWorkers=8`、`npm run build -w @nextagent/agent-plugin-sdk`
  来源：`developer-hook-trace-logging` Requirement: SDK provides developer hook trace plugin definition

- [x] 1.2 插件贡献 observe-only hook，覆盖模型调用前后和 capability 调用前后四个 stage。
  验证：`packages/agent-plugin-sdk/tests/plugin-sdk.test.ts`
  来源：`developer-hook-trace-logging` Requirement: SDK provides developer hook trace plugin definition

- [x] 1.3 hook 将现有 `HookInput` 的坐标和 boundary 组装为 `DEVELOPER_HOOK_TRACE` entry，调用传入 log sink；disabled 或 sink 失败时仍 PASS。
  验证：`packages/agent-plugin-sdk/tests/plugin-sdk.test.ts`
  来源：`developer-hook-trace-logging` Requirement: SDK developer hook trace logging is observe-only

- [x] 1.4 提供 NDJSON line formatter 和 SDK file sink helper；file sink 只写调用方传入的 `logDirectory`，并拒绝逃逸路径。
  验证：`packages/agent-plugin-sdk/tests/plugin-sdk.test.ts`
  来源：`developer-hook-trace-logging` Requirement: SDK developer hook trace logging is caller-owned

- [x] 1.5 提供正式 plugin artifact 写出 helper，生成 `plugin.json + index.js`，供现有 app plugin loader 通过 system config `plugins[]` 加载，并通过 Agent `hooks[]` 激活。
  验证：`npx vitest run packages/agent-plugin-sdk/tests/plugin-sdk.test.ts --maxWorkers=8` 7 tests passed；`npx vitest run packages/agent-plugin-sdk/tests/plugin-sdk.test.ts packages/agent-plugin-sdk/tests/plugin-scaffold.test.ts --maxWorkers=8` 9 tests passed；`npm run build -w @nextagent/agent-plugin-sdk` passed
  来源：`developer-hook-trace-logging` Requirement: SDK can write a formal developer hook trace plugin artifact

- [x] 1.6 增加 e2e 用例，验证生成的 developer hook trace artifact 经 system config `plugins[]` 加载、目标 Agent `hooks[]` 激活后，在真实请求模型调用路径写出 `DEVELOPER_HOOK_TRACE` NDJSON。
  验证：`npx vitest run --config vitest.config.release.ts tests/e2e/developer-hook-trace-plugin-product-path.test.ts --maxWorkers=8` 1 test passed
  来源：`developer-hook-trace-logging` Requirement: SDK can write a formal developer hook trace plugin artifact

- [x] 1.7 在 developer 文档中补充 developer hook trace 的 artifact 生成、system config、Agent hook activation、日志输出和黑盒效果说明。
  验证：文档审阅；`openspec validate add-ts-developer-hook-trace-plugin --strict` passed
  来源：`developer-hook-trace-logging` Requirement: SDK can write a formal developer hook trace plugin artifact

- [x] 1.8 本地 runtime 打包默认预置 `config/plugins/developer-hook-trace/` artifact，但不在 package config sample 声明 `nextAgent.system.plugins[]`，也不修改默认 Agent hook activation。
  验证：`npx vitest run --config vitest.config.release.ts tests/fullstack-packaging-boundary.test.ts --maxWorkers=8` passed；release package gate `e2e-P0-26` 覆盖候选包 artifact 与 config sample inactive 断言
  来源：`developer-hook-trace-logging` Requirement: Local runtime packaging includes developer hook trace artifact without default activation

## 2. 收尾验证

- [x] 2.1 运行 OpenSpec strict validation 和 SDK package build/test。
  验证：`openspec validate add-ts-developer-hook-trace-plugin --strict` passed；`openspec validate --all --strict` 188 passed, 0 failed；`npx vitest run packages/agent-plugin-sdk/tests/plugin-sdk.test.ts --maxWorkers=8` 7 tests passed；`npx vitest run packages/agent-plugin-sdk/tests/plugin-sdk.test.ts packages/agent-plugin-sdk/tests/plugin-scaffold.test.ts --maxWorkers=8` 9 tests passed；`npx vitest run --config vitest.config.release.ts tests/e2e/developer-hook-trace-plugin-product-path.test.ts --maxWorkers=8` 1 test passed；`npx vitest run --config vitest.config.release.ts tests/fullstack-packaging-boundary.test.ts --maxWorkers=8` passed；`npm run build -w @nextagent/agent-plugin-sdk` passed
