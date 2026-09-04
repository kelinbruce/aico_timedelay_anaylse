## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.11 从消息派生子会话` | 以 child durable facts 定义最新继承轮次的首次操作资格 | `session-fork-from-message` | `FN-1.11 从消息派生子会话` |
| `FN-2.3 重试请求` | 将最新继承 request 作为 child 首次真实执行来源 | `request-retry` | `FN-2.3 重试请求` |
| `FN-2.1 提交请求` | 允许 edit-resubmit 替换最新继承 request | `request-edit-resubmit` | `FN-2.1 提交请求` |
| `FN-1.15 查看分享的会话` | copied retry answer 可在递归 fork 中解析完整冻结问答 | `conversation-share` | `FN-1.15 查看分享的会话` |

## `FN-1.11 从消息派生子会话`

### 目标与规范依据

fork 继续复制消息与只读过程快照，不复制 runtime lifecycle；新增行为只把最新继承轮次暴露为 child 首次操作的输入来源。

#### 本 Function 的目标 Requirements

canonical spec：`session-fork-from-message`

- `ADDED`：`最新继承轮次可作为子会话首次操作来源`

### 当前实现

- fork 事务已写入 `SessionForkSourceRecord`，其中包含 child/source session、source/child anchor message 和可信 owner/Agent Scope。
- copied messages 使用 child-owned `messageId`、`requestId` 和 synthetic run anchor；synthetic run anchor 没有 `RequestRun`，只用于消息分组和 `FORK_SNAPSHOT` 历史读取。
- `SessionForkStoreGateway` 已提供 `loadSessionForkSource` 与 `hasUserMessageAfterForkAnchor`；`SessionMessageStoreGateway` 已可读取 child anchor 和按 request 查询 child messages。
- 默认 conversation bootstrap 在 child 尚无 fork 后用户消息时投影 `forkNotice`，但该 UI 提示不是 runtime 权威，也不会随 cursor/anchor page 返回。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 已有与新建 fork 会话使用同一资格规则 | durable fork source 和 copied messages 已存在 | runtime 尚无复用这些事实的 inherited target resolver |
| 资格只对最新继承轮次、child 未演进且无 active work成立 | gateway 已能判断 anchor 后 user message，lane snapshot 可判断 real work | retry/edit 各自只把“无 latest run”当作 not-found |
| synthetic run anchor 始终只读 | stable fork contract 和 persistence 已保证 | 新 resolver 必须按 copied request 定位，不能把 anchor 升格为 run |
| UI 与 backend 资格一致 | 当前 UI 已按 latest turn 提交 `expectedLatestRequestId` | 无需新 marker；backend 需成为最终权威并安全拒绝竞态 |

### 修改方案

在 `agent-runtime` 内新增一个私有 `resolveInheritedLatestSource` helper，由 retry/edit 共用。它依次：

1. 用 command 的 trusted identity、session-bound `agentId` 和 child `sessionId` 调用 `loadSessionForkSource`。
2. 若不存在 fork source，返回“不适用”，调用方保持普通路径。
3. 调用 `hasUserMessageAfterForkAnchor`；若为 true，返回 stale/not-eligible。
4. 读取 child anchor assistant message，并按其 child-owned `requestId` 查询 child messages；要求 `expectedLatestRequestId` 精确匹配、恰好一个可见 canonical `USER` message，且 anchor 属于该 request。
5. 同时读取 session lane snapshot；只在没有 `latestRun/latestRequestId` 时返回 inherited source。出现 real run 时调用方按普通 latest 规则处理。

helper 返回仅限 runtime 私有、不可持久化的：

```ts
interface InheritedLatestSource {
  readonly requestId: MessageId;
  readonly copiedRunAnchor?: RequestRunId;
  readonly inputText: string;
  readonly attachmentIds: readonly AttachmentId[];
  readonly requestModelOptions?: RequestModelOptions;
  readonly routingConstraints?: RoutingConstraints;
  readonly sourceMessageIds: readonly MessageId[];
}
```

