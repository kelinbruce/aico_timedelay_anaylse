## REMOVED Requirements

### Requirement: Workspace File Dependency Supports Governed Discovery

**Reason**：该混合 Requirement 中的文件发现输出从 workspace-relative 改为 execution-view-relative，已经发生实质变化；Glob 的黑盒发现与 authority 行为迁入 `FN-5.4 搜索文件` canonical spec，依赖 owner、共享 port 和 traversal 白盒约束归入本 change design。

**Migration**：使用 `file-search-tools` 的 `文件搜索工具使用 execution view 默认根`、`Glob Has A Strict Pattern And Path Contract` 与 `Glob Uses Agent-Scoped Read Authority`；共享 `WorkspaceFilePort` 边界按 design `FN-5.4 搜索文件 / 修改方案` 实施。
