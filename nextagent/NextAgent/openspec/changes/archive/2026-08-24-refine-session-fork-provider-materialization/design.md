## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| FN-1.11 从消息派生子会话 | 先取得有界 ref 准备清单，由 NextAgent 完成清单内 promotion，再由 selected Working Memory provider 按完整前缀语义原子返回 child | session-fork-from-message、ts-core-contracts | FN-1.11 从消息派生子会话 |
| FN-8.1 持久化运行数据 | Working Memory provider 从接收 Runtime 预构造 composite write 调整为 provider-owned prepare 与最终 fork application transaction | gateway-store-provider-ownership | FN-8.1 持久化运行数据 |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 原子 delta | 其他行为与未触及 Requirements 处理 | 白盒落点 |
|---|---|---|---|---|
| ts-core-contracts / Session Fork Public Contracts | FN-1.11 / session-fork-from-message | REMOVED + ADDED 会话派生 Runtime facade 保持可信窄入口、ADDED 会话派生 gateway 公开准备与原子创建入口、ADDED 会话派生失败使用唯一安全错误契约、MODIFIED Fork From Durable Visible Assistant Message | Runtime facade、Web command/result 与 trusted scope 保持；request anchor 由 prepare/fork 统一解析；增加 optional signal | 契约与 Runtime 调用链 |
| ts-core-contracts / Fork Source Metadata Contract | FN-1.11 / session-fork-from-message | REMOVED + ADDED 会话派生来源元数据保持窄化 | Fork Notice Projection 原位保留 | LOCAL provider application transaction |
| ts-core-contracts / Safe Child Message Projection | FN-1.11 / session-fork-from-message | REMOVED + MODIFIED Child Session Inherits Prefix And Model-Visible Context、MODIFIED Fork Failure Is Atomic And Safe | child-accessible durable refs 保留；规范化工具结果 ref 继续通过可信 resolver promotion，其他 execution-bound refs fail closed | ref 准备、暂存与投影 |
| ts-core-contracts / Fork Promotion Staging Contract | FN-1.11 / session-fork-from-message | REMOVED + ADDED 会话派生 gateway 公开准备与原子创建入口、MODIFIED Fork Failure Is Atomic And Safe | stage/abort/read/cleanup 保留；stage 绑定 prepare 返回的 attempt 与 source ref，最终 commit 只由 forkSession 完成 | ref 准备、暂存与投影 |
| ts-core-contracts / Fork Prefix Query Contract | FN-1.11 / session-fork-from-message | REMOVED + ADDED 会话派生跨 provider 边界使用有界协调材料、MODIFIED Child Session Inherits Prefix And Model-Visible Context、MODIFIED Fork Failure Is Atomic And Safe | 完整 prefix 与容量预算保留；public prefix query 转 provider-private | provider 内部执行顺序 |
| ts-core-contracts / Fork Composite Gateway Write | FN-1.11 / session-fork-from-message | REMOVED + ADDED 会话派生 gateway 公开准备与原子创建入口、MODIFIED Fork Idempotency、MODIFIED Fork Failure Is Atomic And Safe、MODIFIED Fork atomically materializes child-owned process history | 原子事务、promotion commit、成功幂等锚点和 replay 保留；预构造 write 转 provider-private | provider 内部执行顺序 |
| ts-core-contracts / Child Active Context Initialization Contract | FN-1.11 / session-fork-from-message | REMOVED + MODIFIED Child Session Inherits Prefix And Model-Visible Context、MODIFIED Fork Failure Is Atomic And Safe | normal append/compaction 与 prior-history selection 不变；selector port 保留 | LOCAL provider application transaction |

本 change 直接基于当前`WorkingMemoryGatewayBindings`、`adapterKind: "working-memory"`、LOCAL SQLite和外部REMOTE binding注入模式实施。后续`refine-ts-agent-gateway-state-store-boundary`必须在本change归档后rebase，并迁移本change形成的最终`sessionForks`contract、LOCAL实现和conformance资产。本change的agent-contracts升级由本次用户实施指令确认，roadmap记录随本change更新。`fix-agent-web-fork-inherited-retry-edit-disable`的`metadata.forkInherited=true`行为必须保留。

## FN-1.11 从消息派生子会话

### 目标与规范依据

本 Function 保持完整 canonical prefix、child-owned identity、模型可见上下文、过程快照、execution-bound tool-result promotion、原子性和幂等性。跨 provider 不再传递完整 prefix；Working Memory provider 返回有界 ref 清单，NextAgent 只读取并暂存清单中的可信内容，最终仍由该provider原子创建 child。

#### 本 Function 的目标 Requirements

canonical spec：session-fork-from-message

- ADDED：会话派生 gateway 公开准备与原子创建入口
- ADDED：会话派生 Runtime facade 保持可信窄入口
- ADDED：会话派生失败使用唯一安全错误契约
- ADDED：会话派生跨 provider 边界使用有界协调材料
- ADDED：LOCAL 与 REMOTE 会话派生保持契约一致
- ADDED：会话派生来源元数据保持窄化
- MODIFIED：Fork From Durable Visible Assistant Message
- MODIFIED：Child Session Inherits Prefix And Model-Visible Context
- MODIFIED：Fork Idempotency
- MODIFIED：Fork Failure Is Atomic And Safe
- MODIFIED：Fork atomically materializes child-owned process history

