## 背景和现状

TS 后端核心契约已经定义请求提交/编辑命令的 `attachmentIds`、`SessionMessage.attachmentIds`、`RequestAttachment`、`BlobRef`、`ContentRef(refType=ATTACHMENT)` 以及附件相关 timeline/stream vocabulary。架构 change 已明确 attachment runtime 是附件可信校验、暂存、可用性和 cleanup policy 的 owner，请求入口、runtime、context 和 session 不直接处理文件系统细节。

本 change 只补齐请求附件从不可信输入进入受控附件事实的 intake 契约。相关方包括请求入口、attachment runtime、`BlobStoreGateway`、`AttachmentStoreGateway`、observability、audit sink 和前端请求提交/编辑入口。runtime 的 `attachmentIds` 校验和 Context Engine 的附件上下文消费由后续 `add-ts-attachment-request-context-flow` 细化。

## 目标和非目标

**目标：**
- 定义 attachment intake 的黑盒效果：用户提交或编辑请求时，附件先被校验、写入受控 Blob、写入权威 `RequestAttachment` metadata/status，并转换成请求命令可携带的 `AttachmentId`。
- 定义触发机制：由提交请求、编辑最新请求或请求表单中的附件上传/选择触发；带附件的 Web 入口使用 `multipart/form-data`，文本字段与文件 part 同请求到达；发生在请求入口接收附件输入后、request acceptance 前；验证和暂存同步阻塞 acceptance，cleanup 后续异步。
- 定义输入和前置条件：可信 identity、owner scope、session refs、multipart 表单字段、文件 part、服务器实际读取的字节数、配置限制、预算、安全上下文、attachment runtime、`BlobStoreGateway`、`AttachmentStoreGateway`、safe error normalizer、audit/log/metric sink 必须可用。
- 定义输出和副作用：accepted `AttachmentId`、`RequestAttachment` metadata/status、opaque `BlobRef`、safe error、safe summary、intake outcome、audit、log、metric，以及在已有可见 request context 中可投影的 timeline/stream event。
- 定义核心判断顺序、状态/产物契约、流程接入、失败降级和可验收场景。

**非目标：**
- 不解析 PDF、Excel 或 Word 内容，不生成这些类型的上下文摘要。
- 不提供 artifact download、attachment download 或内容预览 API。
- 不定义长期 session retention、后台保留期策略、调度式 cleanup 或 cleanup marker；这些由 `add-ts-attachment-cleanup` 承载。
- 不让 Context Engine 直接读取原始上传输入；附件上下文消费由 `add-ts-attachment-request-context-flow` 定义。
- 不修改核心 `attachmentIds`、`RequestAttachment` 或 `BlobRef` 字段形态，除非另行提出 contract refinement。
- 不把附件内容写入 SafeError、audit、日志、metric、stream payload、message content 或 model context。
- 不定义独立预上传 API、临时上传 token、base64 JSON 附件输入或 attachment download API。

## 设计决策（Decisions）

### 第一性原理和业务边界

第一性原理：附件 intake 解决的是“不可信文件输入能否进入请求生命周期”的问题，不是“附件内容如何被模型理解”的问题。系统不变量是：只有 attachment runtime 接受并生成 `AttachmentId`、`RequestAttachment` 和 opaque `BlobRef` 后，该 `AttachmentId` 才能随请求命令进入 request acceptance。

业务边界：
- 请求入口负责接收 multipart 附件输入、使用可信 auth boundary 注入 identity、做入口级 schema 限制、按服务器实际读取 bytes 计量大小，并调用 attachment runtime；不得自己生成可信 `AttachmentId`、附件 metadata 或读取文件内容进入 message。
- Attachment runtime 负责数量/大小/类型/可读性/Blob 写入、`RequestAttachment` metadata/status 写入、`AttachmentId` 输出和 rejection outcome。
- Runtime 在本 change 中只消费请求入口传入的 accepted `attachmentIds` 和预留坐标；runtime acceptance 中对 `attachmentIds` 的权威回查、owner/agent/session 绑定校验和持久化规则由 `add-ts-attachment-request-context-flow` 定义。本 change 不允许 runtime 接收 raw upload input，也不把“可由任意调用方伪造 attachmentIds”作为可接受行为。
- Context Engine 和后续附件上下文 flow 的消费规则由 `add-ts-attachment-request-context-flow` 定义；本 change 只保证不把 raw upload input 作为输出。
- audit/observability 只记录安全摘要、业务定位字段、reason code 和统计信息。

