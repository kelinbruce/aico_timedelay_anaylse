## ADDED Requirements

### Requirement: Grep file extension filtering

Grep SHALL 在打开或扫描候选文件之前，使用当前 accepted Agent/version 的读取 extension policy 按 deny-first 顺序过滤候选文件。未授权后缀文件 MUST NOT 被读取、计入扫描字节预算或产生匹配结果。

#### Scenario: Grep does not scan unauthorized extensions
- **WHEN** 读取 allowlist 为 `[".log"]`，相同搜索文本同时存在于 `alarm.log` 和 `credential.pem`
- **THEN** Grep SHALL 仅返回 `alarm.log` 中的匹配且不得读取 `credential.pem`

#### Scenario: Missing read extension policy preserves existing scan
- **WHEN** 读取 allowlist 和 denylist 均缺省且目录授权允许候选文件
- **THEN** Grep SHALL 保持现有不按后缀过滤的扫描行为

#### Scenario: Grep denylist excludes a file without allowlist
- **WHEN** 读取 denylist 为 `[".pem"]`、allowlist 缺省，匹配文本存在于 `alarm.log` 和 `credential.pem`
- **THEN** Grep SHALL 扫描并返回 `alarm.log` 的匹配，但不得读取或返回 `credential.pem`
