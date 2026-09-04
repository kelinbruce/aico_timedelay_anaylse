# Fullstack Packaging Boundary

## 背景

NextAgent TS 后端稳定基线原本把仓库根目录定义为后端 workspace，并排除浏览器 UI 源码和静态资源构建行为。当前产品形态允许同仓库存在 `frontend/agent-web` 前端源码，但后端仍必须只消费前端发布出来的 npm 包产物，不能把源码工作区状态、前端私有路径或构建器临时目录变成后端运行时依赖。

本设计承载同仓前端模块、前端构建后 npm 包、`agent-app` 静态资源托管、`backend-only` / `with-frontend` 两种运行包 profile、单 server 交付，以及 Node.js / TypeScript / shared dependency / 产品版本锁步边界。它不定义前端页面行为、前端状态管理、前端路由细节或统一 release/build/package orchestration。

## 设计目标

- 允许 `frontend/agent-web` 在同仓库维护，同时保持后端 implementation 只依赖前端构建产物。
- 固定前端产物 npm 包身份为 `@nextagent/agent-web`，并固定 `@nextagent/agent-web/hosting` 暴露 `resolveFrontendHostingManifest()`。
- 固定 `backend-only` 和 `with-frontend` 两种 package/build profile，profile 选择只来自可信构建或打包参数。
- 由 `agent-app` 负责前端静态资源 route registration；`agent-channel-web` 继续只负责 transport 和 stream projection。
- 通过 `@nextagent/agent-app-frontend-hosting` 独立 Fastify 插件包接入前端静态资源和 SPA fallback。
- 保证 API、SSE、WebSocket 和 control routes 不被前端 fallback 吞掉。
- 保证 `backend-only` 产物不携带前端托管注册逻辑、前端包引用或前端静态资源。
- 以根 `package.json` 作为产品版本、Node.js、TypeScript 和 shared dependency lockstep policy 的权威 manifest。

## 非目标

- 不定义前端页面行为、组件状态、浏览器端路由设计、UI payload 或交互细节。
- 不定义统一 release/build/package orchestration、monorepo task runner 或发布流水线编排。
- 不改变 runtime lifecycle、terminal commit、canonical timeline、session/message durable facts、channel transport ownership 或 gateway persistence owner。
- 不让后端运行时通过环境变量、配置文件、目录扫描或源码路径推导前端托管配置。

## 关键决策

### D1. 同仓源码不是后端依赖

仓库允许存在 `frontend/agent-web`，但后端 `agent-app` 只能消费 `@nextagent/agent-web` npm 包产物、该包的 public exports 和静态资源产物。任何 backend package 直接 import `frontend/agent-web` 源码、frontend-private path 或构建器临时目录都属于 architecture/dependency validation 失败。

### D2. 前端包 contract 固定

前端构建产物包名固定为 `@nextagent/agent-web`。后端启用前端托管时唯一允许读取的前端托管配置 export 是 `@nextagent/agent-web/hosting`，该 export 固定暴露 `resolveFrontendHostingManifest()`。

该 manifest 至少包含 `assetRoot`、`indexHtml`、`routeBase` 和 `spaFallback`。`assetRoot` 与 `indexHtml` 必须是包根内相对路径，不得是绝对路径，不得包含 `..`，解析后不得逃逸包根；`indexHtml` 必须存在且位于 `assetRoot` 内；`routeBase` 必须是以 `/` 开头的规范化 route 前缀；`spaFallback` 必须是布尔值。非法 manifest 在 `with-frontend` 下 fail closed，不得降级到 `backend-only`。

### D3. Profile 选择来自可信打包输入

系统至少支持两种 profile：

- `backend-only`：只组装后端能力，不要求前端包存在，不注册前端静态资源 route。
- `with-frontend`：要求前端包存在，读取 `resolveFrontendHostingManifest()`，注册静态资源和前端 route fallback。

profile 不得通过运行时扫描目录、临时文件或偶然存在的静态资源自动发现。候选 evidence 必须记录当前 profile 和 route registration shape；`backend-only` evidence 不声明前端包证据，`with-frontend` evidence 必须声明前端包证据。

### D4. 两个产品入口定义依赖图

服务形态由两个产品入口固定：

- `packages/agent-app/src/entrypoints/backend-only.ts`
- `packages/agent-app/src/entrypoints/with-frontend.ts`

`backend-only` 入口只引用后端基础装配，不引用前端托管插件或前端包。`with-frontend` 入口可以引用 `@nextagent/agent-app-frontend-hosting` 和 `@nextagent/agent-web/hosting`。前端可选化不得通过单一入口中的运行时分支实现。

两种候选运行包的依赖权威固定为：

- `packages/agent-app/manifests/backend-only.package.json`
- `packages/agent-app/manifests/with-frontend.package.json`