黑盒效果：
- 正常路径：用户提交 1 个 Markdown 文件，系统校验通过、写入 Blob、写入 `RequestAttachment(validationStatus=ACCEPTED, availabilityStatus=AVAILABLE)`，请求命令携带 `AttachmentId` 并记录 attachment accepted。
- 边界路径：用户提交 0 个附件或刚好 3 个 Markdown、单文件刚好 5 MiB，系统按配置限制确定性接受或拒绝，不进行静默截断。
- 失败路径：用户提交 PDF/Excel/Word/其他非 Markdown 类型、4 个附件、超 5 MiB、空文件、不可读 Markdown 或 staging failure，系统返回明确 safe error/rejected outcome 并记录诊断；首版不探测 PDF/Office 密码保护、容器结构或外部解析需求。

### 核心实现策略

采用“runtime 预留请求坐标 + 请求入口归一化附件输入 + attachment runtime intake gate + 请求命令 attachmentIds-only”的单一路径：

1. 无附件 submit/edit 继续使用现有 JSON body；带附件 submit/edit 使用 `multipart/form-data`，其中 `inputText`、`idempotencyKey`、`locale?` 和文件 part 同请求到达；本 change 不引入独立预上传 token 或 base64 JSON 输入。
2. 请求入口使用 auth boundary 注入可信 `IdentityContext`，校验文本字段和 session owner scope，并按服务器实际读取的文件 bytes 计算 `sizeBytes`；客户端声明的 size、owner、status 或 storage 字段一律不可信。
3. 请求入口在处理 submit request 附件前，调用 runtime reserve submit 边界，为同一个 `sessionId`、可信 `IdentityContext`、输入语义和 `idempotencyKey` 预留 `requestId`、`runId` 和 `requestContextId`。
4. Runtime reserve submit 必须是持久幂等的 request-coordinate reservation：同一 owner/agent/session/idempotencyKey 和同一 command semantic 重放时返回同一组坐标；不同 semantic 复用 key 时返回 safe conflict；它不保存 `RequestRun`、不写用户消息、不触发 scheduler、不进入 execution。该能力只需要 runtime-owned minimal reservation fact 或等价 idempotency anchor，不引入完整 request state machine。
5. 预留坐标的生命周期只覆盖当前 intake 到 submit acceptance 的 admission gap。若 intake 成功但 submit acceptance 未发生，已写入的 `RequestAttachment` 仍是可追溯的 orphan candidate；本 change 只要求写入 owner/session/request/run refs 和安全诊断，不定义清理调度或 retention，具体清理由 `add-ts-attachment-cleanup` 处理。
6. 请求入口将 multipart 文件 part 归一化为 attachment runtime intake boundary input：safe file name、declared MIME、server-counted bytes、server-counted `sizeBytes`、可信 identity、session/request/run refs、request action、idempotency key、request budget 和配置限制。
7. Attachment runtime 先对整个附件集合执行结构、数量、大小、Markdown 类型和 UTF-8 可读性校验；首版可对最多 3 个附件收集确定性校验错误，但读取超时、预算不足、依赖不可用和存储失败可 fail-fast；最终仍是 request-level fail-closed，不写入 Blob，不构造 request command，不静默提交剩余附件。
8. 所有附件均通过前置校验后，attachment runtime 才逐个执行写入。每个 accepted 附件在 Blob 写入成功后生成 `AttachmentId`，再写入 `RequestAttachment` metadata/status record。
9. 如果任一附件在 Blob 或 metadata/status 写入阶段失败，整个 request intake 失败；已写入的 Blob 或 metadata/status 必须记录为 orphan candidate 或通过 cleanup owner 后续处理，不得把部分成功的 `attachmentIds` 交给 request command。
10. 请求入口只把全部成功后的 accepted `attachmentIds` 放入提交/编辑请求命令；runtime submit 对同一 idempotency 语义复用已预留 `requestId`、`runId` 和 `requestContextId` 完成 request acceptance。
11. 后续 runtime request acceptance 和 Context Engine 通过 `add-ts-attachment-request-context-flow` 定义的规则消费 `attachmentIds` 并查询权威 `RequestAttachment`，不回读 Web upload input；该后续规则必须关闭跨 owner、跨 agent、跨 session 或非 ACCEPTED attachment id 被消费的路径。

