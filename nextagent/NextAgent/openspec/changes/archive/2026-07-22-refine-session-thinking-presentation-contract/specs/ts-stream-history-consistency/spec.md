## ADDED Requirements

### Requirement: Conversation and process history use separate durable facts

Completed conversation SHALL由message query和run event query组合：visible messages提供user、assistant、capability-result和summary内容；persisted timeline events提供thinking及其他过程顺序。任何一侧不得重建另一侧的canonical内容。

#### Scenario: Completed turn combines message and event facts
- **WHEN**run产生thinking、capability过程和final answer
- **THEN**conversation query MUST返回最终messages
- **AND**event query MUST返回persisted process facts
- **AND**final answer MUST只取自assistant message

#### Scenario: Process failure does not erase committed answer
- **WHEN**event-history读取暂时失败但assistant message已提交
- **THEN**conversation MUST仍显示final answer
- **AND**UI MAY显示过程暂不可用但不得伪造空过程为成功读取

### Requirement: Live in-progress state converges to completed cold history

Live consumer MAY接收多个调用中的累计thinking deltas；model invocation结束时必须接收同step最后累计delta的`completed=true`投影。Cold history只返回该persisted completed delta。两条路径在完成态的reasoning、step、completed state和process ordering上MUST等价。

#### Scenario: Completed delta settles live thinking
- **WHEN**consumer已显示当前连续partial thinking entry，随后可能收到同一model invocation的answer `LLM_CONTENT_DELTA`，并在下一个ProcessPanel过程entry边界前收到completed=true envelope
- **THEN**consumer MUST更新并settle同一entry
- **AND**MUST不创建重复thinking entry
- **AND**answer `LLM_CONTENT_DELTA` MUST不关闭该entry边界
- **AND**后续Capability等ProcessPanel过程event MUST关闭该entry边界，不能仅按runId+stepId跨边界合并

#### Scenario: Cold history reconstructs final process
- **WHEN**client关闭并重新打开已完成conversation
- **THEN**message+event queries MUST重建与live完成态等价的最终内容和过程
- **AND**MUST不重建调用中的live-only delta frames

#### Scenario: Abruptly lost in-progress thinking is not invented
- **WHEN**进程在model invocation结束前消失且只有live-only调用中delta
- **THEN**cold history MUST不出现该调用中reasoning
- **AND**system MUST不从final answer或其他event猜测thinking

### Requirement: Retry selects process history by visible run

Retry SHALL创建新run且保持旧attempt persisted events不可变。默认过程面板由当前visible assistant message对应runId查询；旧attempt只有显式runId查询时返回。

#### Scenario: Retry does not mix attempts
- **WHEN**原run失败后retry成功
- **THEN**新run event page MUST不包含原run events
- **AND**原run显式查询 MUST仍返回原事实

### Requirement: Process history never affects model context or prefix cache

Context assembly和model request SHALL只消费ActiveContext message refs，不查询runtime event history或fork snapshots。

#### Scenario: Persisted events have no model-input effect
- **WHEN**相同message/context state分别存在和不存在process events
- **THEN**rendered provider messages、token budget和cacheable prefix MUST字节等价

#### Scenario: Fork snapshot has no child-context effect
- **WHEN**child session拥有copied process snapshots并首次submit
- **THEN**model input MUST只来自child active-context messages
- **AND**MUST不包含thinking、snapshot status或timeline payload
