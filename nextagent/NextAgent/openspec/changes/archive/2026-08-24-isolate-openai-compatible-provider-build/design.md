## 设计范围

| Function | 目标变化 | 涉及 delta specs | Function 设计章节 |
|---|---|---|---|
| `FN-4.1 调用模型` | OpenAI-compatible provider registration 显式注入；`model-gateway-only` 构建物理排除其调用实现与 SDK，并在配置不兼容时 fail closed | `specs/model-invocation-contract/spec.md`、`specs/local-runtime-package/spec.md` | FN-4.1 调用模型 |

本 change 依赖已提交的 `decouple-model-config-from-openai-env-vars` 行为：`openai-compatible` 的 `baseUrl` 可缺省，未配置时服务为 `DEGRADED_READY`，模型目录为 `MODEL_PROVIDER_NOT_CONFIGURED`。该依赖不改变本 change 的默认行为。

## FN-4.1 调用模型

### 目标与规范依据

proposal 目标：默认产物不回归；OpenAI-compatible 调用实现物理隔离；`model-gateway-only` 构建不携带该实现和 `@ai-sdk/openai-compatible`；配置与构建能力不匹配时启动前 fail closed。

本 Function 的目标 Requirements：

- canonical spec：`model-invocation-contract`
- ADDED `Model provider runtime capability is explicit and build-scoped`
- legacy spec：`local-runtime-package`
- ADDED `Model Gateway-only package excludes OpenAI-compatible provider implementation`

### 当前实现

- `packages/agent-model/src/runtime/configured-model-runtime.ts` 静态 import `openai-compatible-provider.ts`，并在检测到 `openai-compatible` profile 时直接创建 registration。
- `openai-compatible-provider.ts` 同时包含 registration、runtime creation 与全部 `@ai-sdk/openai-compatible` / `ai` SDK 调用逻辑。
- `agent-app` 通过 `model-composition.ts` 调用 `createConfiguredModelRuntime`，没有 provider build capability 概念。
- 本地 runtime package 只有 `backend-only | with-frontend` profile，打包脚本完整复制 workspace package `dist` 与依赖闭包，无法按模型 provider 能力裁剪；TypeScript workspace 也只有默认 project，OpenAI-compatible 调用实现始终参与编译。
- `scripts/pack-local-runtime.mjs` 的 release config sample 仍会把 `openai-compatible.baseUrl` 改写为 `env:OPENAI_BASE_URL`，这是上一 change 的残留，且会破坏本 change 的环境变量解耦目标。

### GAP 分析

| 目标 | 当前事实 | GAP |
|---|---|---|
| 通用模型 runtime 不静态依赖 OpenAI-compatible 调用实现 | `configured-model-runtime.ts` 静态 import provider 实现 | 拆分 registration 与 invocation 实现，改为显式注入 |
| registration 可由默认装配注入、gateway-only 装配不注入 | app composition 没有 provider capability 输入 | 为 app composition 增加构建能力选项并传递给模型 runtime |
| gateway-only 产物物理排除调用实现与 SDK | 打包脚本完整复制 dist 和依赖闭包 | 增加显式打包模式，裁剪 staged manifest/export/依赖并做产物断言 |
| gateway-only 编译输入排除 OpenAI-compatible 调用实现 | `openai-compatible-provider.ts` 被 registration 的类型级动态 import 拉入默认 TypeScript project | 插件加载不产生类型级源码依赖，并为 `agent-model` / `agent-app` 提供 gateway-only TypeScript project |
| 配置不兼容时启动前失败 | 当前即使静态模块被裁掉，也可能到模块加载或首次调用才失败 | 在 model catalog 发布前校验 configured provider 与可用 registration |
| 默认产物不回归 | 默认包含 OpenAI-compatible | 保留默认 registration 注入和现有测试行为 |
| 不回归 OPENAI 环境变量解耦 | pack 脚本残留 `env:OPENAI_BASE_URL` 注入 | 移除该注入，与上一 change 保持一致 |

### 修改方案

**1. Provider registration 与 invocation 实现分离**

