## 背景和现状（Context）

`agent-scoped-plugin-composition` 的稳定行为要求 plugin 只在 `agent-app` 受信启动期加载，形成 frozen `PluginRegistrySnapshot`，request path 只能消费 snapshot 与 Agent activation。当前代码已经实现 loader、manifest validation、path containment、static import specifier scan、host external injection 和 plugin shape validation，但加载实现依赖 `await import(pathToFileURL(mainPath).href)`，因此只有 `createComposedAppAsync` / `createNextAgentAppAsync` 可以按配置加载 plugin。

同步 `createComposedApp` / `createNextAgentApp` 当前遇到 `systemConfig.pluginSystem.plugins[]` 且没有 `pluginRegistrySnapshot` 时抛出 `PLUGIN_REGISTRY_REQUIRED`。这不是产品规格的目标边界，而是 loader 实现选择造成的 implementation-vs-spec gap：同一个受信启动配置在同步和异步 API 上表现不一致。

关键技术约束是 Node ESM dynamic import 天然异步，不能在同步函数里等待。若直接把同步 API 改成异步或要求调用方手工传 snapshot，会继续违背“同步入口也支持该能力”的目标。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 同步和异步 `agent-app` 启动入口都能在未提供 `pluginRegistrySnapshot` 时，从受信 `plugins[]` 加载 plugin。
- 同步和异步入口复用同一个 loader validation、bundle scan 和 default export extraction；异步入口保留 async plugin factory support，避免平行治理或既有 async contract 倒退。
- 保留 `pluginRegistrySnapshot` 作为 trusted preloaded input；显式传入 snapshot 时不得读取 plugin 目录。
- 保留 startup-only 边界，request path 不新增动态加载能力。

**非目标：**

- 不支持 request-time plugin loading、hot reload、remote URL plugin、SkillHub-delivered plugin 或 Agent package 未授权路径加载。
- 不引入 CJS artifact、第二套 manifest 格式或新的 plugin registry 持久化。
- 不放宽 single-file bundle、path containment、host external inventory 或 static import specifier scan。
- 不把 plugin 执行迁入 sandbox gateway；当前 plugin loading 仍是受信启动 composition 能力。

## 设计决策（Decisions）

### D1：保留 `artifactType: "esm-bundle"`，loader 改为同步物化 default export

唯一实现路径：`plugin-loader.ts` 新增同步 loader 入口，`loadPluginRegistrySnapshotSync(entries, configRoot)` 负责完整读取、扫描、同步物化、校验和 deep freeze；现有 `loadPluginRegistrySnapshot(...)` 保持 async 入口，复用同一套读取、扫描、default export extraction 和 shape validation，但通过 async materializer 继续支持返回 `Promise<NextAgentPlugin>` 的 plugin factory。

同步核心读取 `.js` bundle 文本后先执行现有 import specifier scan。扫描通过后，loader 只接受两类 default export 形态：

- `export default <expression>;`
- esbuild 单文件 ESM 常见输出：`export { <local> as default };`

loader 将 default export 物化为内部 `exported` 值后继续走 materializer 和 `validatePluginShape(...)`。同步入口使用 `materializePlugin(...)`，当 factory 返回 Promise 时 fail closed 并产生 safe diagnostic；异步入口使用 `materializePluginAsync(...)`，继续 await `NextAgentPluginFactory` 的 Promise 返回值。plugin 的 provider discovery/executor/policy/hook 方法本身仍可按其 public contract 保持 async。

该方案放弃继续使用 Node ESM dynamic import，原因是它无法满足同步 API。该方案也不新增 CJS/IIFE artifact，原因是现有 scaffold、fixtures 和 stable spec 都围绕单文件 ESM bundle；新增 artifact 会扩大迁移面并形成两套治理。

### D2：`createComposedApp` 自行加载 snapshot，`createComposedAppAsync` 不重复加载

`createComposedApp` 删除 `PLUGIN_REGISTRY_REQUIRED` guard。当 options 未提供 `pluginRegistrySnapshot` 时，它调用 `loadPluginRegistrySnapshotSync(systemConfig.pluginSystem.plugins, systemConfig.paths.configRoot)`；没有 plugins 时仍返回 empty snapshot。

`createComposedAppAsync` 保持 public async 形态，但在未提供 snapshot 时调用 async loader，允许 async plugin factory 在启动期完成 materialization。随后 async path 继续调用 `createComposedApp({ pluginRegistrySnapshot })`，避免二次读取。

显式提供 `pluginRegistrySnapshot` 的路径保持不变：composition 只消费 snapshot，不读 plugin directory。这同时支持测试和受信外部预加载场景。

### D3：loader transformation 是 plugin-loader 私有实现，不成为 plugin author API

plugin author contract 仍是单文件 `.js` ESM bundle。loader 内部只为提取 default export 做最小转换；不支持 named runtime exports、module namespace 行为、top-level await 或保留 import/export graph。任何 residual import specifier 继续 fail closed。

