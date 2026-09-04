## 背景与问题（Why）

`npm run pack:release -- skip` 可以生成 zip，但解压后的 `bin/nextagent-start.cmd` 因缺少 `@nextagent/agent-workflow/dist/engine/index.js` 启动失败。现有打包流程只确认本地 workspace package 存在 `package.json` 和 `dist/`，没有确认 package `exports` 指向的运行时文件已被归档，也没有在 `skip` 场景对解压候选包执行启动验证。

`skip` 的语义应仅限跳过发布 E2E gate；它不能把不可启动的候选包伪装为成功产物。电信运维本地运行包必须在交付前尽早暴露缺失运行时模块、错误依赖闭包或解压布局问题。

## 变更范围（What Changes）

- 打包阶段在暂存每个本地 runtime workspace package 后，递归校验其 `package.json.exports` 的 `import` 和 `require` 目标均存在于暂存包内。
- `pack:release -- skip` 在归档后仍解压到临时验证目录，并执行正式 package startup/self-check 路径；`skip` 仅跳过发布 E2E gate。
- 验证失败时，打包命令 MUST 失败并给出不含敏感信息的诊断；不得把失败 archive 当作可用候选包。
- 新增覆盖嵌套 export 文件缺失、归档解压后启动失败和 `skip` 不跳过启动验证的测试。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `local-runtime-package`: 候选归档在任何打包模式下必须保留全部 runtime export 并经解压启动验证；`skip` 不得绕过此要求。

## 影响范围（Impact）

- `scripts/pack-local-runtime.mjs`：本地包暂存完整性校验、归档解压和启动验证。
- `tests/fullstack-packaging-boundary.test.ts`、`tests/local-runtime-package.test.ts`：打包边界和解压候选运行验证。
- `npm run pack:release -- skip`：执行时间增加候选包解压启动校验，但不改变其跳过发布 E2E 的语义。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/local-runtime-package/spec.md`：修改候选归档完整性与解压启动验证 requirement。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/local-runtime-packaging.md`：补充 `skip` 与候选包完整性/启动验证的边界。
- `openspec/designs/modules/agent-app.md`：无。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：补充解压启动验证入口。

验证入口：
- 打包边界单测、解压后的正式启动/self-check、`npm run pack:release -- skip`。
