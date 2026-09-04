## Why

Agent 在同一个 accepted run 中组合文件工具与可执行工具时，当前相对路径存在两个默认解释：Bash、Python 从 execution view 根解释，而 Read、Write、Edit、Glob、Grep 从 `workspace/` 解释。同一个 `result.json` 因工具不同指向不同文件，导致电信诊断脚本生成的中间结果无法被后续文件工具稳定读取，也使模型必须猜测何时补写 `workspace/` 前缀。

系统需要统一工具可观察的默认路径基准，使同一逻辑相对路径在文件工具与可执行工具间保持一致，同时继续明确 `workspace/` 是跨 run 保留结果的推荐写入目录。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 所有 root-aware builtin tools 将不带已知 root 前缀的相对路径解释为 execution view 根下的路径；LOCAL 与 REMOTE/PaaS 对外使用同一逻辑路径语义。
- Read、Write、Edit、Glob、Grep 与 Bash、Python 对同一相对路径形成一致的可观察目标。
- `workspace/` 继续作为持久化文件的推荐写入目录；`temp/`、`.nextagent/`、`generated-skills/` 和 `shared-data/` 继续遵守各自既有生命周期与读写权限。
- 绝对路径、父级穿越、未授权 Skill projection、只读 root 写入和跨 execution scope 访问继续安全失败。

**非目标：**

- 不把物理 `scopeBase`、宿主路径或 scope key 暴露给模型、Tool 结果、safe error、日志或公共 API。
- 不改变 `workspace/`、`temp/`、`.nextagent/`、`generated-skills/` 或 `shared-data/` 的生命周期和权限。
- 不新增路径配置项、public contract 字段、兼容 alias 或第二套文件访问实现。
- 不修改附件 intake、Skill source、sandbox 隔离强度或持久化 owner。

## What Changes

- **BREAKING**：Read、Write、Edit、Glob、Grep 的无 root 前缀相对路径不再隐式指向 `workspace/`，而是从 execution view 根解释。
- 文件工具显式接受 `workspace/...` 作为持久化目标，并在模型可见说明中推荐把需要跨 run 保留的文件写入该目录。
- 文件工具继续通过同一受治理路径边界解析目标；已知 root 的权限优先于默认根，默认根统一不得扩大 `.nextagent/`、`shared-data/` 或其他只读 root 的写权限。
- 文件搜索结果和文件操作结果继续返回逻辑 execution paths，不返回物理 `scopeBase`。

## Feature 影响（Features）

### 修改的 Feature

- `F-5.2 文件操作工具`：文件操作与文件搜索工具采用同一个 execution view 默认路径基准，并明确 `workspace/` 的持久化推荐语义。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-5.3 读写编辑文件` → `specs/file-operation-tools/spec.md`
  - 功能边界：Read、Write、Edit 对无 root 前缀相对路径采用 execution view 根；显式 `workspace/...` 表示推荐的持久化文件目标。
  - 系统质量属性：安全、可维护性、可测试性。
  - 映射说明：为既有 Function 建立 canonical spec；本次触及的 legacy specs 为 `write-tool` 与 `edit-tool`。
- `FN-5.4 搜索文件` → `specs/file-search-tools/spec.md`
  - 功能边界：Glob、Grep 的默认搜索路径和相对结果统一使用 execution view 根语义。
  - 系统质量属性：安全、可维护性、可测试性。
  - 映射说明：为既有 Function 建立 canonical spec；本次触及的 legacy specs 为 `builtin-tool-framework`、`glob-tool` 与 `grep-tool`。

## 影响范围（Impact）

- Agent 开发者需要为必须跨 run 保留的产物显式使用 `workspace/...`；依赖文件工具隐式补齐 `workspace/` 的 prompt、Skill 示例或测试需要同步调整。
- 不改变 Web API、stream event、gateway request、runtime command 或 `agent-contracts` 字段。
- 受影响实现集中在 builtin 文件工具共享路径解释与模型可见工具说明；受影响验证集中在文件操作、文件搜索、execution workspace 和跨工具路径一致性测试。
