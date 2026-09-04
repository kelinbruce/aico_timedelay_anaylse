## Function

- **所属 Function**：`FN-5.4 搜索文件`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 文件搜索工具使用 execution view 默认根

Glob 和 Grep MUST 将缺省 `path` 与不带已知 root 前缀的相对 `path` 从当前 accepted run 的逻辑 execution view 根解释。默认搜索 MUST 只遍历 Agent-scoped effective Read authority 覆盖的普通文件；系统管理目录、未授权 Skill projection、只读 root 和 scope 外路径 MUST NOT 因默认根统一而被隐式扩大权限。

搜索结果 MUST 使用相对于 execution view 根的规范化逻辑路径。LOCAL 与 REMOTE/PaaS MUST 产生同形逻辑结果，且不得返回物理 `scopeBase`、scope key、`/work` 物理映射或宿主绝对路径。

**需求类别**：功能性需求

#### Scenario: 缺省路径覆盖授权 execution view
- **GIVEN** accepted Agent 的 effective Read authority 同时允许默认根文件和 `workspace/` 文件
- **WHEN** Glob 或 Grep 缺省 `path`
- **THEN** 搜索 MUST 在一个全局排序和容量预算下覆盖两个授权位置
- **AND** 返回路径 MUST 分别保持为 `root-file.txt` 与 `workspace/durable-file.txt`

#### Scenario: 默认搜索跳过未授权系统资源
- **WHEN** 默认 execution view 中存在未授权 `.nextagent/` 内容或 scope 外链接
- **THEN** Glob 和 Grep MUST NOT 遍历或返回该内容
- **AND** 搜索结果 MUST NOT 泄漏其是否存在

### Requirement: Glob Has A Strict Pattern And Path Contract

Glob SHALL accept a strict object containing:

- `pattern` (string, required): a non-empty glob expression relative to each effective search root;
- `path` (string, optional): a non-empty explicit execution-view-relative search directory.

Each string SHALL contain at most 4096 UTF-16 code units. Unknown properties SHALL be rejected.

Glob SHALL return `filenames` as normalized execution-view-relative ordinary-file paths using `/`, and `truncated` to indicate whether matching results were omitted by a hard traversal boundary. The output SHALL NOT contain duration, a duplicate count, file metadata, execution root, or host absolute paths.

**需求类别**：功能性需求

#### Scenario: 最小合法输入使用全部 effective Read roots
- **WHEN** 模型仅使用合法 `pattern` 调用 Glob
- **THEN** Glob MUST 搜索 effective Read authority 的规范化并集
- **AND** `readDirectories` 缺省时 execution view 根 MUST 成为默认搜索范围
- **AND** 匹配文件名 MUST 按定义的输出形状返回

#### Scenario: 未知输入在搜索前被拒绝
- **WHEN** 调用包含未知属性、空字符串、超长字符串或错误类型
- **THEN** 调用 MUST 以安全校验错误失败
- **AND** 系统 MUST NOT 执行文件系统搜索

### Requirement: Glob Uses Agent-Scoped Read Authority

Glob SHALL search only within the effective Read authority compiled for the accepted Agent assembly/version. Effective Read authority SHALL use execution-view-relative configured `readDirectories`, include `writeDirectories`, and preserve whole-execution-view Read compatibility only when `readDirectories` is absent. Known logical roots SHALL remain subordinate to their root access mode and authorization.

Trusted execution view and directory authority SHALL come only from trusted app composition. Model input, client metadata, capability arguments, or request payload SHALL NOT override them. When `path` is absent, Glob SHALL search every normalized non-overlapping authorized root, merge and deduplicate results, and apply one global ordering and capacity budget. When `path` is present, it SHALL be wholly contained by one effective Read authority target.

**需求类别**：功能性需求

#### Scenario: 授权目录被搜索
- **WHEN** `path` 解析为一个已授权 Read directory 或其后代
- **THEN** Glob MUST 只搜索该授权范围
- **AND** 全部返回文件 MUST 保持在 effective Read authority 内

#### Scenario: 未授权目录被拒绝
- **WHEN** `path` 位于全部 effective Read directories 之外
- **THEN** Glob MUST 返回 `CAPABILITY_PATH_REJECTED`
- **AND** 系统 MUST NOT 遍历未授权目录

### Requirement: Grep Has A Strict Pattern And Path Contract

Grep SHALL accept a strict object containing required `pattern`; optional execution-view-relative `path`; optional `glob_filter`; optional `output_mode` with default `files_with_matches`; optional `case_insensitive` with default `false`; and optional integer `max_results` with default `100` and range `1..500`. Each string SHALL contain at most 4096 UTF-16 code units. Unknown properties SHALL be rejected.

