## 1. Contract 和 DTO

- [x] 1.1 在 `agent-contracts/session` 新增 `ForkNotice` read model，并扩展 conversation/session message page 以承载可选 `forkNotice`；不得在 session subpath 暴露 fork command
  验证：`npm run test:contract`；新增或更新 `tests/contract/session-fork-contracts.test.ts`
  来源：specs/ts-core-contracts "Session Fork Public Contracts"；design D1、D7

- [x] 1.2 在 `agent-contracts/runtime` 扩展 `RuntimeSessionPort`，新增 runtime-owned fork command/result 入口
  验证：`npm run test:contract`；`tests/contract/session-fork-contracts.test.ts` 断言 method signature 和 command 字段；编译覆盖所有 `RuntimeSessionPort` 实现者和 test doubles 已同步新增 contract
  来源：specs/ts-core-contracts "Session Fork Public Contracts"；design D1

- [x] 1.3 在 `agent-contracts/context` 新增窄化 `ForkActiveContextSelectionPort` 及 request/result DTO，输入 copied child messages，输出 child message ids
  验证：`npm run test:contract`；contract test 断言 runtime 依赖 context port contract，不依赖 `agent-context-engine` implementation package
  来源：specs/ts-core-contracts "Child Active Context Initialization Contract"；design D4

- [x] 1.4 在 `agent-contracts/gateway` 新增 fork source record、prefix query、`ForkSessionFromMessageWriteRequest`、`ForkSessionFromMessageWriteResult`、fork promotion staging request/metadata record/status、幂等 replay 预查、committed promotion metadata-aware content read，以及 runtime-facing `stageForkPromotion`、`abortForkPromotions`、`cleanupExpiredForkPromotions` 方法；不得暴露 runtime-callable `commitForkPromotionsForFork`；promotion commit 只能由 fork composite write transaction 内部完成；stage request 必须接收 owner+agent、forkAttempt、source/target 坐标、refType、bytes、mimeType、sizeBytes，不接收 caller-supplied `promotedContentId`、`status`、timestamp、`BlobRef`、`safeSummary` 或 `expiresAt`；cleanup request 只接收 `now` 和 `retentionMs`
  验证：`npm run test:contract`；contract test 断言 Record 只作为 gateway port 入参/返回值，不进入 session/Web DTO；`ForkSessionFromMessageWriteResult` 返回 `{ childSession, replayed }`；promotion metadata 区分 `STAGED`/`COMMITTED`/`ABORTED` 且不暴露 `BlobRef` 给 session/Web/model contract；committed promotion 只能通过 owner+agent+child session/message+promotedContentId 的 metadata-aware read 读取 bytes，不能把 `promotedContentId` 当普通 `BlobRef`；stage 拒绝 `sizeBytes` 与 bytes 长度不一致的请求；promotion commit 必须绑定 fork composite write transaction 且没有 runtime-callable commit port；cleanup candidate 只基于 `status + createdAt`/retention；编译覆盖 gateway 实现者和 test doubles 已同步新增 contract
  来源：specs/ts-core-contracts "Fork Source Metadata Contract"、"Fork Composite Gateway Write"、"Fork Promotion Staging Contract"；design D3.1、D5、D6

- [x] 1.5 增加 public DTO 负向 contract test，证明 `forkNotice` 不暴露 source anchor、child anchor、idempotency key、timeline、checkpoint 或完整 fork source record
  验证：`npm run test:contract -- tests/contract/session-fork-contracts.test.ts`
  来源：specs/session-fork-from-message "Fork Notice Projection"；specs/ts-core-contracts "Session Fork Public Contracts"

## 2. Context Engine fork active context selection

- [x] 2.1 在 `agent-context-engine` 实现 `ForkActiveContextSelectionPort`，输入 canonical copied child messages，按 child anchor 截止并输出 child message ids；runtime 不直接导入该 implementation package；在 `agent-context-engine` 包内从 normal assembly history selection 路径提取 package-internal prior-history candidate helper，由 normal assembly 和 fork selector 共同调用；该 helper 不得提升为跨 package public contract，fork selector 不得用 fake current request 调 full assembly/current-request selection path；selector 只校验 fork-specific child 输入约束
  验证：`npm test -- tests/agent-kernel/session-fork-context.test.ts`
  来源：specs/ts-core-contracts "Child Active Context Initialization Contract"；design D4

