## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-4.3 装配上下文` | Retry 后的 prior turn 使用原始用户问题和最新完整可见 attempt，旧 attempt 输出不再导致整轮丢失 | `context-engine` | `FN-4.3 装配上下文` |

## `FN-4.3 装配上下文`

### 目标与规范依据

本设计落实 proposal 中“保留最新有效语义轮次而不恢复旧 attempt”的目标。Context Engine 继续以 `ActiveContextView` 和 immutable message records 为唯一历史 authority，不新增 latest-attempt 推断、持久化写入或 Workflow 专属分支。

#### 本 Function 的目标 Requirements

canonical spec：`context-engine`

- `MODIFIED`：`Prior conversation preserves valid conversation boundaries`

### 当前实现

- `packages/agent-runtime/src/lifecycle/submit.ts` 的 Retry visibility replacement 保留原始 `USER` message，并通过 `listCurrentRequestMessages(... includeHidden: false)` 只加载 source run 中当前可见的非 USER messages 后写入 `metadata.visibility.reason="RETRY_REPLACED"`。执行期 `ASSISTANT_TOOL_USE` 在正常 Tool protocol 中已经 `visible=false`，不会被该查询返回。
- `packages/agent-platform-gateway-local/src/db/sqlite-gateway-core.ts` 的 `hideMessage(...)` 对已经 hidden 的 message 直接返回，不补写新的 visibility reason。因此真实 Tool Retry 的旧 run 可以同时包含“无 replacement reason 的 hidden assistant tool-use”和“带 `RETRY_REPLACED` 的 capability result / terminal answer”。
- `packages/agent-context-engine/src/assembly/active-context-selector.ts` 的 `selectHistoryCandidates(...)` 从单一 `ActiveContextView` snapshot 加载 records，先按 `requestId` 调用 `groupPriorTurns(...)`，再把未加工的整个 unit 传给 `isCompleteVisibleTurn(...)`。
- `isCompleteVisibleTurn(...)` 对 unit 中任一普通 `visible=false` record 返回 false；唯一特例是 `metadata.kind="ASSISTANT_TOOL_USE"` 的执行期 Tool 调用消息。该逻辑没有读取 `metadata.visibility.reason`，因此无法区分 Retry 的旧 attempt 与其他 hidden message。
- 同一 `requestId` 下同时存在旧 attempt 的 `RETRY_REPLACED` messages 和最新可见 attempt 时，旧 hidden record 会使整个 unit 验证失败；原始 `USER` 与最新 terminal answer 因此都不会进入 `priorTurnCandidates`。
- `packages/agent-context-engine/tests/history-candidate-selection.test.ts` 的初始 Tool Retry fixture 给旧 assistant tool-use 人工补写了 `RETRY_REPLACED`，与上述生产持久化形态不一致，因此没有复现旧 tool-use 被保留、旧 result 被过滤后形成孤立协议的缺陷。
- `assemble-context.ts` 通过 `selectActiveContextHistoryCandidates(...)` 使用上述 selector。文件中另有未参与该调用链的同名完整性 helper；本 change 不把该既有重复代码清理扩入行为修复。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 排除 Retry 旧 attempt，同时保留最新完整可见轮次 | 完整性检查直接消费包含全部 attempts 的 raw request unit | 缺少在完整性检查前形成 Retry 后有效消息集合的步骤 |
| 完整 Tool protocol 只由最新 attempt 组成 | 旧 run 的 tool-use 没有 replacement reason，但同 run 的 result / terminal 具有明确 marker | 逐 message 过滤 marker 会留下孤立的旧 tool-use，必须把明确 replacement 扩展到同 request、同 run 的全部非 USER messages |
| 其他隐藏原因和不完整协议继续 fail closed | 当前 generic hidden / protocol 校验已 fail closed | 修复必须只识别明确的 Retry replacement，不得泛化为过滤全部 hidden messages |
| Direct Workflow 与普通请求使用同一规则 | history selector 只消费 message records，不消费 Workflow process events | 验收需要证明通用 selector 足够，且实现不新增 Workflow 分支或 event-to-context 路径 |

### 修改方案

唯一实现路径保留现有 `requestId` 分组和 `isCompleteVisibleTurn(...)`：

