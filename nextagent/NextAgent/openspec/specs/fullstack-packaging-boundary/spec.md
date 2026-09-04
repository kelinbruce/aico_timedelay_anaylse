# fullstack-packaging-boundary Specification

## Purpose
Defines the stable fullstack packaging boundary for NextAgent: the same repository may contain the `frontend/agent-web` source tree, but backend runtime code consumes only packaged frontend artifacts, and product serving shape is selected by trusted packaging input.
## Requirements
### Requirement: Backend consumes only packaged frontend artifacts

当仓库包含 `frontend/agent-web` 前端源码时，后端 `agent-app` SHALL 只消费前端构建后的 npm 包产物及其 public contract。后端 MUST NOT 直接 import 前端源码、frontend-private path、构建器临时目录或未声明的源码工作区状态。

#### Scenario: Agent-app resolves frontend package input
- **WHEN** `agent-app` 需要注册前端静态资源托管
- **THEN** 它 MUST 只从 `@nextagent/agent-web/hosting` public export、package manifest 或静态资源产物中读取所需输入

#### Scenario: Backend code reaches for frontend source
- **WHEN** 后端实现尝试直接依赖 `frontend/agent-web` 源码或 frontend-private path
- **THEN** architecture/dependency validation MUST fail

### Requirement: Frontend package identity and hosting export are fixed

前端构建产物 npm 包身份 SHALL 固定为 `@nextagent/agent-web`。后端启用前端托管时，唯一允许消费的前端托管配置 export SHALL 固定为 `@nextagent/agent-web/hosting`，并且该 export SHALL 固定暴露 `resolveFrontendHostingManifest()`。

#### Scenario: With-frontend build consumes frontend package
- **WHEN** `with-frontend` 产品入口需要启用前端托管
- **THEN** 它 MUST 调用 `@nextagent/agent-web/hosting` 暴露的 `resolveFrontendHostingManifest()`
- **AND** 它 MUST NOT 依赖其他 frontend-private export 或源码路径

### Requirement: Fullstack serving profile is selected by trusted packaging input

系统 SHALL 至少支持 `backend-only` 和 `with-frontend` 两种明确 package/build profile。当前 profile MUST 来自可信构建参数或打包参数，而不是运行时扫描目录、临时文件或偶然存在的静态资源。

#### Scenario: Backend-only candidate is packaged
- **WHEN** trusted packaging input 选择 `backend-only`
- **THEN** 候选运行包 MUST 声明 backend-only profile
- **AND** 前端包缺失不得被视为启动错误
- **AND** 候选 evidence MUST 记录 route registration shape 为纯后端 serving，且不声明前端包证据

#### Scenario: Frontend-enabled candidate is packaged
- **WHEN** trusted packaging input 选择 `with-frontend`
- **THEN** 候选运行包 MUST 要求前端 npm 包产物存在
- **AND** 候选 evidence MUST 记录当前 profile 为 with-frontend
- **AND** 候选 evidence MUST 记录 fullstack 产品版本、后端运行包版本、前端 artifact package 版本、前端 artifact 的内容 hash 或 build ref、前端包证据和 route registration shape

### Requirement: Two product entrypoints define the serving shape

系统 SHALL 使用两个明确的产品入口来定义 serving 形态：

- `packages/agent-app/src/entrypoints/backend-only.ts`
- `packages/agent-app/src/entrypoints/with-frontend.ts`

`backend-only` 产品入口 MUST 只组装后端能力；`with-frontend` 产品入口 MAY 在后端能力之外组装前端托管能力。前端可选化 MUST NOT 通过单一入口中的运行时条件分支实现。

#### Scenario: Backend-only entrypoint is built
- **WHEN** 系统构建 `backend-only` 产品入口
- **THEN** 该入口 MUST 不引用前端托管注册逻辑

#### Scenario: With-frontend entrypoint is built
- **WHEN** 系统构建 `with-frontend` 产品入口
- **THEN** 该入口 MUST 引用 `@nextagent/agent-app-frontend-hosting`
- **AND** 该入口 MUST 引用 `@nextagent/agent-web/hosting`

