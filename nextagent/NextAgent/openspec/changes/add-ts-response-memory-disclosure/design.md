## 背景和现状（Context）

当前长期记忆工具已经具备两类与本 change 直接相关的同步事实：

- `get_memory_detail` 成功后，L2 详情会作为 capability result 进入后续模型调用。
- `add_memory` 成功后，`agent-memory` 已拿到 Store 返回的实际持久化记录，但当前模型可见结果只返回 `longTermMemoryId`、`state`、`briefIndexTruncated`、`createdAt`、`outcome` 和 `nextAction`。当前实现已经用原始 `runId + toolCallId` 派生稳定 idempotency key 调用 Store，Store 也按该键返回首次锚点记录且不重复写入，但 capability descriptor 仍声明为 `NON_IDEMPOTENT`，使 runtime 在调用结果不确定的恢复点拒绝本可安全完成的同 invocation 重放。

当前终态回复只持久化正文和终态状态。Web 的 live 路径读取 terminal event，conversation 路径读取 `SessionMessage` 后重建 terminal envelope；两条路径没有稳定的记忆披露字段。前端若从 `search_memory` 候选、capability delta 或工具参数反推，会把“候选”“实际装入模型”“实际写入”混为一谈，也无法在刷新后保持一致。

`CapabilityInvocationResult.structuredPayload` 当前属于会进入 lifecycle hook、capability result message、后续模型上下文和 live projection 的受控结果。直接给 `add_memory` 的模型可见结果增加完整内容会改变模型上下文。`CapabilityInvocationResult.metadata` 又受小容量和敏感字段检查约束，不适合承载用户记忆内容。因此，本 change 需要在既有 tool loop 内增加一个严格限于可信 memory tool 的前置剥离点，而不是扩展通用 capability result envelope。原始结果仍由 `agent-capability` 执行 output schema 校验并调用该 memory tool 自有的安全诊断投影；诊断只读取 status/reason code，不记录或外发回执内容。

`agent-runtime` 已拥有 checkpoint、恢复、`TERMINAL_COMMIT_PENDING` 和 terminal composite commit；`SessionMessage.metadata` 与 terminal timeline inline payload 已能随终态事务原子写入 JSON。`agent-channel-common` 已从 terminal event 投影 stream envelope，conversation adapter 也会把持久化 message metadata 投影为历史 envelope。本 change 只复用终态承载面，不改变 checkpoint 契约，也不新增表、Gateway 或第二条消息持久化链。

本 change 依赖 `refine-long-term-memory-store-gateway-contract` 已确定的 `memoryId`、有界字符串 `content` 和 `agent-memory` 私有解析边界，实施只使用当前 Gateway contract。当前 `add-ts-memory-application-contract` 同时修改 `agent-contracts/channel`，`stabilize-agent-web-popup-and-scroll` 同时修改共享前端文件；规格可以独立 review，代码必须按依赖顺序串行整合。

相关方包括长期记忆工具 owner、Agent tool loop owner、runtime/session owner、Web channel 与 conversation share 投影 owner、浏览器投影 owner，以及需要审查 `agent-contracts/session` 和 `agent-contracts/channel` 变更的核心契约维护者。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 只在未从 durable execution facts 重建且最终为 `REQUEST_COMPLETED` 的回复底部，让用户看到当前 attempt 实际引用了哪些长期记忆，以及当前 attempt 已经同步新增了哪些长期记忆；恢复执行和 `REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED` 均不生成或展示记忆披露。
- live 和刷新后的 conversation 使用同一份终态事实，不等待异步学习任务，也不从过程事件重建。
- 只在会话 owner 的 live/conversation 中公开披露；conversation share 的服务端投影不暴露用户长期记忆内容或记忆使用清单。
- 保持 `add_memory` 既有模型可见输入和结果不变，终态披露 metadata 不进入后续模型上下文。
- 同步写入已经成功、而请求随后失败、取消或被替代时，长期记忆记录本身保持已提交，但不把它变成该非完成回复或后续 attempt 的用户可见回执。
- 用 request-scoped 状态支持当前连续执行内的并行工具调用，保证全量显示而不是终态截断。
- 让结果不确定的同一次 `add_memory` invocation 可使用原始幂等键安全恢复，避免重复写入；当执行状态需要从 durable facts 重建、无法证明披露链完整时，整个回复省略记忆披露。

**非目标：**

