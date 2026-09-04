## 背景与问题（Why）

NextAgent 当前所有 Web API 路由前缀 `/api/v1` 在后端多处硬编码、前端 21 个文件硬编码。在反向代理前置前缀等部署场景下，使用者无法通过配置改变 API 挂载前缀，必须改代码。

本 change 引入一处公共前缀 `P`（`channel.routePrefix`，后端 yaml；前端构建期 `import.meta.env.VITE_API_URL_PREFIX`），让 NextAgent 自身暴露和调用的**全部 Web API** 自动带上 `P`。`P` 默认 `/`（无前缀），不改配置即与现状完全一致；设 `P=/svcA` 即让 API 挂载在 `/svcA/api/v1/...`。

此外，生产构建 `npm run build:vite:modes` 新增 `--base` 和 `--apiUrlPrefix` 两个 CLI 参数，分别控制 Vite `base`（静态资源路径前缀）和 `P`（API 调用前缀）。不传参数时行为与改动前完全一致。

**关键语义：前置追加，不替换。** `/api/v1` 段固定保留，`P` 只追加在最前面：API 形态 `${P}/api/v1/...`（`P=/` 时 `/api/v1/...`）。`P` 只追加在 `/api/v1` 开头的路径之前，`/rest/` 等外部服务调用不受影响。

**范围限定：只做 API 层。** 本 change 不改动前台 URL 路由、静态资源托管与前缀（`--base` 参数除外）；页面与静态资源仍在根 `/`。仅（1）后台服务启动后暴露的接口自动加前缀；（2）前台代码调用后台接口的地方自动加前缀。

## 变更范围（What Changes）

- `agent-app` 配置 schema 的 `channel` 组 `routePrefix` 字段语义为公共前缀 `P`：可选字符串，校验 pattern `^/[A-Za-z0-9/_-]*$`、maxLength 64，允许单个 `/`（表示无前缀）。缺省 `/`（无前缀，既有部署零迁移）。startup validation 一次性校验并冻结。**迁移注意**：原默认 `/api/v1` 现语义变为"前缀 /api/v1"，会导致 API 路径 `/api/v1/api/v1/...`——既有写 `routePrefix: /api/v1` 的配置必须改成 `/`。
- `agent-app` composition（`composeProductChannelLayer`）把冻结的 `P` 透传给主 Web channel、IR channel（`apiSubNamespace: 'ir'`，挂载在 `${P}/api/v1/ir`）与 local configured auth contribution。
- `agent-channel-web` `registerWebChannel` 的 `route()` 改为拼接 `${P}/api/v1/${path}`（`P=/` 时退化为 `/api/v1/path`）；新增 `apiSubNamespace` option 用于 IR 子命名空间。`memory.ts` 的 `BASE` 同样基于 `P` 拼回 `/api/v1/memory/long-term-mem`。`/health`、`/health/deep` 通过 `route()` 跟随 `${P}/api/v1/health`。
- `agent-channel-web-auth-local` `createLocalConfiguredWebAuth` 的 `routePrefix` option 语义为 `P`；login/logout 路由挂载 `${P}/api/v1/auth/local/*`、`runtime/bootstrap` 挂载 `${P}/api/v1/runtime/bootstrap`；`isProtectedPath` 受保护 API 判定基于 `${P}/api/`；challenge body（`sendChallenge`/`sendAuthFailure`）的 `loginUrl` 改为 `${P}/login`。SPA 静态资源/页面路由的公开判定保持根路径不变（页面层不前缀化）。
- `frontend/agent-web` `runtimeConfig.ts` 的 `resolvePathPrefix` 读 `import.meta.env.VITE_API_URL_PREFIX`（`P`，构建期固化，默认空串=无前缀）；`buildApiUrl` 改追加逻辑（仅 path 以 `/api/v1` 开头时前面拼 `P`，`/rest/` 等非 API 路径不加前缀，`P` 空时不变）；`loadRuntimeConfig` 用构建期 `P` 拼 `${P}/api/v1/runtime/bootstrap`。`RUNTIME_BOOTSTRAP_PATH='/api/v1/runtime/bootstrap'` 不变（`buildApiUrl` 自动加 `P`）。21 个 service/hook 文件继续传 `/api/v1/xxx`，零改动自动跟随。非法值始终抛错（不再区分 dev/prod 模式）。
- `frontend/agent-web/scripts/build-modes.mjs` 新增 `--base` 和 `--apiUrlPrefix` CLI 参数解析：`--base` 透传为 `VITE_BASE` 环境变量（Vite `base` 配置）；`--apiUrlPrefix` 透传为 `VITE_API_URL_PREFIX` 环境变量。两个参数均在 `parseBuildArgs` 中做前置校验，非法值直接终止构建。不传参数时全部退化为默认值。
- `frontend/agent-web/vite.config.ts` 读取 `VITE_BASE` 设置 Vite `base`；删除 `envPrefix: ['VITE_', 'PREFIX_']`（改用 `VITE_` 前缀后不再需要额外配置，Vite 默认暴露 `VITE_` 前缀变量）。`src/vite-env.d.ts` 声明 `VITE_BASE` 和 `VITE_API_URL_PREFIX` 类型。
- 移除原 `frontend/agent-web/public/config.json` 运行时配置文件机制：`P` 改为构建期固化，换 `P` 需重新构建（由部署方通过 `--apiUrlPrefix` 参数在构建阶段注入）。

