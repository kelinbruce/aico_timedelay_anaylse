## 背景和现状（Context）

长期记忆 extraction 需要稳定、可审计的任务输入。直接从 message history 生成长期记忆会混合用户表达、模型推理、工具细节和最终事实，导致 `FACTUAL`、`PROCEDURAL`、`USER_CHARACTERISTICS` 的质量门难以统一。电信网络任务天然以轨迹呈现：目标、约束、动作、观察、结果、失败原因和验证方式。

本 change 新增独立 `task-trajectory` capability，把已提交请求投影为持久化 `TaskTrajectoryRecord`。它不是长期记忆 record，不进入 `search_memory`，不替代 session/timeline 的 source of truth；它是自动学习和后续复盘的稳定 read model。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 定义 `TaskTrajectoryRecord` 的持久化、查询和安全边界。
- 在 terminal commit 成功后异步构建任务轨迹，不影响请求终态。
- 为 memory extraction 提供稳定输入层：`TaskTrajectory -> extraction candidate -> LongTermMemoryRecord`。
- 明确 runtime、agent-memory、gateway-local、memory tools 的职责边界。

**非目标：**

- 不定义长期记忆四类 content schema；该 schema 仍由 `add-ts-memory-core` 拥有。
- 不定义 memory extraction 的 candidate 融合、冲突消歧或写入策略。
- 不把 task trajectory 暴露为 model-facing tool。
- 不定义 Web/REST 管理 API、报表 UI 或训练数据导出。
- 不持久化 raw conversation、raw tool output、raw attachment 或 raw provider response。

## 设计决策（Decisions）

### 决策 1：持久化 TaskTrajectoryRecord，保留 session/timeline 为 source of truth

选定路径：`TaskTrajectoryRecord` 是 owner/agent scoped read model，由已提交 session/run/message/timeline facts 投影得到。它可重复构建，必须保留 source refs，但不复制 raw message content。

放弃路径：
- 不把 trajectory 作为新的 canonical timeline。
- 不把 trajectory 嵌入 `LongTermMemoryRecord.sourceTrace`。
- 不让 memory extraction 每次直接解析 message history 生成长期记忆。

### 决策 2：terminal commit 后异步构建

选定路径：runtime terminal commit 成功后，app composition 复用当前 runtime 已有的 `runTimelineEventListeners` 机制监听已持久化 terminal timeline event，只产生轻量 `TaskTrajectoryBuildIntent` / pending signal 作为快速触发路径；local backend 的后台 worker 按 batch、concurrency、retry/backoff 和 max pending 限制执行 trajectory builder。listener 必须同步返回，构建在 terminal commit 关键路径之外执行；listener、intent 或 builder 失败只产生安全诊断，不改变请求终态。可靠性不依赖 listener/intent 必达，而由 bounded catch-up / reconciliation 保证：worker 周期性通过 public gateway query 扫描已 terminal commit、同 scope 下尚无 trajectory 的最小 run/event refs，并通过 scoped idempotent save 补建。

唯一实现路径：
1. runtime 完成 terminal commit。
2. runtime 通过 `runTimelineEventListeners` 发布带 `persistence="PERSISTED"` 的 terminal `RunTimelineEvent`。
3. app composition 中的 task trajectory listener 只筛选 terminal persisted event，提取 committed run/session refs，并记录或入队 scoped build intent。
4. 后台 worker 从 pending intent 中按限流取任务。
5. 同一个 worker 还必须按 bounded batch/window/cursor 执行 catch-up scan：通过 public gateway query 找到已 terminal commit 且缺少 `TaskTrajectoryRecord` 的 scoped run/event refs，作为丢失 intent 的补偿来源。
6. `agent-memory` 中的 `TaskTrajectoryBuilder` 只读取 public session/message/timeline gateway ports、committed run refs，以及 timeline/session 中已有的 safe tool invocation projection / content refs；不得依赖不存在的独立 tool result gateway。
7. builder 投影为 `TaskTrajectoryRecord`。
8. `TaskTrajectoryStoreGateway.saveTaskTrajectory` 使用 scoped uniqueness anchor 写入专用持久化表；重复 listener、重复 catch-up 或 worker retry 必须幂等返回既有 trajectory 或执行安全 upsert。

放弃路径：
- 不在 runtime 中实现 builder。
- 不新增 `AFTER_TERMINAL_COMMIT` lifecycle hook 或第二套 runtime post-commit contract。
- 不在 terminal commit 事务内写 trajectory。
- 不在 timeline listener 中同步执行完整 trajectory projection。
- 不把 in-memory pending signal 当作唯一可靠来源。
- 不通过 model-facing tools 或 capability invocation 触发。

### 决策 3：gateway public contract 承载持久化和查询

