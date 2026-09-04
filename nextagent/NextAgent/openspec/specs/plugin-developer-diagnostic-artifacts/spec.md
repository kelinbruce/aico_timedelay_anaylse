# plugin-developer-diagnostic-artifacts Specification

## Purpose
定义插件开发诊断记录的统一接收、归集和可追踪产物契约，确保开发诊断不会形成绕过标准观测与安全边界的平行输出路径。
## Requirements
### Requirement: 系统统一接收插件开发诊断记录

系统 MUST 向任一受支持部署模式中已通过启动校验的全部插件提供 `DeveloperDiagnosticArtifactSink.emit(input)`；该 sink MUST 在 LOCAL、REMOTE 和后续受支持部署模式中默认可写。`input` MUST 只包含 `artifactType`、可选可信运行坐标和 JSON-compatible `payload`，MUST NOT 包含 `pluginId`、文件目录、文件名、轮转、压缩或保留策略。系统 MUST 从已校验的插件 manifest 绑定 `pluginId`，并为每次调用返回 `ACCEPTED` 或 `DROPPED`；`DROPPED` 时 MUST 返回 `INVALID_RECORD`、`RECORD_TOO_LARGE`、`QUEUE_OVERLOADED` 或 `OUTPUT_UNAVAILABLE` 中恰好一个稳定 reason code。

**需求类别**：功能性需求

#### Scenario: 两种部署模式均接受合法记录
- **WHEN** 官方 LOCAL 产品入口和官方 REMOTE 产品入口分别加载同一个已通过启动校验的插件，且插件提交合法 `artifactType`、JSON-compatible `payload` 和可用运行坐标
- **THEN** 两个部署中的系统 MUST 都返回 `ACCEPTED`
- **AND** 两条对应物理记录 MUST 使用各自 manifest 绑定的 `pluginId`

#### Scenario: 插件尝试控制物理输出
- **WHEN** 任一部署模式中的插件提交文件目录、文件名、轮转、压缩、保留策略或自声明 `pluginId`
- **THEN** 系统 MUST 返回 `DROPPED`
- **AND** reason code MUST 为 `INVALID_RECORD`
- **AND** 系统 MUST NOT 创建或修改该输入指定的文件

### Requirement: 开发诊断记录使用独立的短期产物文件族

系统首次接受合法 developer diagnostic artifact 记录时 MUST 创建直接位于 `paths.logDirectory` 的独立 NDJSON active segment，并把该记录完整写入该文件族；系统在首次接受记录前 MUST NOT 创建该文件族的 active segment。文件名 MUST 使用 `nextagent-plugin-diagnostic` 专属前缀，且 MUST NOT 为该文件族创建额外子目录。每个物理记录 MUST 是一条完整 UTF-8 JSON line，并包含 `schemaVersion=1`、`recordedAt`、宿主绑定的 `pluginId`、`artifactType`、可用可信运行坐标和 `payload`。该文件族 MUST NOT 与 operational log、audit 或 metrics 共享 active destination、文件 selector、maintenance state 或 retention lifecycle。

**需求类别**：功能性需求

#### Scenario: 没有历史成员和接受记录时不创建文件族
- **WHEN** 应用启动前不存在 developer diagnostic artifact 文件族成员，且应用完成启动、运行和关闭期间没有任何合法记录被系统接受
- **THEN** 系统 MUST NOT 在 `paths.logDirectory` 创建任何 `nextagent-plugin-diagnostic` 文件族成员

#### Scenario: 第一条合法记录创建文件族
- **WHEN** 系统首次接受一条合法 developer diagnostic artifact 记录
- **THEN** 系统 MUST 创建 `nextagent-plugin-diagnostic` 文件族并完整写入该记录
- **AND** 返回结果 MUST 为 `ACCEPTED`

### Requirement: 产物写入具有有界容量和生命周期

系统启动后 MUST 对已经存在的 developer diagnostic artifact 文件族成员启动 reconciliation 和周期 maintenance，但在首次接受合法记录前 MUST NOT 创建 active segment；首次接受合法记录后 MUST 启动包含 active destination 的完整 lifecycle。系统 MUST 对该文件族应用固定 daily boundary 或 active segment 达到 `30 MiB` 时轮转，以先发生者为准。closed segment MUST 通过 `.gz.tmp` 后原子提交 `.gz`，并只在 committed archive 存在后删除 closed source。系统 MUST 从 `closedAt` 起保留 closed source 或 archive `3` 个 elapsed days，并 MUST 最多保留 `10` 个 committed gzip archive；elapsed retention 与 archive count MUST 作为独立删除条件持续生效，数量超限时 MUST 按 `mtime`、文件名最旧优先删除该文件族精确拥有的 archive。reconciliation 和周期 maintenance MUST 只处理该文件族精确拥有的 regular files，且 MUST NOT 因维护本身创建 active segment。单条包含换行分隔符的 serialized record MUST 不超过 `4 MiB`；超过上限的记录 MUST 以 `RECORD_TOO_LARGE` 丢弃，MUST NOT 部分写入或任意截断。

