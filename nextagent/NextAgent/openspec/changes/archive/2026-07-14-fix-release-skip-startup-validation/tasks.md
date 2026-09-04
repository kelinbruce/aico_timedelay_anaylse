## 1. 候选包完整性

- [x] 1.1 在 `scripts/pack-local-runtime.mjs` 实现本地 runtime workspace package 的暂存 export 目标校验，拒绝缺少嵌套 `import` 或 `require` 文件的候选包。
  验证：`npx vitest run --config vitest.config.release.ts tests/fullstack-packaging-boundary.test.ts`。
  来源：`local-runtime-package` 的 “Local runtime package is a user-runnable platform artifact” requirement；design 决策 1。
- [x] 1.2 添加缺少嵌套 export 文件的 negative test，并断言错误仅包含 package 名和 package-relative target。
  验证：`npx vitest run --config vitest.config.release.ts tests/fullstack-packaging-boundary.test.ts`。
  来源：同一 requirement 的 “Nested runtime export is omitted from staged package” scenario；design 安全决策。

## 2. 解压候选验证

- [x] 2.1 在归档生成后解压到隔离临时根，并从该根执行正式 `bin/nextagent-self-check`；成功或失败均清理临时目录。
  验证：打包 orchestration 单测覆盖解压与 self-check 调用。
  来源：同一 requirement 的 “Skip mode still validates extracted package startup” scenario；design 决策 2、4。
- [x] 2.2 将 `skip` 限定为只跳过发布 E2E gate，并添加 self-check 失败的 negative test。
  验证：`npx vitest run --config vitest.config.release.ts tests/fullstack-packaging-boundary.test.ts`。
  来源：同一 requirement 的 “Skip mode still validates extracted package startup” scenario；design 决策 3。

## 3. 真实打包验证

- [x] 3.1 执行 `npm run pack:release -- skip`，确认 archive 完成、解压 self-check 通过，且 archive 不包含 `agent-dev-workbench`。
  验证：`npm run pack:release -- skip` 及 archive 内容检查。
  来源：proposal scope；design 验证映射。
- [x] 3.2 对改动执行 focused tests、`git diff --check` 和 OpenSpec strict validation。
  验证：`npx vitest run --config vitest.config.release.ts tests/fullstack-packaging-boundary.test.ts`、`git diff --check`、`openspec validate fix-release-skip-startup-validation --strict`。
  来源：AGENTS.md 验证门禁；design 可维护性与可测试性结论。

## 归档前更新基线检查（非实施任务）

归档前将稳定行为同步到 `openspec/specs/local-runtime-package/spec.md`，将候选包验证顺序提炼到 `openspec/designs/architecture/local-runtime-packaging.md`，并更新 `openspec/designs/spec-to-design-map.md` 的验证入口。
