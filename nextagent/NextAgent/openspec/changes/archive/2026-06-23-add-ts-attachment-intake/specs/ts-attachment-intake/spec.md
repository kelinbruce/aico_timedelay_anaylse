## ADDED Requirements

### Requirement: 附件 intake 触发与前置条件
TS 后端 MUST 支持请求附件 intake。Attachment intake MUST 由用户提交请求、编辑最新请求或请求表单中的附件上传/选择触发；触发阶段 MUST 位于请求入口接收附件输入之后、request acceptance 之前；附件验证和安全暂存 MUST 作为同步 admission gate 执行，cleanup 后续处理 MAY 异步但 MUST 不影响 intake 结果可见性。

带附件的 Web 请求入口 MUST 使用 `multipart/form-data` 接收 `inputText`、`idempotencyKey`、`locale?` 和文件 part。无附件请求 MAY 继续使用现有 JSON submit/edit body。系统 MUST NOT 在 JSON submit/edit body 中接收 base64 附件 bytes，也 MUST NOT 在本 change 中引入独立预上传 token flow。

#### Scenario: 无附件请求继续使用 JSON body
- **WHEN** 用户提交或编辑请求且未携带附件
- **THEN** 系统 MAY 继续使用现有 JSON submit/edit body
- **AND** 系统 MUST NOT 强制要求 multipart/form-data

#### Scenario: 提交请求携带 Markdown 附件
- **WHEN** 用户提交请求并携带 Markdown 附件
- **THEN** 系统 MUST 使用可信 `IdentityContext`、`sessionId`、request action、multipart 表单字段、服务器实际读取 bytes、服务器实际计数 sizeBytes、配置限制、request budget、attachment runtime、SafeError normalizer、audit/log/metric sink 执行 intake
- **AND** 请求入口 MUST 只将 attachment runtime 接受后产生的 `AttachmentId` 放入 request command 的 `attachmentIds` 字段
- **AND** 系统 MUST NOT 让 raw file bytes、raw upload handle 或客户端自报 owner 字段进入 request command、message、context、model 或 capability

#### Scenario: 带附件请求不使用 JSON base64
- **WHEN** 用户通过 JSON submit/edit body 发送 base64 附件 bytes、raw upload handle 或自报 owner、size、status、storage、validation/availability metadata
- **THEN** 系统 MUST 返回 validation safe error
- **AND** 系统 MUST NOT 从 JSON body 解析或暂存附件内容

#### Scenario: 编辑最新请求携带附件
- **WHEN** 用户编辑最新请求并携带附件
- **THEN** 系统 MUST 在 `EditLatestRequestCommand` 进入 runtime 前执行同一 attachment intake
- **AND** intake MUST 不绕过 latest-request owner scope 和 idempotency 语义
- **AND** `EditLatestRequestCommand.attachmentIds` MUST 只表示本次 edit 新接受的附件
- **AND** 本 change MUST NOT 定义继承、替换、删除或重新绑定历史请求附件的语义

#### Scenario: 无附件请求
- **WHEN** 用户提交或编辑请求且未携带附件
- **THEN** 系统 MUST 将附件集合视为空集合
- **AND** 系统 MUST NOT 调用文件读取、暂存或附件解析流程

### Requirement: 附件数量、大小与启用类型限制
TS 后端 MUST 对附件数量、大小和启用类型执行确定性限制。每个请求最多 3 个附件，单文件最大 5 MiB，文件大小 MUST 大于 0。文件大小 MUST 使用服务器实际读取的 byte length，不得信任客户端声明值。首版本地 release MUST 只启用 Markdown；PDF、Excel、Word 和其他非 Markdown 类型 MUST 返回明确 safe error 或 rejected outcome。

#### Scenario: Markdown 在限制内被接受
- **WHEN** 请求携带 1 到 3 个 Markdown 附件且每个文件大小大于 0 且小于等于 5 MiB
- **THEN** 系统 MUST 对每个附件继续执行类型识别、可读性检查和安全暂存
- **AND** 成功附件 MUST 产生可写入 request command 的 `AttachmentId`

