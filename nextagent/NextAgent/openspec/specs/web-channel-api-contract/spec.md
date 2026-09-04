# web-channel-api-contract Specification

## Purpose
定义 Web channel 公开 API 的请求、响应、错误和流式交互契约，确保客户端只依赖经过 schema 验证的公共 DTO 和受控的流式结果。
## Requirements
### Requirement: Web channel public API MUST have complete request specifications

Web channel public API SHALL maintain a complete request specification for every endpoint exposed to agent-web, including REST, SSE, WebSocket, local auth and health endpoints. The request specification MUST identify HTTP method or WebSocket path, path parameters, query parameters, headers, JSON body, multipart fields and no-body cases. Parameters that are not accepted by the route MUST be rejected by schema validation or documented transport validation before downstream runtime/session/capability ports are called.

所有携带 `agentId` 参数的 Web channel 端点 MUST 接受可选 header `x-agent-id` 作为 hosted-agent selection 信号。该 header 值 MUST NOT 进入请求体，MUST NOT 被视为 owner scope 或 trusted identity。

createSession 和 convenience submit 端点 MUST 从 header `x-agent-id` 提取原始值传给 `RuntimeCreateSessionCommand.agentId`，由 runtime 的 Agent Selection Policy 统一做格式校验和决策。Web channel MUST NOT 在 createSession 路径自行做格式校验或 brand，MUST NOT 自行决定 fallback。

非 session 内端点（cron-tasks、category-questions、frequent-questions、question-associations、annotations/favorite-turns、memory、listSessions）MUST 在 channel 层从 header `x-agent-id` 完成格式校验、brand 和 fallback，直接传解析后的 agentId 给 runtime port。这些端点不走 AgentSelectionPolicy。

session 内端点（如 `POST /api/v1/sessions/:sessionId/requests`、stream、message、cancel）MUST NOT 从 header 解析 agentId，MUST 使用 session 已绑定的 `session.agentId`。

未传 header 时所有端点 MUST fallback 到 `defaultRouteAgentId`，行为与当前版本完全一致。

#### Scenario: REST route request schema coverage

- **WHEN** a public REST route is registered under `/api/v1` or `/health`
- **THEN** the route MUST have an explicit request specification for every accepted path, query, header, body or multipart field
- **AND** unsupported request fields MUST fail closed before runtime/session/capability/gateway ports are called
- **AND** trusted owner scope and trusted agent scope MUST NOT be accepted from request body, query, path or client metadata

#### Scenario: createSession 提取 header 原始值传给 runtime

- **WHEN** 客户端发送 `POST /api/v1/sessions` 且包含 header `x-agent-id: network-specialist`
- **THEN** Web channel MUST 提取该 header 的原始字符串值传给 `RuntimeCreateSessionCommand.agentId`
- **AND** MUST NOT 在 channel 层做格式校验或 brand
- **AND** MUST NOT 将该值放入请求体
- **AND** runtime MUST 通过 AgentSelectionPolicy 统一做格式校验和决策

#### Scenario: 非 session 内端点在 channel 层解析 agentId

- **WHEN** 客户端发送 `GET /api/v1/cron-tasks` 或 `GET /api/v1/frequent-questions` 且包含 header `x-agent-id: network-specialist`
- **THEN** Web channel MUST 在 channel 层完成格式校验、brand 和 fallback
- **AND** MUST 将解析后的 agentId 传递给对应 runtime port
- **AND** 底层 port MUST 按该 agentId 隔离数据

#### Scenario: 未传 header 时 fallback 到默认 agent

- **WHEN** 客户端发送任何携带 agentId 参数的端点且未包含 header `x-agent-id`
- **THEN** Web channel MUST 使用 `defaultRouteAgentId` 作为 agentId
- **AND** 行为 MUST 与当前版本完全一致

#### Scenario: Session-internal endpoints use session-bound agentId

- **WHEN** 客户端对一个已存在的 session 发送请求（如 submit、stream、message）
- **THEN** Web channel MUST 使用 `session.agentId` 作为 agent scope
- **AND** MUST NOT 从 header 解析 agentId 覆盖 session 已绑定的 agentId

#### Scenario: listSessions 按 header 指定的 agentId 过滤

- **WHEN** 客户端发送 `GET /api/v1/sessions` 且包含 header `x-agent-id: network-specialist`
- **THEN** Web channel MUST 按该 agentId 过滤 session 列表

#### Scenario: listSessions 未传 header 时按默认 agent 过滤

- **WHEN** 客户端发送 `GET /api/v1/sessions` 且未包含 header `x-agent-id`
- **THEN** Web channel MUST 使用 `defaultRouteAgentId` 作为 agentId 过滤
- **AND** 行为 MUST 与当前版本完全一致

#### Scenario: Stream route request schema coverage

