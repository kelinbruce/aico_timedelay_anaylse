## 0. 当前分支导入预检

- [x] 0.1 对比 `origin/codex/ts-web-channel` 的 SSE/WS transport 实现和当前分支 Web channel/stream projection 代码，列出可直接复用、需要重做、需要丢弃的实现点。
  验证：code review 检查点，重点确认远程实现是否仍符合当前 `RuntimeTimelinePort.stream(request)`、session-scoped sequence 和 frontend session cursor 语义。
  来源：proposal `与当前基线和相邻 change 的边界`。
- [x] 0.2 确认本 change 只 owning transport subscription/framing/heartbeat/close/replay anchor validation 和 SSE/WS equivalence，不定义 lifecycle-changing WebSocket command。
  验证：architecture review 检查点，配合后续 WebSocket boundary tests。
  来源：design 非目标；proposal 边界说明。
- [x] 0.3 确认 `add-ts-run-status-visibility` 的共享 projection service 和 projection contract tests 已可接入后，再实现 SSE/WS adapter 输出；若尚未就绪，不得新增 transport-private event mapping、terminal 判断或 redaction 规则。
  验证：apply-order review 检查点，后续 delivery/projection tests 断言 SSE/WS 均消费同一 projection service。
  来源：design 当前代码基线和实施顺序约束。

## 1. Projection Service 接入和 Stream Delivery

- [x] 1.1 在 `agent-channel-web` 中建立共享 Web stream delivery 流程，输入 trusted identity、request coordinates、transport kind、可选 `lastSeenSequence`、`RuntimeTimelinePort.stream(request)` 和 status visibility projection service，并输出 `StreamEnvelope` 或 SafeError。
- [x] 1.2 实现 owner-scope 和 request/run visibility 校验，确保 client payload 中的 tenant、subject、owner 字段不能覆盖 trusted identity。
- [x] 1.3 校验 `lastSeenSequence` 为非负 safe integer，并构造 `RuntimeTimelineStreamRequest`；invalid anchor 返回 safe validation failure。
- [x] 1.4 消费 `RuntimeTimelinePort.stream(request)` 返回的 recoverable events 和 live events，保证输出 envelope 的 sequence 单调递增，并在 gap/delta 不可恢复时输出 safe outcome 触发 history refresh。
- [x] 1.5 接入 `add-ts-run-status-visibility` owning 的 timeline-to-`StreamEnvelope` projection service；本 change 不新增 transport-private `StreamEventType` 映射表。
- [x] 1.6 对 projection service 输出的 envelope/SafeError 执行 transport serialization、safe close 和 delivery failure handling；payload projection/redaction 规则由 status visibility change owning。

## 2. 薄 Transport Adapter

- [x] 2.1 让 SSE delivery 使用共享 delivery 流程并复用 projection service；SSE adapter 只负责 HTTP/SSE framing、heartbeat、flush、close。
- [x] 2.2 接入 WebSocket subscribe/send/close delivery，并复用同一 delivery 流程和 projection service；WS adapter 不实现独立 lifecycle 判断。
- [x] 2.3 确认 WebSocket stream adapter 不定义 cancel、pending input answer 等 lifecycle-changing message，也不直接修改 RequestRun 或 pending state。
- [x] 2.4 实现 terminal delivery：request/run-scoped stream 发送匹配 terminal event 后 flush 并完成/关闭；未过滤的 session-scoped stream 发送 terminal event 后继续保持订阅。
- [x] 2.5 实现 subscription cleanup：client disconnect、WebSocket close、transport timeout 或 server shutdown 必须 abort/cleanup runtime timeline subscription，且不合成 terminal event。

## 3. 最小诊断

- [x] 3.1 为 stream open、close/disconnect、replay failure、timeline read failure、projection/serialization failure 添加必要安全日志或 metric。
- [x] 3.2 确保 transport diagnostics 不进入 canonical timeline，不改变 RequestRun status，也不伪造 terminal result。
- [x] 3.3 验证 SafeError、transport close reason 和 diagnostics 不包含 raw prompt、raw model output、raw tool args/result、secret、credential、local path 或未授权对象内容。

## 4. 验证

