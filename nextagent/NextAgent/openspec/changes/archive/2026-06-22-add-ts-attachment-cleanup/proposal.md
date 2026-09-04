## 背景与问题（Why）

`add-ts-attachment-intake` 已经把不可信上传输入转换成受控 `AttachmentId`、`RequestAttachment` 和 opaque `BlobRef`，并明确 intake 成功但 request acceptance 未发生、或 staging 部分失败时会留下可追溯的 orphan candidate。`add-ts-attachment-request-context-flow` 也要求后续请求上下文只消费权威附件事实，并在附件不可用时显式失败或降级。

当前缺失的是附件 cleanup 的独立规格：什么流程可以触发 cleanup、cleanup 如何校验 owner scope 和 agent scope、何时允许删除 blob、何时只能把 metadata 标记为 `UNAVAILABLE`、cleanup 如何记录 audit/diagnostic、以及 cleanup 失败时如何保持主流程正确性。如果没有这条 change，入口、runtime、context、gateway-local 或运维脚本容易各自实现一套“删附件”逻辑，破坏附件可信边界、owner scope 隔离、审计链和历史可追溯性。

现在处理的必要性在于：attachment intake 已经把 orphan candidate 和后续 cleanup handoff 明确后置给本 change；retry source revalidation、request context flow 和 large-content/attachment 可用性语义也都依赖稳定的 cleanup 边界。cleanup 必须先被冻结为独立 capability，后续实现才不会把 retention、后台调度、artifact 清理或 session aging 混进同一条 change。

## 变更范围（What Changes）

- 新增 attachment cleanup 行为：定义 `agent-attachment-runtime` 拥有的显式 cleanup port，负责在可信 owner/agent/session/request/run 坐标下执行 attachment metadata 状态更新、blob 删除检查和 cleanup 结果归档。
- 明确触发机制：首批只支持系统内显式触发，不支持终端用户直接触发，也不定义后台 retention scheduler。允许的触发来源限定为：
  - attachment intake / request acceptance 之间 admission gap 失败后的 orphan cleanup handoff；
  - attachment context / retry source revalidation 发现附件事实仍在但 blob 已不可用时的 explicit availability cleanup。
- 明确输入和前置条件：cleanup 必须接收可信 `IdentityContext`、`agentId`、cleanup reason、至少一组受信 attachment refs 或 trusted request/session/run 坐标、权威 `RequestAttachment`、`AttachmentStoreGateway`、`BlobStoreGateway`、audit writer、structured log/metric sink 和必要配置；不得信任客户端自报状态、路径或 `BlobRef`。
- 明确输出和副作用：cleanup 产生稳定 cleanup outcome、更新后的 `RequestAttachment` 状态、必要时的 blob delete/check 结果、安全诊断、audit/log/metric 和后续可消费的 cleanup evidence；不产生新的 request lifecycle 事实，不改变 runtime terminal 语义。
- 明确核心判断：引用保护优先，仍被 `SessionMessage.attachmentIds` 引用的附件 metadata 不得物理删除；cleanup 可以删除 blob 并把 `availabilityStatus` 更新为 `UNAVAILABLE`，保留 metadata、历史、审计和上下文诊断所需事实。
- 明确非范围：本 change 不定义后台保留期策略、周期性 scheduler、session retention、artifact cleanup、admin bulk cleanup、operator-facing diagnostics/maintenance API、attachment download API、PDF/Office 解析策略或新的用户可见 attachment 管理界面。

BREAKING：无。当前仓库尚无稳定 attachment cleanup 基线。

## Capability 影响（Capabilities）

### 新增 Capability
- `ts-attachment-cleanup`: 定义 TS 后端附件 cleanup 的触发来源、owner-scoped 前置条件、metadata/blob 处理顺序、cleanup outcome、失败/降级和审计边界。

### 修改的 Capability
- 无。

## 影响范围（Impact）

- `agent-attachment-runtime`：新增 attachment cleanup port、reason code、cleanup outcome 和 explicit cleanup policy。
- `agent-contracts/attachment` 或其 owner contract surface：若需要稳定暴露 cleanup port/request/result，需在该 owner surface 增补公共契约。
- `agent-contracts/gateway` 与 gateway-local：复用现有 `AttachmentStoreGateway.updateAttachmentStatus`、`BlobStoreGateway.blobExists/deleteBlob`；若当前 gateway contract 无法表达 cleanup 所需的最小 write/read shape，则本 change 内补齐 owner-owned contract。
- `agent-runtime` / request entry / context flow / retry source validation：只作为 cleanup 调用方或 handoff 触发方，不拥有 cleanup policy。
- `agent-observability` / audit：新增 `attachment.cleanup.*` safe audit/log/metric 事件族。
- 测试：需要 attachment cleanup contract、integration、negative security、owner-scope、orphan/reference-protection、blob-missing、gateway failure 和 no-terminal-side-effect 验证。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-attachment-cleanup/spec.md`：新增 attachment cleanup 行为基线。

长期背景：
- `openspec/overview.md`：补充附件可信生命周期闭环从 intake、context consumption 到 cleanup 的产品边界。

设计视图：
- `openspec/designs/architecture/attachment-lifecycle.md`：补充跨模块 attachment cleanup 流程、引用保护、owner scope、audit 和 failure/degradation 边界。
- `openspec/designs/modules/agent-attachment-runtime.md`：补充 cleanup port、cleanup reason、metadata/blob policy 和非职责。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充 attachment cleanup 对本地 gateway store/blob adapter 的职责边界。
- `openspec/designs/adr/0005-controlled-attachment-cleanup.md`：记录“metadata 保留、blob 可删、cleanup 不进入 request terminal path”的长期取舍。
- `openspec/designs/spec-to-design-map.md`：新增 `ts-attachment-cleanup` 到 architecture/modules/ADR/验证入口的导航。

验证入口：
- 契约验证：cleanup request/result、reason code、引用保护、owner/agent/session 绑定。
- 流程验证：admission gap orphan cleanup、blob-missing explicit unavailable、cleanup 不改变 terminal commit/timeline。
- 安全验证：cleanup 不信任客户端路径/`BlobRef`、不跨 owner 删除、safe output 不泄漏路径/raw content。
