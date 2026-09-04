# agent-session

## 职责

承载 owner+agent scoped `UserSessionPort`、session/message 领域对象和 read model、conversation history consistency、retry replacement visibility、fork notice conversation projection、current request/run message lookup、跨会话 Activity 状态派生与订阅，以及领域对象/read model 与 gateway `*Record` 的映射。

## 非职责

不定义会话保留期、过期、自动清理、调度器、request lifecycle、pending-input timeout、terminal commit、存储 schema、Web transport、前端消费时机或 app composition。不返回 gateway `*Record`、SQLite row、public Web alias 或 `Record<string, unknown>` 给 runtime/channel。

## 依赖

允许依赖 `@nextagent/agent-common` 和 `@nextagent/agent-contracts/session`、`agent-contracts/gateway` public subpaths。不依赖 runtime implementation、Web channel、agent-app、observability implementation 或 platform gateway adapter。

## 核心设计落点

- Suggested question 的模型生成通过共享推荐服务消费 Context Engine 的统一 selected configuration；服务在实际后台调用边界生成 fresh `operationId`，保留 completed-run causal correlation 但不复用 completed run coordinates 或生成 run-bound model timeline。
- Suggested question 输出清洗在 `parseQuestions()` 解析前由 `cleanModelOutput()` 依次移除完整思考块、未闭合开启标签及其后内容、最后一个大小写不敏感的孤立闭合标签及其之前全部内容（防止缺失开启标签的裸露推理进入推荐结果），再执行 Markdown 围栏和叙述性文本清洗；孤立闭合标签之后无有效问题时返回空列表。
- `CapabilityDescriptionProvider` 从当前 active Agent 的 agent-owned resource 文件 `agents/{agentId}/resource/capabilityDescription.md` 热加载产品能力范围原文；LOCAL 模式 load-once 缓存不检测变化，REMOTE 模式 `statSync` 指纹（`path:size:mtimeMs`）变化时重新加载，文件缺失或加载失败返回 `undefined` 不抛异常。Provider 为可选依赖，未注入时推荐行为与文件不存在时一致；内容只用于推荐 prompt 填槽，不进入 Web API、SSE、WebSocket、timeline、SafeError、audit、metric 或 trace。`CapabilityDescriptionSourceLocator` 与 `ChatUploadConfigSourceLocator` 同构，由 composition 层适配 `AgentPackageRootLocator`。
- `DefaultCategoryQuestionCatalog` 的内存 Catalog 按 `agentId + locale` 隔离，不持久化。Catalog 缓存支持运行时动态更新：当 JSONL 文件通过 fingerprint（`statSync` 的 `size + mtimeMs`）检测到变更时，清除对应 `agentId + locale` 的缓存并重新加载；当 JSONL 文件不存在时不缓存空结果，下次请求再次尝试加载。不要求重启应用才能使文件变更生效。fingerprint 检测复用与 `CapabilityDescriptionProvider` 和 `createHotReloadingActiveAssemblyRegistry` 相同的 `statSync` 模式。

