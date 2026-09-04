## Function

- **所属 Function**：`FN-5.3 读写编辑文件`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 显式 Skill resource 读取独立于 workspace 目录权限

Read MUST 允许使用显式 `.nextagent/skills/<skillProjectionKey>/<skill-name>/...` 路径读取当前 execution scope 内身份与完整性有效的 committed Skill projection 文件。该权限 MUST 独立于 workspace `readDirectories`，包括 `readDirectories` 缺省、显式为空或仅覆盖部分 workspace 的情况；Read MUST 同时校验 Skill projection scope authority、目标普通文件、只读 root 和路径安全约束。系统 MUST NOT 因该例外允许读取 `.nextagent/` 管理根、未提交或无效 projection、其他 execution scope projection 或未授权 subtree。

**需求类别**：功能性需求

#### Scenario: 空 workspace 读权限仍可读取已验证 Skill 资源

- **GIVEN** accepted Agent 的 `readDirectories=[]`
- **AND** 当前 execution scope 存在有效 committed Skill projection
- **WHEN** Read 使用激活消息提供的精确 `.nextagent/skills/.../references/guide.md` 路径
- **THEN** Read MUST 返回该有界文件页
- **AND** 返回的 `file_path` MUST 保持该 root-qualified canonical path

#### Scenario: Skill 读取例外不扩大系统目录

- **WHEN** Read 指向 `.nextagent/` 管理根、未验证 projection 或其他 execution scope 的 projection
- **THEN** Read MUST 在读取内容前返回安全授权失败
- **AND** 结果 MUST NOT 泄漏目标是否存在或其内容

## MODIFIED Requirements

### Requirement: 文件操作工具使用 execution view 默认根

Read、Write 和 Edit MUST 将不带 `workspace/`、`temp/`、`.nextagent/`、`generated-skills/` 或 `shared-data/` root 前缀的 bare workspace `file_path` 解释为 `workspace/` 下的路径。`src/alarm.ts`、`./src/alarm.ts` 和 `workspace/src/alarm.ts` MUST 解析为同一个物理目标和 canonical file identity `workspace/src/alarm.ts`；成功结果、文件快照、缓存键和同目标并发控制 MUST 使用该 canonical file identity。workspace 中与已知 root 同名的普通目录 MUST 使用 `workspace/<name>/...` 显式表达。

当 `file_path` 使用其他已知 root 前缀时，系统 MUST 按该 root 的既有生命周期和访问权限解释。默认 workspace 映射 MUST NOT 扩大 `.nextagent/`、`shared-data/` 或其他只读 root 的写权限。绝对路径、父级穿越、未授权 root 和跨 execution scope 路径 MUST 安全失败且不得产生文件副作用。系统 MUST 只返回 root-qualified canonical path，不得返回物理 `scopeBase`、scope key、`/work` 或宿主绝对路径。

**需求类别**：功能性需求

#### Scenario: bare path 与显式 workspace path 指向同一文件

- **WHEN** Write 使用 `diagnosis.json` 创建文件，随后 Read 使用 `workspace/diagnosis.json` 读取
- **THEN** 两次操作 MUST 指向同一个 workspace 文件
- **AND** 两次成功结果的 `file_path` MUST 均为 `workspace/diagnosis.json`

#### Scenario: 无 root 前缀路径与 Bash 指向同一目标

- **WHEN** Bash 从其既有 default cwd 创建 `diagnosis.json`，随后 Read 使用 bare `diagnosis.json`
- **THEN** Read MUST 将输入解释为 `workspace/diagnosis.json`
- **AND** 系统 MUST NOT 承诺 Bash default cwd 中的 bare target 与文件工具 workspace target 是同一个物理文件

#### Scenario: 显式 workspace 路径写入持久化目录

- **WHEN** Write 或 Edit 的 `file_path` 为 `workspace/result.json`
- **THEN** 系统 MUST 将目标解释为当前 execution scope 的 durable `workspace/` root
- **AND** 成功结果 MUST 返回 `workspace/result.json`

#### Scenario: 路径别名共享快照身份

- **WHEN** Read 使用 `./src/a.ts` 建立文件快照，随后 Edit 使用 `workspace/src/a.ts` 修改同一文件
- **THEN** Edit MUST 使用同一个 canonical file identity 执行既有快照一致性校验
- **AND** 系统 MUST NOT 为两个输入别名建立独立快照事实

#### Scenario: workspace 中的保留名称必须显式限定

- **WHEN** Write 分别使用 `temp/result.txt` 和 `workspace/temp/result.txt`
- **THEN** 前者 MUST 按 run-scoped `temp/` root 的既有授权解释
- **AND** 后者 MUST 按 workspace 内的 `temp` 子目录解释

#### Scenario: 默认根不扩大受保护目录权限

