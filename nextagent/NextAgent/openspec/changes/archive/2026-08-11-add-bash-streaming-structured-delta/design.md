## 设计范围

本 change 影响三个 Function：

1. **`tool-structured-delta`**：`TOOL_STRUCTURED_DELTA` emit 时机从"仅完成后"扩展为"执行期间逐帧 emit + 完成后去重兜底"。delta specs：`tool-structured-delta`（MODIFIED + ADDED）。设计章节：§1。
2. **`bash-tool`**：新增 `stream_format` 输入字段和流式执行路径。delta specs：`bash-tool`（ADDED）。设计章节：§2。
3. **`sandbox-runtime`**：`SandboxExecutionPort` 新增 `runShellStreaming` 可选方法，`SandboxGatewayExecutionAdapter` 新增 `executeWithStdoutChunks` 可选方法。delta specs：`sandbox-runtime`（ADDED）。设计章节：§3。

## §1 tool-structured-delta

### 目标与规范依据

使 `TOOL_STRUCTURED_DELTA` 能在 Bash 流式执行期间逐帧 emit，而非等待命令结束后一次性解析 stdout。

本 Function 的目标 Requirements：
- canonical spec：`tool-structured-delta`
- MODIFIED "TOOL_STRUCTURED_DELTA Does Not Replace CAPABILITY_RESULT_DELTA"（明确流式 emit 期间不替换 terminal 语义）
- ADDED "Bash Streaming Structured Delta Emission"（新增流式逐帧 emit + 去重约束）

### 当前实现

`tool-loop.ts` 中 `emitResultDelta` 回调在 capability 执行期间被调用，当前只做两件事：
1. 调用 `tryEmitWorkflowToolDelta`（workflow delta 投影）。
2. 不匹配时 emit `CAPABILITY_RESULT_DELTA`。

`tryEmitToolStructuredDelta` 在执行完成后被调用，对 Bash 的 `result.structuredPayload.stdout` 做 `JSON.parse` 后调用 `identifyStructuredDelta`，匹配则 emit `TOOL_STRUCTURED_DELTA`。

### GAP 分析

| 规范目标 | 当前事实 | 差距 |
|---|---|---|
| 流式执行期间逐帧 emit `TOOL_STRUCTURED_DELTA` | `emitResultDelta` 不做结构化 delta 识别 | 需在 `emitResultDelta` 中新增 `tryEmitStructuredDelta` 桥接 |
| 流式 emit 后不重复 emit | 完成后 `tryEmitToolStructuredDelta` 无条件执行 | 需新增去重标志 |
| 非流式工具不受影响 | 非流式工具不调用 `emitResultDelta` 且 `structuredPayload` 不匹配 | 桥接对非流式 inert，无差距 |

### 修改方案

在 `emitResultDelta` 回调中，`tryEmitWorkflowToolDelta` 返回 `false` 后、`CAPABILITY_RESULT_DELTA` emit 之前，新增 `tryEmitStructuredDelta` 调用：

```
emitResultDelta: async (payload) => {
  const structuredPayload = payload.structuredPayload ?? {};
  if (await tryEmitWorkflowToolDelta({...})) return;
  if (await tryEmitStructuredDelta(runState, run, context, descriptor.capabilityId, toolCall.toolCallId, structuredPayload)) {
    structuredDeltaEmittedDuringExecution = true;
    return;
  }
  // ... existing CAPABILITY_RESULT_DELTA emit
}
```

新增 `let structuredDeltaEmittedDuringExecution = false` 标志，在完成后 `tryEmitToolStructuredDelta` 调用处用 `if (!structuredDeltaEmittedDuringExecution)` 包裹。

**不修改的边界**：
- `tryEmitStructuredDelta` 函数本身不变（已存在于 `structured-delta-identification.ts`）。
- `identifyStructuredDelta` 形状校验逻辑不变。
- `hasSensitiveStructuredContent` 安全检查不变。
- CLIP provider 的 `createClipStreamDeltaEmitter` 路径不变。
- 持久化策略不变（`TOOL_STRUCTURED_DELTA` 仍为 LIVE_ONLY）。

### 质量属性影响

- 可靠性/恢复：去重标志保证流式 emit 后不会对同一 stdout 重复 emit `TOOL_STRUCTURED_DELTA`。
- 可维护性：复用现有 `tryEmitStructuredDelta` 函数，不新增识别逻辑。

