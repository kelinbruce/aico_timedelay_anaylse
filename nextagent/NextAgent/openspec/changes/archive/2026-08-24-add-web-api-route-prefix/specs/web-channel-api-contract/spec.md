## ADDED Requirements

### Requirement: Web API 挂载前缀可由公共前缀 P 决定（追加在 /api/v1 前）

Web channel 公开 API 的挂载前缀 SHALL 由 `app composition config` 的 `channel.routePrefix`（公共前缀 `P`）决定，`P` 追加在固定 `/api/v1` 段之前。所有主 Web channel 路由（sessions、requests、stream、annotations、skills、favorites、memory、cron-tasks、background-tasks、shares、suggested-questions、category-questions、frequent-questions、question-association、session-activities、runtime/bootstrap、health 等）MUST 挂载在 `${P}/api/v1/...`。IR channel MUST 挂载在 `${P}/api/v1/ir/...`。local configured auth 的 login/logout 路由 MUST 挂载在 `${P}/api/v1/auth/local/...`，runtime/bootstrap MUST 挂载在 `${P}/api/v1/runtime/bootstrap`。`P=/`（默认）时退化为 `/api/v1/...`，既有契约零回归。

`/health` 与 `/health/deep` MUST 跟随 `P`（即 `${P}/api/v1/health`），不再固定挂载在根路径 `/health`。health 路由的注册 MUST NOT 使用 `routePrefix === '/api/v1'` 等值门决定是否注册，而 MUST 统一通过 `route()` 注册跟随前缀。

本 change 不改动页面入口、SPA 路由、静态资源托管与前缀；页面与静态资源仍在根 `/`。`P` 只影响 Web API 挂载与前端对 API 的调用。

#### Scenario: API 段 /api/v1 在自定义前缀下保留
- **WHEN** `channel.routePrefix` 配置为 `/svcA`
- **THEN** `GET /svcA/api/v1/sessions` MUST 返回会话列表
- **AND** `GET /svcA/api/v1/ir/sessions`（IR 启用时）MUST 命中 IR channel
- **AND** `GET /svcA/api/v1/auth/local/login`（localAuth 启用时）MUST 命中 auth-local
- **AND** `/api/v1` 段 MUST 保留在路径中（不替换为 `/svcA/sessions`）

#### Scenario: 自定义前缀下主路由命中
- **WHEN** `channel.routePrefix` 配置为 `/svcA` 且前端解析到同一 `P=/svcA`
- **THEN** `GET /svcA/api/v1/sessions` MUST 返回会话列表
- **AND** `GET /api/v1/sessions` MUST 返回 404
- **AND** `GET /svcA/api/v1/health` MUST 返回健康状态
- **AND** `GET /svcA/api/v1/memory/long-term-mem` MUST 返回长期记忆列表
- **AND** `POST /svcA/api/v1/auth/local/login`（localAuth 启用时）MUST 接受登录

#### Scenario: IR channel 挂载在主前缀的 /api/v1 下
- **WHEN** `channel.routePrefix` 配置为 `/svcA`
- **THEN** IR channel 路由 MUST 挂载在 `/svcA/api/v1/ir/...`
- **AND** IR route whitelist 行为 MUST 保持不变（仅白名单路由注册）

#### Scenario: health 跟随前缀
- **WHEN** `channel.routePrefix` 配置为 `/svcA`
- **THEN** `GET /svcA/api/v1/health` MUST 返回 200 且响应体为 health DTO
- **AND** `GET /svcA/api/v1/health/deep` MUST 返回 deep health DTO
- **AND** `GET /health` MUST 返回 404

#### Scenario: 默认前缀下契约不回归
- **WHEN** `channel.routePrefix` 未配置（默认 `/`）
- **THEN** 所有 API 路由 MUST 挂载在 `/api/v1/...`
- **AND** 既有 Web channel API 契约测试 MUST 全部通过

#### Scenario: auth-local 受保护 API 路径判定与前缀跟随
- **WHEN** `channel.routePrefix` 配置为 `/svcA` 且 localAuth 启用
- **THEN** `/svcA/api/...` 路径（除 auth-local 与 runtime/bootstrap 公开路由外）MUST 被判定为受保护路径
- **AND** `/api/v1/...` 路径 MUST NOT 被判定为受保护路径
- **AND** `/svcA/api/v1/auth/local/login` 与 `/svcA/api/v1/runtime/bootstrap` MUST 被判定为公开路由
- **AND** 未认证访问受保护 API 路径的 challenge body `loginUrl` MUST 为 `/svcA/login`

### Requirement: 前端 API 调用自动加前缀

