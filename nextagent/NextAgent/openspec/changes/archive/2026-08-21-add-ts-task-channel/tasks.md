## 1. Package 和基线

- [x] 1.1 保留 `agent-channel-task`、`agent-channel-common`、Fastify registration、identity resolver、attachment intake 和 SSE projection 的现有实现
  验证：现有 package/architecture tests；本 refinement 不迁移 owner 或重建 package
- [x] 1.2 保留 runtime request lifecycle、canonical timeline、PendingInput persistence、terminal commit 和 sequence replay ownership
  验证：现有 runtime contract/characterization tests

## 2. Public DTO 和 Schema 刷新

- [x] 2.1 定义 closed-schema `TaskMessage` 和 `taskMessages`，实现 text/data/fileContent one-of、raw/url one-of、metadata 和当前 `maxItems=1`
  验证：contract tests 覆盖三种合法消息、空数组、多消息、多个 one-of 字段、非法 base64、非法 URL/filename/mediaType
- [x] 2.2 将 create/edit/answer 和 callback/result 数据字段统一为 `taskMessages`，删除 public `inputText`、`editedInputText`、`inputVariables` 数据入口
  验证：旧字段返回 400；合法 DTO 投影到现有 runtime command
- [x] 2.3 删除 public `routingConstraints`，保留 Agent/core 基于输入文本和可信配置选择 skill/recipe
  验证：routingConstraints 返回 400；无 channel 构造的 targetSkill/targetRecipe
- [x] 2.4 实现 JSON inline `fileContent.raw` 到现有 attachment intake 的映射
  验证：base64、filename、media type、attachment intake 接线和 intake 失败时无 submit side effect
- [ ] 2.5 在 attachment owner 增加 remote URL intake 后接入 `fileContent.url`
  验证：URL 正常路径和大小、协议、media type、SSRF、redirect/DNS policy、失败时无 submit side effect；Task Channel 不自行下载
- [x] 2.6 create 接口保留可选 `idempotencyKey`；async-create/edit/cancel/retry/pending-input-answer 和 multipart 中移除 `idempotencyKey`
  验证：create 包含 `idempotencyKey` 时正常接受；其他端点包含 `idempotencyKey` 返回 400；缺失时 channel 内部生成 UUID；重复 POST 创建新 task
- [x] 2.7 从所有 public 响应和事件移除 `runId`、`contextId`、`attempt`：TaskControlResponse、TaskEvent、SSE envelope、callback event 均不暴露内部诊断字段
  验证：contract tests 断言响应和事件不含 runId/contextId/attempt；payload 中也不泄漏 requestContextId
- [x] 2.8 批量端点 URL 使用复数 `tasks`；单任务创建和流式订阅保留单数 `task`
  验证：`/api/v1/task` 和 `/api/v1/task/:taskId/stream` 正常工作；批量端点使用 `/api/v1/tasks/*`

## 3. Task 和 Session 坐标

- [x] 3.1 将外部 taskId 从 sessionId 改为 requestId，并统一 response/event 字段为 sessionId、taskId，不暴露 runId/contextId
  验证：contract tests 断言不再出现 requestId/targetRequestId/runId/contextId，且 taskId 等于 runtime requestId
- [x] 3.2 ~~create 增加可选 body sessionId~~ → superseded by 12.7：create 不接受 sessionId，channel 自动创建新 session
  验证：新 session、create body 含 sessionId 返回 400
- [x] 12.7 create 不接受外部传入 sessionId；channel 总是自动创建新 session，task 与 session 1:1
  验证：create body 含 sessionId 返回 400；create 总是创建新 session；edit/retry/cancel/query/answer 的 sessionId 逻辑不变
- [x] 3.3 edit/retry/cancel body 使用 sessionId，body taskId 作为 requestId/expectedLatestRequestId 交给现有 runtime contract 校验
  验证：task/session 匹配成功；mismatch、非 latest request 和跨 scope 返回 safe not-found/conflict；不新增 request lookup contract
- [x] 3.4 在不扩大未确认 runtime contract 的前提下完成 answer 的 task/session/pendingInput 三方一致性校验方案
  验证：task mismatch、session mismatch、跨 owner、已超时或已回答均返回 safe not-found/conflict

## 4. 创建接口与流式 SSE