所有字段 trusted source 均为 child-owned durable message/fork facts；`copiedRunAnchor` 只作为 child 内附件 authority 复校验和 message visibility replacement 的已有定位坐标，不进入新 run lineage。metadata 解析继续使用现有 runtime schema/helper，非法或 source-bound 引用 fail closed。该对象不跨 package、不新增 gateway contract。

Agent Web 不新增 `forkInherited` metadata 或资格缓存。现有 latest-turn 操作入口继续提交 `expectedLatestRequestId`；runtime 负责最终资格判定，因此旧 fork 会话、刷新、分页与多宿主无需 backfill 或平行逻辑。若其他分支引入“对 `forkInherited` 禁用操作”的投影，集成时必须移除该禁用，不能让客户端覆盖 backend 目标能力。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；由 `最新继承轮次可作为子会话首次操作来源` 派生 | resolver 只消费 child scope durable facts，不读取 parent runtime | forged scope、parent-only facts、synthetic run direct lifecycle negative cases |
| 可靠性/恢复 | 无新增黑盒质量目标；同上 | 不依赖 process-local marker 或仅 bootstrap 可见的 `forkNotice` | restart、旧 fork、分页后操作 |

## `FN-2.3 重试请求`

### 目标与规范依据

inherited retry 是 copied request 在 child 中的首次真实执行；一旦创建 attempt `1`，后续控制全部回归普通 runtime lifecycle。

#### 本 Function 的目标 Requirements

canonical spec：`request-retry`

- `MODIFIED`：`Retryable request 状态分类`
- `MODIFIED`：`Retry 创建同一 request 的新 attempt`
- `ADDED`：`Inherited retry 保持 child 隔离`
- `ADDED`：`Retry 新 run 自动展开实时过程`
- `ADDED`：`Inherited retry 可幂等恢复`

### 当前实现

- `retryLatest` 先按 scoped idempotency anchor 查 accepted retry，再读取 `loadSessionLaneSnapshot`；没有 `latestRun` 即返回 `REQUEST_RETRY_NOT_FOUND`。
- `add-request-retry-attempt-limit` 已在当前 main 代码中把普通 request 的最高 attempt 固定为 `6`，其 active change 尚待归档。
- 普通 retry 从 source `RequestRunRecord` 继承 assembly，创建 `source.attempt+1` 和 `retryOfRunId`，重用原 request 的用户消息，接受后隐藏旧 attempt 输出。
- existing replay 校验要求 `retryOfRunId` 存在，因此不能识别 inherited attempt `1`。
- retry root message、附件复校验、scheduler admission、checkpoint、canonical event、visibility handoff 和 recovery 均已有实现路径。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 无 real run 的最新继承 request 可首次执行 | 无 latest run 直接 not-found | 缺少 inherited resolver fallback |
| 首个 child run 为 attempt `1` 且无 synthetic/parent lineage | 普通路径固定 attempt+1 和 retryOf | 缺少独立的 run assembly 分支 |
| 使用 child 当前可信 assembly | 普通 retry继承 source run assembly | inherited source 没有 source run，需要从 session-bound Agent registry 选择 |
| restart/idempotent replay 不创建第二个 attempt1 | replay 要求 retryOfRunId | 需要允许同 semantic、requestId、attempt1 且无 retryOf 的 accepted anchor |
| 成功后隐藏 copied output、失败保留 | 普通 visibility helper需要 source run | 需要按 inherited source message IDs 执行相同 reason 的 child-only replacement |

### 修改方案

`retryLatest` 保持普通路径不动，仅在 scoped lane snapshot 不存在 real latest run 时调用上一节 resolver：

