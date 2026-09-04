## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.1 查看会话消息流` | 保持普通生命周期 Message-first；当前 Event 只承载封闭、有界且有退出条件的过渡 presentation snapshot | `ts-web-sse-ws-transports` | `FN-1.1 查看会话消息流` |
| `FN-1.2 断线后从上次位置继续` | durable structured presentation 存在时不再同时恢复 Message-derived structured presentation；legacy 数据继续有界兼容 | `ts-stream-history-consistency` | `FN-1.2 断线后从上次位置继续` |
| `FN-5.16 识别和投射结构化工具增量` | 聚合身份按 `(runId, toolCallId)` 隔离，聚合状态有界，Workflow completed product 与其他超限预览保持结构且公开截断事实 | `tool-structured-delta` | `FN-5.16 识别和投射结构化工具增量` |
| `FN-8.1 持久化运行数据` | 聚合结果及 Workflow completed product 的 timeline record 在 gateway 前满足统一 49,000-byte 硬上限 | `gateway-store-provider-ownership` | `FN-8.1 持久化运行数据` |

### 新增目录架构评审

评审结论：`PASS`（2026-08-22）。本 change 新增的 `specs/gateway-store-provider-ownership/`、`specs/ts-stream-history-consistency/` 与 `specs/ts-web-sse-ws-transports/` 目录仅承载对应 canonical spec 的 delta，由当前 active change 拥有，不进入 build/runtime，归档后随 change 目录一起归档。原 `local-run-timeline-store` delta 被删除，不再扩大 legacy spec。

## `FN-1.1 查看会话消息流`

### 目标与规范依据

普通公开过程正文仍遵循 Message-first：生命周期 Event 只保存状态、顺序和强 Message 引用。本 change 只为经过可信 structured-delta 识别与安全校验的 Channel/UI presentation 建立封闭的过渡例外；该 Event body 不代表 Capability 语义结果、模型上下文或请求终态，也不改变 Message-first 长期 owner。

#### 本 Function 的目标 Requirements

canonical spec：`ts-web-sse-ws-transports`

- `MODIFIED`：`可恢复过程事件引用唯一消息正文`

### 当前实现

- `CAPABILITY_STARTED`、`CAPABILITY_COMPLETED` 与 completed Tool-round `LLM_CONTENT_DELTA` 继续通过 `messageId` 恢复 Message 正文。
- `TOOL_STRUCTURED_DELTA` 使用开放 JSON payload，由 runtime 原始 live 投影；当前分支又把可信 structured presentation 聚合为 bounded timeline Event。
- Context renderer 只消费 `CAPABILITY_RESULT` Message，不读取 timeline Event。

### GAP 分析

stable Requirement 当前把所有 ordinary Tool result Event body 都视为 Message 副本，没有区分 Capability 语义结果与经过可信 projector 产生的结构化界面呈现；直接归档会使实现与 Message-first stable 互相否定。

### 修改方案

保留 `CAPABILITY_RESULT` Message 作为 ordinary Capability 语义结果与模型上下文的唯一 durable body。只有通过既有白名单、canonical shape validation 与安全过滤形成的 `TOOL_STRUCTURED_DELTA` 才能在当前兼容阶段形成过渡 presentation snapshot Event；任意 stdout、JSON、Tool 自报字段或 Message 内容不得绕过识别边界创建该例外。

该 presentation Event 只供统一 Channel projector 和 history presentation 使用，不携带 `messageId` 作为模型正文 authority，不得被 Context、Agent Loop、terminal、limitation、fork model context 或 Capability outcome 反向消费。普通 lifecycle Event 的 Message-first 写入顺序与失败语义不变。方案二以后使 canonical Message 能分别承载 semantic result 与 final presentation snapshot 时，系统必须停止在 ordinary Event 中持久化 presentation body；本 change 不提前定义 Message 字段或方案二 disclosure 规则。