- 落实 `architecture/core-contracts.md` 的 `UserSessionPort`、session/message read model 和 gateway Record 映射边界。
- 落实 `architecture/request-run.md` 的 visible conversation history 只能在 terminal durable-write boundary 成功后更新；retry replacement 后默认只显示 latest replacement attempt 的可见输出。
- 落实 owner+agent scoped session/message access；public Web alias 只由 `agent-channel-web` 投影。
- `UserSessionPort.listSessions` 接收 canonical `questionSearchText?`、`createdAtFrom?`、`createdAtTo?`，只负责 owner+agent scoped read model 协调和 Record 映射，不接收 Web `q/createdFrom/createdTo` alias，也不拥有 SQL/index 实现细节。
- `UserSessionPort.deleteSession` 负责 owner+agent scoped session lifecycle 删除语义：检查非 terminal run 冲突、协调会话从属事实删除，并通过 gateway composite delete 保证事务内一致性；不把删除扩展为隐式 cancel 或 soft-delete retained state。
- `SessionActivityService` 实现 `SessionActivityPort`，只从已提交的 session、durable latest run、该 run 的 active pending input 和 terminal facts 派生每个 session 的唯一状态。优先级固定为 `WAITING_FOR_INPUT > RUNNING > UNREAD_FAILURE > UNREAD_RESULT > NONE`；旧 run 的 pending/terminal 通知只能触发重读，不能覆盖较新 accepted run。
- Activity 内部状态按 Owner + Agent + Session scope 保存在进程内，terminal consume suppression 也只在同一进程内有效。首次订阅先完成 scope bootstrap 并发送只含非 `NONE` entry 的稀疏 snapshot，再交付 session-keyed delta；bootstrap-to-live 交接不得丢变化，subscriber 对同一 session 的待发送变化按最新值合并，容量上限由该 scope 的实际 session 数决定。
- `consumeTerminalActivity(...)` 仅在 `activityId` 与 `observedRunId` 同时匹配当前 `UNREAD_RESULT` 或 `UNREAD_FAILURE` 时清除；跨 scope、旧 activity、旧 run、运行态和等待输入态都 fail closed 且不得清除较新状态。session 删除成功后，service 清理该 session 的内部 Activity 状态并向 live subscriber 发布 `NONE`；该清理不替代 durable cascade delete 或 session list refresh。
- `UserSessionPort.listMessages` 支持 latest、older `beforeCursor`、newer `afterCursor` 和 `anchorMessageId` 连续窗口；anchor 必须校验同 scope、同 session 且 visible，失败时 fail closed，不拼接不连续的 latest 与 anchored segment。
- `UserSessionPort.listMessages` 在 default/latest child conversation bootstrap 中可投影 `ForkNotice`：notice 只包含 source session id 和 source title snapshot，仅当 child fork boundary 之后尚无用户消息时返回；cursor/newer/anchor 读取不返回 notice。
- `UserSessionPort.listConversationPreview` 承载当前会话 preview marker read model：只从 visible USER messages 形成 marker，可携带同 request visible ASSISTANT bounded answer preview；不读取 hidden/tool/Capability result 内容，不产生 search/highlight/rank/position 语义。
- 为 runtime recovery 提供 current request/run scoped messages 和 hidden message access；该能力只服务 runtime/context owner，不改变 public history 默认视图。
- 实现 `RuntimeConversationAnnotationPort`：在 owner + session-bound agent scope 下把 Web/runtime annotation command/query 映射到 `ConversationAnnotationStoreGateway`，并在收藏列表查询时补齐 session title 和最近更新时间等 read model 元数据。
- 实现 `RuntimeConversationSharePort`：`createShare` 注入 `ConversationShareStoreGateway` 生成记录并返回完整 shareUrl；`loadSharedConversation` 先 `loadShare` 拿冻结 scope，校验过期/权限/内容存在性，然后用冻结创建者 scope+agentId 通过 `SessionMessageStoreGateway.listMessages` 查 runIds 对应 messages（owner scope 受控例外）。messages 查询采用全量分页拉取再按 runIds 过滤的方式。
- 分享权限校验采用 ops hash 相等语义：`ConversationShareRecord.allowedOps` 类型不变（`readonly string[] | null`），但语义从完整 ops 明文数组变为长度 1 的 `[hash]`（`null` 表示公开分享）。`ConversationShareService` 不再做子集判断（`allowedOps ⊆ viewerOps`），而是比对 `storedOps[0] === viewerOps[0]` 字符串相等：创建者存完整 ops 的 SHA-256 hash，查看者传完整 ops 的同规则 hash，只有 ops 集合完全相同（同角色用户）才通过。hash 变换规则（去重 `new Set` → `.sort()` 字典序 → `JSON.stringify` → `crypto.subtle.digest("SHA-256")` → lowercase hex 64 字符）由前端 `shareService.ts` 集中实现，对 `ShareSettingsModal`/`SharedConversationPage` 透明，后端只做 hash 字符串存储和相等比对，不感知 hash 算法细节。旧记录存储的是完整 ops 明文数组，在 hash 相等校验下自然不匹配并返回 `SHARE_FORBIDDEN`，到期后自然过期，不做数据迁移。`keepPermissions` UI 开关语义不变（开=带权限分享存 `[hash]`，关=公开分享存 `null`）。
- `UserSessionPort.generateTitle`：ordinary submit acceptance 后由 runtime fire-and-forget 调用，消费该次 accepted command input，并使用确定性三级规则管线（短输入直接使用 / 中长输入启发式提取 / 长输入首句截断），纯同步无模型调用；规则提取失败或未覆盖输入形态时 fallback 到当前 command input 的安全版本（trim、移除控制字符、压缩空白、按自动标题最大长度截断），非空 fallback 仍必须通过 XSS/secret redaction policy。生成前按 trusted owner+Agent+session scope loadSession；`titleSource="manual"` 或已有非空 title 时返回 resolved 并跳过，blank、slash-prefixed、不安全、missing 或异常返回未 resolved，使当前 runtime instance 的后续 ordinary submit 可以再试。成功 saveSession 写入 `titleSource="automatic"`；失败静默 warn log，不阻塞 request acceptance 或主执行路径，也不依赖后续请求结果是 completed、failed、canceled 还是 superseded。retry 和 edit-resubmit 不由 session owner自行识别，而由 runtime 调用边界排除。
- `UserSessionPort.updateTitle`：先 trim 调用方标题，再按 trim 后 1–100 字符、XSS/secret pattern、owner+agent scoped loadSession 和 saveSession 的顺序处理。空字符串或仅空白输入使用现有 `SESSION_TITLE_TOO_SHORT` safe error，1–3 字符安全标题允许保存；有效标题按 trim 后的值持久化，不套用 automatic-title 的标点清理或 40 字符截断。任意成功的手工更新都写入 `titleSource="manual"` 并阻止自动覆盖；too-long、trim-empty、unsafe content 和 scoped session not found 使用现有 safe error contract。Web route 在委托前另按 raw body 的 100 字符上限做 schema validation。
- durable final attachment sets are attachmentIds-only and remain authoritative across retry and cleanup; session read models must not reconstruct attachment authority from transient upload state or message metadata copies.