### Requirement: Product runtime dependencies are governed by dedicated product manifests

系统 SHALL 使用两个专用 product manifest 作为候选运行包依赖权威：

- `packages/agent-app/manifests/backend-only.package.json`
- `packages/agent-app/manifests/with-frontend.package.json`

`packages/agent-app/package.json` MUST NOT 被当作候选运行包依赖权威。

#### Scenario: Backend-only candidate dependencies are inspected
- **WHEN** 检查 `backend-only.package.json`
- **THEN** 它 MUST NOT 声明 `@nextagent/agent-app-frontend-hosting`
- **AND** 它 MUST NOT 声明 `@nextagent/agent-web`

#### Scenario: With-frontend candidate dependencies are inspected
- **WHEN** 检查 `with-frontend.package.json`
- **THEN** 它 MUST 声明 `@nextagent/agent-app-frontend-hosting`
- **AND** 它 MUST 以标准 npm package dependency 形式声明 `@nextagent/agent-web`
- **AND** 该依赖版本 MUST 是与仓库根 `package.json.version` 相同的精确版本

### Requirement: Fullstack product version is rooted in root package manifest

仓库根 `package.json.version` SHALL 是 fullstack 产品版本的唯一权威。前端构建产生的 `@nextagent/agent-web` artifact package MUST 使用该版本作为 artifact package 的 `package.json.version`。`packages/agent-app/manifests/with-frontend.package.json` 中对 `@nextagent/agent-web` 的依赖 MUST 采用标准 npm package dependency 形式，并且该依赖版本 MUST 等于根 `package.json.version`。

后端 MUST NOT 在运行时自动改写、同步或拉取前端版本。版本一致性 MUST 在依赖安装、dev bootstrap、构建或打包装配阶段校验；`with-frontend` 启动或候选包校验发现版本不一致时 MUST fail closed。

#### Scenario: Frontend artifact package is generated
- **WHEN** 系统生成 `@nextagent/agent-web` artifact package
- **THEN** artifact package 的 `package.json.version` MUST 等于仓库根 `package.json.version`

#### Scenario: With-frontend product manifest is inspected
- **WHEN** 检查 `packages/agent-app/manifests/with-frontend.package.json`
- **THEN** 其中 `@nextagent/agent-web` dependency MUST 采用标准 npm package dependency 形式
- **AND** 该依赖版本 MUST 等于仓库根 `package.json.version`

#### Scenario: Product version drifts
- **WHEN** `@nextagent/agent-web` artifact version、已安装 `@nextagent/agent-web` 的包版本或根 `package.json.version` 不一致
- **THEN** dev bootstrap、构建或打包装配 validation MUST fail closed
- **AND** 后端运行时 MUST NOT 自动修正版本

### Requirement: Agent-app owns UI asset route registration

前端静态资源和前端 route fallback 的注册 ownership SHALL 归 `agent-app`。`agent-channel-web` MUST 继续只负责 transport 和 stream projection，MUST NOT 变成静态资源托管 owner。

#### Scenario: Fullstack profile starts
- **WHEN** `agent-app` 以 `with-frontend` profile 启动
- **THEN** `agent-app` MUST 注册前端静态资源 route 和前端 route fallback

#### Scenario: Web channel is reviewed
- **WHEN** 评审 `agent-channel-web`
- **THEN** 它 MUST NOT 被要求直接托管前端静态资源

### Requirement: Frontend hosting is attached through Fastify plugins

前端静态资源托管和前端 route fallback MUST 通过独立 package `@nextagent/agent-app-frontend-hosting` 提供的 Fastify 插件接入。该 package 源码位置 MUST 固定为 `packages/agent-app-frontend-hosting`，并且它 MUST 固定暴露 `frontendHostingPlugin`。`agent-app` MUST 只负责组装这些插件。`backend-only` 产品入口 MUST NOT 依赖或引用这些插件 package；`with-frontend` 产品入口 MAY 依赖、引用并注册这些插件。

#### Scenario: Fullstack entrypoint starts
- **WHEN** `with-frontend` 产品入口启动
- **THEN** `agent-app` MAY 注册前端托管 Fastify 插件