### 当前实现

- SessionForkStoreGateway 公开 prefix query、成功幂等预查、预构造 composite write、批量 process status、promotion stage/abort 及创建后读取/维护方法。
- Runtime 拥有 request anchor 解析、prefix 读取、预算、ID remap、safe projection、timeline snapshot、execution-bound promotion、active-context selection、composite write 和失败 abort。
- LOCAL SqliteSessionForkStore 是 SqliteGatewayCore 薄转发；prefix SQL、promotion lifecycle、idempotency lookup 和最终 composite transaction 已存在。
- ForkPromotionContentResolverPort 可从 NextAgent trusted execution workspace 解析 tool-results/<refId>；REMOTE WorkingMemory 不具备该访问能力。
- 页面 fork 按钮只判断 assistant anchor 与回答内容，不检查附件或 ref。带附件的 history 可以派生并展示，但 attachment records 不会重绑为 child-owned，继承后的 retry/edit 仍执行既有 attachment authority revalidation。
- 当前默认预算为 copied messages 500 条、copied content 2,000,000 bytes、promotion refs 8 个、promoted content 2,000,000 bytes、timeline events 10,000 条、timeline serialized content 4,000,000 bytes。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| gateway payload 不随历史增长 | Runtime 取得完整 prefix 并构造完整 write | prefix 与 child plan 留在 provider 内；只返回有界 ref 清单并传输对应受预算约束的 bytes |
| REMOTE 不直接访问 NextAgent workspace | 当前 Runtime 可通过可信 resolver 读取 source execution content | NextAgent 按 prepare 清单解析并 stage，REMOTE 只接收 bytes |
| message/request anchor 使用同一 contract | Runtime 先解析 request anchor | 统一 request 使用两个独立 optional 字段 |
| LOCAL/REMOTE 同行为 | 当前 promotion 与最终 copied facts 由 Runtime 一次性组装 | 两端实现同一 prepare/stage/fork 生命周期 |
| raw persistence 不拥有领域策略 | 当前策略在 Runtime | 增加 provider application layer，SQLite core 保持 raw |

### 修改方案

#### 契约与 Runtime 调用链

agent-contracts/gateway 新增 gateway-owned branded scalar ForkAttemptId，以及 PrepareForkRequest、PrepareForkResult、ForkRequiredContentRef、StageForkPromotionResult、ForkSessionRequest 和 ForkSessionResult。PrepareForkRequest 与 ForkSessionRequest 都继承 OwnerScoped，包含 required agentId、sourceSessionId、idempotencyKey，optional non-null sourceMessageId 与 sourceRequestId，且恰好提供一个 anchor 字段。PrepareForkResult 包含 opaque forkAttemptId、受 provider promotion-ref 数量上限约束且顺序确定的 requiredContentRefs 和 maxPromotedBytes；每个 ForkRequiredContentRef 只包含可信 resolver 所需的 source message/request/run、agentVersion、refType 与 normalized refId。ForkSessionRequest 额外携带同一 forkAttemptId。StageForkPromotionResult只返回attempt/source ref receipt与promotedContentId，不返回BlobRef。ForkSessionResult 为 success-only，只包含 childSession: SessionRecord 与 replayed: boolean。

SessionForkStoreGateway 的最终 public members 精确为：

1. prepareFork(request, signal?)
2. stageForkPromotion(request, signal?)
3. forkSession(request, signal?)
4. abortForkPromotions(request, signal?)
5. loadSessionForkSource(request, signal?)
6. loadForkProcessSnapshotStatus(request, signal?)
7. hasUserMessageAfterForkAnchor(request, signal?)
8. loadCommittedForkPromotionContent(request, signal?)
9. cleanupExpiredForkPromotions(request, signal?)

移除 public listSessionMessagePrefixThroughAnchor、loadForkedSessionByIdempotency、forkSessionFromMessage 和 listForkProcessSnapshotStatuses。删除或私有化 ListSessionMessagePrefixThroughAnchorQuery、LoadForkedSessionByIdempotencyRequest、ForkSessionFromMessageWriteRequest、ForkSessionFromMessageWriteResult、ListForkProcessSnapshotStatusesRequest 和 ForkRunTimelineEventSnapshotDraft。

继续公开并按 prepare 生命周期调整的既有 promotion 类型为 ForkPromotionRefType、StageForkPromotionRequest和ForkPromotionAbortRequest；新增StageForkPromotionResult。StageForkPromotionRequest不再接收caller预构造的child session/message ids，改为携带forkAttemptId、sourceSessionId、sourceMessageId、sourceRefId、refType、bytes、MIME type与size；result只返回attempt/source ref receipt与provider生成的promotedContentId。ForkPromotionAbortRequest只携带trusted scope、agentId与ForkAttemptId。ForkPromotionStatus与ForkPromotedContentRecord转为provider-private persistence types。SessionForkSourceRecord/LoadSessionForkSourceRequest、ForkProcessSnapshotStatusRecord/LoadForkProcessSnapshotStatusRequest、HasUserMessageAfterForkAnchorRequest、ForkPromotionContent/LoadCommittedForkPromotionContentRequest以及ForkPromotionCleanupRequest/ForkPromotionCleanupResult继续服务创建后读取和维护。

