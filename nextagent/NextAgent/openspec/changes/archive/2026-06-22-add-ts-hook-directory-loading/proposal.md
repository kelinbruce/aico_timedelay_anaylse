## 背景与问题（Why）

当前 lifecycle hook 已经有稳定的 runtime executor、definition/binding 语义和 pending / mutation / observability 约束，但 hook code 的工程承载方式仍停留在 app composition 里手工传入 `lifecycleHook`、`lifecycleHookDefinitions` 和 `lifecycleHookBindings`。这有三个直接问题：

1. 工程内没有统一的 hook source-of-truth。产品 hook 若要长期维护，只能散落在 `create-app.ts`、测试装配或临时注册代码里，不利于像 `skills/` 一样按目录组织、审查和发布。
2. 启动期缺少受信加载边界。现状只有“调用方自己传对象”，没有对 hook 目录布局、manifest、模块导出、重复 `hookId`、非法 stage / binding 或路径逃逸做统一 fail-closed 校验。
3. 已冻结的 lifecycle hook 规格与工程期望之间存在 gap。`add-ts-lifecycle-hook-execution` 已把“hook code 位于 `hooks/` 并在启动期冻结”写成非规范性示意，但当前稳定行为仍要求调用方显式组合，缺少工程级装载与注入方案。

这次 change 的必要性，是把 hook 从“代码里手工拼装的能力”收敛成“工程目录 `hooks/` 下的受信启动资源”，并明确唯一加载路径、配置边界和失败语义，避免后续每个产品 hook 再重复发明各自的注册方式。

## 变更范围（What Changes）

- 把 trusted hook root 明确为 `configRoot/hooks`，作为与 `configRoot/skills` 同级的工程目录。
- 规定 `hooks/` 下的 hook package 布局、最小 manifest 形态、模块导出约束和启动期校验规则。
- 首版明确 `hooks/<hook-id>/index.js` 必须为自包含 hook entry：直接导出 `invoke(input, signal)`，不得使用 `import` 声明或依赖启动期跨文件模块解析。
- 由 `agent-app` 在启动期扫描、校验、加载 `hooks/`，并合成冻结后的 `LifecycleHookPort`、`LifecycleHookDefinition[]`、`AgentHookBinding[]` 注入 runtime。
- 保持 runtime hook executor、decision / mutation 解释、pending input、timeline evidence、observability 和 risk policy 边界不变；本 change 只改变 hook 的工程装载方式。
- 明确 fail-closed 规则：目录结构非法、manifest 非法、导出不匹配、重复 `hookId`、非法 binding、路径逃逸、symlink/junction/reparse point 或加载失败时，启动必须失败。
- **BREAKING**：stable spec 将不再只允许“调用方手工传入 hook 实现”作为唯一工程装载方式；受信 `configRoot/hooks` 启动装载成为产品级标准路径。已有直接传 `lifecycleHook*` 的测试装配可继续作为测试入口，但产品主路径以目录装载为准。

## Capability 影响（Capabilities）

### 新增 Capability

- 无

### 修改的 Capability

- `lifecycle-hook-execution`: 补充 `configRoot/hooks` 的工程目录布局、启动扫描/校验/加载、冻结注入和 fail-closed 语义，替代“仅手工 composition 注入”的工程装载假设。

## 影响范围（Impact）

- `packages/agent-app`: 新增 hook directory loader、manifest 校验、startup resource 组合与 runtime 注入。
- `packages/agent-runtime`: 复用现有 `RegisteredLifecycleHookPort` 与 executor，不新增第二套 hook runtime。
- `packages/agent-contracts/runtime`: 如需补充 startup hook manifest 对应的稳定 contract vocabulary，则只增最小 shape；不新增 `agent-contracts/hook`。
- app config / startup validation：增加 `configRoot/hooks` 的 trusted root 校验，并与 `skills/`、`agents/`、`logs/`、`data/`、`execution/` 的路径约束保持一致。
- build / packaging：需要保证 `hooks/` 下的 hook module 可以作为受信 TS backend 产物参与启动期加载。
  首版仅承诺自包含 `index.js` entry；如需多文件 hook package 或标准 ESM `import` 装载，必须另起 change 扩展启动装载模型。
- tests：需要补齐 config assembly、startup validation、runtime integration、negative loading 和 architecture boundary 测试。

## 归档前更新基线（Baseline Promotion Plan）

- 行为契约：
  - `openspec/specs/lifecycle-hook-execution/spec.md`：新增/修改 `hooks/` 工程目录、启动加载、冻结注入、fail-closed 和无热加载契约。

- 长期背景：
  - `openspec/overview.md`：补充 lifecycle hook 从手工 composition 走向工程目录加载的长期背景。

- 设计视图：
  - `openspec/designs/architecture/configuration-boundary.md`：补充 `configRoot/hooks` 的 trusted root、路径校验与受信启动加载边界。
  - `openspec/designs/architecture/capability-spi.md`：无。
  - `openspec/designs/modules/agent-app.md`：补充 startup hook loader、manifest 校验、冻结注入和与 runtime 的组合职责。
  - `openspec/designs/modules/agent-runtime.md`：补充 runtime 继续只消费冻结后的 hook port / definition / binding 快照，不拥有目录扫描职责。
  - `openspec/designs/adr/<id>.md`：如需长期保留“为什么 hook 采用 `configRoot/hooks` 而不是外部 provider / marketplace / hot reload”的取舍，再新增 ADR；否则无。
  - `openspec/designs/spec-to-design-map.md`：更新 `lifecycle-hook-execution` 到 configuration-boundary / agent-app / agent-runtime 的导航。

- 验证入口：
  - `npm run build`
  - `npm test`
  - `npm run test:contract`
  - `npm run lint:architecture`
  - `openspec validate --all --strict`
