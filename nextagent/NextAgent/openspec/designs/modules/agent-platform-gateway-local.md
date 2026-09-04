# agent-platform-gateway-local

## 职责

本模块拥有 LOCAL sandbox 的物理 root layout 执行准备和进程生命周期。它不修改调用前资源的 POSIX mode、Windows ACL、所有权或只读属性；遇到 `EACCES` 或 `EPERM` 时将其映射为不含宿主路径的安全权限失败。仅授权 regular file 的直接执行在可读但不可执行时可复制到本运行 `temp/` 根，给副本设置最小执行权限并在启动失败或完成后清理。Python 继续由可信解释器读取脚本，不依赖脚本 execute 位。

承载 SQLite local gateway adapter。它拥有 local persistence 的私有 row/schema/index/transaction 细节，并为 Working Memory、Long-term Memory 和保留 SQLite 三类 LOCAL provider 提供独立实现。Working Memory provider 拥有主路径 request run、session、message、active context、timeline event、checkpoint、pending input、annotation/share、session fork source/promotion、runtime recovery scan/claim 和 capability recovery guard；Long-term Memory provider 拥有长期记忆 store/retriever；保留 SQLite provider 拥有 attachment reservation/blob、task trajectory、todo、user question activity 和 audit。它也承载 LOCAL deployment 的 sandbox gateway adapter 和 scheduled maintenance execution 形态。

## 非职责

不泄漏 database driver-specific record、file path、SQLite/Kysely 类型或本地运行细节给 runtime、core、context、channel 或 contracts。不使用 generic `records(store,key,json)` 作为主路径业务事实底座；不把领域业务组装逻辑下推到 store。不解释 Skill identity、cleanup policy、execution workspace authorization、memory extraction、memory aging、task outcome 或 memory tool 行为；这些由 capability/runtime/memory owner 提供。

不拥有 developer diagnostic artifact writer 实现、export、testing 或 LOCAL entrypoint 注入。该 writer 的唯一 owner 是 `agent-log`（`createDeveloperDiagnosticArtifactWriter`），由 `agent-app` 统一 Plugin host composition 默认装配，部署专用入口不感知也不注入。

## 依赖

允许依赖 `@nextagent/agent-common`、`@nextagent/agent-contracts/gateway` 和 adapter-local libraries。不得依赖 Web channel、runtime implementation、core、session implementation、app composition 或其它 implementation package。

## 核心设计落点

- LOCAL audit由 `FileAuditEventStoreGateway` owning：把完整 `AuditEventRecord` 包装为私有 `schemaVersion=1` 单行，duplicate retry允许重复完整行，并使用独立 `agent-local-file-roll` handle。
- Audit不再属于SQLite：没有 `audit_events` table/index、query、dual write、operational mirror或跨重启 dedup index；gateway binding从 top-level `GatewayBindings.audit` 提供。
- Audit policy固定 `nextagent-audit` date-sequence、100 MiB、daily/gzip、7 elapsed days；不读取、不复用 operational/metrics state。

