## 0. 当前分支导入预检

- [x] 0.1 对比 `origin/codex/ts-web-channel` 的 auth-local 实现和当前分支代码，列出可直接复用、需要重做、需要丢弃的实现点。
  验证：code review 检查点，输出实现差异清单；该检查无法完全自动化，因为需要判断远程实现是否仍符合当前 stable OpenSpec 和相邻 active change。
  来源：proposal `与当前基线和相邻 change 的边界`。
- [x] 0.2 确认 local auth 只细化 `agent-channel-web-auth-local` / `agent-app` / Web auth boundary，不修改 `IdentityContext`、`SecretReference`、owner scope、runtime lifecycle 或 observability sink contract。
  验证：architecture review 检查点，配合后续 `npm run lint:architecture` 或等价 boundary tests。
  来源：design 文档承载决策；proposal 边界说明。

## 1. 产品装配和依赖边界

- [x] 1.1 在 local 产品入口中显式组装 `agent-channel-web-auth-local`，并确保组装发生在配置/secret freeze 之后、Web 对外服务之前。
  验证：local entrypoint integration verification，断言 valid local auth config 下受保护入口已启用认证边界。
  来源：`Local Auth 启动配置和产品装配`；design 触发机制。
- [x] 1.2 验证 local auth serving boundary 默认只允许 localhost，非 localhost 暴露在本 change 中不可启用。
  验证：local serving boundary verification，断言 non-localhost exposure 未被开启，且未来 LAN/公网访问需要独立 change。
  来源：`Local Auth 启动配置和产品装配`；`P1-S09`。
- [x] 1.3 为 remote/IAM 产品入口添加 negative architecture/integration verification，断言不组装、不依赖、不打包 `agent-channel-web-auth-local` 且不暴露 login/logout 行为。
  验证：architecture boundary verification；remote/IAM entrypoint behavior verification；product manifest validation 断言 backend-only / with-frontend 不声明 `agent-channel-web-auth-local`，local configured auth manifest 显式声明 `agent-channel-web-auth-local`。
  来源：`Local Auth 启动配置和产品装配`；proposal 产品装配边界。
- [x] 1.4 在 `agent-channel-web` 中接入 trusted identity 认证边界，使 Web channel 只消费 trusted `IdentityContext`，不依赖 auth-local 包。
  验证：architecture boundary verification 断言 `agent-channel-web` 不依赖 `agent-channel-web-auth-local`；Web channel behavior verification 覆盖可替换 trusted identity 输入。
  来源：design 选定方案；`Trusted IdentityContext 注入`。

## 2. 启动配置和 secret 消费

- [x] 2.1 实现 auth-local 内部运行视图的启动期构造，输入只来自 frozen app config 和 `agent-app` 提供的 app-owned secret validation result，且不导出为跨模块 public contract、不重新读取 raw env/file。
  验证：startup/config contract verification 覆盖 valid snapshot 构造和运行期不重新读取源配置。
  来源：`Local Auth 配置输入边界`；design 状态 / 产物契约。
- [x] 2.2 验证本地用户身份和 credential source 只能来自启动期冻结配置，配置变更必须重启后生效。
  验证：startup/config verification 覆盖 deployment configuration source、runtime page edits ignored、request payload ignored、restart required。
  来源：`Local Auth 配置输入边界`；`P1-B00`。
- [x] 2.3 添加 startup blocking tests，覆盖 missing identity、missing credential ref、unsupported raw/direct credential、unvalidated active credential、invalid TTL。
  验证：config/auth startup verification 断言 readiness blocked 且 diagnostics safe。
  来源：`Local Auth 启动配置和产品装配`；`Local Auth 配置输入边界`。
- [x] 2.4 实现 auth config safe diagnostics，禁止输出 raw credential、secret file content、cookie signing input、完整敏感路径或 resolver exception body。
  验证：safe diagnostics verification 覆盖 startup failure diagnostic payload。
  来源：`Local Auth 安全诊断和审计`；design 安全质量属性。

## 3. Login、Logout 和 Cookie 生命周期

- [x] 3.1 实现 local login 行为：schema validation、credential verification、signed HttpOnly cookie、fixed TTL、`SameSite=Strict`、`Path=/` 和 safe identity summary。
  验证：login contract verification 覆盖 success response、cookie attributes 和 safe identity summary。
  来源：`Local Login 和 Logout`；`Local Auth Cookie 生命周期`。
- [x] 3.2 实现 login failure 的最小 rate limit/backoff 和 constant-result safe failure，不暴露 credential 接近程度、secret source、文件存在性或签名细节。
  验证：auth failure verification 覆盖 repeated failures、backoff trigger 和 safe response shape。
  来源：`Local Login 和 Logout`；design 核心判断逻辑。
- [x] 3.3 实现 logout 行为清除 local auth cookie，且不删除 session/history/runtime/attachment/memory 等业务数据。
  验证：logout integration verification 断言 cookie cleared、后续 protected request 需重新登录、业务数据未被删除。
  来源：`Local Login 和 Logout`。
