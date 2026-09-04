## 1. 请求入口触发与归一化

- [x] 1.1 保留无附件 submit/edit 的现有 JSON body 路径，并将附件集合视为空集合；无附件请求不得触发文件读取、暂存或附件解析流程。验证：Web contract test 覆盖无附件 JSON submit/edit 仍被接受，且 attachment runtime 未被调用。
- [x] 1.2 为带附件 submit/edit 定义唯一入口形态：`multipart/form-data` 同请求携带 `inputText`、`idempotencyKey`、`locale?` 和文件 part；拒绝 JSON base64 bytes、raw upload handle、独立预上传 token，以及客户端自报的可信 owner、size、status、storage、validation/availability metadata。验证：route/schema tests 覆盖 multipart 成功路径和 JSON/base64/pre-upload negative cases。
- [x] 1.3 在请求入口用可信 auth boundary 和 session owner scope 构造 intake input；`IdentityContext`、owner/agent/session refs 来自可信上下文，`sizeBytes` 来自服务器实际读取 byte length，文件名和声明 MIME 只作为不可信提示。验证：入口测试确认客户端声明的 owner、size、status、storage 字段不会进入 intake 信任语义。
- [x] 1.4 submit/edit 带附件时，请求入口必须先调用 runtime reserve submit 获得 `requestId`、`runId` 和 `requestContextId`，再调用 attachment runtime intake gate。验证：flow test 覆盖 reserve 发生在 intake 和 request acceptance 之前。

## 2. Runtime Reserve Submit 坐标契约

- [x] 2.1 实现 runtime-owned minimal reservation fact 或等价 idempotency anchor：唯一键包含 trusted owner scope、`agentId`、`sessionId`、`idempotencyKey`、request action 和 canonical command semantic hash。验证：reservation 持久化和唯一性契约测试。
- [x] 2.2 定义 canonical command semantic：只包含 trusted request action、`sessionId`、schema validation 后的 exact `inputText` string、`locale?` 和是否存在 attachment intake；不得 trim、Unicode normalize、换行归一化或语义改写，也不得包含 raw bytes、文件名、declared MIME、server-counted size、`BlobRef` 或客户端附件 metadata。验证：canonicalization 单元测试覆盖 `abc`、`abc\n`、` abc ` 为不同 semantic。
- [x] 2.3 实现持久幂等 replay：同一 anchor 在进程重启后返回同一组 `requestId`、`runId`、`requestContextId`。验证：重复 reserve 和重启后的契约测试。
- [x] 2.4 reserve submit 不得等同 request acceptance：不得创建 `RequestRun`、不得写用户消息、不得触发 scheduler、不得进入 execution。验证：runtime 负向测试断言 reserve 后无 accepted run/message/work item。
- [x] 2.5 同一 owner/agent/session/idempotencyKey 搭配不同 command semantic hash 时返回 safe idempotency conflict，不进入 attachment intake 或 request acceptance。验证：semantic conflict 测试。
- [x] 2.6 同一 reservation anchor 下首次 attachment intake 已产生 terminal outcome 后，后续 replay 必须返回首次 intake outcome 和首次 accepted `attachmentIds` 或 rejection result；不得重新读取 upload input、重新写 Blob、创建新 `RequestAttachment` 或比较第二次附件集合。验证：同一 idempotencyKey 下不同文件 replay 测试。
- [x] 2.7 reserve 成功但 intake 或 acceptance 后续失败时，已写入附件事实必须保留可诊断的 reservation/request refs 和安全诊断，作为 orphan candidate 或 cleanup handoff 可追踪；本 change 不定义 cleanup marker、retention 或调度机制。验证：admission gap 失败测试覆盖可诊断 refs 和 cleanup boundary。

## 3. Attachment Runtime Intake Gate

