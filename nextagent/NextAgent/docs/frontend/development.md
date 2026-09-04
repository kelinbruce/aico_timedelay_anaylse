# 前端开发指南

本文说明如何开发和验证 `frontend/agent-web`。产品行为和长期架构仍以 OpenSpec 为准；package 内的当前 owner 与调用边界见 [`ARCHITECTURE.md`](../../frontend/agent-web/ARCHITECTURE.md)。

## 前置条件

- Node.js `>= 22.0.0`
- npm workspaces

根 workspace 只包含 `packages/*`，因此前端依赖需要单独安装：

```powershell
npm install
cd frontend/agent-web
npm install
cd ../agent-web-mock-server
npm install
```

`npm run dev:fullstack` 只会自动安装根 workspace 和 `frontend/agent-web` 的依赖，不会安装 Mock Server 依赖。运行 `npm run dev:mock` 或 `npm run mock` 前，必须已经完成 `frontend/agent-web-mock-server` 的独立依赖安装；其他前端开发命令也默认对应依赖已经存在。

## 前后端源码联调

从仓库根目录运行：

```powershell
npm run dev:watch
```

该命令启动 TypeScript solution watch，在后端编译成功后启动本地 gateway 入口，并启动一个把 `/api` 代理到后端的 Vite server：

- 后端：`http://127.0.0.1:3000`
- Local：`http://127.0.0.1:5173/`
- Immersive：`http://127.0.0.1:5173/immersive/`
- Collaborative 开发宿主：`http://127.0.0.1:5173/collaborative/`

修改前端源码由 Vite 热更新；修改后端源码后，watch script 会在编译成功时重启本地后端。

## 只启动前端

真实后端已经运行在 `http://localhost:3000` 时，可以执行：

```powershell
cd frontend/agent-web
npm run dev
```

该命令读取 `.env.backend`，只启动 Vite，并把 `/api` 代理到后端；它不会启动后端进程。

## 使用 Mock Server

需要独立开发前端时，推荐执行：

```powershell
cd frontend/agent-web
npm run dev:mock
```

该命令同时启动：

- Web Channel mock：`http://localhost:3001`
- Vite：`http://127.0.0.1:5173`

也可以只启动 mock：

```powershell
cd frontend/agent-web-mock-server
npm start
```

或从 `frontend/agent-web` 运行 `npm run mock`。Mock Server 只用于接口和交互联调，不提供完整 runtime、gateway、持久化或安全边界；其覆盖范围见 [`frontend/agent-web-mock-server/README.md`](../../frontend/agent-web-mock-server/README.md)。

## 完整构建产物联调

要验证正式前端 artifact 被后端安装和托管的路径，从仓库根目录运行：

```powershell
npm run dev:fullstack
```

脚本按顺序完成根依赖安装与构建、前端依赖安装、正式多 target 构建、artifact 组装、临时包安装、托管边界校验，最后启动 `packages/agent-app/dist/entrypoints/with-frontend.js`。它不是 watch 模式；修改源码后需要重新运行。

部署和产物结构的完整说明见[部署说明](../developer/12-deployment.md)。

## 目录地图

| 路径 | 当前职责 |
| --- | --- |
| `src/entries/` | Local、Immersive 和 PIU entry，以及渲染前 runtime bootstrap |
| `src/App.tsx` | Local shell、本地认证编排和只读分享路由 |
| `src/app/` | `AppProviders`、Immersive shell、host 类型、非本地鉴权和路由式 `ChatWorkspace` |
| `src/pages/` | `ChatPage`、`SharedConversationPage` 等页面编排 |
| `src/features/` | 按产品能力组织的视图、交互、hook 和 view model |
| `src/features/chat/transport/` | SSE / WebSocket 连接实现 |
| `src/state/` | Zustand store 与浏览器侧状态投影 |
| `src/services/` | 普通 HTTP API client 与业务 service |
| `src/config/` | runtime bootstrap、主题等配置 |
| `src/host/` | Prel adapter 与开发 mock |
| `src/piu/` | Collaborative PIU 注册、显示、布局和内部导航 |
| `tests/` | Vitest unit、component、source/contract tests |
| `tests/e2e/` | Playwright smoke |

页面或组件不应自行增加 `fetch` / `WebSocket`。普通 API、runtime bootstrap 和 stream transport 的 owner 见 package [`ARCHITECTURE.md`](../../frontend/agent-web/ARCHITECTURE.md)。

## Runtime 配置

React tree 渲染前，`src/entries/renderRoot.tsx` 会调用 `src/config/runtimeConfig.ts` 加载运行时配置：