For `files_with_matches`, Grep SHALL return normalized execution-view-relative `filenames`, `total_files_with_matches`, `total_matches`, and `truncated`. For `content`, Grep SHALL return `matches` entries containing execution-view-relative `file_path`, 1-based `line_number`, and the matched `line` truncated to 4096 code units, plus the same totals and `truncated`. The output SHALL NOT contain duration, regex source, resolved physical path, glob filter, execution root, host absolute paths, full file contents, or non-matched lines.

**需求类别**：功能性需求

#### Scenario: 最小合法输入使用全部 effective Read roots
- **WHEN** 模型仅使用合法 `pattern` 调用 Grep
- **THEN** Grep MUST 搜索 effective Read authority 的规范化并集
- **AND** `readDirectories` 缺省时 execution view 根 MUST 成为默认搜索范围
- **AND** 匹配文件名 MUST 使用 `files_with_matches` 输出形状返回

#### Scenario: content 模式返回稳定字段
- **WHEN** 模型以 `output_mode="content"` 调用 Grep
- **THEN** `matches` 的每个条目 MUST 包含 `file_path`、`line_number` 与 `line`
- **AND** 完整文件内容及未匹配行 MUST 不出现在结果中

#### Scenario: 非法输入在搜索前被拒绝
- **WHEN** 调用包含未知属性、空字符串、超长字符串、错误类型或超出 `1..500` 的 `max_results`
- **THEN** 调用 MUST 以安全校验错误失败
- **AND** 系统 MUST NOT 执行文件系统搜索

### Requirement: Grep Uses Agent-Scoped Read Authority

Grep SHALL scan only within the effective Read authority compiled for the accepted Agent assembly/version. Effective Read authority SHALL use execution-view-relative configured `readDirectories`, include `writeDirectories`, and preserve whole-execution-view Read compatibility only when `readDirectories` is absent. Known logical roots SHALL remain subordinate to their root access mode and authorization.

Trusted execution view and directory authority SHALL come only from trusted app composition. Model input, client metadata, capability arguments, or request payload SHALL NOT override them. When `path` is absent, Grep SHALL scan every normalized non-overlapping authorized root, merge and deduplicate candidate files, and apply one global ordering and capacity budget. When `path` is present, it SHALL be wholly contained by one effective Read authority target.

**需求类别**：功能性需求

#### Scenario: 授权目录被搜索
- **WHEN** `path` 解析为一个已授权 Read directory 或其后代
- **THEN** Grep MUST 只搜索该授权范围
- **AND** 全部返回文件 MUST 保持在 effective Read authority 内

#### Scenario: 未授权目录被拒绝
- **WHEN** `path` 位于全部 effective Read directories 之外
- **THEN** Grep MUST 返回 `CAPABILITY_PATH_REJECTED`
- **AND** 系统 MUST NOT 遍历未授权目录

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：提供以 execution view 为统一默认路径基准、受 Agent-scoped Read authority 约束的文件名和内容搜索。
- **依据 Requirements**：`文件搜索工具使用 execution view 默认根`、`Glob Has A Strict Pattern And Path Contract`、`Glob Uses Agent-Scoped Read Authority`、`Grep Has A Strict Pattern And Path Contract`、`Grep Uses Agent-Scoped Read Authority`

### 输入

- **变更类型**：修改
- **目标内容**：缺省或无 root 前缀 `path` 使用 execution-view-relative 语义；显式已知 root 路径继续受对应 root 权限约束。
- **依据 Requirements**：`文件搜索工具使用 execution view 默认根`、`Glob Has A Strict Pattern And Path Contract`、`Grep Has A Strict Pattern And Path Contract`

### 输出

- **变更类型**：修改
- **目标内容**：匹配文件与内容结果返回规范化 execution-view-relative 路径，不暴露物理执行根或宿主路径。
- **依据 Requirements**：`文件搜索工具使用 execution view 默认根`、`Glob Has A Strict Pattern And Path Contract`、`Grep Has A Strict Pattern And Path Contract`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统在一个全局排序和容量预算内遍历 effective Read authority 覆盖的 execution view 目标，跳过未授权系统资源和 scope 外路径。
- **依据 Requirements**：`文件搜索工具使用 execution view 默认根`、`Glob Uses Agent-Scoped Read Authority`、`Grep Uses Agent-Scoped Read Authority`

### 主规格

- **变更类型**：修改
- **目标内容**：`file-search-tools`
- **依据 Requirements**：`文件搜索工具使用 execution view 默认根`、`Glob Uses Agent-Scoped Read Authority`、`Grep Uses Agent-Scoped Read Authority`

### 遗留规格

- **变更类型**：修改
- **目标内容**：`glob-tool` 与 `grep-tool` 保留本次未触及的 Tool-specific Requirements；本次迁移的 path contract 与 Read authority Requirements 由主规格承载。
- **依据 Requirements**：`Glob Has A Strict Pattern And Path Contract`、`Glob Uses Agent-Scoped Read Authority`、`Grep Has A Strict Pattern And Path Contract`、`Grep Uses Agent-Scoped Read Authority`
