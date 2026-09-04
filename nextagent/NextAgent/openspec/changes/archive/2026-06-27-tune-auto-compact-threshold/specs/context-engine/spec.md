<!--
本文件是 active change 的行为规格 delta，路径为 specs/context-engine/spec.md。
归档后，仍然成立的行为契约会同步到 openspec/specs/context-engine/spec.md。

本 change 替换既有 summary compression 触发条件：移除"prior_active_history 被预算门
omitted 才触发"的反应式路径，改为以"对话 token 达到有效上下文窗口 − 13,000"为唯一
主动触发条件。属于对既有行为的修改，因此使用 ## MODIFIED Requirements，完整重述修改后的
requirement。
-->

## MODIFIED Requirements

### Requirement: Context Engine SHALL own summary compression orchestration

Context Engine SHALL 在 `assemble()` 中以一个主动上下文窗口阈值作为 summary compression 的**唯一**触发条件：当 `estimatedConversationInputUnits >= availableInputUnits − autoCompactHeadroomUnits` 成立时，Context Engine SHALL 在预算门评估之后编排 summary compression（复用现有 `runSummaryCompression`），不引入第二条压缩实现路径。它消费预算门的预算/估算信号和 summary-generation port，但不得依赖其他模块的 private ports。

Context Engine SHALL NOT 再以"selected prior active-context history 无法安全放入预算（被预算门 omitted）"作为压缩触发条件；该反应式触发路径被移除。当主动阈值未触发时，若预算门仍 omit `prior_active_history`，Context Engine SHALL 按既有 budget-degraded 结果返回，SHALL NOT 触发压缩。

定义（单一来源，不得另建口径）：

- `availableInputUnits = contextWindowTokens − reservedOutput`，其中 `contextWindowTokens` 取自 `modelSelection.modelInfo.contextWindowTokens`，`reservedOutput` 取自有效 `modelOptions.maxOutputTokens`，与预算门 `runBudgetGate` 的计算完全一致。
- `estimatedConversationInputUnits` SHALL 等于预算门已构建的 `sourceCandidates`（required 与 optional 全部候选）的 `estimatedInputUnits` 之和，使用预算门已注入的同一 token estimator。Context Engine MUST NOT 为阈值判断新建第二条 token 估算路径或第二个 estimator。
- `autoCompactHeadroomUnits` 为固定常量，默认值 `13_000`，表达"有效上下文窗口预留的压缩触发余量"，约对应常见 128K 窗口下 90%–92% 的触发点。该值 MUST NOT 由 `ContextAssemblyRequest`、client request body、model output 或 capability arguments 携带。

小窗口安全降级：当 `availableInputUnits <= autoCompactHeadroomUnits` 时（阈值结果非正，会无条件触发），主动阈值触发器 SHALL NOT 触发，压缩不在本轮发生。

不变量保留：触发压缩时，Context Engine 仍 MUST 保护 current-request、visibility、owner-scope、agent-scope 与 protocol 不变量；当 summary-generation port 未配置或压缩失败时，Context Engine MUST 显式回退到既有 budget-degraded / prior-history omission 结果，MUST NOT 伪造成功装配。

设计入口：`openspec/designs/modules/agent-context-engine.md`（阈值触发器落点、与 `runBudgetGate` / `processBudgetOutcome` 的关系、反应式路径移除）；`openspec/designs/adr/`（固定偏移量 13,000 vs 纯比例阈值的取舍）。

#### Scenario: 对话 token 达到有效窗口减余量阈值时触发压缩

- **WHEN** `availableInputUnits = 100_000`、`autoCompactHeadroomUnits = 13_000`、`estimatedConversationInputUnits = 88_000`（>= 87_000）
- **THEN** Context Engine 在本轮 `assemble()` 中触发 summary compression
- **AND** 压缩通过现有 `runSummaryCompression` 编排执行，不调用第二条压缩实现
- **AND** 该触发发生在预算门评估之后

#### Scenario: 未达阈值时不触发压缩

- **WHEN** `availableInputUnits = 100_000`、`autoCompactHeadroomUnits = 13_000`、`estimatedConversationInputUnits = 80_000`（< 87_000）
- **THEN** Context Engine 不触发 summary compression
- **AND** 即使该轮预算门 omit 了 `prior_active_history`，也按既有 budget-degraded 结果返回，不触发压缩

#### Scenario: 小窗口下阈值不无条件触发

- **WHEN** `availableInputUnits = 12_000`、`autoCompactHeadroomUnits = 13_000`（`availableInputUnits <= autoCompactHeadroomUnits`）
- **AND** `estimatedConversationInputUnits` 为任意正值
- **THEN** 主动阈值触发器不触发
- **AND** 本轮不发生压缩

#### Scenario: summary generation 不可用时安全回退

- **WHEN** 阈值触发条件成立
- **AND** `TraceableSummaryGenerationPort` 未配置，或 summary 生成被取消/返回空/返回 unsafe draft，或 `commitCompaction` 失败
- **THEN** Context Engine MUST NOT 提交压缩后的 active context
- **AND** Context Engine 显式回退到既有 budget-degraded / prior-history omission 结果
- **AND** 不伪造成功装配

#### Scenario: 阈值余量不进入请求体

- **WHEN** Context Engine 组装 `ContextAssemblyRequest`
- **THEN** `autoCompactHeadroomUnits` 不出现在 `ContextAssemblyRequest`、client request body、model output 或 capability arguments 中
- **AND** 该值为固定常量，不通过请求面携带