- 不展示页面上下文、RAG 来源、长期记忆来源、版本、标题、跳转、编辑或纠错入口。
- 不披露 `search_memory` 的 L1 候选，也不把“被检索到”当成“被引用”。
- 不把 extraction、dreaming、aging 或其他异步学习结果追加到已经提交的回复。
- 不新增 attempt 历史查看交互；retry、edit、resubmit 和 supersede successor 均不继承前一 attempt 的披露。
- 不新增通用 capability side-effect/effect contract，不给其他 Tool、Skill 或 Agent capability 开放扩展槽。
- 不升级 checkpoint trigger、幂等键、payload 或 recovery guard，也不把 reply disclosure 变成恢复关键事实。
- 不新增 Gateway port、数据库表、列、后台任务、配置项或 feature flag。
- 不按记忆内容做全局或跨调用去重；不同 `toolCallId` 即使内容相同也属于独立 invocation。
- 不修改 `search_memory`、`get_memory_detail` 的 replay policy 或读取副作用；不在本 change 修正通用 runtime replay guard 与 risk-policy 的职责分配。

## 设计决策（Decisions）

### 1. `agent-core` 是 request-scoped 披露事实的主要 owner

新增长期稳定结构 `ResponseMemoryDisclosure`，只包含两个有序集合：

- `referenced`：本 attempt 中实际进入后续模型调用的 L2 记忆快照。
- `created`：本 attempt 中 `add_memory` 已成功提交的记忆快照。

每个条目只包含 `memoryId` 和规范化 `content`。`content` 使用长期记忆现有的 category-discriminated JSON 结构，不另设 `memoryType`；来源、版本、访问次数、Owner Scope 和内部状态不得进入该结构。

结构的稳定类型和 runtime schema 由 `agent-contracts/session` 主承载，作为 `SessionMessage.metadata.memoryDisclosure` 的唯一领域契约。`agent-memory` 拥有写入是否成功以及实际持久化记录这项原始事实；`agent-core` 是本次回复披露集合的主要 owner，负责把受信工具结果判定为当前 attempt 的 `referenced` 或 `created`；`agent-runtime` 只在完成终态读取、校验并提交该 draft；channel 和 frontend 只校验、投影和展示。

按 `memoryId` 去重，保留首次出现顺序，并用同一 memory 在形成最终回复前最后一次成功装入或成功写入的内容替换快照。`referenced` 和 `created` 分别去重；同一记忆同时出现在两组时不跨组消除，因为两组表达不同事实。

放弃由前端扫描工具事件的方案，因为过程事件不具备终态和恢复语义。放弃由 runtime 查询 memory store 的方案，因为 runtime 不拥有记忆业务语义，而且二次读取会增加延迟并可能修改 detail 访问计数和版本。

### 2. `add_memory` 使用 memory-tool-private 写入回执，并在通用消费者之前剥离

`agent-memory` 在 Store 成功返回 ACTIVE record 后解析实际持久化 `content`，在通过 `addMemoryOutputSchema` 校验的 structured result 中增加内部字段：

```text
memoryWriteReceipt = {
  memoryId,
  content
}
```

校验分为两个有序边界。Store 调用前，`agent-memory` 只校验模型输入、规范化后的可持久化 content，以及按该规范化内容预计的单条 receipt 大小；任一项非法或预计超过 24000 bytes 时安全失败且不得调用 Store。Store 成功返回后，`agent-memory` 再校验 ACTIVE record、解析实际持久化 content，并只抽取 `memoryId + content` 构造 receipt；`addMemoryOutputSchema` 对最终 structured result 执行 exact-field 校验。来源、版本、访问次数、Owner Scope 和其他 retained record 字段不得被复制进 receipt，但这类返回结果投影校验不承诺 Store 未被调用。

canonical `add_memory` 的 capability descriptor 固定声明为 `IDEMPOTENT`。该声明只覆盖 runtime 恢复同一 invocation：调用必须继续使用原始 `runId + toolCallId` 派生的 idempotency key，所有选中的 `LongTermMemoryStoreGateway` 实现必须按既有锚点幂等契约返回首次写入记录且不得重复 side effect。若 Store 已提交但 invocation 结果不确定，恢复可用同一 key 重新调用并从首次记录重建相同 receipt。新的 tool invocation 使用新的 `toolCallId` 和 key，不受前一次调用约束，即使规范化内容相同也可创建新记忆。reply disclosure 不参与 replay 判断；从 durable execution facts 重建的 attempt 即使重新形成 receipt，也统一省略回复披露。

