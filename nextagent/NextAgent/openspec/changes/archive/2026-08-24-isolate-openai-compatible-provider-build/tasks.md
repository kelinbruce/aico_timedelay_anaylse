## 1. `FN-4.1 调用模型`

- [x] 1.1 编写模型 runtime 行为测试：显式注入 OpenAI-compatible registration 时默认目录和调用可用；配置 `openai-compatible` 但 registration 缺失时，catalog 发布前抛出 `MODEL_PROVIDER_REGISTRATION_UNAVAILABLE`。来源：`FN-4.1 + Model provider runtime capability is explicit and build-scoped + 默认服务继续支持 OpenAI-compatible / 缺失 provider runtime capability`。验证：先运行 `npm test -- packages/agent-model/tests/model-catalog.test.ts` 确认新增缺失 registration 用例失败，实现后同一命令通过。

- [x] 1.2 拆分 OpenAI-compatible registration 与 SDK invocation 实现：新增无 SDK import 的 provider registration 入口，`configured-model-runtime.ts` 删除 provider 静态 import 并接受显式 registration；既有 provider 行为测试改为从新的 public export 引用 registration。来源：`FN-4.1 + Model provider runtime capability is explicit and build-scoped + 默认服务继续支持 OpenAI-compatible`；design 修改方案 1。验证：`npm test -- packages/agent-model` 通过，且 OpenAI-compatible 既有 normalization / safe error 测试不回归。

- [x] 1.3 编写 app composition 测试：默认 `modelProviderProfile` 注入 OpenAI-compatible registration；`MODEL_GATEWAY_ONLY` 不注入，遇到 `openai-compatible` profile 时启动装配 fail closed，遇到合法 `model-gateway` profile 时不依赖 OpenAI-compatible registration。来源：`FN-4.1 + Model provider runtime capability is explicit and build-scoped + model-gateway-only 服务配置兼容 / model-gateway-only 服务遇到 OpenAI-compatible 配置`。验证：先运行 `npm test -- packages/agent-app/tests/model-preload-composition.test.ts` 确认 gateway-only 用例失败，实现后同一命令通过。

- [x] 1.4 实现 `agent-app` model provider build profile：composition options 与 prepared model composition 显式传递 `DEFAULT | MODEL_GATEWAY_ONLY`，默认注入 registration，gateway-only 不注入；`agent-app` 不新增 provider 调用逻辑。来源：`FN-4.1 + Model provider runtime capability is explicit and build-scoped`；design 修改方案 2。验证：`npm test -- packages/agent-app/tests/model-preload-composition.test.ts` 通过。

## 2. Local runtime package 构建隔离

- [x] 2.1 编写 package 行为测试：默认 staging 不声明 `modelProviderProfile` 且不裁剪 provider；`model-gateway-only` staging 写入 manifest、排除 OpenAI-compatible invocation 文件和 `@ai-sdk/openai-compatible` dependency；配置含 `openai-compatible` 时 staging 与 self-check fail closed。来源：`FN-4.1 + 可维护性 + Model Gateway-only package excludes OpenAI-compatible provider implementation + 构建 model-gateway-only package / model-gateway-only package 配置不兼容`。验证：先运行 `npm test -- tests/local-runtime-package.test.ts` 确认新增 gateway-only 用例失败，实现后同一命令通过。

- [x] 2.2 实现本地 runtime package 的 `--model-gateway-only` 打包模式与 manifest `modelProviderProfile`，并在启动装配时读取该能力传给 app composition；同时移除 release config sample 中 `env:OPENAI_BASE_URL` 注入残留。来源：`FN-4.1 + 可维护性 + Model Gateway-only package excludes OpenAI-compatible provider implementation`；design 修改方案 4。验证：`npm test -- tests/local-runtime-package.test.ts` 通过，且生成的默认 config sample 不含 `OPENAI_BASE_URL`。

- [x] 2.3 实现 workspace package 裁剪：gateway-only staging 删除 `@nextagent/agent-model` 的 OpenAI-compatible invocation 实现、仅由该实现使用的 normalizer 和 SDK dependency，保留无 SDK registration export，并基于裁剪后的 staged manifest 校验 runtime export 与依赖闭包。来源：`FN-4.1 + 可维护性 + Model Gateway-only package excludes OpenAI-compatible provider implementation + 排除文件破坏 runtime export`；design 修改方案 4。验证：`npm test -- tests/local-runtime-package.test.ts` 通过，断言默认与 gateway-only 产物差异。

- [x] 2.4 实现 gateway-only 编译插拔：registration 加载 invocation implementation 时不创建类型级源码依赖；`agent-model` gateway-only TypeScript project 排除 invocation implementation 与专用 normalizer，`agent-app` gateway-only project 引用裁剪后的 `agent-model` project，打包构建按模式选择 project 并断言编译输出无 invocation JS。来源：`FN-4.1 + 可维护性 + Model Gateway-only package excludes OpenAI-compatible provider implementation + 构建 model-gateway-only package`；design 修改方案 3。验证：临时移除 `openai-compatible-provider.ts` 后运行 `npm run pack:backend:model-gateway-only -- skip --config-sample <model-gateway-sample>` 通过；归档 14,897 entries，OpenAI invocation / normalizer / `@ai-sdk/openai-compatible` / `ai` 均为 0。

## 3. 架构与残留检查

- [x] 3.1 增加架构断言：通用 model runtime 不静态 import OpenAI-compatible invocation 实现；`@ai-sdk/openai-compatible` 只允许出现在 OpenAI-compatible invocation 实现文件；`agent-app` 不 import provider SDK；产品路径不出现 `OPENAI_API_KEY` / `OPENAI_BASE_URL`。来源：design 修改方案 1–4 与验证策略。验证：先运行 `npm run lint:architecture` 确认新增断言失败，实现后同一命令通过。

- [x] 3.2 增加编译插拔架构断言：gateway-only TypeScript project 排除 OpenAI-compatible invocation implementation 与专用 normalizer；app gateway-only project 引用 gateway-only `agent-model` project；registration 不使用会把实现文件拉入编译图的类型级动态 import。来源：design 修改方案 3。验证：`npm run lint:architecture` 通过（54 files / 322 tests）。

## 4. Change 整体验证

- [x] 4.1 运行全量后端构建与回归。来源：proposal 影响范围 + design 验证策略。验证：仓库根 `npm run build`、`npm test` 全部通过。

- [x] 4.2 运行契约、架构与 OpenSpec 门禁。来源：proposal 影响范围 + design 验证策略。验证：仓库根 `npm run test:contract`、`npm run lint:architecture`、`openspec validate --changes isolate-openai-compatible-provider-build --strict` 全部通过。

- [x] 4.3 复验 gateway-only 编译插拔与默认回归。来源：proposal 目标 + design 修改方案 3–4。验证：默认 `npm run build` 通过；`npm test` 通过（171 files / 2,204 tests）；`npm run test:contract` 通过（50 files / 388 tests）；真实 gateway-only 删码构建与归档自检通过且 OpenAI-compatible invocation / SDK artifacts 为 0。

## 归档前更新基线检查（非实施任务）

- 归档时按 `design.md` 的“长期基线刷新计划”同步 stable specs、Function、architecture、modules 和 spec-to-design-map，并运行 `openspec validate --all --strict`。
