## 设计决策

### D1 Retry 优先级链

节点重试策略解析顺序：
1. 节点级 etry（结构化 RetryPolicy）
2. 节点级 etryPolicy（v1 opaque，向后兼容）
3. untime.defaultRetry（流程级默认）
4. { maxRetries: 0 }（不重试）

gateway 节点（START/END/PARALLEL 等）始终 { maxRetries: 0 }，不重试。

### D2 Timeout 优先级

节点超时解析顺序：
1. 节点级 	imeout（毫秒）
2. 节点级 	imeoutMs（v1，毫秒）
3. 无节点级超时（仅受流程级 untime.timeout 约束）

流程级 untime.timeout 通过 createScopedAbortSignal(signal, runtime.timeout) 作用于整个 executePath，替代 v1 ecipe.timeoutMs。ecipe.timeoutMs 保留为兼容回退。

### D3 controlPolicy 执行

controlPolicy 在本 change 仅定义解析与最小执行：
- cancel/STOP：直接终止流程（已有 INTERRUPT 路径）。
- estart/RESTART：从 START 重新执行（本 change 标记为延期，仅解析不执行）。
- esume/ROLLBACK_*：回滚语义需 persistence 支持，本 change 仅解析 ollbackNode，回滚执行延期到 dd-ts-workflow-persistence-recovery。

### D4 dependsOn 最小实现

dependsOn 不改变当前顺序调度模型（
ext 驱动）。最小实现：节点执行前校验 dependsOn 引用的节点 ID 均已在 
odeResults 中出现且状态为 NODE_COMPLETED。若依赖未完成，抛 WORKFLOW_DEPENDENCY_NOT_SATISFIED SafeError。

不实现并行 DAG 调度（延期到分布式执行 change）。

### D5 onError 废弃

esolveOnErrorAction 函数保留（避免破坏既有测试），但 executeNode 的 catch 路径不再调用它。节点级异常转移统一走 esolveErrorTransition（exception 分支）。onError 字段在 contract 保留为 deprecated。

## 架构影响

- gent-workflow/engine：executeNode/executePath 签名不变，内部消费 v2 字段。
- gent-contracts/core：无变更（由 contracts change 承接）。
- 不引入新 port，不改变跨 package 边界。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.1-执行工作流` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/workflow-execution-engine/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。

## 归档阻塞记录（2026-07-31）

- **状态：**保持 active，禁止使用 `--skip-specs`。
- **原因：**stable `workflow-execution-engine` 中找不到 `Engine Consumes Runtime Config` Requirement。
- **解除条件：**逐 Requirement 建立 delta、stable target、Function 与长期设计的双端映射；确认正文、元数据、Scenario 和任何 REMOVED→ADDED/MODIFIED 迁移均完整同步后，再重新执行 archive。