这一修改不扩展 `CapabilityReplayPolicy`、idempotency key 或 Gateway public contract；`agent-memory` 拥有 `add_memory` descriptor 和写入语义，Gateway adapter 继续实现既有 store 幂等契约。本 change 只改变 `add_memory` 的 descriptor 和同 invocation 恢复预期，不修改其他 memory tool 的 descriptor，也不调整通用 runtime replay guard、候选筛选与 risk-policy 执行之间的既有职责；该通用恢复治理问题需要独立 change 统一梳理所有 capability，不能借本功能局部改写。

该字段不是新的通用 `CapabilityInvocationResult` 字段，也不进入 `metadata`。`agent-core` 只在 `providerKind=BUNDLED`、`providerId=memory-tools` 且 `capabilityId=add_memory` 的精确可信身份下接受该字段，并执行如下固定顺序：

1. 对原始 capability result 执行通用安全校验。
2. 对 `memoryWriteReceipt` 执行 session contract schema 校验并采集到 request-local `created`。
3. 更新当前连续执行内的保留 draft，但不为 disclosure 新增 checkpoint。
4. 从 structured payload 创建不含该字段的 sanitized result。
5. 只把 sanitized result 交给 `AFTER_CAPABILITY_RESULT` hook、模型消息、capability result message、live delta、日志、metric 和 trace。

除该精确身份外，任何 structured result 出现 `memoryWriteReceipt` 都按 capability result schema violation 安全失败。剥离后的 `add_memory` 成功结果必须与当前模型可见字段完全一致。

选择 memory-tool-private structured field 是因为写入 owner 已经拥有准确的规范化记录，而当前通用 metadata 不能承载该容量和内容。没有扩展通用 capability result contract，是为了避免为一个受控 side effect 建立可被所有 capability 滥用的新通道。没有从输入重建内容，是为了避免 core 重复 `agent-memory` 的 alias、字符串解析和规范化规则。

### 3. 引用按“有效结果进入下一次模型调用”判定

`get_memory_detail` 不增加内部回执。只有 canonical `BUNDLED memory-tools/get_memory_detail` 进入引用判定。tool loop 在 `AFTER_CAPABILITY_RESULT` hook 完成后，从有效 structured payload 中读取成功 L2 条目；只有 capability result message 已经成功写入 canonical request message 后，才把这些条目保存为当前连续执行内的 `pendingReferenced`。这样 lifecycle hook 若拒绝或改变结果，或者 result message 未成功持久化，披露都不会保留模型没有看到的版本。

在下一次 model invocation 的请求已经完成组装、即将提交给 `agent-model` 前，tool loop 才把 `pendingReferenced` 提升为 `referenced`，并把当次实际进入模型上下文的快照写入 request draft。若 tool result 成功但请求在下一次模型调用前失败、取消或被替代，该候选不会计入引用。

最终只有 `REQUEST_COMPLETED` 披露当前 attempt 的 `referenced` 和 `created`；`REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED` 均省略整个 `memoryDisclosure`。这一规则让“本次回复使用/新增”严格对应用户实际看到的完成回复，而不是把已提交但没有形成该回复的外部写入混入其他消息。任何前序 attempt 的 `referenced` 或 `created` 都不得继承，因为它们没有参与当前完成回复的披露语义。

放弃将 `search_memory` 结果计入引用，因为 L1 仅是候选摘要。放弃把成功 detail 立即计入引用，因为它可能没有进入下一次模型调用。

### 4. 披露 draft 只作为当前连续执行的 terminal handoff

`agent-core` 在一次 `Agent.execute` 内通过 `RequestLocalCapabilityState` 维护 collector，并把 JSON-compatible snapshot 同步到 `flowVariables.responseMemoryDisclosureDraft`，供同一次连续执行结束时的 terminal assembly 读取。该 draft 只包含当前 attempt 的 `referenced`、`pendingReferenced` 和 `created`，不包含前序 run 引用、replacement lineage、Owner Scope 或未披露工具参数。

`agent-core` 是 draft 的唯一写入 owner，只维护当前 attempt 的 `referenced`、`pendingReferenced` 和 `created`；进入 terminal assembly 后，`agent-runtime` 只读取、校验，并仅在披露资格成立的完成终态提交最终 disclosure。runtime 不修改 draft，不从 memory tool、Store、模型上下文、capability delta 或前序 attempt 推导引用/新增。该所有权使 terminal handoff 不形成两个并行业务 owner，也不需要新增 typed extension 或 Gateway。