- **WHEN** Write 或 Edit 以 `.nextagent/skills/private.txt`、`shared-data/private.txt`、绝对路径或包含 `..` 的路径为目标
- **THEN** 系统 MUST 返回安全授权失败
- **AND** 系统 MUST NOT 创建、修改或探测目标内容

### Requirement: workspace 是推荐的持久化写入目录

模型可见的 Read、Write 和 Edit 工具说明 MUST 将 bare workspace path 说明为 `workspace/` 下普通任务文件的输入别名，并说明成功结果返回 `workspace/...` canonical path。工具说明 MUST 表达 `workspace/` 是跨 run 保留的用户可见或 session 可见文件根；`temp/` 用于当前 run 临时文件；`.nextagent/skills/...` 只用于显式读取已验证 Skill 资源。上述说明 MUST NOT 弱化 Agent-scoped 文件 policy 或受保护 root 的访问模式。

**需求类别**：功能性需求

#### Scenario: 工具说明区分默认根与持久化目录

- **WHEN** 模型接收 Read、Write 或 Edit descriptor
- **THEN** descriptor MUST 说明 bare workspace path 默认映射到 `workspace/`
- **AND** descriptor MUST 说明成功结果返回 root-qualified canonical path
- **AND** descriptor MUST 区分 workspace 持久文件、temp 临时文件和显式 Skill 资源

### Requirement: Write Uses Trusted Agent-Scoped Directory Authority

Write SHALL accept workspace targets only within the current accepted Agent's compiled `writeDirectories`. Directory authority SHALL come from trusted app composition and SHALL NOT be supplied or expanded by Tool input, model output, client metadata, or capability arguments.

Write SHALL treat the accepted Agent assembly's compiled `writeDirectories` as authoritative；显式 `writeDirectories=[]` SHALL 不授予 workspace 写权限，Agent authoring 省略该字段时 SHALL 使用 `agent-package-assembly` 定义的产品缺省。Each configured write directory SHALL also be readable. Directory entries SHALL be root-qualified canonical directories whose authority includes descendants；`.` SHALL compile to `workspace`，普通无前缀目录 SHALL compile to `workspace/<directory>`。一个目录授权包含受保护逻辑 root 时 SHALL 继续服从该 root 的访问模式。绝对路径、父级穿越、glob、symlink、junction、reparse-point 或 execution-scope-escaping configuration SHALL fail compilation of the affected Agent assembly。

**需求类别**：功能性需求

#### Scenario: 目标位于授权写目录之外

- **WHEN** `file_path` 位于全部 `writeDirectories` 之外
- **THEN** Write MUST 返回安全授权失败
- **AND** Write MUST NOT 访问文件系统目标

#### Scenario: 点目录表示 execution view 根

- **GIVEN** accepted Agent 的 `writeDirectories` 配置包含 `.` 并已编译为 `workspace`
- **WHEN** Write 的 `file_path` 为 `notes.txt` 或 `workspace/notes.txt`
- **THEN** 两个输入 MUST 通过同一个 `workspace/notes.txt` canonical target 接受授权检查
- **AND** `.nextagent/...`、`temp/...`、`generated-skills/...` 与 `shared-data/...` MUST NOT 因该 workspace 授权获得写权限

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：Read、Write 和 Edit 通过统一 workspace 默认路径访问普通任务文件，输出 root-qualified canonical path，并通过显式受治理路径读取 Skill 资源。
- **依据 Requirements**：`文件操作工具使用 execution view 默认根`、`workspace 是推荐的持久化写入目录`、`显式 Skill resource 读取独立于 workspace 目录权限`

### 输入

- **变更类型**：修改
- **目标内容**：普通无前缀文件路径是对应 `workspace/...` 的输入别名；其他已知 root 必须显式限定并服从各自权限。
- **依据 Requirements**：`文件操作工具使用 execution view 默认根`、`Write Uses Trusted Agent-Scoped Directory Authority`

### 输出

- **变更类型**：修改
- **目标内容**：成功结果只返回 root-qualified canonical path，不返回输入别名或物理路径。
- **依据 Requirements**：`文件操作工具使用 execution view 默认根`、`显式 Skill resource 读取独立于 workspace 目录权限`

### 规格

- **规格项**：默认路径基准
- **变更类型**：修改
- **原规格值**：accepted-run execution view 根
- **目标规格值**：bare workspace path 默认映射到 `workspace/`，并与显式 `workspace/...` 共享 canonical file identity
- **依据 Requirements**：`文件操作工具使用 execution view 默认根`

- **规格项**：Skill 资源访问
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：显式有效 `.nextagent/skills/...` 路径独立于 workspace `readDirectories` 可读，且保持只读和 scope 隔离
- **依据 Requirements**：`显式 Skill resource 读取独立于 workspace 目录权限`