- [x] 2.2 覆盖 child active context 只引用 child message ids 的正向测试
  验证：`npm test -- tests/agent-kernel/session-fork-context.test.ts`
  来源：specs/session-fork-from-message "Child Session Inherits Prefix And Model-Visible Context"

- [x] 2.3 覆盖历史 anchor 不复制 parent 当前 active context 的负向测试：parent anchor 后新增消息后再 fork，child active context 不包含 anchor 后 refs
  验证：`npm test -- tests/agent-kernel/session-fork-context.test.ts`
  来源：specs/session-fork-from-message "Child Session Inherits Prefix And Model-Visible Context"；design D4

- [x] 2.4 覆盖 copied prefix 中 hidden replacement、incomplete tool protocol、orphan capability result 通过共享 prior-history selection helper 被排除的 characterization test
  验证：`npm test -- tests/agent-kernel/session-fork-context.test.ts`
  来源：design D4；specs/ts-core-contracts "Child Active Context Initialization Contract"

- [x] 2.5 覆盖 selector 非法输入失败测试：missing anchor、duplicate message id、mixed child session ids、parent message refs 或 anchor 后记录均失败，且 fork materialization 不写 child active context
  验证：`npm test -- tests/agent-kernel/session-fork-context.test.ts`
  来源：specs/ts-core-contracts "Child Active Context Initialization Contract"；design D4

- [x] 2.6 覆盖 copied prefix 中已有 context compression summary message 的 selection 测试：summary 行为必须与 normal context assembly 的 prior-history helper 一致，保留的 summary metadata refs 已重映射为 child message ids；当 summary 覆盖更早 copied child messages 时，child active context 选择 child summary 且不再选择 covered original refs；summary refs 无法 remap 时 selection 失败
  验证：`npm test -- tests/agent-kernel/session-fork-context.test.ts`
  来源：specs/ts-core-contracts "Child Active Context Initialization Contract"；design D4

- [x] 2.7 增加 fork selector 与正常 context assembly prior-history 判断一致性的 characterization test
  验证：`npm test -- tests/agent-kernel/session-fork-context.test.ts`
  来源：specs/ts-core-contracts "Child Active Context Initialization Contract"；design D4

## 3. Gateway-local persistence

- [x] 3.1 在 SQLite gateway 初始化中新增 `session_forks` 专用事实表、`fork_promoted_contents` 或等价 promotion metadata 表及 scoped uniqueness/visibility/cleanup 索引；首版不保存 per-record `expiresAt`
  验证：`npm test -- tests/agent-kernel/session-fork-gateway.test.ts`，断言表、列、`STAGED`/`COMMITTED`/`ABORTED` 状态约束、child target 坐标、唯一索引、`status + createdAt` cleanup candidate 索引存在，且 metadata 中的 `BlobRef` 不通过 public/session DTO 返回
  来源：design D3.1、D5、D6、Migration Plan；specs/ts-core-contracts "Fork Promotion Staging Contract"

- [x] 3.2 实现内部 source prefix query，按 owner+agent+session 和 canonical order 返回 source session 开头到 anchor 的完整 canonical durable message records，不受 public conversation read 的 hidden/capability-result 过滤影响；实现可内部分批读取但不得语义截断 prefix
  验证：`npm test -- tests/agent-kernel/session-fork-gateway.test.ts`，覆盖正常 prefix、anchor 不存在、跨 owner/agent 返回安全空/失败、large prefix 内部分批但返回完整 prefix，以及 hidden replacement / capability result / summary protocol fragments 不被 prefix query 过滤
  来源：design D3；specs/session-fork-from-message "Child Session Inherits Prefix And Model-Visible Context"

- [x] 3.3 实现 fork composite write，在一个 transaction 内写入 child session、copied messages、child active context state/items（`activeContextVersion=0`、ordinals 从 0 连续）、fork source metadata、idempotency anchor，并在同一个 transaction 内将 matching `forkAttemptId + childSessionId` promotions 标记为 `COMMITTED` 并关联到 child refs；返回 `ForkSessionFromMessageWriteResult { childSession, replayed }`；不得提供 runtime 可单独调用的 promotion commit
  验证：`npm test -- tests/agent-kernel/session-fork-gateway.test.ts`，断言 transaction 成功时 promotion 与 child facts 一起 committed 且 `replayed=false`，response delivery 失败后的同 key replay 返回已 committed child 且 `replayed=true`
  来源：specs/ts-core-contracts "Fork Composite Gateway Write"、"Fork Promotion Staging Contract"；design D3.1、D5