- [x] 4.1 添加 delivery/projection integration 单元测试，覆盖 owner scope、`lastSeenSequence` 映射、projection service 复用、timeline-only filtering、terminal completion 和 projection failure。
- [x] 4.2 添加 SSE/WS equivalence tests，使用同一 golden canonical timeline 验证两个 transport 输出等价。
- [x] 4.2a 添加 subscription-scope terminal tests，断言 request/run-scoped stream 在匹配 terminal 后关闭，session-scoped stream 在单个 run terminal 后继续接收同一 session 后续 events。
  验证：Web channel stream tests 覆盖 SSE 和 WebSocket 两种 transport。
  来源：`Timeline 消费和 Projection Service 复用`；design subscription scope 决策。
- [x] 4.2b 添加 subscription cleanup tests，断言 SSE disconnect、WS close、transport timeout 和 server shutdown 会清理 runtime timeline subscription，且不会伪造 terminal 或改变 RequestRun status。
  验证：Web channel stream tests 覆盖 abort/cleanup hook 和 safe diagnostic。
  来源：`Timeline 消费和 Projection Service 复用`；design cleanup 决策。
- [x] 4.3 添加 WebSocket boundary tests，验证 stream adapter 只处理 subscribe/send/close，不实现 lifecycle-changing command 私有处理。
- [x] 4.4 添加 safe failure tests，覆盖 unauthorized/not-found、invalid replay anchor、timeline read failure、serialization failure。
- [x] 4.5 添加 architecture boundary test，验证 `agent-channel-web` 不依赖 runtime private state、不定义私有 RequestRun lifecycle。
- [x] 4.6 运行 OpenSpec strict validate 和相关 Web channel 测试，并清理实现产生的临时 fixture 或未使用 export。

## 5. Bootstrap Transport Selection 补充任务

- [x] 5.1 在 `agent-channel-web` 增加 runtime/bootstrap config projection contract，至少安全投影 `transportKind: "SSE" | "WEBSOCKET"`，且不暴露 owner scope、agent scope、credential、secret、stream cursor、RequestRun status 或 deployment-private config。
  验证：bootstrap projection schema/route tests 覆盖合法 `SSE`、合法 `WEBSOCKET` 和非法配置 safe failure。
  来源：Requirement: Web Runtime Bootstrap Transport Selection。
- [x] 5.2 在前端 runtime config 流程中改为产品路径优先消费后端 bootstrap `transportKind`，`VITE_TRANSPORT_KIND` 只作为显式 dev/mock fallback。
  验证：frontend runtime config tests 覆盖 bootstrap 优先级、dev/mock fallback 和非法值 safe fail。
  来源：Requirement: Web Runtime Bootstrap Transport Selection。
- [x] 5.3 增加 negative tests，断言 query string、request body、localStorage、HTML runtime config script、user metadata、模型输出或 capability result 均不能覆盖后端 bootstrap `transportKind`。
  验证：frontend/channel boundary tests 覆盖客户端覆盖失败，architecture test 继续断言 `index.html` 不注入 runtime config script。
  来源：Requirement: Web Runtime Bootstrap Transport Selection。
- [x] 5.4 增加 stream integration smoke，分别用 backend-projected `SSE` 和 `WEBSOCKET` 打开 session-scoped stream，证明 transport selection 不改变 `lastSeenSequence` replay、terminal event 或 session-scoped stream 持续订阅语义。
  验证：Web stream integration tests 使用同一 canonical timeline 比较 SSE/WS 输出。
  来源：Requirement: Web Runtime Bootstrap Transport Selection；Requirement: 等价 Web Stream Transport。

## 归档前基线提升检查（非实施任务）

实现完成并验证通过后，只提升必要长期文档：

- 将 `ts-web-sse-ws-transports` 行为契约提升到 `openspec/specs/ts-web-sse-ws-transports/spec.md`。
- 按需更新 Web stream transport architecture 和 `agent-channel-web` 模块边界文档。
- 确认长期文档没有重复定义 runtime lifecycle、RequestRun 状态机或 adapter-private state。
- 只有当实现过程中确有替代方案争议时，新增 ADR。
