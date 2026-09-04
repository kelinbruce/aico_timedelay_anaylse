## ADDED Requirements

### Requirement: Model 可通过 workspace 文件路径以有界分页读回外置的 tool 结果

Runtime SHALL 通过既有的 `read` 工具实现 `large-content-readback` 能力，不添加任何新输入参数或新工具。外置的 tool 结果 SHALL 作为真实文件持久化在执行 workspace 的 `tool-results/<refId>.txt`（位于 readWrite `workspace/` 根下），model 可见的 `PERSISTED_PREVIEW` SHALL 携带该 `file_path`。当 model 以该 `file_path` 调用 `read` 时，`workspaceFiles.readText` SHALL 将其作为普通 workspace 文件读取，并返回有界的行分页，复用 `read` 工具对任何 workspace 文件已使用的可选 `offset` / `limit`、`truncated` 和 `nextOffset` 语义。`offset` 和 `limit` MAY 省略，此时 read 工具 SHALL 应用其既有默认值。如果省略或过大的 limit 会要求返回超过配置的单次调用文本预算的内容，read 工具 SHALL 以安全的需要分页错误失败，告知 model 该文件太大、无法一次读取、必须以显式 `offset` / `limit` 分页；它 SHALL NOT 像页面完整一样静默截断该页。该能力 SHALL NOT 要求 model 知道 blob id、租户/用户标识符或任何非 workspace 存储路径。

#### Scenario: Model 检索大型 tool 结果的有界分页

- **WHEN** model 以 `file_path`（`tool-results/<refId>.txt`）和显式 `offset` / `limit` 调用 `read`
- **THEN** runtime 返回原始内容对应的有界行分页
- **AND** 响应携带 `truncated` 和 `nextOffset`，指示是否还有剩余内容及其位置
- **AND** 响应不要求 model 提供 blob id 或租户标识符

#### Scenario: Model 在大型 tool 结果中向前翻页

- **WHEN** model 以递增的 `offset`（或返回的 `nextOffset`）值调用 `read`
- **THEN** 连续的响应按顺序覆盖原始内容，无重叠或缺口
- **AND** 最后一页报告 `truncated = false` 且没有 `nextOffset`

### Requirement: 读回经由执行 workspace 实施 owner scope

读回 SHALL 通过执行 workspace resolver 实施 owner scope，该 resolver 按 `tenantId` / `subjectId` / `sessionId` 界定 workspace 根。如果某个 `file_path` 对应的底层文件不存在于请求方 owner scope 的 workspace 中，SHALL NOT 返回内容；runtime SHALL 呈现 `read` 工具的 `error: "FILE_UNAVAILABLE"` 形式，并 SHALL NOT 通过失败路径泄漏原始内容、所属 identity 或任何跨 scope 文件内容。通过读回能力进行的分页读取 SHALL 只在已授权的 `read` 工具路径上进行。

#### Scenario: 跨 scope 读回被拒绝且不泄漏

- **WHEN** model 以一个其文件不存在于请求方 owner scope workspace 中的 `file_path` 调用 `read`
- **THEN** runtime 返回 `error: "FILE_UNAVAILABLE"`
- **AND** 原始内容、所属 identity 和任何跨 scope 文件内容都不被暴露

#### Scenario: 缺失或不可读文件安全降级

- **WHEN** workspace 文件缺失、被移除或不可读
- **THEN** `read` 返回 `error: "FILE_UNAVAILABLE"`
- **AND** 失败路径不暴露任何部分原始内容

### Requirement: Read 工具豁免于外置以防止读回循环

`read` 工具 SHALL 豁免于大内容外置路径：其输出 SHALL 是由可选 `offset` / `limit` 参数（以及 workspace 文件 policy 的 `maxLines` / `maxTextBytes` 上限）约束的有界分页，即使请求的页原本会超过内联阈值，SHALL NOT 被替换为 `PERSISTED_PREVIEW` / `SPECIALIZED_REF` 形式。该豁免 SHALL 适用于所有 `read` 输出，并 SHALL 防止 read-读回-外置-读回循环。当请求的读取过大、无法在单个有界响应中返回时，`read` SHALL 返回安全的需要分页错误，而不是外置其自身输出。

#### Scenario: Read 输出永不被外置

- **WHEN** 一个 `read` 页被组装进 model 可见上下文
- **THEN** 该页作为 model 可见内容内联交付
- **AND** 该页不被替换为 `PERSISTED_PREVIEW` 或 `SPECIALIZED_REF` 形式
- **AND** 不发生 read 结果的递归外置

#### Scenario: Read 通过可选参数强制分页

- **WHEN** model 调用 `read`
- **THEN** 省略的 `offset` 和 `limit` 由既有 read schema 给出默认值
- **AND** 提供的 `offset` 和 `limit` 被作为分页参数遵守（`limit` 受 policy 约束）
- **AND** 返回的页大小是有界的

#### Scenario: 超大单次读取告知 model 分页

- **WHEN** model 为一个其默认或显式范围超过配置的单次调用文本预算的文件调用 `read`
- **THEN** runtime 返回安全的需要分页错误
- **AND** 该错误告知 model 以显式 `offset` 和 `limit` 重试
- **AND** 响应不包含含糊的静默截断页

### Requirement: 超范围读回返回空页而不是错误

当 `offset` 处于或超出可用内容末尾时，读回 SHALL NOT 抛出错误。相反，它 SHALL 返回一个空页（`content` 为空、`truncated = false`、无 `nextOffset`），使 model 能检测到内容结束。缺失或不可读文件是唯一的失败条件，按 `error: "FILE_UNAVAILABLE"` 处理，而不是分页错误。

#### Scenario: Offset 超出末尾返回空页

- **WHEN** model 以一个 `file_path` 和处于或超出内容长度的 `offset` 调用 `read`
- **THEN** runtime 返回一个空页
- **AND** 响应报告 `truncated = false` 且没有 `nextOffset`
- **AND** 对内容结束条件不抛出错误
