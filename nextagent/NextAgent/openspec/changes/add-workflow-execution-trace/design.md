## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-9.1 执行工作流` | 新增 optional workflow execution trace 能力，通过 observer + service wrapper 实现节点级和三方调用级诊断 | `workflow-execution-trace` | `FN-9.1 执行工作流` |

### 新增目录架构评审

评审结论：`PASS`（2026-08-13）。

| 新增目录 | owner | 职责边界 | 生命周期 | 构建、打包和运行时影响 |
|---|---|---|---|---|
| `openspec/changes/add-workflow-execution-trace/specs/workflow-execution-trace/` | active change `add-workflow-execution-trace` | 承载 `FN-9.1 执行工作流` 对 canonical spec `workflow-execution-trace` 的 delta Requirements；不承载实现、fixture、生成物或长期 stable spec | 随 active change 创建；归档时按 OpenSpec 流程合并到同名 stable spec 并随 change 进入 archive | 不进入 TypeScript build、runtime package 或请求路径；只影响 OpenSpec validation 与归档同步 |

## `FN-9.1 执行工作流`

### 目标与规范依据

本 Function 在 workflow 执行过程中，需要为开发者提供可选的节点级和三方调用级诊断 trace 能力。trace 数据通过已有的 `DeveloperDiagnosticArtifactWriter` 输出为 NDJSON，配套离线 HTML viewer 消费。该能力默认关闭，开启后不影响 workflow 执行。

#### 本 Function 的目标 Requirements

canonical spec：`workflow-execution-trace`（新增，不修改已有 `workflow-contracts`）

- `ADDED`：workflow execution trace 默认关闭且可配置开关
- `ADDED`：节点级 trace 通过 observer 捕获输入输出和耗时
- `ADDED`：三方调用级 trace 通过 service wrapper 捕获耗时
- `ADDED`：workflow trace 通过 developer diagnostic artifact 输出
- `ADDED`：workflow trace 不影响执行安全
- `ADDED`：workflow trace viewer 离线查看 trace 数据

### 当前实现

- `WorkflowExecutionObserver` 已在 `agent-contracts/core` 定义，engine 的 `executeNode` 在每次节点执行时 emit `NODE_STARTED`/`NODE_COMPLETED`/`NODE_FAILED` 事件，事件携带 `input`（经 `resolveSafeNodeInput` 脱敏）、`output`、`startedAt`、`completedAt`、`safeError`、`nodeExecutionId`。
- `createWorkflowToolPort` 在 `agent-workflow/workflow-tool-port.ts` 中创建 timeline observer，在每次 `execute()` 调用时内部创建并传给 `workflowExecutionService.execute(request, signal, observer)`。`composeWorkflowExecutionLayer` 返回 `WorkflowExecutionService`，无法控制 observer。
- `composeWorkflowExecutionLayer` 在 `agent-app/composition/workflow-composition.ts` 中组装 `WorkflowExecutionServiceFactoryOptions`，把 `ModelInvocationService`、`CapabilityInvocationPort`、`WorkflowSandboxExecutionPort` 等注入 `createWorkflowNodeCatalog`。该函数当前不接收 `developerDiagnosticArtifactWriter`。
- `developerDiagnosticArtifactWriter` 在 `agent-app/composition/create-app.ts` 中无条件创建，写入 `paths.logDirectory/nextagent-plugin-diagnostic.ndjson`，有 30MB 滚动、3 天保留、10 个归档文件策略。`writer.emit()` 要求 `pluginId` 字段（`BoundDeveloperDiagnosticArtifactInput`），而 plugin-facing 的 `DeveloperDiagnosticArtifactInput` 不含 `pluginId`——`pluginId` 由 host 代码 `developerDiagnosticsForPlugin(pluginId)` 在创建 scoped sink 时绑定。
- `developer-hook-trace` 插件通过 `LifecycleHook` + `DeveloperDiagnosticArtifactSink` 写入同一 NDJSON 文件，`artifactType` 区分来源。配套 `developer-hook-trace-viewer.html` 静态查看器。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 节点级 trace | `WorkflowExecutionEvent` 已携带 input/output/timing | 缺少 observer 接住事件并写 NDJSON |
| observer 注入 | observer 在 `createWorkflowToolPort` 内部创建，`composeWorkflowExecutionLayer` 无法控制 | 需要 `WorkflowExecutionService` wrapper 在 `execute()` 内 composite trace collector 和 caller observer |
| 三方调用 trace | model/capability/sandbox 调用发生在 node handler 内部 | 需要 service wrapper 捕获 boundary 调用耗时 |
| 三方调用与节点关联 | 调用发生在 handler 内部，wrapper 无法获知当前 nodeId | boundary trace 只记 `recordedAt`，viewer 通过时间戳落在节点 `startedAt`/`completedAt` 区间内关联（方案 B） |
| 配置开关 | `default-system.yaml` 无 `workflowTrace` 字段 | 缺少 optional 配置项 |
| trace 输出 | `DeveloperDiagnosticArtifactWriter` 已存在 | 可直接复用 |
| pluginId 绑定 | `pluginId` 由 host `developerDiagnosticsForPlugin(pluginId)` 绑定，`writer.emit()` 要求 `pluginId` | workflow trace 不是插件，需 host composition 代码直接调 `writer.emit()` 并设置 `pluginId`（受控例外，见下） |
| writer 传递 | `composeWorkflowExecutionLayer` 不接收 writer | 需要新增入参 |
| trace 可视化 | `developer-hook-trace-viewer.html` 已有先例 | 需新增针对 workflow trace 的 viewer |

