## 背景和现状（Context）

当前 TS 后端已经具备 owner+agent scoped session、message、active context 和 runtime session facade：

- `RuntimeSessionPort` 目前暴露 `createSession`、`requireSession`、`listSessions`、`listMessages`、`updateTitle`、`streamEvents` 和 `getActiveRun`，没有 fork command。
- `UserSessionService.createSession` 只创建空 session，并通过 `activeContextStore.loadActiveContext` 初始化空 active context state；它没有从已有消息创建 child session 的行为。
- `SessionMessageRecord` 已携带 `messageId`、`sessionId`、`requestId`、可选 `runId`、role、content、metadata、visible 和 `createdAt`。message history 当前按 `created_at ASC, message_id ASC` 读取。
- `SessionMessageStoreGateway.appendSessionMessage` 当前会在同一 transaction 中保存单条 message 并追加 active context item；这适合普通 append，不适合 fork 的“批量复制 prefix + 一次性初始化 child active context”。
- active context 是模型可见历史的权威视图。context assembly 不扫描 Web UI state 或全量 session history 来决定模型上下文。
- `agent-channel-web` 当前 conversation response 只投影 `items`、`activeRun` 和 `nextCursor`，没有 fork notice。
- runtime 的 subagent execution 已明确使用 fresh context；child session 不继承 parent conversation history、active context、timeline、attachments 或 tool state。因此 subagent 不能复用为用户可见 session fork。

相关约束：

- owner scope 只能来自可信 channel/auth boundary；Agent Scope 只能来自 runtime/app composition 或已持久化 session/run。
- gateway public contract 使用 Record + write options；复合持久化必须由 gateway 提供单一 composite write，并由 gateway-local 在一个数据库事务中完成。
- Web channel 只做 transport/schema/projection，不拥有 session lifecycle 或 fork 业务语义。
- 本 change 定义后端 Web API、public DTO，并在 `frontend/agent-web` 实现最小 fork 入口：已持久化、可渲染的 assistant message 底部展示派生按钮，in-flight 时不可作为 anchor，成功后打开 child session，失败使用统一提示。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 用户可以从一条已持久化、visible、可渲染的 assistant message 派生一个新的 child session。
- child session 显示 source session 从开头到锚点的可见历史，使用新的 child session/message ids。
- child session 的首次 submit 使用继承后的 child active context，不读取 parent active context 或 parent history。
- fork 后 child 与 source 隔离：后续 messages、runs、timeline、checkpoint、pending input、stream 和 tool state 不共享。
- child session 在 fork 后尚未提交新 user message 时，conversation response 返回窄化 `forkNotice`；提交新 user message 后不再返回。
- fork command retry-safe：相同 idempotency key 返回首次 child session；新的 key 可以从同一 anchor 再派生一个 child session。
- 所有新增 contract、route、gateway write 和 context rule 都有可重复验证路径。

**非目标：**

- 不实现同会话 detach，不复用 `add-ts-task-tools`，不把 fork 结果放入 task 列表。
- 不使用 subagent execution 实现本能力。
- 不继承 raw prompt、raw provider error、stream delta、pending input continuation、未完成 tool state、checkpoint、timeline 或运行中 lifecycle state。
- 不复制 parent 当前 active context，不保存或回放历史 active context snapshot。
- 不实现 fork tree UI、父子 session 实时同步、源标题动态同步、公开完整 lineage 或派生关系管理页面。
- 不实现 fork tree UI、父子 session 实时同步、源标题动态同步、公开完整 lineage 或派生关系管理页面；`frontend/agent-web` 只实现最小入口和 notice 展示。

## 设计决策（Decisions）

### D1：唯一实现路径是 runtime-owned session fork command

新增 `RuntimeSessionPort.forkFromMessage(command)`。Web route 只做 schema validation、identity 注入和结果 projection；runtime 负责解析可信 Agent Scope、校验 source session、校验 anchor message、组装 child fork materialization request，并调用 gateway composite write。

目标 command 形态：

```ts
interface RuntimeForkSessionFromMessageCommand {
  readonly identityContext: IdentityContext;
  readonly sourceSessionId: SessionId;
  readonly sourceAnchorMessageId: MessageId;
  readonly idempotencyKey: IdempotencyKey;
}

interface RuntimeForkSessionFromRequestCommand {
  readonly identityContext: IdentityContext;
  readonly sourceSessionId: SessionId;
  readonly sourceRequestId: MessageId;
  readonly idempotencyKey: IdempotencyKey;
}

interface ForkSessionFromMessageResult {
  readonly childSession: UserSession;
}
```

`agent-contracts/runtime` 提供唯一 runtime facade command/result。`agent-contracts/session` 只提供 `ForkNotice` read model 和 conversation/session message page projection，不提供 fork command。`agent-contracts/context` 提供窄化 fork active context selection port。`agent-contracts/gateway` 提供 fork source record、prefix query 与 composite write contract。

选择理由：

