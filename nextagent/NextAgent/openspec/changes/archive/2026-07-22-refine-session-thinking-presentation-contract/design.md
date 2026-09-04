## 背景和当前代码基线

当前产品路径已经具备以下对象和调用链：

- `agent-core/default-agent`按单次model invocation累积`reasoningContent`，每次provider reasoning chunk都发出完整累计`LLM_THINKING_DELTA`。
- `agent-core/workflow-runtime-event-projector`只投影workflow自身的visible output和node lifecycle，不拥有模型调用thinking完成语义。
- `RuntimeOwnedAgentRunStatePort.emitEvent`通过统一persistence policy分类`LLM_THINKING_DELTA`、`LLM_CONTENT_DELTA`、`CAPABILITY_RESULT_DELTA`和既有lifecycle events；允许持久化的event进入`RunTimelineEventStoreGateway.appendEvent`。
- `agent-channel-common.projectTimelineEventToStreamEnvelope`已经把`LLM_THINKING_DELTA`投影为包含`reasoning/content/text`和`metadata.accumulated=true`的既有wire event。
- `RuntimeSessionPort`拥有session/runtime facade；Web stream通过runtime而不是直接读取gateway。
- Fork由runtime协调，gateway composite在同一SQLite transaction内创建child session、copied messages、active context和fork metadata；copied messages已经使用child-scoped requestId和run anchor，但anchor不是RequestRun。

## 目标和约束

本change只解决后端事实完整性：调用中的thinking delta不存，模型调用结束时保存最后一个非空累计delta；message与event分开查询；同一个安全projector保证live和history完成态一致；fork child拥有独立过程历史。

约束：

- thinking不是message，不进入ActiveContext或模型输入；
- 不新增event type、segment identity、runtime segment状态机或第二套排序时钟；
- 完成的thinking delta必须在对应`MODEL_INVOCATION_COMPLETED|FAILED`之前append，保持过程顺序；
- workflow node、Agent request和runtime lifecycle不得推断模型thinking完成；
- persistence规则必须声明式、可扩展，主emit路径不得出现thinking专用if/else；
- fork不得伪造RequestRun或RequestContext，但source删除后child历史仍必须可用；
- public Web只返回allowlist后的StreamEnvelope，不能透传gateway record或raw payload。

## 决策1：同一个 LLM_THINKING_DELTA 表达调用中和完成态

Canonical event type保持`LLM_THINKING_DELTA`。Payload有且只有两种生命周期形态：

```ts
// 调用中的实时累计delta
{
  reasoning: string;
  stepId: string;
  completed?: never;
}

// 单次模型调用的最后累计delta
{
  reasoning: string;
  stepId: string;
  completed: true;
}
```

共同约束：`reasoning.trim()`非空但保存原始whitespace；`stepId`非空；`completed`只能缺省或为literal true，禁止false。Canonical payload不增加`segmentId`、`segmentOrdinal`、`content`、`text`或presentation metadata。

调用中的累计delta使用`persistence=LIVE_ONLY`。最后一个累计delta使用`persistence=PERSISTED`并包含`completed=true`。同一模型调用至多持久化一个完成delta；没有非空reasoning时不生成完成delta。

## 决策2：模型调用producer持久化最后累计delta

`default-agent`在单次invocation局部累积`reasoningContent`。`RunBoundModelInvocation`提供私有可注入的`beforeTerminal`异步回调；`completed`和`failed`在发布`MODEL_INVOCATION_COMPLETED|FAILED`前恰好调用一次。Default Agent传入闭包：若累计reasoning非空，把当前最后累计`LLM_THINKING_DELTA`标记为`completed=true`并持久化。该delta是本次调用已经累计的最后内容，不产生新的thinking内容或segment。

顺序固定为：

```text
in-progress cumulative thinking deltas (LIVE_ONLY)
last cumulative thinking delta with completed=true (PERSISTED)
MODEL_INVOCATION_COMPLETED | MODEL_INVOCATION_FAILED
subsequent capability/fallback/request events
```

Provider正常结束、safe error、throw、abort都进入同一个invocation terminal方法，因此不需要runtime cancellation状态机。若最后累计delta append失败，`beforeTerminal`失败并阻止model terminal event继续发布；caller按既有failure路径处理，不伪造完成态。Workflow node terminal只表示workflow节点生命周期，不触发、补写或推断thinking完成。

进程在模型调用producer观察到调用结束前直接消失时，调用中的最后累计delta可能丢失。这是“delta不存”的明确代价；recovery不得猜测或合成reasoning。

## 决策3：统一声明式persistence分类

Runtime增加一个纯`TimelineEventPersistencePolicy`，输入event，输出既有`PERSISTED | LIVE_ONLY`。Policy通过事件规则表和payload predicate声明，不把业务分支散落在`emitEvent`：

