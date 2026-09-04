## Function

- **所属 Function**：`FN-1.11 从消息派生子会话`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 最新继承轮次可作为子会话首次操作来源

当 fork child 尚未提交 fork 后用户请求、没有 active runtime work，且 copied prefix 的最后一个完整问答轮次仍是当前最新轮次时，系统 MUST 允许该继承轮次作为 child retry 或 edit-resubmit 的输入来源。系统 MUST 仅使用 child-owned copied messages、durable fork source 和可信 child session scope 判定资格，MUST NOT 读取或控制 parent runtime facts。

该资格不改变 copied run anchor 和 `FORK_SNAPSHOT` 的只读性质。系统 MUST NOT 为 copied run anchor 补建 `RequestRun`、checkpoint、runtime-origin timeline、lane state 或 pending input；直接把 copied run anchor 当作 runtime `runId` 的 lifecycle 请求仍 MUST 以 safe not-found outcome 失败。

当 child 已提交 fork 后用户请求、存在 active runtime work、目标不是最新继承轮次，或 copied messages 无法形成一个 canonical 用户问题时，系统 MUST 拒绝 inherited retry/edit，且 MUST NOT 隐藏或修改 copied history。

**需求类别**：功能性需求

#### Scenario: 刚派生子会话可操作最新继承轮次
- **WHEN** child 尚无 fork 后用户请求和 active runtime work
- **AND** copied prefix 最后一轮包含一个 canonical 用户问题和可渲染回答
- **THEN** 系统 MUST 允许该轮作为 child retry 或 edit-resubmit 的输入来源

#### Scenario: child 已独立演进后不再使用继承资格
- **WHEN** child 已提交至少一个 fork 后用户请求
- **THEN** 系统 MUST NOT 以继承轮次资格操作 copied history
- **AND** child 的普通真实 run MUST 继续遵守既有 retry/edit 规则

#### Scenario: 较早 copied 轮次不可操作
- **WHEN** 用户对 copied prefix 中非最新的轮次发起 retry 或 edit
- **THEN** 系统 MUST 以安全 stale-latest outcome 拒绝
- **AND** 系统 MUST NOT 创建子会话运行事实或改变复制的历史

#### Scenario: copied run anchor 仍不可作为 lifecycle run
- **WHEN** lifecycle command 直接把 copied run anchor 当作 runtime `runId`
- **THEN** 系统 MUST 返回 safe not-found outcome
- **AND** MUST NOT 补建或链接 parent `RequestRun`

#### Scenario: 资格判定不读取 parent runtime
- **WHEN** 系统判定最新继承轮次的 retry/edit 资格
- **THEN** 判定 MUST 仅基于 child-owned durable facts
- **AND** parent `RequestRun`、checkpoint、timeline、lane 和 active-run 状态均不得成为判定输入

### Requirement: Replacement lineage 在递归 fork 中保持 child-owned

当 fork prefix 包含 retry 或 edit-resubmit 产生的 canonical process events 时，系统 MUST 将事件 payload 中已识别的 message、request 和 run reference 通过现有 fork ID map 重映射为新 child-owned ID。`retryOfRunId` MUST 按 run reference 处理，`editedFromRequestId` MUST 按 request reference 处理；它们不得作为未知字符串保留，也不得被删除以隐藏映射失败。

若已识别 reference 无法映射，或未知 payload 字段携带 source-bound message/request/run identity，fork MUST fail closed 且不得持久化 child session、copied messages、process snapshots 或其他部分结果。成功结果的 copied messages 和 process snapshots MUST NOT 暴露 source message/request/run ID。

**需求类别**：系统质量属性

**质量属性**：安全、可靠性/恢复

**适用范围**：该 Function

#### Scenario: retry 后 fork 重映射 previous-attempt lineage
- **GIVEN** source prefix 包含 retry attempt 和 `REQUEST_ACCEPTED.retryOfRunId`
- **WHEN** 用户从 retry 后的可见回答 fork
- **THEN** copied event 的 `retryOfRunId` MUST 指向 child copied previous attempt anchor
- **AND** MUST NOT 保留 source run ID

#### Scenario: edit 后 fork 重映射 replacement lineage
- **GIVEN** source prefix 包含 edit replacement 和 `REQUEST_ACCEPTED.editedFromRequestId`
- **WHEN** 用户从 edit 后的可见回答 fork
- **THEN** copied event 的 `editedFromRequestId` MUST 指向 child copied source request
- **AND** MUST NOT 保留 source request ID

#### Scenario: retry 和 edit 复合后仍可递归 fork
- **GIVEN** 同一 source prefix 依次发生 retry 和 edit replacement
- **WHEN** 用户从最新回答 fork，并从该 child 再次 fork
- **THEN** 每一代 copied event reference MUST 仅指向本代 child-owned IDs
- **AND** parent 和 ancestor runtime facts MUST 保持不变

#### Scenario: 未知 source-bound reference 继续 fail closed
- **WHEN** process event 的未知 payload 字段携带任一 source message/request/run ID
- **THEN** fork MUST 返回安全 payload-unsafe outcome
- **AND** MUST NOT 通过放宽字符串检查或保留 source ID 完成 fork

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：从历史回复派生的 child 在独立演进前，可把最新继承轮次作为首次 retry/edit 的输入来源，同时保持 parent runtime 与 copied process facts 隔离。
- **依据 Requirements**：`最新继承轮次可作为子会话首次操作来源`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统根据 child-owned durable facts 判断最新继承轮次资格；资格通过时交由 child retry/edit；replacement 后再次 fork 时统一重映射 canonical process lineage，失败时不产生部分 child facts。
- **依据 Requirements**：`最新继承轮次可作为子会话首次操作来源`、`Replacement lineage 在递归 fork 中保持 child-owned`

### 结果

- **变更类型**：修改
- **目标内容**：合格的最新继承轮次可在 child 中继续操作；copied run anchor 仍不可作为 runtime lifecycle run；retry/edit 后的会话可继续 fork 且每代过程引用保持 child-owned。
- **依据 Requirements**：`最新继承轮次可作为子会话首次操作来源`、`Replacement lineage 在递归 fork 中保持 child-owned`
