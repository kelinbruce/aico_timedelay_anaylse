## 背景和现状（Context）

首版本地 TS 后端已经把 Web channel、runtime、session/history、stream、attachment、capability 和 observability 分成独立 owner。`agent-channel-web-auth-local` 目前只是 localhost-only local configured authentication 的占位模块，尚未定义 endpoint、cookie、credential 校验或身份注入协议。

本 change 只补齐本地单实例运行包的最小认证闭环。它继承当前稳定基线中的两个前置约束：

- `ts-minimal-agent-kernel` 已经定义 `agent-app` 是唯一读取和验证内置配置、env secret override 并向下游提供 runtime-safe composition input 的 owner；运行期组件不得重新解释源配置。
- `ts-core-contracts` 已经定义 `SecretReference` 只能表达 `env:` 或 `file:` secret source，raw secret 不得进入配置、诊断或可见输出。

相关方：

- `agent-app`：产品入口和 composition root，负责选择 local/remote/IAM 产品装配分支。
- `agent-channel-web-auth-local`：本地认证 adapter boundary，负责 login/logout、cookie 签发/校验、challenge 和 trusted identity 生成；不新增跨模块 public contract surface。
- `agent-channel-web`：Web transport 和 stream projection boundary，只消费 auth boundary 注入的 trusted identity，不依赖 auth-local 包。
- `agent-observability`：消费安全 auth 诊断、日志、audit 和 metric。

当前目标规格的实施重点是：补齐本地认证边界、产品装配、验证和架构边界检查；本设计不约束具体代码组织方式。

## 当前代码基线和最小 Delta

当前分支的 `agent-channel-web-auth-local` 仍是本地认证占位边界，local 产品入口尚未形成完整的 login/logout/cookie/challenge 流程。Web channel 已有 REST/SSE stream 入口，后续 WebSocket 入口由 `add-ts-web-sse-ws-transports` 补齐；本 change 不能把认证失败传入 runtime 主流程，也不能让 auth-local 读取 raw env/file 或定义新的跨模块 secret contract。

本 change 的最小增量是：

- 在 `agent-app` local product bootstrap 中，基于 frozen app config 和 app-owned secret validation result 显式组装 auth-local。
- auth-local 路由和认证 hook 必须通过 `agent-channel-web-auth-local` 提供的 Fastify 插件/插件工厂注册；local product bootstrap 必须把该插件和受保护 Web/API/SSE/WS 路由装配在同一 Fastify 作用域内。
- 在 Web auth boundary 做 route classification：login shell、login/logout endpoint、health 和必要 static asset 按公开策略处理；protected SPA route、`/api/**`、SSE 和 WebSocket 在进入业务或 stream subscription 前执行 auth。
- 实现 signed HttpOnly cookie、fixed TTL、restart invalidation、logout clear-cookie 和 unauthenticated challenge / safe close reason。
- 将 trusted `IdentityContext` 注入受保护请求，忽略 body/query/header/client metadata 中的 identity 字段。

验证入口是 local entrypoint integration tests、route precedence tests、SSE/WS auth tests、no-side-effect tests 和 architecture boundary tests：必须证明未认证访问不会创建 session、RequestRun、message、attachment、memory、pending input 或 capability invocation。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 在 local 产品入口中启用 localhost-only local auth，默认保护 Web 页面、REST API、SSE 和 WebSocket。
- 使用已冻结的配置和 `agent-app` 提供的 secret validation result 声明单一本地身份和 credential source。
- 提供 login/logout、未认证 challenge、signed HttpOnly cookie、固定 TTL、服务重启失效和安全诊断。
- 在受保护请求进入 runtime/session/attachment/capability 等主流程前注入可信 `IdentityContext`。
- 保证 `agent-channel-web` 和 remote/IAM 产品入口不依赖、不打包、不暴露 `agent-channel-web-auth-local`。
- 保证 generic app composition 和 remote/IAM 产品入口不 import、不 register、不 bundle `agent-channel-web-auth-local`；只有 local product bootstrap 显式选择该插件，并由 dedicated local product manifest 声明 `agent-channel-web-auth-local` 运行依赖。