### Requirement: With-frontend hosting configuration has one authority path

`with-frontend` 的前端托管配置 SHALL 只由可信 profile 选择结果和 `@nextagent/agent-web/hosting` 导出的 hosting manifest 共同确定。该 export MUST 通过 `resolveFrontendHostingManifest()` 返回 manifest。系统 MUST NOT 再从环境变量、配置文件或运行时目录扫描中推导第二套前端托管配置。

#### Scenario: With-frontend startup resolves hosting configuration
- **WHEN** `with-frontend` 产品入口启动
- **THEN** 它 MUST 使用 `resolveFrontendHostingManifest()` 返回的 manifest 确定 asset root、`index.html`、base path 和 SPA fallback
- **AND** 它 MUST NOT 再读取独立 app-local runtime 配置源来覆写这些值

### Requirement: Frontend hosting manifest is schema-validated and path-bounded

`resolveFrontendHostingManifest()` 返回值 MUST 通过固定 runtime schema 校验。manifest 至少 MUST 包含：

- `assetRoot`
- `indexHtml`
- `routeBase`
- `spaFallback`

其中 `assetRoot` 和 `indexHtml` MUST 是前端包根内相对路径；MUST NOT 是绝对路径；MUST NOT 包含 `..` 路径穿越；解析后 MUST NOT 逃逸前端包根。`indexHtml` MUST 指向存在文件且位于 `assetRoot` 内。`routeBase` MUST 是以 `/` 开头的规范化 route 前缀。`spaFallback` MUST 是布尔值。

#### Scenario: Manifest is invalid or escapes package root
- **WHEN** `resolveFrontendHostingManifest()` 返回值缺失字段、schema 非法、路径越界或目标文件不存在
- **THEN** `with-frontend` 启动 MUST fail closed
- **AND** 系统 MUST NOT 静默降级为 `backend-only`

### Requirement: Fullstack dev bootstrap starts from one command

系统 SHALL 在仓库根提供 `npm run dev:fullstack` 作为开发阶段单入口。该命令 MUST 按顺序准备后端依赖、准备 `frontend/agent-web` 前端依赖、构建前端静态产物、生成最小 `@nextagent/agent-web` artifact package、通过固定 bootstrap 脚本按标准 npm package install 语义安装该前端包，并启动 `with-frontend` 产品入口。

启动后，同一个 server MUST 同时提供后端 API/stream/control routes 和前端静态资源/route fallback。

`npm run dev:fullstack` MUST 仅作为 dev-only convenience entry。它 MUST NOT 作为候选运行包 evidence、正式打包入口、release qualification 输入或 release verdict 来源；前端包安装 MUST 通过固定 bootstrap 脚本产生与标准 npm 依赖安装一致的结果，MUST NOT 改写 `with-frontend.package.json` 或引入 backend-private 文件依赖；MUST NOT 引入 HMR、Vite dev server 代理或长期运行的前端 watch 流程。

`@nextagent/agent-web` artifact package MUST 只包含后端托管所需的静态构建产物和 `@nextagent/agent-web/hosting` public export。浏览器运行所需的前端运行时代码 MUST 已包含在 `dist/` 静态资源内；后端静态托管 MUST NOT 依赖 frontend `node_modules`、前端源码目录、Vite dev server 或 CDN。

#### Scenario: Developer starts fullstack serving from one command
- **WHEN** 开发同学在仓库根执行 `npm run dev:fullstack`
- **THEN** 系统 MUST 准备后端依赖和前端依赖
- **AND** 系统 MUST 构建前端静态产物
- **AND** 系统 MUST 生成 `@nextagent/agent-web` artifact package
- **AND** 系统 MUST 通过固定 bootstrap 脚本按标准 npm package install 语义安装该前端包
- **AND** 系统 MUST 启动 `with-frontend` 产品入口
- **AND** 同一个 server MUST 同时提供后端 API/stream/control routes 和前端静态资源/route fallback

