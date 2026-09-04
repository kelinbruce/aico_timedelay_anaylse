## 背景与问题（Why）

NextAgent 需要一个受治理的内置 `glob` Tool，使电信网络智能体能够在当前 Agent 的可信 workspace 内按文件名模式发现日志、配置、导出结果和诊断材料。

原始 change 使用大写 Tool 名称、测试专用 `deliveryTarget`、直接文件系统执行和 `CapabilityInvocationRequest` 形态。这些约束与当前已归档的 Builtin Tool framework、Agent capability binding、可信 workspace 和受控 Tool dependency 架构冲突。

Glob 是只读能力，不执行动态代码，也不需要 sandbox；但它仍必须遵守 Agent-scoped Read authority、Owner/Agent scope 固化、取消、有界容量、安全错误和可观测性约束。

## 变更范围（What Changes）

- **新增** 小写 `glob` Builtin Tool，通过 `defineTool` 和 owned builtin Tool list 显式注册。
- **扩展** 现有 `workspaceFiles` 受控 dependency，增加 Agent-scoped 文件发现操作；Glob Tool 不直接接触宿主文件系统。
- **定义** 与 TonyClaw 一致的模型输入：必填 `pattern` 和可选 `path`。
- **定义** workspace-relative 模式、Read authority、链接/特殊文件、隐藏文件和确定性结果语义。
- **定义** 最大 10 层目录深度、500 个返回结果和 20000 个已检查条目的硬边界。
- **明确** Glob 沿用既有 builtin Tool 默认启用策略、可信 Agent binding 显式禁用和 provider governance，不新增测试/商用 delivery contract。

## Capability 影响（Capabilities）

### 新增 Capability

- `glob-tool`：可信 workspace 内的受治理文件名模式发现能力。

### 修改 Capability

- `builtin-tool-framework`：扩展 `workspaceFiles` dependency，使 Read、Write 和 Glob 共享同一个受控文件系统边界。

## 依赖关系

- 依赖已归档的 Builtin Tool framework 和可信 Agent workspace 架构。
- 与当前分支的 `add-ts-write-tool` 共同扩展同一个 `workspaceFiles` dependency；不得创建第二套 filesystem port、workspace root 或目录授权模型。

## 非目标（Non-Goals）

- 不新增 `deliveryTarget`、测试专用 Tool catalog、商业交付模式或 Tool alias。
- 不实现文件内容搜索、正则表达式搜索、Grep、Find、Read、Write、Edit 或动态命令执行。
- 不读取或服从 `.gitignore`、`.ignore` 等仓库忽略文件。
- 不允许模型提供宿主绝对路径、workspace root、Read authority、深度上限、扫描预算或返回上限。
- 不跟随 symlink、junction 或 reparse point，不搜索 workspace 外路径。
- 不在日志、metric、trace、audit、SafeError 或 result metadata 中记录 pattern、文件名、目录或宿主路径。