`packages/agent-app/package.json` 只是 workspace/source manifest，不是候选运行包依赖权威。`backend-only.package.json` 不得声明 `@nextagent/agent-app-frontend-hosting` 或 `@nextagent/agent-web`；`with-frontend.package.json` 必须显式声明 `@nextagent/agent-app-frontend-hosting`，并以标准 npm package dependency 形式精确依赖根版本一致的 `@nextagent/agent-web`。

### D5. 静态托管 ownership 归 agent-app

`agent-app` 是唯一 composition root，因此负责根据 profile 组装前端托管能力并注册静态资源 route 和 SPA fallback。`agent-channel-web` 继续只负责 Fastify transport、SSE/WebSocket stream projection、public DTO projection 和 presentation-safe errors，不拥有静态资源托管。

### D6. 前端托管插件独立成包

前端静态资源和 fallback 通过 `packages/agent-app-frontend-hosting` 中的 `@nextagent/agent-app-frontend-hosting` 提供。该 package 固定暴露 `frontendHostingPlugin`。`agent-app` 只负责组装插件；`backend-only` 入口不得依赖或引用该插件包，`with-frontend` 入口才可以依赖和注册。

### D7. 后端 routes 优先

前端 fallback 只处理非 API 的静态资源和前端 route。`/api/**`、SSE、WebSocket 和 control routes 必须继续由后端既有 owner 处理，不能被静态资源 fallback 接管。

### D8. Backend-only 产物必须裁剪前端能力

构建阶段必须以产品入口为边界，对 `backend-only` 产物执行 tree-shaking 或等价裁剪，使最终交付物完全不包含前端托管注册逻辑、前端 npm 包产物引用或前端静态资源产物。这里要求的是产物中不存在这些能力，而不是运行时分支未执行。

### D9. 根 package.json 是版本和锁步策略权威

仓库根 `package.json.version` 是 fullstack 产品版本唯一权威。前端 artifact package 的 `package.json.version` 必须由根版本写入，`with-frontend.package.json` 中对 `@nextagent/agent-web` 的精确依赖版本必须等于根版本。后端运行时不得自动同步、改写或拉取前端版本；版本一致性在依赖安装、dev bootstrap、构建或打包装配阶段校验，发现漂移时 fail closed。`with-frontend` 候选 evidence 必须记录 fullstack 产品版本、后端运行包版本、前端 artifact package 版本，以及前端 artifact 的内容 hash 或 build ref。

仓库根 `package.json` 同时是 Node.js、TypeScript 和 shared dependency lockstep policy 的唯一权威：

- `engines.node` 是前后端共同遵循的 Node.js 版本权威值。
- 根 `devDependencies.typescript` 是 TypeScript 版本权威值。
- `x-nextagent.sharedDependencyLockstep` allowlist 定义共享依赖锁步范围。

根 `workspaces` 保持只覆盖 `packages/*`。`frontend/agent-web` 通过显式检查纳入 toolchain 与 shared dependency 治理；`frontend/agent-web-mock-server` 不进入本边界的 workspace 或 lockstep scope。

### D10. Dev bootstrap 是开发入口，不是 release verdict

仓库根 `npm run dev:fullstack` 是 dev-only convenience entry。它按固定顺序准备后端依赖、准备 `frontend/agent-web` 依赖、构建前端、生成最小 `@nextagent/agent-web` artifact package、按标准 npm package install 语义安装该前端包，并启动 `with-frontend` 产品入口。

该命令启动的同一个 server 同时提供后端 API/stream/control routes 和前端静态资源/fallback。它不得作为候选运行包 evidence、正式打包入口、release qualification 输入或 release verdict 来源。

### D11. `dev:watch` 是独立源码开发入口

仓库根 `npm run dev:watch` 作为源码开发入口，固定启动两条长期运行路径：

- `frontend/agent-web` 的 Vite dev server，保留既有 HMR；
- backend-only 产品入口对应的后端 watch 编译与自动重启。

`dev:watch` 通过 Vite `/api` proxy 把 REST、SSE 和 WebSocket stream 请求代理到 backend-only 后端服务。它不构建前端 artifact，不安装 `@nextagent/agent-web`，不启动 `with-frontend` 产品入口，也不注册前端静态托管插件。

后端 watch 采用编译成功触发的进程级重启，而不是进程内 HMR。编译失败只暴露诊断并等待下一次成功编译；后端重启期间现有 SSE/WS 连接允许断开，恢复语义继续由既有 runtime recovery / stream replay 规格承载。

前端 backend dev profile 固定对齐默认 backend-only 本地端点 `http://localhost:3000`，默认 transport 为 SSE。WebSocket transport 仍通过显式 `VITE_TRANSPORT_KIND=WEBSOCKET` 选择；仓库不再提供脚本级 `dev:ws` 或 `.env.websocket` 作为 transport authority。

本地运行数据目录 `data/` 属于开发机状态，不属于源码或 OpenSpec artifact，必须由根 `.gitignore` 忽略。