- 落实 `architecture/core-contracts.md` 的 gateway `*Record`、CAS result、idempotent write options 和 composite request 语义。
- 落实最小内核 SQLite persistence：专用事实表、锚点幂等、message append transaction、terminal commit transaction、session lane snapshot query、`loadRunByIdempotencyKey` 和 recovery claim/terminal transaction。
- timeline persistence 按 runtime 已分类的事件写入 `timeline_events`：completed thinking 与合法 message-ref process event 复用普通 scoped append，live-only delta 不写 row、不消耗 sequence。`listEvents` 在 SQL/row boundary 保持 owner、Agent、session、run scope、稳定 sequence 与 bounded pagination，损坏 row 不得被当作 empty page；私有幂等 migration 维护 `(tenant_id, subject_id, agent_id, session_id, run_id, sequence)` 辅助索引，仅优化既有查询，不新增 public query/Record/table/remote contract。
- 直接实现 long-term memory public gateway ports：`SqliteLongTermMemoryCore` / `SqliteLongTermMemoryStores` 提供完整 `LongTermMemoryGatewayBindings`，使用 `long-term-memory.sqlite`、专用 `long_term_memory` 表和 adapter-private retrieval index/FTS5 fallback。FTS5、literal fallback、row schema、index sync、`generateLongTermMemoryId()` 和 row mapper 都是本 package 私有实现细节。
- 直接实现 task trajectory public gateway ports：保留 SQLite provider 的 `SqliteGatewayStoreBindings.taskTrajectoryStore` / `taskTrajectoryQuery` 使用 `nextagent.sqlite` 中的专用 task trajectory facts/table 和 scoped build-candidate query。build candidate query 只能返回 owner/agent/session/run/terminal event refs、状态和 cursor，不得返回 raw content。
- 隔离 SQLite/Kysely row/schema/index/transaction 细节，不向上层泄漏 driver-specific record 或 filesystem path。
- gateway-local 只返回持久化事实和 CAS/claim 结果，不反推业务事件语义，不决定 retry replacement、cancel terminal reason、capability replay policy 或 recovery eligibility。
- LOCAL persistence uses three independent SQLite files derived from trusted `workspaceRoot`: `working-memory.sqlite`、`long-term-memory.sqlite` and `nextagent.sqlite`. Providers must not share database connections, schema owners, transaction objects or cross-provider transactions. Current baseline starts from empty schema only; it does not read an old single database, run data migration, dual-write or fall back at runtime.
- gateway-local 不拥有 memory lifecycle business policy：不判断 extraction candidate、AGING decay/archive/delete/revival 合法性、task outcome 语义、memory tool exposure gate 或 remote complete-service backend 策略；它只执行 scoped row/index updates、validation、version/CAS、幂等和 transaction。
- LOCAL sandbox adapter 接收 capability/runtime 派生的 `SandboxExecutionRequest.filesystem`，从 layout 生成 process cwd、root mapping、temp env、timeout/cancellation 和 output bounds。LOCAL mode 可使用物理 `scopeBase` 作为 cwd，以支持 `workspace/...`、`.nextagent/...`、`temp/...` root-qualified relative paths，但只能声明 best-effort filesystem enforcement。
- LOCAL adapter 不得从 `workspaceDir`、raw config、Skill source path 或 capability args 自行派生 sandbox root；缺少 filesystem layout 或 root authorization 时必须 fail closed。
- LOCAL mode 可对 committed `.nextagent/skills/<skillProjectionKey>/<skill-name>/` projection subtree 施加 host ACL/chmod read-only protection。该保护失败或 cleanup 受阻只能产生 safe diagnostics 和后续重试，不能影响 request terminal handling。
- attachment metadata cleanup 通过 `AttachmentStoreGateway` 记录和 `BlobStoreGateway` delete/check 由本模块适配，但 cleanup candidate selection、owner/agent scope 决策和 lifecycle 语义仍归 `agent-attachment-runtime`。
- 会话历史搜索由本模块在 SQLite 层基于现有 `sessions` 和 `messages` 源事实执行 scoped SQL 查询：标题和 visible USER message 内容做 literal contains 匹配，创建时间过滤、排序、分页和 `hasMore` 判断都在 session 结果集上完成；message 命中使用 `EXISTS` 或等价 session-level 子查询，不按 message match row 分页，不做 JS 全量内存过滤，不新增 FTS/search document/sidecar/rebuild 持久化结构。
- 会话删除由本模块提供 owner+agent scoped composite delete：在同一事务内检查非 terminal run 冲突，先删除该 session 的 `pending_inputs`，再删除 session、messages、active context、timeline、request runs、checkpoints、annotation/share 及其从属投影，不引入 tombstone 或 soft-delete retained state。删除成功后上层 Activity `NONE` 通知不属于数据库事务。
- `conversation_annotations.saveAnnotation` 在同一 SQLite 事务内执行回答收藏容量治理：固定上限为每个 `(tenant_id, subject_id)` 100 条 `is_favorited=1`，跨 agent 共享配额；仅 INSERT 新收藏或 false→true 净新增触发校验，取消收藏、true→true、sentiment/comment-only 更新和已 accepted 的幂等重放放行。超限在写入前返回 `FAVORITE_LIMIT_EXCEEDED`，supersede 清理和会话删除级联自然释放配额。`isQuestionFavorited` 不占用该配额。
- 对话标注 favorite list 查询在 SQLite 层返回 turn 粒度收藏事实：按 scope 过滤 `is_favorited=1` 的 annotation row，按 `updated_at` / `favoritedAt` 降序分页，并 LEFT JOIN `messages` 读取同 run 的 visible USER question preview。无匹配 USER message 时返回空 `questionPreview`，`rootMessageId` 回退为 `requestRunId`。gateway-local 只负责 scoped SQL、row mapping、preview 截断和 fallback，不把 session 聚合 favorite count 作为收藏列表事实。
- `conversation_annotations.question_favorite` 以 `INTEGER NOT NULL DEFAULT 0 CHECK (question_favorite IN (0, 1))` 映射 `ConversationAnnotationRecord.isQuestionFavorited`；新建表直接包含该列，既有数据库通过幂等 `ensureColumn` 补列并把旧记录读取为 `false`。annotation insert/update/row mapping 必须让问题收藏独立 round-trip；partial upsert 未提供该字段时保留原值。只有 `sentiment=null`、`is_favorited=0` 且 `question_favorite=0` 同时成立时才物理删除 annotation 行。`listFavoriteTurns()` 继续只按 `is_favorited=1` 查询，纯问题收藏不得进入回答收藏列表；本模块不因该字段伪造正式问题推荐 adapter。
- 当前会话 conversation preview 和 newer/anchor windows 由本模块基于现有 `messages` 表查询：preview 只统计/分页同 scope、同 session、visible USER marker，并仅为页内 marker 读取同 request visible ASSISTANT answer preview；conversation latest/older/newer/anchor 返回连续 visible segment，hidden/stale/cross-scope anchor fail closed。
- session fork 由本模块提供 scoped prefix/event query、`session_forks`、fork run snapshot status 和 `fork_promoted_contents` 专用事实，以及 composite write transaction。Prefix query 返回 source 开头到 anchor 的完整 canonical durable message records，不套用 public history hidden/capability-result 过滤；fork composite write 在同一事务内持久化 child session、copied messages、child active context v0、child-owned `FORK_SNAPSHOT` timeline rows、per-run `AVAILABLE | LEGACY_UNAVAILABLE` status、fork source metadata、idempotency anchor，并把 matching staged promotions 标记为 `COMMITTED`。普通 `appendEvent` 只能写 runtime origin，不能制造 snapshot。
- Scheduled maintenance execution 在 LOCAL mode MAY 使用 in-process self-rescheduling timer，具备 jitter、overlap prevention、abort/stop support 和 safe diagnostics。Gateway 只调度 capability-provided jobs，不枚举 Skill cleanup candidates、不解释 `skillProjectionKey`、不扩大 execution workspace 授权。
- local RAG fallback provider 把 startup-built temporary index 视为当前 trusted owner 的 workspace-scoped shared corpus。它必须校验 tenant、subject、knowledge scope kind 和 logical root，但不得仅因 `agentId` 或 `agentVersion` 不同就拒绝同 owner/workspace 检索；Agent identity 在本地 provider 中只保留 caller context 和诊断意义，不作为共享 workspace index 的隔离键。
- `createLocalApiCallPort` 实现 `ApiCallPort` 的 LOCAL deployment：使用 `fetch` 完成 HTTP/HTTPS 非流式调用，并解析 SSE `text/event-stream` 响应为 async iterable chunk 供流式调用。Bearer token 从 `credentialRef` 配置注入，不来自模型输入、skill body 或客户端请求体。接受 `AbortSignal` 做取消和超时。该实现只负责 HTTP 边界和 SSE 解析，不负责 swagger 解析、提参或业务结果组装——这些归 `ApiCall` tool。`local-runtime-bindings.ts` 的 `LocalGatewayRuntimeBindings` 扩展 `createLocalApiCallPort`，由 `agent-app` composition 按 `deploymentMode=LOCAL` 选择。