#### Scenario: 附件数量超限
- **WHEN** 请求携带超过 3 个附件
- **THEN** 系统 MUST 返回 `ATTACHMENT_COUNT_EXCEEDED`
- **AND** 系统 MUST 拒绝本次 request intake
- **AND** 系统 MUST NOT 静默丢弃多余附件后继续提交请求

#### Scenario: 附件大小非法
- **WHEN** 单个附件大小为 0 或超过 5 MiB
- **THEN** 系统 MUST 返回 `ATTACHMENT_EMPTY` 或 `ATTACHMENT_TOO_LARGE`
- **AND** 系统 MUST NOT 截断文件、压缩文件或只处理部分内容

#### Scenario: 任一附件校验失败时请求级 fail-closed
- **WHEN** 请求携带多个附件且任一附件违反数量、大小、类型或可读性限制
- **THEN** 系统 MUST 拒绝整个 request intake
- **AND** 系统 MUST NOT 暂存通过校验的其他附件后继续提交请求
- **AND** 系统 MUST NOT 将部分成功的 `attachmentIds` 放入 request command

#### Scenario: 未启用类型被拒绝
- **WHEN** 请求携带 PDF、Excel、Word 或其他非 Markdown 类型附件
- **THEN** 系统 MUST 返回 `ATTACHMENT_TYPE_UNSUPPORTED`
- **AND** safe output MUST 提示当前首版仅启用 Markdown
- **AND** 系统 MUST NOT 尝试解析、转换、预览或把该文件内容送入上下文

### Requirement: 附件类型与可读性校验
TS 后端 MUST 把声明 MIME 视为不可信提示。首版 Markdown 判定 MUST 使用扩展名 `.md` / `.markdown`、声明 MIME 为 `text/markdown` 或 `text/plain`、且内容不匹配已知二进制 magic bytes 的最小一致性规则，并对 Markdown 执行 UTF-8 可读性检查。首版 MUST NOT 为了区分密码保护、外部解析器、宏执行、脚本执行、远程访问或容器展开而探测 PDF、Excel、Word 或其他非 Markdown 内容；这些非 Markdown 附件 MUST 默认返回 `ATTACHMENT_TYPE_UNSUPPORTED`。

#### Scenario: 声明类型和实际类型不一致
- **WHEN** 附件声明为 Markdown 但实际内容或扩展名与 Markdown 不一致
- **THEN** 系统 MUST 返回 `ATTACHMENT_TYPE_MISMATCH`
- **AND** 系统 MUST NOT 仅依赖客户端声明 MIME 接受附件

#### Scenario: Markdown 读取失败
- **WHEN** Markdown 附件无法按 UTF-8 读取、包含 NUL 字节或匹配已知二进制 magic bytes
- **THEN** 系统 MUST 返回 `ATTACHMENT_READ_FAILED`
- **AND** 系统 MUST 记录 diagnostic log 和 metric
- **AND** 输出 MUST NOT 包含 raw attachment content

#### Scenario: 非 Markdown 不触发外部解析判断
- **WHEN** 附件不是首版启用的 Markdown 类型，且需要外部解析器、密码、远程访问、宏执行、脚本执行或容器展开才能进一步判断
- **THEN** 系统 MUST 返回 `ATTACHMENT_TYPE_UNSUPPORTED`
- **AND** 系统 MUST NOT 调用外部解析器、展开容器、探测 Office/PDF 密码或执行附件内容

### Requirement: 受控附件事实
TS 后端 MUST 只通过 attachment runtime 生成的受控附件事实把附件带入请求生命周期。成功 intake MUST 产生 `AttachmentId`、写入 `BlobStoreGateway` 的 opaque bytes、写入 `AttachmentStoreGateway` 的 `RequestAttachment` metadata/status 和 safe summary；本 change MUST NOT 扩展核心 request command 字段或让 command/session 保存附件 metadata 副本。

