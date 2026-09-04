## Function

- **所属 Function**：`FN-2.3 重试请求`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Agent Web 对可操作的最新轮次暴露 retry 入口

Agent Web MUST 在当前最新轮次存在、会话不处于界面转换状态且 retry 次数未达到既有上限时暴露 TurnBlock 与 Composer retry 入口。`metadata.forkInherited: true` MUST NOT 单独导致 retry 入口禁用或隐藏；最新继承轮次是否可执行 MUST 由 retry 请求的后端权威资格校验决定。较早历史轮次 MUST NOT 获得 latest retry 入口。

**需求类别**：功能性需求

#### Scenario: 最新继承轮次可发起 retry

- **WHEN** 用户打开刚派生、尚无新提问的 child session
- **AND** 最新继承轮次满足 Agent Web 的其他既有 retry 入口条件
- **THEN** TurnBlock 与 Composer retry 入口 MUST 可用
- **AND** 用户触发 retry 时 Agent Web MUST 发起 retry 请求

#### Scenario: provenance 不绕过既有界面限制

- **WHEN** 最新继承轮次的 retry 次数已达到既有上限，或会话正在进行界面转换
- **THEN** Agent Web MUST 按对应既有规则禁用 retry 入口
- **AND** `metadata.forkInherited: true` MUST NOT 覆盖该限制

#### Scenario: 后端拒绝继承轮次 retry

- **WHEN** Agent Web 已发起最新继承轮次 retry
- **AND** 后端因目标已过期、存在 active runtime work、附件不可用、scope 不匹配或 durable fork source 不可用而拒绝
- **THEN** Agent Web MUST 展示既有安全失败结果
- **AND** Agent Web MUST NOT 将 `forkInherited` 当作后端资格判断的替代项

## REMOVED Requirements

### Requirement: Agent Web 禁用继承 latest turn 的 retry 入口

**Reason**：该禁用契约与已经交付的“最新继承轮次可作为子会话首次操作来源”相冲突，并使前端阻止合法请求到达后端权威校验边界。

**Migration**：使用“Agent Web 对可操作的最新轮次暴露 retry 入口”；`forkInherited` 仅保留 provenance 语义，其他 retry 入口条件保持不变。

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：系统允许用户从满足既有界面条件的最新继承轮次发起 retry，并由后端完成权威资格校验；较早轮次和既有禁用条件不变。
- **依据 Requirements**：`Agent Web 对可操作的最新轮次暴露 retry 入口`

### 结果

- **变更类型**：修改
- **目标内容**：符合条件的最新继承轮次显示可用 retry 入口，后端拒绝时展示既有安全失败结果。
- **依据 Requirements**：`Agent Web 对可操作的最新轮次暴露 retry 入口`
