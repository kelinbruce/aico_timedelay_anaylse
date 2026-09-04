## Function

- **所属 Function**：`FN-7.8 上报 AI 日志`
- **Function 变更类型**：新增
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: OperationLogGatewayPort 是 AI 日志上报出口

系统 MUST 新增 `OperationLogGatewayPort` 接口，作为 AI 日志向 CloudSop 合规审计系统上报的受治理出口。`OperationLogGatewayPort` MUST 暴露 `writeAiLog(entry)` 方法，接受 `OperationLogEntry` 和可选 `AbortSignal`，返回 `Promise<void>`。`OperationLogEntry` MUST 包含 operation、source、target、detail、level、result、tenantId、userName、terminalIP、logType、systemLang 和 show 字段，且该结构 MUST 是 CloudSop API 的完整请求体。

`OperationLogGatewayPort` MUST NOT 进入 `GatewayBindings`、MUST NOT 新增 `GatewayAdapterKind`，MUST NOT 走 gateway provider 选择机制。`OperationLogGatewayPort` MUST 通过 trusted app composition 直接注入到 `postTerminalCallback` 闭包，MUST NOT 由 runtime 动态 import 或远程加载，MUST NOT 进入 `RequestLifecycleDependencies` 接口。

`OperationLogGatewayPort` MUST 只在 REMOTE 部署模式下创建实例。LOCAL 部署模式下 port 为 undefined 时 MUST 跳过 AI 日志上报，MUST NOT 因此 fail。系统 MUST NOT 在运行时从 LOCAL 回退到 REMOTE 或从 REMOTE 回退到 LOCAL。

常规 opLog MUST NOT 使用此 port。常规 opLog 的声明机制（路由 config + opLogIdentity）保持不变，其采集和上报逻辑由另一个 repo 的 remote 包独立完成。

`writeAiLog` 返回 `Promise<void>` — 调用方不消费返回值，上报失败由 `postTerminalCallback` 的 try-catch 包裹只记 warn。

**需求类别**：功能性需求

#### Scenario: AI 日志通过 gateway port 上报

- **WHEN** run 到达终态且 `OperationLogGatewayPort` 存在
- **THEN** 系统 MUST 调用 `writeAiLog(entry)` 上报 AI 日志
- **AND** MUST NOT 绕过 port 直接调用 CloudSop HTTP 端点

#### Scenario: LOCAL 部署跳过 AI 日志上报

- **WHEN** 部署模式为 LOCAL 且 `OperationLogGatewayPort` 为 undefined
- **THEN** 系统 MUST 跳过 AI 日志上报
- **AND** MUST NOT 因此 fail 或影响业务流程

#### Scenario: 上报失败不影响业务流程

- **WHEN** `writeAiLog` 调用失败（网络错误、超时或返回错误）
- **THEN** 系统 MUST 只记本地 warn 日志
- **AND** MUST NOT 影响 request lifecycle、terminal commit 或业务流程

### Requirement: 所有终态都上报 AI 日志

系统 MUST 在 `postTerminalCallback` 中为所有终态的 run 上报 AI 日志。AI 日志逻辑 MUST 在 `postTerminalCallback` 闭包中的 `if (status !== 'COMPLETED') return` early-return 之前执行，因为所有终态都要上报。`postTerminalCallback` 以 fire-and-forget 模式执行（`void Promise.resolve().then(...).catch(...)`），AI 日志上报发生在 terminal commit 之后，不阻塞 terminal commit。

COMPLETED 终态的 `result` MUST 为 `"SUCCESSFUL"`；FAILED 和 CANCELED 终态的 `result` MUST 为 `"FAILURE"`。

前置条件：run 已到达终态（terminal commit 已完成），USER message 和 ASSISTANT message 已持久化到 `messageStore`，`command.inputVariables.requestHeaders` 携带 terminalIP。

AI 日志 entry 的固定字段：`operation` 为中文 `"创建对话资源访问详情"` 或英文 `"Create chat resource access details"`（按审计 locale 选择）；`source` MUST 固定为 `"NextAgent"`；`target` 为中文 `"对话"` 或英文 `"chat"`（按审计 locale 选择）；`level` MUST 固定为 `"MINOR"`；`logType` MUST 固定为 `"OperationLog"`；`show` MUST 固定为 `true`。

`tenantId` MUST 来自 `command.identityContext.tenantId`，`userName` MUST 来自 `command.identityContext.displayName`，`systemLang` MUST 来自审计 locale：部署环境变量 `OSS_LANG`（下划线格式如 `zh_CN`、`en_US`）优先，未设置时降级到 `command.locale`。`OSS_LANG` 的下划线分隔符 MUST 归一化为连字符格式。此约定与常规 opLog 的部署语言决策一致，`terminalIP` MUST 来自 `command.inputVariables.requestHeaders` 中由 channel 层捕获的客户端 IP。

