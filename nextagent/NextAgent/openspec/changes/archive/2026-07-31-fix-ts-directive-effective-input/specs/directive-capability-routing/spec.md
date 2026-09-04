## Function

- **所属 Function**：`FN-2.8 指令定向请求处理`
- **Function 变更类型**：`ADDED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Directive 生成有效用户问题

当已接受的用户输入包含一个有效且无冲突的 `$skill:<name>` 或 `$workflow:<name>` directive 时，系统 MUST 从用户问题中移除全部已成功识别的 capability directive token；系统 MUST 把移除后仅裁剪首尾空白的剩余文本作为有效用户问题。系统 MUST NOT 把已成功识别的 directive token 作为用户问题内容传给工作流、模型或后续会话上下文。

**需求类别**：功能性需求

#### Scenario: Workflow directive 前缀从有效问题中移除

- **WHEN** 用户提交 `inputText="$workflow:ran-alarm-diagnosis diagnose RAN alarms"`
- **THEN** 系统 MUST 生成 `targetRecipe=ran-alarm-diagnosis`
- **AND** 系统 MUST 生成有效用户问题 `diagnose RAN alarms`
- **AND** 工作流 `input_question` MUST 等于 `diagnose RAN alarms`

#### Scenario: Skill directive 前缀从模型输入中移除

- **WHEN** 用户提交 `inputText="$skill:alarm-diagnosis diagnose alarms"`
- **THEN** 系统 MUST 生成目标 Skill `alarm-diagnosis`
- **AND** 该请求及后续轮次的模型用户消息 MUST 包含 `diagnose alarms`
- **AND** 该请求及后续轮次的模型用户消息 MUST NOT 包含 `$skill:alarm-diagnosis`

#### Scenario: 相同 directive 的重复引用全部移除

- **WHEN** 用户输入包含两个 `$skill:alarm-diagnosis` 且不包含其他 capability directive
- **THEN** 系统 MUST 生成恰好一个目标 Skill `alarm-diagnosis`
- **AND** 系统 MUST 从有效用户问题中移除两个 directive token

#### Scenario: 无 directive 的问题保持不变

- **WHEN** 用户输入不包含 `$skill:` 或 `$workflow:` directive
- **THEN** 系统 MUST 把原输入作为有效用户问题
- **AND** 系统 MUST NOT 生成 directive-derived routing target

#### Scenario: 非前缀 directive 只移除已识别 token

- **WHEN** 用户提交 `inputText="please use $skill:alarm-diagnosis to diagnose alarms"`
- **THEN** 系统 MUST 移除 `$skill:alarm-diagnosis`
- **AND** 系统 MUST 保留 directive token 以外的字符顺序和内容
- **AND** 系统 MUST 只裁剪结果的首尾空白

### Requirement: 有效用户问题成为持久化和执行事实

对于包含有效且无冲突 capability directive 的已接受请求，系统 MUST 把有效用户问题保存为该请求的可见 USER message content。系统 MUST 使用同一个有效用户问题构造当前请求的工作流输入和模型用户消息。系统 MUST 把 directive-derived routing target 保存为与 USER message content 分离的结构化请求路由事实。

**需求类别**：功能性需求

#### Scenario: 可见历史只保存有效问题

- **WHEN** 包含 `$workflow:ran-alarm-diagnosis` 的请求被接受并保存
- **THEN** 会话历史中的对应 USER message content MUST 等于有效用户问题
- **AND** 该 content MUST NOT 包含 `$workflow:ran-alarm-diagnosis`
- **AND** 请求仍 MUST 保留结构化 `targetRecipe=ran-alarm-diagnosis`

#### Scenario: Skill 路由结果与有效问题同时可用

- **WHEN** 包含 `$skill:alarm-diagnosis` 的请求进入受治理 Skill 路由
- **THEN** Skill 路由 MUST 消费结构化目标 Skill `alarm-diagnosis`
- **AND** 下游模型 MUST 消费不含该 directive 的有效用户问题

### Requirement: 重试编辑与恢复保持净化语义

系统 MUST 在 retry 和 local recovery 时从已保存的有效用户问题与结构化请求路由事实重建请求。系统 MUST NOT 通过在 USER message content 中保留或重新拼接 capability directive 来恢复路由。Edit MUST 对编辑后的输入重新执行 directive 解析与有效用户问题生成，并 MUST NOT 继承被替换请求的 directive-derived routing target。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复

**适用范围**：该 Function

#### Scenario: Workflow retry 保持路由且不恢复 directive

- **WHEN** 用户重试一个由 `$workflow:ran-alarm-diagnosis` 定向且已完成的请求
- **THEN** retry MUST 继续使用 `targetRecipe=ran-alarm-diagnosis`
- **AND** retry 的有效用户问题和工作流 `input_question` MUST NOT 包含 `$workflow:ran-alarm-diagnosis`

#### Scenario: Skill retry 保持路由且模型输入净化

- **WHEN** 用户重试一个由 `$skill:alarm-diagnosis` 定向且已完成的请求
- **THEN** retry MUST 继续使用目标 Skill `alarm-diagnosis`
- **AND** retry 的模型用户消息 MUST NOT 包含 `$skill:alarm-diagnosis`

#### Scenario: Edit 使用新输入事实

- **WHEN** 用户把最新请求编辑为 `$workflow:transport-diagnosis diagnose transport alarms`
- **THEN** 新请求 MUST 使用 `targetRecipe=transport-diagnosis`
- **AND** 新请求的有效用户问题 MUST 等于 `diagnose transport alarms`
- **AND** 新请求 MUST NOT 继承被替换请求的 directive-derived routing target

#### Scenario: Local recovery 保持结构化目标

- **WHEN** local recovery 重建一个尚未终结且包含 directive-derived routing target 的请求
- **THEN** 恢复后的请求 MUST 使用已保存的结构化路由事实
- **AND** 恢复后的有效用户问题 MUST 等于已保存的 USER message content

### Requirement: 非成功解析不产生净化路由事实

当 capability directive 非法或多个 directive 冲突时，系统 MUST 保持现有 fail-closed routing outcome。系统 MUST NOT 从非法或冲突 directive 生成可执行结构化路由目标。系统 MUST NOT 把部分解析结果当作成功净化结果继续执行 Skill、Workflow 或模型路径。

**需求类别**：功能性需求

#### Scenario: Skill 与 Workflow directive 冲突

- **WHEN** 用户输入同时包含 `$skill:alarm-diagnosis` 和 `$workflow:ran-alarm-diagnosis`
- **THEN** 系统 MUST 产生安全拒绝或受治理澄清
- **AND** 系统 MUST NOT 生成可执行 target Skill 或 `targetRecipe`
- **AND** 系统 MUST NOT 进入 Skill、Workflow 或模型执行路径

#### Scenario: Directive 名称非法

- **WHEN** 用户输入包含 `$skill:../secret`
- **THEN** 系统 MUST 产生安全拒绝
- **AND** 系统 MUST NOT 生成结构化路由目标
- **AND** 系统 MUST NOT 进入 Skill、Workflow 或模型执行路径

## Function 变更汇总

### 描述

- **变更类型**：新增
- **目标内容**：系统把用户输入中的有效 capability directive 转换为一个受治理结构化路由目标，并向历史、工作流和模型提供不含已解释 directive 的有效用户问题。
- **依据 Requirements**：`Directive 生成有效用户问题`、`有效用户问题成为持久化和执行事实`、`重试编辑与恢复保持净化语义`、`非成功解析不产生净化路由事实`

### 输入

- **变更类型**：新增
- **目标内容**：包含零个、一个或多个 `$skill:<name>` / `$workflow:<name>` token 的用户输入。
- **依据 Requirements**：`Directive 生成有效用户问题`、`非成功解析不产生净化路由事实`

### 输出

- **变更类型**：新增
- **目标内容**：有效且无冲突的输入产生一个结构化路由目标和一个有效用户问题；非法或冲突输入产生安全失败结果且不产生可执行目标。
- **依据 Requirements**：`Directive 生成有效用户问题`、`非成功解析不产生净化路由事实`

### 处理过程

- **变更类型**：新增
- **目标内容**：系统识别全部 capability directive，判定其是否有效且无冲突；成功时移除已识别 token、裁剪首尾空白并分离保存问题与路由目标，失败时停止下游执行。
- **依据 Requirements**：`Directive 生成有效用户问题`、`有效用户问题成为持久化和执行事实`、`非成功解析不产生净化路由事实`

### 结果

- **变更类型**：新增
- **目标内容**：历史、Workflow、模型、retry、edit 和 local recovery 使用一致的有效用户问题与结构化路由目标，directive 不再作为问题内容跨路径或跨轮传播。
- **依据 Requirements**：`有效用户问题成为持久化和执行事实`、`重试编辑与恢复保持净化语义`

### 接口

- **变更类型**：新增
- **目标内容**：用户通过请求文本中的 `$skill:<name>` 或 `$workflow:<name>` 指定路由目标；public request body 不新增 target 字段。
- **依据 Requirements**：`Directive 生成有效用户问题`、`有效用户问题成为持久化和执行事实`

### 覆盖特性

- **变更类型**：新增
- **目标内容**：`F-2.6 指定技能处理`、`F-9.1 执行工作流`
- **依据 Requirements**：`Directive 生成有效用户问题`、`有效用户问题成为持久化和执行事实`

### 主规格

- **变更类型**：新增
- **目标内容**：`directive-capability-routing`
- **依据 Requirements**：`Directive 生成有效用户问题`、`有效用户问题成为持久化和执行事实`、`重试编辑与恢复保持净化语义`、`非成功解析不产生净化路由事实`