RuntimeSessionPort.forkFromMessage(command, signal?) 与 forkFromRequest(command, signal?) 保持现有 command/result 和 Web API。Runtime require source session 并取得 persisted Agent Scope 后，分别只设置 sourceMessageId 或 sourceRequestId，先调用 selected sessionForks.prepareFork。它按 requiredContentRefs 顺序通过既有 ForkPromotionContentResolverPort 读取规范化 tool-result bytes，并调用同一 store 的 stageForkPromotion；全部准备成功后使用同一 source 坐标、idempotencyKey 与 forkAttemptId 调用 forkSession。Runtime 不读取 prefix、不解析 request anchor、不生成 child ids、不调用 selector、不按 deployment mode 分支。

ForkActiveContextSelectionPort 保留在 context subpath，并由 LOCAL provider 通过 private composition 复用。ForkPromotionContentResolutionRequest、ForkPromotionContentResolutionResult 和 ForkPromotionContentResolverPort 继续归 runtime/context 既有边界；prepare result 提供 resolver 所需的可信 source 坐标和 bytes 上限，REMOTE WorkingMemory 不实现或调用该 resolver。

#### provider 共同实现边界

`WorkingMemoryGatewayBindings.sessionForks: SessionForkStoreGateway`是NextAgent与selected Working Memory provider之间唯一的会话派生边界。REMOTE AgentMemory与LOCAL SQLite接收相同DTO、使用相同字段校验和错误目录；差异只存在于provider-private查询、内容存储和原子提交技术。公开contract不暴露SQL、远端endpoint、对象存储key、`BlobRef`、provider credential或内部事务token。

provider application 必须能够在可信 `OwnerScoped + agentId` 下完成以下内部能力：

- 按 `sourceSessionId` 读取唯一 source session，并读取截至最终 assistant message anchor 的完整 canonical durable message prefix。
- 按 request id 查询 durable assistant candidates，并结合 request/run terminal facts唯一解析最终 message anchor。
- 读取 source request/run、active context、timeline event、process status、fork source和成功幂等锚点。
- 生成 child session/message/request/run/event ids，并执行既有 safe message projection、process snapshot remap与active-context selection语义。
- 暂存不可见 content，并在一个 provider-local 原子提交边界内写入全部 child facts、提交 matching promotions和成功幂等锚点。

REMOTE AgentMemory 如果缺少其中任一事实读取或原子写入能力，就不是该 contract 的完整实现；不得通过让 NextAgent 回传完整 prefix、预构造 child records或回退 LOCAL SQLite 补齐。

#### provider-private promotion 状态

REMOTE 与 LOCAL 使用相同的逻辑 staging record；物理表、document或object-store metadata名称可以不同，但每条 record 至少保存以下私有字段：

| 私有字段 | 来源与用途 |
|---|---|
| owner scope、`agentId` | 来自可信 gateway 调用上下文，用于所有查询、唯一键和写入隔离 |
| `forkAttemptId`、`sourceSessionId`、`sourceMessageId`、normalized `sourceRefId`、`refType` | 来自已校验 stage request，用于把 bytes 绑定到 prepare/fork 的 source 坐标 |
| provider-generated `promotedContentId` | 在首次成功 stage 时生成，作为 child message中的 durable ref |
| private content locator | 指向 provider 已持久化的 bytes；不得进入 public DTO、SafeError、日志或 trace |
| SHA-256 content digest、`mimeType`、`sizeBytes` | digest用于快速拒绝不一致内容；digest一致时仍读取bytes做逐字节比较，`sizeBytes`用于预算累计 |
| `status`、`createdAt`、optional `committedAt`、optional `abortedAt` | 支持 `STAGED → COMMITTED` 或 `STAGED → ABORTED` 生命周期 |
| optional child session/message coordinates | 只在最终 fork transaction 内绑定；`STAGED` 时为空 |

stage 语义唯一键为 `owner scope + agentId + forkAttemptId + sourceMessageId + sourceRefId`。同一 `forkAttemptId` 下的全部 records还必须绑定同一个 `sourceSessionId`；发现跨 session复用时按attempt/source绑定不一致失败。成功幂等锚点继续使用 `owner scope + agentId + sourceSessionId + finalSourceAnchorMessageId + normalized idempotencyKey`，并指向首次创建的 child session。promotion stage 不创建或占用该成功锚点。

状态转换固定如下：

