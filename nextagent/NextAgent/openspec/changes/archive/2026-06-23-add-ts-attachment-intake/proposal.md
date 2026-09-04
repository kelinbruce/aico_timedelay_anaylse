## 背景与问题

电信网络智能体的用户请求可能携带故障日志、配置片段、巡检结果和排障说明等附件。附件来自不可信的 Web 输入，如果直接进入 message、context、model 或 capability，会带来 owner scope 绕过、路径泄露、超预算输入、损坏文件吞错和原始内容外泄风险。

本 change 的第一性原理是：附件 intake 的唯一目标是在请求接受前把不可信文件输入转换成受控、可追溯、可拒绝的 `AttachmentId` 和权威 `RequestAttachment` 事实。附件内容不是用户消息正文的一部分；只有 attachment runtime 接受并产生附件事实后，后续 request lifecycle 才能通过 `attachmentIds` 消费该附件。

现在处理的必要性在于：核心契约已经为请求命令 `attachmentIds`、`RequestAttachment`、附件接收事件和附件拒绝事件预留边界。若缺少明确 intake 规格，入口、执行、上下文和后续附件解析流程容易各自处理文件内容，破坏受控附件事实和安全审计边界。

## 变更范围

- 新增 attachment intake 行为：由用户在提交请求或编辑最新请求时上传/选择附件触发；带附件的 Web 请求入口使用 `multipart/form-data` 接收文本字段和文件 part，不把附件 bytes/base64 放入 JSON submit body；触发阶段位于请求入口接收附件输入之后、请求进入执行接受之前；请求入口先向 runtime 预留本次请求的 `requestId`、`runId` 和 `requestContextId`，再执行文件校验和暂存，随后用同一组预留坐标完成同步 admission gate，后续 cleanup 可异步但不属于本 change。
- 新增输入和前置条件：需要可信 `IdentityContext`、`sessionId`、请求动作、multipart 表单字段、原始文件名、声明 MIME、服务器实际读取的字节流和字节数、配置限制、idempotency key、request budget、安全上下文、attachment runtime、`BlobStoreGateway`、`AttachmentStoreGateway`、safe error normalizer、audit writer、structured log/metric sink；依赖核心契约已存在 `AttachmentId`、`RequestAttachment` 和请求命令 `attachmentIds` 字段。
- 新增输出和副作用：成功附件产生 `AttachmentId`、`RequestAttachment(validationStatus=ACCEPTED, availabilityStatus=AVAILABLE)`、opaque `BlobRef`、安全摘要、`attachment.accepted` audit、日志和 metric；拒绝附件产生 safe error 或请求拒绝结果、`attachment.rejected` audit、日志和 metric。`ATTACHMENT_ACCEPTED`/`ATTACHMENT_REJECTED` timeline/stream projection 仅在已有可见 request context 时才投影，不代表 request 已 accepted。
- 明确核心判断逻辑：按数量、服务器计数大小、空文件、Markdown 类型判定、启用范围、UTF-8 可读性、Blob 写入、metadata/status 写入和 `AttachmentId` 输出顺序判断；首版本地 release 只接受 Markdown，PDF、Excel、Word 和其他类型必须明确拒绝。
- 明确状态和产物契约：`AttachmentId` 是 request command 和 `SessionMessage` 保存的唯一附件引用；`RequestAttachment` 是附件 metadata/status 权威事实；`BlobRef` 是只可由 `BlobStoreGateway` 解析的 opaque 内容引用；safe summary 只描述文件安全属性，不替代原始内容；audit/log/metric 不能包含 raw attachment content、`BlobRef`、secret、credential 或未脱敏路径。
- 明确流程接入：上游是请求入口附件输入、可信身份边界和 session owner scope；当前节点是 attachment intake gate；下游是携带 `attachmentIds` 的请求命令、`RequestAttachment` metadata/status、audit/observability，以及后续 `add-ts-attachment-request-context-flow` 和 `add-ts-attachment-cleanup`。
- 明确失败与降级：超数量、超大小、空文件、未启用类型、类型不匹配、读取失败、Blob 写入失败、metadata/status 写入失败、预算不足、超时和依赖不可用都必须返回明确 safe error 或 rejected outcome，不得静默丢弃、静默截断或吞错；首版不探测密码保护、外部解析需求或 Office/PDF 容器展开。

