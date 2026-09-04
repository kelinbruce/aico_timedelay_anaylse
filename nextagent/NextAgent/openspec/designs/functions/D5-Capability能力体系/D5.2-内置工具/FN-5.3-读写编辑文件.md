# FN-5.3 读写编辑文件

> 能力域 D5 Capability 能力体系 · 子域 [D5.2 内置工具](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-5.2](../../../features/D5-Capability能力体系/D5.2-内置工具/F-5.2-文件操作工具.md) |
| 主规格 | [file-operation-tools](../../../../specs/file-operation-tools/spec.md) |
| 遗留规格 | [builtin-tool-framework](../../../../specs/builtin-tool-framework/spec.md)、[write-tool](../../../../specs/write-tool/spec.md)、[edit-tool](../../../../specs/edit-tool/spec.md) |
| 接口 | 能力调用端口（工具） |

## 描述

提供文件读取、写入和编辑工具，通过受治理的 accepted-run execution view 访问文件。Read、Write 和 Edit 通过统一 workspace 默认路径访问普通任务文件，输出 root-qualified canonical path，并通过显式受治理路径读取 Skill 资源。

## 前置条件

- 目标文件是当前 accepted Agent 获得授权的 execution view 范围内的单文件路径。
- 目标路径符合相应 logical root 的读写权限与路径安全约束。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 文件路径 | 是 | 规范化 execution-view-relative 路径；bare workspace path（无 `workspace/`、`temp/`、`.nextagent/`、`generated-skills/`、`shared-data/` 前缀）是对应 `workspace/...` 的输入别名，其他已知 root 必须显式限定并服从各自权限 |
| 操作类型 | 是 | 读取、写入或编辑 |
| 内容/编辑参数 | 否 | 写入或编辑的内容 |

## 输出

读取返回有界内容页、规范化逻辑 execution path、effective 分页坐标、截断事实和可选 continuation；写入/编辑返回包含规范化逻辑 execution path 的操作结果。成功结果只返回 root-qualified canonical path，不返回输入别名或物理路径，也不返回物理 `scopeBase` 或宿主绝对路径。

## 处理过程

1. 系统将输入规范化为 execution-view-relative 路径并识别显式 logical root；bare workspace path 与对应 `workspace/...` 解析为同一个物理文件和同一个 canonical file identity。
2. 系统校验可信 scope、logical root access mode、workspace policy 和分页参数。
3. Read 从 0-based offset 开始，单次最多返回 2000 行；仍有内容时显式返回下一起始行。
4. 系统执行读取、写入或编辑，结果受统一 Capability 容量约束且只返回 root-qualified canonical path。
5. 显式有效 `.nextagent/skills/...` 路径独立于 workspace `readDirectories` 可读，保持只读和 scope 隔离。
6. 非法路径、参数、权限、timeout 和 abort 保持真实安全语义。

## 结果

- 正常：操作成功；bare workspace path 与显式 `workspace/...` 指向同一目标并返回同一 canonical path。
- 持久化：需要跨 run 保留的结果显式使用 `workspace/...`。
- 非法、越权、缺失或超限目标：安全失败且不产生越权副作用。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| Read 单次分页范围 | offset 从 0 开始且缺省为 0；单次最多 2000 行且缺省 2000；仍有后续内容时显式返回截断事实和下一起始行 | `file-operation-tools`：`Read Tool 只读取受控工作区内的有界文件页` |
| 默认路径基准 | bare workspace path 默认映射到 `workspace/`，并与显式 `workspace/...` 共享 canonical file identity | `file-operation-tools`：`文件操作工具使用 execution view 默认根` |
| 持久化推荐目录 | `workspace/` | `file-operation-tools`：`workspace 是推荐的持久化写入目录` |
| Skill 资源访问 | 显式有效 `.nextagent/skills/...` 路径独立于 workspace `readDirectories` 可读，且保持只读和 scope 隔离 | `file-operation-tools`：`显式 Skill resource 读取独立于 workspace 目录权限` |
