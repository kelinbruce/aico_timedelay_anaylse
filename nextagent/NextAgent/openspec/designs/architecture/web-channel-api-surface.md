# Web Channel API Surface

## 职责

定义 Web channel 对外暴露的 API 端点、跨模块流程、port 隔离和安全投影契约。Web channel 只负责 transport 和 projection，不拥有 request lifecycle；所有业务操作通过 gent-contracts/runtime 定义的 port 委托给 runtime/catalog/assembly 层。

## 当前 API Surface

| 端点 | 方法 | 职责 | 依赖 port |
|---|---|---|---|
| /api/v1/sessions | GET | 列出会话 | RuntimeSessionPort |
| /api/v1/sessions | POST | 创建会话 | RuntimeSessionPort |
| /api/v1/sessions/:sessionId | DELETE | 删除会话 | RuntimeSessionPort |
| /api/v1/sessions/:sessionId/title | PUT | 更新会话标题；raw body 上限由 Web 校验，trim/非空/安全校验由 session owner 负责 | RuntimeSessionPort.updateTitle |
| /api/v1/sessions/:sessionId/conversation | GET | 获取会话历史 | RuntimeSessionPort |
| /api/v1/sessions/:sessionId/stream | GET | SSE event stream | RuntimeSessionPort.streamEvents |
| /api/v1/sessions/:sessionId/ws | WebSocket upgrade | WebSocket event stream | RuntimeSessionPort.streamEvents |
| /api/v1/sessions/:sessionId/requests | POST | 提交请求 | RuntimeCommandPort.submit |
| /api/v1/sessions/:sessionId/cancel | POST | 取消请求 | RuntimeCommandPort.cancel |
| /api/v1/sessions/:sessionId/retry | POST | 重试请求 | RuntimeCommandPort.retryLatest |
| /api/v1/sessions/:sessionId/requests/latest/edit | POST | 编辑并重提 latest request | RuntimeCommandPort.editLatest |
| /api/v1/sessions/:sessionId/pending-inputs/:pendingInputId/answer | POST | 回答当前 Pending Input | RuntimeCommandPort.answerPendingInput |
| /api/v1/skills | GET | 查询可用 Skill 列表 | SkillCatalogQueryPort |
| /health | GET | 健康检查 | HealthEvaluatorPort |
| /api/v1/runtime/bootstrap | GET | Bootstrap 投影 | trusted app config |

## API 公共路径前缀

全部 Web API 路由的挂载前缀由 `app composition config` 的 `channel.routePrefix`（公共前缀 `P`）决定：`P` 追加在固定 `/api/v1` 段之前（形态 `${P}/api/v1/...`），不替换 `/api/v1`，只影响 API 挂载，不改动页面入口、SPA 路由与静态资源托管（仍在根 `/`）。`P` 校验 pattern `^/[A-Za-z0-9/_-]*$`、maxLength 64，缺省 `/`（无前缀，既有部署零迁移）；注意原默认 `/api/v1` 现语义变为"前缀 /api/v1"，既有写 `routePrefix: /api/v1` 的配置必须改成 `/`。主 Web channel、memory、local configured auth、IR（`${P}/api/v1/ir`）和 health（`${P}/api/v1/health`）全部经统一 `route()` 拼接跟随 `P`，health 路由不得用值门决定是否注册。

前端 `frontend/agent-web` 的 `P` 为构建期固化值（`import.meta.env.VITE_API_URL_PREFIX`，默认空串=无前缀；`buildApiUrl` 仅对 `/api/v1` 开头的 path 前置拼接 `P`，`/rest/` 等非 API 路径不受影响）。生产构建 `npm run build:vite:modes` 提供 `--base`（Vite base）和 `--apiUrlPrefix`（P）CLI 参数；换 `P` 需重新构建，无运行时配置文件机制。

## 安全响应头

所有出站响应（REST、SSE、WebSocket upgrade 响应、静态资源）无条件下发 `Strict-Transport-Security: max-age=31536000; includeSubDomains`，不依赖请求 protocol 判定。同时下发 `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`：允许 Agent Web 必需的运行时样式和 `data:` 图片，继续阻止 inline script。响应头由 `agent-channel-web` 在统一出站边界设置，`agent-app` 静态托管路径复用同一头集合。

## Skill 列表查询跨模块流程

## Submit Routing Constraints

Web submit DTO does not own capability target semantics. Public agent-web request bodies must not carry `routingConstraints.targetSkill` or `routingConstraints.targetRecipe`; schema validation rejects those fields before runtime submit is called. Web users express direct capability intent in accepted user text with `$skill:<name>` or `$workflow:<name>`. `agent-core` parses that accepted text and maps it to governed Skill or workflow routing constraints after request acceptance.

Non-target routing constraints such as `forbiddenCapabilityIds`, `executionMode`, `maxToolCalls`, `allowHumanInput` and `allowSubagents` can still cross the Web boundary after schema validation. They remain policy inputs, not authorization to invoke a capability.

### 端点

GET /api/v1/skills?pageNum=1&pageSize=50&keyword=alarm

### 跨模块流程