#### Scenario: 成功生成可消费 AttachmentId
- **WHEN** Markdown 附件通过所有 intake 校验并成功暂存
- **THEN** 系统 MUST 将附件 bytes 写入 `BlobStoreGateway` 并获得 opaque `BlobRef`
- **AND** 系统 MUST 写入包含 `attachmentId`、`sessionId`、`requestId`、`runId?`、`agentId`、`fileName`、`mediaType`、`sizeBytes`、`storageRef`、`validationStatus=ACCEPTED`、`availabilityStatus=AVAILABLE` 和 `createdAt` 的 `RequestAttachment` metadata/status record
- **AND** 请求入口 MUST NOT 将文件名、media type、sizeBytes、status 或 storageRef 复制进 request command/session
- **AND** 请求入口 MUST 只通过 `attachmentId` 把附件传递给 request command

#### Scenario: AttachmentId 可追溯到权威事实
- **WHEN** 后续流程消费 `AttachmentId`
- **THEN** 系统 MUST 能通过 `AttachmentStoreGateway` 查询到 attachment runtime 接受的 `RequestAttachment`
- **AND** 系统 MUST 能通过 `RequestAttachment.storageRef` 和 `BlobStoreGateway` 找到受控内容
- **AND** 消费方 MUST NOT 依赖请求入口私有 upload state

#### Scenario: safe summary 不替代内容解析
- **WHEN** attachment runtime 输出 safe summary
- **THEN** safe summary MUST 只描述文件名、类型、大小、accepted/rejected 状态和 reason code 等安全属性
- **AND** safe summary MUST NOT 概括 Markdown 原文内容
- **AND** safe summary MUST NOT 作为模型上下文内容替代后续 attachment context flow

### Requirement: 附件 intake 流程接入
TS 后端 MUST 将 attachment intake 接入 submit/edit request 主流程。请求入口 MUST 先通过 runtime reserve submit 边界预留 request 坐标，再调用 attachment runtime 完成 intake，最后构造 request command；runtime reserve submit MUST NOT 等同于 request acceptance，MUST NOT 保存 `RequestRun`、用户消息或触发 scheduler；runtime request acceptance 和 Context Engine 的附件消费规则由后续附件 flow change 定义，本 change MUST NOT 让 raw upload input 越过 attachment runtime。

Runtime reserve submit 在 admission gap 内 MUST 具备持久幂等性。同一可信 owner/agent/session/idempotencyKey 和同一 command semantic MUST 返回同一组 `requestId`、`runId` 和 `requestContextId`；同一 key 搭配不同 command semantic MUST 返回 safe idempotency conflict。除非 submit/edit acceptance 成功，预留坐标 MUST NOT 成为用户可见 request。

Runtime reserve submit MUST 由最小 runtime-owned reservation fact 或等价 idempotency anchor 支撑。anchor 唯一性 MUST 包含可信 owner scope、`agentId`、`sessionId`、`idempotencyKey`、request action 和 canonical command semantic hash。canonical command semantic MUST 由可信 request action、`sessionId`、normalized `inputText`、`locale?` 和是否存在 attachment intake 推导；MUST NOT 包含 raw file bytes、file name、declared MIME、server-counted size、`BlobRef` 或客户端提供的 attachment metadata。`normalized inputText` MUST 是请求入口 schema validation 后得到的 exact string value；系统 MUST NOT 为幂等目的执行 trim、Unicode normalization、换行归一化或语义改写。进程重启后，同一 anchor 的 replay MUST 返回首次预留坐标；同一 owner/agent/session/idempotencyKey 但 command semantic hash 不同的 replay MUST 返回 safe conflict。

reservation anchor 已产生 terminal attachment intake outcome 后，同一 anchor 的 replay MUST 返回首次 intake outcome，以及首次 accepted `attachmentIds` 或 rejection result。系统 MUST NOT 为该 replay 重新读取 upload input、重新暂存 Blob、创建新的 `RequestAttachment`，也 MUST NOT 比较第二次附件集合。同一 idempotency key 下的附件变化视为首次用户动作的 replay，不视为新的 intake attempt。