放弃的方案：
- 放弃在请求入口中直接生成 `AttachmentId` 或 `RequestAttachment`。这样会把可信校验和 owner scope 分散到入口层。
- 放弃在 runtime acceptance 中处理 raw file bytes。runtime 应保持执行 lifecycle owner，不承担文件系统和内容安全细节。
- 放弃“先 intake 后 submit 再回填 request 坐标”。该方案会让附件事实先以缺失 request/run 坐标的形态落库，再依赖后续回填事务修正，增加并发重放、失败恢复和 orphan 识别复杂度；本 change 选择先持久幂等 reserve 坐标，再用同一坐标完成 intake 和 acceptance。
- 放弃首版对 PDF/Excel/Word 做 best-effort 接受。未启用类型必须显式 safe error，避免用户误以为内容已进入上下文。
- 放弃静默丢弃失败附件后继续请求。附件是用户输入的一部分，失败必须可见。
- 放弃在首版强制投影用户可见 timeline 事件。attachment accepted/rejected 首先是 intake outcome；只有当周边 request flow 已有可见 request context 时，才可投影为 timeline/stream，不得暗示 request 已 accepted。

### 核心判断逻辑

Attachment runtime MUST 按以下顺序判断：

1. 校验 request 结构：附件集合缺失时视为空集合；附件条目缺少文件名、字节流、声明 MIME 或服务器计数大小字段时返回 validation safe error。
2. 校验可信入口上下文：intake input MUST 由请求入口使用可信 `IdentityContext` 构造；attachment runtime 不接受请求体自报 owner 字段，也不尝试从附件内容或客户端 metadata 推导 owner。
3. 校验每请求数量：附件数 MUST 小于等于 3；超过时拒绝整个 request intake，返回 `ATTACHMENT_COUNT_EXCEEDED` safe error。
4. 逐文件校验大小：单文件大小 MUST 使用服务器实际读取的 byte length，MUST 大于 0 且小于等于 5 MiB；0 字节返回 `ATTACHMENT_EMPTY`，超限返回 `ATTACHMENT_TOO_LARGE`。
5. 识别 Markdown 类型：首版 Markdown 判定使用扩展名 `.md` / `.markdown`、声明 MIME 为 `text/markdown` 或 `text/plain`、且内容不匹配已知二进制 magic bytes 的最小一致性规则；声明 MIME 不得单独作为可信类型。
6. 校验启用范围：首版本地 release 只有 Markdown 类型启用；PDF、Excel、Word 和其他非 Markdown 类型 MUST 返回 `ATTACHMENT_TYPE_UNSUPPORTED`，并说明当前只启用 Markdown。
7. 校验 Markdown 可读性：Markdown 必须可按 UTF-8 读取为文本；读取失败、非法 UTF-8、包含 NUL 字节或匹配已知二进制 magic bytes 时返回 `ATTACHMENT_READ_FAILED` 或 `ATTACHMENT_TYPE_MISMATCH`。首版不使用“损坏内容”或“安全文本边界”作为额外不可操作判断。
8. 校验 request budget：附件 intake 预算从 attachment runtime intake gate 开始计时，只覆盖读取、校验、Blob 写入和 metadata/status 写入；预算包含总耗时和总字节数，不包含确定性的 staging 操作次数。
9. Blob 写入：accepted Markdown bytes 只能写入通用 `BlobStoreGateway`；写入失败、权限不足、存储不可用或超时 MUST 显式失败。
10. Metadata/status 写入：成功写入 Blob 后，attachment runtime MUST 通过 `AttachmentStoreGateway` 写入权威 `RequestAttachment` metadata/status record，包含 `attachmentId`、`sessionId`、`requestId`、`runId?`、`agentId`、`fileName`、`mediaType`、`sizeBytes`、`storageRef`、`validationStatus=ACCEPTED`、`availabilityStatus=AVAILABLE` 和 `createdAt`。
11. 输出 `AttachmentId`：成功写入 `RequestAttachment` 后，请求入口只能将 `AttachmentId` 放入 request command；不得把文件名、media type、size、status 或 `BlobRef` 复制进 command/session。
12. 记录副作用：accepted/rejected intake outcome 的安全日志、metric 和必要 audit 是横切副作用，必须在对应 outcome 产生时记录；不得等到流程末尾才补记，也不得记录 raw content 或 `BlobRef`。用户可见 timeline/stream projection 只在 request flow 已有可见上下文时发生，不代表 request acceptance。

