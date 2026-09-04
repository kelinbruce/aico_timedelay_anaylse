## 背景与问题（Why）

`agent-app` 的 plugin 加载是受信启动期能力：系统配置 `plugins[]` 声明本地插件目录，启动时校验 manifest、bundle、host external、provider/policy/hook shape，并冻结 `PluginRegistrySnapshot` 供后续 request path 消费。当前实现只有 `createComposedAppAsync` / `createNextAgentAppAsync` 会按配置加载 plugin；同步 `createComposedApp` / `createNextAgentApp` 在配置存在 `plugins[]` 且未显式传入 `pluginRegistrySnapshot` 时直接拒绝。

这使同一份受信系统配置在同步和异步产品入口上的行为不一致。对本地 runtime、测试 harness、嵌入式启动场景而言，同步入口也是受信启动 composition 边界；只因为入口是同步函数就要求调用方提前手动准备 snapshot，会把 `agent-app` 应拥有的 loader/validation 责任外溢到调用方，并容易形成绕过正常 plugin 治理的平行路径。

## 变更范围（What Changes）

- `agent-app` 的同步启动 API 必须支持从受信 `systemConfig.pluginSystem.plugins[]` 加载 plugin，并形成与异步路径等价的冻结 `PluginRegistrySnapshot`。
- 同步和异步启动路径必须复用同一套 manifest、path containment、bundle import specifier scan、host external、plugin shape、provider/policy/hook 和 safe diagnostic 校验语义。
- `pluginRegistrySnapshot` 仍然作为 trusted preloaded input 支持；当调用方显式提供 snapshot 时，启动路径不得再次读取 plugin 目录。
- request path 不新增任何动态加载能力；启动完成后仍只消费 frozen plugin registry snapshot 和 Agent activation snapshot。
- 若同步实现需要新的 loader artifact 约束，该约束必须写入 plugin manifest/loader contract，并由 scaffold、测试 fixture 和 loader validation 一致执行。

## Capability 影响（Capabilities）

### 新增 Capability

- 无

### 修改的 Capability

- `agent-scoped-plugin-composition`: 明确同步和异步 `agent-app` 启动入口都必须支持受信配置声明的 startup plugin loading，并保持同一冻结 snapshot 与 fail-closed 治理语义。

## 影响范围（Impact）

- 代码：`packages/agent-app/src/composition/create-app.ts`、`packages/agent-app/src/plugin/plugin-loader.ts` 以及必要的 plugin test fixtures/helper。
- SDK/脚手架：如同步加载需要额外 artifact 约束，`agent-plugin-sdk` scaffold 生成的 `plugin.json` 与 build 输出需要对齐。
- 测试：新增或调整 plugin loader / composition / product-path 测试，覆盖同步入口加载 plugin、预加载 snapshot 不重复加载、invalid plugin 仍 fail closed、异步入口保持现有行为。
- 运维：plugin 仍只从受信 `configRoot` 下的系统配置路径加载；不会引入 request-time、remote URL、SkillHub-delivered plugin 或热加载能力。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/agent-scoped-plugin-composition/spec.md`：归档时合并同步和异步启动入口都支持 startup plugin loading 的行为契约。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/plugin-composition.md`：如存在该主题文档，归档时补充同步/异步启动入口共享 loader 语义；不存在则不新增平行设计文档。
- `openspec/designs/modules/agent-app.md`：归档时补充 `agent-app` 对 plugin loader/snapshot 的同步与异步入口职责。
- `openspec/designs/adr/<id>.md`：若实现引入新的 artifact 格式或 loader 取舍，归档时新增 ADR；否则无。
- `openspec/designs/spec-to-design-map.md`：如补充或新增设计文档，归档时更新导航。

验证入口：
- plugin loader 单元/契约测试。
- `createComposedApp` / `createNextAgentApp` 同步启动集成测试。
- 现有 async plugin product-path/e2e 测试。
- `openspec validate support-sync-plugin-startup-loading --strict`。
