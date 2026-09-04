## ADDED Requirements

### Requirement: Capability 结果大内容作为可读文件外置到执行 workspace

当内容超过内联阈值的 `CAPABILITY_RESULT` 被持久化到 message store 时，runtime SHALL 在写入该 message 之前，将完整原始内容外置为执行 workspace 中的一个真实文件 `workspace/tool-results/<refId>.txt`（位于 readWrite `workspace/` 根下，通过执行 workspace resolver 实施 owner scope），并 SHALL 将 model 可见形式持久化为 `PERSISTED_PREVIEW`，携带 `file_path`（`tool-results/<refId>.txt`）、原始大小、有界 preview，以及一条指示 model 以该 `file_path` 和可选 `offset` / `limit` 调用 `read` 工具以分页读取完整内容的访问指令。原始完整内容的权威来源 SHALL 是该 workspace 文件，而不是 model 可见的 message 内容。本 change 有意更新 capability-result 内容的冻结大内容基线：附件派生内容、artifact、model 摘要和其他 blob 支撑的对象仍由 `BlobStoreGateway` 承载，而超大的 capability-result 文本使用执行 workspace，使既有 `read` 工具能在不引入新工具、新 `read` 参数、blob id 暴露或虚拟路径 router 的情况下对其分页。组装和渲染路径 SHALL 透传该合规形式，并 SHALL NOT 为超大的 capability 结果发出无引用的内存 preview 作为最终 model 可见形式。本 change 不试图保护该 workspace 文件免受后续 model/tool 写入；普通 workspace 写/编辑/sandbox 流程对 `tool-results/` 的变更不在本 change 范围内。

#### Scenario: 超大 capability 结果在持久化前被外置为 workspace 文件

- **WHEN** 一个内容超过内联阈值的 `CAPABILITY_RESULT` 被写入 message store
- **THEN** 完整原始内容在 message 写入之前被写入 `workspace/tool-results/<refId>.txt`（按 owner scope）
- **AND** 持久化的 message 内容是携带 `file_path`、原始大小、有界 preview 和访问指令的 `PERSISTED_PREVIEW`，该指令指示 model 以 `file_path` 和可选 `offset` / `limit` 调用 `read`
- **AND** 原始完整内容的权威来源是该 workspace 文件，而不是 message 内容

#### Scenario: 组装和渲染透传合规形式

- **WHEN** 组装或渲染加载一个先前外置的 capability 结果
- **THEN** 它呈现带 `file_path` 和访问指令的同一 `PERSISTED_PREVIEW` 形式
- **AND** 除非 model 以该 `file_path` 调用 `read`，它不重新内联完整原始内容
- **AND** 它不发出无引用的 preview 作为最终 model 可见形式