### Reserve Submit 最小契约

- Owner：`agent-runtime` 拥有 reservation fact 或等价 idempotency anchor；gateway-local 只负责持久化、唯一约束和事务。
- Anchor：唯一键 MUST 包含 trusted owner scope、`agentId`、`sessionId`、`idempotencyKey`、request action 和 canonical command semantic hash。
- Canonical semantic：只由 trusted request action、`sessionId`、normalized `inputText`、`locale?` 和“是否存在 attachment intake”组成；MUST NOT 包含 raw bytes、file name、declared MIME、server-counted size、`BlobRef` 或客户端附件 metadata。
- `normalized inputText`：指请求入口 schema validation 后得到的 exact string value；不做 trim、不做 Unicode normalization、不做换行归一化、不做语义改写。因此 `"abc"`、`"abc\n"` 和 `" abc "` 是不同 command semantic。
- Replay：同一 anchor 在进程重启后 MUST 返回首次预留的 `requestId`、`runId`、`requestContextId`；同 owner/agent/session/idempotencyKey 但 semantic hash 不同 MUST 返回 safe idempotency conflict。
- Attachment replay：同一 reservation anchor 下，一旦首次 attachment intake 已产生 terminal outcome，后续 replay MUST 返回首次 intake outcome，以及首次 accepted `attachmentIds` 或 rejection result；系统 MUST NOT 重新读取 upload input、重新暂存 Blob、创建新的 `RequestAttachment` 或比较第二次附件集合。同一 idempotency key 下的附件变化视为 replay，不视为新的 intake attempt。
- Visibility：reservation fact 不是用户可见 request，不是 `RequestRun`，不是用户消息，不是 scheduler work，也不是 execution state。

### 状态 / 产物契约

- Attachment runtime intake input：一次请求提交或编辑中的附件输入集合。生命周期限于 request admission 前；包含附件输入、安全入口 metadata 和请求坐标；不可信 owner 字段不得进入可信身份语义。
- `AttachmentId`：本 change 对 request command 和 `SessionMessage` 暴露的唯一附件引用。语义是“当前请求可引用的附件 id”；字段形态遵守核心契约，不在本 change 中新增字段。
- `RequestAttachment`：附件 metadata/status 的权威事实。生命周期从 accepted metadata 写入到 cleanup/status 更新；消费方必须通过 `AttachmentStoreGateway` 查询，不得信任 command、message metadata、模型输出或 capability 参数中的附件描述。
- `BlobRef`：写入 `BlobStoreGateway` 后得到的 opaque 内容存储引用。只能由 `BlobStoreGateway` 解析；不得进入模型上下文、用户可见 stream、SafeError、audit 明细或结构化日志。
- Safe summary：只描述附件安全属性和处理状态，例如文件名、类型、大小、accepted/rejected reason；不概括 Markdown 原文内容，不替代后续解析/摘要。
- `ATTACHMENT_ACCEPTED` / `ATTACHMENT_REJECTED` intake outcome：表示 attachment intake gate 接受或拒绝附件，不表示 request 已 accepted。timeline/stream projection 只有在 request flow 已有可见 request context 时才能投影；payload 只包含 `attachmentId`、safe metadata 和 reason code，不包含 `BlobRef`。
- Audit/log/metric：记录 accepted/rejected、reason code、大小区间、latency、owner/session/request refs 和 failure category；不得包含 raw attachment content、`BlobRef`、secret、credential、未脱敏路径或未授权对象内容。

