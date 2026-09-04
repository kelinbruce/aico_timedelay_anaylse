#### Scenario: NODE_FAILED 事件携带 safeError

- **GIVEN** `workflowTrace.enabled: true` 且 workflow 正在执行
- **WHEN** engine 发出携带 `safeError` 的 `NODE_FAILED` 事件
- **THEN** trace collector MUST 在 payload 中包含 `safeError` 字段
- **AND** `safeError` MUST 包含 `code`、`message`、`category`

﻿## Function

- **所属 Function**：FN-9.1 执行工作流
- **Function 变更类型**：MODIFIED
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: workflow execution trace 默认关闭且可配置开关

系统 MUST 在 `DefaultSystemConfig` 中提供 optional `workflowTrace` 字段，其 `enabled` 属性 MUST 为 boolean。字段不存在时系统 MUST 等价为 `enabled: false`。

trace 在 workflow 执行期间同步触发，由 `workflowExecutionService.execute()` 调用驱动：engine emit 的 `WorkflowExecutionEvent` 驱动节点级 trace，node handler 内部对 model/capability/sandbox service 的调用驱动三方调用级 trace。trace 的文件写入通过 `DeveloperDiagnosticArtifactWriter` 的有界异步 enqueue 完成，不阻塞 workflow 执行路径。

`enabled: false` 时系统 MUST NOT 创建 trace collector、MUST NOT 包装注入 node catalog 的 service、MUST NOT 产生任何 workflow trace 诊断数据、MUST NOT 产生任何性能开销。`enabled: true` 且 `developerDiagnosticArtifactWriter` 可用时系统 MUST 在 composition 层创建 trace collector 并包装 service。`enabled: true` 但 `developerDiagnosticArtifactWriter` 不可用时系统 MUST 跳过 trace 创建，返回原始 `WorkflowExecutionService`，不影响 workflow 执行。

**需求类别**：功能性需求

#### Scenario: 默认不开启 trace

- **GIVEN** `default-system.yaml` 不含 `workflowTrace` 字段
- **WHEN** 系统启动并组装 workflow execution layer
- **THEN** 系统 MUST NOT 创建 trace collector
- **AND** 系统 MUST NOT 包装 model/capability/sandbox service
- **AND** workflow 执行 MUST NOT 产生任何 `workflow-node-trace` 或 `workflow-boundary-trace` artifact

#### Scenario: 显式开启 trace

- **GIVEN** `default-system.yaml` 配置 `workflowTrace.enabled: true` 且 `developerDiagnosticArtifactWriter` 可用
- **WHEN** 系统启动并组装 workflow execution layer
- **THEN** 系统 MUST 创建 trace collector
- **AND** 系统 MUST 用 timing wrapper 包装 model/capability/sandbox service 后注入 node catalog
- **AND** workflow 执行 MUST 通过 `DeveloperDiagnosticArtifactWriter` 输出 trace artifact

#### Scenario: 显式关闭 trace

- **GIVEN** `default-system.yaml` 配置 `workflowTrace.enabled: false`
- **WHEN** 系统启动并组装 workflow execution layer
- **THEN** 系统 MUST NOT 创建 trace collector
- **AND** 系统 MUST NOT 包装 service

#### Scenario: writer 不可用时跳过 trace

- **GIVEN** `default-system.yaml` 配置 `workflowTrace.enabled: true` 但 `developerDiagnosticArtifactWriter` 为 undefined
- **WHEN** 系统组装 workflow execution layer
- **THEN** 系统 MUST 跳过 trace 创建
- **AND** MUST 返回原始 `WorkflowExecutionService`
- **AND** workflow 执行 MUST NOT 产生任何 trace artifact
- **AND** workflow 执行 MUST NOT 受影响

### Requirement: 节点级 trace 通过 observer 捕获输入输出和耗时

