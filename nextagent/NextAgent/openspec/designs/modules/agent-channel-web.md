# agent-channel-web

## 职责

承载 Fastify route plugin、最小 Web session create/list/conversation/delete/fork/submit/cancel/retry/edit/title routes、Request Execution Stream 与 Session Activity Projection Stream 的 SSE/WebSocket adapter、Activity consume route、runtime bootstrap projection、presentation-safe errors 和 Web channel transport boundary。

## 非职责

不拥有 request lifecycle、runtime state、session/message state、Session Activity 状态/订阅 truth/消费策略、context policy、capability execution、local auth 或前端静态资源托管。不直接调用 `agent-session`、gateway store 或 implementation package；session/history/submit/cancel/retry/activity 只能通过 runtime-facing ports。不得直接注册前端静态资源 route 或 SPA fallback；不得用前端环境变量、URL、localStorage 或 UI 控件决定产品路径 stream transport。

## 依赖

允许依赖 `@nextagent/agent-common` 和 `@nextagent/agent-contracts/channel`、`agent-contracts/runtime` public subpaths（含 `SkillCatalogQueryPort`）。不得依赖 `agent-channel-web-auth-local`、`agent-session`、gateway/model/capability/session contract subpaths、gateway adapter、lifecycle owner implementation、`@nextagent/agent-app-frontend-hosting` 或 `@nextagent/agent-web`。

## 核心设计落点

- Runtime bootstrap route 在每次请求时消费 app 注入的 `PortalAbilityConfigProviderPort`，并投影 strict public DTO `portalAbilityConfig`：`suggestedQuestionsEnabled`、`cronTasksEnabled`、`longTermMemoryManagementEnabled`、`knowledgeImportEnabled` 和 `fullProcessEnabled` 均为 boolean；`ask-user-question-time-minutes` 及其毫秒派生值不得进入 response。channel 不解析 Agent package raw config，也不拥有入口显示策略。

