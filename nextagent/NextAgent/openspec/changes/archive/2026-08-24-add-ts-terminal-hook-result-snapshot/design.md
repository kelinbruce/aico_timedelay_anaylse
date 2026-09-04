## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.1 注册和执行钩子` | Hook 显式结果在保持原样语义的同时，扩展为可进入同一 run 终态快照的安全输出 | `lifecycle-hook-execution` | `FN-10.1 注册和执行钩子` |
| `FN-2.4 查看请求状态` | 四类请求终态一次返回同 run 完整 Hook 结果快照，live、resume 与 history 一致 | `ts-run-status-visibility` | `FN-2.4 查看请求状态` |

## `FN-10.1 注册和执行钩子`

### 目标与规范依据

proposal 要求 Hook author 只提供允许返回给当前可信 scope 调用方的 `resultSummary`，Runtime 不生成、改写或补充该对象。前置 change `refine-ts-hook-result-event-summary` 建立的单一 `HookResult.resultSummary` 和 `HOOK_INVOKED` 事实仍是唯一来源；本 change 只扩展该结果允许进入的输出面，不公开 `HOOK_INVOKED` event 本身。

#### 本 Function 的目标 Requirements

canonical spec：`lifecycle-hook-execution`

- `ADDED`：`Hook 结果输出必须满足请求终态公开边界`

### 当前实现

- `HookResult` 的两个 union branch 已复用 `resultSummary?: JsonObject`，Plugin SDK 与 Runtime 共用该公共契约。
- `LifecycleHookStageExecutor` 已在应用 Hook effect 前校验并 detach 该 JSON object，使完整 `HOOK_INVOKED.inlinePayload` 受既有 `49_000 bytes` 限制。
- 成功 invocation 在单条 `HOOK_INVOKED` 中记录真实 `outcome`、resolved `failureMode` 和可选 `resultSummary`；非成功 invocation 省略 `outcome/resultSummary`。
- `HOOK_INVOKED` 仍被 Channel 分类为 `TIMELINE_ONLY`，当前终态投影不读取其结果。
- 当前安全 Requirement 只允许 `resultSummary` 进入内部 timeline，与本 change 的终态公开输出目标冲突。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| Hook 结果可安全进入同 run 终态快照 | 安全规范限定 timeline-only | 需在原 Requirement 中精确扩展允许面，不能新建平行安全语义 |
| 返回对象与 Hook 输出 JSON 语义等价 | 现有 executor 已校验并 detach | 不需要新处理层，但需防止终态路径重新生成或改写内容 |
| `HOOK_INVOKED` 仍不公开 | Channel 已拦截该 event | 需 negative regression 证明公开的只是终态快照字段 |

### 修改方案

唯一路径是在同一 canonical spec 新增请求终态公开边界 Requirement：前置 change 继续唯一拥有内部 timeline 安全性，本 Requirement 唯一拥有 authenticated terminal stream/history 可见性。Hook producer 必须同时满足两个输出面，但它们不定义平行字段或结果事实。实现继续复用 validated/detached `resultSummary`，不修改 `HookResult`、Plugin SDK、Hook executor、`HOOK_INVOKED` payload 和既有容量校验。

终态快照 builder 只能从 persisted `HOOK_INVOKED.inlinePayload.resultSummary` 取值，并按 JSON 语义直接复制已有对象。它不读取 Hook input、boundary、mutation、Capability 或 Model 输入输出，不新增 mapper、sanitizer、redactor 或 summary generator。