系统 MUST 通过实现 `WorkflowExecutionObserver` 的 trace collector 捕获节点级执行数据。trace collector 的 `emitEvent` 按以下判断顺序处理每个 `WorkflowExecutionEvent`：

1. `nodeExecutionId` 为 undefined → 跳过（START/END 脚手架节点）。
2. `eventType` 为 `NODE_STARTED` → 以 `nodeExecutionId` 为 key 暂存 `{ startedAt, nodeId, nodeType, executionId, inputKeys }`，其中 `inputKeys` 为 `Object.keys(event.input)`。
3. `eventType` 为 `NODE_COMPLETED`、`NODE_FAILED`、`NODE_SKIPPED` 或 `NODE_WAITING`（均为终态事件，同一 `nodeExecutionId` 不会再收到后续终态） → 查找暂存：
   - 有匹配 → 计算 `durationMs = event.completedAt - 暂存.startedAt`，从 `event.output` 提取 `outputKeys`，构造 payload，通过 `DeveloperDiagnosticArtifactSink.emit()` 输出 `artifactType: workflow-node-trace`，然后清除该暂存条目。
   - 无匹配 → 跳过（孤立终态事件）。
4. 其他 eventType（如 NODE_OUTPUT_DELTA） → 跳过，不做暂存或配对。
5. emitEvent 内部 MUST try-catch，异常 MUST NOT 传播给 caller observer 或 workflow 执行。

payload MUST 包含 `executionId`、`nodeId`、`nodeType`、`nodeExecutionId`、`durationMs`、`status`，MAY 包含 `inputKeys` 和 `outputKeys`。payload MUST NOT 记录 input 或 output 的值正文，MUST 只记录字段名列表。trace collector MUST NOT 修改 `WorkflowExecutionEvent` 的内容或阻止 event 传播。

trace collector MUST 通过 `WorkflowExecutionService` wrapper 与 caller observer composite：wrapper 的 `execute()` 创建 composite observer，`emitEvent` 先调 trace collector 再调 caller observer，`registerExecutionRecipe` 透传给 caller observer。

**需求类别**：功能性需求

#### Scenario: 节点完成后输出 trace

- **GIVEN** `workflowTrace.enabled: true` 且 workflow 正在执行
- **WHEN** engine 发出某节点的 `NODE_STARTED` 随后发出 `NODE_COMPLETED`
- **THEN** trace collector MUST 通过 `DeveloperDiagnosticArtifactSink.emit()` 输出一条 `artifactType` 为 `workflow-node-trace` 的记录
- **AND** 记录 MUST 包含该节点的 `executionId`、`nodeId`、`nodeType`、`nodeExecutionId`、`durationMs`、`status`
- **AND** 记录 MAY 包含 `inputKeys` 和 `outputKeys`
- **AND** 记录 MUST NOT 包含 input 或 output 的值正文

#### Scenario: 节点失败也输出 trace

- **GIVEN** `workflowTrace.enabled: true` 且 workflow 正在执行
- **WHEN** engine 发出某节点的 `NODE_STARTED` 随后发出 `NODE_FAILED`
- **THEN** trace collector MUST 输出一条 `workflow-node-trace` 记录
- **AND** 记录 MUST 包含 `status` 为失败状态
- **AND** 记录 MUST 包含 `durationMs`

#### Scenario: 节点跳过和等待也输出 trace 并清除暂存

- **GIVEN** workflowTrace.enabled: true 且 workflow 正在执行
- **WHEN** engine 发出某节点的 NODE_STARTED 随后发出 NODE_SKIPPED 或 NODE_WAITING
- **THEN** trace collector MUST 输出一条 workflow-node-trace 记录
- **AND** 记录 MUST 包含 durationMs
- **AND** 暂存条目 MUST 被清除

#### Scenario: 非终态事件不触发 trace

