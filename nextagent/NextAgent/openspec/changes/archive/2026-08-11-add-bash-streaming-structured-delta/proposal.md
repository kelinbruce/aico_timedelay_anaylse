## 背景与问题（Why）

现有 `TOOL_STRUCTURED_DELTA` 对 Bash 工具的识别发生在 capability 执行完成后：`tryEmitToolStructuredDelta` 在 `tool-loop.ts` 中对 `result.structuredPayload.stdout` 做 `JSON.parse`，一次性提取 `{eventType, messageType, content}` 三元组后 emit 单条事件。这对一次性返回的 JSON 输出可以工作，但当 Bash 执行 `curl` 命令且后端返回 SSE 流式数据时（如 `data:{"messageType":"STREAM_DSL","eventType":"ANSWER","content":"xxxxx"}`），存在两个问题：

1. **延迟**：全部 stdout 必须等到命令结束后才能解析，前端无法在执行过程中渐进式渲染结构化内容。
2. **截断风险**：长流式输出可能超过 stdout 100KB 上限被截断，导致 `stdoutTruncated: true`，`extractClipcStructuredEvent` 直接跳过识别。

电信运维场景中，Bash 调用 `curl` 访问后端流式 API 返回 SSE 事件流是常见模式。这些 SSE 帧的 `data:` 字段携带结构化事件（`{messageType, eventType, content}`），需要逐帧 emit `TOOL_STRUCTURED_DELTA` 以驱动前端流式渲染。

## 变更范围（What Changes）

1. **Bash 流式执行契约**：`SandboxExecutionPort` 新增可选方法 `runShellStreaming`，接收 `onStdoutChunk` 回调；`SandboxGatewayExecutionAdapter` 新增可选方法 `executeWithStdoutChunks`，使 sandbox 执行过程中能逐块回调 stdout 数据。当 gateway 不支持 `executeWithStdoutChunks` 时，`runShellStreaming` 为 `undefined`，Bash 工具回退到现有 `runShell`/`runShellBackgroundable` 路径。

2. **Bash 输入扩展 `stream_format`**：Bash 工具 input schema 新增可选字段 `stream_format`（枚举 `'sse' | 'ndjson'`）。当模型设置 `stream_format` 且 sandbox 支持 `runShellStreaming` 时，Bash 工具使用流式执行路径；否则回退到现有路径。

3. **Bash 流式帧分割与 emit**：复用 CLIP 基础设施 `drainClipOutputFrames`/`parseClipOutputFrame`/`parseClipSseFrame` 对 stdout chunk 做帧分割。每帧提取 `data_json`（SSE `data:` 字段 JSON.parse 结果），包装为 `{structuredPayload: dataJson ?? parsed}` 调用 `emitResultDelta`。

4. **`emitResultDelta` 桥接**：在 `tool-loop.ts` 的 `emitResultDelta` 回调中，于 `tryEmitWorkflowToolDelta` 之后、`CAPABILITY_RESULT_DELTA` 之前，新增 `tryEmitStructuredDelta` 调用。当 `structuredPayload` 匹配 `{eventType, messageType, content}` 三元组时，emit `TOOL_STRUCTURED_DELTA` 并返回；不匹配时继续走 `CAPABILITY_RESULT_DELTA`。

5. **去重**：新增 `structuredDeltaEmittedDuringExecution` 标志。当执行期间已 emit 过 `TOOL_STRUCTURED_DELTA` 时，执行完成后的 `tryEmitToolStructuredDelta` 被跳过，避免对同一 stdout 内容重复 emit。

6. **非流式兼容**：不设置 `stream_format` 的 Bash 调用、其他工具（Read/Write/Skill 等）以及 CLIP provider 的行为完全不变。桥接在 `emitResultDelta` 中对不匹配 `structuredPayload` 的 payload 是 inert 的（返回 `false`，继续走原有路径）。