## 持久化原则

- SQLite row/entity 只停留在本 package 私有实现中；gateway public port 只接收或返回 `*Record` persistence DTO。
- simple write 使用 `Record + write options`，例如 `saveRun(record, options)`、`saveSession(record, options)`、`appendEvent(record, options)`；同形 `record + idempotencyKey` 不新增专用 request wrapper。
- query/filter、CAS transition 和多事实 composite operation 可以使用专用 request object，例如 lookup/list query、`ClaimRunRequest`、`TerminalCommitRequest`。
- `idempotencyKey` 属于 command/write option 或 composite request，不进入 `*Record`；gateway-local 可以把它作为锚点事实表列保存。
- session create、accepted run create、message append、timeline append 和 checkpoint save 通过各自锚点事实表保存 scoped `idempotency_key`；terminal commit 锚定 `request_runs.terminalCommitState` 和 version CAS。
- `saveSession` 更新既有 session 时映射当前 `title` / `titleSource`，同时保留该 session 首次创建时的 `idempotency_key`。标题更新调用携带的 write option key 不会替换原始 session-create anchor，也不会形成独立的 durable title replay anchor；上层不得据此声明 title update exactly-once。
- message append 必须由 `SessionMessageStoreGateway.appendSessionMessage(record, options)` 在一个 SQLite transaction 内完成 message anchor、session `updatedAt` 和 active context item 更新。
- terminal commit 必须由 `RequestRunStoreGateway.commitTerminal(request)` 在一个 SQLite transaction 内完成 run terminal state、terminal message、active context item 和 terminal timeline event 更新。
- Working Memory provider owns terminal commit, session create, session cascade delete, session fork/promotion, request recovery, checkpoint and pending input composite transactions. Long-term Memory provider owns retained memory row/index consistency.保留 SQLite provider owns only explicitly listed local stores and must not become the default owner for new stores.
- fork composite write 必须是单一事务，且不得读取宿主文件、解析 execution-bound ref、推断 event visibility 或决定 promotion 语义。它只写 runtime 已验证并重映射的 child records；snapshot sequence 在 child session domain 连续分配。Promotion staging 写入 opaque blob 和 `STAGED` metadata；commit 只能发生在 fork composite write 内部；abort/cleanup 只让 `STAGED`/`ABORTED` residue 保持不可见并收敛，永远不选择 `COMMITTED`。
- long-term memory write/update 必须通过 dedicated memory table 和 retrieval index 完成；`saveLongTermMemory(request, options)` 的 `idempotencyKey` 只来自 write options，不写入 Request/Record。`transitionLongTermMemoryState`、`adjustLongTermMemoryConfidence` 和 `markLongTermMemoryAccessed` 只做 scoped retained-record mutation 与 version/CAS，不执行业务状态机策略。批量新增 `batchCreateLongTermMemory` 对每项复用 `saveLongTermMemory` 的同步校验、scoped anchor、FTS 写入和独立 transaction，使单项失败不回滚其它成功项；写入 `CONFIGURED` 新记忆前按 ACTIVE 与 ARCHIVED 合计检查 50 条容量，归档不释放额度。
- task trajectory save 必须使用 scoped uniqueness anchor；重复 terminal listener、catch-up 或 worker retry 返回既有 trajectory 或安全 upsert，不创建重复 learning input。
- Todo state persistence uses reserved SQLite provider-owned tables, not Working Memory request/session/message tables. `todo_state_revisions` appends one scoped full snapshot per successful TodoWrite invocation keyed by trusted owner scope, agent scope, session id and invocation idempotency anchor. `todo_states_current` stores the current snapshot for `(tenant_id, subject_id, agent_id, session_id)`. Replaying the same invocation returns the anchored revision/current state without duplicate side effects. Gateway-local owns row mapping, uniqueness, CAS/transaction and low-cardinality diagnostics; runtime/core/capability own todo semantics and terminal guard.
- pending input 必须提供 owner+agent+session scoped active lookup、answer resolve CAS 和 Agent-scoped unresolved timeout fact query。后者使用 `(agent_id, timeout_at, pending_input_id)` 可用索引和 `(timeout_at, pending_input_id)` keyset，校验 `limit=1..1000`，返回 future/due `PENDING` 与 terminal commit 尚未完成的 `TIMED_OUT`，并保留每条 fact 的 Owner + Agent + Session + Run coordinates。gateway-local 不接收 `now/dueBefore`、不判断 due、不持久化 cursor、不静默 clamp、不保留旧全局 due scan，也不反推 question/confirmation/authorization/handoff 的业务语义。
- same-session lane scheduling 必须通过 scoped lane snapshot query 读取 session 当前 active/queued/latest request facts；query 返回事实，不在 gateway 内做调度选择。
- request retry 必须通过新的 attempt/run 事实表达 replacement；被替换 attempt 的 messages 保留可审计记录，默认 history query 不显示 hidden/replaced 输出。
- runtime startup recovery discovery 实现 `AgentListRecoverableRunsRequest { agentId, now, limit }`：SQLite 必须在 SQL 层按 `agent_id`、recoverable status、terminal commit state 和 `lock_expires_at IS NULL OR lock_expires_at <= now` 过滤，按 `updated_at ASC, created_at ASC, run_id ASC` 稳定排序并限制到 `1..1000`。查询不按 owner 分区，但返回 Record 保留 owner+agent coordinates；claim/terminal commit 继续保留完整 owner+agent+session+run scope 和 version/CAS 约束。
- `request_runs` 私有 row 使用 nullable `locked_by`、`lock_expires_at` typed columns，并由唯一 row mapper 与 Record JSON 在同一次写入中同步；`idx_request_runs_recovery(agent_id, status, terminal_commit_state, lock_expires_at, updated_at, created_at, run_id)` 服务 bounded discovery。不得使用 `json_extract` 或先读全局 rows 再由 runtime 过滤。当前基线直接创建该 schema，不包含旧库兼容或 schema migration 路径。
- pending capability recovery guard 必须保存可重复判断的 invocation anchor 或 equivalent durable fact，避免进程重启后重复执行 non-idempotent capability。
- long-term memory core persistence 由本模块直接实现 local store/retrieval ports：owner+agent scoped retained record、search/list/detail/count/state transition、FTS5 degraded fallback、`accessCount` / `recallCount` side effect 和 physical delete 都属于 gateway-local 持久化职责；memory lifecycle 允许性判断仍由上层 memory boundary 拥有。
- 当前 gateway-local SQLite local atomic persistence transaction 以一致性为先，不承诺事务中途 abort；远程、长耗时或可取消的 Gateway cancellation 后置。
- `conversation_shares` 专用事实表存储对话分享记录，主键 `(tenant_id, subject_id, agent_id, share_id)`，含 `share_id` 全局唯一索引、`idempotency_key` scoped unique 索引和 `(tenant_id, subject_id, agent_id, session_id)` 索引。`shareId` 由 gateway 生成（`crypto.randomBytes(16).toString("base64url")`），`loadShare` 按 `shareId` 全局查找（不带 scope），`deleteSharesBySession` 按 scope+sessionId 清理。`ConversationShareStoreGateway` 由 `SqliteGatewayStores` 统一管理。