**需求类别**：系统质量属性
**质量属性**：性能/容量
**适用范围**：该 Function

#### Scenario: 无记录启动时只维护历史成员
- **WHEN** 应用启动时存在 developer diagnostic artifact closed segment 或 archive，且本进程尚未接受合法记录
- **THEN** 系统 MUST 对既有成员执行 reconciliation、压缩、elapsed retention 和 archive count maintenance
- **AND** maintenance MUST NOT 创建 active segment

#### Scenario: 第一条记录启动文件生命周期
- **WHEN** 系统首次接受一条合法 developer diagnostic artifact 记录
- **THEN** 系统 MUST 创建 active destination 并由完整 lifecycle 接管该文件族的 reconciliation 和周期 maintenance
- **AND** 该记录 MUST 受 `30 MiB`、`3` elapsed days、最多 `10` 个 committed gzip archive 和单条 `4 MiB` 的既有边界约束

#### Scenario: 30 MiB 大小边界触发轮转与压缩
- **WHEN** active segment 接受下一条完整记录后达到或超过 `30 MiB`
- **THEN** 系统 MUST 关闭该 segment 并为后续记录选择新的 active segment
- **AND** closed segment MUST 最终形成可恢复的 committed gzip archive

#### Scenario: 压缩归档数量超过十个
- **WHEN** 该文件族提交第十一个仍未达到 `3` elapsed days 的 gzip archive
- **THEN** maintenance MUST 删除该文件族精确拥有的最旧 archive
- **AND** 成功 maintenance 后 committed gzip archive 数量 MUST 不超过 `10`

#### Scenario: 单条记录超过上限
- **WHEN** 一条记录的 UTF-8 serialized bytes 加换行超过 `4 MiB`
- **THEN** 系统 MUST 返回 `DROPPED`
- **AND** reason code MUST 为 `RECORD_TOO_LARGE`
- **AND** active segment MUST 不包含该记录的部分内容

### Requirement: 产物失败不改变受保护操作

`DeveloperDiagnosticArtifactSink.emit` MUST 使用有界异步 enqueue，MUST NOT 在插件 Hook、Tool 或 Policy 路径执行同步文件 append、同步 flush、gzip、目录扫描或 retention。记录非法、记录超限、队列过载、destination 不可用、maintenance 失败或 close 超时时，系统 MUST NOT 改变插件贡献的业务结果、request terminal result 或 Agent activation；系统 MUST 更新受信本地开发诊断状态，且 MUST NOT 把该失败写入 operational log、audit、metrics、timeline、stream 或 Web 公共响应。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: 产物 destination 不可用
- **WHEN** 插件执行期间 developer diagnostic artifact destination 不可用
- **THEN** `emit` MUST 返回 `DROPPED` 与 `OUTPUT_UNAVAILABLE`
- **AND** 插件受保护操作 MUST 继续其原有结果
- **AND** 主运行日志 MUST 不出现 artifact payload 或该写入失败的镜像记录

### Requirement: 本地状态只暴露有界安全证据

受信本地开发诊断状态 MUST 只包含 `availability=AVAILABLE|DEGRADED`、范围为 `0..2147483647` 的 saturating `droppedCount` 和可选 `lastFailureCode`。状态 MUST NOT 包含 artifact payload、原始异常、宿主路径、credential、token、tenant identity 或 subject identity。系统提供可写 sink 且尚未接受记录时，availability MUST 为 `AVAILABLE`；任一记录或 lifecycle failure 后 availability MUST 为 `DEGRADED`；成功重新建立 destination 后 availability MUST 恢复为 `AVAILABLE`，但 `droppedCount` MUST 保留进程内累计值。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 尚未接受记录时状态可用
- **WHEN** 系统已提供可写 sink 且尚未接受任何 developer diagnostic artifact 记录
- **THEN** 受信本地开发诊断状态 MUST 返回 `availability=AVAILABLE`
- **AND** 查询状态 MUST NOT 创建该文件族成员

#### Scenario: 本地开发者查询降级状态
- **WHEN** 至少一条记录因 `QUEUE_OVERLOADED` 被丢弃
- **THEN** 受信本地状态 MUST 返回 `availability=DEGRADED`
- **AND** `droppedCount` MUST 至少为 `1`
- **AND** `lastFailureCode` MUST 为 `QUEUE_OVERLOADED`
- **AND** 状态 MUST 不暴露被丢弃的 payload

### Requirement: 原始调测内容与主输出面隔离

developer diagnostic artifact MAY 包含显式启用调测插件所需的用户问题、模型输入输出、Tool 参数或结果以及上下文内容；选择主体是受信本地运维人员，选择条件是 Agent activation 启用相应调测插件，未满足该条件时内置调测插件 MUST NOT 生成记录。系统配置 MUST NOT 提供 `developerDiagnostics` 或其他 artifact 输出开关。系统 MUST 把该文件族视为潜在敏感内容，MUST NOT 将其读取、投影或镜像到 operational log、audit、metrics、timeline、stream、Web 公共 API 或普通 readiness payload。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：系统

