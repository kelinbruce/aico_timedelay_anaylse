## Function

- **所属 Function**：`FN-10.1 注册和执行钩子`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Hook 结果可以直接携带执行后结果输出

`HookResult` MUST 允许 Hook 在任一合法 `PASS`、`SKIP`、`DENY`、`BLOCK` 或 `PEND` 结果中省略或提供一个 `resultSummary: JsonObject`。这里的 `resultSummary` MUST 表示 Hook 显式返回的执行后结果对象，不是 Runtime 生成的摘要。

省略时系统 MUST 保持当前 Hook 控制、mutation、pending 和观测行为，并且 MUST NOT 合成默认值。提供时，系统 MUST 只校验该值是可序列化的 JSON object，并保证包含该对象的完整 `HOOK_INVOKED.inlinePayload` 的 UTF-8 JSON 编码不超过 `49_000 bytes`。显式 `null`、数组、非 JSON 值、循环引用或容量超限 MUST 使整个 `HookResult` 成为非法结果。

除上述 JSON 边界和容量校验外，Runtime MUST NOT 对 `resultSummary` 执行摘要生成、字段筛选、字段重命名、值转换、排序、裁剪、脱敏、补全或业务解释。通过校验的对象 MUST 按 JSON 语义原样进入 event。`resultSummary` MUST NOT 改变 `outcome`、mutation、pending input、failure mode、Agent loop、模型上下文、Capability 调用或 request terminal result。

**需求类别**：功能性需求

#### Scenario: Hook 返回的结果对象被原样接受

- **WHEN** Hook 返回合法 `outcome`，并携带可序列化且使完整 `HOOK_INVOKED.inlinePayload` 不超过 `49_000 bytes` 的 `resultSummary`
- **THEN** 系统 MUST 接受该 `HookResult`
- **AND** 系统 MUST 保留 `resultSummary` 的全部 JSON 字段、嵌套结构、数组、标量和 `null` 值
- **AND** 系统 MUST 继续仅按 `outcome`、mutation 和 pending input 解释 lifecycle 行为

#### Scenario: Hook 可以省略结果输出

- **WHEN** Hook 返回不含 `resultSummary` 的合法 `HookResult`
- **THEN** 系统 MUST 保持既有 Hook 行为
- **AND** 系统 MUST NOT 合成 `resultSummary`

#### Scenario: 非法结果输出使整个 Hook 结果无效

- **WHEN** `resultSummary` 本身是 `null`、数组、包含非 JSON 值或循环引用，或者包含该对象的完整 `HOOK_INVOKED.inlinePayload` 的 UTF-8 JSON 编码超过 `49_000 bytes`
- **THEN** 系统 MUST 将整个 `HookResult` 判定为非法
- **AND** 系统 MUST NOT 应用同一结果中的 mutation、control outcome 或 pending input intent
- **AND** 系统 MUST 按 `Hook failure handling is explicit and bounded by failure mode` 处理该非法结果

### Requirement: Hook 结果输出必须由 Hook 明确负责 timeline 安全性

`resultSummary` 是 Hook 主动提供给内部 timeline 的结果输出。Hook MUST 只把允许进入 `HOOK_INVOKED` 的结果数据放入该字段，MUST NOT 放入 prompt、模型输入输出、Capability 输入输出、Hook input、完整 boundary、mutation 值、Owner Scope、credential、authentication token、附件内容或原始异常。不能保证该边界的 Hook MUST 省略 `resultSummary`。

Runtime MUST NOT 从 Hook input、boundary、mutation、pending input、safe reason、error details 或处理后的 boundary 补充、展开或反推 `resultSummary`。该字段不改变 `HOOK_INVOKED` 的 timeline-only 可见性。

**需求类别**：系统质量属性

**质量属性**：安全
**适用范围**：该 Function

#### Scenario: Runtime 不从其他 Hook 数据合成结果输出

- **WHEN** 合法 `HookResult` 未提供 `resultSummary`，但 mutation、pending input、safe reason、error details 或 boundary 包含处理信息
- **THEN** 系统 MUST 省略 `HOOK_INVOKED.inlinePayload.resultSummary`
- **AND** 系统 MUST NOT 将上述数据复制、摘要或编码到 `resultSummary`

#### Scenario: Runtime 不改写 Hook 提供的结果输出

- **WHEN** 合法 `HookResult` 提供满足边界要求的 `resultSummary`
- **THEN** Runtime MUST NOT 因字段名称或字段值执行额外的内容处理
- **AND** timeline 中的 `resultSummary` MUST 与 Hook 返回对象保持 JSON 语义等价

## MODIFIED Requirements

### Requirement: Every hook invocation produces a timeline-only observability fact

