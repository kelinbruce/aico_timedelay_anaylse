## 背景与问题（Why）

当前 `agent-channel-web` 已经向 agent-web 暴露 Session、Request Command、SSE/WebSocket stream、Annotation/Favorite、Background Task、Share、Skill/Question、Auth/Health 等接口，但接口规格资料没有形成一条完整、可验证的 public API contract。

代码实态显示，部分路由只注册了请求 `body` 或 `querystring` schema，许多路由缺少 `params` schema 和 `response` schema；部分 route-local 错误仍返回不完整的 `{ error: { code } }` 或 `{ error: "Not Found" }` 形态。现有 `docs/agent-web-api-list.md` 虽然列出了大部分接口，但字段说明、响应字段、错误码和错误描述粒度不一致，且存在与 schema 不一致的示例字段。

这会带来三个直接问题。第一，agent-web 或外部集成方无法只凭接口资料准确构造请求和解析响应。第二，错误码缺少接口级说明，前端很难区分 validation、auth、not found、conflict、unavailable 等可恢复路径。第三，缺少 response schema 会让接口漂移不能被测试及时发现，尤其是 Web channel 只负责 transport/projection 的边界下，public DTO 必须比内部 runtime/session 对象更明确。

因此需要新增一个面向 Web channel public API 的规格完整性 change：补齐请求参数、响应字段、安全错误投影和文档/代码一致性要求，并把后续实现任务拆成可验证子目标。

## 变更范围（What Changes）

- 新增 `web-channel-api-contract` capability，定义 Web channel public API 规格资料的完整性要求：每个对 agent-web 暴露的 REST/SSE/WebSocket/Auth/Health 接口都必须有请求参数、响应字段和错误响应规格。
- Web channel route registry 后续实现必须为 public REST 接口补齐 `params`、`querystring`、`body` 和 `response` schema；无法用 Fastify response schema 表达的 SSE/WebSocket frame 必须在 OpenSpec 和文档中定义 envelope/frame 规格。
- 统一 Web channel safe error response 规格，明确标准形态、HTTP 状态映射、route-local 错误码、runtime/session/share 透传错误的安全约束和不暴露内容。
- 更新 `docs/agent-web-api-list.md` 的结构，使每个接口固定包含 Path 参数、Query、Headers、Body 或 Multipart、成功响应、错误码与错误描述。
- 修正文档与当前代码/schema 不一致的字段示例，例如 question association/frequent question 响应条目字段和枚举值。
- 不改变 `agent-channel-web` 对 request lifecycle、session history、runtime terminal state 的所有权；Web channel 仍只拥有 transport、runtime schema validation 和 public DTO projection。
- 不新增业务端点，不改变 Owner Scope 或 Agent Scope 来源，不允许客户端通过 request body、query、path 或 header 覆盖 trusted identity 或 agent scope。

## Capability 影响（Capabilities）

### 新增 Capability

- `web-channel-api-contract`: 定义 Web channel public API 的规格完整性、DTO/schema 挂载、安全错误投影和文档一致性要求。

### 修改的 Capability

- 无。现有 `ts-minimal-agent-kernel`、`ts-web-sse-ws-transports`、`web-skill-catalog`、`conversation-annotation`、`conversation-share`、`category-question-api`、`frequent-question-api`、`question-association-api` 等 capability 的业务行为不在本 change 中改变；本 change 只补齐面向 Web channel API surface 的规格完整性契约。

## 影响范围（Impact）

- 代码模块：
  - `packages/agent-channel-web/src/routes/requests.ts`
  - `packages/agent-channel-web/src/transports/websocket.ts`
  - `packages/agent-channel-web-auth-local/src/index.ts`
  - `packages/agent-channel-web/src/schemas/*`
- 文档：
  - `docs/agent-web-api-list.md`
  - `docs/developer/10-api-reference.md`
- OpenSpec：
  - 新增 active spec delta：`openspec/changes/complete-web-channel-api-specification/specs/web-channel-api-contract/spec.md`
- 测试：
  - Web channel route/schema contract tests
  - safe error projection tests
  - 文档与 schema 关键字段一致性检查
  - `openspec validate complete-web-channel-api-specification --strict`
- 运维与集成：
  - agent-web 和外部调用方可依赖稳定字段说明和错误码说明进行请求构造、响应解析和错误处理。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/web-channel-api-contract/spec.md`：新增 Web channel public API 规格完整性、schema 挂载、安全错误投影和文档一致性契约。

长期背景：
- `openspec/overview.md`：增加 Web channel public API contract 作为对外接口规格入口；不记录临时缺口。

设计视图：
- `openspec/designs/architecture/web-channel-api-surface.md`：归档前提炼 Web channel API surface 的请求/响应/error contract owner、SSE/WS 等价 stream transport 说明和文档生成/校验边界。
- `openspec/designs/modules/agent-channel-web.md`：归档前补充 route schema、public DTO projection、safe error projection 的模块职责和非职责。
- `openspec/designs/modules/agent-channel-web-auth-local.md`：归档前补充 local auth login/logout/challenge 的 public response 和错误投影职责。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：增加 `web-channel-api-contract` 到 Web channel API surface、agent-channel-web 模块设计、auth-local 模块设计及验证入口的导航。

验证入口：
- `vitest run packages/agent-channel-web/tests/*route*.test.ts packages/agent-channel-web/tests/*schema*.test.ts`
- 新增 Web channel API schema coverage test
- 新增 Web channel safe error projection test
- `openspec validate complete-web-channel-api-specification --strict`
- `openspec validate --all --strict`