### Staging 部分失败不变量

- Blob 写入成功但 metadata/status 未写入时，系统 MAY 只存在 opaque Blob orphan；Blob write MUST 接收 safe diagnostic context，至少包含 `reservationId` 或等价 reservation anchor id、`requestId`、`runId?`、`sessionId`、`agentId`、owner scope 和 intake attempt id。失败路径 MUST 使用这些 safe correlation fields 记录 redacted diagnostic log/audit，并且不得向用户可见输出暴露 `BlobRef`、storage path、URL 或 raw content。本 change 不要求 cleanup 枚举 blob-only orphan。
- Metadata/status 写入成功后，`RequestAttachment` MUST 携带 owner/session/request/run/agent refs、`storageRef`、status、safe file metadata 和 createdAt，使 cleanup 能在 request acceptance 未发生时识别 orphan candidates。
- 部分 staging 成功 MUST NOT 进入 request command。任一 Blob 或 metadata/status 写入失败时，整个 request intake MUST 在 request acceptance 前失败。

### 流程接入

主流程接入点：
- 上游：前端 submit/edit form、请求入口、auth identity boundary、session owner scope、request budget 和配置。
- 当前节点：runtime reserve submit 坐标和 attachment runtime intake gate。
- 下游：`SubmitRequestCommand.attachmentIds`、`EditLatestRequestCommand.attachmentIds`、runtime 复用的 request 坐标、`RequestAttachment` metadata/status、timeline/stream projection、audit/observability，以及后续 runtime/context/cleanup changes。

生命周期阶段：
- upload input 可以在请求入口接收时暂存为临时输入，但它不是可信 `AttachmentId`、`RequestAttachment` 或 `BlobRef`。
- attachment runtime intake 必须在 runtime request acceptance 前完成；runtime reserve submit 只预留坐标，不等同于 request acceptance。
- request accepted 后，runtime 和 session 的 `attachmentIds` 校验、持久化和 context 消费由 `add-ts-attachment-request-context-flow` 细化。
- request rejected 或 edit rejected 时，已暂存内容的清理策略由 `add-ts-attachment-cleanup` 细化；本 change 不定义 cleanup marker 或调度机制。
- edit latest 带附件时，`EditLatestRequestCommand.attachmentIds` 只表示本次 edit 新接受的附件；本 change 不定义继承、替换、删除或重新绑定历史请求附件的语义。

## 质量属性设计

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | owner scope 来自可信 channel/auth boundary；附件内容必须通过 attachment runtime；SafeError、stream、audit、日志和 metric 不包含 raw content、secret、credential、未脱敏路径或未授权内容；首版禁用 PDF/Excel/Word。 | owner-scope、redaction、unsupported type、secret/path leakage 验证 |
| 性能/容量 | 每请求最多 3 个附件，单文件最大 5 MiB；intake 受 gate 内总耗时、总字节数、读取超时和 staging 超时限制；不做外部解析和复杂内容分析。 | limit contract、timeout、staging latency metric 验证 |
| 可靠性/恢复 | intake 是 admission gate；失败显式拒绝，不静默丢附件；Blob 和 `RequestAttachment` 由 attachment runtime 管理；清理和保留策略由后续 cleanup change 定义。 | 流程、resilience、cleanup boundary 验证 |
| 可维护性 | 单一路径集中在 attachment runtime；请求入口不拥有可信文件处理；runtime attachmentIds-only；PDF/Office 解析后续 change 独立扩展。 | 架构边界、职责归属、评审检查 |
| 可测试性 | 校验顺序、reason code、暂存边界、safe output 均可确定性验证；Markdown 只需小文件 fixtures。 | 契约、边界、流程验证 |
| 审计/可追溯性 | accepted/rejected 都记录 owner/session/request refs、attachment id、reason、size、latency 和 safe summary；`AttachmentId` 可追溯到权威 `RequestAttachment` 和 opaque `BlobRef`。 | audit、metric/log、traceability 验证 |