- **GIVEN** workflowTrace.enabled: true 且 workflow 正在执行
- **WHEN** trace collector 收到 NODE_OUTPUT_DELTA 事件
- **THEN** trace collector MUST NOT 输出 workflow-node-trace 记录
- **AND** MUST NOT 暂存或修改已有暂存

#### Scenario: START 和 END 脚手架节点也输出 trace

- **GIVEN** `workflowTrace.enabled: true`
- **WHEN** engine 发出 START 或 END 节点的 event（`nodeExecutionId` 为 undefined）
- **THEN** trace collector MUST 输出 `workflow-node-trace` 记录
- **AND** collector MUST 使用 `executionId:nodeId` 作为 fallback 暂存 key

#### Scenario: 孤立终态事件跳过

- **GIVEN** `workflowTrace.enabled: true`
- **WHEN** trace collector 收到 `NODE_COMPLETED` 但暂存中无匹配的 `NODE_STARTED`
- **THEN** trace collector MUST NOT 输出 `workflow-node-trace` 记录
- **AND** MUST NOT 抛出异常

#### Scenario: workflow 中断时暂存不泄漏

- **GIVEN** `workflowTrace.enabled: true` 且某节点已暂存 `NODE_STARTED` 但未收到匹配终态事件
- **WHEN** workflow 执行结束（包括中断、取消）
- **THEN** 暂存条目 MUST NOT 影响后续 workflow 执行
- **AND** 暂存条目 MUST NOT 产生孤立 trace 记录

#### Scenario: trace collector 与 caller observer 同时收到 event

- **GIVEN** `workflowTrace.enabled: true` 且 caller 传入了 timeline observer
- **WHEN** engine emit `WorkflowExecutionEvent`
- **THEN** trace collector MUST 收到该 event
- **AND** caller observer MUST 也收到该 event
- **AND** trace collector 的 emit 异常 MUST NOT 影响 caller observer 收到 event

### Requirement: 三方调用级 trace 通过 service wrapper 捕获耗时

系统 MUST 在 composition 层用 timing wrapper 包装注入 node catalog 的 `ModelInvocationService`、`CapabilityInvocationPort` 和 `WorkflowSandboxExecutionPort`。每次包装方法的调用按以下判断顺序处理：

1. 记录 `startedAt = Date.now()`。
2. 调用原始方法。
3. 成功返回 → emit `artifactType: workflow-boundary-trace`，payload 含 `recordedAt`、`boundaryType`、`durationMs`、`status: SUCCEEDED`。返回原值。
4. 异常 → emit `status: FAILED` 的 boundary trace，重新抛出原始异常。
5. emit 内部 MUST try-catch，异常 MUST NOT 传播。

payload MUST 包含 `recordedAt`、`boundaryType`（`MODEL`、`API` 或 `PYTHON`）、`durationMs`、`status`（`SUCCEEDED` 或 `FAILED`）。payload MUST NOT 包含调用参数、messages、prompt、modelId、capability arguments、sandbox code 或返回值正文。payload MUST NOT 包含 `nodeId` 或 `nodeExecutionId`。wrapper MUST NOT 改变原 service 的返回值或行为。wrapper MUST 在异常时重新抛出原始异常。

**需求类别**：功能性需求

#### Scenario: 模型调用输出 boundary trace

- **GIVEN** `workflowTrace.enabled: true` 且 LLM 节点正在执行
- **WHEN** wrapped `ModelInvocationService.complete()` 或 `.stream()` 被调用并返回
- **THEN** trace MUST 输出一条 `artifactType` 为 `workflow-boundary-trace` 的记录
- **AND** 记录 MUST 包含 `boundaryType: "MODEL"`、`recordedAt`、`durationMs`、`status`
- **AND** 记录 MUST NOT 包含 messages、prompt 或 model output 正文

#### Scenario: API 调用输出 boundary trace