`truncated=true` 是该 structured presentation 的可观察事实，不绑定 Event 作为长期 carrier。原 change 新增的 `AgentRunStatePort.flushStructuredDeltaPersistence(...)` 会把私有持久化机制暴露给 Core；本轮选择删除该方法，在 `CAPABILITY_RESULT` Message 写入成功后由 Runtime 私有触发相同 flush，从而保证 Message failure 不留下新的 orphan snapshot。该公共方法删除必须先完成群内确认。

#### 质量属性影响

无新增黑盒质量目标。本 Function 继续保持既有可靠性/恢复边界；定向回归验证 Context 不读 Event、普通 lifecycle 不恢复 Event body，并验证 structured presentation 的封闭 consumer 边界。

## `FN-1.2 断线后从上次位置继续`

### 目标与规范依据

history 必须为同一 Tool 调用选择唯一 presentation 来源：process-history eligible 的非 `ANSWER` 新数据使用 durable structured presentation Event；只有缺少该 Event 的 legacy 数据继续从 `CAPABILITY_RESULT` Message 派生兼容 envelope。ordinary `ANSWER` 继续使用既有 Message-derived answer projection，不从 event-history 恢复。两种来源不得同时呈现。

#### 本 Function 的目标 Requirements

canonical spec：`ts-stream-history-consistency`

- `MODIFIED`：`结构化过程正文使用单一 Message 恢复`

### 当前实现

- `conversationAdapter` 会从 canonical structured shape 的 `CAPABILITY_RESULT` Message 生成一个 `TOOL_STRUCTURED_DELTA` history envelope。
- `composeTurnProcessHistory` 会把 conversation-derived base envelopes 与 run event-history envelopes 合并；当前只处理同 eventId、thinking step、process content step 和 `CAPABILITY_COMPLETED`/result association，不会消除同一 `(runId, toolCallId)` 的 Message-derived structured envelope 与 persisted structured Event。
- 本分支持久化 ordinary structured presentation 后，DETAIL、PIU、DSL 等非 terminal structured presentation 可以同时从两条来源进入合并结果。

### GAP 分析

代码已经形成两个 presentation 候选，但没有 canonical selection，可能重复展示并让后续方案二面对不确定 authority。完全删除 Message-derived 投影又会使 change 之前的 legacy history 丢失 structured presentation。

### 修改方案

`composeTurnProcessHistory` 在当前 run 范围内先收集通过既有 history eligibility 过滤的可信 persisted `TOOL_STRUCTURED_DELTA` 非空 `toolCallId`。合并 base envelopes 时，如果某个 Message-derived history envelope 同为 `TOOL_STRUCTURED_DELTA` 且具有相同 `toolCallId`，则不再加入结果；该 Tool 调用的 process presentation 以 Event 集合为准。没有 matching eligible Event 时继续保留既有 Message-derived envelope 作为 legacy compatibility projection。ordinary non-Workflow `ANSWER` Event 继续被 canonical answer filter 排除，因此 matching Message-derived answer 保留。

选择规则只作用于 UI/history presentation，不删除 Message、不改变 Message 的 Context/model 可见性，也不按正文相等、前缀或相似度去重。Workflow inner product 继续使用既有 Event-owned 例外；terminal Assistant answer 继续使用 Message owner，并由后续 Issue #823 change 单独收敛。

#### 质量属性影响

无新增黑盒质量目标。本 Function 继续保持既有可靠性/恢复边界；定向回归验证新数据无重复、legacy 可恢复、跨 run/Tool 不误抑制。

## `FN-5.16 识别和投射结构化工具增量`

### 目标与规范依据

本 Function 继续负责结构化 Tool 增量的契约可见识别与投影。本次只收敛已经引入的聚合持久化：不同 run 的同名 Tool 调用必须隔离，聚合驻留必须有界，历史内容发生截断时必须保持结构并显式投影该事实。

#### 本 Function 的目标 Requirements

canonical spec：`tool-structured-delta`