| 事件语义 | 分类 |
|---|---|
| 调用中的`LLM_THINKING_DELTA`，`completed`缺省 | `LIVE_ONLY` |
| 模型调用最后累计`LLM_THINKING_DELTA`，`completed=true` | `PERSISTED` |
| `LLM_CONTENT_DELTA` | `LIVE_ONLY` |
| `CAPABILITY_RESULT_DELTA` | `LIVE_ONLY` |
| 既有`TOOL_STRUCTURED_DELTA`且`workflowEventType=NODE_COMPLETED` | 保持既有`PERSISTED`规则；本change不扩大其他delta的持久化范围 |
| 既有request/model/capability/attachment/context/policy/hook/input/background lifecycle | 保持既有persisted规则 |

Policy还验证producer提供的显式`event.persistence`与允许分类一致；调用中delta标为PERSISTED、completed delta标为LIVE_ONLY、`completed=false`或非法payload都在append/publish前失败。Composition可以提供既有selective policy，但不能把规则表声明为mandatory persisted的completed thinking降级。

`RuntimeOwnedAgentRunStatePort.emitEvent`固定执行：校验坐标和payload→解析classification→LIVE_ONLY只publish，PERSISTED先append canonical record再由既有timeline publication path发布。这里不出现thinking专用分支。

完成的thinking delta沿用现有单event idempotent append机制；本change不新增segment ordinal幂等协议。并发/重放由model invocation terminal一次性门禁和gateway现有scoped idempotency保障。

## 决策4：run-scoped event history由runtime提供

新增：

```ts
interface RuntimeListSessionEventsQuery {
  identityContext: IdentityContext;
  sessionId: SessionId;
  runId: RequestRunId;
  afterSequence: TimelineSequence;
  limit: number; // 1..1000
  signal?: AbortSignal;
}

type RuntimeSessionEventHistoryPage =
  | { availability: "AVAILABLE"; events: readonly RunTimelineEvent[]; nextAfterSequence?: TimelineSequence }
  | { availability: "LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE"; events: readonly []; nextAfterSequence?: never };
```

Runtime调用链唯一为：

```text
Web route
  -> RuntimeSessionPort.listEvents
      -> UserSessionPort.requireSession（Owner/Agent/session校验）
      -> current RequestRun 或 child copied-run snapshot status解析
      -> RunTimelineEventStoreGateway.listEvents
      -> runtime-safe RunTimelineEvent page
  -> shared channel projector
  -> StreamEnvelope page
```

Runtime返回的event必须删除tenantId、subjectId、agentId、gateway idempotency metadata和contentRef。普通runtime event包含真实requestContextId；fork snapshot省略。分页以`sequence > afterSequence`和validated limit执行；读取`limit+1`可由gateway支持的两次有界查询实现，不能向gateway传入1001。无event的合法run返回AVAILABLE空页；非法run、scope mismatch、storage failure和损坏row不能伪装成空历史。

Web接口固定：

```text
GET /api/v1/sessions/:sessionId/runs/:runId/events?afterSequence=0&limit=100
```

Route只做schema validation、调用runtime、逐event调用共享projector和response serialization。任何可见event投影失败时整页安全失败，不返回partial page。Timeline-only event统一过滤；即使整页过滤为空，只要canonical scan仍有下一页就保留cursor。

## 决策5：shared projector完成live/history一致投影

Projector继续输出public `LLM_THINKING_DELTA`：

- 调用中的canonical event：`metadata={ accumulated:true }`；
- completed canonical event：`metadata={ accumulated:true, completed:true }`。

两者复用相同`reasoning/content/text/contentType/stepId/runId/requestId`规则。Frontend继续按既有事件顺序合并当前连续thinking entry。`LLM_CONTENT_DELTA`属于answer通道，不形成ProcessPanel过程entry，因此同一model invocation的completed thinking即使在answer delta之后到达，也必须settle当前连续thinking entry；Capability等实际过程entry仍关闭该连续边界。`completed=true`不得把`runId+stepId`提升为跨边界全局segment identity，也不得新建重复entry。当前change只验证adapter兼容，不实现history fetch和ProcessPanel状态机。

Final answer仍只来自ASSISTANT message；capability result正文仍按既有message/安全投影来源组合。Event page只补充过程顺序和状态。

## 决策6：fork物化child-owned event snapshot

### 为什么不使用lineage read-through

查询时回读source timeline依赖source retention，source删除后child过程丢失，并使递归fork、权限和cutoff复杂化。新fork应表现为独立session，因此在创建时物化snapshot。

### Record语义

`RunTimelineEventRecord`增加可选`recordOrigin`：缺省表示既有`RUNTIME`，literal `FORK_SNAPSHOT`表示只读child过程快照。`requestContextId`调整为条件字段：

- RUNTIME record：必须有真实requestContextId；
- FORK_SNAPSHOT：必须省略requestContextId、contentRef和任何source坐标。