#### Scenario: Fullstack dev bootstrap cannot prepare frontend artifact
- **WHEN** 开发同学执行 `npm run dev:fullstack`
- **AND** 依赖准备失败、前端构建失败、前端包安装失败、`@nextagent/agent-web/hosting` 缺失、manifest 非法、路径越界或 `index.html` 不存在
- **THEN** 命令 MUST fail closed
- **AND** 系统 MUST NOT 静默降级为 `backend-only`
- **AND** 系统 MUST NOT 通过目录扫描推导前端资源位置

### Requirement: Backend-only artifacts exclude frontend hosting capability

构建阶段 MUST 对 `backend-only` 产物执行 tree-shaking 或等价产物裁剪，使最终交付物中完全不包含：

- 前端托管注册逻辑；
- 前端 npm 包产物引用；
- 前端静态资源产物。

`with-frontend` 产物则 MAY 保留这些内容。

#### Scenario: Backend-only artifact is inspected
- **WHEN** 检查 `backend-only` 最终构建产物
- **THEN** 其中 MUST NOT 存在前端托管注册逻辑或前端静态资源产物

### Requirement: Backend-only remains a valid runtime package profile

`backend-only` SHALL 保持为有效运行包形态。该形态下系统 MUST 提供 API、SSE/WebSocket 和 health/readiness；MUST NOT 因前端包缺失而失败；MUST NOT 注册前端静态资源 route。

#### Scenario: Backend-only package starts without frontend package
- **WHEN** backend-only 运行包启动且没有前端包产物
- **THEN** 系统 MUST 正常进入纯后端 serving 形态

### Requirement: UI asset fallback never takes ownership of backend routes

无论是否启用 `with-frontend`，前端静态资源 fallback SHALL 只处理非 API 的静态资源和前端 route fallback。API、SSE、WebSocket 和 control routes MUST 继续由后端既有 owner 处理。

#### Scenario: Request targets backend route
- **WHEN** 请求命中 `/api/**`、SSE、WebSocket 或 control route
- **THEN** 前端静态资源 fallback MUST NOT 处理该请求

#### Scenario: Request targets frontend route
- **WHEN** 请求不命中后端 route 且当前 profile 为 `with-frontend`
- **THEN** 前端静态资源托管 MAY 提供静态资源或前端 route fallback

### Requirement: Frontend and backend toolchain versions are lockstep-governed

前端和后端 MUST 使用一致的 Node.js 版本和 TypeScript 版本。仓库根 `package.json` SHALL 是这些 toolchain 版本的权威 manifest：`engines.node` 是 Node.js 权威值，根 `devDependencies.typescript` 是 TypeScript 权威值。版本一致性 MUST 通过可验证规则检查，而不是仅靠文档约定。

#### Scenario: Node or TypeScript versions drift
- **WHEN** 前端和后端的 Node.js 或 TypeScript 版本不一致
- **THEN** consistency validation MUST fail

### Requirement: Shared dependencies remain version-aligned across frontend and backend

前后端共同依赖的公共组件、共享库或同名公共依赖 MUST 保持版本一致。shared dependency lockstep 的校验范围 SHALL 由仓库根 `package.json` 中的 `x-nextagent.sharedDependencyLockstep` allowlist 定义，并且只覆盖同时被 `frontend/agent-web`、`agent-app` 或 `@nextagent/agent-app-frontend-hosting` 直接声明的共享依赖。共享依赖版本漂移 MUST 被显式校验并阻断受控构建或候选运行包生成。

#### Scenario: Shared dependency version drifts
- **WHEN** 前端和后端的共同依赖版本不一致
- **THEN** dependency lockstep validation MUST fail

### Requirement: Frontend repo packages outside `frontend/agent-web` stay out of lockstep scope

仓库根 `workspaces` MUST 保持只覆盖 `packages/*`。`frontend/agent-web` MAY 通过显式检查纳入 toolchain 与 shared dependency 治理，但 `frontend/agent-web-mock-server` MUST NOT 自动进入本 capability 的 workspace / lockstep scope。

