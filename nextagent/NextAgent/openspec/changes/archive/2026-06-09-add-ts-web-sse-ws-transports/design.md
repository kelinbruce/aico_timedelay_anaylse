## 背景和现状（Context）

TS 后端的核心契约已经明确：runtime 拥有 request lifecycle 和 canonical timeline，Web channel 负责把 runtime timeline 投影给客户端。首版需要 WebSocket 与现有 SSE 具备一致的用户可见行为，但不需要建设完整 stream 平台。

实现约束：

- `agent-channel-web` 是主要改动 owner。
- Web channel 不新增执行事实、不持久化 RequestRun 状态、不创建私有 pending lifecycle。
- SSE/WS 的差异只允许出现在建连、framing、heartbeat、send、close。
- 事件选择、sequence 投影、terminal event vocabulary、payload redaction 和 safe projection failure 由 `add-ts-run-status-visibility` 的共享 projection service 统一拥有；本 change 只负责 transport subscription、delivery、close 和 cleanup。canonical replay 语义由 `RuntimeTimelinePort.stream(request)` 拥有。

## 当前代码基线和最小 Delta

当前分支已经具备 runtime timeline stream、SSE route 和前端 session-level `lastSeenSequence` cursor；前端代码也已经有 WebSocket transport 客户端路径。但后端 WebSocket stream adapter 仍不是稳定完成的同等实现，Web channel 的 projection 仍需要从 route-local 逻辑收敛为复用 `add-ts-run-status-visibility` 的 projection service。

实施顺序约束：本 change 的 SSE/WS adapter 改造必须在 `add-ts-run-status-visibility` 已提供共享 projection service 和 projection contract tests 之后接入。若该 service 尚未就绪，本 change 只能准备薄 delivery 流程或测试夹具，不能临时新增 transport-private event mapping、terminal 判断或 redaction 规则。

本 change 的最小增量是：

- 保留现有 SSE 行为作为兼容基线，但改为复用共享 delivery 流程和 projection service。
- 新增 WebSocket subscribe/send/close stream adapter，使其与 SSE 使用同一 `RuntimeTimelinePort.stream(request)`、同一 `lastSeenSequence`、同一 `StreamEnvelope` 输出和同一 safe failure 语义。
- 新增 Web runtime bootstrap config projection，使浏览器从 Web channel 获取 `transportKind: "SSE" | "WEBSOCKET"` 后再选择 stream transport；构建期 `VITE_TRANSPORT_KIND` 只能服务 dev/mock fallback，不能作为产品路径事实源。
- 明确 request/run-scoped stream 在匹配 terminal 后关闭，session-scoped stream 在单个 run terminal 后继续订阅。
- 补齐 disconnect、WS close、transport timeout 和 server shutdown 的 subscription cleanup，保证 cleanup 不产生 runtime terminal fact。

验证入口是 SSE/WS equivalence tests、subscription-scope terminal tests、subscription cleanup tests 和 WebSocket boundary tests：必须证明 WebSocket adapter 不实现 cancel、retry、pending input answer 或任何 lifecycle-changing command。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 让同一 RequestRun 经 SSE 和 WebSocket 消费时，用户可见事件序列、terminal event、replay 和 safe failure 语义等价。
- 定义一套复用共享 projection service 的 Web stream delivery 流程，SSE/WS 只负责 transport delivery 差异。
- 定义 Web stream transport selection 的 backend bootstrap projection，使产品路径浏览器从可信 Web channel 配置获取 `transportKind`。
- 明确 Web stream 的输入前置条件、owner scope 校验、replay 起点、timeline 投影、terminal 完成和失败输出。
- 用少量关键测试锁住等价性和边界。

**非目标：**

- 不修改 runtime lifecycle、RequestRun state machine、terminal commit 或 canonical timeline vocabulary。
- 不实现新的业务事件类型、模型输出策略、能力执行语义或 pending input 生命周期。
- 不提供跨实例 stream fan-out、外部消息总线、分布式 WebSocket 网关或非粘性路由。
- 不提供独立 stream 状态存储、完整 delivery audit、artifact download、session retention、自动 output continuation 或跨会话 memory 能力。
- 不通过 HTML runtime config script、客户端 query/body/localStorage、模型输出或 capability result 注入 transport selection。
- 不把 transport diagnostic 写成 canonical timeline event。

## 设计决策（Decisions）

### 第一性原理

同一个 RequestRun 只有一条事实来源：runtime canonical timeline。SSE 和 WebSocket 的黑盒效果必须一致。Transport 只能改变数据如何到达客户端，不能改变系统认为发生了什么。

