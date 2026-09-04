## Function

- **所属 Function**：`FN-6.3 沙箱执行命令`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Dynamic execution SHALL use deployment-mode-specific sandbox enforcement

`bash`、`python`、Skill script execution 和模型生成代码执行 MUST 经过 sandbox gateway 边界。sandbox MUST 接收由当前已接受运行的 `ExecutionWorkspaceView` 派生的物理文件系统布局，并按以下全部根类型解释访问边界：

- `workspace/`：按持久文件策略读写；
- `.nextagent/`：只读，仅显式授权的脚本资源或 sandbox-owned 临时执行副本允许执行；
- `temp/`：当前运行的可读写临时空间；
- `shared-data/`：仅 LOCAL 模式存在的只读公共输入和显式 Python 脚本路径；REMOTE/PaaS 模式 MUST 不暴露该根，并在运行策略请求该根时 fail closed。

REMOTE/PaaS 模式 MUST 通过容器或 Pod 的 root mapping、只读挂载、cwd 和 deny-by-default 文件系统策略执行访问控制。LOCAL 模式 MUST 保留相同的受信 root layout、cwd、清洗环境、超时、取消、输出限制和入口检查，但 MUST NOT 声明普通本地进程具备强恶意代码文件系统隔离。

LOCAL 模式 MUST NOT 通过修改调用前已存在文件或目录的 POSIX mode、Windows ACL、所有权或只读属性来建立只读边界。系统 MUST NOT 依赖 shell command string 解析作为 REMOTE/PaaS 安全边界；解析和 preflight 只作为入口 guardrail，生产文件系统安全 MUST 来自 sandbox 平台执行。

**需求类别**：功能性需求

#### Scenario: Python 读取 Skill 资源并写入 workspace

- **WHEN** sandboxed Python 命令读取 `.nextagent/skills/<skillProjectionKey>/foo/references/guide.md`
- **AND** 写入 `workspace/analysis.txt`
- **THEN** 两个操作 MUST 使用同一个受信物理 root layout
- **AND** 命令 MUST NOT 获得其他宿主目录的授权

#### Scenario: 本地执行不修改只读根权限

- **WHEN** LOCAL 模式执行引用 Skill projection 或 `shared-data/` 的命令
- **THEN** 系统 MUST 保持这些原始物理根及其既有子项的宿主权限元数据不变
- **AND** 系统 MUST NOT 以 chmod、ACL deny、所有权或只读属性修改模拟只读访问

#### Scenario: PaaS 动态执行由容器隔离

- **WHEN** REMOTE/PaaS 模式执行 Python 或 Bash
- **THEN** 进程 MUST 通过容器或 Pod 文件系统隔离看到 `workspace/`、`.nextagent/` 和 `temp/`
- **AND** `.nextagent/` MUST 由文件系统 enforcement 保持只读
- **AND** 本地宿主 `shared-data/` MUST NOT 暴露

### Requirement: 沙箱执行必须保持宿主权限元数据

系统 MUST 在沙箱命令成功、非零退出、超时、取消、准备失败和并发执行后保持调用前已存在资源的宿主权限元数据不变。原始资源权限不满足请求操作的最小权限时，系统 MUST 返回安全且可诊断的权限失败，除非请求是符合本 Requirement 的 sandbox-owned 临时副本执行。

Python 解释器读取脚本时，系统 MUST 只要求当前执行身份能够读取脚本并遍历父目录，脚本缺少 execute 位 MUST NOT 单独导致失败。必须直接执行的脚本在原文件可读但不可执行时，系统 MUST 在当前运行授权的 sandbox temp 根创建副本，并 MUST 只为该副本设置执行所需权限；原文件及其父目录权限 MUST 保持不变。临时副本无法安全创建、读取或执行时，系统 MUST 返回安全权限失败，MUST NOT 修改原始资源后重试。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复

**适用范围**：该 Function

#### Scenario: 原始权限满足最小条件

- **WHEN** sandbox 请求使用的全部原始资源满足对应读取、写入、执行或目录遍历最小权限
- **THEN** 系统 MUST 直接执行授权操作
- **AND** 执行前后的宿主权限元数据 MUST 完全一致

#### Scenario: workspace 写入权限不足

- **WHEN** sandbox 请求写入 workspace 文件
- **AND** 当前执行身份缺少目标写权限或父目录写入与遍历权限
- **THEN** 系统 MUST 返回不包含宿主绝对路径的安全权限失败
- **AND** 系统 MUST NOT 提高或降低目标及父目录权限

#### Scenario: Python 脚本可读但不可执行

- **WHEN** Python 脚本可读且父目录可遍历
- **AND** 脚本文件不具有 execute 位
- **THEN** 系统 MUST 通过 Python 解释器读取并执行该脚本
- **AND** 系统 MUST NOT 修改脚本权限

#### Scenario: 直接脚本使用临时副本

- **WHEN** 请求必须直接执行一个已授权、可读但不可执行的脚本
- **AND** 当前运行具有可用的 sandbox temp 根
- **THEN** 系统 MUST 执行 sandbox-owned 临时副本
- **AND** 系统 MUST 只为该临时副本设置执行所需权限
- **AND** 原始脚本及其父目录权限 MUST 保持不变

#### Scenario: 命令失败或并发执行后权限不变

- **WHEN** sandbox 命令非零退出、超时、取消、准备失败，或多个命令并发使用同一个授权根
- **THEN** 每个命令完成后原始文件和目录的宿主权限元数据 MUST 与首个命令开始前一致

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统通过沙箱网关执行命令或脚本，在不修改原始宿主权限元数据的前提下控制 root layout、工作目录、环境、超时、取消和输出；权限不足时安全失败或执行 sandbox-owned 临时副本。
- **依据 Requirements**：`Dynamic execution SHALL use deployment-mode-specific sandbox enforcement`、`沙箱执行必须保持宿主权限元数据`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统校验执行所需最小权限；满足时使用原始资源，不满足时返回安全权限失败，只有可读但不可直接执行的授权脚本允许转为 sandbox-owned 临时副本执行。
- **依据 Requirements**：`沙箱执行必须保持宿主权限元数据`

### 结果

- **变更类型**：修改
- **目标内容**：正常和异常执行均保持原始资源权限不变；权限不足时返回安全失败，临时副本执行不改变原始资源。
- **依据 Requirements**：`沙箱执行必须保持宿主权限元数据`

### 主规格

- **变更类型**：修改
- **目标内容**：`sandbox-runtime`
- **依据 Requirements**：`Dynamic execution SHALL use deployment-mode-specific sandbox enforcement`、`沙箱执行必须保持宿主权限元数据`

### 遗留规格

- **变更类型**：修改
- **目标内容**：`sandbox-deny-by-default-adapter`
- **依据 Requirements**：`Dynamic execution SHALL use deployment-mode-specific sandbox enforcement`