- [x] 4.1 重写 `POST /api/v1/task` 为 JSON 创建：单任务请求体（无 `tasks[]` 包装），返回 JSON 控制响应 `{ sessionId, taskId, taskStatus: "TASK_ACCEPTED" }`；可选 `idempotencyKey`；移除 `mode`、`callbackTarget`
  验证：响应为 JSON `{ sessionId, taskId, taskStatus }`；旧字段返回 400；multipart 请求也返回 JSON
- [x] 4.2 实现 `GET /api/v1/task/:taskId/stream` SSE 订阅端点：必带 `sessionId` query 参数，可选 `lastSeenSequence` 支持 replay；选择 SSE 即推送全部事件
  验证：GET stream 返回 SSE；首事件为 TASK_ACCEPTED；`lastSeenSequence` 支持 replay；终态事件后关闭流
- [x] 4.3 更新 `POST /api/v1/tasks/async`：移除 `idempotencyKey`；保留顶层 `isStreamRecord` 参数（默认 `false`）；`isStreamRecord=false` callback 仅推 4 类事件；`isStreamRecord=true` callback 额外推过程事件
  验证：缺失 callbackTarget 返回 400；callback port 未配置返回 503；isStreamRecord=true callback 推送过程事件；isStreamRecord=false 不推送
- [x] 4.4 将 async-create/edit/cancel/retry/pending-input-answer 保持批量 `tasks[]`（maxItems=20）；流式创建为单任务不包装
  验证：单项目数组等价单任务；超过 20 项返回 400；部分失败返回 200 + per-item error；流式创建不接受 tasks 数组
- [x] 4.5 保留 `GET /api/v1/task/:taskId/stream` SSE 订阅端点；删除 `websocket.ts` 全文和 WS upgrade handler
  验证：GET /api/v1/task/:taskId/stream 返回 SSE；WS /api/v1/task/:taskId/ws 返回 404；无 websocket 残留代码

## 5. Runtime Request Summary Query

- [x] 5.1 扩展 `RuntimeRequestSummary` 增加 `terminalResult` 字段：包含 content、contentType 和可选 safe error 字段（code、category、retryable）
  验证：contract tests 覆盖类型定义、public export、terminalResult 存在/不存在场景
- [x] 5.2 在 agent-runtime 实现 `getRequestSummary`：组合 `loadSessionLaneSnapshot` + `loadActivePendingInput`，从 snapshot 中按 requestId 查找 run
  验证：runtime tests 覆盖活跃 task、终态 task、有/无 active pending、task 不存在
- [x] 5.3 在 agent-runtime 实现 terminalResult 提取：对终态 request 从 timeline 最后一个终态事件 payload 提取 content/contentType/safe error 字段
  验证：COMPLETED 返回 content；FAILED 返回 content + safe error；无终态事件时 terminalResult 为 undefined
- [x] 5.4 不新增 gateway 方法或表，复用已有 `loadSessionLaneSnapshot` 和 `loadActivePendingInput`
  验证：无 gateway 契约变更

## 6. POST `/api/v1/tasks/query` 对账接口

- [x] 6.1 实现 `POST /api/v1/task/streams/query` 批量查询：body `{ tasks: [{ sessionId, taskId }] }`，maxItems=20，每项调 `getRequestSummary`
  验证：contract tests 覆盖批量查询、跨 session、空数组返回 400、超过 20 项返回 400
- [x] 6.2 返回 `{ results: [...] }`，每项含 task 坐标和 `taskStatus`；终态时返回 terminalResult 投影为 taskMessages；pendingInput 状态优先投影
  验证：RunStatus 全量映射；终态返回 taskMessages（COMPLETED 为 text，FAILED 为 data）；active pending 投影为 TASK_PENDING
- [x] 6.3 对 active PendingInput 返回 TASK_PENDING 和 pendingInputId/taskMessages/overtime/metadata 一致快照
  验证：有/无 timeoutAt；问题数据可供调用方重建 UserCheck
- [x] 6.4 owner scope + agent scope isolation：找不到的 task 返回 per-item NOT_FOUND
  验证：跨 owner/agent task 返回 safe not-found；不泄漏存在性

## 7. TaskStatus、TaskEventType 与统一事件结构