#### Scenario: Mock server package is inspected
- **WHEN** 检查 `frontend/agent-web-mock-server`
- **THEN** 它 MUST NOT 被视为本 capability 的 toolchain lockstep 或 shared dependency lockstep 治理对象

### Requirement: Source watch dev mode starts from one command
系统 SHALL 在仓库根提供 `npm run dev:watch` 作为源码开发阶段 watch 入口。该入口 MUST 同时启动前端源码开发服务和后端 backend-only 开发服务，使开发者能够通过一个长期运行命令观察前后端源码修改。

`dev:watch` MUST NOT 自动执行依赖安装。依赖缺失、脚本缺失、端口占用或子进程无法启动时，命令 MUST 显式失败，不得静默降级为 `dev:fullstack`、`backend-only` 单进程或 frontend-only 单进程。

#### Scenario: Developer starts source watch mode
- **WHEN** 开发同学在仓库根执行 `npm run dev:watch`
- **THEN** 系统 MUST 启动 `frontend/agent-web` 的 Vite dev server
- **AND** 系统 MUST 启动 backend-only 后端服务
- **AND** 前端服务 MUST 能通过 Vite `/api` proxy 访问该 backend-only 后端服务
- **AND** 命令 MUST 保持运行直到用户终止或任一必需子进程失败

#### Scenario: Source watch dependencies are missing
- **WHEN** 开发同学执行 `npm run dev:watch`
- **AND** 后端依赖、前端依赖、构建脚本或开发脚本缺失
- **THEN** 命令 MUST fail closed
- **AND** 命令 MUST NOT 自动运行根目录或 `frontend/agent-web` 的依赖安装

### Requirement: Source watch frontend uses Vite HMR
`dev:watch` SHALL 使用 `frontend/agent-web` 的 Vite dev server 承载前端源码开发体验。前端源码修改后的 HMR 行为由 Vite dev server 提供；本 requirement 不定义新的前端 HMR 机制。

`dev:watch` 使用的前端 dev server MUST 默认通过 `http://127.0.0.1:5173/` 暴露本地开发页面。实现 MAY 允许开发者通过显式本地 dev server host 配置覆盖默认 host，但默认行为 MUST 使用可从本机访问的 loopback 地址。

`dev:watch` MUST 通过 Vite dev server 代理后端 API 路径到 backend-only 后端服务。该代理 MUST 覆盖 REST API、SSE stream 和 WebSocket stream upgrade 使用的 `/api/**` 路径。

#### Scenario: Frontend dev entry is reachable on local loopback
- **WHEN** 开发同学执行 `npm run dev:watch`
- **THEN** Vite dev server MUST 默认监听 `127.0.0.1:5173`
- **AND** 前端页面 MUST 能通过 `http://127.0.0.1:5173/` 访问
- **AND** 显式 host 覆盖 MUST NOT 改变 backend-only 后端监听配置或 `/api` proxy target

#### Scenario: Frontend source changes during watch mode
- **WHEN** `dev:watch` 正在运行
- **AND** 开发同学修改 `frontend/agent-web` 前端源码
- **THEN** Vite dev server MUST 继续作为前端页面服务入口
- **AND** 前端页面的源码更新反馈 MUST 由 Vite HMR 机制处理
- **AND** 后端不需要构建或安装 `@nextagent/agent-web` artifact package 才能让前端源码改动进入开发页面

#### Scenario: Frontend calls backend through proxy
- **WHEN** `dev:watch` 正在运行
- **AND** 前端页面发起 `/api/**` REST、SSE stream 或 WebSocket stream 请求
- **THEN** Vite dev server MUST 将该请求代理到 backend-only 后端服务
- **AND** 前端静态托管 fallback MUST NOT 处理该请求

### Requirement: Source watch backend restarts after successful TypeScript compilation
`dev:watch` SHALL 使用 TypeScript watch 编译后端源码，并在编译成功产出可运行后端构建结果后自动重启 backend-only Node 进程。该行为是进程级自动重启，不是后端进程内 HMR。

