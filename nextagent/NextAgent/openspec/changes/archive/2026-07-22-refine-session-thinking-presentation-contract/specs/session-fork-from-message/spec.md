## MODIFIED Requirements

### Requirement: Child Session Inherits Prefix And Model-Visible Context

系统SHALL在fork时复制source session从开头到anchor message的canonical conversation prefix，并用copied child message ids初始化child active context。Copied message必须使用child-owned messageId、sessionId、requestId和runId；同一source run映射到同一新child run anchor，不同source run映射到不同anchor，且映射只存在于本次fork执行内存中。

Child active context MUST只引用child message ids，version初始化为0，ordinals从0连续递增。系统MUST NOT复制parent active context、历史context snapshot、thinking event或process snapshot到模型上下文。Summary covered refs、message metadata、ContentRef和execution-bound refs继续按既有safe child message projection重映射、promotion或fail closed。

除messages与active context外，fork MUST为copied prefix中每个display run物化child-owned durable process snapshots；这些snapshots只用于event history，不是RequestRun、checkpoint或模型上下文事实。

#### Scenario: Child conversation displays the copied prefix
- **WHEN**fork成功后读取child conversation
- **THEN**response MUST包含截至anchor的可见message序列
- **AND**每条message MUST使用child session identity且保持对应content、role、content type和visibility

#### Scenario: Child active context only references child messages
- **WHEN**fork成功后读取child active context
- **THEN**items MUST只引用copied child messages且不包含anchor之后内容
- **AND**version MUST为0

#### Scenario: Historical anchor ignores parent current context
- **WHEN**source在anchor后继续产生消息或发生compression后从历史anchor fork
- **THEN**child active context MUST只由copied prefix计算
- **AND**MUST不读取parent current context或timeline

#### Scenario: Summary refs are remapped without duplicate covered originals
- **WHEN**copied prefix包含SUMMARY及covered originals
- **THEN**summary metadata MUST只引用存在的child message ids
- **AND**selected active context MUST不同时包含summary和其covered originals

#### Scenario: Copied turns retain child run anchors
- **WHEN**source messages带有runId
- **THEN**copied messages MUST携带对应child run anchor
- **AND**同run共享anchor、不同run使用不同anchor、anchor不得等于source runId

#### Scenario: Child first submit uses only inherited messages
- **WHEN**用户在新child首次submit
- **THEN**provider context MUST来自child active context
- **AND**MUST不读取parent messages、timeline、snapshots或checkpoint

### Requirement: Forked Session Is Isolated From Source Session

Fork后child SHALL独立演进。Fork不得修改source messages、active context、timeline或RequestRun；不得调用Agent core或model provider。Child后续RequestRun、timeline、checkpoint、pending input、workspace和artifacts必须写入child scope。

Copied run anchor仍不是可操作runtime lifecycle fact。Fork新增的FORK_SNAPSHOT records只是child-owned只读过程历史，MUST不创建RequestRun、RequestContext、checkpoint、pending input或lane state；cancel、retry、edit、recovery、activeRun和stream control MUST忽略它们并保持run-not-found。

#### Scenario: Fork does not modify source
- **WHEN**fork成功
- **THEN**source所有message、context、timeline、run和checkpoint facts MUST保持不变

#### Scenario: Child continuation never writes back
- **WHEN**child提交新请求
- **THEN**新messages、RequestRun、runtime events和context MUST只写入child

#### Scenario: Runtime state is not inherited
- **WHEN**source存在checkpoint、pending input、live delta、provider error、tool state或未完成run
- **THEN**child MUST不继承这些事实
- **AND**只继承durable message prefix及允许的read-only process snapshots

#### Scenario: Unsafe source-bound refs fail atomically
- **WHEN**copied message或event payload含无法安全remap、promotion或证明child-accessible的source runtime/path ref
- **THEN**fork MUST安全失败
- **AND**MUST不创建可见child或部分facts

#### Scenario: Snapshot run anchor is not actionable
- **WHEN**child run anchor只有FORK_SNAPSHOT records而没有RequestRun
- **THEN**lifecycle和recovery路径 MUST不把它当作runtime run
- **AND**event-history读取 MAY返回其只读过程snapshots

## ADDED Requirements

### Requirement: Fork atomically materializes child-owned process history

