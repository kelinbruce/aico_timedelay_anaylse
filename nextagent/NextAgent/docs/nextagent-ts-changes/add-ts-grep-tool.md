# add-ts-grep-tool

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Tool

状态：active
类型：实施 change
主要 owner：`agent-capability`
依赖：`add-ts-builtin-tool-framework`

## 目标

- 新增 Grep tool descriptor/schema definition。
- 新增 Grep tool executor handler。
- 在 trusted workspace root 下的文件中**搜索文本内容或正则表达式模式**，返回匹配的行和上下文。

## 与已有 Tool 的边界

| Tool | 边界 | 黑盒效果 |
|------|------|----------|
| **Glob tool** | 按文件名模式搜索：`*.ts`、`src/**/*.md` | 用户感知：找到符合命名模式的文件列表 |
| **Grep tool** | 按文件内容搜索：文本字符串或正则表达式 | 用户感知：找到包含特定内容的文件和行号 |
| **Read tool** | 读取文件完整内容或指定行范围 | 用户感知：查看文件内容 |
| **Bash tool** | 执行 shell 命令（可调用 grep/ripgrep 等） | 用户感知：执行任意命令，无结构化结果 |

**关键区分**：
- Glob tool 基于**文件名/路径模式**搜索，回答"哪些文件叫这个名字？"
- Grep tool 基于**文件内容**搜索，回答"哪些文件包含这段文字？"
- Read tool 读取**已知文件**的内容
- Bash tool 虽然可以通过 shell grep 实现搜索，但 Grep tool 提供结构化的搜索结果和 workspace 安全保证

## 非目标

- 不定义通用全文搜索引擎。
- 不定义 workspace 外文件搜索。
- 不定义基于语义的相似性搜索（由 RAG tool 负责）。
- 不定义文件内容替换（由 Edit tool 负责）。

## 黑盒效果

用户通过 Grep tool 可以：
1. 指定搜索模式（文本或正则表达式）
2. 可选指定搜索范围（目录、文件类型过滤）
3. 获得结构化的匹配结果：`[{file, line, column, context}]`

系统保证：
- 搜索范围限制在 workspace 内
- 忽略二进制文件和大文件（可配置阈值）
- 支持上下文行显示（如前后各 3 行）
- 搜索结果按相关性或文件路径排序
