# add-ts-write-tool

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Tool

状态：active
类型：实施 change
主要 owner：`agent-capability`
依赖：`add-ts-builtin-tool-framework`

目标：
- 新增 Write tool descriptor/schema definition。
- 新增 Write tool executor handler。
- 写入 trusted workspace root 下的 workspace-relative 文件，并拒绝逃逸 workspace root 的路径。

非目标：
- 不定义通用文件系统写入控制。
- 不定义 workspace 外文件修改。
- 不定义 sandbox 路由（Write 不需要 sandbox）。
- 不定义商用交付场景的文件写入（调试专用）。
