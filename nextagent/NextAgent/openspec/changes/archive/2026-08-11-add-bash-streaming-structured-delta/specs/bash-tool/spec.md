# bash-tool Specification Delta

所属 Function：bash-tool
Function 变更类型：修改
spec 角色：主规格

## ADDED Requirements

### Requirement: Bash Streaming Execution Path

Bash 工具 input schema MUST 支持可选字段 `stream_format`，枚举值为 `'sse'` 和 `'ndjson'`。当模型设置 `stream_format` 且 sandbox 执行端口提供 `runShellStreaming` 方法时，Bash 工具 MUST 使用流式执行路径：通过 `runShellStreaming` 的 `onStdoutChunk` 回调逐块接收 stdout，使用帧分割逻辑将 chunk 分割为独立帧，每帧提取结构化 payload 后通过 `emitResultDelta` 回调传递给 tool-loop。

需求类别：功能性需求

当 `stream_format` 为 `'sse'` 或 `'ndjson'` 且 sandbox 执行端口提供 `runShellStreaming` 方法时，Bash 工具 MUST 使用流式执行路径：通过 `runShellStreaming` 的 `onStdoutChunk` 回调逐块接收 stdout，使用帧分割逻辑将 chunk 分割为独立帧，每帧提取结构化 payload 后通过 `emitResultDelta` 回调传递给 tool-loop。

当模型未设置 `stream_format` 时，Bash 工具 MUST 根据命令和参数内容自动检测是否为 SSE 流式请求。当命令文本包含 `text/event-stream`、`/sse/`、`--no-buffer` 或 ` -N ` 特征时，Bash 工具 MUST 自动将 `stream_format` 设为 `'sse'`。当未设置 `stream_format` 且未匹配到任何流式特征、或 sandbox 执行端口不提供 `runShellStreaming` 时，Bash 工具 MUST 走现有非流式执行路径（`runShell`、`runShellBackgroundable` 或 `runPython`），行为 MUST 与未引入 `stream_format` 字段时完全一致。

流式执行路径的 terminal 结果处理（`exitCode`、`stdoutTruncated`、`stderrTruncated`、degraded 判定、timeout 判定）MUST 与非流式路径一致。流式路径 MUST NOT 改变 `bashExecutionOutputSchema` 的结果形状。

帧分割逻辑 MUST 复用 `drainClipOutputFrames` 的 SSE `\n\n` 边界和 NDJSON 行边界分割。每帧通过 `parseClipOutputFrame` 解析；对 SSE 帧，`parseClipSseFrame` MUST 提取 `data:` 字段并 JSON.parse 为 `data_json`。每帧的 `data_json`（或直接 parsed 对象）MUST 直接作为 payload 传给 `emitResultDelta`，MUST NOT 自行包装 `{structuredPayload: ...}`，因为 executor 层会自动包裹 `{structuredPayload: payload}`。

执行完成后 MUST 调用 `emitter.flush()` 处理残余 buffer 中的不完整帧。

#### Scenario: stream_format sse 使用流式执行路径

- **WHEN** 模型调用 Bash 并设置 `stream_format: "sse"`，且 sandbox 执行端口提供 `runShellStreaming`
- **THEN** Bash 工具 MUST 调用 `runShellStreaming` 而非 `runShell` 或 `runShellBackgroundable`
- **AND** `onStdoutChunk` 回调 MUST 被调用以逐块接收 stdout
- **AND** 每个完整 SSE 帧 MUST 通过 `emitResultDelta` 传递给 tool-loop

#### Scenario: stream_format ndjson 使用流式执行路径

- **WHEN** 模型调用 Bash 并设置 `stream_format: "ndjson"`，且 sandbox 执行端口提供 `runShellStreaming`
- **THEN** Bash 工具 MUST 调用 `runShellStreaming`
- **AND** 每个完整 JSON 行 MUST 通过 `emitResultDelta` 传递给 tool-loop

#### Scenario: 未设置 stream_format 但命令匹配 SSE 特征时自动激活流式路径

- **WHEN** 模型调用 Bash 且未设置 `stream_format`，但命令或参数包含 `text/event-stream`、`/sse/`、`--no-buffer` 或 ` -N `
- **THEN** Bash 工具 MUST 自动将 `stream_format` 设为 `"sse"`
- **AND** MUST 使用流式执行路径
- **AND** `onStdoutChunk` 回调 MUST 被调用

#### Scenario: 未设置 stream_format 且不匹配流式特征时走非流式路径

- **WHEN** 模型调用 Bash 且未设置 `stream_format`，且命令不匹配任何 SSE 流式特征
- **THEN** Bash 工具 MUST 走现有非流式执行路径
- **AND** 行为 MUST 与未引入 `stream_format` 字段时完全一致

#### Scenario: sandbox 不支持 runShellStreaming 时回退

- **WHEN** `stream_format` 为 `"sse"`（显式设置或自动检测），但 sandbox 执行端口的 `runShellStreaming` 为 `undefined`
- **THEN** Bash 工具 MUST 回退到现有非流式执行路径
- **AND** MUST NOT 抛出错误

#### Scenario: 流式路径 terminal 结果形状不变

- **WHEN** Bash 流式执行完成
- **THEN** 返回的结果 MUST 匹配 `bashExecutionOutputSchema`
- **AND** `exitCode`、`stdout`、`stderr`、`stdoutTruncated`、`stderrTruncated` 字段 MUST 存在
- **AND** degraded 和 timeout 判定逻辑 MUST 与非流式路径一致

#### Scenario: 残余 buffer 在 flush 时处理

- **WHEN** Bash 流式执行完成且 emitter buffer 中有残余不完整帧
- **THEN** `emitter.flush()` MUST 被调用
- **AND** 残余帧 MUST 被处理并传递给 `emitResultDelta`

## Function 变更汇总

### 输入

变更类型：修改
目标内容：Bash input schema 新增可选字段 `stream_format`（枚举 `'sse' | 'ndjson'`），用于声明命令输出为流式结构化数据。当模型未设置该字段时，Bash 工具根据命令内容自动检测 SSE 流式特征。
依据 Requirements：Bash Streaming Execution Path

### 处理过程

变更类型：修改
目标内容：新增流式执行分支。当 `stream_format` 为 `'sse'`/`'ndjson'`（显式设置或自动检测）且 `runShellStreaming` 可用时，创建 `BashStreamDeltaEmitter`，调用 `runShellStreaming` 逐块回调 stdout，帧分割后通过 `emitResultDelta` 逐帧推送。`emitBashOutputFrame` 直接传递提取的 payload，不自行包裹 `structuredPayload`。不可用时回退到现有 `runShell`/`runShellBackgroundable`/`runPython` 路径。
依据 Requirements：Bash Streaming Execution Path