- [x] 7.1 增加 TASK_PENDING channel projection，active PendingInput 优先于 EXECUTING RunStatus
  验证：pending/received/timeout/canceled transitions 的状态投影测试
- [x] 7.2 async-create/edit/retry/cancel/answer 统一返回 TaskControlResponse（sessionId、taskId、taskStatus），不含 runId/contextId
  验证：五类成功响应 schema；cancel 返回 TASK_CANCELED；响应不含 runId/contextId/attempt
- [x] 7.3 补齐 TaskEventType 对所有 23 个 StreamEventType 的穷尽映射
  验证：包含 BACKGROUND_TASK_STARTED/COMPLETED/FAILED、OUTPUT_GUARD_BLOCKED；新增未映射值时编译成 contract test 失败
- [x] 7.4 实现统一 `TaskEvent` 结构：SSE 和 callback 共用同一事件格式，与 channel-web StreamEnvelope 字段对齐（eventId、eventType、sessionId、taskId、sequence、createdAt、payload），移除 runId/requestContextId/transportHints/timelineEventRef
  验证：SSE event 和 callback event 结构相同；payload 字段与 channel-web 一致；不含内部诊断字段
- [x] 7.5 实现 GET stream 的事件投影：runtime StreamEnvelope -> TaskEvent（requestId->taskId，eventType 映射，移除内部字段）；选择 SSE 即推送全部事件
  验证：GET stream 推送全部事件；首事件为 TASK_ACCEPTED

## 8. Pending Input 和恢复

- [x] 8.1 pending-input answer body 增加 sessionId 和单条 `data: { answers: string[][] }` TaskMessage；移除 idempotencyKey
  验证：成功恢复、answer shape/cardinality、session scope、已超时/已回答冲突
- [x] 8.2 完成 pending-input answer 的 task/session/pendingInput 三方一致性校验
  验证：task mismatch、session mismatch 和跨 owner 均返回 safe not-found/conflict；与 3.4 共用唯一方案
- [x] 8.3 恢复路径改为 POST query 对账（不再依赖 SSE/WS replay）：调用方通过 query 获取 task 状态、终态结果和 pendingInput
  验证：重启后 query 返回正确状态；终态返回 terminalResult；pending 返回 pendingInput payload

## 9. HTTP/IR Async Callback

- [x] 9.1 在 `agent-channel-task` 实现收窄 HTTP callback transport，只允许固定 POST JSON schema 和可信 URL policy，不提供通用 HTTP executor
  验证：非法 protocol/credential/fragment、空 allowlist 和不匹配 origin 在网络调用前失败；调用方不能篡改 method/headers/credentials/body
- [x] 9.2 将 callback schema 改为 `events: TaskEvent[]`（统一事件结构），`isStreamRecord` 参数控制事件范围：isStreamRecord=false 仅 4 类事件，isStreamRecord=true 含过程事件
  验证：isStreamRecord=false 只推送 TASK_COMPLETED/FAILED/CANCELED/USER_INPUT_REQUIRED；isStreamRecord=true 推送过程事件；事件结构为 TaskEvent
- [x] 9.3 支持一次 callback 推送多条有序数据，重试保持 eventId 和 sequence 不变
  验证：batch ordering、duplicate delivery、consumer idempotency fixture、bounded request size
- [x] 9.4 USER_INPUT_REQUIRED callback payload 包含 pendingInputId/kind/questions/overtime
  验证：有/无 timeoutAt；问题数据可供调用方重建 UserCheck
- [x] 9.5 callback 失败保持 runtime truth 不变并通过 POST query 恢复
  验证：timeout/重试耗尽、NextAgent 重启、调用方停机；无 lifecycle/terminal side effect

- [x] 9.6 网络 callbackDeliveryPort 仅在 allowedOrigins 非空时创建；remote UDS 使用 app composition 固定的本地 origin；`tlsInsecure=true` 时仅对已通过 allowlist 的 callback HTTPS 跳过证书校验
  验证：空 allowedOrigins 时 async create 返回 503 且不发起网络请求；UDS 相对 URL 正常交付；allowlisted HTTPS 在 tlsInsecure=true 时走 https.request，HTTP 仍用 fetch，其他 HTTPS 连接不受影响

## 10. Traceparent Header