- [x] 3.1 定义 attachment runtime intake 的边界输入、结果和 SafeError/rejected outcome 映射，复用已冻结 `AttachmentId`、`RequestAttachment`、`BlobRef`、`BlobStoreGateway`、`AttachmentStoreGateway` 和 request command `attachmentIds`；若字段或 port 不足，先提出独立 contract refinement change。验证：contract guard 和 architecture check。
- [x] 3.2 按 design 顺序校验 request 结构和可信入口上下文：附件集合缺失视为空集合；缺少文件名、字节流、声明 MIME 或服务器计数大小返回 validation safe error；不得接受请求体自报 owner 或从附件内容推导 owner。验证：intake contract 负向测试。
- [x] 3.3 执行数量和大小限制：每请求最多 3 个附件；单文件 sizeBytes 必须大于 0 且小于等于 5 MiB；错误分别映射 `ATTACHMENT_COUNT_EXCEEDED`、`ATTACHMENT_EMPTY`、`ATTACHMENT_TOO_LARGE`。验证：0、1、3、4 个附件，以及 0、1、5 MiB、超过 5 MiB 边界测试。
- [x] 3.4 执行首版 Markdown 类型与可读性校验：扩展名 `.md`/`.markdown`，声明 MIME 为 `text/markdown` 或 `text/plain`，内容不匹配已知二进制 magic bytes，并可按 UTF-8 读取；PDF/Excel/Word/其他非 Markdown 返回 `ATTACHMENT_TYPE_UNSUPPORTED`，不得为区分 parser/password 去探测 Office/PDF 内容。验证：Markdown、PDF、ZIP/Office、伪装扩展名、非法 UTF-8、NUL 字节 fixtures。
- [x] 3.5 将 intake budget 限定在 gate 内读取、校验、Blob 写入和 metadata/status 写入的总耗时与总字节数；读取超时、staging 超时和预算不足必须返回 `ATTACHMENT_INTAKE_TIMEOUT` 或 `ATTACHMENT_BUDGET_EXCEEDED`，且标明 retryable 语义。验证：timeout/budget tests。
- [x] 3.6 前置确定性校验可在最多 3 个附件内 collect-all-errors；读取超时、budget exhausted、dependency unavailable 和 storage failure 可 fail-fast；任一失败均 request-level fail-closed，不写 Blob、不构造 request command、不静默提交剩余附件。验证：多附件混合成功/失败测试，断言前置校验失败时 `BlobStoreGateway` 未被调用。

## 4. Blob 与 RequestAttachment 事实写入

- [x] 4.1 所有附件均通过前置校验后，attachment runtime 才能逐个写入 accepted Markdown bytes 到通用 `BlobStoreGateway` 并获得 opaque `BlobRef`。验证：Blob write 集成测试或 fake gateway 测试。
- [x] 4.2 Blob 写入成功后生成 `AttachmentId`，并通过 `AttachmentStoreGateway` 写入权威 `RequestAttachment` metadata/status record，字段包含 `attachmentId`、`sessionId`、`requestId`、`runId?`、`agentId`、`fileName`、`mediaType`、`sizeBytes`、`storageRef`、`validationStatus=ACCEPTED`、`availabilityStatus=AVAILABLE` 和 `createdAt`。验证：metadata creation 契约测试。
- [x] 4.3 任一附件在 Blob 或 metadata/status 写入阶段失败时，整个 request intake 失败，返回 `ATTACHMENT_STAGING_FAILED` 或对应 dependency/timeout safe failure；不得输出部分成功的 `attachmentIds`。验证：partial staging failure 测试。
- [x] 4.4 Blob 写入必须接收 safe diagnostic context，至少包含 `reservationId` 或等价 reservation anchor id、`requestId`、`runId?`、`sessionId`、`agentId`、owner scope 和 intake attempt id。验证：BlobStoreGateway write options/context 契约测试。
- [x] 4.5 Blob 写入成功但 metadata/status 未写入时，orphan 必须可通过 redacted diagnostic log 或 audit 中的 safe correlation fields 诊断，且不得把 `BlobRef`、storage path、URL 或 raw content 暴露给用户可见输出；本 change 不要求 cleanup 枚举 blob-only orphan。验证：blob-only orphan 诊断和脱敏测试。
- [x] 4.6 Metadata/status 写入成功后，`RequestAttachment` 必须包含 owner/session/request/run/agent refs、`storageRef`、status、safe file metadata 和 `createdAt`，以便 request acceptance 未发生时可识别 orphan candidate。验证：metadata orphan traceability 测试。
- [x] 4.7 Safe summary 只描述文件名、类型、大小、accepted/rejected 状态和 reason code，不概括 Markdown 原文。验证：safe summary 内容断言。

## 5. Request Command 与后续流程边界