`responseMemoryDisclosureDraft` 是 core/runtime 保留键，不属于 lifecycle hook 可观察或可修改的 planning variables。`agent-core` 在构造 `BEFORE_PLANNING` boundary 时先移除该键；应用 hook 返回值时只合并非保留键，并把可信 draft 原样保留。hook 返回同名字段时直接丢弃并记录不含内容的固定诊断。其他 hook boundary 原本不承载 flow variables，无需新增字段。该选择复用现有 request context 作为 terminal handoff，同时避免增加通用 typed extension。

发生以下边界时必须同步更新 request-local state 和 flow variable snapshot，但不得为 disclosure 额外调用 `saveCheckpoint`：

- 成功采集 `add_memory` 写入回执后、进入 `AFTER_CAPABILITY_RESULT` hook 前。
- `get_memory_detail` 的 hook 后有效结果已成功写入 capability result message，并采集为引用候选后。
- pending 候选在模型调用前提升为 referenced 后。
- terminal assembly 读取 draft 前。

既有 checkpoint 可以因其他 lifecycle 原因附带保存 flow variables，但本 change 不把其中的 disclosure draft 视为完整性证明，也不让 runtime replay guard 读取该 draft。原始 `add_memory` invocation 的恢复继续只依据既有 descriptor、稳定 key 和持久化 capability result facts；runtime 不得按 disclosure 内容改变 replay 决策。任何从 durable execution facts 重建 `RequestContext` 后继续的 attempt 均被 runtime 标记为 disclosure-ineligible，最终省略整段 `memoryDisclosure`。新的 retry/edit/resubmit/successor attempt 由 runtime 创建新的 request context，不复制前序 draft；若原 attempt 最终不是 `REQUEST_COMPLETED`，其 draft 随该 attempt 结束，不形成 reply disclosure。

`flowVariables` 只是当前连续执行内的 request-local terminal handoff，不是公开业务事实或 recovery truth。最终稳定披露只存在于具备披露资格的完成终态 assistant message metadata 和同事务 terminal event。

`add_memory` 在调用 Store 前根据已规范化内容计算预期 receipt 大小；若超过 memory tool 既有 24000-byte 单次安全结果上限，直接安全失败且不得写入，避免产生已经提交但无法通过既有 capability result contract 返回的写入。`get_memory_detail` 继续复用同一既有单次结果限制。本 change 不增加跨调用或每 request 的披露专用总预算，不因累计 disclosure 大小拒绝 Retriever 或 Store；terminal、channel 和 frontend 不得截断、分页或增加 `omittedCount`，实际引用和同步新增多少就完整持久化并展示多少。若未来需要限制 terminal metadata 或 Web payload 总量，必须由统一消息存储与传输容量治理独立定义，不在记忆披露路径建立局部执行门禁。

### 5. runtime 只在披露完整且最终完成时固化当前 attempt 的披露

`agent-runtime` 在 terminal assembly 中读取并校验当前 attempt 的 `responseMemoryDisclosureDraft`。runtime 在私有 queued/executing/terminal 状态中维护“是否从 durable execution facts 重建”的受信标记，不把该标记放入客户端输入、`agent-contracts` public DTO 或 disclosure draft。所有通过既有 `reconstructRecoveryContext` 从持久化运行事实生成 `RequestContext` 的恢复、resume 路径都必须把该私有标记设为 true；fresh submit、retry、edit、resubmit 和 supersede successor 新建的 context 默认为 false，且不得从客户端 metadata 或 flow variable 覆盖。最终结构按以下固定顺序生成：先执行既有 terminal output guard 得到最终规范化 `terminalStatus`，再判断恢复标记和 draft：

- 最终 `terminalStatus=COMPLETED`、执行未从 durable facts 重建且 draft 合法：保留非空 `referenced` 和 `created`；两组均为空时不写 `memoryDisclosure`。
- 执行从 durable facts 重建：无论 draft 是否存在或非空，均不写 `memoryDisclosure`，并记录不含记忆内容的固定 `RESPONSE_MEMORY_DISCLOSURE_RECOVERY_OMITTED` 诊断。
- `REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED`：无论 draft 是否非空，均不写 `memoryDisclosure`。
- draft 非法：不写 `memoryDisclosure`，且不得阻止正文和终态提交。

