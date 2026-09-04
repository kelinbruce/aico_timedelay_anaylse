## 背景和现状（Context）

当前 execution-engine 应该是 workflow 主线里的第 4 步：承接最小 contract，先把单实例内存执行跑通。若现在就把 distributed claim、snapshot、recovery、rollback/degrade 一起塞进来，会直接破坏 KISS。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 实现单实例 `execute()`
- 支持最小 graph 调度
- 消费 gateway control semantics，但不拥有 gateway 节点定义
- 支持节点级 timeout / retry
- 输出安全的 `WorkflowExecutionEvent`

**非目标：**
- 不实现 distributed scheduling
- 不实现 snapshot / resume
- 不实现 rollback / degrade / advanced exception graph

## 设计决策（Decisions）

1. 首版只支持单实例内存态执行
2. graph 使用 contract 中唯一的 `nodes + next`
3. gateway 相关节点的具体语义由 `gateway-nodes` 提供，engine 只消费其控制语义
4. 引擎只发事件，不拥有 observability sink
5. 中断只通过 `AbortSignal`
6. 节点流式中间态通过可选 observer 上浮，由上层 orchestrator 投影到 runtime timeline

## Execution Request Contract Fields（补充）

`WorkflowExecutionRequest` 在 interaction / restful 等 change 推进过程中扩展了以下可选字段，均向后兼容，由本 change 冻结契约 owner 统一记录：
- `executionMetadata?: JsonObject`：节点执行期可读写的 metadata，当前用于 sub-recipe 深度追踪（`subRecipeDepth`）等非 durable 执行期状态，不进入持久化事实。
- `agentAssemblyRef?: string`：可信 Agent Assembly 引用，用于节点在需要 Agent-owned 资源（如 knowledge 检索的 assembly-scoped 索引）时定位 assembly，只来自 acceptance 时固化的可信 assembly。
- `resumeState?: JsonObject`：waiting 节点 resume 时由上层 runtime 注入的恢复状态，配合 `WorkflowExecutionResult.pendingInput` 实现 pending input 两阶段交互。

`WorkflowExecutionService.execute` 扩展可选 `runtime` 参数，提供 `requestPendingInput(request, signal)` hook，让 interaction 节点能把 pending input 请求委托回 runtime pending input 通道，而不在 workflow 内自建等待语义。该 hook 是 async contract 并接收 `AbortSignal`。
## 最小调度模型

支持：
- 普通节点顺序推进
- gateway handler 提供的条件分支选择
- gateway handler 提供的单进程受控并发
- gateway handler 提供的终止聚合

不支持：
- distributed owner claim
- resume from snapshot
- rollback branch
- degrade branch
- loop
- gateway 节点语义 owner 迁移到 engine 本身

## 失败和降级

- 节点超时 -> retry
- retry 耗尽 -> 检查节点 `exception` 映射（`Record<string, WorkflowBranchDef>`），若存在则按 condition 求值选择跳转目标继续执行；无 `exception` 或无满足条件的分支则终止为 `FAILED`
- recipe 超时 / external cancel -> `INTERRUPTED`
- 节点可见增量输出 -> observer event -> 上层 runtime stream projection

### Exception 后处理跳转（补充）

节点 `exception` 字段是 `WorkflowNodeDef` 的可选字段，复用 `WorkflowBranchDef` 的 condition 求值能力。engine 在节点失败且 retry 耗尽后（abort 检查之后、`FAILED` terminal 之前）调用 `resolveErrorTransition(node, variables)`：
- 若 `exception` 为空 record，终止为 TERMINAL（等同 FAILED）
- 若 `exception` 非空，复用 `resolveWorkflowBranchTransition` 按 condition 求值选择 `CONTINUE` 跳转目标
- 这不引入 rollback / degrade / loop，只支持基于 condition 的异常后跳转

### 失败链优先级顺序

engine 在节点抛错后按固定优先级链处理，顺序为：`retry → abort 检查 → exception → onError → FAILED`。
- `shouldRetry`：若 retry 策略允许重试，递增 attempt 后重新执行节点，不进入后续分支。
- `abort 优先`：`isAbortError(error) && !nodeSignal.didTimeout` 时直接返回 `INTERRUPTED`，不进入 exception/onError，避免 cancel 被吞。
- `exception` 求值：retry 耗尽且非 abort 时，先把 `safeError` 安全标量映射进全局变量，再求值 `exception` 分支；命中则 `CONTINUE` 跳转。
- `onError`：exception 未命中时检查 `onError`（`SKIP` 跳过当前节点 / `JUMP` 跳转目标节点）。
- `FAILED`：以上均未处理则终止为 `FAILED`。

该顺序由 `refine-ts-workflow-failure-priority` change 细化，本 change 冻结其基础形状。
## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 顺序执行 | T1 | integration |
| 条件分支 | T2 | integration |
| 单进程 parallel-gateway | T3 | integration |
| timeout / retry | T4 | integration |
| interrupt | T5 | integration |
| event / delta 安全字段 | T6 | contract test |
| runtime-visible node delta bridge | T7 | integration |

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.1-执行工作流` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/workflow-execution-engine/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
