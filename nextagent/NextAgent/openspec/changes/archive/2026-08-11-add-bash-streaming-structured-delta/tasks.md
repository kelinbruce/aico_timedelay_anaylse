## 1. sandbox-runtime

- [x] 1.1 在 `packages/agent-capability/src/tools/tool-spi.ts` 的 `SandboxExecutionPort` 接口新增可选方法 `runShellStreaming?(input, context, onStdoutChunk, signal?)`。
  验证：`npm run typecheck` 通过。
  满足：Requirement "Sandbox Streaming Stdout Execution"。

- [x] 1.2 在 `packages/agent-capability/src/builtins/sandbox/sandbox-execution-port.ts` 的 `SandboxGatewayExecutionAdapter` 接口新增可选方法 `executeWithStdoutChunks?(request, options, signal?)`。
  验证：`npm run typecheck` 通过。
  满足：Requirement "Sandbox Streaming Stdout Execution"。

- [x] 1.3 在 `createWorkspaceBackedSandboxExecutionPort` 中检测 `gateway.executeWithStdoutChunks`，条件展开挂载 `runShellStreaming`（使用 `...(gatewaySupportsStreaming ? { runShellStreaming: ... } : {})` 避免 `exactOptionalPropertyTypes` 错误）。
  验证：`npm run typecheck` 通过；gateway 不支持时 `runShellStreaming` 为 `undefined`。
  满足：Requirement "Sandbox Streaming Stdout Execution"。

- [x] 1.4 在 `runSandbox` 函数新增 `onStdoutChunk?` 参数，当不为 `undefined` 且 `gatewayAdapter.executeWithStdoutChunks` 不为 `undefined` 时调用 `executeWithStdoutChunks`，否则走原有 `gateway.execute`。
  验证：`npm run typecheck` 通过。
  满足：Requirement "Sandbox Streaming Stdout Execution"。

## 2. bash-tool

- [x] 2.1 在 `packages/agent-capability/src/builtins/bash/bash-schemas.ts` 的 `createBashInputSchema` properties 中新增 `stream_format` 字段（`type: 'string'`, `enum: ['sse', 'ndjson']`）。
  验证：`npm run typecheck` 通过。
  满足：Requirement "Bash Streaming Execution Path"。

- [x] 2.2 在 `packages/agent-capability/src/clip/clip-command-output.ts` 新增 `BashStreamDeltaEmitter` 接口和 `createBashStreamDeltaEmitter` 函数，复用 `drainClipOutputFrames`/`emitBashOutputFrame`。`emitBashOutputFrame` 提取 `data_json`（SSE `data:` 字段 JSON.parse 结果），直接作为 payload 传给 `emitResultDelta`，不自行包裹 `{structuredPayload: ...}`（executor 层会自动包裹）。
  验证：`npm run typecheck` 通过。
  满足：Requirement "Bash Streaming Execution Path"。

- [x] 2.3 在 `packages/agent-capability/src/builtins/bash/bash-tool.ts` 的 `executeBash` 中新增流式执行分支：计算 `useStreaming`，创建 `BashStreamDeltaEmitter`，调用 `runShellStreaming`，完成后 `emitter.flush()`。不支持时回退到现有路径。
  验证：`npm run typecheck` 通过；`stream_format` 未设置时走原有路径。
  满足：Requirement "Bash Streaming Execution Path"。

- [x] 2.4 在 `executeBash` 中新增 SSE 命令自动检测：当 `stream_format` 未设置时，根据命令和参数内容检测 `text/event-stream`、`/sse/`、`--no-buffer`、` -N ` 特征，自动设为 `'sse'`。
  验证：`npm run typecheck` 通过；curl 带 `-H "Accept: text/event-stream"` 时自动激活流式路径。
  满足：Requirement "Bash Streaming Execution Path" Scenario "未设置 stream_format 但命令匹配 SSE 特征时自动激活流式路径"。

## 3. tool-structured-delta

- [x] 3.1 在 `packages/agent-core/src/tools/tool-loop.ts` 的 import 中新增 `tryEmitStructuredDelta`（从 `./structured-delta-identification.js`）。
  验证：`npm run typecheck` 通过。
  满足：Requirement "Bash Streaming Structured Delta Emission"。

- [x] 3.2 在 `invokePreparedToolCall` 中 `workflowToolDeltaProjectionState` 旁新增 `let structuredDeltaEmittedDuringExecution = false` 标志。
  验证：`npm run typecheck` 通过。
  满足：Requirement "Bash Streaming Structured Delta Emission"。

- [x] 3.3 在 `emitResultDelta` 回调中，`tryEmitWorkflowToolDelta` 返回 `false` 后、`CAPABILITY_RESULT_DELTA` 之前，新增 `tryEmitStructuredDelta` 调用。匹配时设 `structuredDeltaEmittedDuringExecution = true` 并 `return`。
  验证：`npm run typecheck` 通过。
  满足：Requirement "Bash Streaming Structured Delta Emission"。

- [x] 3.4 在完成后 `tryEmitToolStructuredDelta` 调用处用 `if (!structuredDeltaEmittedDuringExecution)` 包裹。
  验证：`npm run typecheck` 通过。
  满足：Requirement "TOOL_STRUCTURED_DELTA Does Not Replace CAPABILITY_RESULT_DELTA"。

## 4. 验证

- [x] 4.1 运行 `npm run typecheck`，确认仅 pre-existing 无关错误（`history-candidate-selection.test.ts`）。
  验证：typecheck 输出无本 change 相关的 TS 错误。
  满足：AGENTS.md 验证门禁。

- [x] 4.2 运行 `openspec validate add-bash-streaming-structured-delta --strict`。
  验证：openspec strict 验证通过。
  满足：AGENTS.md OpenSpec 验证门禁。

- [x] 4.3 新增流式 Bash `TOOL_STRUCTURED_DELTA` 逐帧 emit 测试：模拟 `runShellStreaming` 逐块回调 SSE 帧，断言每帧 emit 一条 `TOOL_STRUCTURED_DELTA`。
  验证：vitest 测试通过。
  满足：Requirement "Bash Streaming Structured Delta Emission" Scenario "SSE 流式逐帧 emit"。

- [x] 4.4 新增去重测试：流式 emit 后完成后不重复 emit `TOOL_STRUCTURED_DELTA`，但 `CAPABILITY_RESULT_DELTA` 和 `CAPABILITY_COMPLETED` 仍 emit。
  验证：vitest 测试通过。
  满足：Requirement "TOOL_STRUCTURED_DELTA Does Not Replace CAPABILITY_RESULT_DELTA" Scenario "流式 emit 后完成后不重复"。

- [x] 4.5 新增非流式回退测试：流式帧不匹配时完成后正常识别（`structuredDeltaEmittedDuringExecution` 为 false 时 `tryEmitToolStructuredDelta` 正常执行）。
  验证：vitest 测试通过。
  满足：Requirement "Bash Streaming Execution Path" Scenario "未设置 stream_format 且不匹配流式特征时走非流式路径" 和 "sandbox 不支持时回退"。

- [x] 4.6 运行 `$nextagent-code-review` 检视提交范围，确认架构边界、安全、Clean Code 无 P0/P1 问题。
  验证：检视结论 PASS。
  满足：AGENTS.md Push 门禁。
