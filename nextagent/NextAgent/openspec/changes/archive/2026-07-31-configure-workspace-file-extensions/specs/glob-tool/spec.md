## ADDED Requirements

### Requirement: Glob file extension filtering

Glob SHALL 使用当前 accepted Agent/version 的读取 extension policy 按 deny-first 顺序执行结果过滤。未授权后缀的文件 MUST NOT 出现在结果中；目录可作为遍历内部事实，但 MUST NOT 因名称后缀获得文件授权。过滤 MUST 在结果计数和返回上限计算之前完成，使未授权文件不消耗可见结果配额。

#### Scenario: Glob omits unauthorized extensions
- **WHEN** 读取 allowlist 为 `[".json"]`，匹配目录同时包含 `cell.json`、`secret.pem` 和 `README`
- **THEN** Glob SHALL 仅返回 `cell.json`

#### Scenario: Empty read extension list returns no files
- **WHEN** 读取 allowlist 为显式空数组
- **THEN** Glob SHALL 返回空文件结果且不得暴露目录中文件名

#### Scenario: Glob denylist overrides an allowed extension
- **WHEN** `.json` 同时位于读取 allowlist 和 denylist，匹配目录包含 `cell.json`
- **THEN** Glob SHALL 不返回 `cell.json`
