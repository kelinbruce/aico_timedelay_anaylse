# Web 流传输

## 目的

Web stream transports 定义 Web 产品路径如何在 SSE 和 WebSocket 之间选择 stream delivery。transport 是后端 runtime/channel 配置事实，不是前端 UI 可切换状态。

## 基线决策

- Request Execution Stream 使用 canonical `StreamEnvelope`，通过 `RuntimeSessionPort.streamEvents(...)` 交付单个 session 的 request/run timeline、status、replay 和 terminal projection。
- Session Activity Projection Stream 是唯一受控例外：它使用严格的 `SNAPSHOT | DELTA` 判别联合，通过独立的 `RuntimeSessionActivityPort` 交付 Owner + Agent scope 内的 session attention projection，不进入 `StreamEnvelope`、`RuntimeSessionPort.streamEvents(...)` 或 IR route。
- 两类 stream 只复用 SSE/WebSocket framing、认证、背压和连接清理 primitive；不得复用 payload decoder、cursor、subscriber、replay buffer 或 frontend store。
- 后端 bootstrap 投影可信 `transportKind` 给前端；两类 stream 在同一 app instance 中都使用该 transport，SSE 与 WebSocket 不并行建立。
- 前端产品路径只能消费后端 bootstrap 的 `transportKind`。`VITE_TRANSPORT_KIND`、URL、localStorage 或 UI 控件不得覆盖产品路径 transport。

## 等价性

同一 request/run 在 Request Execution Stream 的 SSE 和 WebSocket 下必须保持事件语义、sequence、replay anchor、terminal projection、safe error、auth scope 和 cleanup 规则等价。

`lastSeenSequence` 在 SSE query 和 WebSocket subscription payload 中都是 optional cursor。两种 transport 必须保留省略和显式数字的区别：省略时不得合成 `0`，显式合法数字才下沉为 `RuntimeSessionStreamEventsQuery.lastSeenSequence`。显式非法 cursor 必须在 channel validation 阶段 safe failure，不得订阅 runtime stream 或泄漏 owner scope、agent scope、本地路径、prompt、模型输出、timeline payload。

request/run-scoped recovery 必须携带显式 `lastSeenSequence`；`requestId` 和 `runId` 只是 filter，不改变 session-scoped sequence。session-scoped no-cursor stream 是 live-tail，不 replay 已有 timeline。SSE 可以发送连接建立 comment 这类 transport frame 表达连接已打开，但该 frame 不是 `StreamEnvelope`，不得改变 WebSocket 等价的业务事件序列。

Session Activity Projection Stream 不接受 timeline cursor、request/run filter 或 feed revision。首次连接必须先发送只包含非 `NONE` entry 的稀疏 `SNAPSHOT`，再发送 session-keyed `DELTA`；bootstrap 与 live 交接期间发生的变化不得丢失。协议损坏、bootstrap 失败或 serialization 失败必须关闭连接或返回安全失败，不得伪造空 snapshot。每个浏览器 app instance 只建立一条全 scope activity connection；session list 分页、搜索、弹窗开合或 detail stream 切换不得改变该连接的订阅范围。

## 降级边界

dev/mock/test fixture 可以显式选择 transport 来覆盖测试场景；产品路径 fallback 必须由后端配置和 bootstrap 决定。连接失败时前端可以重连当前后端指定 transport，但不得自行切换到另一种 transport 并改变协议语义。

## 认证和清理

SSE 和 WebSocket 都使用同一 Web auth 结果。Request Execution Stream 按 session scope 校验；Session Activity Projection Stream 的 snapshot、delta 和 consume 同时校验 trusted Owner Scope 与 Agent Scope。断连 cleanup 只清理 transport 资源，不提交 request terminal、不消费 activity，也不修改 runtime lifecycle。

## 验证关注点

- bootstrap `transportKind` contract 测试。
- SSE/WebSocket stream projection 等价测试。
- Activity SSE/WebSocket snapshot/delta 等价、单连接选择、bootstrap-to-live 不丢变化和 IR route 不暴露测试。
- Architecture negative test 证明 Activity 不进入 `StreamEnvelope` 或 `RuntimeSessionPort.streamEvents(...)`。
- 前端产品路径不读取 `VITE_TRANSPORT_KIND` 覆盖后端事实。
- transport close 不生成 terminal，auth failure 不进入 runtime command。