- **GIVEN** `workflowTrace.enabled: true` 且 RESTFUL 节点正在执行
- **WHEN** wrapped `CapabilityInvocationPort.invoke()` 被调用并返回
- **THEN** trace MUST 输出一条 `artifactType` 为 `workflow-boundary-trace` 的记录
- **AND** 记录 MUST 包含 `boundaryType: "API"`、`recordedAt`、`durationMs`、`status`
- **AND** 记录 MUST NOT 包含 capability arguments 或 result 正文

#### Scenario: Python 调用输出 boundary trace

- **GIVEN** `workflowTrace.enabled: true` 且 Python 节点正在执行
- **WHEN** wrapped `WorkflowSandboxExecutionPort.runPython()` 被调用并返回
- **THEN** trace MUST 输出一条 `artifactType` 为 `workflow-boundary-trace` 的记录
- **AND** 记录 MUST 包含 `boundaryType: "PYTHON"`、`recordedAt`、`durationMs`、`status`
- **AND** 记录 MUST NOT 包含 code 或 result 正文

#### Scenario: boundary 调用失败也输出 trace

- **GIVEN** `workflowTrace.enabled: true` 且 wrapped service 调用抛出异常
- **WHEN** wrapper 捕获异常
- **THEN** trace MUST 输出 `status: "FAILED"` 的 boundary trace 记录
- **AND** wrapper MUST 重新抛出原始异常
- **AND** 异常 MUST NOT 被 wrapper 吞掉

#### Scenario: wrapper 不改变原 service 行为

- **GIVEN** `workflowTrace.enabled: true`
- **WHEN** wrapped service 被调用
- **THEN** 返回值 MUST 与未包装时完全一致
- **AND** 异常类型和 message MUST 与未包装时一致

### Requirement: workflow trace 通过 developer diagnostic artifact 输出

系统 MUST 通过已有的 `DeveloperDiagnosticArtifactWriter` 输出 workflow trace 数据。composition 层 MUST 直接调用 `writer.emit()` 并设置 `pluginId: 'workflow-trace'`（host 代码受控例外，非插件 manifest 绑定）。trace 数据 MUST 写入 `paths.logDirectory` 下的 `nextagent-plugin-diagnostic.ndjson` 文件，复用已有 writer 的文件管理策略：单文件最大 30MB、daily 或 size 滚动、gzip 压缩归档段、最多 10 个 committed archive、3 天 elapsed retention。`workflow-node-trace` 和 `workflow-boundary-trace` MUST 通过 `artifactType` 字段区分。trace 记录 MUST 携带 `schemaVersion: 1`、`recordedAt`、`pluginId`、`artifactType`、可用可信运行坐标（`sessionId`/`requestId`/`runId`/`agentId`/`agentVersion`）和 `payload` 字段，与现有 `developer-hook-trace` 记录格式一致。trace 数据 MUST NOT 进入 Web API、SSE、WebSocket、timeline、SafeError、audit、metric 或 trace。trace 数据 MUST NOT 与 operational log、audit 或 metrics 共享 active destination、文件 selector、maintenance state 或 retention lifecycle。

**需求类别**：功能性需求

#### Scenario: trace 写入已有 NDJSON 文件

- **GIVEN** `workflowTrace.enabled: true` 且 workflow 正在执行
- **WHEN** trace collector 或 boundary wrapper emit artifact
- **THEN** 数据 MUST 通过 `DeveloperDiagnosticArtifactWriter.emit()` 写入
- **AND** `pluginId` MUST 为 `workflow-trace`
- **AND** 文件名 MUST 为 `nextagent-plugin-diagnostic.ndjson`
- **AND** 目录 MUST 为 `paths.logDirectory`

#### Scenario: artifactType 区分 trace 类型

- **WHEN** 查看 NDJSON 文件中的 workflow trace 记录
- **THEN** 节点级 trace 的 `artifactType` MUST 为 `workflow-node-trace`
- **AND** 三方调用级 trace 的 `artifactType` MUST 为 `workflow-boundary-trace`

#### Scenario: trace 记录携带可信运行坐标

