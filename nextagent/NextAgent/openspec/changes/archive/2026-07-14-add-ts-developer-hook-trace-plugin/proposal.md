## 背景与问题（Why）

开发者调测 agent loop 时，需要一个可复用的 developer hook 插件定义，用于观察模型调用前后和工具调用前后的 raw hook boundary，并把这些数据交给调用方提供的日志 sink。按当前插件规范，本次只增加 SDK 内的插件代码，不修改 `agent-app`、runtime、配置 schema、host external 或默认 Agent 配置。

## 变更范围（What Changes）

- 在 `agent-plugin-sdk` 中新增独立 `developer-hook-trace` 文件，内置插件构造、NDJSON formatter、file sink 和正式 plugin artifact 写出 helper。
- 插件贡献 observe-only lifecycle hook：`developer-hook-trace.loop-raw-boundary`。
- hook 只覆盖 `BEFORE_MODEL_INVOKE`、`AFTER_MODEL_RESULT`、`BEFORE_CAPABILITY_INVOKE`、`AFTER_CAPABILITY_RESULT`。
- hook 将现有 `HookInput` 中的 stage、agent/run/request/session 坐标和 `boundary` 组装为 `DEVELOPER_HOOK_TRACE` entry，并调用调用方传入的 log sink。
- 提供 NDJSON line formatter 和 SDK 内 file sink helper，便于调用方把 entry 输出到指定 `logs` 目录。
- 提供 `plugin.json + index.js` artifact 写出 helper，使调用方可以把 `developer-hook-trace` 部署到现有 `configRoot/plugins/developer-hook-trace/`，再通过现有 system config `plugins[]` 和 Agent `hooks[]` 激活。
- 本地 runtime 打包默认把该 artifact 预置到候选包 `config/plugins/developer-hook-trace/`，但不在 package config sample 中声明插件，也不修改默认 Agent hook activation。

## 非目标（Non-Goals）

- 不新增 `developerTraceLog` host external。
- 不新增 app config、runtime command、stream event、gateway schema 或持久化表。
- 不改变 HookInput contract、lifecycle stage vocabulary 或 mutation 规则。
- 不在 SDK 内读取 app config、修改 runtime、或替调用方决定全局日志目录；file sink 的 `logDirectory` 由调用方显式传入。
- 不新增独立 artifact package、不修改 scaffold 默认模板、不自动写 system config 或 Agent activation。

## 影响范围（Impact）

- `packages/agent-plugin-sdk/src/developer-hook-trace.ts`
- `packages/agent-plugin-sdk/src/index.ts`
- `packages/agent-plugin-sdk/package.json`
- `packages/agent-plugin-sdk/tests/plugin-sdk.test.ts`
- `scripts/pack-local-runtime.mjs`
- `tests/fullstack-packaging-boundary.test.ts`
- `tests/e2e/developer-hook-trace-plugin-product-path.test.ts`
- `tests/e2e/release-package/release-package-gate.test.ts`
- `docs/developer/19-agent-plugins.md`
- `docs/developer/README.md`

## 验证入口

- `npx vitest run packages/agent-plugin-sdk/tests/plugin-sdk.test.ts packages/agent-plugin-sdk/tests/plugin-scaffold.test.ts --maxWorkers=8`
- `npm run build -w @nextagent/agent-plugin-sdk`
- `npx vitest run --config vitest.config.release.ts tests/e2e/developer-hook-trace-plugin-product-path.test.ts --maxWorkers=8`
- `npx vitest run --config vitest.config.release.ts tests/fullstack-packaging-boundary.test.ts --maxWorkers=8`
- `openspec validate add-ts-developer-hook-trace-plugin --strict`