## 映射原则

- public Web aliases such as `displayTitle`、`lastActivityAt`、`q`、`createdFrom`、`createdTo`、`cursor`、`nextCursor` 只在 `agent-channel-web` schema/projection 层出现；session read model 使用 canonical `title?`、`updatedAt`、`questionSearchText?`、`createdAtFrom?`、`createdAtTo?`、`beforeCursor`、`afterCursor`、`nextBeforeCursor`、`newerCursor`。
- `UserSession`、`SessionMessage` 和 `SessionMessagePage` 是领域对象/read model；gateway `SessionRecord`、`SessionHistoryEntry`、`SessionMessageRecord` 和 `SessionMessageRecordPage` 只在 gateway port 入参或返回值中出现。
- `ListSessionMessagesQuery` 使用 session-level `beforeCursor/afterCursor/anchorMessageId/includeCapabilityResults`；`ListCurrentRequestMessagesQuery` 使用 request/run scoped `offset/includeHidden`，两者不合并。
- `ForkNotice` 是 session read model，不是 message、active context item 或 gateway `ForkSourceRecord` 暴露；session 模块只读取 fork source metadata 所需字段并投影窄 DTO。
- retry replacement attempt 的旧输出保留 durable/auditable message facts；默认 `ListSessionMessagesQuery` 不展示 hidden/replaced 输出，只有 owner scoped diagnostic/recovery path 可通过 `includeHidden` 读取。
- supersede 清理后，session-level annotation read model 只返回当前仍可见 run 的标注；session 模块不从 hidden message 或 retry lineage 反推旧 run 标注。
- session create 时初始化 active context state，并通过 gateway-local session anchor idempotency 返回首次 created session。

## 替换边界

否。Session 是会话/read model owner。

## 验证关注点

- session/message/read model 访问必须保留 owner scope 和 agent scope。
- 不得把 runtime lifecycle、调度器或存储 driver 纳入 session。
- history consistency 和 latest-request policy 不得被 channel 直接改写。
- retry replacement visibility、hidden message auditability 和 current request/run recovery lookup 必须有 session/gateway contract 测试覆盖。
- fork notice 显隐、source title snapshot、child first user message 后隐藏以及 cursor/newer/anchor 读取不显示 notice 必须有 session/Web 测试覆盖。
- annotation upsert/list/favorite enrichment、scope 传递和 terminal commit non-regression 必须有 session-level 测试覆盖。
- Activity 必须覆盖固定优先级、latest-run 选择、pending 解决后重新派生、terminal consume 匹配、迟到旧 run、scope 隔离、bootstrap-to-live、subscriber 合并、重启不恢复 terminal unread 和 session 删除 `NONE`。
- package public return 不得包含 gateway `*Record` 或 public Web alias。

## Public Exports

`@nextagent/agent-session`
