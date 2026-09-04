## 背景和现状（Context）

现行 fork 行为（2026-07-07-add-ts-session-fork-from-message）：

- fork 复制 source session 截至 anchor 的 canonical durable message prefix，为每条 copied message 生成新的 child `messageId`、child `sessionId` 和 child-side `requestId`，并用 copied child message ids 初始化 child active context version `0`。
- 原 D3 明确排除 `runId`：copied messages 不携带 source `runId`，理由是 `runId` 指向 RequestRun 生命周期事实，复制旧 run id 会让 child message 看起来属于 source run，破坏隔离。
- fork 不创建 RequestRun、不调用 Agent core 或 model provider、不修改 source session；child message 的 content/metadata 经 safe child message projection 清除 source run/checkpoint/timeline refs。

conversation share 现状：

- 创建分享（`POST /api/v1/sessions/:sessionId/shares`）以前端勾选的问答对 `runIds` 为选择键，`ConversationShareRecord` 冻结 `runIds` 快照。
- 读取分享时用分享记录中冻结的 creator owner+agent scope 分页查询被分享 session 的 messages，按 `msg.runId !== undefined && runIds.contains(msg.runId)` 过滤，过滤结果为空返回 `SHARE_CONTENT_DELETED`。
- 读取范围被严格锁定在 `runIds` 快照内，这是跨 scope 只读例外的安全边界。

由此，fork child session 中继承的问答对没有 `runId`，分享选择键缺失：勾选无法映射到有效 `runIds` 快照，读取路径过滤后为空，用户看到分享页查无数据。

相关约束：

- 同形同策：相同语义类别、相同生命周期阶段的对象用同一条原则处理；不得为相同语义新增平行 DTO 或平行选择机制。
- 冻结核心契约优先：优先在既有 public 字段和 vocabulary 内调和，避免 contract churn。
- `SessionMessageRecord.runId` 是 optional 字段，shape 无需变更。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- fork child session 继承的问答对可经既有 conversation share 链路创建并读取分享。
- 保持 fork 隔离：child 不引用 source run 身份与 lifecycle 事实；fork 不创建 runtime 事实。
- 保持分享读取 scope 锁定语义：读取范围仍然严格等于 `runIds` 快照对应的 messages。
- 零 contract churn：不新增 Web API、不变更 `ConversationShareRecord`/`SessionMessageRecord` shape、不要求前端改动。

**非目标：**

- 不为继承问答对伪造 execution timeline 或 run 状态。
- 不支持继承问答对的 retry/edit/cancel。
- 不持久化 fork provenance（copied message 与 source run/message 的对应关系）。

## 设计决策（Decisions）

### D1：message 的 `runId` 字段是 turn 分组/读取锚点，与 RequestRun 事实分离

`SessionMessageRecord.runId` 在 durable conversation 域承载两类消费：

1. turn 分组与读取锚点：conversation 按 run 聚合问答对、分享按 `runIds` 快照选择并过滤问答对。
2. lifecycle 引用：`runId` 指向 RequestRun/timeline/checkpoint 等 runtime 事实。

原 D3 为阻断第 2 类消费对 child 的污染而整体移除 `runId`，顺带杀死了第 1 类消费。本 change 恢复第 1 类、继续阻断第 2 类：copied message 携带的 `runId` 只是 durable 分组锚点，MUST NOT 被当作 lifecycle 引用。字段取值的重映射不等于 runtime 事实的复制——这与 `messageId`、`requestId` 的 remap 是同一条 child-owned identity 原则（同形同策）：fork 把 copied message 的全部归属标识 remap 到 child scope，`runId` 不再例外。

### D2：run anchor 铸造规则（重映射而非复制）

fork 构造 id maps 时为 source prefix 中出现的每个不同 source `runId` 经 runtime idFactory（与 child `messageId`/`requestId` 同一铸造通道）铸造一个新 child run id：

- 同一 source run 的 copied messages MUST 共享同一个 child run anchor（保持问答对分组）。
- 不同 source run MUST 映射到不同 child run anchor。
- run anchor MUST NOT 等于任何 source `runId`（新铸造，不与 source 建立引用）。
- source message 无 `runId` 时，其 copied message MUST NOT 携带 `runId`。
- source `runId` → child run anchor 的映射只存在于 fork 执行的内存中，MUST NOT 持久化、MUST NOT 写入日志/metric/trace/audit（无 source run provenance）。
- run anchor 数量 ≤ prefix 消息数，已被既有 fork resource preflight（copied message count/bytes 预算）覆盖，不新增预算维度。

不保留 source `runId` 的理由沿用原 D3 的隔离论证：保留会把 child message 绑定到 source RequestRun；新铸造满足 child-owned identity 且与 source 零引用。