系统 MUST NOT 上报 AI 系统版本信息 — 该信息可从 CloudSop 管理页面或后台获取和追踪。

**需求类别**：功能性需求

#### Scenario: COMPLETED 终态上报 SUCCESSFUL

- **WHEN** run 到达 COMPLETED 终态
- **THEN** AI 日志 entry 的 `result` MUST 为 `"SUCCESSFUL"`

#### Scenario: FAILED 终态上报 FAILURE 并填充 answer panel 内容

- **WHEN** run 到达 FAILED 终态
- **THEN** AI 日志 entry 的 `result` MUST 为 `"FAILURE"`
- **AND** `detail` 中系统产生的输出内容 MUST 填充用户在 answer panel 看到的失败内容

#### Scenario: CANCELED 终态上报 FAILURE

- **WHEN** run 到达 CANCELED 终态
- **THEN** AI 日志 entry 的 `result` MUST 为 `"FAILURE"`

#### Scenario: 无 ASSISTANT 消息时输出内容为空

- **WHEN** run 在产生任何 ASSISTANT 消息之前就失败（如模型调用前 crash）
- **AND** `listCurrentRequestMessages` 返回的消息列表中没有 ASSISTANT 消息
- **THEN** `detail` 中系统产生的输出内容 MUST 为空字符串
- **AND** AI 日志 MUST 正常上报

#### Scenario: Guardrail 拦截轮次上报且资源名称为空

- **WHEN** guardrail 拦截的 round 到达 COMPLETED 终态（模型未被调用）
- **THEN** AI 日志 MUST 正常上报
- **AND** `result` MUST 为 `"SUCCESSFUL"`
- **AND** `detail` 中被访问的资源名称 MUST 为空字符串
- **AND** `detail` 中系统接收的输入内容 MUST 为被拦截的用户输入
- **AND** `detail` 中系统产生的输出内容 MUST 为拒绝消息

### Requirement: detail 字段按 locale 选择模板

`detail` 字段 MUST 按审计 locale 选择中英文模板填充。中文 locale（`zh-CN`）使用中文冒号 `：` 和中文分号 `；`，英文 locale（`en-US`）使用英文冒号 `:` 和英文分号 `;`。每项 MUST 独占一行，冒号后不换行，分号后换行。模板本身 MUST 包含 `\n` 换行符，不需要格式化后处理。

`detail` MUST 包含 4 个参数：
1. 对话 id — 来自 `run.sessionId`，不截断。
2. 被访问的资源名称 — 模型名去重列表 + km 标记，用对应语言版本分号分隔，不截断。
3. 系统接收的输入内容 — USER message content，不截断。
4. 系统产生的输出内容 — 最后一条 ASSISTANT message content，截断至 1024 个字符。

截断 MUST 按 Unicode 字符数（`String.prototype.slice(0, 1024)`），MUST NOT 按字节。

**需求类别**：功能性需求

#### Scenario: 中文 locale 使用中文标点模板

- **WHEN** 审计 locale 为 `zh-CN`
- **THEN** `detail` MUST 使用中文冒号 `：` 和中文分号 `；`
- **AND** 每项 MUST 独占一行，分号后换行

#### Scenario: 英文 locale 使用英文标点模板

- **WHEN** 审计 locale 为 `en-US`
- **THEN** `detail` MUST 使用英文冒号 `:` 和英文分号 `;`
- **AND** 每项 MUST 独占一行，分号后换行

#### Scenario: 输出内容截断至 1024 个字符

- **WHEN** 最后一条 ASSISTANT message content 超过 1024 个字符
- **THEN** `detail` 中系统产生的输出内容 MUST 截断至前 1024 个字符
- **AND** 截断 MUST 按 Unicode 字符数，MUST NOT 按字节

### Requirement: 通过 timeline 事件监听收集模型名和 km 标记

系统 MUST 通过 `RequestLifecycleDependencies.runTimelineEventListeners` 注册 listener，按 `runId` 在内存 Map 中收集模型名和 km 标记。listener MUST NOT 在 `OperationLogGatewayPort` 为 undefined 时注册。

`MODEL_INVOCATION_COMPLETED` 事件 MUST 触发取 `inlinePayload.modelId` 加入该 runId 的模型名 Set。`CAPABILITY_COMPLETED` 事件 MUST 触发 km 标记判断，两种来源：
- agent loop 的 RagTool：`inlinePayload.capabilityId === 'Rag'` 且 `inlinePayload.status === 'SUCCEEDED'`。
- workflow knowledge 节点：`inlinePayload.nodeType === 'KNOWLEDGE_SEARCH'` 或 `'KNOWLEDGE_QA'`（workflow 事件通过 `attachWorkflowFields` 注入了 `nodeType`），且 `inlinePayload.status === 'SUCCEEDED'`。