1. **Web channel** 收到请求，解析 pageNum、pageSize、可选 keyword 查询参数，进行 runtime schema validation。
2. **Web channel** 调用注入的 SkillCatalogQueryPort.listSkills(request, signal)，传入 SkillCatalogQueryRequest。
3. **gent-app composition** 实现的 SkillCatalogQueryPort 调用 CapabilityCatalog.listAvailable() 获取当前 Agent Scope 下所有 SKILL capability descriptor。
4. **composition** 在内存中按 keyword（匹配 displayName 和 capabilityId，case-insensitive）过滤、按 pageNum/pageSize 分页切片。
5. **composition** 将过滤后的 descriptor 列表投影为 SkillCatalogSummaryEntry[]（仅包含 capabilityId、displayName、description、providerKind、可选 ersion），返回 SkillCatalogQueryResult。
6. **Web channel** 将 SkillCatalogQueryResult 投影为 HTTP 200 响应 DTO，包含 	otal、pageNum、pageSize、skills 数组。

### Port 定义

SkillCatalogQueryPort 定义在 gent-contracts/runtime，与 RuntimeCommandPort、RuntimeSessionPort 并列：

`	ypescript
export interface SkillCatalogQueryRequest {
  agentId: AgentId;
  identityContext: IdentityContext;
  pageNum: number;       // default 1, min 1
  pageSize: number;      // default 50, min 1, max 100
  keyword?: string;      // optional case-insensitive search
}

export interface SkillCatalogSummaryEntry {
  capabilityId: string;
  displayName: string;
  description: string;
  providerKind: 'BUNDLED' | 'LOCAL_DIRECTORY' | 'SKILL_HUB';
  version?: string;
}

export interface SkillCatalogQueryResult {
  total: number;
  pageNum: number;
  pageSize: number;
  skills: SkillCatalogSummaryEntry[];
}

export interface SkillCatalogQueryPort {
  listSkills(
    request: SkillCatalogQueryRequest,
    signal?: AbortSignal
  ): Promise<SkillCatalogQueryResult>;
}
`

### 安全边界

- **Agent Scope**: 当前版本使用 hosted ctiveAgentId（单 Agent 模式）。未来支持多 Agent 时需改为 session-bound gentId。
- **Owner Scope**: 由 Web channel auth boundary 通过 identityContext 解析。
- **来源聚合**: BUNDLED + LOCAL_DIRECTORY（所有模式）；SKILL_HUB（仅 REMOTE 模式）。
- **agent-owned authorization**: local-skills-agent-owned Skill 经过 agent-owned source authorization 校验。
- **投影安全**: 不暴露 inputSchema、outputSchema、metadata、provider 私有配置、credential、文件路径或 catalog 内部 governance evidence。
- **错误处理**: 未认证 401、catalog unavailable 503、非法参数 400。

### 依赖方向

`
agent-channel-web
  └─> agent-contracts/runtime (SkillCatalogQueryPort)
        └─> agent-app composition (实现)
              ├─> agent-capability (CapabilityCatalog.listAvailable())
              └─> agent-capability (AgentAssemblyRegistry.active())
`

**禁止**: Web channel 直接依赖 gent-capability、CapabilityCatalog、AssemblyRegistry。

### 已知限制

- 单 Agent 模式: GET /api/v1/skills 使用 hosted ctiveAgentId，若在既有 session 内展示 Skill 可能列出默认 Agent 的 Skill 而非 session-bound Agent 的 Skill。未来多 Agent 时需增加 gentId 查询参数或从 session 上下文解析。详见 design D5。
- 内存分页: Skill 数量上限 500，在内存中过滤和分页。若未来 Skill 数量超过 1000，需考虑 catalog 层面分页支持。详见 design D3。
- REMOTE deployment mode 未完整实现: SKILL_HUB Skill 聚合依赖 REMOTE 模式的完整实现。详见 design D15。

## IR Surface

IR（机机交互）surface 是 web-channel 的第二种 surface，面向外部系统（编排系统、网管平台、上游业务系统）的程序化调用。路径前缀 `/api/v1/ir`，协议、DTO、schema 和 stream 行为与 ER 对应端点完全一致。

### 认证隔离

IR 路由通过 trusted-header 模式认证：上游网关注入 `x-tenant-id`、`x-subject-id`、`x-display-name` 请求头，NextAgent 只读不校验凭证。ER 路由通过 cookie 认证。两条认证路径互不交叉：IR 路由不挂 cookie auth plugin，ER 路由不挂 header resolver。Agent Scope 不从 header 取，仍来自 `requireSession` 返回的持久化 `session.agentId`。

### IR 端点表

| 端点 | 方法 | 对应 ER 端点 | 依赖 port |
|---|---|---|---|
| /api/v1/ir/sessions | POST | /api/v1/sessions | RuntimeSessionPort |
| /api/v1/ir/sessions/:sessionId/requests | POST | /api/v1/sessions/:sessionId/requests | RuntimeCommandPort.submit |
| /api/v1/ir/sessions/:sessionId/stream | GET | /api/v1/sessions/:sessionId/stream | RuntimeSessionPort.streamEvents |
| /api/v1/ir/sessions/:sessionId/cancel | POST | /api/v1/sessions/:sessionId/cancel | RuntimeCommandPort.cancel |
| /api/v1/ir/sessions/:sessionId/retry | POST | /api/v1/sessions/:sessionId/retry | RuntimeCommandPort.retryLatest |
| /api/v1/ir/sessions/:sessionId/pending-inputs/:pendingInputId/answer | POST | /api/v1/sessions/:sessionId/pending-inputs/:pendingInputId/answer | RuntimeCommandPort.answerPendingInput |

IR surface 不暴露 bootstrap、skills、conversation、annotations、shares 等 UI 专属端点。`registerWebChannel` 通过 `routePrefix` 和 `routeWhitelist` 参数控制：ER 注册传 `/api/v1` 且不传白名单（全量注册），IR 注册传 `/api/v1/ir` 且传入 6 端点白名单。multipart 和 WebSocket 注册也受白名单门控。
