# request-attachments

## Purpose
定义已接受附件在 acceptance 之后如何参与 request context，包括 authority 校验、分类、最小安全上下文和显式降级。
## Requirements
### Requirement: 请求上下文附件流程由 runtime 拥有
融合附件信息的 request context MUST 由 runtime 拥有。submit request、retry latest 和 edit latest MUST 都在 request 进入执行前重新校验附件 authority。Runtime MUST 使用当前 `tenantId`、`subjectId` 和可信 `agentId`，对照权威 `RequestAttachment` 事实解析每个 `attachmentId`。

#### Scenario: 已接受 request 在执行前重新校验附件
- **WHEN** runtime 接受一个带附件的 submit、retry latest 或 edit latest request
- **THEN** runtime MUST 重新读取权威 `RequestAttachment` 事实
- **AND** runtime MUST 拒绝跨 owner、跨 agent、不可用或非 accepted 的附件

### Requirement: 已接受 request 持久化 durable 最终附件集合
acceptance 成功后，runtime/session owner MUST 把该 request 的最终附件引用集合持久化进不可变 root user message 或等价的单一权威 message 事实。该 durable 集合 MUST 只包含 `attachmentIds`。retry latest MUST 只从该已持久化集合读取附件引用。

#### Scenario: Retry 只读取 durable 附件集合
- **WHEN** retry latest 从一个已 terminal commit 的 request 创建
- **THEN** runtime MUST 只从不可变 root message 或等价权威事实读取附件引用
- **AND** runtime MUST NOT 从临时 upload 状态或 cleanup 诊断信息重建附件集合

### Requirement: Context Engine 以固定规则分类附件
Context Engine MUST 按固定规则顺序把每个附件分类为 `latest-request-critical`、`latest-request-optional`、`historical` 或 `excluded`。分类 MUST 基于 request 事实、owner scope、agent scope、可用性和受控投影。它 MUST NOT 把 client payload、message metadata 副本、模型输出或 capability 参数当作文件名、类型、大小、状态或存储引用的 authority。

一个附件只有在以下全部条件成立时才是 `latest-request-critical`：

- 它直接绑定到当前 request；
- 它仍保持 owner-scoped、agent-scoped、可用，并被批准用于受控 context 消费；
- 当前 assembly 尚未为同一 `attachmentId` 保留等价的受控摘录、Markdown 投影或已批准 ref。

一个仍为 `AVAILABLE` 的 `historical` 附件（绑定到先前 request）MUST 被投影为可读：runtime 物化它，context engine 暴露其 `modelPath`。一个不是 `AVAILABLE` 的 `historical` 附件 MUST 显式降级为 metadata-only 并带有 `ATTACHMENT_HISTORICAL_DEGRADED` evidence。`historical` 判定表达的是 request 绑定关系，而非可读性；可读性由 `availabilityStatus` 和是否存在已物化的 `modelPath` 决定。

#### Scenario: 等价保留投影阻止升级为 critical
- **WHEN** 当前 assembly 已为同一 `attachmentId` 包含等价的受控投影
- **THEN** 该附件 MUST NOT 被分类为 `latest-request-critical`

#### Scenario: 可用的 historical 附件可读而不降级
- **WHEN** 一个先前轮次的附件仍为 `AVAILABLE`
- **THEN** 它 MUST 被分类为 `historical`
- **AND** 它 MUST 获得一个 `modelPath`
- **AND** 它 MUST NOT 产生降级 evidence

### Requirement: 最小安全当前请求上下文显式失败
如果因为某个 `latest-request-critical` 附件不可用、不可读、已删除、已过期、跨 owner、跨 agent、超出 budget 或缺少必需的受控投影而无法装配最小安全当前请求上下文，系统 MUST 在模型调用前返回显式 insufficient-context 或 safe failure outcome。非 critical 附件 MAY 显式降级，但系统 MUST NOT 静默省略 critical 附件。

#### Scenario: 缺失 critical 附件会阻止模型调用
- **WHEN** 一个 current-request-critical 附件不再可读或不再可用
- **THEN** context assembly MUST 显式失败
- **AND** runtime MUST NOT 像对待纯文本 request 一样调用模型

#### Scenario: 非 critical 附件显式降级
- **WHEN** 一个当前 request 附件被分类为 `latest-request-optional` 且完整投影会超出 context budget
- **THEN** 系统 MAY 用一个已保留的受控替代物、metadata-only 投影或省略来替换它
- **AND** 降级原因 MUST 被记录为机器可读 evidence

### Requirement: 附件上下文 artifact 保持安全且可追溯
附件上下文 MAY 产生安全 descriptor、受控投影、附件上下文决策和降级 evidence。这些 artifact MUST 可追溯到来源 `attachmentId` 和当前 request 决策。对已物化的可用附件，形如 `temp/attachments/{attachmentId}/{fileName}` 的逻辑 workspace 路径 MAY 作为 `AttachmentContextEvidence.modelPath` 对模型可见。artifact MUST NOT 通过 safe error、用户可见 stream payload、audit detail 或 structured logs 暴露原始 storage 句柄、`BlobRef`、`storageRef`、绝对文件系统路径、provider SDK 句柄或原始 payload。

