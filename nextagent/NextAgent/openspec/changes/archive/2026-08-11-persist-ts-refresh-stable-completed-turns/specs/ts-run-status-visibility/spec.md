## Function

- **所属 Function**：`FN-2.4 查看请求状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Workflow 产品过程不受 Capability Result 呈现策略裁剪

`STATUS_ONLY`、`SUMMARY`、`DETAIL` Capability Result 呈现策略 MUST 只治理 ordinary `CAPABILITY_RESULT_DELTA` 以及从 canonical result Message 恢复的 Message-backed result completion。Workflow inner product 与 terminal answer MUST NOT 因该策略被隐藏、摘要化、替换或改变结构。

model loop 调用 Workflow Tool 时，outer invocation MUST 继续持有标准 Tool protocol lifecycle 与 result。outer Assistant Tool-use Message 写入成功后、调用 Workflow 且产生任何 inner Event 前，系统 MUST 发布一个使用相同 `toolCallId` 并引用该 Message 的 ordinary outer `CAPABILITY_STARTED`。canonical outer `CAPABILITY_RESULT` Message 写入成功后，`SUCCEEDED`、`DEGRADED` 和 `TIMED_OUT` 终态 MUST 各自产生 ordinary outer `CAPABILITY_RESULT_DELTA` 和一个 `messageId` 指向该 result Message 的 outer `CAPABILITY_COMPLETED`。Workflow inner lifecycle/product Event MUST NOT 替代、抑制或复制该 outer lifecycle/result。

Workflow product 的 `ANSWER` 或 `SUB_CONCLUSION` 只表示产品展示层级，MUST NOT 改变 terminal Assistant Message 对 canonical `TURN_ANSWER` 的持有关系，也 MUST NOT 使 ordinary structured content 获得 Workflow message-free history 例外。

**需求类别**：功能性需求

#### Scenario: 三档配置不改变 Workflow inner product

- **GIVEN** 同一 completed Workflow product 分别运行在 `STATUS_ONLY`、`SUMMARY` 和 `DETAIL` Capability Result 配置下
- **WHEN** 系统生成 live 或 history projection
- **THEN** 三次投影的产品事件层级、内容类型、content 与 Workflow identity MUST 相同
- **AND** terminal answer MUST 相同

#### Scenario: 普通 Capability Result 继续受策略治理

- **WHEN** ordinary model-loop Capability Result 分别使用 `STATUS_ONLY`、`SUMMARY` 和 `DETAIL`
- **THEN** 系统 MUST 继续按既有 Capability Result 策略产生对应安全投影
- **AND** 既有安全字段、长度限制和降级行为 MUST 保持不变

#### Scenario: Workflow-as-Tool 只治理 outer result

- **WHEN** model loop 调用 Workflow Tool
- **THEN** 系统 MUST 在调用 Workflow 和发布任何 inner Event 前，发布引用 canonical outer Tool-use Message 的 outer `CAPABILITY_STARTED`
- **AND** outer invocation 以 `SUCCEEDED`、`DEGRADED` 或 `TIMED_OUT` 结束且 canonical result Message 已写入
- **THEN** 系统 MUST 发布 ordinary outer `CAPABILITY_RESULT_DELTA` 与引用该 Message 的 outer `CAPABILITY_COMPLETED`
- **AND** outer Workflow Tool result MUST 继续受 matching Capability Result 策略治理
- **AND** inner Workflow product MUST NOT 受 outer 策略裁剪

#### Scenario: 产品层级不绕过 canonical answer 边界

- **WHEN** Workflow product 使用 `ANSWER` 或 `SUB_CONCLUSION` 展示层级
- **THEN** 该层级 MUST NOT 改变 terminal Assistant Message 的 canonical answer 语义
- **AND** ordinary structured Event MUST NOT 因相同字段获得 Event-owned cold-history 例外

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：明确 ordinary/outer Capability Result、Workflow inner product 与 terminal answer 的策略边界。
- **依据 Requirements**：`Workflow 产品过程不受 Capability Result 呈现策略裁剪`

### 输出

- **变更类型**：修改
- **目标内容**：三档 ordinary/outer Capability Result 投影，以及不受三档裁剪的 Workflow product 与 terminal answer。
- **依据 Requirements**：`Workflow 产品过程不受 Capability Result 呈现策略裁剪`

### 处理过程

- **变更类型**：修改
- **目标内容**：策略继续只在 Capability Result 分支应用；Workflow product 与 answer 按各自 durable owner 投影。
- **依据 Requirements**：`Workflow 产品过程不受 Capability Result 呈现策略裁剪`

### 结果

- **变更类型**：修改
- **目标内容**：产品定义的 Workflow process 在三档下保持一致，ordinary/outer Capability Result 保持既有配置差异。
- **依据 Requirements**：`Workflow 产品过程不受 Capability Result 呈现策略裁剪`

### 规格

- **规格项**：Capability 结果呈现级别
- **变更类型**：修改
- **原规格值**：`STATUS_ONLY`、`SUMMARY`、`DETAIL`；最终级别不得突破平台安全上限
- **目标规格值**：`STATUS_ONLY`、`SUMMARY`、`DETAIL`；最终级别不得突破平台安全上限；只治理 ordinary/outer Capability Result，不治理 Workflow `PRODUCT_PROCESS` 或 `TURN_ANSWER`
- **依据 Requirements**：`Workflow 产品过程不受 Capability Result 呈现策略裁剪`
