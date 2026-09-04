## 背景和现状（Context）

`add-ts-trace-log-linking` 和 `add-ts-structured-logging` 已建立 `ObservabilityObservationEvent` → `ObservabilityProjectorHost.acceptObservation` → `StructuredLogProjector` 的投影链。当前观察面覆盖了外部边界（模型调用、HTTP 网关、capability 调用和终端 timeline 事件），但运行时内部状态机转换、调度行为和持久化降级没有被观察。

`agent-runtime` 的 `RequestLifecycleCoordinator` 通过 `deps.runTimelineEventListeners` 向外暴露 timeline 事件，但该机制仅投射已持久化的 timeline event，不覆盖内存中的调度状态。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 为 QUEUED→EXECUTING 过渡、lane drain、local recovery、terminal commit 降级、health 探测结果和应用关闭提供结构化 observation
- 所有新增 observation 复用现有 `ObservabilityObservationEvent` 和 `ObservabilityProjectorHost` 路径
- observation 发射失败不阻断主业务路径

**非目标：**
- 不新增持久化的 observation record 或 gateway contract
- 不修改 `ObservabilityProjectorHost` 接口
- 不为内部操作新增 timeline event（调度事件不进入持久化 timeline）
- 不修改 `agent-contracts` 的 public API

## 设计决策（Decisions）

### D1: observation 发射位置

所有新增 observation 在以下位置直接构造并发射：
- **submit.ts**: `drainLane`（RUN_DISPATCHED、LANE_DRAIN_*）、`recoverLocalRuntime`（RECOVERY_SCAN_*）
- **terminal-commit.ts**: `commitTerminalOutcome`（TERMINAL_COMMIT_DEGRADED）
- **create-app.ts**: health 探测回调（HEALTH_EVALUATED）、`close()`（APP_SHUTDOWN）

理由：这些方法是当前 state machine transition 的唯一 owner；在源头发射避免创建额外的 wrapper 或 event bus。

### D2: `acceptObservation` 注入方式

`RequestLifecycleCoordinator` 已有 `deps` 对象。为保持简单，通过新增可选依赖 `deps.projectorHost?: ObservabilityProjectorHost` 注入。`agent-app` 在创建 coordinator 时传入。

`commitTerminalOutcome` 是一个纯函数，通过 `TerminalCommitHooks` 扩展可选的 `acceptObservation` 回调。

备选方案（放弃）：
- 为 `RequestLifecycleCoordinator` 添加单独的 observation port interface：增加不必要的接口抽象，不符合"简单优先"
- 使用 event emitter：增加异步性和类型安全问题

### D3: StructuredLogEvent 扩展

`StructuredLogEvent` 联合类型新增：
- `SCHEDULER_DIAGNOSTIC`：映射 `system` 边界的 RUN_DISPATCHED、LANE_DRAIN_*
- `RECOVERY_DIAGNOSTIC`：映射 `system` 边界的 RECOVERY_SCAN_*
- `HEALTH_PROBE_RESULT`：映射 `health_probe` 边界的 HEALTH_EVALUATED
- `APP_SHUTDOWN`：映射 `system` 边界的 APP_SHUTDOWN

`mapEvent` 函数按 boundary + operation 组合路由。无新增 projector 或 projector interface。

### D4: non-blocking contract

所有新增 observation 发射沿用现有 try/catch 包裹模式：

```ts
try { deps.projectorHost?.acceptObservation(event); } catch { /* silent */ }
```

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | observation 不携带 secret、credential、raw prompt/output、attachment content 或 stack trace。使用现有 `createObservationEvent` 的 shape assertion 保证安全 | `redaction.ts` 的 sanitization 测试覆盖新 boundary |
| 性能/容量 | observation 发射是同步 handoff（入队），不超过现有 projector host queue capacity (1024)。高频路径（lane drain）中每次 drain 循环最多发射 2 条 observation | 调度 integration 测试验证 observation 不影响 drain 吞吐 |
| 可靠性/恢复 | observation 发射失败被静默捕获。恢复路径中的 observation 不影响 recovery 的 scan/rebuild/claim 结果 | contract 测试验证 observation 失败不抛异常 |
| 可维护性 | 所有新增 observation 与现有 observation 共用同一 `ObservabilityObservationEvent` 类型、同一 projector host 和同一 redaction pipeline，无新增 abstraction | 架构检查 `dependency-cruiser` |
| 可测试性 | `deps.projectorHost` 是可选的 test double。`commitTerminalOutcome` 的 hooks 中 `acceptObservation` 可被 mock | unit test 使用 mock projector host 断言 observation shape |
| 审计/可追溯性 | 新增 observation 进入 audit projector 和 structured log projector，与现有审计路径一致 | integration test 验证 audit event 写入 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| RUN_DISPATCHED observation shape | T1 | unit test 在 submit test 中断言 observation 字段 |
| LANE_DRAIN_STARTED/COMPLETED/SUPERSEDED | T2 | unit test 覆盖三种 drain 分支 |
| 恢复 observation 携带计数 | T3 | recovery unit test 验证 scanned/rebuilt/failed 等 |
| TERMINAL_COMMIT_DEGRADED 在降级时发射 | T4 | terminal-commit unit test 覆盖 commit 失败路径 |
| HEALTH_EVALUATED 发射 | T5 | integration test 验证 health endpoint 产生 observation |
| APP_SHUTDOWN 发射 | T6 | unit test 验证 close() 路径 |
| observation 失败不阻断主路径 | T7 | contract test 使用 throwing projector host |
| 新增 StructuredLogEvent 映射正确 | T8 | structured-log-projector unit test |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/internal-lifecycle-observability/spec.md`（新增）
- 架构和跨模块设计：`openspec/designs/architecture/observability.md`（新增，汇总现有和新 observation boundary）

## 风险与取舍（Risks / Trade-offs）

- [风险] `deps.projectorHost` 使 `RequestLifecycleCoordinator` 增加对 `agent-observability` 的依赖 → 缓解：使用 `ObservabilityProjectorHost` interface（小、稳定），且作为可选依赖，不影响 coordinator 的独立可测试性
- [风险] lane drain 路径在高速率下可能产生大量 observation → 缓解：projector host 已有 queue capacity 限制 (1024)，超限时丢弃并记录 degradation metric

## 迁移计划（Migration Plan）

无。本次变更为纯新增 observation，不修改已有行为、API 或数据模型。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/internal-lifecycle-observability/spec.md`：新增，承载本 change 定义的行为契约
- `openspec/designs/architecture/observability.md`：新增，汇总所有 observation boundary 和 signal inventory

## 待确认问题（Open Questions）

无。