- resolver 不适用或资格失败：维持既有 safe not-found/stale/conflict。
- resolver 成功：从 child session 当前 active assembly 创建同一 copied `requestId` 的新 `RequestRun`，`attempt=1`、新 `runId`，省略 `retryOfRunId`/parent lineage；以 copied canonical user message 重建 `SubmitRequestCommand` 和 `RequestContext`。
- 复用既有 attachment revalidation、scheduler capacity、`saveRun` acceptance anchor、checkpoint、enqueue、`REQUEST_ACCEPTED` 和 terminal lifecycle。
- accepted 后按 resolver 的 source message IDs 隐藏 copied assistant/capability output，reason 仍为 `RETRY_REPLACED`；不隐藏 canonical user message，不访问 parent。
- replay 分支以 idempotency semantic、child requestId、`attempt=1` 且无 `retryOfRunId` 识别 inherited accepted run；普通 retry 继续要求 previous link。visibility handoff 必须可幂等补完。
- attempt limit 保持同形：inherited attempt `1` 是 child original execution，不增加 retry 计数；后续 attempt `2` 至 `6` 继续对应第 1 至第 5 次 retry，普通上限逻辑无需新增配置或平行计数器。

不新增 `RequestRunRecord` 字段或新事件类型。attempt `1` 本身表达“child 首次真实执行”，synthetic anchor 不进入 runtime lineage；这是避免伪造 previous run 的最小方案。

