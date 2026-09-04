## Function

- **所属 Function**：`FN-10.6 前端定制`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Automatic process disclosure preserves the next visual focus

当 live 过程条目进入完成状态且没有用户手工覆盖时，`ProcessPanel` MUST 在后续活动内容进入可见阅读阶段前直接从布局中隐藏该条目的 detail，MUST NOT 等待 settle delay，且 MUST NOT 对该自动收起执行改变布局高度的 transition。

用户手工展开或收起条目后，该手工状态 MUST 在当前 run 内优先于自动 disclosure。后续条目完成、活动条目切换、内容更新或最终答案开始 MUST NOT 覆盖该状态。由 `rootMessageId` 与 `displayRunId` 共同标识的 run scope 改变时，系统 MUST 清除上一 scope 的手工状态。

当一个 Process Detail 包含至少一个 `toolMessageType: "PIU"` 的结构化 segment 且该 Detail 已在当前 run scope 挂载时，条目自动收起、条目手工收起、整个过程面板收起和 reduced-motion 模式下的收起 MUST 只隐藏该 Detail 并阻止其交互，MUST 保留同一 PIU 组件实例。由折叠或重新展开产生的 React render MUST NOT 再次调用相同 PIU 内容的 `Prel.autoLoad` 或 `piu.emit`。不包含 PIU 的 Detail MUST 保持既有折叠后卸载行为，尚未展开的 PIU Detail MUST NOT 仅因处于折叠状态而提前挂载。

当 PIU Detail 所属过程条目不再存在于当前对话投影，或 `rootMessageId + displayRunId` run scope 被替换时，系统 MUST 卸载该 Detail、取消尚未完成的 PIU 加载结果并清空其容器 DOM。PIU host 未提供的外部销毁协议不属于本 Requirement。

**需求类别**：功能性需求

#### Scenario: 自动完成条目在下一步骤前直接收起

- **GIVEN** 一个不包含 PIU 的自动管理 live 条目处于展开状态
- **WHEN** 该条目进入 final，且后续活动条目同时或随后出现
- **THEN** 已完成条目的 detail MUST 直接从布局和 React render tree 中移除
- **AND** 系统 MUST NOT 等待 settle delay
- **AND** 系统 MUST NOT 对该自动收起执行 height transition

#### Scenario: 手工展开跨后续步骤保持

- **GIVEN** 用户手工展开了一个过程条目
- **WHEN** 该条目完成、后续活动条目开始或最终答案开始输出
- **THEN** 该条目 MUST 保持展开
- **AND** 自动 disclosure MUST NOT 覆盖该手工状态

#### Scenario: 手工收起不被内容更新重新打开

- **GIVEN** 用户手工收起了一个过程条目
- **WHEN** 该条目的 detail 更新或后续活动条目发生变化
- **THEN** 该条目 MUST 保持收起

#### Scenario: PIU 条目自动收起后复用交互实例

- **GIVEN** 一个自动管理的过程条目 Detail 包含 PIU 结构化内容且已完成首次挂载
- **WHEN** 该条目完成并自动收起，随后用户主动展开
- **THEN** 自动收起 MUST 隐藏 Detail 并阻止其中的 PIU 接收用户交互
- **AND** 用户主动展开时 MUST 看到首次挂载的同一 PIU 实例及其交互状态
- **AND** 系统 MUST NOT 因该次收起或展开重复调用 `Prel.autoLoad` 或 `piu.emit`

#### Scenario: 整个过程面板收起后复用 PIU 交互实例

- **GIVEN** 一个已展开的过程面板包含至少一个已挂载 PIU Detail
- **WHEN** 用户收起并重新展开整个过程面板
- **THEN** 收起期间过程面板及 PIU Detail MUST 不可见且不可交互
- **AND** 重新展开后 MUST 恢复同一 PIU 实例及其交互状态
- **AND** 系统 MUST NOT 因面板收起或展开重复调用 `Prel.autoLoad` 或 `piu.emit`

#### Scenario: reduced-motion 收起保留 PIU 实例

- **GIVEN** 用户启用了 reduced-motion，且一个 PIU Detail 已完成首次挂载
- **WHEN** 系统或用户收起该 Detail
- **THEN** Detail MUST 立即变为不可见且不可交互
- **AND** PIU 组件实例 MUST 保持挂载

#### Scenario: 未查看的 PIU Detail 不提前挂载

- **GIVEN** 一个已收起的过程条目包含尚未挂载的 PIU Detail
- **WHEN** 过程面板保持收起或重新渲染
- **THEN** 系统 MUST NOT 挂载该 PIU Detail
- **AND** 系统 MUST NOT 调用该 PIU 的 `Prel.autoLoad` 或 `piu.emit`

#### Scenario: PIU owner 移除后释放容器

- **GIVEN** 一个 PIU Detail 已挂载，或其 `Prel.autoLoad` 尚未完成
- **WHEN** 所属过程条目从当前对话投影移除或 run scope 被替换
- **THEN** 系统 MUST 卸载该 Detail 并清空其容器 DOM
- **AND** 尚未完成的加载结果 MUST NOT 再触发 `piu.emit`

#### Scenario: 新 run 清除手工覆盖

- **GIVEN** 当前 run 存在用户手工展开或收起状态
- **WHEN** `ProcessPanel` 切换到新的 `rootMessageId + displayRunId` run scope
- **THEN** 新 scope MUST 不继承上一 scope 的手工 disclosure 状态

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统提供的前端定制行为在 Process Detail 视觉折叠期间保留已挂载 PIU 的交互实例，并在 owner 移除时结束该实例的前端容器生命周期。
- **依据 Requirements**：`Automatic process disclosure preserves the next visual focus`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统区分视觉折叠和 owner 移除；前者只改变 PIU Detail 的可见性与交互可达性，后者卸载并清理前端容器。
- **依据 Requirements**：`Automatic process disclosure preserves the next visual focus`

### 结果

- **变更类型**：修改
- **目标内容**：用户重新展开同一 Process Detail 时恢复原有 PIU 交互状态，折叠操作不产生重复初始化；owner 移除后不产生延迟 emit。
- **依据 Requirements**：`Automatic process disclosure preserves the next visual focus`

### 覆盖特性

- **变更类型**：修改
- **目标内容**：`F-10.6 前端定制` 增加 Process Detail PIU 生命周期可靠性保证。
- **依据 Requirements**：`Automatic process disclosure preserves the next visual focus`

### 主规格

- **变更类型**：修改
- **目标内容**：`agent-web-process-panel`
- **依据 Requirements**：`Automatic process disclosure preserves the next visual focus`

### 其他规格

- **变更类型**：修改
- **目标内容**：`FN-10.6` 当前列出的其他 specs 保持各自现有 Requirements，本 change 不修改其行为。
- **依据 Requirements**：`Automatic process disclosure preserves the next visual focus`
