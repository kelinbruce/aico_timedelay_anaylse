## 背景和现状（Context）

workflow 能力组当前最缺的是统一 public contract，不是调度策略、恢复机制或分布式执行语义。若 contract 先把 snapshot、distributed owner、rollback/degrade 等高复杂行为固化进去，会让后续 change 丧失 KISS 和唯一实施路径。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 冻结 workflow 最小 public contract
- 为 package-composition、recipe-dispatch、execution-engine 提供统一输入输出形状
- 保持 contract 足够薄，不提前定义恢复、持久化和多实例语义

**非目标：**
- 不定义 persistence/recovery contract
- 不定义 event durable store
- 不定义 distributed scheduling
- 不定义节点私有业务字段

## 设计决策（Decisions）

- Recipe 是静态 Recipe 1.0 DSL 资源，进入 catalog 后的运行时可执行语义统一为 `CapabilityKind.WORKFLOW`。
- `CapabilityKind` 的 durable vocabulary 为 `TOOL | SKILL | AGENT | WORKFLOW`；不保留 `RECIPE` 兼容分支，避免同一运行时能力出现两种 kind。
- 资源层的 `RecipeDefinition`、`recipeName`、`RECIPE_CHOICE`、RAG `indexType: RECIPE` 不属于 capability kind，不随本次统一改名。

1. workflow contract 归 `agent-contracts/core`
2. `WorkflowNodeType` 归 `agent-common`
3. `FlowGraph` 只采用一套结构：`nodes: Record<string, WorkflowNodeDef>`
4. 节点连接只用 `next` map，不引入独立 `edges`
5. `WorkflowExecutionService` 只定义 `execute()` 和可选 observer，不定义 `resume()` 或 `recover()`
6. `WorkflowExecutionEvent` 只表达节点生命周期观测与安全可见 delta，不表达 durable persistence
7. `inputs`、`outputs`、`outputParser` 只保留 opaque `JsonObject`

## 最小契约面（Minimal Contract Surface）

### WorkflowNodeType

首版冻结 workflow 能力组共用 vocabulary。当前 change 允许保留 roadmap 已确认的节点类型集合，但它们只表示节点分类，不绑定对应节点私有 schema 或执行策略。

### RecipeDefinition

最小字段：
- `recipeName`
- `version`
- `displayName`
- `description?`
- `flowGraph`
- `timeoutMs?`
- `priority?`

可选 opaque 字段：
- `type?`（`"recipe"` | `"boot-recipe"`，默认 `"recipe"`；补充：用于标识 boot-recipe，routing 据此自动进入）
- `inputSchema?`
- `outputSchema?`

不在本 change 定义：
- recipe durable metadata
- version rollout / publish policy
- marketplace / remote source metadata

### FlowGraph

`FlowGraph` 只包含：
- `nodes: Record<string, WorkflowNodeDef>`

`WorkflowNodeDef` 只包含：
- `type: WorkflowNodeType`
- `description?`
- `inputs?`
- `outputs?`
- `outputParser?`
- `timeoutMs?`
- `retryPolicy?`
- `onError?`
- `exception?`（补充：`Record<string, WorkflowBranchDef>`，节点运行异常后处理跳转）
- `next: Record<string, WorkflowBranchDef>`

`WorkflowBranchDef` 只包含：
- `condition?: string`

本 change 不定义：
- `loop`
- `rollback`
- `degrade`
- `default branch` 以外的高级控制流语义

> 补充：`exception` 字段已后续追加为 `WorkflowNodeDef` 的可选字段（`Record<string, WorkflowBranchDef>`），复用 branch condition 求值实现节点异常后跳转，不引入 loop / rollback / degrade。

### WorkflowExecutionService

```ts
execute(
  request: WorkflowExecutionRequest,
  signal: AbortSignal,
  observer?: WorkflowExecutionObserver
): Promise<WorkflowExecutionResult>
```

`WorkflowExecutionRequest`：
- `recipeName`
- `recipeVersion`
- `inputVariables`
- `identityContext`
- `agentId`
- `agentVersion`
- `sessionId`
- `requestId`
- `runId`
- `requestContextId`

`WorkflowExecutionResult`：
- `executionId`
- `status: "COMPLETED" | "FAILED" | "INTERRUPTED"`
- `outputVariables`
- `nodeResults`
- `startedAt`
- `completedAt`

`WorkflowNodeResult`：
- `nodeId`
- `nodeType`
- `status: "NODE_COMPLETED" | "NODE_FAILED" | "NODE_SKIPPED"`
- `output?`
- `safeError?`
- `retryCount`
- `startedAt`
- `completedAt`

### WorkflowExecutionEvent

仅用于 engine lifecycle 观测：
- `executionId`
- `nodeId`
- `nodeType`
- `eventType`
- `visibleDelta?`
- `output?`
- `safeError?`
- `retryCount`
- `startedAt`
- `completedAt`

`visibleDelta` 只允许：
- `channel: "CONTENT" | "THINKING"`
- `content: string`

禁止包含：
- prompt
- raw model output
- raw capability result
- secret
- path

## 触发机制（Trigger）

- 编译期：类型检查
- 启动期：recipe schema 校验
- 运行期：engine 通过 `execute()` 消费该 contract

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 单一 DSL 结构 | T1 | contract test |
| port 签名稳定 | T2 | contract test |
| Event / observer 安全边界 | T3 | contract test |
| `AgentAssembly.recipeIds` 可选扩展 | T4 | contract test |

## 风险与取舍（Risks / Trade-offs）

- [contract 过薄] -> 允许后续 change 做 refinement，但当前避免过早冻结复杂语义
- [节点类型先多后少] -> 当前只把它们视为 vocabulary，不把执行细节写进 contract

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.1-执行工作流` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/ts-core-contracts/spec.md`、`openspec/specs/workflow-contracts/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