#### Scenario: 安全上下文 artifact 可追溯
- **WHEN** Context Engine 选择一个附件用于 context 消费
- **THEN** 产出的 artifact MUST 可追溯到来源 `attachmentId`
- **AND** 产出的 artifact MUST NOT 包含 blob ref、`storageRef` 或绝对存储坐标
- **AND** 任何模型可见路径 MUST 是 `temp/attachments/` 之下的逻辑 workspace 路径，而不是原始存储路径或绝对路径

### Requirement: Cleanup 和 retry 消费 authority 事实而非 upload 状态
Request context 流程 MUST 消费权威 `RequestAttachment` 事实和 durable 最终附件集合。它 MUST NOT 把 upload 条目临时状态、command cache 或后续 cleanup 诊断信息当作事实来源。cleanup 和 retry 可以观察 `availabilityStatus=UNAVAILABLE` 以显式失败或降级，但它们不拥有 context policy。

#### Scenario: Cleanup 结果作为 authority 事实被消费
- **WHEN** cleanup 把一个附件标记为不可用
- **THEN** retry 和 context 流程 MUST 读取 `availabilityStatus=UNAVAILABLE`
- **AND** 它们 MUST 基于该事实显式失败或降级

### Requirement: historical 附件跨轮次保持可读
Runtime MUST 在 tool loop 开始前，把当前 session 中每个 `ACCEPTED`+`AVAILABLE` 附件——而不只是当前 request 的附件——物化到 run-scoped 的 `temp/attachments/{attachmentId}/{fileName}` 目录，使后续轮次可以读取先前轮次上传的文件。context engine MUST 为每个可用附件暴露逻辑 workspace `modelPath`（`temp/attachments/{attachmentId}/{fileName}`），无论它绑定到当前 request 还是先前轮次。`availabilityStatus` 不是 `AVAILABLE` 的 historical 附件 MUST NOT 获得 `modelPath` 且 MUST 显式降级。

runtime MUST 通过以 `tenantId`、`subjectId`、`agentId` 和 `sessionId` 为 scope 的 `AttachmentStoreGateway.listAttachmentsBySession` 解析 session 附件集合；它 MUST NOT 从 client payload、upload 临时状态或模型输出重建 historical 集合。

#### Scenario: 后续轮次读取先前轮次附件
- **WHEN** 一个 session 拥有来自先前 request 的一个 AVAILABLE 附件
- **AND** 用户发送后续 request 而未重新附加该文件
- **THEN** runtime MUST 把该先前轮次附件物化到当前 run 的 `temp/attachments/{attachmentId}/{fileName}`
- **AND** 渲染出的附件 disclosure MUST 为该附件包含一个 `modelPath`
- **AND** 模型 MUST 能够通过 Read 工具使用该 `modelPath` 读取该文件

#### Scenario: 不可用的 historical 附件仍会降级
- **WHEN** 一个 session 拥有一个 `availabilityStatus` 不是 `AVAILABLE` 的 historical 附件
- **THEN** context engine MUST NOT 为它暴露 `modelPath`
- **AND** context engine MUST 发出带有 `readable: false` 的 `ATTACHMENT_HISTORICAL_DEGRADED` 降级 evidence

#### Scenario: 可用的 historical 附件不降级
- **WHEN** 一个 session 拥有一个 `availabilityStatus` 为 `AVAILABLE` 的 historical 附件
- **THEN** context engine MUST NOT 为它发出 `ATTACHMENT_HISTORICAL_DEGRADED` 降级 evidence
- **AND** 附件 disclosure MUST 提供其 `modelPath` 供读取

### Requirement: Context Engine 在所有模式下跳过附件内容读取
context engine MUST NOT 在任何存储模式下为附件内容调用 `blobStore.loadBlob`。`attachmentContentBlocks` MUST 为空。它 MUST 只渲染安全的文件 metadata disclosure；模型和模型可见工具都不得接收 `storageRef` 作为路径。

#### Scenario: Remote 模式跳过 blob 内容读取
- **WHEN** 部署模式为 REMOTE
- **AND** 当前 request 拥有已接受附件
- **THEN** context engine MUST NOT 调用 `blobStore.loadBlob`
- **AND** `attachmentContentBlocks` MUST 为空
- **AND** 附件 evidence MUST 仍从 `attachmentStore` 收集

#### Scenario: Local 模式同样跳过 blob 内容读取
- **WHEN** 部署模式为 LOCAL
- **AND** 当前 request 拥有已接受附件
- **THEN** context engine MUST NOT 通过 `blobStore` 读取附件内容
- **AND** `attachmentContentBlocks` MUST 为空
- **AND** 模型可见 prompt 文本 MUST NOT 包含存储坐标或执行期附件路径

### Requirement: AttachmentContextEvidence 暴露安全的文件 metadata
`AttachmentContextEvidence` MUST 包含 `fileName`、`mediaType` 和 `sizeBytes` 字段。这些字段 MUST 对模型可见 disclosure 是安全的。它们 MUST NOT 包含 `storageRef`、`BlobRef`、HOFS 路径或任何原始存储坐标。