Agent Web 必须区分两种 run identity：history projection 持有的 `displayRunId` 仅表示已持久化过程历史的加载 authority；当前 live/settled envelopes 的最新显式 `runId` 表示过程面板 disclosure scope。retry command 一进入 pending，投影就必须把该 source root 切换到新的待接管 attempt：暂时不展示旧 attempt 的 assistant/process envelopes；HTTP acceptance 返回真实 `runId` 后，以该 run 绑定新 disclosure scope 并展示实时过程；acceptance 前失败则恢复原轮次。不得等第一条 think 或 terminal reload 才清除旧过程。live run identity 不得覆写持久化 `displayRunId` 或触发额外历史事件加载；否则实时流与历史回填会形成双来源竞争。这样新 retry run 使用独立 disclosure scope并按既有 running 默认规则自动展开，旧 run 的用户折叠选择不会继承，同时历史加载仍只由已持久化目标驱动。该规则同时适用于普通 retry 与 inherited retry，不新增 fork 专用分支。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Inherited retry 保持 child 隔离` | child-only resolver、attachment revalidation、无 parent lineage | parent stores 不被调用、附件 fail closed |
| 可靠性/恢复 | `Inherited retry 可幂等恢复` | 复用 durable acceptance anchor并幂等补完 visibility | restart replay、acceptance 后 visibility 中断 |

## `FN-2.1 提交请求`

### 目标与规范依据

edit-resubmit 可把最新 copied 用户输入替换为新的 child request，同时保持既有 append-only acceptance、latest-wins 和 failure rollback。

#### 本 Function 的目标 Requirements

canonical spec：`request-edit-resubmit`

- `MODIFIED`：`Edit-resubmit command SHALL preflight the observed latest request`
- `ADDED`：`Inherited edit 创建独立 child replacement`

`request-edit-resubmit` 已稳定承载 edit-resubmit 黑盒行为但尚未在 FN-2.1 文档中标为主规格；本 change 将其确认为 canonical spec。FN-2.1 当前导航的其他提交/lane/idempotency specs 保持遗留规格，本 change 不迁移其未触及 Requirements。

### 当前实现

- `editLatest` 的 preflight 强制要求 `loadSessionLaneSnapshot` 返回 `latestRun/latestRequestId`；fresh fork child 因没有 real run 返回 `EDIT_LATEST_NOT_FOUND`。
- accepted edit 已使用 active session assembly，创建新 request/run/context/checkpoint/user message，并以 `editedFromRequestId` 发出 `REQUEST_ACCEPTED`。
- source replacement 已按 `expectedLatestRequestId` 调用 request-scoped message visibility write，适合 child copied request。
- edit 的 idempotency replay、attachment authority、optimistic UI reconciliation 和 point-in-time latest preflight 已存在。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| copied latest request 可通过 preflight | preflight 只识别 lane latest run | 缺少 inherited resolver fallback |
| accepted 后使用既有 replacement | request-scoped hide 已可覆盖 copied request | 需要确认仅在 durable acceptance 后调用且 replay可补完 |
| 不读取 parent runtime | current edit无需 parent，但新 fallback 若设计不当可能追溯 source | 必须复用 child-only resolver |
| 保持现有并发模型 | preflight 是 point-in-time optimistic check | 不得借本 change 增加不完整的 CAS 或新 gateway state |

### 修改方案

`editLatest` 保持普通 snapshot preflight；仅在 snapshot 没有 real latest run 时调用共享 inherited resolver。resolver 成功后：

- 继续使用现有 `assemblyRegistry.active(session.agentId)`、新 request/run/context、attachment revalidation、acceptance、checkpoint、event、latest-wins、enqueue 和 request-scoped `EDIT_REPLACED`。
- `editedFromRequestId` 使用 child copied requestId；source replacement 只作用于 child session 同 request messages。
- idempotency semantic 不变，现有 accepted run anchor可恢复首次结果并补完 visibility。
- acceptance 前任一失败均不调用 source hide；point-in-time preflight 与并发竞态保持 stable spec 已声明的边界。

Web contract 和 Composer 流程不改。当前 latest turn 的 edit action、draft、text-only 限制和失败 rollback 均继续复用。

Agent Web 的 optimistic replacement 必须以 source request 的 `rootMessageId` 为统一轮次身份，同时更新 retained `SessionConversationMessage`、history envelope 和 live/settled envelope 三层投影。三层只表达同一份 canonical visibility，不得让未更新的 message layer 在 selector 中重新生成已隐藏的 assistant answer。实现扩展既有 `optimisticallyEditRoot`/rollback 对称逻辑，不新增 `forkInherited` 判断；因此普通 edit 和 inherited edit 走同一条完整轮次替换路径。

新 request accepted 后，本地 superseded mapping 继续重绑定到 accepted root；acceptance 前失败则同时恢复三层 source visibility。会话切换可继续复用缓存，但缓存中的 source 完整轮次已经隐藏；authoritative reload 仅用于最终对账，不作为清除旧答案的必要条件。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；由 `Inherited edit 创建独立 child replacement` 派生 | child-only source、既有 attachment authority、request-scoped hide | parent不变、跨 scope、附件失败 |
| 可靠性/恢复 | 无新增黑盒质量目标；同上 | 复用 accepted idempotency anchor与 visibility 补完 | restart replay、acceptance 前后故障边界 |

## `FN-1.15 查看分享的会话`

### 目标与规范依据

递归 fork 会为不同 source run 铸造不同 child run anchor。若 source 可见答案来自 retry，则 canonical USER 仍属于原 attempt run，而 copied answer 属于 retry run anchor；二者共享 child-owned `requestId`。分享冻结的是所选答案 run，不应因此把存在的完整问答误判为删除。

#### 本 Function 的目标 Requirements

canonical spec：`conversation-share`

- `ADDED`：`Copied retry answer 的冻结分享保持完整`

### 当前实现

- `ConversationShareService.loadSharedConversation` 按冻结 `sessionId + runIds` 读取创建者 scope 内的 messages，并分别处理真实 `RequestRun` 与无真实 run 的 copied run anchor。
- 真实 `RequestRun` 分支已按 run 的 `requestId` 从同 session messages 补齐 canonical USER，并把返回范围限制为该 USER 与 selected attempt messages。
- copied run fallback 只在 selected run messages 内查找 USER。retry 后 fork 会让 canonical USER 与 selected answer 使用同 request 的不同 child run anchor，因此该 fallback 将仍存在的内容误判为 `SHARE_CONTENT_DELETED`。
- 当前读取已经一次性加载同 session、同 frozen creator scope 的 messages，无需新增 Gateway 查询或 parent/ancestor 回源。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| copied retry answer 可补齐唯一 canonical USER | USER 与 selected answer 共享 child-owned `requestId`，但可使用不同 run anchor | copied fallback 把 USER 错误限定在 selected run |
| 分享只返回冻结 selected run 内容 | `runIds` 已冻结，真实 run 分支已有 request-scoped USER 补齐 | copied fallback 需只跨 run 补齐一个 USER，不得带入同 request 的其他 run 输出 |
| 非唯一或损坏数据 fail closed | 当前缺少 USER 时返回 `SHARE_CONTENT_DELETED` | 扩展查找后仍必须要求 request identity 和 USER 恰好唯一 |

### 修改方案

`ConversationShareService.loadSharedConversation` 保持真实 `RequestRun` 分支不变。仅在 selected copied run anchor 没有真实 `RequestRun` 时：

1. 从 selected run messages 中要求恰好一个非空 `requestId`，并要求至少一个 readable assistant answer。
2. 在同一 frozen creator scope、同一 `sessionId` 已读取的 messages 中，按该 `requestId` 查找恰好一个 readable canonical USER；USER 可具有同 request 的另一 child run anchor。
3. 结果只加入该 canonical USER 与 selected run messages；不得加入该 request 的其他 run assistant/capability messages，也不得读取其他 session。
4. USER 缺失、多于一个、request identity 不唯一或 selected answer 缺失时继续返回 `SHARE_CONTENT_DELETED`。

该方案不新增 persistence snapshot、Gateway API 或父会话回源。冻结边界仍由 `ConversationShareRecord.sessionId + runIds` 确定；跨 run 只允许补齐同 request 的单个 canonical USER。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Copied retry answer 的冻结分享保持完整` | 只在冻结 creator scope/session 内按唯一 request 补齐 USER，assistant/capability 内容仍限 selected run | 同 request 其他 attempt 不泄漏、跨 session/ancestor 不读取、非唯一关联 fail closed |
| 可靠性/恢复 | `Copied retry answer 的冻结分享保持完整` | 读取完全依赖 durable share/message facts，不依赖运行中进程或 parent runtime | replacement 后原分享继续可读、reload/restart 结果一致 |