#### Scenario: request acceptance 前完成 intake
- **WHEN** 请求入口接收到带附件的 submit request
- **THEN** 请求入口 MUST 先从 runtime 预留 `requestId`、`runId` 和 `requestContextId`
- **AND** 请求入口 MUST 在调用 submit acceptance boundary 前完成 intake
- **AND** runtime submit MUST 复用同一组预留 request 坐标完成 request acceptance
- **AND** `SubmitRequestCommand.attachmentIds` MUST 只包含 attachment runtime 接受后产生的 ids
- **AND** runtime MUST NOT 接收 raw file bytes 或 raw upload handles

#### Scenario: reserve submit 重放返回同一坐标
- **WHEN** 请求入口用相同可信 owner、session、idempotencyKey 和相同 command semantic 重复 reserve submit
- **THEN** runtime MUST 返回同一组 `requestId`、`runId` 和 `requestContextId`
- **AND** runtime MUST NOT 创建 `RequestRun`、用户消息或 scheduler work item

#### Scenario: 同一 idempotency key 下附件变化不重新暂存
- **WHEN** 首次带附件请求已经在同一 reservation anchor 下产生 terminal attachment intake outcome
- **AND** 用户使用同一 owner、agent、session、idempotencyKey、request action、exact `inputText`、`locale?` 和 attachment-present semantic 重放请求但上传了不同文件
- **THEN** 系统 MUST 返回首次 intake outcome 和首次 accepted `attachmentIds` 或 rejection result
- **AND** 系统 MUST NOT 重新读取第二次 upload input、写入新 Blob 或创建新的 `RequestAttachment`

#### Scenario: `inputText` exact string 参与幂等语义
- **WHEN** 用户使用同一 owner、agent、session 和 idempotencyKey 重放请求，但 `inputText` 从 `abc` 变为 `abc\n` 或 ` abc `
- **THEN** 系统 MUST 将其视为不同 command semantic
- **AND** 系统 MUST 返回 safe idempotency conflict

#### Scenario: reserve 后 intake 成功但 acceptance 未发生
- **WHEN** attachment intake 已写入 Blob 或 `RequestAttachment`，但 submit/edit acceptance 未成功
- **THEN** 系统 MUST NOT 将该附件 id 放入任何 accepted request command
- **AND** 已写入事实 MUST 保留 owner/session/request/run refs 和安全诊断，以便后续 cleanup change 识别 orphan candidate

#### Scenario: 后续 context flow 消费附件
- **WHEN** Context Engine 后续需要附件上下文
- **THEN** 本 change MUST 只提供 attachment runtime 接受后产生的 `AttachmentId` 作为后续 flow 输入
- **AND** 本 change MUST NOT 定义 Markdown 内容进入上下文的预算、摘要、排序或加载规则

### Requirement: 附件失败与降级可见性
TS 后端 MUST 对所有 attachment intake 失败和降级输出明确 safe error、rejected outcome 或用户可见提示。系统 MUST NOT 静默截断、静默丢弃、吞错、伪造 accepted，或把失败附件当作空附件继续处理。

Attachment intake 在 staging 前 MUST 使用 collect-all-errors，并在 request level fail-closed。只有所有附件都通过结构、数量、大小、类型和可读性校验后，Blob 和 metadata/status 写入才 MUST 开始。accepted/rejected audit/log/metric 是 outcome-time side effects，不是流程末尾追加的补记步骤。

Attachment intake MAY 在 staging 前对最多 3 个附件收集确定性 validation errors。read timeout、budget exhausted、dependency unavailable 和 storage failure MAY fail fast。无论采用哪种方式，request acceptance 前的用户可观察 request-level 结果 MUST 保持 fail-closed，部分成功的 `attachmentIds` MUST NOT 进入 request command。

#### Scenario: 暂存失败
- **WHEN** accepted 类型附件在安全暂存时发生路径不可用、权限不足、暂存一致性失败、存储不可用或写入失败
- **THEN** 系统 MUST 返回 `ATTACHMENT_STAGING_FAILED`
- **AND** 系统 MUST 记录 diagnostic log、metric 和必要 audit 安全摘要
- **AND** 系统 MUST NOT 生成可进入 request command 的 `AttachmentId`