#### Scenario: Remote 模式下模型可见附件 disclosure 包含文件 metadata
- **WHEN** 部署模式为 REMOTE
- **AND** 当前 request 拥有已接受附件
- **THEN** 渲染出的附件 disclosure MUST 为每个附件包含文件名、媒体类型和大小
- **AND** 该 disclosure MUST NOT 包含 HOFS 路径或存储引用

### Requirement: Runtime 为工具执行物化附件
在 tool loop 开始前，runtime MUST 解析当前 request 已持久化的附件 record，并把每个正式 blob 物化到 run-scoped、可信的执行临时目录。物化 MUST 使用流式 `BlobStoreGateway.materializeBlob` 操作，MUST NOT 通过 `loadBlob(): Uint8Array` 加载完整附件。产生的执行路径（而不是 `storageRef`）MUST 对工具执行同步可用。它们 MUST NOT 出现在模型输入、工具调用参数、stream payload 或 safe error 中。

#### Scenario: Skill 工具读取物化后的附件路径
- **WHEN** runtime 为一个带已接受附件的 request 启动 tool loop
- **THEN** 每个附件 MUST 被物化到 execution resolver 的 run-scoped `temp/attachments` 目录之下
- **AND** `ToolExecutionContext.attachmentPaths` MUST 只包含物化后的可读路径
- **AND** skill 工具 MUST 能够同步读取这些路径
- **AND** `storageRef` 和物化路径都不得对模型可见

#### Scenario: attachmentRefs 不对模型可见
- **WHEN** context engine 渲染模型输入
- **THEN** `attachmentRefs` MUST NOT 出现在 system prompt、user message 或任何模型可见部分
- **AND** `storageRef` 值 MUST NOT 出现在 stream event 或 safe error 中

### Requirement: 会话历史和分享 endpoint 包含附件 metadata
完整会话历史 endpoint（`GET /api/v1/sessions/:sessionId/conversation`）和分享会话 endpoint（`GET /api/v1/shares/:shareId/conversation`）MUST 在每条带有附件的 user request message 中包含附件安全摘要（`fileName`、`mediaType`、`sizeBytes`）。该摘要 MUST NOT 包含 `storageRef` 或任何存储坐标。会话预览 endpoint（`GET /api/v1/sessions/:sessionId/conversation/preview`）MUST NOT 包含附件 metadata。

#### Scenario: 完整会话历史返回附件列表
- **WHEN** 用户打开一个历史会话
- **THEN** 会话 API 响应 MUST 为每条带有附件的 message 包含附件 metadata
- **AND** 该 metadata MUST 包含 `fileName`、`mediaType` 和 `sizeBytes`
- **AND** 该 metadata MUST NOT 包含 `storageRef`

#### Scenario: 分享会话返回附件列表
- **WHEN** 用户打开一个被分享的会话
- **THEN** 分享会话 API 响应 MUST 包含附件 metadata
- **AND** 该 metadata MUST NOT 包含 `storageRef`

#### Scenario: 会话预览不返回附件 metadata
- **WHEN** 会话预览 endpoint 被调用
- **THEN** 响应 MUST NOT 包含附件 metadata
- **AND** 响应 MUST 只包含轻量的 preview 字段

### Requirement: 物化路径传递给产品 Skill API
runtime MUST 把 run-scoped 物化附件路径数组注入 `ToolExecutionContext.attachmentPaths`，并把同一 JSON 数组注入 sandbox 的 `FILE_PATHS`。该数组 MUST 同样用于本地和远程存储。不存在附件时，两个字段都不得存在。产品 Skill API MUST 同步读取这些由系统组装的路径，而不解析模型 tool-call 参数。

#### Scenario: 多个文件以物化路径传递
- **WHEN** 一个 request 拥有 2 个已接受附件
- **THEN** `ToolExecutionContext.attachmentPaths` MUST 包含位于 run-scoped 临时附件目录之下的两条不同路径
- **AND** sandbox 环境 `FILE_PATHS` MUST 把相同路径编码为 JSON 数组

#### Scenario: 单个文件以包含一个元素的 attachmentPaths 数组传递
- **WHEN** 一个 request 拥有 1 个附件
- **THEN** `ToolExecutionContext.attachmentPaths` MUST 包含一条物化路径
- **AND** 该值 MUST 是数组而不是字符串

#### Scenario: 无附件时省略 attachmentPaths 和 FILE_PATHS
- **WHEN** 一个 request 没有附件
- **THEN** `ToolExecutionContext.attachmentPaths` MUST NOT 存在
- **AND** sandbox 的 `FILE_PATHS` 环境变量 MUST NOT 被设置

#### Scenario: attachmentPaths 由系统组装而非来自模型参数
- **WHEN** 模型调用一个 Skill 工具
- **THEN** 这些路径 MUST 由 runtime 在 gateway 物化后组装
- **AND** 模型的 tool call 参数 MUST NOT 包含附件路径