内存 Map 在 `postTerminalCallback` 取出后 MUST 清理对应 runId 的条目。内存 Map 是 process-local 的，生命周期为从 run 首次产生 timeline 事件到 postTerminalCallback 取出。

收集是 process-local 的。runtime recovery 场景下新实例没有原始事件，内存 Map 为空，`detail` 中被访问的资源名称 MUST 为空字符串。这是可接受的降级 — 系统 MUST NOT 因此跳过 AI 日志上报。

系统 MUST NOT 引入 Redis 或其他跨实例状态传递方式用于模型名收集。系统 MUST NOT 修改 `agent-runtime`、`agent-core` 或 `agent-capability`。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: 模型调用记录 modelId

- **WHEN** `MODEL_INVOCATION_COMPLETED` 事件到达 listener
- **THEN** 系统 MUST 取 `inlinePayload.modelId` 加入该 runId 的模型名 Set

#### Scenario: Agent loop RagTool 记录 km 标记

- **WHEN** `CAPABILITY_COMPLETED` 事件的 `inlinePayload.capabilityId === 'Rag'` 且 `status === 'SUCCEEDED'`
- **THEN** 系统 MUST 标记该 runId 的 km 标记

#### Scenario: Workflow knowledge 节点记录 km 标记

- **WHEN** `CAPABILITY_COMPLETED` 事件的 `inlinePayload.nodeType` 为 `KNOWLEDGE_SEARCH` 或 `KNOWLEDGE_QA` 且 `status === 'SUCCEEDED'`
- **THEN** 系统 MUST 标记该 runId 的 km 标记

#### Scenario: Recovery 实例资源名称为空

- **WHEN** runtime 实例崩溃后另一个实例通过 recovery 拉起未完成的 run
- **THEN** AI 日志 MUST 正常上报
- **AND** `detail` 中被访问的资源名称 MUST 为空字符串
- **AND** MUST NOT 因此跳过 AI 日志上报

#### Scenario: Port 不存在时不注册 listener

- **WHEN** `OperationLogGatewayPort` 为 undefined（如 LOCAL 部署）
- **THEN** 系统 MUST NOT 注册 timeline event listener
- **AND** MUST NOT 产生内存开销

### Requirement: CloudSop 审计通道是受控脱敏例外

CloudSop 合规审计通道 MUST 是 redaction-policy 的受控例外。该通道 MUST 只上报用户原始文本输入（USER message content）和最终 assistant 输出（ASSISTANT message content，截断至 1024 个字符），MUST NOT 上报 prompt 全文、stream delta、tool 调用细节、reasoning、provider raw body、路径、credential 或其他 special field。

AI 日志上报路径 MUST NOT 经过 `ObservabilityProjectorHost`、`StructuredLogProjector`、`AuditProjector` 或任何 observability 投影路径。AI 日志 MUST 通过独立的 `OperationLogGatewayPort.writeAiLog` 路径直接上报 CloudSop。

AI 日志的 `detail` 字段中的用户输入和系统输出 MUST NOT 进入 Web API、SSE、WebSocket、timeline、SafeError、audit、metric、trace 或 `ObservabilityObservationEvent`。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: AI 日志内容不进入可观测面

- **WHEN** AI 日志 entry 包含用户原始输入和 assistant 输出
- **THEN** 该内容 MUST NOT 进入 `ObservabilityProjectorHost`
- **AND** MUST NOT 进入 Web API、SSE、WebSocket、timeline 或 audit

#### Scenario: AI 日志只包含用户输入和 assistant 输出

- **WHEN** AI 日志 entry 的 detail 字段被构建
- **THEN** detail MUST 只包含对话 id、资源名称、用户原始输入和 assistant 输出（截断）
- **AND** MUST NOT 包含 prompt 全文、stream delta、tool 调用细节、reasoning 或 provider raw body

### Requirement: terminalIP 从请求头捕获

channel 层 MUST 扩展 `extractRequestHeaders` 捕获客户端 IP。客户端 IP 的解析优先级 MUST 为 `x-real-client-addr` → `x-forwarded-for`（取第一个逗号前值）→ `request.ip`。terminalIP MUST 通过 `inputVariables.requestHeaders` 传入 runtime，`postTerminalCallback` MUST 从 `command.inputVariables.requestHeaders` 读取。

**需求类别**：功能性需求

#### Scenario: terminalIP 来自 x-real-client-addr

- **WHEN** 请求头包含 `x-real-client-addr`
- **THEN** terminalIP MUST 取 `x-real-client-addr` 的值

#### Scenario: terminalIP 来自 x-forwarded-for

