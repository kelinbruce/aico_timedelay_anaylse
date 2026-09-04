## Function

- **所属 Function**：`FN-5.4 搜索文件`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: 文件搜索工具使用 execution view 默认根

Glob 和 Grep MUST 将缺省 `path` 解释为当前 accepted Agent 的 effective workspace Read authority，并 MUST 只遍历该 workspace 范围。Glob 和 Grep MUST 将 bare workspace `path` 解释为 `workspace/` 下的目录；bare path 与对应显式 `workspace/...` path MUST 解析为同一个 canonical search target。

显式 root-qualified `path` MUST 按对应 root 的既有授权检查。显式 `.nextagent/skills/<skillProjectionKey>/<skill-name>/...` path 在 committed projection authority 有效时 MUST 可搜索，且 MUST 独立于 workspace `readDirectories`；它 MUST NOT 自动加入缺省搜索。`temp/`、`generated-skills/`、`shared-data/` 和其他 `.nextagent/` 路径 MUST NOT 因缺省 `path` 被遍历。

搜索结果 MUST 使用 root-qualified canonical path。LOCAL 与 REMOTE/PaaS MUST 产生同形逻辑结果，且不得返回物理 `scopeBase`、scope key、`/work` 映射或宿主绝对路径。

**需求类别**：功能性需求

#### Scenario: 缺省路径覆盖授权 execution view

- **GIVEN** workspace、temp、shared-data 和已验证 Skill projection 中均存在匹配文件
- **WHEN** Glob 或 Grep 省略 `path`
- **THEN** 搜索 MUST 只返回 effective workspace Read authority 内的匹配文件
- **AND** 返回路径 MUST 使用 `workspace/...`

#### Scenario: 默认搜索跳过未授权系统资源

- **WHEN** 默认 execution view 中存在 `.nextagent/`、`temp/`、`generated-skills/`、`shared-data/` 内容或 scope 外链接
- **THEN** Glob 和 Grep MUST NOT 因省略 `path` 遍历或返回该内容
- **AND** 搜索结果 MUST NOT 泄漏未授权目标是否存在

#### Scenario: bare 搜索路径映射到 workspace

- **WHEN** Glob 使用 `path="diagnostics"`，Grep 使用 `path="workspace/diagnostics"`
- **THEN** 两次搜索 MUST 使用同一个 canonical search target `workspace/diagnostics`

#### Scenario: 显式搜索有效 Skill projection

- **GIVEN** accepted Agent 的 `readDirectories=[]`
- **WHEN** Glob 或 Grep 使用有效 committed `.nextagent/skills/.../references` 路径
- **THEN** 搜索 MUST 只遍历该授权 Skill subtree
- **AND** 结果 MUST 保持 `.nextagent/skills/...` root-qualified canonical path

#### Scenario: 显式 Skill 路径拒绝 scope 越权

- **WHEN** 显式 `path` 指向未提交、完整性无效或其他 execution scope 的 Skill projection
- **THEN** Glob 或 Grep MUST 返回 `CAPABILITY_PATH_REJECTED`
- **AND** 系统 MUST NOT 遍历或泄漏目标内容

### Requirement: Glob Has A Strict Pattern And Path Contract

Glob SHALL accept a strict object containing:

- `pattern` (string, required): a non-empty glob expression relative to the canonical search target;
- `path` (string, optional): a non-empty explicit execution-view-relative search directory whose bare form aliases `workspace/...`.

Each string SHALL contain at most 4096 UTF-16 code units. Unknown properties SHALL be rejected.

Glob SHALL return `filenames` as root-qualified canonical ordinary-file paths using `/`, and `truncated` to indicate whether matching results were omitted by a hard traversal boundary. The output SHALL NOT contain duration, a duplicate count, file metadata, execution root, or host absolute paths.

**需求类别**：功能性需求

#### Scenario: 最小合法输入使用全部 effective Read roots

- **WHEN** 模型仅使用合法 `pattern` 调用 Glob
- **THEN** Glob MUST 搜索 effective workspace Read authority 的规范化并集
- **AND** `readDirectories` 缺省时整个 `workspace` MUST 成为默认搜索范围
- **AND** 匹配文件名 MUST 以 `workspace/...` 形式返回

#### Scenario: 未知输入在搜索前被拒绝

- **WHEN** 调用包含未知属性、空字符串、超长字符串或错误类型
- **THEN** 调用 MUST 以安全校验错误失败
- **AND** 系统 MUST NOT 执行文件系统搜索

### Requirement: Glob Uses Agent-Scoped Read Authority

Glob SHALL search workspace targets only within the effective Read authority compiled for the accepted Agent assembly/version. Effective workspace Read authority SHALL use root-qualified canonical `readDirectories`, include canonical `writeDirectories`, default to the entire `workspace` only when `readDirectories` is absent, and contain no workspace directory when `readDirectories=[]` and no write directory contributes one.

Trusted execution view and directory authority SHALL come only from trusted app composition. Model input, client metadata, capability arguments, or request payload SHALL NOT override them. When `path` is absent, Glob SHALL search every normalized non-overlapping workspace authority root, merge and deduplicate results, and apply one global ordering and capacity budget. When `path` is present, it SHALL be wholly contained by one effective workspace Read target or pass the independent authorization of an explicitly supported special root；known logical roots SHALL remain subordinate to their root access mode。

**需求类别**：功能性需求

#### Scenario: 授权目录被搜索

