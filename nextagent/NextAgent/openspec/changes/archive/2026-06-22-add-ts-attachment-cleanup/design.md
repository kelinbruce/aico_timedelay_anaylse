## 背景和现状（Context）

当前仓库已经冻结了附件生命周期的前两段边界：

- `add-ts-attachment-intake` 负责把不可信上传输入转换成受控 `AttachmentId`、`RequestAttachment` 和 opaque `BlobRef`，并明确 intake 失败、acceptance 缺口和 partial staging 会留下 orphan candidate，具体 cleanup 由本 change 承载。
- `add-ts-attachment-request-context-flow` 负责 request acceptance 之后附件如何进入 context，并要求附件不可用时显式失败或降级。
- `agent-attachment-runtime` 在稳定模块设计里已经被声明为 attachment validation、availability check 和 cleanup policy skeleton 的 owner。
- `agent-contracts/gateway` 当前已经有 `AttachmentStoreGateway.saveAttachment/loadAttachment/listAttachmentsByRequestId/updateAttachmentStatus` 与 `BlobStoreGateway.storeBlob/loadBlob/blobExists/deleteBlob`，但还没有稳定的 cleanup domain contract。

这说明实现和契约都已经具备 cleanup 的最小骨架：metadata 有 owner-scoped 权威记录，blob 有 opaque delete/check 入口，retry source validator 已经把 `availabilityStatus=AVAILABLE` 当作继续消费的前置条件。缺口在于 cleanup 仍没有统一触发规则、状态语义和 audit 边界。

相关方包括：
- `agent-attachment-runtime`：cleanup owner。
- `agent-runtime` / request entry：在 admission gap、partial staging failure 和显式 handoff 时触发 cleanup。
- `agent-context-engine` / retry source validation：消费 cleanup 结果，不拥有 cleanup policy。
- `agent-platform-gateway-local` / future remote gateway：执行 owner-scoped metadata update 和 blob delete/check。
- `agent-observability` / audit sink：记录 cleanup evidence。

当前实现与目标之间的明显 gap：
- 只有 retry source validator，尚无通用 cleanup port。
- gateway contract 只有 status update，没有 cleanup outcome 或 cleanup reason。
- local scheduled maintenance gateway 已存在，但本 change 的 one-pager 明确首批不引入 attachment cleanup scheduler；实现若试图复用 scheduler 作为默认触发路径，会与范围冲突。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 冻结 attachment cleanup 的唯一目标实现路径：`agent-attachment-runtime` 提供显式 cleanup port，由系统内可信流程调用。
- 明确 cleanup 触发点、输入、判断顺序、metadata/blob 处理规则和 cleanup outcome。
- 明确 “metadata 保留、blob 可删、availability 收敛为 `UNAVAILABLE`” 的首版策略。
- 明确 cleanup 与 runtime terminal、context flow、retry source revalidation 和 observability 的接入边界。
- 提供可验证的 owner-scope、安全、可靠性和审计契约。

**非目标：**
- 不定义 attachment retention period、后台 job、Cron、timer loop 或 bulk scanner。
- 不定义 session retention、artifact cleanup、memory cleanup 或 admin bulk cleanup。
- 不定义 operator-facing diagnostics/maintenance command 或 attachment 管理面。
- 不定义 attachment download / preview API。
- 不定义 PDF/Office 解析、重新摘要、重新投影或再次入上下文的产品策略。
- 不物理删除 `RequestAttachment` metadata 作为首版主路径。

## 设计决策（Decisions）

### 1. 选定唯一实现路径：显式 cleanup port，不引入自动调度

本 change 选定的唯一实现路径是：

1. 在 `agent-attachment-runtime` 定义 attachment cleanup port/request/result。
2. cleanup 只由系统内显式调用触发。
3. cleanup 调用使用 trusted owner scope、`agentId` 和权威 `RequestAttachment` 事实驱动。
4. cleanup 通过 `AttachmentStoreGateway` 更新 metadata，通过 `BlobStoreGateway` 检查/删除 blob。
5. cleanup 结果通过 cleanup outcome + cleanup evidence 暴露给上游调用方和 observability。