| 当前状态 | 操作与条件 | 结果 |
|---|---|---|
| 不存在 | 首次 `stageForkPromotion`且source ref、bytes和预算校验通过 | 写入bytes与`STAGED` metadata，返回新`promotedContentId` |
| `STAGED` | 相同语义键且digest、MIME type、size相同的stage retry | 不重复写bytes，返回首次`promotedContentId` |
| `STAGED` | 最终`forkSession`提交且该row属于精确required ref集合 | 在同一最终提交中绑定child坐标并转为`COMMITTED` |
| `STAGED` | `abortForkPromotions`或过期cleanup成功取得该row | 转为`ABORTED`，随后best-effort删除bytes |
| `ABORTED` | cleanup确认bytes已删除或不存在 | 删除private metadata row |
| `COMMITTED` | abort或cleanup | 保持不变；只能由committed content read读取 |

不允许`ABORTED → STAGED`、`ABORTED → COMMITTED`、`COMMITTED → ABORTED`或`COMMITTED → STAGED`。bytes先于metadata写入时，metadata写失败需要best-effort删除bytes；删除失败的无metadata orphan由provider自身内容存储维护策略收敛。只有`STAGED` metadata与bytes都持久化且可重新读取后，stage调用才可返回成功。

#### `prepareFork` 实现逻辑

新增 `prepareFork` 的 provider 侧逻辑按以下固定顺序实现：

1. 执行 strict request validation，normalize `idempotencyKey`，并确认`sourceMessageId`与`sourceRequestId`恰好一个；随后在dispatch前检查cancellation。
2. 使用可信 owner scope、`agentId`和`sourceSessionId`读取source session。未命中或scope不匹配时，不执行跨scope探测查询。
3. 解析最终 message anchor：message入口直接读取并校验指定message；request入口只在同一source session和request id下查找completed、durable、visible assistant candidates，零个或多个均失败。两个入口得到最终 message后使用完全相同的后续逻辑。
4. 校验最终message可见、role为assistant且回答内容非空。
5. 读取成功幂等锚点。锚点存在且child facts完整时，生成新的opaque `forkAttemptId`并返回空`requiredContentRefs`；锚点损坏时按幂等损坏失败。未命中时继续。
6. 校验最终message绑定的source run存在且terminal。
7. 使用最终message anchor查询从source session开头到该message的完整canonical prefix，排序键复用WorkingMemory message的既有canonical顺序。prefix为空、任一message scope损坏或message数量/content bytes超限时立即失败，不返回部分清单。
8. 按source message canonical顺序执行safe projection预检并扫描content与metadata。每次出现规范化`tool-results/<refId>`都计入promotion ref预算；输出前再按`sourceMessageId + normalized refId`去重，同一message内按normalized ref id升序。provider已持有且可证明对child安全的durable refs不进入清单；host/workspace path、traversal、unknown或无法证明安全的execution-bound ref直接失败。
9. 在相同可信scope读取prefix涉及的request/run、process status和timeline facts，执行完整性、event数量与serialized bytes预算预检。prepare不生成child ids，也不写child或成功幂等事实。
10. 使用provider id factory生成新的opaque `forkAttemptId`，返回去重后的清单和provider配置的`maxPromotedBytes`。production id factory使用至少128 bit随机性；conformance test可注入确定性id factory，但不得在同一scope内复用attempt id。

`prepareFork` 不保存prefix snapshot、ref manifest或单独的preparation record。`forkAttemptId`只作为不可见staging namespace；它不证明source facts未变化，也不替代最终成功幂等键。provider负责生成不可预测且在相同scope内不复用的attempt id。对于空required ref清单，最终调用不依赖任何staging row；对于非空清单，首次成功stage会把attempt与source session绑定，最终`forkSession`再从source事实重新推导清单完成权威校验。

#### `stageForkPromotion` 实现逻辑

修改后的 `stageForkPromotion` provider 侧逻辑按以下固定顺序实现：

1. strict校验request，确认`sizeBytes`等于实际byte length、MIME type合法、`sourceRefId`为规范化tool-result ref；随后在持久化前检查cancellation。provider-private locator不得进入public request/result或诊断面。
2. 使用可信scope读取`sourceSessionId`与`sourceMessageId`，确认message属于该session，并从其content或metadata中重新发现同一个normalized `sourceRefId`。不得仅相信prepare返回值或caller声明。
3. 查询同attempt的已有staging rows，确认它们都属于同一owner、agent和source session。以stage语义唯一键查询已有row；存在时先比较SHA-256 digest、MIME type和size，三者一致后再读取stored bytes逐字节比较；完全一致才返回首次receipt，否则返回promotion conflict。
4. 对尚未存在的ref，在同一并发控制边界内累计该attempt全部`STAGED` bytes并加入本次`sizeBytes`；超过provider的promoted-content bytes预算时不写入任何新事实。
5. 生成新的`promotedContentId`，持久化bytes，再原子写入或以唯一约束竞争写入`STAGED` metadata。并发写入由唯一键选出一个winner；loser按第3步比较后返回相同receipt或conflict。
6. 返回只含attempt/source ref坐标和`promotedContentId`的`StageForkPromotionResult`。此时`loadCommittedForkPromotionContent`仍不得读取该content。