- [x] 5.1 intake 全部成功后，请求入口只能把 accepted `attachmentIds` 放入 `SubmitRequestCommand` 或 `EditLatestRequestCommand`，并复用 reserve submit 预留的 `requestId`、`runId`、`requestContextId` 完成 request acceptance。验证：submit/edit success flow tests。
- [x] 5.2 request command 和 `SessionMessage` 不得包含 raw upload input、文件名、media type、sizeBytes、validation/availability status、`storageRef` 或 `BlobRef`。验证：command/session negative assertions。
- [x] 5.3 任一附件失败、reserve conflict、budget exhausted、dependency unavailable 或 partial staging failure 时，不得进入 submit/edit acceptance，不得伪造成无附件请求继续处理。验证：failure flow tests。
- [x] 5.4 本 change 只提供 `attachmentIds` 作为后续输入；runtime acceptance 中对 `attachmentIds` 的权威回查、owner/agent/session 绑定校验、ACCEPTED 状态校验，以及 Context Engine 的 Markdown 内容预算、摘要、排序、加载规则由 `add-ts-attachment-request-context-flow` 承载。验证：architecture boundary check。
- [x] 5.5 `EditLatestRequestCommand.attachmentIds` 只表示本次 edit 新接受的附件；本 change 不继承、替换、删除或重新绑定历史请求附件。验证：edit latest command projection tests。

## 6. 事件、审计、日志、指标与安全输出

- [x] 6.1 intake 成功时记录 `attachment.accepted` audit、accepted count、size bucket 和 staging latency metric；任何输出只包含 `attachmentId`、安全文件名、media type、sizeBytes、validation/availability status、safe summary 和必要业务 refs，不包含 `BlobRef`、存储路径、URL 或 raw content。验证：accepted audit/metric 脱敏测试。
- [x] 6.2 intake 被拒绝或暂存失败时返回 `ATTACHMENT_REJECTED` safe intake outcome 或 safe failure outcome，并记录 `attachment.rejected` audit、reason code、failure category、latency 和必要 dependency metric。验证：rejected audit/metric 测试。
- [x] 6.3 `ATTACHMENT_ACCEPTED` / `ATTACHMENT_REJECTED` timeline/stream projection 仅在 request flow 已有可见 request context 时产生，且语义必须是 intake outcome，不得暗示 request accepted。验证：projection 时机/语义测试或 architecture boundary review。
- [x] 6.4 SafeError 映射覆盖 validation、authorization、count exceeded、empty、too large、type unsupported、type mismatch、read failed、staging failed、timeout、budget exhausted 和 dependency unavailable；首版 parser/password 不作为 MUST 验收项。验证：safe error 契约测试。
- [x] 6.5 SafeError、timeline/stream payload、audit、structured log 和 metric 不得包含 raw attachment content、secret、credential、未脱敏路径、stack trace、provider/raw storage error、`BlobRef` 或未授权对象内容。验证：redaction/security 测试。

## 7. 验证和收尾

- [x] 7.1 运行 OpenSpec strict validation。验证命令：`npx openspec validate add-ts-attachment-intake --strict`。
- [x] 7.2 运行 attachment intake 相关 contract、flow、resilience、安全、observability 和 architecture 验证；实现阶段按实际测试套件记录具体命令。验证：测试命令输出和失败路径断言。
- [x] 7.3 做 KISS/边界收口检查：不得启用 PDF/Excel/Word 内容解析，不得新增 attachment download API，不得引入独立预上传 token flow，不得实现 cleanup retention/scheduler，不得让 raw attachment content 或 `BlobRef` 进入 message、context、model、capability、SafeError、audit、log 或 metric。验证：code review + architecture/security checks。

## 8. 归档前基线提升检查（非实施任务）

交付完成并验证通过后，在归档前根据 proposal/design 的 Baseline Promotion Plan 处理：

- [ ] 8.1 将 `openspec/specs/ts-attachment-intake/spec.md` 提升为 attachment intake 行为基线。
- [ ] 8.2 按需更新 `openspec/overview.md`、`openspec/designs/architecture/attachment-intake.md`、`openspec/designs/domain/attachment.md`、`openspec/designs/contracts/attachment-intake.md`、请求入口/attachment runtime/runtime request acceptance 相关长期职责文档、`openspec/designs/adr/0004-controlled-attachment-intake.md` 和 `openspec/designs/spec-to-design-map.md`。
- [ ] 8.3 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