- **GIVEN** `workflowTrace.enabled: true` 且 workflow 在有效 session/request/run 上下文中执行
- **WHEN** trace 记录写入 NDJSON
- **THEN** 记录 MUST 携带 `sessionId`、`requestId`、`runId`、`agentId`、`agentVersion`
- **AND** 这些坐标 MUST 来自 workflow 执行的可信上下文，MUST NOT 来自客户端请求体

### Requirement: workflow trace 不影响执行安全

trace collector 和 boundary wrapper MUST 以 observe-only 方式运行。trace emit 失败 MUST NOT 影响 workflow 执行结果。trace payload MUST NOT 包含 raw prompt、raw model output、raw capability result、secret、credential、path 或高基数字段。节点级 trace 的 `inputKeys` 只记录字段名列表，MUST NOT 记录字段值。boundary trace 只记录 `recordedAt`、`boundaryType`、`durationMs`、`status`，MUST NOT 记录调用参数和返回值正文。`workflowTrace.enabled: false` 时系统 MUST NOT 产生任何性能开销。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：FN-9.1 执行工作流

#### Scenario: emit 失败不影响执行

- **GIVEN** `workflowTrace.enabled: true` 且 `DeveloperDiagnosticArtifactSink.emit()` 抛出异常
- **WHEN** workflow 节点执行
- **THEN** workflow 执行 MUST 不受影响
- **AND** 节点 MUST 正常返回结果

#### Scenario: trace 不含敏感字段

- **GIVEN** `workflowTrace.enabled: true`
- **WHEN** trace collector 或 boundary wrapper 构造 payload
- **THEN** payload MUST NOT 包含 `prompt`、`messages`、`rawModelOutput`、`capabilityResult`、`secret`、`credential`、`path` 字段
- **AND** inputKeys MUST 只包含字段名字符串，不包含字段值

#### Scenario: 关闭时零开销

- **GIVEN** `workflowTrace.enabled: false`（默认）
- **WHEN** workflow 执行
- **THEN** 系统 MUST NOT 创建 trace collector
- **AND** 系统 MUST NOT 包装 service
- **AND** workflow 执行路径 MUST 与无 trace 能力时完全一致

### Requirement: workflow trace viewer 离线查看 trace 数据

系统 MUST 在 `agent-plugin-sdk/assets/` 提供 `workflow-trace-viewer.html` 静态查看器。查看器 MUST 可独立打开、不依赖 NextAgent 服务、不发起网络请求、不写入持久存储。查看器 MUST 加载本地 NDJSON 文件，过滤 `pluginId` 为 `workflow-trace` 的记录，按 `(sessionId, requestId)` 聚合展示。查看器 MUST 展示节点轨迹（nodeId/nodeType/input/output/durationMs/status）和边界调用（boundaryType/durationMs/status/recordedAt），通过 `recordedAt` 时间戳落在节点 `startedAt`/`completedAt` 区间内关联边界调用与节点。查看器 MUST 把字符串作为文本显示，不作为 HTML 执行。查看器 MUST 对非法行降级并报告行号与原因。

**需求类别**：功能性需求

#### Scenario: 查看器加载 NDJSON 并按 session 聚合

- **GIVEN** 开发者打开 `workflow-trace-viewer.html` 并选择一份包含 `workflow-node-trace` 和 `workflow-boundary-trace` 记录的 NDJSON 文件
- **THEN** 查看器 MUST 按 `(sessionId, requestId)` 聚合记录
- **AND** MUST 展示每个节点轨迹的 nodeId、nodeType、durationMs、status
- **AND** MUST 展示每条边界调用的 boundaryType、durationMs、status

#### Scenario: 查看器不依赖网络

- **WHEN** 查看器运行
- **THEN** MUST NOT 发起网络请求
- **AND** MUST NOT 读写持久存储
- **AND** MUST NOT 依赖 NextAgent 服务

