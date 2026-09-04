## 背景与问题（Why）

NextAgent 在已治理的 `glob` Tool 之外，还需要一个受治理的内置 `grep` Tool，使电信网络智能体能够在可信 workspace 内按正则模式定位包含特定字符串、关键字、告警码或调用栈片段的日志、配置和导出结果。

Glob 只能按文件名模式匹配，不能跨文件内容发现，原始 change 已明确把内容搜索、正则表达式搜索、Grep、Find 列为非目标。Glob spec 在 D5 也明确 Glob 不得调用 ripgrep 或宿主 shell 命令，因此 Grep 必须独立成 Tool，但仍沿用 `glob` 已确立的 builtin Tool 框架、Agent-scoped Read authority、受控 workspaceFiles 边界、低基数可观测性和安全失败语义。

Grep 是只读能力，不执行动态代码，也不需要 sandbox；与 Glob 共享同一个 Agent-scoped 依赖、authority、目录授权和决定性结果形态。

## 变更范围（What Changes）

- **新增** PascalCase `Grep` Builtin Tool，通过 `defineTool` 和 owned builtin Tool list 显式注册。
- **扩展** 现有 `workspaceFiles` 受控 dependency，增加 Agent-scoped 文件内容搜索操作；Grep Tool 不直接接触宿主文件系统、不执行宿主命令、不调用 ripgrep、不走 sandbox。
- **定义** 与 TonyClaw 一致的模型输入：必填 `pattern` 和可选 `path`、`glob_filter`、`output_mode`、`case_insensitive`、`max_results`。
- **定义** workspace-relative 搜索路径、Read authority、链接/特殊文件、隐藏文件、二进制文件和决定性结果语义。
- **定义** 每文件读取与匹配上限、返回匹配数上限、已检查条目上限、已读取字节上限等硬边界。
- **明确** Grep 沿用既有 builtin Tool 默认启用策略、可信 Agent binding 显式禁用和 provider governance，不新增 delivery contract、shell 执行或 ripgrep 包装。

## Capability 影响（Capabilities）

### 新增 Capability

- `grep-tool`：可信 workspace 内的受治理文件内容正则搜索能力。

### 修改 Capability

- `builtin-tool-framework`：扩展 `workspaceFiles` dependency，使 Read、Write、Glob 和 Grep 共享同一个受控文件系统边界。

## 依赖关系

- 依赖已归档的 Builtin Tool framework、可信 Agent workspace、`glob-tool` 规范和 `add-ts-glob-tool` 已合并的 `workspaceFiles.globFiles` 操作。
- 与 `glob-tool` 共同扩展同一个 `workspaceFiles` dependency；不得创建第二套 filesystem port、workspace root、目录授权模型、ripgrep 包装或 host shell 调用路径。

## 非目标（Non-Goals）

- 不新增 `deliveryTarget`、测试专用 Tool catalog、商业交付模式、Tool alias 或并行 invocation contract。
- 不实现 `find`、动态命令执行、ripgrep 包装、宿主 shell 调用、外部进程或 sandbox 路由。
- 不读取或服从 `.gitignore`、`.ignore` 等仓库忽略文件。
- 不允许模型提供宿主绝对路径、workspace root、Read authority、深度上限、扫描预算、返回上限、单文件读取上限或已读取字节上限。
- 不跟随 symlink、junction 或 reparse point，不搜索 workspace 外路径，不读取目录、device、socket、FIFO 等非普通文件。
- 不在日志、metric、trace、audit、SafeError 或 result metadata 中记录 pattern、文件内容、文件名、目录或宿主路径。
- 不在 `files_with_matches` 模式下读取匹配行的内容；不在 `content` 模式下输出整篇文件。
