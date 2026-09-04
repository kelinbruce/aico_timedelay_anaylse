## ADDED Requirements

### Requirement: Read file extension authorization

Read SHALL 在读取文件 metadata 或内容之前，使用当前 accepted Agent/version 的读取 extension policy 检查已规范化目标文件名，并严格按 denylist 命中、allowlist 是否缺省、allowlist 命中的顺序判定。文件名最终后缀按 ASCII 小写比较；无后缀或仅为 dotfile 且没有第二个 `.` 的文件 SHALL 视为无后缀：allowlist 缺省且未被 denylist 命中时允许，allowlist 已配置时拒绝。既有路径安全规则 SHALL 在 extension policy 之前拒绝尾随点等非法路径语法。未授权目标 SHALL 返回与不可用文件相同的安全结果，不得泄漏文件是否存在、物理路径、大小或内容。

#### Scenario: Allowed final extension is read
- **WHEN** 读取 allowlist 为 `[".json"]`、denylist 缺省且 Read 目标为 `workspace/counters/cell.JSON`
- **THEN** Read SHALL 按 `.json` 授权并返回既有的有界文本读取结果

#### Scenario: Multiple suffix uses final extension only
- **WHEN** 读取 allowlist 为 `[".gz"]` 且 Read 目标为 `workspace/archive.tar.gz`
- **THEN** Read SHALL 允许该目标

#### Scenario: Disallowed or missing suffix is indistinguishable from unavailable
- **WHEN** 读取 allowlist 为 `[".json"]` 且目标为 `workspace/run.sh`、`workspace/README` 或 `workspace/.env`
- **THEN** 每个调用 SHALL 返回安全的 `FILE_UNAVAILABLE` 结果且不得读取目标内容

#### Scenario: Existing path syntax rejection remains authoritative
- **WHEN** Read 目标以尾随点等既有规则禁止的路径语法表示
- **THEN** Read SHALL 保持既有 `CAPABILITY_PATH_REJECTED` 行为且不得以 extension policy 改写路径安全判定

#### Scenario: Read denylist overrides allowlist
- **WHEN** `.json` 同时位于读取 allowlist 和 denylist 且目标为 `workspace/counters.json`
- **THEN** Read SHALL 返回安全的 `FILE_UNAVAILABLE` 结果且不得读取目标内容
