## 背景与问题（Why）

已归档的 TS 后端架构基线明确限制根 workspace 不负责 `browser UI source` 和 `static asset build behavior`。当前黑盒目标已经变化：

- 前端与后端同仓库协作，前端源码位于 `frontend/agent-web`；
- 前端构建为独立 npm 包，后端 `agent-app` 增加依赖；
- `agent-app` 负责前端静态资源托管路由注册，在同一个 server 中同时提供后端服务和前端静态资源；
- 前端是可选依赖，必须支持 `backend-only` 与 `with-frontend` 两种明确交付形态；
- 前后端产品版本必须有单一权威，避免后端运行包和前端 artifact 漂移；
- 前后端 Node.js、TypeScript 版本，以及共同依赖的公共组件版本必须一致；
- 前端对后端发布的是构建产物，不是源码。

如果没有独立 change 统一承载这些边界，当前规格会同时出现两类冲突：

1. 架构基线继续禁止同仓库前端源码和前端构建行为进入受控范围；
2. `add-ts-local-runtime-package` 只定义“运行包可包含 Web 静态资产”，但没有定义前端 npm 包产物 contract、可选依赖 profile、toolchain 锁步和后端消费边界。

因此，需要一个同时刷新架构边界和实施边界的 change，把“同仓库前端模块 + 构建后前端包 + `agent-app` 静态托管 + backend-only/fullstack 两种形态”纳入目标态。

## 变更范围（What Changes）

- 新增 `fullstack-packaging-boundary` capability。
- 刷新 `ts-backend-architecture` 的仓库/构建边界：允许同仓库存在 `frontend/agent-web`，但后端仍只消费前端 npm 包构建产物，不消费前端源码。
- 定义前端 npm 包产物 contract：前端源码位于 `frontend/agent-web`，构建后 npm 包固定为 `@nextagent/agent-web`，并通过 `@nextagent/agent-web/hosting` 暴露 `resolveFrontendHostingManifest()`；`agent-app` 不得依赖 frontend-private path。
- 定义 `agent-app` 的静态资源托管 ownership：由 `agent-app` 负责基于可信 build/package profile 注册前端 route；`agent-channel-web` 不拥有静态资源托管。
- 定义 `backend-only` / `with-frontend` 两种明确 package/build profile；前端是否启用必须来自可信构建参数或打包参数，而不是运行时目录探测。
- 定义唯一产品实现路径：`packages/agent-app/src/entrypoints/backend-only.ts` 与 `packages/agent-app/src/entrypoints/with-frontend.ts` 区分 `backend-only` / `with-frontend`，前端托管通过 `packages/agent-app-frontend-hosting` 中的独立 package `@nextagent/agent-app-frontend-hosting` 暴露的 `frontendHostingPlugin` 接入；两种候选运行包的依赖权威固定为 `packages/agent-app/manifests/backend-only.package.json` 与 `packages/agent-app/manifests/with-frontend.package.json`；构建阶段必须让 `backend-only` 产物完全不包含前端注册逻辑和前端产物。
- 定义 `with-frontend` 配置来源：只能由可信 profile 选择结果和 `@nextagent/agent-web/hosting` 暴露的 hosting manifest 共同确定，不再引入第二套运行时配置输入。
- 定义 hosting manifest 安全边界：`resolveFrontendHostingManifest()` 的返回值必须通过固定 schema 校验，字段路径必须受限在前端包根内；manifest 缺失、非法或路径越界时 `with-frontend` 必须 fail closed，不得静默降级。
- 定义开发阶段单入口：仓库根 `npm run dev:fullstack` 必须作为 dev-only bootstrap，顺序完成后端依赖准备、前端依赖准备、前端构建、生成最小 `@nextagent/agent-web` artifact package、通过固定 bootstrap 脚本按标准 npm package install 语义安装该前端包，并通过 `with-frontend` 产品入口启动同一个 server，同时提供后端 API/stream/control routes 和前端静态资源/route fallback；该命令不作为候选运行包 evidence、正式打包入口或 release verdict 来源。
- 定义前后端产品版本同步边界：仓库根 `package.json.version` 是 fullstack 产品版本权威；前端 artifact package `@nextagent/agent-web` 的 `package.json.version` 必须由该值写入；`packages/agent-app/manifests/with-frontend.package.json` 中对 `@nextagent/agent-web` 的依赖必须采用标准 npm package dependency 形式，并使用与根版本一致的精确版本；开发 bootstrap 和正式打包都必须校验版本一致，运行时不得自动改写或同步版本。
- 定义前后端 toolchain 一致性边界：仓库根 `package.json` 是 Node.js、TypeScript 和 shared dependency lockstep policy 的权威 manifest；共同依赖的公共组件版本必须锁步一致，并由根 `package.json` 中的 `x-nextagent.sharedDependencyLockstep` 明确校验范围。
- 明确根 workspace 不扩展到 `frontend/*`；`frontend/agent-web` 通过显式锁步检查纳入治理，`frontend/agent-web-mock-server` 不在本 change 范围内。
- 明确统一的 release/build/package orchestration 不是本 change 的验收前提；这部分可以后置为独立 change，但 dev-only `npm run dev:fullstack` bootstrap 属于当前 change 范围。
- 保持单一主要 owner：主要写入边界归 `agent-app` / app composition；前端模块只提供受控 npm 包产物 contract 和必要静态资源内容。
- 保持 package 边界清晰：前端托管插件由独立 package 提供，`agent-app` 负责组装，不把前端托管逻辑混入 `agent-app` 包内普通模块。