- `MODIFIED`：`Stream Envelope Projection`
- `MODIFIED`：`Streaming TOOL_STRUCTURED_DELTA Persistence`
- `ADDED`：`结构化增量按run与Tool调用隔离聚合`
- `ADDED`：`PIU累积uuid合并持久化`
- `ADDED`：`STREAM_DSL按content.type聚合持久化`
- `ADDED`：`其他结构化增量按接收顺序持久化`
- `ADDED`：`结构化增量聚合状态有界`
- `ADDED`：`结构化增量显式flush与run终止兜底flush`

### 当前实现

- `RuntimeOwnedAgentRunStatePort` 在一个 coordinator 中共享一个 `StructuredDeltaPersistenceAccumulator`；不同 session lane 可以并发执行。
- accumulator 的 `accept` 虽接收 `runId`，私有 `groups` 却只以 `toolCallId` 为 key；`flush(toolCallId)` 也不携带 run 坐标。不同 run 的相同 `toolCallId` 会复用同一 group。
- 原 change 在 `agent-contracts/runtime.AgentRunStatePort` 新增 `flushStructuredDeltaPersistence(...)`，并由 Core 在 `CAPABILITY_RESULT` Message 追加前显式调用；这既把 Runtime 私有 persistence mechanism 暴露为公共 contract，也可能在 Message 写入失败时留下 orphan presentation snapshot。
- `passthroughQueue`、PIU `dataParts`、STREAM_DSL 拼接字符串和 group 数量没有 item/byte/group 上限。
- runtime 已在 direct flush 与 `finishRun` fallback 中调用 `truncateTimelineInlinePayload`，并在超限时写入 `truncated=true`。
- 现有截断 helper 会把超限的非字符串 `content` JSON 化为字符串；当非 `content` shell 自身超限时，返回结果仍可能超过 49,000 bytes。
- channel 的 `TOOL_STRUCTURED_DELTA` 投影保留内容与关联字段，但丢弃 `truncated`。
- Workflow projector 会把 `NODE_OUTPUT_DELTA` 作为实时 fragment 发出，并在 `NODE_COMPLETED` 产生携带完整累积内容、`accumulated=true` 的 durable product。该 product 不进入 accumulator，而是走通用 persisted event 路径；当原始 `inlinePayload` 超过 49,000 bytes 时，通用 guard 当前只发布完整 `LIVE_ONLY` 事件并跳过 append，导致 settled live 有 completed product、刷新后的 history 没有对应 product。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| `(runId, toolCallId)` 隔离 | 状态和单组 flush 只按 `toolCallId` | 并发 run 可串组、串写或互相清除 |
| Message-first 写入顺序 | Core 通过公共 port 在 Message 追加前 flush | Message 失败可能留下 orphan snapshot，且公共 contract 冻结过渡实现 |
| 聚合状态有界 | group、queue、PIU parts、DSL string 无界 | 外部 Tool 数据可导致进程内存持续增长 |
| 结构保真 | 非字符串超限后变成字符串 | history 读取方无法继续按 PIU/DSL shape 解析 |
| 截断显式可见 | 持久化 marker 未进入 channel 投影 | live 显示完整而 history 静默变短 |
| terminal 语义独立 | 当前代码未生成 terminal 事实，但缺少负向门禁 | 后续 completion change 可能误把截断映射为 limitation |
| Workflow completed product 可恢复 | 超限 product 被通用 guard 改为仅实时事件 | live fragment/product 与刷新后 history 不一致，远端没有可恢复的 completed product |

### 修改方案

#### 1. run-scoped 私有状态

accumulator 使用 `Map<runId, Map<toolCallId, AccumulatorGroup>>`。私有单组 flush 签名为 `flush(runId, toolCallId)`；`flushAll(runId)`、`clearRun(runId)` 和 `hasPending(runId)` 只访问指定 run 的内层 Map。Runtime 在成功追加带非空 `toolCallId` 的 `CAPABILITY_RESULT` Message 后私有调用单组 flush；Core 不再调用或感知该持久化机制，`AgentRunStatePort.flushStructuredDeltaPersistence(...)` 被删除且不提供 replacement。