## 替换边界

是。Local platform gateway adapter 可整包替换。

## 验证关注点

- SQLite/Kysely 和 driver-specific record 不得泄漏到 runtime、session、context、channel、core 或 contracts。
- 专用事实表、scoped unique idempotency key、message append/terminal commit composite transaction 和 no generic record store 必须由 gateway-local tests 覆盖。
- lane snapshot、retry replacement visibility、`loadRunByIdempotencyKey`、recovery scan/claim/terminal commit 和 capability recovery guard 必须由 gateway-local/contract tests 覆盖。
- existing-session title save 必须覆盖 `title` / `titleSource` row mapping、原 session-create idempotency anchor 保留，以及 title update key 不成为独立 durable replay anchor 的限制。
- fork prefix/event query、snapshot origin guard、snapshot status、child sequence、fork composite write 原子性、idempotency replay、promotion staging/commit/abort/cleanup、child active context v0、source deletion/recursive fork 和 failure-injection 不可见性必须由 gateway-local tests 覆盖。
- memory store/retriever 和 task trajectory store/query 必须由 contract/local gateway tests 覆盖 owner+agent scope、L1/L2 projection、state filters、physical delete、sourceTrace merge、version/CAS、FTS5 degraded fallback、task trajectory build candidates 和 dedicated table ownership。
- pending-input gateway tests 必须覆盖 future/due `PENDING`、incomplete/completed `TIMED_OUT`、stable keyset、非法 limit/cursor、跨 Agent 排除/多 Owner coordinates、旧 due query 不存在、索引查询计划，以及 session delete 后 timeout facts 不可发现。
- 本地运行态承诺 startup-only Agent-scoped recovery 和同 Agent 短暂多副本的 CAS/lease 竞争，不声明后台持续轮询、leader election、lease heartbeat 或分布式 exactly-once。
- sandbox unavailable/deny-by-default 或受限占位行为不得绕过 sandbox gateway contract。
- sandbox adapter 必须从 `filesystem.defaultCwd` 和 `temp` root 派生 `TMPDIR`、`TMP`、`TEMP`；日志和 safe error 不得包含 raw host path、stdout/stderr 全量内容或 credential。
- sandbox adapter may map `shared-data/...` root-qualified path arguments only when the request filesystem includes a read-only sharedData root. Python direct execution may translate the first explicit script path such as `shared-data/scripts/diagnose.py`; shared-data must not become PATH/PYTHONPATH/import search authority or arbitrary binary execution authority.