- fork 是用户可见 session lifecycle 操作，不是 request execution，也不是 tool/subagent execution。
- runtime 已拥有 trusted Agent Scope resolution 和 session facade，是 Web channel 和 session/gateway/context 之间的正确编排 owner。
- 让 Web channel 或 gateway-local 直接实现 fork 会越过 lifecycle 和 business decision owner。

放弃方案：

- 放弃同会话 detach：detach 解决前台 run 后台继续，不创建继承历史的新会话。
- 放弃 subagent：subagent child session 明确 fresh context，且服务于 tool invocation，而不是用户可见会话分叉。
- 放弃在 `agent-session` 单独编排所有逻辑：session 领域可以投影 read model，但 fork 需要 runtime 可信 Agent Scope、context rule 和 gateway composite write 协作。

### D2：Anchor eligibility 只基于已持久化可渲染 assistant message

fork anchor 必须满足：

- owner scope、Agent Scope、source session 匹配。
- `role=ASSISTANT`。
- `visible=true`。
- content 非空。
- 已存在于 message store，可由 conversation history 读取。
- 首版 eligibility 边界为“已作为 visible assistant message 持久化并可由 conversation history 读取”。runtime 不以 source `RequestRun.status=COMPLETED` 作为 eligibility 条件；如果 implementation 能加载 source run 且发现其仍为 non-terminal，则按持久化不变量异常拒绝该 anchor。

stream delta、active run projection、未提交 final message、hidden replacement、user/system/capability result message 都不可作为 anchor。

选择理由：

- 黑盒 UI 语义是“回复已进入 conversation history 后底部按钮可用，仍在 streaming/active run projection 中时禁用”。后端可验证边界就是“已进入 durable conversation history 的 assistant message”。
- 不要求 `RequestRun.status=COMPLETED`，避免把 fork 限死在成功 run；只要用户看到了已持久化 assistant message，就可以派生。

### D3：复制 canonical prefix，但生成 child-owned ids

runtime 从 source session 读取按 canonical order 排列的 message prefix：从 source session 开头到 source anchor message，包含 anchor。实现新增 gateway prefix query，例如：

```ts
interface ListSessionMessagePrefixThroughAnchorQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly anchorMessageId: MessageId;
}
```

该 query 是 gateway 内部 fork prefix query，返回 source session 截至 anchor 的 canonical durable `SessionMessageRecord` 序列，不走 public conversation read projection，不受 `includeHidden=false` 或 capability-result 过滤影响。query 可以在 gateway-local 内部分批/分页读取以控制内存，但语义上必须返回完整 prefix through anchor，不得静默截断；找不到 anchor 或 anchor 不属于 session 时返回安全空/失败结果，由 runtime 映射为 safe not-found。child 页面展示仍走正常 public conversation read，只展示 fork materialization 后 child session 中应对客户端可见的消息。

runtime 为 child 构造新的 message records：

- 每个 copied message 使用新的 `messageId`。
- 每个 copied message 使用 child `sessionId`。
- `requestId` 按 source request root 映射到 child-side request root。若 source message 的 `requestId` 指向 prefix 内某个 source root message，则替换为对应 child message id；不能解析时 fork 失败。
- copied messages 不携带 source `runId`。source run 是 source session 的 request lifecycle truth，不能成为 child runtime truth。需要 provenance 时只能由 fork source metadata 记录 source anchor。
- content、content type、role、visible 和必要 metadata 复制到 child；写入前必须通过 safe child message projection，而不是只清洗 metadata。
- safe child message projection 必须检查 copied message 的 `content`、metadata、replacement evidence、summary metadata、`ContentRef` 以及 backing ref。它保留展示和 context 所需的普通 metadata；`SummaryMessageMetadata.coveredMessageRefs`、`retainedTailMessageRefs` 等 message refs 必须重映射为 child message ids；`ReplacementLineage.sourceMessageId`、`sourceRunId`、`sourceInvocationId`、source run/checkpoint/timeline refs、raw provider fields 和 parent invocation lineage 必须清除、置空或使 fork 失败；不得把 parent runtime truth 留在 child message 中。
- 已知 typed metadata 必须按其字段语义显式处理：summary refs 必须 remap 到 child message ids 或 fail；replacement/source runtime lineage 必须清除、置空或 fail。未知 metadata MAY 在不含 source-bound/runtime-only 值时原样保留；若未知 metadata 中出现 source run id、checkpoint ref、timeline ref、raw provider field、parent invocation lineage、source execution path、host path 或 execution-bound ref，fork MUST fail safely，不得静默复制。
- durable artifact、attachment、blob-backed content ref 只有在 owner+agent scoped 且 fork 后 child 可访问时才可以保留、复制或重映射。execution-bound refs 不可原样复制，包括 `tool-results/<refId>`、source run workspace path、tmp/cache/log/test-output path、provider invocation scratch path 或任何只能由 source request/run execution workspace 解析的 ref。
- 如果 copied message 的模型可见 content、metadata 或 backing ref 中含 execution-bound ref，fork materialization 必须先将其提升为 owner+agent scoped durable artifact/blob，并把 child message content/metadata 重写为 child 可访问的 durable ref；无法提升或重写时 fork 必须整体失败。实现不得只删除 metadata，却把 `read` 某个 source file path 的指令留在 child message content 中。

