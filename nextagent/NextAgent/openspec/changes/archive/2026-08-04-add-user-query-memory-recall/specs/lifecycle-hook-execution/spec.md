## Function

- **所属 Function**：`FN-10.1 注册和执行钩子`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Hook inputs are stage-scoped, minimal, and authority-safe

每次通用 `LifecycleHook` 执行 SHALL 至少接收以下输入：

- `hookId`
- `agentId`
- `agentVersion`
- `agentAssemblyRef?`
- 当前 `stage`
- 与该 stage 对应的 typed `HookBoundary`
- stable safe idempotency key or digest

通用 `HookInput` MUST 只携带当前 stage 已成立且允许暴露的边界事实。通用 `HookInput` MUST NOT 混入 `RequestRun` 全对象、通用 `requestContextId` 引用、`tenantId`、`subjectId`、未经当前 stage 定义的 payload、raw prompt、raw model output、tool args/result、附件正文、secret 或 credential。

runtime MAY 为 app composition 注册的受信终末 Hook executor 提供一个不属于 `LifecycleHook`、`HookInput` 或 plugin SDK 的内部执行上下文。该上下文仅可包含当前请求的可信 Owner Scope、Agent Scope、RequestRun 坐标、已允许的 stage boundary 和 cancellation signal。runtime MUST 只在 AgentAssembly 已激活且 Hook ID 已由 app composition 注册时使用该通道；其他 Hook MUST 继续只接收通用 `HookInput`。

受信终末 Hook MUST 在同一 stage 的普通 observe/impact Hook 完成后执行；其结果生效后 MUST NOT 再执行其他 Hook。受信执行上下文及结果 MUST NOT 被转发、序列化或作为 plugin 配置、模型输入、Web API 或 capability 参数暴露。未注册、未激活或阶段不匹配的 Hook MUST NOT 获得受信上下文，也不得降级为带 Owner Scope 的普通 Hook。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 通用 Hook 仅接收阶段边界事实
- **WHEN** runtime 在任一 stage 调用通用 Hook
- **THEN** `HookInput` MUST 只包含该 stage 的 boundary facts
- **AND** 系统 MUST NOT 将完整请求运行时对象或 Owner Scope 交给通用 Hook

#### Scenario: 受信终末 Hook 在普通 Hook 后执行
- **GIVEN** AgentAssembly 激活了 app composition 注册的受信终末 Hook
- **WHEN** runtime 调用该 Hook 支持的 stage
- **THEN** runtime MUST 先完成同阶段全部普通 Hook，再通过内部上下文执行受信 Hook
- **AND** 普通或 plugin Hook MUST NOT 看到受信 Hook 的作用域或 mutation

#### Scenario: 非受信 Hook 不能请求内部作用域
- **WHEN** 未注册到受信 executor map 的 Hook 声明、配置或尝试读取 Owner Scope
- **THEN** runtime MUST 拒绝该配置或执行路径
- **AND** 系统 MUST NOT 为补齐该 Hook 输入发起跨 owner 探测

### Requirement: Every hook invocation produces a timeline-only observability fact

每次 hook invocation MUST 形成一条 timeline-only `HOOK_INVOKED` event。它至少 MUST 能追溯：

- `requestRunId`
- `sessionId`
- `requestId`（该 run 的根用户消息 ID）
- `hookId`
- `agentId`
- `agentVersion`
- `stage`
- hook kind
- hook effects
- execution strategy
- invocation `status`
- 时间信息
- `outcome`
- `safeReason` 或 `error`
- `mutationSummary`
- ignored observe control diagnostic when applicable

`HOOK_INVOKED` 是 canonical timeline event，但 MUST remain timeline-only and MUST NOT be projected as a public user conversation stream event by default。Observability MUST 从 timeline projection 消费 hook invocation facts。Runtime MUST NOT 暴露单独的 `HookInvocationEvent` contract、listener mechanism 或 first-release hook invocation query API。

`mutationSummary` MUST 只为 runtime 实际应用到 effective boundary 的通用 Hook mutation 生成，并且只含 stage-derived mutation kind 与被替换字段名，不含字段值。受信终末 Hook 的 mutation MUST NOT 产生 `mutationSummary`；其 Query、Owner Scope、记忆正文、记忆 ID、模型消息和 mutation 值 MUST NOT 写入 `HOOK_INVOKED`、timeline、日志、metric、trace 或 audit。受信终末 Hook MAY 写入 runtime 严格校验的安全诊断摘要：固定枚举 `diagnosticCode`、`0..10` 的候选数和详情数，以及枚举化的上下文准入结果。observe-only Hook 返回但被忽略的 mutation 或 control output MUST NOT 产生 `mutationSummary`，且 ignored output 只记录 diagnostic code。

**需求类别**：系统质量属性
**质量属性**：安全、审计/可追溯性
**适用范围**：该 Function

#### Scenario: 成功调用形成 Hook 观测事实
- **WHEN** 任一 Hook 正常完成
- **THEN** 系统 MUST 形成一条 `HOOK_INVOKED`
- **AND** 该事件可被日志和指标从 timeline projection 消费

#### Scenario: 受信终末 mutation 不进入观测 payload
- **GIVEN** 已激活的受信终末 Hook 返回了合法 mutation
- **WHEN** runtime 应用该 mutation
- **THEN** `HOOK_INVOKED` MUST 只记录安全结果与执行状态且不含 `mutationSummary`
- **AND** timeline、日志、metric、trace 和 audit MUST NOT 包含召回内容、模型消息或 mutation 值

#### Scenario: 主动召回输出可定位的安全摘要
- **GIVEN** `user-query-memory-recall` 已被调用
- **WHEN** Hook 成功、跳过、无结果、降级或发生受控失败
- **THEN** `HOOK_INVOKED` MUST 记录固定诊断码、L1 候选数、可用 L2 详情数和上下文准入结果中当前路径适用的安全字段
- **AND** 日志投影 MUST 同时保留 Hook 的耗时和稳定 run/session/request 关联字段
- **AND** 任意诊断字段均 MUST NOT 包含 Query、Owner Scope、记忆 ID、记忆正文、模型消息或 mutation 值

#### Scenario: 失败调用仍形成 Hook 观测事实
- **WHEN** 任一 Hook 超时、抛错或返回非法结果
- **THEN** 系统 MUST 仍形成一条 `HOOK_INVOKED`
- **AND** 其中 MUST 只包含安全的失败状态与诊断信息

## Function 变更汇总

### 输入

- **变更类型**：修改
- **目标内容**：通用 Hook 保持无 Owner Scope 的最小阶段输入；仅 app composition 注册且 Agent 已激活的受信终末 Hook 可取得当前请求的可信作用域。
- **依据 Requirements**：`Hook inputs are stage-scoped, minimal, and authority-safe`

### 处理过程

- **变更类型**：修改
- **目标内容**：runtime 先执行普通 Hook，再执行已激活的受信终末 Hook；受信结果不再传给其他 Hook。
- **依据 Requirements**：`Hook inputs are stage-scoped, minimal, and authority-safe`、`Every hook invocation produces a timeline-only observability fact`

### 结果

- **变更类型**：修改
- **目标内容**：受信终末 Hook 可修改当前阶段边界，但其 mutation 和受保护内容不进入观测 payload；所有 Hook 仍形成安全的 timeline-only 调用事实。
- **依据 Requirements**：`Every hook invocation produces a timeline-only observability fact`