前端 agent-web MUST 通过构建期 `import.meta.env.VITE_API_URL_PREFIX` 解析 `P`（构建阶段注入，固化进产物），并在唯一的 URL 构造入口 `buildApiUrl` 把 `P` 追加在传入的 `/api/v1` 前导段之前。前端 service 代码继续使用 `/api/v1/...` 字面量，前缀追加 MUST 在单一入口完成，避免分散硬编码。`P` 与后端 `routePrefix` 不一致时，前端请求 MUST 命中 404。

`buildApiUrl` MUST 只对 `/api/v1` 开头的路径追加前缀 `P`；`/rest/` 等非 `/api/v1` 路径（外部服务调用）MUST NOT 加前缀。`P` 为空或 `/` 时等同于无前缀。

非法 `P` 值（不以 `/` 开头或包含非法字符）MUST 在构建阶段（`build-modes.mjs` 的 `parseBuildArgs`）和运行时（`resolvePathPrefix`）均抛错终止，MUST NOT 静默降级。

生产构建 `npm run build:vite:modes` MUST 支持 `--base` 和 `--apiUrlPrefix` 两个 CLI 参数：`--base` 透传为 `VITE_BASE` 环境变量控制 Vite `base` 配置（静态资源路径前缀）；`--apiUrlPrefix` 透传为 `VITE_API_URL_PREFIX` 环境变量控制 `P`。两个参数均为可选，不传时退化为默认值。`build-modes.mjs` 的 `parseBuildArgs` MUST 对两个参数做前置校验：`--base` 必须以 `/` 开头且以 `/` 结尾（或单独 `/`），只允许 `A-Za-z0-9/_-`；`--apiUrlPrefix` 必须以 `/` 开头，只允许 `A-Za-z0-9/_-`。非法值 MUST 终止构建。

`P` MUST NOT 改变 Web channel 公开 API 的请求/响应/错误契约本身：路径参数、query、body、响应 DTO、safe error code/category → HTTP 状态映射、stream envelope 形状保持不变，仅挂载前缀可变。

#### Scenario: 前端 API URL 追加前缀
- **WHEN** 构建期 `VITE_API_URL_PREFIX=/svcA`
- **THEN** `buildApiUrl('/api/v1/sessions')` MUST 产出 `/svcA/api/v1/sessions`
- **AND** `buildApiUrl('/api/v1/sessions/123/stream')` MUST 产出 `/svcA/api/v1/sessions/123/stream`
- **AND** `VITE_API_URL_PREFIX` 为空或 `/` 时 `buildApiUrl('/api/v1/sessions')` MUST 产出 `/api/v1/sessions`

#### Scenario: 非 /api/v1 路径不加前缀
- **WHEN** 构建期 `VITE_API_URL_PREFIX=/svcA`
- **THEN** `buildApiUrl('/rest/naie/guardrail/config/v1/report/risks')` MUST 产出 `/rest/naie/guardrail/config/v1/report/risks`
- **AND** `buildApiUrl('/rest/naie/aicoservice/v1/sessions/s1/bi-reports')` MUST 产出 `/rest/naie/aicoservice/v1/sessions/s1/bi-reports`

#### Scenario: 构建期前缀驱动 bootstrap
- **WHEN** 构建期 `VITE_API_URL_PREFIX=/svcA`
- **THEN** `loadRuntimeConfig` MUST 请求 `/svcA/api/v1/runtime/bootstrap`
- **AND** 解析的 `P` MUST 为 `/svcA`

#### Scenario: 非法前缀值始终抛错
- **WHEN** 构建期 `VITE_API_URL_PREFIX=svcA`（不以 `/` 开头）
- **THEN** `resolvePathPrefix` MUST 抛出错误
- **AND** 该错误 MUST 在 dev 和 prod 模式下均触发

#### Scenario: CLI 参数校验
- **WHEN** `npm run build:vite:modes -- --base /Talon/ --apiUrlPrefix /netafrunservice`
- **THEN** `VITE_BASE` MUST 为 `/Talon/`
- **AND** `VITE_API_URL_PREFIX` MUST 为 `/netafrunservice`
- **AND** Vite `base` 配置 MUST 为 `/Talon/`

#### Scenario: CLI 参数缺失时退化
- **WHEN** `npm run build:vite:modes`（不传参数）
- **THEN** `VITE_BASE` MUST 未设置
- **AND** `VITE_API_URL_PREFIX` MUST 未设置
- **AND** Vite `base` MUST 为默认值 `/`
- **AND** `apiPrefix` MUST 为空串（无前缀）

#### Scenario: CLI 参数非法值终止构建
- **WHEN** `npm run build:vite:modes -- --apiUrlPrefix svcA`（不以 `/` 开头）
- **THEN** `parseBuildArgs` MUST 抛出错误
- **AND** 构建 MUST 终止
- **AND** 错误信息 MUST 包含 `--apiUrlPrefix` 和非法值