runtime 不修改 current draft，不读取前序 terminal message，不查询 memory Store，也不建立或解释 replacement lineage。恢复标记只控制能否投影当前 draft，不改变 capability replay、请求正文或终态。submit、edit、resubmit、retry 和 supersede 的既有 acceptance/dispatch/terminal 流程保持不变；每个新 attempt 从自己的空 disclosure context 开始。已由非完成 attempt 提交的长期记忆记录仍留在 memory Store，后续任务只能通过正常记忆检索再次使用，而不是通过 reply disclosure 搬运。

同一个最终对象在现有 terminal composite transaction 中同时写入：

- terminal assistant `SessionMessage.metadata.memoryDisclosure`。
- terminal timeline event `inlinePayload.memoryDisclosure`。

不新增独立 write，不增加或修改 checkpoint，也不修改 `terminalMessageId`。`terminalMessageId` 继续只把 terminal event 与同事务 assistant message 对齐，本 change 不把它作为 live/conversation 的新关联坐标。

非法 draft 不得阻止正文和终态提交。runtime 丢弃披露并记录仅含固定 reason code 的安全诊断，不记录 memoryId、content、identity 或高基数字段。

### 6. channel 投影同一 DTO，frontend 复用同一底部组件

`agent-contracts/channel` 增加与 session 结构同形但独立命名的 public DTO/schema，不依赖 `agent-contracts/session` subpath。`agent-channel-common` 只从 `REQUEST_COMPLETED` terminal timeline event 的受信 inline payload 校验并投影 `payload.memoryDisclosure`；SSE 和 WebSocket 使用同一 stream envelope。其他终态即使携带该字段，也必须省略公开投影。

conversation route 继续返回持久化 `SessionMessage.metadata`，conversation adapter 只在同一 assistant message 的受信 `metadata.eventType=REQUEST_COMPLETED` 且 `metadata.status=COMPLETED` 时投影合法 `memoryDisclosure`；其他终态省略公开字段。该判断不查询 timeline、不新增 `terminalMessageId` 关联，也不扫描 capability result/delta 或调用 memory API。

conversation share 是独立的公开投影边界，不复用 owner conversation 对 metadata 的可见权限。`agent-channel-web` 必须在服务端组装 shared conversation response 时从每条 message metadata 中无条件移除 `memoryDisclosure`，无论该消息属于 COMPLETED、FAILED、CANCELED 还是 SUPERSEDED；其他既有 share-safe metadata 继续按分享契约投影。过滤只作用于公开 DTO，不修改 `SessionMessage`、terminal event 或 owner conversation。浏览器分享页不得承担保密职责，因为它不应收到该字段。会话分享只授权查看已选择的问答内容，不等价于授权查看用户的长期记忆库存或本次回复装入了哪些个人记忆。

`frontend/agent-web` 增加唯一 runtime parser 和 `MemoryDisclosureFooter`：

- 从当前 assistant reply 对应的 terminal envelope 读取披露。
- 只为非空集合显示“引用了 N 条记忆”或“新增了 N 条记忆”。
- 两组独立展开，展开后展示全部规范化内容。
- `memoryId` 只作为 React key/去重 identity，不显示给用户；各 category 按固定中文字段标签展示全部非空值和数组元素，不渲染原始 JSON 文本。
- 不在正文内部增加标记，不增加顶部过程，不显示来源、版本、标题、链接或操作。
- live 与 conversation 复用同一 parser、turn projection 和组件；terminal envelope 不含该字段时不显示区域。
- `REQUEST_FAILED`、`REQUEST_CANCELED` 和 `REQUEST_SUPERSEDED` turn 均不显示记忆 footer；successor 也不继承这些 attempt 的条目。
- schema 非法时只隐藏记忆区域，正文和终态照常显示；前端只记录不含内容的固定诊断。

首版不新增 attempt 历史查看入口。当前回复只读取当前 `REQUEST_COMPLETED` terminal envelope。frontend 不解析 lineage、不扫描或拼接前序 attempt，也不改变既有 turn 的可见性。

## 质量属性设计（Quality Attributes）

### 安全