选择理由：

- child session 是全新会话，后续隐藏、反馈、active context、submit、retry/edit 等行为都不能指回 parent message ids。
- `requestId` grouping 对 context assembly 的 prior turn 分组有意义，必须在 child 内自洽。
- `runId` 指向 RequestRun 生命周期事实，复制旧 run id 会让 child message 看起来属于 source run，破坏隔离。

放弃方案：

- 放弃保留 source message ids：会导致 active context、message lookup、annotation、feedback 和 future mutation 跨 session 串写。
- 放弃复制 source run ids：会把 child history 绑定到 source RequestRun，破坏 child isolation。

### D3.1：execution-bound promotion 使用 gateway metadata staging，而不是文件目录

execution-bound ref promotion 的 staging 不是 runtime 创建的临时文件目录，也不是把 source execution workspace path 移到另一个宿主路径。runtime 只能通过既有 workspace/sandbox/resolver 边界读取 source `tool-results/<refId>` 或等价 execution-bound 内容；读取到的 bytes 必须通过 gateway/content owner 写入 durable bytes store。

首版只支持能通过既有可信 workspace/sandbox/resolver 边界解析为 bytes 的 execution-bound ref。若 fork materializer 只能观察到 source execution path、host path、tmp/cache/log/test-output path，或无法识别/无法授权解析的 execution-bound ref 形态，fork MUST 在 child persistence 前 safe fail，并同步 abort 当前 `forkAttemptId` 下已经 staged 的 promotions。实现不得为了 fork 新增 generic host-file read port。

首版 staging 语义落在 gateway 内部的 content metadata lifecycle 上。gateway fork/promotion contract 提供最小状态机边界；runtime 负责读取和重写，gateway 负责持久化可见性：

```ts
interface StageForkPromotionRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly forkAttemptId: string;
  readonly sourceSessionId: SessionId;
  readonly sourceMessageId: MessageId;
  readonly childSessionId: SessionId;
  readonly childMessageId: MessageId;
  readonly refType: "CAPABILITY_RESULT";
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

interface ForkPromotionAbortRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly forkAttemptId: string;
}

interface ForkPromotionCleanupRequest {
  readonly now: EpochMillis;
  readonly retentionMs: number;
}

interface ForkPromotionCleanupResult {
  readonly cleanedCount: number;
  readonly retryableCount: number;
}

interface ForkPromotionGateway {
  stageForkPromotion(request: StageForkPromotionRequest): Promise<ForkPromotedContentRecord>;
  abortForkPromotions(request: ForkPromotionAbortRequest): Promise<void>;
  cleanupExpiredForkPromotions(request: ForkPromotionCleanupRequest): Promise<ForkPromotionCleanupResult>;
}
```

`stageForkPromotion` 是 staging 边界：runtime 传入 source/target 坐标和 bytes，gateway/content owner 负责生成 child 可见的 `promotedContentId`、写入 opaque blob 并写入 `STAGED` metadata。调用方不得传入 `promotedContentId`、`status`、`createdAt`、`committedAt`、`abortedAt` 或 `BlobRef`；这些由 stage/commit/abort 边界生成或推进。`sizeBytes` MUST 与 `bytes.byteLength` 一致，否则 stage 返回 safe failure 且不得写入 metadata。若 blob 写入成功但 metadata 写入失败，`stageForkPromotion` MUST best-effort 删除刚写入的 blob 并返回 safe failure；该失败不得被视为成功 staging，也不得留下可由 fork-promotion cleanup job 正常依赖的无 metadata orphan blob。

Promotion commit MUST NOT be exposed as a runtime-callable gateway port. gateway-local MUST only mark matching promotions `COMMITTED` inside the same SQLite transaction that persists the fork composite write. Runtime may stage content before the composite write and abort staged content on failure, but it MUST NOT independently mark promotions `COMMITTED`. `abortForkPromotions` 用于 composite write 前失败、fork transaction 失败或 staging 后 materialization 失败的同步 abort。resolver MUST 只解析 `COMMITTED` promotion，因此 abort cleanup 失败也不得让 `STAGED` 或 `ABORTED` content 变为可见。

`cleanupExpiredForkPromotions` 是 `agent-app` 注册的 scheduled maintenance job 调用的内部 gateway 方法，不是 Web/session API。它只接收 `now` 与 `retentionMs`，不得接收客户端 owner/session/message filter 或状态覆盖；gateway-local 必须用 promotion metadata 中已持久化的 owner+agent scope 执行 blob delete 和 metadata 收敛。

metadata 形态：

```ts
interface ForkPromotedContentRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly forkAttemptId: string;
  readonly promotedContentId: string;
  readonly sourceSessionId: SessionId;
  readonly sourceMessageId: MessageId;
  readonly childSessionId: SessionId;
  readonly childMessageId: MessageId;
  readonly refType: "CAPABILITY_RESULT";
  readonly blobRef: BlobRef;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly status: "STAGED" | "COMMITTED" | "ABORTED";
  readonly createdAt: EpochMillis;
  readonly committedAt?: EpochMillis;
  readonly abortedAt?: EpochMillis;
}
```

