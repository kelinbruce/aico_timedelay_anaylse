# refine-ts-fullstack-packaging-boundary

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Fullstack Packaging and UI Hosting

状态：active
类型：架构 refinement + 实施 change
主要 owner：`agent-app`
协作 owner：`agent-channel-web`、`frontend/agent-web` package owner
依赖：`establish-ts-backend-architecture`、`add-ts-local-runtime-package`

目标：
- 刷新 TS 后端架构基线，使同仓库 `frontend/agent-web` 前端模块、前端构建后 npm 包产物、`agent-app` 静态资源托管和同一 server 提供前后端服务成为受控目标态。
- 明确 `backend-only` 和 `with-frontend` 是两种产品入口与交付形态；`backend-only` 构建产物中不得包含前端注册逻辑或前端产物。

规格输入：
- 仓库允许存在 `frontend/agent-web` 前端模块；该模块是同仓库源码边界，不自动成为后端 runtime 依赖。
- 前端对后端暴露的是构建后的独立 npm 包 `@nextagent/agent-web`，源码位于 `frontend/agent-web`；`agent-app` 只能消费该包的 public exports、package manifest 和静态资源产物，不得 import 前端源码或 private path。
- `@nextagent/agent-web` 必须通过固定 public export `@nextagent/agent-web/hosting` 暴露 `resolveFrontendHostingManifest()`；该 export 是后端启用前端托管时唯一允许读取的前端配置输入。
- `agent-app` 负责前端静态资源托管的路由注册，并在同一 server 中同时提供后端 API/SSE/WebSocket 与前端静态资源/route fallback。
- `agent-channel-web` 继续只负责 transport 和 stream projection，不拥有静态资源托管职责，不拥有 request lifecycle 或执行事实。
- 前端是可选依赖；是否注册前端静态资源路由必须由可信构建参数或打包参数控制，而不是运行时扫描目录自动探测。
- 至少支持 `backend-only` 和 `with-frontend` 两种明确 package/build profile；`backend-only` 不注册前端路由，`with-frontend` 依赖前端构建产物并注册静态资源路由。
- `backend-only` 仍然是有效交付形态；`with-frontend` 只在前端包产物存在且 profile 明确启用时生效。
- 系统必须采用两个明确的产品入口：`packages/agent-app/src/entrypoints/backend-only.ts` 只装配后端能力；`packages/agent-app/src/entrypoints/with-frontend.ts` 在后端能力之外装配前端托管能力。
- 两种运行包的依赖权威必须由两个专用 product manifest 定义：`packages/agent-app/manifests/backend-only.package.json` 和 `packages/agent-app/manifests/with-frontend.package.json`；`packages/agent-app/package.json` 只是 workspace/source manifest，不得作为候选运行包依赖权威。
- 前端托管必须通过独立 package `@nextagent/agent-app-frontend-hosting` 接入，其源码位于 `packages/agent-app-frontend-hosting`，并通过固定 Fastify 插件 export `frontendHostingPlugin` 暴露；`agent-app` 只负责组装该插件。`backend-only` 入口不得依赖或引用该插件 package，`with-frontend` 入口才可依赖并引用。
- `with-frontend` 的前端托管配置只能由两部分确定：可信构建/打包 profile 选择结果，以及 `@nextagent/agent-web/hosting` 导出的 hosting manifest；不得再引入第二套 app-local runtime 配置源。
- `resolveFrontendHostingManifest()` 返回值必须通过固定 runtime schema 校验。manifest 至少包含 `assetRoot`、`indexHtml`、`routeBase`、`spaFallback` 四个字段；`assetRoot` 和 `indexHtml` 必须是包内相对路径，禁止绝对路径、`..` 路径穿越或解析后逃逸包根。`with-frontend` profile 下 manifest 缺失、schema 非法、路径越界或目标文件不存在时必须 fail closed，启动以安全错误失败；不得静默降级为 `backend-only`。
- 仓库根 `npm run dev:fullstack` 必须作为开发阶段单入口，顺序完成后端依赖准备、前端依赖准备、前端构建、生成最小 `@nextagent/agent-web` artifact package、通过 dev bootstrap 脚本按标准 npm package install 语义安装该前端包、校验已安装包版本与根版本一致，并启动 `with-frontend` 产品入口，在同一个 server 中同时提供后端 API/stream/control routes 和前端静态资源/route fallback；该命令只作为 dev-only convenience entry，不作为候选运行包 evidence、正式打包入口或 release verdict 来源。
- 仓库根 `package.json.version` 是 fullstack 产品版本唯一权威；`@nextagent/agent-web` artifact package 的 `package.json.version` 必须由根版本写入；`packages/agent-app/manifests/with-frontend.package.json` 中对 `@nextagent/agent-web` 的依赖必须采用标准 npm package dependency 形式，并使用与根版本一致的精确版本；后端对前端包的消费必须与其他 npm 依赖一致，经由配置的 npm registry / package manager resolution 处理，不得把仓库内 tarball 路径、backend-private 装配目录或临时文件路径写入 product manifest。开发 bootstrap 和正式打包都必须校验一致，后端运行时不得自动同步、改写或拉取前端版本。
- 构建阶段必须保证 `backend-only` 产物实现 tree-shaking 或等价裁剪效果，使其最终产物中完全不包含前端注册逻辑和前端静态产物。
- API、SSE、WebSocket 和 control route ownership 不变；前端静态资源 fallback 不得吞掉这些 route。
- 前端和后端必须使用一致的 Node.js 版本和 TypeScript 版本；权威来源是仓库根 `package.json` 的 `engines.node` 和根 `devDependencies.typescript`。
- 仓库根 `workspaces` 保持只覆盖 `packages/*`；`frontend/agent-web` 和 `frontend/agent-web-mock-server` 不自动进入根 workspace。前后端共同依赖的公共组件、共享库或同名公共依赖必须保持版本一致，并提供可验证手段；锁步校验范围由根 `package.json` 中 `x-nextagent.sharedDependencyLockstep` allowlist 定义，只覆盖 `frontend/agent-web`、`agent-app` 或 `@nextagent/agent-app-frontend-hosting` 直接声明的共享依赖；`frontend/agent-web-mock-server` 不在本 change 治理范围内。
- 本 change 不要求统一的 release/build/package orchestration 入口；这部分明确后置，不作为本 change 验收前提。开发阶段单入口 `npm run dev:fullstack` 属于当前 change 范围。

