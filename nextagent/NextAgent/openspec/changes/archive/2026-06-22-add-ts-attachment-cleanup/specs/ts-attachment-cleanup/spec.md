## ADDED Requirements

### Requirement: 附件 cleanup 触发与阶段边界
TS 后端 MUST 通过 `agent-attachment-runtime` 提供显式 attachment cleanup capability。cleanup 只允许由系统内可信流程显式触发，不得由终端用户直接调用，也不得由 request terminal path、session retention、artifact cleanup 或未定义的后台扫描逻辑隐式触发。

首批允许的 cleanup 触发来源 MUST 限定为：
- attachment intake 成功但 request acceptance 未发生、被拒绝或部分 staging 失败后的 orphan cleanup handoff；
- retry source revalidation、attachment request context flow 或其他权威附件可用性检查发现 metadata 仍在但 blob 已不可用时的 explicit availability cleanup。

本 change MUST NOT 定义周期性 retention job、调度器、批量后台枚举、session aging 联动、admin bulk cleanup 或 operator-facing diagnostics/maintenance command。cleanup 可以同步执行，也可以由主流程在返回结果后异步 handoff；无论采用哪种方式，cleanup 都 MUST 独立于 request terminal commit，不得改变 runtime lifecycle、timeline 终态或 stream terminal 语义。

#### Scenario: admission gap orphan 触发显式 cleanup
- **WHEN** attachment intake 已经写入 `RequestAttachment` 或 blob，但 submit/edit acceptance 未成功
- **THEN** 系统 MUST 允许调用 attachment cleanup capability 处理该 orphan candidate
- **AND** cleanup MUST 使用可信 owner scope、`agentId` 和权威 attachment refs
- **AND** cleanup MUST NOT 重新进入 request acceptance、scheduler 或 terminal commit 路径

#### Scenario: blob 缺失触发 explicit availability cleanup
- **WHEN** retry source revalidation 或 attachment context flow 查询到 `RequestAttachment` 仍存在，但 `BlobStoreGateway` 确认 blob 已不可用
- **THEN** 系统 MUST 允许调用 attachment cleanup capability 将该附件显式标记为 unavailable
- **AND** cleanup outcome MUST 可被后续 retry/context 流程消费
- **AND** cleanup MUST NOT 静默把该附件继续视为可用

#### Scenario: cleanup 不由后台调度器自动触发
- **WHEN** 系统仅存在 attachment metadata 或 blob 但没有显式 cleanup 调用
- **THEN** 本 change MUST NOT 要求后台 retention job、Cron、定时器或自动扫描立即处理它
- **AND** 系统 MUST NOT 假定 request terminal path 会同步删除附件

### Requirement: cleanup 输入与可信前置条件
Attachment cleanup MUST 只接受可信 cleanup request。cleanup request MUST 包含 trusted owner scope（`tenantId`、`subjectId`）、`agentId`、cleanup reason code、至少一组可信 attachment refs 或可信 `sessionId`/`requestId`/`runId` 坐标、调用时的安全上下文，以及必要的 `AttachmentStoreGateway`、`BlobStoreGateway`、audit writer、structured log/metric sink 和 error normalizer。

cleanup 实现 MUST 通过权威 `RequestAttachment` 事实驱动，不得信任客户端、模型输出、capability 参数或日志重放中自报的 `BlobRef`、本地路径、remote locator、validation status、availability status 或 owner 字段。`BlobRef` 只能从已加载的权威 `RequestAttachment.storageRef` 获得，并且只可交给 `BlobStoreGateway` 使用。

cleanup 在删除 blob 或更新状态前 MUST 完成 owner scope、agent scope、session/request/run 坐标和 cleanup reason 的校验。若调用方缺少可信 attachment refs 或给出的 refs 与权威事实不一致，cleanup MUST 显式失败。