- 共享 stream projector 对 `CAPABILITY_STARTED` / `CAPABILITY_COMPLETED` 只投影闭集 `capabilityKind`、合法 `capabilityId`、`toolCallId` 与受约束 `targetCapabilityId`；单字段非法时局部省略，不得从 Message、结果、参数、描述或浏览器状态恢复。SSE、WebSocket 与 run-event history 复用同一 projector，保持 started/completed 身份以及 live/history 结果一致。
- `CAPABILITY_STARTED` 在 `Skill`、`Agent` 或普通 Tool 生命周期下的 `ApiCall` 与模型工具调用唯一关联时，由共享安全 projector 输出 optional `capabilityTargetName`。`readReferencedToolCall` 收紧为同一 Message 内恰好一个匹配 `toolCallId`+`toolName` 且 `arguments` 为对象才返回；零个或多个匹配走 `contentUnavailable`。投影 helper 只允许 `Skill`→`name`、`Agent`→`agentId`、`ApiCall`→`apiName` 三个白名单映射，trim 后匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`，否则省略字段；不读取其他 `arguments`、结果正文或 metadata。`capabilityTargetName` 只加到通过关联门禁的 `CAPABILITY_STARTED`，`CAPABILITY_COMPLETED` 和结果事件不重复字段；与 `STATUS_ONLY`/`SUMMARY`/`DETAIL` 结果级别独立，不提高安全上限。

- 落实 `architecture/runtime-boundaries.md` 的 Web submit/session/history/cancel/retry 只进入 runtime-facing ports。
- 落实 `architecture/core-contracts.md` 的两类 stream 边界：Request Execution Stream 的 SSE 和 WebSocket 只投影 runtime event stream 为 `StreamEnvelope`；Session Activity Projection Stream 只投影 `RuntimeSessionActivityPort` 的严格 `SNAPSHOT | DELTA`。两者只复用 transport framing/auth/cleanup，不共享 payload、cursor、subscriber、replay buffer 或 lifecycle truth。
- Activity 只注册 ER route：`GET /api/v1/session-activities/stream`、`WS /api/v1/session-activities/ws` 和 `POST /api/v1/sessions/:sessionId/activity/consume`；IR whitelist 不暴露这些 route。SSE/WS 订阅只携带 trusted identity，consume body 只接受 `activityId` 与 `observedRunId`；所有 route 都委托 `RuntimeSessionActivityPort`，channel 不依赖 `agent-session`。协议、bootstrap、serialization 或 port failure 必须 safe failure/close，不能伪造空 snapshot、清除 activity 或改变 request lifecycle。
- 落实 `architecture/conversation-process-history.md` 的 run event-history boundary：`GET /api/v1/sessions/:sessionId/runs/:runId/events` 委托 `RuntimeSessionPort.listEvents`，再在同一 HTTP request 内一次批量调用 server-only `resolveProcessMessages`，把 event/message pair 交给 live/history 共用的 `ProcessMessageAssociation` projector。单引用失败输出可排序的 `contentUnavailable=true` status-only envelope；route 不直连 gateway、不暴露隐藏消息、不接受客户端 `messageIds`，也不把 event 并入 conversation response。
- Capability Result 的 live SSE、WebSocket 和 run-event history 共用 `agent-channel-common` projector 与 app 注入的冻结 `CapabilityResultPresentationPolicy`。channel 不读取完整系统配置、不拥有平台安全上限，也不把 Message 结果正文、`resultProjectionKind` 或上游任意 JSON 直接投影给浏览器。
- channel 持有 shared transient projection cache（SSE 与 WebSocket 共享、订阅级、至多 1,000 条已解析消息，订阅关闭即释放）与订阅级安全 snapshot 收敛：同一订阅已交付且 occurrence 坐标一致的非空安全累计正文在完成事件中原地收敛为完成态；无可复用内容且 Message 关联失败时才输出 `contentUnavailable=true`。该缓存只是 transient 投影缓存，不是 canonical stream/history truth、persistence owner 或 request lifecycle 状态。
- 落实 `architecture/fullstack-packaging-boundary.md` 的静态托管非职责：前端静态资源和 SPA fallback 由 `agent-app` 在 `with-frontend` profile 下注册。
- 落实 owner scope 和 Agent Scope 隔离：identity 来自 channel/auth boundary，agent scope 由 runtime trusted resolver 得到。
- 所有出站响应无条件下发 `Strict-Transport-Security: max-age=31536000; includeSubDomains`；同时下发 `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`，允许 Agent Web 必需的运行时样式和 `data:` 图片，继续阻止 inline script。
- `DELETE /api/v1/sessions/:id` 只做 path/schema 校验、trusted identity 注入和 safe status projection，删除业务语义通过 runtime-facing session port 下沉，不直连 session implementation 或 gateway-local。
- submit request schema 只允许 allow-listed non-target `routingConstraints` fields；agent-web public body 不接受 `routingConstraints.targetSkill` 或 `routingConstraints.targetRecipe`。Web 用户要指定 Skill/Workflow 目标时必须把 `$skill:<name>` 或 `$workflow:<name>` 写入用户文本，由 Agent 内部 routing 在 acceptance 后解析。channel 只构造 typed non-target value，不把任何 constraint 当作 capability authorization。
- `PUT /api/v1/sessions/:sessionId/title` 只接受 raw length 不超过 100 的 allow-listed title body，从 trusted channel/auth boundary 注入 identity，并委托 `RuntimeSessionPort.updateTitle`；trim、1–100 字符非空校验、unsafe-content 拒绝和 `titleSource=manual` 语义由 runtime session facade/session owner 下沉，route 不直连 gateway。
- `POST /api/v1/sessions/:sessionId/requests/latest/edit` 当前只接受 JSON：`expectedLatestRequestId`、`editedInputText`、`idempotencyKey`、可选 `locale` 和只允许空数组的 `attachments`。route 先 `requireSession`，将 `attachmentIds=[]` 委托给 runtime；非空 JSON attachments、multipart edit、owner/Agent 字段和其他未知字段均在 runtime delegation 前拒绝。可选 `locale` 目前不构成 runtime edit locale 生效保证。
- submit request schema 可接受 request-scoped、provider-neutral 的 `modelOptions.thinking.depth="OFF"`，并在调用 runtime command boundary 前归一化为 runtime-owned `requestModelOptions`。channel 不接受 `temperature`、`topP`、`maxOutputTokens`、provider-private reasoning object、provider override、model profile override 或其他未知 model option 字段。
- submit 路径的输入护栏拦截分支在调用 `runtime.submit` 之前执行：当 guardrail 输入校验返回 `BLOCKED` 时，`submitStagedRequest` 先生成 `requestId`（`crypto.randomUUID` 等价），调用 `RuntimeCommandPort.recordInputGuardBlock?.({ identityContext, agentId: session.agentId, sessionId, inputText, refusalMessage, requestId, idempotencyKey })` 持久化一对 `visible=true` 的用户输入与拒答消息（共享 `requestId`、无 `runId`、`metadata.modelVisibility.excluded=true`），再 `throw new AgentError({ code: "GUARD_INPUT_BLOCKED", message: refusalMessage })` 返回 HTTP 400 作为前端即时反馈。channel 不调用 `runtime.submit`、不创建 run、不产生 terminal timeline event；持久化权威事实由 runtime/gateway 拥有，conversation 读路径按普通 `visible=true` history 返回该轮。`recordInputGuardBlock` 是可选方法：runtime 未实现时 channel 回退为仅 400 即时反馈（刷新丢失，渐进降级）并记录 safe diagnostic，不阻塞主路径。拒答语由 guardrail 服务返回，channel 透传不改写、不生成。
- 后端 bootstrap 必须从可信 channel/app config 投影 `transportKind`；产品路径前端不得自行切换 transport。
- SSE/WebSocket stream route 必须保留 `lastSeenSequence` 的省略状态；只有显式合法数字才作为 runtime replay anchor 下沉，显式非法值 safe failure，省略时不得合成 `0`。
- Skill 列表查询端点暴露 `GET /api/v1/skills`，通过 `SkillCatalogQueryPort` 委托给 app composition 层消费 `CapabilityCatalog` 和 `AssemblyRegistry`，不直接依赖 `agent-capability`。
- `GET /api/v1/sessions` 的搜索和时间过滤是 Web 边界输入：route 只接受并校验 public `q`、`createdFrom`、`createdTo`、`offset`、`limit`，把合法值映射为 runtime canonical `questionSearchText`、`createdAtFrom`、`createdAtTo`，空白搜索不下沉为搜索条件。
- `GET /api/v1/sessions/:sessionId/conversation` 支持 latest、older `cursor`、newer `newerCursor` 和 `anchorMessageId` 四种读取形态；channel 负责拒绝 cursor/newer/anchor 组合，保留 `includeCapabilityResults` 语义，并只把 internal `nextBeforeCursor/newerCursor` 投影为 public `nextCursor/newerCursor`。
- `GET /api/v1/sessions/:sessionId/conversation/preview` 是当前会话 preview marker route：必须显式 `limit`，可带 `offset`，拒绝搜索、日期、cursor、position 或 `includeCapabilityResults` 参数，只投影 `sessionId/totalMarkers/offset/limit/markers[]` safe DTO。
- `POST /api/v1/sessions/:sessionId/messages/:messageId/fork` 和 `POST /api/v1/sessions/:sessionId/requests/:requestId/fork` 只做 path/body schema validation、trusted identity 注入、normalized idempotency key 传递和 safe response projection；message/request fork 语义、anchor resolution、child materialization 和 idempotency replay 都由 runtime session facade 拥有。
- 推荐问题端点暴露 `POST /api/v1/sessions/:sessionId/requests/:requestId/suggested-questions`，通过 app-composed `SuggestedQuestionPort` 在 owner scope 和 session-bound agent scope 下执行；channel 只做身份解析、session/request 路由参数校验、safe DTO projection，不拥有推荐生成语义。
- cancel/retry Web API 只负责认证、schema validation、safe error 和 DTO projection；终态提交、attempt、replacement visibility、idempotency 和 lane 调度由 runtime/session/gateway owner 决定。
- 对话标注 Web API 只负责身份解析、schema validation、safe DTO projection 和 503 降级。`POST /api/v1/sessions/:sessionId/runs/:runId/annotations`、`GET /api/v1/favorites` 和 `GET /api/v1/sessions/:sessionId/annotations` 通过 app-composed `annotations?: RuntimeConversationAnnotationPort` 执行，route 不得直接依赖 gateway store 或 session implementation。`GET /api/v1/favorites` 投影 turn 粒度收藏结果，包含 `sessionId`、`requestRunId`、`rootMessageId`、`questionPreview`、`questionTruncated`、`sessionTitle`、`sessionUpdatedAt` 和 `favoritedAt`，不再投影会话聚合 favorite count。
- 对话分享 Web API 只负责身份解析、schema validation、safe DTO projection 和 503 降级。`POST /api/v1/sessions/:sessionId/shares` 和 `GET /api/v1/shares/:shareId/conversation` 通过 app-composed `shares?: RuntimeConversationSharePort` 执行，route 不得直接依赖 gateway store。查看路由从 `X-Viewer-Ops` header 解析 viewerOps，SafeError code 映射 HTTP 状态（404/410/403）。未注入时返回 503 `SHARES_UNAVAILABLE`。
- 长期记忆管理 routes 只负责 schema validation、trusted identity 与 Agent Scope 注入、AbortSignal 传递和 safe DTO projection，并委托 `LongTermMemoryManagementPort`。`/api/v1/memory/long-term-mem` 下 13 个 REST 端点对应 13 个 management operation（含批量新增）；仅当 `registerWebChannel` 收到 `longTermMemoryManagement` 依赖时注册，MUST NOT 直接调用长期记忆 Gateway port。身份字段从 Web Channel composition 提供的 identity resolver 获得完整 `IdentityContext`，`agentId` 来自 hosted-Agent selection/app composition；query/body 身份字段返回 4xx；`subjectId` 投影为 REST alias `userId`，`displayName` 不进入 Gateway 或 REST DTO。`SafeError` 映射为 `LtmError { code, message, retryable }`：`LTM_MEMORY_NOT_FOUND`→404、`LTM_STORAGE_UNAVAILABLE`→500、`UNAVAILABLE`→503、其它→400；成功包装为 `{ errorCode:0, errorMsg:"SUCCESS", data }`。`queryText` ≤128 Unicode code point 超限返回 400 `LTM_QUERY_INVALID`；`/manual` 标签 >10、置信度非法或字段超长返回 400。`POST /api/v1/memory/long-term-mem/batch` 接受 1 至 100 个条目，先整体校验 `items` 数量和字段 allowlist 再委托 `batchCreateLongTermMemory`，未知字段或越界在处理前整体拒绝，返回 `successCount`/`failCount`/`memoryIds`。JSON 文件 bytes、导入 preview、客户端容量算术和 CSV 内容不进入 channel；`GET /api/v1/memory/long-term-mem` 与 `POST /api/v1/memory/long-term-mem/batch` 继续分别承载筛选分页读取和服务端最终准入，channel 不拥有文件语义、容量规则或 persistence。
- 未认证请求只投影 auth challenge；credential validation、cookie 签发和 local auth policy 由 auth adapter/composition 提供。
- IR（机机交互）surface 是 web-channel 的第二种 surface，面向外部系统（编排系统、网管平台、上游业务系统）的程序化调用，路径前缀 `/api/v1/ir`，协议、DTO、schema 和 stream 行为与 ER 对应端点完全一致。IR 复用 ER 的 `registerWebChannel(instance, dependencies)`，通过 `routePrefix: string`（默认 `/api/v1`）参数化路由前缀、`routeWhitelist?: ReadonlySet<string>` 限制只注册白名单内路由。composition 层双注册：ER（cookie auth + `/api/v1` + 全量路由）和 IR（`createTaskIdentityResolver` 作为 `identityResolver` + `/api/v1/ir` + 6 端点白名单）。IR 6 端点为 `POST /api/v1/ir/sessions`、`POST /api/v1/ir/sessions/:sessionId/requests`、`GET /api/v1/ir/sessions/:sessionId/stream`、`POST /api/v1/ir/sessions/:sessionId/cancel`、`POST /api/v1/ir/sessions/:sessionId/retry`、`POST /api/v1/ir/sessions/:sessionId/pending-inputs/:pendingInputId/answer`。认证隔离：IR 路由只读 `x-tenant-id`/`x-subject-id`/`x-display-name` header（trusted-header 模式，上游网关注入、NextAgent 只读不校验），不挂 cookie auth plugin；ER 路由只认 cookie。Agent Scope 不从 header 取，仍来自 `requireSession` 返回的持久化 `session.agentId`。IR 不注册 WS 端点、不加载 multipart 插件、不暴露 bootstrap/skills/conversation/annotations/shares/activity 等 UI 专属端点。IR 不新增 port/DTO/Record/契约语义，所有状态由 runtime 经现有 `RuntimeCommandPort`/`RuntimeSessionPort` 拥有。`registerWebChannel` 内部的 `instance.register(fastifyMultipart)` 和 `registerWebSocketStream(...)` 等非路由副作用调用也受白名单门控：白名单不含对应路径时跳过。完整端点表与认证隔离见 `architecture/web-channel-api-surface.md`。

## Projection 规则

- Capability 成功、降级、失败和超时继续使用同一个 `CAPABILITY_RESULT` transport/projection。channel 只投影经过 runtime/core 安全化的最终结果、opaque refs 和稳定技术信息；不解释 retryable、不启动重试、不从错误文本推断 authorization pending，也不暴露 raw output、异常、路径或 credential。

- public Web DTO aliases such as `displayTitle`、`lastActivityAt`、`q`、`createdFrom`、`createdTo`、`cursor`、`nextCursor` 和空 `attachments?: []` 只在本 package schema/projection 层出现。
- request body 中 owner/agent 字段必须 schema validation failed；owner scope 只能来自 channel/auth boundary，agent scope 只能由 runtime trusted resolver 得到。
- fork request body 只接受 trim 后非空且不超过 128 字符的 `idempotencyKey`；owner/agent 字段、child ids、fork source metadata、copied messages、active context refs、timeline、checkpoint 或 raw prompt content 必须 schema failed，route 不得调用 runtime。
- request body 中 `routingConstraints.targetSkill`、`routingConstraints.targetRecipe`、routing override、provider override、raw prompt、raw policy、raw tool authority、credential、path 或 provider-private constraint 字段必须 schema validation failed 或被剔除；channel 不得补做业务治理。
- request body 中 `modelOptions` 只允许表达当前请求关闭 thinking 的 provider-neutral 偏好；非 `OFF` thinking depth、provider-native reasoning 参数或其他 model override 字段必须 schema validation failed，且不得进入 accepted request execution path。
- annotation request body 中 `tenantId`、`subjectId`、`agentId` 或其他 client-supplied scope 字段必须被 schema 拒绝或忽略；收藏分页 `limit` 上限为 100。
- Skill 列表查询只通过 `SkillCatalogQueryPort` 获取 `SkillCatalogQueryResult` 并投影为 HTTP 响应 DTO；不得将 port 内部类型、`CapabilityDescriptor` 或 catalog governance evidence 直接暴露给客户端。
- SSE 和 WebSocket 只从 runtime event stream 读取 canonical runtime events 并投影为 public `StreamEnvelope`；同一 request/run 的事件语义、顺序、replay anchor 和 terminal projection 必须等价。
- Activity SSE 和 WebSocket 只从 `RuntimeSessionActivityPort` 读取 strict snapshot/delta；同一 scope 的 snapshot、delta、失败关闭和无 cursor 重连语义必须等价。Activity 不得使用 `StreamEnvelope`、`StreamEventType`、timeline sequence、`lastSeenSequence`、request/run filter 或 execution stream subscriber。
- SSE/WS 引用解析复用 subscription-local、最多 1000 项的 message cache，关闭订阅即释放；消息正文、visibility、metadata、raw Tool input/output 和 legacy event body 不得进入浏览器响应。共享投影必须保留安全 `final` 标识。
- run event-history response 只包含 shared projector 允许的 `StreamEnvelope`；单个引用无效按 status-only 降级，event page/共享 schema 整体损坏才整页失败。timeline-only event 被一致过滤，canonical scan 尚有后页时必须保留 cursor。
- request/run filter 只作为 runtime stream query filter 透传，不改变 session-scoped sequence；channel 不拥有 replay/live-tail truth、transport-private replay buffer 或 terminal history truth。
- `suggested-questions` 响应只暴露 `{ questions: string[] }`；channel 不得把 prompt 原文、模型原始输出、provider metadata 或推荐内容写入日志、metric、trace 或 audit。
- conversation `forkNotice` 只投影 `{ sourceSessionId, sourceSessionTitle }`，且只出现在 default/latest conversation bootstrap；channel 不允许 query/body 强制显示、隐藏或伪造 notice，也不得把内部 fork source record 投影给客户端。
- conversation API 保留 `includeCapabilityResults` 的兼容 query，但非 AskUserQuestion `CAPABILITY_RESULT` item 的 public `content` 必须为空，metadata 只保留严格 allowlist；普通 Agent Web 默认不请求这些 item 作为过程详情输入。只读 share 必须排除普通 Capability Result Message，同时保留完整用户问题和最终 Assistant Message。上述投影不修改 durable Message。
- Capability 结果呈现策略只允许 `STATUS_ONLY`、`SUMMARY`、`DETAIL`。共享 projector 先应用身份优先的安全 schema 和平台上限，再应用精确 `capabilityId` 策略；unknown/custom、关联失败或无安全 projector 的扩展 Tool 不高于 `STATUS_ONLY`。Skill、ToolSearch 或直接调用等来源不参与策略选择。
- Grep 使用共享 `agent-channel-common` 中的专用 projector，不复用 Glob `fileList` 计数。projector 校验 canonical `output_mode`、模式专属集合、非负总数和安全路径后，文件模式按匹配文件总数生成摘要，内容模式按匹配总数与涉及文件总数生成摘要；`DETAIL` 最多保留 50 个文件路径或“路径与 1-based 行号”条目并主动删除匹配正文。缺失模式、未知模式、矛盾 shape、非法计数或不安全详情条目一律降为 `STATUS_ONLY`，SSE、WebSocket 与 run history 复用同一结果。
- Capability 失败使用 projector 产生的闭合、语言中立 descriptor。完整 `safeErrorCode + safeErrorCategory` 事实优先于 code-only `DEGRADATION_NOTICE`；channel 不从错误码推断自动恢复、用户行动、request terminal 或重试入口，也不把 Event type / internal status 作为正文回退。
- canonical `AskUserQuestion` answer 的 stream `CAPABILITY_RESULT_DELTA` 与 conversation capability-result item 必须调用 `agent-channel-common` 的同一个 `projectAskUserQuestionAnswerResult(...)`。conversation 只在 canonical message content 能验证 `AskUserQuestion`、非空 tool/pending coordinates、`QUESTION/RECEIVED` 和 ordered answer shape 时附加可选 `pendingInputAnswer`；stream payload 合并完全相同的安全投影。该 projector 最多保留 20 个 answer group、每组 9 项、每项 4096 个 Unicode code point和总计 24576 个 code point，并显式返回 `truncated`；未知字段、畸形 shape 或非 question result 必须省略 answer projection。`USER_INPUT_RECEIVED` 继续 answer-free，channel 不把回答复制进 summary/text/metadata，也不让 frontend 从 canonical raw message content重建安全投影。

## 替换边界

是。Channel adapter 可按 package replacement 方式替换。

## 验证关注点

- 不得拥有 request lifecycle、session/message state、context policy、capability execution、cancel/retry lifecycle 或 stream transport selection truth。
- Fastify request/reply object 不得泄漏到 lower-level packages。
- `agent-channel-web` 必须可在不导入 `agent-channel-web-auth-local` 的情况下使用。
- channel 产品代码不得依赖 `agent-session` 或 gateway adapter implementation。
- channel 产品代码不得依赖 `@nextagent/agent-app-frontend-hosting`、`@nextagent/agent-web` 或 `frontend/agent-web` 源码路径。
- API、SSE、WebSocket 和 control routes 不得被前端静态资源 fallback 接管。
- submit/cancel/retry/bootstrap/skills/annotation response 必须通过 public schema/contract 测试覆盖。
- title/edit route 必须覆盖 schema allowlist、trusted identity 注入、runtime-facing port delegation、empty attachment projection，以及 non-empty attachments 和 multipart edit 不调用 runtime 的 negative cases。
- submit model option allowlist 必须通过 schema/route negative tests 覆盖：合法 `modelOptions.thinking.depth="OFF"` 被转为 `requestModelOptions`，未知字段、非 `OFF` depth 和 provider-private reasoning object 被拒绝。
- fork route schema、runtime delegation、request-anchor route、fork notice projection 和 authority-field negative cases 必须通过 Web contract tests 覆盖。
- Skill 列表查询不直接依赖 `CapabilityCatalog` 或 `AssemblyRegistry`。
- SSE/WebSocket projection 必须覆盖 ordering、replay、terminal projection 和 cleanup 等价。
- Activity route 必须覆盖 SSE/WS snapshot/delta 等价、trusted scope、strict DTO、consume matching delegation、协议失败关闭、连接独立性、IR route absent，以及对 `StreamEnvelope` / `RuntimeSessionPort.streamEvents(...)` / `agent-session` 依赖的 negative architecture case。
- AskUserQuestion 的 stream/conversation safe projection 必须做 deep-equality、容量/Unicode 边界、malformed fail-closed 和 `USER_INPUT_RECEIVED` answer injection negative tests。
- Capability Result 必须覆盖三档策略、身份/shape 碰撞、受控 CLIP classifier、Skill 激活来源、unknown/custom、失败 code/category 联合语义、conversation/share raw-content negative tests，以及 SSE/WS/history 深度等价。
- run event-history route 必须覆盖 owner/Agent/session/run scope、query limit/cursor validation、legacy availability、shared projection 和 no-partial-page failure。
- 产品路径前端不得通过 build-time env 或 UI 控件覆盖后端 bootstrap 的 `transportKind`。

## Public Exports

`@nextagent/agent-channel-web`

## Category Question Query Route

`GET /api/v1/category-questions?locale=zh-CN` 通过 `CategoryQuestionPort` 查询分类问题目录，返回 `CategoryQuestionResult` DTO。与 `GET /api/v1/skills` 同形同策：通过 identity resolver 解析 owner scope，使用 `activeAgentId` 作为 agent scope，不直接依赖 `agent-capability` 内部实现。Port 查询失败时返回 503 safe error。响应 DTO 不包含 hash 字段。

## Frequent Question and Pin Routes

`GET /api/v1/frequent-questions?locale=zh-CN` 通过 `FrequentQuestionPort.listFrequentQuestions()` 查询合并排序后的高频问题列表，返回 `{ locale, questions: [{ text }] }` DTO。`POST /api/v1/user-questions/pin` 通过 `FrequentQuestionPort.pinQuestion()` 收藏问题到常问列表。两个路由均通过 identity resolver 解析 owner scope，使用 `activeAgentId` 作为 agent scope。pin 路由需要 `AuthGate(Write)` 权限校验，请求体 `question` 超过 `PIN_QUESTION_MAX_LENGTH`（2000）字符时 trim 后截断存储，返回 HTTP 204。无 unpin API。响应 DTO 不包含 `hash`、`frequency`、`is_pinned`、`pinned_at` 等内部字段。

## Question Association Route

`GET /api/v1/question-association?keyword=xxx&locale=zh-CN` 通过 `FrequentQuestionPort.listQuestionAssociations()` 查询输入联想结果，返回 `{ locale, questions: [{ text, source }] }` DTO，`source` 为 `"pinned" | "high-frequency" | "static"`，纯视觉展示用。路由通过 identity resolver 解析 owner scope，使用 `activeAgentId` 作为 agent scope。`keyword` 为必填查询参数（trim 后非空，空则返回 400），`locale` 为可选。不修改任何持久化状态。`frequentQuestions` port 通过 `registerTrustedIdentityWebChannel` 透传注入。

## Capability 失败处置协作

本包只从 canonical final result 生成安全 DTO、SSE/WS/history 投影，不读取中间 attempts，也不根据 `retryable`、error code 或 message 推断自动重试、授权控制或 request terminal。失败字段、外置引用和三档呈现必须在 live/history 间等价；完整 producer/consumer 边界见 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md`。