#### Scenario: 字符串作为文本显示不作为 HTML 执行

- **GIVEN** NDJSON 记录中包含 `<img src=x onerror="document.body.dataset.xss='1'">` 字符串
- **WHEN** 查看器渲染该记录
- **THEN** 字符串 MUST 作为文本显示
- **AND** MUST NOT 执行为 HTML

#### Scenario: 非法行降级报告

- **GIVEN** NDJSON 文件包含格式损坏的行
- **WHEN** 查看器解析该文件
- **THEN** 查看器 MUST 跳过非法行
- **AND** MUST 报告行号与原因

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：开发者可通过系统配置开启 workflow execution trace，获取各节点输入输出字段名、耗时及三方调用耗时的诊断数据，用于离线性能排查。trace 在 workflow 执行期间同步触发，由 engine emit 的 `WorkflowExecutionEvent` 和 node handler 内 service 调用驱动。trace 数据通过 developer diagnostic artifact NDJSON 文件输出，配套离线 HTML viewer 消费。默认关闭，开启后以 observe-only 方式运行，不影响 workflow 执行安全。
- **依据 Requirements**：workflow execution trace 默认关闭且可配置开关、节点级 trace 通过 observer 捕获输入输出和耗时、三方调用级 trace 通过 service wrapper 捕获耗时、workflow trace 通过 developer diagnostic artifact 输出、workflow trace 不影响执行安全、workflow trace viewer 离线查看 trace 数据

### 输入

- **变更类型**：修改
- **目标内容**：trace 能力的输入为 `default-system.yaml` 中的 `workflowTrace.enabled` 配置项、可用的 `developerDiagnosticArtifactWriter`、workflow 执行过程中 engine emit 的 `WorkflowExecutionEvent`（携带经 `resolveSafeNodeInput` 脱敏的 input/output/timing）和 node handler 内部对 model/capability/sandbox service 的调用。前置条件：`enabled: true` 且 writer 可用。
- **依据 Requirements**：workflow execution trace 默认关闭且可配置开关、节点级 trace 通过 observer 捕获输入输出和耗时、三方调用级 trace 通过 service wrapper 捕获耗时、workflow trace 通过 developer diagnostic artifact 输出

### 处理过程

- **变更类型**：修改
- **目标内容**：开启且 writer 可用时，composition 层创建 trace collector 实现 `WorkflowExecutionObserver`，通过 `WorkflowExecutionService` wrapper 与 caller observer composite；用通用 timing wrapper 包装 model/capability/sandbox service 捕获三方调用耗时；两类 trace 通过 `DeveloperDiagnosticArtifactWriter`（`pluginId: 'workflow-trace'`）写入同一 NDJSON 文件。trace collector 按 `nodeExecutionId` 配对 NODE_STARTED/COMPLETED 事件计算 durationMs；boundary wrapper 在每次 service 调用前后计时。所有 emit 异常 catch 后不传播。
- **依据 Requirements**：节点级 trace 通过 observer 捕获输入输出和耗时、三方调用级 trace 通过 service wrapper 捕获耗时、workflow trace 通过 developer diagnostic artifact 输出、workflow trace 不影响执行安全

### 结果

- **变更类型**：修改
- **目标内容**：NDJSON 文件中新增 `workflow-node-trace` 和 `workflow-boundary-trace` 两类 artifact 记录，携带 `pluginId: 'workflow-trace'` 和可信运行坐标。记录复用已有 writer 的 30MB 滚动、3 天保留、10 个归档文件策略。可通过配套 HTML viewer 按 `(sessionId, requestId)` 聚合查看节点轨迹和边界调用耗时。trace 数据不进入 Web API、SSE、timeline、audit、metric 或 trace。
- **依据 Requirements**：workflow trace 通过 developer diagnostic artifact 输出、workflow trace 不影响执行安全、workflow trace viewer 离线查看 trace 数据