同一 run 内继续按 `toolCallId` 聚合；不同 run 即使 `toolCallId` 完全相同，也不得读取、删除或持久化对方的 group。`beginRun` 只清理该 run 的旧状态，`finishRun` 只兜底提交该 run。

#### 2. 有界聚合与到界分批提交

固定内部预算如下，不新增配置：

| 预算 | 上限 | 测量边界 |
|---|---:|---|
| 每个 run 的待处理 Tool 调用 group | 64 groups | 内层 Map 中尚未提交的 group 数 |
| 每个 group 的待处理源事件 | 256 events | 每次成功接收的结构化增量计 1 |
| 每个 group 的待处理源载荷 | 49,000 bytes | 每个源事件 `inlinePayload` 经 `JSON.stringify` 后的 UTF-8 bytes 累加 |

`accept` 返回需要立即提交的已完成批次。接收新事件前若将超过 group 的 event/byte 上限，先关闭并移出当前 group，把聚合结果返回给 `agent-run-state-port` 通过既有 direct write 路径提交，再以新 group 接收当前事件。创建新 group 时若 run 已有 64 groups，按 Map 插入顺序移出最早 group 并返回其聚合结果，再创建新 group。单个源事件本身超过 49,000 bytes 时不进入 accumulator，直接返回给 direct write 路径执行结构保真的单记录归一化。

该方案使驻留状态确定有界，同时尽量保留完整内容；到界只改变持久化批次数，不改变 live subscriber 已收到的事件，也不引入新的 store 或异步后台队列。

#### 3. 聚合规则

- PIU + 非空 `uuid`：同一 group 内按 `uuid` 追加 `content.data`；输出保留第一条的其他字段并将 `data` 设为数组。
- PIU 无 `uuid`：按接收顺序透传。
- STREAM_DSL `type=dsl`：顺序拼接内层字符串；`dataModel`、`done`、`error` 到达时先关闭当前 dsl buffer，再按接收顺序透传该事件。
- TEXT、DSL、ACTION、OPERATOR、FILE：按接收顺序透传。
- 聚合批次到界或正常 flush 都复用同一 `collectGroupResults`，避免第二套合并语义。

#### 4. 结构保真的单记录归一化

`truncateTimelineInlinePayload` 以最终 `JSON.stringify(payload)` 的 UTF-8 bytes 为唯一测量结果。未超限时原样返回；超限时设置 `truncated=true` 并按 `toolMessageType` 处理：

- TEXT 或其他字符串 content：在 UTF-8 code point 边界保留前缀。
- PIU：保留 content 对象、`uuid` 等固定字段和 `data` 数组，只保留能完整放入预算的 data 前缀项；单个 data 项不能完整放入时不保留该项。
- STREAM_DSL `type=dsl`：保留 content 对象与 `type=dsl`，只截断内层 `content` 字符串。
- 其他数组：保留能完整放入预算的前缀元素；其他对象：保留能完整放入预算的键值前缀；不得把对象或数组序列化为字符串冒充原 shape。

如果可选 shell 字段导致记录仍超限，按序移除可选字段；`capabilityId`、`toolCallId`、`toolEventType`、`toolMessageType`、`content` 和 `truncated` 为通用结构化历史所需最小字段。Workflow completed product 还必须保留 `accumulated`、`workflowEventType`、`nodeId`、`nodeType`，并在存在时保留 `nodeExecutionId` 与 `parentToolCallId`。有效结构化事件的最小 shell 受既有 contract 长度约束，能够落入 49,000-byte 上限。归一化函数在返回前执行最终 byte assertion，任何调用 gateway 的路径不得绕过。

#### 5. 截断投影与失败边界

channel 在 `TOOL_STRUCTURED_DELTA` payload 顶层复制布尔 `truncated`；字段缺省表示未发生持久化内容截断。`metadata.accumulated` 语义不变。