插件需要 top-level await 或完整 ESM module graph 时，应把异步行为放在 provider discovery/executor/policy/hook public async method 中，而不是依赖 module loader 语义作为 startup loading 前置条件。返回 `Promise<NextAgentPlugin>` 的 plugin factory 只由异步启动入口支持；同步启动入口必须可同步形成 frozen snapshot。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 加载 authority 仍只来自 trusted system config；path containment、manifest schema、host external inventory、runtime import specifier scan 和 safe diagnostic 规则不变。同步 evaluator 不引入 request-body、model output 或 remote source 权限。 | plugin-loader negative tests；sync composition invalid plugin test；code review 检查 request path 不调用 loader |
| 性能/容量 | loader 仍最多处理 8 个 plugin，读取单文件 bundle 并物化，启动成本有上限；preloaded snapshot 路径不重复扫描。 | plugin-loader limit tests；composition tests 断言预加载 snapshot 不重复读取 |
| 可靠性/恢复 | invalid plugin 在 app readiness 前 fail closed；required plugin 失败仍阻断启动，optional plugin 失败产生诊断并跳过。同步可物化插件在同步/异步入口结果等价；async factory 只在异步入口 await。 | sync/async loader tests；composition fail-closed tests |
| 可维护性 | 共享 bundle 读取、scan、default export extraction 和 shape validation，`create-app.ts` 只选择 snapshot 来源；不新增 artifact type 或 parallel manifest contract。 | `npm run lint:architecture`；plugin-loader focused tests |
| 可测试性 | fixture 可直接写 ESM-shaped bundle；新增同步 `createComposedApp` 集成测试覆盖 product behavior，loader 单元测试覆盖 export 形态。 | `vitest run packages/agent-app/tests/plugin-loader.test.ts packages/agent-app/tests/composition.test.ts` |
| 审计/可追溯性 | 本 change 不新增 runtime event 或持久化事实；现有 safe diagnostics 保留 plugin id、reason code、bounded summary。 | plugin diagnostic assertions；code review 检查不记录 bundle source、paths、raw errors |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 同步入口未提供 snapshot 时从 `plugins[]` 加载 plugin | 2.1, 3.1 | sync composition/product test |
| 异步入口保留 async plugin factory support | 1.3, 2.2, 3.2 | plugin-host-externals async factory test；existing async plugin loader/e2e tests |
| 显式 `pluginRegistrySnapshot` 不触发目录读取 | 2.3, 3.3 | composition test with missing plugin dir and provided snapshot |
| invalid plugin 同步/异步都 fail closed | 2.4, 3.4 | plugin-loader negative tests |
| request path 不新增动态加载能力 | 2.5, 3.5 | source review / architecture grep |
| OpenSpec delta 有效 | 4.1 | `openspec validate support-sync-plugin-startup-loading --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/agent-scoped-plugin-composition/spec.md` 主承载 startup plugin loading、sync/async entrypoint consistency、frozen snapshot 和 fail-closed 行为。
- 架构和跨模块设计：如已有 plugin composition architecture 文档，归档时承载 loader 与 app composition 的跨模块流程；没有则不新增平行主题。
- 模块设计：`openspec/designs/modules/agent-app.md` 归档时承载 `agent-app` 对 plugin loader/snapshot 的模块职责。
- ADR：若归档时认为“同步物化 ESM-shaped default export”是长期关键取舍，则新增 ADR；否则由 module design 承载。
- 导航：若新增或更新长期设计文档，更新 `openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [风险] loader 私有转换对任意 ESM 语法不是完整 module loader。-> 缓解方式：plugin artifact contract 本来要求单文件 bundle 且无 runtime import specifier；loader 只承诺 default export extraction，unsupported export shape fail closed，并通过 scaffold/esbuild 输出和 fixtures 测试覆盖。
- [风险] 同步 evaluator 执行 plugin top-level code。-> 缓解方式：这与当前 dynamic import 的启动期执行模型一致，authority 仍来自 trusted config；安全边界由 manifest/path/scan/host external/shape validation 和 startup-only 限制承担。
- [风险] 去掉 async dynamic import 后不支持 top-level await。-> 缓解方式：startup plugin contribution 仍通过 object/factory 物化；返回 Promise 的 factory 由异步启动入口继续支持，完整 module loader 语义和 top-level await 不进入当前 artifact contract。

## 迁移计划（Migration Plan）

无数据迁移。现有 `artifactType: "esm-bundle"` 和 scaffold 输出保持目标态。若已有插件依赖 top-level await 或非 default-export bundle 形态，同步和异步入口都会 fail closed；若已有插件使用返回 Promise 的 factory，异步启动入口继续支持，同步启动入口在未提供 preloaded snapshot 时 fail closed。

回滚策略：恢复 `createComposedApp` guard 和 async dynamic import loader；对应回滚会重新引入同步入口能力缺口，只能作为临时恢复手段。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-scoped-plugin-composition/spec.md`：合并同步/异步启动入口一致加载 plugin、预加载 snapshot 不重复读取、invalid artifact fail closed 的行为。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/<topic>.md`：如已有 plugin composition architecture 文档，提炼 startup-only frozen snapshot 和 sync/async shared loader 流程；否则无。
- `openspec/designs/modules/agent-app.md`：补充 `agent-app` loader/snapshot ownership 和 sync/async API 行为。
- `openspec/designs/adr/<id>.md`：如需要保留完整 module loader 取舍，新增 ADR 记录“不使用 Node dynamic import 作为 plugin startup loading 唯一路径”的理由；否则无。
- `openspec/designs/spec-to-design-map.md`：随长期设计文档变更更新导航。

## 待确认问题（Open Questions）

无。
