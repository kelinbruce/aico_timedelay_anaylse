## Function

- **所属 Function**：`FN-10.13 HarnessBench 评测`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: 评测失败提供安全诊断

系统 MUST 为每个非成功 task 提供唯一的安全失败阶段和闭集原因码，并 MUST 区分候选准备、会话创建、请求提交、stream 等待、terminal、工作区导出、HarnessBench 进程和 grader 阶段。报告 MUST 记录模型请求和工作区产物是否已观测到，并 MUST 只使用 run-relative evidence ref。NextAgent request 进入失败 terminal 时，系统 MUST 优先保留公开 stream 提供的安全原因码；公开 stream 未提供安全原因码且 terminal status 为 `failed` 时，系统 MUST 使用 `TERMINAL_FAILED`，不得使用 `UNKNOWN`。

**需求类别**：系统质量属性

**质量属性**：审计/可追溯性
**适用范围**：该 Function

#### Scenario: terminal 失败保留公开安全原因码

- **WHEN** NextAgent request 进入失败 terminal 且公开 stream 提供安全原因码
- **THEN** task 仍 MUST 按零分进入固定分母
- **AND** 报告 MUST 记录 `failurePhase=terminal`、公开 stream 提供的安全原因码、模型请求证据和工作区产物观测结论

#### Scenario: failed terminal 缺少公开安全原因码

- **WHEN** NextAgent request 进入 `failed` terminal 且公开 stream 未提供安全原因码
- **THEN** task 仍 MUST 按零分进入固定分母
- **AND** 报告 MUST 记录 `failurePhase=terminal`、`failureReasonCode=TERMINAL_FAILED`、模型请求证据和工作区产物观测结论
- **AND** 报告 MUST NOT 为该失败记录 `failureReasonCode=UNKNOWN`

## ADDED Requirements

### Requirement: 多轮 adapter 证据形成单一安全诊断

当一个 HarnessBench task 包含一个或多个按执行顺序排列的 adapter 轮次结果时，评测报告 MUST 检查全部轮次中的安全结构化证据；非成功 task 的 `failurePhase` 和 `failureReasonCode` MUST 取最后一个同时包含合法失败阶段和安全原因码的失败轮次。`workspaceOutcomeObserved` MUST 在任一轮明确记录已观测工作区结果时为 `true`，否则为 `false`。报告 MUST NOT 因末轮摘要缺少失败字段而丢弃更早轮次的合法安全证据，也 MUST NOT 把原始 stdout、prompt、模型输出或异常正文复制到诊断字段。

**需求类别**：系统质量属性

**质量属性**：审计/可追溯性
**适用范围**：该 Function

#### Scenario: 末轮摘要不覆盖前序明确失败
- **WHEN** 一个非成功 task 的前序 adapter 轮次包含合法 `STREAM_WAIT_FAILED` 失败证据，而末轮摘要不包含合法失败字段
- **THEN** 报告的 `failurePhase` 和 `failureReasonCode` 分别为该前序证据的 `stream_wait` 和 `STREAM_WAIT_FAILED`
- **AND** 报告不包含该轮次的原始 stdout、prompt、模型输出或异常正文

#### Scenario: 多个明确失败采用最后一项
- **WHEN** 一个非成功 task 按执行顺序包含多个合法失败轮次
- **THEN** 报告仅使用最后一个合法失败轮次的 `failurePhase` 和 `failureReasonCode` 形成唯一诊断

#### Scenario: 任一轮观测到工作区结果
- **WHEN** 一个 task 的任一 adapter 轮次明确记录 `workspaceOutcomeObserved=true`
- **THEN** 报告的 `workspaceOutcomeObserved` 为 `true`，即使最后一轮没有工作区观测或缺少该字段

#### Scenario: 没有合法结构化证据
- **WHEN** 一个非成功 task 的 adapter 输出均不包含合法的安全结构化失败证据
- **THEN** 报告使用既有安全 fallback 阶段和原因码
- **AND** 报告不从非结构化文本猜测失败原因

### Requirement: 模型输出上限仅形成观测事实

评测报告 schema version 3 MUST 为每个 task 输出必填布尔字段 `modelOutputLimitObserved`，并 MUST 汇总 `modelOutputLimitObservedCount`。当任一可验证模型轮次的 `usage.output_tokens` 达到或超过该候选运行配置的 `maxOutputTokens` 时，逐 task 字段 MUST 为 `true`；没有达到、缺少合法 usage 或 task 未执行时 MUST 为 `false`。该观测 MUST NOT 改写 task 的 terminal 状态、失败阶段、原因码、重试资格、评分分量或 `taskScore`。JSON 报告与 Markdown 摘要 MUST 对该观测给出一致结论。

**需求类别**：系统质量属性

**质量属性**：审计/可追溯性
**适用范围**：该 Function

