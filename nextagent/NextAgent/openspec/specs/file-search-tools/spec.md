# file-search-tools Specification

## Purpose
定义 `FN-5.4 搜索文件` 的 canonical 黑盒契约：Glob、Grep 在 accepted-run execution view 与 effective Read authority 内执行文件名或内容搜索，返回规范化逻辑路径，并对全部搜索目标应用单一全局排序与容量预算。

## Function

- **所属 Function**：`FN-5.4 搜索文件`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
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

### Requirement: Grep 成功结果显式携带实际输出模式

Grep 的每个成功结果 MUST 包含必填、非空的 `output_mode` 字段。`output_mode` MUST 为 `files_with_matches` 或 `content`，并 MUST 等于本次执行实际采用的输出模式；字段没有 default，结果对象 MUST 拒绝未知字段。零匹配结果 MUST 携带实际 `output_mode`，任何消费方 MUST NOT 根据 `filenames`、`matches`、计数字段或其空值组合推断输出模式。

当 `output_mode="files_with_matches"` 时，`filenames` MUST 包含本次返回的规范化 execution-view-relative 匹配文件路径，`matches` MUST 为空数组。当 `output_mode="content"` 时，`matches` MUST 包含本次返回的内容匹配项，`filenames` MUST 为空数组。两种模式都 MUST 返回非负整数 `total_files_with_matches`、非负整数 `total_matches` 和 boolean `truncated`。

**需求类别**：功能性需求

#### Scenario: 文件模式成功结果自描述模式
- **WHEN** Grep 以 `output_mode="files_with_matches"` 完成搜索
- **THEN** 结果 MUST 携带 `output_mode="files_with_matches"`
- **AND** 结果 MUST 携带 `filenames`、空 `matches`、两个总数和 `truncated`

#### Scenario: 内容模式成功结果自描述模式
- **WHEN** Grep 以 `output_mode="content"` 完成搜索
- **THEN** 结果 MUST 携带 `output_mode="content"`
- **AND** 结果 MUST 携带 `matches`、空 `filenames`、两个总数和 `truncated`

#### Scenario: 零匹配仍保留实际模式
- **GIVEN** Grep 搜索合法完成且没有匹配
- **WHEN** 系统生成成功结果
- **THEN** 结果 MUST 携带本次执行实际采用的 `output_mode`
- **AND** `filenames` 与 `matches` MUST 都为空数组
- **AND** `total_files_with_matches` 与 `total_matches` MUST 都为 `0`
- **AND** 消费方 MUST NOT 把该成功结果解释为失败结果

#### Scenario: 缺少模式的结果不能通过输出校验
- **WHEN** Grep executor 返回缺少 `output_mode`、携带未知模式或同时在非当前模式数组中返回条目的结果
- **THEN** 结果 MUST 以安全的 Capability output validation failure 失败
- **AND** 系统 MUST NOT 把该对象发布为 Grep 成功结果
