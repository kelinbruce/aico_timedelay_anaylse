## 设计范围

- 受影响 Function/OpenSpec capability/spec: `FN-4.6 分页查看大结果` / `large-content-readback`。
- 受影响实现 owner: `agent-capability` 内置 workspace `Read` 能力。
- 不修改普通文件读取预算、路径授权、workspace root 策略、large-content externalization owner、Web API、stream event、runtime command、gateway contract 或 persistence owner。

## FN-4.6 分页查看大结果

### 目标与规范依据

`Read` 使用 `offset` / `limit` 按行分页，再对选中切片执行字节预算校验。`tool-results/*` 是 Capability 输出外部化后的主要回读面，真实诊断输出经常包含长 JSON 行、命令日志或表格行。16 KiB 的专用预算会让一次回读只能覆盖很少行，且 `PAGING_REQUIRED` 缺少可执行边界，模型难以稳定恢复。

本 Function 的目标 Requirements 位于 canonical spec `large-content-readback`，本 change 通过 `MODIFIED` operation 更新 `Read tool is exempt from externalization to prevent readback loops`。

### 当前实现

- `tool-results/*` 专用单次回读预算为 16 KiB。
- 超出预算且 `limit > 1` 时返回 `PAGING_REQUIRED`。
- 错误消息仅要求减小 `limit`，不暴露当前切片字节数、预算或建议值。
- `limit=1` 时保留 bounded-head 行首回退，避免单行超预算导致完全不可读。

### GAP 分析

分页单位是行，约束单位是字节。模型只能控制 `limit`，但失败反馈没有给出字节预算、当前切片大小或按行估算后的建议 `limit`。当日志每行较长时，`limit=100` 仍可能超出 16 KiB，模型会多轮试探甚至放弃。

### 修改方案

将 `tool-results/*` 专用预算提升到 64 KiB，并继续受 `workspaceFiles.maxTextBytes` 更小值约束：

```text
singleCallTextBudget = min(workspaceFiles.maxTextBytes, 65_536)
```

对 `limit > 1` 的 oversized slice，基于实际选中的行计算 `suggestedLimit`，并通过 safe details 返回。建议值至少为 `1`，且不超过当前 read policy 的 `maxLines`。

计算必须使用实际选中行数，而不是只使用请求 `limit`，因为最后一页可能少于请求行数。估算应足够保守，使模型用相同 `offset` 和 `suggestedLimit` 重试时能够成功，或者自然退化到既有 `limit=1` bounded-head 行为。

### 非目标

- 不新增 byte-offset pagination。
- 不新增独立 readback tool 或 blob-backed router。
- 不修改普通 workspace 文件读取预算。
- 不在错误、日志或 public API surface 中暴露原始宿主路径或不安全 payload 内容。

## 长期基线刷新计划

- 归档时刷新 stable spec: `openspec/specs/large-content-readback/spec.md`。
- 需要确认 Function 文档: `openspec/designs/functions/D4-模型与上下文/D4.2-上下文管理与压缩/FN-4.6-分页查看大结果.md`。
- 不涉及新增 Function、Feature、module、architecture、ADR 或 spec-to-design-map 条目。

## 验证

- Focused `Read` capability tests 覆盖 `PAGING_REQUIRED` details、建议行数重试成功、`limit=1` bounded head 和 `tool-results` 64 KiB 回读预算。
- OpenSpec validation 用于确认 capability delta 格式正确。
