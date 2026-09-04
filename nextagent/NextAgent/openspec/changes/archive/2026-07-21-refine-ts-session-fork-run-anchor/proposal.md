## 背景与问题（Why）

用户从会话 A fork 出 child session 后，在 child session 中勾选继承自会话 A 的问答对创建分享，分享页查询不到任何内容。

失败机制是确定的：conversation share 以问答对所在 run 的 `runId` 作为选择键——创建分享时冻结 `runIds` 快照，读取分享时按快照过滤被分享 session 的 messages（`msg.runId !== undefined && runIds.contains(msg.runId)`），过滤结果为空时返回 `SHARE_CONTENT_DELETED`。而按照现行 fork 设计（2026-07-07-add-ts-session-fork-from-message D3），copied messages 不携带 `runId`，继承问答对因此对整条分享链路不可见：前端勾选项缺少选择键，即使构造出分享记录，读取路径也会把无 `runId` 的消息全部过滤掉。

第一性原理上，fork 的 child-owned identity 原则要求 copied message 的全部归属标识 remap 到 child scope：`messageId`、`sessionId`、`requestId` 都已如此，`runId` 是唯一未 remap 的归属标识，导致以它为键的 durable 读取路径在 child session 断链。原设计把「message 记录上的 `runId` 字段」（turn 分组与读取锚点语义）与「`runId` 指向的 RequestRun 生命周期事实」（runtime truth 语义）视为一体并整体排除；本 change 将两种语义分离：重映射字段取值不等于复制 runtime 事实。

## 变更范围（What Changes）

- fork 复制 prefix 时，为携带 `runId` 的 source message 的 copied message 铸造 child-scoped run anchor：同一 source run 的 copied messages MUST 共享同一个新 child run id；不同 source run MUST 使用不同 child run id；run anchor MUST NOT 等于任何 source `runId`；source message 无 `runId` 时其 copied message MUST NOT 携带 `runId`。
- run anchor 只是 durable message 的分组/读取锚点，不是 runtime 事实：fork MUST NOT 为 run anchor 创建 RequestRun、timeline event 或 checkpoint；cancel/retry/edit/recovery/stream/activeRun 等 lifecycle 路径 MUST NOT 把 run anchor 当作可操作的 run；run anchor 与 source run 的对应关系 MUST NOT 持久化（不保留 source run provenance）。
- 既有 fork 不变量不变：child message 的 content/metadata 不得包含 source run ids（safe child message projection 要求不变）；fork 不创建 runtime 事实、不调用 Agent core 或 model provider、不修改 source session。
- conversation share 的 contract、route、创建与读取路径不变；继承问答对经 child run anchor 纳入既有 `runIds` 快照机制。
- 本 change 不新增 Web API、不改变 `ConversationShareRecord` 或 `SessionMessageRecord` 的 shape、不要求前端改动。

## Capability 影响（Capabilities）

### 新增 Capability
无。

### 修改的 Capability
- `session-fork-from-message`：copied message 的 child-owned identity 范围扩展为包含 `runId` 字段重映射，并明确 run anchor 的非 lifecycle 语义边界。

## 影响范围（Impact）

- 后端 runtime：`RequestLifecycleCoordinator` 的 fork id remap 与 copied message 构造需要支持 run anchor；fork prefix query、promotion、composite write 不变。
- 后端 contract：`SessionMessageRecord.runId` 的 shape 不变；本 change 只规定 fork 复制路径下该字段的取值来源，不影响其他写入路径。
- conversation share：契约与读取路径不变；fork child session 的继承问答对变得可创建、可读取分享。
- 前端：child session 继承 turn 的分享勾选经既有 `runId` 通道生效，无新增 UI 工作；继承 turn 没有 execution timeline，执行细节展示为空是既有行为的自然结果。
- 受影响的 stable spec：`openspec/specs/session-fork-from-message/spec.md`。
- 受影响的长期设计：`openspec/designs/adr/session-fork-copies-prefix-not-runtime-state.md` 的 Context 把 run ids 列为不得成为 child runtime truth 的 source runtime facts，归档时需要澄清其含义是 source run 身份与 lifecycle 事实，不排斥新铸造的 child-scoped 分组锚点。
- 验证入口：OpenSpec strict validation；`tests/agent-kernel/session-fork-runtime.test.ts` 新增 run anchor 与分享链路用例并适配既有 id 序列；`npm run test:contract`；`npm run lint:architecture`。

## 非目标（Non-Goals）

- 不改变 conversation share 的 Web API、`ConversationShareRecord` shape、`runIds` 快照语义或读取路径。
- 不为继承问答对提供 execution timeline、process details 或 run 状态；不支持对继承问答对的 retry/edit/cancel。
- 不持久化 fork 后 message 与 source run 的 provenance；不新增 fork lineage API。
- 不处理既有数据迁移：fork child session 此前无法对继承问答对创建有效分享，无受影响存量数据。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/session-fork-from-message/spec.md`：合并本 change 的 run anchor 契约与场景。

长期背景：
- `openspec/overview.md`：不更新；本 change 是既有 fork 能力的行为修正，不引入新的用户可见能力。

设计视图：
- `openspec/designs/architecture/`：不更新；本 change 不新增跨模块流程或契约 ownership。
- `openspec/designs/modules/agent-runtime.md`：归档时提炼 fork id remap 覆盖 `messageId`/`requestId`/`runId` 的 child-owned identity 原则。
- `openspec/designs/adr/session-fork-copies-prefix-not-runtime-state.md`：归档时补充 run anchor 与该 ADR 的边界说明（复制的是分组锚点字段取值，不是 runtime state）。
- `openspec/designs/spec-to-design-map.md`：归档时同步 `session-fork-from-message` 导航。
