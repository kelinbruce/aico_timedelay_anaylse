# add-ts-tool-search-tool

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Tool

状态：active
类型：实施 change
主要 owner：`agent-capability`
依赖：`add-ts-capability-core-governance`

目标：
- 新增 ToolSearch tool descriptor、input/output schema 和 safe result。
- 只搜索当前 run 已治理、已授权、可安全披露的候选工具 metadata。
- 定义搜索结果的安全字段、稳定排序、limit、truncation 和 scope 约束。

非目标：
- 不动态安装工具。
- 不扫描文件系统、SkillHub、MCP server 或 API source。
- 不定义 capability conflict resolution 或 source configuration。
- 不扩大当前 Agent 已授权或可见工具集合。