后端 watch 重启 MUST 使用 backend-only 产品入口。重启后的后端服务 MUST 继续提供 API、SSE/WebSocket stream 和 control routes。`dev:watch` MUST NOT 为后端代码热替换定义新的 runtime lifecycle、terminal commit、stream migration、gateway persistence 或 in-flight request 语义。

#### Scenario: Backend source changes and compilation succeeds
- **WHEN** `dev:watch` 正在运行
- **AND** 开发同学修改后端 TypeScript 源码
- **AND** TypeScript watch 编译成功产出可运行后端构建结果
- **THEN** `dev:watch` MUST 自动重启 backend-only Node 进程
- **AND** 重启后的后端 MUST 继续通过 backend-only serving shape 提供后端 routes

#### Scenario: Backend source changes and compilation fails
- **WHEN** `dev:watch` 正在运行
- **AND** 后端 TypeScript watch 编译失败
- **THEN** `dev:watch` MUST NOT 重启到失败编译产生的坏产物
- **AND** 命令 MUST 让编译失败作为可观察诊断暴露给开发同学

#### Scenario: Backend restart interrupts live connections
- **WHEN** `dev:watch` 因后端源码成功编译而重启 backend-only Node 进程
- **THEN** 系统 MUST NOT 承诺既有 SSE 或 WebSocket 连接在后端进程重启期间保持不断开
- **AND** 本 capability MUST NOT 定义 stream connection 迁移、in-flight request 迁移或进程内状态热替换语义
- **AND** 已持久化状态的恢复行为仍由既有 runtime recovery 和 stream replay 规格承载

### Requirement: Source watch mode preserves packaged fullstack boundary
`dev:watch` SHALL 是独立于 `dev:fullstack` 的源码开发入口。它 MUST NOT 替代、调用或改变 `dev:fullstack` 的 packaged static hosting verification 流程。

`dev:watch` MUST NOT 构建前端静态 artifact、生成最小 `@nextagent/agent-web` artifact package、通过 bootstrap 脚本安装该前端包、启动 `with-frontend` 产品入口或注册 `@nextagent/agent-app-frontend-hosting` 前端静态托管插件。

#### Scenario: Source watch mode is inspected for packaged frontend behavior
- **WHEN** 开发同学执行 `npm run dev:watch`
- **THEN** 命令 MUST NOT 执行 `@nextagent/agent-web` artifact package 生成流程
- **AND** 命令 MUST NOT 安装 `@nextagent/agent-web` artifact package
- **AND** 命令 MUST NOT 启动 `with-frontend` 产品入口
- **AND** 命令 MUST NOT 注册前端静态资源 route 或 SPA fallback

#### Scenario: Fullstack dev bootstrap remains unchanged
- **WHEN** 开发同学执行 `npm run dev:fullstack`
- **THEN** 系统 MUST 继续执行既有 packaged static hosting bootstrap 流程
- **AND** `dev:fullstack` MUST NOT 引入 Vite dev server proxy、前端 HMR 或长期运行的前端 watch 流程

### Requirement: Frontend backend dev profile targets the default backend
前端 backend dev profile SHALL target the backend-only default development endpoint. `frontend/agent-web/.env.backend` MUST set `VITE_PROXY_TARGET=http://localhost:3000` and MUST keep the default transport as `VITE_TRANSPORT_KIND=SSE`.

#### Scenario: Backend dev profile starts against the local backend
- **WHEN** a developer starts the frontend backend dev profile from `frontend/agent-web`
- **THEN** Vite MUST use `http://localhost:3000` as the backend proxy target
- **AND** the default transport kind MUST be SSE
- **AND** the profile MUST NOT require the packaged fullstack entrypoint

### Requirement: Script-level websocket dev profile is not a transport authority
The frontend package SHALL NOT expose a dedicated script or `.env` mode whose only purpose is to force WebSocket transport. Runtime transport selection MUST remain owned by the frontend runtime configuration value `VITE_TRANSPORT_KIND`; the WebSocket implementation and its tests MUST remain available.

