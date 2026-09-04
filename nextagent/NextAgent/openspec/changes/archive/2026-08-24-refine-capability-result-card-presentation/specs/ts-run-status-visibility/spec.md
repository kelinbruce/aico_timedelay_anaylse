## Function

- **所属 Function**：`FN-2.4 查看请求状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Capability 结果呈现策略受平台安全上限约束

系统 MUST 在用户查看 Capability 执行结果时先确定平台安全上限，再把启动期冻结的集成呈现级别收窄到该上限；任何集成配置 MUST NOT 提高平台安全上限、改变 canonical Capability Result Message、改变模型上下文或把未列入安全投影白名单的字段发送给浏览器。

**需求类别**：功能性需求

呈现级别从低到高依次为 `STATUS_ONLY`、`SUMMARY`、`DETAIL`。`STATUS_ONLY` 只携带公开身份、关联标识、有效级别和状态；`SUMMARY` 只增加非空、非通用且通过既有白名单与容量校验的安全摘要；`DETAIL` 才允许增加既有 projector 已批准的 `safeResult` 和详情文本。AskUserQuestion accepted answer 继续作为公开对话事实独立保留。安全失败继续按安全失败契约呈现，三种成功结果级别 MUST NOT 改变失败字段集合。

平台安全上限 MUST 继续按已识别 Capability 身份、结果 schema 和可信来源确定。未知身份、未知 shape、schema 失败、内部 Skill 正文或无法证明安全来源的结果最高为 `STATUS_ONLY`。配置级别只允许 `STATUS_ONLY`、`SUMMARY`、`DETAIL`；`default-level` 缺失时仍为 `SUMMARY`；exact `capability-id` 规则、256 项上限、标识长度、重复项、未知字段和 ready gate 规则保持不变。

内置策略基线 MUST 把 `Skill`、`Agent`、`ApiCall`、`search_memory`、`get_memory_detail`、`add_memory`、`acquire_skill` 设为 `STATUS_ONLY`；把 `AskUserQuestion`、`TodoWrite`、`Cron`、`Rag`、`Bash`、`Python` 设为 `DETAIL`；把 `Read`、`Write`、`Edit`、`Glob`、`Grep`、`ToolSearch`、`Workflow` 设为 `SUMMARY`。已识别 CLIP 和其他没有精确规则的扩展 Tool 继续使用有效 `default-level`，但没有平台管理 projector 时最高为 `STATUS_ONLY`。`ApiCall` 的规范路径和防御性 `STATUS_ONLY` 上限保持不变。

#### Scenario: 默认命令和程序结果使用既有安全详情

- **GIVEN** 集成方没有配置 Capability 结果呈现精确规则
- **AND** `Bash` 或 `Python` 成功结果通过既有命令输出安全 schema
- **WHEN** 用户查看该步骤
- **THEN** 有效呈现级别 MUST 为 `DETAIL`
- **AND** 用户主动展开时 MUST 只看到既有 exit code、stdout/stderr preview、timeout 和截断事实
- **AND** 浏览器 MUST NOT 收到原始命令、Python 代码、脚本名、调用参数或超出既有边界的输出

#### Scenario: 集成规则仍可收窄命令结果

- **GIVEN** 集成规则把 `Bash` 或 `Python` 精确配置为 `STATUS_ONLY` 或 `SUMMARY`
- **WHEN** 用户查看该步骤
- **THEN** 有效级别 MUST 使用该更低级别
- **AND** 被该级别排除的 `safeResult` 和详情 MUST NOT 进入浏览器

#### Scenario: 默认 RAG 结果使用既有详情

- **GIVEN** 集成方没有配置 Capability 结果呈现精确规则
- **AND** `Rag` 成功结果通过既有安全 schema
- **WHEN** 用户查看该步骤
- **THEN** 有效级别 MUST 为 `DETAIL`
- **AND** 投影 MUST 继续使用既有来源、预览和截断边界

#### Scenario: 未知与无 projector 结果继续安全降级

- **GIVEN** 配置请求 `DETAIL`
- **AND** 结果属于未知扩展 Tool，或属于仍无成功 projector 的 `Agent`、Memory Tool 或 `acquire_skill`
- **WHEN** 系统生成用户可见投影
- **THEN** 有效级别 MUST 为 `STATUS_ONLY`
- **AND** 系统 MUST NOT 透传任意 JSON、原始结果或产品自报安全字段

#### Scenario: 非法配置继续阻止应用 ready

- **GIVEN** 启动配置包含重复 `capability-id`、`HIDDEN`、未知级别、未知字段或超出既有数量和长度边界的规则
- **WHEN** 系统校验并冻结配置
- **THEN** 校验 MUST 失败
- **AND** 应用 MUST NOT 进入 ready 状态

### Requirement: Capability 业务呈现必须与结果显示策略正交

系统 MUST 在 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 下使用同一身份解析、业务标题、状态与安全失败事实。业务名称映射 MUST NOT 改变有效结果级别、平台安全上限、安全投影字段或 AskUserQuestion accepted-answer；结果显示策略也 MUST NOT 改变标题身份。

**需求类别**：功能性需求

`SUMMARY` 只有在后端提供已识别的 `safeSummaryCode`、所需参数通过既有白名单和容量校验、且本地化结果 trim 后非空并具有标题和状态之外的独立业务信息时才有效。没有有效摘要时，界面 MUST 省略摘要，只保留标题与状态；MUST NOT 显示“暂无摘要”“结果已返回”“命令执行完成”“程序执行完成”“工作流执行完成”“收到流事件”或语义等价的占位/重复文字，也 MUST NOT 从 raw detail、JSON、技术 id、关键词或详情首句推导摘要。

当既有 `DETAIL` 或安全失败技术详情允许展开时，界面 MUST 只本地化平台拥有的区块标题、字段标签、标点、截断提示、状态标签和安全失败说明。技术证据值的内容、顺序、单位、精度和既有截断结果 MUST 保持不变。业务语言适配 MUST NOT 增加详情字段、展开入口或可见内容。

过程面板和单步骤的既有 disclosure 行为 MUST 保持不变。完成态普通步骤默认收起；摘要 MUST NOT 因配置为 `SUMMARY` 或 `DETAIL` 而成为收起条目下方的常驻正文。没有有效详情的步骤 MUST NOT 显示空展开入口。

#### Scenario: 成功命令直接呈现已有详情而不显示废话摘要

- **GIVEN** `Bash` 或 `Python` 的有效级别为 `DETAIL`
- **AND** 已有安全结果包含可显示 stdout、stderr、非零 exit code、timeout 或截断事实
- **WHEN** 用户展开完成态步骤
- **THEN** 展开区 MUST 直接呈现已有安全执行结果
- **AND** 界面 MUST NOT 在结果上方重复“执行完成”“返回了输出”或语义等价摘要
- **AND** 用户收起步骤后 MUST 只看到标题与状态

#### Scenario: 空成功命令没有摘要和空展开入口

- **GIVEN** `Bash` 或 `Python` 成功结果 exit code 为零且没有 stdout、stderr、timeout 或截断事实
- **WHEN** 用户查看完成态步骤
- **THEN** 界面 MUST 只显示标题与状态
- **AND** 界面 MUST NOT 显示成功占位摘要或空展开入口

#### Scenario: Workflow 外层成功摘要不重复状态

- **GIVEN** Workflow outer result 的唯一摘要只表达 recipe 已完成、等待或中断，且标题和状态已表达同一事实
- **WHEN** 用户查看该 ordinary Capability 步骤
- **THEN** 界面 MUST 省略重复摘要
- **AND** Workflow inner product 和 terminal answer MUST 继续遵守各自既有呈现契约

#### Scenario: 前端不从 raw JSON 生成摘要

- **GIVEN** 一个 ordinary Capability result 没有有效受信摘要和 recognized `safeResult`
- **AND** 事件携带 legacy text、可解析 JSON 或任意技术详情
- **WHEN** 前端构建过程步骤
- **THEN** 前端 MUST 只显示标题与状态
- **AND** 前端 MUST NOT 截取首句、匹配关键词或显示“工具输出已生成”

### Requirement: RAG 检索结果具有可展示的安全摘要

系统 MUST 为通过既有 RAG 安全 schema 的成功结果生成语言中立召回数量摘要；`SUMMARY` MUST 只携带既有 `safeSummaryCode` 和只含 `totalCount` 的白名单化 `safeSummaryArgs`，MUST NOT 携带 `safeResult`、来源、内容预览、完整内容、provenance、score、rankHint、诊断或其他原始字段。

**需求类别**：功能性需求

有效级别为 `DETAIL` 时，系统 MUST 在数量摘要基础上复用既有 `kind="ragRetrieval"` 安全详情。该详情继续包含 `totalCount` 和按原始顺序排列、最多 50 项的 `items`；每项只包含 `displaySource`、`sourceMissing`、`contentPreview` 和 `contentTruncated`。来源 basename、中文主导最多 40 个 Unicode code point、其他内容最多 100 个 Unicode code point，以及缺失字段和截断判断的既有规则保持不变。

#### Scenario: RAG SUMMARY 只显示召回数量

- **GIVEN** 集成规则把 `Rag` 精确配置为 `SUMMARY`
- **AND** RAG 结果通过既有安全 schema且召回 3 项
- **WHEN** 系统生成用户可见投影
- **THEN** 投影 MUST 包含召回数量 3 的语言中立摘要语义
- **AND** 投影 MUST NOT 包含 `safeResult`、来源或内容预览

#### Scenario: RAG DETAIL 复用既有来源和预览

- **GIVEN** `Rag` 的有效级别为 `DETAIL`
- **WHEN** 系统生成用户可见投影
- **THEN** 投影 MUST 包含既有白名单和既有边界生成的 `ragRetrieval` safe result
- **AND** 系统 MUST NOT 增加任何新的原始检索字段或更大的容量边界

#### Scenario: RAG 非法结果继续安全降级

- **GIVEN** RAG 结果没有通过既有安全 schema
- **WHEN** 系统生成用户可见投影
- **THEN** 平台安全上限 MUST 降为 `STATUS_ONLY`
- **AND** 浏览器 MUST NOT 从原始结果补建数量、来源或预览

## ADDED Requirements

### Requirement: 已有 typed safe result 必须使用本地化结构呈现

前端 MUST 对共享后端已经提供的 `ToolSearch`、`Cron` 和 `TodoWrite` typed safe result 使用当前界面语言的专用结构呈现。该呈现 MUST 只消费 safe result 白名单字段，不得改变字段内容、顺序或既有截断结果。

**需求类别**：功能性需求

`ToolSearch` DETAIL MUST 显示已有工具名称、kind、capability id、description preview 和截断事实；`Cron` DETAIL MUST 按 create、delete、list 形态显示已有任务标识、human schedule、cron、recurring 和截断事实；`TodoWrite` MUST 本地化空列表、更新数量和 `pending/in_progress/completed` 状态。没有详情项且没有截断事实时，界面 MUST 省略展开入口。

#### Scenario: ToolSearch DETAIL 使用专用结构

- **GIVEN** `ToolSearch` 的有效级别为 `DETAIL` 且 safe result 包含两个工具
- **WHEN** 用户展开步骤
- **THEN** 界面 MUST 按原顺序显示两个工具的已有安全字段
- **AND** 界面 MUST NOT 退化为 raw JSON 或浏览器生成摘要

#### Scenario: Cron 三种结果使用专用结构

- **GIVEN** `Cron` safe result 分别表示 create、delete 或 list
- **WHEN** 用户展开步骤
- **THEN** 界面 MUST 使用与实际形态匹配的当前语言字段标签
- **AND** 界面 MUST NOT 显示 prompt、原始参数或未白名单字段

#### Scenario: TodoWrite 状态使用当前语言

- **GIVEN** `TodoWrite` safe result 包含 pending、in-progress 和 completed 项
- **WHEN** 用户使用中文或英文界面查看详情
- **THEN** 每个状态和空列表/更新文案 MUST 使用当前界面语言
- **AND** 切换语言 MUST NOT 改变 todo 内容、顺序或状态事实

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：用户查看请求状态时，系统只显示有独立价值的安全摘要，并在现有卡片中以当前语言呈现已批准的有界详情；默认命令、程序和知识检索步骤可主动展开查看既有安全结果。
- **依据 Requirements**：`Capability 结果呈现策略受平台安全上限约束`、`Capability 业务呈现必须与结果显示策略正交`、`RAG 检索结果具有可展示的安全摘要`、`已有 typed safe result 必须使用本地化结构呈现`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统先按既有安全上限和三档配置确定字段，再由界面只消费受信摘要和 typed safe result；无有效摘要或详情时只保留标题与状态，且不改变既有 disclosure 行为。
- **依据 Requirements**：`Capability 结果呈现策略受平台安全上限约束`、`Capability 业务呈现必须与结果显示策略正交`、`已有 typed safe result 必须使用本地化结构呈现`

### 结果

- **变更类型**：修改
- **目标内容**：Bash、Python、Rag 默认返回既有安全 DETAIL；RAG SUMMARY 只返回召回数量；ToolSearch、Cron、TodoWrite 使用本地化专用结构；未知或不支持结果继续 fail closed。
- **依据 Requirements**：`Capability 结果呈现策略受平台安全上限约束`、`RAG 检索结果具有可展示的安全摘要`、`已有 typed safe result 必须使用本地化结构呈现`

### 规格

- **规格项**：Capability 结果呈现级别
- **变更类型**：修改
- **原规格值**：`STATUS_ONLY` 为 `Skill`、`Agent`、`ApiCall`、`search_memory`、`get_memory_detail`、`add_memory`、`acquire_skill`；`DETAIL` 为 `AskUserQuestion`、`TodoWrite`、`Cron`；`SUMMARY` 为 `Rag`、`Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`Python`、`ToolSearch`、`Workflow`
- **目标规格值**：`STATUS_ONLY` 为 `Skill`、`Agent`、`ApiCall`、`search_memory`、`get_memory_detail`、`add_memory`、`acquire_skill`；`DETAIL` 为 `AskUserQuestion`、`TodoWrite`、`Cron`、`Rag`、`Bash`、`Python`；`SUMMARY` 为 `Read`、`Write`、`Edit`、`Glob`、`Grep`、`ToolSearch`、`Workflow`
- **依据 Requirements**：`Capability 结果呈现策略受平台安全上限约束`

### 主规格

- **变更类型**：修改
- **目标内容**：`ts-run-status-visibility`
- **依据 Requirements**：`Capability 结果呈现策略受平台安全上限约束`、`Capability 业务呈现必须与结果显示策略正交`、`RAG 检索结果具有可展示的安全摘要`、`已有 typed safe result 必须使用本地化结构呈现`