1. `groupPriorTurns(...)` 继续按现有顺序产生每个 prior request 的 raw unit，不改变 current-request-first、SUMMARY、snapshot 或排序规则。
2. `selectHistoryCandidates(...)` 对每个 raw unit 收集明确被替换的 run：只读取非 USER record 的受信持久化 metadata；当 `visibility.reason === "RETRY_REPLACED"` 且 `runId` 已定义时，把该 `runId` 加入 request-local `replacedRunIds`。该步骤不比较 run 顺序、时间或值，也不选择 latest attempt。
3. 形成 request-local `effectiveUnit`：保留 root USER；排除带 `RETRY_REPLACED` 的 record；排除 `runId` 属于 `replacedRunIds` 的全部非 USER records。缺少 `runId` 的 Retry marker 只排除自身，不扩展到其他 records。
4. 先形成 `effectiveUnit`，再调用现有 `isCompleteVisibleTurn(effectiveUnit)`。因此真实持久化形态中的旧 assistant tool-use 会随明确被替换的 source run 一起在 Tool 特例之前删除；最新 attempt 中没有 Retry visibility reason 且不属于 replaced run 的合法 Tool 调用仍沿用既有特例和协议校验。
5. 验证通过时只把 `effectiveUnit` 的 message ids 加入 `priorTurnCandidates`，不得把 raw unit 中已过滤的 message id 重新加入。验证失败时沿用既有 `excludedTurnCount` 语义，把该 request 计为一个 excluded turn。
6. `isHiddenReplacement(...)`、`hasOrderedToolProtocol(...)`、budget、compression、render 和 downstream selection 保持不变。非 `RETRY_REPLACED` hidden record 若不属于 replaced run，仍留在 `effectiveUnit` 并由既有完整性检查 fail closed。

该方案不新增类型、port、配置、持久化字段或共享 helper。`replacedRunIds` 与 `effectiveUnit` 都是 selector 内的 request-local 值；新增判断只把已有 message-level replacement marker 投影到同一 `requestId + runId` 的非 USER records。连续 Retry 会收集每个具有明确 marker 的旧 run；没有 marker 时不猜测，不遍历 RequestRun lineage，也不形成第二套 latest-attempt authority。

Direct Workflow 不需要专用实现：其 terminal answer 已使用普通 assistant message carrier，Workflow process events 不属于 `ActiveContextView` message record 输入。通用 prior turn 测试覆盖 USER + terminal answer 的选择；架构审查确认没有新增 event-to-context 转换。

#### 备选方案（Alternatives Considered）

- 按 `requestId + runId` 重新分组并选择最大 attempt：需要 Context Engine 重复 Runtime 的 lineage/latest 语义，还要把无独立 retry USER 的最新 run 与原始 USER 重新拼接；拒绝该方案以避免第二套 attempt authority。
- 修改 Runtime/Gateway 以便给已经 hidden 的 assistant tool-use 补写 replacement reason：需要改变 `hideMessage` 对已隐藏消息的语义，只能修复未来写入且会扩大到 lifecycle、Gateway 幂等和 persistence contract；作为独立 refinement 候选，不进入本 change。
- Retry acceptance 时重写 `ActiveContextView`：会把只读 history selection 缺陷扩大到 Gateway composite write、事务和恢复语义；现有 visibility reason 已足够表达目标，因此拒绝。
- 过滤全部 `visible=false` 或全部 replacement metadata 后再校验：会误删执行期 `ASSISTANT_TOOL_USE` 的合法模型协议消息，也会放宽 Edit、Guard 和其他 hidden reason 的 fail-closed；拒绝泛化。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | 无新增黑盒质量目标；由 `Prior conversation preserves valid conversation boundaries` 功能性 Requirement 派生 | 只解释既有 durable visibility reason，不引入 process-local latest 状态；连续 Retry 使用同一确定规则 | 多次 Retry 后仍只保留最新完整 attempt；visibility metadata 缺失或异常时 fail closed |
| 可维护性 | 无新增黑盒质量目标；由同一功能性 Requirement 派生 | 复用现有分组和协议校验，只增加一个窄判断和局部 effective unit | 无平行 selector、无 Workflow 分支、无公共抽象或 owner 漂移 |
| 可测试性 | 无新增黑盒质量目标；由同一功能性 Requirement 派生 | 在既有 history candidate 测试层构造真实 visibility metadata shape | 纯文本、Tool、连续 Retry、非 Retry hidden 与不完整 latest attempt 均有确定断言 |
| 审计/可追溯性 | 无新增黑盒质量目标；由同一功能性 Requirement 派生 | 只从候选集中排除旧 records，不删除或改写 durable message | hidden old attempts 仍可由既有授权诊断路径读取 |

