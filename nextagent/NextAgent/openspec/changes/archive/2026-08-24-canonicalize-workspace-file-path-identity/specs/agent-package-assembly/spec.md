## Function

- **所属 Function**：`FN-3.2 编译智能体装配`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Agent 装配编译 root-qualified 文件目录权限

系统 MUST 在 Agent 装配时将 `workspaceFiles.readDirectories` 和 `workspaceFiles.writeDirectories` 编译为 root-qualified canonical directories。`.` MUST 编译为 `workspace`；不带已知 root 前缀的普通目录 MUST 编译为 `workspace/<directory>`；以 `workspace`、`temp`、`.nextagent`、`generated-skills` 或 `shared-data` 开头的目录 MUST 保留对应 root 并完成规范化。workspace 内与已知 root 同名的普通目录 MUST 通过 `workspace/<name>` 显式配置。

`readDirectories` 缺省时，effective Read authority MUST 包含整个 `workspace`；显式空数组 MUST 不授权任何 workspace 目录。`writeDirectories` 缺省时 MUST 保持产品默认 workspace 写权限，显式空数组 MUST 不授权 workspace 写入；每个 write directory MUST 自动加入 effective Read authority。系统 MUST 在发布 `AgentAssembly` 前拒绝绝对路径、父级穿越、glob、链接逃逸或不能映射到受治理逻辑 root 的目录，并 MUST NOT 让 request、模型输出、Tool input 或客户端 metadata 修改编译结果。

**需求类别**：功能性需求

#### Scenario: 普通目录配置编译到 workspace

- **WHEN** Agent 定义配置 `readDirectories=["diagnostics"]` 和 `writeDirectories=["."]`
- **THEN** 编译后的目录 MUST 分别为 `workspace/diagnostics` 和 `workspace`
- **AND** effective Read authority MUST 同时包含这两个 workspace 范围

#### Scenario: 省略与显式空集合保持不同语义

- **WHEN** 两个 Agent 定义分别省略 `readDirectories` 和显式配置 `readDirectories=[]`
- **THEN** 前者 MUST 获得整个 `workspace` 的读取权限
- **AND** 后者 MUST 不获得任何 workspace 读取权限，除非 `writeDirectories` 贡献了对应 workspace 目录

#### Scenario: 缺省与显式空写目录保持兼容语义

- **WHEN** 两个 Agent 定义分别省略 `workspaceFiles` 和显式配置 `writeDirectories=[]`
- **THEN** 前者 MUST 编译产品默认 workspace 写权限
- **AND** 后者 MUST 不获得 workspace 写权限

#### Scenario: 保留显式特殊 root

- **WHEN** Agent 定义配置 `generated-skills/output` 或 `workspace/temp`
- **THEN** 系统 MUST 分别保留为 `generated-skills/output` 和 `workspace/temp`
- **AND** 系统 MUST NOT 将 `workspace/temp` 错误解释为 run-scoped `temp/`

#### Scenario: 非法目录阻断受影响 Agent 装配

- **WHEN** 目录配置包含绝对路径、父级穿越、glob 或逃逸当前 execution scope 的链接
- **THEN** 系统 MUST 在发布受影响 Agent 装配前安全失败
- **AND** 其他 Agent 装配的权限 MUST NOT 被扩大

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：启动期将 Agent 文件目录配置编译为 root-qualified canonical authority；请求路径只使用冻结结果。
- **依据 Requirements**：`Agent 装配编译 root-qualified 文件目录权限`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统区分缺省与显式空集合，规范化全部目录并拒绝非法目录，然后发布不可由请求扩大的装配结果。
- **依据 Requirements**：`Agent 装配编译 root-qualified 文件目录权限`

### 规格

- **规格项**：文件目录规范形式
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`.` 为 `workspace`，普通目录为 `workspace/<directory>`，已知 root 保持 root-qualified
- **依据 Requirements**：`Agent 装配编译 root-qualified 文件目录权限`