放弃的方案：
- 放弃“request terminal 自动删除附件”。这会让 runtime lifecycle 拥有附件 cleanup policy，违背架构边界。
- 放弃“先上 scheduler 再定义显式 port”。one-pager 已明确 scheduler 不在本 change 范围内，且会把 retention policy 与 orphan cleanup 混在一起。
- 放弃“物理删除 metadata”。历史消息、审计和后续 context diagnostics 都需要保留 `RequestAttachment` 事实。
- 放弃“gateway-local 自己扫描 orphan attachments”。gateway adapter 只负责 owner-scoped persistence 和 blob operations，不拥有 cleanup candidate 选择。
- 放弃“在本 change 内暴露 operator-facing cleanup command”。这会把附件生命周期收敛能力扩展成管理面能力，超出本 change 范围。

### 2. cleanup 只收敛 attachment lifecycle，不改 request lifecycle

cleanup 是附件生命周期事实，不是 request lifecycle 事实。它不创建新的 `RequestRun`、timeline terminal event、session message 或 pending input，也不改变已有 terminal commit。

因此调用关系固定为：
- 上游主流程发现 orphan / unavailable candidate。
- 上游显式调用 cleanup port。
- cleanup port 独立执行 metadata/blob 收敛。
- 下游主流程后续重新读取 `RequestAttachment.availabilityStatus` 决定失败或降级。

这保证：
- runtime 仍然拥有 request lifecycle；
- context-engine 仍然只消费事实，不执行删除；
- gateway adapter 仍然只做 persistence/blob 适配。

### 3. metadata 永久保留，blob 按条件删除

首版策略固定为：
- `RequestAttachment` metadata 是权威业务事实，正常 cleanup 不删除。
- cleanup 允许删除 blob，并在 metadata 上将 `availabilityStatus` 收敛为 `UNAVAILABLE`。
- `validationStatus` 保持原事实，不因 cleanup 变成 `REJECTED`。cleanup 不是 retroactive validation failure。

理由：
- 历史 `SessionMessage.attachmentIds`、retry source validation、context failure/degradation 和审计都需要 attachment identity 持续存在。
- `BlobStoreGateway` 在稳定设计里只负责 opaque bytes lifecycle，不表达业务状态；availability 必须体现在 metadata。

### 4. 引用保护优先于物理删除

cleanup 的第一业务判断不是“能不能删 blob”，而是“该附件 metadata 是否仍被已冻结的权威附件引用事实引用”。

选定规则：
- 对 request acceptance 之后的附件，唯一引用保护来源是 immutable root message 或等价单一权威 message fact 上持久化的 final attachment set，也就是 `SessionMessage.attachmentIds`。
- 对 request acceptance 之前的 orphan candidate，不存在第二套“主流程保留”引用来源；cleanup 只依据 trusted handoff 坐标和已写入的 `RequestAttachment` 事实判断它是否属于 pre-acceptance orphan。
- 若仍被任一持久化 `SessionMessage.attachmentIds` 引用，则 metadata 必须保留。
- 对被引用附件，cleanup 允许把 blob 删除并把 `availabilityStatus` 改为 `UNAVAILABLE`。
- 对未被引用的 orphan candidate，cleanup 也保留 metadata，但允许删除 blob，并将状态收敛为 `UNAVAILABLE`。

放弃的方案：
- 放弃“引用中附件不能删 blob”。这样会让 orphan cleanup 和 unavailable 收敛无法落地。
- 放弃“引用中附件删 metadata 只留 audit”。这会破坏现有 `AttachmentId -> RequestAttachment` 的权威解析链。

### 5. cleanup request 只接受可信定位信息，不接受 BlobRef/path 输入