每次 `BEFORE_REQUEST_ACCEPT` Hook invocation，以及每次具有 active accepted-run 坐标的 Hook invocation，MUST 形成恰好一条 timeline-only `HOOK_INVOKED` event。缺少 active accepted-run 坐标的 background model Hook invocation MUST NOT 合成 request-run `HOOK_INVOKED`。事件至少 MUST 能追溯可适用的 `requestRunId`、`sessionId`、`requestId`，以及 `agentId`、`agentVersion`、`hookId`、stage、执行状态、resolved `failureMode` 与耗时。除 Hook 依照 `Hook 结果输出必须由 Hook 明确负责 timeline 安全性` 主动提供的 `resultSummary` 外，系统 MUST 对 event payload 执行既有安全投影；MUST NOT 持久化或投影 prompt、模型输入输出、Hook mutation 值、Owner Scope、原始异常或其他不安全内容。

当 Hook 返回合法 `HookResult` 时，`HOOK_INVOKED` MUST 记录 `status: "SUCCESS"` 和该结果的真实 `outcome`。该结果提供 `resultSummary` 时，系统 MUST 把同一个 JSON 结果对象写入同一事件的 `inlinePayload.resultSummary`；未提供时该字段 MUST 缺失。系统 MUST 保持 `mutationSummary` 只记录由 stage 推导的 mutation kind 和被修改字段名，MUST NOT 将 `resultSummary`、mutation 值或处理后 boundary 值写入 `mutationSummary`。

当 Hook 超时、抛错、不可用或返回非法结果时，`HOOK_INVOKED` MUST 分别记录可适用的 `TIMEOUT`、`FAILED` 或 `INVALID_RESULT` 非成功 `status`，MUST 记录 resolved `failureMode`，并且 MUST 省略 `outcome` 和 `resultSummary`。系统 MUST NOT 为未返回合法结果的 invocation 合成 `outcome: "PASS"`。

对于 `user-query-memory-recall`，系统 MUST 保持既有聚合 `diagnosticCode` 的含义，并以固定、无敏感内容的新增码区分坐标不完整、Assembly/RequestRun/根消息读取失败，以及 L1 搜索和 L2 详情读取的失败或取消。日志还 MUST 在路径适用时记录 L1 候选数、可用 L2 详情数和上下文准入结果。

**需求类别**：系统质量属性

**质量属性**：审计/可追溯性
**适用范围**：该 Function

#### Scenario: Hook 结果输出进入同一条 invocation fact

- **WHEN** run-bound Hook 返回携带合法 `resultSummary` 的合法结果
- **THEN** 对应 `HOOK_INVOKED` MUST 同时记录 `status: "SUCCESS"`、真实 `outcome`、resolved `failureMode` 和与 Hook 返回对象 JSON 语义等价的 `resultSummary`
- **AND** 同一次 invocation MUST NOT 因结果输出产生第二条 timeline event

#### Scenario: 省略结果输出时事件不合成字段

- **WHEN** run-bound Hook 返回不含 `resultSummary` 的合法结果
- **THEN** 对应 `HOOK_INVOKED` MUST 记录 `status: "SUCCESS"`、真实 `outcome` 和 resolved `failureMode`
- **AND** `inlinePayload.resultSummary` MUST 缺失

#### Scenario: 非成功 invocation 不伪造控制结论

- **WHEN** run-bound Hook 超时、抛错、不可用或返回非法结果
- **THEN** 对应 `HOOK_INVOKED` MUST 记录匹配失败事实的非成功 `status` 和 resolved `failureMode`
- **AND** `outcome` 和 `resultSummary` MUST 缺失
- **AND** 系统 MUST NOT 以 `PASS`、`SKIP`、`DENY`、`BLOCK` 或 `PEND` 伪装 Hook 未返回的结论

#### Scenario: 主动召回输出可定位的安全摘要

- **GIVEN** `user-query-memory-recall` 已被调用
- **WHEN** Hook 被跳过、依赖读取失败、L1 未命中或失败、L2 失败、未准入上下文或成功注入
- **THEN** `HOOK_INVOKED` MUST 记录对应阶段的固定 `diagnosticCode`
- **AND** 运维人员 MUST 能仅通过该码区分前置条件、L1、L2、上下文准入和幂等跳过
- **AND** 任意诊断字段均 MUST NOT 包含 Query、Owner Scope、记忆 ID、记忆正文、模型消息、mutation 值或原始异常

### Requirement: Lifecycle-changing hook outcomes are recorded in HOOK_INVOKED without default client projection

当 Hook 返回合法结果时，`HOOK_INVOKED.outcome` MUST 记录该 invocation 的真实 Hook 控制结论，包括改变 request lifecycle 的 `DENY`、`BLOCK` 和 `PEND`。消费者 MUST 先确认 `status: "SUCCESS"`，再使用 `outcome` 识别 Hook 返回的控制结论。非成功 invocation MUST 按 `Every hook invocation produces a timeline-only observability fact` 省略 `outcome`。Runtime MUST NOT 发布单独的 `HOOK_OUTCOME_APPLIED` event；`HOOK_INVOKED` 是 Hook invocation evidence 的单一事实来源。