#### Scenario: cleanup request 使用权威附件事实
- **WHEN** 调用方请求 cleanup 某个附件
- **THEN** 系统 MUST 先通过 trusted owner scope 和 `agentId` 加载权威 `RequestAttachment`
- **AND** 系统 MUST 只从该权威事实读取 `storageRef`
- **AND** 系统 MUST NOT 接受调用方直接传入的路径、URL 或 `BlobRef` 作为删除依据

#### Scenario: 跨 owner 或跨 agent cleanup 被拒绝
- **WHEN** cleanup request 中的 trusted owner scope 或 `agentId` 与权威 `RequestAttachment` 不匹配
- **THEN** 系统 MUST 返回 safe authorization/not-found outcome
- **AND** 系统 MUST NOT 更新 metadata
- **AND** 系统 MUST NOT 删除任何 blob

#### Scenario: 缺少可信定位信息时 cleanup 失败
- **WHEN** cleanup request 既没有可信 attachment refs，也没有足以唯一定位附件的 trusted session/request/run 坐标
- **THEN** 系统 MUST 返回 validation safe error
- **AND** 系统 MUST NOT 进入模糊查询、批量扫描或猜测性删除

### Requirement: cleanup 核心判断与执行顺序
Attachment cleanup MUST 按固定顺序执行，不得把关键判断留到实现阶段自由决定：

1. 校验 cleanup request 的 trusted owner scope、`agentId`、cleanup reason 和定位信息。
2. 加载权威 `RequestAttachment`；若不存在，返回 explicit not-found / already-clean outcome。
3. 判定该附件是否仍被已 acceptance 请求的 immutable root message 或等价单一权威 message fact 上持久化的 `SessionMessage.attachmentIds` 引用；对于 request acceptance 之前的 orphan candidate，系统 MUST 只依据 trusted handoff 坐标和已写入的 `RequestAttachment` 事实判断其是否属于 pre-acceptance orphan，而 MUST NOT 额外引入未定义的“主流程保留”引用来源。
4. 若仍被引用，cleanup MUST 保留 metadata；仅当 cleanup reason 是 “blob unavailable / orphan staging / explicit detach after failed admission” 且需要收敛可用性时，系统 MAY 删除 blob 并把 `availabilityStatus` 更新为 `UNAVAILABLE`。
5. 若不再被引用，cleanup MAY 删除 blob；成功后 MUST 将 `availabilityStatus` 更新为 `UNAVAILABLE`，并保留 `RequestAttachment` metadata 与原始 `validationStatus`。
6. 若 blob 已不存在，cleanup MUST 将该结果视为显式可观察事实，而不是静默成功；系统 MUST 仍更新 metadata 为 `UNAVAILABLE`，并记录 safe reason。
7. metadata 状态更新成功后，cleanup 才视为完成；若 blob 删除成功但 metadata 更新失败，cleanup MUST 返回 explicit failure，并留下可追踪诊断。

cleanup MUST NOT 物理删除仍被引用的 `RequestAttachment` metadata，也 MUST NOT 把 metadata 删除作为首版正常路径。cleanup outcome MUST 明确区分 “metadata retained + blob removed”、“metadata retained + blob already missing”、“already unavailable / already cleaned” 和 “cleanup failed”。

#### Scenario: 被 message 引用的附件只允许收敛为 unavailable
- **WHEN** `RequestAttachment` 仍被任一可见或历史 `SessionMessage.attachmentIds` 引用
- **THEN** cleanup MUST NOT 删除该 `RequestAttachment` metadata
- **AND** cleanup MAY 删除 blob 并把 `availabilityStatus` 更新为 `UNAVAILABLE`
- **AND** cleanup outcome MUST 保留该附件仍有历史引用的诊断语义

#### Scenario: orphan 附件删除 blob 并保留 metadata
- **WHEN** `RequestAttachment` 不再被任何 `SessionMessage.attachmentIds` 引用，且 cleanup reason 指向 admission gap orphan 或 partial staging orphan
- **THEN** cleanup MAY 删除对应 blob
- **AND** 系统 MUST 将 `availabilityStatus` 更新为 `UNAVAILABLE`
- **AND** 系统 MUST 保留 metadata 供后续审计和 orphan 诊断使用