cleanup request 的最小可信输入必须来自：
- trusted owner scope：`tenantId`、`subjectId`
- trusted `agentId`
- attachment refs 或 trusted `sessionId`/`requestId`/`runId`
- cleanup reason

cleanup request 不接受：
- raw `BlobRef`
- local path / remote URL
- 客户端自报 availability / validation status
- 模型或 capability 生成的附件定位信息

理由：
- `BlobRef` 是 opaque storage ref，只能从权威 `RequestAttachment.storageRef` 获得。
- 允许直接传 path/locator 会把 gateway blob abstraction 打穿。

### 6. cleanup outcome 需要稳定、可追踪、可幂等理解

cleanup port 的 outward contract 需要稳定表达结果，而不是只返回布尔值。首版 outcome 至少区分：
- `COMPLETED`
- `ALREADY_UNAVAILABLE`
- `NOT_FOUND`
- `REJECTED`
- `FAILED`

其中：
- `COMPLETED`：metadata 已更新为 `UNAVAILABLE`，blob 已删或已确认缺失。
- `ALREADY_UNAVAILABLE`：metadata 本就已是 `UNAVAILABLE`，且无需再次修改。
- `NOT_FOUND`：给定 owner/agent/scope 下没有权威附件事实。
- `REJECTED`：前置条件不满足，如 scope mismatch、缺少可信定位信息、禁止的 cleanup reason。
- `FAILED`：gateway timeout/unavailable、blob delete success but metadata update failed 等执行失败。

这样上游流程和测试才能稳定断言 cleanup 结果，而不是通过日志猜测。

### 7. cleanup evidence 是唯一后续诊断载体

cleanup 必须产生 cleanup evidence，最少包含：
- owner/session/request/run/attachment refs
- cleanup reason
- whether referenced
- blob existed / delete attempted / delete result
- metadata update result
- occurredAt / latency
- safe reason code

cleanup evidence 进入 audit/log/metric，但不进入用户直接可见 payload。后续 request flow 若要给用户提示附件已不可用，必须自己读取 `RequestAttachment` 与 evidence 后投影 notice。

### 8. 与现有 gateway/local 实现的适配策略

本 change 复用现有 gateway 基线，而不是新建 persistence owner：
- metadata side 使用 `AttachmentStoreGateway.loadAttachment` + `updateAttachmentStatus`。
- blob side 使用 `BlobStoreGateway.blobExists` + `deleteBlob`。

