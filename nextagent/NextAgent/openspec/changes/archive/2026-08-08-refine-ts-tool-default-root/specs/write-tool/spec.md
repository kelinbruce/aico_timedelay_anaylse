## REMOVED Requirements

### Requirement: Write Input And Output Are Bounded

**Reason**：路径输入和输出语义改为 execution-view-relative，并迁入 `FN-5.3 读写编辑文件` 的 canonical spec。

**Migration**：使用 `file-operation-tools` 中同名 Requirement；调用方为持久化结果显式使用 `workspace/...`。

### Requirement: Write Uses Trusted Agent-Scoped Directory Authority

**Reason**：`writeDirectories` 的默认根语义改为 execution view，并迁入 `FN-5.3 读写编辑文件` 的 canonical spec。

**Migration**：使用 `file-operation-tools` 中同名 Requirement；`"."` 表示 execution view 根，已知只读 root 继续拒绝写入。
