## REMOVED Requirements

### Requirement: 长期记忆管理提供唯一 Channel 端口

**Reason**：该 Requirement 的 method 集合被批量新增触及，按 legacy 收敛规则迁入 `memory-core` 主规格并更新为 13 个 operation。

**Migration**：归档时把目标态 Requirement 合并到 `openspec/specs/memory-core/spec.md`，并从本 legacy spec 删除原 Requirement。

### Requirement: Management 调用使用可信 Scope 和取消上下文

**Reason**：该 Requirement 的 management method 数量和批量调用取消边界被触及，按 legacy 收敛规则迁入 `memory-core` 主规格。

**Migration**：归档时把目标态 Requirement 合并到 `openspec/specs/memory-core/spec.md`，并从本 legacy spec 删除原 Requirement。

### Requirement: Management Boundary 由 Composition 显式启用

**Reason**：该 Requirement 的 route 数量被批量新增触及，按 legacy 收敛规则迁入 `memory-core` 主规格。

**Migration**：归档时把目标态 Requirement 合并到 `openspec/specs/memory-core/spec.md`，并从本 legacy spec 删除原 Requirement。