## 文档承载决策

- 行为契约：`openspec/specs/ts-attachment-intake/spec.md` 主承载 attachment intake 可验证行为。
- 跨模块架构：`openspec/designs/architecture/attachment-intake.md` 主承载请求入口、attachment runtime、runtime acceptance、context flow、cleanup 接入和质量属性。
- 领域模型/状态机：`openspec/designs/domain/attachment.md` 主承载 attachment input、`RequestAttachment`、`BlobRef`、summary、validation/availability status、rejection outcome 和生命周期。
- API/SPI/event/schema：`openspec/designs/contracts/attachment-intake.md` 主承载 attachment runtime intake boundary、safe error、`AttachmentId`、`RequestAttachment` 和 timeline/stream payload 语义。
- 模块职责：归档前按架构基线归入请求入口、attachment runtime 和 runtime 相关模块职责文档。
- ADR：`openspec/designs/adr/0004-controlled-attachment-intake.md` 主承载附件必须通过 attachment runtime 转换为受控 `AttachmentId` 和权威 `RequestAttachment` 的决策。
- 导航：`openspec/designs/spec-to-design-map.md` 主承载 capability 到设计和验证入口的导航。

## 风险与取舍

- [风险] 用户上传 PDF/Excel/Word 后期望首版可用 -> 明确返回 `ATTACHMENT_TYPE_UNSUPPORTED` safe error，提示当前只支持 Markdown，后续解析 change 再启用。
- [风险] 为了体验静默丢弃失败附件 -> 明确禁止，附件失败会影响请求输入完整性，必须用户可见。
- [风险] Markdown 内容过大进入上下文 -> intake 只产生 `AttachmentId` 和权威 metadata/status；上下文预算和内容消费由后续 attachment request context flow 决定。
- [风险] 暂存成功但 request acceptance 后续失败产生孤儿文件 -> 本 change 不定义 cleanup 细节，只要求 raw content 不进入 runtime；清理 port 和策略由 cleanup change 处理。
- [取舍] 不做复杂病毒扫描或外部文档解析 -> 保持首版本地 release KISS；用类型限制、大小限制、文本读取和外部解析拒绝降低风险。
- [取舍] 带附件请求使用 multipart intake path，不支持 base64 JSON 或独立预上传 token -> 保持入口和 idempotency 绑定简单，避免同一能力出现三种传输形态。
- [取舍] 首版 fail-closed，不做部分附件成功后继续提交 -> 保持用户输入完整性和实现路径唯一，避免部分 Blob/metadata 成功导致隐式降级。

## 质检方案

后续审查 attachment intake 或相邻附件 change 时，必须按请求生命周期逐阶段检查，不只看 OpenSpec strict validation：

1. HTTP/入口阶段：确认传输形态、body shape、大小计量来源、idempotency 绑定时机和可信 identity 来源唯一。
2. 坐标和幂等阶段：确认是否引入新 lifecycle 阶段；若引入，必须说明持久幂等、重复 key、冲突 key、崩溃恢复和 orphan 处理边界。
3. 归一化阶段：确认哪些字段来自服务器事实、哪些字段只是客户端提示；不得让 owner、size、status、storageRef 来自请求体。
4. 校验阶段：确认每条判断都有可操作定义、错误码、请求级语义和 fail-fast/collect-all 策略；删除首版永远不会触发的未来判断。
5. 写入阶段：确认 id 生成时机、Blob 写入、metadata/status 写入、部分成功补偿或 cleanup handoff，且不产生可进入 command 的半成功结果。
6. command/acceptance 阶段：确认 request command 和 `SessionMessage` 只携带 `attachmentIds`；runtime/context 后续校验由相邻 change 明确承载。
7. 输出和观测阶段：确认 SafeError、timeline/stream、audit、log、metric 不含 raw content、`BlobRef`、路径、secret 或未授权对象内容。
8. KISS 检查：每个机制必须能解释当前首版 Markdown intake 的必要性；未来 PDF/Office、预上传、异步解析、下载、retention、summary/ref 不得混入当前 change。