#### Scenario: blob 已丢失时 cleanup 不静默成功
- **WHEN** cleanup 加载到权威 `RequestAttachment`，但 `BlobStoreGateway` 报告 blob 不存在
- **THEN** cleanup MUST 将该附件状态显式收敛为 `UNAVAILABLE`
- **AND** cleanup outcome MUST 标明 blob already missing
- **AND** 系统 MUST NOT 把该情况当作无事发生

#### Scenario: blob 删除成功但 metadata 更新失败
- **WHEN** `BlobStoreGateway.deleteBlob` 成功，但 `AttachmentStoreGateway.updateAttachmentStatus` 失败
- **THEN** cleanup MUST 返回 explicit failure outcome
- **AND** 系统 MUST 记录 safe diagnostic correlation fields
- **AND** 系统 MUST NOT 把 cleanup 标记为 completed

### Requirement: cleanup 状态与产物契约
Attachment cleanup MUST 产生稳定的 cleanup domain outcome 与 cleanup evidence。首版至少必须产生以下可消费产物：

- cleanup outcome：表示 `COMPLETED`、`ALREADY_UNAVAILABLE`、`NOT_FOUND`、`REJECTED` 或 `FAILED` 等稳定结果，并包含 safe reason code。
- updated attachment authority：成功 cleanup 后返回更新后的权威 `RequestAttachment`，其 `availabilityStatus` MUST 为 `UNAVAILABLE`；`validationStatus` MUST 保持原有事实，不得被 cleanup 伪造成 `REJECTED`。
- cleanup evidence：包含 owner/session/request/run/attachment refs、cleanup reason、是否仍被引用、blob delete/check 结果和时间戳的安全证据，供 audit、log、metric 和后续诊断消费。

cleanup evidence 的生命周期 MUST 覆盖至少一次 cleanup 调用和后续诊断期。evidence 可以进入 audit/log/metric，但 MUST NOT 向用户可见输出暴露 raw attachment content、`BlobRef`、storage path、URL、provider error、stack trace 或未授权对象内容。

cleanup 本身 MUST NOT 生成新的 `SessionMessage`、checkpoint、pending input、memory record、learning event 或用户可见 artifact ref。后续流程若要提示附件已不可用，必须消费保留的 `RequestAttachment` 和 cleanup evidence，而不是依赖临时进程内状态。

#### Scenario: cleanup 成功返回 updated attachment authority
- **WHEN** cleanup 完成且 metadata 状态更新成功
- **THEN** cleanup result MUST 返回更新后的权威 `RequestAttachment`
- **AND** 该权威事实的 `availabilityStatus` MUST 为 `UNAVAILABLE`
- **AND** `validationStatus` MUST 保持 cleanup 之前的值

#### Scenario: cleanup 不产生新的 request 事实
- **WHEN** cleanup 被执行
- **THEN** 系统 MUST NOT 新建 `SessionMessage`、`RequestRun`、checkpoint、pending input、memory record 或 learning event
- **AND** cleanup evidence MUST 只作为 audit/diagnostic/observability 事实存在

### Requirement: cleanup 流程接入与后续消费
Attachment cleanup MUST 接入附件生命周期，而不是主导 request lifecycle。其上游可以是：
- attachment intake 在 admission gap 或 partial staging failure 处产生的 orphan cleanup handoff；
- retry source attachment revalidation；
- attachment request context flow 的 availability revalidation。

其下游消费方 MUST 包括：
- retry source validation：依据 `availabilityStatus=UNAVAILABLE` 拒绝继续复用 source attachment；
- attachment request context flow：在 context build 时把 unavailable attachment 视为显式失败或降级输入；
- observability / audit：消费 cleanup evidence；
- 后续 release 中可能引入的受控 attachment diagnostics。

cleanup 本身 MUST NOT 重新定义 retry policy、context selection policy、session retention policy 或 request acceptance policy。cleanup 只收敛 attachment lifecycle 事实，后续主流程通过权威 `RequestAttachment` 读取结果。

