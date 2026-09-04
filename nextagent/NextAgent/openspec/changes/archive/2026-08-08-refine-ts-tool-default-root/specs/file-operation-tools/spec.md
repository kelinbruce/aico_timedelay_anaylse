## Function

- **所属 Function**：`FN-5.3 读写编辑文件`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 文件操作工具使用 execution view 默认根

Read、Write 和 Edit MUST 将不带 `workspace/`、`temp/`、`.nextagent/`、`generated-skills/` 或 `shared-data/` root 前缀的相对 `file_path` 从当前 accepted run 的逻辑 execution view 根解释。LOCAL deployment 的逻辑 execution view 根 MUST 映射到当前 scope 的 `scopeBase`；REMOTE/PaaS deployment 的逻辑 execution view 根 MUST 映射到 `/work`。系统 MUST 只返回规范化逻辑路径，不得返回物理 `scopeBase`、scope key 或宿主绝对路径。

当 `file_path` 使用已知 root 前缀时，系统 MUST 按该 root 的既有生命周期和访问权限解释；默认根统一 MUST NOT 扩大 `.nextagent/`、`shared-data/` 或其他只读 root 的写权限。绝对路径、父级穿越、未授权 root 和跨 execution scope 路径 MUST 安全失败且不得产生文件副作用。

**需求类别**：功能性需求

#### Scenario: 无 root 前缀路径与 Bash 指向同一目标
- **GIVEN** Read 与 Bash 使用同一个 accepted run execution view
- **WHEN** Bash 从默认 cwd 创建 `diagnosis.json`，随后 Read 读取 `diagnosis.json`
- **THEN** Read MUST 读取同一个 execution-view-relative 文件
- **AND** 结果 MUST NOT 包含物理 `scopeBase`

#### Scenario: 显式 workspace 路径写入持久化目录
- **WHEN** Write 或 Edit 的 `file_path` 为 `workspace/result.json`
- **THEN** 系统 MUST 将目标解释为当前 execution scope 的 durable `workspace/` root
- **AND** 成功结果 MUST 返回 `workspace/result.json`

#### Scenario: 默认根不扩大受保护目录权限
- **WHEN** Write 或 Edit 以 `.nextagent/skills/private.txt`、`shared-data/private.txt`、绝对路径或包含 `..` 的路径为目标
- **THEN** 系统 MUST 返回安全授权失败
- **AND** 系统 MUST NOT 创建、修改或探测目标内容

### Requirement: workspace 是推荐的持久化写入目录

模型可见的 Read、Write 和 Edit 工具说明 MUST 把 `workspace/` 表达为需要跨 run 保留的用户可见或 session 可见文件的推荐写入目录。工具说明 MUST 同时说明：无 root 前缀路径从 execution view 根解释；`temp/` 用于当前 run 临时文件；推荐语义不得把 `workspace/` 改为强制写入目录，也不得弱化 Agent-scoped 文件 policy。

**需求类别**：功能性需求

#### Scenario: 工具说明区分默认根与持久化目录
- **WHEN** 模型接收 Read、Write 或 Edit descriptor
- **THEN** descriptor MUST 说明无 root 前缀路径从 execution view 根解释
- **AND** descriptor MUST 推荐使用 `workspace/...` 保存需要跨 run 保留的结果

### Requirement: Write Input And Output Are Bounded

Write input SHALL contain exactly required `file_path` and `content` string fields. `file_path` SHALL be execution-view-relative. `content` SHALL be non-empty and its encoded byte length SHALL NOT exceed the Agent-scoped `workspaceFiles.maxTextBytes`.

Successful business output SHALL contain exactly normalized `type="create"|"update"` and normalized execution-view-relative `file_path`. It SHALL NOT contain content, original content, diff, byte count, host path, temporary path, or a `CapabilityInvocationResult` envelope.

**需求类别**：功能性需求

#### Scenario: 空内容或超限内容被拒绝
- **WHEN** `content` 为空或编码后超过 `maxTextBytes`
- **THEN** Write MUST 在产生文件系统副作用前失败
- **AND** 失败结果 MUST NOT 包含内容或宿主路径

### Requirement: Write Uses Trusted Agent-Scoped Directory Authority

Write SHALL accept targets only within the current accepted Agent's compiled `writeDirectories`. Directory authority SHALL come from trusted app composition and SHALL NOT be supplied or expanded by Tool input, model output, client metadata, or capability arguments.

`writeDirectories` SHALL default to empty. Each configured write directory SHALL also be readable. Directory entries SHALL be normalized execution-view-relative directories whose authority includes descendants; `"."` SHALL represent the execution view root. Absolute paths, parent traversal, glob, symlink, junction, reparse-point, or execution-scope-escaping configuration SHALL fail compilation of the affected Agent assembly. A directory authorization that includes a protected logical root SHALL remain subordinate to that root's access mode.

**需求类别**：功能性需求