## Capability 影响（Capabilities）

### 新增 Capability

- `fullstack-packaging-boundary`: 定义同仓库前端模块、前端构建后 npm 包产物、`agent-app` 静态资源托管、可选前端依赖 profile、单 server 交付和 toolchain/dependency 锁步边界。

### 修改的 Capability

- `ts-backend-architecture`: 刷新“根 workspace 不负责 browser UI source/static asset build behavior”的限制，改为“允许同仓库前端源码存在，但后端实现只依赖前端构建产物和受控托管边界”。
- `local-runtime-package`: 补充 `backend-only` / `with-frontend` 两种 package profile、前端构建产物依赖、静态资源 route registration 和 candidate evidence 差异。

## 影响范围（Impact）

- 受影响模块与边界：
  - `agent-app`: 前端包消费、静态资源 route registration、package profile selection、候选运行包 evidence。
  - `agent-channel-web`: 保持 transport/stream ownership，不接管静态资源托管。
  - `frontend/agent-web`: 同仓库前端源码位置和对后端发布的 npm 包产物 contract。
  - release package / qualification：消费 `backend-only` / `with-frontend` package profile 和前端包 evidence。
- 受影响配置或构建输入：
  - trusted build/package profile
  - `@nextagent/agent-web/hosting` manifest export
  - root `npm run dev:fullstack` development bootstrap command
  - root `package.json.version` 产品版本权威值
  - `@nextagent/agent-web` artifact package version
  - root `package.json` 中的 Node.js / TypeScript 权威版本
  - root `package.json` 中的 shared dependency lockstep allowlist
- 不影响：
  - runtime request lifecycle、terminal commit、timeline、stream projection、session/message durable facts、model invocation、capability invocation 语义。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：

- `openspec/specs/fullstack-packaging-boundary/spec.md`：新增
- `openspec/specs/ts-backend-architecture/spec.md`：补充同仓库前端源码和后端消费前端构建产物的边界说明
- `openspec/specs/local-runtime-package/spec.md`：补充 `backend-only` / `with-frontend` profile 和前端包证据差异

长期背景：

- `openspec/overview.md`：补充同仓库 fullstack package profile 和单 server 托管边界

设计视图：

- `openspec/designs/architecture/fullstack-packaging-boundary.md`：新增同仓库前端模块、前端产物包、可选依赖 profile 和单 server 托管边界
- `openspec/designs/modules/agent-app.md`：补充前端包消费、静态资源注册和 profile 选择职责
- `openspec/designs/modules/agent-channel-web.md`：补充静态资源托管非职责说明
- `openspec/designs/spec-to-design-map.md`：新增 `fullstack-packaging-boundary` 导航

验证入口：

- fullstack package profile contract tests
- frontend package consumption tests
- route precedence tests
- fullstack dev bootstrap command tests
- product version consistency checks
- toolchain version consistency checks
- shared dependency lockstep checks