`agent-channel-common` 的 visible event 闭集不新增 `HOOK_INVOKED`；后续 Channel 只投影 persisted terminal fact 中的 `hookResults`。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Hook 结果输出必须满足请求终态公开边界` | Hook producer 明确承担公开输出责任；Runtime 不从其他数据合成或加工 | 禁止合成，原样 JSON，`HOOK_INVOKED` 仍 timeline-only |
| 审计/可追溯性 | `Hook 结果输出必须满足请求终态公开边界` | 终态条目只复制单条 invocation 权威事实的允许字段 | invocation 一一对应，无第二 truth source |

## `FN-2.4 查看请求状态`

### 目标与规范依据

proposal 要求四类请求终态都同步返回当前 run 完整、有序、有界的 Hook 结果快照；无法完整生成时保留原请求终态并返回明确错误码。本 change 已经用户明确确认，作为 terminal `StreamEnvelope.payload` 公共 shape 的契约升级实施。

#### 本 Function 的目标 Requirements

canonical spec：`ts-run-status-visibility`

- `ADDED`：`请求终态同步返回 Hook 执行结果快照`
- `ADDED`：`Hook 终态快照必须保持作用域隔离`
- `ADDED`：`Hook 终态快照必须保持有界完整性`
- `ADDED`：`Hook 终态快照不可用时必须保留原请求终态`
- `ADDED`：`Hook 终态快照在实时与历史中必须一致`

### 当前实现

- `agent-runtime` 在 `BEFORE_AGENT_TERMINAL` Hook 完成后调用 `commitTerminalOutcome(...)`，由 `RequestRunStoreGateway.commitTerminal(...)` 原子写入 terminal assistant message、terminal event 和 run 终态。
- terminal event 当前只写入 `content`、`terminalMessageId` 和失败时的安全 `code/category`，没有 Hook 快照。
- runtime 拥有 `RunTimelineEventStoreGateway.listEvents(...)`，可以用可信 tenant、subject、agent、session、request 和 run 坐标按 sequence 读取 timeline；gateway 单页上限为 `1_000`。
- `agent-channel-common` 对四类 terminal event 使用同一 projector branch；SSE、WebSocket、resume 和 REST run-event history 复用该投影。
- 普通 conversation history 来自 assistant message，不是 run-event history，不应重建 Hook 快照。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 四类 terminal payload 含完整 `hookResults` 或唯一错误码 | terminal fact 未携带 Hook 数据 | 需在终态原子提交前生成一次快照并写入 terminal fact |
| 只读取当前可信 scope/request/run | timeline gateway 已提供所有坐标 | 需用全坐标发起读取，不得从请求 payload 接受 scope |
| 多页历史不丢失、不重复 | 单页最多 `1_000` 条 | 需内部顺序读取至空页，并防止 sequence 不推进 |
| 超限或读取/校验失败不改写 request terminal | terminal commit 当前无快照降级语义 | 需把快照失败收敛为三个公开错误码，不抛出覆盖业务终态 |
| live/resume/history 一致 | 四个 surface 已复用 terminal projector | 需 projector 校验并复制 persisted terminal 快照字段 |

### 修改方案

`agent-runtime` 是快照聚合和 terminal fact 的唯一 owner；`agent-channel-common` 只拥有公共 stream projection。不新增 Gateway port、Record、表、Hook event type、history API 或 Channel 业务真相。

#### 1. 终态提交前构建单次快照

`submit.ts` 的既有 `commitTerminal(...)` 在 `BEFORE_AGENT_TERMINAL` 完成后、`commitTerminalOutcome(...)` 之前调用私有 snapshot builder。builder 使用 `command.identityContext`、run-bound `agentId/sessionId/requestId/runId` 组成查询，不从 client metadata 或 Hook 输出接受 scope。

读取固定从 `afterSequence = 0` 开始，每页 `limit = 1_000`，页满时用最后 sequence 继续，直到返回少于上限的页。每页必须严格升序且跨页推进；不推进或重复 sequence 归类为 unavailable。复用既有 `5_000 ms` timeline read timeout，不新增配置。

builder 仅选取 `type === "HOOK_INVOKED"` 的 record，并按 `ts-run-status-visibility` delta spec 唯一定义的公共 entry schema 验证和投影。其他 persisted `HOOK_INVOKED` timeline-only 字段可以存在，但不进入 snapshot entry；该公共 schema 不在 design 中重复定义。

builder 对完整 `hookResults` 数组使用 `Buffer.byteLength(JSON.stringify(value), "utf8")`计算容量。上限直接复用 `maxTimelineInlinePayloadBytes = 49_000`，不新增可配置值；这一上限约束快照数组，不改写既有 terminal `content` 规则。

builder 的结果是二选一：

| 内部结果 | 条件 | terminal payload delta |
|---|---|---|
| `AVAILABLE` | 历史完整、全部 matching fact 合法且数组不超限 | `hookResults`，可为 `[]` |
| `UNAVAILABLE` | 读取失败、超时或 sequence 不推进 | `hookResultsErrorCode: "HOOK_RESULTS_UNAVAILABLE"` |
| `INVALID` | matching fact 不满足上述 shape 不变量 | `hookResultsErrorCode: "HOOK_RESULTS_INVALID"` |
| `LIMIT_EXCEEDED` | 完整数组超过 `49_000 bytes` | `hookResultsErrorCode: "HOOK_RESULTS_LIMIT_EXCEEDED"` |

私有结果不持久化为独立状态；它只作为当次 terminal event payload 的输入。失败时不抛出改写 request status，不返回已收集前缀。

#### 2. 与原终态事实一次提交

runtime-private terminal commit 入口把必填的互斥 snapshot result 赋值给既有 terminal event `inlinePayload`；公开导出的 `TerminalCommitOptions` 不承载该内部结果。既有公开 `commitTerminalOutcome(...)` 在没有 runtime lifecycle 聚合上下文时显式写入 `HOOK_RESULTS_UNAVAILABLE`，不得把缺失快照伪装为 `hookResults: []`。终态继续通过既有 `commitTerminal(...)` composite write 与 terminal message/run status 原子提交，不增加第二次 write、第二个 event 或表。

同一 run 的 Hook 在 snapshot build 前已完成。进入 builder 后不再执行 lifecycle Hook，因此读到的 persisted invocation 集合是当次 terminal fact 的完整边界。终态幂等重放仍使用首次 committed terminal fact，不重新聚合或覆盖快照。

#### 3. Channel 只投影 terminal fact

`agent-channel-common` 四类 terminal event 共享分支增加同级 snapshot projector。它仅复制规格允许的条目字段，`resultSummary` 只做 JSON shape validation 后直接复用，并对完整 `hookResults` 复验 `49_000 bytes` UTF-8 上限；不执行内容转换。非法或超限的 persisted terminal payload 继续使用既有 projection-failure 边界，不借此伪造 snapshot builder 的 `HOOK_RESULTS_INVALID` 或 `HOOK_RESULTS_LIMIT_EXCEEDED` 结果。

SSE、WebSocket、resume 和 REST run-event history 不各自重新读取 Hook history，仍共享该 projector。conversation history 不修改。

黑盒效果示例：Bash Capability 执行后，Hook 显式返回 `{ "a": 1, "b": 2 }`，请求完成时 Channel 收到的 terminal envelope 包含：

```json
{
  "eventType": "REQUEST_COMPLETED",
  "payload": {
    "status": "COMPLETED",
    "content": "done",
    "hookResults": [
      {
        "hookInvocationId": "hook-invocation-1",
        "hookId": "bash-result-hook",
        "stage": "AFTER_CAPABILITY_RESULT",
        "status": "SUCCESS",
        "failureMode": "CONTINUE",
        "outcome": "PASS",
        "resultSummary": { "a": 1, "b": 2 }
      }
    ]
  }
}
```

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Hook 终态快照必须保持作用域隔离` | 全可信 scope 查询，只投影允许字段 | 跨 owner/agent/session/request/run negative case |
| 性能/容量 | `Hook 终态快照必须保持有界完整性` | `1_000` 条内部分页、`49_000 bytes` 快照上限、无截断 | 多页完整性、边界值与超限 |
| 可靠性/恢复 | `Hook 终态快照不可用时必须保留原请求终态`、`Hook 终态快照在实时与历史中必须一致` | 快照失败不改写请求终态；快照与 terminal fact 原子提交 | read timeout/failure、resume/history 一致 |
| 审计/可追溯性 | `请求终态同步返回 Hook 执行结果快照` | sequence 升序、invocation 一一复制、`HOOK_INVOKED` 保持权威事实 | 无遗漏、无重复、无第二 truth source |
| 可测试性 | `Hook 终态快照在实时与历史中必须一致` | 所有 Channel surface 共享一个 terminal projector | 同 persisted fact 的 surface 等价性 |

