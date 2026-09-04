## 黑盒目标

- 每次 `assemble()` 在 history selection 之后、large-content truncation 之前，执行一轮 micro-compact 扫描，识别可安全遗忘的旧工具结果并替换为轻量占位符。
- 只清理白名单工具（Bash、Read、Grep、Glob、WebFetch、WebSearch、FileEdit、FileWrite）的结果；自定义 MCP 工具、Agent 编排工具和 Task 类工具永远不进入候选池。
- 累积可压缩工具结果超过 10 个时触发，始终保留最近 5 个，清理最旧的超出部分。
- 不调用模型：候选识别、年龄排序和最近窗口保留全部由本地纯规则完成，无 prompt、无推理、无额外 token 开销。
- 只修改工具返回内容，不修改用户消息、assistant 回复、对话骨架或当前请求上下文。
- 微压缩状态持久化在 `ActiveContextViewRecord` 上，跨请求保持幂等：同一 `messageId` 不会被重复标记。
- 摘要压缩（summary compression）成功后清空微压缩状态，因为上下文已被替换为 summary + retained tail。
- 任何环节失败（状态解析、内容替换）必须安全降级：不阻塞主管线，不修改消息，输出 presentation-safe 诊断。
- 微压缩与现有 `truncateLargeToolResults` 互补而非替代：前者按累积数量清理旧结果，后者按单个大小裁剪超大结果。
- 微压缩在 budget evaluation 之前运行，使预算门看到压缩后的 token 估算，减少 `prior_active_history` 省略量。

## 2. 解决的问题是什么

`add-ts-context-budget-explainability` 和 `add-ts-context-compression` 已经能检测和处理 prior history 超预算的情况。但当前机制有一个结构性缺口：

- **budget policy 的响应粒度太粗**：当历史超预算时，策略只能省略整条 `prior_active_history` 候选，或触发 summary compression 将前缀压成摘要。这两种操作都是"全留或全丢"级别的，缺少中间态的轻量清理。
- **工具调用结果是上下文膨胀的主要来源**：一次长程对话可能产生数十次 Bash 输出、文件读取、搜索结果。这些内容大多是阶段性消费的——模型已经用过一遍，后续参考价值递减。但它们仍以完整形态占据上下文窗口。
- **large-content truncation 只处理单个超大结果**：现有的 `truncateLargeToolResults` 按 8KB 阈值裁剪单个超大结果，但不处理"大量中等大小结果累积"的场景。10 个 5KB 的 Bash 输出总计 50KB，每个都不触发 large-content 阈值，但合起来已经占据大量预算。

本 change 引入 micro-compact 作为 request pre-hook：每轮请求前，以纯本地规则识别可安全遗忘的旧工具结果并替换为占位符。它填补的是"单个结果不大、但累积可观"这个结构性空白，推迟 budget-driven omission 和 summary compression 的触发时机。

## 3. 核心设计和规格

### 3.1 白名单工具

只有以下工具的结果可以进入微压缩候选池：

| 工具 | 入选理由 |
|---|---|
| Bash | 大量输出是一次性消费的日志或命令结果，后续价值递减 |
| Read | 文件内容可以重新读取 |
| Grep | 查询条件稳定时结果可以重新生成 |
| Glob | 文件匹配结果通常可重放 |
| WebFetch | 旧网页内容多数是阶段性证据，必要时可重新抓取 |
| WebSearch | 搜索结果通常只支撑当轮判断 |
| FileEdit | 返回值多是写入确认，不需要长期保留 |
| FileWrite | 返回值多是写入确认，真正状态在文件系统里 |

**不在白名单中的工具：**

- Agent 编排工具（子 Agent 输出不可重放）
- Task/任务管理工具（任务状态不可重放）
- 自定义 MCP 工具（Harness 不知道其是否幂等、是否有副作用、输出是否可重放）
- 所有未显式列入白名单的工具

白名单设计原则：关心的不是"内容是否有用"，而是"丢掉后能不能恢复，或者丢掉是否不会伤害主线"。

### 3.2 触发与保留参数

| 参数 | 值 | 说明 |
|---|---|---|
| `triggerThreshold` | **10** | 累积可压缩工具结果数量超过此值时触发 |
| `keepRecent` | **5** | 始终保留最近的工具结果数量 |

触发逻辑：`compactableCount > triggerThreshold` 时，清理最旧的 `compactableCount - keepRecent` 个工具结果。

### 3.3 执行路径

微压缩只有一条执行路径：in-memory 替换。

- 仅在 in-memory 投影（`HistorySelectionOutcome.recordsByMessageId`）中替换工具结果内容为占位符
- render 阶段对从 messageStore 重新加载的原始记录再次应用替换
- Provider 级缓存保护 deferred 到后续 change

早期设计曾考虑 idle gap 超过阈值时的"冷启动路径"（直接改写持久化内容），但该路径在 provider 缓存保护上没有实际效果——无论是否修改 messageStore，最终发给模型的内容都会变化，provider 缓存前缀都会失效。