## 归档前基线提升计划

- `openspec/specs/ts-attachment-intake/spec.md`：提升 attachment trigger、preconditions、limits、accepted/rejected behavior、safe output 和 failure visibility。
- `openspec/overview.md`：提升请求附件受控接入的产品目标和安全边界。
- `openspec/designs/architecture/attachment-intake.md`：提升跨模块流程、owner boundary、attachmentIds-only request acceptance、Blob/metadata 写入、失败降级和质量属性。
- `openspec/designs/domain/attachment.md`：提升 attachment input、`RequestAttachment`、`BlobRef`、summary、validation/availability status 和 rejection outcome。
- `openspec/designs/contracts/attachment-intake.md`：提升 attachment runtime intake boundary、safe error、`AttachmentId` 和 `RequestAttachment` 调用语义。
- 请求入口相关长期职责文档：提升 attachment intake 职责。
- Attachment runtime 相关长期职责文档：提升 validation、Blob 写入、metadata/status 写入和 `AttachmentId` 输出职责。
- Runtime request acceptance 相关长期职责文档：提升 attachmentIds-only 职责。
- `openspec/designs/adr/0004-controlled-attachment-intake.md`：提升受控附件 intake 决策。
- `openspec/designs/spec-to-design-map.md`：提升 capability 导航和验证入口。

## 验证映射

| 约束 | Task | 验证入口 |
|------|------|---------|
| 带附件请求使用 multipart，JSON submit/edit 不接收 base64/raw upload handle | 1.2 | Web contract test 验证 request body shape |
| 可信 identity、owner/session refs 和 sizeBytes 只能来自服务端可信上下文和服务器实际读取 | 1.3, 3.2 | Security/entry tests 验证 scope 和 size 来源 |
| reserve submit 是 runtime-owned minimal reservation fact，持久幂等且不等同 request acceptance | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7 | Runtime contract tests 验证 anchor、canonicalization、replay、conflict、first intake outcome replay 和 no accepted side effect |
| 首版仅启用 text/markdown 类型，其他类型返回 ATTACHMENT_TYPE_UNSUPPORTED | 3.4 | `packages/agent-attachment-runtime/tests/attachment-type-validation.test.ts` |
| 单个附件大小不得超过 5 MiB，超限返回 ATTACHMENT_TOO_LARGE | 3.3 | Unit 测试验证大小限制和边界值 |
| 每个请求附件数量不得超过 3 个，超限返回 ATTACHMENT_COUNT_EXCEEDED | 3.3 | `packages/agent-attachment-runtime/tests/attachment-count-validation.test.ts` |
| 任一附件校验失败或部分写入失败时请求级 fail-closed，不输出半成功 attachmentIds | 3.6, 4.3, 4.4, 4.5, 4.6 | Flow/integration 测试验证 validation failure、partial staging failure、diagnostic context 和 orphan traceability |
| 通过 BlobStoreGateway.store 存储附件内容 | 4.1 | Integration 测试验证 blob 存储路径 |
| 通过 AttachmentStoreGateway.create 创建附件元数据 | 4.2 | `packages/agent-attachment-runtime/tests/attachment-metadata-creation.test.ts` |
| request command 和 SessionMessage 只携带 attachmentIds，不复制附件 metadata 或 BlobRef | 5.1, 5.2 | Command/session contract tests |
| edit latest 的 attachmentIds 只表示本次 edit 新接受附件，不处理历史附件关系 | 5.5 | Edit command projection tests |
| intake outcome 事件不等同 request accepted，timeline/stream 只在可见 request context 中投影 | 6.3 | Projection timing/semantics tests |
| 附件验证失败返回结构化 SafeError（错误码见 spec） | 6.4 | Contract 测试验证错误响应格式和错误码 |

## 待确认问题

无。