**非目标：**

- 不支持 LAN/公网直接暴露本地认证模式，不定义 HTTPS 反代、secure cookie 或公网部署要求。
- 不提供页面修改认证配置、多用户管理、注册、密码修改、credential rotate API、remember-me、refresh token 或服务端认证 session store。
- 不定义 IAM 登录流程，不为 remote/IAM 产品入口提供本地用户 fallback。
- 不修改 runtime lifecycle、RequestRun 状态机、session/message persistence、stream replay、attachment 或 capability 业务语义。
- 不定义长期 query parameter 认证票据；REST、SSE、WS 均使用 cookie。

## 设计决策（Decisions）

### 1. 触发机制

本地认证有两个触发点，二者分属不同生命周期阶段：

1. 启动期装配触发：
   - 触发方：`agent-app` local product bootstrap。
   - 触发阶段：配置和 secret validation/freeze 完成后，Web channel 对外服务前。
   - 执行方式：同步；失败则 startup `BLOCKED`。
   - 不是用户动作、后台 job、调度机制或请求生命周期阶段。

2. 请求期认证触发：
   - 触发方：用户访问 login/logout 或受保护 Web/REST/SSE/WS 入口。
   - 触发阶段：Web channel auth boundary，位于 request acceptance、stream subscription、attachment intake、history read、runtime command dispatch 之前。
   - 执行方式：login/logout 是同步 auth action；受保护入口的 cookie 校验是每次请求/连接前置同步校验；通过后主流程可异步继续。

认证失败不得进入 runtime request lifecycle，不产生 terminal event、checkpoint、pending input、memory record 或 learning event。

### 2. 输入与前置条件

启动期最小输入：

- 已验证并冻结于当前进程生命周期的 `DefaultSystemConfig`。
- `agent-app` 提供的 app-owned validated secret reference result；它不是跨模块 public contract，auth-local 不重新读取 raw env/file。
- local product branch 选择结果。
- local auth 配置：本地用户 `IdentityContext` 所需字段、credential `SecretReference`、cookie TTL 和 auth enabled flag。
- adapter-private cookie signing input：单次进程内生成或启动期安全装配得到；不得来自客户端，也不得形成跨模块 contract。
- readiness / safe diagnostics publisher。

请求期最小输入：

- Web adapter request context。
- 受保护入口判定信息：public auth entry 或 protected entry。
- login request body 或 cookie header。
- frozen local auth internal runtime view。
- safe error normalization 和既有 observability boundary。
- 请求取消上下文或等价机制，用于慢边界和超时控制。

前置条件：

- 系统尚未对外 serving 前，active credential reference 已通过 startup secret validation。
- local 产品入口默认监听 loopback；非 loopback 暴露不是本 change 允许的部署形态。
- `agent-channel-web` 提供可接入 trusted identity 的认证边界，但不依赖 auth-local。

### 3. 输出与副作用

启动期输出：

- auth-local 内部运行视图，用于保存本次进程内已验证的 local auth 配置投影。
- startup safe diagnostics，作为既有 config/readiness/observability 边界的诊断输入。
- Web auth boundary registration result

请求期输出：

- login success：safe current-user identity summary、signed HttpOnly cookie、safe auth diagnostic。
- login failure：safe auth failure response、rate limit/backoff state、safe auth diagnostic。
- logout：clear-cookie response、safe auth diagnostic。
- protected request success：trusted `IdentityContext` attached to Web request context for downstream owner-scope use。
- protected request failure：unauthenticated challenge 或 safe close reason，safe auth diagnostic。

允许的副作用：

- 设置或清除 local auth cookie。
- 更新最小 login failure rate-limit/backoff state。
- 记录安全结构化日志、audit event、metric。

禁止的副作用：