截断是结构化历史预览事实，不是 request terminal fact。runtime 不发布 `DEGRADATION_NOTICE`，不创建新的 request-level terminal fact 或 annotation，也不改变 run status。真实 `timelineStore.appendEvent` 失败仍向上传播；不得 blanket catch 或 fail-open。诊断只允许记录 event type、原始/持久化 byte 数、truncated 与 direct/fallback 路径，不记录业务正文。

#### 6. Workflow completed product 的 settled 一致性

Workflow `NODE_OUTPUT_DELTA` fragment 继续保持 `LIVE_ONLY` 并按原始内容实时投影；本 change 不截断 fragment，也不把它放入非 Workflow accumulator。对于匹配既有 Workflow product contract 的 `NODE_COMPLETED` `TOOL_STRUCTURED_DELTA`，runtime 在构造包含可信 propagation attributes 的 record payload 后调用同一个 `truncateTimelineInlinePayload`，再执行既有 `appendEvent`。

append 成功后，`onTimelineAppend` 只发布 gateway 返回的 persisted record。超限 completed product 不再额外发布一份完整 `LIVE_ONLY` completed event，因此 settled live 与 cold history 都看到相同的有界 `content` 和 `truncated=true`；容量内 product 保持原样。真实 append failure 仍由既有调用栈传播；不得为了保住实时完整 completed product 而吞掉写失败或伪造 durable 成功。

#### 质量属性影响

| 质量属性 | 规范依据 | 实现机制 | 验证关注点 |
|---|---|---|---|
| 性能/容量 | `结构化增量聚合状态有界` | 固定 group/event/byte 预算与同步分批提交 | 上限边界、单事件超限、多字节输入、无界增长负例 |
| 可靠性/恢复 | `结构化增量按run与Tool调用隔离聚合`、`结构化增量显式flush与run终止兜底flush` | nested Map、run-scoped flush/clear、direct/fallback 同策 | 同 ID 并发 run、显式/兜底 flush、append 失败传播 |
| 安全 | `结构化增量聚合状态有界` | 不在日志输出正文；结构化最小 shell 保留可信关联字段 | 跨 owner/session 不串写、日志无原始内容 |

## `FN-8.1 持久化运行数据`

### 目标与规范依据

本 Function 负责 timeline durable fact 的统一 gateway 边界。本次要求聚合记录和 Workflow `NODE_COMPLETED` structured product 在进入任何 local/remote binding 前都满足相同的 49,000-byte 单记录不变量，且真实存储错误仍显式传播。

#### 本 Function 的目标 Requirements

canonical spec：`gateway-store-provider-ownership`

- `ADDED`：`结构化增量记录在统一timeline gateway前有界`

### 当前实现

- local 与 remote composition 通过 Working Memory bindings 注入同一个 `RunTimelineEventStoreGateway` contract；仓内 remote package 不拥有 repo 外服务端 adapter 实现。
- direct structured flush 与 `finishRun` fallback 已在 gateway 调用前使用同一 truncation helper。
- 现有测试只使用接受任意大小的 mock `appendEvent`，未证明 remote API 的真实 50,000-byte 边界。
- helper 对普通大 content 生效，但不能保证超大 shell 的最终 serialized bytes，也不能保持所有 JSON shape。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| gateway 前确定满足 49,000-byte 上限 | 常见 content 场景满足，shell 场景不保证 | 远端仍可能返回容量 400 |
| Workflow completed product 可持久化 | 超限时通用 guard 跳过 append | settled history 缺失且同类 structured record 未同策 |
| local/remote 同形 | active design 声称 local-only | 设计没有反映统一 binding 事实 |
| direct/fallback 同策 | 两条路径调用同一 helper | 需要补边界与结构回归证据 |
| append 失败显式 | await append 并传播 | 必须保持，不得因容量治理改为 best-effort |

### 修改方案