## 验证策略（Verification Strategy）

- unit / characterization：在 history candidate selection 层构造同一 `requestId` 的 mixed-attempt records，先证明纯文本 Retry 的现有失败，再验证只选择原始 USER、最新 terminal answer 和当前 request。
- protocol regression：覆盖生产同形旧 attempt——assistant tool-use 已 hidden 且没有 replacement reason，同 run capability result / terminal answer 带 marker——以及最新完整 Tool protocol；断言最新序列原样保留且旧 run 全部非 USER records 被排除。
- boundary regression：覆盖连续 Retry、缺少 `runId` 的 marker、完全没有 marker、最新 attempt 缺少 capability result 或 terminal answer、非 `RETRY_REPLACED` hidden reason，以及合法执行期 `ASSISTANT_TOOL_USE visible=false` 的既有行为。
- lifecycle characterization：使用真实 Runtime retry visibility 查询与 SQLite `hideMessage` 语义产生或等价验证持久化 shape，再通过 Context Engine public assembly 入口断言后续模型选择；不得再次用会给所有旧 records 人工补 marker 的 fixture 代替 owner-chain 证据。
- integration / architecture：复用 Context Engine 的 public assembly 入口验证选中 refs 和最终顺序；审查 Direct Workflow process event 没有进入 ActiveContextView/message candidate 路径，且生产代码变更只位于 Context Engine selector。
- OpenSpec / architecture gates：验证 delta 与 stable Requirement 精确合并，且没有 `agent-contracts`、Gateway、Runtime、Workflow、Agent Web 或 persistence 变更。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/context-engine/spec.md`：合并 Retry 后 effective prior turn 与其他 hidden/incomplete fail-closed 行为。
- `openspec/designs/functions/D4-模型与上下文/D4.2-上下文管理与压缩/FN-4.3-装配上下文.md`：刷新处理过程、结果和“Retry 后历史选择”规格项。
- `openspec/designs/features/`：无；Feature 的用户价值与 Function 组成不变。
- `openspec/overview.md`：无；该问题是既有上下文连续性不变量的实现补实。
- `openspec/designs/architecture/core-contracts.md`：把 prior conversation 的 hidden replacement 规则细化为先排除 Retry replacement，再验证剩余完整轮次；其他 hidden/incomplete 继续整体排除。
- `openspec/designs/architecture/request-run.md`：无；Retry lineage、visibility owner 和 model context owner 不变。
- `openspec/designs/modules/agent-context-engine.md`：补充 Retry replacement filtering 在完整轮次校验前执行的模块设计事实。
- `openspec/designs/adr/request-retry-replacement-attempt.md`：无；既有“旧 attempt 可追溯但不进入模型上下文”决策不变。
- `openspec/designs/spec-to-design-map.md`：无；spec、设计承载和验证入口没有新增导航。

## 风险与取舍（Risks / Trade-offs）

- 若某个旧 run 完全没有 `RETRY_REPLACED` reason，本 change 不猜测 latest run，也不掩盖既有 degradation；该 unit 按现有可见事实验证，Runtime 的 visibility failure 继续由既有安全路径处理。
- 若 marker 被错误写入某个 run，run-scope 投影会保守排除该 run 的全部非 USER records，可能减少历史但不会恢复已替换输出或混合 Tool 协议；同 request 限定、精确 `runId` 匹配和完整性校验共同限制影响范围。
- 仅按精确 reason 过滤意味着 malformed、未知或未来新增 reason 不会被自动恢复为有效上下文。这是有意的 fail-closed 取舍，避免新 hidden semantics 未经 OpenSpec 就进入模型输入。
- 过滤发生在 budget/compression 前，可能使合法 prior candidate 数量相对缺陷行为增加；downstream budget 与 compression 仍拥有最终窗口控制，因此不新增容量策略。

## 待确认问题（Open Questions）

无。
