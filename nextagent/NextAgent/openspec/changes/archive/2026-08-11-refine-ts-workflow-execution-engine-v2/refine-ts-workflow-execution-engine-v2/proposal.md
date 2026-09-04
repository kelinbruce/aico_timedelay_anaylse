## 背景与问题（Why）

efine-ts-workflow-recipe-v2-contracts 已定义 untime/controlPolicy/dependsOn/etry/	imeout contract。当前 InMemoryWorkflowExecutionService 仍消费 v1 字段（etryPolicy/	imeoutMs/onError），未消费 v2 结构化字段，导致 contract 与执行语义脱节。

本 change 让 engine 消费 v2 contract：

- 消费 untime.timeout 作为流程级超时（替代 ecipe.timeoutMs）。
- 消费 untime.defaultRetry 作为节点重试默认值，节点级 etry 覆盖默认。
- 消费 controlPolicy 执行流程级暂停/恢复/取消/重启策略。
- 消费 dependsOn 做 DAG 依赖调度（最小实现：节点执行前校验依赖已完成）。
- 废弃 onError 消费，节点级异常转移统一走 exception。

## 变更范围（What Changes）

- **修改** executePath/executeNode：消费 untime.timeout/defaultRetry/controlPolicy。
- **修改** parseRetryPolicy：优先消费结构化 etry，回退 etryPolicy，再回退 untime.defaultRetry。
- **修改** createScopedAbortSignal：节点 	imeout（毫秒）优先于 	imeoutMs。
- **新增** esolveControlPolicy：解析 untime.controlPolicy 决定恢复/取消/重启的回滚策略。
- **新增** DAG 依赖校验：节点执行前校验 dependsOn 节点已完成。
- **移除** esolveOnErrorAction 消费路径（保留函数但 engine 不再调用）。

## 不在范围内（Explicit Non-Goals）

- 不实现分布式调度（由 dd-ts-workflow-distributed-execution 延期）。
- 不实现 untime.profile 多执行器路由。
- 不实现 untime.incremental/persistence.checkpoint 持久化（由 dd-ts-workflow-persistence-recovery 承接）。
- 不实现 suspend 节点恢复语义。

## Capability 影响（Capabilities）

### 修改的 Capability

- workflow-execution-engine：消费 v2 contract，执行语义对齐。