#### Scenario: 多附件部分写入失败
- **WHEN** 多个附件都通过前置校验，但任一附件在 Blob 写入或 metadata/status 写入阶段失败
- **THEN** 系统 MUST 拒绝整个 request intake
- **AND** 系统 MUST NOT 将已写入成功附件的 `attachmentIds` 放入 request command
- **AND** 已写入 Blob 或 metadata/status MUST 作为 orphan candidate 或 cleanup handoff 可追踪
- **AND** metadata 已写入的 orphan candidate MUST 携带 owner/session/request/run/agent refs 和 storageRef
- **AND** Blob write MUST 接收 safe diagnostic context，至少包含 `reservationId` 或等价 reservation anchor id、`requestId`、`runId?`、`sessionId`、`agentId`、owner scope 和 intake attempt id
- **AND** Blob 已写入但 metadata 未写入的 orphan candidate MUST 可通过 redacted diagnostic log 或 audit 中的 safe correlation fields 诊断
- **AND** 系统 MUST NOT 将 `BlobRef`、storage path、storage URL 或 raw content 暴露到用户可见输出
- **AND** 本 change MUST NOT 要求 cleanup 枚举 blob-only orphans

#### Scenario: 预算不足或超时
- **WHEN** attachment intake 超过 request admission 预算、读取超时或 staging 超时
- **THEN** 系统 MUST 返回 `ATTACHMENT_INTAKE_TIMEOUT` 或 `ATTACHMENT_BUDGET_EXCEEDED`
- **AND** safe output MUST 标明 retryable 语义
- **AND** 系统 MUST NOT 后台继续接受该附件并让当前请求继续

#### Scenario: 依赖不可用
- **WHEN** attachment runtime、`BlobStoreGateway`、`AttachmentStoreGateway`、audit writer 或必要配置不可用
- **THEN** 系统 MUST 返回 SafeError 或 rejected outcome
- **AND** 系统 MUST 记录 dependency failure metric
- **AND** 系统 MUST NOT 降级为请求入口私有文件处理

### Requirement: 附件 intake 事件、审计与脱敏
TS 后端 MUST 为 attachment intake 产生安全、可追溯的审计、日志和最小指标。`ATTACHMENT_ACCEPTED` / `ATTACHMENT_REJECTED` 是 intake outcome events：它们表示 attachment intake gate 接受或拒绝附件，不表示 request 本身已 accepted。只有周边 request flow 已有可见 request context 时，用户可见 timeline/stream projection 才 MAY 产生；如果产生，payload MUST 安全表达 intake outcome 语义，并且 MUST NOT 暗示 request acceptance。Audit/log/metric MUST 使用 business refs 和 safe reason code；任何输出 MUST NOT 包含 raw attachment content、secret、credential、未脱敏路径或未授权对象内容。

#### Scenario: accepted 附件产生事件和审计
- **WHEN** 附件 intake 成功
- **THEN** 系统 MUST 记录 `attachment.accepted` audit 安全摘要、accepted count、size bucket 和 staging latency metric
- **AND** 只有 request flow 已有可见 request context 时，系统 MAY 产生 `ATTACHMENT_ACCEPTED` timeline/stream projection（stable event code）
- **AND** 输出 MUST 只包含 `attachmentId`、安全文件名、media type、sizeBytes 和安全摘要字段
- **AND** 输出 MUST NOT 包含 `BlobRef`、存储路径、存储 URL 或 raw attachment content

#### Scenario: rejected 附件产生事件和审计
- **WHEN** 附件 intake 被拒绝
- **THEN** 系统 MUST 返回 `ATTACHMENT_REJECTED` safe intake outcome 或 `ATTACHMENT_STAGING_FAILED` safe failure outcome
- **AND** 系统 MUST 记录 `attachment.rejected` audit 安全摘要、reason code、failure category 和 latency metric
- **AND** 只有 request flow 已有可见 request context 时，系统 MAY 产生 `ATTACHMENT_REJECTED` timeline/stream projection（stable event code）
- **AND** 系统 MUST NOT 泄露 raw attachment content、内部路径、stack trace、provider error、secret 或 credential
