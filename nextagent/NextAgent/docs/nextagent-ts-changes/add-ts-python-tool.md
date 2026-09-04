# add-ts-python-tool

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Tool

状态：active
类型：实施 change
主要 owner：`agent-capability`
依赖：`add-ts-builtin-tool-framework`、`add-ts-executable-tool-sandbox-runtime`

目标：
- 新增 Python tool descriptor 配置。
- 新增 Python tool executor handler。
- 集成 sandbox gateway 执行 Python 脚本。

非目标：
- 不定义沙箱机制，由 `add-ts-executable-tool-sandbox-runtime` 定义。
- 不提供绕过沙箱的执行路径。