## Capability 影响（Capabilities）

### 新增 Capability

（无）

### 修改的 Capability

- `app-config-schema`：`channel` 组 `routePrefix` 语义为公共前缀 `P`，默认 `/`。
- `web-channel-api-contract`：所有 Web API 路由挂载前缀由 `channel.routePrefix`（`P`）决定，形态 `${P}/api/v1/...`；前后端必须解析到同一 `P` 才能联通。

## 影响范围（Impact）

- 代码：`packages/agent-app/src/config/{component-config,validation}.ts`、`packages/agent-app/config/default-system.yaml`、`packages/agent-app/src/composition/{channel-composition,local-configured-auth-channel-contribution}.ts`、`packages/agent-channel-web/src/routes/{requests,memory}.ts`、`packages/agent-channel-web-auth-local/src/index.ts`、`frontend/agent-web/src/config/runtimeConfig.ts`、`frontend/agent-web/src/vite-env.d.ts`、`frontend/agent-web/vite.config.ts`、`frontend/agent-web/scripts/build-modes.mjs`。
- API：所有 `/api/v1/*` 路由的挂载前缀可变（`${P}/api/v1/*`）；默认值不变，既有客户端零迁移。
- 页面/静态资源：不改动，仍在根 `/`（`--base` 参数可选控制 Vite 静态资源路径前缀）。
- 测试：`agent-channel-web`/`agent-channel-web-auth-local` 路由注册测试覆盖自定义 `P`；`frontend/agent-web` runtime-config 测试覆盖追加语义、`/rest/` 不加前缀、非法值始终抛错与构建期 `VITE_API_URL_PREFIX`。
- 配置/运维：后端改 `channel.routePrefix`、前端构建时传 `--apiUrlPrefix`（值一致）即生效；换 `P` 需重新构建前端。既有 `routePrefix: /api/v1` 配置需迁移为 `/`。

## 归档前更新基线（Baseline Promotion Plan）

**行为契约：**
- `openspec/specs/app-config-schema/spec.md`：`channel` 组合并 `routePrefix`（公共前缀 `P`，默认 `/`）requirement。
- `openspec/specs/web-channel-api-contract/spec.md`：合并「Web API 路由前缀 `P` 追加在 `/api/v1` 前」requirement。

**长期背景：**
- `openspec/overview.md`：稳定基线描述补充「Web API 挂载前缀可由 `channel.routePrefix`（`P`）配置，`P` 追加在固定 `/api/v1` 段前，默认 `/` 无前缀」一句。

**验证入口：**
- `agent-channel-web` route integration test：自定义 `P` 后 sessions/memory/health/stream/IR 命中 `${P}/api/v1/...`，`/api/v1/...` 返回 404；`P=/` 时退化零回归。
- `agent-channel-web-auth-local` route test：自定义 `P` 后 login/logout 命中 `${P}/api/v1/auth/local/*`，challenge `loginUrl` 为 `${P}/login`，受保护 API 路径判定跟随 `P`。
- `frontend/agent-web` runtime-config test：`P=/svcA`（`VITE_API_URL_PREFIX`）时 `buildApiUrl('/api/v1/sessions')` → `/svcA/api/v1/sessions`；`/rest/` 路径不加前缀；空值/`/` 回退无前缀；非法值始终抛错。