1. `backendBaseUrl` 来自 `VITE_BACKEND_BASE_URL`；未配置时使用同源地址。
2. 产品运行时通过 `GET /api/v1/runtime/bootstrap` 获取 `transportKind`。
3. 仅开发环境在 bootstrap 失败时回退到 `VITE_TRANSPORT_KIND`，最后默认使用 `SSE`。
4. 非开发环境无法获取或无法校验 bootstrap 时 fail closed，显示 runtime configuration error，而不是猜测 transport。

Vite 开发代理由 `VITE_PROXY_TARGET` 配置；`.env.backend` 默认指向 `http://localhost:3000`，`.env.mock` 默认指向 `http://localhost:3001`。

## 构建与测试

在 `frontend/agent-web` 目录运行：

```powershell
npm run build
npm test
npm run build:vite
npm run build:vite:modes
npm run test:e2e
```

- `npm run build` 执行 TypeScript `--noEmit` 校验。
- `npm test` 执行全部 Vitest 测试。
- `npm run build:vite` 执行单 target Vite build。
- `npm run build:vite:modes` 构建正式 Immersive 页面 target 和 PIU target，并校验 artifact allowlist / denylist。
- `npm run test:e2e` 当前只运行 `tests/e2e/app-smoke.spec.cjs`，验证 Local welcome shell；它不是三宿主或完整业务旅程的 E2E 覆盖。

可以用 Vitest 文件路径缩小验证范围，例如：

```powershell
npm test -- tests/runtime-config.test.ts tests/stream-transport.test.ts
npm test -- tests/conversationStore.test.ts tests/useChatSessionStream.test.tsx
npm test -- tests/immersive-entry.test.tsx tests/piu-runtime-contract.test.tsx
```

## 修改后的验证选择

- 通用前端业务变更：至少运行 `npm run build` 和相关 Vitest；影响面较大时运行 `npm test`。
- Runtime config 或 stream：重点覆盖 `runtime-config`、`stream-transport`、`useStreamConnection`、`useChatSessionStream` 和 `conversationStore`。
- Host、Prel 或 PIU：除针对性测试外，手动检查 `/immersive/` 与 `/collaborative/`，并运行 `npm run build:vite:modes`。
- 正式托管边界：运行 `npm run build:vite:modes`，必要时从仓库根执行 `npm run fullstack:validate` 或 `npm run dev:fullstack`。
- API、stream event、runtime command、权限或其他契约变化：先进入对应 OpenSpec change，再按全仓门禁验证。

## 调试入口

| 现象 | 首先检查 |
| --- | --- |
| 页面显示 runtime configuration unavailable | Network 中的 `GET /api/v1/runtime/bootstrap`、`src/config/runtimeConfig.ts`、`src/entries/renderRoot.tsx` |
| `/api` 请求到了错误服务 | `vite.config.ts`、`.env.backend`、`.env.mock`、`VITE_PROXY_TARGET` |
| Local 登录或非本地身份跳转异常 | `src/services/apiClient.ts`、`src/services/authProbe.ts`、`src/app/NonLocalAuth.tsx` |
| 路由和当前会话不同步 | `src/App.tsx`、`src/app/ChatWorkspace.tsx`、`src/pages/ChatPage.tsx`、`src/state/sessionStore.ts` |
| 刷新后历史或 active run 不一致 | `src/services/sessionService.ts`、`src/state/conversationStore.ts`、`buildSessionProjection.ts` |
| SSE / WebSocket 重连、gap 或降级异常 | `src/features/chat/transport/streamTransport.ts`、`useStreamConnection.ts`、`useChatSessionStream.ts` |
| Immersive 页面宿主异常 | `src/entries/immersive.tsx`、`src/app/ImmersiveApp.tsx` |
| 正式 PIU 注册、挂载异常 | `src/entries/piu.tsx`、`src/piu/registerAIAgentPIU.tsx`、`src/piu/AIAgentPiuRuntime.tsx` |
| Collaborative 本地开发宿主异常 | `src/entries/collaborative.ts` |
| Mock 响应与前端预期不一致 | `frontend/agent-web-mock-server/routes/` 与 [agent-web API 清单](../apis/agent-web-api-list.md) |

## 相关文档

- [前端文档入口](./README.md)
- [前端用户工作流](./user-workflows.md)
- [agent-web 实现架构](../../frontend/agent-web/ARCHITECTURE.md)
- [agent-web 界面原则](../../frontend/agent-web/PRINCIPLE.md)
- [快速上手](../developer/01-quickstart.md)
- [测试与调试](../developer/11-testing-debugging.md)
- [部署说明](../developer/12-deployment.md)
- [agent-web API 清单](../apis/agent-web-api-list.md)
