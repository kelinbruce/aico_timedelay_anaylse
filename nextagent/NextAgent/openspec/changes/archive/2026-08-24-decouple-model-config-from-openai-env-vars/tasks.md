# Tasks

## FN-4.1 调用模型

- [x] 1.1 编写内置默认配置（无 overlay）启动成功并进入 `DEGRADED_READY` 的契约测试。来源：`FN-4.1 + 全局模型目录提供安全模型配置 + 内置默认配置未配置模型 provider`。验证：`npm test -- packages/agent-app/tests/system-config.test.ts`，断言 readiness 为 `DEGRADED_READY`、存在 `APP_CONFIG_MODEL_PROVIDER_NOT_CONFIGURED` warning evidence、`modelProfiles` 保留、无 raw secret/endpoint 泄漏；`npm run test:contract` 与 `tests/local-runtime-package.test.ts` 覆盖真实 runtime package 启动和配置 evidence。实施前确认测试失败。
- [x] 1.2 编写 `openai-compatible` 父项缺失 `baseUrl` 时相关模型目录项为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED` 的契约测试。来源：`FN-4.1 + 全局模型目录提供安全模型配置 + 未配置 provider 不影响其他 viable profile`。验证：`npm run test:contract`，断言目录项不可用且不提供 resolved configuration。
- [x] 1.3 编写 `baseUrl` 存在但非法、`credentialRef` grammar 非法时阻止 ready 的契约测试。来源：`FN-4.1 + Agent App system config 使用 canonical model/provider 配置 + openai-compatible 父项缺失 baseUrl`（非法值路径）。验证：`npm test -- packages/agent-app/tests/system-config.test.ts`，断言 access shape 违反仍为 `BLOCKED`。
- [x] 1.4 修改 `packages/agent-app/src/config/validation.ts`：`openai-compatible` 的 `baseUrl` 缺失不再阻止 ready，改为产生 `APP_CONFIG_MODEL_PROVIDER_NOT_CONFIGURED` warning；配置中无 viable 模型时进入 `DEGRADED_READY`；保留父项和子项供 assembly/catalog 使用；非法 `baseUrl` 与非法 credential 仍阻止 ready。来源：`FN-4.1 + Agent App system config 使用 canonical model/provider 配置`。验证：1.1–1.3 测试通过。
- [x] 1.5 修改 `packages/agent-contracts/src/model/index.ts`：`ModelUnavailableReason` 与 `ModelCatalogEntrySchema` 新增 `MODEL_PROVIDER_NOT_CONFIGURED`。来源：`FN-4.1 + 全局模型目录提供安全模型配置`。验证：`npm run test:contract`，新增 schema/contract 测试通过。
- [x] 1.6 修改模型目录装配：为 `baseUrl` 缺失的 `openai-compatible` 父项生成静态 `UNAVAILABLE` 目录项，reason 为 `MODEL_PROVIDER_NOT_CONFIGURED`，不触发 provider model-information 查询，不影响其他 viable profile。来源：`FN-4.1 + 全局模型目录提供安全模型配置`。验证：`npm test -- packages/agent-model`、`npm run test:contract`，1.2 测试通过。
- [x] 1.7 编写模型调用命中未配置模型时返回安全 model-unavailable failure 且不启动 provider execution 的契约测试。来源：`FN-4.1 + 全局模型目录提供安全模型配置 + 内置默认配置未配置模型 provider`。验证：`npm run test:contract`，断言 `ModelFinalResult.safeError` 且无 provider 调用/fallback。
- [x] 1.8 修改 `packages/agent-app/config/default-system.yaml`：移除 `openai-compatible` 父项的 `baseUrl` 与 `credentialRef`；保留 `OPENAI_MODEL_NAME`、推理参数和模型配置结构。来源：`proposal scope + design 修改方案 3`。验证：1.1 契约测试通过；`openspec validate --changes decouple-model-config-from-openai-env-vars --strict` 通过。
- [x] 1.9 删除 `packages/agent-app/src/config/env.ts` 的死代码 `credentialEnvNames`。来源：`design 修改方案 4`。验证：`npm run build` 通过；无 import 引用残留。
- [x] 1.10 修改 `packages/agent-app/src/testing.ts`：移除 `OPENAI_BASE_URL` 读取与 baseUrl override；`OPENAI_MODEL_NAME` override 保留，需要真实 provider 的测试显式提供接入参数。来源：`design 修改方案 4`。验证：`npm test -- packages/agent-app` 相关测试通过；`npm run build` 通过。
- [x] 1.11 修改 `packages/agent-app/src/local-runtime-package/index.ts`：移除 `baseUrl: 'env:OPENAI_BASE_URL'` 注入，直接镜像源配置；`OPENAI_MODEL_NAME` 注入保留。来源：`design 修改方案 4`。验证：`npm test -- tests/local-runtime-package.test.ts`、`npm run build` 通过。
- [x] 1.12 编写 source-level architecture 断言：产品代码不再硬编码 `OPENAI_API_KEY`/`OPENAI_BASE_URL` 作为配置生成或 override 来源；断言范围排除测试 fixture、迁移脚本和文档。来源：`design 验证策略 architecture/negative`。验证：`npm run lint:architecture` 通过。
- [x] 1.13 保留 `OPENAI_MODEL_NAME` 为可选覆盖，并在 provider 未配置且该变量缺失时解析为安全占位模型名 `default-model`，保证无 overlay 启动不被 Agent assembly 阻断。来源：`design 修改方案 3 + 内置默认配置未配置模型 provider`。验证：无 `OPENAI_MODEL_NAME` 的默认配置评估测试与真实 runtime package 启动测试通过。

## 跨 Function 整体验证

- [x] 2.1 全量后端构建与测试回归。来源：`design 验证策略`。验证：仓库根 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 全部通过。
- [x] 2.2 更新受影响文档，移除指导用户配置 `OPENAI_API_KEY`/`OPENAI_BASE_URL` 的过时说明，改为通过配置 overlay 提供 `baseUrl`/`credentialRef`，并说明未配置时服务 `DEGRADED_READY`。来源：`proposal 影响范围`。验证：`rg "OPENAI_API_KEY|OPENAI_BASE_URL"` 命中仅限测试 fixture、迁移脚本与文档迁移说明；code review 检查文档改动范围。

## 归档前基线检查（非实施任务）

- [ ] 3.1 归档前同步长期基线：`openspec/specs/model-invocation-contract/spec.md`、`openspec/specs/local-runtime-package/spec.md`、`openspec/designs/architecture/local-runtime-packaging.md`（及引用出厂默认 env 绑定的 configuration-boundary 文档）。来源：`design 长期基线刷新计划`。验证：归档流程同步基线，`openspec validate --all --strict` 通过。
