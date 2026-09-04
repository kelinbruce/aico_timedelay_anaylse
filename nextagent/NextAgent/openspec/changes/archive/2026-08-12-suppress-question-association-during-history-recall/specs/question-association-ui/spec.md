## REMOVED Requirements

### Requirement: 联想面板触发规则

**Reason**: 该 Requirement 属于 `FN-1.18 输入联想`，且本 change 修改其历史回看触发边界；继续留在 legacy `question-association-ui` 会使同一 Function 的触发契约分散在多个 specs。

**Migration**: 完整目标行为迁入 canonical spec `question-association-api` 的同名 Requirement；`question-association-ui` 中未触及的数据获取、视觉展示、键盘交互、鼠标交互和面板样式 Requirements 原位保留。
