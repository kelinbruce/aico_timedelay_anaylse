## REMOVED Requirements

### Requirement: Edit Input And Output Are Bounded

**Reason**：路径输入和输出语义改为 execution-view-relative，并迁入 `FN-5.3 读写编辑文件` 的 canonical spec。

**Migration**：使用 `file-operation-tools` 中同名 Requirement；调用方为持久化结果显式使用 `workspace/...`。

### Requirement: Edit Rejects Targets Outside Authorized Write Directories

**Reason**：目录授权改为 execution-view-relative，并迁入 `FN-5.3 读写编辑文件` 的 canonical spec。

**Migration**：使用 `file-operation-tools` 中同名 Requirement；已知 logical root 的 access mode 仍具有最终约束力。
