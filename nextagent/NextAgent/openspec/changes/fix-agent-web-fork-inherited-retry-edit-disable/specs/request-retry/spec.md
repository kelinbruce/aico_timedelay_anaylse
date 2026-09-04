## Function

- **所属 Function**：`FN-2.3 重试请求`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Agent Web 禁用继承 latest turn 的 retry 入口

Agent Web MUST 在当前最新轮次存在、会话不处于界面转换状态且 retry 次数未达到既有上限时暴露 TurnBlock 与 Composer retry 入口。当 `metadata.forkInherited: true` 时，Agent Web MUST 禁用 TurnBlock 与 Composer retry 入口，呈现禁用视觉态（`not-allowed` 光标、降低透明度），并在悬浮时通过 Tooltip 展示继承轮次不可重试的原因说明。较早历史轮次 MUST NOT 获得 latest retry 入口。其他既有禁用条件（retry 次数上限、界面转换状态）MUST 继续优先于 provenance 禁用。

**需求类别**：功能性需求

#### Scenario: 最新继承轮次禁用 retry

- **WHEN** 用户打开刚派生、尚无新提问的 child session
- **AND** 最新继承轮次携带 `metadata.forkInherited: true`
- **THEN** TurnBlock 与 Composer retry 入口 MUST 呈现禁用态
- **AND** 点击 retry 入口 MUST NOT 发起 retry 请求
- **AND** 悬浮时 MUST 展示继承轮次不可重试的原因说明

#### Scenario: provenance 不绕过既有界面限制

- **WHEN** 最新继承轮次的 retry 次数已达到既有上限，或会话正在进行界面转换
- **THEN** Agent Web MUST 按对应既有规则禁用 retry 入口
- **AND** `metadata.forkInherited: true` MUST NOT 覆盖该限制

#### Scenario: 非 inherited latest turn 正常暴露 retry

- **WHEN** 最新轮次不携带 `metadata.forkInherited: true`
- **AND** 会话不处于界面转换状态且 retry 次数未达到上限
- **THEN** TurnBlock 与 Composer retry 入口 MUST 可用
- **AND** 用户触发 retry 时 Agent Web MUST 发起 retry 请求

## REMOVED Requirements

### Requirement: Agent Web 对可操作的最新轮次暴露 retry 入口

**Reason**：该暴露契约依赖后端 inherited retry 路径在环境中可靠可用，但实际环境返回 `REQUEST_RETRY_NOT_FOUND`，导致用户操作必然失败。前端需恢复禁用以避免用户操作失败。

**Migration**：使用"Agent Web 禁用继承 latest turn 的 retry 入口"；`forkInherited` 重新承担前端禁用语义，其他 retry 入口条件保持不变。

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：Agent Web 对最新继承轮次禁用 retry 入口并展示说明性 tooltip；非 inherited 轮次和既有禁用条件不变。
- **依据 Requirements**：`Agent Web 禁用继承 latest turn 的 retry 入口`

### 结果

- **变更类型**：修改
- **目标内容**：继承轮次显示禁用 retry 入口；非 inherited 轮次正常暴露。
- **依据 Requirements**：`Agent Web 禁用继承 latest turn 的 retry 入口`