- 未认证或认证失败时创建 session、RequestRun、message、attachment、artifact、memory、pending input、checkpoint 或 capability invocation。
- 把 cookie value、raw credential、secret file content、signing key、raw exception、prompt/model output 或未授权对象内容写入日志、audit、metric、trace、safe error 或 stream。
- 将认证失败伪造成 runtime terminal failure。

### 4. 核心判断逻辑

启动期必须按以下顺序处理：

1. `agent-app` 根据 deployment branch 判断当前是否是 local 产品入口。
2. 若不是 local 产品入口，禁止组装 auth-local，并通过架构边界验证确认不可依赖或打包。
3. 若是 local 产品入口，读取冻结配置中的 local auth 分支。
4. 校验本地身份字段来自配置快照，不来自客户端或 Agent package。
5. 校验 credential source 已由 `agent-app` 的 secret validation result 标记为 active、required、validated。
6. 校验 cookie TTL 和 local auth branch enablement 满足本地最小策略；cookie 名称和签名材料属于 adapter-private 配置/实现细节，不形成跨模块 contract。
7. 若任何 critical auth config 不成立，startup `BLOCKED`，只发布 safe diagnostics。
8. 若全部成立，创建只读 auth-local 内部运行视图，启用 login/logout 行为和受保护入口认证边界。
9. 允许 Web channel 对外服务；后续请求只能消费 runtime view，不重新读取源配置。

login 必须按以下顺序处理：

1. 校验 login request schema；非法输入返回 safe validation/auth failure。
2. 确认请求来自 localhost local product entry；remote/IAM entrypoint 不存在该登录行为。
3. 执行 rate limit/backoff 检查；超限返回 safe auth failure，不说明 credential 细节。
4. 通过内部 secret resolver 或装配时安全句柄读取/比较 credential；raw credential 只在认证边界内短暂存在。
5. credential 不匹配时记录 safe failure，更新 backoff state。
6. credential 匹配时生成 process-bound signed cookie，TTL 固定，`HttpOnly`、`SameSite=Strict`、`Path=/`。
7. 返回 safe current-user identity summary。

protected request 必须按以下顺序处理：

1. Web auth boundary 先做 route classification：login shell、login/logout endpoint、health 和必要 static asset 按公开策略处理；protected SPA route 返回 challenge/login routing；`/api/**`、SSE 和 WebSocket 必须在 SPA fallback 前进入 auth boundary。
2. 拒绝 query parameter 长期 credential/token；不把它作为认证依据。
3. 读取 cookie；缺失则返回 unauthenticated challenge。
4. 校验签名、TTL、process-bound signing context、cookie purpose 和 configured identity binding。
5. 失败则返回 unauthenticated challenge 或 safe close reason；不得触发下游业务。
6. 成功则从 runtime snapshot 构造 `IdentityContext`。
7. 忽略 request body/query/header/client metadata 中的 tenant/subject/displayName/owner/auth 字段。
8. 将 trusted identity 注入 Web request context，再进入 downstream Web / runtime / stream / attachment / history flow。

logout 必须按以下顺序处理：

1. 接受已认证或带有待清除 cookie 的 logout request。
2. 清除 local auth cookie。
3. 记录 safe logout diagnostic。
4. 不删除业务 session/history/runtime/attachment/memory 数据。

### 5. 状态 / 产物边界

本 change 不新增 `agent-contracts/*` owning subpath，不新增 gateway Record，不新增 runtime/session/capability public DTO。下列产物只约束 auth-local adapter 内部语义和 Web boundary 可观察行为；归档时不得把它们提升为跨模块公共接口，除非另有 contract refinement change。

#### Auth-local 内部运行视图

语义：

- 单次进程生命周期内本地认证的只读运行视图。
- 是 auth-local adapter 唯一允许消费的认证配置事实。
- 来自 frozen app config 和 app-owned secret validation result，不从 auth-local 内部读取 raw env/file。

最小语义：