`BlobStoreGateway` 只保存 opaque bytes，并返回内部 `BlobRef`；它不拥有 artifact/content visibility、session/run binding 或模型可见语义。业务可见性由 `ForkPromotedContentRecord.status` 与 child message 是否已被 committed fork materialization 引用共同决定：

- `STAGED` promotion 不得被 conversation read、artifact/content resolver、model context、Web projection、safe error、audit/log 明细观察到。
- copied child message 只允许写入 `promotedContentId` 形态的 `ContentRef`（例如 `refType=CAPABILITY_RESULT`），不得写入 `BlobRef`、source execution path 或宿主绝对路径。
- content resolver 只解析 `COMMITTED` promotion metadata；解析时才在 gateway 内部使用 `BlobRef` 读取 bytes。
- fork composite write 任一步失败时，runtime MUST 同步尝试 `abortForkPromotions(forkAttemptId)`，将相关 staged promotion 标记为 `ABORTED` 并 best-effort 删除底层 blob；cleanup 失败也不得让 staged/aborted content 变为可见。
- gateway-local composite write 不读取宿主路径，不解析 execution-bound ref，不决定 promotion 语义；它只持久化 runtime/session/context 已经决定好的 fork facts 和已经重写好的 child message records。

fork-promotion cleanup job 是本 change 新增的后台收敛能力，复用既有 `ScheduledMaintenanceGatewayPort` 调度，而不是新增 scheduler。`agent-app` 注册 job；默认 `cadenceMs=60 * 60 * 1000`，默认 `retentionMs=24 * 60 * 60 * 1000`。job 调用 `cleanupExpiredForkPromotions({ now, retentionMs })`；gateway-local 只选择 `status in ("STAGED","ABORTED")` 且 `createdAt < now - retentionMs` 的 records，永远不选择 `COMMITTED`。它对过期 `STAGED` 做条件更新 `STAGED -> ABORTED`，对 `ABORTED` best-effort `deleteBlob`；blob 不存在或删除成功后 MUST 删除对应 promotion metadata；delete 失败 MUST 保留 `ABORTED` metadata，计入 `retryableCount` 并留待下次重试。首版不得新增 `CLEANED` 状态、`cleanupCompletedAt` 字段或 per-record `expiresAt`；如未来需要不同 refType 的保留期，必须由独立 change 重新引入并限定只对 `STAGED`/`ABORTED` 生效。

失败阶段处理表：

| 阶段 | 可能已写入的事实 | 同步处理 | 后台 cleanup |
| --- | --- | --- | --- |
| promotion 前失败 | 无 child、无 promotion | 返回 safe failure | 无 |
| blob/metadata staging 失败 | 可能有 staging 内部刚写的 blob | `stageForkPromotion` best-effort 删除 blob 并失败 | 不依赖无 metadata orphan；若仍残留，仅能由 blob-store 专属孤儿清理处理 |
| `STAGED` 后、commit 前失败 | `STAGED` metadata 和 blob | `abortForkPromotions`: `STAGED -> ABORTED` + best-effort delete blob | 过期后重试 abort/delete |
| composite transaction 失败 | child 事实回滚，promotion 仍非 `COMMITTED` | 同步 abort matching `forkAttemptId` | 过期后重试 abort/delete |
| composite 已成功但响应失败 | child、messages、active context、fork source、idempotency、promotion 都已 committed | 不 abort；同 key retry 返回 child | 不清理 `COMMITTED` |

选择理由：

- 这避免 runtime 绕过 sandbox/gateway 边界直接管理宿主文件。
- 裸 `BlobRef` 没有 session/message/status 语义；使用 metadata lifecycle 才能表达 staged、committed、aborted 和 cleanup。
- fork 的黑盒承诺是“成功后 child 完整可继续，失败后用户和模型都看不到半成品”，因此 promotion 必须先不可见 staging，再随 fork materialization 一起变为 child-accessible。

### D4：child active context 复用 context-engine prior-history 规则，不复制 parent 当前 active context

`agent-contracts/context` 定义窄化 fork active context selection port，`agent-context-engine` 实现该 port，`agent-runtime` 只通过 `agent-app` 注入的 port 调用，不直接 import `agent-context-engine` implementation package。例如：

```ts
interface ForkActiveContextSelectionRequest {
  readonly copiedMessages: readonly SessionMessage[];
  readonly childAnchorMessageId: MessageId;
}

interface ForkActiveContextSelectionResult {
  readonly messageIds: readonly MessageId[];
}

interface ForkActiveContextSelectionPort {
  selectForkActiveContext(request: ForkActiveContextSelectionRequest): Promise<ForkActiveContextSelectionResult>;
}
```

选择流程不是第二套 context policy：