- **WHEN** Web channel exposes SSE or WebSocket stream for a session
- **THEN** the stream request specification MUST define `sessionId`, optional `lastSeenSequence`, optional `requestId` and optional `runId`
- **AND** unsupported stream query parameters MUST fail with a safe validation error
- **AND** SSE and WebSocket MUST use equivalent request parsing semantics unless a transport-specific requirement explicitly says otherwise

#### Scenario: Multipart request schema coverage

- **WHEN** a submit or edit endpoint accepts `multipart/form-data`
- **THEN** the request specification MUST list every accepted text field and file part
- **AND** unsupported multipart fields MUST fail with a safe validation error
- **AND** multipart intake MUST NOT allow client-provided owner scope, agent scope, accepted request ids, run ids, attachment ids or persistence facts

### Requirement: Web channel public API MUST have complete success response specifications

Web channel public API SHALL maintain a complete success response specification for every endpoint exposed to agent-web. The success response specification MUST define HTTP status, content type, top-level response shape, field names, field types, optionality, enum values and no-content responses. Internal domain objects, gateway records, database rows and raw runtime facts MUST NOT be exposed as public Web DTOs.

#### Scenario: REST route response schema coverage
- **WHEN** a public REST route returns a successful response
- **THEN** the response specification MUST define the exact public DTO shape or `204 No Content`
- **AND** the implementation MUST register or otherwise verify an equivalent response schema for that route
- **AND** the response MUST NOT expose gateway `*Record` objects, database row shapes, raw provider errors, prompt content, model output deltas, capability arguments/results beyond intended public projection, credential values or host file paths

#### Scenario: Stream response specification coverage
- **WHEN** SSE or WebSocket emits stream data
- **THEN** the response specification MUST define the `StreamEnvelope` frame shape and event type vocabulary used by agent-web
- **AND** stream payloads MUST remain channel-safe projections of canonical timeline facts
- **AND** transport diagnostics MUST NOT invent successful terminal events or expose raw timeline payloads

#### Scenario: Auth and health response specification coverage
- **WHEN** local auth or health routes are enabled
- **THEN** their success responses MUST have documented DTO fields and status codes
- **AND** auth challenge responses MUST be documented separately from successful login/logout DTOs
- **AND** health responses MUST document both healthy and unhealthy status response shapes

### Requirement: Web channel public API MUST expose safe error code specifications

Web channel public API SHALL define safe error responses for every endpoint exposed to agent-web. Error responses MUST use a consistent public shape with a safe `code` and safe `message`, except where an existing transport protocol requires a documented challenge response. Error documentation MUST list endpoint-specific local error codes, expected HTTP status codes and the safe reason visible to clients. Error responses MUST NOT expose raw provider errors, stack traces, prompt content, model output, capability arguments/results, credential values, local file paths, unauthorized object existence or high-cardinality internal details.

#### Scenario: AgentError mapping is documented and stable
- **WHEN** an `AgentError` crosses the Web channel boundary
- **THEN** Web channel MUST map `VALIDATION` to 400, `AUTHORIZATION` to 403, `NOT_FOUND` to 404, `CONFLICT` to 409 and `UNAVAILABLE` to 503
- **AND** local auth required MUST produce a documented 401 challenge or safe error response
- **AND** the public response MUST include safe `code` and safe `message`

#### Scenario: Route-local errors use the safe error shape
- **WHEN** a route-local validation, missing dependency, unavailable service, missing output or not-found condition is returned directly by Web channel
- **THEN** the response MUST use the documented safe error shape
- **AND** the error code MUST be listed in the endpoint's error specification
- **AND** route-local errors MUST NOT return an undocumented string-only error body

#### Scenario: Share and stream protocol errors are documented
- **WHEN** share viewing returns forbidden, not-found or expired outcomes
- **THEN** the endpoint specification MUST document the corresponding safe error code and HTTP status
- **WHEN** WebSocket setup fails before protocol upgrade
- **THEN** the failure response MUST use a documented safe error body and status code

### Requirement: Web channel API documentation MUST stay aligned with executable schema and route projection

The authoritative Web channel API documentation SHALL stay aligned with executable route schemas and public DTO projection. `docs/agent-web-api-list.md` MUST list every endpoint exposed to agent-web and, for each endpoint, provide request parameters, success response fields and error codes. `docs/developer/10-api-reference.md` MUST remain a concise reference and MUST link to the authoritative Web channel API list instead of defining conflicting field details.

#### Scenario: Endpoint inventory remains complete
- **WHEN** the route registry exposes, removes or renames an agent-web-facing endpoint
- **THEN** the authoritative API document MUST be updated in the same change
- **AND** the route/schema coverage test MUST detect undocumented public endpoints

#### Scenario: Field examples match schema
- **WHEN** the API document includes example JSON for request, response or error bodies
- **THEN** the examples MUST use field names, enum values and optionality that match executable schema or documented projection code
- **AND** stale aliases that do not exist in public DTOs MUST be corrected or removed

