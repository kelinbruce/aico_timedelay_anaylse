## ADDED Requirements

### Requirement: Workspace File 权限是可信且 Agent-Scoped 的

可信的 SDK/Agent 配置 MAY 定义 `workspaceFiles.readDirectories`、`workspaceFiles.writeDirectories` 和 `workspaceFiles.maxTextBytes`。App composition SHALL 校验这些值并把它们编译为关联到已受理 Agent assembly/version 的 Agent-scoped workspace 文件依赖。

`readDirectories` 在缺失时 SHALL 保持既有的整个 workspace 默认。`writeDirectories` 对未显式配置的 Agent 定义 SHALL 默认为空，并 SHALL 被纳入有效 Read 权限。内置 `default-agent` 定义 SHALL 显式配置 `writeDirectories=["."]`，只在该 Agent 的可信 workspace 之内授予写权限。`maxTextBytes` SHALL 默认为 `256000`，SHALL 具有 `256000` 的系统硬上限，MAY 只被配置调小。

无效的目录条目、无效的数值，或逃逸出已校验 workspace 的权限 SHALL 使受影响 Agent assembly 的编译失败，而不改变其他 Agent assembly。

#### Scenario: 模型输入不能扩展 workspace 权限

- **WHEN** 请求、模型输出、Tool 输入、capability metadata 或客户端 payload 包含目录或大小权限
- **THEN** app composition 和 workspace 文件依赖 MUST 把它作为授权输入忽略
- **AND** 只有已编译的可信 Agent-scoped 配置可以决定有效文件权限

#### Scenario: 内置 default Agent 获得显式写权限

- **WHEN** app composition 加载内置 `default-agent` 定义
- **THEN** 其编译后的 `writeDirectories` MUST 只包含 workspace root `"."`
- **AND** 该权限 MUST 保持限定在该已受理 Agent assembly 的已解析 workspace 内