1. Runtime MUST pass `copiedMessages` in canonical conversation order and MUST include messages only from the child session prefix through `childAnchorMessageId`. The selector MUST fail if the anchor is missing, if message ids are duplicated, if records contain more than one child `sessionId`, or if any record appears after the anchor.
2. The selector MUST treat `copiedMessages` as the only input corpus. It MUST NOT read parent active context, parent history, parent timeline, parent checkpoint, or gateway state.
3. The selector MUST validate fork-specific child ownership constraints before selection: every emitted or metadata-retained message ref MUST already be remapped to a child message id present in the copied child prefix; any remaining parent/source message ref MUST fail selection.
4. After fork-specific validation and anchor cutoff, the implementation MUST reuse the context-engine internal prior-history candidate selection helper used by normal context assembly. The helper MUST be extracted as a package-internal `agent-context-engine` implementation detail that normal assembly and `ForkActiveContextSelectionPort` both call; it MUST NOT be promoted to a cross-package public contract. Fork selection MUST NOT call the full assembly/current-request selection path with a fake current request. Fork code MUST NOT restate or independently maintain the complete-turn, summary, tool-use/capability-result pairing, hidden replacement, or orphan-fragment rules.
5. Context compression summary is authoritative within the copied child corpus. When a copied `SUMMARY` message has valid remapped `SummaryMessageMetadata` that covers earlier copied child message ids, the selector MUST treat the child summary as the model-visible replacement and MUST NOT also emit the covered original refs. If summary metadata refs cannot be remapped to child message ids present in the copied prefix, selection MUST fail.
6. Fork materialization MUST persist the emitted refs as the child active context with `activeContextVersion=0` and item ordinals from `0` without gaps. Later child submit, append, and compaction then use the existing active context version increment semantics.
7. Fork active context v0 is deterministic materialization from copied child messages. It MUST NOT call model providers, MUST NOT invoke context compression, and MUST NOT create a new summary. Existing copied summary messages participate only as already-durable copied child messages after their metadata refs have been remapped.

不使用 parent 当前 active context，也不引入历史 active context snapshot/version 回放。fork 的语义不是重放某个历史 active context snapshot，而是从 copied durable prefix 中重建 anchor 时刻可继续推理的 effective context；其中 compressed summary 的 replacement 语义必须被保留，避免 child 同时看到 summary 和被 summary 覆盖的原始消息。

选择理由：

- parent 当前 active context 可能已经包含 anchor 之后的新消息，从历史 anchor fork 时会污染 child。
- 任意历史 active context snapshot 需要长期记录每次 context 变化，修改面大，成本高于首版收益。
- 现有 context 架构已经把 active context 作为模型可见历史权威视图，因此 fork 必须显式初始化 child active context，不能等首次 submit 时扫描全量 history。
- context selection policy 由 `agent-context-engine` 拥有；fork selector 只提供 child prefix、anchor 截止和 parent ref 拒绝，不维护平行选择算法。

放弃方案：

- 放弃复制 parent 当前 active context：历史 anchor 会继承错误上下文。
- 放弃保存每个历史时刻 active context snapshot：这是过度设计。
- 放弃首次 submit 扫描 child full history：会绕过 active context 架构边界。

### D5：gateway composite write 一次性物化 fork

新增 gateway composite write，例如：

```ts
interface SessionForkSourceRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly childSessionId: SessionId;
  readonly sourceSessionId: SessionId;
  readonly sourceAnchorMessageId: MessageId;
  readonly childAnchorMessageId: MessageId;
  readonly sourceSessionTitleSnapshot: string;
  readonly createdAt: EpochMillis;
}

interface ForkSessionFromMessageWriteRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly childSession: SessionRecord;
  readonly copiedMessages: readonly SessionMessageRecord[];
  readonly activeContextMessageIds: readonly MessageId[];
  readonly forkSource: SessionForkSourceRecord;
  readonly sourceSessionId: SessionId;
  readonly sourceAnchorMessageId: MessageId;
  readonly idempotencyKey: IdempotencyKey;
}

interface ForkSessionFromMessageWriteResult {
  readonly childSession: SessionRecord;
  readonly replayed: boolean;
}
```

gateway-local 在一个 SQLite transaction 内完成：

- 写入 child session anchor。
- 写入 copied child messages。
- 写入 active context state/items，`activeContextVersion` 初始化为 0，ordinals 从 0 连续。
- 写入 fork source fact。
- 写入或校验 idempotency anchor：`tenantId + subjectId + agentId + sourceSessionId + sourceAnchorMessageId + idempotencyKey`。
- 返回 `ForkSessionFromMessageWriteResult`：`replayed=false` 表示本次 transaction 创建了 child fork facts；`replayed=true` 表示同一 scoped idempotency anchor 已经成功 committed，gateway 返回首次创建的 child session。失败 attempt MUST NOT 写入成功 idempotency anchor，也不得 replay 为 child session。

gateway-local 不决定 prefix、anchor eligibility、active context selection 或 notice visibility。

选择理由：

- fork 的黑盒结果必须要么完整可用，要么不可见失败。
- 循环调用现有 `appendSessionMessage` 会逐条追加 active context，无法保证 child session/messages/fork metadata 整体原子，也容易在失败时留下半成品。

