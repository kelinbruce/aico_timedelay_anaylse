## REMOVED Requirements

### Requirement: Grep Has A Strict Pattern And Path Contract

**Reason**：Grep path 与输出改为 execution-view-relative，并迁入 `FN-5.4 搜索文件` canonical spec。

**Migration**：使用 `file-search-tools` 中同名 Requirement；无 `path` 时从授权 execution view 搜索。

### Requirement: Grep Uses Agent-Scoped Read Authority

**Reason**：effective Read authority 的默认根改为 execution view，并迁入 `FN-5.4 搜索文件` canonical spec。

**Migration**：使用 `file-search-tools` 中同名 Requirement；root access mode 与 Agent-scoped authority 继续生效。
