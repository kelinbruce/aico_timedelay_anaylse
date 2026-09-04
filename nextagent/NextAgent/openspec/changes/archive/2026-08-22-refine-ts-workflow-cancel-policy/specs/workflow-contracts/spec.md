## ADDED Requirements

### Requirement: ControlPolicy

TS 后端 MUST 在 agent-contracts/core 定义 ControlPolicySchema，定义流程级外部取消回退策略。

ControlPolicy MUST 包含可选字段 cancel（Record of WorkflowSafeId to WorkflowBranchDef）与 cancelTimeout（秒，最小 1，未配置时不设额外超时）。

cancel MUST 复用 WorkflowBranchDef（含可选 condition），与 WorkflowNodeDef.next、WorkflowNodeDef.exception 完全同形同策。cancelTimeout 是 cancel 回退可选兜底超时，独立于 runtime.timeout，MUST NOT 复用整体 workflow 执行预算。未配置时回退 MUST 跟随回退节点自身 timeout/retry 默认逻辑。

ControlPolicy MUST NOT 包含 resume、modify、restart 入口（已废弃）。ControlPolicy MUST NOT 包含 strategy 枚举或 rollbackNode 字段（旧设计已废弃）。

未配置 controlPolicy.cancel 时 MUST 默认直接终止（不回退，兼容当前 INTERRUPTED 行为）。

condition 字段为预留能力，首版 MUST NOT 参与回退分支选择（当前无入口传入 variables）；首版 MUST 取 cancel 的第一个 entry 作为回退目标，MUST 允许多 entry 存在。

loader（recipe YAML 不可信边界）MUST 对 controlPolicy 做 runtime schema validation。旧字段（strategy、rollbackNode、resume、modify、restart）传入时 MUST 报错，不做兼容。新字段（cancel 为 Record、cancelTimeout 为正整数）MUST 校验类型。

#### Scenario: Cancel Configured With Rollback Target

- **WHEN** recipe 定义 runtime.controlPolicy.cancel 含 entry rollback_cleanup
- **THEN** 解析结果 ControlPolicy.cancel MUST 为 Record 含 key rollback_cleanup
- **AND** 每个 entry MUST 符合 WorkflowBranchDef（可选 condition）

#### Scenario: Cancel Timeout Configured

- **WHEN** recipe 定义 runtime.controlPolicy.cancelTimeout 为 30
- **THEN** 解析结果 ControlPolicy.cancelTimeout MUST 为 30（秒）
- **AND** MUST NOT 解释为毫秒

#### Scenario: Cancel Default Stop

- **WHEN** 未配置 controlPolicy.cancel
- **THEN** 外部取消时 MUST 默认直接终止（不回退）

#### Scenario: Cancel Reuses WorkflowBranchDef

- **WHEN** recipe 定义 runtime.controlPolicy.cancel.rollback_cleanup.condition 为空串
- **THEN** 解析结果 MUST 符合 WorkflowBranchDef（空串合法）
- **AND** MUST 与 next/exception 的 condition 字段同形同策

#### Scenario: Legacy Fields Ignored By Loader

- **WHEN** recipe YAML 定义 control_policy.cancel.strategy 或 control_policy.cancel.rollbackNode（旧字段）
- **THEN** loader MUST 报错（旧字段不做兼容）
- **AND** MUST NOT 将旧字段值映射到新 schema

#### Scenario: Cancel Timeout Invalid Value Rejected

- **WHEN** recipe 定义 controlPolicy.cancelTimeout 为非整数或小于 1
- **THEN** runtime schema validation MUST 拒绝

#### Scenario: Cancel Entry Not Record Rejected

- **WHEN** recipe 定义 controlPolicy.cancel 为非 Record 类型（如字符串或数组）
- **THEN** runtime schema validation MUST 拒绝

#### Scenario: Legacy Strategy Enum Rejected

- **WHEN** recipe 定义 runtime.controlPolicy.cancel.strategy
- **THEN** schema 校验 MUST 拒绝（additionalProperties false）
- **AND** MUST NOT 出现 strategy、rollbackNode、resume、modify、restart 字段