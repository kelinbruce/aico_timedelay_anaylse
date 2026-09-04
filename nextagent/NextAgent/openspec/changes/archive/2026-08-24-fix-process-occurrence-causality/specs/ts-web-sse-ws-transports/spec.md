## Function

- **所属 Function**：`FN-1.1 查看会话消息流`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 用户输入边界分隔复用 stepId 的模型发生实例

Web stream consumer MUST 使用同一 root message、attempt 和 run 内的 `USER_INPUT_RECEIVED` 事件分隔模型发生实例。对于 `LLM_CONTENT_DELTA`，每个事件所属的输入分段从该运行开始或最近一个先于该事件的 `USER_INPUT_RECEIVED` 之后开始，并在下一个 `USER_INPUT_RECEIVED` 到达前结束。相同非空 `stepId` 在不同输入分段中 MUST 形成不同发生实例；相同 `stepId` 只有在同一输入分段内 MAY 作为累计快照 lane。

consumer MUST 只在相同 session、root message、attempt、event type、`stepId` 和输入分段内替换累计快照。不同输入分段的执行说明 MUST 分别保留各自首次出现的 sequence 和 created time；consumer MUST NOT 根据正文相等、前缀关系、相邻位置或同一次 RequestRun 合并不同发生实例。该规则 MUST 同时用于 live envelope accumulation、turn projection 和 run-event history；producer 的 `stepId`、event type 和 payload shape 保持不变。

**需求类别**：功能性需求

#### Scenario: 补充信息边界后复用 stepId

- **GIVEN** 输入分段 E1 中的 `stepId=S1` 已产生执行说明 A
- **AND** 同一运行随后产生 `USER_INPUT_REQUIRED` 和 `USER_INPUT_RECEIVED`
- **WHEN** 输入分段 E2 中的 `stepId=S1` 产生执行说明 B
- **THEN** live 过程 MUST 同时保留 A 和 B
- **AND** B MUST 使用自身首次事件的时序位置，不得占用 A 的位置
- **AND** A 和 B MUST 分别在各自输入分段内更新

#### Scenario: 同一输入分段内累计帧原地更新

- **GIVEN** 输入分段 E1 中的 `stepId=S1` 已发布非终态累计正文
- **WHEN** E1 中 S1 发布后续流式帧、输出续写或 completed snapshot
- **THEN** consumer MUST 原地更新 E1/S1 的累计快照
- **AND** 更新后的累计正文 MUST 只包含该发生实例按生成顺序确认的内容

#### Scenario: 不同输入分段产生相同正文

- **GIVEN** E1/S1 和 E2/S1 产生完全相同的公开正文
- **WHEN** live stream、重连或 run-event history 投影这两个发生实例
- **THEN** 用户 MUST 看到两个按各自真实时序排列的执行说明
- **AND** 系统 MUST NOT 因正文相等而删除、覆盖或合并其中任一说明

#### Scenario: 历史缺少可验证输入边界

- **GIVEN** 旧历史复用同一 `stepId` 且不包含可验证的 `USER_INPUT_RECEIVED` 边界
- **WHEN** 新版本读取该历史
- **THEN** 系统 MUST NOT 根据正文、关键词或相邻事件伪造输入分段
- **AND** 系统 MUST 按可验证的现有身份进行安全投影

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：系统使用已接受用户输入边界分隔可复用 `stepId` 的模型发生实例，并只在同一输入分段内更新累计正文。
- **依据 Requirements**：`用户输入边界分隔复用 stepId 的模型发生实例`

### 结果

- **变更类型**：修改
- **目标内容**：live、重连和历史回显分别保留补充信息前后的执行说明，后续说明不覆盖前文或继承前文位置。
- **依据 Requirements**：`用户输入边界分隔复用 stepId 的模型发生实例`

### 规格

- **规格项**：模型发生实例累计身份
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：相同模型步骤只在同一已接受用户输入分段内累计更新；输入分段前后的执行说明分别保留自身时序，不得互相替换。
- **依据 Requirements**：`用户输入边界分隔复用 stepId 的模型发生实例`