#### Scenario: retry source validation 消费 cleanup 结果
- **WHEN** retry source 请求引用的 attachment 已被 cleanup 收敛为 `UNAVAILABLE`
- **THEN** retry source validation MUST 把该附件视为不可用
- **AND** 系统 MUST 显式拒绝或降级 retry，而不是继续把它当作可用 source attachment

#### Scenario: context flow 消费 cleanup 结果
- **WHEN** attachment request context flow 读取到已 cleanup 的附件
- **THEN** 它 MUST 依据 `availabilityStatus=UNAVAILABLE` 执行既有 failure/degradation 规则
- **AND** 它 MUST NOT 依赖进程内缓存绕过 cleanup 结果

### Requirement: cleanup 失败与降级可见性
Attachment cleanup MUST 对 timeout、gateway unavailable、owner-scope mismatch、metadata update failure、blob delete failure 和 dependency missing 返回显式 outcome。系统 MUST NOT 静默吞错、静默忽略 cleanup 失败，也 MUST NOT 因 cleanup 失败反向影响已完成的 request terminal result。

若 cleanup 被异步 handoff，主流程 MAY 先返回原本的 submit/edit/retry/context 结果，但 cleanup failure MUST 进入 safe audit/log/metric，并保留后续可诊断 evidence。若 cleanup 是同步调用且其结果本身属于当前主流程的一部分，调用方 MUST 看到明确 cleanup failure outcome。

#### Scenario: cleanup timeout
- **WHEN** cleanup 调用在 blob check/delete 或 metadata update 阶段超时
- **THEN** 系统 MUST 返回 timeout failure outcome
- **AND** 系统 MUST 记录 safe reason code
- **AND** cleanup failure MUST NOT 修改已有 terminal commit 结果

#### Scenario: gateway 不可用
- **WHEN** `BlobStoreGateway` 或 `AttachmentStoreGateway` 不可用
- **THEN** 系统 MUST 返回 unavailable failure outcome
- **AND** 系统 MUST NOT 回退为直接访问本地路径或绕过 gateway 的删除

#### Scenario: cleanup 失败不改变 terminal 语义
- **WHEN** cleanup 发生在 request acceptance 之后的独立 availability 收敛路径上且执行失败
- **THEN** 系统 MUST 保持原有 request timeline 和 terminal result 不变
- **AND** cleanup failure MUST 仅通过 cleanup outcome 与 observability/audit 暴露

### Requirement: cleanup 审计、日志与指标脱敏
Attachment cleanup MUST 产生安全、可追溯的 audit/log/metric。至少必须记录 cleanup reason、owner/session/request/run/attachment refs、是否仍被引用、blob check/delete 结果、metadata update 结果、latency 和稳定 reason code。所有输出 MUST 使用 safe summary 和 bounded fields。

cleanup audit/log/metric MUST NOT 包含 raw attachment content、`BlobRef`、storage path、provider/raw storage error、secret、credential、stack trace 或未脱敏路径。cleanup 不需要为用户直接投影 timeline/stream 事件；如后续产品需要用户可见提示，必须由消费 cleanup 结果的 request flow 产生自己的安全 notice。

#### Scenario: cleanup audit 记录安全摘要
- **WHEN** cleanup 完成、被拒绝或失败
- **THEN** 系统 MUST 记录 `attachment.cleanup.completed`、`attachment.cleanup.rejected` 或 `attachment.cleanup.failed` 等 safe audit event
- **AND** audit 只包含业务 refs、reason code、引用保护结果和安全摘要
- **AND** audit MUST NOT 包含 raw attachment content、`BlobRef` 或路径

#### Scenario: cleanup 不直接产出用户可见流事件
- **WHEN** cleanup 被执行
- **THEN** 本 change MUST NOT 要求直接产生 `ATTACHMENT_*` timeline/stream 事件
- **AND** 用户可见提示若存在，必须由后续消费 cleanup 结果的主流程显式投影