#### Scenario: Documentation does not redefine internal ownership
- **WHEN** the API document describes a Web channel response
- **THEN** it MUST describe only the public DTO and safe projection
- **AND** it MUST NOT redefine runtime lifecycle, session ownership, gateway record ownership or provider adapter behavior outside the owning specs/designs

### Requirement: Web channel API completeness MUST be verifiable

Web channel API completeness SHALL be guarded by repeatable validation. Tests or validation scripts MUST verify route/schema coverage, safe error shape coverage and documentation alignment for public Web channel endpoints. The validation MUST run without requiring a live external model provider.

#### Scenario: Schema coverage validation detects missing route specifications
- **WHEN** a public Web channel route lacks required request or response schema coverage
- **THEN** the validation MUST fail with a message identifying the route and missing schema category

#### Scenario: Safe error validation detects unsafe or incomplete errors
- **WHEN** a Web channel route returns a route-local error without safe `code` and safe `message`
- **THEN** the validation MUST fail
- **AND** the failing route and status code MUST be identifiable from the test output

#### Scenario: Documentation alignment validation detects drift
- **WHEN** authoritative API documentation names a response field or enum value that conflicts with executable schema or projection tests
- **THEN** the validation MUST fail
- **AND** the failure MUST identify the endpoint and mismatched field or enum value

### Requirement: Web channel 必须下发 Content-Security-Policy 响应头

Web channel MUST 在全部常规 HTTP 响应、SSE 响应以及 WebSocket 101 握手和 4xx 降级响应中携带 `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`。三类响应的 CSP 值 MUST 相同，MUST NOT 被传输协议或其他运行时条件改变。

CSP 在浏览器渲染 `text/html` 文档时 MUST 允许同源资源、运行时 `<style>`、style attribute 和 `data:` 图片，MUST 继续阻止没有 nonce 或 hash 的 inline script。JSON、SSE 和 WebSocket 响应上的 CSP 头被浏览器忽略。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：Web channel

#### Scenario: 常规 JSON 响应携带 CSP
- **WHEN** 客户端发送 `GET /api/v1/sessions` 请求
- **THEN** 响应 MUST 携带 `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`

#### Scenario: Agent Web 在 CSP 下保持可用样式和图片
- **WHEN** 浏览器加载 Web channel 提供的 Agent Web 页面，且页面使用运行时 `<style>`、style attribute 和 `data:` 图片
- **THEN** CSP MUST NOT 阻止这些样式和图片
- **AND** 页面 MUST 保持组件样式和图片可用

#### Scenario: CSP 继续阻止 inline script
- **WHEN** 浏览器加载 Web channel 提供的 HTML，且页面包含没有 nonce 或 hash 的 inline script
- **THEN** CSP MUST 阻止该 inline script 执行

#### Scenario: SSE 流响应携带 CSP
- **WHEN** 客户端通过 SSE 连接 Request Execution Stream
- **THEN** SSE 响应 MUST 携带 `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`

#### Scenario: WebSocket 握手响应携带 CSP
- **WHEN** 客户端发起 WebSocket 升级请求
- **THEN** 101 Switching Protocols 握手响应 MUST 携带 `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`

#### Scenario: WebSocket 4xx 降级响应携带 CSP
- **WHEN** WebSocket 升级请求被拒绝（如无效 handshake）
- **THEN** 4xx 错误响应 MUST 携带 `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`

### Requirement: Web channel 必须无条件下发 Strict-Transport-Security 响应头

Web channel MUST 在所有出站响应中无条件携带 `Strict-Transport-Security: max-age=31536000; includeSubDomains` 响应头。该头 MUST NOT 根据外部或内部传输协议以及其他运行时条件被删除或跳过。

该头 MUST 出现在全部常规 HTTP 响应、SSE 响应以及 WebSocket 101 握手和 4xx 降级响应中。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：Web channel

#### Scenario: HTTP 响应携带 HSTS
- **WHEN** 客户端通过 HTTP（代理后）发送请求
- **THEN** 响应 MUST 携带 `Strict-Transport-Security: max-age=31536000; includeSubDomains`

#### Scenario: HTTPS 响应携带 HSTS
- **WHEN** 客户端通过 HTTPS 直接发送请求
- **THEN** 响应 MUST 携带 `Strict-Transport-Security: max-age=31536000; includeSubDomains`

#### Scenario: SSE 流响应携带 HSTS
- **WHEN** 客户端通过 SSE 连接 Request Execution Stream 且应用在 HTTP（代理后）运行
- **THEN** SSE 响应 MUST 携带 `Strict-Transport-Security: max-age=31536000; includeSubDomains`

#### Scenario: WebSocket ws 握手响应携带 HSTS
- **WHEN** 客户端通过 ws（非 TLS）发起 WebSocket 升级请求
- **THEN** 101 握手响应 MUST 携带 `Strict-Transport-Security: max-age=31536000; includeSubDomains`

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