BREAKING：无。当前 TS 后端尚未形成稳定 attachment intake 基线。

## Capability 影响

### 新增 Capability
- `ts-attachment-intake`: 定义 TS 后端请求附件 intake 的触发、输入前置、验证顺序、受控附件事实、输出副作用、失败降级、安全审计和首版本地 release 支持范围。

### 修改的 Capability
- 无。

## 影响范围

- 核心实现策略：请求入口对带附件 submit/edit 使用 multipart intake path，先向 runtime reserve submit 坐标，再把附件输入交给 attachment intake gate；intake gate 使用 runtime 预留的请求坐标完成限制校验、Markdown 类型/UTF-8 可读性检查、Blob 写入、`RequestAttachment` metadata/status 写入和 `AttachmentId` 输出；请求命令只携带 accepted `attachmentIds`，runtime submit 复用预留坐标完成 acceptance；runtime acceptance 和 context consumption 的细化由后续附件 flow change 承载。
- API/事件：固化附件 intake safe error、`RequestAttachment` validation/availability status、`attachment.accepted`/`attachment.rejected` audit 和 attachment audit safe summary；`ATTACHMENT_ACCEPTED`/`ATTACHMENT_REJECTED` projection 仅在已有可见 request context 时才投影；不新增 attachment download API，不改变 context assembly 读取策略。
- 配置：需要 attachment intake limits，包括每请求最大附件数 3、单文件最大 5 MiB、首版 enabled media type 仅 Markdown、UTF-8 文本读取、整体 intake/读取/Blob 写入/metadata 写入超时；配置不得允许 base64 JSON 附件、raw secret、未脱敏路径、暴露 `BlobRef` 或绕过 attachment runtime。
- 验证：需要覆盖 Markdown 成功、数量/大小/类型/空文件/损坏/不可读失败、安全输出、`attachmentIds`、提交/编辑请求的 intake gate、Blob/metadata 写入失败、timeout、budget exhausted 和 dependency unavailable。
- 运维：新增 attachment accepted/rejected count、reject reason、size bucket、staging latency、read failure、timeout 和 budget exhausted 的日志/metric/audit 安全摘要，不要求首版强制每次 intake 都产生用户可见 timeline 事件。

## 归档前基线提升计划

行为契约：
- `openspec/specs/ts-attachment-intake/spec.md`：新增 attachment intake 行为基线。

长期背景：
- `openspec/overview.md`：补充首版本地 release 对请求附件受控接入的产品目标和安全边界。

设计视图：
- `openspec/designs/architecture/attachment-intake.md`：提升请求入口、attachment runtime、runtime acceptance、context flow、audit/observability 和 cleanup 接入边界。
- `openspec/designs/domain/attachment.md`：提升 attachment input、`RequestAttachment`、`BlobRef`、safe summary、validation/availability status 和 rejection outcome 的领域语义。
- `openspec/designs/contracts/attachment-intake.md`：提升 attachment intake boundary、safe error、`AttachmentId` 和 `RequestAttachment` 消费语义。
- 请求入口相关长期职责文档：补充请求入口对附件输入的职责和非职责。
- Attachment runtime 相关长期职责文档：补充 attachment runtime 的验证、Blob 写入、metadata/status 写入、`AttachmentId` 输出和安全输出职责。
- Runtime request acceptance 相关长期职责文档：补充请求接受前只消费 `attachmentIds` 并查询权威 `RequestAttachment` 的职责边界。
- `openspec/designs/adr/0004-controlled-attachment-intake.md`：记录附件必须通过 attachment runtime 转换为受控 `AttachmentId` 和权威 `RequestAttachment` 后才能进入请求生命周期的长期决策。
- `openspec/designs/spec-to-design-map.md`：新增 `ts-attachment-intake` 到 architecture、domain、contracts、modules 和 ADR 的导航。

验证入口：
- 契约验证：附件数量、大小、类型、validation/availability status、safe error、`attachmentIds` 和安全输出。
- 流程验证：submit/edit request 在 request acceptance 前执行 intake gate，成功后请求命令只接收 `attachmentIds`。
- 恢复/降级验证：读取失败、损坏文件、暂存失败、超时、预算不足、dependency unavailable 均显式失败或拒绝。
- 安全验证：raw attachment content、secret、credential、本地路径和未授权对象内容不得进入 SafeError、stream、audit、日志或 metric。
