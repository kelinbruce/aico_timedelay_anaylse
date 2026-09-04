## ADDED Requirements

### Requirement: Skill Modal 打开期间 SHALL 保持外框几何稳定

Skill 列表 Modal 在一次打开期间 MUST 使用固定的列表视口高度。首次加载、搜索加载、搜索结果、空结果和分页追加 MUST 只更新列表视口内部内容，MUST NOT 因异步数据状态变化而改变 Modal 的外框高度或锚定位置。列表内容超过该视口时 MUST 使用内部垂直滚动。

#### Scenario: 首次 Skill 请求完成不移动 Modal
- **WHEN** 用户点击“全部”打开 Modal，且首次 Skill 请求在 Modal 显示后完成
- **THEN** 请求完成前后 Modal 的外框高度和锚定位置 MUST 保持不变
- **AND** Skill 结果 MUST 在既有列表视口内显示

#### Scenario: 搜索结果数量变化不移动 Modal
- **WHEN** 用户在已打开的 Modal 中搜索，且 loading、结果或空结果依次替换列表内容
- **THEN** Modal 的外框高度和锚定位置 MUST 保持不变
- **AND** 超出列表视口的结果 MUST 通过内部垂直滚动访问