### D6：fork source 字段只保留必要原因

内部 fork source 只保留以下字段：

- `sourceSessionId`：作为普通 source session navigation target，并用于审计 provenance。
- `sourceSessionTitleSnapshot`：用于 fork notice 稳定展示，源会话后续重命名不影响 child notice 文案。
- `sourceAnchorMessageId`：用于 provenance 和 idempotency coordinate，不直接对 public DTO 暴露。
- `childAnchorMessageId`：用于服务端判断 fork notice 是否仍应显示，即 child anchor 之后是否已有 user message。
- trusted owner scope、Agent Scope、`createdAt`：用于隔离、审计和诊断。

不保留完整 fork tree、每条 copied message lineage、parent run/checkpoint/timeline refs、raw content 或 parent active context snapshot。

`sourceSessionTitleSnapshot` 与 child session title MUST 使用 session-domain normalized title：读取 source `UserSession.title` 后 trim；缺失或 trim 后为空时使用默认标题 `Untitled session`。该语义属于 session/runtime domain，Web channel 仍只做 public projection；session/runtime 不得依赖 Web `displayTitle` alias 或导入 Web `safeTitle()` helper。

选择理由：

- 用户黑盒只需要“由某会话派生”和一个普通 source session navigation target。
- 内部只需要定位来源、幂等和 notice 显隐边界。
- 多余 lineage 会增加 public API 和持久化复杂度，且首版没有用户可见收益。

### D7：fork notice 由 child boundary message 决定显隐

conversation read 增加 server-side fork notice projection：

```ts
interface ForkNotice {
  readonly sourceSessionId: SessionId;
  readonly sourceSessionTitle: string;
}
```

`SessionMessagePage` 或 conversation domain read model 增加可选 `forkNotice`。`agent-channel-web` 在 `projectConversation` 中投影为 public `forkNotice`。`forkNotice` 只属于 child conversation 的默认/latest bootstrap projection；它不是 message，不进入 active context，不参与模型上下文，也不用于 anchored/paged history continuity。

显示条件：

- child session 存在 fork source fact。
- child anchor message 之后不存在 role=USER 的 message。
- conversation read 是默认/latest bootstrap read，没有携带 `cursor`、`newerCursor` 或 `anchorMessageId`。

不使用 `forkedAt` 判断。`forkedAt` 只能说明这个 session 是 forked child，不能说明用户是否已经开始在 child 中继续工作。

选择理由：

- 用户要求“当用户提交消息后，不再显示派生提醒”。
- 基于 child anchor 之后是否有 user message，语义精确且不依赖时间戳。

### D8：Web route 和 UI 触发语义

新增 route：

```text
POST /api/v1/sessions/{sessionId}/messages/{messageId}/fork
POST /api/v1/sessions/{sessionId}/requests/{requestId}/fork
```

请求体：

```json
{ "idempotencyKey": "..." }
```

`idempotencyKey` MUST 是必填的 opaque bounded token。Web route MUST 对原始字符串做 `trim()`，trim 后为空或长度超过 128 个字符时拒绝；runtime/gateway 只接收 trim 后的 normalized key。请求体禁止携带 owner、agent、child ids、fork metadata、copied messages、active context 或 raw content。日志、metric、audit 和 safe diagnostics 不得记录原始 key，最多记录 `idempotencyKeyPresent=true` 或 bounded fingerprint。

`frontend/agent-web` 的最小交互语义：

- 满足 D2 anchor eligibility 的已持久化、可渲染 assistant messages 可作为 route anchor。
- in-flight streaming output 不在 conversation history 中，因此 message route 不会接受该 anchor。
- 对 live UI 中已完成但尚未刷新 conversation snapshot 的 assistant response，前端可在 `REQUEST_COMPLETED` 后用该 turn 的 `rootMessageId`/request id 调用 request route；后端必须先解析为一个 durable completed assistant message，再复用 message fork。
- 模型回复操作区在收藏按钮右侧展示派生图标；history-loaded、durable、visible assistant message 使用 message anchor；live completed assistant response 使用 request/root message id；in-flight、failed、canceled 或 superseded response 不显示入口。
- 点击派生后调用 `POST /api/v1/sessions/{sessionId}/messages/{messageId}/fork` 或 `POST /api/v1/sessions/{sessionId}/requests/{requestId}/fork`；in-flight 或 share-selection 等禁用状态下不得触发。
- fork 成功 response 足以打开 child session。
- fork 失败使用现有前端统一错误提示，不新增 source-specific 失败分支。
- child conversation response 的 `forkNotice` 足以渲染“由某会话派生”，并提供普通 source session navigation target；source 是否可打开由既有 session read/navigation 语义处理。
- fork notice 只把 source session title 渲染为链接，不把整句提示渲染为链接；child 提交第一条 fork 后 user message 后 notice 消失。

### D9：不创建 RequestRun，不触发 model，不写 source

fork command 是 session materialization，不是 request execution：

