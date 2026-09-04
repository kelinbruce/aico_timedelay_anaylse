# add-ts-session-affinity-reconnect-replay

规划入口：[P5 — 分布式与并行执行](../roadmap/p5-distributed-parallel.md)

状态：blocked
类型：implementation change
主要 owner：`agent-channel-web`
依赖：`add-ts-runtime-multi-instance-consistency` 归档；部署平台提供基于健康状态的 Session affinity 和故障后重新路由能力

目标：
- 客户端优先重连到当前活动 Session 所在实例时，继续获得该实例可用的实时事件和持久化历史。
- 客户端重连到非活动实例时，仍可读取本轮已经持久化的事件，并获得明确、一致的降级行为；下一轮对话恢复完整提交、控制和实时事件能力。

规格输入：
- Session affinity 是外部部署优化，不是系统正确性的来源；路由未命中不得破坏 persisted timeline/history truth。
- 非活动实例只能回放 StateStore 中已持久化且已授权的事件；尚未持久化的 `LIVE_ONLY` delta 可以缺失，不得伪造、补写或宣称无缝连续。
- 下一轮请求无论到达哪个健康实例，都必须按多实例一致性契约重新建立活动执行、取消、重试、抢占和实时事件能力。
- 所有 reconnect/history 查询继续校验可信 Agent Scope 和 Owner Scope。

契约输入：
- 优先复用既有 timeline sequence、replay request 和 SSE/WS transport contract；只有无法表达黑盒降级结果时才提出最小 contract refinement。
- Channel 只投影 persisted replay 与当前进程 live stream，不拥有 Session 活动实例、request lifecycle 或跨实例 subscriber registry。
- 若需要向客户端暴露降级信息，必须使用单一、安全、可验证的 public projection，不泄漏 instance identity、内部拓扑或高基数诊断信息。

实现约束：
- 负载均衡器、亲和 cookie/route rule、健康探测消费和故障转移策略均由部署平台负责，当前仓库不得提供其实现或控制 API。
- 仓内只实现 channel/runtime 已有端口上的 replay 与 live projection 组合，不新增跨实例 event bus、subscriber transfer 或第二套 canonical timeline。
- 测试通过显式连接实例 A 或实例 B 模拟亲和命中和未命中，不启动真实 LB 产品。

非目标：
- 不保证当前请求的 token 级 stream 在实例之间连续迁移。
- 不实现 `LIVE_ONLY` event 持久化、跨实例 pub/sub、subscriber registry 或 websocket session transfer。
- 不实现负载均衡、Session affinity 配置、服务发现或容器编排。
- 不负责实例故障后的任务恢复和副作用重放。

验收要点：
- 重连活动实例时，客户端按既有 sequence 先补齐持久化事件，再继续接收该实例 live event，不重复规范事件。
- 重连非活动实例时，只返回授权范围内的持久化事件；未持久化 delta 缺失不会导致 history sequence 损坏或虚假完成状态。
- 在非活动实例完成一次降级重连后发起下一轮请求，系统能够重新建立完整 request lifecycle、控制命令和实时投影。
- 测试证明 channel 不保存 request owner truth，且错误响应不暴露实例标识、内部地址或路由拓扑。

并行边界：
- 本 change 独占 `agent-channel-web` 的 reconnect/replay/live projection 组合和相关 Web contract refinement。
- 不得与同时重写 SSE/WS resume contract、timeline sequence 或 channel transport ownership 的 change 并行。
- 可与不修改 reconnect projection 的 failure takeover runtime 内部工作并行起草，但只有在多实例一致性归档后实施。