- [x] 3.4 增加 fork active context 初始化负向验证，证明 composite write 直接初始化 child active context state/items，不通过普通 `appendSessionMessage` 或 `appendItem` 逐条追加；初始化完成后 `activeContextVersion=0`
  验证：`npm test -- tests/agent-kernel/session-fork-gateway.test.ts`；新增或更新 `tests/architecture/session-fork-boundaries.test.ts`
  来源：specs/ts-core-contracts "Child Active Context Initialization Contract"；design D4、D5

- [x] 3.5 增加 transaction failure injection 测试，证明任一步失败后 child session 不可从 list/conversation 观察到，且 staged/aborted promotion 不可被 content/artifact resolver 或 model context assembly 观察到；失败 attempt 不写成功 idempotency anchor
  验证：`npm test -- tests/agent-kernel/session-fork-gateway.test.ts`
  来源：specs/session-fork-from-message "Fork Failure Is Atomic And Safe"

- [x] 3.6 增加 fork idempotency 测试：相同 source anchor + idempotencyKey 返回同一 child session，不同 key 创建不同 child session；失败 attempt 的 `STAGED`/`ABORTED` promotion residue 不得让同 key 返回不存在的 child session
  验证：`npm test -- tests/agent-kernel/session-fork-gateway.test.ts`
  来源：specs/session-fork-from-message "Fork Idempotency"

- [x] 3.7 实现 fork-promotion cleanup job 所需 gateway-local candidate/cleanup 方法，入参只包含 `now` 和 `retentionMs`，按 `status in (STAGED, ABORTED)` 且 `createdAt < now - retentionMs` 选择 residue；过期 `STAGED` 必须条件更新为 `ABORTED`，`ABORTED` best-effort `deleteBlob`；blob 不存在或删除成功后必须删除 promotion metadata，删除失败必须保留 `ABORTED` metadata 并计入 retryable residue；不得选择 `COMMITTED`，不得新增 `CLEANED` 状态、`cleanupCompletedAt` 或 `expiresAt`
  验证：`npm test -- tests/agent-kernel/session-fork-gateway.test.ts`，覆盖 expired `STAGED` -> `ABORTED`、expired `ABORTED` delete success 后删除 metadata、blob missing 后删除 metadata、delete failure retryable、`COMMITTED` 不被选中
  来源：specs/ts-core-contracts "Fork Promotion Staging Contract"；design D3.1

## 4. Runtime fork orchestration

- [x] 4.1 在 runtime session facade 实现 `forkFromMessage`：解析 trusted Agent Scope、校验 source session、读取 anchor、读取 source prefix、生成 child ids、调用注入的 `ForkActiveContextSelectionPort` 和 gateway composite write
  验证：`npm test -- tests/agent-kernel/session-fork-runtime.test.ts`
  来源：specs/session-fork-from-message "Fork From Durable Visible Assistant Message"；design D1、D3、D4、D5

- [x] 4.2 实现 anchor eligibility 校验：只接受 owner+agent scoped、visible、非空、已持久化并可由 conversation history 读取且满足 design D2 完整 eligibility 的 assistant message；不以 `RequestRun.status=COMPLETED` 作为 eligibility 条件，但可观察到 source run non-terminal 时必须作为持久化不变量异常拒绝
  验证：`npm test -- tests/agent-kernel/session-fork-runtime.test.ts`，覆盖 user/system/capability result/hidden/replaced/空内容/不存在 message 均拒绝
  来源：specs/session-fork-from-message "Fork From Durable Visible Assistant Message"；design D2

- [x] 4.3 实现 copied message id remap：new child `messageId`、child `sessionId`、child-side `requestId`，copied messages 不携带 source `runId`
  验证：`npm test -- tests/agent-kernel/session-fork-runtime.test.ts`，断言 child records 不含 source ids/run ids
  来源：specs/session-fork-from-message "Child Session Inherits Prefix And Model-Visible Context"；design D3

