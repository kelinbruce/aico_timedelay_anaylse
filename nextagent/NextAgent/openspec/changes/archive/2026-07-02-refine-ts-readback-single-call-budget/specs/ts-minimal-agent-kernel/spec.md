## MODIFIED Requirements

### Requirement: 最小 Capability Read Tool

`read` capability SHALL continue to read one workspace-relative file with line-based `offset` / `limit` paging and safe bounded output.

For `tool-results/<refId>.txt` readback, successful payload MUST additionally respect a dedicated single-call text budget of `16384` bytes or the configured `workspaceFiles.maxTextBytes`, whichever is smaller. When the requested default or explicit range exceeds that budget, the tool MUST return a safe `PAGING_REQUIRED` result rather than inline the oversized page. If `limit=1` and the selected line itself exceeds the budget, the tool MAY return a bounded head with `truncated=true`.

#### Scenario: read 工具遵守 workspace 边界

- **WHEN** read capability 请求读取文件
- **THEN** 工具 MUST 只接受 `file_path` as workspace-relative 单文件路径
- **AND** 绝对路径、路径逃逸、目录读取、glob pattern、权限拒绝、timeout 或 abort MUST 返回 safe capability failure，并导致 request 发布 `DEGRADATION_NOTICE` 后以 `REQUEST_FAILED` 结束
- **AND** 缺失文件或普通 IO failure MAY 作为 safe tool result 交给模型继续生成答复
- **AND** `offset` MUST mean 0-based start line and default to `0`
- **AND** `limit` MUST mean maximum line count and default to `2000`
- **AND** `offset` and `limit` MUST be integers, `offset` MUST be greater than or equal to `0`, and `limit` MUST be between `1` and `2000`; invalid values MUST fail capability input schema validation
- **AND** successful payload MUST 受 line-based `offset`、`limit` 和最大输出大小约束
- **AND** successful payload MUST contain `file_path`、`offset`、`limit`、`content`、`truncated` and optional `nextOffset`
- **AND** successful payload `file_path` MUST be a normalized workspace-relative path and MUST NOT expose host absolute path
- **AND** 超限时 MUST 返回 bounded slice，并显式包含 `truncated=true` 和 `nextOffset`
- **AND** 对 `tool-results/<refId>.txt`，当默认或显式范围超过单次读回预算时 MUST 返回 `PAGING_REQUIRED`，不得把超大 readback 页直接作为完整成功结果返回
- **AND** safe failure MUST NOT 泄漏未脱敏宿主路径、credential 或未授权对象内容