`HOOK_INVOKED` MUST NOT 默认映射成新的用户可见 `StreamEventType`。对于 `PEND`，`USER_INPUT_REQUIRED` event MUST 携带 `pendingInputId` 供下游关联。

**需求类别**：功能性需求

#### Scenario: Deny is recorded in HOOK_INVOKED without a separate event

- **WHEN** 某个 Hook 合法返回 `DENY` 并改变请求生命周期
- **THEN** Runtime 的 `HOOK_INVOKED` event MUST 记录 `status: "SUCCESS"` 和 `outcome: "DENY"`
- **AND** 系统 MUST NOT 新增单独的 `HOOK_OUTCOME_APPLIED` event
- **AND** 系统 MUST NOT 新增对应的用户可见 stream event type

#### Scenario: Block is distinguishable from deny in HOOK_INVOKED

- **WHEN** 某个 Hook 合法返回 `BLOCK` 并改变请求生命周期
- **THEN** Runtime 的 `HOOK_INVOKED` event MUST 记录 `status: "SUCCESS"` 和 `outcome: "BLOCK"`
- **AND** 消费者 MUST 能通过 `outcome` 区分 `BLOCK` 与 `DENY`

#### Scenario: Pending is recorded in HOOK_INVOKED with USER_INPUT_REQUIRED correlation

- **WHEN** 某个 Hook 合法返回 `PEND` 并导致请求进入等待用户输入状态
- **THEN** Runtime 的 `HOOK_INVOKED` event MUST 记录 `status: "SUCCESS"` 和 `outcome: "PEND"`
- **AND** Runtime MUST 发出携带 `pendingInputId` 的 `USER_INPUT_REQUIRED` event
- **AND** 下游 MUST 能通过 `hookInvocationId` 关联 `HOOK_INVOKED` 与 `USER_INPUT_REQUIRED`

#### Scenario: Pending answer reception reuses existing client-visible input events

- **WHEN** 某个由 lifecycle Hook 触发的 pending input 被正式回答
- **THEN** Runtime MUST 继续沿用既有 `USER_INPUT_RECEIVED` 与 canonical timeline 事实
- **AND** 系统 MUST NOT 为 Hook 恢复路径新增专用的用户可见 stream event type

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：开发者注册 Hook 后，系统在批准阶段执行、校验并解释 Hook 结果；Hook 可通过 `resultSummary` 直接提供执行后 JSON 结果输出，Runtime 不做二次加工，运维人员可从 invocation fact 无歧义地区分执行状态、真实控制结论和失败处置。
- **依据 Requirements**：`Hook 结果可以直接携带执行后结果输出`、`Hook 结果输出必须由 Hook 明确负责 timeline 安全性`、`Every hook invocation produces a timeline-only observability fact`、`Lifecycle-changing hook outcomes are recorded in HOOK_INVOKED without default client projection`

### 输出

- **变更类型**：修改
- **目标内容**：输出成功、超时、失败或非法结果的 Hook invocation fact；合法结果可同时原样输出 Hook 提供的 `resultSummary`，非成功 invocation 不输出伪造的控制结论或结果对象。
- **依据 Requirements**：`Hook 结果可以直接携带执行后结果输出`、`Every hook invocation produces a timeline-only observability fact`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统只校验 Hook 结果及可选 `resultSummary` 的 JSON/容量边界；合法对象原样进入 invocation fact，非法结果不应用任何同批 Hook effect，并按 resolved failure mode 继续或失败；timeline fact 保持内部可观察且不默认进入用户对话 stream。
- **依据 Requirements**：`Hook 结果可以直接携带执行后结果输出`、`Hook 结果输出必须由 Hook 明确负责 timeline 安全性`、`Every hook invocation produces a timeline-only observability fact`、`Lifecycle-changing hook outcomes are recorded in HOOK_INVOKED without default client projection`

### 结果

- **变更类型**：修改
- **目标内容**：Hook 执行后结果具有直接且唯一的 JSON 输出路径；运维与内部集成消费者可通过执行状态、可选真实控制结论、失败模式和可选结果对象解释 invocation，普通用户对话事件集合保持不变。
- **依据 Requirements**：`Hook 结果可以直接携带执行后结果输出`、`Every hook invocation produces a timeline-only observability fact`、`Lifecycle-changing hook outcomes are recorded in HOOK_INVOKED without default client projection`

### 覆盖特性

- **变更类型**：修改
- **目标内容**：`F-10.1 扩展生命周期钩子` 增加 Hook 执行结果输出和无歧义 invocation evidence 的用户价值，组成 Functions 不变。
- **依据 Requirements**：`Hook 结果可以直接携带执行后结果输出`、`Every hook invocation produces a timeline-only observability fact`