runtime 在构造 `RunTimelineEventRecord` 时统一执行 FN-5.16 定义的归一化，并在调用 `RunTimelineEventStoreGateway.appendEvent` 前断言 `Buffer.byteLength(JSON.stringify(inlinePayload)) <= 49_000`。显式 flush、聚合到界批次、非 Workflow `accumulated=true` direct write、`finishRun` fallback 与 Workflow `NODE_COMPLETED` direct append 都复用同一 normalizer；gateway adapter 不再承担业务 payload 缩减。

本 change 不实现 repo 外 remote adapter。contract test 使用一个在超过 50,000 bytes 时拒绝的 gateway fixture，证明 runtime 发出的记录已低于服务限制；预发再用原 Issue #820 场景核验部署 image 与真实 remote service。

真实 serialization、认证、连接或 storage failure 继续由既有 gateway/error normalizer 处理并传播；只有可在 runtime 确定处理的 inline content 容量通过有界归一化避免远端 400。

#### 质量属性影响

| 质量属性 | 规范依据 | 实现机制 | 验证关注点 |
|---|---|---|---|
| 性能/容量 | `结构化增量记录在统一timeline gateway前有界` | gateway 前最终 UTF-8 byte assertion | 49,000 边界、50,000 拒绝 fixture、direct/fallback/Workflow completed parity |
| 可靠性/恢复 | `结构化增量记录在统一timeline gateway前有界` | 同一 normalization 路径；真实 append failure 不吞 | remote-contract 负例、append reject 传播 |

## 跨 Function 协作与端到端流程

1. Tool producer 发出安全校验后的非 Workflow `TOOL_STRUCTURED_DELTA`；live subscriber 立即收到原事件。
2. FN-5.16 以 `(runId, toolCallId)` 接收并聚合；到界时返回一个或多个已完成批次。
3. runtime 将到界批次、显式 flush 或 `finishRun` fallback 的结果交给同一个 direct record builder。
4. FN-5.16 对 inline payload 做结构保真的有界归一化并标记截断；FN-8.1 在 gateway 调用前验证最终 UTF-8 bytes。
5. local 或 remote binding 通过同一 gateway contract 持久化；FN-1.1 使用与 live 相同的 channel projector，并在截断记录上保留 `truncated=true`。
6. FN-1.2 合并 conversation 与 event history：matching structured Event 存在时只使用 Event presentation；缺失时保留 legacy Message-derived presentation。Message 本身仍供 Context/Model 使用，Event 不进入该路径。
7. Workflow `NODE_OUTPUT_DELTA` fragment 继续实时投影；`NODE_COMPLETED` product 在 gateway 前有界化并持久化，成功后由 canonical append 发布同一 record，保证 settled live/history 一致。

### 并行 active change 协调

- `suppress-nonstructured-residue-when-structured-exists` 修改同一 `tool-structured-delta` spec 的另一个 Requirement，并可能先归档；本 change 不改其 terminal residue 语义，归档前必须基于届时 stable 重生成 delta。
- `add-request-run-batch-query` 与 `refine-session-fork-provider-materialization` 修改同一 FN-8.1 canonical spec 的其他 Requirements；本 change 不改其查询或 fork contract，任一先归档时后归档者负责 rebase。
- `refine-ts-agent-gateway-state-store-boundary` 计划把 Working Memory vocabulary 收敛为 StateStore，但尚未进入实现；本 change 不依赖该重命名，也不修改 gateway contract。若该 change 先落地，本 change 必须在归档前把文案和导航重基到 StateStore；若本 change 先归档，state-store change 负责保留本次新增容量 Requirement。
- production code 冲突以实际 diff 为准；本 change 只修改 runtime accumulator/payload、channel projector 及其测试，不借机吸收上述 change 的行为。

## 验证策略