### `pluginId` 受控例外

`plugin-developer-diagnostic-artifacts` spec 规定 `pluginId` MUST 从已校验的插件 manifest 绑定，plugin-facing `DeveloperDiagnosticArtifactInput` MUST NOT 包含 `pluginId`。Workflow trace 不是插件，没有 manifest，因此无法通过 `developerDiagnosticsForPlugin(pluginId)` 获取 scoped sink。

本 change 的受控例外是：`agent-app` composition 代码（host 代码，非插件代码）直接调用 `DeveloperDiagnosticArtifactWriter.emit()`，在 `BoundDeveloperDiagnosticArtifactInput` 中设置 `pluginId: 'workflow-trace'`。这与 `developerDiagnosticsForPlugin(pluginId)` 在同一信任层级——两者都是 host composition 代码绑定 `pluginId`，区别仅在于来源是 manifest 还是硬编码常量。

该例外的适用范围：仅限 `agent-app` composition 层的 workflow trace 能力，不扩展到其他非插件诊断。owner 是 `agent-app` composition。验证方式：architecture test 断言只有 `composeWorkflowExecutionLayer` 直接调用 `writer.emit()` 并设置 `pluginId: 'workflow-trace'`，其他路径仍走 `developerDiagnosticsForPlugin(pluginId)` scoped sink。

### 修改方案

唯一实现路径是 composition 层 service wrapper + `WorkflowExecutionService` wrapper，不修改 `agent-workflow` 的 engine 或 node handler。

1. `agent-app/config/component-config.ts` 新增 optional `workflowTrace?: { readonly enabled: boolean }` 字段到 `DefaultSystemConfig` 和 `RawDefaultSystemConfig`；`validation.ts` 新增对应 optional TypeBox schema；默认不存在等价 `enabled: false`。

2. `agent-plugin-sdk` 新增 `workflow-trace-collector.ts`：
   - `WorkflowTraceCollector` 实现 `WorkflowExecutionObserver`。`emitEvent` 的判断顺序：
     1. 收到 event。
     2. `nodeExecutionId` 为 undefined → 跳过（START/END 脚手架节点）。
     3. `NODE_STARTED` → 以 `nodeExecutionId` 为 key 暂存 `{ startedAt, nodeId, nodeType, executionId, inputKeys }`。
     4. `NODE_COMPLETED`、`NODE_FAILED`、`NODE_SKIPPED` 或 `NODE_WAITING`（均为终态事件） → 查找暂存：
        - 有匹配 → 计算 `durationMs = completedAt - startedAt`，从 `event.output` 提取 `outputKeys`，构造 payload，通过 `DeveloperDiagnosticArtifactSink.emit()` 输出 `artifactType: workflow-node-trace`，然后清除暂存。
        - 无匹配 → 跳过（孤立终态事件）。
     5. `emitEvent` 内部 try-catch，异常不传播。
   - `createTimingWrappedService<T>(original, sink, boundaryType, methodNames)` 通用工厂函数。每次包装方法的判断顺序：
     1. 记录 `startedAt = Date.now()`。
     2. 调用原始方法。
     3. 成功 → emit `artifactType: workflow-boundary-trace`，payload 含 `recordedAt`、`boundaryType`、`durationMs`、`status: SUCCEEDED`。返回原值。
     4. 异常 → emit `status: FAILED`，重新抛出原始异常。
     5. emit 内部 try-catch，异常不传播。
   - 对 model invocation 包装 `complete()` 和 `stream()` 方法，`boundaryType: 'MODEL'`。
   - 对 capability invocation 包装 `invoke()` 方法，`boundaryType: 'API'`。
   - 对 sandbox execution 包装 `runPython()` 方法，`boundaryType: 'PYTHON'`。
   - boundary trace 不携带 `nodeId`/`nodeExecutionId`（方案 B）。

