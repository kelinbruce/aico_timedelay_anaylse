# targeted-skill-routing Delta Specification

所属 Function：`FN-2.6 指定技能处理`

Function 变更类型：修改

spec 角色：主规格

## MODIFIED Requirements

### Requirement: Target Skill failures degrade explicitly

当请求通过可信 `routingConstraints.targetSkill` 指定 Skill 时，系统 MUST 使用当前 Agent scope 解析目标 Skill，并通过统一 Capability 调用边界执行。调用成功或合法降级时，系统 MUST 保留定向 Skill 结果和 request-local context 行为。

目标不可用、输入非法、父 `AbortSignal` 已取消、descriptor 解析失败、最终 Capability 失败、非法 `CapabilityInvocationResult` 或调用 rejection MUST 形成安全且确定的结果。定向 Skill 路径 MUST NOT 回退到普通模型选路，MUST NOT 在 Agent loop 中自动重放。统一调用边界 MUST 仅按 `capability-catalog / 瞬态失败只在统一执行边界安全重试` 和当前 invocation 的 effective `maxRetries` 执行内部自动重试；字段缺失时 MUST 使用该 Requirement 定义的 canonical 缺省行为。

最终 `safeError.category=CANCELED` MUST 结束为取消终态。其他最终失败 MUST 使用 `CapabilityInvocationResult.safeError` 或规范化的安全内部错误构造终止 message，并 MUST 结束当前请求；raw Skill body、source 路径、resolver exception、owner scope 和 provider response MUST NOT 进入 message。

**需求类别**：功能性需求

#### Scenario: 定向 Skill 成功

- **WHEN** 可信 target Skill 可用且执行成功
- **THEN** 系统 MUST 使用该 Skill 的结果继续当前请求
- **AND** 系统 MUST NOT 改为普通模型自主选择 Skill

#### Scenario: 定向 Skill 最终失败

- **WHEN** 统一调用边界返回最终 `FAILED` 或 `TIMED_OUT`
- **THEN** 系统 MUST 保留 `safeError.code/category/message`
- **AND** 系统 MUST 结束当前请求
- **AND** 系统 MUST NOT 进入普通 Agent tool loop 或执行第二层自动重试

#### Scenario: 定向 Skill 取消

- **WHEN** 解析或执行定向 Skill 时请求被取消
- **THEN** 系统 MUST 结束为取消终态
- **AND** 系统 MUST NOT 创建失败终态或模型恢复轮次

#### Scenario: 定向 Skill 返回非法结果

- **WHEN** 定向 Skill 返回的 `CapabilityInvocationResult` 不满足公共 schema
- **THEN** 系统 MUST 使用稳定 `INTERNAL + retryable=false` 错误终止
- **AND** 非法结果内容 MUST NOT 进入终止 message

## Function 变更汇总

### 描述

- 变更类型：修改
- 目标内容：指定 Skill 的调用结果遵守统一 Capability 错误契约，并在最终失败时确定结束请求。
- 依据 Requirements：`Target Skill failures degrade explicitly`

### 输出

- 变更类型：修改
- 目标内容：成功保留 Skill 结果；最终失败产生安全终止 message；取消产生取消终态。
- 依据 Requirements：`Target Skill failures degrade explicitly`

### 处理过程

- 变更类型：修改
- 目标内容：系统不把定向 Skill 失败回退到普通模型选路，也不在 Agent loop 中执行第二层自动重试。
- 依据 Requirements：`Target Skill failures degrade explicitly`

### 结果

- 变更类型：修改
- 目标内容：定向 Skill 的成功、失败和取消行为均唯一确定且不泄漏内部执行事实。
- 依据 Requirements：`Target Skill failures degrade explicitly`