## 关键流程

1. 前端源码在 `frontend/agent-web` 维护，后端不直接消费源码。
2. 前端构建生成 `@nextagent/agent-web` artifact package，包含静态构建产物和 `@nextagent/agent-web/hosting` public export。
3. 构建或打包阶段显式选择 `backend-only` 或 `with-frontend` profile。
4. `backend-only` 使用 `backend-only.package.json`，不依赖前端包，不注册静态 route。
5. `with-frontend` 使用 `with-frontend.package.json`，精确依赖根版本一致的 `@nextagent/agent-web`，并要求前端包证据存在。
6. `with-frontend` 入口调用 `resolveFrontendHostingManifest()`，对 manifest 执行 schema 和路径约束校验。
7. `agent-app` 注册后端 routes；在 `with-frontend` 下再注册前端静态资源 route 和 fallback。
8. route precedence 确保 API、SSE、WebSocket 和 control routes 不被 fallback 接管。
9. 候选 evidence 记录 profile、route registration shape、fullstack 产品版本、后端运行包版本、前端 artifact 版本、前端 artifact 内容 hash 或 build ref 和前端包证据。

## 质量属性和验证

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 后端不消费前端源码或 private path；manifest schema 校验和路径约束 fail closed；静态 fallback 不吞掉 API/stream/control routes。 | frontend package consumption tests、manifest validation tests、source/dependency negative tests、route precedence tests |
| 可靠性 | `backend-only` 与 `with-frontend` 是明确 profile；profile 不依赖运行时探测；前端包缺失只阻断 `with-frontend`。 | package profile tests、startup/profile negative tests |
| 可维护性 | `agent-app` 是静态托管注册 owner；托管插件独立成包；`agent-channel-web` 不膨胀成 fullstack host。 | architecture/dependency tests、code review |
| 可审计性 | 候选 evidence 记录 profile、route registration shape、产品版本、前端 artifact 版本、内容 hash 或 build ref 和前端包证据。 | candidate evidence tests、product version checks |
| 可测试性 | 包 contract、manifest 校验、route precedence、产物裁剪、版本锁步和 dev bootstrap 都有确定入口。 | contract tests、integration tests、artifact exclusion tests、toolchain/shared dependency checks |

## 文档承载

- 行为契约：`openspec/specs/fullstack-packaging-boundary/spec.md`
- 架构刷新：`openspec/specs/ts-backend-architecture/spec.md`
- 设计主承载：`openspec/designs/architecture/fullstack-packaging-boundary.md`
- 模块职责：`openspec/designs/modules/agent-app.md`、`openspec/designs/modules/agent-channel-web.md`
- 导航：`openspec/designs/spec-to-design-map.md`

本地运行包 artifact、package profile 和 candidate evidence handoff 已由 `local-runtime-package` 建立独立稳定 capability，并由 `openspec/designs/architecture/local-runtime-packaging.md` 主承载。本设计继续只承载同仓前端源码、`@nextagent/agent-web` artifact package、前端静态托管注册、route precedence、前端版本锁步和 `with-frontend` 附加前端 evidence；不得重复定义运行包 manifest、目录 layout、startup/stop entrypoint 或 release qualification verdict。

## 多宿主前端 Artifact 语义

正式前端 artifact 现在固定承载两个正式宿主形态：

- 沉浸式页面入口：正式包中的 `index.html` 必须由源码 `immersive.html` 构建/装配得到，并固定加载 `/febs/v1/assets/prelude-loader`。
- 协作式 PIU 资产：正式包必须额外包含 `piu/AIAgentPIU.js` 与同名 `piu/AIAgentPIU.css`，二者是协作式嵌入的唯一正式前端资产组合。

开发态本地式 `index.html`、源码 `immersive.html`、`collaborative.html` 与 mock prelude 只属于 dev/test/source 语义，正式 artifact 不得发布这些源文件名或测试宿主。`with-frontend` profile 继续只消费 packaged artifact 与 hosting manifest；后端不解释 PIU handler，不读取前端源码，也不推导产品宿主模式。

## 单次正式构建与 Dev Watch 边界

正式前端构建必须在一次产品编排中同时产出沉浸式页面和协作式 PIU 资产，并执行 artifact allowlist/denylist 检查。允许的正式关键输出至少包括 `index.html`、`piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css`；不得把本地式源 `index.html`、`immersive.html`、`collaborative.html` 或 mock prelude 带入正式输出。

`dev:watch` 继续是单一源码开发入口，但它的职责扩大为通过一个 Vite server 暴露 `/`、`/immersive/` 和 `/collaborative/` 三种开发入口，同时保持 API/stream 代理与 backend-only watch/restart。该模式不构建正式 artifact、不安装正式 PIU 输出，也不得写入 `dist` 中的正式 `index.html` 或 `piu/*` 资产。