3. `agent-app/composition/workflow-composition.ts` 的 `composeWorkflowExecutionLayer` 新增入参 `developerDiagnosticArtifactWriter` 和读取 `systemConfig.workflowTrace?.enabled`：
   - `enabled: false`（默认）→ 不创建任何 trace 对象，不包装 service，返回原始 `WorkflowExecutionService`，零开销。
   - `enabled: true` →
     - 如果 `developerDiagnosticArtifactWriter` 为 undefined → 跳过 trace（writer 不可用），返回原始 service。
     - 否则：创建 trace sink（内联，直接 `writer.emit({ ...input, pluginId: 'workflow-trace' })`），创建 `WorkflowTraceCollector(traceSink)`，用 `createTimingWrappedService` 包装 model/capability/sandbox service 后注入 `createWorkflowNodeCatalog`，返回 `WorkflowExecutionService` wrapper。
   - `WorkflowExecutionService` wrapper 的 `execute()` 逻辑：
     1. 收到 `(request, signal, callerObserver?, runtime?)`。
     2. 创建 composite observer：`emitEvent` 先调 `traceCollector.emitEvent(e)`（try-catch 不传播），再调 `callerObserver?.emitEvent(e)`；`registerExecutionRecipe` 透传给 caller observer。
     3. 调用原始 `service.execute(request, signal, compositeObserver, runtime)`，返回原结果。

4. `agent-app/composition/create-app.ts` 在调用 `composeWorkflowExecutionLayer` 时传入 `developerDiagnosticArtifactWriter`。

5. `agent-plugin-sdk/assets/` 新增 `workflow-trace-viewer.html` 静态查看器。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `workflow trace 不影响执行安全` | observe-only、不记录 raw prompt/output/secret、input 已由 engine 脱敏 | trace 数据不含敏感字段；emit 异常不影响 workflow |
| 可诊断 | `节点级 trace 通过 observer 捕获输入输出和耗时` | observer 配对 NODE_STARTED/COMPLETED 事件计算 durationMs | 节点级 trace 包含 nodeId/nodeType/durationMs/status |
| 可维护 | `三方调用级 trace 通过 service wrapper 捕获耗时` | composition 层通用 service wrapper，不修改 engine/handler | wrapper 不改变原 service 行为 |

## 跨 Function 协作与端到端流程

```text
operator sets workflowTrace.enabled: true in default-system.yaml
  -> agent-app startup reads config
  -> create-app.ts passes developerDiagnosticArtifactWriter to composeWorkflowExecutionLayer
  -> composeWorkflowExecutionLayer:
    -> if writer undefined: skip trace, return original service
    -> creates trace sink (inline: writer.emit with pluginId 'workflow-trace')
    -> creates WorkflowTraceCollector(traceSink)
    -> wraps model/capability/sandbox service with createTimingWrappedService
    -> injects wrapped services into createWorkflowNodeCatalog
    -> returns WorkflowExecutionService wrapper that composites traceCollector + caller observer
  -> workflow executes (synchronous within workflowExecutionService.execute()):
    -> createWorkflowToolPort creates timeline observer, calls wrapped execute()
    -> wrapper composites timeline observer + traceCollector
    -> engine emits WorkflowExecutionEvent -> both observers receive it synchronously
    -> traceCollector pairs NODE_STARTED/COMPLETED, writes workflow-node-trace to NDJSON
    -> node handler calls wrapped model/capability/sandbox -> timing wrapper records durationMs, writes workflow-boundary-trace to NDJSON
  -> developer opens workflow-trace-viewer.html, loads NDJSON file
  -> viewer filters pluginId=workflow-trace, aggregates by (sessionId, requestId)
  -> viewer shows node trajectory + boundary calls correlated by timestamp
```