内部写入回执只接受 `memory-tools/add_memory` 的精确可信身份，并在任何 outward/model consumer 前剥离；非可信同名字段安全失败。`responseMemoryDisclosureDraft` 在 planning hook projection/merge 边界被隔离，hook 无法观察或篡改。披露内容只在当前连续执行内进入受保护 request state；既有 lifecycle checkpoint 若保存完整 flow variables，可能在 owner-scoped checkpoint payload 中附带该 draft，但本 change 不增加 checkpoint write，也不把该副本作为恢复完整性或披露资格依据。披露资格成立时，最终 disclosure 进入完成终态的 message metadata、terminal event 和 owner Web 投影；不进入模型、日志、metric、trace、audit 或 conversation share。公开给 owner 的披露不含来源、Owner Scope、版本、访问计数或内部状态，日志和诊断不含 memoryId/content。现有 Agent Scope 和 Owner Scope 仍由 memory tool/Gateway 查询校验，本 change 不接受客户端 scope 字段。

验证入口包括 memory tool output schema 测试、tool-loop spoof/剥离 negative test、模型上下文断言、channel/frontend 非法 payload 测试和 architecture import 检查。

### 性能和容量

不增加 memory Gateway 查询、checkpoint 写入和 terminal 数据库事务；同步开销只是当前 attempt 的 request-local 去重和已有 terminal metadata 写入。单次 memory tool 结果继续遵守既有 24000-byte 安全输出边界，其中 `add_memory` 在 Store 写入前校验完整内部 receipt 可通过该边界；本 change 不新增累计 disclosure 预算、并发预留或由 footer 大小触发的工具拒绝，终态和前端不做截断。

验证入口包括 `add_memory` 单条 receipt 边界测试，以及大量去重条目在 terminal/live/history 中全量一致且不会改变 memory tool 调用结果的测试。

### 可靠性和恢复

已提交 `add_memory` 在工具返回后进入当前连续执行的 request-local draft。Store 已提交但 invocation 结果不确定时，既有 runtime recovery 使用原始 invocation idempotency key 安全重放，只返回首次锚点记录，不产生第二条记忆；reply disclosure 不参与该判断。任何从 durable execution facts 重建后继续的 attempt 都省略整个 disclosure，以避免展示不完整的引用或新增集合。具备披露资格的完成终态对象随 assistant message 和 terminal event 在既有 composite transaction 原子提交；失败、取消和被替代终态同样省略该字段，新的 retry/edit/resubmit/successor 不继承前序 draft。

验证入口包括 invocation key 稳定性、Store 同 key 单锚点写入、调用结果不确定时的 `add_memory` 恢复、不同 tool invocation 独立写入、恢复执行省略披露、terminal composite commit contract test、最终规范化完成终态提交、写入成功后失败/取消/被替代仍省略披露、新 attempt 不继承和 live 刷新一致性测试。

### 可维护性

语义 owner 保持单一：memory 产生准确写入结果，core 判断并维护当前 attempt 的引用/新增，runtime 只在完成终态读取并提交，channel 投影且负责 share-safe 过滤，frontend 展示。没有增加通用 effect abstraction、Gateway 或数据库 schema。唯一特例是可信 `add_memory` 的 memory-tool-private structured field，代码中必须集中在一个 helper 并由 source/architecture test 防止扩散。

验证入口包括 package build、dependency-cruiser、精确 provider/capability identity source assertion，以及 push 前 `$nextagent-code-review`。

### 可测试性

所有状态转换均由确定的 tool result、hook 后有效 payload、model invocation 边界和 terminal status 驱动；无需真实模型或远端 memory service。测试使用现有 capability invocation port、run-state port、terminal gateway 和 stream projection 替身。

验证入口包括 `agent-memory` unit、`agent-core` tool-loop unit/parallel tests、runtime recovery omission/terminal tests、channel contract tests、frontend Vitest 和 live/history Playwright 用户旅程。

### 审计和可追溯性

完成回复的最终 message metadata 是刷新后可恢复的 owner 可见披露事实，terminal event 是 owner live 的同源投影；两者由同事务和同一对象产生。该能力不是安全审计日志，也不是跨 attempt 的记忆变更账本，不另建 audit event，也不在日志复制记忆内容。`memoryId` 仅随 owner 可见条目持久化，用于解释本次完成回复，不提供管理或跳转入口；conversation share 必须省略该事实，不能借分享接口扩大可见范围。

验证入口包括 message/event 深度相等断言、conversation/live DTO 一致性测试和刷新后的浏览器旅程。

## 验证映射（Verification Map）

