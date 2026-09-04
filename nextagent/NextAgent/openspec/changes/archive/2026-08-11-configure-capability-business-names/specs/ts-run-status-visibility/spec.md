## Function

- **所属 Function**：`FN-2.4 查看请求状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Agent Web 必须集中维护 Capability 业务名称映射

系统 MUST 使用一个集中名称解析入口管理 Capability 业务名称。平台 MUST 在该入口维护固定标题模板和内置 Capability 名称；集成产品 MUST 通过 AICOConfig 为扩展 Tool、Agent、Skill、Workflow 提供产品级名称。系统 MUST 保留既有构建期集成映射作为配置缺失时的兼容 fallback，并 MUST NOT 新增后端名称 resolver、运行时名称服务、第二份 frontend config store、Vite environment configuration 或 Capability 注册 metadata 来生成业务标题。

**需求类别**：功能性需求

名称解析 MUST 使用以下唯一优先级，命中后 MUST 停止继续查找：

1. 平台固定 `kind + id` 映射；
2. 当前 AICOConfig 中当前界面语言的集成 `kind + id` 名称；
3. 当前前端产物中当前界面语言的既有构建期集成映射；
4. 合法技术标识或既有中性标题降级。

平台映射 MUST 至少覆盖以下当前用户可见生产身份：

| 类型 | `capabilityId` | 中文标题 | 英文标题 |
|---|---|---|---|
| 文件 Tool | `Read`、`Write`、`Edit`、`Glob`、`Grep` | 读取文件、保存文件、更新文件、查找文件、搜索文件内容 | Read file、Save file、Update file、Find files、Search file contents |
| 执行 Tool | `Bash`、`Python` | 执行命令、执行程序 | Run command、Run program |
| 知识/计划 Tool | `Rag`、`ToolSearch`、`TodoWrite`、`Cron` | 检索知识、查找可用能力、更新任务计划、管理定时任务 | Search knowledge、Find available capabilities、Update task plan、Manage scheduled tasks |
| Memory Tool | `search_memory`、`get_memory_detail`、`add_memory` | 检索长期记忆、查看记忆详情、保存长期记忆 | Search long-term memory、View memory details、Save long-term memory |
| 能力获取 | `acquire_skill` | 获取技能 | Acquire skill |

AICOConfig 与构建期映射中的 Tool value MUST 是完整业务标题。Agent、Skill、Workflow value MUST 只包含资源业务名称，并 MUST 由平台固定模板包装。配置名称和构建期名称 MUST 使用当前界面语言；当前语言名称缺失或非法时 MUST 继续到下一优先级，MUST NOT 借用另一语言。名称 MUST 作为纯文本渲染，MUST NOT 包含执行状态或详情内容，也 MUST NOT 作为 HTML 或 Markdown 解释。

平台固定映射 MUST 优先于全部集成名称来源；AICOConfig 中与平台固定身份相同的条目 MUST NOT 改变平台名称。相同有效 AICOConfig 快照内的 `kind + id` 唯一性由 AICOConfig 校验契约决定；名称解析 MUST NOT 任选冲突值。

历史记录 MUST 保存执行身份而不是映射名称。当前有效 AICOConfig、前端产物或当前界面语言变化后，live 与 history MUST 按当前名称解析优先级重新渲染；系统 MUST NOT 冻结执行时名称。

#### Scenario: AICOConfig 配置扩展 Skill 名称

- **GIVEN** AICOConfig 配置 `SKILL + alarm-diagnosis` 的 `zh-CN` 名称为“告警诊断”
- **WHEN** 当前中文界面渲染 `capabilityId=Skill` 与 `targetCapabilityId=alarm-diagnosis`
- **THEN** 标题 MUST 显示“加载技能：告警诊断”和既有状态
- **AND** 配置值 MUST NOT 包含或替换“加载技能”模板

#### Scenario: 平台固定名称不能被配置覆盖

- **GIVEN** AICOConfig 为 `TOOL + Read` 配置名称“读取设备”
- **WHEN** 当前中文界面渲染 `Read` 步骤
- **THEN** 标题 MUST 继续使用平台固定名称“读取文件”
- **AND** Capability 执行 MUST 不受该配置影响

#### Scenario: 当前语言缺失时使用构建期 fallback

- **GIVEN** AICOConfig 的扩展 Tool 条目只提供 `en-US` 名称
- **AND** 当前中文前端产物包含同一身份的构建期中文名称
- **WHEN** 中文界面渲染该 Tool
- **THEN** 标题 MUST 使用构建期中文名称
- **AND** 标题 MUST NOT 使用 AICOConfig 的英文名称

#### Scenario: 配置与构建期名称均缺失

- **GIVEN** 一个扩展 Tool 具有合法 `capabilityId`，但当前语言下没有 AICOConfig 或构建期名称
- **WHEN** 用户查看其 live 或 history 步骤
- **THEN** 标题 MUST 显示原 `capabilityId` 和既有状态
- **AND** Tool 注册和执行 MUST NOT 因名称缺失失败

#### Scenario: 历史按当前配置重新渲染

- **GIVEN** history 保存合法 `capabilityKind`、`capabilityId` 和可选 `targetCapabilityId`
- **AND** 当前启动快照为该身份提供有效 AICOConfig 名称
- **WHEN** 用户重新打开该 history
- **THEN** 标题 MUST 使用当前有效配置名称
- **AND** history MUST NOT 声称保留执行时名称

#### Scenario: 名称按纯文本渲染

- **GIVEN** 有效配置名称包含 Markdown punctuation 或 HTML-like text
- **WHEN** 前端显示 Capability 标题
- **THEN** 该值 MUST 作为文本显示
- **AND** 前端 MUST NOT 创建 markup、link、script 或其他可执行内容

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：用户查看请求过程时，扩展 Capability 标题可使用宿主提供的产品业务名称，同时保持平台固定名称、过程结构、执行身份和结果安全边界不变。
- **依据 Requirements**：`Agent Web 必须集中维护 Capability 业务名称映射`

### 输入

- **变更类型**：修改
- **目标内容**：过程标题除公开 Capability 身份与当前前端产物映射外，还接收当前有效 AICOConfig 中与当前界面语言匹配的扩展名称。
- **依据 Requirements**：`Agent Web 必须集中维护 Capability 业务名称映射`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统按平台固定名称、AICOConfig 集成名称、构建期集成名称和既有安全降级的固定优先级生成标题。
- **依据 Requirements**：`Agent Web 必须集中维护 Capability 业务名称映射`

### 规格

- **规格项**：Capability 业务名称优先级
- **变更类型**：修改
- **原规格值**：平台固定映射、构建期集成映射、合法技术标识或中性标题降级
- **目标规格值**：平台固定映射、AICOConfig 集成名称、构建期集成映射、合法技术标识或中性标题降级
- **依据 Requirements**：`Agent Web 必须集中维护 Capability 业务名称映射`

### 覆盖特性

- **变更类型**：修改
- **目标内容**：`F-2.4 查看请求状态` 支持按当前宿主配置呈现扩展 Capability 产品业务名称，并保持平台治理与安全降级。
- **依据 Requirements**：`Agent Web 必须集中维护 Capability 业务名称映射`