#### Scenario: 目标位于授权写目录之外
- **WHEN** `file_path` 位于全部 `writeDirectories` 之外
- **THEN** Write MUST 返回安全授权失败
- **AND** Write MUST NOT 访问文件系统目标

#### Scenario: 点目录表示 execution view 根
- **GIVEN** accepted Agent 的 `writeDirectories` 包含 `"."`
- **WHEN** Write 的 `file_path` 为 `notes.txt` 或 `workspace/notes.txt`
- **THEN** 两个 execution-view-relative 目标 MUST 分别按其规范化逻辑路径接受授权检查
- **AND** `.nextagent/...` 与 `shared-data/...` MUST 继续因 root access mode 拒绝写入

### Requirement: Edit Input And Output Are Bounded

Edit input SHALL contain exactly required `file_path`, `old_string`, `new_string` string fields and optional `replace_all` boolean field. `file_path` SHALL be execution-view-relative. `old_string` SHALL be non-empty. `new_string` SHALL NOT equal `old_string`. The edited file content SHALL NOT exceed the Agent-scoped `workspaceFiles.maxTextBytes` after encoding.

Successful business output SHALL contain exactly normalized `type="update"`, normalized execution-view-relative `file_path`, `old_string`, `new_string`, `replaced_count` (integer >= 1), and `replace_all`. It SHALL NOT contain full file content, original content, diff, byte count, host path, temporary path, or a `CapabilityInvocationResult` envelope.

**需求类别**：功能性需求

#### Scenario: 非法 Edit 输入被拒绝
- **WHEN** `file_path` 缺失或为空、`old_string` 缺失或为空、`new_string` 等于 `old_string`，或编辑后内容编码长度超过 `workspaceFiles.maxTextBytes`
- **THEN** Edit MUST 以 `CAPABILITY_INPUT_INVALID` 失败
- **AND** 失败结果 MUST NOT 包含文件内容或宿主路径

### Requirement: Edit Rejects Targets Outside Authorized Write Directories

Edit SHALL accept targets only within the current accepted Agent's compiled execution-view-relative `writeDirectories`. Directory authority SHALL come from trusted app composition and SHALL NOT be supplied or expanded by Tool input. Protected logical root access mode SHALL remain authoritative after directory matching.

**需求类别**：功能性需求

#### Scenario: Edit 目标位于授权写目录之外
- **WHEN** `file_path` 位于全部 `writeDirectories` 之外或位于只读 logical root
- **THEN** Edit MUST 返回安全授权失败
- **AND** Edit MUST NOT 访问文件系统目标

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：提供以 execution view 为统一默认路径基准的文件读取、写入和编辑能力，并推荐把持久化结果写入 `workspace/`。
- **依据 Requirements**：`文件操作工具使用 execution view 默认根`、`workspace 是推荐的持久化写入目录`、`Write Input And Output Are Bounded`、`Write Uses Trusted Agent-Scoped Directory Authority`、`Edit Input And Output Are Bounded`、`Edit Rejects Targets Outside Authorized Write Directories`

### 输入

- **变更类型**：修改
- **目标内容**：文件路径使用规范化 execution-view-relative 语义；无 root 前缀路径从默认根解释，已知 root 前缀保留其生命周期和权限。
- **依据 Requirements**：`文件操作工具使用 execution view 默认根`、`Write Input And Output Are Bounded`、`Write Uses Trusted Agent-Scoped Directory Authority`、`Edit Input And Output Are Bounded`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统先按 execution view 规范化路径，再执行 Agent-scoped directory authority、root access mode 与路径安全校验，最后进行对应文件操作。
- **依据 Requirements**：`文件操作工具使用 execution view 默认根`、`Write Uses Trusted Agent-Scoped Directory Authority`、`Edit Rejects Targets Outside Authorized Write Directories`

### 结果

- **变更类型**：修改
- **目标内容**：成功结果返回逻辑 execution path；持久化产物推荐位于 `workspace/`，非法或越权路径安全失败且不产生副作用。
- **依据 Requirements**：`文件操作工具使用 execution view 默认根`、`workspace 是推荐的持久化写入目录`、`Write Input And Output Are Bounded`、`Edit Input And Output Are Bounded`

### 主规格

- **变更类型**：修改
- **目标内容**：`file-operation-tools`
- **依据 Requirements**：`文件操作工具使用 execution view 默认根`、`Write Uses Trusted Agent-Scoped Directory Authority`

### 遗留规格

- **变更类型**：修改
- **目标内容**：`write-tool` 与 `edit-tool` 保留本次未触及的 Tool-specific Requirements；本次迁移的路径输入与目录授权 Requirements 由主规格承载。
- **依据 Requirements**：`Write Input And Output Are Bounded`、`Write Uses Trusted Agent-Scoped Directory Authority`、`Edit Input And Output Are Bounded`、`Edit Rejects Targets Outside Authorized Write Directories`