stage不接收`idempotencyKey`或最终anchor，因此不负责判断某次fork是否已经成功。若并发fork已经成功，后续`forkSession`会返回首次child，Runtime再best-effort abort当前attempt的residue。

#### `forkSession` 实现逻辑

新增 `forkSession` 的 provider 侧逻辑按以下固定顺序实现：

1. strict校验request，normalize幂等键，确认两个anchor字段恰好一个并校验`forkAttemptId` shape；随后在dispatch前检查cancellation。
2. 按`prepareFork`第2至第4步重新读取source session并重新解析最终message anchor。request入口必须再次得到同一个唯一completed assistant message；不得把prepare阶段结果当作可信anchor cache。
3. 按最终message anchor读取成功幂等锚点。存在时校验其child session、fork source和必要child facts完整，然后直接返回首次`childSession`与`replayed=true`；不得提交当前attempt的staged content。不存在时继续。
4. 校验最终message绑定的source run存在且terminal；随后按`prepareFork`第7至第8步重新读取完整prefix并重新执行prefix预算、安全投影与ref分类。重新推导的去重required ref集合是最终权威集合。
5. 读取同scope、同source session和同`forkAttemptId`的全部`STAGED` rows，以`sourceMessageId + sourceRefId`构造集合并与权威required ref集合做双向精确比较。缺少row、额外row、重复语义键、跨session绑定、ref type不一致、bytes缺失、digest/size不一致或非`STAGED`状态均在child可见前失败；required集合为空时staged集合也必须为空。
6. 按`prepareFork`第9步重新读取并校验相关request/run、process status和timeline facts，再为source prefix中的每个distinct message/request/run生成一对一child id映射；用同一映射生成child session、child messages、child anchor、fork source和process snapshot events/status。所有source identity/control refs都必须映射为child-owned ids，不能映射的值按权威错误目录失败。
7. 对每个required ref，使用matching staging row的`promotedContentId`替换source message content与metadata中的全部对应出现位置；copied message不得残留原`tool-results/<refId>`、private content locator或`BlobRef`。其余message projection继续执行既有runtime-only metadata移除、`metadata.forkInherited=true`、summary/replacement/tool pairing和typed ref校验。
8. 使用source title snapshot生成既有fork title；通过canonical fork active-context selection语义选择child message refs，并验证全部selected refs都存在于copied child prefix。REMOTE可以使用自身实现，但输出必须通过与LOCAL相同的conformance fixtures，不得采用“全部消息”或“空上下文”等替代算法。
9. 在最终原子提交开始前再次检查cancellation。最终提交使用provider支持的单一serializable transaction或等价原子条件写：先在该提交边界内再次检查成功幂等锚点和source session/anchor仍有效，再写入child session、messages、active-context version 0与items、fork source、process snapshots/status，把精确matching staging rows绑定child坐标并转为`COMMITTED`，最后写成功幂等锚点。
10. 成功提交后返回`replayed=false`。若唯一约束表明并发请求已先提交同一成功幂等锚点，则丢弃未提交的candidate child facts，读取并校验winner child，返回`replayed=true`；当前attempt的`STAGED` rows保持不可见并由Runtime abort或cleanup收敛。

最终事务不得包含跨NextAgent workspace、Long-term Memory或另一个Working Memory provider的写入。若promotion bytes位于provider自己的object store，bytes可以在stage阶段先持久化；最终事务只原子改变provider-owned metadata可见性和全部WorkingMemory child facts。最终事务失败时matching rows仍为`STAGED`且child完全不可见。

#### 修改后的 `abortForkPromotions` 与存量成员兼容边界

- `abortForkPromotions` 的 request 改为只使用可信owner scope、`agentId`和`forkAttemptId`。provider按该坐标查询`STAGED` rows，以条件更新转为`ABORTED`；对每个成功转换的row best-effort删除bytes。并发已转为`COMMITTED`的row不修改；删除失败保留`ABORTED` metadata供既有cleanup重试；重复abort无新增副作用。
- `loadSessionForkSource`、`loadForkProcessSnapshotStatus`、`hasUserMessageAfterForkAnchor`、`loadCommittedForkPromotionContent`和`cleanupExpiredForkPromotions`保留当前请求、结果和业务语义。本change不重新设计或要求重写其provider逻辑，只为public method补充optional、非wire的`AbortSignal`最后参数。
- 新增或修改的methods在远程读取、内部批处理、content存储和最终提交前的慢边界检查optional signal；上述五个存量methods仅在其现有慢边界接入signal。同步原子提交开始后不承诺中途abort。provider-native异常按session fork权威错误目录返回safe envelope。

#### ref 分类与投影