契约输入：
- `ts-backend-architecture` 中关于根 workspace、browser UI source 和 static asset build behavior 的稳定边界。
- `local-runtime-package` 中关于 backend-only package、静态资源托管和 candidate evidence 的稳定边界。
- `agent-app` 作为 composition root 的职责边界。
- `agent-channel-web` 只负责 transport 和 stream projection 的职责边界。
- Fastify 作为当前唯一 Web server / route plugin 技术栈边界。
- 根 `package.json` 作为 workspace、Node.js、TypeScript 和 shared dependency lockstep policy 的权威 manifest。
- 根 `package.json.version` 作为后端运行包和前端 artifact 的产品版本权威。

实现约束：
- 主要写入 owner 保持为 `agent-app`；`frontend/agent-web` 只提供受控 npm 包产物 contract，不得反向拥有后端 serving 或 runtime ownership。
- 前端托管 Fastify 插件必须位于独立 package `packages/agent-app-frontend-hosting`，而不是 `agent-app` 包内普通模块；`agent-app` 只保留 composition 和 route registration owner 身份。
- 不得让后端实现直接依赖前端源码、frontend-private path、前端构建工具私有布局或未声明的工作区状态。
- 不得让 `agent-channel-web`、frontend runtime 或静态资源托管拥有 request lifecycle、timeline、terminal result 或 session/message durable fact。
- profile 选择必须来自可信构建参数或打包参数，而不是运行时扫描目录自动探测。
- `backend-only` 与 `with-frontend` 必须对应 `packages/agent-app/src/entrypoints/backend-only.ts` 和 `packages/agent-app/src/entrypoints/with-frontend.ts` 两个不同入口及其依赖图，不得通过单一入口中的运行时 `if` 分支实现前端可选化。
- `with-frontend` 不得从环境变量、配置文件或运行时目录扫描中推导第二套前端托管配置；只能消费 `@nextagent/agent-web/hosting` 的 public manifest export。
- `npm run dev:fullstack` 中的前端包安装必须通过固定 bootstrap 脚本完成，并且只允许产生与标准 npm 依赖安装一致的结果；不得改写 `with-frontend.package.json`、不得引入 backend-private 文件依赖、不得引入 HMR、Vite dev server 代理或长期运行的前端 watch 流程；依赖准备失败、前端构建失败、前端包安装失败、前端包版本不一致、manifest 非法、路径越界或 `index.html` 不存在时必须 fail closed，不得退回 `backend-only`、不得目录扫描、不得产生 release verdict。
- `@nextagent/agent-web` artifact package version、`with-frontend.package.json` 中声明的 `@nextagent/agent-web` 精确依赖版本和根 `package.json.version` 必须一致；dev bootstrap / packaging validation 发现版本漂移时必须 fail closed，运行时不得自动修正版本。
- `packages/agent-app/manifests/backend-only.package.json` 必须不包含 `@nextagent/agent-app-frontend-hosting` 和 `@nextagent/agent-web`；`packages/agent-app/manifests/with-frontend.package.json` 必须显式包含这两个依赖。

非目标：
- 不定义前端页面行为、前端状态管理、前端路由设计或 UI 交互细节。
- 不定义统一的 release/build/package orchestration、monorepo task runner 或发布流水线编排。
- 不改变 runtime request lifecycle、terminal commit、timeline、stream projection、session/message durable fact、model invocation 或 capability invocation 语义。

验收要点：
- fullstack package profile contract tests 验证 `backend-only` / `with-frontend` 两种形态。
- frontend package consumption tests 验证 `agent-app` 只消费 `@nextagent/agent-web/hosting` 和前端静态产物，不消费源码/private path。
- frontend hosting manifest validation tests 验证 manifest schema、路径约束、缺失文件和非法 manifest 的 fail-closed 行为。
- fullstack dev bootstrap command tests 验证 `npm run dev:fullstack` 一条命令完成依赖准备、前端构建、前端 artifact 装配和同一 server 启动，并同时提供后端 API/stream/control routes 和前端静态资源/route fallback。
- product artifact tests 验证 `backend-only` 构建产物中没有前端注册逻辑和前端静态产物，`with-frontend` 构建产物包含前端托管能力。
- route precedence integration tests 验证静态资源 fallback 不吞掉 API/SSE/WebSocket/control routes。
- product version consistency checks 验证根产品版本、前端 artifact package version 和 `with-frontend.package.json` 中声明的 `@nextagent/agent-web` 精确依赖版本一致，漂移时 fail closed。
- toolchain version consistency checks 和 shared dependency lockstep checks 验证前后端版本锁步。

并行边界：
- 不得修改 runtime canonical facts、stream vocabulary、session/message durable fact owner 或 `agent-channel-web` 的 transport ownership。
- 不得把前端页面行为、统一的 release/build/package orchestration 或前端构建器私有约束混入本 change。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
