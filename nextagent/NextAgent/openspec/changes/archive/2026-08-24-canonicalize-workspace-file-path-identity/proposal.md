## Why

电信网络智能体在执行 Skill 时，通常先读取 Skill 自带的参考资料或脚本，再读取、生成和搜索本次任务的工作文件。当前文件工具把裸相对路径解释到 execution view 根，而 `workspace/...` 指向单独的持久化根；同一业务文件因此可能因为是否带 `workspace/` 前缀而形成两个目标、两份快照或不同的授权判断。Glob/Grep 省略 `path` 时还会按配置遍历多个授权根，模型难以判断默认搜索边界，运维人员也难以从工具结果确认实际访问的是哪个文件。

现有 Skill 资源已通过受治理的 `.nextagent/skills/...` 投影提供精确逻辑路径。现在需要把普通工作文件的默认路径、配置授权和结果路径统一到 `workspace/`，同时保持 Skill 资源的显式访问能力和既有只读边界，避免后续只改工具描述却与运行行为不一致。

本 change 使用以下术语：

- **canonical file identity**：文件工具用于结果、快照、缓存和并发控制的唯一逻辑文件身份；普通工作文件一律使用 `workspace/...`。
- **bare workspace path**：不以 `workspace/`、`temp/`、`.nextagent/`、`generated-skills/` 或 `shared-data/` 开头的相对路径，例如 `src/alarm.ts`；它是对应 `workspace/src/alarm.ts` 的输入别名，不形成第二个文件身份。
- **root-qualified path**：显式包含上述已知逻辑 root 的路径。workspace 中与已知 root 同名的目录必须写成 `workspace/<name>/...`。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- Read、Write、Edit、Glob 和 Grep 将 bare workspace path 与对应的 `workspace/...` 路径解析为同一个物理文件和同一个 canonical file identity。
- 文件工具成功结果只返回 root-qualified canonical path，使调用方能够稳定复用结果路径。
- Glob/Grep 省略 `path` 时只搜索当前 Agent 获得读取授权的 workspace 范围，不隐式扫描 Skill、临时、共享或系统管理 root。
- `readDirectories` 和 `writeDirectories` 在 Agent 装配时编译为 root-qualified canonical directories；普通无前缀配置继续表示 workspace 内目录，既有缺省写权限保持不变。
- 已验证的 Skill projection 继续通过显式 `.nextagent/skills/...` 路径读取和搜索，其权限不依赖 workspace `readDirectories`，并继续受 projection scope authority、完整性和只读规则约束。
- 路径逃逸、绝对路径、未授权目录和受保护 root 写入继续在产生文件副作用或内容泄漏前失败。

**非目标：**

- 不改变 Bash、Python 或其他 sandbox 命令的默认 cwd、命令文本或脚本源码路径解释。
- 不让 Skill body 中的相对资源路径自动依赖“当前 Skill”；Skill 仍使用激活消息注入的精确 resource root。
- 不新增公共 `agent-contracts` 字段，不改变 execution workspace root 的物理布局、生命周期或 Owner Scope/Agent Scope。
- 不为旧版本写在 execution view 根下、workspace 外的普通文件提供隐式回退；需要保留的文件由部署或使用方显式迁入 `workspace/`。
- 不改变 `writeDirectories` 缺省时采用产品默认 workspace 写权限、显式 `[]` 禁用写入的既有兼容语义。
- `temp/`、`generated-skills/` 和 `shared-data/` 不再因 `.` 获得隐式目录权限；需要文件工具访问时必须显式配置对应 root-qualified directory，并继续服从该 root 的专用访问模式。已验证 Skill projection 是唯一独立于目录列表的读取例外。

## What Changes

- **BREAKING** Read、Write、Edit、Glob 和 Grep 的 bare workspace path 从 execution view 根改为 `workspace/`，并与显式 `workspace/...` 共享 canonical file identity。
- **BREAKING** 文件工具成功结果中的普通工作文件路径统一返回 `workspace/...`，不再返回无 root 前缀路径。
- **BREAKING** Glob/Grep 省略 `path` 时只搜索 effective workspace Read authority；其他逻辑 root 只能通过显式、已授权的 root-qualified path 搜索。
- Agent 装配将 `readDirectories`、`writeDirectories` 中的 `.` 编译为 `workspace`，将普通无前缀目录编译到 `workspace/...`，并保留已知 root 前缀。写目录仍自动加入有效读权限。
- 显式 Skill resource 读取与搜索独立校验 committed projection authority，不因 `readDirectories` 缺省、为空或仅授权 workspace 而被错误拒绝，也不进入默认搜索。

## Feature 影响（Features）

### 修改的 Feature

- `F-3.1 装配智能体`：Agent 文件目录策略的编译结果改为 root-qualified canonical directories，供运行时稳定执行同一授权语义。
- `F-5.2 文件操作工具`：普通文件的默认位置和返回身份统一为 `workspace/...`，默认搜索边界变为 workspace，同时保留显式 Skill 资源访问。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-3.2 编译智能体装配` → `specs/agent-package-assembly/spec.md`
  - 功能边界：将 Agent 定义中的文件目录策略编译为唯一的 root-qualified canonical authority，并冻结缺省与显式空集合语义。
  - 系统质量属性：安全、可维护性、可测试性。
  - 映射说明：canonical spec。
- `FN-5.3 读写编辑文件` → `specs/file-operation-tools/spec.md`
  - 功能边界：统一 bare workspace path、显式 workspace path、返回路径、快照身份和目录授权判断；保持显式 Skill resource 的受治理读取。
  - 系统质量属性：安全、可靠性/恢复、可测试性。
  - 映射说明：canonical spec；本 change 不触及其 legacy specs。
- `FN-5.4 搜索文件` → `specs/file-search-tools/spec.md`
  - 功能边界：将缺省搜索限制在 workspace，并将显式路径统一到 root-qualified canonical path；显式 Skill projection 搜索继续受独立权限校验。
  - 系统质量属性：安全、性能/容量、可测试性。
  - 映射说明：canonical spec；本 change 不触及其 legacy specs。

## 影响范围（Impact）

- Agent 开发者：现有 `.` 和普通无前缀目录配置继续可写，但编译后的含义明确为 workspace；依赖 execution view 根普通文件的配置和用例需要迁移。
- Skill 作者：激活消息中的 `.nextagent/skills/...` 精确资源路径继续有效；省略 Glob/Grep `path` 将不再找到 Skill 文件，搜索 Skill 时必须显式传入资源 root。
- 运维与平台集成：旧版本遗留在 scopeBase 根部的普通文件不会被新文件工具隐式读取；升级前需评估是否迁入 `workspace/`。
- 公共输入字段形状不变；普通文件的路径解释和成功结果值发生兼容性变化。
- 受影响验证包括目录策略编译、路径别名、快照与并发身份、默认搜索边界、Skill projection 正负授权以及本地/远端逻辑路径一致性。