Gateway runtime `appendEvent`仍只接受RUNTIME record；FORK_SNAPSHOT只能作为`forkSessionFromMessage` composite write的一部分产生。这样外部producer不能伪造snapshot，gateway-local也不需要反推业务语义。

### 复制规则

Runtime在已有source→child message/request/run临时映射仍在内存时：

1. 收集copied visible message prefix中distinct source runs。
2. 对每个run读取其全部durable timeline records；live-only delta天然不存在。
3. 验证所有records属于同一trusted owner、Agent、source session和该run。
4. 生成新eventId，重映射child session/request/run及payload中已知的message/request/run引用，清除requestContextId/contentRef和source coordinates，设置`recordOrigin=FORK_SNAPSHOT`。
5. 保留type、validated inlinePayload和相对顺序；gateway在child session sequence domain中连续分配新sequence。
6. 与child session、messages、active context、fork metadata和per-run snapshot status一次原子提交。

复制所有durable event，而不是在fork流程复制一份Web allowlist。Web可见性仍只有shared projector决定；timeline-only snapshot可留作审计顺序，但普通live stream、resume、lifecycle和recovery路径必须按`recordOrigin`忽略，只有`RuntimeSessionPort.listEvents`可以读取。复制前的fork-safe projector重映射已知message/request/run引用，清除或拒绝checkpoint、timeline ref、provider raw object和path。用于展示关联的opaque `stepId`、`toolCallId`、`capabilityId`、workflow execution/node id可以保留，但不得被任何控制接口当作source authority。未知字段含source-bound/runtime-only值时必须fail closed，不能静默删除。失败使整个fork不可见并触发既有promotion cleanup。

### Snapshot状态和旧数据

每个child copied run保存exact status：

```ts
type ForkProcessSnapshotStatus = "AVAILABLE" | "LEGACY_UNAVAILABLE";
```

它不保存source坐标或payload。新direct fork从真实source run复制成功后为AVAILABLE；从AVAILABLE copied run递归fork时复制source child自己的snapshot；从LEGACY_UNAVAILABLE run递归fork时只传播状态。升级前fork缺少status时，runtime只有在message membership证明runId属于copied prefix后返回`LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE`，不猜测source mapping。任意不属于current RequestRun或copied prefix的runId仍安全not-found。

Source session删除不影响child snapshot。Child删除按既有session cleanup删除其snapshot rows和status。Run anchor仍不是RequestRun；cancel/retry/edit/recovery/activeRun对其保持not-found。

## 决策7：message、retry、share和context边界保持不变

- Conversation/message query不返回thinking event。
- Terminal commit不携带thinking bundle。
- Retry创建新run但不隐藏、改写或删除旧run events；UI默认查询visible assistant message对应run。
- Share/export继续只读取messages，不调用event history。
- ActiveContext selector、Context Engine、summary、prompt shaping、provider request和prefix cache不读取timeline history。
- Fork snapshot只服务用户历史展示，不进入child active context或首次submit。

## 失败、恢复和容量

- 最后累计thinking delta append失败：不发布completed delta，不发布后续model terminal boundary；按既有safe failure路径结束。
- Event query storage failure或payload损坏：整页失败，不返回partial data或raw store错误。
- Fork任一event读取、验证、remap或write失败：composite不创建child；已staged promotion按既有路径abort。
- Abrupt crash发生在模型调用producer观察到调用结束前：调用中的thinking可丢失，不回填。
- 每个model invocation最多新增一条durable thinking row；不随token数量增长。
- Fork写放大与source prefix中的durable event数线性相关，复用既有fork resource preflight并新增event count/serialized bytes上限；超过上限在写入前安全拒绝。

## 验证映射

| 行为 | 主要验证 |
|---|---|
| thinking不是message/context | contract + context/prefix-cache regression |
| 调用中的thinking不存、最后累计delta持久化 | runtime + SQLite tests |
| 完成delta先于model invocation terminal | producer ordering tests |
| workflow node terminal不推断thinking完成 | workflow projector regression tests |
| persistence无thinking主路径特例 | unit + architecture/source guard |
| run-scoped event query | runtime facade + route schema/pagination tests |
| shared projector一致 | channel SSE/WS/resume/REST contract tests |
| fork snapshot原子与隔离 | runtime/gateway fork tests |
| source删除与递归fork | fork integration tests |
| lifecycle忽略snapshot anchor | cancel/retry/recovery negative tests |
|旧fork不可用且不猜测|upgrade characterization tests|

## 当前change与后续change边界

当前change交付后端完成thinking delta、persistence、event query、shared projection和fork snapshot vertical slice。后续`establish-conversation-process-history-continuity`只实现frontend history hydration、message/event join、自动折叠、manual override、动画、滚动和三宿主旅程，不重新定义后端事实或fork语义。

安全脱敏、限长、externalize、thinking分享和历史回填继续是独立后续范围。