#### Scenario: Developer chooses WebSocket transport explicitly
- **WHEN** a developer needs to exercise WebSocket transport in frontend dev
- **THEN** the developer MUST use the normal frontend dev entry with `VITE_TRANSPORT_KIND=WEBSOCKET` supplied explicitly in the environment
- **AND** `frontend/agent-web` MUST NOT provide a `dev:ws` package script
- **AND** the repository MUST NOT provide `frontend/agent-web/.env.websocket`

### Requirement: Local runtime data stays out of version control
The repository SHALL treat local runtime SQLite data as developer-machine state, not source or OpenSpec artifact. The root `.gitignore` MUST ignore `data/` so backend startup and tests do not create Git-visible SQLite files.

#### Scenario: Local runtime data is generated
- **WHEN** tests or local development create files under `data/`
- **THEN** those files MUST be ignored by Git
- **AND** generated SQLite runtime data MUST NOT appear as source changes

### Requirement: Frontend artifact publishes multi-host formal assets

The `@nextagent/agent-web` formal artifact SHALL publish only formal runtime assets for product consumption. The formal frontend artifact MUST include:

- `index.html` as the formal output generated from the immersive source entry `immersive.html`.
- Static assets required by `index.html`.
- `piu/AIAgentPIU.js` as the collaborative PIU JavaScript asset.
- `piu/AIAgentPIU.css` as the collaborative PIU same-name stylesheet asset.
- `@nextagent/agent-web/hosting` public export and hosting manifest required by `with-frontend`.

The PIU asset name MUST be `AIAgentPIU`. The formal artifact MUST provide `AIAgentPIU.js` and the same-name stylesheet `AIAgentPIU.css`. The PIU runtime identity MUST be `AIAgentPIU`, and the artifact package version MUST equal the repository root `package.json.version`.

The `AIAgentPIU` formal runtime asset set is closed: product Prel loading MUST be able to start the PIU by loading only `piu/AIAgentPIU.js` and `piu/AIAgentPIU.css`. `piu/AIAgentPIU.js` MUST NOT require any additional emitted JavaScript chunk, runtime asset manifest, or script-injected JavaScript file. `piu/AIAgentPIU.css` MUST NOT require any additional emitted stylesheet. Static assets required by the immersive `index.html` MAY exist, but they MUST NOT be required for `AIAgentPIU` startup.

#### Scenario: Formal frontend artifact is generated
- **WHEN** the frontend formal artifact is assembled
- **THEN** the artifact MUST include `index.html`
- **AND** `index.html` MUST be generated from the immersive source entry `immersive.html`
- **AND** the artifact MUST NOT publish the local source `index.html`
- **AND** the artifact MUST include `piu/AIAgentPIU.js`
- **AND** the artifact MUST include `piu/AIAgentPIU.css`
- **AND** the artifact package version MUST equal the repository root `package.json.version`

#### Scenario: Product loads the PIU asset through Prel
- **WHEN** a product runtime resolves `AIAgentPIU` through Prel asset loading
- **THEN** the formal artifact MUST provide a PIU JavaScript asset named `AIAgentPIU.js`
- **AND** the formal artifact MUST provide a PIU stylesheet asset named `AIAgentPIU.css`
- **AND** those assets MUST represent the `AIAgentPIU` runtime identity

#### Scenario: PIU runtime asset set is closed
- **WHEN** the formal frontend artifact is inspected for `AIAgentPIU` runtime requirements
- **THEN** `piu/AIAgentPIU.js` MUST be the only JavaScript asset required to start `AIAgentPIU`
- **AND** `piu/AIAgentPIU.css` MUST be the only stylesheet asset required by `AIAgentPIU`
- **AND** `piu/AIAgentPIU.js` MUST NOT reference extra emitted JavaScript chunks through dynamic import, script injection, or a runtime asset manifest
- **AND** `piu/AIAgentPIU.css` MUST NOT require extra emitted stylesheet assets
- **AND** immersive `index.html` static assets MUST NOT be required for `AIAgentPIU` startup

### Requirement: Formal index is immersive and loads Prel

The source `immersive.html` in `@nextagent/agent-web` SHALL be the immersive entry for dev/test smoke. The formal artifact `index.html` SHALL be generated from `immersive.html`. Both `immersive.html` and the formal artifact `index.html` MUST include `<script src="/febs/v1/assets/prelude-loader"></script>` and MUST NOT alter the script `src`.