如果现有 gateway contract 缺少 cleanup 所需的最小 request/result shape，本 change 在 owner contract surface 内补齐；不允许通过引入 generic records 表、旁路 SQL 或直接文件删除实现。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | cleanup 只接受 trusted owner scope、`agentId` 和权威附件事实；禁止 direct path/`BlobRef` 输入；safe output 不暴露 raw content、路径或 `BlobRef`。 | owner-scope negative tests、redaction tests、architecture review |
| 性能/容量 | 首版 cleanup 只处理显式给定的 attachment refs 或可信单请求坐标，不做后台扫描；单次 cleanup 面向小批量、同步或 handoff 异步执行。 | integration tests、code review 检查不引入 scheduler/scanner |
| 可靠性/恢复 | cleanup 不进入 request terminal path；blob 缺失会被显式收敛为 `UNAVAILABLE`；metadata update 是 cleanup completed 的必要条件；失败保留 evidence。 | cleanup contract/integration tests、terminal non-regression tests |
| 可维护性 | 统一由 `agent-attachment-runtime` 持有 cleanup policy；runtime/context/gateway-local 只承担触发或适配职责。 | architecture boundary tests、code review |
| 可测试性 | cleanup outcome、reason code、引用保护、blob missing、partial failure 都可用黑盒 contract/integration test 验证。 | contract tests、gateway fake/integration tests |
| 审计/可追溯性 | cleanup evidence 保留 refs、reason 和 blob/metadata 结果；metadata 持续存在保证 `AttachmentId` 可追溯。 | audit/log assertions、traceability tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| cleanup 只由显式可信流程触发，不引入 scheduler | 1.1, 1.2, 5.2 | architecture review + negative tests |
| cleanup request 不接受 direct `BlobRef`/path | 2.1, 2.2 | contract/security tests |
| 被引用附件 metadata 不得删除 | 3.1, 3.2 | integration test: referenced attachment cleanup |
| orphan / unreferenced attachment 可删 blob 并收敛 metadata | 3.3, 3.4 | integration test: orphan cleanup |
| blob 已缺失时显式收敛为 unavailable | 3.5 | integration test: blob missing |
| blob 删除成功但 metadata 更新失败必须显式失败 | 3.6 | partial failure test |
| cleanup 不改变 request terminal/timeline 语义 | 4.1 | characterization/integration tests |
| cleanup evidence 与 audit/log/metric 必须脱敏 | 4.2, 4.3 | observability/security tests |
| retry/context 流程消费 cleanup 后的 unavailable 事实 | 4.4 | integration/contract tests |
| OpenSpec 严格校验通过 | 6.1 | `npx openspec validate add-ts-attachment-cleanup --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-attachment-cleanup/spec.md`
- 架构和跨模块设计：`openspec/designs/architecture/attachment-lifecycle.md`
- 模块设计：`openspec/designs/modules/agent-attachment-runtime.md`、`openspec/designs/modules/agent-platform-gateway-local.md`
- ADR：`openspec/designs/adr/0005-controlled-attachment-cleanup.md`
- 导航：`openspec/designs/spec-to-design-map.md`

同一规范性事实的主承载划分：
- cleanup 触发/结果/失败契约归 spec；
- metadata 保留 + blob 可删 + 不进入 terminal path 的跨模块语义归 architecture/ADR；
- cleanup port owner 和 gateway-local 非职责归 module docs。

## 风险与取舍（Risks / Trade-offs）

- [风险] cleanup 不做 scheduler，orphan metadata 可能保留较久。 -> 这是首版有意取舍；通过显式 handoff 和后续独立 retention change 处理，不在本 change 偷渡后台策略。
- [风险] metadata 永久保留会让附件表增长。 -> 首版以正确性、可追溯性优先；容量控制留给后续 retention/aging change。
- [风险] blob 删除成功但 metadata 更新失败会留下“metadata still available but content gone”的短暂不一致。 -> cleanup 必须返回 explicit failure，并通过后续重试/人工诊断再收敛。
- [风险] 不提供 bulk cleanup 可能增加运维手工成本。 -> 首版只冻结单对象/显式 handoff 边界，避免过早引入扫描器和管理面。
- [取舍] 保留 metadata 而不物理删除。 -> 牺牲部分存储空间，换取历史可追溯性和 context/retry 明确失败能力。

## 迁移计划（Migration Plan）

无。当前仓库尚无稳定 attachment cleanup 行为；本 change 直接建立首版基线。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-attachment-cleanup/spec.md`：提炼 cleanup 触发、输入、执行顺序、状态契约、失败和脱敏要求。
- `openspec/overview.md`：补充附件生命周期闭环从 intake 到 cleanup 的长期背景。
- `openspec/designs/architecture/attachment-lifecycle.md`：提炼 cleanup 与 intake/context/retry/gateway/observability 的跨模块设计。
- `openspec/designs/modules/agent-attachment-runtime.md`：提炼 cleanup port owner、非职责和验证关注点。
- `openspec/designs/modules/agent-platform-gateway-local.md`：提炼 attachment metadata/blob cleanup 的 local adapter 边界。
- `openspec/designs/adr/0005-controlled-attachment-cleanup.md`：提炼 metadata retained / blob removable / no terminal ownership 的长期决策。
- `openspec/designs/spec-to-design-map.md`：增加 `ts-attachment-cleanup` 导航与验证入口。

## 待确认问题（Open Questions）

无。
