## ADDED Requirements

### Requirement: Agent workspace file extension authority

可信 Agent 配置 SHALL 支持可选的 `workspaceFiles.readAllowedExtensions`、`workspaceFiles.readDeniedExtensions`、`workspaceFiles.writeAllowedExtensions` 和 `workspaceFiles.writeDeniedExtensions` 字符串数组。每个条目 MUST 匹配 `^\.[a-z0-9]+$`，MUST 使用小写 ASCII，并以目标文件名最终一个 `.` 起始的后缀精确匹配；每个数组内部 MUST NOT 包含重复条目。任一 allowlist 缺省 SHALL 表示未被同类 denylist 拒绝的后缀均获授权；显式空 allowlist SHALL 表示不授权该类操作的任何文件后缀。任一 denylist 缺省 SHALL 等价于空 denylist。配置解析 MUST 拒绝非数组、非字符串、空字符串、无前导点、大写、路径分隔符、glob、仅为 `.` 或同数组重复条目；同一后缀同时存在于同类 allowlist 和 denylist SHALL 被接受，并在运行期由 denylist 优先拒绝。

#### Scenario: Valid extension allowlists and denylists are accepted
- **WHEN** Agent 配置声明 `readAllowedExtensions: [".json", ".log"]`、`readDeniedExtensions: [".pem"]`、`writeAllowedExtensions: [".json"]` 和 `writeDeniedExtensions: [".sh"]`
- **THEN** 配置 SHALL 被接受并保留规范化顺序和值

#### Scenario: Both lists missing preserves unrestricted compatibility
- **WHEN** 一个 Agent 同时缺省某类操作的 allowlist 和 denylist
- **THEN** 该类文件 Tool SHALL 保持所有后缀均获授权的兼容行为

#### Scenario: Denylist without allowlist excludes only denied extensions
- **WHEN** Agent 声明 `readDeniedExtensions: [".pem"]` 且缺省 `readAllowedExtensions`
- **THEN** `.pem` SHALL 被拒绝，其他后缀和无后缀文件 SHALL 获得读取授权

#### Scenario: Allowlist without denylist permits only allowed extensions
- **WHEN** Agent 声明 `readAllowedExtensions: [".json"]` 且缺省 `readDeniedExtensions`
- **THEN** 仅 `.json` SHALL 获得读取授权，其他后缀和无后缀文件 SHALL 被拒绝

#### Scenario: Denylist overrides allowlist
- **WHEN** `.json` 同时出现在同类 allowlist 和 denylist
- **THEN** `.json` MUST 被拒绝；未命中 denylist 的后缀 MUST 继续由 allowlist 决定

#### Scenario: Empty allowlist denies every extension
- **WHEN** Agent 显式声明某类操作的 allowlist 为空数组
- **THEN** 该类文件 Tool SHALL 不授权任何后缀，无论 denylist 是否缺省

#### Scenario: Unsafe extension entry is rejected
- **WHEN** 任一 extension 条目为 `.JSON`、`json`、`.tar.gz`、`*`、`.`、包含 `/` 或与同一数组已有条目重复
- **THEN** 受影响 Agent definition MUST 编译失败且不得进入 runtime-facing assembly
