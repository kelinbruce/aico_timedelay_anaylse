# add-ts-glob-tool

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Tool

状态：active
类型：实施 change
主要 owner：`agent-capability`
依赖：`add-ts-builtin-tool-framework`

目标：
- 新增 Glob tool descriptor 配置。
- 新增 Glob tool executor handler。
- 在 trusted workspace root 下搜索 workspace-relative 文件。

非目标：
- 不定义通用文件系统搜索控制。
- 不定义 workspace 外的文件搜索。
- 不定义商用交付场景的文件搜索（测试专用）。
