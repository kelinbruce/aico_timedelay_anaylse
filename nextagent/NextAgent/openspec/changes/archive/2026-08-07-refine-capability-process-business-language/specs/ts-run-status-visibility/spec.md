## Function

- **所属 Function**：`FN-2.4 查看请求状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Capability 过程标题必须使用最小公开身份生成

系统 MUST 为普通 Agent Web 中每个用户可见的 Capability 步骤显示一个非空标题和一个独立状态。标题 MUST 只使用生命周期公开身份、当前前端产物的受治理业务名称映射和平台固定模板生成；系统 MUST NOT 从 Capability 参数、结果正文、模型输出、描述或浏览器状态猜测业务名称。

**需求类别**：功能性需求

普通或直接 Capability 的标题 MUST 按以下顺序生成：

1. `capabilityKind + capabilityId` 的业务名称映射命中时，使用映射标题；
2. 映射未命中且 `capabilityId` 合法时，普通 Tool 显示原 `capabilityId`，直接 Agent、Skill、Workflow 使用平台固定模板包装该 id；
3. `capabilityId` 缺失或不合法时，显示“执行操作”或 `Execute operation`。

`Agent`、`Skill`、`Workflow` 通用执行入口的标题 MUST 按以下顺序生成：

| 执行入口 `capabilityId` | 目标映射命中 | 目标映射未命中 | `targetCapabilityId` 缺失或不合法 |
|---|---|---|---|
| `Agent` | `调用子智能体：{name}` / `Invoke sub-agent: {name}` | `调用子智能体：{targetCapabilityId}` / `Invoke sub-agent: {targetCapabilityId}` | `调用子智能体` / `Invoke sub-agent` |
| `Skill` | `加载技能：{name}` / `Load skill: {name}` | `加载技能：{targetCapabilityId}` / `Load skill: {targetCapabilityId}` | `加载技能` / `Load skill` |
| `Workflow` | `执行预设流程：{name}` / `Run preset workflow: {name}` | `执行预设流程：{targetCapabilityId}` / `Run preset workflow: {targetCapabilityId}` | `执行预设流程` / `Run preset workflow` |

前端 MUST 根据执行入口推导目标映射 kind：`Agent → AGENT`、`Skill → SKILL`、`Workflow → WORKFLOW`。前端 MUST NOT 要求额外 `targetCapabilityKind`，也 MUST NOT 把执行入口 `capabilityKind=TOOL` 当成目标能力 kind。

`capabilityId` MUST 复用既有 public payload 合法性规则。`targetCapabilityId` MUST 是 trim 后 1 至 128 个 Unicode code point且不含 Unicode control character 的字符串。非法身份 MUST NOT 原样渲染。

状态 MUST 继续由既有 lifecycle phase 与安全失败事实确定，并以单个 ` · ` 与标题连接。执行中、已完成、失败、超时和已取消状态 MUST 使用当前界面已有的本地化状态语义；未知内部枚举 MUST NOT 原样显示。

`AskUserQuestion` 的问题、选项、回答和等待输入 MUST 继续由专用交互呈现。`ApiCall` 的规范路径 MUST NOT 新增普通结果卡，也 MUST NOT 从 HTTP 内容生成业务标题。

#### Scenario: Read 使用平台业务标题

- **GIVEN** `Read` 步骤公开 `capabilityKind=TOOL` 和 `capabilityId=Read`
- **AND** 平台中文映射为“读取文件”
- **WHEN** 用户查看正在执行的步骤
- **THEN** 标题 MUST 显示“读取文件 · 执行中”
- **AND** 标题 MUST NOT 同时拼接 `Read` 或重复状态

#### Scenario: Bash 和 Python 使用中性任务语言

- **GIVEN** `Bash` 与 `Python` 分别执行任意合法输入
- **WHEN** 用户在中文界面查看步骤
- **THEN** Bash 标题 MUST 使用“执行命令”
- **AND** Python 标题 MUST 使用“执行程序”
- **AND** 系统 MUST NOT 把任一步骤推断为检查、分析或诊断

#### Scenario: Skill 使用目标能力映射名称

- **GIVEN** lifecycle 公开 `capabilityId=Skill` 和 `targetCapabilityId=network-diagnosis`
- **AND** 前端 `SKILL + network-diagnosis` 映射为“网络诊断”
- **WHEN** 用户查看已完成步骤
- **THEN** 标题 MUST 显示“加载技能：网络诊断 · 已完成”
- **AND** 标题 MUST NOT 同时显示 `network-diagnosis` 或入口 `Skill`

#### Scenario: 目标名称未配置时显示目标能力标识

- **GIVEN** lifecycle 公开 `capabilityId=Agent` 和合法 `targetCapabilityId=network-diagnostic-agent`
- **AND** 当前前端产物没有对应 Agent 名称映射
- **WHEN** 用户查看该步骤
- **THEN** 标题 MUST 显示“调用子智能体：network-diagnostic-agent”和既有状态
- **AND** 界面 MUST NOT 显示空标题、未翻译 key 或渲染异常

#### Scenario: wrapper 目标身份缺失时显示中性标题

- **GIVEN** lifecycle 公开 `capabilityId=Workflow`
- **AND** `targetCapabilityId` 缺失或不合法
- **WHEN** 用户查看该步骤
- **THEN** 标题 MUST 显示“执行预设流程”和既有状态
- **AND** 系统 MUST NOT 从结果、描述或其他步骤补充目标名称

#### Scenario: 普通 Tool 映射未命中时保留执行入口

- **GIVEN** 一个普通 Tool 没有业务名称映射
- **AND** lifecycle 包含合法 `capabilityId`
- **WHEN** 用户查看其 live 或 history 步骤
- **THEN** 标题 MUST 显示原 `capabilityId` 和既有状态
- **AND** 界面 MUST NOT 显示空标题或渲染异常

#### Scenario: 所有标题身份均非法时使用通用降级

- **GIVEN** 一个步骤的 `capabilityId` 缺失或不合法
- **WHEN** 用户查看该步骤
- **THEN** 中文界面 MUST 显示“执行操作”与既有状态
- **AND** 其他步骤和最终答案 MUST 继续正常显示

#### Scenario: AskUserQuestion 保留专用交互

- **GIVEN** `AskUserQuestion` 已产生合法问题和选项
- **WHEN** 用户查看并回答该问题
- **THEN** 问题、选项、等待和回答 MUST 继续由专用交互呈现
- **AND** 系统 MUST NOT 把它替换为普通 Tool 结果卡

### Requirement: Capability 生命周期必须公开最小执行身份

系统 MUST 在用户可见且代表受治理 Capability 的 `CAPABILITY_STARTED` 与 `CAPABILITY_COMPLETED` 中公开执行入口身份。新产生的该类事件 MUST 包含合法 `capabilityKind`、既有 `capabilityId` 和 `toolCallId`；`Agent`、`Skill`、`Workflow` 通用入口在能够确定合法目标时 MUST 额外包含一个 `targetCapabilityId`。

**需求类别**：系统质量属性

**质量属性**：安全、可靠性/恢复、可维护性、可测试性、审计/可追溯性
**适用范围**：Capability lifecycle public stream 与 history

新增公共字段契约如下：

| 字段 | 类型 | 必填性 | 合法值与字段关系 | 非法值行为 |
|---|---|---|---|---|
| `capabilityKind` | string | 公共 schema optional；新受治理 Capability producer 必须输出 | 仅允许 `TOOL`、`SKILL`、`AGENT`、`WORKFLOW` | 局部省略，保留合法既有字段 |
| `targetCapabilityId` | string | optional、non-null | trim 后 1 至 128 个 Unicode code point且不含 Unicode control character；只允许 `capabilityId=Agent|Skill|Workflow` | 局部省略，执行和其他步骤不受影响 |

`targetCapabilityId` MUST 只表示本次调用的具体目标能力：`Agent` 使用已解析的 `agentId`，`Skill` 使用已解析的 `name`，`Workflow` 使用已解析的 `recipeName`。公开 payload MUST NOT 同时增加这些入口专属字段，也 MUST NOT 包含 prompt、args、inputText、inputVariables、路径、结果、状态文案或业务名称。

同一次调用的 started 与 completed MUST 逐值复用相同 `capabilityKind`、`capabilityId` 和已存在的 `targetCapabilityId`。成功、失败、超时、取消和结果校验失败 MUST NOT 重新解释目标身份。合法 completion-only 路径 MUST 输出能够安全确定的入口身份；不能确定目标时 MUST 省略 `targetCapabilityId`。

`CAPABILITY_RESULT_DELTA` MUST NOT 因本 change 新增 `capabilityKind` 或 `targetCapabilityId`，并 MUST 继续通过既有 `toolCallId` 与 started/completed 关联。SSE、WebSocket、live run-event history 与刷新后的 history MUST 对同一 lifecycle 事实输出相同身份。

Workflow 外层 wrapper lifecycle MUST 使用 `TOOL + Workflow + targetCapabilityId` 表示本次调用的 Recipe，内部 Tool、Skill、Agent、Subflow 节点 MUST 分别使用 `TOOL`、`SKILL`、`AGENT`、`WORKFLOW` 与其直接目标 id 公开身份，并 MUST NOT 再携带 `targetCapabilityId`。内层事件 MUST 保留既有 `parentToolCallId` 与外层 wrapper 关联。业务标题适配 MUST NOT 增加或删除任何外层或内层过程条目；非 Capability Workflow 节点 MUST 保持既有呈现，不得伪造 Capability kind。

旧 backend 或旧 history 缺少新增字段时 MUST 继续可读取。单条新增字段不合法时，系统 MUST 局部省略该字段并保留合法 `capabilityId`、状态、安全失败事实、其他步骤和最终答案。

#### Scenario: Agent started 与 completed 复用同一目标能力标识

- **GIVEN** Agent 通用入口在执行前解析为 `capabilityKind=TOOL`、`capabilityId=Agent` 和 `targetCapabilityId=network-diagnostic-agent`
- **WHEN** 后端先后产生 started 与 completed
- **THEN** 两个事件 MUST 携带逐值相同的三项身份
- **AND** 中间 result delta MUST NOT 重复携带 `capabilityKind` 或 `targetCapabilityId`

#### Scenario: Skill 只公开归一化目标能力标识

- **GIVEN** Skill 调用参数包含 `name=network-diagnosis` 和其他参数
- **WHEN** 系统公开 started/completed
- **THEN** payload MUST 包含 `targetCapabilityId=network-diagnosis`
- **AND** payload MUST NOT 包含 `name`、Skill 参数正文、源路径或完整调用参数

#### Scenario: 普通 Read 不公开目标能力标识

- **GIVEN** 普通 `Read` Tool 的调用参数中存在任意字段
- **WHEN** 系统公开其 lifecycle
- **THEN** started/completed MUST 包含 `capabilityKind=TOOL` 和 `capabilityId=Read`
- **AND** started/completed MUST NOT 包含 `targetCapabilityId`

#### Scenario: 非 wrapper 携带目标字段时局部降级

- **GIVEN** 一个事件包含 `capabilityId=Write` 和 `targetCapabilityId=unexpected-target`
- **WHEN** Web channel 投影该事件
- **THEN** 投影 MUST 省略 `targetCapabilityId`
- **AND** 投影 MUST 保留合法 `capabilityId=Write` 和既有状态

#### Scenario: Workflow 保持既有外层与内层结构

- **GIVEN** Workflow wrapper 调用 `recipeName=workflow-title-mapped-test`
- **AND** 该 Recipe 执行一个 `recipe_name=alarm-recovery` 的 Subflow 节点
- **WHEN** 系统公开外层和内层 lifecycle
- **THEN** 外层 MUST 使用 `capabilityKind=TOOL`、`capabilityId=Workflow` 和 `targetCapabilityId=workflow-title-mapped-test`
- **AND** Subflow 节点 MUST 使用 `capabilityKind=WORKFLOW` 和 `capabilityId=alarm-recovery`
- **AND** Subflow MUST 通过既有 `parentToolCallId` 关联外层，系统 MUST NOT 因目标名称增加或删除条目

#### Scenario: completion-only 路径保留兼容身份

- **GIVEN** 一个合法 preflight 或恢复路径只产生 `CAPABILITY_COMPLETED`
- **AND** 该路径只能确定合法 `capabilityId`
- **WHEN** 浏览器渲染该步骤
- **THEN** completed MUST 保留该 `capabilityId`
- **AND** 浏览器 MUST 使用该 id 和完成状态降级显示

#### Scenario: 旧历史缺少新增字段

- **GIVEN** history 中一个步骤只有合法 `capabilityId=Read` 和 `toolCallId`
- **WHEN** 新前端加载该历史
- **THEN** history MUST 正常显示该步骤
- **AND** 前端 MUST NOT 查询后端 Capability 目录或调用参数补充身份

### Requirement: Agent Web 必须集中维护 Capability 业务名称映射

系统 MUST 使用一个构建期映射入口管理 Capability 业务名称。平台 MUST 在该入口维护固定标题模板和内置 Capability 名称；集成产品 MUST 在同一入口维护其扩展 Tool、Agent、Skill、Workflow 名称。系统 MUST NOT 新增后端名称 resolver、运行时名称服务、第二份 application 配置或 Capability 注册 metadata 来生成本 change 的业务标题。

**需求类别**：功能性需求

平台映射 MUST 至少覆盖以下当前用户可见生产身份：

| 类型 | `capabilityId` | 中文标题 | 英文标题 |
|---|---|---|---|
| 文件 Tool | `Read`、`Write`、`Edit`、`Glob`、`Grep` | 读取文件、保存文件、更新文件、查找文件、搜索文件内容 | Read file、Save file、Update file、Find files、Search file contents |
| 执行 Tool | `Bash`、`Python` | 执行命令、执行程序 | Run command、Run program |
| 知识/计划 Tool | `Rag`、`ToolSearch`、`TodoWrite`、`Cron` | 检索知识、查找可用能力、更新任务计划、管理定时任务 | Search knowledge、Find available capabilities、Update task plan、Manage scheduled tasks |
| Memory Tool | `search_memory`、`get_memory_detail`、`add_memory` | 检索长期记忆、查看记忆详情、保存长期记忆 | Search long-term memory、View memory details、Save long-term memory |
| 能力获取 | `acquire_skill` | 获取技能 | Acquire skill |

Tool 映射值 MUST 是完整业务标题。Agent、Skill、Workflow 映射值 MUST 只包含资源业务名称，并 MUST 由平台固定模板包装。映射 MUST 使用当前前端产物既有 i18n 资源选择当前语言名称；当前语言名称缺失时 MUST 视为映射未命中，MUST NOT 借用另一语言。映射值 MUST NOT 包含执行状态、HTML、Markdown 或详情内容。

同一前端产物的服务范围内，相同 `kind + id` MUST 具有唯一、稳定的用户语义。集成产品不能保证该约束时 MUST 不配置该映射，系统 MUST 使用 id 降级显示，而不是任选一个名称。

业务名称和语言资源 MUST 随前端产物发布。历史记录 MUST 保存执行身份而不是映射名称；映射更新后，历史 MUST 按当前前端产物重新渲染。本 change MUST NOT 提供运行时语言切换后的历史名称冻结或重选机制。

#### Scenario: 集成产品配置扩展 Skill 名称

- **GIVEN** 集成产品在统一映射入口配置 `SKILL + alarm-diagnosis → 告警诊断`
- **WHEN** lifecycle 公开 `capabilityId=Skill` 和 `targetCapabilityId=alarm-diagnosis`
- **THEN** 中文标题 MUST 显示“加载技能：告警诊断”和既有状态
- **AND** 集成配置 MUST NOT 包含“加载技能”模板或执行状态

#### Scenario: 集成产品未配置扩展 Tool 名称

- **GIVEN** 一个扩展 Tool 具有合法 `capabilityId` 但没有前端映射
- **WHEN** 用户查看该步骤
- **THEN** 标题 MUST 显示原 `capabilityId` 和既有状态
- **AND** Tool 的注册和执行 MUST NOT 因缺少名称映射失败

#### Scenario: 映射更新后历史按当前产物渲染

- **GIVEN** 历史事件保存合法 `capabilityKind`、`capabilityId` 和可选 `targetCapabilityId`
- **AND** 新前端产物更新了对应业务名称映射
- **WHEN** 用户重新打开该历史
- **THEN** 标题 MUST 使用新前端产物的当前映射
- **AND** history MUST NOT 声称冻结了执行时业务名称

### Requirement: Capability 业务呈现必须与结果显示策略正交

系统 MUST 在 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 下使用同一身份解析、业务标题、状态与安全失败事实。业务名称映射 MUST NOT 改变有效结果级别、平台安全上限、`safeSummaryCode`、`safeSummaryArgs`、`safeResult`、详情字段、截断边界或 AskUserQuestion accepted-answer；结果显示策略也 MUST NOT 改变标题身份。

**需求类别**：功能性需求

`SUMMARY` 只有在后端提供已识别的 `safeSummaryCode`、所需参数通过既有白名单和容量校验、且本地化渲染结果 trim 后非空并非通用技术占位语时才是有效摘要。没有有效摘要时，界面 MUST 省略摘要，只保留标题与状态；MUST NOT 显示“暂无摘要”“结果已返回”或类似占位语，也 MUST NOT 从原始结果、技术 id 或详情推导摘要。

Bash 与 Python MUST 分别使用命令和程序语义。Python 对应的安全摘要 MUST 使用“程序执行完成/失败/超时”或 `Program completed/failed/timed out`，MUST NOT 使用命令措辞。RAG `SUMMARY` 的 `safeResult`、来源与预览仍只由既有 RAG 规格决定。

当既有 `DETAIL` 或安全失败技术详情允许展开时，界面 MUST 只本地化平台拥有的区块标题、字段标签、标点、截断提示、状态标签和安全失败说明。技术证据值的内容、顺序、单位、精度和既有截断结果 MUST 保持不变。

业务语言适配 MUST NOT 增加详情字段、展开入口或可见内容，也 MUST NOT 把 Bash 命令、Python 代码或脚本名、原始参数、原始结果、异常、credential、token、内部路径或 correlation id 引入浏览器。`STATUS_ONLY` 与 `SUMMARY` 下原本不可见的详情 MUST 继续不可见。

#### Scenario: SUMMARY 无有效摘要时只显示标题状态

- **GIVEN** 一个成功 Tool 的有效级别为 `SUMMARY`
- **AND** 摘要 code 缺失、未知、参数非法、渲染为空或形成通用占位语
- **WHEN** 用户查看该步骤
- **THEN** 界面 MUST 只显示标题与状态
- **AND** 界面 MUST NOT 显示摘要占位或把结果正文作为摘要

#### Scenario: Python 摘要使用程序措辞

- **GIVEN** 平台 `Python` Tool 的有效级别为 `SUMMARY`
- **AND** 后端提供有效的成功、失败或超时摘要事实
- **WHEN** 用户查看中文过程
- **THEN** 摘要 MUST 使用对应的程序执行措辞
- **AND** 摘要 MUST NOT 使用“命令执行完成”“命令执行失败”或“命令执行超时”

#### Scenario: 三种级别使用相同标题

- **GIVEN** 一个 Tool 具有相同的公开身份和前端名称映射
- **WHEN** 该 Tool 分别应用 `STATUS_ONLY`、`SUMMARY` 和 `DETAIL`
- **THEN** 三种显示 MUST 使用相同业务标题和状态规则
- **AND** 摘要与详情字段 MUST 继续由各自有效级别决定

#### Scenario: RAG 结果字段不受标题调整影响

- **GIVEN** `Rag` 的有效级别为 `SUMMARY`
- **WHEN** 系统应用“检索知识”业务标题
- **THEN** 系统 MUST NOT 增加、删除或改写 RAG 的 `safeResult`、来源、预览或其他详情字段

#### Scenario: 命令详情只本地化标签

- **GIVEN** 命令结果在 `DETAIL` 下包含允许的 exit status、stdout preview 和 stderr preview
- **WHEN** 用户在中文界面展开详情
- **THEN** 退出状态、标准输出和错误信息标签 MUST 使用中文平台文案
- **AND** 数值与 preview MUST 保持既有内容、顺序和截断结果
- **AND** 界面 MUST NOT 补充原始命令或命令名称

#### Scenario: Python 详情不显示脚本名称

- **GIVEN** Python 结果在 `DETAIL` 下已有安全输出字段
- **WHEN** 用户展开详情
- **THEN** 界面 MUST 继续显示既有安全字段及本地化标签
- **AND** 系统 MUST NOT 新增脚本名、程序名、代码、参数或执行目标字段

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：Capability 步骤依据最小公开身份和前端集中映射显示业务标题；映射不可用时保留合法技术身份，过程结构与结果披露范围不变。
- **依据 Requirements**：本 change 的全部 Requirements。

### 前置条件

- **变更类型**：修改
- **目标内容**：系统已解析当前 Capability；集成产品可随前端产物提供扩展能力名称映射，映射缺失不影响能力执行。

### 输入

- **变更类型**：修改
- **目标内容**：既有 Capability lifecycle 事实、执行入口 `capabilityKind + capabilityId`、可选 `targetCapabilityId`、当前前端映射和语言资源。

### 输出

- **变更类型**：修改
- **目标内容**：started/completed 输出最小身份；前端按映射名称、目标能力 id、执行入口 id和通用标题顺序降级，并仅在有效时显示既有安全摘要和详情。

### 处理过程

- **变更类型**：修改
- **目标内容**：执行边界形成身份；started/completed 复用；channel 安全投影；前端集中解析业务名称并拼接既有状态。

### 结果

- **变更类型**：修改
- **目标内容**：已适配 Capability 显示业务语言；未适配能力、旧后端和旧历史保留当前执行身份，现有流程和结果披露保持不变。