选定路径：在 `agent-contracts/gateway` 定义 `TaskTrajectoryStoreGateway` 和 `TaskTrajectoryQueryGateway`。local backend 由 `agent-platform-gateway-local` 的专用表实现，并像 session/message/checkpoint stores 一样显式挂到 `LocalGatewayStores` 和 `SqliteGatewayStores`：`LocalGatewayStores.taskTrajectoryStore` 负责 save，`LocalGatewayStores.taskTrajectoryQuery` 负责 query。`TaskTrajectoryQueryGateway` 同时暴露最小 `listBuildCandidates` 查询，用于 catch-up worker 找到已 terminal commit 但尚无 trajectory 的 scoped run/event refs；该查询只能返回 owner/agent/session/run/terminal event refs、状态和 cursor，不得返回 raw content。app composition 只能从这些 public gateway properties 注入给 `agent-memory` worker 和 memory extraction，不得由 `agent-memory` 直接 new gateway-local store 或读取 SQLite row。

核心 DTO 草图：

```typescript
type TaskTrajectoryId = Brand<string, "TaskTrajectoryId">;
type TaskTrajectoryBuildStatus = "COMPLETED" | "FAILED" | "SKIPPED";
type TaskOutcomeStatus = "SUCCEEDED" | "FAILED" | "PARTIAL" | "UNKNOWN" | "CANCELLED";
type OutcomeEvidenceLevel = "NONE" | "MODEL_CLAIM" | "TOOL_STATUS" | "VERIFICATION" | "USER_CONFIRMATION";
type TaskTrajectoryKind = "TROUBLESHOOTING" | "CONFIG_CHANGE" | "PLANNING" | "EXPLANATION" | "GENERAL_TASK";

interface TaskTrajectoryRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly taskTrajectoryId: TaskTrajectoryId;
  readonly sessionId: SessionId;
  readonly requestRunId: RequestRunId;
  readonly taskKind: TaskTrajectoryKind;
  readonly trajectoryBuildStatus: TaskTrajectoryBuildStatus;
  readonly taskOutcomeStatus: TaskOutcomeStatus;
  readonly outcomeEvidenceLevel: OutcomeEvidenceLevel;
  readonly goalSummary: string;
  readonly constraintSummaries: readonly string[];
  readonly observations: readonly TaskTrajectoryObservation[];
  readonly actions: readonly TaskTrajectoryAction[];
  readonly outcomeSummary?: string;
  readonly outcomeEvidenceRefs: readonly TaskTrajectorySourceRef[];
  readonly failureSummary?: string;
  readonly sourceRefs: readonly TaskTrajectorySourceRef[];
  readonly startedAt: EpochMillis;
  readonly completedAt: EpochMillis;
  readonly createdAt: EpochMillis;
  readonly updatedAt: EpochMillis;
}

interface TaskTrajectoryBuildCandidate extends OwnerScoped {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestRunId: RequestRunId;
  readonly terminalTimelineEventId: RunTimelineEventId;
  readonly terminalTimelineSequence: number;
  readonly terminalCommittedAt: EpochMillis;
}
```

字段细节、row mapping 和 query request 的主承载是本 change design，归档后进入 architecture memory 设计文档。

### 决策 4：轨迹内容只保存安全摘要和 refs

选定路径：trajectory 保存安全摘要、动作类型、工具名、结果状态、低基数标签和 source refs。摘要只能来自已提交事实的安全投影：`RequestRun` terminal facts、visible committed `SessionMessage` safe projection、canonical timeline events、tool invocation result safe summary、artifact/content reference metadata、runtime safe error / diagnostic code。诊断、日志和 audit 不记录 raw content。

轨迹中的业务结果必须保守判断。`terminal commit` 成功只表示请求终态已可靠持久化，不表示用户业务目标已完成。builder 输出 `taskOutcomeStatus`、`outcomeEvidenceLevel`、`outcomeEvidenceRefs` 和可选 `outcomeSummary`；证据不足时默认 `taskOutcomeStatus=UNKNOWN`、`outcomeEvidenceLevel=NONE`。只有 task kind 对应的强证据满足时才能标记 `SUCCEEDED`，例如验证命令成功、配置 apply + verify 成功、用户显式确认，或 explanation/planning 类任务已产出目标内容。单纯 final assistant claim 只能作为 `MODEL_CLAIM` 弱证据，不得单独支持高置信 `PROCEDURAL` 学习。

放弃路径：
- 不保存 raw user/assistant message。
- 不保存 raw tool output 或附件内容。
- 不保存 provider raw error。
- 不把 request terminal completed 当成业务成功。
- 不让 builder 在证据不足时猜测成功。

### 决策 4A：轨迹是历史投影，后续相似轨迹不回写旧 outcome

选定路径：`TaskTrajectoryRecord` 描述当次请求在当时可见证据下的任务轨迹。后续相似会话提供新的验证证据时，应新增新的 trajectory，并由 memory extraction 在 `LongTermMemoryRecord` 层做 sourceTrace 融合、`extractionCount` 递增和 confidence corroboration。旧的 `UNKNOWN` trajectory 不因另一个相似 trajectory 被证明正确而改成 `SUCCEEDED`。

