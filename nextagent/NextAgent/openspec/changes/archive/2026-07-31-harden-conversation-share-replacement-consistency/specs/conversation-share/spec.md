## REMOVED Requirements

### Requirement: Shared conversation view Web API contract

**Reason**：该 Requirement 的唯一黑盒归属是 `FN-1.15 查看分享的会话`。本 change 修改其内容解析与失败语义，因此按触及即迁移规则从混合承载多个 Functions 的 legacy `conversation-share` 迁出。

**Migration**：完整目标态以 `ADDED` 形式迁入 `specs/shared-conversation-view/spec.md`；创建分享、有效期、ops、页面路由、只读展示和会话清理等未触及 Requirements 原位保留。

### Requirement: Owner scope controlled exception for share viewing

**Reason**：该 Requirement 的唯一黑盒归属是 `FN-1.15 查看分享的会话`。本 change 修改其 attempt 补全读取范围与安全隐藏边界，因此按触及即迁移规则从 legacy `conversation-share` 迁出。

**Migration**：完整目标态以 `ADDED` 形式迁入 `specs/shared-conversation-view/spec.md`；长期 owner scope 架构导航在归档时改指新的 canonical spec。