- `agent-model` 新增 provider-specific public export `./providers/openai-compatible`，只暴露 `createOpenAICompatibleModelProviderRegistration` 和相关 options 类型。
- 该入口文件不 import SDK，也不实现 provider 调用；它返回的 invocation service 在 `complete`/`stream` 执行时动态 import 既有 `openai-compatible-provider.ts` 的 invocation service 工厂。
- 既有 `openai-compatible-provider.ts` 保留为唯一 OpenAI-compatible SDK 调用实现文件，继续拥有 SDK import、request normalization、safe error mapping 和 result normalization。
- `ConfiguredModelRuntimeOptions` 新增 optional `openAICompatibleProviderRegistration`。`configured-model-runtime.ts` 删除 provider 静态 import；当配置包含 `openai-compatible` 且 registration 缺失时，抛出 `MODEL_PROVIDER_REGISTRATION_UNAVAILABLE`，并在 catalog 发布前终止装配。
- 这里的动态 import 是为了物理裁剪 SDK 调用实现；它只发生在已通过配置、registration 与 invocation precondition 校验后的 provider execution 阶段。

**2. App composition 显式注入 build capability**

- `CreateComposedAppOptions` / `PreparedModelComposition` 增加 `modelProviderProfile: 'DEFAULT' | 'MODEL_GATEWAY_ONLY'`，默认值为 `DEFAULT`。
- `agent-app/src/composition/model-composition.ts` 在 `DEFAULT` profile 下调用 OpenAI-compatible registration 入口并传入 `createConfiguredModelRuntime`；在 `MODEL_GATEWAY_ONLY` profile 下不注入该 registration。
- `agent-app` 只执行配置加载、依赖注入和组合，不新增 provider 调用、request normalization 或 safe error 逻辑。
- 本地 runtime package manifest 新增 optional `modelProviderProfile`，读取后传入 app composition；未声明时按 `DEFAULT` 处理。

**3. 编译插拔与打包物理排除**

- `registration.ts` 将 OpenAI-compatible invocation implementation 视为运行期可选插件模块：动态 import 使用包内固定模块坐标，不在 TypeScript 编译图中创建对实现文件的类型依赖；加载后校验模块导出的 invocation service 工厂，非法模块按安全模型错误失败。
- `agent-model/tsconfig.model-gateway-only.json` 排除 `openai-compatible-provider.ts` 与仅由其使用的 `tool-use-normalizer.ts`；默认 `tsconfig.json` 继续编译两者。
- `agent-app/tsconfig.model-gateway-only.json` 与默认 project 保持相同源码与引用，唯一差异是引用 `agent-model/tsconfig.model-gateway-only.json`，确保 app 构建不会把默认 `agent-model` project 重新带回来。
- `pack-local-runtime.mjs` 在 `--model-gateway-only` 时使用上述两个 gateway-only project 重建 workspace，清理旧 `agent-model/dist` 后编译，并在编译后断言 OpenAI-compatible invocation JS 不存在；默认打包继续使用默认 TypeScript project。

**4. 打包模式与物理排除**

- `pack-local-runtime.mjs` 新增 `--model-gateway-only` flag，可与现有 `backend-only` / `with-frontend` package profile 组合。
- `stageLocalRuntimePackage` 在该模式下把 `modelProviderProfile="model-gateway-only"` 写入 manifest。
- `stageWorkspacePackage` 支持按模型 provider build profile 裁剪：
  - 对 `@nextagent/agent-model` 删除 SDK invocation 实现文件与仅由其使用的 normalizer 文件，并从 staged `package.json` 移除 `@ai-sdk/openai-compatible` 与 `ai` dependency。
  - 保留无 SDK 的 `./providers/openai-compatible` registration export，使同步 composition 仍可显式表达该 capability；gateway-only profile 不会注入它。
  - 裁剪后重新校验 staged exports 和依赖闭包，缺文件或缺依赖必须在 archive 前 fail closed。
- `model-gateway-only` 模式在 staging 前解析 config sample；发现 `openai-compatible` provider profile 时直接失败，安全 code 为 `MODEL_PROVIDER_BUILD_PROFILE_INCOMPATIBLE`，错误只包含 provider identity 与构建能力事实。默认 `backend-only` / `with-frontend` 不裁剪、不声明 `modelProviderProfile`。
- 移除 `createReleaseConfigSample` 中 `baseUrl: 'env:OPENAI_BASE_URL'` 的注入，保持源配置原样；`OPENAI_MODEL_NAME` 的既有注入继续保留。

**5. 失败与降级边界**