- **WHEN** `path` 解析为一个已授权 workspace Read directory 或其后代
- **THEN** Glob MUST 只搜索该授权范围
- **AND** 全部返回文件 MUST 保持在该 canonical target 内

#### Scenario: 未授权目录被拒绝

- **WHEN** `path` 既不位于 effective workspace Read directories 内，也未通过显式 special-root authorization
- **THEN** Glob MUST 返回 `CAPABILITY_PATH_REJECTED`
- **AND** 系统 MUST NOT 遍历未授权目录

### Requirement: Grep Has A Strict Pattern And Path Contract

Grep SHALL accept a strict object containing required `pattern`; optional execution-view-relative `path` whose bare form aliases `workspace/...`; optional `glob_filter`; optional `output_mode` with default `files_with_matches`; optional `case_insensitive` with default `false`; and optional integer `max_results` with default `100` and range `1..500`. Each string SHALL contain at most 4096 UTF-16 code units. Unknown properties SHALL be rejected.

For `files_with_matches`, Grep SHALL return root-qualified canonical `filenames`, `total_files_with_matches`, `total_matches`, and `truncated`. For `content`, Grep SHALL return `matches` entries containing root-qualified canonical `file_path`, 1-based `line_number`, and the matched `line` truncated to 4096 code units, plus the same totals and `truncated`. The output SHALL NOT contain duration, regex source, resolved physical path, glob filter, execution root, host absolute paths, full file contents, or non-matched lines.

**需求类别**：功能性需求

#### Scenario: 最小合法输入使用全部 effective Read roots

- **WHEN** 模型仅使用合法 `pattern` 调用 Grep
- **THEN** Grep MUST 搜索 effective workspace Read authority 的规范化并集
- **AND** `readDirectories` 缺省时整个 `workspace` MUST 成为默认搜索范围
- **AND** 匹配文件名 MUST 以 `workspace/...` 形式使用 `files_with_matches` 输出形状返回

#### Scenario: content 模式返回稳定字段

- **WHEN** 模型以 `output_mode="content"` 调用 Grep
- **THEN** `matches` 的每个条目 MUST 包含 root-qualified canonical `file_path`、`line_number` 与 `line`
- **AND** 完整文件内容及未匹配行 MUST 不出现在结果中

#### Scenario: 非法输入在搜索前被拒绝

- **WHEN** 调用包含未知属性、空字符串、超长字符串、错误类型或超出 `1..500` 的 `max_results`
- **THEN** 调用 MUST 以安全校验错误失败
- **AND** 系统 MUST NOT 执行文件系统搜索

### Requirement: Grep Uses Agent-Scoped Read Authority

Grep SHALL scan workspace targets only within the effective Read authority compiled for the accepted Agent assembly/version. Effective workspace Read authority SHALL use root-qualified canonical `readDirectories`, include canonical `writeDirectories`, default to the entire `workspace` only when `readDirectories` is absent, and contain no workspace directory when `readDirectories=[]` and no write directory contributes one.

Trusted execution view and directory authority SHALL come only from trusted app composition. Model input, client metadata, capability arguments, or request payload SHALL NOT override them. When `path` is absent, Grep SHALL scan every normalized non-overlapping workspace authority root, merge and deduplicate candidate files, and apply one global ordering and capacity budget. When `path` is present, it SHALL be wholly contained by one effective workspace Read target or pass the independent authorization of an explicitly supported special root；known logical roots SHALL remain subordinate to their root access mode。

**需求类别**：功能性需求

#### Scenario: 授权目录被搜索

- **WHEN** `path` 解析为一个已授权 workspace Read directory 或其后代
- **THEN** Grep MUST 只搜索该授权范围
- **AND** 全部返回文件 MUST 保持在该 canonical target 内

#### Scenario: 未授权目录被拒绝

- **WHEN** `path` 既不位于 effective workspace Read directories 内，也未通过显式 special-root authorization
- **THEN** Grep MUST 返回 `CAPABILITY_PATH_REJECTED`
- **AND** 系统 MUST NOT 遍历未授权目录

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：Glob 和 Grep 缺省只搜索 workspace；bare path 是 `workspace/...` 的别名，显式有效 Skill projection 可独立搜索。
- **依据 Requirements**：`文件搜索工具使用 execution view 默认根`、`Glob Uses Agent-Scoped Read Authority`、`Grep Uses Agent-Scoped Read Authority`

### 输入

- **变更类型**：修改
- **目标内容**：省略 `path` 表示 effective workspace Read authority；显式 bare path 映射到 workspace，显式 root-qualified path 服从对应授权。
- **依据 Requirements**：`文件搜索工具使用 execution view 默认根`、`Glob Has A Strict Pattern And Path Contract`、`Grep Has A Strict Pattern And Path Contract`

### 输出

- **变更类型**：修改
- **目标内容**：所有匹配文件路径均返回 root-qualified canonical path。
- **依据 Requirements**：`Glob Has A Strict Pattern And Path Contract`、`Grep Has A Strict Pattern And Path Contract`

### 规格

- **规格项**：默认路径基准
- **变更类型**：修改
- **原规格值**：accepted-run execution view 根
- **目标规格值**：省略 `path` 只搜索 effective workspace Read authority；bare path 映射到 `workspace/`
- **依据 Requirements**：`文件搜索工具使用 execution view 默认根`

- **规格项**：显式 Skill 搜索
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：有效 `.nextagent/skills/...` subtree 可显式搜索且不进入默认搜索
- **依据 Requirements**：`文件搜索工具使用 execution view 默认根`
