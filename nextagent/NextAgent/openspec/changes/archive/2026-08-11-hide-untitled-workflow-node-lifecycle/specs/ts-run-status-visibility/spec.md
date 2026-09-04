## Function

- **所属 Function**：`FN-2.4 查看请求状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 无业务标题的 Workflow 内部节点不得显示技术身份

对于可信 Workflow 内部、且不代表 runtime Capability 的节点 lifecycle，当 matching structured process 没有非空 `TITLE` 或 `SUB_TITLE` 时，用户可见过程 MUST NOT 把 `nodeId`、`capabilityId`、`toolCallId`、correlation id 或 `nodeType` 当作业务标题。该 lifecycle 的事实身份、状态、顺序和历史恢复资格 MUST 保持不变；本 Requirement 只约束用户可见过程投影。

该类无业务标题节点处于 started、successful completed、failed、timed-out 或 skipped 状态时，用户可见过程 MUST NOT 为 lifecycle 创建独立步骤。当 matching structured process 包含 `DETAIL`、`SUB_DETAIL` 或 `SUB_CONCLUSION` 时，用户可见过程 MUST 仅在该 occurrence 没有 failed 或 timed-out 终态时保留对应正文 occurrence，且 MUST NOT 为该正文生成空标题、独立状态图标、完成对勾或第二层展开入口；同一 occurrence failed 或 timed-out 时，其无标题正文 occurrence MUST NOT 显示。

同一节点 occurrence 已具有非空 `TITLE` 或 `SUB_TITLE` 时，用户可见过程 MUST 保留该 structured business title，并在 successful、failed 或 timed-out completion 上显示对应实际状态；matching structured detail MUST 沿用既有标题与正文层级。用户可见过程 MUST NOT 为同一终态增加第二个 lifecycle 或故障步骤。对于具有合法 `capabilityKind` 的 `TOOL`、`SKILL`、`AGENT` 或 `WORKFLOW` lifecycle，系统 MUST 沿用各自既有标题与状态规则。

当 Workflow 节点的标题可见且正文被 `show_content=false` 隐藏时，系统 MUST 在 successful completion 投影既有 shape 的 body-free terminal lifecycle，并 MUST NOT 因隐藏正文而丢失实际完成状态。该 terminal lifecycle MUST NOT 包含节点 output、structured content 或其他被正文可见性禁止的内容。

active live、settled live 与 cold history MUST 对相同的可信 Workflow lifecycle/product facts 应用上述同一规则，并形成相同的用户可见步骤、正文 occurrence 和顺序。

**需求类别**：功能性需求

#### Scenario: 无标题延时节点执行期间不显示技术标识

- **GIVEN** 可信 Workflow 投影了一个不代表 runtime Capability 的 `DELAY` 节点 lifecycle
- **AND** 该节点没有 matching 非空 `TITLE` 或 `SUB_TITLE`
- **WHEN** 用户在节点处于 started 状态时查看过程
- **THEN** 用户可见过程 MUST NOT 创建该 lifecycle 的独立步骤
- **AND** 用户可见内容 MUST NOT 包含该节点的 `nodeId`、`capabilityId`、`toolCallId`、correlation id 或 `nodeType`

#### Scenario: 无标题节点完成后只显示正文

- **GIVEN** 无业务标题的可信 Workflow 内部非 runtime Capability 节点已经 started
- **WHEN** 同一节点 successful completed 并产生 matching `DETAIL`、`SUB_DETAIL` 或 `SUB_CONCLUSION`
- **THEN** settled live MUST 只保留该 structured product 的正文 occurrence
- **AND** 正文 MUST NOT 具有空标题、独立状态图标、完成对勾或第二层展开入口
- **AND** started lifecycle 的独立步骤 MUST NOT 在 completion 时出现或消失

#### Scenario: 无标题且无正文的节点不论终态均不显示

- **GIVEN** 可信 Workflow 内部非 runtime Capability 节点没有 matching 非空 `TITLE` 或 `SUB_TITLE`
- **AND** 该 occurrence 没有 matching `DETAIL`、`SUB_DETAIL` 或 `SUB_CONCLUSION`
- **WHEN** 该节点 successful、failed 或 timed-out
- **THEN** 用户可见过程 MUST NOT 显示该节点的 lifecycle 或正文步骤

#### Scenario: 无标题但有正文的失败节点不显示

- **GIVEN** 可信 Workflow 内部非 runtime Capability 节点没有 matching 非空 `TITLE` 或 `SUB_TITLE`
- **AND** 该 occurrence 具有 matching `DETAIL`、`SUB_DETAIL` 或 `SUB_CONCLUSION`
- **WHEN** 该节点 successful completed
- **THEN** 用户可见过程 MUST 以不折叠的纯正文 occurrence 显示该正文
- **WHEN** 同一 occurrence failed 或 timed-out
- **THEN** 用户可见过程 MUST NOT 显示该 lifecycle 或 matching 正文 occurrence

#### Scenario: 已配置业务标题和 runtime Capability 保持既有呈现

- **WHEN** Workflow 节点具有 matching 非空 `TITLE` 或 `SUB_TITLE`，或者 lifecycle 具有合法 `capabilityKind=TOOL`、`SKILL`、`AGENT` 或 `WORKFLOW`
- **THEN** 用户可见过程 MUST 沿用该类别既有的业务标题、实际状态和 structured product 呈现规则
- **AND** 本 Requirement MUST NOT 删除或重命名其用户可见步骤

#### Scenario: 有业务标题的节点失败时保留标题

- **GIVEN** 可信 Workflow 内部非 runtime Capability 节点已经为一个 occurrence 产生非空 `TITLE` 或 `SUB_TITLE`
- **WHEN** 同一 occurrence 的 lifecycle 以 failed 或 timed-out 状态完成
- **THEN** 用户可见过程 MUST 在该业务标题上显示对应终态
- **AND** 用户可见过程 MUST NOT 把该标题替换为本地化通用故障标题
- **AND** 用户可见过程 MUST NOT 为同一 occurrence 增加第二个故障步骤

#### Scenario: 有业务标题的节点成功时保留正文和实际状态

- **GIVEN** 可信 Workflow 内部非 runtime Capability 节点已经为一个 occurrence 产生非空 `TITLE` 或 `SUB_TITLE` 及 matching structured detail
- **WHEN** 同一 occurrence 的 lifecycle 以 successful 状态完成
- **THEN** 用户可见过程 MUST 在该业务标题上显示成功终态
- **AND** matching structured detail MUST 保持可见
- **AND** 用户可见过程 MUST NOT 为同一 occurrence 增加第二个 lifecycle 步骤

#### Scenario: 有业务标题但隐藏正文的节点仍显示成功状态

- **GIVEN** Workflow 节点已经产生非空 `TITLE` 或 `SUB_TITLE`
- **AND** 该节点配置 `show_content=false`
- **WHEN** 同一 occurrence successful completed
- **THEN** runtime projection MUST 产生不含正文的 successful terminal lifecycle
- **AND** 用户可见过程 MUST 在该业务标题上显示成功状态
- **AND** lifecycle 与用户可见过程 MUST NOT 包含节点 output 或 structured detail

#### Scenario: 实时与历史使用同一无标题规则

- **GIVEN** settled live 与 cold history 输入包含相同的可信 Workflow lifecycle/product facts
- **WHEN** 用户分别查看实时完成态和重新打开后的历史过程
- **THEN** 两条路径 MUST 形成相同的用户可见步骤、正文 occurrence 和顺序
- **AND** cold history MUST NOT 因持久化 lifecycle identity 而重新显示技术标题

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：查看请求的当前状态和关键过程时，无业务标题的 Workflow 内部非 runtime Capability 节点不暴露技术身份；无标题正文仅在非失败终态可见，有业务标题的节点保留实际状态。
- **依据 Requirements**：`无业务标题的 Workflow 内部节点不得显示技术身份`

### 输出

- **变更类型**：修改
- **目标内容**：请求过程包含已配置业务标题及实际状态的步骤，以及仅属于非失败 occurrence 的无标题纯正文。
- **依据 Requirements**：`无业务标题的 Workflow 内部节点不得显示技术身份`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统根据可信 Workflow lifecycle 与 matching structured title 区分事实身份和业务标题，并对实时与历史输入应用同一可见性规则。
- **依据 Requirements**：`无业务标题的 Workflow 内部节点不得显示技术身份`

### 结果

- **变更类型**：修改
- **目标内容**：无业务标题节点不形成 lifecycle 步骤，非失败正文保持纯内容呈现，失败或超时 occurrence 整体隐藏；有业务标题的节点继续显示真实状态。
- **依据 Requirements**：`无业务标题的 Workflow 内部节点不得显示技术身份`

### 覆盖特性

- **变更类型**：修改
- **目标内容**：`F-2.4 查看请求状态` 覆盖无业务标题 Workflow 内部节点的稳定过程呈现。
- **依据 Requirements**：`无业务标题的 Workflow 内部节点不得显示技术身份`

### 主规格

- **变更类型**：修改
- **目标内容**：`ts-run-status-visibility`
- **依据 Requirements**：`无业务标题的 Workflow 内部节点不得显示技术身份`