| ref 类别 | 首版行为 |
|---|---|
| provider 已持有且 owner+agent scoped、按既有规则对 child 可安全读取的 durable attachment/artifact/blob/promoted content ref | 保留或在 provider 内重映射；不暴露 BlobRef 或 storage path |
| 规范化 tool-results/<refId> 且 source terminal run 与 resolver 坐标完整 | prepare 返回 ref；NextAgent 解析 bytes 并 stage；forkSession 重写为 promotedContentId并原子 commit |
| source run workspace path、临时/host path或其他不能通过既有可信 resolver按规范 ref解析的值 | reject SESSION_FORK_EXECUTION_BOUND_CONTENT 或 SESSION_FORK_EXECUTION_BOUND_METADATA；不创建 child |
| unknown ref、scope 不一致或无法证明 child-accessible 的 durable ref | fail closed；不原样复制 |

Working Memory provider不调用NextAgent resolver，也不新增generic file/blob read contract。它只通过stageForkPromotion接收prepare清单中规范化ref对应的受预算约束bytes，并以forkAttemptId + sourceMessageId + sourceRefId绑定staging metadata。forkSession必须从同一attempt的staged rows取得promotedContentId，不接收refMappings或content bytes。历史及新提交的committed promotion继续可由loadCommittedForkPromotionContent读取。

附件不作为 execution-bound content自动复制。消息中的 attachmentIds 只有在既有 owner+agent读取规则已允许 child conversation安全展示时才可保留；本 change不复制或重绑 attachment row/blob，也不改变 inherited retry/edit 的附件重新校验与失败语义。页面不预判ref/attachment能力，后端是权威安全边界。

#### LOCAL provider application transaction

agent-platform-gateway-local 在现有 package 内增加 provider-private application service，迁移并复用当前 Runtime fork helpers。它通过 private SQLite primitives读取 prefix、events/status和幂等锚点，并组装最终 private materialization plan；SqliteGatewayCore 继续只负责 row mapping、sequence/ordinal、scoped uniqueness、幂等和事务。

LOCAL factory注入 ForkActiveContextSelectionPort、id factory、clock和provider-private resource limits。未注入selector的通用SQLite store仍可服务非派生能力，但调用forkSession时必须fail closed为SESSION_FORK_UNAVAILABLE；产品composition必须注入selector。预算不进入 PrepareForkRequest 或 ForkSessionRequest。prepareFork不持久化第二套preparation fact；forkSession从完整prefix重新推导required refs，并与fork_promoted_contents中同attempt的staged rows精确匹配。现有fork_promoted_contents persistence增加sourceRefId与content digest，并允许STAGED target坐标待最终fork transaction填充；不新增parallel preparation store。不得新增目录层级或复制Context Engine selection算法。

#### 外部 REMOTE WorkingMemory 增量对接边界

REMOTE WorkingMemory 已实现旧版 `SessionForkStoreGateway`；本change只要求外部实现按本design新增`prepareFork`和`forkSession`，调整`stageForkPromotion`与`abortForkPromotions`的request/result及attempt绑定，并为五个保留members接入optional signal。保留members的既有读取、可见性和cleanup逻辑不重写。

REMOTE 团队的增量契约、四个新增或修改operations的实现步骤和验收清单见 [`REMOTE WorkingMemory 会话派生增量修改指导`](./remote-working-memory-implementation-guide.md)。该文档仅作为实施导航；public contract和可观察行为以delta spec为准，provider-private决策以本design为准。

外部实现复用其现有session、message、request/run、active context、timeline/process status、fork metadata reader与既有promotion content store，并为四个变化operations补齐以下能力：

| 变化 contract | 在旧实现上的增量读取 | 在旧实现上的增量写入 |
|---|---|---|
| `prepareFork`（新增） | anchor message或request candidates、完整prefix、source runs、process status/events、成功幂等锚点 | 无；只生成返回用attempt id |
| `stageForkPromotion`（修改） | source session/message/ref、同attempt staging metadata与累计bytes | 用新的attempt+source-ref唯一键保存bytes与`STAGED` metadata |
| `forkSession`（新增） | 与prepare相同的全部source facts、同attempt staging rows、成功幂等锚点 | 原子写入child facts、`COMMITTED` promotion metadata和成功幂等锚点 |
| `abortForkPromotions`（修改） | matching attempt的`STAGED` rows | `ABORTED`状态与best-effort bytes删除 |

外部实现继续使用其已有存储与transport，不需要访问NextAgent workspace或resolver；NextAgent resolver只把prepare清单对应的bytes通过修改后的stage contract交给它。新增逻辑使用与LOCAL语义相同的六类派生预算、id factory、clock和active-context selection结果。外部实现可以在服务内部批量读取完整prefix和events，但不得把读取状态暴露为新的public contract。

本代码仓不实现REMOTE WorkingMemory服务端逻辑，不新增AgentMemory HTTP endpoint、vendor DTO、credential或transport adapter，也不修改仓内`agent-platform-gateway-remote`去承载上述业务实现。本仓交付范围仅为`agent-contracts`、NextAgent Runtime调用侧、LOCAL SQLite实现、provider-neutral conformance资产和本实施指导。外部REMOTE实现通过发布后的contract与conformance独立验收。

仓内`agent-remote-deployment`当前仍装配LOCAL SQLite Working Memory；它必须像其他产品composition一样向该LOCAL provider注入Context Engine selector。这个装配改动不构成REMOTE WorkingMemory业务实现，也不新增REMOTE transport或服务端逻辑。

