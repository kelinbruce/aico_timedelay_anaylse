## 背景和现状（Context）

当前 `agent-channel-web` 是 agent-web 的后端 transport/projection 边界，真实 route 主要注册在 `packages/agent-channel-web/src/routes/requests.ts`，WebSocket stream 在 `packages/agent-channel-web/src/transports/websocket.ts`，local auth route 在 `packages/agent-channel-web-auth-local/src/index.ts`。

代码实态存在 implementation-vs-spec gap：

- 只有少量 route 注册了 `response` schema，例如 runtime bootstrap、health、skills。
- 多数 route 缺少 `params` schema，path 参数只在 handler 内强转为 branded id。
- 一部分 route 使用 `requireJsonBody(..., TypeBoxSchema)` 手工校验 body，但没有把 schema 挂到 Fastify route registry。
- SSE/WebSocket 有 query 校验，但规格资料没有和 REST API 清单放在同一个可审查结构中。
- route-local 错误形态不一致：部分返回 `{ error: { code } }`，部分返回 `{ error: "Not Found" }`，缺少 safe `message`。
- `docs/agent-web-api-list.md` 已经列出大部分接口，但字段表、响应字段、错误码说明粒度不统一，并存在与代码 schema 不一致的示例字段。

相关方：

- `agent-channel-web`：拥有 public HTTP/SSE/WebSocket schema、safe DTO projection 和 safe error projection。
- `agent-channel-web-auth-local`：拥有 local login/logout/challenge 的 auth adapter response。
- `agent-app`：组合注入 runtime/session/skill/question/share/annotation/background task ports，不拥有 Web DTO 字段表。
- `agent-web` 与外部集成方：消费 public API 文档和错误码说明。

约束：

- Web channel 不拥有 request lifecycle、session/message state、terminal commit、canonical timeline 或业务语义路由。
- Owner Scope 只能来自 channel/auth boundary；Agent Scope 只能来自 trusted app composition 或 session/run facts。
- 实施阶段默认只改 active change 文档和代码；长期基线在归档前提炼。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 补齐面向 agent-web 的 public API 请求规格、响应规格、错误码和错误描述。
- 让 route registry、TypeBox schema、projection tests 和 `docs/agent-web-api-list.md` 收敛到同一个接口形状。
- 统一 route-local safe error 响应，至少保证 `{ error: { code, message } }`。
- 建立可重复验证路径，防止新增 Web route 或字段漂移时文档缺失。

**非目标：**

- 不新增业务端点。
- 不改变 runtime/session/core/model/capability/gateway 的业务语义或 owner。
- 不生成完整 OpenAPI 服务器，不引入新外部依赖。
- 不把 runtime/domain/gateway 内部对象公开为 Web DTO。
- 不在本 change 归档前直接修改长期 design/spec 基线，除非进入归档阶段。

## 设计决策（Decisions）

### 1. 唯一 schema owner：`agent-channel-web/src/schemas`

选定路径：所有 agent-web public REST DTO schema 放在 `packages/agent-channel-web/src/schemas/*`，由 route registry 引用；Auth local 自有 login/logout/challenge schema 放在 `agent-channel-web-auth-local` 内部，不让 `agent-channel-web` 依赖 auth adapter。

理由：

- Web DTO 是 channel projection，不属于 runtime/session/gateway owner。
- 当前仓库已经有 `request-dto.ts`、`session-dto.ts`、`skill-catalog-query.ts` 等 TypeBox schema，增量补齐比引入 OpenAPI generator 更小。
- TypeBox schema 可直接用于 Fastify runtime validation 和测试读取。

放弃方案：

- 从 docs 反向生成 schema：会让文档成为执行边界，风险较高。
- 把 DTO schema 放进 `agent-contracts`：会扩大 frozen public contract 面，把 Web presentation alias 推到跨 package contract。
- 使用 ad hoc markdown 表作为唯一权威：不能被 route tests 稳定验证。

### 2. Route registry 必须显式挂载请求和响应 schema