#### Scenario: 默认未启用调测插件
- **WHEN** 目标 Agent 未激活调测插件
- **THEN** 内置调测插件 MUST NOT 为请求生成 developer diagnostic artifact 记录
- **AND** 没有其他合法记录被接受时，系统 MUST NOT 创建该文件族成员

#### Scenario: 配置尝试控制 artifact 输出
- **WHEN** 系统配置包含 `developerDiagnostics` 或其他 artifact 输出开关
- **THEN** 启动校验 MUST 拒绝该未知配置
- **AND** 系统 MUST NOT 因该配置改变 sink 的可写性或 Agent activation 语义

#### Scenario: 主输出维护扫描共享日志目录
- **WHEN** operational、audit 或 metrics maintenance 在 `paths.logDirectory` 遇到 developer diagnostic artifact family member
- **THEN** 该 maintenance MUST 保留该文件
- **AND** 只有 developer diagnostic artifact lifecycle MAY 轮转、压缩或删除它

### Requirement: 内置调测插件提交统一记录

`developer-hook-trace` 在每个已激活且受支持的 lifecycle stage MUST 提交恰好一条 `artifactType=developer-hook-trace` 记录，保留既有 trace coordinates 与原始 boundary 内容。每条记录的 payload MUST 包含 `printedAt`，值为插件 formatter 创建该 entry 时生成的 ISO-8601 时间字符串，表示本地 trace 打印时间；`printedAt` MUST NOT 从 runtime、provider 或宿主配置接收，也 MUST NOT 参与模型 latency 计算。payload MUST 只把 stage-owned business payload（包括 model timing）保留在原始 `boundary` 内，MUST NOT 把 `boundary` 字段复制为顶层 `raw*`、`modelFirstContentLatencyMs`、`modelE2ELatencyMs` 或其他平行字段，MUST NOT 从 trace 打印时间戳派生额外的模型 latency。当 `AFTER_MODEL_RESULT` boundary 不携带 `firstContentLatencyMs` 或 `modelE2ELatencyMs` 时，插件 MUST 仍写入该 boundary 并返回 `PASS`，MUST NOT 要求匹配的 timing 实现变更。`context-monitor` MUST 在每次完成上下文压缩后提交恰好一条 `artifactType=context-evolution.compaction` 记录，并在每次 Agent terminal 前提交恰好一条 `artifactType=context-evolution.terminal` 记录；它 MUST 保留现有 pre-compression、post-compression、summary、latest messages 和 latest answer 语义。两个插件 MUST NOT 接受或使用 `logDirectory`、`logFile`，MUST NOT 直接创建、追加、覆盖、轮转或删除宿主文件。

**需求类别**：功能性需求

#### Scenario: Developer hook trace 记录模型调用边界
- **WHEN** 已激活 `developer-hook-trace` 的 Agent 进入 `BEFORE_MODEL_INVOKE`
- **THEN** 插件 MUST 提交恰好一条 `artifactType=developer-hook-trace` 记录
- **AND** payload MUST 保留该 stage 的原始 boundary 与可用 trace coordinates

#### Scenario: Developer hook trace 记录包含打印时间
- **WHEN** `developer-hook-trace` 写入任一受支持的 lifecycle hook boundary
- **THEN** 记录 payload MUST 包含 `printedAt`
- **AND** `printedAt` MUST 为表示本地 trace 打印时间的 ISO-8601 字符串
- **AND** 记录 MUST 保持原始 `boundary` 不变

#### Scenario: Developer hook trace 只有一个 lifecycle payload 位置
- **WHEN** `developer-hook-trace` 写入任一受支持的 lifecycle hook boundary
- **THEN** 记录 MUST 把 stage-owned business payload（含 model timing）只保留在 `boundary` 内
- **AND** MUST NOT 把 `boundary` 字段复制为顶层 `raw*`、`modelFirstContentLatencyMs`、`modelE2ELatencyMs` 或其他平行字段
- **AND** MUST NOT 从 trace 打印时间戳派生额外的模型 latency

#### Scenario: Developer hook trace 接受无 timing metadata 的模型结果
- **WHEN** 既有 host 加载插件 artifact 并调用不携带 `firstContentLatencyMs` 或 `modelE2ELatencyMs` 的 `AFTER_MODEL_RESULT` boundary
- **THEN** 插件 MUST 写入该 boundary 并返回 `PASS`
- **AND** MUST NOT 要求匹配的 host timing 实现变更

#### Scenario: Context monitor 记录压缩与终态
- **WHEN** 一个已激活 `context-monitor` 的请求完成一次上下文压缩并随后进入 terminal
- **THEN** 插件 MUST 提交恰好一条 compaction record 和恰好一条 terminal record
- **AND** 插件 MUST 不创建 session-specific 文件