#### 错误、幂等与取消

prepareFork、stageForkPromotion与forkSession的失败都reject AgentError；forkSession只resolve success-only ForkSessionResult。REMOTE adapter strict校验failure envelope与canonical (code, category, retryable)，丢弃provider message/details，统一使用 Session fork failed.。规范化工具结果的resolver/stage失败与unsupported execution-bound content/metadata分别使用权威code，不得降级为复制ref或deployment-specific结果。

相同 trusted scope、source session、最终 message anchor与normalized key最多创建一个child；不同key创建不同child。promotion stage按attempt+source message+source ref幂等，同bytes/MIME/size重试返回首次promotedContentId，不同值冲突。失败attempt不写成功锚点。最终提交后response丢失时，同key重试返回首次child且replayed=true。最终事务开始前取消不留child，开始后只允许全部可见或全部不可见。

#### provider conformance

本change在现有`agent-test-kit`中新增唯一可发布的session-fork provider conformance资产。runner seed相同WorkingMemory facts与provider-owned durable refs；driver在provider外使用同一test-only ref→bytes fixture模拟NextAgent可信resolver，并按prepare结果调用stage。共享runner覆盖message/request anchors、完整prefix与active context、规范化tool-result discovery/stage/commit、scope隔离、取消和幂等重放；容量预算、unsupported execution-bound ref、process snapshots、并发幂等、response loss及安全错误矩阵由相同公开contract下的provider验收用例补充，外部REMOTE按实施指导中的清单提供对应证据。

这里的conformance driver仅是`agent-test-kit`测试API：`reset`、`seedSource`和`readChild`只负责建立fixture及读取规范化测试事实，不属于`agent-contracts`，不得进入应用composition、运行时调用链或REMOTE transport。生产适配方式仍只有`WorkingMemoryGatewayBindings.sessionForks: SessionForkStoreGateway`；LOCAL与外部REMOTE都不得把test driver当作第二套gateway。

LOCAL与REMOTE成功结果按child ids alpha-renaming并仅忽略provider clock字段；失败比较canonical tuple。外部AgentMemory未通过同一suite digest不得声明兼容。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | Child Session Inherits Prefix And Model-Visible Context、Fork Failure Is Atomic And Safe | trusted scope、prepare manifest绑定、safe projection、unsupported execution-bound fail closed、safe error normalization | 跨scope、伪造stage与unsupported refs不泄漏、不产生child |
| 性能/容量 | 会话派生跨 provider 边界使用有界协调材料 | 固定坐标、有界ref清单、受预算约束bytes和provider-local batching | 不传完整历史，ref/bytes超限原子失败 |
| 可靠性/恢复 | Fork Idempotency、Fork Failure Is Atomic And Safe | provider-local transaction、成功锚点、取消边界 | 并发同key、response loss和故障注入 |
| 可测试性 | LOCAL 与 REMOTE 会话派生保持契约一致 | 同一contract、fixtures和error catalog | LOCAL/REMOTE相同结果或相同safe failure |

#### 备选方案（Alternatives Considered）

- NextAgent分页读取完整prefix：仍使payload随历史增长；不选择。
- REMOTE直接访问NextAgent workspace：扩大信任面且部署上不可用；不选择。
- LOCAL保留promotion成功、REMOTE fail closed：形成deployment-specific行为；不选择。

## FN-8.1 持久化运行数据

### 目标与规范依据

selected Working Memory provider成为session fork事实发现、promotion staging binding、child生成和原子提交的单一owner，同时NextAgent只负责通过既有可信resolver解析prepare清单，raw persistence adapter不反推业务语义。这是session fork的窄架构refinement，不改变普通request lifecycle。

#### 本 Function 的目标 Requirements

canonical spec：gateway-store-provider-ownership

- MODIFIED：Working Memory preserves request and session transaction boundaries

当前标题和`WorkingMemoryGatewayBindings`用于匹配并实施当前stable基线；后续StateStore change负责迁移到其最终标题和binding。

### 当前实现

- WorkingMemory provider拥有request/session composite transaction，但fork业务计划由Runtime组装。
- LOCAL prefix/promotion/composite作为多个public methods暴露；raw SQLite core满足Record/row/事务职责。
- 当前代码使用`WorkingMemoryGatewayBindings`和`adapterKind: "working-memory"`；后续StateStore change会统一重命名binding，但不改变本change已经落地的fork operations。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| provider读取并复制全部WorkingMemory facts | Runtime读取并组装 | 需要provider application service与有界prepare清单 |
| raw adapter不拥有领域策略 | 直接把逻辑塞入SQLite core会冲突 | 维持application/raw分层 |
| LOCAL/REMOTE同contract | 旧payload依赖Runtime Records | public入口只用可信坐标 |

### 修改方案

`WorkingMemoryGatewayBindings`继续使用唯一`sessionForks: SessionForkStoreGateway`。provider application service实现public prepareFork与forkSession，既有stage/abort/read/cleanup仍在同一gateway；该service拥有anchor、prefix、ref discovery、projection、selection、snapshot和预算策略，raw persistence只提供private query/write/transaction primitives。

