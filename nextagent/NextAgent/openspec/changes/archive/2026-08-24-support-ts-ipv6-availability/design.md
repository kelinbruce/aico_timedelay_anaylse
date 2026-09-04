## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.34 配置网络连通性` | 新增可验证的监听环境变量覆盖、IPv6/双栈入站地址、可连接启动提示和首批 IPv6 literal 出站保证 | `network-connectivity` | `FN-10.34 配置网络连通性` |

## `FN-10.34 配置网络连通性`

### 目标与规范依据

本 Function 以最小增量补齐 IPv6 网络可用性：复用既有 `channel.host`/`channel.port` 和 Node.js 默认网络栈，不创建 IP 族策略或全局 HTTP transport。设计必须保持 `127.0.0.1:3000` 默认值和本地配置认证的 localhost-only 边界。

#### 本 Function 的目标 Requirements

canonical spec：`network-connectivity`

- `ADDED`：`监听地址和端口支持进程环境变量覆盖`
- `ADDED`：`IPv6 入站监听提供可连接的启动地址`
- `ADDED`：`网络监听不得放宽已选择的安全暴露边界`
- `ADDED`：`首批关键出站路径可连接 IPv6 literal 目标`
- `ADDED`：`IPv6 可用性必须由真实 socket 验证`

### 当前实现

- `agent-app` 的 `DefaultSystemConfig` 已包含 `channel.host`、`channel.port` 和 `channel.udsPath`。TypeBox/Ajv 边界要求 host 为非空字符串，TCP port 位于 `1..65535`；内置默认值为 `127.0.0.1:3000`。
- application config loader 先合并内置 YAML 与用户 YAML，再解析部分 `env:` 引用并执行统一 schema validation。local runtime package 有独立的 package config 读取入口，但最终复用同一 `validateDefaultSystemConfig`。
- `packages/agent-app/src/config/env.ts` 只拥有 credential resolver。通用配置环境变量解析位于 config loader 和 local runtime package loader，当前两条路径均未覆盖 `NEXTAGENT_CHANNEL_HOST` 或 `NEXTAGENT_CHANNEL_PORT`。
- app lifecycle 把冻结后的 `channel.host` 和 `channel.port` 原样传入 Fastify `listen`。没有 `ipv6Only`、额外 listener 或 IP 族分支。
- local configured auth profile 在 composition 时与 channel config 同时可见，但当前 composition path 没有显式拒绝 `0.0.0.0` 或 `::` 的 host/profile 组合；这与既有 localhost-only 安全基线存在差距。
- local runtime CLI 已对 IPv6 literal 添加方括号，并把 `0.0.0.0` 展示为 `localhost`，但 `::` 仍展示为 `[::]`。现有测试没有覆盖 ready notice 的三个 unspecified/loopback 地址分支。
- OpenAI-compatible model path 使用注入 fetch 或 Node.js 内置 fetch；local api-call 使用内置 fetch；task callback 的常规 HTTP/HTTPS path 使用 fetch，`tlsInsecure=true` 的 HTTPS path 使用 `node:https.request`。三者均没有强制 IP 族策略。
- WHATWG `URL.hostname` 对 IPv6 literal 返回带方括号文本；实际按 Node.js `22.22.0` 运行现有 insecure HTTPS callback 真实 socket 测试时，`https.request({ hostname: '[::1]' })` 无法连接 IPv6 endpoint，当前路径安全返回 `false`。
- 现有出站单元测试主要使用 mock fetch 或 IPv4 server，没有真实 IPv6 socket 的产品路径证据。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| `监听地址和端口支持进程环境变量覆盖` | 两条 config load path 都只处理既有配置源和部分 `env:` 引用 | 缺少同一语义的 channel env override 与非法 port 安全失败测试 |
| `IPv6 入站监听提供可连接的启动地址` | Fastify 已接收 `::1`/`::`，CLI 仅错误展示 `::` | CLI 映射缺失，且没有真实 IPv6/双栈入站证据 |
| `网络监听不得放宽已选择的安全暴露边界` | local configured auth composition 未校验最终 host 是否为受支持 loopback | 缺少 host/profile fail-closed guard 及 negative test |
| `首批关键出站路径可连接 IPv6 literal 目标` | fetch 和 insecure HTTPS callback 均依赖 Node.js 默认网络行为 | 缺少固定 Node.js 版本下的真实 IPv6 证据 |
| `IPv6 可用性必须由真实 socket 验证` | 现有测试以 mock fetch 和 IPv4 server 为主 | 缺少固定 Node.js 版本下的真实 IPv6/双栈 characterization |

