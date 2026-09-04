## Why

大型 Capability 输出会外部化到 `workspace/tool-results/<refId>.txt`，再通过 `Read` 工具回读。现有 `tool-results` 专用回读预算为 16 KiB，而真实电信诊断输出常包含较长 JSON、命令日志或表格行，单行可能达到数百到数千字节。

`Read` 使用 `offset` / `limit` 按行分页，但最终按字节预算校验切片。当前 `PAGING_REQUIRED` 只提示减小 `limit`，没有告诉模型当前切片大小、预算边界或可重试的建议行数，导致模型只能盲目从 2000、1000、500、100 逐步试探，仍可能失败后放弃。

## What Changes

- 将 `tool-results/*` 单次回读预算从 16 KiB 提升到 64 KiB，并继续受 `workspaceFiles.maxTextBytes` 更小值约束。
- 保持 `Read` exempt from large-content externalization，避免工具输出回读再次被外部化形成循环。
- oversized read slice 返回 `PAGING_REQUIRED` 时提供安全、可执行的诊断信息，包括 `suggestedLimit`、`byteBudget`、请求 `limit`、`offset`、`sliceBytes` 和最大行字节证据。
- 保留 `limit=1` 的 bounded-head escape hatch，用于单行本身超过预算的场景。

## Function Impact

- 修改 Function/OpenSpec capability: `FN-4.6 分页查看大结果` / `large-content-readback`。
- 不新增 Function、Capability、Web API、stream event、runtime command、gateway contract 或 persistence owner。

## Impact

- 影响 `agent-capability` 中 `Read` 对 `tool-results/*` 与 `workspace/tool-results/*` 路径的回读行为。
- 不改变普通 workspace 文件预算、`offset` / `limit` schema、workspace 授权、路径策略或 large-content externalization owner。