- **WHEN** 请求头不包含 `x-real-client-addr` 但包含 `x-forwarded-for`
- **THEN** terminalIP MUST 取 `x-forwarded-for` 第一个逗号前的值

#### Scenario: terminalIP 来自 request.ip

- **WHEN** 请求头不包含 `x-real-client-addr` 和 `x-forwarded-for`
- **THEN** terminalIP MUST 取 `request.ip`

## Function 变更汇总

### 描述

- **变更类型**：新增
- **目标内容**：新增 AI 日志合规审计上报通道，在 run 到达终态后向 CloudSop 上报用户原始输入和系统输出（截断），支持所有终态和中英文 locale 模板。
- **依据 Requirements**：`OperationLogGatewayPort 是 AI 日志上报出口`、`所有终态都上报 AI 日志`、`detail 字段按 locale 选择模板`、`通过 timeline 事件监听收集模型名和 km 标记`、`CloudSop 审计通道是受控脱敏例外`、`terminalIP 从请求头捕获`

### 前置条件

- **变更类型**：新增
- **目标内容**：run 已到达终态（terminal commit 已完成），USER message 和 ASSISTANT message 已持久化到 `messageStore`，`command.inputVariables.requestHeaders` 携带 terminalIP，部署环境变量 `OSS_LANG` 或 `command.locale` 决定审计 locale。
- **依据 Requirements**：`所有终态都上报 AI 日志`、`terminalIP 从请求头捕获`

### 输入

- **变更类型**：新增
- **目标内容**：`command.identityContext`（tenantId、displayName）、部署环境变量 `OSS_LANG`、`command.locale`（审计 locale 降级来源）、`command.inputVariables.requestHeaders`（terminalIP）、`run.sessionId`、内存 Map 中按 runId 收集的模型名和 km 标记、`messageStore.listCurrentRequestMessages` 返回的 USER 和 ASSISTANT message content。
- **依据 Requirements**：`所有终态都上报 AI 日志`、`通过 timeline 事件监听收集模型名和 km 标记`、`terminalIP 从请求头捕获`

### 输出

- **变更类型**：新增
- **目标内容**：通过 `OperationLogGatewayPort.writeAiLog` 向 CloudSop 发送一条 `OperationLogEntry`，包含对话 ID、资源名称、用户原始输入和系统输出（截断至 1024 个字符）。内存 Map 中对应 runId 的条目被清理。上报失败只记本地 warn。
- **依据 Requirements**：`OperationLogGatewayPort 是 AI 日志上报出口`、`所有终态都上报 AI 日志`、`通过 timeline 事件监听收集模型名和 km 标记`、`CloudSop 审计通道是受控脱敏例外`

### 处理过程

- **变更类型**：新增
- **目标内容**：run 到达终态后，`postTerminalCallback` 以 fire-and-forget 方式组装 AI 日志 entry：从 command 获取身份，从 `OSS_LANG`（优先）或 `command.locale`（降级）解析审计 locale，从内存 Map 获取模型名和 km 标记，从 messageStore 获取 question 和 answer（截断），用 locale 模板填充 detail，调用 `writeAiLog` 上报。所有终态都上报，失败不影响业务流程。
- **依据 Requirements**：`所有终态都上报 AI 日志`、`detail 字段按 locale 选择模板`、`通过 timeline 事件监听收集模型名和 km 标记`

### 结果

- **变更类型**：新增
- **目标内容**：COMPLETED 终态 result 为 SUCCESSFUL，FAILED/CANCELED 终态 result 为 FAILURE。CloudSop 收到一条完整审计记录。无 ASSISTANT 消息时输出内容为空字符串。Recovery 场景资源名称为空字符串。
- **依据 Requirements**：`所有终态都上报 AI 日志`、`通过 timeline 事件监听收集模型名和 km 标记`

### 规格

| 规格项 | 变更类型 | 原规格值 | 目标规格值 | 依据 Requirements |
|---|---|---|---|---|
| 触发时机 | 新增 | 不适用（新增） | terminal commit 后 fire-and-forget，所有终态（COMPLETED/FAILED/CANCELED）都触发 | `所有终态都上报 AI 日志` |
| 输出截断 | 新增 | 不适用（新增） | ASSISTANT message content 截断至 1024 个 Unicode 字符 | `detail 字段按 locale 选择模板` |
| 部署模式 | 新增 | 不适用（新增） | 仅 REMOTE 模式创建 port 实例，LOCAL 跳过 | `OperationLogGatewayPort 是 AI 日志上报出口` |
| 安全边界 | 新增 | 不适用（新增） | CloudSop 通道是 redaction-policy 受控例外，不经过 observability 投影路径 | `CloudSop 审计通道是受控脱敏例外` |