- [x] 4.4 实现 source title snapshot 到 child title 和 fork source metadata 的写入，使用 session-domain normalized title（trim；缺失或空标题使用 `Untitled session`），不得依赖 Web `displayTitle` alias 或 `safeTitle()` helper
  验证：`npm test -- tests/agent-kernel/session-fork-runtime.test.ts`，覆盖 source rename 后 child title/notice title 使用 fork 时快照，以及 source title 缺失/空白时使用 normalized default
  来源：specs/session-fork-from-message "Fork Notice Projection"；design D6、D7

- [x] 4.5 增加 runtime 负向测试，证明 fork 不创建 RequestRun、不调用 Agent core、不调用 model provider、不修改 source messages/active context/timeline
  验证：`npm test -- tests/agent-kernel/session-fork-runtime.test.ts`
  来源：specs/session-fork-from-message "Forked Session Is Isolated From Source Session"；design D9

- [x] 4.6 增加 child first submit characterization test，证明首次 submit 从 child active context 读取 prior history，不读取 parent history 或 parent active context；fork active context v0 初始化不调用 model provider、不运行 context compression、不新建 summary
  验证：`npm test -- tests/agent-kernel/session-fork-runtime.test.ts`
  来源：specs/session-fork-from-message "Child Session Inherits Prefix And Model-Visible Context"；design D4

- [x] 4.7 实现 copied message safe child message projection，保留显示和 context 所需 content/metadata，检查 content、metadata、replacement evidence、summary metadata、`ContentRef` 和 backing refs，去除 source run/checkpoint/timeline refs、runtime-only refs 和 raw provider fields；未知 metadata 若包含 source runtime refs 或 execution-bound refs 必须 fail safe
  验证：`npm test -- tests/agent-kernel/session-fork-runtime.test.ts`，断言 copied content/metadata 不包含 source run/checkpoint/timeline/raw provider refs；summary message refs 被 remap 为 child ids；replacement/source runtime lineage 被清除或导致 fail；未知 metadata 不含 source-bound/runtime-only 值时可保留，含 source run/checkpoint/timeline/raw provider/source execution path/host path/execution-bound ref 时 fail safe；owner+agent scoped 且 child-accessible 的 durable attachment/artifact/blob refs 可保留或 remap；`tool-results/<refId>`、source run workspace path、tmp/cache/log/test-output 等 execution-bound refs 只能通过既有 workspace/sandbox/resolver 边界读取并 promotion；无法通过既有可信 resolver 读成 bytes 的 execution-bound ref 必须 fail safe；不得新增 generic host-file read port；promotion stage request 写入 bytes + target coords，返回 opaque blob + `STAGED` metadata，child message 被重写为 child-accessible `ContentRef`/promoted content id，不包含 `BlobRef`、source execution path 或 host path；stage metadata 写入失败时 best-effort 删除刚写入 blob 且 fork 原子失败；child first submit 模型输入不包含 source execution workspace read 指令
  来源：specs/session-fork-from-message "Child Session Inherits Prefix And Model-Visible Context"、"Forked Session Is Isolated From Source Session"、"Fork Failure Is Atomic And Safe"；specs/ts-core-contracts "Safe Child Message Projection"、"Fork Promotion Staging Contract"；design D3、D3.1

- [x] 4.8 增加 fork resource preflight 测试，覆盖 runtime 注入的 `maxCopiedMessages`、`maxCopiedContentBytes`、`maxPromotionRefs`、`maxPromotedBytes` 任一超限时返回 safe failure，且不静默截断 prefix、不创建 visible child session、partial copied messages、partial durable promotions 或 partial active context；Web request 不得提供或覆盖这些 limits
  验证：`npm test -- tests/agent-kernel/session-fork-runtime.test.ts tests/agent-kernel/session-fork-gateway.test.ts tests/agent-kernel/session-fork-web.test.ts`，覆盖 preflight failure 不写 blob/metadata；同 key retry 在 promotion staging 前 replay；promotion staged 后 composite write 失败或 late replay 时 runtime 同步调用 abort，staged content 不可见并进入 `ABORTED` 或保持 retryable cleanup residue；cleanup failure 不会让 staged/aborted content 变为可见；成功 fork 后 resolver 只解析 `COMMITTED` promotion；Web body 不能提供或覆盖 runtime resource limits
  来源：specs/session-fork-from-message "Fork Failure Is Atomic And Safe"；specs/ts-core-contracts "Fork Promotion Staging Contract"；design D3、D3.1、Quality Attributes