- 不创建 RequestRun。
- 不调用 Agent core。
- 不调用 context assembly render 或 model provider。
- 不发布 source timeline event。
- 不修改 source session message、active context、checkpoint 或 RequestRun。

需要审计时，只记录 safe fork operation audit/diagnostic，不记录 raw content。

选择理由：

- fork 是历史复制和上下文初始化，不是一次新的模型交互。
- 用户第一次在 child 中 submit 时才进入正常 request lifecycle。

## 质量属性设计（Quality Attributes）

**安全**

- owner scope 和 Agent Scope 只来自可信 boundary/runtime resolver。
- fork route schema 拒绝客户端提供 owner、agent、child ids、copied messages、active context 或 fork source。
- source session、anchor message、child session、copied messages、active context 和 fork metadata 全部 owner+agent scoped。
- safe errors、logs、metrics、audit 不记录 copied content、raw model output、stream delta、tool result、prompt、credential 或附件内容。
- 验证入口：Web schema negative tests、runtime scope tests、gateway scoped idempotency tests、safe diagnostic assertions、architecture import checks。

**性能/容量**

- fork 不调用模型，不执行 tools；主要成本是一次 source prefix read 和一次 composite write。
- storage 增长与 copied prefix message 数量线性相关，这是“完整继承历史”的必要成本。
- fork materialization 前必须做 runtime-owned resource preflight，覆盖 message count、估算 bytes、safe child message projection、durable promotion 和 composite write 预算。preflight 不是产品语义硬上限；它只用于判断当前操作是否能完整、安全、原子完成。
- 首版预算使用注入到 runtime 的最小 limits 对象，不暴露给 Web request，由 `agent-app` composition 提供默认值，测试可以注入小值：
  ```ts
  interface SessionForkResourceLimits {
    readonly maxCopiedMessages: number;
    readonly maxCopiedContentBytes: number;
    readonly maxPromotionRefs: number;
    readonly maxPromotedBytes: number;
  }
  ```
- runtime MUST 在调用 gateway composite write 前完成 preflight；gateway prefix query 可以内部分批读取，但 runtime 不得使用 partial prefix 继续 materialization；context-engine 不参与容量决策；gateway-local 只执行 prefix query 和 composite write，不决定“是否太大”。
- 当完整 prefix、projection、durable promotion 或 composite write 无法在当前资源预算内完成时，fork 返回 safe failure（例如 `SESSION_FORK_RESOURCE_EXHAUSTED`），不得创建 child session、partial copied messages、visible partial promoted content 或 partial active context；已经 staged 的 promotion 必须保持不可见并进入 abort/cleanup。
- child active context 不把完整 history 直接发给模型；首次 submit 仍通过现有 context assembly、budget 和 compaction 路径处理。
- 验证入口：gateway transaction tests、large prefix/resource-exhausted characterization test、message projection tests、context assembly test 证明模型输入来自 active context 而不是全量 history。

**可靠性/恢复**

- composite write 保证 fork 要么完整可见，要么失败不可见。
- idempotency anchor 保证网络重试返回同一 child session。
- source session 不被修改，fork 失败不会破坏原会话。
- child session 首次 submit 使用正常 request lifecycle，继承既有 terminal commit 和 recovery 机制。
- failed fork attempts MUST NOT write the successful idempotency anchor. The same idempotency key only replays an already committed child; `STAGED`/`ABORTED` promotion residue cannot make a retry return a non-existent child.
- fork-promotion cleanup job only converges invisible residue. Fork safety depends on synchronous abort attempts and resolver `COMMITTED`-only lookup, not on scheduled cleanup running on time.
- 验证入口：transaction failure injection、idempotency replay test、source unchanged test、child first submit context test、promotion cleanup retry test。

**可维护性**

- runtime、session、context、gateway、channel 的 owner 分离清晰。
- 不引入 fork tree、historical active context snapshot 或 parallel task model。
- public DTO 窄化，内部 fork source 字段都有明确原因。
- 验证入口：contract tests、architecture tests、code review 检查 gateway 不做业务选择、channel 不导入 gateway fork records。

**可测试性**

- anchor eligibility、prefix copy、id remap、active context refs、notice visibility 和 idempotency 都可用 deterministic fixtures 测试。
- gateway composite write 可用 SQLite transaction failure fixture 测试。
- Web route 可用 Fastify inject 测试 schema 和 response projection。
- 验证入口：unit、contract、integration、architecture、OpenSpec strict validate。

**审计/可追溯性**

- fork source fact 提供最小 provenance。
- audit/diagnostic 使用 hashed/bounded refs 和安全 outcome，不记录内容。
- `forkNotice` 不执行 source availability check；source link 打开仍走现有 session read/navigation 权限校验和 safe not-found 处理。
- 验证入口：audit/diagnostic payload tests、fork source persistence tests、forkNotice source link existing-navigation semantics test。

## 文档承载决策（Documentation Ownership）