选定路径：每个 REST route 都挂载 `schema: { params?, querystring?, body?, response? }`。multipart route 无法完全通过 JSON body schema 表达时，保留 content-type parser 和手工 multipart parser，但必须挂载 path params schema，并通过 focused tests 覆盖 multipart field allowlist。

首批覆盖对象：

| 分组 | 端点 |
|---|---|
| Runtime/Auth/Health | `GET /api/v1/runtime/bootstrap`、`POST /api/v1/auth/local/login`、`POST /api/v1/auth/local/logout`、`GET /health`、`GET /health/deep` |
| Session | `GET /api/v1/sessions`、`POST /api/v1/sessions`、`PUT /api/v1/sessions/:sessionId/title`、`DELETE /api/v1/sessions/:sessionId`、conversation、preview、fork |
| Request Command | session submit、convenience submit、cancel、retry、edit、pending input answer、suggested questions |
| Stream | SSE stream、WebSocket stream setup/frame |
| Annotation/Favorite | upsert annotation、list annotations、favorites |
| Background Task | list、output、kill |
| Share | create share、load shared conversation |
| Skill/Question | skills、category questions、frequent questions、question association、pin user question |

理由：

- Fastify schema 是当前代码中最接近执行边界的规格挂载点。
- 对于 `response`，显式 schema 能防止 handler 返回内部对象或字段漂移。
- 对于 `params`，能在 branded id 强转前 fail closed。

### 3. 安全错误投影使用统一 DTO

选定路径：新增或复用一个 Web safe error schema：

```json
{
  "error": {
    "code": "REQUEST_VALIDATION_FAILED",
    "message": "Request validation failed."
  }
}
```

所有 route-local 错误都使用该 shape。`AgentError` 继续经全局 error handler 投影。local auth challenge 如果为了前端登录页需要额外字段，必须在 auth-local schema 中显式列出，并与普通 safe error 区分。

状态映射：

- `VALIDATION` -> 400
- local auth required/challenge -> 401
- `AUTHORIZATION` -> 403
- `NOT_FOUND` -> 404
- share expired -> 410
- `CONFLICT` -> 409
- `UNAVAILABLE` -> 503

理由：

- agent-web 能稳定根据 `error.code` 分支处理。
- safe `message` 是接口文档需要的最小可见解释。
- 不改变 runtime `AgentError` 语义，只补齐 channel projection。

### 4. API 文档由 schema/projection 校验反向约束

选定路径：`docs/agent-web-api-list.md` 继续作为权威人读 API 清单，但必须按统一模板维护每个接口：

- 方法与路径
- Path 参数
- Query 参数
- Headers
- JSON Body 或 Multipart fields
- Success response
- Error responses
- curl 示例

`docs/developer/10-api-reference.md` 保持精炼，不重复完整字段表。新增测试或脚本读取 route manifest/schema fixture，至少校验公开端点列表、关键响应字段和错误 shape。

理由：

- 现有文档已经承载完整 API 清单，保留可降低迁移成本。
- 通过测试让文档不能随意漂移。
- 不引入新文档体系。

### 5. 不创建独立持久化或 runtime contract

本 change 不新增数据库表、不新增 gateway record、不新增 runtime command。所有 API 完整性事实停留在 Web channel schema、route tests、docs 和 OpenSpec。

理由：