### 备选方案（Alternatives Considered）

- 终态时只返回最后一个 Hook：无法表达多 stage/多 Hook 历史，且会丢失已有事实；不采用。
- 把结果放入 terminal `content`、assistant metadata 或 `mutationSummary`：混淆用户答复、消息持久化和 Hook mutation 语义；不采用。
- Channel 在投影终态时再读取 `HOOK_INVOKED`：会让 transport 拥有 runtime truth 聚合，live/history 可能漂移；不采用。
- 为 `hookResults` 新增表或第二个 terminal-adjacent event：既有 terminal JSON fact 已能原子承载，会新增真相与事务同步成本；不采用。

## 跨 Function 协作与端到端流程

1. `FN-10.1` 的既有 Hook executor 校验并持久化单条 `HOOK_INVOKED`，Hook author 对可选 `resultSummary` 的公开安全性负责。
2. 同 run 的 `BEFORE_AGENT_TERMINAL` 完成后，`FN-2.4` 的 runtime terminal owner 用可信坐标读取全部 persisted timeline，构建完整快照或唯一错误码。
3. runtime 把该结果与原 terminal message/run/event 一次提交；幂等重放复用首次事实。
4. Channel 只投影该 terminal fact，SSE、WebSocket、resume 和 REST run-event history 给出一致结果；`HOOK_INVOKED` 仍不作为公开 event 返回。