The source `index.html` SHALL remain the standalone local entry for frontend/backend local testing. The formal artifact `index.html` MUST NOT be produced from that local source entry, and local standalone behavior MUST remain outside the formal artifact.

#### Scenario: Formal index is inspected
- **WHEN** the formal `index.html` is inspected
- **THEN** it MUST include `<script src="/febs/v1/assets/prelude-loader"></script>`
- **AND** the `src` attribute MUST be exactly `/febs/v1/assets/prelude-loader`
- **AND** it MUST NOT include local-mode-only page ownership for login, theme, locale, help, or logout

### Requirement: Dev and test host assets are excluded from formal artifact

The local source `index.html`, source `immersive.html`, source `collaborative.html`, collaborative dev/test host generated JavaScript/CSS/assets, and the lightweight mock Prel loader SHALL be dev/test-only source or test-host assets. The local source `index.html` MUST NOT be copied or used as the formal artifact `index.html`. The source `immersive.html` MUST NOT be included in the formal artifact under the name `immersive.html`. The source `collaborative.html` MUST NOT be included in the formal artifact under the name `collaborative.html`. JavaScript, CSS, or asset files owned only by the `collaborative.html` dev/test host MUST NOT be included in the formal artifact. Test hosts and mock Prel files MUST NOT be exposed through `@nextagent/agent-web/hosting`.

Dev/test tooling MAY provide these assets for local verification, including a mock top menu with a right-side PIU render container, but formal product packaging MUST exclude them.

#### Scenario: Formal artifact excludes dev and test hosts
- **WHEN** the formal `@nextagent/agent-web` artifact is inspected
- **THEN** source `immersive.html` MUST NOT be present
- **AND** the local source `index.html` MUST NOT be published as the formal `index.html`
- **AND** source `collaborative.html` MUST NOT be present
- **AND** JavaScript, CSS, or asset files generated only for the `collaborative.html` dev/test host MUST NOT be present
- **AND** the mock Prel loader MUST NOT be present

#### Scenario: Dev test host provides PIU containers
- **WHEN** the dev/test host serves `collaborative.html`
- **THEN** the host MAY render a mock product top menu
- **AND** the top menu MAY include a right-side container used by `loadAIAgent`
- **AND** those test-host containers MUST remain outside the formal artifact

### Requirement: Multi-host build is one formal build output

The formal frontend build SHALL produce all formal mode assets in one controlled build flow. It MUST build `immersive.html` into the formal artifact file `index.html`, and it MUST produce `piu/AIAgentPIU.js` plus `piu/AIAgentPIU.css` in the same formal flow so product runtime can choose which asset to load. The build flow MUST fail closed if any formal asset is missing or if `AIAgentPIU` requires any runtime asset outside the closed PIU asset set.

#### Scenario: Formal multi-host build completes
- **WHEN** the frontend formal build command completes successfully
- **THEN** `index.html` MUST exist as the formal output generated from `immersive.html`
- **AND** `piu/AIAgentPIU.js` MUST exist as the PIU entry
- **AND** `piu/AIAgentPIU.css` MUST exist as the PIU same-name stylesheet
- **AND** product packaging MUST NOT need a second frontend build to obtain any formal asset

#### Scenario: PIU asset is missing from formal build
- **WHEN** the frontend formal build command cannot produce `piu/AIAgentPIU.js` or `piu/AIAgentPIU.css`
- **THEN** the build MUST fail closed
- **AND** the artifact assembly MUST NOT silently publish an immersive-only artifact

#### Scenario: PIU build emits an extra required runtime asset
- **WHEN** the frontend formal build command emits an extra JavaScript chunk, stylesheet, runtime asset manifest, or script-injected JavaScript file required by `AIAgentPIU`
- **THEN** the build MUST fail closed
- **AND** the artifact assembly MUST NOT publish a PIU package that requires more than `piu/AIAgentPIU.js` and `piu/AIAgentPIU.css`