## 跨 Function 协作与端到端流程

`FN-1.11` 的 shared resolver 只判定并返回 child-owned inherited source；不创建 runtime facts。`FN-2.3` 和 `FN-2.1` 分别拥有 retry/edit acceptance，并复用已有 scheduler、persistence 和 projection。

共同优先级固定为：

| lane snapshot | inherited source | 处理路径 |
|---|---|---|
| 存在 real latest run | 任意 | 普通 retry/edit；不得回退到 inherited |
| 不存在 real latest run | 合格 | inherited retry/edit |
| 不存在 real latest run | 不存在或不合格 | 既有 safe not-found/stale/conflict |

在命令 preflight 后并发出现新 lane work 时，继续采用现有 point-in-time optimistic/latest-wins 行为；本 change 不声称原子拒绝该竞态。跨 Function E2E 必须证明：fork → inherited action → child live/history → reload → subsequent normal action → share 均只形成 child facts。

### Replacement 后再次 fork 的事件引用

retry 和 edit 接受时会在 canonical `REQUEST_ACCEPTED` payload 中分别记录 `retryOfRunId` 和 `editedFromRequestId`。当用户在 replacement 后再次 fork 时，这两个字段与 `requestId`、`runId`、`requestRunId`、`messageId`、`rootMessageId`、`parentMessageId`、`terminalMessageId` 和 `selectedMessageRefs` 属于同一类 typed durable reference，必须通过现有 fork ID map 统一重映射为 child-owned ID。