- [x] 4.9 实现 fork-promotion cleanup job factory 并在 `agent-app` 注册到既有 `ScheduledMaintenanceGatewayPort`；默认 `cadenceMs=60 * 60 * 1000`、`retentionMs=24 * 60 * 60 * 1000`，job 只调用 `cleanupExpiredForkPromotions({ now, retentionMs })` 收敛不可见 residue，不拥有 fork 成功/失败语义；cleanup 成功删除 blob 或发现 blob 不存在后必须删除 promotion metadata，删除失败保留 `ABORTED` metadata 并计入 `retryableCount`，不得新增 `CLEANED` 状态、`cleanupCompletedAt` 或 `expiresAt`
  验证：`npm test -- tests/agent-kernel/session-fork-runtime.test.ts tests/agent-kernel/session-fork-gateway.test.ts`；app composition 测试断言 job 注册、overlap 使用 `SKIP`、stop abort 不影响 request lifecycle，cleanup 不处理 `COMMITTED` 且不会让 staged/aborted content 可见
  来源：design D3.1；specs/ts-core-contracts "Fork Promotion Staging Contract"

## 5. agent-session read model 和 fork notice

- [x] 5.1 在 session read model 中加载 fork source metadata，并在 conversation/message page 中计算可选 `forkNotice`
  验证：`npm test -- tests/agent-kernel/session-fork-session-service.test.ts`
  来源：specs/session-fork-from-message "Fork Notice Projection"；design D7

- [x] 5.2 实现 `forkNotice` 显隐规则：仅默认/latest conversation bootstrap 在 child anchor 后无 user message 时返回；child anchor 后有 user message 后不返回；不基于 `forkedAt`；`forkNotice` 不作为 message、不进入 active context
  验证：`npm test -- tests/agent-kernel/session-fork-session-service.test.ts`
  来源：specs/session-fork-from-message "Fork Notice Projection"；design D7

- [x] 5.3 增加 `forkNotice` 不做 source availability check 的测试：child conversation 仍返回标题快照和普通 source session target，不返回 source 可用性/删除/权限状态；打开 source 仍走既有 session read/navigation safe not-found
  验证：`npm test -- tests/agent-kernel/session-fork-session-service.test.ts`
  来源：specs/session-fork-from-message "Fork Notice Projection"

## 6. Web API 和 projection

- [x] 6.1 在 `agent-channel-web` 新增 `POST /api/v1/sessions/:sessionId/messages/:messageId/fork` route 和 TypeBox schema
  验证：`npm test -- tests/agent-kernel/session-fork-web.test.ts`
  来源：specs/ts-minimal-agent-kernel "Session Fork Web Route"；design D8

- [x] 6.2 增加 Web schema negative tests，证明请求体缺失 `idempotencyKey`、`idempotencyKey` 为空、trim 后为空、超过 128 字符或非字符串，以及携带 owner、agent、child ids、fork source、copied messages、active context、timeline 或 checkpoint 字段时被拒绝；正向测试证明 route 只向 runtime 传递 trim 后的 normalized key，且日志/metric/audit 不记录原始 key
  验证：`npm test -- tests/agent-kernel/session-fork-web.test.ts`
  来源：specs/ts-minimal-agent-kernel "Session Fork Web Route"

- [x] 6.3 扩展 conversation projection，默认/latest bootstrap 返回可选 `forkNotice`，并保证 response 不返回内部 fork source record；`cursor`、`newerCursor` 或 `anchorMessageId` 读取不返回 `forkNotice`
  验证：`npm test -- tests/agent-kernel/session-fork-web.test.ts`，覆盖 default/latest 有 notice、cursor/newerCursor/anchorMessageId 无 notice、首条 child user message 后无 notice，且 notice 不作为 conversation item
  来源：specs/ts-minimal-agent-kernel "Fork Notice Conversation Projection"；specs/ts-core-contracts "Session Fork Public Contracts"

- [x] 6.4 增加 route 行为测试：fork 成功返回 child session metadata，客户端随后读取 child conversation 能看到 copied visible prefix 和 fork notice
  验证：`npm test -- tests/agent-kernel/session-fork-web.test.ts`
  来源：specs/session-fork-from-message "Fork From Durable Visible Assistant Message"、"Fork Notice Projection"