### 3.4 管线集成

微压缩集成到 `assemble()` 管线中，在 history selection 之后、large-content truncation 和 budget evaluation 之前：

```
assemble()
  -> loadActiveContext
  -> resolveCapabilities
  -> assemblePrompt
  -> selectHistory              // history selection
  -> microcompactHistory       // NEW: micro-compact
  -> truncateLargeToolResults  // existing: large-content truncation
  -> evaluateBudget            // existing: budget gate
  -> processBudgetOutcome      // existing: compression
  -> buildAssemblyResult
```

render 阶段对重新加载的记录重新应用微压缩替换（与 `truncateRenderedToolResults` 同级）。

### 3.5 状态模型

微压缩状态持久化在 `ActiveContextViewRecord.metadata.microCompactState`：

```typescript
interface MicroCompactState {
  readonly compactedIds: readonly string[]  // 已标记压缩的 messageId
}
```

- 每次 `assemble()` 从 active context 重建状态
- 扫描 `priorTurnCandidates` 识别可压缩工具结果，与已压缩集合取差集得到 fresh 候选
- 超出阈值时标记新候选，更新状态
- 摘要压缩成功后清空状态（上下文已重建，旧 ID 不再有效）

### 3.6 与现有机制的关系

| 现有机制 | 与微压缩的关系 |
|---|---|
| `truncateLargeToolResults` | 互补：微压缩按累积数量清理旧结果，大内容截断按单个大小裁剪超大结果。微压缩先运行。 |
| Budget Gate | 前置：微压缩在预算评估前执行，使预算门看到压缩后的 token 估算。 |
| Summary Compression | 协调：摘要压缩成功后清空微压缩状态。 |
| Large-Content Classifier | 正交：large-content 处理单个结果的持久化/预览，微压缩处理累积结果的清理。 |

## 4. 数据是怎么流转的

```
assemble() 调用
  ↓
selectHistoryCandidates()
  → 产出 HistorySelectionOutcome (currentRequestRecords, priorTurnCandidates, recordsByMessageId)
  ↓
microcompactHistory()                    // NEW
  → 从 priorTurnCandidates 中识别 CAPABILITY_RESULT 消息
  → 按白名单过滤 toolName
  → 读取 ActiveContextView.metadata.microCompactState.compactedIds
  → 计算 fresh 候选 = 全部可压缩 - 已压缩
  → 如果 fresh + 已压缩 > triggerThreshold:
      → 按出现顺序排序全部可压缩候选
      → 保留最近 keepRecent 个
      → 其余标记为 compacted
      → 替换 recordsByMessageId 中对应记录的 content 为占位符
      → 更新 microCompactState.compactedIds
      → 产出 MicroCompactResult（engine 内部类型）
  ↓
truncateLargeToolResults()              // existing
  → 处理剩余的大型工具结果
  ↓
evaluateBudget()                        // existing
  → 看到压缩后的 token 估算
  → 减少 HISTORY_OMITTED_TO_BUDGET 的量
  ↓
render()
  → 从 messageStore 重新加载记录（原始内容）
  → truncateRenderedToolResults()        // existing
  → applyMicroCompactReplacement()      // NEW: 对重新加载的记录重新应用替换
  → 产出 RenderedModelInput
```

冷启动路径已移除。详见 §3.3 执行路径说明。

## 5. 下一步的处理是谁

- `agent-contracts/context`
  - 无变更（`MicroCompactResult` 类型定义在 engine 内部，不暴露在公共契约中）
- `agent-contracts/gateway`
  - `ActiveContextViewRecord.metadata` 扩展 `microCompactState` 字段。
- `agent-context-engine`
  - 新增 `src/micro-compact/` 子模块：
    - `config.ts` — 常量（`COMPACTABLE_TOOL_NAMES`、`triggerThreshold`、`keepRecent`）
    - `candidate-scanner.ts` — 从 `HistorySelectionOutcome` 识别可压缩工具结果（纯函数）
    - `state-manager.ts` — 读写 `MicroCompactState`（纯函数 + metadata 投影）
    - `content-replacer.ts` — 生成占位符内容（纯函数）
    - `micro-compact.ts` — 主编排函数（in-memory 替换）
  - 修改 `assemble-context.ts`：在 history selection 之后插入 micro-compact 步骤。
  - 修改 render 阶段：对重新加载的记录重新应用微压缩替换。
  - 修改 summary compression orchestrator：压缩成功后清空 micro-compact 状态。
- `agent-platform-gateway-local`
  - SQLite `active_context_items` 表的 metadata JSON 扩展 `microCompactState` 字段（向后兼容，缺失时视为空）。
- 后续独立 changes
  - provider 级 cache_edits 优化、thinking 块清理、sub-agent 微压缩隔离策略由后续 change 提出。
