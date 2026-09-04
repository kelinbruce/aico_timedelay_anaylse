## REMOVED Requirements

### Requirement: Dynamic execution SHALL use deployment-mode-specific sandbox enforcement

**Reason**：该 Requirement 的输入、目标行为、结果和失败语义属于 `FN-6.3 沙箱执行命令`，并且本次修改其宿主权限元数据行为；继续留在 `skill-resource-access` 会使同一沙箱执行契约跨两个 specs 承载。

**Migration**：完整目标行为迁入 canonical spec `sandbox-runtime` 的同名 Requirement；`skill-resource-access` 中其他未触及 Requirements 原位保留。
