# FN-5.4 搜索文件

> 能力域 D5 Capability 能力体系 · 子域 [D5.2 内置工具](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-5.2](../../../features/D5-Capability能力体系/D5.2-内置工具/F-5.2-文件操作工具.md) |
| 主规格 | [file-search-tools](../../../../specs/file-search-tools/spec.md) |
| 遗留规格 | [glob-tool](../../../../specs/glob-tool/spec.md)、[grep-tool](../../../../specs/grep-tool/spec.md)、[builtin-tool-framework](../../../../specs/builtin-tool-framework/spec.md) |
| 接口 | 能力调用端口（工具） |

## 描述

提供文件名匹配（Glob）和文件内容搜索（Grep）工具。Glob 和 Grep 缺省只搜索 workspace；bare path 是 `workspace/...` 的别名，显式有效 Skill projection 可独立搜索，并在同一个全局排序与容量预算下覆盖 effective Read authority。

## 前置条件

- 搜索范围完全位于当前 accepted Agent 获得授权的 execution view 范围内。
- 默认搜索不隐式纳入系统管理目录、共享只读目录、其他 run 临时目录、scope 外路径或链接目标。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 搜索类型 | 是 | 文件名匹配或内容搜索 |
| 模式/关键词 | 是 | glob 模式或 grep 关键词 |
| 搜索路径 | 否 | execution-view-relative 限定路径；省略 `path` 表示 effective workspace Read authority；显式 bare path 映射到 `workspace/`，显式 root-qualified path 服从对应授权 |

## 输出

返回带 root-qualified canonical path 的文件列表或内容匹配结果，不返回输入别名、物理执行根或宿主绝对路径。Grep 成功结果显式携带实际 `output_mode`，合法零匹配也不依赖数组形状推断模式。

## 处理过程

1. 系统将缺省或显式路径解释为 execution-view-relative 搜索范围；bare path 映射到 `workspace/`。
2. 系统校验全部搜索目标均位于当前 Agent 的有效读取权限内，并排除未授权目录和链接目标。
3. 系统在一个全局排序、去重与容量预算下返回 root-qualified canonical path。
4. 显式有效 `.nextagent/skills/...` subtree 可显式搜索且不进入默认搜索。

## 结果

- 正常：返回 root-qualified canonical path 匹配结果；Grep 的模式、模式专属集合和总数保持一致。
- 无匹配：返回空集合、零计数及 Grep 实际输出模式。
- 未授权显式路径：安全失败且不遍历目标。

## 规格

| 规格项 | 规格值 | 来源 |
|---|---|---|
| 默认路径基准 | 省略 `path` 只搜索 effective workspace Read authority；bare path 映射到 `workspace/` | `文件搜索工具使用 execution view 默认根` |
| 搜索预算 | 全部有效搜索范围共享单一全局排序与容量预算 | `Glob Uses Agent-Scoped Read Authority`、`Grep Uses Agent-Scoped Read Authority` |
| Grep 成功结果输出模式 | 必填 `output_mode`，精确取值为 `files_with_matches`、`content` | `Grep 成功结果显式携带实际输出模式` |
| Skill 资源搜索 | 有效 `.nextagent/skills/...` subtree 可显式搜索且不进入默认搜索 | `文件搜索工具使用 execution view 默认根` |