## Function 影响（OpenSpec Capabilities）

### 修改的 Capability

- `tool-structured-delta`（`FN-*`，canonical spec：`tool-structured-delta`）：`TOOL_STRUCTURED_DELTA` 的 emit 时机从"仅完成后"扩展为"执行期间逐帧 + 完成后兜底"；`emitResultDelta` 回调新增 `tryEmitStructuredDelta` 桥接；新增流式去重约束。涉及系统质量属性：可靠性/恢复（去重保证不重复 emit）、可维护性（复用现有帧分割基础设施）。
- `bash-tool`（`FN-*`，canonical spec：`bash-tool`）：input schema 新增 `stream_format` 可选字段；新增流式执行路径（`runShellStreaming` + `BashStreamDeltaEmitter`）；流式路径与现有 `runShell`/`runShellBackgroundable`/`runPython` 路径的回退关系。涉及系统质量属性：可靠性/恢复（gateway 不支持流式时优雅回退）。
- `sandbox-runtime`（`FN-*`，canonical spec：`sandbox-runtime`）：`SandboxExecutionPort` 新增 `runShellStreaming` 可选方法；`SandboxGatewayExecutionAdapter` 新增 `executeWithStdoutChunks` 可选方法；`runSandbox` 新增 `onStdoutChunk` 参数。涉及系统质量属性：可维护性（可选方法不破坏现有 port 契约）。

### 新增的 Capability

无。

## Non-Goals

- 不修改 CLIP provider 流式路径（`createClipStreamDeltaEmitter` 行为不变）。
- 不修改 `structured-delta-safety.ts` 安全检查逻辑。
- 不修改持久化策略（`runTimelineEventPersistencePolicy`）；流式 `TOOL_STRUCTURED_DELTA` 仍为 LIVE_ONLY。
- 不修改前端渲染逻辑（前端已支持 `TOOL_STRUCTURED_DELTA` 事件流式接收和渐进式渲染）。
- 不处理跨帧累积拼接的流式场景（前提是每帧自包含完整结构化事件）。
- 不修改 ApiCall 工具的流式路径（ApiCall 流式识别在编排层，不在 tool-loop）。
- 不做历史回放（流式 Bash 的 `TOOL_STRUCTURED_DELTA` 不从 `CAPABILITY_RESULT` 消息重建，与现有 Bash 行为一致）。
## 影响范围（Impact）

- `packages/agent-capability/src/tools/tool-spi.ts`：`SandboxExecutionPort` 接口新增 `runShellStreaming?` 方法。
- `packages/agent-capability/src/builtins/sandbox/sandbox-execution-port.ts`：`SandboxGatewayExecutionAdapter` 新增 `executeWithStdoutChunks?`；`createWorkspaceBackedSandboxExecutionPort` 条件性挂载 `runShellStreaming`；`runSandbox` 新增 `onStdoutChunk` 参数。
- `packages/agent-capability/src/clip/clip-command-output.ts`：新增 `BashStreamDeltaEmitter` 接口和 `createBashStreamDeltaEmitter` 函数，复用 `drainClipOutputFrames`/`emitBashOutputFrame`。
- `packages/agent-capability/src/builtins/bash/bash-schemas.ts`：input schema 新增 `stream_format` 字段。
- `packages/agent-capability/src/builtins/bash/bash-tool.ts`：新增流式执行分支（`useStreaming` 路径），创建 `BashStreamDeltaEmitter` 并调用 `runShellStreaming`。
- `packages/agent-core/src/tools/tool-loop.ts`：`emitResultDelta` 回调新增 `tryEmitStructuredDelta` 桥接；新增 `structuredDeltaEmittedDuringExecution` 去重标志；完成后 `tryEmitToolStructuredDelta` 被条件跳过。
- 测试：需新增流式 Bash `TOOL_STRUCTURED_DELTA` 逐帧 emit 测试、非流式回退测试、去重测试。