实现继续采用按 reference kind 分类的 key set，不新增 retry/edit 专用 fork 分支：

| reference kind | payload keys |
|---|---|
| message | `messageId`、`rootMessageId`、`parentMessageId`、`terminalMessageId`、`selectedMessageRefs` |
| request | `requestId`、`editedFromRequestId` |
| run | `runId`、`requestRunId`、`retryOfRunId` |

已识别 typed reference 若在 copied prefix 中没有映射，fork 必须 fail closed；未知字段携带 source-bound ID 时仍必须以 `SESSION_FORK_EVENT_PAYLOAD_UNSAFE` 拒绝。不得通过放宽未知字符串检查、保留 source ID 或删除 canonical lineage 字段绕过失败。成功 fork 后的消息、事件和过程快照不得包含 source message/request/run ID，且失败不得产生半成品 child session。

## 跨 Function 质量属性设计（Cross-Function Quality Attributes）

| 质量属性 | 影响 Functions 与规范依据 | 共享或端到端机制 | 端到端验证 |
|---|---|---|---|
| 安全 | `FN-1.11/最新继承轮次可作为子会话首次操作来源`、`FN-2.3/Inherited retry 保持 child 隔离`、`FN-2.1/Inherited edit 创建独立 child replacement` | shared resolver 固定 child scope；两个 acceptance path均禁止 parent runtime reads/writes | fake parent facts、recursive fork、跨 scope和 parent non-mutation integration |
| 可靠性/恢复 | `FN-1.11/最新继承轮次可作为子会话首次操作来源`、`FN-2.3/Inherited retry 可幂等恢复`、`FN-2.1/Inherited edit 创建独立 child replacement` | durable fork source + copied messages判定资格，durable child acceptance anchor恢复结果 | old fork、restart、idempotent replay、visibility handoff |

## 验证策略（Verification Strategy）

- characterization：先锁定普通 retry/edit、fork read-only anchor、point-in-time edit preflight 和现有 Web 操作行为，修改后必须保持。
- runtime unit/integration：覆盖 inherited resolver 正常、旧 fork、recursive fork、child 已演进、active work、stale target、附件失败、acceptance/replay/restart 和 subsequent normal retry/edit。
- persistence/architecture：断言不新增 RequestRun/Gateway schema，不为 synthetic anchor 写 runtime facts，不读取或修改 parent runtime。
- frontend/contract：既有 API schema不变；latest copied turn 的操作可提交，retry pending 后旧过程立即退出展示，真实新 run 使用新 disclosure scope并自动展开，失败恢复原轮次；edit accepted 后在 reload 前完整移除 copied 问答及其操作入口，会话切换和 reload 前后一致；失败保持安全提示、用户草稿和原轮次；若集成分支含 `forkInherited` 禁用逻辑，增加回归测试确保不再禁用。
- end-to-end：验证 fork → retry/edit → live/history reload → process history → recursive fork → share 的用户可观察一致性；特别覆盖 source 可见答案来自 retry、copied USER/answer run anchor 不同的分享。

### 确定性状态机遍历

复合场景验收以确定性 breadth-first state-machine traversal 为主，不以手写 happy-path 列表或随机 fuzz 代替。测试模型从每个可达状态尝试 `fork`、`retry`、`edit`、`share`、authoritative reload、runtime restart 和 idempotent replay；用下列语义状态摘要去重：

- session 来源：native、first-generation fork、recursive fork；
- latest 来源：copied-only、real attempt、edited replacement；
- run 状态：none、active、terminal committed、terminal pending；
- retry 边界：0、1、5 次 accepted retry，以及第 6 次拒绝；
- edit 边界：0、1、连续 2 次；
- share 冻结点：replacement 前、retry 后、edit 后、fork 前、fork 后；
- child 演进：尚未演进、已有 fork 后真实请求。