`agent-app` 只做 composition 接线；`agent-plugin-sdk` 提供 collector、wrapper 工厂和 viewer；`agent-workflow` 不修改。trace 触发是同步的，发生在 `workflowExecutionService.execute()` 调用期间，由 engine emit 的 `WorkflowExecutionEvent`（节点级）和 node handler 内 service 调用（boundary 级）驱动。trace emit 通过 `DeveloperDiagnosticArtifactWriter` 的有界异步 enqueue 写入文件，不阻塞 workflow 执行路径。

## 产物生命周期

trace 数据写入 `paths.logDirectory/nextagent-plugin-diagnostic.ndjson`，复用已有 `DeveloperDiagnosticArtifactWriter` 的文件管理策略：单文件最大 30MB、按 daily 或 size 滚动、gzip 压缩归档段、最多 10 个 committed archive、3 天 elapsed retention。trace 记录与 `developer-hook-trace` 等其他 diagnostic artifact 共享同一文件族，通过 `pluginId` 和 `artifactType` 区分。trace 数据不进入 SQLite、operational log、audit、metrics 或 trace。消费方是离线 HTML viewer 和 `jq`/文本编辑器。

## 验证策略

- contract tests 固定 `WorkflowExecutionObserver` contract 不变、trace collector 不修改 engine 行为。
- SDK tests 覆盖 `WorkflowTraceCollector` 的事件配对、durationMs 计算、inputKeys/outputKeys 提取、START/END 过滤、孤立终态事件跳过、暂存清理、`emitEvent` 异常不传播；boundary wrapper 的 timing 记录、`boundaryType` 分类、异常重抛、原 service 行为不变、emit 异常不传播。
- composition tests 覆盖 `workflowTrace.enabled: true/false` 两种路径，确认 service 包装、observer composite 和 sink 创建只在 enabled 且 writer 可用时发生；writer 不可用时跳过 trace；`developerDiagnosticArtifactWriter` 被正确传入。
- architecture tests 确认 `agent-workflow` engine 和 node handler 源码不被修改；确认只有 `composeWorkflowExecutionLayer` 直接调用 `writer.emit()` 并设置 `pluginId: 'workflow-trace'`。
- integration tests 通过现有 workflow e2e 测试，确认 trace collector 开启时不影响 workflow 执行结果。
- viewer tests 覆盖 NDJSON 加载、按 `(sessionId, requestId)` 聚合、节点轨迹和边界调用展示、非法行降级、XSS 防护。
- 安全 tests 断言 trace payload 不含 `prompt`/`messages`/`rawModelOutput`/`capabilityResult`/`secret`/`path` 字段。

## 长期基线刷新计划

- stable specs：归档时新增 `workflow-execution-trace` stable spec。
- Functions：刷新 `FN-9.1 执行工作流`。
- Features：刷新 `F-9.1 执行工作流`。
- overview：补充 workflow execution trace 能力摘要。
- architecture：保持 `workflow-execution-and-routing.md` 不变；补充 composition 层 trace 接线说明。
- modules：刷新 `agent-plugin-sdk` 和 `agent-app` composition。
- ADR：无。
- spec-to-design-map：补充 workflow execution trace 验证入口。

## 风险与取舍

- boundary trace 不携带 `nodeId`/`nodeExecutionId`（方案 B），只能通过 `recordedAt` 时间戳落在节点 `startedAt`/`completedAt` 区间内关联。并发 fork-join 场景下同一时间区间可能存在多个节点执行，boundary trace 的归属可能模糊。顺序执行场景（绝大多数）不受影响。后续如需精确关联可通过 `ExecutionCorrelationPort` wrapper + ALS 升级，不在本 change 范围内。
- `pluginId` 受控例外：host composition 代码直接设置 `pluginId: 'workflow-trace'` 而非来自插件 manifest。这违反了 `plugin-developer-diagnostic-artifacts` spec 的字面约束（`pluginId` MUST 从已校验的插件 manifest 绑定）。例外原因：workflow trace 不是插件，但与 `developerDiagnosticsForPlugin(pluginId)` 在同一 host 信任层级。适用范围仅限 `composeWorkflowExecutionLayer`，由 architecture test 锁定。
- trace 数据与 `developer-hook-trace` 数据共享同一个 NDJSON 文件，通过 `artifactType` 区分。文件增长速度会更快，但 30MB 滚动和 3 天保留策略已足够覆盖调试场景。
- wrapper 只记录 `recordedAt`、`boundaryType`、`durationMs`、`status`，不记录调用参数和返回值正文，因此无法用于复现三方调用的具体输入输出。这是安全约束下的有意取舍。