- 认证模式是 local configured authentication。
- 只服务 local product entrypoint。
- 身份投影使用核心契约已有 `IdentityContext`。
- credential source 使用核心契约已有 `SecretReference`。
- cookie 策略满足 signed、HttpOnly、fixed TTL、`SameSite=Strict`、`Path=/` 和服务重启失效。
- 生成时间和签名上下文只用于本进程内校验，不对外暴露。

生命周期和消费方：

- 生命周期：单次进程运行期有效；服务重启后 cookie 必须失效。
- 消费方：`agent-channel-web-auth-local` login/logout/auth boundary、`agent-app` local composition、health/readiness safe diagnostics。

安全限制：

- 不包含 raw credential、cookie value、signing key、secret file content 或可写配置句柄。

#### Local auth cookie

语义：

- 浏览器持有的 signed HttpOnly 认证票据。
- 表示当前浏览器会话已通过本地配置凭据认证；不是服务端持久化 session。

生命周期：

- 签发于 login success。
- 在 TTL 过期、logout、签名失败、cookie 篡改、服务重启或 signing context 改变后失效。

与原始事实关系：

- 原始事实是冻结配置中的本地身份和 credential reference。
- cookie 是该身份在当前进程内的临时认证投影，不授权读取 raw secret 或绕过 owner-scope 校验。

#### Local auth challenge

语义：

- Web boundary 输出的安全未认证提示。
- 供前端跳转登录页或关闭未授权 stream。

生命周期和消费方：

- 每次未认证 protected access 即时产生。
- 消费方：浏览器前端、SSE/WS client、测试和 safe diagnostics。

安全限制：

- 不暴露 secret source、cookie verification detail、session/run 是否存在或内部异常体。

#### Auth safe diagnostic

语义：

- startup 或 request 认证边界产生的安全诊断项。
- 不是业务事实，不进入 runtime timeline。

最小语义：

- 表达安全 reason code、outcome、auth mode、safe scope 和是否影响 readiness。
- 可被已有 config/readiness/observability 边界消费。
- 不定义新的 audit、metric、trace 或 logging contract。

安全限制：

- 只能包含 safe field ref、reason code、auth mode、outcome 和脱敏摘要。

### 6. 流程接入

启动流程：

- 上游：configuration source loading、app config validation/freeze、`agent-app` secret validation result。
- 当前流程：`agent-app` local product bootstrap 组装 `agent-channel-web-auth-local`。
- 下游：`agent-channel-web` auth boundary registration、readiness publishing。

请求主流程：

- 上游：浏览器访问 login/logout/protected Web route、REST、SSE、WS。
- 当前流程：auth-local login/logout behavior 或 protected-entry auth boundary。
- 下游：
  - login/logout 只返回 auth response，不进入 runtime。
  - protected REST 成功后进入 Web handling，再进入 runtime/session/attachment 等既有边界。
  - protected SSE/WS 成功后进入 stream projection，失败则不订阅 runtime timeline。

消费规则：

- downstream 只能消费 trusted `IdentityContext`，不得知道 cookie、credential 或 auth-local 内部协议。
- local auth 不拥有 owner-scope 数据持久化；持久化事实仍由 session/runtime/attachment/memory 等 owner 按既有契约写入。

### 7. 失败与降级

启动失败：

- local auth critical config 缺失、credential reference 未验证、TTL 非法、cookie signing input 不成立：startup `BLOCKED`。
- diagnostic 必须 safe；不得 fallback 到无认证、本地默认用户或 remote/IAM 身份。

请求失败：

- login schema invalid、credential mismatch、rate limit/backoff active：safe auth failure。
- cookie missing/expired/tampered/previous-process signed：unauthenticated challenge。
- protected SSE/WS auth failure：safe challenge 或 close reason；不订阅 timeline。
- secret resolver/auth internals error：转换为 safe auth failure；不泄漏异常体。

降级：

- 本 change 不定义认证降级为匿名访问。
- local auth enabled 且 critical auth branch 不成立时只能 fail closed。
- remote/IAM 产品入口不允许降级到 local configured user。

超时：

