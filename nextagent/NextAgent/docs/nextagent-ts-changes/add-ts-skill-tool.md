# add-ts-skill-tool

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Tool

状态：active
类型：实施 change
主要 owner：`agent-capability`
依赖：`add-ts-skill-manifest-contract`、`add-ts-builtin-skill-source`、`add-ts-capability-core-governance`

目标：
- 新增 `Skill` tool descriptor、input/output schema 和 safe result 语义。
- 定义 `skill_id` 到 governed Skill capability 的解析边界。
- Skill tool 不解析 manifest、不读取 Skill 文件、不直接执行 Skill 内容。

非目标：
- 不定义 Skill manifest 格式，由 `add-ts-skill-manifest-contract` 承载。
- 不定义 builtin Skill source，由 `add-ts-builtin-skill-source` 承载。
- 不实现 INLINE/FORK、nested invocation、progressive disclosure 或 Skill installation。