## Public Exports

`@nextagent/agent-platform-gateway-local`

## clipc Executable Locator and Fail-Closed

The restricted local sandbox resolves the governed `clipc` binary through a trusted executable locator supplied by app composition. The locator is specific to `clipc` and does not create an arbitrary executable registry. The adapter normalizes one matching pair of outer double quotes around the trusted directory, resolves the binary using the platform-specific filename, verifies the resolved target exists as a regular file, and executes it with `shell: false`. Missing locator, absent directory, non-existent binary, or non-regular file MUST fail closed with an explicit unavailable safe result.

`clipc` 的用户身份 header 注入是 trusted identity 投影：`X-Subject-Id` 来自 `identityContext.subjectId`，`X-Display-Name` 来自 `identityContext.displayName`；不注入 `tenantId` 或 `Agent-Tenant-ID`。同名模型输入 header 必须被可信值覆盖，模型输出与请求参数不得伪造用户身份。

When `sandbox.enabled` is omitted or `true`, the restricted local sandbox uses an executable denylist as its sole command-level validation: a request whose executable is in the configured `deniedExecutables` is rejected safely; all other resolvable executables proceed. The gateway no longer validates path arguments, confines paths to filesystem roots, checks request environment variables, or validates file types — those concerns are delegated to platform isolation. Unresolvable executables fail closed with an explicit unavailable safe result. When the frozen value is `false`, the adapter keeps Python on the direct interpreter path but switches local Bash execution into trusted shell mode: it reconstructs a shell command line from trusted `command + args` tokens, preserves shell control tokens such as `&&`, `||`, `|`, `&`, `(` and `)`, executes that line through the trusted platform shell interpreter with `shell: false`, and still uses adapter-owned cwd, sanitized process environment, timeout, cancellation, and output byte limits.

## user_question_activity Table

`user_question_activity` 表存储 owner-scoped + agent-scoped 的问题级用户行为数据。PRIMARY KEY 为 (`tenant_id`, `subject_id`, `agent_id`, `question_hash`)，其中 `question_hash` 为 `SHA-256(trimmed_question_text)`。表包含 `is_pinned`、`pinned_at`、`ask_frequency`、`last_asked_at`、`locale`、`created_at`、`updated_at` 列。两个索引：`idx_user_question_activity_pinned`（pinned 查询）和 `idx_user_question_activity_frequency`（高频查询）。`UserQuestionActivityStoreGateway` port 提供 `upsertActivity`（frequency 增长，不修改 is_pinned）、`pinQuestion`（含上限淘汰，单事务）、`listPinned` 和 `listHighFrequency` 方法。所有方法接收 owner scope 参数。