fork 深度覆盖 `0/1/2`，其中深度 `2` 代表后续递归 fork 的同构持久化与引用重映射路径；edit 连续覆盖 `0/1/2`，其中连续第 2 次代表后续 edit 的同构 replacement；retry 按稳定上限完整覆盖 attempt `1` 至 `6` 和下一次拒绝。遍历器必须保存触发失败的最短 action sequence，确保任何失败都可作为确定性回归用例重放。

每个 action 的守卫、状态变化和拒绝结果固定如下；遍历器必须对每个已访问状态尝试全部 action，不能只生成合法路径：

| action | 成功守卫与状态变化 | 必须覆盖的拒绝或不变结果 |
|---|---|---|
| `fork(anchor)` | anchor 是 scoped、visible、durable assistant；创建独立 child prefix，并把深度增加 1 | 非 assistant、hidden、非 durable、跨 scope、unsafe event reference 均原子拒绝 |
| `retry(latest)` | copied-only latest 创建 child attempt `1`；real terminal-committed latest 创建同 request 下一 attempt，最高为 `6` | active、terminal-pending、stale、非最新、attempt 超限、附件不可用均不产生新 attempt |
| `edit(latest, input)` | copied-only 或 real latest 创建新的 child request/run，并在 acceptance 后执行 `EDIT_REPLACED` | active、stale、非最新、附件不可用及 acceptance 前失败保留 source visibility |
| `share(anchor)` | 对 durable selected content 建立冻结快照；后续 replacement 不改变该快照 | 非法 anchor 或跨 scope 拒绝，且不产生可读取 share |
| `reload` | 从 authoritative persisted facts 重建相同 visible history、latest 资格和 lineage | 不得依赖浏览器缓存或 process-local marker |
| `restart` | 重建 runtime/coordinator 后保持与 restart 前相同的 durable state | 不得回源读取 ancestor runtime，也不得改变 active/terminal 判定 |
| `replay(command)` | 相同 semantic 与 idempotency key 返回首次 durable accepted 结果并补完允许的 handoff | 不得创建第二个 request/run/share/fork child |

覆盖报告必须同时满足：

- 每个已访问语义状态的全部 action 均有 `accepted` 或具体 safe rejection outcome；
- 每一种 guard outcome 至少命中一次，包括 active、terminal-pending、stale、non-latest、retry-limit、attachment-unavailable、cross-scope 和 unsafe-reference；
- 每一种成功转移至少在 native、first-generation fork、recursive fork 中适用的来源上命中；
- `retry → edit → fork`、`edit → retry → fork`、`fork → retry → edit → fork → retry` 和 `fork → edit → retry → fork → edit` 四条复合顺序必须作为固定 replay seeds，不能仅依赖状态去重偶然覆盖；
- 报告输出 visited semantic states、attempted transitions、accepted transitions、safe rejections、guard-outcome counts 和最短失败序列；任一要求计数为零即验收失败。

每个可达状态统一断言：

1. source/parent session 的 messages、run、checkpoint、timeline、lane 和 share 均未被 descendant 操作改写；
2. descendant 的 message/request/run/event references 全部属于 descendant scope，canonical lineage 已重映射且无 source ID 泄漏；
3. default conversation 只显示当前 replacement，hidden facts 仍保留正确 reason 并可审计；
4. replacement 前创建的 share 保持冻结内容，replacement 后创建的 share 只返回所选 attempt；
5. reload、restart 和 idempotent replay 前后，latest 资格、visible history、attempt lineage 与分享结果一致；
6. 非最新、stale、active、terminal-pending、超 retry 上限和跨 scope 操作安全拒绝，且不产生半成品 child facts。

四层验收固定为：

