## 背景与问题（Why）

当前仓库已经有 `npm run dev:fullstack`，但该入口按 fullstack packaging 边界工作：构建前端静态产物、生成并安装 `@nextagent/agent-web` artifact package，然后启动 `with-frontend` 产品入口。它适合验证 packaged static hosting 行为，但不适合日常源码开发。

日常开发需要一个更短的反馈回路：前端源码修改应由 Vite dev server 提供 HMR；后端源码修改应由 TypeScript watch 编译并在编译成功后自动重启 backend-only 后端进程。现在缺少一个被 OpenSpec 明确定义的源码 watch 开发入口，开发者需要手动编译、构建或重启，容易把 source development 和 packaged fullstack verification 混在一起。

本 change 的必要性在于：在不改变 `dev:fullstack`、`backend-only` / `with-frontend` profile、前端静态托管边界、SSE/WebSocket stream 语义的前提下，新增一个专门用于源码开发的 watch mode。

## 变更范围（What Changes）

- 在仓库根定义新的开发入口 `npm run dev:watch`。
- `dev:watch` MUST 启动 `frontend/agent-web` 的 Vite dev server，并保留 Vite 自带 HMR 行为。
- `dev:watch` MUST 启动 backend-only 后端服务，提供后端 API、SSE/WebSocket stream 和 control routes。
- 后端代码修改后，`dev:watch` MUST 通过 TypeScript watch 编译成功触发 backend-only Node 进程自动重启；本 change 不定义后端进程内 HMR。
- `dev:watch` MUST NOT 构建前端静态 artifact、生成或安装 `@nextagent/agent-web` artifact package、启动 `with-frontend` 产品入口或注册前端静态托管 route。
- `dev:fullstack` MUST 保持 packaged static hosting verification 语义不变，继续禁止 HMR、Vite dev server proxy 或长期运行的前端 watch 流程。
- `dev:watch` MUST 为前端 Vite 进程注入真实后端 proxy target，以便前端通过 Vite `/api` proxy 访问 backend-only 后端。
- `dev:watch` 使用的前端 dev server MUST 默认通过本地 loopback `http://127.0.0.1:5173/` 可访问，并允许开发者通过 `VITE_DEV_HOST` 显式覆盖 dev server host。
- 本 change 不改变 SSE/WebSocket transport 等价性、不修改 runtime transport config 的选择能力、不修改 runtime lifecycle、terminal commit、canonical timeline、gateway persistence 或产品打包流程。
- 作为开发入口收敛的一部分，前端 backend dev profile 对齐当前 backend-only 默认端口 `3000`，删除脚本级 `.env.websocket` / `dev:ws` convenience profile；WebSocket transport 仍通过显式 `VITE_TRANSPORT_KIND=WEBSOCKET` 运行时配置选择。
- 本地运行数据目录 `data/` 作为开发机器状态从版本控制候选集中排除。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `fullstack-packaging-boundary`: 新增源码 watch 开发入口 `dev:watch` 的行为契约，并明确它与既有 `dev:fullstack` packaged static hosting 入口的边界。

## 影响范围（Impact）

- OpenSpec：修改 `fullstack-packaging-boundary` capability 的增量规格，新增 dev watch mode 需求。
- 根脚本与开发脚本：后续实现会新增 `npm run dev:watch` 及其编排脚本。
- 后端开发启动：后续实现会以 backend-only entrypoint 作为 watch mode 后端服务入口。
- 前端开发启动：后续实现会复用 `frontend/agent-web` 的 Vite dev server 和 HMR，不新增前端 HMR 实现。
- 配置：后续实现会在 `dev:watch` 编排层注入 Vite proxy target，避免把 watch mode 绑定到 packaged fullstack 配置。
- 测试：需要覆盖 `dev:watch` 的编排边界、`dev:fullstack` 语义不变、backend-only 启动边界和 Vite proxy 形态。
- 无 Web API、stream event、runtime command、领域对象、gateway record 或持久化 schema 变更。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/fullstack-packaging-boundary/spec.md`：新增 `dev:watch` 源码开发入口需求，保留 `dev:fullstack` packaged static hosting 需求。

长期背景：
- `openspec/overview.md`：无，watch mode 是开发入口补充，不改变产品范围或长期业务背景。

设计视图：
- `openspec/designs/architecture/fullstack-packaging-boundary.md`：归档前补充 `dev:watch` 与 `dev:fullstack` 的开发入口分工、backend-only watch 服务边界和非 HMR 后端重启策略。
- `openspec/designs/modules/agent-app.md`：如实现只复用既有 backend-only entrypoint，无需更新；若新增 app-level public helper 或新的 composition entry，则归档前补充模块职责。
- `openspec/designs/adr/<id>.md`：无，不需要新增长期 ADR；后端不做 HMR 的取舍可保留在 architecture 设计中。
- `openspec/designs/spec-to-design-map.md`：归档前补充 `fullstack-packaging-boundary` 的验证入口包含 dev watch orchestration tests。

验证入口：
- `openspec validate add-ts-dev-watch-mode --strict`
- `dev:watch` orchestration tests
- `dev:fullstack` packaging boundary regression tests
- backend-only startup/profile tests
- Vite proxy configuration tests