## §2 bash-tool

### 目标与规范依据

使 Bash 工具能通过 `stream_format` 输入字段选择流式执行路径，逐帧推送 `TOOL_STRUCTURED_DELTA`。

本 Function 的目标 Requirements：
- canonical spec：`bash-tool`
- ADDED "Bash Streaming Execution Path"（`stream_format` 字段 + 流式执行路径 + 回退关系）

### 当前实现

Bash 工具 `executeBash` 函数根据 `run_in_background`、`isPython`、`backgroundExecutionEnabled` 选择 `runShellBackgroundable`/`runShell`/`runPython` 路径。无流式执行能力。

### GAP 分析

| 规范目标 | 当前事实 | 差距 |
|---|---|---|
| 模型可通过 `stream_format` 请求流式执行 | input schema 无 `stream_format` 字段 | 需新增 schema 字段 |
| Bash 使用 `runShellStreaming` 逐块回调 stdout | `SandboxExecutionPort` 无流式方法 | 需在 sandbox-runtime 新增（§3） |
| 逐帧分割 stdout 并 emit | 无帧分割逻辑 | 需新增 `BashStreamDeltaEmitter` |
| gateway 不支持时优雅回退 | 无回退逻辑 | 需条件判断 `useStreaming` |

### 修改方案

1. **input schema**：在 `createBashInputSchema` 的 `properties` 中新增 `stream_format`（`type: 'string'`, `enum: ['sse', 'ndjson']`）。

2. **流式执行分支**：在 `executeBash` 中，计算 `useStreaming = (streamFormat === 'sse' || streamFormat === 'ndjson') && typeof runShellStreamingFn === 'function'`。当 `useStreaming` 为 true 时：
   - 创建 `BashStreamDeltaEmitter`（传入 `options.context.emitResultDelta`）。
   - 调用 `runShellStreamingFn(sandboxInput, options.context, async (chunk) => { await emitter.accept(chunk); }, options.signal)`。
   - 执行完成后调用 `emitter.flush()` 处理残余 buffer。
   - 后续结果处理（`exitCode`/`stdoutTruncated`/degraded 等）与现有路径一致。

3. **`BashStreamDeltaEmitter`**：在 `clip-command-output.ts` 中新增，复用 `drainClipOutputFrames` 做帧分割。每帧通过 `parseClipOutputFrame` 解析；对 SSE 帧，`parseClipSseFrame` 将 `data:` 字段 JSON.parse 为 `data_json`；`emitBashOutputFrame` 提取 `data_json`（或直接 parsed 对象）包装为 `{structuredPayload: dataJson ?? parsed}` 调用 `emitResultDelta`。

4. **回退**：`runShellStreamingFn` 为 `undefined` 或 `stream_format` 未设置时，`useStreaming` 为 false，走现有 `runShellBackgroundable`/`runShell`/`runPython` 路径。

**不修改的边界**：
- `parseBashCommand`/`parseBashInputForModelCorrection` 不变。
- `bashExecutionOutputSchema`/`bashOutputSchema`/`bashBackgroundOutputSchema` 不变。
- `normalizeClipSubscribeCommandStdout` 不变。
- timeout/环境/路径处理不变。

### 质量属性影响

- 可靠性/恢复：gateway 不支持 `executeWithStdoutChunks` 时 `runShellStreaming` 为 `undefined`，`useStreaming` 为 false，优雅回退。

## §3 sandbox-runtime

### 目标与规范依据

为 sandbox 执行端口新增流式 stdout 回调能力，使 Bash 流式执行路径能逐块获取 stdout 数据。

本 Function 的目标 Requirements：
- canonical spec：`sandbox-runtime`
- ADDED "Sandbox Streaming Stdout Execution"（`runShellStreaming` + `executeWithStdoutChunks` + `onStdoutChunk` 参数）

### 当前实现

`SandboxExecutionPort` 接口有 `runShell`/`runPython`/`runShellBackgroundable`/`startBackgroundShell` 方法。`SandboxGatewayExecutionAdapter` 接口有 `execute` 方法。`runSandbox` 函数调用 `options.gateway.execute(request, signal)` 获取结果。

### GAP 分析