LOCAL与REMOTE都在selected Working Memory provider内完成最终transaction，不跨Working Memory provider、Long-term Memory或fallback SQLite建立分布式事务。普通terminal commit、session create/delete、RequestRun lifecycle、active-context append/compaction owner不变；该模式不得泛化为generic gateway business service。

## 跨 Function 协作与端到端流程

1. Web构造现有message/request fork command并传播abort signal。
2. Runtime取得trusted scope、require source session，调用selected sessionForks.prepareFork。
3. Working Memory provider读取完整事实并返回有界requiredContentRefs；Runtime只解析这些refs并逐项调用stageForkPromotion。
4. Runtime使用同一source坐标、idempotencyKey与forkAttemptId调用forkSession；Working Memory provider重新校验并原子提交child facts与matching promotions。
5. Runtime/channel只投影既有child结果；失败时best-effort abort同attempt，取消或response loss按统一error/idempotency语义处理。
6. 创建后fork notice、inherited retry/edit、process history、committed promotion read和cleanup继续使用保留窄成员。

## 跨 Function 质量属性设计（Cross-Function Quality Attributes）

| 质量属性 | 影响 Functions 与规范依据 | 共享机制 | 端到端验证 |
|---|---|---|---|
| 性能/容量 | FN-1.11 有界协调材料；FN-8.1 transaction Requirement | Runtime到provider不传完整prefix，只传固定坐标、有界ref清单对应的受预算bytes | 不同历史长度下非内容请求上界不变，bytes不超过promotion预算 |
| 可靠性/恢复 | FN-1.11 Fork Idempotency、Fork Failure Is Atomic And Safe；FN-8.1 transaction Requirement | provider-local final transaction与成功锚点 | LOCAL故障注入和REMOTE conformance |
| 可测试性 | FN-1.11 provider一致性；前置provider conformance Requirement | 单一发布suite与canonical errors | 相同suite digest在两端通过 |

## 验证策略（Verification Strategy）

- contract：断言九个gateway members、independent anchors、prepare/ref/stage/fork shapes、success-only result、strict schemas、optional signal与旧exports移除。
- Runtime：断言按prepare清单调用既有resolver与stage后调用forkSession，不读取prefix、不调用selector、不分LOCAL/REMOTE。
- LOCAL integration：覆盖空ref与多ref prepare、完整prefix、promotion stage/commit/abort、title、summary/replacement/tool pairing、active context、snapshots、durable refs、unsupported refs、预算、原子故障、幂等和取消。
- provider conformance：LOCAL与外部AgentMemory运行同一fixtures；success比较规范化facts，failure比较canonical tuple。
- Web：现有按钮、route/request/success保持；resolver或unsupported ref失败时显示现有失败提示，不在前端复制后端安全判断。

## 长期基线刷新计划（Baseline Promotion Plan）

- stable specs：合入session-fork-from-message、gateway-store-provider-ownership delta；移除ts-core-contracts七条迁移Requirements。
- Functions：刷新FN-1.11输入、过程、结果、规格和接口并纠正“子会话上下文为空”；刷新FN-8.1 provider transaction边界。
- Features：刷新F-1.6 基于历史回复新建会话与F-8.1 本地持久化。
- architecture：刷新core-contracts、runtime-boundaries、conversation-process-history、ts-backend-architecture。
- modules：刷新agent-contracts、agent-runtime、agent-context-engine、gateway-local和agent-app；不把外部REMOTE WorkingMemory实现写入仓内module设计。
- ADR：刷新session-fork-copies-prefix-not-runtime-state。
- overview与导航：刷新openspec/overview.md和spec-to-design-map.md。
- 其他长期文档：无。

## 风险与取舍（Risks / Trade-offs）

- prepare与stage使派生增加跨边界调用，但只传受既有数量/bytes预算约束的ref材料，不传完整历史。
- 页面不预判ref；resolver、stage或unsupported ref失败时用户仍收到安全失败。
- 附件摘要可展示不等于附件成为child-owned执行输入；retry/edit继续按既有scope重新校验。
- provider内完整读取仍有计算成本，通过预算安全拒绝。
- 后续StateStore change必须在本change归档后rebase并保留最终fork contract；forkInherited change的行为必须在本change实施中保留。

## 迁移与回滚（Migration / Rollback）

这是TypeScript/provider contract breaking migration，不提供双contract或Runtime fallback。顺序固定为：记录contract/roadmap批准；基于当前Working Memory binding发布prepare/stage/fork contracts与conformance；完成LOCAL实现并由外部AgentMemory通过同一suite；同一NextAgent release切换Runtime与providers并删除旧public operations；后续StateStore change再迁移binding命名。

回滚必须同时恢复匹配版本的NextAgent与AgentMemory contract。既有已提交child与promotion使用未改变的durable schema并继续可读。

## 待确认问题（Open Questions）

无未决设计选择。本次用户指令已批准先实施fork contract；后续StateStore change不再是本change的实施门禁。