- [x] 3.4 实现 cookie 校验：signature、TTL、process-bound signing context、purpose 和 configured identity binding。
  验证：cookie lifecycle verification 覆盖 valid、expired、tampered、previous-process/restart invalid。
  来源：`Local Auth Cookie 生命周期`。

## 4. Protected Web、REST、SSE 和 WebSocket 接入

- [x] 4.1 在 protected REST/Web 入口前置执行 local auth boundary，未认证时返回 frontend 可识别的 unauthenticated challenge。
  验证：protected REST/Web integration verification 覆盖 unauthenticated challenge 和 authenticated success。
  来源：`未认证 Challenge 和受保护流程拦截`。
- [x] 4.1a 添加 route precedence verification，断言 login shell、login/logout endpoint 和必要 static asset 可按公开策略访问；protected SPA route 返回 challenge/login routing；`/api/**`、SSE 和 WebSocket 不被 SPA fallback 吞掉，且在订阅/业务操作前执行 auth boundary。
  验证：Web route integration verification 覆盖 static/login/protected/API/SSE/WS。
  来源：`未认证 Challenge 和受保护流程拦截`。
- [x] 4.2 在 SSE 和 WebSocket stream subscription 前置执行同一 local auth boundary，失败时 safe close/challenge，成功后再订阅 runtime timeline。
  验证：SSE/WS auth verification 覆盖 unauthenticated 不订阅 `RuntimeTimelinePort.stream(request)`，authenticated 正常投影。
  来源：`未认证 Challenge 和受保护流程拦截`；`Local Auth Cookie 生命周期`。
- [x] 4.3 添加 no-side-effect tests，断言未认证或 invalid cookie 访问 protected REST/SSE/WS 在 auth boundary 处短路，不调用 runtime-facing submit/session/history/stream port，也不创建 session、RequestRun、message、attachment、memory、pending input 或 capability invocation。
  验证：Web channel integration verification 使用下游 runtime/session/capability 端口调用计数或等价 spy，实际断言 user-data operation 未发生。
  来源：`未认证 Challenge 和受保护流程拦截`；design 禁止副作用。
- [x] 4.4 添加 trusted identity tests，断言 request body/query/header/client metadata 中的 tenant/subject/displayName/owner/auth 字段不能覆盖 local auth 注入的 `IdentityContext`。
  验证：owner-scope/auth boundary verification。
  来源：`Trusted IdentityContext 注入`。
- [x] 4.5 添加 query parameter token negative test，断言 REST/SSE/WS query 中的长期 credential/token 不被当作认证依据。
  验证：protected entry and stream verification 实际携带 query token 并断言 unauthenticated challenge。
  来源：`Local Auth Cookie 生命周期`。

## 5. 安全诊断、审计和可观测

- [x] 5.1 为 login success/failure、logout、challenge、invalid cookie、expired cookie 和 protected-entry rejection 输出 safe auth diagnostic。
  验证：observability verification 断言 event/outcome/auth mode/safe owner coordinates，且不进入 runtime timeline。
  来源：`Local Auth 安全诊断和审计`。
- [x] 5.2 添加敏感信息泄漏 negative tests，覆盖 credential、cookie value、signing key、secret content、full sensitive path、raw exception、unauthorized object content 不出现在 response/log/audit/metric/stream。
  验证：safe diagnostics verification 和 response boundary assertions。
  来源：`Local Auth 安全诊断和审计`；design 安全质量属性。
- [x] 5.3 确认认证失败不会伪造成业务失败，不产生 RequestRun terminal timeline event。
  验证：timeline absence assertions；runtime submit/terminal flow 未被触发。
  来源：`Local Auth 安全诊断和审计`。

## 6. 总体验证和收尾

- [x] 6.1 运行 OpenSpec 校验并修复本 change 规格问题。
  验证：`openspec validate add-ts-local-configured-auth --strict`。
  来源：OpenSpec 验证门禁。
- [x] 6.2 运行常规 TS 验证门禁。
  验证：项目常规 build、test、contract test、architecture gate。
  来源：AGENTS.md 验证门禁。
- [x] 6.3 执行 spec-to-task 可追踪性审查，确认每个 `ts-local-configured-auth` requirement 至少有一个实现或验证 task。
  验证：code review 检查点；无法完全自动化，因为该检查跨 proposal/design/spec/tasks 语义对应。
  来源：roadmap 生成后一致性确认；design 验证映射。
- [x] 6.4 清理实现产生的临时 fixture、未使用 export 和调试日志。
  验证：diff hygiene check、相关 lint/test 输出。
  来源：AGENTS.md 外科手术式修改和验证门禁。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/ts-local-configured-auth/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/authentication-boundary.md`。
- 按需更新 `openspec/designs/architecture/local-auth-session.md`。
- 按需更新 `openspec/designs/architecture/web-auth-local.md`。
- 按需更新 `openspec/designs/modules/agent-channel-web-auth-local.md`。
- 按需更新 `openspec/designs/modules/agent-channel-web.md`。
- 按需更新 `openspec/designs/modules/agent-app.md`。
- 如实现中出现长期方案争议，新增 `openspec/designs/adr/<next-id>-localhost-only-local-auth.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一 cookie 生命周期、auth API schema、identity owner 或接口语义。