### 修改方案

唯一实施路径如下：

1. 在 `agent-app` config owner 内增加一个纯函数 `applyChannelEnvOverrides(input, resolveEnv)`，不进入 `agent-contracts`。application config loader 与 local runtime package config loader 都在既有 env-ref 解析之后、`validateDefaultSystemConfig` 之前调用该函数。
   - 函数只在顶层 input 和既有 `channel` 都是 plain object 时覆盖字段；不得修复结构非法的 source config。
   - `NEXTAGENT_CHANNEL_HOST` 不存在时不写字段，存在时把原字符串写入 `channel.host`，由既有 non-empty schema 完成校验。
   - `NEXTAGENT_CHANNEL_PORT` 不存在时不写字段；存在且满足 `^[1-9][0-9]{0,4}$` 且数值不大于 `65535` 时转换为 number；其他文本保持为 schema-invalid 值，使既有安全配置诊断阻断 ready，且不引入包含原值的新诊断。
   - helper 放在既有 config implementation 内并由 package loader 通过同 package 私有路径复用，避免两个 loader 复制解析规则。
2. 保持 app lifecycle 的单一 Fastify `listen` 路径不变。`channel.host` 继续是监听地址的唯一事实；不设置 `ipv6Only`，不建立第二 listener，也不新增 `ipFamily`。`::` 的双栈结果依赖 spec 已冻结的主机 IPv4-mapped IPv6 前置条件。
3. 在 local runtime CLI 的既有 `safeDisplayHost` 中把 `::` 与 `0.0.0.0` 一并映射为 `localhost`。继续用现有 IPv6 literal 方括号逻辑处理 `::1`，不扩大 hostname parser。
4. 在 sync/async product composition 的共同 config 后置检查点增加单一 private guard。仅当 `channelAuthProfile=LOCAL_CONFIGURED_AUTH` 时，最终 host 必须是 `localhost`、`127.0.0.1` 或 `::1`；其他值以不包含原始 host 的安全 validation error 阻断后续 channel registration。DEFAULT_WEB profile 不应用该限制，既有 local auth owner 和 route registration 不改变。
5. 首批出站路径继续使用当前 transport，不注入 dispatcher 或 lookup：
   - OpenAI-compatible model 和 local api-call 只增加真实 IPv6 socket 测试；若 Node.js `22.22.0` 默认 fetch 无法通过测试，本 change 必须停止并修订设计，不得临时增加全局 IP 族策略。
   - task callback 的 fetch path 和 `tlsInsecure` HTTPS path 分别增加真实 IPv6 HTTP/HTTPS 测试。`tlsInsecure` 路径只在构造私有 `https.request` options 时移除 `URL.hostname` 已包含的 IPv6 外层方括号，使 Node 接收裸 IPv6 hostname；目标 URL、origin allowlist 和其他请求字段保持不变。
   - 不得增加未被失败证据需要的其他兼容逻辑；普通 hostname 与 IPv4 hostname 必须原样传入。
6. 所有真实 server 在测试 teardown 中确定关闭；测试断言 server 收到请求，而不以 DNS mock、`family` mock 或 source assertion 代替网络结果。双栈测试分别从 `[::1]` 和 `127.0.0.1` 访问同一 listener；HTTPS callback 使用 test-only certificate 和现有 `tlsInsecure` test path。