| 场景 | 处理 |
|---|---|
| Default profile + `openai-compatible` 合法配置 | 注入 registration，既有调用行为不变 |
| Default profile + `openai-compatible` 未配置 `baseUrl` | 保持上一 change 的 `DEGRADED_READY` / `MODEL_PROVIDER_NOT_CONFIGURED` |
| Gateway-only + 只含 `model-gateway` | 正常装配；仍要求唯一可信 Model Gateway provider |
| Gateway-only + 任一 `openai-compatible` profile | pack/staging 或 startup fail closed，不发布 catalog；安全 code 为 `MODEL_PROVIDER_BUILD_PROFILE_INCOMPATIBLE` |
| Configured provider 缺 registration | startup fail closed，安全 code `MODEL_PROVIDER_REGISTRATION_UNAVAILABLE` |
| Default package 缺 OpenAI-compatible invocation 文件 | provider execution 返回安全模型错误；该缺件属于构建破坏，默认打包测试仍须证明正常产物包含实现 |
| Gateway-only 编译后仍出现 OpenAI-compatible invocation JS | package build 在 archive 前 fail closed，不得进入 staging |

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可维护性 | `Model Gateway-only package excludes OpenAI-compatible provider implementation` | manifest 声明能力；打包时物理裁剪 provider 文件与 SDK；裁剪后校验 exports/dependencies | 架构与 package 测试断言默认/gateway-only 产物差异 |
| 可靠性/恢复 | `Model provider runtime capability is explicit and build-scoped` | catalog 发布前校验 provider registration；不兼容配置 fail closed | 启动测试断言无 catalog、无请求接受与安全诊断 |
| 可测试性 | 两个 ADDED Requirements | registration 可注入，打包能力可用小型 staging fixture 验证 | 单元、contract、architecture、package 测试分层覆盖 |

### 备选方案（Alternatives Considered）

- 新建独立 `agent-model-openai-compatible` workspace package：物理隔离更彻底，但会新增 package owner、manifest、构建顺序和跨包契约，当前只有一个 provider 且公共契约不变，成本超过收益。
- 运行期按 `providerId` 动态发现 provider：实现少，但构建能力不可审计，也无法证明 gateway-only 产物不含 SDK，且容易把配置错误推迟到首次调用。
- 复制现有 provider 文件为 gateway stub：会造成平行实现和 fake provider，违反 fail-closed 与同形同策原则。

## 验证策略（Verification Strategy）

- **unit / contract**：默认 registration 注入、gateway-only 缺 registration 时 catalog 发布前 fail closed、未配置 provider 的既有 `DEGRADED_READY` 行为、OpenAI-compatible invocation 行为不回归。
- **integration / package**：`stageLocalRuntimePackage` 写入 `modelProviderProfile`；gateway-only staging 裁剪 provider 文件与 SDK 依赖；不兼容 config 在 archive 前失败；默认 staging 不裁剪。
- **architecture**：断言 `configured-model-runtime.ts` 不静态 import OpenAI-compatible provider；SDK import 只存在于 provider invocation 实现文件；`agent-app` 不 import provider SDK；产品路径无 `OPENAI_API_KEY` / `OPENAI_BASE_URL`。
- **build / regression**：全量 build、test、contract、architecture 和 OpenSpec strict validation；打包相关测试覆盖 release config sample 不再注入 `env:OPENAI_BASE_URL`。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/model-invocation-contract/spec.md`：新增 provider runtime capability Requirement。
- `openspec/specs/local-runtime-package/spec.md`：新增 gateway-only package exclusion Requirement。
- `openspec/designs/functions/D4-模型与上下文/D4.1-模型调用与降级/FN-4.1-调用模型.md`：更新 provider runtime capability 与构建模式摘要。
- `openspec/designs/architecture/model-provider-boundary.md`：更新 provider registration 显式注入与构建裁剪边界。
- `openspec/designs/architecture/local-runtime-packaging.md`：更新 model provider build profile 与产物断言。
- `openspec/designs/modules/agent-model.md`：更新 provider-specific public export 和 SDK 隔离。
- `openspec/designs/modules/agent-app.md`：更新 composition-only provider capability 注入。
- `openspec/designs/spec-to-design-map.md`：补充两个新增 Requirement 的映射。
- `openspec/overview.md`、Feature、ADR：无。

## 风险与取舍（Risks / Trade-offs）

- 动态 import 只隔离 SDK 调用实现，registration wrapper 仍会进入 gateway-only 产物；该 wrapper 不含 SDK 与调用逻辑，是保持同步 composition 和构建可裁剪的最小代价。
- 打包脚本需要裁剪 workspace package manifest；若未来 workspace exports 增多，必须继续以 staged manifest 校验兜底，避免出现隐藏缺失 export。
- `model-gateway-only` 仍依赖调用方提供可信 Model Gateway provider；本 change 不伪造 provider 或本地 fallback。

## 待确认问题（Open Questions）

无
