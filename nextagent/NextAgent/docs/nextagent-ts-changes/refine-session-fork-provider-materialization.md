# refine-session-fork-provider-materialization

规划入口：[P5 — 分布式与并行执行](../roadmap/p5-distributed-parallel.md)

状态：ready
类型：contract refinement change
主要 owner：`agent-contracts/gateway`、`agent-platform-gateway-local`
依赖：当前`WorkingMemoryGatewayBindings`、既有会话派生实现与promotion persistence；2026-08-21需求方确认本change先于`refine-ts-agent-gateway-state-store-boundary`实施，并批准本文列出的`agent-contracts` breaking变化

目标：
- 会话派生跨LOCAL/REMOTE边界只传可信source坐标、有界required refs和对应受预算bytes，不传完整消息前缀或预构造child facts。
- 在当前`WorkingMemoryGatewayBindings.sessionForks`新增`prepareFork`与provider-owned `forkSession`，调整既有promotion stage/abort，并保持LOCAL与外部REMOTE使用同一contract。
- NextAgent Runtime只解析prepare清单内的规范化tool-result内容；LOCAL SQLite在provider内读取完整源事实并原子创建child。
- 外部REMOTE WorkingMemory基于其现有gateway在仓外完成增量实现；本仓不实现REMOTE服务端或vendor transport。

规格输入：
- 消息入口和请求入口分别使用`sourceMessageId`与`sourceRequestId`，每次请求恰好提供一个。
- `prepareFork`只预检并返回opaque attempt、有界required refs和bytes上限，不创建可见child。
- `forkSession`重新读取和校验完整源事实、matching staged refs、active context和process snapshots，并原子创建全部child facts。
- 完整前缀、安全投影、child-owned identity、promotion可见性、幂等重放、取消和安全失败语义保持一致。

契约输入：
- 新增`ForkAttemptId`、`PrepareForkRequest/Result`、`ForkRequiredContentRef`、`StageForkPromotionResult`和`ForkSessionRequest/Result`。
- `SessionForkStoreGateway`最终公开`prepareFork`、`stageForkPromotion`、`forkSession`、`abortForkPromotions`及五个既有读取/维护members，全部接受optional `AbortSignal`。
- 删除public prefix query、成功幂等预查、预构造composite write和批量process-status operations；provider可把所需能力保留为private primitives。
- `RuntimeSessionPort.forkFromMessage`与`forkFromRequest`保持既有command/result，仅增加optional `AbortSignal`。

实现约束：
- 当前change直接使用`GatewayBindings.workingMemory`、`WorkingMemoryGatewayBindings`与`adapterKind: "working-memory"`，不得提前实施StateStore重命名或能力组重组。
- LOCAL provider在现有package内增加private application service，复用SQLite primitives与Context Engine selector；raw SQLite core不拥有fork业务策略。
- 本仓不新增REMOTE WorkingMemory服务端实现、AgentMemory HTTP endpoint、vendor DTO、credential或transport adapter。
- 后续`refine-ts-agent-gateway-state-store-boundary`必须在本change归档后rebase，并无损迁移最终fork contract、LOCAL实现和conformance资产。

非目标：
- 不改变Web route/request/success、页面按钮条件、标题、fork notice或普通request lifecycle。
- 不复制或重新绑定attachment row/blob，不新增generic host-file read或任意路径上传。
- 不提供LOCAL/REMOTE两套fork contract、双写、fallback或第二个最终确认操作。
- 不在本change重命名`workingMemory`为`stateStore`。

验收要点：
- LOCAL完整覆盖message/request anchors、空ref/多ref、预算、安全投影、process snapshots、active context、atomic failure、并发幂等、取消和response loss。
- Runtime不读取完整prefix、不生成child ids、不按deployment mode分支。
- 外部REMOTE可直接复用同一provider-neutral conformance runner与fixtures。
- public prepare/fork payload大小不随源消息或事件数量增长，stage bytes不超过provider预算。
- 后端、contract、architecture、frontend相关门禁和OpenSpec strict validation通过。

并行边界：
- 本change实施期间独占`SessionForkStoreGateway`、fork promotion contract、Runtime fork orchestration和LOCAL fork persistence路径。
- `refine-ts-agent-gateway-state-store-boundary`暂停实施，待本change归档后rebase；不得并行修改相同binding、conformance和Requirement合并键。
- 外部REMOTE团队只在其仓内实现公开contract，不向本仓提交REMOTE服务端逻辑。
