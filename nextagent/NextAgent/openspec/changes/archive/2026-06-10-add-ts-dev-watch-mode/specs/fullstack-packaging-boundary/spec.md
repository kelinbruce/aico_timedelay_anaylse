## ADDED Requirements

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
- **AND** 本 change MUST NOT 定义 stream connection 迁移、in-flight request 迁移或进程内状态热替换语义
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
