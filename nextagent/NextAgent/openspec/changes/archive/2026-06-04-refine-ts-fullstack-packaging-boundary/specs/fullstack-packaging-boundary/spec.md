## ADDED Requirements

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

仓库根 `workspaces` MUST 保持只覆盖 `packages/*`。`frontend/agent-web` MAY 通过显式检查纳入 toolchain 与 shared dependency 治理，但 `frontend/agent-web-mock-server` MUST NOT 自动进入本 change 的 workspace / lockstep scope。

#### Scenario: Mock server package is inspected
- **WHEN** 检查 `frontend/agent-web-mock-server`
- **THEN** 它 MUST NOT 被视为本 change 的 toolchain lockstep 或 shared dependency lockstep 治理对象
