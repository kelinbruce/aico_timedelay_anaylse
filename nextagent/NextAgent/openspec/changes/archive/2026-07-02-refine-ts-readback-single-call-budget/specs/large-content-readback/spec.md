## MODIFIED Requirements

### Requirement: Read 工具豁免于外置化以防止读回循环

`read` 工具 SHALL 豁免于大内容外置化路径：其输出 SHALL 是由可选 `offset` / `limit` 参数控制的有界分页，SHALL NOT 被替换为 `PERSISTED_PREVIEW` / `SPECIALIZED_REF` 形式，即使所请求的分页本来会超过内联阈值。该豁免 SHALL 适用于所有 `read` 输出，并 SHALL 阻止 read-读回-外置化-读回循环。

具体针对 `tool-results/<refId>.txt` 读回，runtime SHALL 强制执行 `16384` 字节或已配置 `workspaceFiles.maxTextBytes` 中较小者的专用单次调用文本预算。当请求的默认或显式范围会超出该预算时，`read` SHALL 返回安全的 `PAGING_REQUIRED` 结果，而不是内联超大的分页。如果 `limit=1` 且所请求的单行本身超出预算，runtime MAY 返回带 `truncated=true` 的有界开头部分，使模型不会陷入死锁。

#### Scenario: Read 输出永远不会被外置化

- **WHEN** 一个 `read` 分页被组装进模型可见上下文
- **THEN** 该分页作为模型可见内容被内联交付
- **AND** 该分页不会被替换为 `PERSISTED_PREVIEW` 或 `SPECIALIZED_REF` 形式
- **AND** 不会发生 read 结果的递归外置化

#### Scenario: Read 通过可选参数强制分页

- **WHEN** 模型调用 `read`
- **THEN** 省略的 `offset` 和 `limit` 由既有 read schema 给出默认值
- **AND** 提供的 `offset` 和 `limit` 作为分页参数被遵守（`limit` 受策略约束）
- **AND** 返回的分页大小是有界的

#### Scenario: 超大的单次 read 提示模型分页

- **WHEN** 模型对某个文件调用 `read`，其请求的默认或显式范围对已配置的单次调用文本预算而言过大
- **THEN** runtime 返回安全的 paging-required 错误
- **AND** 该错误提示模型以显式 `offset` 和 `limit` 重试
- **AND** 响应不包含含糊的静默截断分页

#### Scenario: Tool-results 读回使用更严格的单次调用预算

- **WHEN** 模型对 `tool-results/<refId>.txt` 调用 `read`
- **AND** 请求的默认或显式范围会超出 `16384` 字节
- **THEN** runtime 返回 `error: "PAGING_REQUIRED"`
- **AND** 它不把超大的读回分页内联进 tool 结果
