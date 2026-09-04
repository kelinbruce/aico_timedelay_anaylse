## Why

平台集成方在消费请求终态事件时，只能取得请求状态和最终内容。Hook 执行结果虽然已经作为同一运行的内部 `HOOK_INVOKED` 事实持久化，但调用方若要在请求完成时一次取得这些结果，仍需读取并关联整段过程历史；只订阅终态事件的集成无法完成该关联。

本变更让请求终态事件同步携带本次运行已经形成的 Hook 执行结果快照，使实时订阅和刷新后的运行历史给出一致结果，同时保留每条 `HOOK_INVOKED` 作为单次 Hook 执行的权威事实。

## 术语

- `hookResults`：请求终态事件中按原始 invocation 顺序排列的 Hook 执行结果快照。每个条目只复制同一运行已持久化 `HOOK_INVOKED` 的公开允许字段，不产生新的 Hook 结论。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 和 `REQUEST_SUPERSEDED` 同步返回同一运行在终态提交前已持久化的全部 `HOOK_INVOKED` 结果；没有 Hook invocation 时返回空数组。
- `hookResults` 按 `HOOK_INVOKED` 的 timeline sequence 升序排列，每个 invocation 恰好出现一次，并保留其 `hookInvocationId`、`hookId`、stage、status、resolved `failureMode`、可选 outcome 和可选 `resultSummary`。
- SSE、WebSocket、timeline resume 和 REST run-event history 对同一终态事实返回相同的 `hookResults`。
- 非成功 Hook 继续省略其 `outcome` 和 `resultSummary`。
- 终态同步快照必须有界；无法安全、完整地产生快照时，终态保持原有请求状态和内容，通过独立错误码明确表示 Hook 快照不可用，不能返回截断或部分 `hookResults`。
- Hook author 只在 `resultSummary` 已允许通过当前 Owner Scope 和 Agent Scope 的请求终态 stream/history 返回时提供该字段；Runtime 不对结果内容做二次加工。

**非目标：**

- 不替代、删除或修改独立的 `HOOK_INVOKED` timeline fact，也不新增 `HOOK_RESULT` 事件。
- 不把 `HOOK_INVOKED` 本身投影为公开 stream event；只在请求终态 payload 中提供快照。
- 不从 Hook input、boundary、mutation、Capability 输入输出、模型输入输出、日志或原始异常补充结果。
- 不把快照写入最终答复 `content`、assistant message metadata 或 `mutationSummary`。
- 不新增独立 Hook history API、数据库表、配置项、分页、内容 mapper、摘要生成、字段重命名、裁剪或脱敏。
- 不改变 Hook 的执行顺序、failure mode、request lifecycle、终态状态或 Agent loop 行为。

## What Changes

- 修改四类请求终态事件：快照可完整生成时，terminal payload 新增 `hookResults` 数组；不存在历史 Hook invocation 时该数组为空。
- 修改终态 stream/history 公共投影：原样返回 terminal fact 中已验证的 `hookResults`，使 live 与 history 使用同一数据。
- 修改终态提交边界：在提交终态前，以当前可信 Owner Scope、Agent Scope、session、request 和 run 坐标读取本 run 的已持久化 Hook facts，并生成一次不可部分提交的快照。
- 增加容量与失败保证：序列化后的完整 `hookResults` 数组受 `49_000 bytes` UTF-8 上限约束；历史读取失败、记录非法、读取不完整或数组超限时，terminal payload 省略 `hookResults` 并返回固定 `hookResultsErrorCode`，不得改变原请求终态或返回部分数组。
- 修改 Hook producer 安全边界：`resultSummary` 进入终态公开投影，Hook author 必须只提供允许进入当前请求终态 stream/history 的数据；Runtime 仍只做 JSON/容量校验和直接复制，不增加内容处理。
- **BREAKING**：终态 stream payload 可能新增 `hookResults`；严格拒绝未知 payload 字段的消费者必须接受该可选字段。

## Feature 影响（Features）

### 修改的 Feature

- `F-2.4 查看请求状态`：平台集成方可以只消费请求终态事件，一次取得本 run 的 Hook 执行结果快照；实时和历史返回一致，组成 Functions 不变。
- `F-10.1 扩展生命周期钩子`：Hook author 可以让显式结果随请求终态返回，并承担公开结果的数据安全责任；组成 Functions 不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.1 注册和执行钩子` → `specs/lifecycle-hook-execution/spec.md`
  - 功能边界：Hook 显式提供的 `resultSummary` 可进入请求终态公开快照；producer 必须满足该公开边界，Runtime 不加工结果内容。
  - 系统质量属性：安全、审计/可追溯性。
  - 映射说明：canonical spec；依赖 `refine-ts-hook-result-event-summary` 已建立的 Hook 结果与内部 timeline 边界，本 change 新增不同可见面的请求终态公开边界；不触及 legacy spec。
- `FN-2.4 查看请求状态` → `specs/ts-run-status-visibility/spec.md`
  - 功能边界：请求终态事件新增有界、完整、按执行顺序返回的 Hook 结果快照；独立 `HOOK_INVOKED` 仍是单次执行权威事实。
  - 系统质量属性：安全、性能/容量、可靠性/恢复、审计/可追溯性。
  - 映射说明：canonical spec；本 change 不触及 legacy spec。

## 影响范围（Impact）

- 平台集成方：终态 stream payload 可直接读取 `hookResults`，无需额外请求并关联 timeline-only Hook events。
- 最终用户：请求状态和最终答复内容不变；普通 Agent Web 是否展示 Hook 结果不属于本 change。
- 公共契约：`StreamEnvelope.payload` 的终态事件 shape 增加可选字段，REST history 响应沿用相同 envelope。
- Agent 开发者：现有返回 `resultSummary` 的 Hook 必须确认该对象允许进入 authenticated terminal stream/history；不能满足时必须省略该字段。
- 运行与存储：终态 event 的既有 JSON payload 承载新增数组，不需要数据库迁移；终态提交增加一次有界的同 run timeline 读取。
- 验证：需要覆盖四类终态、无 Hook、多个 Hook、失败 Hook、live/history 一致性、scope 隔离、读取失败、非法记录和容量超限。