- 问题是 public API 规格和投影缺口，不是业务状态缺口。
- 引入 runtime contract 会错误扩大 owner 边界。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 所有请求 schema 明确拒绝 owner/agent override；safe error 不暴露 raw provider error、stack、prompt、model output、capability args/results、credential、host path 或未授权对象存在性 | route negative tests、safe error tests、code review |
| 性能/容量 | 仅增加小型 TypeBox schema、route registry metadata 和文档校验；不引入运行时远程调用、存储或 heavy generator | existing route tests、build |
| 可靠性/恢复 | 不改变 runtime terminal correctness、retry/recovery 或 stream replay truth；SSE/WS 只补规格和校验，不改 canonical timeline owner | stream tests、schema coverage tests |
| 可维护性 | Web DTO schema 单一归属 `agent-channel-web/src/schemas`；auth-local schema 留在 auth package；docs 不重新定义 runtime/gateway 内部语义 | architecture lint、schema coverage test、code review |
| 可测试性 | route/schema coverage、safe error shape、doc/schema alignment 都可离线验证，不依赖真实模型 provider | Vitest focused tests、OpenSpec validate |
| 审计/可追溯性 | 文档列明错误码和响应字段；测试失败能定位 route/field/error code；不新增日志中的敏感内容 | safe error tests、docs alignment test |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 每个 public REST route 有请求规格和响应规格 | 1.1, 1.2, 2.1 | Web channel API schema coverage test |
| Multipart submit/edit 字段 allowlist 明确且可验证 | 1.3 | multipart route tests |
| SSE/WS 请求和 frame 规格等价 | 1.4, 2.2 | stream transport tests |
| route-local 错误统一 safe shape | 2.3 | safe error projection tests |
| 文档端点、字段、枚举与 schema/projection 一致 | 3.1, 3.2 | documentation alignment test |
| Web channel 不拥有 runtime/session/gateway 业务语义 | 2.4 | `npm run lint:architecture`、code review |
| OpenSpec artifacts 可归档 | 4.1 | `openspec validate complete-web-channel-api-specification --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/web-channel-api-contract/spec.md` 主承载 Web channel API 完整性、安全错误投影和文档一致性要求。
- 架构和跨模块设计：`openspec/designs/architecture/web-channel-api-surface.md` 主承载 API surface、port 隔离、SSE/WS 等价边界和 safe projection 的跨模块视图。
- 模块设计：`openspec/designs/modules/agent-channel-web.md` 主承载 route schema、public DTO projection、safe error projection 和验证关注点。
- 模块设计：`openspec/designs/modules/agent-channel-web-auth-local.md` 主承载 local auth login/logout/challenge response 和 cookie auth boundary。
- ADR：无。该 change 是规格完整性收敛，不需要长期技术决策记录。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 `web-channel-api-contract` 到上述设计文档和验证入口的映射。
- 人读 API 清单：`docs/agent-web-api-list.md` 主承载完整字段表和示例；`docs/developer/10-api-reference.md` 只做精炼入口和链接。

## 风险与取舍（Risks / Trade-offs）

- [风险] 一次性补齐全部 route schema 改动面较大。-> 缓解方式：按分组落地，先建立 shared params/error/response schema，再逐组挂载和测试。
- [风险] response schema 过度绑定内部 runtime 对象，导致后续实现难演进。-> 缓解方式：只定义 public DTO projection，不把 domain object 或 gateway record 放进 response schema。
- [风险] 文档校验太重，维护成本高。-> 缓解方式：首版只校验端点清单、关键字段、错误 shape 和已知漂移字段，不做完整 Markdown parser。
- [风险] Auth local challenge 需要兼容前端登录页现有字段。-> 缓解方式：把 challenge 作为 documented auth response，不强行压成普通 safe error，但仍禁止敏感信息。

## 迁移计划（Migration Plan）

无数据迁移。接口字段目标是与当前公开行为收敛，不新增破坏性业务语义。若某个文档示例与当前代码不一致，以当前 executable schema/projection 为准修正文档；若发现代码返回不安全或不完整错误 shape，则在本 change 内修正为 safe DTO。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/web-channel-api-contract/spec.md`：保留 API 完整性、成功响应、安全错误和文档一致性 requirement。
- `openspec/overview.md`：增加 Web channel public API contract 作为对外接口规格入口。
- `openspec/designs/architecture/web-channel-api-surface.md`：提炼完整 endpoint inventory、schema/projection owner、port 隔离、SSE/WS 等价 stream 边界和 safe error policy。
- `openspec/designs/modules/agent-channel-web.md`：提炼 route schema、DTO projection、safe error projection、docs alignment 验证关注点。
- `openspec/designs/modules/agent-channel-web-auth-local.md`：提炼 login/logout/challenge public response 与 cookie auth 边界。
- `openspec/designs/spec-to-design-map.md`：新增 `web-channel-api-contract` 导航和验证入口。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-5.2-调用能力` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/web-channel-api-contract/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