- [x] 10.1 确认 Task Channel 端点透明透传 W3C `traceparent` header，不解析、不校验、不处理
  验证：携带 traceparent 的请求正常处理；不携带的请求正常处理；channel 源码无 traceparent 处理代码
- [ ] 10.2 traceparent 数据传递到 runtime/capability/CLIP 出站，单开 change 处理
  验证：OpenSpec 仍注明明确 deferred；当前 change 不实现数据传递项

## 11. 安全、架构和完整验证

- [x] 11.1 更新 architecture constraints：Task Channel 不依赖 CLIP、agent-capability private path、gateway implementation、agent-channel-web 或通用 HTTP client abstraction
  验证：`npm run lint:architecture` 和对应 negative architecture tests
- [x] 11.2 覆盖 safe error、redaction 和不可信 metadata/URL 边界
  验证：response/log/metric/trace/audit 不含 raw file、callback body、credential、prompt/model output 或 unsafe URL detail
- [x] 11.3 运行 change 范围验证
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
- [x] 11.4 运行 OpenSpec strict validation 和 `$nextagent-code-review`
  验证：`openspec validate --all --strict` 于 2026-07-30 通过 267/267；push 前 `$nextagent-code-review` 发现的 callback fail-open 与跨 change WebSocket 规格冲突已修复，最终结论 PASS

## 归档前长期设计同步（非实施 task）

- 更新 `openspec/specs/agent-task-channel/spec.md`、`openspec/specs/ts-core-contracts/spec.md`、backend architecture 和 minimal kernel baseline
- 更新 Task Channel API、async callback、module design 和 spec-to-design-map
- 将收窄 callback transport 纳入 Task Channel 长期设计，并明确不得演化为通用 HTTP executor
- 事件批量上报汇聚策略（按时间窗/数量）单独 change 处理

## 12. 729 接口重构：URL 体系拆分与流式 SSE
> 以下 section 12-14 是 729 接口重构迭代，supersede 已完成 task 中的对应旧设计：task 4.1（JSON 创建→SSE）、4.2/4.5（GET stream→404）、4.3/9.2（isStreamRecord→reportEvents）、2.2（answer taskMessages→顶层 answers）、6.1（query 格式简化）。已完成 task 保持勾选状态，记录第一迭代的实施事实。
- [x] 12.1 将 POST `/api/v1/task` 迁移为 `POST /api/v1/stream-task`，响应体从 JSON 改为 SSE 事件流（`text/event-stream`）；首个事件为 TASK_ACCEPTED，终态事件后关闭流
  验证：contract tests 断言 Content-Type 为 text/event-stream；首事件为 TASK_ACCEPTED；终态后流关闭
- [x] 12.2 将 POST `/api/v1/tasks/async` 迁移为 `POST /api/v1/async-tasks`，保持批量 JSON+callback 模式不变
  验证：contract tests 断言新 URL 正常工作；旧 URL 返回 404
- [x] 12.3 删除 `GET /api/v1/task/:taskId/stream` 路由注册，使其返回 404；保留 `lastSeenSequence` 设计供后续启用
  验证：GET /api/v1/task/:taskId/stream 返回 404；无 stream handler 残留代码
- [x] 12.4 拆分 Edit 为 `POST /api/v1/stream-task/:taskId/edit`（SSE 响应）和 `POST /api/v1/async-tasks/edit`（JSON 响应）
  验证：流式 edit 返回 SSE；异步 edit 返回 JSON；旧 URL 返回 404
- [x] 12.5 拆分 Retry 为 `POST /api/v1/stream-task/:taskId/retry`（SSE 响应）和 `POST /api/v1/async-tasks/retry`（JSON 响应）
  验证：流式 retry 返回 SSE；异步 retry 返回 JSON；旧 URL 返回 404
- [x] 12.6 Cancel、Query、Answer 路径保持不变：`/api/v1/tasks/cancel`、`/api/v1/tasks/query`、`/api/v1/tasks/pending-inputs/answer`
  验证：三个端点路径不变，行为不变

## 13. 729 接口重构：reportEvents、idempotencyKey、Answer、Query、Attempt

- [x] 13.1 将 `isStreamRecord` 参数替换为 `reportEvents`（接受事件类型列表或 `"ALL"`/`"TERMINAL"`）；create/edit/retry 流式和异步端点都支持；参数为预留，事件过滤引擎暂不实现，当前行为等同 `ALL`
  验证：schema 接受 reportEvents 参数；旧 isStreamRecord 返回 400；默认行为不变
