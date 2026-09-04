## 1. Startup Hook Root And Loader

- [x] 1.1 在 `agent-app` startup composition 中派生并冻结 trusted hook root=`configRoot/hooks`，禁止新增用户可写 `paths.hooksRoot`，并补齐与 `skills/`、`agents/`、`logs/`、`data/`、`execution/` 一致的路径边界校验。
  验证：`npm test -- tests/agent-kernel/config-assembly.test.ts`
  来源：spec requirement `Hook definitions and Agent bindings remain separate and bounded`；design D1
- [x] 1.2 实现 `agent-app` hook directory loader：只在启动期扫描 `configRoot/hooks` 下一级 package 目录，物化冻结后的 `RegisteredLifecycleHookPort`、`LifecycleHookDefinition[]`、`AgentHookBinding[]`，并注入现有 runtime composition。
  验证：`npm test -- tests/agent-kernel/main-path.test.ts tests/agent-kernel/lifecycle-hook-execution-core.test.ts`
  来源：spec requirement `Hook definitions and Agent bindings remain separate and bounded`；design D3
- [x] 1.3 定义首版 hook package 工程布局与 manifest/module 校验：`hooks/<hook-id>/hook.json` + `hooks/<hook-id>/index.js`，并确保目录名、`hookId`、最小 definition 字段、最小 bindings 和导出约定一致；manifest 不承载 `source`、`defaultOrder`、`defaultTimeoutMs`、`defaultConfig`，binding 首版只要求 `agentId`。
  验证：`npm test -- tests/agent-kernel/hook-directory-loading.test.ts`
  来源：spec requirement `Hook directory loading is startup-validated and fail-closed`；design D2
- [x] 1.4 补齐 negative validation：manifest 非法、duplicate `hookId`、非法 binding、`SYSTEM` disable、导出缺失、路径逃逸、symlink/junction/reparse point 等场景都必须 fail closed，且不得部分加载。
  验证：`npm test -- tests/agent-kernel/hook-directory-loading.test.ts`
  来源：spec requirement `Hook code execution is app-composed and bounded`；spec requirement `Hook directory loading is startup-validated and fail-closed`；design D4

## 2. Runtime Integration And Non-Regression

- [x] 2.1 将目录加载结果接入现有 lifecycle hook 执行路径，保证 request、pending resume、recovery 与 terminal commit 继续只消费冻结 snapshot，不在主路径重新扫目录。
  验证：`npm test -- tests/agent-kernel/lifecycle-hook-execution-*.test.ts tests/agent-kernel/local-runtime-recovery.test.ts tests/agent-kernel/runtime-recovery-guard.test.ts`
  来源：spec requirement `Hook definitions and Agent bindings remain separate and bounded`；design D5
- [x] 2.2 增加 architecture / source-level 检查点，确认目录扫描 owner 只在 `agent-app`，`agent-runtime` / `agent-core` / `agent-channel-web` 不新增 hook 目录读取或热加载逻辑。
  验证：code review 检查点：新增 loader 仅位于 `packages/agent-app/**`；`npm run lint:architecture`
  来源：design D3；proposal 变更范围
- [x] 2.3 维持现有 hook executor 语义不回退：`SYSTEM/CUSTOM` 顺序、`BLOCKING/NON_BLOCKING`、`CONTINUE/FAIL`、`PEND`、`TerminalEventMutation`、HookInvocationEvent 与 timeline-only evidence 行为保持不变。
  验证：`npm test -- tests/agent-kernel/lifecycle-hook-execution-core.test.ts tests/agent-kernel/lifecycle-hook-execution-pending.test.ts tests/agent-kernel/lifecycle-hook-execution-terminal.test.ts tests/agent-kernel/lifecycle-hook-execution-failure.test.ts`
  来源：proposal scope；design D3/D5；existing lifecycle-hook-execution stable behavior

## 3. Validation And Packaging

- [x] 3.1 验证 build / contract / architecture 门禁，确认 `hooks/` 工程加载不会破坏现有打包、类型构建和 stable contract。
  验证：`npm run build`、`npm run test:contract`、`npm run lint:architecture`
  来源：proposal 影响范围；design 验证映射
- [x] 3.2 补齐产品路径 characterization：空 `configRoot/hooks` 允许启动；存在合法 hook package 时自动装载生效；目录存在但 candidate 非法时启动失败。
  验证：`npm test -- tests/agent-kernel/hook-directory-loading.test.ts tests/local-runtime-package.test.ts`
  来源：spec requirement `Hook directory loading is startup-validated and fail-closed`；design D4

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/lifecycle-hook-execution/spec.md` 的稳定行为契约。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/configuration-boundary.md`。
- 按需更新 `openspec/designs/modules/agent-app.md`、`openspec/designs/modules/agent-runtime.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 若长期保留 `configRoot/hooks` 决策理由有必要，再新增或更新对应 ADR。