Runtime SHALL在source→child message/request/run映射仍可用时读取copied display runs的全部durable timeline records，验证同一Owner Scope、Agent Scope、source session和run binding，然后生成FORK_SNAPSHOT drafts。每条draft必须使用新child eventId及child session/request/run坐标，省略requestContextId、contentRef、source坐标和gateway metadata，并保留validated type、createdAt和source records的相对顺序。Known payload message/request/run refs必须重映射；checkpoint/timeline refs、provider raw fields和paths必须清除或拒绝。用于展示关联的opaque step/tool/capability/workflow ids MAY保留，但不得成为控制authority。

Gateway fork composite MUST在同一transaction内创建child session、messages、active context、fork metadata、snapshot rows和per-run status，并在child session sequence domain连续分配sequence。任一步失败全部回滚；idempotent replay不得重复rows或sequence。

#### Scenario: Direct fork copies durable process events
- **WHEN**source copied runs包含durable thinking、capability和terminal/lifecycle events
- **THEN**child MUST拥有对应FORK_SNAPSHOT rows
- **AND**rows MUST使用child identities并保持source相对顺序
- **AND**source live-only deltas MUST不出现

#### Scenario: Source deletion does not remove child history
- **WHEN**fork成功后source session被删除
- **THEN**child conversation和AVAILABLE process snapshots MUST继续可读
- **AND**query MUST不回读或探测source

#### Scenario: Ordinary stream excludes copied history
- **WHEN**child建立live或resume stream
- **THEN**FORK_SNAPSHOT events MUST不进入该stream
- **AND**只有run-scoped event-history query MAY读取它们

#### Scenario: Snapshot copy respects resource limits
- **WHEN**durable event count或serialized bytes超过fork preflight限制
- **THEN**fork MUST在可见child write前安全拒绝
- **AND**failure MUST不包含event payload或reasoning

#### Scenario: Snapshot payload validation failure keeps fork atomic
- **WHEN**任一source event包含无法安全复制的source runtime ref或损坏payload
- **THEN**fork MUST失败并回滚全部child facts

### Requirement: Copied run process availability is explicit and lineage-free

每个copied run SHALL保存exact `AVAILABLE | LEGACY_UNAVAILABLE` status，不保存source session/request/run、cutoff、lineage或payload。AVAILABLE表示child拥有完整可查询snapshot集合，集合可以为空；LEGACY_UNAVAILABLE表示历史版本没有可靠过程快照且不得猜测。

#### Scenario: New direct fork marks copied runs available
- **WHEN**从真实source runs成功完成snapshot读取和composite write
- **THEN**每个copied run MUST有AVAILABLE status
- **AND**无durable event的合法run MUST仍是AVAILABLE empty

#### Scenario: Upgrade-era fork is unavailable without guessing
- **WHEN**既有child copied run缺少status且message membership证明其属于fork prefix
- **THEN**event query MUST返回LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE
- **AND**MUST不尝试恢复source mapping

#### Scenario: Arbitrary run is not treated as legacy
- **WHEN**runId既不是同session RequestRun也不是copied prefix member
- **THEN**runtime MUST返回safe not-found
- **AND**MUST不返回legacy unavailable以泄露fork membership

### Requirement: Recursive fork copies child-owned snapshots without source lineage

Fork-of-fork SHALL把source child视为当前唯一source。AVAILABLE copied run的FORK_SNAPSHOT rows按普通durable snapshot重新映射到grandchild；source child自己的真实run events也按同一规则复制。LEGACY_UNAVAILABLE status原样传播且不阻止message fork。

#### Scenario: Available snapshot survives recursive fork
- **WHEN**用户从包含AVAILABLE copied run的child再次fork
- **THEN**grandchild MUST拥有重新生成identity和sequence的snapshot rows
- **AND**MUST不保存或读取ultimate ancestor坐标

#### Scenario: Legacy unavailability propagates narrowly
- **WHEN**递归fork prefix包含LEGACY_UNAVAILABLE run和其他AVAILABLE runs
- **THEN**grandchild MUST只把对应run标为LEGACY_UNAVAILABLE
- **AND**其他runs MUST正常复制并保持AVAILABLE

### Requirement: Fork process snapshots never participate in model context

FORK_SNAPSHOT records和process status SHALL只服务event-history facade。Context Engine、ActiveContext initialization、summary、prompt shaping、provider request和prefix cache MUST不读取它们。

#### Scenario: Child model input ignores copied thinking
- **WHEN**child拥有包含reasoning的process snapshots并首次submit
- **THEN**provider input MUST只包含child active-context messages
- **AND**MUST不包含reasoning、event payload、snapshot origin或availability status
