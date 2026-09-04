## 1. Loader 核心

- [x] 1.1 在 `plugin-loader.ts` 中新增同步 plugin registry loader，支持读取、扫描、同步物化 default export、host external injection、shape validation 和 deep freeze；现有 async loader 复用 bundle 读取、扫描、default export extraction 和 shape validation。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/plugin-loader.test.ts packages/agent-app/tests/plugin-host-externals.test.ts packages/agent-app/tests/plugin-manifest.test.ts`
  来源：`agent-scoped-plugin-composition` / design D1
- [x] 1.2 为同步 loader 增加 export 形态与失败路径测试，覆盖 `export default`、`export { local as default }`、runtime import specifier、unsupported export shape 和 required plugin fail closed。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/plugin-loader.test.ts`
  来源：`Plugins load only during trusted startup composition` / design D1、D3
- [x] 1.3 保留 async loader 对 `Promise<NextAgentPlugin>` factory 的支持，同时让 sync loader 对 async factory fail closed。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/plugin-host-externals.test.ts`
  来源：`Asynchronous startup awaits async plugin factory` / `Synchronous startup rejects async plugin factory`

## 2. App composition 接入

- [x] 2.1 修改 `createComposedApp` / `createNextAgentApp` 同步启动路径：未提供 `pluginRegistrySnapshot` 时按 `systemConfig.pluginSystem.plugins[]` 加载 plugin，不再因存在 plugins 直接抛 `PLUGIN_REGISTRY_REQUIRED`。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts`
  来源：`Plugins load only during trusted startup composition` / design D2
- [x] 2.2 保持 `createComposedAppAsync` / `createNextAgentAppAsync` 复用同一 loader 语义，并确保传入 preloaded snapshot 时同步/异步路径都不读取 plugin 目录。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts`；`npx vitest run --config vitest.config.release.ts tests/smoke/plugin-loader.test.ts tests/smoke/plugin-policy-activation.test.ts tests/smoke/plugin-provider-guard.test.ts`
  来源：`Synchronous startup consumes preloaded snapshot without reloading` / design D2
- [x] 2.3 确认 request path 不新增 plugin loading 调用点，loader 仍只由 startup composition 或测试 loader 入口使用。
  验证：`rg -n "loadPluginRegistrySnapshot|loadPluginRegistrySnapshotSync" packages tests` code review 检查调用点；`npm run lint:architecture`
  来源：`Boundary runtime input cannot load plugins` / design non-goals

## 3. 验证和收尾

- [x] 3.1 运行 OpenSpec change 验证。
  验证：`openspec validate support-sync-plugin-startup-loading --strict`
  来源：proposal / OpenSpec delta
- [x] 3.2 运行定向 TypeScript 与测试验证，确认 loader/composition 改动没有破坏 async plugin loader path。
  验证：`npx tsc -b packages/agent-app/tsconfig.json --pretty false`；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/plugin-loader.test.ts packages/agent-app/tests/plugin-host-externals.test.ts packages/agent-app/tests/plugin-manifest.test.ts packages/agent-app/tests/composition.test.ts`；`npx vitest run --config vitest.config.release.ts tests/smoke/plugin-loader.test.ts tests/smoke/plugin-policy-activation.test.ts tests/smoke/plugin-provider-guard.test.ts`
  来源：design Verification Map
- [x] 3.3 检查 diff 和任务状态，清理本次实现产生的未使用 import、临时 fixture 或旧 guard 文案。
  验证：`git diff --check`；`git status --short`
  来源：AGENTS 实现质量门禁 / design maintainability

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，归档前根据 proposal/design 的“归档前更新基线”处理：

- 合并 `openspec/specs/agent-scoped-plugin-composition/spec.md` 中的同步/异步 startup plugin loading 行为契约。
- 按需更新 `openspec/designs/modules/agent-app.md` 中的 plugin loader/snapshot 职责。
- 如新增长期设计文档或 ADR，同步更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一 loader 语义或 plugin artifact contract。