- [x] 6.5 在 `frontend/agent-web` 增加最小 fork 入口和 fork notice 展示：模型回复操作区收藏按钮右侧显示派生图标；仅 history-loaded durable assistant message 启用；点击后调用 fork route，成功打开 child session，失败使用统一 toast；fork notice 只把 source title 渲染为链接，child 首次提交后隐藏
  验证：`npm test -- frontend/agent-web/tests/TurnBlock.test.tsx frontend/agent-web/tests/buildTurnBlocks.test.ts frontend/agent-web/tests/chat-page.route-state.test.tsx frontend/agent-web/tests/conversationStore.test.ts frontend/agent-web/tests/sessionService.test.ts`
  来源：design D8；specs/session-fork-from-message "Fork Notice Projection"

## 7. App composition 和 architecture guards

- [x] 7.1 在 `agent-app` composition root 注入新增 runtime/session/gateway/context dependencies，包括 `ForkActiveContextSelectionPort`
  验证：`npm run build`
  来源：proposal Impact；design D1、D4、D5

- [x] 7.2 更新 architecture/source-level assertions，证明 `agent-channel-web` 不导入 gateway fork records，gateway-local 不导入 runtime/session/context implementation，runtime 不导入 channel implementation 或 `agent-context-engine` implementation package
  验证：`npm run lint:architecture`；新增或更新 `tests/architecture/session-fork-boundaries.test.ts`
  来源：specs/ts-core-contracts "Session Fork Public Contracts"；design Documentation Ownership

- [x] 7.3 增加 source-level negative assertion，证明产品路径没有使用 subagent execution、task tools 或 async detach 实现 session fork
  验证：`npm run lint:architecture` 或 `npm test -- tests/architecture/session-fork-boundaries.test.ts`
  来源：proposal Non-Goals；design D1

## 8. 集成验证

- [x] 8.1 运行 session fork 相关单元、contract、integration 和前端入口 tests
  验证：`npm test -- tests/agent-kernel/session-fork-context.test.ts tests/agent-kernel/session-fork-gateway.test.ts tests/agent-kernel/session-fork-runtime.test.ts tests/agent-kernel/session-fork-session-service.test.ts tests/agent-kernel/session-fork-web.test.ts frontend/agent-web/tests/TurnBlock.test.tsx frontend/agent-web/tests/buildTurnBlocks.test.ts frontend/agent-web/tests/chat-page.route-state.test.tsx frontend/agent-web/tests/conversationStore.test.ts frontend/agent-web/tests/sessionService.test.ts`
  来源：design Quality Attributes；AGENTS.md 验证门禁

- [x] 8.2 运行全量 TypeScript build
  验证：`npm run build`
  来源：AGENTS.md 验证门禁

- [x] 8.3 运行 contract test suite
  验证：`npm run test:contract`
  来源：specs/ts-core-contracts 全部新增 requirements

- [x] 8.4 运行架构边界验证
  验证：`npm run lint:architecture`
  来源：design Quality Attributes；AGENTS.md 架构边界

- [x] 8.5 运行 OpenSpec 严格校验
  验证：`openspec validate --all --strict`
  来源：AGENTS.md OpenSpec 验证门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/session-fork-from-message/spec.md`、`openspec/specs/ts-core-contracts/spec.md` 和 `openspec/specs/ts-minimal-agent-kernel/spec.md`。
- 更新 `openspec/overview.md` 中的长期能力背景。
- 更新 `openspec/designs/architecture/core-contracts.md`、runtime boundary 和 context assembly 相关架构文档。
- 更新 `openspec/designs/modules/agent-runtime.md`、`agent-session.md`、`agent-context-engine.md`、`agent-channel-web.md` 和 `agent-platform-gateway-local.md`。
- 新增或更新 `openspec/designs/adr/session-fork-copies-prefix-not-runtime-state.md`。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一 API schema、数据 owner、fork source 字段或 active context 初始化语义。

## Review follow-up: live completed fork

- [x] Add runtime request-scoped fork command that resolves source request/root message id to one durable completed assistant message before reusing `forkFromMessage`.
- [x] Add Web `POST /api/v1/sessions/:sessionId/requests/:requestId/fork` route with the same narrow idempotency body schema.
- [x] Enable frontend fork action for completed live assistant responses using request/root message id, while preserving message-id fork for conversation-loaded assistant messages.
- [x] Add focused backend, contract and frontend tests for request fork routing and live completed fork behavior.
