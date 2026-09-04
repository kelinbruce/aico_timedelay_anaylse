## 1. routePrefix 参数化与路由白名单

- [ ] 1.1 在 `registerWebChannel` 的 `WebChannelDependencies` 中新增 `routePrefix?: string`（默认 `/api/v1`）和 `routeWhitelist?: ReadonlySet<string>` 参数；将所有硬编码 `/api/v1/...` 路由路径改为 `${routePrefix}/...` 拼接
  验证：`npm run build`；现有 ER contract 测试全部通过（路径和行为零回归）
  来源：spec `IR Surface Endpoint Set`；design D1
- [ ] 1.2 实现 `routeWhitelist` 过滤逻辑：当 `routeWhitelist` 提供时，只注册白名单内的路由；未提供时注册全部（ER 行为不变）
  验证：contract 测试——IR 注册时传入 6 端点白名单，非白名单路径（如 `/api/v1/ir/runtime/bootstrap`、`/api/v1/ir/skills`、`/api/v1/ir/frequent-questions`）返回 HTTP 404
  来源：spec `IR Surface Endpoint Set` scenario "IR surface does not expose UI-only ER endpoints"
- [ ] 1.3 将 `instance.register(fastifyMultipart)` 和 `registerWebSocketStream(instance, ...)` 这两个非路由副作用调用纳入白名单覆盖：当 `routeWhitelist` 提供且不含 multipart 上传路径和 WS stream 路径时，跳过这两个调用
  验证：contract 测试——IR 注册后访问 WS stream 路径不建立连接；IR surface 不加载 multipart 插件（提交 multipart body 返回 400 而非解析）
  来源：design D3a；spec `IR Surface Endpoint Set`（IR 只暴露 6 端点，不暴露 WS 和 multipart 上传）

## 2. IR composition 注册

- [ ] 2.1 在 `channel-composition.ts` 中新增 IR 注册路径：调用 `registerWebChannel` 传入 `routePrefix: "/api/v1/ir"`、`routeWhitelist`（6 端点）和 `identityResolver: createTaskIdentityResolver(context.identity)`
  验证：`npm run build`；启动后 `/api/v1/ir/sessions` 等 6 个端点可访问
  来源：spec `IR Identity From Trusted Headers`；design D2、D3
- [ ] 2.2 确保 IR 注册在 ER 受保护路由 scope 内完成，且 IR 路由不挂 cookie auth plugin、ER 路由不挂 header resolver
  验证：code review 检查点——确认 IR 和 ER 的 `identityResolver` 在 composition 层分别注入，互不感知
  来源：spec `IR and ER Authentication Isolation`；design D4

## 3. IR 行为等价 contract 测试

- [ ] 3.1 编写 IR 端点行为等价测试：对 6 个 IR 端点分别验证响应 DTO、schema validation、runtime delegation 与对应 ER 端点完全一致（仅 URL prefix 和 auth 方式不同）
  验证：`npm test -- packages/agent-channel-web`（新增 IR contract 测试文件）
  来源：spec `IR Surface Endpoint Set` scenario "IR endpoints mirror ER protocol"
- [ ] 3.2 编写 IR SSE stream 测试：验证 `GET /api/v1/ir/sessions/:sessionId/stream` 的 `lastSeenSequence` replay、live-tail、terminal projection 和 abort 行为与 ER stream 一致
  验证：`npm test -- packages/agent-channel-web`（stream contract 测试）
  来源：spec `IR Stream Consumption`；design D5
- [ ] 3.3 编写 IR agent scope 测试：验证 IR 请求的 agent scope 来自 `requireSession` 返回的 `session.agentId`，而非 header
  验证：`npm test -- packages/agent-channel-web`
  来源：spec `IR Identity From Trusted Headers` scenario "Agent scope is not from headers"

## 4. 认证隔离与安全负向测试

- [ ] 4.1 编写缺头负向测试：IR 请求缺少 `x-tenant-id` 或 `x-subject-id` 时返回 safe 401，且不创建 session/request/message/attachment/pending-input
  验证：`npm test -- packages/agent-channel-web`（断言 HTTP 401 + 断言 runtime port 未被调用）
  来源：spec `IR Identity From Trusted Headers` scenario "Missing required headers are rejected"
- [ ] 4.2 编写 body 注入 scope 负向测试：IR 请求 body 包含 `tenantId`/`subjectId`/`agentId` 等 scope 字段时被 schema 拒绝
  验证：`npm test -- packages/agent-channel-web`（断言 HTTP 400 或字段被忽略）
  来源：spec `IR Identity From Trusted Headers` scenario "Body cannot override header identity"
- [ ] 4.3 编写 ER/IR 认证交叉拒绝测试：cookie-only 请求在 IR 路由被拒（401）；header-only 请求在 ER 路由被拒（401/challenge）
  验证：`npm test -- packages/agent-channel-web`
  来源：spec `IR and ER Authentication Isolation` scenarios "Cookie-only request is rejected on IR routes" 和 "Header-only request is rejected on ER routes"
- [ ] 4.4 编写 auth 失败无 side effect 测试：任何 auth 失败（缺头、交叉拒绝）均不创建或修改 session、RequestRun、message、attachment、memory、pending input、checkpoint、timeline 或 capability state
  验证：`npm test -- packages/agent-channel-web`（断言 runtime port 调用次数为 0）
  来源：spec `IR and ER Authentication Isolation` scenario "Auth failure produces no side effect"
- [ ] 4.5 编写跨 scope 隐藏测试：IR 请求访问其他 owner/agent scope 的 session 时返回 safe 404，不泄露存在性
  验证：`npm test -- packages/agent-channel-web`
  来源：spec `IR Safe Error And Capacity Boundary` scenario "Cross-scope request is hidden"
- [ ] 4.6 编写 safe error 不泄露敏感数据测试：IR 请求失败时 safe error 不含 prompt、模型输出、凭证、token、raw file content
  验证：`npm test -- packages/agent-channel-web`（断言响应体字段）
  来源：spec `IR Safe Error And Capacity Boundary` scenario "Safe error does not leak sensitive data"

## 5. 架构验证

- [ ] 5.1 确认 `agent-channel-web` 不依赖 `agent-channel-web-auth-local` 或任何 auth 实现（IR resolver 由 composition 注入）
  验证：`npm run lint:architecture`（dependency-cruiser 断言无新增违规依赖）
  来源：design D2、D3；AGENTS.md 模块边界
- [ ] 5.2 确认 ER 行为零回归：现有 ER contract 测试和 e2e 测试全部通过
  验证：`npm test`、`npm run test:contract`
  来源：spec `IR Surface Endpoint Set` scenario "ER registration is unaffected by routePrefix parameterization"

## 6. 验证和收尾

- [ ] 6.1 运行完整验证套件
  验证：`openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
  来源：proposal 验证入口
- [ ] 6.2 确认本次改动未遗留未使用 import、变量、临时 fixture 或 debug logging
  验证：code review 检查点——diff 中无本次改动产生的死代码
  来源：AGENTS.md 实现质量门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 同步 `openspec/specs/web-channel-ir-surface/spec.md`。
- 合并 `openspec/specs/ts-local-configured-auth/spec.md` 的 IR route classification delta。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/web-channel-api-surface.md`。
- 按需更新 `openspec/designs/modules/agent-channel-web.md`。
- 按需新增 `openspec/designs/adr/` 中 IR 复用 ER 协议与 createTaskIdentityResolver 的取舍 ADR。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