- [x] 13.2 idempotencyKey 差异化：Create 可选，Edit 必填，Answer 可选；缺失时 channel 内部生成 UUID。Query 为只读接口不需要 idempotencyKey
  验证：create 缺失时内部生成 UUID；edit 缺失时返回 400；query 不接受 idempotencyKey 字段
  验证：顶层 answers 正常接受；旧 taskMessages 包裹格式返回 400
- [x] 13.4 简化 Query 响应格式：统一用 `data: JsonObject` 扁平字段，按 taskStatus 区分内容；移除 `taskMessages` 数组和 `pendingInput` 嵌套对象
  验证：终态返回 data.content/contentType；pending 返回 data.pendingInputId/kind/questions/overtime；非终态无 data
- [x] 13.5 Retry 响应增加 `attempt` 字段（从 runtime `RequestAccepted.attempt` 暴露）
  验证：retry 响应包含 attempt 且递增；edit 响应 attempt 为 1

## 14. 729 接口重构：事件过滤、Multipart Edit、questions 结构、spec 修正

- [x] 14.1 channel 层过滤 4 个事件类型（`BACKGROUND_TASK_STARTED`、`BACKGROUND_TASK_COMPLETED`、`BACKGROUND_TASK_FAILED`、`OUTPUT_GUARD_BLOCKED`），不在 SSE 和 callback 中推送；TaskEventType 枚举保留 23 个穷尽映射不变
  验证：contract tests 断言这 4 个事件类型不出现在 SSE 和 callback 中；枚举仍包含这 4 个值
- [x] 14.2 Edit 流式和异步端点支持 multipart form-data，与 create 的 multipart 解析逻辑复用
  验证：流式 edit multipart 返回 SSE；异步 edit multipart 返回 JSON；multipart 字段限制与 create 一致
- [x] 14.3 正式暴露 PendingInput questions 结构化 schema：公开 prompt、options[]（label/value/requiresTextInput/inputPlaceholder）、multiple、custom 和 4 种 kind
  验证：query 和 SSE 事件中 questions 包含结构化字段；与 runtime 合约和 channel-common 投影一致
- [x] 14.4 修正 spec 描述：edit 产生新 taskId（runtime editLatest 创建新 requestId，旧 request 被 supersede），retry 保持同一 taskId（attempt 递增）；原 "Edit and retry preserve task identity" 描述错误
  验证：contract tests 断言 edit 返回新 taskId；retry 返回同一 taskId；spec scenario 已修正
- [x] 14.5 运行 change 范围验证
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`

## 15. 生产测试发现的缺陷修复

- [x] 15.1 修复 stream-task SSE 的 STREAM_REPLAY_ANCHOR_REQUIRED 报错：`streamTaskSseResponse` 调用 `deliverWebStream` 时传了 `requestId` 过滤器但未传 `lastSeenSequence`，runtime 规则有 filter 无 anchor 即拒绝。补 `lastSeenSequence: brand(0)`，与 `deliverTaskCallbacks` 的同形写法一致
  验证：routes.test.ts 的 stream-task create SSE 首事件测试通过；`lastSeenSequence: 0` + requestId 走 filtered replay 路径，anchor 0 在 runtime 直接放行
- [x] 15.2 修复 ATTACHMENT_STAGING_FAILED：`preloadAttachmentCompositionAsync` 只 cleanup 未显式创建 `uploadTempDir`/`downloadTempDir` 目录，`stageBlob` 的 `writeFile` 不递归建目录导致写入失败。在 cleanup 前加 `mkdir(dir, { recursive: true })`
  验证：typecheck 通过；attachment composition 启动后目录存在，`stageBlob` 写入成功
- [x] 15.3 修复 REMOTE 模式 ASYNC_CALLBACK_UNAVAILABLE：`default-system.yaml` 缺少 `taskCallback` 节点时 `allowedOrigins` 为空且 `socketPath` 为 undefined，`callbackDeliveryPort` 未创建。REMOTE 模式下 `taskCallback.socketPath` 未配置时自动回退到 `channel.udsPath`，`allowedOrigins` 自动填充 `http://localhost`，`callbackDeliveryPort` 自动创建。不需要改配置文件
  验证：typecheck 通过；routes.test.ts async-tasks 测试通过；`effectiveSocketPath` 回退逻辑仅在 REMOTE 模式生效，LOCAL 模式不受影响