- 引用只包含进入后续模型调用的成功 L2 详情：Task 3.2、3.3；由 tool-loop hook 后投影、未发生下一次模型调用、重复读取和 final model context 测试验证。
- 新增只包含当前连续执行且最终完成的 attempt 实际提交的同步 `add_memory`：Task 2.1、2.3、3.1、3.4；由 Store 返回内容、同 invocation 幂等恢复、不同 invocation 独立写入、失败写入、alias/string normalization、恢复执行省略，以及失败/取消/被替代终态省略测试验证。
- 内部回执不改变模型上下文、hook boundary 和通用 result：Task 2.2、3.1、3.5；由 exact identity、spoof、planning hook 隔离、persisted result、live delta 和 next model request negative tests 验证。
- 披露全量且不以累计 footer 大小改变 memory tool 执行：Task 3.5、4.2、5.1、6.2；由多条 detail/add、terminal/live/history 全量一致和不存在披露专用拒绝路径的测试验证。
- 恢复降级、新 attempt 隔离和完成终态原子性：Task 2.3、3.4、4.1、4.2；由不确定 invocation 同 key 恢复且不重复写入、重建执行省略 disclosure、retry/edit/resubmit/successor 不复制 draft、最终规范化非完成终态省略、composite commit 和 message/event 一致性测试验证。
- owner conversation 与 live 同源：Task 5.1、5.2、6.1、6.2；由 SSE/WebSocket contract、history adapter、TurnBlock component 和浏览器刷新旅程验证。
- conversation share 不公开披露：Task 5.3、6.4；由 share route 服务端投影测试和 owner/share 对照浏览器旅程验证。
- 非法或缺失 payload 不影响正文/终态：Task 4.2、5.1、6.1；由 field-absent message、invalid schema 和 safe diagnostic tests 验证。
- 架构和 contract 边界：Task 1.1、1.2、7.2；由 contract upgrade review、build、contract tests、dependency-cruiser 和 `$nextagent-code-review` 验证。

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/response-memory-disclosure/spec.md` 主承载引用、新增、终态和 owner 展示语义；`openspec/specs/memory-tools/spec.md` 只主承载 `add_memory` memory-tool-private 回执、单次结果边界及剥离要求；既有 `openspec/specs/conversation-share/spec.md` 主承载 shared conversation 的 disclosure 隔离，不由 response disclosure 规格重复定义分享授权。
- 核心结构和跨模块流程：`openspec/designs/architecture/core-contracts.md` 主承载 `ResponseMemoryDisclosure`、可信回执剥离顺序、request draft、恢复时省略、terminal commit 和 history/stream 双投影契约，并明确 checkpoint contract 不变。
- 系统职责边界：`openspec/designs/architecture/ts-backend-architecture.md` 只承载 memory、core、runtime、channel 和 browser 的 owner/非 owner 关系。
- 模块设计：`openspec/designs/modules/agent-memory.md`、`agent-core.md`、`agent-runtime.md`、`agent-channel-web.md` 和 `agent-web.md` 分别承载各模块落点、依赖和验证入口，不重复定义跨模块数据结构。
- ADR：无。本 change 复用既有 capability result、terminal composite commit 和 stream envelope 机制，没有引入独立且需长期解释的新基础设施决策。
- 导航：`openspec/designs/spec-to-design-map.md` 负责从 `response-memory-disclosure` 导航到上述 architecture、module 和验证入口。

## 风险与取舍（Risks / Trade-offs）

- [memory-tool-private structured field 是 capability result 的窄特例] -> 只允许精确可信 identity，集中剥离 helper，在 hook 和 generic projection 前移除，并用 negative architecture/source test 防止扩散；不把特例升级为通用 extension。
- [复用 flowVariables 可能把披露内容暴露给 planning hook] -> 将 draft 定义为 core/runtime 保留键，hook projection 前删除、merge 后保留，并用 hook 观察/伪造/删除三类 negative test 固定隔离。
- [core/runtime 复用同一 draft 容易形成双 owner] -> core 是唯一写入 owner，runtime 在 terminal assembly 只读；runtime 不从工具结果或前序 attempt 推导当前 attempt 语义，并用只读边界测试防止交叉写入。
- [恢复执行无法证明 request-local draft 完整] -> 不升级 checkpoint 或建立 memory 专用恢复机制；runtime 依据受信的执行重建标记省略整个 disclosure，并记录固定无内容诊断。该取舍只降低 footer 可见性，不影响正文、终态、memory Store 或 capability recovery。
- [完整内部回执可能超过 memory tool 既有单次结果上限] -> 明确依赖 `refine-long-term-memory-store-gateway-contract` 的有界 content，在 Store 写入前对完整单条 receipt 做 size validation；detail 继续使用既有结果边界，依赖未完成前不得实施。
- [`IDEMPOTENT` 容易被误解为内容级去重] -> 规格只允许同一 `runId + toolCallId` invocation 使用原 key 恢复；不同 tool invocation 必须产生不同 key 并保持独立。任何 Gateway adapter 若不能满足既有锚点幂等 store contract，就不得作为该 memory tool 的选中实现。
- [大量 memory tool 调用可能形成较大的 terminal metadata 和 Web payload] -> 首版遵循“实际使用多少就完整显示多少”，不以展示大小阻止 Agent 使用记忆，也不静默省略；通过多条目端到端测试确认现有 carrier 正确传递。若需要统一总量上限，由后续消息存储与传输容量治理覆盖所有同类 payload，不在本 change 建立记忆专用门禁。
- [非完成 attempt 已经写入的记忆没有回复级回执] -> 明确 reply disclosure 只解释用户实际看到的完成回复，不充当全局记忆变更账本；已写入记录仍由 memory Store 保存，后续任务按正常检索使用，避免把旧请求事实归因给新回复。
- [非法披露被隐藏可能降低用户可见诊断性] -> 保证正文和终态优先，记录无内容的固定诊断并由测试/运维发现；不向用户展示“暂不可用”以避免把内部 contract 故障伪装成记忆状态。
- [本 change 与 popup/scroll change 触达相邻前端文件] -> 规格可并行，代码实施必须在另一个 change 合入后串行整合并重跑 frontend 回归，不覆盖既有未提交改动。
- [memory application contract 同时修改 channel contract] -> 本 change 只增加 reply disclosure DTO，不复用或扩展 management port；实现时在 application contract 合入后串行更新共享 `agent-contracts/channel` 文件并重跑 contract/architecture tests。
- [owner conversation metadata 被 share route 整体透传会泄露个人记忆内容] -> `agent-channel-web` 在服务端 shared conversation 投影中显式剥离 `memoryDisclosure`，保留 canonical owner message 不变，并用 owner/share 对照测试固定该安全边界；不把保密责任留给前端。

## 发布与回滚计划

不需要数据库结构变更。发布顺序固定为：

1. 先完成并归并 `refine-long-term-memory-store-gateway-contract`。
2. 核心契约升级已经确认；同一版本发布 backend contracts、memory/core/runtime/channel 和 frontend，不支持只发布会产生内部 receipt 而 core 尚未剥离的组合。
3. message metadata 不含 `memoryDisclosure` 时正常显示正文且不显示 footer，不回填既有数据。
4. 回滚必须整体回滚本 change 的 producer、collector、terminal projection 和 frontend parser；已持久化 metadata 是附加 JSON 字段，不需要清理数据。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/response-memory-disclosure/spec.md`：新增稳定行为契约。
- `openspec/specs/memory-tools/spec.md`：归并 memory-tool-private 写入回执和模型可见结果不变的约束。
- `openspec/specs/conversation-share/spec.md`：归并 shared conversation 服务端投影省略 `memoryDisclosure` 的安全约束。
- `openspec/overview.md`：补充用户能在终态回复看到长期记忆引用和同步新增回执的产品目标。
- `openspec/designs/architecture/core-contracts.md`：归并稳定数据结构、可信剥离顺序、引用状态转换、恢复时省略、terminal commit 和 Web 双投影契约，并记录 checkpoint contract 不变。
- `openspec/designs/architecture/ts-backend-architecture.md`：归并跨模块 owner 和依赖边界。
- `openspec/designs/modules/agent-memory.md`：归并准确写入回执的产生与非职责。
- `openspec/designs/modules/agent-core.md`：归并 request collector、引用判定和模型上下文隔离。
- `openspec/designs/modules/agent-runtime.md`：归并恢复执行省略 disclosure 和 terminal composite commit 接入点。
- `openspec/designs/modules/agent-channel-web.md`：归并 owner conversation/terminal stream 的受控投影和 conversation share disclosure 剥离边界。
- `openspec/designs/modules/agent-web.md`：归并 live/history 共用 footer 的浏览器职责。
- `openspec/designs/spec-to-design-map.md`：增加 capability、设计 owner 和验证入口导航。
- 不新增 ADR。

## 待确认问题（Open Questions）

设计语义和实现路径无未决项。`agent-contracts/session` 和 `agent-contracts/channel` 的核心契约升级确认已经完成，已冻结的数据结构和 owner 边界可以进入实施。
