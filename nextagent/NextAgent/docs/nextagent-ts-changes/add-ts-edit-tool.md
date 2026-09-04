# add-ts-edit-tool

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Tool

状态：active
类型：实施 change
主要 owner：`agent-capability`
依赖：`add-ts-builtin-tool-framework`、`add-ts-write-tool`

## 目标

- 新增 Edit tool descriptor/schema definition。
- 新增 Edit tool executor handler。
- 对 trusted workspace root 下的 workspace-relative 文件执行**部分编辑**（基于行范围或标记的增量更新），而非全量覆盖。
- 支持原子性编辑操作：要么完全成功，要么回滚到原始状态。

## 与已有 Tool 的边界

| Tool | 边界 | 黑盒效果 |
|------|------|----------|
| **Write tool** | 全量写入：替换整个文件内容 | 用户感知：文件被完全重写 |
| **Edit tool** | 增量编辑：基于行范围/标记替换部分内容 | 用户感知：文件被局部修改，保留未触及部分 |
| **Bash tool** | Shell 命令执行（可调用 sed/awk 等） | 用户感知：执行任意命令，无结构化结果 |

**关键区分**：
- Write tool 适合创建新文件或完全替换内容
- Edit tool 适合修改现有文件的部分内容（如修复 bug、添加功能），保留上下文和未修改部分
- Bash tool 虽然可以通过 sed/awk 实现编辑，但 Edit tool 提供结构化的编辑意图表达和原子性保证

## 非目标

- 不定义通用文本编辑器功能（如交互式编辑）。
- 不定义 workspace 外文件编辑。
- 不定义多文件批量编辑（每个调用只编辑一个文件）。
- 不定义基于语义的智能编辑（如"重构函数"），只提供基于行/标记的精确编辑。

## 黑盒效果

用户通过 Edit tool 可以：
1. 指定文件路径和编辑范围（起始行/结束行，或标记对）
2. 提供替换内容
3. 获得编辑成功/失败的结构化结果

系统保证：
- 编辑操作原子性（成功或完全回滚）
- 编辑范围外的内容保持不变
- 编辑后的文件仍符合 workspace 安全策略