- 行为契约主承载：`openspec/specs/session-fork-from-message/spec.md`。
- 核心契约主承载：`openspec/specs/ts-core-contracts/spec.md` 和归档后的 `openspec/designs/architecture/core-contracts.md`。
- Web route 行为主承载：`openspec/specs/ts-minimal-agent-kernel/spec.md`；模块职责归档到 `openspec/designs/modules/agent-channel-web.md`。
- runtime/session/context/gateway 跨模块流程主承载：归档到 architecture 文档，尤其 runtime boundary、context assembly 和 core contracts 相关主题。
- 模块职责主承载：`openspec/designs/modules/agent-runtime.md`、`agent-session.md`、`agent-context-engine.md`、`agent-platform-gateway-local.md`、`agent-channel-web.md`。
- 长期取舍主承载：`openspec/designs/adr/session-fork-copies-prefix-not-runtime-state.md`。
- 导航主承载：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [风险] 复制完整 prefix 会增加存储成本。-> 接受该成本，因为用户明确要求完整继承历史；prefix read 可内部分批但不得语义截断，超出当前资源预算时原子失败。
- [风险] 历史 anchor 的 context 与 source 当前 active context 不一致。-> 不复制 parent 当前 active context，改由 copied prefix 生成 child effective context；compressed summary 必须作为 replacement 保留，避免 summary 与 covered originals 同时进入 child active context。
- [风险] copied message 中可能含 source-specific refs。-> fork materialization 必须使用 safe child message projection，覆盖 content、metadata、replacement evidence 和 backing refs；source run/checkpoint/timeline/raw provider refs 必须移除，execution-bound refs 必须通过 gateway metadata staging promotion 后重写为 child-accessible `ContentRef`，不得暴露 `BlobRef` 或 source path，否则 fork 失败。
- [风险] 新增 composite write 扩大 gateway contract。-> 这是保证原子性的最小必要 contract；不引入通用事务脚本或 generic record store。
- [风险] fork 入口和 notice 横跨后端 API 与 `frontend/agent-web`。-> 本 change 只实现最小按钮、busy/error、成功跳转和 notice 链接，不实现 fork tree、lineage 管理或父子同步；验证覆盖后端 API、DTO、message eligibility 和前端入口状态。

## 迁移计划（Migration Plan）

需要 local gateway schema migration：

- 新增 `session_forks` 专用事实表，按 `tenantId + subjectId + agentId + childSessionId` 唯一定位 child fork source。
- 新增 `fork_promoted_contents` 或等价 promotion metadata 表，按 owner scope、Agent Scope、fork attempt、target child session/message 和 promoted content id 记录 `STAGED`/`COMMITTED`/`ABORTED` lifecycle；`BlobRef` 只作为 gateway 内部字段保存，不进入 public/session/model projection；为 `status + createdAt` 建立 cleanup candidate 索引，首版不保存 per-record `expiresAt`。
- 为 `tenantId + subjectId + agentId + sourceSessionId + sourceAnchorMessageId + idempotencyKey` 建立 scoped uniqueness。
- 不修改现有 session/message/active_context 表语义；新增 composite write 复用这些专用事实表。

发布和回滚：

- 新 route 在后端可用后，旧客户端不调用该 route，不受影响。
- 若需要回滚，可停止暴露 route；已创建的 forked sessions 保持普通 session 可读，fork notice 依赖新增 fork source 表，缺失时安全退化为无 notice。
- 不需要迁移既有 sessions；历史 session 默认无 fork source。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/session-fork-from-message/spec.md`：提升 fork 行为、隔离、active context、notice、idempotency 和失败契约。
- `openspec/specs/ts-core-contracts/spec.md`：提升 fork command、fork source、fork notice、promotion staging lifecycle、gateway composite write 和 child active context 初始化契约。
- `openspec/specs/ts-minimal-agent-kernel/spec.md`：提升 fork Web route 和 conversation `forkNotice` projection。
- `openspec/overview.md`：补充派生会话能力背景。
- `openspec/designs/architecture/core-contracts.md`：补充 DO/DTO/Record/port ownership、fork source 字段、promotion staging metadata lifecycle 和 composite write。
- `openspec/designs/architecture/runtime-boundaries.md`：补充 fork command 不进入 request lifecycle 的边界。
- `openspec/designs/architecture/context-assembly.md`：补充 child active context 初始化规则。
- `openspec/designs/modules/agent-runtime.md`：补充 fork orchestration。
- `openspec/designs/modules/agent-session.md`：补充 fork notice 和 session read model。
- `openspec/designs/modules/agent-context-engine.md`：补充 `ForkActiveContextSelectionPort` 实现边界。
- `openspec/designs/modules/agent-channel-web.md`：补充 route/schema/projection。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充 SQLite composite transaction、fork metadata 表和 promotion metadata 表。
- `openspec/designs/adr/session-fork-copies-prefix-not-runtime-state.md`：记录核心取舍。
- `openspec/designs/spec-to-design-map.md`：新增导航。

## 待确认问题（Open Questions）

无。`frontend/agent-web` 的具体实现范围限定为最小派生按钮、失败提示、成功跳转和 fork notice 展示；更完整的 fork tree、lineage 管理和父子同步不属于本 change。