#### Scenario: 失败 task 达到输出上限
- **WHEN** 一个失败 task 的任一可验证模型轮次记录 `usage.output_tokens` 等于候选运行配置的 `maxOutputTokens`
- **THEN** 逐 task `modelOutputLimitObserved` 为 `true` 且汇总计数包含该 task
- **AND** task 保留原有 terminal 状态、失败阶段、原因码和零分语义

#### Scenario: 成功 task 达到输出上限
- **WHEN** 一个最终成功的 task 曾有模型轮次达到候选运行配置的 `maxOutputTokens`
- **THEN** 逐 task `modelOutputLimitObserved` 为 `true`
- **AND** task 仍按上游合法评分形成成功结论

#### Scenario: 没有达到或没有 usage
- **WHEN** task 的全部合法模型轮次均低于候选输出上限，或不存在合法模型轮次 usage
- **THEN** 逐 task `modelOutputLimitObserved` 为 `false`

#### Scenario: JSON 与 Markdown 结论一致
- **WHEN** 系统为同一次运行生成 JSON 报告和 Markdown 摘要
- **THEN** Markdown 展示的逐 task 输出上限观测与 JSON 的 `modelOutputLimitObserved` 一致
- **AND** Markdown 展示的汇总数量与 JSON 的 `modelOutputLimitObservedCount` 一致

### Requirement: 剩余失败类型具有固定恢复回归入口

系统 MUST 提供版本控制内的 `failure-recovery-regression` profile，并 MUST 固定执行 `007-session-memory`、`078-local-api-cursor-retry-ledger`、`081-local-html-dom-form-extract`、`088-api-contract-mock-client-compat` 和 `091-financial-close-reconciliation`。该 profile MUST 声明 `nonScoring=true`，MUST 复用真实候选执行、grader 预检、报告和安全诊断路径，且 MUST NOT 生成 `frameworkEffectScore` 或改变全量评测清单与计分语义。

**需求类别**：功能性需求

#### Scenario: 执行固定恢复回归
- **WHEN** 开发者选择 `failure-recovery-regression` profile 运行评测
- **THEN** manifest 恰好包含该 Requirement 固定的五个 task id
- **AND** 每个 task 通过与全量运行相同的候选执行、grader 预检、报告和安全诊断路径处理

#### Scenario: 恢复回归保持非计分
- **WHEN** `failure-recovery-regression` 运行完成或中断
- **THEN** 报告标记 `nonScoring=true` 且不包含 `frameworkEffectScore`
- **AND** 该运行结果不得被宣称为框架效果得分或全量可比基线

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：全部 task 的终态结论、评分覆盖、多轮安全失败诊断、模型输出上限观测与逐 task 评分，以及内容一致的机器可读 JSON 报告和 Markdown 摘要；仅评分覆盖完整的有效全量运行输出 `frameworkEffectScore`。
- **依据 Requirements**：`评测失败提供安全诊断`、`多轮 adapter 证据形成单一安全诊断`、`模型输出上限仅形成观测事实`

### 处理过程

- **变更类型**：修改
- **目标内容**：对失败 terminal 优先保留公开安全原因码并以闭集码补足缺失值；对每个 task 汇聚全部 adapter 轮次的结构化安全证据，保留最后一个明确失败诊断与任一轮工作区观测；独立记录模型输出达到候选上限的事实而不改变 terminal、重试或计分语义；固定恢复 profile 复用正式执行和报告路径但保持非计分。
- **依据 Requirements**：`评测失败提供安全诊断`、`多轮 adapter 证据形成单一安全诊断`、`模型输出上限仅形成观测事实`、`剩余失败类型具有固定恢复回归入口`

### 规格

- **规格项**：报告格式
- **变更类型**：修改
- **原规格值**：机器可读 JSON 报告 + 内容一致 Markdown 摘要；中断时原子写出部分报告且不包含 `frameworkEffectScore`；不含 credential、token、完整 prompt、完整模型输出、task 文件内容或主机绝对路径
- **目标规格值**：schema version 3 机器可读 JSON 报告 + 内容一致 Markdown 摘要；包含多轮安全诊断、必填逐 task `modelOutputLimitObserved` 与汇总计数；中断时原子写出部分报告且不包含 `frameworkEffectScore`；不含 credential、认证 token、完整 prompt、完整模型输出、task 文件内容或主机绝对路径
- **依据 Requirements**：`多轮 adapter 证据形成单一安全诊断`、`模型输出上限仅形成观测事实`

- **规格项**：恢复回归 profile
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`failure-recovery-regression` 固定覆盖 `007-session-memory`、`078-local-api-cursor-retry-ledger`、`081-local-html-dom-form-extract`、`088-api-contract-mock-client-compat`、`091-financial-close-reconciliation`，且 `nonScoring=true`
- **依据 Requirements**：`剩余失败类型具有固定恢复回归入口`
