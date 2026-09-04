## Why

Workflow 执行目前只通过 `WorkflowExecutionEvent` 向 timeline projector 投影节点生命周期摘要，开发者在排查 workflow 性能问题时无法获知各节点的完整输入输出、总耗时，也无法拆分节点内部三方调用（模型/API/Python）各自占了多少时间。`developer-hook-trace` 插件已建立了一条 `LifecycleHook -> DeveloperDiagnosticArtifactSink -> NDJSON -> HTML viewer` 的诊断管线，但它只覆盖 agent 主循环的 model/capability boundary，不覆盖 workflow 内部的节点级和三方调用级执行细节。

系统需要一个可配置开关的 workflow execution trace 能力：开启后，在 workflow 执行过程中把每个节点的输入输出字段名、耗时，以及节点内部模型/API/Python 调用的耗时，通过已有的 `DeveloperDiagnosticArtifactWriter` 写入 `nextagent-plugin-diagnostic.ndjson`，配套离线 HTML viewer 消费。该能力默认关闭、零开销，不经过插件加载机制，不修改 workflow engine 和 node handler 实现。

## 目标与非目标

**目标：**

- 提供可通过 `default-system.yaml` 中 `workflowTrace.enabled` 开关启用的 workflow execution trace 能力。
- 节点级 trace 复用现有 `WorkflowExecutionObserver`，通过 `WorkflowExecutionService` wrapper 与 caller observer composite，在 `NODE_STARTED`/`NODE_COMPLETED`/`NODE_FAILED`/`NODE_SKIPPED`/`NODE_WAITING` 事件中捕获节点输入输出字段名、耗时和错误信息，零侵入 engine。
- 三方调用级 trace 通过 composition 层通用 service wrapper 包装注入 node catalog 的 `ModelInvocationService`、`CapabilityInvocationPort` 和 `WorkflowSandboxExecutionPort`，捕获每次调用的 `boundaryType`、`recordedAt`、`durationMs` 和 `status`，不记录调用参数和返回值正文，不携带 `nodeId`/`nodeExecutionId`。
- trace 数据通过已有的 `DeveloperDiagnosticArtifactWriter` 写入 `nextagent-plugin-diagnostic.ndjson`，用 `artifactType` 区分 `workflow-node-trace` 和 `workflow-boundary-trace`，`pluginId` 为 `workflow-trace`（host composition 代码受控例外，非插件 manifest 绑定）。
- 节点级与三方调用级 trace 通过 `recordedAt` 时间戳落在节点 `startedAt`/`completedAt` 区间内关联（方案 B），viewer 可按 `(sessionId, requestId)` 聚合完整执行轨迹。
- 配套离线 HTML viewer，可加载 NDJSON 文件展示节点轨迹和边界调用耗时，不依赖网络、不写持久存储。
- trace collector 和 boundary wrapper 的异常不影响 workflow 执行（observe-only, non-blocking）。
- trace 数据遵守安全约束：不记录 raw prompt、raw model output、raw capability result、secret、path；节点 input 只记录字段名列表。

**非目标：**

- 不修改 `agent-workflow` engine 或 node handler 实现代码。
- 不引入新的插件加载机制或 LifecycleHook。
- 不新建独立日志文件或独立 writer；复用 `nextagent-plugin-diagnostic.ndjson`。
- 不把 trace 数据引入 Web API、SSE、WebSocket、timeline、SafeError、audit、metric 或 trace。
- 不实现 real-time trace 流式推送；trace 数据只通过离线 NDJSON 文件消费。
- 不通过 ALS 或 `ExecutionCorrelationPort` wrapper 关联 boundary trace 与节点（方案 B）；后续如需精确关联可独立升级。
- 不为 trace 能力新建 OpenSpec capability 或 Function；作为 `FN-9.1 执行工作流` 的可观测性增强。

## What Changes

- 在 `agent-plugin-sdk` 新增 `workflow-trace-collector.ts`：导出 `WorkflowTraceCollector`（实现 `WorkflowExecutionObserver`）和通用 `createTimingWrappedService` boundary wrapper 工厂。
- 在 `agent-app` composition 的 `composeWorkflowExecutionLayer` 中，新增入参 `developerDiagnosticArtifactWriter`；根据 `workflowTrace.enabled` 配置和 writer 可用性决定是否创建 trace sink（内联，`pluginId: 'workflow-trace'`）、trace collector、包装 service 并返回 `WorkflowExecutionService` wrapper（composite trace collector + caller observer）。
- 在 `agent-app` config 的 `DefaultSystemConfig` 中新增 optional `workflowTrace: { enabled: boolean }` 字段，`default-system.yaml` 默认不含该字段（等价 `enabled: false`）。
- 在 `agent-app/composition/create-app.ts` 调用 `composeWorkflowExecutionLayer` 时传入 `developerDiagnosticArtifactWriter`。
- 在 `agent-plugin-sdk/assets/` 新增 `workflow-trace-viewer.html` 静态查看器。
- trace 数据通过已有的 `developerDiagnosticArtifactWriter` 输出，`artifactType` 为 `workflow-node-trace` 或 `workflow-boundary-trace`，`pluginId` 为 `workflow-trace`（host composition 代码受控例外）。

## Feature 影响

### 修改的 Feature

- `F-9.1 执行工作流`
  - 开发者可通过系统配置开启 workflow execution trace，获取各节点输入输出字段名、耗时及三方调用耗时的诊断数据，配套离线 HTML viewer 查看，用于离线性能排查。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-9.1 执行工作流` -> 新增 canonical spec `workflow-execution-trace`
  - 变化边界：新增 optional workflow execution trace 能力，通过 composition 层 observer + service wrapper 实现，不修改 engine 或 node handler；trace 数据通过 developer diagnostic artifact 输出，不进入 formal observability surface。`pluginId` 由 host composition 代码设置（受控例外）。
  - 系统质量属性：可诊断。

## 影响范围

- **Agent 开发者**：在 `default-system.yaml` 或 `local-overlay.yaml` 中配置 `workflowTrace.enabled: true` 即可开启 trace，重启服务后生效；排查完设为 `false` 或删除该行即可关闭。打开 `workflow-trace-viewer.html` 加载 NDJSON 文件查看执行轨迹。
- **公共诊断产物契约**：复用已有 `DeveloperDiagnosticArtifactWriter` 和 `nextagent-plugin-diagnostic.ndjson` 文件，新增两种 `artifactType` 和一个 `pluginId`（`workflow-trace`，host 代码受控例外），不新建文件或 writer。
- **配置**：新增 optional `workflowTrace` 字段，默认不存在等价 `enabled: false`；复用 `paths.logDirectory`。
- **workflow engine**：不修改 `agent-workflow` 的 engine 或 node handler 实现。