- accumulator 单元测试覆盖同 ID 跨 run 隔离、run-scoped flush/clear、各聚合规则和 group/event/byte 到界行为。
- runtime port 集成测试覆盖 owner/agent/session/run 坐标不串写、显式与兜底 flush 同策、Workflow fragment 排除、Workflow completed product 有界持久化与 settled live/history 同形、subscriber 防重复和 append rejection 传播。
- payload 纯函数与 port 测试覆盖 ASCII、中文/emoji、exact boundary、超大 optional shell、PIU/STREAM_DSL shape 和最终 UTF-8 bytes。
- channel projection 测试覆盖 `truncated` 的 live/history 同形投影。
- frontend process-history 测试覆盖同一 run/tool 的 Event presentation 优先、legacy Message fallback、不同 Tool/run 不误去重；Context/Message tests 继续证明模型输入来自 Message 而非 Event。
- terminal 负向测试断言截断不生成 degradation/limitation 且不改变 terminal status。
- gateway contract fixture 在 50,000 bytes 拒绝，断言 runtime 交付的记录始终不触发该拒绝；该可重复边界测试是代码实施与归档门禁，真实 remote E2E 不伪装为仓内已覆盖。

## 上线后验证（非归档门禁）

- 核验受影响部署的 image digest 或 commit 包含容量修复及其后继变更。
- 使用 Issue #820 原始 IR 大 payload 在 remote 模式复测请求终态、gateway 容量边界与 history 可读性。
- 只记录 commit/digest、event type、原始与持久化 byte 数、截断标记和 direct/fallback 路径，不记录 raw Tool content；该运营证据用于关闭生产事故，不替代仓内自动化验证，也不阻塞代码 change 归档。

## 未选择方案

- 不要求所有 producer 生成全局唯一 `toolCallId`：provider ID 没有跨 run 唯一契约，修改某个 ID 生成器不能建立正确性保证。
- 不把 ordinary Capability 语义结果改成 Event-owned，也不把过渡 snapshot 声明为长期 presentation owner：Message 继续拥有语义结果；Event 只在当前兼容阶段承载可信 structured presentation。方案二以后把 final presentation snapshot 收编到同一 Message 时，删除该 Event body 例外，不改变 Channel projector 的可观察结果。
- 不在本 change 引入 `contentRef` 或方案二的 Message envelope 字段：当前 49,000-byte 约束只适用于 timeline presentation record，长期大正文所有权由对应 Message/terminal change 单独定义。
- 不吞掉 timeline append 异常：这会把真实 durable fact 丢失伪装成成功，破坏 canonical timeline。
- 不把聚合容量做成 provider-specific 配置：49,000 bytes 是当前统一 gateway 前的内部持久化预算。

## 长期基线刷新计划

- stable specs：归并到 `openspec/specs/ts-web-sse-ws-transports/spec.md`、`openspec/specs/ts-stream-history-consistency/spec.md`、`openspec/specs/tool-structured-delta/spec.md` 与 `openspec/specs/gateway-store-provider-ownership/spec.md`；同步消除“所有 structured presentation 必须从 Message 恢复”和“非流式只走 Message 重建”的冲突目标态。
- Functions：刷新 `FN-1.1 查看会话消息流`、`FN-1.2 断线后从上次位置继续`、`FN-5.16 识别和投射结构化工具增量`、`FN-8.1 持久化运行数据` 的处理过程、结果和必要关键规格。
- Features：用户价值与 Function 组成不变，无更新。
- overview：补充结构化历史为有界、可解释预览的长期事实。
- architecture：刷新 conversation process history、stream projection、runtime canonical timeline 与 local/remote gateway 同形写入边界。
- modules：刷新 `agent-runtime`、`agent-channel-common` 与 `agent-web` 模块的聚合、归一化、投影选择职责。
- ADR：更新 `process-message-body-owned-by-message`，保留 ordinary semantic result、长期 presentation 与 terminal answer 的 Message-first 决策，并登记当前可信 structured presentation Event 的封闭过渡例外、consumer 边界和退出条件。
- spec-to-design-map：更新两个 stable specs 到 runtime timeline、channel projection、gateway contract 与验证入口的导航。