- [x] 15.4 确认异构回调接口 DFX 参数已正确实现：超时 30s（`defaultCallbackTimeoutMs`）、最大重试 3（`defaultMaxRetries`）、退避 `min(1000*2^(n-1), 8000)`（`exponentialBackoffMs`）；3 次重试全失败后停止交付、取消 stream 订阅、记录诊断日志；callback 失败不影响 runtime truth；客户端可通过 `POST /api/v1/tasks/query` 重连恢复
  验证：task-callback.test.ts 34/34 通过，含重试稳定性、delivery_abandoned 诊断、callback failure 不改变 runtime truth 测试
- [x] 15.5 修复 stream-task edit/retry 的 STREAM_FILTER_NOT_FOUND：`submitEditTask` 和 `submitRetryTask` 丢弃了 `RequestAccepted.runId`，导致 `streamTaskSseResponse` 调 `deliverWebStream` 时只有 requestId 无 runId，runtime 走 `assertStreamFilterVisible` 路径 B（查 timeline events），NAIE 异步写入延迟导致事件未落盘即报错。修复：channel 层返回并传递 runId，runtime 走路径 A（`requestRunStore.loadRun`），不依赖 timeline 事件落盘
  验证：typecheck 通过；routes.test.ts 149/149 通过；edit/retry 返回 runId 传给 deliverWebStream，runtime 走 loadRun 路径校验

## 16. 附件 metadata 到 workflow 变量注入

- [x] 16.1 在 `agent-core` 的 `DefaultAgent` 构造 `WorkflowExecutionRequest` 时，将 `resolveAttachmentRefs` 已解析的第一个 `AttachmentRef`（`attachmentId`/`fileName`/`mediaType`/`sizeBytes`/`storageRef`）注入到 `inputVariables.fileContent` 保留键。调用方 `inputVariables` 已包含 `fileContent` 键时不覆盖（caller precedence）。附件内容不随变量注入；内容访问仍由 context engine attachment disclosure + Read tool 处理
  验证：workflow engine `initializeVariables` 自动将 `fileContent` spread 到 `variables.fileContent`；workflow node 可通过 `${variables.fileContent.fileName}` 等引用；caller `inputVariables` 含 `fileContent` 时系统不覆盖；无附件时 `inputVariables` 不含 `fileContent` 键

## 17. Channel 创建 Session 后 Submit 失败的泄漏修复

- [x] 17.1 在 `agent-channel-task` 的 `submitCreateTask`（stream-task create）中，当 `runtime.submit` 抛出异常时，best-effort 调用 `runtime.deleteSession` 清理本次新建的 session，然后 re-throw 原始错误；deleteSession 自身失败时只记 warn 日志，不掩盖原始错误
  验证：routes.test.ts 新增测试——submit mock 抛 `CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY`，断言 deleteSession 被调用且 session 不在 list 中，接口返回原始错误码

- [x] 17.2 在 `agent-channel-task` 的 `processAsyncCreateTaskItem`（async-tasks create）中，当 `runtime.submit` 抛出异常时，best-effort 调用 `runtime.deleteSession` 清理本次新建的 session，然后返回 `batchItemError`；同 batch 其他 item 不受影响
  验证：routes.test.ts 新增测试——batch 中一个 item submit 失败，断言该 item session 被删除，另一 item 正常返回

- [x] 17.3 在 `agent-channel-web` 的 `POST /api/v1/requests` convenience submit 中，当 `body.sessionId === undefined`（channel 新建 session）且 `submitStagedRequest` 失败时，best-effort 调用 `runtime.deleteSession` 清理本次新建的 session
  验证：requests.test.ts 新增测试——convenience submit 失败时 session 被删除，已有 sessionId 的 submit 失败时不删除

- [x] 17.4 提取公共 cleanup helper（如果三处逻辑一致），避免 copy-paste；helper 接收 `sessions` port、`identityContext`、`sessionId`，内部 catch 且不 re-throw
  验证：三处复用同一 helper，无重复实现

- [x] 17.5 运行 change 范围验证
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate add-ts-task-channel --strict`