| 层级 | 责任 |
|---|---|
| runtime state model | 遍历所有有界语义状态与合法/非法转移，验证统一 invariants |
| SQLite integration | 使用真实 gateway tables/transactions 验证 visibility、event remap、share freeze 和失败原子性 |
| Web contract | 验证 fork/retry/edit/share 既有 API shape、状态码和 safe error projection |
| browser E2E | 验证代表性最长路径的操作入口、live/history/reload 和分享页面用户可见结果 |

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/session-fork-from-message/spec.md`、`openspec/specs/request-retry/spec.md`、`openspec/specs/request-edit-resubmit/spec.md`：合并本 change delta。
- `openspec/specs/conversation-share/spec.md`：合并 copied retry answer 的冻结分享解析规则。
- `openspec/designs/functions/D1-会话与流式交互/D1.2-会话生命周期管理/FN-1.11-从消息派生子会话.md`、`openspec/designs/functions/D1-会话与流式交互/D1.3-对话标注与分享/FN-1.15-查看分享的会话.md`、`openspec/designs/functions/D2-请求运行时/D2.1-请求提交与控制/FN-2.3-重试请求.md`、`FN-2.1-提交请求.md`：刷新前置条件、处理过程、结果和 spec 导航。
- `openspec/designs/features/D1-会话与流式交互/D1.2-会话生命周期管理/F-1.6-基于历史回复新建会话.md`、`openspec/designs/features/D1-会话与流式交互/D1.3-对话标注与分享/F-1.8-分享对话.md`、`openspec/designs/features/D2-请求运行时/D2.1-请求提交与控制/F-2.3-重试请求.md`、`F-2.1-提交请求.md`：刷新用户可操作边界。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/request-run.md`、`openspec/designs/architecture/runtime-boundaries.md`：刷新 inherited source 与 real run 边界；不新建平行架构主题。
- `openspec/designs/modules/agent-runtime.md`：刷新 shared resolver 与 acceptance owner。
- `openspec/designs/modules/agent-session.md`：刷新 copied run 无真实 `RequestRun` 时的 request-scoped canonical USER 补齐规则。
- `openspec/designs/modules/agent-channel-web.md`：仅在集成时存在 fork action 禁用投影才刷新，否则无。
- ADR：无；不改变 fork isolation、runtime owner 或 latest-wins 的长期决策。
- `openspec/designs/spec-to-design-map.md`：刷新 `request-edit-resubmit` 对 `FN-2.1` 的 canonical 导航，以及 `conversation-share` 的新增验证入口。

## 风险与取舍（Risks / Trade-offs）

- inherited retry 的 `attempt=1` 与动作名称“retry”存在表面差异，但它准确表达 child 没有 previous real attempt；伪造 attempt2/previous link 会污染 recovery、audit 和控制语义。
- current active assembly 可能与 parent 当时执行 assembly 不同。该行为是 child 首次执行而非 parent replay，可避免读取 parent run；UI和文档应使用“重新生成/编辑后提交”的用户语义，不承诺 bit-for-bit 重放。
- point-in-time preflight 允许极窄并发窗口。沿用既有 latest-wins 比新增半套 CAS 更一致；需用 characterization 明确该边界，若未来要求原子拒绝必须独立修改 gateway composite/CAS contract。
- old fork 依赖 durable fork source 和 copied messages 的完整性。数据损坏时 fail closed，不做猜测或 parent 回源修复。

## 迁移与回滚（Migration / Rollback）

- 先归档/稳定 `add-request-retry-attempt-limit` 并合入部署 `harden-conversation-share-replacement-consistency`，再部署本 change；这些 change 均不需要数据 migration。
- 新代码兼容既有 fork 会话，因为不依赖新增持久化 marker。回滚本 change 后，已创建的 child real runs仍是普通 runtime facts并可正常读取；只有尚未执行的 inherited latest turn 恢复为 not-found。
- 回滚不得删除已创建 child run 或恢复已被 replacement 隐藏的消息；它们遵守既有 retry/edit durable semantics。

## 待确认问题（Open Questions）

无。