## 跨 Function 质量属性设计（Cross-Function Quality Attributes）

| 质量属性 | 影响 Functions 与规范依据 | 共享或端到端机制 | 端到端验证 |
|---|---|---|---|
| 安全 | `FN-10.1` 安全责任 Requirement；`FN-2.4` 作用域隔离 Requirement | producer 限定内容，runtime 用可信 scope 聚合，Channel 仅投影允许字段 | 合法 Hook 结果原样到达终态，禁止字段和跨 scope fact 不到达 Channel |
| 审计/可追溯性 | `FN-10.1` 结果事实 Requirement；`FN-2.4` 快照 Requirement | invocation fact 是权威来源，terminal 只形成一次有序快照 | 每个 persisted invocation 恰好对应一个 terminal entry，重连不改变结果 |

## 验证策略（Verification Strategy）

- contract：固定四类 terminal payload 的 `hookResults | hookResultsErrorCode` 互斥契约、entry 字段闭集和三个错误码，同时证明 `HOOK_INVOKED` 仍不是公开 stream type。
- runtime unit/kernel：使用真实 terminal commit 路径覆盖无 Hook、多 Hook、四类终态、成功/非成功、原样 `resultSummary`、排序、分页、幂等重放和快照失败不改写原终态。
- gateway/integration：验证全坐标查询、多页 sequence 推进和 terminal composite write 中快照与终态事实的一致性。
- Channel contract/integration：对同一 persisted terminal fact 比较 SSE、WebSocket、resume 与 REST history；验证 conversation history 不合成快照。
- negative cases：跨 Owner/Agent/session/request/run、非法字段/闭集值、非成功伪 outcome/resultSummary、读取超时/失败/不推进、数组超限和 projector 防御均断言安全黑盒结果，不锁死私有 helper 名称。
- architecture/人工审查：确认 runtime 仍拥有 terminal truth，Channel 只投影；未新增目录、公共 API、Gateway DTO、表、event type、内容 mapper 或第二 Hook truth source。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/lifecycle-hook-execution/spec.md`：在前置 change 的内部 timeline 安全性 Requirement 之外，新增 `Hook 结果输出必须满足请求终态公开边界`。
- `openspec/specs/ts-run-status-visibility/spec.md`：新增终态 Hook 快照、有界完整性和 live/history 一致 Requirements。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.1-注册和执行钩子.md`：更新 resultSummary 公开输出责任。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.4-查看请求状态.md`：更新终态快照输出与处理路径。
- `openspec/designs/features/D10-二次开发与平台集成/D10.1-扩展与插件/F-10.1-扩展生命周期钩子.md`：更新 Hook 结果作为 authenticated terminal 输出的平台集成价值。
- `openspec/designs/features/D2-请求运行时/D2.2-请求状态与处理/F-2.4-查看请求状态.md`：更新终态一次返回 Hook 结果的用户价值。
- `openspec/designs/architecture/core-contracts.md`：更新 terminal payload 的 `hookResults | hookResultsErrorCode` 契约边界。
- `openspec/designs/architecture/request-run.md`：更新终态提交前快照构建与原子提交边界。
- `openspec/designs/architecture/stream-projection.md`：更新 terminal Hook 快照的共享投影与 live/history 一致性。
- `openspec/designs/architecture/observability.md`：更新 `HOOK_INVOKED` 权威事实与 terminal 只读快照关系。
- `openspec/designs/modules/agent-runtime.md`：更新 snapshot builder 和 terminal fact owner。
- `openspec/designs/modules/agent-channel-web.md`：更新 Web Channel 复用共享 terminal snapshot projector 的边界。
- `openspec/overview.md`：无；顶层范围不变。
- `openspec/designs/adr/`：无；未引入新的不可逆架构决策。
- `openspec/designs/spec-to-design-map.md`：导航目标不变；归档时更新两个 Function 的验证说明。

## 风险与取舍（Risks / Trade-offs）

- 将 Hook-owned JSON 从内部 timeline 扩展到 authenticated terminal stream/history 会放大错误 Hook 实现的数据泄露影响。缓解方式是把允许面写入同一 producer Requirement，并在实施检视中审核所有实际返回 `resultSummary` 的 built-in Hook。
- 终态前增加 timeline 读取会增加有界延迟。复用已有 timeout、分页上限和 49 KB 容量上限；失败时优先保证原请求终态可提交。
- 终态 payload 新增字段可能影响严格拒绝未知字段的外部 consumer。本 change 按用户已确认的公共 contract 升级推进，不增加 alias 或双写窗口。
- 并行 active change `refine-system-event-business-language` 也修改 `ts-run-status-visibility`，但不修改本 change 的 Requirement 名称或 terminal Hook 快照 schema。归档时必须按 Requirement 名称合并两组 delta，不能以文件覆盖方式丢失任一 change。

## 迁移与回滚（Migration / Rollback）

- 本 change 依赖 `refine-ts-hook-result-event-summary` 已先实施并保持同一 Requirement 名称；合并/归档顺序必须先前置 change、后本 change。
- 数据库无需迁移；terminal event 已使用开放 JSON `inlinePayload`。新 consumer 必须同时处理 `hookResults` 与 `hookResultsErrorCode`。
- 回滚时整体恢复 runtime terminal builder 和 Channel projector；已持久化的新 terminal payload 在旧 projector 中被开放 JSON 边界忽略，原 request terminal status/content 仍可读取。
- 回滚验证四类 terminal 仍可投影原字段，并确认 `HOOK_INVOKED` timeline fact 未被修改或删除。

## 待确认问题（Open Questions）

无。用户已明确确认在终态事件中新增 Hook 历史结果承载能力，并确认 `resultSummary` 必须使用 Hook 执行后输出、Runtime 不做额外处理。