允许更新旧 trajectory 的受控例外仅限同一 request/run 的 projection 修复：例如 builder 当时失败后重建成功、迟到的同一 run 已提交事实被补齐、或 projection bug 需要幂等重建。跨 request / 跨 session 的相似证据不得修改旧 trajectory 的 `taskOutcomeStatus`。

放弃路径：
- 不把 task trajectory 表做成知识融合状态机。
- 不通过重跑旧 trajectory 来解决长期记忆证据融合。
- 不让 memory extraction 修改 task trajectory outcome。

### 决策 5：memory extraction 消费 trajectories，不消费 trajectory builder

选定路径：`add-ts-memory-extraction` 通过 `TaskTrajectoryQueryGateway` 查询时间窗口内的 trajectories，再按 category-specific matrix 提取候选。extraction 不调用 builder，不读取 task trajectory table，不读取 raw message history。

放弃路径：
- 不让 extraction 私查 session/message DB。
- 不让 memory tools 使用 task trajectory。
- 不在 task trajectory change 中定义 extraction candidate schema。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | owner/agent scope 强制来自 trusted context；trajectory 只保存安全摘要和 refs；跨 scope not found/empty，不泄漏存在性。 | Contract/security tests |
| 性能/容量 | 构建异步执行；单条 trajectory 只保存摘要和数组上限；查询支持时间窗口、limit 和 cursor/offset。 | Capacity tests、query limit tests |
| 可靠性/恢复 | terminal commit 不等待 trajectory；listener/intent 只是快速触发；bounded catch-up 从 committed terminal refs 补建丢失 intent；save 使用 scoped idempotency，重复触发返回同一 trajectory 或执行安全 upsert。 | Resilience/integration tests |
| 可维护性 | runtime 不拥有 builder；builder 在 `agent-memory`；gateway-local 只做 row mapping；memory extraction 只消费 query port。 | Architecture tests |
| 可测试性 | builder 输入为 committed refs，可用 gateway test doubles；query/store contract 可独立测试。 | Unit/contract/integration tests |
| 审计/可追溯性 | trajectory 保留 sourceRefs；构建失败产生 safe diagnostic；不记录 raw content。 | Observability/audit tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| terminal commit 后异步构建与 catch-up | 3.1, 3.4, 4.2, 4.4 | `tests/agent-kernel/task-trajectory-integration.test.ts` |
| trajectory 不含 raw content | 2.2, 6.1 | contract/security tests |
| query 强制 owner/agent scope | 1.2, 4.1 | gateway contract tests |
| runtime 不拥有 builder | 6.2 | architecture tests |
| memory tools 不消费 trajectory | 6.3 | architecture tests |
| extraction 通过 query gateway 消费 | 5.2 | integration tests |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/task-trajectory/spec.md`。
- 架构和跨模块设计：`openspec/designs/architecture/memory.md` 主承载 `TaskTrajectory -> memory extraction` 流程；runtime post-commit 触发事实归 runtime architecture 文档摘要。
- 模块设计：`openspec/designs/modules/agent-memory.md` 主承载 builder orchestration；`openspec/designs/modules/agent-platform-gateway-local.md` 主承载 local persistence ownership。
- ADR：`openspec/designs/adr/task-trajectory-learning-input.md` 记录持久化轨迹作为学习输入层的取舍。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [新增持久化面扩大复杂度] -> 独立 change、专用表、明确 retention/owner scope，不塞进 memory extraction。
- [轨迹复制敏感内容] -> 只保存安全摘要和 refs，contract tests 覆盖 raw content 禁止项。
- [runtime 边界膨胀] -> runtime 只发布 post-commit refs，builder 位于 `agent-memory`。
- [与 memory record 混淆] -> trajectory 不进入 search_memory，不是 LongTermMemoryRecord，不参与 aging。
- [远端 backend 双写] -> remote complete-service backend 下本地 builder disabled。

## 迁移计划（Migration Plan）

无历史数据迁移要求。启用后只为新 terminal commit 的 request 构建 trajectory；catch-up 只覆盖启用后的 bounded batch/window/cursor，不作为历史 session 全量回填机制。是否回填历史 session 不属于本 change。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/task-trajectory/spec.md`：task trajectory 行为契约。
- `openspec/overview.md`：长期记忆学习输入层的背景。
- `openspec/designs/architecture/memory.md`：trajectory、memory extraction、long-term memory 的跨模块流程。
- `openspec/designs/modules/agent-memory.md`：TaskTrajectoryBuilder、memory extraction consumer 职责。
- `openspec/designs/modules/agent-platform-gateway-local.md`：task_trajectory table 和 gateway ownership。
- `openspec/designs/adr/task-trajectory-learning-input.md`：持久化轨迹作为学习输入层的 ADR。
- `openspec/designs/spec-to-design-map.md`：导航。

## 待确认问题（Open Questions）

无。