- credential verification、secret access 或 signing verification 的慢边界必须受控超时。
- 超时按 safe auth failure 或 startup `BLOCKED` 处理，不等待首次请求补偿。

### 8. 选定方案和放弃方案

选定方案：localhost-only local product entrypoint + signed stateless HttpOnly cookie + frozen config / app-owned secret validation result + Web auth boundary trusted identity。

理由：

- 满足首版本地安全闭环，避免完整用户管理系统。
- 不需要服务端认证 session store，服务重启自然使旧 cookie 失效。
- 认证事实停留在 Web boundary，runtime/session 不需要感知 cookie 协议。
- 与 app config / secret boundary 的 startup-only 冻结模型一致。

放弃方案：

- 放弃匿名本地模式：会让 request submit、history、attachment 和 stream 默认裸奔。
- 放弃服务端 auth session store：超出首版范围，并引入新的持久化 owner 和清理语义。
- 放弃 refresh token / remember-me：扩大票据生命周期和泄露风险。
- 放弃 query parameter 长期 token：容易进入日志、history、referrer 和代理记录。
- 放弃 LAN/公网本地认证：需要 TLS、secure cookie、反代、CSRF/部署安全要求，应单独 change。
- 放弃 `agent-channel-web` 直接依赖 auth-local：会破坏 remote/IAM 可替换认证和 Web channel 复用边界。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 认证 fail closed；credential 只使用 `env:`/`file:` reference；cookie `HttpOnly`、`SameSite=Strict`、固定 TTL、process-bound；客户端身份字段不可覆盖 trusted identity；remote/IAM 不 fallback。 | security verification、safe diagnostics verification、architecture boundary verification |
| 性能/容量 | 本地单用户认证只做一次 login credential 校验和每请求 cookie 签名校验；不引入 DB session lookup。失败登录使用最小 backoff，避免无限快速猜测。 | backoff 行为验证；protected entry 前置校验不触发下游重操作的集成验证 |
| 可靠性/恢复 | 服务重启后旧 cookie 失效；startup critical config 错误 `BLOCKED`；请求期 auth 失败不污染 runtime terminal 或 durable facts。 | restart/invalid-cookie verification、unauthenticated-no-side-effect verification |
| 可维护性 | auth-local 是可替换 adapter；Web channel 只依赖 trusted identity 认证边界；runtime/session/capability 不感知 cookie 协议。 | architecture boundary verification、module boundary review |
| 可测试性 | 使用冻结配置、受控时间、受控签名上下文和受控 secret resolver，可确定性验证 TTL、restart、challenge、SSE/WS。 | contract verification、Web channel integration verification、SSE/WS auth verification |
| 审计/可追溯性 | login success/failure、logout、challenge、invalid/expired cookie 输出 safe auth diagnostic；不进入 runtime timeline。 | observability verification、timeline absence verification |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| local 产品入口显式组装 auth-local，remote/IAM 禁止组装 | 1.1, 1.3 | architecture boundary verification、entrypoint behavior verification |
| localhost-only serving boundary 默认成立 | 1.2, 6.3 | local serving boundary verification |
| local auth 只消费冻结配置和 app-owned secret validation result | 1.4, 2.1, 2.2, 5.1 | startup/config contract verification |
| raw/direct credential 被拒绝且 safe diagnostics 不泄漏 | 2.3, 2.4, 4.3, 5.1 | secret/auth config verification、safe diagnostics verification |
| login 成功签发 signed HttpOnly cookie 并返回身份摘要 | 3.1, 5.2 | login contract verification |
| login 失败限速/退避且不泄漏 credential 细节 | 3.2, 4.2, 5.2 | auth failure verification |
| logout 清除 cookie 且不删除业务数据 | 3.3, 5.2 | logout behavior verification |
| cookie TTL、签名无效、服务重启后失效 | 3.4, 5.3 | cookie lifecycle verification |
| 未认证 protected REST/SSE/WS 不产生用户数据 | 4.1, 4.2, 4.3 | Web channel integration verification、no-side-effect verification |
| trusted `IdentityContext` 不可被客户端覆盖 | 4.4 | owner-scope/auth boundary verification |
| auth diagnostics safe 且不进入 runtime timeline | 5.1, 5.2, 5.3 | observability verification、timeline absence verification |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-local-configured-auth/spec.md` 主承载 local auth 行为、失败、验证要求；不新增核心接口契约。
- 跨模块架构：`openspec/designs/architecture/authentication-boundary.md` 主承载 local/remote/IAM 装配边界、身份来源和 protected flow 接入。
- 领域模型/状态机：`openspec/designs/architecture/local-auth-session.md` 主承载 local auth cookie 生命周期和 challenge 语义；不主张新增跨模块 DTO。
- API/SPI/event/schema：`openspec/designs/architecture/web-auth-local.md` 主承载 login/logout/challenge 和 SSE/WS auth 可观察行为；不新增 `agent-contracts` owning subpath。
- 模块职责：`openspec/designs/modules/agent-channel-web-auth-local.md`、`openspec/designs/modules/agent-channel-web.md`、`openspec/designs/modules/agent-app.md` 主承载模块职责和依赖边界。
- ADR：仅当实现中出现 LAN/公网、server-side session store、token 方案等长期争议时，新增 `openspec/designs/adr/<next-id>-localhost-only-local-auth.md`。
- 导航：`openspec/designs/spec-to-design-map.md` 记录 spec 到 design 和验证入口的导航。

## 风险与取舍（Risks / Trade-offs）

- [本地认证被误用为 LAN/公网方案] -> 规格固定 localhost-only，非 loopback/TLS/secure cookie/反代要求必须单独 change。
- [Web channel 直接依赖 auth-local 导致 remote/IAM 被污染] -> 使用 trusted identity 认证边界，并用 architecture boundary verification 阻断依赖。
- [认证失败污染 runtime 事实] -> auth boundary 位于 request acceptance 和 stream subscription 之前，并用 no-side-effect verification 验证。
- [cookie 泄漏或长期有效] -> 使用 HttpOnly、Strict、固定 TTL、process-bound signing context；服务重启失效。
- [诊断泄露 credential 或路径] -> 所有 auth error 经 safe diagnostics，验证禁止敏感字段。

## 发布和回滚策略（Release / Rollback）

本 change 不包含数据迁移或既有认证行为转换。发布启用步骤：

1. local 产品配置提供本地身份、credential `SecretReference` 和 cookie TTL。
2. 启动期验证通过后 local entrypoint serving。
3. 若 auth 配置错误，启动失败并输出 safe diagnostics；回滚方式是恢复上一份有效配置并重启。

remote/IAM 入口不受本 change 启用影响，且不得因 local auth 失败改变其认证模式。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-local-configured-auth/spec.md`：提升 local auth 可验证行为契约。
- `openspec/overview.md`：提炼本地运行包默认需要认证保护的长期背景。
- `openspec/designs/architecture/authentication-boundary.md`：提炼产品装配、身份来源、protected flow 和安全边界。
- `openspec/designs/architecture/local-auth-session.md`：提炼 cookie 和 challenge 的生命周期语义。
- `openspec/designs/architecture/web-auth-local.md`：提炼 login/logout/challenge 和 SSE/WS auth 可观察行为。
- `openspec/designs/modules/agent-channel-web-auth-local.md`：更新 auth-local 模块职责和非职责。
- `openspec/designs/modules/agent-channel-web.md`：补充 Web channel 只消费 trusted identity 的边界。
- `openspec/designs/modules/agent-app.md`：补充 local/remote/IAM 产品入口组装边界。
- `openspec/designs/spec-to-design-map.md`：新增导航和验证入口。
- `openspec/designs/adr/<next-id>-localhost-only-local-auth.md`：仅在出现长期替代方案争议时创建。

## 待确认问题（Open Questions）

无。首版固定为 localhost-only、单用户配置、signed stateless HttpOnly cookie、无服务端认证 session store、无 LAN/公网支持。