### D3：run anchor 的语义边界

- fork MUST NOT 为 run anchor 创建 RequestRun、timeline event、checkpoint、pending input 或 lane queue 事实；`RequestLifecycleCoordinator.forkFromMessage` 不进入 request lifecycle。
- run-scoped 查询（timeline 读取、activeRun、run-scoped stream filter、RequestRun load）对 run anchor 返回空或不存在，属于既有行为的自然结果，各路径 MUST NOT 为 run anchor 增加特判。
- cancel/retry/edit/recovery 等 lifecycle 操作 MUST NOT 以 run anchor 为目标；若客户端以 run anchor 发起 run-scoped 操作，按既有的 run-not-found 安全语义处理。
- conversation annotation 按 `runId` 记录且不校验 run 存在；继承问答对的标注落在 run anchor 命名空间下，行为自洽，本 change 不新增 annotation 契约。

### D4：与安全不变量的关系

- safe child message projection 不变：copied message 的 content、metadata、replacement evidence、summary metadata、`ContentRef` 和 backing refs 中的 source run ids 仍 MUST 清除、置空或使 fork 失败；run anchor 只写入 message 的 `runId` 字段本身。
- 分享读取 scope 锁定不变：读取范围仍严格等于 `runIds` 快照对应的 messages；child run anchor 只属于 child session，分享创建与读取都在同一 owner+agent scoped session 内闭环，不扩大跨 scope 只读例外的覆盖面。
- 诊断边界不变：fork 日志/metric/audit 不包含 copied message 内容，也不包含 run anchor 与 source run 的对应关系。

### D5：放弃方案

- **fork 为继承问答对创建 RequestRun 副本**：RequestRun 是 request lifecycle truth，为它伪造 COMPLETED/COMMITTED 记录违反既有隔离契约（fork 操作本身 MUST NOT 创建 RequestRun），并连带伪造 timeline、checkpoint、lane snapshot 语义；runtime truth 被污染，恢复、重试、审计路径都会读到从未发生的执行。
- **分享选择键改为 `requestIds` 或 message id 列表**：为同一语义（选择问答对）新增平行选择机制，违反同形同策；`ConversationShareRecord` shape 与 Web API body 都要变更，构成 contract churn；retry 会在同一 request 下产生多个 run，`requestId` 无法区分被取代的尝试，丢失现有 `runIds` 快照的 attempt 精确性；既有分享记录语义漂移。
- **分享读取对无 `runId` 消息 fallback 按 `requestId` 匹配**：读取范围不再等于 `runIds` 快照，`requestId` 会命中被取代 run 的消息，稀释「读取范围严格锁定快照」的安全不变量，且同一 message 集合出现两种匹配语义。

三个放弃方案都要么伪造 runtime truth，要么制造平行机制/双语义，唯一满足全部不变量的是 D1-D3 的 run anchor 重映射。

## 质量属性设计（Quality Attributes）

- 安全：run anchor 与 source run 无引用关系，分享读取 scope 锁定语义不变；provenance 不落盘、不入日志。
- 可靠性/恢复：run anchor 在 fork composite write 的同一数据库事务内随 copied messages 落库；fork 幂等 replay 返回首次 child session，不重复铸造。
- 容量：run anchor 数量受既有 copied message 预算约束；铸造为内存操作，不新增 I/O。
- 可诊断：fork 失败诊断维持既有安全错误码与低基数字段。

## 风险与取舍（Risks / Trade-offs）

- 取舍：继承问答对获得可分享的 turn 锚点，但没有 execution timeline；用户在 child session 打开继承问答对的执行细节时看到空过程。这是「不伪造 runtime truth」的直接代价，可接受。
- 风险：未来若有路径默认 `message.runId` 必然指向已存在 RequestRun，会对 run anchor 失效。本 change 在 spec 中显式禁止该假设，并以「run 查询对 anchor 返回空/不存在」为契约。

## 迁移计划（Migration Plan）

无数据迁移。fork child session 此前无法对继承问答对创建有效分享，无受影响存量数据；既有 source session 与非 fork session 的消息、分享记录不变。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/session-fork-from-message/spec.md`：提升 run anchor 契约与场景。
- `openspec/designs/modules/agent-runtime.md`：提炼 fork id remap 覆盖 `messageId`/`requestId`/`runId` 的 child-owned identity 原则。
- `openspec/designs/adr/session-fork-copies-prefix-not-runtime-state.md`：补充 run anchor 与该 ADR 的边界说明。
- `openspec/designs/spec-to-design-map.md`：同步 `session-fork-from-message` 导航。

## 待确认问题（Open Questions）

无。