业务边界：

- Web channel：认证/授权、SSE/WS 连接、timeline projection、safe transport error、必要 observability。
- Runtime：RequestRun 接受、调度、取消、latest-request、timeline 发布、terminal commit。
- Session/gateway：owner-scoped timeline/history 读取。

黑盒效果：

- 用户提交请求后，SSE 或 WebSocket 都能看到同一批 stream-visible events 和唯一终态事件；terminal event 结束对应 RequestRun，不结束未过滤的 session-scoped live stream。
- 用户断线后用 `lastSeenSequence` 恢复；Web channel 将其传入 `RuntimeTimelineStreamRequest`，runtime 返回可恢复事件和后续 live events。
- 未授权、run 不存在、replay anchor 非法、timeline 不可读、projection/serialization 失败时，返回 safe failure，不伪造成成功终态。

### 核心实现策略

当前核心实现策略是在 Web channel 内使用同一套 delivery 流程，并复用 status visibility change 提供的 projection service：

1. Web stream connect 或 WS subscription 接收 sessionId、requestId、可选 runId、transport kind 和 `lastSeenSequence`。
2. Web auth boundary 注入 trusted identity。
3. 投影流程校验 owner scope 和 request/run 可见性。
4. Delivery 流程构造 `RuntimeTimelineStreamRequest` 并消费 `RuntimeTimelinePort.stream(request)` 返回的 canonical timeline events。
5. Delivery 流程按 runtime 返回顺序把 recoverable events 和 live events 交给共享 projection service，得到 `StreamEnvelope` 或 safe projection failure。
6. Payload channel-safe projection 和 redaction 由共享 projection service 承担；transport 只负责序列化、发送和 safe close。
7. SSE/WS adapter 发送 envelope、heartbeat 和 close signal。
8. 终态 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED` 发送并 flush 后，如果订阅带有 `requestId` 或 `runId` 过滤，则该 request/run-scoped stream 完成；如果订阅是未过滤的 session-scoped live stream，则继续保持订阅并等待同一 session 的后续 events。
9. client disconnect、WebSocket close、transport timeout 或 server shutdown 必须 abort/cleanup 对应 runtime timeline subscription；该 cleanup 只产生 safe transport diagnostic，不产生 runtime terminal fact。

放弃方案：

- 放弃 SSE/WS 各自实现 projection：会复制 terminal、safe error、redaction 和 sequence 判断。
- 放弃 Web channel 私有 stream state machine：会破坏 runtime owns lifecycle。
- 放弃把 transport disconnect 写入 timeline：断连是 delivery 事实，不是 request execution fact。
- 放弃前端构建期 transport 选择作为产品事实源：同一个打包产物必须能由 Web channel 的可信 bootstrap projection 决定使用 SSE 或 WebSocket，不能通过重新构建或客户端可篡改字段改变产品 transport。
- 放弃首版自动 fallback transport：deployment 通过 Web channel bootstrap 明确选择 transport，backend 不在单次连接内静默切换协议。

### Transport selection bootstrap projection

产品路径的 `transportKind` 事实源是 app composition 注入到 Web channel 的 runtime/bootstrap config。Web channel 只把 channel-safe config 投影给浏览器，至少包含 `transportKind: "SSE" | "WEBSOCKET"`。该 projection 不携带 owner scope、agent scope、credential、secret、stream cursor、RequestRun status 或 deployment-private 配置。

前端启动流程固定为：

1. 浏览器加载同一个前端 artifact。
2. 前端调用 Web channel runtime/bootstrap config endpoint。
3. 前端用 runtime schema 校验 `transportKind`，只接受 `SSE` 或 `WEBSOCKET`。
4. 前端用 bootstrap 结果选择 SSE 或 WebSocket stream transport。
5. 前端继续用 session-scoped `lastSeenSequence` 作为 replay anchor；transport selection 不改变 `RuntimeTimelinePort.stream(request)`、terminal event、history refresh 或 session-scoped stream 语义。

服务端缺失、非法或不可安全投影 `transportKind` 时，产品路径必须 safe fail 并给出 channel-safe diagnostic；dev/mock profile 必须显式声明 `SSE` fallback 后才能使用该 fallback，且该 fallback 不能进入 release/product evidence。客户端 query、request body、localStorage、HTML script 注入、模型输出、capability input/result 或 user metadata 都不得覆盖 bootstrap projection。

### 核心判断逻辑

Web stream projection 使用固定规则顺序：

1. 验证 transport request schema；非法输入返回 safe validation error。
2. 使用 trusted identity，忽略 payload 中任何 owner/tenant/subject 字段。
3. 校验 session/request/run owner scope 和可见性；失败返回 safe authorization/not-found error。
4. 校验 `lastSeenSequence` 是非负 safe integer，并构造 `RuntimeTimelineStreamRequest`。
5. 消费 `RuntimeTimelinePort.stream(request)` 返回的 canonical timeline events，按 session-scoped sequence 单调递增投影。
6. 当 runtime replay 从最近可恢复事件继续，或 delta/sequence continuity 不足以恢复展示时，Web channel 输出 projection service 定义的 safe outcome，触发 history refresh，而不是自行重建状态。
7. timeline-only event、stream-visible event vocabulary 和 payload redaction 由 projection service 决定；transport 不维护私有映射表。
8. 写入 transport；projection/serialization 失败时输出 safe failure 或 safe close reason。
9. 发送 terminal event 后，request/run-scoped stream 完成；未过滤的 session-scoped stream 不因单个 terminal event 完成，且 terminal 后不得继续发送同一个 RequestRun 的业务事件。
10. 连接结束、WS close、transport timeout 或 server shutdown 时清理 runtime timeline subscription；清理不得合成 terminal 或改变 RequestRun status。

### 状态 / 产物契约

- `StreamEnvelope`：用户可见 wire DTO，是 timeline/status 的安全投影；不替代 canonical timeline，不作为 durable execution fact。
- `timelineEventRef`：指向来源 timeline event id；不授权客户端读取 raw timeline payload。
- `sequence`：用户可见 stream 顺序和 replay 锚点。
- `SafeError`：失败可见输出；不包含 cause、stack、secret、raw provider error、raw tool/model input 或未授权对象内容。
- Transport diagnostic：只进安全日志或 metric，不进入 RequestRun 状态。

## KISS 收敛

首版实现应以最小闭环为准：

| 范围 | 首版处理 |
|---|---|
| Projection | 复用 status visibility 的共享 projection service |
| SSE | 使用投影流程，保持薄 adapter |
| WebSocket | subscribe/send/close 使用共享 delivery 流程并复用 projection service；不定义 cancel/answer 等 lifecycle-changing command |
| Replay | 只转发 `lastSeenSequence` 给 `RuntimeTimelinePort.stream(request)`，不拥有 canonical replay 语义 |
| Terminal close | request/run-scoped stream 在对应 terminal 后关闭；session-scoped live stream 继续保持订阅 |
| Cleanup | disconnect、WS close、transport timeout、server shutdown 清理 runtime timeline subscription |
| Failure | 覆盖 validation、authorization/not-found、invalid replay、timeline read、projection/serialization |
| Observability | 必要安全日志或 metric，不做完整 delivery audit |
| Tests | 投影单元、SSE/WS equivalence、owner scope、replay、terminal、safe failure |

明确延后：

- 跨实例 fan-out、非粘性路由、外部消息总线。
- 完整 throughput/backpressure 优化和复杂 per-connection buffer 策略。
- 独立 stream 状态存储或长期 delivery audit。
- 大规模文档矩阵；只提升与行为契约和模块边界直接相关的长期文档。

## 风险与取舍（Risks / Trade-offs）

- [Replay 语义被 channel 私有化] -> delivery 流程只消费 `RuntimeTimelinePort.stream(request)`，gap/delta 不可恢复时输出 safe outcome 触发 history refresh。
- [Projection ownership 被 transport 重复实现] -> 本 change 只接入 `add-ts-run-status-visibility` 的 projection service，不新增 transport-private mapping/redaction。
- [WS 双向能力诱导业务控制下沉到 channel] -> 本 change 只实现 stream subscribe/send/close，不定义 cancel/answer 等 lifecycle-changing message。
- [Transport diagnostic 被误认为执行事实] -> diagnostic 只进安全日志或 metric，不进入 timeline。
- [实现范围膨胀] -> 首版任务只接受一个 投影流程、两个薄 adapter 和关键等价测试。

## 归档前基线提升计划（Baseline Promotion Plan）

- 提升 `ts-web-sse-ws-transports` 行为契约。
- 按需更新 Web stream transport architecture 和 `agent-channel-web` 模块边界文档。
- 只有当实现过程中确有替代方案争议时，新增 ADR。

## 待确认问题（Open Questions）

无。首版只要求本地单实例 Web stream 等价；跨实例 WebSocket fan-out 和非粘性 stream delivery 后置。
