## ADDED Requirements

### Requirement: Timeline persistence is classified by lifecycle finality

Product runtime SHALL通过唯一声明式policy把每个timeline event分类为`LIVE_ONLY`或`PERSISTED`。Policy MUST按event type及validated payload predicate声明允许形态；`emitEvent`主路径MUST只消费分类结果，不得增加thinking专用if/else。

调用中的`LLM_THINKING_DELTA`省略`completed`并MUST为LIVE_ONLY；单次模型调用最后累计`LLM_THINKING_DELTA`包含`completed=true`并MUST为PERSISTED。`LLM_CONTENT_DELTA`和`CAPABILITY_RESULT_DELTA`MUST保持LIVE_ONLY。既有其他event继续遵循其已有persistence规则，本change不扩大其他delta的持久化集合。Event持久化与Web可见性MUST是独立维度。

#### Scenario: In-progress deltas remain live only
- **WHEN**runtime处理调用中thinking、assistant content delta或capability result delta
- **THEN** policy MUST分类为LIVE_ONLY
- **AND** timeline store MUST不创建row或sequence

#### Scenario: Completed thinking is durable
- **WHEN**runtime处理合法`completed=true` thinking delta
- **THEN** policy MUST分类为PERSISTED
- **AND** composition override MUST不能把它降级为LIVE_ONLY

#### Scenario: Invalid persistence combination is rejected
- **WHEN** producer把partial thinking标成PERSISTED、把final thinking标成LIVE_ONLY或提供`completed=false`
- **THEN** runtime MUST在append和publish前失败
- **AND** MUST不留下row、sequence或live完成态

### Requirement: Final thinking reuses the canonical timeline store

Local runtime SHALL复用`RunTimelineEventStoreGateway.appendEvent`和`timeline_events`保存模型调用最后累计thinking delta，MUST NOT增加thinking message、sidecar或第二套sequence。每个model invocation最多追加一条包含完整reasoning和`completed=true`的record；gateway scoped idempotency replay MUST返回首次eventId、sequence、payload和createdAt，不插入第二条row。

Gateway-local只校验generic record、JsonObject serialization、scope、origin、idempotency和sequence，不解析model reasoning业务。Payload生命周期校验属于runtime policy。

#### Scenario: Last cumulative thinking delta is stored once
- **WHEN**runtime append合法completed thinking event
- **THEN** timeline table MUST增加恰好一条`LLM_THINKING_DELTA` row
- **AND** row MUST保留`reasoning`、`stepId`和`completed=true`
- **AND** message和ActiveContext stores MUST无变化

#### Scenario: Database reopen preserves completed thinking
- **WHEN**保存completed thinking event后关闭并重开同一SQLite database
- **THEN** eventId、coordinates、sequence、payload和createdAt MUST原样恢复
- **AND**未持久化的调用中deltas MUST不被合成

#### Scenario: Storage failure is explicit
- **WHEN** serialization、constraint或SQLite failure阻止append
- **THEN**runtime MUST不发布completed thinking delta或后续依赖model terminal boundary
- **AND** safe failure MUST不包含database path、raw SQLite error或reasoning content

### Requirement: Timeline records distinguish runtime facts from fork snapshots

`RunTimelineEventRecord` SHALL支持可选`recordOrigin=FORK_SNAPSHOT`；字段缺省表示既有runtime fact。Runtime fact MUST包含真实`requestContextId`。FORK_SNAPSHOT MUST省略requestContextId、contentRef和source coordinates，只能由fork composite write创建，不能通过普通`appendEvent`创建。

普通live stream、resume、lifecycle、recovery、terminal reconciliation、cancel、retry、edit、activeRun和stream-control reads MUST忽略FORK_SNAPSHOT。只有run-scoped history read MAY返回snapshot，经runtime映射后仍不暴露gateway细节。

#### Scenario: Normal append cannot manufacture a fork snapshot
- **WHEN** caller通过`appendEvent`提交`recordOrigin=FORK_SNAPSHOT`
- **THEN** gateway MUST在insert前拒绝
- **AND** MUST不推进sequence

#### Scenario: Runtime record still requires request context
- **WHEN**普通runtime record缺少requestContextId
- **THEN** gateway/runtime validation MUST失败
- **AND** 不得因fork支持而放宽普通事件不变量

#### Scenario: Lifecycle ignores copied snapshot facts
- **WHEN** child timeline包含run anchor的FORK_SNAPSHOT records但不存在RequestRun
- **THEN** recovery和控制操作 MUST不把该anchor识别为active或terminalized run
- **AND** cancel/retry/edit MUST保持run-not-found语义

#### Scenario: Live stream does not replay inherited snapshots
- **WHEN**client在child session建立普通live或resume stream
- **THEN**stream MUST不发送FORK_SNAPSHOT rows
- **AND**client MUST通过run event-history接口加载copied process history

### Requirement: Fork composite atomically copies durable timeline snapshots

Fork composite write SHALL接收已经过runtime验证和child identity重映射的snapshot drafts及每个copied run的`AVAILABLE | LEGACY_UNAVAILABLE`状态，在创建child session的同一transaction内写入messages、active context、fork metadata、snapshot records和status。

Gateway MUST按输入的source相对顺序为child snapshots分配连续的child session sequence。Idempotent replay MUST返回首次child且不得重复snapshot或推进sequence。任一validation或write失败 MUST回滚全部child facts。

#### Scenario: Successful fork owns independent event rows
- **WHEN**source prefix的display runs包含durable events且fork成功
- **THEN** child MUST拥有使用child session/request/run/event identities的snapshot rows
- **AND** source删除后child rows MUST保持可查询

#### Scenario: Live-only deltas are not copied
- **WHEN**source run包含多个只用于live展示的调用中deltas
- **THEN** fork copy set MUST只来自durable timeline rows
- **AND** child MUST不出现partial-only row

#### Scenario: Fork event failure is atomic
- **WHEN**任一snapshot payload、scope、origin、resource limit或write不合法
- **THEN** child session、messages、active context、snapshot rows和status MUST全部不存在
- **AND** source facts MUST保持不变

#### Scenario: Fork snapshot survives reopen and child continuation
- **WHEN**fork成功、database重开且child产生新的real run events
- **THEN**copied snapshots MUST保持原child sequence
- **AND**新runtime events MUST从child session当前最大sequence之后继续

### Requirement: Event history queries remain scoped and bounded

`RunTimelineEventStoreGateway.listEvents` SHALL按tenant、subject、agent、session、exclusive afterSequence和validated limit查询；requestId和runId出现时必须共同过滤。结果按sequence ASC返回。Owner或Agent mismatch返回不可区分空结果；storage failure显式失败。

#### Scenario: Run pagination has no duplicate or omission
- **WHEN**一个run的persisted events跨越多页
- **THEN**连续使用next cursor MUST让每条event恰好出现一次
- **AND**不得混入其他request或run

#### Scenario: Empty valid run is distinguishable at runtime facade
- **WHEN**合法RequestRun或AVAILABLE copied run没有persisted events
- **THEN**gateway可返回空records
- **AND**runtime依据已验证run/status返回AVAILABLE，而不是把空结果当作not-found