| 规范目标 | 当前事实 | 差距 |
|---|---|---|
| sandbox 执行期间逐块回调 stdout | `execute` 只返回最终结果 | 需新增 `executeWithStdoutChunks` |
| port 暴露流式方法 | `SandboxExecutionPort` 无流式方法 | 需新增 `runShellStreaming` |
| `runSandbox` 支持流式 | `runSandbox` 无 `onStdoutChunk` 参数 | 需新增参数和条件分支 |

### 修改方案

1. **`SandboxGatewayExecutionAdapter`**：新增可选方法 `executeWithStdoutChunks?(request, options: { onStdoutChunk? }, signal?)`。

2. **`SandboxExecutionPort`**：新增可选方法 `runShellStreaming?(input, context, onStdoutChunk, signal?)`。

3. **`createWorkspaceBackedSandboxExecutionPort`**：检测 `gateway.executeWithStdoutChunks` 是否为 function（`gatewaySupportsStreaming`）。当支持时，通过条件展开 `...(gatewaySupportsStreaming ? { runShellStreaming: async (...) => runSandbox(..., onStdoutChunk) } : {})` 挂载。使用条件展开而非 `: undefined` 是因为 `exactOptionalPropertyTypes: true` 不允许 optional 属性赋值为 `undefined`。

4. **`runSandbox`**：新增 `onStdoutChunk?` 参数。当 `onStdoutChunk !== undefined && gatewayAdapter.executeWithStdoutChunks !== undefined` 时调用 `executeWithStdoutChunks(request, { onStdoutChunk }, signal)`；否则走原有 `gateway.execute(request, signal)`。

**不修改的边界**：
- `execute` 方法行为不变。
- `runShell`/`runPython`/`runShellBackgroundable`/`startBackgroundShell` 行为不变。
- sandbox 请求构造（`sandboxRequest`）不变。
- 风险策略评估不变。

### 质量属性影响

无新增黑盒质量目标。可选方法不破坏现有 port 契约；不支持流式的 gateway 正常回退。

## 长期基线刷新计划

归档前需更新以下 stable spec：

- `openspec/specs/tool-structured-delta/spec.md`：
  - MODIFIED "TOOL_STRUCTURED_DELTA Does Not Replace CAPABILITY_RESULT_DELTA"：补充流式 emit 期间 terminal 语义不变约束。
  - ADDED "Bash Streaming Structured Delta Emission"：流式逐帧 emit + 去重 + 非流式兼容。
- `openspec/specs/bash-tool/spec.md`：
  - ADDED "Bash Streaming Execution Path"：`stream_format` 字段 + 流式路径 + 回退关系。
- `openspec/specs/sandbox-runtime/spec.md`：
  - ADDED "Sandbox Streaming Stdout Execution"：`runShellStreaming` + `executeWithStdoutChunks` + `onStdoutChunk`。

不更新：`structured-delta-safety.ts`、持久化策略、前端、overview.md、architecture、modules、ADR、spec-to-design-map（本 change 不改变跨模块架构边界或长期技术决策）。

## 验证策略

- `tool-structured-delta`：流式逐帧 emit 测试（收到一帧 emit 一帧）、去重测试（流式 emit 后完成后不重复）、非流式兼容测试（无 `stream_format` 时走原有路径）。
- `bash-tool`：`stream_format` 字段 schema 验证、流式路径选择测试、回退测试（gateway 不支持流式时走 `runShell`）。
- `sandbox-runtime`：`runShellStreaming` 挂载测试（gateway 支持/不支持）、`executeWithStdoutChunks` 调用测试。
- Negative case：敏感内容不 emit、非结构化帧走 `CAPABILITY_RESULT_DELTA`、非 Bash 工具不触发桥接。

## 风险与取舍

- [帧分割正确性] 中风险。复用 `drainClipOutputFrames` 的 SSE `\n\n` 边界和 NDJSON 行边界分割逻辑，该逻辑已被 CLIP 路径验证。但 Bash curl 的 SSE 格式可能与 CLIP 略有差异（如 `data:` 前缀空格），`parseClipSseFrame` 已处理 `data:` 后可选空格。
- [去重可靠性] 低风险。`structuredDeltaEmittedDuringExecution` 标志在 `emitResultDelta` 中设置，在完成后检查。即使流式期间没有任何帧匹配结构化 delta，标志保持 false，完成后 `tryEmitToolStructuredDelta` 正常执行（非流式行为不变）。
- [exactOptionalPropertyTypes] 低风险。使用条件展开而非 `: undefined` 避免 TypeScript strict 模式错误。