本方案只修改 task callback 内部 insecure HTTPS request option 的 IPv6 hostname 表示；不修改 `FetchGateway`、gateway selection、provider SDK contract、`DefaultSystemConfig` public export、Web API、stream contract、runtime lifecycle、observability contract 或持久化边界。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `网络监听不得放宽已选择的安全暴露边界` | composition 在 local configured auth route 注册前校验最终 host/profile 组合；错误不包含原始 host 或 env value | unspecified 地址必须 fail closed，`::1` 保持可用，DEFAULT_WEB 不被错误限制 |
| 可靠性/恢复 | `首批关键出站路径可连接 IPv6 literal 目标` | 保留 Node.js 默认 fetch 和 `https.request` 行为，以真实 socket 固定已成立的兼容基线 | HTTP/HTTPS IPv6 成功路径和不可达目标既有安全失败语义 |
| 可测试性 | `IPv6 可用性必须由真实 socket 验证` | 使用真实 IPv6 server 和双协议 loopback client，资源在 teardown 关闭 | 不允许 mock-only 证据；三条首批路径和双栈入站都必须实际到达 server |

## 验证策略（Verification Strategy）

- unit：验证 channel env override 的逐字段优先级、合法转换、空值/越界/非法 grammar 和默认值不变；验证 CLI 对 `::`、`::1`、`0.0.0.0` 的可观察输出。
- integration/characterization：启动真实 IPv6/双栈 server，验证 `::1` 入站、`::` 的 IPv6/IPv4 loopback 访问，以及 model、api-call、task callback 的真实 IPv6 HTTP/HTTPS 请求。
- security negative：使用 local configured auth 与 unspecified/non-loopback host 组合，断言 ready 前失败、route 未注册且错误不泄露输入；验证 `::1` 不被地址形态拒绝。
- compatibility：未设置两个新环境变量时验证冻结配置仍使用 YAML 结果和内置 `127.0.0.1:3000`；既有 IPv4 与 hostname 出站测试继续通过。
- architecture：确认新增 helper 停留在 `agent-app` 私有 config 边界，不扩展 `agent-contracts`，出站实现未引入全局 dispatcher 或新的跨 package HTTP abstraction。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/network-connectivity/spec.md`：新增 `FN-10.34` 唯一主规格并保留 Function 元数据。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.2-集成与定制/FN-10.34-配置网络连通性.md`：新增 Function 文档并同步 functions index。
- `openspec/designs/features/D10-二次开发与平台集成/D10.2-集成与定制/F-10.5-集成外部系统.md`：增加 `FN-10.34` 组成和 IPv6 网络可用性保证；同步 feature spec 导航。
- `openspec/overview.md`：补充支持 IPv6/双栈部署的产品范围摘要。
- `openspec/designs/architecture/configuration-boundary.md`：补充 channel 环境变量 precedence、app config owner 和 local auth host guard。
- `openspec/designs/modules/agent-app.md`：补充 channel env override、CLI 地址投影和 listen composition 职责；`agent-model`、`agent-platform-gateway-local`、`agent-channel-task` 模块文档无职责变化。
- ADR：无；本 change 沿用既有 Node.js/Fastify/configuration boundary，不形成新的长期架构取舍。
- `openspec/designs/spec-to-design-map.md`：新增 `network-connectivity` 到 configuration、agent-app 和网络 integration 验证入口的导航。

## 风险与取舍（Risks / Trade-offs）

- `::` 是否接受 IPv4-mapped 连接受主机网络栈设置影响。spec 将该能力写成显式前置条件，测试环境必须具备该条件；本 change 不用双 listener 隐藏主机策略。
- 真实 IPv6 socket 测试依赖执行环境启用 IPv6。release gate 环境若禁用 IPv6，应视为无法提供该平台验收证据，而不是跳过后仍声明支持。
- local configured auth host allowlist 会暴露既有 localhost-only 契约的实现缺口，但该检查是启用 env override 前必须闭合的安全边界；它不改变 DEFAULT_WEB 的监听能力。
- 首批出站范围不覆盖全部 remote gateway。文档明确只对三条路径给出保证，避免把表征测试误述为全局选路治理。

## 待确认问题（Open Questions）

无。
